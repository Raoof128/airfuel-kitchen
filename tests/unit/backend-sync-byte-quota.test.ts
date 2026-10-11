// Byte quota (migration 202610110004). Runs the real migration chain in PGlite with synthetic users.
// Caps are not reached by writing 64 MiB; instead the counter is set near the cap, which is the state a
// full account would be in. The invariant under test is that the counter always equals the real sum.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), "utf8");
const BYTE_CAP = 67108864;
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const DAN = "44444444-4444-4444-8444-444444444444";
const OP = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Pg = PGlite;
async function setup(migrations: string[]): Promise<Pg> {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}'), ('${CAROL}'), ('${DAN}');
  `);
  for (const name of migrations) await pg.exec(read(name));
  return pg;
}
function writer(pg: Pg) {
  return {
    async as(uid: string) {
      await pg.exec("reset role");
      await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [
        uid,
      ]);
      await pg.exec("set role authenticated");
    },
    async write(
      entity: string,
      recordId: string,
      revision: number,
      op: string,
      payload: { id: string; notes?: string } | null,
    ) {
      return pg.query<{ revision: number; payload: unknown }>(
        "select * from public.airfuel_apply_change($1,$2,$3,$4,$5,$6::jsonb)",
        [
          entity,
          recordId,
          revision,
          op,
          payload === null,
          payload === null ? null : JSON.stringify(payload),
        ],
      );
    },
    async done() {
      await pg.exec("reset role");
    },
  };
}
async function counters(pg: Pg, uid: string) {
  await pg.exec("reset role");
  const quota = await pg.query<{ record_count: number; payload_bytes: number }>(
    "select record_count, payload_bytes from public.airfuel_user_quota where user_id = $1",
    [uid],
  );
  const sum = await pg.query<{ bytes: number }>(
    "select coalesce(sum(coalesce(octet_length(payload::text), 0)), 0)::bigint as bytes from public.airfuel_user_records where user_id = $1",
    [uid],
  );
  return {
    counter: Number(quota.rows[0]?.payload_bytes ?? 0),
    records: Number(quota.rows[0]?.record_count ?? 0),
    actual: Number(sum.rows[0].bytes),
  };
}
async function sizeOf(pg: Pg, payload: unknown): Promise<number> {
  const result = await pg.query<{ n: number }>(
    "select octet_length($1::jsonb::text) as n",
    [JSON.stringify(payload)],
  );
  return Number(result.rows[0].n);
}

const ALL = [
  "202610110001_airfuel_sync.sql",
  "202610110002_airfuel_sync_no_force_rls.sql",
  "202610110003_airfuel_sync_quota.sql",
  "202610110004_airfuel_sync_byte_quota.sql",
];

describe("byte quota: enforcement, accounting and invariants", () => {
  let pg: Pg;
  beforeAll(async () => {
    pg = await setup(ALL);
  }, 60_000);
  afterAll(async () => {
    await pg?.close();
  }, 60_000);

  it("refuses growth past 64 MiB with SQLSTATE 53400 and a storage message, but accepts a write below it", async () => {
    const w = writer(pg);
    await w.as(ALICE);
    await pg.exec("reset role");
    // Put Alice's counter 1,000 bytes below the cap, as a full account would be.
    await pg.exec(
      `insert into public.airfuel_user_quota (user_id, record_count, payload_bytes) values ('${ALICE}', 0, ${BYTE_CAP - 1000}) on conflict (user_id) do update set payload_bytes = excluded.payload_bytes`,
    );
    await w.as(ALICE);
    const big = { id: "byte-big", notes: "x".repeat(2000) };
    const refused = await w
      .write("sessions", "byte-big", 1, OP(1), big)
      .catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "53400" });
    expect(String((refused as Error).message)).toContain(
      "Storage quota exceeded",
    );
    const small = { id: "byte-small", notes: "y".repeat(200) };
    const size = await sizeOf(pg, small);
    expect(size).toBeLessThan(1000);
    await w.write("sessions", "byte-small", 1, OP(2), small);
    await w.done();
    expect((await counters(pg, ALICE)).counter).toBe(BYTE_CAP - 1000 + size);
  });

  it("deletes and shrinking updates free bytes", async () => {
    const w = writer(pg);
    await w.as(BOB);
    const payload = { id: "bob-doc", notes: "z".repeat(5000) };
    await w.write("pantry", "bob-doc", 1, OP(3), payload);
    const shrunk = { id: "bob-doc", notes: "short" };
    await w.write("pantry", "bob-doc", 2, OP(4), shrunk);
    const afterShrink = await counters(pg, BOB);
    expect(afterShrink.counter).toBe(afterShrink.actual);
    expect(afterShrink.counter).toBe(await sizeOf(pg, shrunk));
    await w.write("pantry", "bob-doc", 3, OP(5), null);
    await w.done();
    const afterDelete = await counters(pg, BOB);
    expect(afterDelete.counter).toBe(0);
    expect(afterDelete.actual).toBe(0);
  });

  it("stale and duplicate writes change neither the row nor the counter", async () => {
    const w = writer(pg);
    await w.as(CAROL);
    await w.write("recipeStates", "carol-note", 5, OP(6), {
      id: "carol-note",
      notes: "kept",
    });
    const before = await counters(pg, CAROL);
    // Lower revision with a huge payload: a no-op, so it must not be counted.
    await w.write("recipeStates", "carol-note", 4, OP(7), {
      id: "carol-note",
      notes: "q".repeat(100000),
    });
    // Same revision, lower UUID: also a no-op.
    await w.write(
      "recipeStates",
      "carol-note",
      5,
      "00000000-0000-4000-8000-000000000000",
      { id: "carol-note", notes: "q".repeat(100000) },
    );
    // The identical write retried: a no-op.
    await w.write("recipeStates", "carol-note", 5, OP(6), {
      id: "carol-note",
      notes: "kept",
    });
    await w.done();
    const after = await counters(pg, CAROL);
    expect(after.counter).toBe(before.counter);
    expect(after.counter).toBe(after.actual);
  });

  it("keeps the counter equal to the real sum after a mixed sequence of writes", async () => {
    const w = writer(pg);
    await w.as(DAN);
    const steps: [
      string,
      string,
      number,
      string,
      { id: string; notes?: string } | null,
    ][] = [
      ["sessions", "d1", 1, OP(10), { id: "d1", notes: "a".repeat(300) }],
      ["sessions", "d2", 1, OP(11), { id: "d2", notes: "b".repeat(50) }],
      ["sessions", "d1", 2, OP(12), { id: "d1", notes: "c".repeat(900) }],
      ["sessions", "d2", 2, OP(13), null],
      ["sessions", "d3", 1, OP(14), { id: "d3", notes: "d".repeat(10) }],
      ["sessions", "d1", 1, OP(15), { id: "d1", notes: "stale".repeat(500) }],
      ["sessions", "d3", 2, OP(16), { id: "d3", notes: "e".repeat(2000) }],
      ["sessions", "d1", 3, OP(17), null],
    ];
    for (const [entity, id, rev, op, payload] of steps) {
      await w.write(entity, id, rev, op, payload);
      const check = await counters(pg, DAN);
      expect(check.counter).toBe(check.actual);
    }
    await w.done();
    const final = await counters(pg, DAN);
    expect(final.records).toBe(3);
  });
});

describe("byte quota: backfill on a populated database", () => {
  let pg: Pg;
  beforeAll(async () => {
    // Existing project: 0001 to 0003 applied, rows written, then 0004.
    pg = await setup(ALL.slice(0, 3));
    await pg.exec(`
      insert into public.airfuel_user_records (user_id, entity, record_id, revision, operation_id, deleted, payload) values
        ('${ALICE}', 'sessions', 'p1', 1, '${OP(20)}', false, '{"id":"p1","notes":"${"m".repeat(400)}"}'),
        ('${ALICE}', 'sessions', 'p2', 2, '${OP(21)}', true, null),
        ('${BOB}', 'pantry', 'q1', 1, '${OP(22)}', false, '{"id":"q1","notes":"${"n".repeat(70)}"}');
    `);
    await pg.exec(read(ALL[3]));
  }, 60_000);
  afterAll(async () => {
    await pg?.close();
  }, 60_000);

  it("backfills payload_bytes to the real sum, tombstones count as zero", async () => {
    const alice = await counters(pg, ALICE);
    const bob = await counters(pg, BOB);
    expect(alice.counter).toBe(alice.actual);
    expect(bob.counter).toBe(bob.actual);
    expect(alice.actual).toBeGreaterThan(400);
    expect(alice.records).toBe(2);
  });

  it("applies the byte cap immediately to a backfilled account", async () => {
    await pg.exec("reset role");
    await pg.exec(
      `update public.airfuel_user_quota set payload_bytes = ${BYTE_CAP - 10} where user_id = '${BOB}'`,
    );
    const w = writer(pg);
    await w.as(BOB);
    const refused = await w
      .write("pantry", "q-new", 1, OP(23), {
        id: "q-new",
        notes: "x".repeat(500),
      })
      .catch((error: unknown) => error);
    await w.done();
    expect(refused).toMatchObject({ code: "53400" });
  });
});
