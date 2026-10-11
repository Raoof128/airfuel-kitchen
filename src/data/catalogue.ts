import { recipeSchema, type Recipe } from "../lib/schema";
const modules = import.meta.glob("./recipes-*.json", {
  eager: true,
  import: "default",
});
export const catalogue: Recipe[] = Object.values(modules).flatMap((value) =>
  recipeSchema.array().parse(value),
);
const ids = new Set<string>();
for (const recipe of catalogue) {
  if (ids.has(recipe.id)) throw new Error(`Duplicate recipe ID: ${recipe.id}`);
  ids.add(recipe.id);
}
export const categoryLabels: Record<Recipe["category"], string> = {
  "chicken-turkey": "Chicken & turkey",
  meat: "Beef, lamb & pork",
  seafood: "Fish & seafood",
  vegetarian: "Vegetarian",
  breakfast: "Eggs & breakfast",
  "quick-dinners": "Quick dinners",
  "snacks-sides": "Snacks & sides",
  desserts: "Something sweet",
};
