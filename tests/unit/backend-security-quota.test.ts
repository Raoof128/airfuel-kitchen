// Quota proof-of-concept tests against the real sync migrations 0001 to 0004, run in PGlite.
// Each `it` named PoC-* asserts that an attack SUCCEEDS today. When the owner fixes it, flip the
// assertion (or switch to it.fails) and record the migration that fixed it. Controls (named
// "control:") assert that a protection holds and should keep passing.
// Findings: docs/backend/findings/security.md (SEC-9 and the 0004 byte-quota review).
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationText = (name: string) =>
  readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
const migrations = [
  "202610110001_airfuel_sync.sql",
  "202610110002_airfuel_sync_no_force_rls.sql",
  "202610110003_airfuel_sync_quota.sql",
  "202610110004_airfuel_sync_byte_quota.sql",
  "202610110005_airfuel_sync_row_bytes.sql",
].map(migrationText);

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

let db: PGlite;

async function as(uid: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    uid,
  ]);
  await db.exec("set role authenticated");
}
async function admin() {
  await db.exec("reset role");
}
let operation = 0;
const opId = () =>
  `00000000-0000-4000-8000-${(++operation).toString(16).padStart(12, "0")}`;
function apply(
  recordId: string,
  payload: unknown,
  entity = "pantry",
  revision = 1,
) {
  return db.query(
    "select * from public.airfuel_apply_change($1,$2,$3,$4,$5,$6::jsonb)",
    [
      entity,
      recordId,
      revision,
      opId(),
      payload === null,
      payload === null ? null : JSON.stringify(payload),
    ],
  );
}
async function counters(uid: string) {
  await admin();
  const r = await db.query<{ record_count: string; payload_bytes: string }>(
    "select record_count, payload_bytes from public.airfuel_user_quota where user_id = $1",
    [uid],
  );
  return {
    records: Number(r.rows[0]?.record_count ?? 0),
    bytes: Number(r.rows[0]?.payload_bytes ?? 0),
  };
}

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
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}');
    create role airfuel_owner nologin nobypassrls;
    grant usage on schema auth to airfuel_owner;
    grant references on auth.users to airfuel_owner;
  `);
  for (const sql of migrations) await db.exec(sql);
  await db.exec(`
    alter table public.airfuel_user_records owner to airfuel_owner;
    alter table public.airfuel_user_quota owner to airfuel_owner;
    alter function public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb) owner to airfuel_owner;
    grant execute on function public.airfuel_row_bytes(text, jsonb) to airfuel_owner;
  `);
});
afterAll(async () => {
  await db.close();
});

describe("PoC: bytes the 64 MiB cap does not count", () => {
  // Finding: the counter sums the jsonb text of the payload. The id is counted once, inside the
  // payload (the table check forces payload.id = record_id). Not counted: the separate record_id
  // column and the primary-key index, plus per-row tuple overhead. Measured below with physical
  // relation size, so the gap is real but bounded, not "unbounded".
  it("control: physical growth from 2,000 rows with 300-character ids stays within 1.2x of the counter (fixed by 0005)", async () => {
    await as(ALICE);
    await admin();
    const sizeBefore = Number(
      (
        await db.query<{ s: string }>(
          "select pg_total_relation_size('public.airfuel_user_records')::text s",
        )
      ).rows[0].s,
    );
    await as(ALICE);
    for (let i = 0; i < 2000; i++) {
      const recordId = `${"r".repeat(290)}${String(i).padStart(10, "0")}`;
      await apply(recordId, { id: recordId }, "shopping");
    }
    await admin();
    const sizeAfter = Number(
      (
        await db.query<{ s: string }>(
          "select pg_total_relation_size('public.airfuel_user_records')::text s",
        )
      ).rows[0].s,
    );
    const c = await counters(ALICE);
    const growth = sizeAfter - sizeBefore;
    // 0005 charges each row its payload plus 2 x id plus 128 bytes. Physical growth must not exceed the count by more than 20%.
    expect(growth).toBeLessThanOrEqual(c.bytes * 1.2);
    // And the count must not be wildly above physical growth either.
    expect(c.bytes).toBeLessThanOrEqual(growth * 2);
  }, 60_000);

  it("control: a 300-character id of 4-byte characters is charged as payload plus 2 x id plus 128 bytes (fixed by 0005)", async () => {
    await as(BOB);
    const recordId = "😀".repeat(300); // 300 characters, 1,200 UTF-8 bytes
    await apply(recordId, { id: recordId });
    const c = await counters(BOB);
    // Payload text of {"id": "<1200 bytes>"} is 1,210 bytes; the column copy and index entry add 2 x 1,200 and 128 overhead.
    expect(c.bytes).toBe(
      Buffer.byteLength(`{"id": "${recordId}"}`, "utf8") + 2 * 1200 + 128,
    );
  });

  it("PoC-3: projection at the row cap: 224,006 rows of tiny payloads count about 9 MB, ids and index are extra (projected)", async () => {
    // Projection only: 224,006 x ~40-byte payloads ~ 8.6 MB counted against a 64 MiB cap.
    // The same rows carry a 300-byte id column and a primary-key index entry each, uncounted.
    const tinyPayload = Buffer.byteLength(`{"id": "x"}`, "utf8");
    expect(224_006 * tinyPayload).toBeLessThan((64 * 1024 * 1024) / 4);
    expect(224_006 * 300).toBeGreaterThan(64 * 1024 * 1024);
  });
});

describe("controls: protections that should hold", () => {
  it("control: a write that would exceed 512 KiB per record is refused by the table check", async () => {
    await as(ALICE);
    const huge = { id: "big-one", notes: "n".repeat(600 * 1024) };
    await expect(apply("big-one", huge)).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("control: direct writes to the table and the counter are refused for authenticated", async () => {
    await as(ALICE);
    await expect(
      db.query(
        "insert into public.airfuel_user_records (user_id,entity,record_id,revision,operation_id,deleted,payload) values ($1,'pantry','direct',1,$2,false,'{\"id\":\"direct\"}')",
        [ALICE, opId()],
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        "update public.airfuel_user_quota set payload_bytes = 0 where user_id = $1",
        [ALICE],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("control: the counters stay exact across update, shrink, tombstone and stale-revision no-op", async () => {
    await as(ALICE);
    const id = "exact-check";
    await apply(id, { id, notes: "a".repeat(5000) }, "pantry", 1);
    await apply(id, { id, notes: "b" }, "pantry", 2); // shrink
    await apply(id, { id, notes: "c".repeat(9000) }, "pantry", 1); // stale revision: no-op
    await apply(id, null, "pantry", 3); // tombstone
    await admin();
    const actual = await db.query<{ n: string; bytes: string }>(
      "select count(*)::text n, coalesce(sum(public.airfuel_row_bytes(record_id, payload)),0)::text bytes from public.airfuel_user_records where user_id = $1",
      [ALICE],
    );
    const c = await counters(ALICE);
    expect(c.bytes).toBe(Number(actual.rows[0].bytes));
    expect(c.records).toBe(Number(actual.rows[0].n));
  });

  it("control: a record that would pass 64 MiB is refused with 53400 and the counter is unchanged", async () => {
    // Set Bob's counter to 1 byte under the cap (the state a full account reaches), then push a record over.
    await as(BOB);
    await admin();
    await db.exec(
      `update public.airfuel_user_quota set payload_bytes = ${64 * 1024 * 1024 - 1} where user_id = '${BOB}'`,
    );
    const before = (await counters(BOB)).bytes;
    await as(BOB);
    await expect(
      apply("one-too-many", { id: "one-too-many", notes: "x".repeat(2000) }),
    ).rejects.toMatchObject({ code: "53400" });
    expect((await counters(BOB)).bytes).toBe(before);
  });
});

describe("CPU and I/O per call (control, no timeout measured)", () => {
  it("control: refused oversize writes leave both counters unchanged", async () => {
    await as(ALICE);
    const before = await counters(ALICE);
    const big = { id: "cpu", notes: "z".repeat(600 * 1024) };
    for (let i = 0; i < 3; i++)
      await expect(apply("cpu", big)).rejects.toMatchObject({ code: "23514" });
    expect(await counters(ALICE)).toEqual(before);
  });
});
