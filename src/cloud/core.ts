import Dexie, { type Table } from "dexie";
import { z } from "zod";
import { KitchenDB, tableNames } from "../lib/db";
import {
  activeCookingSchema,
  customRecipeSchema,
  overrideSchema,
  pantrySchema,
  planSchema,
  preferenceSchema,
  recipeStateSchema,
  sessionSchema,
  shoppingSchema,
} from "../lib/schema";

export type SyncErrorKind = "transient" | "permanent" | "config" | "auth";
// Transient: network, timeout, server or unexpected response. Retried with backoff.
// Permanent: the server or validator rejected this record's content. Never retried until the record changes or the owner retries it.
// Config: the project refused the write for permission or row-level-security reasons. A server setup fault, so the whole pass stops and is retried with backoff.
// Auth: the session is no longer valid. Automatic retries stop until the user signs in again.
export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  constructor(
    message: string,
    kind: SyncErrorKind,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SyncError";
    this.kind = kind;
  }
}
export function classifySyncError(error: unknown): SyncErrorKind {
  if (error instanceof SyncError) return error.kind;
  // Local or remote payloads that fail the per-entity schema will fail identically on every retry.
  if (error instanceof z.ZodError) return "permanent";
  return "transient";
}
// 30s, 60s, 120s, 240s, then 5 minutes. Retries never become unbounded in frequency.
export function retryDelay(failures: number): number {
  return Math.min(300000, 30000 * 2 ** Math.min(Math.max(failures, 0), 4));
}
function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The cloud rejected this change.";
}

const entitySchema = z.enum(tableNames);
export type Entity = z.infer<typeof entitySchema>;
const wireSchema = z
  .object({
    entity: entitySchema,
    record_id: z.string().min(1).max(300),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    // Postgres orders uuids bytewise (lower-case hex). Normalising keeps the client tie-break identical.
    operation_id: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    deleted: z.boolean(),
    payload: z.unknown(),
  })
  .strict();
export type WireRecord = z.infer<typeof wireSchema>;
const validators = {
  recipeStates: recipeStateSchema,
  sessions: sessionSchema,
  plans: planSchema,
  pantry: pantrySchema,
  shopping: shoppingSchema,
  customRecipes: customRecipeSchema,
  overrides: overrideSchema,
  preferences: preferenceSchema,
  activeCooking: activeCookingSchema,
};
export function validateWire(value: unknown): WireRecord {
  const row = wireSchema.parse(value);
  if (row.deleted) {
    if (row.payload !== null)
      throw new Error("A deleted record must have no payload.");
  } else {
    row.payload = validators[row.entity].parse(row.payload);
    if ((row.payload as { id: string }).id !== row.record_id)
      throw new Error("Cloud record ID does not match its payload.");
  }
  return row;
}
export function stableStringify(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function compareVersion(
  a: Pick<WireRecord, "revision" | "operation_id">,
  b: Pick<WireRecord, "revision" | "operation_id">,
): number {
  return (
    a.revision - b.revision ||
    (a.operation_id < b.operation_id
      ? -1
      : a.operation_id > b.operation_id
        ? 1
        : 0)
  );
}
interface TrackedRecord {
  key: string;
  entity: Entity;
  recordId: string;
  fingerprint: string;
  revision: number;
  operationId: string;
  pending?: WireRecord;
  // Set when the server permanently rejected this pending write. It is kept, not retried, and
  // cleared when the record changes locally (which creates a new operation).
  blocked?: { operationId: string; message: string };
  // Write-ahead receipt makes applying data across two IndexedDB databases recoverable.
  incoming?: WireRecord;
}
// A value that a same-record conflict displaced. Both sides are kept until the owner chooses.
export interface ConflictRecord {
  key: string;
  entity: Entity;
  recordId: string;
  // The value this device had (null means deleted) and the value the cloud held (null means deleted).
  local: unknown | null;
  remote: unknown | null;
  remoteRevision: number;
  remoteOperationId: string;
  createdAt: number;
}
export class SyncDB extends Dexie {
  records!: Table<TrackedRecord, string>;
  meta!: Table<{ key: string; value: string }, string>;
  conflicts!: Table<ConflictRecord, string>;
  constructor(name = "airfuel-kitchen-sync") {
    super(name);
    this.version(1).stores({ records: "key", meta: "key" });
    this.version(2).stores({ records: "key", meta: "key", conflicts: "key" });
  }
}
export interface CloudAdapter {
  apply(record: WireRecord): Promise<WireRecord>;
  readAll(): Promise<WireRecord[]>;
  // Remote rows that failed validation in the last readAll and were skipped (not applied).
  unreadableCount?(): number;
}
export async function listConflicts(
  metadata: SyncDB,
): Promise<ConflictRecord[]> {
  return metadata.conflicts.toArray();
}
// The owner picks which version stays. The choice becomes a normal local edit and syncs from there.
export async function resolveConflict(
  local: KitchenDB,
  metadata: SyncDB,
  key: string,
  side: "local" | "remote",
): Promise<void> {
  const conflict = await metadata.conflicts.get(key);
  if (!conflict) return;
  const chosen = side === "local" ? conflict.local : conflict.remote;
  const table = local.table(conflict.entity);
  await local.transaction("rw", table, async () => {
    if (chosen === null) await table.delete(conflict.recordId);
    else await table.put(validators[conflict.entity].parse(chosen));
  });
  await metadata.conflicts.delete(key);
}
// Fingerprints are taken from the validated form (zod trims and normalises), so local rows must be
// compared in that same form. Comparing a raw row with a validated fingerprint makes a row look
// edited forever, which would skip a remote update and then push the stale value over it.
function validatedLocal(entity: Entity, value: unknown): unknown {
  const parsed = validators[entity].safeParse(value);
  return parsed.success ? parsed.data : value;
}
export class SyncEngine {
  constructor(
    readonly local: KitchenDB,
    readonly metadata: SyncDB,
    readonly adapter: CloudAdapter,
  ) {}
  async bind(identity: string): Promise<void> {
    await this.metadata.transaction("rw", this.metadata.meta, async () => {
      const binding = await this.metadata.meta.get("binding");
      if (binding && binding.value !== identity)
        throw new Error(
          "This browser data is already bound to another cloud account or project. Use a separate browser profile for another account.",
        );
      if (!binding)
        await this.metadata.meta.put({ key: "binding", value: identity });
    });
  }
  async pendingCount(): Promise<number> {
    return (await this.metadata.records.toArray()).filter(
      (row) => row.pending && !row.blocked,
    ).length;
  }
  async rejectedCount(): Promise<number> {
    return (await this.metadata.records.toArray()).filter((row) => row.blocked)
      .length;
  }
  async conflictCount(): Promise<number> {
    return this.metadata.conflicts.count();
  }
  async listConflicts(): Promise<ConflictRecord[]> {
    return listConflicts(this.metadata);
  }
  async resolveConflict(key: string, side: "local" | "remote"): Promise<void> {
    return resolveConflict(this.local, this.metadata, key, side);
  }
  async recoverReceipts(): Promise<void> {
    for (const state of await this.metadata.records.toArray())
      if (state.incoming) await this.finishReceipt(state);
  }
  private async finishReceipt(state: TrackedRecord): Promise<void> {
    const incoming = state.incoming!;
    const nextFingerprint = stableStringify(incoming.payload);
    const table = this.local.table(incoming.entity);
    await this.local.transaction("rw", table, async () => {
      const current = validatedLocal(
        incoming.entity,
        await table.get(incoming.record_id),
      );
      // Edits made while the request was in flight always survive and become a later revision.
      if (stableStringify(current) === state.fingerprint) {
        if (incoming.deleted) await table.delete(incoming.record_id);
        else await table.put(incoming.payload);
      }
    });
    await this.metadata.records.put({
      key: state.key,
      entity: incoming.entity,
      recordId: incoming.record_id,
      fingerprint: nextFingerprint,
      revision: incoming.revision,
      operationId: incoming.operation_id,
    });
  }
  // Number of local rows that fail validation in the last scan. They are kept and never synced.
  invalidLocalCount = 0;
  async scanLocal(): Promise<void> {
    const { rows: local, invalid } = await this.local.transaction(
      "r",
      this.local.tables,
      async () => {
        const rows: { entity: Entity; recordId: string; payload: unknown }[] =
          [];
        const invalidKeys = new Set<string>();
        for (const entity of tableNames)
          for (const payload of await this.local.table(entity).toArray()) {
            const parsed = validators[entity].safeParse(payload);
            if (!parsed.success) {
              // An invalid row is neither uploaded nor treated as deleted; treating it as missing would
              // send a tombstone that deletes the cloud copy.
              const id = (payload as { id?: unknown } | null)?.id;
              invalidKeys.add(JSON.stringify([entity, String(id)]));
              continue;
            }
            rows.push({
              entity,
              recordId: parsed.data.id,
              payload: parsed.data,
            });
          }
        return { rows, invalid: invalidKeys };
      },
    );
    this.invalidLocalCount = invalid.size;
    const current = new Map(
      local.map((row) => [JSON.stringify([row.entity, row.recordId]), row]),
    );
    await this.metadata.transaction("rw", this.metadata.records, async () => {
      const tracked = new Map(
        (await this.metadata.records.toArray()).map((row) => [row.key, row]),
      );
      for (const key of new Set([...current.keys(), ...tracked.keys()])) {
        if (invalid.has(key)) continue;
        const row = current.get(key);
        const state = tracked.get(key);
        if (state?.incoming)
          throw new Error("Recover pending cloud changes before scanning.");
        const fingerprint = stableStringify(row?.payload);
        if (fingerprint === (state?.fingerprint ?? "null")) continue;
        const entity = row?.entity ?? state!.entity;
        const recordId = row?.recordId ?? state!.recordId;
        const revision = (state?.revision ?? 0) + 1;
        const pending = validateWire({
          entity,
          record_id: recordId,
          revision,
          operation_id: crypto.randomUUID(),
          deleted: !row,
          payload: row?.payload ?? null,
        });
        await this.metadata.records.put({
          key,
          entity,
          recordId,
          fingerprint,
          revision,
          operationId: pending.operation_id,
          pending,
        });
      }
    });
  }
  // Same-record conflict: a local value that has not been acknowledged differs from the cloud winner.
  // Whichever side wins by revision/UUID, the other value is recorded here instead of being overwritten.
  private async keepDisplacedValue(
    incoming: WireRecord,
    state: TrackedRecord | undefined,
  ): Promise<void> {
    // Our own acknowledged write is not a conflict.
    if (state?.pending?.operation_id === incoming.operation_id) return;
    const table = this.local.table(incoming.entity);
    const current = validatedLocal(
      incoming.entity,
      await this.local.transaction("r", table, () =>
        table.get(incoming.record_id),
      ),
    );
    const localFingerprint = stableStringify(current);
    const remoteFingerprint = stableStringify(incoming.payload);
    // The same revision with a different operation can only come from a write made without seeing ours,
    // so it displaces an already-acknowledged local value that was never unsynced.
    const concurrentWithAcknowledged =
      !!state &&
      !state.pending &&
      incoming.revision === state.revision &&
      incoming.operation_id !== state.operationId;
    const dirty =
      !!state?.pending ||
      localFingerprint !== (state?.fingerprint ?? "null") ||
      concurrentWithAcknowledged;
    if (!dirty || localFingerprint === remoteFingerprint) return;
    const conflict: ConflictRecord = {
      key: JSON.stringify([
        incoming.entity,
        incoming.record_id,
        incoming.operation_id,
        localFingerprint,
      ]),
      entity: incoming.entity,
      recordId: incoming.record_id,
      local: current === undefined ? null : structuredClone(current),
      remote: incoming.deleted ? null : structuredClone(incoming.payload),
      remoteRevision: incoming.revision,
      remoteOperationId: incoming.operation_id,
      createdAt: Date.now(),
    };
    await this.metadata.conflicts.put(conflict);
  }
  async acceptRemote(value: unknown): Promise<void> {
    const incoming = validateWire(value);
    const key = JSON.stringify([incoming.entity, incoming.record_id]);
    const state = await this.metadata.records.get(key);
    if (
      state &&
      compareVersion(incoming, {
        revision: state.revision,
        operation_id: state.operationId,
      }) < 0
    )
      return;
    if (
      state &&
      !state.pending &&
      compareVersion(incoming, {
        revision: state.revision,
        operation_id: state.operationId,
      }) === 0
    )
      return;
    await this.keepDisplacedValue(incoming, state);
    const receipt: TrackedRecord = {
      key,
      entity: incoming.entity,
      recordId: incoming.record_id,
      fingerprint: state?.fingerprint ?? "null",
      revision: state?.revision ?? 0,
      operationId: state?.operationId ?? "",
      incoming,
    };
    await this.metadata.records.put(receipt);
    await this.finishReceipt(receipt);
  }
  async run(): Promise<{
    pending: number;
    rejected: number;
    conflicts: number;
    unreadable: number;
  }> {
    await this.recoverReceipts();
    await this.scanLocal();
    for (const state of await this.metadata.records.toArray()) {
      if (!state.pending || state.blocked) continue;
      let winner: WireRecord;
      try {
        winner = await this.adapter.apply(state.pending);
      } catch (error) {
        // A rejected record must not stop the others from syncing, but a transient or auth failure
        // stops the pass so nothing is pulled over work that has not been sent.
        if (classifySyncError(error) !== "permanent") throw error;
        await this.metadata.records.put({
          ...state,
          blocked: {
            operationId: state.pending.operation_id,
            message: messageOf(error),
          },
        });
        continue;
      }
      await this.acceptRemote(winner);
    }
    for (const record of await this.adapter.readAll())
      await this.acceptRemote(record);
    // Capture user edits made during network requests; the next pass sends them.
    await this.scanLocal();
    return {
      pending: await this.pendingCount(),
      rejected: (await this.rejectedCount()) + this.invalidLocalCount,
      conflicts: await this.conflictCount(),
      unreadable: this.adapter.unreadableCount?.() ?? 0,
    };
  }
}

// Owner action: re-queue every record the server refused, after the cause is fixed. Keeps all values.
export async function retryRejected(metadata: SyncDB): Promise<number> {
  return metadata.transaction("rw", metadata.records, async () => {
    let cleared = 0;
    for (const row of await metadata.records.toArray())
      if (row.blocked) {
        const unblocked = { ...row };
        delete unblocked.blocked;
        await metadata.records.put(unblocked);
        cleared++;
      }
    return cleared;
  });
}
// Forgets sync baselines (which duplicate content) so the next pass re-derives every local edit.
// Refused while conflicts are unresolved: the next pass would otherwise compare local edits without a
// baseline, and the conflict copies would be discarded. Local values are never removed here.
// Delete-all: removes every sync record on this device, including unresolved conflict copies and the
// account binding. Only the device's own copies are removed; cloud data is untouched.
export async function deleteAllSyncState(metadata: SyncDB): Promise<void> {
  await metadata.transaction(
    "rw",
    [metadata.records, metadata.conflicts, metadata.meta],
    async () => {
      await metadata.records.clear();
      await metadata.conflicts.clear();
      await metadata.meta.clear();
    },
  );
}
export async function forgetSyncBaselines(metadata: SyncDB): Promise<void> {
  await metadata.transaction(
    "rw",
    metadata.records,
    metadata.conflicts,
    async () => {
      if ((await metadata.conflicts.count()) > 0)
        throw new Error(
          "Resolve the sync conflicts on this device, or export a backup, before clearing the sync cache.",
        );
      await metadata.records.clear();
    },
  );
}
