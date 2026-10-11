// Database boundary tests against the REAL sync migration, run in PGlite (Postgres compiled to WASM).
// Scope: PostgreSQL grants, RLS, the security-definer RPC, constraints and revision ordering.
// NOT covered: PostgREST, GoTrue (JWT verification, refresh, sign-out), Supabase API row limits and
// Supabase's own role setup. Live qualification against a disposable Supabase project is still required.
// This file lives in tests/unit because vite.config.ts only includes tests/unit/**.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202610110001_airfuel_sync.sql",
    import.meta.url,
  ),
  "utf8",
);
const noForce = readFileSync(
  new URL(
    "../../supabase/migrations/202610110002_airfuel_sync_no_force_rls.sql",
    import.meta.url,
  ),
  "utf8",
);
const quota = readFileSync(
  new URL(
    "../../supabase/migrations/202610110003_airfuel_sync_quota.sql",
    import.meta.url,
  ),
  "utf8",
);
const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const OP_LOW = "00000000-0000-4000-8000-000000000001";
const OP_MID = "00000000-0000-4000-8000-000000000002";
const OP_HIGH = "ffffffff-ffff-4fff-8fff-fffffffffffe";

interface Row {
  user_id: string;
  entity: string;
  record_id: string;
  revision: number;
  operation_id: string;
  deleted: boolean;
  payload: { id: string; notes?: string } | null;
}

let db: PGlite;

// Simulates PostgREST/GoTrue: switch role and set the JWT subject claim that auth.uid() reads.
async function as(
  uid: string | null,
  role: "authenticated" | "anon" = "authenticated",
) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    uid ?? "",
  ]);
  await db.exec(`set role ${role}`);
}
async function admin() {
  await db.exec("reset role");
}
function apply(
  entity: string,
  recordId: string,
  revision: number,
  operationId: string,
  payload: { id: string; notes?: string } | null = { id: recordId, notes: "x" },
  deleted = payload === null,
) {
  return db.query<Row>(
    "select * from public.airfuel_apply_change($1,$2,$3,$4,$5,$6::jsonb)",
    [
      entity,
      recordId,
      revision,
      operationId,
      deleted,
      payload === null ? null : JSON.stringify(payload),
    ],
  );
}
async function stored(userId: string, entity: string, recordId: string) {
  await admin();
  const result = await db.query<Row>(
    "select * from public.airfuel_user_records where user_id = $1 and entity = $2 and record_id = $3",
    [userId, entity, recordId],
  );
  return result.rows[0];
}
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  db = new PGlite();
  // Minimal Supabase stand-ins: the roles, an auth.users table and auth.uid() reading the JWT subject.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}');
  `);
  await db.exec(migration);
  await db.exec(noForce);
  await db.exec(quota);
  await db.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/202610110004_airfuel_sync_byte_quota.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  // Production owner setup for this suite: the table and function belong to a role WITHOUT BYPASSRLS.
  // Every test below therefore runs with the owner subject to RLS, which the no-FORCE migration must allow.
  await db.exec(`
    create role airfuel_owner nologin nobypassrls;
    -- The RPC calls auth.uid() and the table references auth.users, so the owner needs these privileges.
    grant usage on schema auth to airfuel_owner;
    grant references on auth.users to airfuel_owner;
    alter table public.airfuel_user_records owner to airfuel_owner;
    alter function public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb) owner to airfuel_owner;
    -- The quota counter must share the function's owner: the RPC reads and writes it under RLS.
    alter table public.airfuel_user_quota owner to airfuel_owner;
  `);
  // Seed both users' rows through the only legitimate write path.
  await as(ALICE);
  await apply("preferences", "preferences", 1, OP_MID, {
    id: "preferences",
    notes: "alice-prefs",
  });
  await apply("recipeStates", "chicken", 1, OP_MID, {
    id: "chicken",
    notes: "alice-note",
  });
  await as(BOB);
  await apply("recipeStates", "chicken", 1, OP_MID, {
    id: "chicken",
    notes: "bob-note",
  });
  await apply("sessions", "bob-session", 1, OP_LOW, {
    id: "bob-session",
    notes: "bob-only",
  });
  await admin();
  // WASM startup plus the migration can exceed the 10s default hook timeout when the suite runs in parallel.
}, 60_000);

afterAll(async () => {
  await db?.close();
}, 60_000);

describe("sync migration: anonymous and direct-table access", () => {
  it("denies anonymous role every table operation and the RPC", async () => {
    await as(null, "anon");
    await expectCode(
      db.query("select * from public.airfuel_user_records"),
      "42501",
    );
    await expectCode(
      db.query(
        "insert into public.airfuel_user_records (user_id,entity,record_id,revision,operation_id,deleted,payload) values ($1,'sessions','x',1,$2,false,'{\"id\":\"x\"}')",
        [ALICE, OP_LOW],
      ),
      "42501",
    );
    await expectCode(apply("recipeStates", "anon-try", 1, OP_LOW), "42501");
    await admin();
  });

  it("denies authenticated direct INSERT, UPDATE and DELETE on the table", async () => {
    await as(ALICE);
    await expectCode(
      db.query(
        "insert into public.airfuel_user_records (user_id,entity,record_id,revision,operation_id,deleted,payload) values ($1,'sessions','direct',1,$2,false,'{\"id\":\"direct\"}')",
        [ALICE, OP_LOW],
      ),
      "42501",
    );
    await expectCode(
      db.query(
        'update public.airfuel_user_records set payload = \'{"id":"chicken","notes":"hacked"}\' where user_id = $1',
        [ALICE],
      ),
      "42501",
    );
    await expectCode(
      db.query("delete from public.airfuel_user_records where user_id = $1", [
        ALICE,
      ]),
      "42501",
    );
    await admin();
    expect(
      (await stored(ALICE, "recipeStates", "chicken"))?.payload?.notes,
    ).toBe("alice-note");
  });

  it("refuses an authenticated call to the RPC without a JWT subject", async () => {
    await as(null, "authenticated");
    await expectCode(apply("recipeStates", "no-subject", 1, OP_LOW), "42501");
    await admin();
  });
});

describe("sync migration: cross-user isolation", () => {
  it("returns only the caller's rows, including for guessed IDs and explicit owner filters", async () => {
    await as(ALICE);
    const all = await db.query<Row>(
      "select * from public.airfuel_user_records",
    );
    expect(all.rows.every((row) => row.user_id === ALICE)).toBe(true);
    const byOwner = await db.query<Row>(
      "select * from public.airfuel_user_records where user_id = $1",
      [BOB],
    );
    expect(byOwner.rows).toHaveLength(0);
    const guessed = await db.query<Row>(
      "select * from public.airfuel_user_records where record_id = 'bob-session'",
    );
    expect(guessed.rows).toHaveLength(0);
    await admin();
  });

  it("cannot alter another user's row through any statement", async () => {
    await as(ALICE);
    // Without an UPDATE/DELETE grant the statement is refused outright, not merely filtered.
    await expectCode(
      db.query(
        'update public.airfuel_user_records set payload = \'{"id":"bob-session","notes":"pwned"}\' where user_id = $1',
        [BOB],
      ),
      "42501",
    );
    await expectCode(
      db.query("delete from public.airfuel_user_records where user_id = $1", [
        BOB,
      ]),
      "42501",
    );
    await admin();
    expect((await stored(BOB, "sessions", "bob-session"))?.payload?.notes).toBe(
      "bob-only",
    );
  });

  it("ignores a client-chosen owner: the RPC has no owner argument and writes under auth.uid()", async () => {
    await as(ALICE);
    const result = await apply("sessions", "alice-owned", 1, OP_LOW, {
      id: "alice-owned",
      notes: "x",
      user_id: BOB,
    } as { id: string; notes: string });
    expect(result.rows[0].user_id).toBe(ALICE);
    await expectCode(
      db.query(
        "select * from public.airfuel_apply_change($1,$2,$3,$4,$5,$6::jsonb,$7)",
        ["sessions", "forged", 1, OP_LOW, false, '{"id":"forged"}', BOB],
      ),
      "42883",
    );
    await admin();
    expect(await stored(ALICE, "sessions", "alice-owned")).toBeDefined();
    expect(await stored(BOB, "sessions", "alice-owned")).toBeUndefined();
  });

  it("does not let Bob's write land on Alice's record with the same entity and ID", async () => {
    await as(BOB);
    const result = await apply("recipeStates", "chicken", 9, OP_HIGH, {
      id: "chicken",
      notes: "bob-overwrite",
    });
    expect(result.rows[0].user_id).toBe(BOB);
    await admin();
    expect(
      (await stored(ALICE, "recipeStates", "chicken"))?.payload?.notes,
    ).toBe("alice-note");
  });
});

describe("sync migration: revision ordering", () => {
  it("rejects stale writes and reports the winning row to the client", async () => {
    await as(ALICE);
    await apply("pantry", "flour", 1, OP_LOW, { id: "flour", notes: "one" });
    await apply("pantry", "flour", 2, OP_MID, { id: "flour", notes: "two" });
    const stale = await apply("pantry", "flour", 1, OP_HIGH, {
      id: "flour",
      notes: "stale-but-higher-uuid",
    });
    expect(stale.rows[0].revision).toBe(2);
    expect(stale.rows[0].payload?.notes).toBe("two");
    await admin();
  });

  it("breaks equal-revision ties by operation UUID regardless of arrival order", async () => {
    for (const [first, second] of [
      [OP_LOW, OP_HIGH],
      [OP_HIGH, OP_LOW],
    ]) {
      await as(ALICE);
      const record = `tie-${first.slice(0, 4)}-${second.slice(0, 4)}`;
      // The note records which operation wrote it, so the expectation follows the UUID, not arrival order.
      await apply("plans", record, 5, first, { id: record, notes: first });
      const result = await apply("plans", record, 5, second, {
        id: record,
        notes: second,
      });
      expect(result.rows[0].operation_id).toBe(OP_HIGH);
      expect(result.rows[0].payload?.notes).toBe(OP_HIGH);
    }
    await admin();
  });

  it("never resurrects a tombstone with a stale revision", async () => {
    await as(ALICE);
    await apply("sessions", "deleted-session", 2, OP_MID, null);
    await apply("sessions", "deleted-session", 1, OP_HIGH, {
      id: "deleted-session",
      notes: "old",
    });
    const row = await apply("sessions", "deleted-session", 1, OP_HIGH, {
      id: "deleted-session",
      notes: "old",
    });
    expect(row.rows[0].deleted).toBe(true);
    expect(row.rows[0].payload).toBeNull();
    await admin();
  });

  it("documents that an equal-revision edit with a higher UUID does resurrect a concurrent delete", async () => {
    // Decision, not a guarantee of intent: a concurrent edit at the same revision is not stale, so the
    // UUID tie-break decides. Tracked as LOGIC-10 family in docs/backend/findings/sync.md.
    await as(ALICE);
    await apply("sessions", "concurrent", 3, OP_LOW, null, true);
    const edit = await apply("sessions", "concurrent", 3, OP_HIGH, {
      id: "concurrent",
      notes: "edit",
    });
    expect(edit.rows[0].deleted).toBe(false);
    await admin();
  });
});

describe("sync migration: table constraints", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["unknown entity", () => apply("notAnEntity", "x", 1, OP_LOW)],
    [
      "record id longer than 300 characters",
      () =>
        apply("sessions", "r".repeat(301), 1, OP_LOW, { id: "r".repeat(301) }),
    ],
    ["empty record id", () => apply("sessions", "", 1, OP_LOW, { id: "" })],
    [
      "revision zero",
      () => apply("sessions", "rev0", 0, OP_LOW, { id: "rev0" }),
    ],
    [
      "revision above the safe integer range",
      () =>
        apply("sessions", "revbig", Number.MAX_SAFE_INTEGER + 1, OP_LOW, {
          id: "revbig",
        }),
    ],
    [
      "payload id differs from record id",
      () => apply("sessions", "id-a", 1, OP_LOW, { id: "id-b" }),
    ],
    [
      "payload without an id",
      () =>
        apply("sessions", "noid", 1, OP_LOW, { notes: "x" } as unknown as {
          id: string;
        }),
    ],
    [
      "tombstone that still carries a payload",
      () =>
        db.query(
          "select * from public.airfuel_apply_change('sessions','tomb',1,$1,true,'{\"id\":\"tomb\"}'::jsonb)",
          [OP_LOW],
        ),
    ],
    [
      "live row with a null payload",
      () =>
        db.query(
          "select * from public.airfuel_apply_change('sessions','nullp',1,$1,false,null)",
          [OP_LOW],
        ),
    ],
    [
      "payload above 512 KiB",
      () =>
        apply("customRecipes", "huge", 1, OP_LOW, {
          id: "huge",
          notes: "x".repeat(530_000),
        }),
    ],
    [
      "payload that is a JSON array",
      () =>
        db.query(
          "select * from public.airfuel_apply_change('sessions','arr',1,$1,false,'[1,2]'::jsonb)",
          [OP_LOW],
        ),
    ],
  ];
  for (const [name, attempt] of cases)
    it(`rejects ${name}`, async () => {
      await as(ALICE);
      await expectCode(attempt(), "23514");
      await admin();
    });

  it("accepts a legitimate tombstone with no payload", async () => {
    await as(ALICE);
    const result = await apply("sessions", "boundary", 1, OP_LOW, null, true);
    expect(result.rows[0].deleted).toBe(true);
    await admin();
  });
});

describe("sync migration: security-definer hardening", () => {
  it("keeps the RPC SECURITY DEFINER with an empty fixed search_path and no public or anon execute", async () => {
    await admin();
    const fn = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      "select prosecdef, proconfig from pg_proc where proname = 'airfuel_apply_change'",
    );
    expect(fn.rows[0].prosecdef).toBe(true);
    expect(fn.rows[0].proconfig).toContain('search_path=""');
    const acl = await db.query<{ privilege: string }>(
      "select has_function_privilege('anon', 'public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb)', 'EXECUTE') as privilege",
    );
    expect(acl.rows[0].privilege).toBe(false);
  });

  it("is not redirected by a caller-controlled search_path that shadows auth.uid and the table", async () => {
    await admin();
    await db.exec(`
      create schema evil;
      create table evil.airfuel_user_records (like public.airfuel_user_records);
      create function evil.uid() returns uuid language sql as $$ select '${BOB}'::uuid $$;
    `);
    await as(ALICE);
    await db.exec("set search_path = evil, public");
    const result = await apply("sessions", "hijack-probe", 1, OP_LOW, {
      id: "hijack-probe",
    });
    await db.exec("reset search_path");
    expect(result.rows[0].user_id).toBe(ALICE);
    await admin();
    const shadow = await db.query<{ count: string }>(
      "select count(*)::text as count from evil.airfuel_user_records",
    );
    expect(shadow.rows[0].count).toBe("0");
    expect(await stored(ALICE, "sessions", "hijack-probe")).toBeDefined();
  });

  it("writes through the RPC as an owner without BYPASSRLS once FORCE is removed, and FORCE alone breaks it", async () => {
    await admin();
    const force = await db.query<{ relforcerowsecurity: boolean }>(
      "select relforcerowsecurity from pg_class where oid = 'public.airfuel_user_records'::regclass",
    );
    expect(force.rows[0].relforcerowsecurity).toBe(false);
    // Demonstrates the defect the migration removes: with FORCE, the owner's insert is refused.
    await db.exec(
      "alter table public.airfuel_user_records force row level security",
    );
    await as(ALICE);
    await expectCode(
      apply("sessions", "force-probe", 1, OP_LOW, { id: "force-probe" }),
      "42501",
    );
    await admin();
    await db.exec(noForce);
    await as(ALICE);
    const ok = await apply("sessions", "force-probe", 1, OP_LOW, {
      id: "force-probe",
    });
    expect(ok.rows[0].user_id).toBe(ALICE);
    await admin();
  });
});

describe("sync no-FORCE migration (202610110002)", () => {
  it("is idempotent: applying it again leaves the RPC working for a second user", async () => {
    await admin();
    await db.exec(noForce);
    await as(BOB);
    const result = await apply("sessions", "bob-idempotent", 1, OP_LOW, {
      id: "bob-idempotent",
    });
    expect(result.rows[0].user_id).toBe(BOB);
    await admin();
  });
});

describe("sync per-account quota (SEC-9, 202610110003)", () => {
  const CAP = 224006;
  it("refuses a NEW record at the cap with SQLSTATE 53400, while updates and other accounts still work", async () => {
    await admin();
    await db.exec(
      `update public.airfuel_user_quota set record_count = ${CAP - 1} where user_id = '${ALICE}'`,
    );
    await as(ALICE);
    const last = await apply("sessions", "quota-last", 1, OP_LOW, {
      id: "quota-last",
    });
    expect(last.rows[0].user_id).toBe(ALICE);
    await expectCode(
      apply("sessions", "quota-over", 1, OP_LOW, { id: "quota-over" }),
      "53400",
    );
    // An update to a record the account already holds is not a new record, so it is allowed at the cap.
    const update = await apply("sessions", "quota-last", 2, OP_MID, {
      id: "quota-last",
      notes: "edited at cap",
    });
    expect(update.rows[0].revision).toBe(2);
    await as(BOB);
    const bob = await apply("sessions", "bob-under-cap", 1, OP_LOW, {
      id: "bob-under-cap",
    });
    expect(bob.rows[0].user_id).toBe(BOB);
    await admin();
  });

  it("counts tombstones as records and keeps the counter in step with inserts", async () => {
    await admin();
    await db.exec(
      `update public.airfuel_user_quota set record_count = ${CAP - 1} where user_id = '${ALICE}'`,
    );
    await as(ALICE);
    await apply("sessions", "quota-tomb", 1, OP_LOW, null);
    await admin();
    const counter = await db.query<{ record_count: number }>(
      `select record_count from public.airfuel_user_quota where user_id = '${ALICE}'`,
    );
    expect(counter.rows[0].record_count).toBe(CAP);
  });

  it("keeps the counter table private to clients and the grants on the RPC unchanged", async () => {
    await as(ALICE);
    await expectCode(
      db.query("select * from public.airfuel_user_quota"),
      "42501",
    );
    await expectCode(
      db.query("update public.airfuel_user_quota set record_count = 0"),
      "42501",
    );
    await as(null, "anon");
    await expectCode(
      apply("sessions", "anon-quota", 1, OP_LOW, { id: "anon-quota" }),
      "42501",
    );
    await admin();
    const acl = await db.query<{ anon: boolean; auth: boolean }>(
      "select has_function_privilege('anon', 'public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb)', 'EXECUTE') as anon, has_function_privilege('authenticated', 'public.airfuel_apply_change(text,text,bigint,uuid,boolean,jsonb)', 'EXECUTE') as auth",
    );
    expect(acl.rows[0]).toEqual({ anon: false, auth: true });
  });
});
