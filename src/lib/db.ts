import Dexie, { type Table } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { z } from "zod";
import { localDate } from "./engine";
import {
  activeCookingSchema,
  backupLimits,
  backupSchema,
  customRecipeSchema,
  dateSchema,
  defaultPreferences,
  overrideSchema,
  pantrySchema,
  planSchema,
  preferenceSchema,
  recipeSchema,
  recipeStateSchema,
  sessionSchema,
  shoppingSchema,
  timestampCeiling,
  type ActiveCooking,
  type Backup,
  type CookingSession,
  type CustomRecipe,
  type KitchenData,
  type PantryItem,
  type PlanEntry,
  type Preferences,
  type Recipe,
  type RecipeOverride,
  type RecipeState,
  type ShoppingItem,
} from "./schema";

export const tableNames = [
  "recipeStates",
  "sessions",
  "plans",
  "pantry",
  "shopping",
  "customRecipes",
  "overrides",
  "preferences",
  "activeCooking",
] as const;
type TableName = (typeof tableNames)[number];
const stores = {
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
// The most rows one batch action accepts; a recipe adds at most 100 ingredients.
const maxShoppingBatch = 500;
// Databases whose upgrade is currently waiting on another connection.
const upgradeBlocked = new WeakSet<KitchenDB>();
export class KitchenDB extends Dexie {
  recipeStates!: Table<RecipeState, string>;
  sessions!: Table<CookingSession, string>;
  plans!: Table<PlanEntry, string>;
  pantry!: Table<PantryItem, string>;
  shopping!: Table<ShoppingItem, string>;
  customRecipes!: Table<CustomRecipe, string>;
  overrides!: Table<RecipeOverride, string>;
  preferences!: Table<Preferences, string>;
  activeCooking!: Table<ActiveCooking, string>;
  constructor(name = "airfuel-kitchen") {
    super(name);
    // The block can fire during module load, before any page has subscribed, so the
    // state is kept on the instance and replayed to late subscribers.
    this.on("blocked", () => upgradeBlocked.add(this));
    this.on("ready", () => {
      upgradeBlocked.delete(this);
    });
    this.version(1).stores(stores);
    this.version(2)
      .stores(stores)
      .upgrade(async (transaction) => {
        // Legacy cooking logs do not prove consumption. Preserve them with zero logged intake.
        await transaction
          .table("sessions")
          .toCollection()
          .modify((row) => {
            row.servingsConsumed ??= 0;
          });
        await transaction
          .table("preferences")
          .toCollection()
          .modify((row) => {
            // Null is treated like missing: no preference column is nullable.
            for (const [key, value] of Object.entries(defaultPreferences))
              if (row[key] === undefined || row[key] === null)
                row[key] = value;
          });
      });
  }
}
export const db = new KitchenDB();
const newId = () => crypto.randomUUID();
// Clamped to the schema ceiling: a row imported at the maximum must stay editable, and
// `previous + 1` would otherwise go one past what the schema accepts.
const nextTime = (previous = 0) =>
  Math.min(timestampCeiling, Math.max(Date.now(), previous + 1));
// Refuses a write that would add a row beyond the cap a backup can hold.
async function assertRoom(
  table: { count(): PromiseLike<number> },
  name: TableName,
  previous: unknown,
) {
  if (previous !== undefined) return;
  if ((await table.count()) >= backupLimits[name])
    throw new Error(
      `This browser already holds the most ${name} records a backup can contain (${backupLimits[name]}). Delete some before adding more.`,
    );
}
const emptyRecipeState = (recipeId: string): RecipeState => ({
  id: recipeId,
  tried: false,
  triedAt: null,
  favourite: false,
  rating: null,
  notes: "",
  viewedAt: null,
  updatedAt: 0,
});
export async function readKitchen(database = db): Promise<KitchenData> {
  return database.transaction(
    "r",
    tableNames.map((name) => database.table(name)),
    async () => ({
      recipeStates: await database.recipeStates.toArray(),
      sessions: await database.sessions.toArray(),
      plans: await database.plans.toArray(),
      pantry: await database.pantry.toArray(),
      shopping: await database.shopping.toArray(),
      customRecipes: await database.customRecipes.toArray(),
      overrides: await database.overrides.toArray(),
      preferences: (await database.preferences.get("preferences")) ?? {
        ...defaultPreferences,
      },
      activeCooking: await database.activeCooking.get("active"),
    }),
  );
}
export function useKitchen() {
  return useLiveQuery(() => readKitchen(), []);
}
type Input<T extends { id: string; updatedAt: number }> = Omit<
  T,
  "id" | "updatedAt"
> & { id?: string };
// Generated shopping ticks are scoped per planning week (`week-<monday>:generated:…`).
// Once a week is more than four weeks old its ticks are no longer visible in practice,
// so they are removed. Manual items are never pruned.
export const shoppingRetentionDays = 28;
const generatedWeek = /^week-(\d{4}-\d{2}-\d{2}):/;
export async function pruneStaleGeneratedShopping(
  table: Table<ShoppingItem, string>,
  today: string,
): Promise<number> {
  const cutoff = new Date(`${today}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - shoppingRetentionDays);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const stale = await table
    .where(":id")
    .startsWith("week-")
    .filter((row) => {
      const week = generatedWeek.exec(row.id)?.[1];
      return !row.manual && week !== undefined && week < cutoffDate;
    })
    .primaryKeys();
  await table.bulkDelete(stale);
  return stale.length;
}
// Raw Zod issue JSON and DOM storage messages must never reach the toast; our own
// Error messages (conflicts, guarded cooking state) pass through unchanged.
export function describeWriteError(error: unknown): Error {
  if (error instanceof z.ZodError)
    return new Error(
      "Some details are not valid. Check the highlighted fields and try again.",
    );
  if ((error as { name?: unknown } | null)?.name === "QuotaExceededError")
    return new Error(
      "This browser has no free storage left. Export a backup, free some space and try again.",
    );
  return error instanceof Error
    ? error
    : new Error("Could not save. Please try again or export a backup.");
}
// Writes that have been requested but not yet committed. Unloading the page while one is in
// flight aborts its IndexedDB transaction, so the page should warn before it unloads.
let inFlightWrites = 0;
export function hasPendingWrites(): boolean {
  return inFlightWrites > 0;
}
function withUserErrors<T extends object>(api: T): T {
  return Object.fromEntries(
    Object.entries(api).map(([name, action]) => [
      name,
      typeof action === "function"
        ? async (...args: unknown[]) => {
            inFlightWrites++;
            try {
              return await (action as (...a: unknown[]) => Promise<unknown>)(
                ...args,
              );
            } catch (error) {
              throw describeWriteError(error);
            } finally {
              inFlightWrites--;
            }
          }
        : action,
    ]),
  ) as T;
}
export function createActions(database = db) {
  async function save<T extends { id: string; updatedAt: number }>(
    name: TableName,
    schema: z.ZodType<T>,
    input: Input<T>,
  ): Promise<string> {
    const table = database.table<T, string>(name);
    return database.transaction("rw", table, async () => {
      const id = input.id ?? newId();
      const previous = await table.get(id);
      await assertRoom(table, name, previous);
      const record = schema.parse({
        ...input,
        id,
        updatedAt: nextTime(previous?.updatedAt),
      });
      await table.put(record);
      return id;
    });
  }
  async function patchRecipeState(
    recipeId: string,
    patch: Partial<
      Pick<RecipeState, "tried" | "favourite" | "rating" | "notes" | "viewedAt">
    >,
  ) {
    const parsed = recipeStateSchema
      .pick({
        tried: true,
        favourite: true,
        rating: true,
        notes: true,
        viewedAt: true,
      })
      .partial()
      .parse(patch);
    return database.transaction("rw", database.recipeStates, async () => {
      const previous = await database.recipeStates.get(recipeId);
      await assertRoom(database.recipeStates, "recipeStates", previous);
      const now = nextTime(previous?.updatedAt);
      const current = previous ?? emptyRecipeState(recipeId);
      // Opening a recipe must not make blank memory defeat an older backup's real edits.
      // viewedAt has its own timestamp; updatedAt orders explicit user-memory edits.
      const editsMemory = Object.keys(parsed).some((key) => key !== "viewedAt");
      const record = recipeStateSchema.parse({
        ...current,
        ...parsed,
        triedAt:
          parsed.tried === undefined
            ? current.triedAt
            : parsed.tried
              ? (current.triedAt ?? now)
              : null,
        updatedAt: editsMemory ? now : current.updatedAt,
      });
      await database.recipeStates.put(record);
      return record;
    });
  }
  // The page passes the notes it last loaded or saved. A stale tab must not overwrite
  // notes that another tab saved since then.
  async function saveRecipeNotes(
    recipeId: string,
    notes: string,
    expectedNotes: string,
  ) {
    z.string().max(10000).parse(notes);
    z.string().max(10000).parse(expectedNotes);
    return database.transaction("rw", database.recipeStates, async () => {
      const stored = (await database.recipeStates.get(recipeId))?.notes ?? "";
      if (stored !== expectedNotes)
        throw new Error(
          "These notes were saved in another tab. Review them before saving again.",
        );
      return patchRecipeState(recipeId, { notes });
    });
  }
  async function toggleRecipeState(
    recipeId: string,
    field: "favourite" | "tried",
  ): Promise<RecipeState> {
    z.enum(["favourite", "tried"]).parse(field);
    return database.transaction("rw", database.recipeStates, async () => {
      const current =
        (await database.recipeStates.get(recipeId)) ??
        emptyRecipeState(recipeId);
      // Read and invert inside the transaction: rapid clicks and other tabs must
      // operate on saved state, not the React snapshot that rendered a button.
      return patchRecipeState(recipeId, { [field]: !current[field] });
    });
  }
  type CookingPatch = Partial<
    Omit<ActiveCooking, "id" | "recipeId" | "updatedAt">
  >;
  function assertActiveCooking(
    previous: ActiveCooking | undefined,
    expectedActiveRecipeId: string | null | undefined,
  ) {
    if (
      expectedActiveRecipeId !== undefined &&
      (previous?.recipeId ?? null) !== expectedActiveRecipeId
    )
      throw new Error(
        "Cooking changed in another tab. Review your active recipe and try again.",
      );
  }
  async function startCooking(
    recipeId: string,
    servings: number,
    expectedActiveRecipeId: string | null,
  ) {
    activeCookingSchema.shape.recipeId.parse(recipeId);
    activeCookingSchema.shape.servings.parse(servings);
    activeCookingSchema.shape.recipeId.nullable().parse(expectedActiveRecipeId);
    await database.transaction(
      "rw",
      database.activeCooking,
      database.recipeStates,
      async () => {
      const previous = await database.activeCooking.get("active");
      // Replacement is explicit and conditional, so a confirmation cannot
      // overwrite a different cook started in another tab while it was open.
      assertActiveCooking(previous, expectedActiveRecipeId);
      const current = previous?.recipeId === recipeId ? previous : undefined;
      // A new cook starts from the checks already ticked on the recipe page. A resumed cook
      // keeps its own checklist.
      const pageChecks = current
        ? undefined
        : (await database.recipeStates.get(recipeId))?.checks;
      await database.activeCooking.put(
        activeCookingSchema.parse({
          checkedIngredients: pageChecks?.ingredients ?? [],
          checkedSteps: pageChecks?.steps ?? [],
          timerEndsAt: null,
          timerRemainingSeconds: 0,
          ...current,
          id: "active",
          recipeId,
          servings,
          updatedAt: nextTime(previous?.updatedAt),
        }),
      );
    });
  }
  async function patchActiveCooking(
    recipeId: string,
    patch: CookingPatch,
    defaultServings = 2,
    expectedActiveRecipeId?: string | null,
  ) {
    const parsed = activeCookingSchema
      .omit({ id: true, recipeId: true, updatedAt: true })
      .partial()
      .parse(patch);
    await database.transaction("rw", database.activeCooking, async () => {
      const previous = await database.activeCooking.get("active");
      assertActiveCooking(previous, expectedActiveRecipeId);
      // Routine timer, serving and checklist edits cannot replace another cook.
      // Only startCooking accepts explicit authority to make that replacement.
      if (previous && previous.recipeId !== recipeId)
        throw new Error(
          "Another recipe is already cooking. Finish or stop it before changing this one.",
        );
      const current =
        previous?.recipeId === recipeId
          ? previous
          : {
              recipeId,
              servings: defaultServings,
              checkedIngredients: [],
              checkedSteps: [],
              timerEndsAt: null,
              timerRemainingSeconds: 0,
            };
      await database.activeCooking.put(
        activeCookingSchema.parse({
          ...current,
          ...parsed,
          id: "active",
          updatedAt: nextTime(previous?.updatedAt),
        }),
      );
    });
  }
  // Writes one shopping row. The caller owns the transaction and the pruning.
  async function writeShopping(input: Input<ShoppingItem>) {
    const previous = input.id ? await database.shopping.get(input.id) : undefined;
    const changed =
      previous &&
      input.manual &&
      ["name", "quantity", "unit", "form"].some(
        (key) =>
          previous[key as keyof ShoppingItem] !==
          input[key as keyof typeof input],
      );
    return save("shopping", shoppingSchema, {
      ...input,
      checked: changed ? false : input.checked,
    });
  }
  const api = {
    patchRecipeState,
    saveRecipeNotes,
    toggleRecipeState,
    deleteRecipeState: (recipeId: string) =>
      database.recipeStates.delete(recipeId),
    // Ticks made on the recipe page while not cooking. Writes only recipeStates, so the
    // active cook is never created, changed or blocked by a recipe-page tick.
    async setRecipeCheck(
      recipeId: string,
      kind: "ingredient" | "step",
      index: number,
      checked: boolean,
      length?: number,
    ) {
      z.string().min(1).max(300).parse(recipeId);
      z.enum(["ingredient", "step"]).parse(kind);
      z.number().int().min(0).max(99).parse(index);
      z.boolean().parse(checked);
      if (length !== undefined) {
        z.number().int().min(0).max(100).parse(length);
        if (index >= length)
          throw new Error("That ingredient or step is not in this recipe.");
      }
      return database.transaction("rw", database.recipeStates, async () => {
        const previous = await database.recipeStates.get(recipeId);
        await assertRoom(database.recipeStates, "recipeStates", previous);
        const current = previous ?? emptyRecipeState(recipeId);
        const key = kind === "ingredient" ? "ingredients" : "steps";
        const indices = new Set(current.checks?.[key] ?? []);
        if (checked) indices.add(index);
        else indices.delete(index);
        const record = recipeStateSchema.parse({
          ...current,
          checks: {
            ingredients: current.checks?.ingredients ?? [],
            steps: current.checks?.steps ?? [],
            [key]: [...indices].sort((x, y) => x - y),
          },
          updatedAt: nextTime(previous?.updatedAt),
        });
        await database.recipeStates.put(record);
        return record;
      });
    },
    async clearUserData() {
      await database.transaction("rw", database.tables, async () => {
        for (const table of database.tables) await table.clear();
      });
    },
    saveSession: (input: Input<CookingSession>) =>
      save("sessions", sessionSchema, input),
    async saveCookingSession(
      input: Input<CookingSession>,
      completeCooking = false,
    ) {
      z.boolean().parse(completeCooking);
      return database.transaction(
        "rw",
        database.sessions,
        database.recipeStates,
        database.activeCooking,
        async () => {
          const id = await save("sessions", sessionSchema, input);
          await patchRecipeState(input.recipeId, {
            tried: true,
            ...(input.rating === null ? {} : { rating: input.rating }),
          });
          if (
            completeCooking &&
            (await database.activeCooking.get("active"))?.recipeId ===
              input.recipeId
          )
            await database.activeCooking.delete("active");
          return id;
        },
      );
    },
    deleteSession: (id: string) => database.sessions.delete(id),
    savePlan: (input: Input<PlanEntry>) => save("plans", planSchema, input),
    deletePlan: (id: string) => database.plans.delete(id),
    savePantry: (input: Input<PantryItem>) =>
      save("pantry", pantrySchema, input),
    deletePantry: (id: string) => database.pantry.delete(id),
    async saveShopping(input: Input<ShoppingItem>) {
      return database.transaction("rw", database.shopping, async () => {
        await pruneStaleGeneratedShopping(database.shopping, localDate());
        return writeShopping(input);
      });
    },
    // One transaction for a whole list: a validation or storage failure on any row writes
    // none of them, instead of leaving the list half-added.
    async saveShoppingBatch(rows: Input<ShoppingItem>[]) {
      z.array(z.unknown()).max(maxShoppingBatch).parse(rows);
      return database.transaction("rw", database.shopping, async () => {
        await pruneStaleGeneratedShopping(database.shopping, localDate());
        const ids: string[] = [];
        for (const row of rows) ids.push(await writeShopping(row));
        return ids;
      });
    },
    // Clears the ticks for one planning week in one transaction. Ticked manual items are
    // deleted; ticked generated rows for that week are unticked, since the meal plan owns them.
    async clearTickedShopping(weekStart: string) {
      dateSchema.parse(weekStart);
      return database.transaction("rw", database.shopping, async () => {
        const prefix = `week-${weekStart}:`;
        const ticked = await database.shopping.filter((row) => row.checked).toArray();
        const manual = ticked.filter((row) => row.manual).map((row) => row.id);
        const generated = ticked.filter(
          (row) => !row.manual && row.id.startsWith(prefix),
        );
        await database.shopping.bulkDelete(manual);
        for (const row of generated)
          await writeShopping({ ...row, checked: false });
        return manual.length + generated.length;
      });
    },
    deleteShopping: (id: string) => database.shopping.delete(id),
    async savePreferences(
      patch: Partial<Omit<Preferences, "id" | "updatedAt">>,
    ) {
      const parsed = preferenceSchema
        .omit({ id: true, updatedAt: true })
        .partial()
        .parse(patch);
      return database.transaction("rw", database.preferences, async () => {
        const previous =
          (await database.preferences.get("preferences")) ?? defaultPreferences;
        const record = preferenceSchema.parse({
          ...previous,
          ...parsed,
          updatedAt: nextTime(previous.updatedAt),
        });
        await database.preferences.put(record);
        return record;
      });
    },
    saveCustomRecipe: (recipe: Recipe) =>
      save("customRecipes", customRecipeSchema, { id: recipe.id, recipe }),
    deleteCustomRecipe: (id: string) => database.customRecipes.delete(id),
    // Pass a full base recipe when initially creating an override; later patches merge against it.
    async saveOverride(
      recipeId: string,
      patch: Partial<Recipe>,
      baseRecipe?: Recipe,
    ) {
      await database.transaction("rw", database.overrides, async () => {
        const previous = await database.overrides.get(recipeId);
        await assertRoom(database.overrides, "overrides", previous);
        const recipe = recipeSchema.parse({
          ...(previous?.recipe ?? baseRecipe),
          ...patch,
          id: recipeId,
          slug: recipeId,
        });
        await database.overrides.put(
          overrideSchema.parse({
            id: recipeId,
            recipe,
            updatedAt: nextTime(previous?.updatedAt),
          }),
        );
      });
    },
    deleteOverride: (id: string) => database.overrides.delete(id),
    startCooking,
    async stopCooking(expectedActiveRecipeId: string) {
      activeCookingSchema.shape.recipeId.parse(expectedActiveRecipeId);
      await database.transaction("rw", database.activeCooking, async () => {
        assertActiveCooking(
          await database.activeCooking.get("active"),
          expectedActiveRecipeId,
        );
        await database.activeCooking.delete("active");
      });
    },
    patchActiveCooking,
    async setCookingCheck(
      recipeId: string,
      kind: "ingredient" | "step",
      index: number,
      checked: boolean,
      defaultServings = 2,
      expectedActiveRecipeId?: string | null,
    ) {
      z.enum(["ingredient", "step"]).parse(kind);
      z.number().int().min(0).max(99).parse(index);
      z.boolean().parse(checked);
      await database.transaction("rw", database.activeCooking, async () => {
        const previous = await database.activeCooking.get("active");
        // A caller that expected a cook which has since finished gets the conflict message.
        assertActiveCooking(previous, expectedActiveRecipeId);
        // Ticking is part of cooking, not a way to start it: a tick with nothing cooking
        // would otherwise create the single active cook and block every other recipe.
        if (!previous)
          throw new Error(
            "Start cooking this recipe before ticking its steps or ingredients.",
          );
        const field =
          kind === "ingredient" ? "checkedIngredients" : "checkedSteps";
        const indices = new Set(
          previous?.recipeId === recipeId ? previous[field] : [],
        );
        if (checked) indices.add(index);
        else indices.delete(index);
        await patchActiveCooking(
          recipeId,
          { [field]: [...indices].sort((a, b) => a - b) },
          defaultServings,
          expectedActiveRecipeId,
        );
      });
    },
    // Same optional guard as the other active-cooking writes: when the caller passes the
    // recipe it last saw, a write that would replace or clear a different cook is refused.
    async saveActiveCooking(
      input: Omit<ActiveCooking, "id" | "updatedAt"> | null,
      expectedActiveRecipeId?: string | null,
    ) {
      await database.transaction("rw", database.activeCooking, async () => {
        if (expectedActiveRecipeId !== undefined)
          assertActiveCooking(
            await database.activeCooking.get("active"),
            expectedActiveRecipeId,
          );
        if (input === null) {
          await database.activeCooking.delete("active");
          return;
        }
        await save("activeCooking", activeCookingSchema, {
          ...input,
          id: "active",
        });
      });
    },
  };
  return withUserErrors(api);
}
export const actions = createActions();
// Export validates every row so a backup can always be restored. Restore comparison and
// the preview fingerprint read rows as stored: a damaged local row must not stop a user
// from exporting the rest or from replacing it by restoring a good backup.
type StoredRow = { id: string; updatedAt?: unknown } & Record<string, unknown>;
type RawSnapshot = Record<TableName, StoredRow[]>;
// Dexie's upgrade step and backups can produce the same record with keys in a different
// order, so comparisons use sorted keys rather than insertion order.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  return value;
}
async function rawSnapshot(database: KitchenDB): Promise<RawSnapshot> {
  const result = {} as RawSnapshot;
  for (const name of tableNames)
    result[name] = (await database.table(name).toArray()) as StoredRow[];
  return result;
}
// Names the first damaged record so the user can judge it. Ids are truncated and the raw
// Zod issues stay out of the message.
function damagedRecordError(
  name: TableName,
  rows: StoredRow[],
  cause: unknown,
) {
  const element = backupSchema.shape[name].element;
  const bad = rows.find((row) => !element.safeParse(row).success);
  const where = bad
    ? `the saved ${name} record "${String(bad.id).slice(0, 60)}" is damaged or from an unsupported version`
    : `the saved ${name} table has too many records to back up`;
  return new Error(
    `Could not make a backup: ${where}. Nothing was exported and your data is unchanged.`,
    { cause },
  );
}
async function snapshot(database: KitchenDB): Promise<Backup> {
  const rows = await rawSnapshot(database);
  const result: Record<string, unknown> = {
    format: "airfuel-kitchen",
    version: 2,
    exportedAt: Date.now(),
  };
  for (const name of tableNames) {
    const parsed = backupSchema.shape[name].safeParse(rows[name]);
    if (!parsed.success)
      throw damagedRecordError(name, rows[name], parsed.error);
    result[name] = parsed.data;
  }
  return backupSchema.parse(result);
}
// A backup larger than the restore limit could be written but never restored.
export const maxBackupBytes = 20 * 1024 * 1024;
export async function exportBackup(database = db): Promise<string> {
  try {
    const text = await database.transaction("r", database.tables, async () =>
      JSON.stringify(await snapshot(database), null, 2),
    );
    if (new TextEncoder().encode(text).length > maxBackupBytes)
      throw new Error(
        "Your data is too large for one backup file (over 20 MB), so nothing was exported. Your data is unchanged.",
      );
    return text;
  } catch (error) {
    throw describeWriteError(error);
  }
}
function dataFingerprint(rows: RawSnapshot): string {
  // Exact serialised state avoids probabilistic hash collisions at this destructive boundary.
  // View-only recipe rows (updatedAt 0, never edited) and viewedAt are not user data
  // here, matching comparableRow below: opening a recipe must not invalidate a preview.
  return JSON.stringify(
    tableNames.map((name) =>
      rows[name]
        .filter(
          (row) => name !== "recipeStates" || (row.updatedAt as number) > 0,
        )
        .map((row) => comparableRow(name, row))
        .sort(),
    ),
  );
}
// viewedAt is a device view log that merge never applies, so viewing alone is not a conflict.
function comparableRow(name: TableName, row: object): string {
  return JSON.stringify(
    canonical(name === "recipeStates" ? { ...row, viewedAt: undefined } : row),
  );
}
export interface ImportPreview {
  backup: Backup;
  added: number;
  duplicates: number;
  conflicts: number;
  currentCount: number;
  fingerprint: string;
}
const knownPreviews = new WeakMap<ImportPreview, string>();
// A stamp in the future (clock skew, or a hostile file) would let no later genuine edit win a
// merge. Incoming stamps are capped just before the import, so any edit made afterwards is
// strictly newer and wins.
function capFutureStamps(backup: Backup, now: number): Backup {
  const cap = <T extends { updatedAt: number }>(row: T): T =>
    row.updatedAt > now ? { ...row, updatedAt: now - 1 } : row;
  const capped: Record<string, unknown> = { ...backup };
  for (const name of tableNames)
    capped[name] = (backup[name] as Array<{ updatedAt: number }>).map(cap);
  return capped as unknown as Backup;
}
export async function previewImport(
  text: string,
  database = db,
): Promise<ImportPreview> {
  try {
    if (new TextEncoder().encode(text).length > maxBackupBytes)
      throw new Error("Backup exceeds 20 MB.");
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      throw new Error("The backup is not valid JSON.");
    }
    let backup: Backup;
    try {
      backup = capFutureStamps(backupSchema.parse(input), Date.now());
    } catch (error) {
      // The UI gets a plain sentence with one short field hint; the full issues stay in `cause`.
      const first = error instanceof z.ZodError ? error.issues[0] : undefined;
      const where = first?.path.length
        ? ` Problem at ${first.path.map(String).join(".").slice(0, 80)}.`
        : "";
      throw new Error(
        `This file is not an AirFuel Kitchen backup. Choose a backup exported from Settings.${where}`,
        { cause: error },
      );
    }
    for (const name of tableNames) {
      const ids = new Set<string>();
      for (const row of backup[name]) {
        if (ids.has(row.id))
          throw new Error(`Duplicate ID in ${name}: ${row.id}`);
        ids.add(row.id);
      }
    }
    const current = await database.transaction("r", database.tables, () =>
      rawSnapshot(database),
    );
    let added = 0,
      duplicates = 0,
      conflicts = 0,
      currentCount = 0;
    for (const name of tableNames) {
      const existing = new Map<string, StoredRow>(
        current[name].map((row) => [row.id, row]),
      );
      currentCount += existing.size;
      for (const row of backup[name]) {
        const other = existing.get(row.id);
        if (!other) added++;
        else {
          duplicates++;
          if (comparableRow(name, other) !== comparableRow(name, row))
            conflicts++;
        }
      }
    }
    const preview = {
      backup,
      added,
      duplicates,
      conflicts,
      currentCount,
      fingerprint: dataFingerprint(current),
    };
    knownPreviews.set(preview, JSON.stringify(preview));
    return preview;
  } catch (error) {
    throw describeWriteError(error);
  }
}
export async function importBackup(
  preview: ImportPreview,
  mode: "merge" | "replace",
  database = db,
): Promise<void> {
  try {
    if (
      !knownPreviews.has(preview) ||
      knownPreviews.get(preview) !== JSON.stringify(preview)
    )
      throw new Error("Please preview this backup again before importing.");
    if (mode !== "merge" && mode !== "replace")
      throw new Error("Invalid import mode.");
    const backup = backupSchema.parse(preview.backup);
    await database.transaction("rw", database.tables, async () => {
      const current = await rawSnapshot(database);
      if (dataFingerprint(current) !== preview.fingerprint)
        throw new Error(
          "Your data changed after the preview. Preview again to avoid overwriting newer changes.",
        );
      // Decide every table's rows first, so nothing is written unless the whole result fits.
      const writes = {} as Record<TableName, StoredRow[]>;
      for (const name of tableNames) {
        if (mode === "replace") {
          writes[name] = backup[name] as StoredRow[];
          continue;
        }
        const existing = new Map(
          current[name].map((row) => [row.id, row.updatedAt as number]),
        );
        // The active cook is one device's current session. A merge may update it only for
        // the same recipe; a different recipe would silently replace what is being cooked.
        const cookingNow = current.activeCooking[0]?.recipeId;
        const incoming =
          name === "activeCooking"
            ? backup.activeCooking.filter(
                (row) => !cookingNow || row.recipeId === cookingNow,
              )
            : backup[name];
        writes[name] = incoming.filter(
          (row) =>
            !existing.has(row.id) || row.updatedAt > existing.get(row.id)!,
        ) as StoredRow[];
      }
      // The result must still fit one backup file. Row counts alone are not enough: two
      // files that are each under the limit can merge into one that the export refuses.
      const result = {} as Record<string, unknown>;
      for (const name of tableNames) {
        const byId = new Map<string, StoredRow>(
          mode === "replace" ? [] : current[name].map((row) => [row.id, row]),
        );
        for (const row of writes[name]) byId.set(row.id, row);
        result[name] = [...byId.values()];
        if (byId.size > backupLimits[name])
          throw new Error(
            `This ${mode} would leave ${byId.size} ${name} records, more than a backup can hold (${backupLimits[name]}). Nothing was imported.`,
          );
      }
      const bytes = new TextEncoder().encode(
        JSON.stringify(result, null, 2),
      ).length;
      if (bytes > maxBackupBytes)
        throw new Error(
          `This ${mode} would leave about ${Math.round(bytes / 1048576)} MB of data, more than one backup file can hold (20 MB). Nothing was imported.`,
        );
      for (const name of tableNames) {
        const table = database.table(name);
        if (mode === "replace") await table.clear();
        await table.bulkPut(writes[name]);
      }
    });
    knownPreviews.delete(preview);
  } catch (error) {
    throw describeWriteError(error);
  }
}
// Another tab on an older build can hold the database open. Dexie then waits without
// any error, so the page needs this event to tell the user to close that tab.
// Calls back at once when the upgrade is already blocked, so a page that subscribes
// after the block (the usual case at module load) still shows the message.
export function onUpgradeBlocked(callback: () => void, database = db) {
  const handler = () => callback();
  database.on("blocked", handler);
  if (upgradeBlocked.has(database)) callback();
  return () => database.on("blocked").unsubscribe(handler);
}
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
