import { describe, expect, it } from "vitest";
import { formatAmount, ingredientDetails } from "../../src/components/context";

describe("formatAmount", () => {
  it("shows spoon and cup measures as kitchen fractions", () => {
    expect(formatAmount(0.5, "tsp")).toBe("½");
    expect(formatAmount(1 / 3, "tsp")).toBe("⅓");
    expect(formatAmount(0.333, "tsp")).toBe("⅓");
    expect(formatAmount(0.25, "tbsp")).toBe("¼");
    expect(formatAmount(1.5, "cup")).toBe("1½");
    expect(formatAmount(2.75, "tbsp")).toBe("2¾");
    expect(formatAmount(2, "tsp")).toBe("2");
  });
  it("keeps decimals for other units and uncommon fractions", () => {
    expect(formatAmount(187.5, "g")).toBe("187.5");
    expect(formatAmount(0.5, "each")).toBe("0.5");
    expect(formatAmount(1.4, "tsp")).toBe("1.4");
  });
});

describe("ingredientDetails", () => {
  it("joins only the parts that exist", () => {
    expect(ingredientDetails("", "raw")).toBe("raw");
    expect(ingredientDetails("Chopped", "dried")).toBe("Chopped · dried");
    expect(ingredientDetails(undefined, undefined)).toBe("");
  });
});
