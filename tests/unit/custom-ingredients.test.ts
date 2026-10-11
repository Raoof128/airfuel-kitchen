import { describe, expect, it } from "vitest";
import { parseCustomIngredients } from "../../src/pages/CustomRecipes";

describe("custom ingredient entry", () => {
  it("accepts decimals and optional preparation or aisle while preserving explicit fields", () => {
    expect(
      parseCustomIngredients(
        "0.5 | tsp | paprika | ground\n300 | g | chicken | raw | diced | Meat & seafood",
      ),
    ).toEqual({
      errors: [],
      ingredients: [
        {
          quantity: 0.5,
          unit: "tsp",
          name: "paprika",
          form: "ground",
          preparation: "",
          aisle: "Pantry",
        },
        {
          quantity: 300,
          unit: "g",
          name: "chicken",
          form: "raw",
          preparation: "diced",
          aisle: "Meat & seafood",
        },
      ],
    });
  });

  it("reports original line numbers, bad measurements and missing fields together", () => {
    const result = parseCustomIngredients(
      "300 | g | chicken | raw\n\n1/2 | cup |  | ",
    );
    expect(result.ingredients).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Line 3:");
    expect(result.errors[0]).toContain("use a decimal");
    expect(result.errors[0]).toContain("choose a unit");
    expect(result.errors[0]).toContain("give the ingredient a name");
    expect(result.errors[0]).toContain("describe its form");
  });

  it("rejects empty, oversized and incorrectly delimited lists before saving", () => {
    expect(parseCustomIngredients("  \n ").errors[0]).toContain("at least one");
    expect(
      parseCustomIngredients(
        Array(101).fill("1 | g | pepper | ground").join("\n"),
      ).errors[0],
    ).toContain("100 ingredients");
    expect(
      parseCustomIngredients(
        "1 | g | pepper | ground | chopped | Pantry | extra",
      ).errors[0],
    ).toContain("4 to 6 sections");
  });
});

describe("natural ingredient lines", () => {
  const first = (line: string) => parseCustomIngredients(line).ingredients[0];

  it.each([
    [
      "200 g chicken breast",
      { quantity: 200, unit: "g", name: "chicken breast" },
    ],
    ["2 tbsp olive oil", { quantity: 2, unit: "tbsp", name: "olive oil" }],
    ["1/2 tsp paprika", { quantity: 0.5, unit: "tsp", name: "paprika" }],
    [
      "½ tsp smoked paprika",
      { quantity: 0.5, unit: "tsp", name: "smoked paprika" },
    ],
    ["1½ cups rice", { quantity: 375, unit: "ml", name: "rice" }],
    ["3 eggs", { quantity: 3, unit: "each", name: "eggs" }],
    ["pinch of salt", { quantity: 0.125, unit: "tsp", name: "salt" }],
    ["salt", { quantity: 1, unit: "each", name: "salt", form: "as needed" }],
    ["1 L milk", { quantity: 1000, unit: "ml", name: "milk" }],
    ["1 kg potatoes", { quantity: 1000, unit: "g", name: "potatoes" }],
    [
      "200 g chicken breast, diced",
      {
        quantity: 200,
        unit: "g",
        name: "chicken breast",
        preparation: "diced",
      },
    ],
  ])("reads %s", (line, expected) => {
    const result = parseCustomIngredients(line);
    expect(result.errors).toEqual([]);
    expect(result.ingredients).toHaveLength(1);
    expect(first(line)).toMatchObject({ aisle: "Pantry", ...expected });
  });

  it("keeps the pipe format working alongside natural lines", () => {
    const result = parseCustomIngredients(
      "300 | g | chicken | raw | diced | Meat & seafood\n2 tbsp olive oil",
    );
    expect(result.errors).toEqual([]);
    expect(result.ingredients.map((i) => i.name)).toEqual([
      "chicken",
      "olive oil",
    ]);
  });

  it("reports a garbage line by its line number and keeps the good lines", () => {
    const result = parseCustomIngredients("200 g chicken\n@@@ ###\n5 ml oil");
    expect(result.ingredients.map((i) => i.name)).toEqual(["chicken", "oil"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^Line 2: could not read/);
  });

  it("rejects a quantity with no ingredient name", () => {
    const result = parseCustomIngredients("200 g");
    expect(result.ingredients).toEqual([]);
    expect(result.errors[0]).toMatch(/^Line 1:/);
  });
});
