"""Original concise methods; metric volume preserves publisher cup proportions."""

import json
import re
from pathlib import Path
import build

DEFS = []


def add(slug, title, cat, serv, temp, prep, cook, rest, ingredients, steps, desc):
    DEFS.append(
        (slug, title, cat, serv, temp, prep, cook, rest, ingredients, steps, desc)
    )


add(
    "paneer-tikka",
    "Paneer and capsicum tikka",
    "vegetarian",
    2,
    180,
    15,
    10,
    30,
    [
        (300, "g", "paneer cheese", "2.5 cm cubes"),
        (118, "ml", "Greek yoghurt", "half US cup"),
        (15, "ml", "chickpea flour", ""),
        (15, "ml", "ginger garlic paste", ""),
        (0.25, "tsp", "turmeric", ""),
        (1, "tsp", "Kashmiri chilli powder", ""),
        (0.5, "tsp", "cumin", ""),
        (1, "tsp", "chaat masala", ""),
        (0.5, "tsp", "garam masala", ""),
        (1, "tsp", "dried fenugreek leaves", ""),
        (1, "tsp", "lemon juice", ""),
        (15, "ml", "oil", "plus light brushing, amount varies"),
        (2, "each", "capsicums", "2.5 cm pieces"),
        (1, "each", "red onion", "2.5 cm pieces"),
    ],
    [
        "Mix yoghurt, chickpea flour, ginger garlic paste, spices, fenugreek, lemon and oil. Coat paneer and vegetables; refrigerate 30 minutes.",
        "Thread onto short metal skewers approved for your appliance, or arrange loose in one layer. Air-fry at 180°C for 5 minutes, turn and cook 3–5 minutes more until browned and hot.",
    ],
    "Paneer, capsicum and onion in a spiced yoghurt marinade, cooked on short skewers.",
)
add(
    "malai-broccoli",
    "Creamy malai broccoli",
    "vegetarian",
    4,
    180,
    15,
    10,
    30,
    [
        (300, "g", "broccoli", "florets"),
        (118, "ml", "Greek yoghurt", ""),
        (59, "ml", "thickened cream", ""),
        (59, "ml", "vegetarian processed cheese", "grated; quarter US cup"),
        (15, "ml", "ginger garlic paste", ""),
        (0.25, "tsp", "cardamom", ""),
        (15, "ml", "dried fenugreek leaves", ""),
        (0.5, "tsp", "cumin", ""),
        (0.5, "tsp", "garam masala", ""),
        (0.25, "tsp", "black pepper", ""),
        (0.25, "tsp", "sugar", ""),
        (1, "tsp", "lemon juice", ""),
        (15, "ml", "cornflour", ""),
        (15, "ml", "melted butter", "for brushing"),
    ],
    [
        "Boil broccoli for 1 minute, then cool in cold water, drain and dry. Whisk yoghurt, cream, cheese, paste, spices, sugar, lemon and cornflour. Coat broccoli and refrigerate 30 minutes.",
        "Brush with butter and spread in one layer. Air-fry at 180°C for 8–10 minutes, turning halfway, until browned with a cooked coating.",
    ],
    "Broccoli florets with a creamy yoghurt and cheese coating scented with cardamom.",
)
add(
    "tandoori-paneer-naan-pizza",
    "Paneer naan pizzas",
    "quick-dinners",
    2,
    180,
    10,
    20,
    0,
    [
        (118, "ml", "paneer cheese", "small cubes; half US cup"),
        (30, "ml", "Greek yoghurt", ""),
        (1, "tsp", "ginger garlic paste", ""),
        (0.25, "tsp", "turmeric", ""),
        (0.5, "tsp", "chilli powder", ""),
        (0.5, "tsp", "garam masala", ""),
        (2, "each", "naan breads", ""),
        (2, "tsp", "oil", ""),
        (118, "ml", "pizza sauce", ""),
        (177, "ml", "mozzarella cheese", "grated; three-quarter US cup"),
        (59, "ml", "red onion", "thinly sliced"),
        (59, "ml", "capsicum", "thinly sliced"),
        (10, "each", "grape tomatoes", "halved"),
        (30, "ml", "fresh coriander leaves", "chopped"),
    ],
    [
        "Combine paneer with yoghurt, paste and spices; set aside while preparing the bases. Brush naan with oil and spread with sauce.",
        "Divide cheese, paneer, onion, capsicum and tomatoes over both breads. Air-fry one pizza at a time at 180°C for 8–10 minutes until the centre is hot and the cheese melted. Finish with coriander.",
    ],
    "Naan breads topped with spiced paneer, vegetables, tomato sauce and mozzarella.",
)
add(
    "air-fryer-aloo-gobi",
    "Roasted aloo gobi",
    "vegetarian",
    4,
    195,
    15,
    15,
    0,
    [
        (1, "each", "cauliflower", "medium, about 710 ml florets"),
        (2, "each", "potatoes", "small, about 237 ml cubes"),
        (30, "ml", "olive oil", ""),
        (15, "ml", "ginger garlic paste", ""),
        (1, "each", "green chilli", "split"),
        (1, "each", "onion", "sliced"),
        (1, "each", "tomato", "diced"),
        (15, "ml", "lime juice", ""),
        (30, "ml", "fresh coriander leaves", ""),
        (0.5, "tsp", "chilli powder", ""),
        (0.5, "tsp", "turmeric", ""),
        (0.5, "tsp", "cumin", ""),
        (1, "tsp", "coriander powder", ""),
        (0.5, "tsp", "garam masala", ""),
    ],
    [
        "Cut cauliflower into small florets and potatoes into 2 cm cubes. Toss with onion, tomato, chilli, ginger garlic paste, oil and dry spices.",
        "Spread in an uncrowded layer. Air-fry at 195°C for 12–15 minutes, shaking halfway, until the potatoes and cauliflower are tender. Use a second batch if necessary.",
        "Finish with lime juice and coriander and serve hot.",
    ],
    "Potato, cauliflower, onion and tomato roasted together with aromatic spices.",
)
add(
    "air-fryer-banana-chips",
    "Plantain chips",
    "snacks-sides",
    4,
    180,
    15,
    26,
    10,
    [
        (2, "each", "green plantains", "unripe"),
        (30, "ml", "coconut oil", ""),
        (1.5, "tsp", "turmeric", "divided"),
        (1, "tsp", "salt", "soaking water"),
    ],
    [
        "Peel firm green plantains and soak 10 minutes in a litre of water mixed with salt and 1 tsp turmeric. Drain and dry.",
        "Cut into 2 mm slices using a guarded slicer. Toss with oil and remaining turmeric.",
        "Air-fry in two uncrowded batches at 180°C for 10–13 minutes each, shaking midway and checking often near the end. Cool to crisp.",
    ],
    "Thin green-plantain slices with turmeric, cooked in small batches until crisp.",
)


def records():
    sources = {
        r["slug"]: r
        for r in json.loads(Path("research/plant/indian-facts.json").read_text())
    }
    result = []
    for (
        slug,
        title,
        cat,
        serv,
        temp,
        prep,
        cook,
        rest,
        ingredients,
        steps,
        desc,
    ) in DEFS:
        source = sources[slug]
        original_servings = int(source["recipeYield"][0])
        ratio = original_servings / serv
        n = source["nutrition"]
        values = {
            k: str(round(float(re.search(r"[\d.]+", n[field])[0]) * ratio, 1))
            for k, field in [
                ("protein", "proteinContent"),
                ("kcal", "calories"),
                ("carbs", "carbohydrateContent"),
                ("fat", "fatContent"),
                ("fibre", "fiberContent"),
            ]
        }
        build.R[slug] = (cat, temp, cook, rest, title, steps)
        build.overrides[slug] = ingredients
        record = build.make(
            {
                "slug": slug,
                "title": source["name"],
                "url": source["sourceUrl"],
                "timing": f"Prep: {prep} mins Serves {serv}",
                "ingredients": [],
                "nutrition": values,
            }
        )
        record["sources"] = [
            {
                "title": "Indian Veggie Delight: " + source["name"],
                "url": source["sourceUrl"],
                "verifiedAt": "2026-10-11",
            }
        ]
        record["description"] = desc
        record["nutrition"]["method"] = (
            f"Publisher estimate for {original_servings} source portions, proportionally regrouped into {serv} portions with the complete ingredient list unchanged. US cups converted to 237 ml and US tablespoons to 15 ml; range quantities select the lower option. Optional garnishes excluded. Oil for unspecified brushing and produce size vary; not laboratory tested."
        )
        if "paneer" in slug:
            record["allergens"] = sorted(set(record["allergens"] + ["milk"]))
            record["dietary"] = ["vegetarian"]
        result.append(record)
    return result
