// Supabase adapter contract with a fake PostgREST-shaped client (no network): error-to-policy mapping,
// paginated reads, account isolation, skipped unreadable rows and the status display mapping.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifySyncError,
  forgetSyncBaselines,
  SyncDB,
  SyncEngine,
  SyncError,
  type CloudAdapter,
  type WireRecord,
} from "../../src/cloud/core";
import {
  createSupabaseAdapter,
  postgrestErrorKind,
} from "../../src/cloud/supabase";
import { syncDisplayState, type CloudStatus } from "../../src/cloud/index";
import { createActions, KitchenDB } from "../../src/lib/db";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OP = "00000000-0000-4000-8000-000000000042";

interface Row {
  user_id: string;
  entity: string;
  record_id: string;
  revision: number;
  operation_id: string;
  deleted: boolean;
  payload: unknown;
}

// Fake PostgREST: honours eq/order/range and returns an exact count, like select("*", {count:"exact"}).
function fakeClient(options: {
  rows?: Row[];
  serverPageCap?: number;
  // A misbehaving or misconfigured server that ignores the owner filter.
  ignoreOwnerFilter?: boolean;
  rpc?: (name: string, args: Record<string, unknown>) => unknown;
}) {
  const requests: {
    filters: Record<string, unknown>;
    from: number;
    to: number;
  }[] = [];
  const rows = options.rows ?? [];
  const client = {
    from: () => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        order: () => builder,
        range: async (from: number, to: number) => {
          requests.push({ filters: { ...filters }, from, to });
          const owned = options.ignoreOwnerFilter
            ? rows
            : rows.filter((row) => row.user_id === filters.user_id);
          const cap = options.serverPageCap ?? 1000;
          const end = Math.min(to + 1, from + cap);
          return {
            data: owned.slice(from, end),
            error: null,
            count: owned.length,
          };
        },
      };
      return builder;
    },
    rpc: async (name: string, args: Record<string, unknown>) =>
      options.rpc ? options.rpc(name, args) : { data: null, error: null },
  };
  return { client: client as unknown as SupabaseClient, requests };
}

function rowFor(userId: string, index: number): Row {
  return {
    user_id: userId,
    entity: "sessions",
    record_id: `session-${String(index).padStart(5, "0")}`,
    revision: 1,
    operation_id: OP,
    deleted: false,
    payload: {
      id: `session-${String(index).padStart(5, "0")}`,
      updatedAt: 1,
      recipeId: "chicken",
      date: "2026-10-11",
      servingsPrepared: 2,
      servingsConsumed: 1,
      rating: null,
      actualMinutes: null,
      ingredientChanges: "",
      temperatureC: null,
      timeChanges: "",
      notes: "",
      wouldCookAgain: null,
    },
  };
}

const opened: (KitchenDB | SyncDB)[] = [];
afterEach(async () => {
  for (const database of opened.splice(0)) await database.delete();
});

describe("PostgREST error mapping", () => {
  it("maps each error shape to exactly one retry policy", () => {
    expect(
      postgrestErrorKind({ code: "PGRST301", message: "JWT expired" }),
    ).toBe("auth");
    expect(
      postgrestErrorKind({ code: "42501", message: "Authentication required" }),
    ).toBe("auth");
    expect(postgrestErrorKind({ code: "", message: "JWT is invalid" })).toBe(
      "auth",
    );
    expect(
      postgrestErrorKind({
        code: "42501",
        message: "new row violates row-level security policy",
      }),
    ).toBe("config");
    expect(
      postgrestErrorKind({
        code: "23514",
        message: "violates check constraint",
      }),
    ).toBe("permanent");
    expect(
      postgrestErrorKind({ code: "22001", message: "value too long" }),
    ).toBe("permanent");
    expect(postgrestErrorKind({ code: "P0001", message: "raised" })).toBe(
      "permanent",
    );
    expect(
      postgrestErrorKind({ code: "57014", message: "statement timeout" }),
    ).toBe("transient");
    expect(
      postgrestErrorKind({ code: "53400", message: "Record quota exceeded" }),
    ).toBe("permanent");
    expect(
      postgrestErrorKind({ code: "", message: "TypeError: fetch failed" }),
    ).toBe("transient");
  });

  it("turns a server constraint rejection into a permanent SyncError on apply", async () => {
    const { client } = fakeClient({
      rpc: () => ({
        data: null,
        error: { code: "23514", message: "check constraint violated" },
      }),
    });
    const adapter = createSupabaseAdapter(client, ME);
    const record: WireRecord = {
      entity: "sessions",
      record_id: "x",
      revision: 1,
      operation_id: OP,
      deleted: true,
      payload: null,
    };
    const error = await adapter
      .apply(record)
      .catch((caught: unknown) => caught);
    expect(classifySyncError(error)).toBe("permanent");
    expect((error as Error).message).toContain("check constraint violated");
  });

  it("turns an expired JWT into an auth failure rather than a retryable write", async () => {
    const { client } = fakeClient({
      rpc: () => ({
        data: null,
        error: { code: "PGRST301", message: "JWT expired" },
      }),
    });
    const record: WireRecord = {
      entity: "sessions",
      record_id: "x",
      revision: 1,
      operation_id: OP,
      deleted: true,
      payload: null,
    };
    const error = await createSupabaseAdapter(client, ME)
      .apply(record)
      .catch((caught: unknown) => caught);
    expect(classifySyncError(error)).toBe("auth");
  });

  it("treats a network-level failure as transient so the write is retried", async () => {
    const { client } = fakeClient({
      rpc: () => ({
        data: null,
        error: { code: "", message: "TypeError: fetch failed" },
      }),
    });
    const record: WireRecord = {
      entity: "sessions",
      record_id: "x",
      revision: 1,
      operation_id: OP,
      deleted: true,
      payload: null,
    };
    const error = await createSupabaseAdapter(client, ME)
      .apply(record)
      .catch((caught: unknown) => caught);
    expect(classifySyncError(error)).toBe("transient");
  });
});

describe("paginated reads", () => {
  it("reads every owned row across pages with the owner filter on each request", async () => {
    const rows = Array.from({ length: 1201 }, (_, index) => rowFor(ME, index));
    const { client, requests } = fakeClient({ rows });
    const records = await createSupabaseAdapter(client, ME).readAll();
    expect(records).toHaveLength(1201);
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.filters.user_id === ME)).toBe(
      true,
    );
  });

  it("fails loudly when the API row limit silently truncates pages", async () => {
    const rows = Array.from({ length: 600 }, (_, index) => rowFor(ME, index));
    const { client } = fakeClient({ rows, serverPageCap: 300 });
    await expect(createSupabaseAdapter(client, ME).readAll()).rejects.toThrow(
      "row limit",
    );
  });

  it("stops the read when the signed-in account changes between pages", async () => {
    const rows = Array.from({ length: 600 }, (_, index) => rowFor(ME, index));
    const { client, requests } = fakeClient({ rows });
    let active = true;
    const adapter = createSupabaseAdapter(client, ME, () => active);
    const originalFrom = client.from.bind(client);
    client.from = ((table: string) => {
      if (requests.length === 1) active = false;
      return originalFrom(table);
    }) as SupabaseClient["from"];
    const error = await adapter.readAll().catch((caught: unknown) => caught);
    expect(classifySyncError(error)).toBe("auth");
    // Page two was requested, but its rows are discarded before use because the account changed.
    expect(requests).toHaveLength(2);
  });

  it("refuses rows that belong to another account even when the server ignores the owner filter", async () => {
    const rows = [rowFor(ME, 1), rowFor(OTHER, 2)];
    const { client } = fakeClient({ rows, ignoreOwnerFilter: true });
    const error = await createSupabaseAdapter(client, ME)
      .readAll()
      .catch((caught: unknown) => caught);
    expect(classifySyncError(error)).toBe("auth");
    expect((error as Error).message).toContain("another account");
  });

  it("skips one invalid remote row, counts it, and still applies the rest", async () => {
    const broken: Row = {
      ...rowFor(ME, 9),
      payload: { id: "different-id", notes: "" },
    };
    const { client } = fakeClient({
      rows: [rowFor(ME, 1), broken, rowFor(ME, 2)],
    });
    const adapter = createSupabaseAdapter(client, ME);
    const records = await adapter.readAll();
    expect(records.map((record) => record.record_id)).toEqual([
      "session-00001",
      "session-00002",
    ]);
    expect(adapter.unreadableCount?.()).toBe(1);
  });
});

describe("conflicts, blocked records and status mapping", () => {
  function device(adapter: CloudAdapter) {
    const name = `transport-${crypto.randomUUID()}`;
    const local = new KitchenDB(`${name}-local`);
    const metadata = new SyncDB(`${name}-sync`);
    opened.push(local, metadata);
    return {
      local,
      metadata,
      actions: createActions(local),
      engine: new SyncEngine(local, metadata, adapter),
    };
  }

  it("a rejected record stays local, and a later edit clears the block and retries", async () => {
    const seen: string[] = [];
    let reject = true;
    const adapter: CloudAdapter = {
      async apply(record) {
        seen.push(record.operation_id);
        if (reject) throw new SyncError("too big", "permanent");
        return record;
      },
      async readAll() {
        return [];
      },
    };
    const a = device(adapter);
    await a.actions.patchRecipeState("chicken", { notes: "first" });
    expect((await a.engine.run()).rejected).toBe(1);
    await a.engine.run();
    expect(seen).toHaveLength(1);
    reject = false;
    await a.actions.patchRecipeState("chicken", { notes: "shorter" });
    const result = await a.engine.run();
    expect(result.rejected).toBe(0);
    expect(seen).toHaveLength(2);
  });

  it("keeps a displaced local value for the owner to restore, and resolving it makes it a new edit", async () => {
    const cloud = new Map<string, WireRecord>();
    const adapter: CloudAdapter = {
      async apply(record) {
        const key = record.record_id;
        const current = cloud.get(key);
        if (
          !current ||
          record.revision > current.revision ||
          (record.revision === current.revision &&
            record.operation_id > current.operation_id)
        )
          cloud.set(key, structuredClone(record));
        return structuredClone(cloud.get(key)!);
      },
      async readAll() {
        return [...cloud.values()];
      },
    };
    const a = device(adapter);
    const b = device(adapter);
    await a.actions.patchRecipeState("chicken", { notes: "A version" });
    await b.actions.patchRecipeState("chicken", { notes: "B version" });
    await a.engine.run();
    await b.engine.run();
    await a.engine.run();
    const conflicts = await a.engine.listConflicts();
    const b2 = await b.engine.listConflicts();
    expect(conflicts.length + b2.length).toBeGreaterThanOrEqual(1);
    const holder = conflicts.length ? a : b;
    const [kept] = conflicts.length ? conflicts : b2;
    const keptNotes = (kept.local as { notes: string }).notes;
    await holder.engine.resolveConflict(kept.key, "local");
    expect((await holder.local.recipeStates.get("chicken"))?.notes).toBe(
      keptNotes,
    );
    expect(await holder.engine.conflictCount()).toBe(0);
  });

  it("maps the sync state to the six states the owner must be able to tell apart", () => {
    const base: CloudStatus = {
      phase: "ready",
      email: "owner@example.com",
      enabled: true,
      pending: 0,
      rejected: 0,
      conflicts: 0,
      lastSyncedAt: 1,
      message: "",
    };
    expect(syncDisplayState({ ...base, enabled: false, pending: 2 })).toBe(
      "saved-locally",
    );
    expect(syncDisplayState({ ...base, phase: "offline", pending: 2 })).toBe(
      "saved-locally",
    );
    expect(syncDisplayState({ ...base, pending: 2 })).toBe("waiting");
    expect(syncDisplayState({ ...base, phase: "syncing", pending: 2 })).toBe(
      "syncing",
    );
    expect(syncDisplayState(base)).toBe("synced");
    expect(syncDisplayState({ ...base, conflicts: 1 })).toBe("conflict");
    expect(syncDisplayState({ ...base, rejected: 1, conflicts: 1 })).toBe(
      "failed",
    );
    expect(syncDisplayState({ ...base, phase: "error" })).toBe("failed");
  });

  it("refuses to clear the sync cache while conflicts are unresolved, and keeps them", async () => {
    const meta = new SyncDB();
    opened.push(meta);
    const held = {
      key: "held-back",
      entity: "recipeStates" as const,
      recordId: "chicken",
      local: { id: "chicken", notes: "kept on device" },
      remote: { id: "chicken", notes: "cloud" },
      remoteRevision: 2,
      remoteOperationId: OP,
      createdAt: 1,
    };
    await meta.conflicts.put(held);
    await expect(forgetSyncBaselines(meta)).rejects.toThrow(
      "Resolve the sync conflicts",
    );
    expect(await meta.conflicts.count()).toBe(1);
  });
});

describe("SEC-8 regression: one corrupt remote row cannot stall a pull", () => {
  it("applies every valid row around a malformed one, counts the bad row, and completes the pass", async () => {
    const name = `sec8-${crypto.randomUUID()}`;
    const local = new KitchenDB(`${name}-local`);
    const metadata = new SyncDB(`${name}-sync`);
    opened.push(local, metadata);
    const corrupt: Row = {
      ...rowFor(ME, 2),
      payload: { id: "not-the-record-id", notes: "" },
    };
    const { client } = fakeClient({
      rows: [rowFor(ME, 1), corrupt, rowFor(ME, 3)],
    });
    const engine = new SyncEngine(
      local,
      metadata,
      createSupabaseAdapter(client, ME),
    );
    const result = await engine.run();
    expect(result.unreadable).toBe(1);
    expect(await local.sessions.get("session-00001")).toBeDefined();
    expect(await local.sessions.get("session-00003")).toBeDefined();
    expect(await local.sessions.get("session-00002")).toBeUndefined();
  });
});
