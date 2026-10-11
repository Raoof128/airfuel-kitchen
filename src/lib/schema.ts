import { z } from "zod";

const short = z.string().trim().min(1).max(300);
const text = z.string().max(10000);
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(160);
const positive = z.number().finite().positive().max(1000000);
const nonnegative = z.number().finite().min(0).max(1000000);
const servingsSchema = z.number().finite().min(0.01).max(100);
export const unitSchema = z.enum(["g", "ml", "each", "tsp", "tbsp"]);
export const categories = [
  "chicken-turkey",
  "meat",
  "seafood",
  "vegetarian",
  "breakfast",
  "quick-dinners",
  "snacks-sides",
  "desserts",
] as const;
export const allergenNames = [
  "milk",
  "egg",
  "fish",
  "crustacean",
  "mollusc",
  "peanut",
  "tree-nut",
  "sesame",
  "soy",
  "wheat",
  "gluten",
  "lupin",
  "sulphites",
] as const;
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T12:00:00Z`);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid calendar date");
const stringList = z.array(short).max(100);
export const ingredientSchema = z
  .object({
    name: short,
    quantity: positive,
    unit: unitSchema,
    preparation: text,
    form: short,
    aisle: short,
  })
  .strict();
export const nutritionSchema = z
  .object({
    protein: nonnegative,
    calories: nonnegative,
    carbs: nonnegative,
    fat: nonnegative,
    fibre: nonnegative.nullable(),
    method: z.string().min(1).max(3000),
    confidence: z.enum(["estimated", "source-estimate"]),
    reference: text.min(1),
  })
  .strict();
export const recipeSchema = z
  .object({
    id: slug,
    slug,
    title: short,
    description: text.min(1),
    category: z.enum(categories),
    tags: stringList,
    sources: z
      .array(
        z
          .object({
            title: short,
            url: z
              .string()
              .url()
              .max(2000)
              .refine(
                (v) => new URL(v).protocol === "https:",
                "HTTPS sources only",
              ),
            verifiedAt: dateSchema,
          })
          .strict(),
      )
      .min(1)
      .max(30),
    prepMinutes: nonnegative,
    cookMinutes: positive,
    totalMinutes: positive,
    temperatureC: z.number().min(40).max(260),
    servings: servingsSchema,
    portion: short,
    ingredients: z.array(ingredientSchema).min(1).max(100),
    steps: z.array(text.min(1)).min(1).max(100),
    preheat: z.boolean(),
    preheatMinutes: nonnegative,
    turn: text,
    safety: stringList,
    internalTempC: z.number().min(0).max(100).nullable(),
    nutrition: nutritionSchema,
    allergens: z.array(z.enum(allergenNames)).max(20),
    dietary: z
      .array(z.enum(["vegetarian", "vegan", "gluten-free", "dairy-free"]))
      .max(4),
    substitutions: stringList,
    oilFree: z.boolean(),
    storage: text,
    equipment: stringList,
    difficulty: z.enum(["Easy", "Moderate"]),
    image: z
      .object({
        src: z.string().regex(/^\/images\/[a-zA-Z0-9_-]+\.(webp|png|jpg|svg)$/),
        alt: short,
        credit: short,
        licence: short,
      })
      .strict(),
  })
  .strict()
  .refine((r) => r.id === r.slug, "ID and slug must match")
  .refine(
    (r) => r.totalMinutes >= r.cookMinutes + r.prepMinutes,
    "Total time must include prep and cooking",
  );
export type Recipe = z.infer<typeof recipeSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
const timestamp = z.number().finite().int().min(0).max(8640000000000000);
const id = z.string().min(1).max(300);
const metadata = { id, updatedAt: timestamp };
export const recipeStateSchema = z
  .object({
    ...metadata,
    tried: z.boolean(),
    triedAt: timestamp.nullable(),
    favourite: z.boolean(),
    rating: z.number().int().min(1).max(5).nullable(),
    notes: text,
    viewedAt: timestamp.nullable(),
  })
  .strict();
export type RecipeState = z.infer<typeof recipeStateSchema>;
export const sessionSchema = z
  .object({
    ...metadata,
    recipeId: slug,
    date: dateSchema,
    servingsPrepared: servingsSchema,
    servingsConsumed: nonnegative.max(100),
    rating: z.number().int().min(1).max(5).nullable(),
    actualMinutes: nonnegative.nullable(),
    ingredientChanges: text,
    temperatureC: z.number().min(40).max(260).nullable(),
    timeChanges: text,
    notes: text,
    wouldCookAgain: z.boolean().nullable(),
  })
  .strict();
export type CookingSession = z.infer<typeof sessionSchema>;
export const planSchema = z
  .object({
    ...metadata,
    recipeId: slug,
    date: dateSchema,
    slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    servings: servingsSchema,
  })
  .strict();
export type PlanEntry = z.infer<typeof planSchema>;
export const pantrySchema = z
  .object({
    ...metadata,
    name: short,
    quantity: nonnegative,
    unit: unitSchema,
    form: short,
  })
  .strict();
export type PantryItem = z.infer<typeof pantrySchema>;
export const shoppingSchema = z
  .object({
    ...metadata,
    name: short,
    quantity: nonnegative,
    unit: unitSchema,
    form: short,
    aisle: short,
    checked: z.boolean(),
    manual: z.boolean(),
  })
  .strict();
export type ShoppingItem = z.infer<typeof shoppingSchema>;
export const preferenceSchema = z
  .object({
    id: z.literal("preferences"),
    updatedAt: timestamp,
    name: short,
    location: short,
    language: short,
    timezone: short.refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone"),
    airFryerBrand: short,
    airFryerLitres: positive.max(100),
    airFryerModel: z.string().max(100),
    defaultServings: servingsSchema,
    minProtein: nonnegative.max(300),
    maxMinutes: positive.max(1440),
    preferredProteins: stringList,
    favouriteIngredients: stringList,
    dislikedIngredients: stringList,
    avoidIngredients: stringList,
    allergens: z.array(z.enum(allergenNames)).max(20),
    dietary: z
      .array(z.enum(["vegetarian", "vegan", "gluten-free", "dairy-free"]))
      .max(4),
    oilFree: z.boolean(),
    cuisines: stringList,
    theme: z.enum(["light", "dark", "system"]),
  })
  .strict();
export type Preferences = z.infer<typeof preferenceSchema>;
export const defaultPreferences: Preferences = {
  id: "preferences",
  updatedAt: 0,
  name: "Raouf",
  location: "Sydney, Australia",
  language: "en-AU",
  timezone: "Australia/Sydney",
  airFryerBrand: "Ninja",
  airFryerLitres: 6.7,
  airFryerModel: "",
  defaultServings: 2,
  minProtein: 30,
  maxMinutes: 35,
  preferredProteins: [],
  favouriteIngredients: [],
  dislikedIngredients: [],
  avoidIngredients: [],
  allergens: [],
  dietary: [],
  oilFree: false,
  cuisines: [],
  theme: "system",
};
export const customRecipeSchema = z
  .object({ ...metadata, recipe: recipeSchema })
  .strict()
  .refine(
    (v) => v.id === v.recipe.id && v.id.startsWith("custom-"),
    "Custom IDs must match and start custom-",
  );
export type CustomRecipe = z.infer<typeof customRecipeSchema>;
// Overrides contain complete validated recipes. Partial updates are merged before writing.
export const overrideSchema = z
  .object({ ...metadata, recipe: recipeSchema })
  .strict()
  .refine((v) => v.id === v.recipe.id);
export type RecipeOverride = z.infer<typeof overrideSchema>;
export const activeCookingSchema = z
  .object({
    id: z.literal("active"),
    updatedAt: timestamp,
    recipeId: slug,
    servings: servingsSchema,
    checkedIngredients: z.array(z.number().int().min(0).max(99)).max(100),
    checkedSteps: z.array(z.number().int().min(0).max(99)).max(100),
    timerEndsAt: timestamp.nullable(),
    timerRemainingSeconds: nonnegative.max(86400),
  })
  .strict();
export type ActiveCooking = z.infer<typeof activeCookingSchema>;
export const backupSchema = z
  .object({
    format: z.literal("airfuel-kitchen"),
    version: z.literal(2),
    exportedAt: timestamp,
    recipeStates: z.array(recipeStateSchema).max(20000),
    sessions: z.array(sessionSchema).max(50000),
    plans: z.array(planSchema).max(20000),
    pantry: z.array(pantrySchema).max(10000),
    shopping: z.array(shoppingSchema).max(10000),
    customRecipes: z.array(customRecipeSchema).max(1000),
    overrides: z.array(overrideSchema).max(1000),
    preferences: z.array(preferenceSchema).max(1),
    activeCooking: z.array(activeCookingSchema).max(1),
  })
  .strict();
export type Backup = z.infer<typeof backupSchema>;
export interface KitchenData {
  recipeStates: RecipeState[];
  sessions: CookingSession[];
  plans: PlanEntry[];
  pantry: PantryItem[];
  shopping: ShoppingItem[];
  customRecipes: CustomRecipe[];
  overrides: RecipeOverride[];
  preferences: Preferences;
  activeCooking: ActiveCooking | undefined;
}
