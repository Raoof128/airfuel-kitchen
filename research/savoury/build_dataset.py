"""Rebuild reviewed recipe records; publisher estimates retain original serving basis."""

import json
import re
import html
import pathlib

ROOT = pathlib.Path(__file__).parent
AUTHORED = json.loads((ROOT / "authored.json").read_text())
SOURCES = json.loads((ROOT / "source-facts-review.json").read_text())
if (ROOT / "more-source-facts-review.json").exists():
    SOURCES += json.loads((ROOT / "more-source-facts-review.json").read_text())

if (ROOT / "me-source-facts-review.json").exists():
    SOURCES += json.loads((ROOT / "me-source-facts-review.json").read_text())
if (ROOT / "expansion-source-facts.json").exists():
    SOURCES += json.loads((ROOT / "expansion-source-facts.json").read_text())
AFCD = {r["id"]: r for r in json.loads((ROOT / "afcd-reference.json").read_text())}

AFCD.update(
    {r["id"]: r for r in json.loads((ROOT / "product-profiles.json").read_text())}
)


def publisher(url):
    for domain, name in [
        ("bbcgoodfood", "Good Food"),
        ("ninja", "Ninja Kitchen"),
        ("alaskaseafood", "Alaska Seafood"),
        ("foodforfitness", "Food For Fitness"),
        ("fisheries.noaa.gov", "NOAA / Seafood Nutrition Partnership"),
        ("kikkoman", "Kikkoman"),
        ("pauladeen", "Paula Deen"),
        ("sunbeam", "Sunbeam"),
        ("recipethis", "Recipe This"),
    ]:
        if domain in url:
            return name
    return "Recipe source"


def ingredient(v, reference=None):
    # Amounts and food forms come from reviewed tuples, not inferred quantities.
    q, u, name, *rest = v
    prep = rest[0] if rest else ""
    form = rest[1] if len(rest) > 1 else "raw"
    low = name.lower()
    reference_name = (reference or {}).get("name", "").lower()
    if form == "raw":
        if "dried" in low or (
            "dried" in reference_name and "raw" not in reference_name
        ):
            form = "dried"
        elif "canned" in low or "tinned" in low:
            form = "canned"
        elif "cooked" in low:
            form = "cooked"
        elif "frozen" in low:
            form = "frozen"

    def matches(words):
        return re.search(r"\b(?:" + "|".join(words) + r")\b", low) is not None

    aisle = "Pantry"
    if form in {"dried", "canned"} or matches(
        [
            "oil",
            "sauce",
            "stock",
            "paste",
            "powder",
            "flour",
            "cornflour",
            "breadcrumbs",
            "vinegar",
            "mayonnaise",
            "mustard",
            "honey",
            "sugar",
            "seed",
            "seeds",
            "peanut butter",
            "coconut milk",
            "coconut cream",
        ]
    ):
        aisle = "Pantry"
    elif matches(
        [
            "chicken",
            "turkey",
            "duck",
            "beef",
            "pork",
            "lamb",
            "bacon",
            "ham",
            "sausage",
            "sausages",
            "chorizo",
            "salami",
        ]
    ):
        aisle = "Meat"
    elif matches(
        [
            "fish",
            "salmon",
            "prawn",
            "prawns",
            "tuna",
            "cod",
            "hoki",
            "bream",
            "scallop",
            "scallops",
            "calamari",
            "squid",
            "crab",
            "mussel",
            "mussels",
            "lobster",
        ]
    ):
        aisle = "Seafood"
    elif matches(
        [
            "cheese",
            "cheddar",
            "mozzarella",
            "parmesan",
            "ricotta",
            "yoghurt",
            "butter",
            "egg",
            "eggs",
            "milk",
            "cream",
        ]
    ):
        aisle = "Dairy & eggs"
    elif matches(
        [
            "onion",
            "onions",
            "shallot",
            "shallots",
            "tomato",
            "tomatoes",
            "capsicum",
            "lemon",
            "lime",
            "cabbage",
            "carrot",
            "potato",
            "potatoes",
            "coriander",
            "parsley",
            "garlic",
            "ginger",
            "apple",
            "plum",
            "lettuce",
            "broccoli",
            "cauliflower",
            "cucumber",
            "avocado",
            "rocket",
            "spinach",
            "basil",
            "dill",
            "mushroom",
            "mushrooms",
            "zucchini",
            "bok choy",
            "leek",
            "celery",
            "sprouts",
            "green beans",
            "red chilli",
            "pumpkin",
        ]
    ):
        aisle = "Fruit & vegetables"
    return dict(name=name, quantity=q, unit=u, preparation=prep, form=form, aisle=aisle)


def build():
    out = []
    provenance = []
    for src in SOURCES:
        slug = src.get("slug") or src["url"].rstrip("/").split("/")[-1]
        if slug not in AUTHORED or any(d["id"] == slug for d in out):
            continue
        a = AUTHORED[slug]
        cat = a["category"]
        nutrition = src["nutrition"]

        def num(k, default=None):
            v = nutrition.get(k)
            if v is None:
                return default
            return float(re.search(r"[\d.]+", str(v)).group())

        macros = dict(
            protein=num("proteinContent"),
            calories=num("calories"),
            carbs=num("carbohydrateContent", 0),
            fat=num("fatContent"),
            fibre=num("fiberContent"),
        )
        if a.get("afcd"):
            assert len(a["afcd"]) == len(a["ingredients"]), slug
            totals = {k: 0.0 for k in ["energyKj", "protein", "fat", "fibre", "carbs"]}
            for ing, food_id in zip(a["ingredients"], a["afcd"]):
                assert ing[1] == "g", slug + " requires edible grams"
                food = AFCD[food_id]
                for key in totals:
                    if food[key] is not None:
                        totals[key] += food[key] * ing[0] / 100 / a["servings"]
            macros = {
                k: round(totals[k], 1) for k in ["protein", "fat", "fibre", "carbs"]
            }
            macros["calories"] = round(totals["energyKj"] / 4.184)
            if any(AFCD[fid]["fibre"] is None for fid in a["afcd"]):
                macros["fibre"] = None
        if any(macros[k] is None for k in ["protein", "calories", "carbs", "fat"]):
            raise ValueError("Incomplete nutrition " + slug)
        if not 0 < macros["calories"] < 2000:
            raise ValueError("Implausible calorie estimate " + slug)
        safetyTemp = a.get(
            "internal",
            74 if cat == "chicken-turkey" else 63 if cat == "seafood" else 71,
        )
        ingredients = [
            ingredient(x, AFCD.get(a.get("afcd", [None] * len(a["ingredients"]))[i]))
            for i, x in enumerate(a["ingredients"])
        ]
        prep = a.get("prep", 5)
        cook = a["cook"]
        preheat = a.get("preheat", 0)
        wait = a.get("wait", 0)
        steps = a["steps"][:]
        if preheat:
            steps.insert(
                0,
                f"Preheat the air fryer to {a['temp']}°C for {preheat} minutes, following its manual.",
            )
        if not a.get("noFinalThermometerStep"):
            steps.append(
                f"Check the thickest part with a clean food thermometer: it must reach {safetyTemp}°C. Add short cooking intervals if needed; the timer alone cannot establish doneness."
            )
        oilFree = a.get("oilFree", False)
        macros.update(
            method="Publisher estimate for the listed source serving, retained with the original ingredient proportions. UK tablespoons converted to 15 ml; Australian teaspoons are 5 ml. "
            + a.get(
                "nutritionNote",
                "Optional serving suggestions are excluded. Ingredient brands, size and cooking losses change actual values.",
            ),
            confidence="source-estimate",
            reference=src["url"],
        )
        if a.get("afcd"):
            macros.update(
                method="Calculated from FSANZ AFCD Release 3 per-100-g nutrient data using the listed edible ingredient weights and forms, summed and divided by servings. All listed coating and oil counted; actual uptake or discarded drippings may lower intake. Water loss changes cooked weight, not the batch nutrient sum. "
                + a.get("nutritionNote", ""),
                confidence="estimated",
                reference="https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd",
            )
        if any(fid.startswith("LABEL_") for fid in a.get("afcd", [])):
            macros["method"] = (
                "Calculated from the listed edible ingredient weights using FSANZ AFCD Release 3 plus the named manufacturer product label, divided by servings. "
                + a.get("nutritionNote", "")
            )
        d = dict(
            id=slug,
            slug=slug,
            title=a["title"],
            description=a["description"],
            category=cat,
            tags=a.get("tags", [])
            + (["high-protein"] if macros["protein"] >= 25 else []),
            sources=[
                dict(
                    title=publisher(src["url"]) + " · " + html.unescape(src["name"]),
                    url=src["url"],
                    verifiedAt="2026-10-11",
                )
            ],
            prepMinutes=prep,
            cookMinutes=cook,
            totalMinutes=prep + cook + preheat + wait,
            temperatureC=a["temp"],
            servings=a["servings"],
            portion=a.get(
                "portion",
                f"One of {a['servings']} equal portions; nutrition is per portion.",
            ),
            ingredients=ingredients,
            steps=steps,
            preheat=bool(preheat),
            preheatMinutes=preheat,
            turn=a.get("turn", "Turn halfway through cooking."),
            safety=[
                "Keep raw meat and seafood separate from ready-to-eat food; wash hands and sanitise tools.",
                "Leave space for air circulation. Cook in batches when needed; extra batches add time.",
                "Use only accessories approved for your model. Never preheat loose baking paper.",
            ]
            + a.get("safety", []),
            internalTempC=safetyTemp,
            nutrition=macros,
            allergens=a.get("allergens", []),
            dietary=a.get("dietary", []),
            substitutions=a.get(
                "substitutions",
                [
                    "Ingredient swaps change the nutrition and may change allergens and cooking time."
                ],
            ),
            oilFree=oilFree,
            storage="Refrigerate promptly in a shallow covered container below 5°C; follow NSW leftover guidance. Reheat thoroughly once until steaming hot throughout. See the food-safety guide for time limits.",
            equipment=["Basket-style air fryer", "Food thermometer"]
            + a.get("equipment", []),
            difficulty=a.get("difficulty", "Easy"),
            image=dict(
                src="/images/" + cat + ".webp",
                alt=a["title"] + " category illustration; finished dishes vary",
                credit="AirFuel Kitchen",
                licence="AI-generated illustration; not a photograph of the tested recipe",
            ),
        )
        if a.get("afcd"):
            d["sources"].append(
                dict(
                    title="FSANZ Australian Food Composition Database, Release 3",
                    url="https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd",
                    verifiedAt="2026-10-11",
                )
            )
        for fid in a.get("afcd", []):
            food = AFCD[fid]
            if food.get("url") and not any(
                s["url"] == food["url"] for s in d["sources"]
            ):
                d["sources"].append(
                    dict(
                        title=food["name"] + " nutrient label",
                        url=food["url"],
                        verifiedAt=food["verifiedAt"],
                    )
                )
        out.append(d)
        provenance.append(
            dict(
                id=slug,
                url=src["url"],
                verifiedAt=src["verifiedAt"],
                httpStatus=src["httpStatus"],
                sourceYield=src["recipeYield"],
                sourceIngredients=src["recipeIngredient"],
                sourceNutrition=src["nutrition"],
                adaptation="Original instructions; metric equivalents; NSW internal cooking temperature overrides publisher guidance.",
                afcdMapping=[
                    dict(
                        ingredient=ing[2],
                        edibleGrams=ing[0],
                        foodId=fid,
                        referenceFood=AFCD[fid]["name"],
                    )
                    for ing, fid in zip(a["ingredients"], a.get("afcd", []))
                ],
                nutritionCaveat=a.get(
                    "nutritionNote",
                    "Publisher estimate, not independently recalculated or laboratory tested.",
                ),
            )
        )
    (ROOT.parent.parent / "src/data/recipes-savoury.json").write_text(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n"
    )
    (ROOT / "provenance.json").write_text(
        json.dumps(provenance, indent=2, ensure_ascii=False) + "\n"
    )
    print("Built", len(out), "reviewed recipes")


if __name__ == "__main__":
    build()
