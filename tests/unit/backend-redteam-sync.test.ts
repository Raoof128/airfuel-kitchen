// Red-team checks on sync across two simulated devices. The cloud side is the REAL migration set run
// in PGlite, reached through an adapter that calls the same RPC the Supabase client calls. Each device
// is a fresh KitchenDB and SyncDB on fake-indexeddb. Tests named RT-B<n> are it.fails.
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import Dexie from "dexie";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  deleteAllSyncState,
  forgetSyncBaselines,
  SyncDB,
  SyncEngine,
  SyncError,
  type CloudAdapter,
  type WireRecord,
} from "../../src/cloud/core";
import { createSupabaseAdapter, postgrestErrorKind } from "../../src/cloud/supabase";
import { createActions, exportBackup, KitchenDB } from "../../src/lib/db";

const migrationDir = new URL("../../supabase/migrations/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, migrationDir), "utf8");
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

let pg: PGlite;
async function as(uid: string) {
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await pg.exec("set role authenticated");
}
async function admin() {
  await pg.exec("reset role");
}
interface Row {
  user_id: string;
  entity: string;
  record_id: string;
  revision: number | string;
  operation_id: string;
  deleted: boolean;
  payload: Record<string, unknown> | null;
}
const toWire = (row: Row) =>
  ({
    entity: row.entity,
    record_id: row.record_id,
    revision: Number(row.revision),
    operation_id: row.operation_id,
    deleted: row.deleted,
    payload: row.payload,
  }) as unknown as WireRecord;

// Same privilege model as backend-sync-rls.test.ts: the owner role is subject to RLS.
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}');
  `);
  await pg.exec(read("202610110001_airfuel_sync.sql"));
  await pg.exec(read("202610110002_airfuel_sync_no_force_rls.sql"));
  await pg.exec(read("202610110003_airfuel_sync_quota.sql"));
  await pg.exec(`
    create role airfuel_owner nologin nobypassrls;
    grant usage on schema auth to airfuel_owner;
    grant references on auth.users to airfuel_owner;
    alter table public.airfuel_user_records owner to airfuel_owner;
    alter function public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb) owner to airfuel_owner;
    alter table public.airfuel_user_quota owner to airfuel_owner;
  `);
}, 60000);
afterAll(async () => {
  await pg.close();
});

// The real RPC, called as the signed-in user. `loseResponseOnce` simulates a request the server
// committed whose response never reached the device.
function pgAdapter(uid: string, loseResponseOnce = false): CloudAdapter {
  let lose = loseResponseOnce;
  return {
    async apply(record) {
      await as(uid);
      const result = await pg.query<Row>(
        "select * from public.airfuel_apply_change($1,$2,$3,$4,$5,$6::jsonb)",
        [
          record.entity,
          record.record_id,
          record.revision,
          record.operation_id,
          record.deleted,
          record.deleted ? null : JSON.stringify(record.payload),
        ],
      );
      await admin();
      if (lose) {
        lose = false;
        throw new SyncError("The response was lost after the server committed.", "transient");
      }
      return toWire(result.rows[0]);
    },
    async readAll() {
      await as(uid);
      const result = await pg.query<Row>(
        "select * from public.airfuel_user_records where user_id = $1 order by entity, record_id",
        [uid],
      );
      await admin();
      return result.rows.map(toWire);
    },
  };
}

const opened: (KitchenDB | SyncDB)[] = [];
afterEach(async () => {
  for (const database of opened.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});
function device(uid: string, adapter?: CloudAdapter) {
  const local = new KitchenDB(`rt-sync-local-${crypto.randomUUID()}`);
  const metadata = new SyncDB(`rt-sync-meta-${crypto.randomUUID()}`);
  opened.push(local, metadata);
  return {
    local,
    metadata,
    actions: createActions(local),
    engine: new SyncEngine(local, metadata, adapter ?? pgAdapter(uid)),
  };
}
async function cloudRow(entity: string, recordId: string) {
  await admin();
  const result = await pg.query<Row>(
    "select * from public.airfuel_user_records where entity = $1 and record_id = $2",
    [entity, recordId],
  );
  return result.rows[0];
}
async function cloudCount(entity: string) {
  await admin();
  const result = await pg.query<{ n: number }>(
    "select count(*)::int as n from public.airfuel_user_records where entity = $1",
    [entity],
  );
  return result.rows[0].n;
}
const session = (recipeId: string) => ({
  recipeId,
  date: "2026-10-11",
  servingsPrepared: 2,
  servingsConsumed: 1,
  rating: null,
  actualMinutes: null,
  ingredientChanges: "",
  temperatureC: null,
  timeChanges: "",
  notes: "cooked it",
  wouldCookAgain: null,
});

describe("RT-B sync: stale devices", () => {
  it("a device that deleted a record online never resurrects it when a stale device edits it", async () => {
    const a = device(ALICE);
    const b = device(ALICE);
    await a.actions.patchRecipeState("rt-r", { notes: "v1" });
    await a.engine.run();
    await b.engine.run();
    await a.actions.patchRecipeState("rt-r", { notes: "v2" });
    await a.engine.run();
    await a.actions.deleteRecipeState("rt-r");
    await a.engine.run();
    // Device B has not pulled since v1. Its edit is based on a stale revision.
    await b.actions.patchRecipeState("rt-r", { notes: "stale edit" });
    await b.engine.run();
    expect((await cloudRow("recipeStates", "rt-r")).deleted).toBe(true);
    const conflicts = await b.metadata.conflicts.toArray();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].remote).toBeNull();
    // A later pass on either device keeps the tombstone and never re-sends the stale value.
    await b.engine.run();
    await a.engine.run();
    expect((await cloudRow("recipeStates", "rt-r")).deleted).toBe(true);
    expect((await a.local.recipeStates.get("rt-r"))).toBeUndefined();
  }, 60000);

  it("two devices editing the same record at the same revision converge on one winner", async () => {
    const a = device(ALICE);
    const b = device(ALICE);
    await a.actions.patchRecipeState("rt-same", { notes: "base" });
    await a.engine.run();
    await b.engine.run();
    await a.actions.patchRecipeState("rt-same", { notes: "from A" });
    await b.actions.patchRecipeState("rt-same", { notes: "from B" });
    await a.engine.run();
    await b.engine.run();
    await a.engine.run();
    const cloud = await cloudRow("recipeStates", "rt-same");
    const aNotes = (await a.local.recipeStates.get("rt-same"))?.notes;
    const bNotes = (await b.local.recipeStates.get("rt-same"))?.notes;
    expect(aNotes).toBe(cloud.payload?.notes);
    expect(bNotes).toBe(cloud.payload?.notes);
    // The losing value is kept as exactly one conflict copy on whichever device lost, not discarded.
    expect((await a.metadata.conflicts.count()) + (await b.metadata.conflicts.count())).toBe(1);
  }, 60000);
});

describe("RT-B sync: redelivery", () => {
  it("a cooking session whose response was lost is delivered once, not duplicated", async () => {
    const flaky = device(ALICE, pgAdapter(ALICE, true));
    await flaky.actions.saveSession(session("rt-r"));
    await expect(flaky.engine.run()).rejects.toMatchObject({ kind: "transient" });
    await flaky.engine.run();
    expect(await flaky.local.sessions.count()).toBe(1);
    expect(await cloudCount("sessions")).toBe(1);
  }, 60000);
});

describe("RT-B sync: quota and read cap", () => {
  it(
    "RT-B6 an account at its 224,006-row quota can still read everything it is allowed to hold",
    async () => {
      // The quota lets an account hold 224,006 rows, but readAll stops at 400 pages of 500 (200,000).
      // Past that point the account can write but never pull again.
      const userId = ALICE;
      const total = 224006;
      const rows = Array.from({ length: total }, (_, index) => ({
        user_id: userId,
        entity: "sessions",
        record_id: `s-${String(index).padStart(7, "0")}`,
        revision: 1,
        operation_id: "00000000-0000-4000-8000-000000000001",
        deleted: true,
        payload: null,
      }));
      const client = {
        from() {
          const chain = {
            select: () => chain,
            eq: () => chain,
            order: () => chain,
            range: (from: number, to: number) =>
              Promise.resolve({ data: rows.slice(from, to + 1), error: null, count: total }),
          };
          return chain;
        },
      } as unknown as SupabaseClient;
      const adapter = createSupabaseAdapter(client, userId);
      await expect(adapter.readAll()).resolves.toHaveLength(total);
    },
    120000,
  );
});

describe("sync migrations", () => {
  it("re-running the sync migration on a populated database is refused and leaves the rows alone", async () => {
    const scratch = new PGlite();
    try {
      await scratch.exec(`
        create role anon nologin; create role authenticated nologin;
        create schema auth; create table auth.users (id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      `);
      await scratch.exec(read("202610110001_airfuel_sync.sql"));
      await scratch.exec(
        `insert into auth.users values ('${ALICE}');
         insert into public.airfuel_user_records (user_id, entity, record_id, revision, operation_id, deleted, payload)
         values ('${ALICE}', 'recipeStates', 'kept', 1, '00000000-0000-4000-8000-000000000001', false, '{"id":"kept"}');`,
      );
      await expect(scratch.exec(read("202610110001_airfuel_sync.sql"))).rejects.toThrow();
      await scratch.exec("rollback");
      const count = await scratch.query<{ n: number }>(
        "select count(*)::int as n from public.airfuel_user_records",
      );
      expect(count.rows[0].n).toBe(1);
    } finally {
      await scratch.close();
    }
  }, 60000);

  it("maps every server error class to the retry policy the controller relies on", () => {
    expect(postgrestErrorKind({ code: "42501" })).toBe("config");
    expect(postgrestErrorKind({ message: "Authentication required" })).toBe("auth");
    expect(postgrestErrorKind({ code: "PGRST301" })).toBe("auth");
    expect(postgrestErrorKind({ code: "53400" })).toBe("permanent");
    expect(postgrestErrorKind({ code: "23505" })).toBe("permanent");
    expect(postgrestErrorKind({ code: "08006" })).toBe("transient");
  });
});

describe("sync reset semantics (pinned)", () => {
  it("the plain cache reset refuses while a conflict copy exists; delete-all removes it", async () => {
    const a = device(ALICE);
    const b = device(ALICE);
    await a.actions.patchRecipeState("rt-pin", { notes: "base" });
    await a.engine.run();
    await b.engine.run();
    await a.actions.patchRecipeState("rt-pin", { notes: "A" });
    await a.engine.run();
    await b.actions.patchRecipeState("rt-pin", { notes: "B" });
    await b.engine.run();
    await a.engine.run();
    // Which device holds the conflict depends on the UUID tie-break, so the test follows it.
    const loser = (await a.metadata.conflicts.count()) > 0 ? a : b;
    expect(await loser.metadata.conflicts.count()).toBe(1);
    await expect(forgetSyncBaselines(loser.metadata)).rejects.toThrow(/Resolve the sync conflicts/);
    await deleteAllSyncState(loser.metadata);
    expect(await loser.metadata.conflicts.count()).toBe(0);
    expect(await loser.metadata.records.count()).toBe(0);
  }, 60000);
});

describe("RT-B sync: the export offered before delete-all", () => {
  it.fails(
    "RT-B8 the backup offered before delete-all keeps the losing value of an unresolved conflict",
    async () => {
      // DECISION (lead): the backup format stays unchanged (changing it is reserved for P0/P1 fixes), so this
      // remains an expected failure. Instead, Settings' delete-all dialog now counts unresolved conflicts and
      // warns that their other versions are deleted and not in a backup (src/pages/Settings.tsx).
      // Settings offers "Export backup first" before delete-all, which removes conflict copies. The export
      // reads only the nine data tables, so the displaced local value is in neither the export nor the app.
      const a = device(ALICE);
      const b = device(ALICE);
      await a.actions.patchRecipeState("rt-export", { notes: "base" });
      await a.engine.run();
      await b.engine.run();
      await a.actions.patchRecipeState("rt-export", { notes: "marker-from-device-A" });
      await a.engine.run();
      await b.actions.patchRecipeState("rt-export", { notes: "marker-from-device-B" });
      await b.engine.run();
      await a.engine.run();
      const loser = (await a.metadata.conflicts.count()) > 0 ? a : b;
      const [conflict] = await loser.metadata.conflicts.toArray();
      const exported = await exportBackup(loser.local);
      expect(exported).toContain(String((conflict.local as { notes: string }).notes));
    },
    60000,
  );
});
