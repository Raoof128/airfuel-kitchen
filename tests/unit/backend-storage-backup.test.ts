import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createActions,
  exportBackup,
  importBackup,
  KitchenDB,
  maxBackupBytes,
  previewImport,
  readKitchen,
  tableNames,
} from "../../src/lib/db";
import type { Backup, Recipe } from "../../src/lib/schema";

const databases: KitchenDB[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) {
    database.close();
    await Dexie.delete(database.name);
  }
});
const makeDB = () => {
  const database = new KitchenDB(`backup-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
};

const custom = (id = "custom-toast"): Recipe => ({
  id,
  slug: id,
  title: "Custom toast",
  description: "Personal toast",
  category: "breakfast",
  tags: [],
  sources: [
    { title: "Source", url: "https://example.com/t", verifiedAt: "2026-10-01" },
  ],
  prepMinutes: 1,
  cookMinutes: 4,
  totalMinutes: 5,
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
  steps: ["Toast."],
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
    method: "Label",
    confidence: "estimated",
    reference: "Label",
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
  servingsConsumed: 1,
  rating: 4,
  actualMinutes: 6,
  ingredientChanges: "",
  temperatureC: null,
  timeChanges: "",
  notes: "Good",
  wouldCookAgain: true,
  ...extra,
});

// Populates every table so a round trip proves each one, not a subset.
async function seed(database: KitchenDB) {
  const actions = createActions(database);
  await actions.patchRecipeState("toast", {
    tried: true,
    favourite: true,
    rating: 5,
    notes: "Thick slices",
  });
  await actions.saveSession({
    id: "s1",
    recipeId: "toast",
    date: "2026-10-01",
    servingsPrepared: 2,
    servingsConsumed: 1,
    rating: 4,
    actualMinutes: 6,
    ingredientChanges: "",
    temperatureC: null,
    timeChanges: "",
    notes: "Good",
    wouldCookAgain: true,
  });
  await actions.savePlan({
    recipeId: "toast",
    date: "2026-10-02",
    slot: "breakfast",
    servings: 2,
  });
  await actions.savePantry({
    name: "Butter",
    quantity: 100,
    unit: "g",
    form: "salted",
  });
  await actions.saveShopping({
    name: "Milk",
    quantity: 250,
    unit: "ml",
    form: "fresh",
    aisle: "Dairy",
    checked: false,
    manual: true,
  });
  await actions.saveCustomRecipe(custom());
  await actions.saveOverride(
    "toast",
    { steps: ["Toast gently."] },
    custom("toast"),
  );
  await actions.savePreferences({ name: "Tester", defaultServings: 3 });
  await actions.startCooking("toast", 2, null);
}

describe("backup format and coverage", () => {
  it("names every user table in the backup, matching the live Dexie tables exactly", async () => {
    const database = makeDB();
    expect(database.tables.map((table) => table.name).sort()).toEqual(
      [...tableNames].sort(),
    );
    const backup = JSON.parse(await exportBackup(database)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(backup).sort()).toEqual(
      ["format", "version", "exportedAt", ...tableNames].sort(),
    );
  });

  it("writes format, schema version and export timestamp, and round-trips every table", async () => {
    const source = makeDB();
    await seed(source);
    const text = await exportBackup(source);
    const backup = JSON.parse(text) as Backup;
    expect(backup.format).toBe("airfuel-kitchen");
    expect(backup.version).toBe(2);
    expect(Number.isInteger(backup.exportedAt)).toBe(true);
    for (const name of tableNames)
      expect(backup[name].length, name).toBeGreaterThan(0);

    const target = makeDB();
    const preview = await previewImport(text, target);
    const rows = tableNames.reduce((sum, name) => sum + backup[name].length, 0);
    expect(preview.added).toBe(rows);
    await importBackup(preview, "replace", target);
    expect(await readKitchen(target)).toMatchObject({
      recipeStates: [expect.objectContaining({ id: "toast", tried: true })],
      preferences: expect.objectContaining({
        name: "Tester",
        defaultServings: 3,
      }),
      activeCooking: expect.objectContaining({ recipeId: "toast" }),
    });
    expect(JSON.parse(await exportBackup(target)).sessions).toEqual(
      backup.sessions,
    );
  });

  it("contains no credentials, tokens or cloud settings", async () => {
    const database = makeDB();
    await seed(database);
    const text = await exportBackup(database);
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object")
        for (const [key, child] of Object.entries(value)) {
          keys.add(key);
          walk(child);
        }
    };
    walk(JSON.parse(text));
    expect(
      [...keys].filter((key) =>
        /token|secret|password|credential|api[_-]?key|supabase|session_?key/i.test(
          key,
        ),
      ),
    ).toEqual([]);
    expect(text).not.toMatch(/eyJ[a-zA-Z0-9_-]{10,}\./); // a JWT-shaped string
  });

  it("refuses a backup from a schema version this build does not understand", async () => {
    const database = makeDB();
    const backup = JSON.parse(await exportBackup(database)) as Record<
      string,
      unknown
    >;
    // No version-1 backup format exists in this repository's history, so version 1 is
    // refused rather than guessed at.
    await expect(
      previewImport(JSON.stringify({ ...backup, version: 1 }), database),
    ).rejects.toThrow(/not an AirFuel Kitchen backup/);
    await expect(
      previewImport(JSON.stringify({ ...backup, version: 3 }), database),
    ).rejects.toThrow(/not an AirFuel Kitchen backup/);
  });
});

describe("restore cases", () => {
  it("restores an empty backup as a valid no-op in both modes", async () => {
    const source = makeDB();
    const target = makeDB();
    const text = await exportBackup(source);
    for (const mode of ["merge", "replace"] as const) {
      const preview = await previewImport(text, target);
      expect(preview).toMatchObject({ added: 0, duplicates: 0, conflicts: 0 });
      await importBackup(preview, mode, target);
    }
    expect(await target.sessions.count()).toBe(0);
  });

  it("rejects duplicate IDs inside one file before writing anything", async () => {
    const database = makeDB();
    const backup = JSON.parse(await exportBackup(database)) as Record<
      string,
      unknown[]
    >;
    backup.sessions = [session("same"), session("same", { notes: "other" })];
    await expect(
      previewImport(JSON.stringify(backup), database),
    ).rejects.toThrow("Duplicate ID in sessions: same");
    expect(await database.sessions.count()).toBe(0);
  });

  it("rejects corrupt JSON with a plain sentence", async () => {
    const database = makeDB();
    await expect(previewImport("{not json", database)).rejects.toThrow(
      "The backup is not valid JSON.",
    );
  });

  it("rejects unexpected fields rather than silently keeping them", async () => {
    const database = makeDB();
    const backup = JSON.parse(await exportBackup(database)) as Record<
      string,
      unknown
    >;
    backup.injected = "field";
    await expect(
      previewImport(JSON.stringify(backup), database),
    ).rejects.toThrow(/not an AirFuel Kitchen backup/);
  });

  it("rejects a row with a missing required field and names where the problem is", async () => {
    const database = makeDB();
    const backup = JSON.parse(await exportBackup(database)) as Record<
      string,
      unknown[]
    >;
    const thin: Record<string, unknown> = session("s-missing");
    delete thin.servingsPrepared;
    backup.sessions = [thin];
    await expect(
      previewImport(JSON.stringify(backup), database),
    ).rejects.toThrow(/Problem at sessions\.0\.servingsPrepared/);
  });

  it("bounds the payload: anything over 20 MB is refused before it is parsed", async () => {
    const database = makeDB();
    const huge = `{"padding":"${"a".repeat(20 * 1024 * 1024)}"}`;
    const parse = vi.spyOn(JSON, "parse");
    await expect(previewImport(huge, database)).rejects.toThrow(
      "Backup exceeds 20 MB.",
    );
    expect(parse).not.toHaveBeenCalled();
  });

  it("merges a conflicting record by timestamp: newer wins, ties keep the local copy", async () => {
    // Stamps are set in the past so the result never depends on the clock: an incoming stamp
    // that is newer but not in the future must win, and an equal stamp must not.
    const database = makeDB();
    const now = Date.now();
    const localRow = session("same", {
      notes: "local",
      rating: 3,
      updatedAt: now - 10_000,
    });
    await database.sessions.put(localRow as never);
    const backup = JSON.parse(await exportBackup(makeDB())) as Record<
      string,
      unknown[]
    >;
    backup.sessions = [
      { ...localRow, notes: "newer import", updatedAt: now - 5_000 },
    ];
    const preview = await previewImport(JSON.stringify(backup), database);
    expect(preview).toMatchObject({ duplicates: 1, conflicts: 1, added: 0 });
    await importBackup(preview, "merge", database);
    expect((await database.sessions.get("same"))?.notes).toBe("newer import");

    backup.sessions = [
      { ...localRow, notes: "tie import", updatedAt: now - 5_000 },
    ];
    const tiePreview = await previewImport(JSON.stringify(backup), database);
    await importBackup(tiePreview, "merge", database);
    expect((await database.sessions.get("same"))?.notes).toBe("newer import");
  });

  it("a future-stamped incoming row is capped to just before the import, not kept in the future", async () => {
    const database = makeDB();
    const now = Date.now();
    await database.sessions.put(
      session("same", { notes: "local", updatedAt: now - 10_000 }) as never,
    );
    const backup = JSON.parse(await exportBackup(makeDB())) as Record<
      string,
      unknown[]
    >;
    backup.sessions = [
      session("same", {
        notes: "future import",
        updatedAt: now + 60 * 60 * 1000,
      }),
    ];
    await importBackup(
      await previewImport(JSON.stringify(backup), database),
      "merge",
      database,
    );
    const stored = await database.sessions.get("same");
    expect(stored?.notes).toBe("future import");
    expect(stored!.updatedAt).toBeLessThan(Date.now());
  });

  it("a cancelled import (preview only) writes nothing", async () => {
    const source = makeDB();
    await seed(source);
    const text = await exportBackup(source);
    const target = makeDB();
    await previewImport(text, target);
    expect(await target.sessions.count()).toBe(0);
    expect(await target.recipeStates.count()).toBe(0);
  });

  it("refuses an import whose preview was made before the local data changed", async () => {
    const source = makeDB();
    await seed(source);
    const text = await exportBackup(source);
    const target = makeDB();
    const preview = await previewImport(text, target);
    await createActions(target).savePantry({
      name: "Oil",
      quantity: 10,
      unit: "ml",
      form: "olive",
    });
    await expect(importBackup(preview, "replace", target)).rejects.toThrow(
      "Your data changed after the preview",
    );
  });

  it("opening a recipe between preview and confirm is not a data change", async () => {
    // viewedAt is a device view log. Merge never applies it and the UI says viewing is not
    // a conflict, so viewing must not invalidate a preview either.
    const source = makeDB();
    await seed(source);
    const text = await exportBackup(source);
    const target = makeDB();
    const preview = await previewImport(text, target);
    await createActions(target).patchRecipeState("another-recipe", {
      viewedAt: Date.now(),
    });
    await expect(
      importBackup(preview, "merge", target),
    ).resolves.toBeUndefined();
    expect(await target.sessions.count()).toBe(1);
  });

  it("a stale or reused preview is rejected", async () => {
    const source = makeDB();
    await seed(source);
    const target = makeDB();
    const preview = await previewImport(await exportBackup(source), target);
    await importBackup(preview, "merge", target);
    await expect(importBackup(preview, "merge", target)).rejects.toThrow(
      "Please preview this backup again",
    );
  });

  it("a failure mid-replace leaves the previous state fully intact", async () => {
    const source = makeDB();
    await seed(source);
    const text = await exportBackup(source);

    const target = makeDB();
    const actions = createActions(target);
    await actions.savePantry({
      name: "Keep me",
      quantity: 1,
      unit: "each",
      form: "whole",
    });
    await actions.patchRecipeState("keep", { tried: true });
    const before = JSON.stringify(await readKitchen(target));

    const preview = await previewImport(text, target);
    // Fail on the third table write, after two tables have already been replaced in the
    // same transaction. Dexie must roll all of them back.
    const failing = vi
      .spyOn(target.table("plans"), "bulkPut")
      .mockRejectedValue(new Error("disk went away mid-restore"));
    await expect(importBackup(preview, "replace", target)).rejects.toThrow(
      "disk went away mid-restore",
    );
    expect(failing).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await readKitchen(target))).toBe(before);
  });

  it("a failure mid-merge leaves the previous state fully intact", async () => {
    const source = makeDB();
    await seed(source);
    const text = await exportBackup(source);
    const target = makeDB();
    await createActions(target).patchRecipeState("keep", { tried: true });
    const before = JSON.stringify(await readKitchen(target));
    const preview = await previewImport(text, target);
    vi.spyOn(target.table("shopping"), "bulkPut").mockRejectedValueOnce(
      new Error("write refused"),
    );
    await expect(importBackup(preview, "merge", target)).rejects.toThrow(
      "write refused",
    );
    expect(JSON.stringify(await readKitchen(target))).toBe(before);
  });
});

describe("storage failures during backup and restore", () => {
  it("a quota error during restore reads as a storage message, not a raw browser error", async () => {
    const source = makeDB();
    await seed(source);
    const text = await exportBackup(source);
    const target = makeDB();
    const preview = await previewImport(text, target);
    const quota = Object.assign(new Error("The quota has been exceeded."), {
      name: "QuotaExceededError",
    });
    vi.spyOn(target.table("sessions"), "bulkPut").mockRejectedValueOnce(quota);
    await expect(importBackup(preview, "replace", target)).rejects.toThrow(
      "This browser has no free storage left",
    );
  });

  it("a corrupt record in the live database does not block replace-restore, which is the way out of it", async () => {
    const target = makeDB();
    const source = makeDB();
    await seed(source);
    const text = await exportBackup(source);
    // Written straight to IndexedDB, bypassing validation, as a damaged v1 record would be.
    await target
      .table("recipeStates")
      .put({ id: "broken", tried: "yes" } as never);
    const preview = await previewImport(text, target);
    await importBackup(preview, "replace", target);
    expect(await target.recipeStates.get("broken")).toBeUndefined();
    expect(await target.sessions.count()).toBe(1);
  });

  it("export names a damaged record instead of dumping a raw validation error", async () => {
    const database = makeDB();
    await database
      .table("sessions")
      .put({ id: "bad", recipeId: "toast" } as never);
    const error = await exportBackup(database).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/sessions/);
    expect((error as Error).message).not.toMatch(/"code"|"path"|\[\s*\{/);
  });
});

describe("limits and key order", () => {
  it("refuses to export a backup that could not be restored under the 20 MB limit", async () => {
    const database = makeDB();
    // 2,100 saved sessions with maximum-length notes is over 20 MB once exported.
    const notes = "n".repeat(10000);
    await database
      .table("sessions")
      .bulkPut(
        Array.from({ length: 2100 }, (_, index) =>
          session(`big-${index}`, { notes, updatedAt: index + 1 }),
        ),
      );
    const error = await exportBackup(database).catch(
      (caught: unknown) => caught,
    );
    expect((error as Error).message).toMatch(/too large for one backup file/);
    expect(maxBackupBytes).toBe(20 * 1024 * 1024);
  });

  it("a v1 record that was upgraded still reads as identical to its own export", async () => {
    // The upgrade appends servingsConsumed after the old keys; the export puts keys in
    // schema order. Same data must not be reported as a conflict.
    const name = `keyorder-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      recipeStates: "id,updatedAt",
      sessions: "id,recipeId,date,updatedAt",
      plans: "id,date,recipeId,updatedAt",
      pantry: "id,updatedAt",
      shopping: "id,updatedAt",
      customRecipes: "id,updatedAt",
      overrides: "id,updatedAt",
      preferences: "id",
      activeCooking: "id",
    });
    await old.table("sessions").put({
      id: "s-order",
      updatedAt: 5,
      recipeId: "toast",
      date: "2026-10-01",
      servingsPrepared: 2,
      rating: null,
      actualMinutes: null,
      ingredientChanges: "",
      temperatureC: null,
      timeChanges: "",
      notes: "",
      wouldCookAgain: null,
    });
    old.close();
    const upgraded = new KitchenDB(name);
    databases.push(upgraded);
    await upgraded.open();
    const preview = await previewImport(await exportBackup(upgraded), upgraded);
    expect(preview).toMatchObject({ duplicates: 1, conflicts: 0, added: 0 });
  });
});
