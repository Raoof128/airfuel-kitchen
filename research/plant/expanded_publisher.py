"""Individually read sources with explicit per-serving publisher estimates."""

import build


def records():
    slug = "air-fryer-maple-soy-tempeh"
    url = "https://dailydish.co.uk/air-fryer-tempeh/"
    build.R[slug] = (
        "vegetarian",
        190,
        15,
        15,
        "Maple soy tempeh",
        [
            "Cut tempeh into 1.5 cm cubes. Stir soy sauce, maple syrup, sesame oil, mirin and grated ginger together, then coat the cubes. Leave to marinate for 15 minutes.",
            "Spread in a single layer in the preheated basket. Air-fry at 190°C for 10–15 minutes, shaking halfway and watching closely near the end so the sweet coating does not burn.",
            "Serve when the cubes are browned and hot throughout. The nutrition covers the tempeh and marinade; rice and extra garnishes are separate.",
        ],
    )
    build.overrides[slug] = [
        (198, "g", "plain tempeh", "source 7 oz, rounded to grams"),
        (45, "ml", "soy sauce", ""),
        (30, "ml", "maple syrup", ""),
        (15, "ml", "sesame oil", ""),
        (2, "tsp", "mirin", ""),
        (2, "tsp", "fresh ginger", "finely grated"),
    ]
    record = build.make(
        {
            "slug": slug,
            "url": url,
            "title": "Air Fryer Tempeh",
            "timing": "Prep: 5 mins Serves 3",
            "ingredients": [],
            "nutrition": {
                "protein": "14",
                "kcal": "222",
                "carbs": "18",
                "fat": "12",
                "fibre": "1",
            },
        }
    )
    record["description"] = (
        "Tempeh cubes in a sticky maple, ginger and soy marinade, browned at the edges."
    )
    record["sources"] = [
        {
            "title": "The Daily Dish: Air Fryer Tempeh",
            "url": url,
            "verifiedAt": "2026-10-11",
        }
    ]
    record["nutrition"]["method"] = (
        "Publisher per-serving estimate for three portions of tempeh and marinade; rice and garnishes excluded. Original seven ounces converted to 198 g, tablespoons to 15 ml. All source proportions retained. Brands and marinade retained on the food will vary."
    )
    record["allergens"] = ["soy", "sesame", "wheat", "gluten"]
    record["dietary"] = ["vegetarian", "vegan", "dairy-free"]
    return [record]
