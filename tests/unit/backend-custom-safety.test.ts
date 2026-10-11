import { describe, expect, it } from "vitest";
import { coreTemperatureRequirement } from "../../src/lib";
import type { Ingredient, Recipe } from "../../src/lib";

const ingredient = (name: string): Ingredient => ({
  name,
  quantity: 100,
  unit: "g",
  preparation: "",
  form: "as sold",
  aisle: "Pantry",
});
const requirement = (category: Recipe["category"], ...names: string[]) =>
  coreTemperatureRequirement(category, names.map(ingredient));

describe("core temperature requirement from ingredients", () => {
  it.each([
    ["chicken breast", 74, "poultry"],
    ["turkey mince", 74, "poultry"],
    ["duck breast", 74, "poultry"],
    ["pork mince", 71, "mince, pork, egg or red meat"],
    ["beef mince", 71, "mince, pork, egg or red meat"],
    ["lamb chops", 71, "mince, pork, egg or red meat"],
    ["eggs", 71, "mince, pork, egg or red meat"],
    ["salmon fillet", 63, "fish"],
    ["prawns", 63, "fish"],
  ])("%s needs %i°C", (name, minimum, label) => {
    const result = requirement("quick-dinners", name);
    expect(result.minimum).toBe(minimum);
    expect(result.reason).toBe(`because it contains ${name} (${label})`);
  });

  it("does not match eggplant as egg", () => {
    expect(requirement("quick-dinners", "eggplant").minimum).toBeNull();
  });

  it("does not match peanut or hamburger as a meat word", () => {
    expect(requirement("snacks-sides", "peanut butter").minimum).toBeNull();
    expect(requirement("snacks-sides", "hamburger buns").minimum).toBeNull();
  });

  it("ignores packaged ingredients that name a meat", () => {
    expect(requirement("quick-dinners", "chicken stock").minimum).toBeNull();
    expect(requirement("quick-dinners", "fish sauce").minimum).toBeNull();
    expect(requirement("vegetarian", "chicken seasoning").minimum).toBeNull();
  });

  it.each([
    ["chicken-turkey", 74, "for chicken & turkey recipes"],
    ["meat", 71, "for beef, lamb & pork recipes"],
    ["breakfast", 71, "for eggs & breakfast recipes"],
    ["seafood", 63, "for fish & seafood recipes"],
  ] as const)(
    "category %s has a minimum of %i°C",
    (category, minimum, reason) => {
      expect(requirement(category, "water")).toEqual({ minimum, reason });
    },
  );

  it("has no minimum for categories without one and no protein", () => {
    expect(requirement("vegetarian", "lentils")).toEqual({
      minimum: null,
      reason: "",
    });
    expect(requirement("desserts", "sugar").minimum).toBeNull();
  });

  it("applies the highest requirement when the category and ingredients differ", () => {
    expect(requirement("meat", "chicken thighs")).toEqual({
      minimum: 74,
      reason: "because it contains chicken thighs (poultry)",
    });
    expect(requirement("seafood", "pork belly").minimum).toBe(71);
    expect(requirement("quick-dinners", "salmon", "egg").minimum).toBe(71);
  });

  it("keeps the category minimum when no ingredient is higher", () => {
    expect(requirement("chicken-turkey", "salmon").minimum).toBe(74);
  });
});
