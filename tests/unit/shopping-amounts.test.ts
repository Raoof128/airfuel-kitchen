import { describe, expect, it } from "vitest";
import { formatShoppingAmount } from "../../src/lib/engine";

describe("shopping amounts read naturally", () => {
  it("shows volumes under 15 ml as teaspoon fractions", () => {
    expect(formatShoppingAmount(1.7, "ml")).toBe("⅓ tsp");
    expect(formatShoppingAmount(6.67, "ml")).toBe("1⅓ tsp");
    expect(formatShoppingAmount(3.75, "ml")).toBe("¾ tsp");
    expect(formatShoppingAmount(9.2, "ml")).toBe("1¾ tsp");
  });

  it("shows 15 to 60 ml as tablespoons, rounded up to the next half", () => {
    expect(formatShoppingAmount(15, "ml")).toBe("1 tbsp");
    expect(formatShoppingAmount(22.5, "ml")).toBe("1½ tbsp");
    expect(formatShoppingAmount(31.67, "ml")).toBe("2 tbsp");
    expect(formatShoppingAmount(40, "ml")).toBe("2 tbsp");
  });

  it("keeps 60 ml and up in ml, and litres from 1000 ml", () => {
    expect(formatShoppingAmount(62, "ml")).toBe("62 ml");
    expect(formatShoppingAmount(250, "ml")).toBe("250 ml");
    expect(formatShoppingAmount(1200, "ml")).toBe("1.2 L");
  });

  it("shows mass from 1000 g as kilograms with up to two decimals", () => {
    expect(formatShoppingAmount(1500, "g")).toBe("1.5 kg");
    expect(formatShoppingAmount(1250, "g")).toBe("1.25 kg");
    expect(formatShoppingAmount(999, "g")).toBe("999 g");
  });

  it("formats typed spoon units as fractions and leaves other units alone", () => {
    expect(formatShoppingAmount(0.5, "tsp")).toBe("½ tsp");
    expect(formatShoppingAmount(1.9, "tbsp")).toBe("2 tbsp");
    expect(formatShoppingAmount(6, "each")).toBe("6 each");
  });
});
