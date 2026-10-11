import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { KitchenDB, onUpgradeBlocked, tableNames } from "../../src/lib/db";
import { defaultPreferences, type Recipe } from "../../src/lib/schema";

// Every database this file creates is named with a fresh UUID and deleted in afterEach,
// so no test ever touches the real `airfuel-kitchen` database.
const names: string[] = [];
const openHandles: Array<{ close(): void }> = [];

afterEach(async () => {
  for (const handle of openHandles.splice(0)) handle.close();
  for (const name of names.splice(0)) await Dexie.delete(name);
});

const freshName = (prefix: string) => {
  const name = `${prefix}-${crypto.randomUUID()}`;
  names.push(name);
  return name;
};

// The exact v1 store definitions shipped before version 2. Copied literally on purpose:
// the test must describe what a real user's browser holds, not what the code says today.
const v1Stores = {
  recipeStates: "id,updatedAt",
  sessions: "id,recipeId,date,updatedAt",
  plans: "id,date,recipeId,updatedAt",
  pantry: "id,updatedAt",
  shopping: "id,updatedAt",
  customRecipes: "id,updatedAt",
  overrides: "id,updatedAt",
  preferences: "id",
  activeCooking: "id",
};

function openV1(name: string) {
  const old = new Dexie(name);
  old.version(1).stores(v1Stores);
  return old;
}

const recipe = (id: string): Recipe => ({
  id,
  slug: id,
  title: "Legacy toast",
  description: "Saved before version 2",
  category: "breakfast",
  tags: ["legacy"],
  sources: [
    {
      title: "Example",
      url: "https://example.com/toast",
      verifiedAt: "2026-10-01",
    },
  ],
  prepMinutes: 2,
  cookMinutes: 5,
  totalMinutes: 7,
  temperatureC: 180,
  servings: 1,
  portion: "1 slice",
  ingredients: [
    {
      name: "Bread",
      quantity: 1,
      unit: "each",
      preparation: "",
      form: "sliced",
      aisle: "Bakery",
    },
  ],
  steps: ["Toast the bread."],
  preheat: false,
  preheatMinutes: 0,
  turn: "",
  safety: [],
  internalTempC: null,
  nutrition: {
    protein: 4,
    calories: 90,
    carbs: 16,
    fat: 1,
    fibre: 2,
    method: "Label estimate",
    confidence: "estimated",
    reference: "Packet label",
  },
  allergens: ["wheat", "gluten"],
  dietary: [],
  substitutions: [],
  oilFree: true,
  storage: "",
  equipment: [],
  difficulty: "Easy",
  image: {
    src: "/images/toast.webp",
    alt: "Toast",
    credit: "Own photo",
    licence: "Own work",
  },
});

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  updatedAt: 10,
  recipeId: "toast",
  date: "2026-10-01",
  servingsPrepared: 2,
  rating: 4,
  actualMinutes: 6,
  ingredientChanges: "",
  temperatureC: null,
  timeChanges: "",
  notes: "Good",
  wouldCookAgain: true,
  ...extra,
});

// A realistic v1 population: every table has rows, including a partially-filled
// preferences record, a session with no consumption field (v1 never had one), and
// a corrupt-looking row. Dexie v1 stored whatever it was given, so corrupt rows exist.
function populateV1(old: Dexie) {
  return Promise.all([
    old.table("recipeStates").bulkPut([
      {
        id: "toast",
        tried: true,
        triedAt: 100,
        favourite: false,
        rating: 4,
        notes: "Ask for thick slices",
        viewedAt: 200,
        updatedAt: 300,
      },
    ]),
    old
      .table("sessions")
      .bulkPut([
        session("s-legacy"),
        session("s-second", { notes: "Second cook", rating: null }),
      ]),
    old.table("plans").bulkPut([
      {
        id: "p1",
        updatedAt: 5,
        recipeId: "toast",
        date: "2026-10-02",
        slot: "breakfast",
        servings: 2,
      },
    ]),
    old.table("pantry").bulkPut([
      {
        id: "pan1",
        updatedAt: 5,
        name: "Butter",
        quantity: 100,
        unit: "g",
        form: "salted",
      },
    ]),
    old.table("shopping").bulkPut([
      {
        id: "week-2026-09-28:generated:butter",
        updatedAt: 5,
        name: "Butter",
        quantity: 100,
        unit: "g",
        form: "salted",
        aisle: "Dairy",
        checked: true,
        manual: false,
      },
    ]),
    old
      .table("customRecipes")
      .bulkPut([
        { id: "custom-toast", updatedAt: 7, recipe: recipe("custom-toast") },
      ]),
    old
      .table("overrides")
      .bulkPut([{ id: "toast", updatedAt: 8, recipe: recipe("toast") }]),
    // Partial preferences from an early build: missing almost every key.
    old.table("preferences").put({ id: "preferences", name: "Legacy name" }),
    old.table("activeCooking").put({
      id: "active",
      updatedAt: 9,
      recipeId: "toast",
      servings: 2,
      checkedIngredients: [0],
      checkedSteps: [],
      timerEndsAt: null,
      timerRemainingSeconds: 0,
    }),
  ]);
}

async function readRaw(database: Dexie) {
  const result: Record<string, unknown[]> = {};
  for (const name of tableNames)
    result[name] = await database.table(name).toArray();
  return result;
}

describe("v1 -> v2 upgrade gauntlet", () => {
  it("upgrades an empty v1 database without creating any rows", async () => {
    const name = freshName("mig-empty");
    openV1(name).close();
    const upgraded = new KitchenDB(name);
    openHandles.push(upgraded);
    await upgraded.open();
    expect(upgraded.verno).toBe(2);
    const raw = await readRaw(upgraded);
    for (const name of tableNames) expect(raw[name], name).toHaveLength(0);
  });

  it("keeps every v1 record byte-for-byte except the two intended transforms", async () => {
    const name = freshName("mig-full");
    const old = openV1(name);
    await populateV1(old);
    const before = await readRaw(old);
    old.close();

    const upgraded = new KitchenDB(name);
    openHandles.push(upgraded);
    await upgraded.open();
    const after = await readRaw(upgraded);

    // Intended transform 1: sessions gain an explicit zero consumption (never inferred).
    expect(after.sessions).toEqual(
      (before.sessions as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        servingsConsumed: 0,
      })),
    );
    // Intended transform 2: preferences gain defaults for missing keys, existing values win.
    expect(after.preferences).toEqual([
      {
        ...defaultPreferences,
        ...(before.preferences as object[])[0],
      },
    ]);
    // Every other table must be untouched, byte-for-byte.
    for (const table of tableNames) {
      if (table === "sessions" || table === "preferences") continue;
      expect(JSON.stringify(after[table]), table).toBe(
        JSON.stringify(before[table]),
      );
    }
  });

  it("does not infer consumed servings from prepared servings on upgraded sessions", async () => {
    const name = freshName("mig-consumed");
    const old = openV1(name);
    await old.table("sessions").put(session("s1", { servingsPrepared: 4 }));
    old.close();
    const upgraded = new KitchenDB(name);
    openHandles.push(upgraded);
    await upgraded.open();
    expect(await upgraded.sessions.get("s1")).toMatchObject({
      servingsPrepared: 4,
      servingsConsumed: 0,
    });
  });

  it("leaves corrupt and oddly-shaped v1 rows in place rather than deleting them", async () => {
    const name = freshName("mig-corrupt");
    const old = openV1(name);
    const corrupt = session("s-corrupt", { rating: "five", notes: 42 });
    const missingFields = { id: "s-thin", updatedAt: 3, recipeId: "toast" };
    await old.table("sessions").bulkPut([corrupt, missingFields]);
    old.close();
    const upgraded = new KitchenDB(name);
    openHandles.push(upgraded);
    await upgraded.open();
    const rows = await upgraded.sessions.orderBy("id").toArray();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === "s-corrupt")).toMatchObject({
      rating: "five",
      notes: 42,
      servingsConsumed: 0,
    });
    expect(rows.find((row) => row.id === "s-thin")).toEqual({
      ...missingFields,
      servingsConsumed: 0,
    });
  });

  it("rolls back a failing upgrade: the v1 data and version are both untouched", async () => {
    const name = freshName("mig-rollback");
    const old = openV1(name);
    await populateV1(old);
    const before = await readRaw(old);
    old.close();

    // Make the v2 preferences step throw. It runs after the sessions step has already
    // modified rows in the same versionchange transaction, so a correct rollback must
    // undo that sessions change too.
    const boom = Object.defineProperty(defaultPreferences, "injectedFailure", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("injected upgrade failure");
      },
    });
    expect(boom).toBe(defaultPreferences);
    let failed: unknown;
    try {
      const doomed = new KitchenDB(name);
      openHandles.push(doomed);
      await doomed.open().catch((error: unknown) => {
        failed = error;
      });
    } finally {
      delete (defaultPreferences as Record<string, unknown>).injectedFailure;
    }
    expect(failed).toBeInstanceOf(Error);
    expect(String((failed as Error).message)).toMatch(
      /injected upgrade failure/,
    );

    const inspect = openV1(name);
    await inspect.open();
    expect(inspect.verno).toBe(1);
    const after = await readRaw(inspect);
    inspect.close();
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(
      (after.sessions as Array<Record<string, unknown>>).every(
        (row) => !("servingsConsumed" in row),
      ),
    ).toBe(true);
  });

  it("completes the same upgrade cleanly on retry after the failure is gone", async () => {
    const name = freshName("mig-retry");
    const old = openV1(name);
    await old.table("sessions").put(session("s-retry"));
    old.close();
    const upgraded = new KitchenDB(name);
    openHandles.push(upgraded);
    await upgraded.open();
    expect(await upgraded.sessions.get("s-retry")).toMatchObject({
      servingsConsumed: 0,
    });
    expect(upgraded.verno).toBe(2);
  });

  it("waits, does not corrupt data, and reports a blocked upgrade while an old connection stays open", async () => {
    const name = freshName("mig-blocked");
    const old = openV1(name);
    await old.table("sessions").put(session("s-blocked"));
    old.close();

    // A stale tab on v1 that never answers versionchange (a raw IDB connection with no
    // onversionchange handler) holds the old version open.
    const holder = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 10);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    openHandles.push({ close: () => holder.close() });

    const upgraded = new KitchenDB(name);
    openHandles.push(upgraded);
    let notified = 0;
    const unsubscribe = onUpgradeBlocked(() => {
      notified++;
    }, upgraded);
    // Wait for the blocked event itself rather than a timer: no timing assumption.
    const sawBlocked = new Promise<{
      oldVersion: number;
      newVersion: number | null;
    }>((resolve) => upgraded.once("blocked", resolve));
    let settled = false;
    const opening = upgraded.open().then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const blocked = await sawBlocked;
    expect(blocked).toMatchObject({ oldVersion: 10, newVersion: 20 });
    expect(notified).toBe(1);
    expect(settled).toBe(false);

    unsubscribe();
    holder.close();
    await opening;
    expect(settled).toBe(true);
    expect(await upgraded.sessions.get("s-blocked")).toMatchObject({
      servingsConsumed: 0,
    });
  });

  it("a page that subscribes after the block is told at once, and not again after the upgrade completes", async () => {
    const name = freshName("mig-late-subscriber");
    const old = openV1(name);
    await old.table("sessions").put(session("s-late"));
    old.close();
    const holder = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 10);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    openHandles.push({ close: () => holder.close() });

    const upgraded = new KitchenDB(name);
    openHandles.push(upgraded);
    const sawBlocked = new Promise<void>((resolve) => upgraded.once("blocked", () => resolve()));
    const opening = upgraded.open();
    await sawBlocked;
    // Subscribed only now, as React's useEffect would do after module load.
    let late = 0;
    const unsubscribe = onUpgradeBlocked(() => {
      late++;
    }, upgraded);
    expect(late).toBe(1);

    holder.close();
    await opening;
    expect(await upgraded.sessions.get("s-late")).toMatchObject({ servingsConsumed: 0 });
    let afterOpen = 0;
    const again = onUpgradeBlocked(() => {
      afterOpen++;
    }, upgraded);
    expect(afterOpen).toBe(0);
    again();
    unsubscribe();
  });
});
