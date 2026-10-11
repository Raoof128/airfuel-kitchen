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

const entitySchema = z.enum(tableNames);
export type Entity = z.infer<typeof entitySchema>;
const wireSchema = z
  .object({
    entity: entitySchema,
    record_id: z.string().min(1).max(300),
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    operation_id: z.string().uuid(),
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
  // Write-ahead receipt makes applying data across two IndexedDB databases recoverable.
  incoming?: WireRecord;
}
export class SyncDB extends Dexie {
  records!: Table<TrackedRecord, string>;
  meta!: Table<{ key: string; value: string }, string>;
  constructor(name = "airfuel-kitchen-sync") {
    super(name);
    this.version(1).stores({ records: "key", meta: "key" });
  }
}
export interface CloudAdapter {
  apply(record: WireRecord): Promise<WireRecord>;
  readAll(): Promise<WireRecord[]>;
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
    return (await this.metadata.records.toArray()).filter((row) => row.pending)
      .length;
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
      const current = await table.get(incoming.record_id);
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
  async scanLocal(): Promise<void> {
    const local = await this.local.transaction(
      "r",
      this.local.tables,
      async () => {
        const rows: { entity: Entity; recordId: string; payload: unknown }[] =
          [];
        for (const entity of tableNames)
          for (const payload of await this.local.table(entity).toArray()) {
            const validated = validators[entity].parse(payload);
            rows.push({ entity, recordId: validated.id, payload: validated });
          }
        return rows;
      },
    );
    const current = new Map(
      local.map((row) => [JSON.stringify([row.entity, row.recordId]), row]),
    );
    await this.metadata.transaction("rw", this.metadata.records, async () => {
      const tracked = new Map(
        (await this.metadata.records.toArray()).map((row) => [row.key, row]),
      );
      for (const key of new Set([...current.keys(), ...tracked.keys()])) {
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
  async run(): Promise<{ pending: number }> {
    await this.recoverReceipts();
    await this.scanLocal();
    for (const state of await this.metadata.records.toArray())
      if (state.pending)
        await this.acceptRemote(await this.adapter.apply(state.pending));
    for (const record of await this.adapter.readAll())
      await this.acceptRemote(record);
    // Capture user edits made during network requests; the next pass sends them.
    await this.scanLocal();
    return { pending: await this.pendingCount() };
  }
}
