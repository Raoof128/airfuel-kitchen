"""Validate the plant dataset and independently reproduce calculated nutrients.

Run from the repository root: python3 research/plant/validate.py
This uses saved evidence only and performs no network requests.
"""

import json
import math
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "research" / "plant"


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise SystemExit(f"Cannot read {path}: {exc}") from exc


def main():
    recipes = read_json(ROOT / "src/data/recipes-plant.json")
    calculations = read_json(EVIDENCE / "afcd-calculations.json")
    profiles = {
        r["id"]: r
        for name in ["afcd-reference.json", "product-profiles.json"]
        for r in read_json(EVIDENCE / name)
    }
    by_slug = {r["slug"]: r for r in recipes}
    errors = []
    if len(recipes) != 150 or len(by_slug) != 150:
        errors.append("Expected150 unique canonical records")
    blocked = ("supergoldenbakes.com", "forksoverknives.com", "silverhillsbakery.ca")
    for r in recipes:
        slug = r["slug"]
        if r["id"] != slug or not r["ingredients"] or len(r["steps"]) < 2:
            errors.append(f"{slug}: incomplete recipe")
        if (
            r["totalMinutes"]
            < r["prepMinutes"] + r["cookMinutes"] + r["preheatMinutes"]
        ):
            errors.append(f"{slug}: time omits a declared component")
        for i in r["ingredients"]:
            if not isinstance(i["quantity"], (float, int)) or i["quantity"] <= 0:
                errors.append(f"{slug}: invalid ingredient amount")
        for s in r["sources"]:
            if not s["url"].startswith("https://") or any(
                h in s["url"] for h in blocked
            ):
                errors.append(f"{slug}: unacceptable source URL")
        for key in ["protein", "calories", "carbs", "fat"]:
            value = r["nutrition"][key]
            if (
                not isinstance(value, (float, int))
                or not math.isfinite(value)
                or value < 0
            ):
                errors.append(f"{slug}: invalid {key}")
        foods = " ".join(i["name"].lower() for i in r["ingredients"])
        allergens = set(r["allergens"])
        if "soy sauce" in foods and not {"soy", "wheat", "gluten"} <= allergens:
            errors.append(f"{slug}: ordinary soy sauce requires soy/wheat/gluten")
        if "peanut" in foods and "peanut" not in allergens:
            errors.append(f"{slug}: peanut allergen missing")
        if "vegan" in r["dietary"] and allergens & {
            "milk",
            "egg",
            "fish",
            "crustacean",
            "mollusc",
        }:
            errors.append(f"{slug}: vegan/allergen conflict")
        if "gluten-free" in r["dietary"] and allergens & {"wheat", "gluten"}:
            errors.append(f"{slug}: gluten claim conflict")
    for c in calculations:
        r = by_slug[c["slug"]]
        totals = {k: 0 for k in ["protein", "calories", "carbs", "fat", "fibre"]}
        unknown_fibre = False
        for i in c["ingredientMatches"]:
            p = profiles[i["referenceId"]]
            unknown_fibre |= p["fibre"] is None
            for k in totals:
                per100 = p["energyKj"] / 4.184 if k == "calories" else p[k]
                totals[k] += i["grams"] / 100 * (per100 or 0)
        expected = {k: round(v / c["servings"]) for k, v in totals.items()}
        expected["calories"] = 5 * round(expected["calories"] / 5)
        if unknown_fibre:
            expected["fibre"] = None
        for k, value in expected.items():
            if value != r["nutrition"][k] or value != c["roundedPerServing"][k]:
                errors.append(f"{c['slug']}: nutrition/evidence mismatch for {k}")
    result = {
        "recipes": len(recipes),
        "calculatedNutritionReproduced": len(calculations),
        "categories": dict(Counter(r["category"] for r in recipes)),
        "nutritionConfidence": dict(
            Counter(r["nutrition"]["confidence"] for r in recipes)
        ),
        "atLeast25gProtein": sum(r["nutrition"]["protein"] >= 25 for r in recipes),
        "within35Minutes": sum(r["totalMinutes"] <= 35 for r in recipes),
        "budgetTagged": sum("Budget-friendly" in r["tags"] for r in recipes),
        "errors": errors,
    }
    print(json.dumps(result, indent=2))
    return bool(errors)


if __name__ == "__main__":
    sys.exit(main())
