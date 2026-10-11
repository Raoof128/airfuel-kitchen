import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createActions, KitchenDB } from "../../src/lib/db";
import { recipeStateSchema } from "../../src/lib/schema";
import {
  compareVersion,
  stableStringify,
  SyncDB,
  SyncEngine,
  validateWire,
  type CloudAdapter,
  type WireRecord,
} from "../../src/cloud/core";
import {
  createSupabaseAdapter,
  parseCloudConfig,
} from "../../src/cloud/supabase";
const dispose: (KitchenDB | SyncDB)[] = [];
afterEach(async () => {
  for (const database of dispose) await database.delete();
  dispose.length = 0;
});
function device(adapter: CloudAdapter) {
  const local = new KitchenDB(`local-${crypto.randomUUID()}`);
  const metadata = new SyncDB(`sync-${crypto.randomUUID()}`);
  dispose.push(local, metadata);
  return {
    local,
    metadata,
    engine: new SyncEngine(local, metadata, adapter),
    actions: createActions(local),
  };
}
class FakeCloud implements CloudAdapter {
  records = new Map<string, WireRecord>();
  fail = false;
  loseAcknowledgement = false;
  beforeApply?: () => Promise<void>;
  async apply(record: WireRecord) {
    if (this.fail) throw new Error("Offline");
    if (this.beforeApply) {
      const callback = this.beforeApply;
      this.beforeApply = undefined;
      await callback();
    }
    const key = `${record.entity}/${record.record_id}`;
    const previous = this.records.get(key);
    if (!previous || compareVersion(record, previous) > 0)
      this.records.set(key, structuredClone(record));
    if (this.loseAcknowledgement) {
      this.loseAcknowledgement = false;
      throw new Error("Response lost after server committed");
    }
    return structuredClone(this.records.get(key)!);
  }
  async readAll() {
    if (this.fail) throw new Error("Offline");
    return [...this.records.values()].map((row) => structuredClone(row));
  }
}
describe("optional cloud queue and conflict engine", () => {
  it("retains queued offline writes, retries idempotently and propagates deletions", async () => {
    const cloud = new FakeCloud();
    const first = device(cloud);
    const second = device(cloud);
    await first.actions.patchRecipeState("chicken", {
      notes: "original",
      tried: true,
    });
    cloud.fail = true;
    await expect(first.engine.run()).rejects.toThrow("Offline");
    expect(await first.engine.pendingCount()).toBe(1);
    cloud.fail = false;
    cloud.loseAcknowledgement = true;
    await expect(first.engine.run()).rejects.toThrow("Response lost");
    expect(await first.engine.pendingCount()).toBe(1);
    await first.engine.run();
    await second.engine.run();
    expect(cloud.records.size).toBe(1);
    expect((await second.local.recipeStates.get("chicken"))?.notes).toBe(
      "original",
    );
    await first.actions.deleteRecipeState("chicken");
    await first.engine.run();
    await second.engine.run();
    expect(await second.local.recipeStates.count()).toBe(0);
    expect([...cloud.records.values()][0].deleted).toBe(true);
    await first.engine.run();
    expect(await first.local.recipeStates.count()).toBe(0);
  });
  it("converges concurrent same-record changes by revision and UUID tie-break", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const b = device(cloud);
    await a.actions.patchRecipeState("chicken", { notes: "A" });
    await b.actions.patchRecipeState("chicken", { notes: "B" });
    await a.engine.scanLocal();
    await b.engine.scanLocal();
    const aPending = (await a.metadata.records.toArray())[0].pending!;
    const bPending = (await b.metadata.records.toArray())[0].pending!;
    const winner = compareVersion(aPending, bPending) > 0 ? "A" : "B";
    await a.engine.run();
    await b.engine.run();
    await a.engine.run();
    expect((await a.local.recipeStates.get("chicken"))?.notes).toBe(winner);
    expect((await b.local.recipeStates.get("chicken"))?.notes).toBe(winner);
  });
  it("preserves new local edits made during an in-flight network request", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    await a.actions.patchRecipeState("chicken", { notes: "Before request" });
    cloud.beforeApply = () =>
      a.actions.patchRecipeState("chicken", { notes: "Edited during request" });
    expect((await a.engine.run()).pending).toBe(1);
    expect((await a.local.recipeStates.get("chicken"))?.notes).toBe(
      "Edited during request",
    );
    await a.engine.run();
    expect(
      (cloud.records.values().next().value!.payload as { notes: string }).notes,
    ).toBe("Edited during request");
  });
  it("recovers a crash after receipt persistence or local application without losing subsequent edits", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    await a.actions.patchRecipeState("chicken", { notes: "Local" });
    await a.engine.scanLocal();
    const state = (await a.metadata.records.toArray())[0];
    const incoming = {
      ...state.pending!,
      revision: 10,
      operation_id: crypto.randomUUID(),
      payload: { ...(state.pending!.payload as object), notes: "Remote" },
    };
    await a.metadata.records.put({ ...state, incoming });
    // Simulates local application completed, process died before metadata commit, then user edited.
    await a.local.recipeStates.put(recipeStateSchema.parse(incoming.payload));
    await a.actions.patchRecipeState("chicken", { notes: "Edit after crash" });
    await a.engine.recoverReceipts();
    await a.engine.scanLocal();
    const recovered = (await a.metadata.records.toArray())[0];
    expect(recovered.pending?.revision).toBe(11);
    expect((recovered.pending?.payload as { notes: string }).notes).toBe(
      "Edit after crash",
    );
  });
  it("preserves distinct journal IDs and prevents account/project mixing", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    const b = device(cloud);
    const input = {
      recipeId: "chicken",
      date: "2026-10-11",
      servingsPrepared: 2,
      servingsConsumed: 1,
      rating: 5,
      actualMinutes: null,
      ingredientChanges: "",
      temperatureC: null,
      timeChanges: "",
      notes: "",
      wouldCookAgain: true,
    };
    await a.actions.saveSession(input);
    await b.actions.saveSession(input);
    await a.engine.run();
    await b.engine.run();
    await a.engine.run();
    expect(await a.local.sessions.count()).toBe(2);
    expect(await b.local.sessions.count()).toBe(2);
    await a.engine.bind("project|alice");
    await expect(a.engine.bind("project|bob")).rejects.toThrow("another");
  });
  it("rejects unvalidated cloud payloads and uses property-order-independent fingerprints", () => {
    expect(() =>
      validateWire({
        entity: "sessions",
        record_id: "bad",
        revision: 1,
        operation_id: crypto.randomUUID(),
        deleted: false,
        payload: { id: "bad" },
      }),
    ).toThrow();
    expect(stableStringify({ a: 1, b: { c: 2, d: 3 } })).toBe(
      stableStringify({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });
});
describe("cloud configuration and SQL boundary static checks (not live RLS tests)", () => {
  it("rejects cross-owner server responses and stops before a request after sign-out", async () => {
    const record: WireRecord = {
      entity: "recipeStates",
      record_id: "chicken",
      revision: 1,
      operation_id: crypto.randomUUID(),
      deleted: true,
      payload: null,
    };
    let requests = 0;
    const fakeClient = {
      rpc: async () => {
        requests++;
        return { data: [{ ...record, user_id: "other-user" }], error: null };
      },
    } as unknown as SupabaseClient;
    await expect(
      createSupabaseAdapter(fakeClient, "current-user").apply(record),
    ).rejects.toThrow("another account");
    await expect(
      createSupabaseAdapter(fakeClient, "current-user", () => false).apply(
        record,
      ),
    ).rejects.toThrow("stopped");
    expect(requests).toBe(1);
  });
  it("validates server payload before accepting an acknowledged write", async () => {
    const record: WireRecord = {
      entity: "recipeStates",
      record_id: "chicken",
      revision: 1,
      operation_id: crypto.randomUUID(),
      deleted: true,
      payload: null,
    };
    const fakeClient = {
      rpc: async () => ({
        data: [
          {
            ...record,
            user_id: "current-user",
            deleted: false,
            payload: { id: "chicken", notes: "Missing fields" },
          },
        ],
        error: null,
      }),
    } as unknown as SupabaseClient;
    await expect(
      createSupabaseAdapter(fakeClient, "current-user").apply(record),
    ).rejects.toThrow();
  });
  it("rejects service-role, secret, insecure and URL-credential configuration", () => {
    const jwt = (role: string) =>
      `header.${btoa(JSON.stringify({ role }))}.signature`;
    expect(
      parseCloudConfig("https://example.supabase.co", jwt("anon")),
    ).not.toBeNull();
    expect(
      parseCloudConfig("https://example.supabase.co", jwt("service_role")),
    ).toBeNull();
    expect(
      parseCloudConfig(
        "https://example.supabase.co",
        "sb_secret_dont-use-this",
      ),
    ).toBeNull();
    expect(
      parseCloudConfig("http://example.supabase.co", jwt("anon")),
    ).toBeNull();
    expect(
      parseCloudConfig("https://user:pass@example.supabase.co", jwt("anon")),
    ).toBeNull();
  });
  it("contains explicit RLS ownership, authenticated-only RPC and no caller-controlled owner", () => {
    const sql = readFileSync(
      new URL(
        "../../supabase/migrations/202610110001_airfuel_sync.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("using ((select auth.uid()) = user_id)");
    expect(sql).toContain("security definer set search_path = ''");
    expect(sql).toContain("caller uuid := auth.uid()");
    expect(sql).toContain("where user_id = caller");
    expect(sql).toContain("from public, anon");
    expect(sql).not.toContain("p_user_id");
    expect(sql).toContain(
      "grant select on public.airfuel_user_records to authenticated",
    );
    expect(sql).toContain("(excluded.revision, excluded.operation_id) >");
    expect(sql).toContain("jsonb_typeof(payload->'id') = 'string'");
  });
});
