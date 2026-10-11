"""Publisher estimates retained only with complete proportional ingredient lists."""

import build


def records():
    return additions()


def additions():
    definitions = [
        (
            "almond-hemp-granola",
            "Almond and hemp granola",
            "breakfast",
            5,
            150,
            10,
            20,
            30,
            "https://evergreenkitchen.ca/air-fryer-granola/",
            "Evergreen Kitchen",
            [
                (355, "ml", "rolled oats", "1.5 US cups"),
                (118, "ml", "raw almonds", "roughly chopped"),
                (59, "ml", "almond meal", ""),
                (30, "ml", "hemp seeds", ""),
                (30, "ml", "coconut oil", "melted"),
                (45, "ml", "almond butter", ""),
                (45, "ml", "honey", ""),
                (1, "tsp", "vanilla extract", ""),
                (0.75, "tsp", "ground cinnamon", ""),
            ],
            [
                "Combine oats, almonds, almond meal, hemp seeds and cinnamon. Stir melted coconut oil, almond butter, honey and vanilla together, then mix through the oats.",
                "Press into a shallow layer on a manufacturer-approved liner fully weighted by food. Air-fry at 150°C for 10 minutes, turn the mixture and press down again, then cook about 10 minutes more until golden.",
                "Cool completely, about 30 minutes, before breaking into clusters. The recipe makes five portions; milk or yoghurt is additional.",
            ],
            "Toasted oat clusters with almonds, hemp seeds and almond butter.",
            {"protein": "10", "kcal": "362", "carbs": "31", "fat": "22", "fibre": "6"},
            "Publisher estimate for five portions; original cup and spoon proportions retained using 237 ml US cups and 15 ml tablespoons. Almonds and honey selected from source alternatives. Serving dairy excluded.",
        ),
        (
            "quinoa-kale-stuffed-squash",
            "Quinoa and kale stuffed squash",
            "vegetarian",
            2,
            160,
            15,
            30,
            0,
            "https://veganpunks.com/air-fryer-acorn-squash/",
            "Vegan Punks",
            [
                (
                    1,
                    "each",
                    "small acorn squash",
                    "halved and seeds removed; two halves must fit",
                ),
                (60, "g", "dry quinoa", "rinsed"),
                (180, "ml", "vegetable stock", ""),
                (2, "each", "garlic cloves", "minced"),
                (0.5, "each", "red onion", "diced"),
                (15, "ml", "fresh sage", "chopped"),
                (237, "ml", "kale", "finely shredded"),
                (15, "ml", "toasted pumpkin seeds", ""),
                (
                    1,
                    "tsp",
                    "olive oil",
                    "measured allowance for the source unquantified splash",
                ),
            ],
            [
                "Halve the squash and scoop out seeds. Place cut-side down and air-fry at 160°C for 15 minutes, turn and cook another 5–10 minutes until the flesh is fork-tender.",
                "Meanwhile simmer quinoa in stock for 12–15 minutes until tender. Soften onion in the oil in a frying pan, then add garlic, sage and kale. Cook until the kale wilts and mix with quinoa.",
                "Fill squash halves with the quinoa mixture and air-fry another 5 minutes until steaming. Scatter with pumpkin seeds. Larger squash need longer before filling.",
            ],
            "Roasted acorn squash halves filled with quinoa, kale, sage and pumpkin seeds.",
            {"protein": "9", "kcal": "257", "carbs": "48", "fat": "5", "fibre": "8"},
            "Publisher per-half estimate with original proportions retained. Source oil splash standardised to 5 ml; exact oil and squash size vary, so this is an approximate source estimate. Quinoa is weighed dry. Other pumpkin varieties change cooking time and nutrition.",
        ),
    ]
    definitions.append(
        (
            "broccoli-ricotta-stuffed-shells",
            "Broccoli ricotta stuffed shells",
            "vegetarian",
            4,
            175,
            30,
            36,
            0,
            "https://cosori.com/blogs/recipes/cheesy-veggie-stuffed-shells",
            "COSORI",
            [
                (113, "g", "broccoli florets", ""),
                (142, "g", "jumbo wheat pasta shells", "about twelve; dry weight"),
                (15, "ml", "olive oil", ""),
                (118, "ml", "ricotta cheese", "half US cup"),
                (118, "ml", "fresh basil leaves", ""),
                (71, "ml", "vegetarian hard cheese", "grated; 0.3 US cup"),
                (15, "ml", "pine nuts", "toasted"),
                (1, "each", "garlic clove", ""),
                (0.5, "tsp", "lemon zest", ""),
                (0.5, "tsp", "salt", ""),
                (0.25, "tsp", "black pepper", ""),
                (1, "each", "large egg", "beaten"),
                (237, "ml", "marinara tomato sauce", ""),
                (59, "ml", "mozzarella cheese", "grated"),
            ],
            [
                "Boil broccoli for 5 minutes, cool and drain. Cook pasta until pliable but still firm, drain and toss with oil.",
                "Process broccoli with ricotta, basil, hard cheese, pine nuts, garlic, zest and seasoning. Mix in egg last; do not taste after adding raw egg.",
                "Spread half the sauce in a 20 cm air-fryer-safe pan. Fill twelve shells and arrange over the sauce. Add remaining sauce and mozzarella; cover with tightly secured approved foil or a fitted ovenproof lid.",
                "Cook at 175°C for 30 minutes until the filling reaches 75°C. Uncover and finish at 200°C for 4–6 minutes until cheese is golden, watching closely. Serve three shells per portion.",
            ],
            "Jumbo pasta shells filled with broccoli, ricotta and pine nuts, baked in tomato sauce.",
            {"protein": "15", "kcal": "346", "carbs": "36", "fat": "17", "fibre": "4"},
            "COSORI publisher estimate per three shells; source ingredient proportions retained. Ounces converted to grams, US cups to 237 ml, tablespoon to 15 ml. Original 230 C broil finish adapted to 200 C air fry with extra time and visual check; not kitchen-tested on Ninja. Optional chilli and garnish omitted.",
        )
    )
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
        url,
        publisher,
        ingredients,
        steps,
        desc,
        nutrition,
        note,
    ) in definitions:
        build.R[slug] = (cat, temp, cook, rest, title, steps)
        build.overrides[slug] = ingredients
        r = build.make(
            {
                "slug": slug,
                "url": url,
                "title": title,
                "timing": f"Prep: {prep} mins Serves {serv}",
                "ingredients": [],
                "nutrition": nutrition,
            }
        )
        r["sources"] = [
            {"title": publisher + ": " + title, "url": url, "verifiedAt": "2026-10-11"}
        ]
        r["description"] = desc
        r["nutrition"]["method"] = note
        if slug == "broccoli-ricotta-stuffed-shells":
            r["allergens"] = ["milk", "egg", "wheat", "gluten", "tree-nut"]
            r["dietary"] = ["vegetarian"]
            r["internalTempC"] = 75
        if slug == "almond-hemp-granola":
            r["preheat"] = False
            r["totalMinutes"] -= r["preheatMinutes"]
            r["preheatMinutes"] = 0
        result.append(r)
    return result
