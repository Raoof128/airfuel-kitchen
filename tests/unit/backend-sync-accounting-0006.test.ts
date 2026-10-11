// Accounting hardening (migration 202610110006), run in PGlite with the real migration chain.
// Not exercised here: true concurrent interleaving. PGlite is single-connection, so the table locks that
// serialise recompute against writes are applied but cannot be raced from a second session in this suite.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = new URL("../../supabase/migrations/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), "utf8");
const ALL = [
  "202610110001_airfuel_sync.sql",
  "202610110002_airfuel_sync_no_force_rls.sql",
  "202610110003_airfuel_sync_quota.sql",
  "202610110004_airfuel_sync_byte_quota.sql",
  "202610110005_airfuel_sync_row_bytes.sql",
  "202610110006_airfuel_sync_accounting_hardening.sql",
];
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const OP = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const zeros = (n: number) => `[${Array(n).fill("0").join(",")}]`;

async function setup(names: string[]): Promise<PGlite> {
  const pg = new PGlite();
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
  for (const name of names) await pg.exec(read(name));
  return pg;
}
async function asUser(pg: PGlite, uid: string) {
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [
    uid,
  ]);
  await pg.exec("set role authenticated");
}
async function admin(pg: PGlite) {
  await pg.exec("reset role");
}
async function counters(pg: PGlite, uid: string) {
  await admin(pg);
  const quota = await pg.query<{ record_count: string; payload_bytes: string }>(
    "select record_count::text, payload_bytes::text from public.airfuel_user_quota where user_id = $1",
    [uid],
  );
  const actual = await pg.query<{ bytes: string; n: string }>(
    "select coalesce(sum(public.airfuel_row_bytes(record_id, payload)),0)::text bytes, count(*)::text n from public.airfuel_user_records where user_id = $1",
    [uid],
  );
  return {
    counter: Number(quota.rows[0]?.payload_bytes ?? 0),
    records: Number(quota.rows[0]?.record_count ?? 0),
    actual: Number(actual.rows[0].bytes),
    rows: Number(actual.rows[0].n),
  };
}

describe("accounting hardening: dense payloads and the binary bound", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await setup(ALL);
  }, 60_000);
  afterAll(async () => {
    await pg?.close();
  }, 60_000);

  it("counts a dense array at least at its binary (pg_column_size) size, not its shorter text", async () => {
    await admin(pg);
    const payload = JSON.stringify({
      id: "dense",
      xs: JSON.parse(zeros(20000)),
    });
    const sizes = await pg.query<{
      binary: number;
      text: number;
      charged: string;
    }>(
      `select pg_column_size($1::jsonb::text::jsonb) as binary,
              octet_length($1::jsonb::text) as text,
              public.airfuel_row_bytes('dense', $1::jsonb)::text as charged`,
      [payload],
    );
    const row = sizes.rows[0];
    // The binary form is genuinely larger than the text form for this shape: the test is meaningful.
    expect(row.binary).toBeGreaterThan(row.text * 2);
    expect(Number(row.charged)).toBeGreaterThanOrEqual(
      row.binary + 2 * "dense".length + 128,
    );
  });

  it("charges an accepted dense write at least its binary size, through the RPC", async () => {
    await asUser(pg, ALICE);
    const xs = JSON.parse(zeros(20000));
    await pg.query(
      "select * from public.airfuel_apply_change('sessions','dense-write',1,$1,false,$2::jsonb)",
      [OP(1), JSON.stringify({ id: "dense-write", xs })],
    );
    await admin(pg);
    const stored = await pg.query<{ b: number }>(
      "select pg_column_size(payload::text::jsonb) as b from public.airfuel_user_records where record_id = 'dense-write'",
    );
    const c = await counters(pg, ALICE);
    expect(c.counter).toBe(c.actual);
    expect(c.counter).toBeGreaterThanOrEqual(
      stored.rows[0].b + 2 * "dense-write".length + 128,
    );
  });

  it("refuses a dense payload whose text is within 512 KiB but whose binary form is not, with the binary-bound constraint", async () => {
    await admin(pg);
    const payload = JSON.stringify({
      id: "too-dense",
      xs: JSON.parse(zeros(150000)),
    });
    const sizes = await pg.query<{ text: number; binary: number }>(
      "select octet_length($1::jsonb::text) as text, pg_column_size($1::jsonb::text::jsonb) as binary",
      [payload],
    );
    // Preconditions that make this a real test: text passes the old 512 KiB check, binary fails the new one.
    expect(sizes.rows[0].text).toBeLessThanOrEqual(524288);
    expect(sizes.rows[0].binary).toBeGreaterThan(524288);
    await asUser(pg, BOB);
    const refused = await pg
      .query(
        "select * from public.airfuel_apply_change('sessions','too-dense',1,$1,false,$2::jsonb)",
        [OP(2), payload],
      )
      .catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "23514" });
    expect(String((refused as Error).message)).toContain(
      "bounded_binary_payload",
    );
    await admin(pg);
    expect((await counters(pg, BOB)).rows).toBe(0);
  });
});

describe("accounting hardening: recompute on a populated database", () => {
  let pg: PGlite;
  beforeAll(async () => {
    // Existing project: 0001 to 0005 applied, rows written directly, quota counters left stale, then 0006.
    pg = await setup(ALL.slice(0, 5));
    await pg.exec(`
      insert into public.airfuel_user_records (user_id, entity, record_id, revision, operation_id, deleted, payload) values
        ('${ALICE}', 'sessions', 'p1', 1, '${OP(10)}', false, '{"id":"p1","xs":${zeros(3000)}}'),
        ('${ALICE}', 'sessions', 'p2', 2, '${OP(11)}', true, null),
        ('${BOB}', 'pantry', 'q1', 1, '${OP(12)}', false, '{"id":"q1","notes":"plain"}');
      insert into public.airfuel_user_quota (user_id, record_count, payload_bytes) values
        ('${ALICE}', 99, 1), ('${BOB}', 0, 0);
    `);
    await pg.exec(read(ALL[5]));
  }, 60_000);
  afterAll(async () => {
    await pg?.close();
  }, 60_000);

  it("recomputes stale counters to exactly the sum of the row charges, for every account", async () => {
    const alice = await counters(pg, ALICE);
    const bob = await counters(pg, BOB);
    expect(alice.counter).toBe(alice.actual);
    expect(alice.records).toBe(alice.rows);
    expect(alice.records).toBe(2);
    expect(bob.counter).toBe(bob.actual);
    expect(bob.records).toBe(1);
  });

  it("keeps the counter equal to the charges after writes that follow the recompute", async () => {
    await asUser(pg, ALICE);
    await pg.query(
      "select * from public.airfuel_apply_change('sessions','p1',2,$1,false,$2::jsonb)",
      [OP(13), JSON.stringify({ id: "p1", xs: JSON.parse(zeros(10)) })],
    );
    await pg.query(
      "select * from public.airfuel_apply_change('sessions','p3',1,$1,false,'{\"id\":\"p3\"}'::jsonb)",
      [OP(14)],
    );
    const c = await counters(pg, ALICE);
    expect(c.counter).toBe(c.actual);
    expect(c.records).toBe(3);
  });
});

describe("accounting hardening: re-entrancy", () => {
  it("applying 0006 again on an already-migrated database changes nothing and breaks nothing", async () => {
    const pg = await setup(ALL);
    try {
      await asUser(pg, ALICE);
      await pg.query(
        "select * from public.airfuel_apply_change('sessions','again',1,$1,false,'{\"id\":\"again\"}'::jsonb)",
        [OP(20)],
      );
      await admin(pg);
      const before = await counters(pg, ALICE);
      await pg.exec(read(ALL[5]));
      const after = await counters(pg, ALICE);
      expect(after).toEqual(before);
      await asUser(pg, ALICE);
      const write = await pg.query<{ user_id: string }>(
        "select * from public.airfuel_apply_change('sessions','after-reapply',1,$1,false,'{\"id\":\"after-reapply\"}'::jsonb)",
        [OP(21)],
      );
      expect(write.rows[0].user_id).toBe(ALICE);
    } finally {
      await pg.close();
    }
  }, 60_000);
});
