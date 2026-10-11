"""Deterministic editorial corrections after factual record assembly."""

import json
import re
from pathlib import Path


def polish(records):
    descriptions = json.loads(Path("research/plant/descriptions.json").read_text())
    budget_slugs = {
        "air-fryer-fried-rice",
        "dal-with-air-fryer-tofu",
        "air-fryer-enchiladas",
        "air-fryer-cheese-and-bean-toastie",
        "air-fryer-tortilla-de-patatas",
        "air-fryer-scrambled-eggs-on-toast",
        "air-fryer-onions",
        "air-fryer-roasted-peppers-bell-peppers",
        "air-fryer-spinach",
        "two-ingredient-air-fryer-croutons",
        "vegetable-rice-cutlet",
        "air-fryer-aloo-gobi",
        "masala-peanuts",
        "classic-baked-oats",
        "air-fryer-leeks",
        "air-fryer-baked-potatoes",
        "air-fryer-chickpeas",
        "air-fryer-roast-potatoes",
        "air-fryer-boiled-eggs",
    }
    for recipe in records:
        key = recipe["slug"]
        if key in budget_slugs:
            recipe["tags"] = list(dict.fromkeys(recipe["tags"] + ["Budget-friendly"]))
        if key in descriptions:
            recipe["description"] = descriptions[key]
        recipe["steps"] = [
            re.sub(r"([a-z])(?=\d)", r"\1 ", step) for step in recipe["steps"]
        ]
        names = " ".join(i["name"] for i in recipe["ingredients"]).lower()
        # Compound products cannot support strict dietary claims without labels.
        if "vegetarian sausage" in names:
            recipe["dietary"] = ["vegetarian"]
            recipe["allergens"] = sorted(set(recipe["allergens"] + ["milk", "egg"]))
        if "pesto" in names:
            recipe["allergens"] = sorted(
                set(recipe["allergens"] + ["tree-nut", "milk"])
            )
            recipe["dietary"] = [d for d in recipe["dietary"] if d != "gluten-free"]
        if key == "air-fryer-spring-rolls":
            recipe["allergens"] = [a for a in recipe["allergens"] if a != "milk"]
            recipe["dietary"] = ["vegetarian", "dairy-free"]
            for i in recipe["ingredients"]:
                if i["name"] == "spring roll pastry sheets":
                    i["name"] = "dairy-free spring roll pastry sheets"
        if key in {
            "best-ever-philips-airfryer-new-york-cheesecake",
            "chickpea-scotch-eggs",
            "air-fryer-black-bean-burgers",
            "air-fryer-bread-and-butter-pudding",
            "air-fryer-pumpkin-custard-pie",
        }:
            recipe["internalTempC"] = 71
        if key == "air-fryer-portobello-burgers":
            recipe["ingredients"][0]["name"] = "large flat field mushrooms"
        if key == "pesto-mozzarella-gnocchi":
            recipe["allergens"] = sorted(
                set(
                    recipe["allergens"]
                    + ["wheat", "gluten", "sulphites", "tree-nut", "milk"]
                )
            )
            recipe["dietary"] = ["vegetarian"]
        if key == "air-fryer-scrambled-eggs-on-toast":
            recipe["safety"].append(
                "Air-fried scrambled eggs can become firm; stir frequently and serve immediately. A stovetop usually gives softer curds."
            )
    return records
