// SEC-9 backfill: a database that already has sync rows (0001 applied manually) gets correct quota
// counters when 0003 is applied, and the cap applies immediately afterwards. Own PGlite instance,
// so the populated state is created exactly as an existing project would have it.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationsDir = new URL("../../supabase/migrations/", import.meta.url);
const read = (name: string) =>
  readFileSync(new URL(name, migrationsDir), "utf8");
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const OP = "00000000-0000-4000-8000-000000000007";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}'), ('${CAROL}');
  `);
  // An existing project: 0001 and 0002 are applied, 0003 is not.
  await db.exec(read("202610110001_airfuel_sync.sql"));
  await db.exec(read("202610110002_airfuel_sync_no_force_rls.sql"));
  // Populated rows written before the quota existed: Alice 3 rows incl. a tombstone, Bob 2 rows, Carol none.
  await db.exec(`
    insert into public.airfuel_user_records (user_id, entity, record_id, revision, operation_id, deleted, payload) values
      ('${ALICE}', 'sessions', 'a1', 1, '${OP}', false, '{"id":"a1"}'),
      ('${ALICE}', 'sessions', 'a2', 1, '${OP}', false, '{"id":"a2"}'),
      ('${ALICE}', 'sessions', 'a3', 2, '${OP}', true, null),
      ('${BOB}', 'pantry', 'b1', 1, '${OP}', false, '{"id":"b1"}'),
      ('${BOB}', 'pantry', 'b2', 1, '${OP}', false, '{"id":"b2"}');
  `);
  await db.exec(read("202610110003_airfuel_sync_quota.sql"));
}, 60_000);

afterAll(async () => {
  await db?.close();
}, 60_000);

async function counter(userId: string): Promise<number | undefined> {
  const result = await db.query<{ record_count: number }>(
    "select record_count from public.airfuel_user_quota where user_id = $1",
    [userId],
  );
  return result.rows[0]?.record_count;
}

describe("SEC-9 backfill on a populated database", () => {
  it("sets each account's counter to its real row count, including tombstones", async () => {
    expect(await counter(ALICE)).toBe(3);
    expect(await counter(BOB)).toBe(2);
    // Nothing to back-fill for an account with no rows.
    expect(await counter(CAROL)).toBeUndefined();
    const actual = await db.query<{ user_id: string; n: number }>(
      "select user_id, count(*)::int as n from public.airfuel_user_records group by user_id",
    );
    for (const row of actual.rows)
      expect(await counter(row.user_id)).toBe(row.n);
  });

  it("applies the cap immediately to an existing account, with updates still allowed", async () => {
    await db.exec(
      `update public.airfuel_user_quota set record_count = 224006 where user_id = '${ALICE}'`,
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      ALICE,
    ]);
    const refused = await db
      .query(
        "select * from public.airfuel_apply_change('sessions','new-after-backfill',1,$1,false,'{\"id\":\"new-after-backfill\"}'::jsonb)",
        [OP],
      )
      .catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: "53400" });
    const update = await db.query<{ revision: number }>(
      'select * from public.airfuel_apply_change(\'sessions\',\'a1\',5,$1,false,\'{"id":"a1","notes":"edit"}\'::jsonb)',
      ["00000000-0000-4000-8000-0000000000ff"],
    );
    expect(update.rows[0].revision).toBe(5);
    await db.exec("reset role");
  });

  it("a new record for an account below the cap still counts from the backfilled value", async () => {
    await db.exec(
      `update public.airfuel_user_quota set record_count = 3 where user_id = '${BOB}'`,
    );
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      BOB,
    ]);
    await db.query(
      "select * from public.airfuel_apply_change('pantry','b3',1,$1,false,'{\"id\":\"b3\"}'::jsonb)",
      [OP],
    );
    await db.exec("reset role");
    expect(await counter(BOB)).toBe(4);
  });
});
