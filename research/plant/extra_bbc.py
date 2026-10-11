"""Additional individually verified Good Food pages, using publisher estimates."""

import json, re
from pathlib import Path
import build


def records():
    src = {
        r["slug"]: r
        for r in json.loads(Path("research/plant/extra-facts.json").read_text())
    }
    defs = [
        (
            "air-fryer-cauliflower-popcorn-with-soured-cream-herb-dressing",
            "Crumbed cauliflower with sour cream dip",
            "vegetarian",
            4,
            200,
            20,
            40,
            0,
            [
                (1000, "g", "cauliflower", "small florets"),
                (125, "g", "plain flour", ""),
                (25, "g", "vegetarian hard cheese", "grated"),
                (1, "tsp", "onion granules", ""),
                (0.5, "tsp", "dried oregano", ""),
                (1, "tsp", "paprika", ""),
                (1, "each", "egg", ""),
                (150, "ml", "milk", ""),
                (80, "g", "panko breadcrumbs", ""),
                (150, "ml", "sour cream", ""),
                (0.125, "tsp", "onion granules", "for dip"),
                (10, "g", "chives", "chopped"),
            ],
            [
                "Mix sour cream with the smaller onion-granule quantity and chopped chives; refrigerate while cooking.",
                "Combine flour, cheese, remaining onion granules, oregano and paprika. Mix in egg and enough milk for a thick batter. Coat small cauliflower florets, let excess drip off and press into breadcrumbs.",
                "Air fry at 200°C in loose single layers for 15–20 minutes per batch, turning midway. The cauliflower must be tender and coating cooked and crisp. Serve with the chilled dip.",
            ],
        ),
        (
            "air-fryer-spring-rolls",
            "Vegetable spring rolls",
            "quick-dinners",
            8,
            200,
            15,
            24,
            10,
            [
                (30, "ml", "cornflour", "two UK tablespoons, divided"),
                (15, "ml", "dark soy sauce", ""),
                (1, "tsp", "honey", ""),
                (1, "tsp", "sesame oil", ""),
                (45, "ml", "vegetable oil", "15 ml for pan; 30 ml for brushing"),
                (
                    450,
                    "g",
                    "mixed stir-fry vegetables",
                    "beansprouts, cabbage, carrot and capsicum, shredded",
                ),
                (8, "each", "spring roll pastry sheets", "large sheets"),
            ],
            [
                "Mix half the cornflour with soy sauce, honey and sesame oil. Heat 15 ml vegetable oil in a wok, stir-fry vegetables for 30 seconds, then add sauce and cook 1 minute. Transfer to a bowl and cool for 10 minutes.",
                "Mix remaining cornflour with 15 ml water. Divide filling among eight pastry sheets. Fold the bottom corner over the filling, tuck in both sides and roll tightly, sealing the top with cornflour paste.",
                "Brush with remaining vegetable oil. Air fry at 200°C for 12 minutes per batch, turning halfway. Leave space around each roll and check the centre is hot and the pastry crisp.",
            ],
        ),
        (
            "air-fryer-sweetcorn-fritters",
            "Sweetcorn and parsley fritters",
            "breakfast",
            12,
            200,
            15,
            30,
            0,
            [
                (175, "g", "plain flour", ""),
                (1.5, "tsp", "baking powder", ""),
                (0.5, "tsp", "garlic powder", ""),
                (1, "tsp", "smoked paprika", ""),
                (100, "ml", "milk", ""),
                (2, "each", "eggs", "beaten"),
                (15, "g", "parsley", "approximate half bunch, chopped"),
                (4, "each", "spring onions", "chopped"),
                (500, "g", "sweetcorn kernels", "thawed and drained"),
            ],
            [
                "Mix flour, baking powder, garlic powder and paprika. Gradually stir in milk and eggs, then parsley, spring onions and drained corn.",
                "Divide into twelve flattened fritters about 1.5 cm thick. Arrange six at a time on a neatly fitted liner weighted down by the food.",
                "Air fry at 200°C for 12–15 minutes per batch. Turn after 8 minutes and check the centres are set without wet batter.",
            ],
        ),
        (
            "green-goddess-bowl-with-crispy-sesame-tofu",
            "Sesame tofu quinoa bowls",
            "quick-dinners",
            4,
            190,
            20,
            30,
            0,
            [
                (15, "ml", "soy sauce", ""),
                (1, "each", "egg", "beaten"),
                (45, "ml", "plain flour", "three UK tablespoons"),
                (75, "g", "sesame seeds", ""),
                (450, "g", "firm tofu", "dried, cut into 1.5 cm strips"),
                (
                    500,
                    "g",
                    "quinoa",
                    "ready-cooked; heat following packet instructions",
                    "cooked",
                ),
                (0.5, "each", "white cabbage", "shredded"),
                (160, "g", "edamame", "shelled, cooked following packet directions"),
                (1, "each", "green apple", "cut into thin sticks"),
                (1, "each", "avocado", "peeled flesh"),
                (15, "g", "coriander", ""),
                (15, "g", "basil", ""),
                (100, "g", "Greek yoghurt", ""),
                (1, "each", "lime", "zest and juice"),
            ],
            [
                "Whisk soy sauce and egg together. Dust dried tofu strips in flour, dip in egg and coat with sesame seeds, pressing firmly so they adhere.",
                "Air fry at 190°C in a loose layer for 10–15 minutes per batch, turning halfway. The coating must be set and golden. Use a suitable secured liner to catch loose seeds.",
                "Blend avocado, coriander, basil, yoghurt and lime zest and juice, adding a little water to make a dressing.",
                "Heat ready-cooked quinoa and edamame following their packets. Divide quinoa between bowls. Toss cabbage, apple and edamame with dressing and add the crisp tofu.",
            ],
        ),
    ]
    out = []
    for slug, title, cat, serv, temp, prep, cook, rest, ings, steps in defs:
        s = src[slug]
        n = s["nutrition"]
        nn = {
            k: str(float(re.search(r"[\d.]+", n.get(p, "0"))[0]))
            for k, p in [
                ("protein", "proteinContent"),
                ("kcal", "calories"),
                ("carbs", "carbohydrateContent"),
                ("fat", "fatContent"),
                ("fibre", "fiberContent"),
            ]
        }
        build.R[slug] = (cat, temp, cook, rest, title, steps)
        build.overrides[slug] = ings
        fake = {
            "slug": slug,
            "url": s["sourceUrl"],
            "title": s["name"],
            "timing": f"Prep: {prep} mins Serves {serv}",
            "ingredients": [],
            "nutrition": nn,
        }
        r = build.make(fake)
        r["sources"] = [
            {
                "title": "Good Food: " + s["name"],
                "url": s["sourceUrl"],
                "verifiedAt": "2026-10-11",
            }
        ]
        if slug == "green-goddess-bowl-with-crispy-sesame-tofu":
            r["nutrition"]["method"] += (
                " Air-fryer set point is adapted from the linked tofu nugget technique because this source omits a temperature."
            )
            r["sources"].append(
                {
                    "title": "Good Food tofu air-fryer technique",
                    "url": "https://www.bbcgoodfood.com/recipes/air-fryer-tofu-popcorn-nuggets",
                    "verifiedAt": "2026-10-11",
                }
            )
        if slug == "air-fryer-spring-rolls":
            r["nutrition"]["fibre"] = None
        out.append(r)
    return out
