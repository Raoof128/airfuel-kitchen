import Dexie, { type Table } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { z } from "zod";
import { localDate } from "./engine";
import {
  activeCookingSchema,
  backupSchema,
  customRecipeSchema,
  defaultPreferences,
  overrideSchema,
  pantrySchema,
  planSchema,
  preferenceSchema,
  recipeSchema,
  recipeStateSchema,
  sessionSchema,
  shoppingSchema,
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
            for (const [key, value] of Object.entries(defaultPreferences))
              if (row[key] === undefined) row[key] = value;
          });
      });
  }
}
export const db = new KitchenDB();
const newId = () => crypto.randomUUID();
const nextTime = (previous = 0) => Math.max(Date.now(), previous + 1);
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
function withUserErrors<T extends object>(api: T): T {
  return Object.fromEntries(
    Object.entries(api).map(([name, action]) => [
      name,
      typeof action === "function"
        ? async (...args: unknown[]) => {
            try {
              return await (action as (...a: unknown[]) => Promise<unknown>)(
                ...args,
              );
            } catch (error) {
              throw describeWriteError(error);
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
    await database.transaction("rw", database.activeCooking, async () => {
      const previous = await database.activeCooking.get("active");
      // Replacement is explicit and conditional, so a confirmation cannot
      // overwrite a different cook started in another tab while it was open.
      assertActiveCooking(previous, expectedActiveRecipeId);
      const current = previous?.recipeId === recipeId ? previous : undefined;
      await database.activeCooking.put(
        activeCookingSchema.parse({
          checkedIngredients: [],
          checkedSteps: [],
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
  const api = {
    patchRecipeState,
    saveRecipeNotes,
    toggleRecipeState,
    deleteRecipeState: (recipeId: string) =>
      database.recipeStates.delete(recipeId),
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
        const previous = input.id
          ? await database.shopping.get(input.id)
          : undefined;
        const changed =
          previous &&
          input.manual &&
          ["name", "quantity", "unit", "form"].some(
            (key) =>
              previous[key as keyof ShoppingItem] !==
              input[key as keyof typeof input],
          );
        await pruneStaleGeneratedShopping(database.shopping, localDate());
        return save("shopping", shoppingSchema, {
          ...input,
          checked: changed ? false : input.checked,
        });
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
    async saveActiveCooking(
      input: Omit<ActiveCooking, "id" | "updatedAt"> | null,
    ) {
      if (input === null) {
        await database.activeCooking.delete("active");
        return;
      }
      await save("activeCooking", activeCookingSchema, {
        ...input,
        id: "active",
      });
    },
  };
  return withUserErrors(api);
}
export const actions = createActions();
async function snapshot(database: KitchenDB): Promise<Backup> {
  const result: Record<string, unknown> = {
    format: "airfuel-kitchen",
    version: 2,
    exportedAt: Date.now(),
  };
  for (const name of tableNames)
    result[name] = await database.table(name).toArray();
  return backupSchema.parse(result);
}
export async function exportBackup(database = db): Promise<string> {
  return database.transaction("r", database.tables, async () =>
    JSON.stringify(await snapshot(database), null, 2),
  );
}
function dataFingerprint(backup: Backup): string {
  // Exact serialised state avoids probabilistic hash collisions at this destructive boundary.
  return JSON.stringify(
    tableNames.map((name) =>
      [...backup[name]].sort((a, b) => a.id.localeCompare(b.id)),
    ),
  );
}
// viewedAt is a device view log that merge never applies, so viewing alone is not a conflict.
function comparableRow(name: TableName, row: object): string {
  return JSON.stringify(
    name === "recipeStates" ? { ...row, viewedAt: undefined } : row,
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
export async function previewImport(
  text: string,
  database = db,
): Promise<ImportPreview> {
  if (new TextEncoder().encode(text).length > 20 * 1024 * 1024)
    throw new Error("Backup exceeds 20 MB.");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("The backup is not valid JSON.");
  }
  let backup: Backup;
  try {
    backup = backupSchema.parse(input);
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
    snapshot(database),
  );
  let added = 0,
    duplicates = 0,
    conflicts = 0,
    currentCount = 0;
  for (const name of tableNames) {
    const existing = new Map<string, { id: string; updatedAt: number }>(
      current[name].map((row) => [row.id, row]),
    );
    currentCount += existing.size;
    for (const row of backup[name]) {
      const other = existing.get(row.id);
      if (!other) added++;
      else {
        duplicates++;
        if (comparableRow(name, other) !== comparableRow(name, row)) conflicts++;
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
}
export async function importBackup(
  preview: ImportPreview,
  mode: "merge" | "replace",
  database = db,
): Promise<void> {
  if (
    !knownPreviews.has(preview) ||
    knownPreviews.get(preview) !== JSON.stringify(preview)
  )
    throw new Error("Please preview this backup again before importing.");
  if (mode !== "merge" && mode !== "replace")
    throw new Error("Invalid import mode.");
  const backup = backupSchema.parse(preview.backup);
  await database.transaction("rw", database.tables, async () => {
    const current = await snapshot(database);
    if (dataFingerprint(current) !== preview.fingerprint)
      throw new Error(
        "Your data changed after the preview. Preview again to avoid overwriting newer changes.",
      );
    for (const name of tableNames) {
      const table = database.table(name);
      if (mode === "replace") {
        await table.clear();
        await table.bulkPut(backup[name]);
      } else {
        const existing = new Map(
          current[name].map((row) => [row.id, row.updatedAt]),
        );
        const updates = backup[name].filter(
          (row) =>
            !existing.has(row.id) || row.updatedAt > existing.get(row.id)!,
        );
        await table.bulkPut(updates);
      }
    }
  });
  knownPreviews.delete(preview);
}
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
