"""Build reviewed canonical records from factual source metadata + original editorial methods."""

import json, re, sys
from pathlib import Path
from curated import R

BASE = Path(__file__).parent
S = json.loads((BASE / "source-facts.json").read_text())
Y = json.loads((BASE / "yields.json").read_text())
FRA = {"½": "0.5", "¼": "0.25", "¾": "0.75", "⅓": "0.333", "⅔": "0.667"}
# Resolved from UK public per-serving labels, not an inferred serving size.
yields = {
    "halloumi": 6,
    "arancini": 4,
    "doughnuts": 8,
    "stollen-bites": 25,
    "gingerbread": 24,
    "spiced-carrot-fries": 2,
    "tofu-popcorn-nuggets": 24,
    "chickpeas": 4,
}
# Specific quantity clarifications. Unspecified herbs/greasing are approximate,
# remain labelled and are never used to manufacture per-serving nutrient values.
overrides = {
    "air-fryer-omelette": [(15, "g", "butter", ""), (2, "each", "eggs", "")],
    "air-fryer-banana-bread": [
        (150, "ml", "sunflower oil", "plus a little for the tin"),
        (150, "g", "caster sugar", ""),
        (150, "g", "self-raising flour", ""),
        (1, "tsp", "baking powder", ""),
        (2, "each", "eggs", ""),
        (2, "each", "ripe bananas", "mashed"),
    ],
    "air-fryer-tofu-popcorn-nuggets": [
        (
            1,
            "each",
            "extra-firm tofu block",
            "source does not specify pack weight; nutrition varies with the pack",
        ),
        (
            45,
            "ml",
            "plain flour",
            "3 UK tbsp for batter; metric volume preserves source measure",
        ),
        (15, "ml", "plain flour", "1 UK tbsp for dusting"),
        (1.5, "tsp", "paprika", ""),
        (1, "tsp", "Dijon mustard", ""),
        (125, "ml", "milk", ""),
        (75, "g", "panko breadcrumbs", ""),
        (0.5, "tsp", "garlic granules", ""),
        (15, "ml", "vegetable bouillon powder", "1 UK tbsp; check allergen label"),
    ],
}
skips = {
    "air-fryer-poached-egg": "Retired: Good Food January 2026 eggs guide explicitly discourages this method due to oil-water spitting and difficult access; replaced with tempeh recipe.",
    "air-fryer-french-fries": "Source six-person yield conflicts with per-four nutrition and implausible energy; excludes factory-prepared item.",
    "air-fryer-crisps": "ME nutrition repeats frozen fries numbers; not used pending clear calculation.",
    "air-fryer-tuna-pasta-bake": "Owned by savoury stream.",
    "air-fryer-buffalo-wings": "Owned by savoury stream.",
    "air-fryer-hot-cross-bun-brownie": "Too similar to the independently retained brownie.",
    "caramelised-onion-chutney-soured-cream-dip-with-air-fryer-crisps": "Dip variation does not create distinct potato preparation.",
    "air-fryer-chocolate-fondants-2": "Molten batter conflicts with requested cooked-flour/egg dessert standard.",
    "air-fryer-almond-choc-chunk-passover-cookies": "Published calories inconsistent with macros; unresolved.",
    "easiest-air-fryer-easter-chocolate-cookies": "Too similar to cookie component of retained ice-cream sandwich.",
    "air-fryer-tofu-popcorn-nuggets": "Publisher estimate excluded: undefined tofu block; retained separately with explicit 400 g tofu and AFCD recalculation.",
    "air-fryer-cinnamon-rolls": "Publisher estimate excluded as inconsistent; retained separately with AFCD recalculation.",
    "air-fryer-chickpeas": "Publisher estimate excluded for missing yield; retained separately with measured drained weight and AFCD recalculation.",
}


def num(s):
    s = s.strip()
    for a, b in FRA.items():
        s = s.replace(a, " " + b)
    return sum(float(x) for x in s.split())


def ingredient(line):
    line = (
        line.replace("vegetable or sunflower oil", "vegetable oil")
        .replace("rapeseed or sunflower oil", "canola oil")
        .replace("1 stalk or 450g broccoli", "450g broccoli")
        .replace("1-2 tsp milk", "1 tsp milk")
        .replace("mincemeat (vegetarian, if necessary)", "vegetarian fruit mince")
        .replace(
            "jam of your choice (strawberry, raspberry or apricot work well)",
            "strawberry jam",
        )
    )
    line = (
        line.replace("vegetable oil", "vegetable oil")
        .replace("vegetable or olive oil", "vegetable oil")
        .replace("hot chicken or vegetable stock", "hot vegetable stock")
        .replace("small or medium egg", "medium egg")
        .replace("dark or milk chocolate chips", "dark chocolate chips")
        .replace("Cajun-style or fajita seasoning", "Cajun seasoning")
        .replace("2 large, ripe, firm tomatoes", "2 large ripe firm tomatoes")
        .replace("1 tbsp olive oil, plus 2 tsp", "25ml olive oil")
        .replace("2-3 tbsp curry paste", "30ml curry paste")
        .replace("4-6 vegetarian sausages", "4 vegetarian sausages")
        .replace("2-4 garlic cloves", "2 garlic cloves")
        .replace("1-3 tbsp plain flour", "15ml plain flour")
        .replace(
            "½ x 7g sachet fast-action dried yeast", "3.5g fast-action dried yeast"
        )
        .replace("3 courgettes (about 650g)", "650g courgettes")
        .replace("1 medium cauliflower (around 750g)", "750g cauliflower")
        .replace("225ml buttermilk or natural yogurt", "225ml buttermilk")
    )
    line = (
        line.replace("courgette", "zucchini")
        .replace("aubergine", "eggplant")
        .replace("red pepper", "red capsicum")
        .replace("yogurt", "yoghurt")
        .replace("rapeseed", "canola")
        .replace("coriander", "coriander")
    )
    if not re.match(r"^[\d½¼¾]", line) and any(
        x in line
        for x in [
            "to serve",
            "to decorate",
            "for dusting",
            "for drizzling",
            "fillings of your choice",
            "your choice of",
            "toppings of your choice",
        ]
    ):
        return None
    if line.startswith("milk , to glaze"):
        return entry(5, "ml", "milk", "light glaze")
    if line.startswith("drop of vanilla"):
        return entry(0.05, "tsp", "vanilla extract", "one drop")
    if line == "sea salt flakes":
        return entry(0.25, "tsp", "sea salt flakes", "optional seasoning")
    # Ignore dusting/garnishes in canonical list; explicit optional status retained in methods.
    orig = line
    q = None
    unit = None
    # Exact can net mass remains labelled; draining losses are explicitly visible.
    m = re.match(r"([\d.]+)g can (.*)", line)
    if m:
        q = float(m[1])
        unit = "g"
        name = m[2].split(",")[0].strip()
        prep = (
            "canned net weight; drain before use"
            if "drained" in line
            else "canned, including liquid"
        )
        return entry(q, unit, name, prep, "canned")
    m = re.match(r"([\d.]+)\s*x\s*([\d.]+)g\s*(.*)", line)
    if m:
        q = float(m[1]) * float(m[2])
        unit = "g"
        line = m[3]
    if q is None:
        m = re.match(
            r"((?:\d+\s*)?[½¼¾⅓⅔]|\d+(?:\.\d+)?)\s*(kg|g|ml|tsp|tbsp)\b\s*(.*)", line
        )
        if m:
            q = num(m[1])
            unit = m[2]
            line = m[3]
            if unit == "kg":
                q *= 1000
                unit = "g"
            if unit == "tbsp":
                q *= 15
                unit = "ml"  # UK tablespoon is 15 ml, not Australian 20 ml.
    if q is None:
        m = re.match(r"((?:\d+\s*)?[½¼¾⅓⅔]|\d+(?:\.\d+)?)\s*(.*)", line)
        if m:
            q = num(m[1])
            unit = "each"
            line = m[2]
    if q is None:
        if line.startswith("pinch"):
            q = 0.125
            unit = "tsp"
            line = re.sub(r"^pinch of ", "", line)
        elif "oil" in line and (
            "spray" in line
            or line.startswith("neutral oil")
            or line.startswith("vegetable oil")
            or "for proving" in line
            or "for air-frying" in line
        ):
            q = 5
            unit = "ml"
            line = "vegetable oil, approximate light coating; source gives no amount"
        elif line.startswith("knob of butter"):
            q = 10
            unit = "g"
            line = "butter, approximate small knob; source gives no mass"
        elif "handful" in line:
            q = 5 if "small" in line else 10
            unit = "g"
            line = (
                re.sub(r"^(small )?handful of ", "", line)
                + ", approximate herb handful"
            )
        elif line.startswith("a few thyme"):
            q = 3
            unit = "each"
            line = "thyme sprigs, leaves removed; approximate source handful"
        elif line.startswith("thumb-sized"):
            q = 20
            unit = "g"
            line = "fresh ginger, grated; approximate thumb-sized piece"
        elif line.startswith("dash"):
            q = 0.25
            unit = "tsp"
            line = "vegetarian Worcestershire sauce, small dash"
        else:
            raise ValueError("Unparsed ingredient: " + orig)
    # Explicit selected alternatives preserve original units and principal ingredient quantity.
    line = line.replace("natural yoghurt", "natural yoghurt")
    main, *tail = line.split(",")
    prep = ", ".join(tail).strip()
    name = main.strip()
    if name == "curry paste":
        name = "vegetarian curry paste"
    if name == "Jersey Royals":
        name = "baby potatoes"
    if name == "Maris Piper potatoes":
        name = "floury potatoes"
    if name == "zucchinis":
        name = "zucchini"
    if " or " in name:
        name = name.split(" or ")[0].strip()
        prep = ("selected first source option; " + prep).strip()
    name = re.sub(r"\s*\([^)]*\)", "", name).strip()
    name = re.sub(r"^(small |large |medium |ripe |whole |fresh )", "", name).strip()
    if name.startswith("block "):
        name = name[6:]
    if name.startswith("sachet "):
        name = name[7:]
    if name == "red capsicum":
        pass
    if "400" in name:
        raise ValueError(orig)
    form = (
        "frozen"
        if "frozen" in name
        else "dried"
        if any(
            x in name
            for x in [
                "flour",
                "sugar",
                "powder",
                "breadcrumbs",
                "granules",
                "spice",
                "cinnamon",
                "paprika",
                "cumin",
                "rice",
                "macaroni",
            ]
        )
        else "fresh"
    )
    return entry(q, unit, name, prep, form)


def entry(q, unit, name, prep, form="fresh"):
    name = name.replace("parmesan", "vegetarian hard cheese").replace(
        "double cream", "double cream (approximately 48% fat)"
    )
    # Keep UK double cream note; source nutrition depends on higher fat cream.
    aisle = "Pantry"
    if any(
        x in name.lower()
        for x in [
            "milk",
            "cream",
            "butter",
            "cheese",
            "feta",
            "halloumi",
            "yoghurt",
            "egg",
        ]
    ):
        aisle = "Dairy & eggs"
    if any(
        x in name.lower()
        for x in [
            "potato",
            "onion",
            "garlic clove",
            "spinach",
            "mushroom",
            "lemon",
            "lime",
            "apple",
            "banana",
            "cabbage",
            "carrot",
            "capsicum",
            "broccoli",
            "sprout",
            "herb",
            "parsley",
            "coriander",
            "mint",
            "thyme",
            "dill",
            "eggplant",
            "zucchini",
            "squash",
            "parsnip",
        ]
    ):
        aisle = "Fruit & vegetables"
    return {
        "name": name,
        "quantity": round(q, 3),
        "unit": unit,
        "preparation": prep,
        "form": form,
        "aisle": aisle,
    }


def make(s):
    key = s["slug"]
    cfg = R[key]
    cat, temp, cook, rest, title, steps = cfg
    sm = re.search(r"Serves (\d+)", s["timing"])
    serv = int(sm[1]) if sm else yields.get(key.replace("air-fryer-", ""))
    if not serv:
        raise ValueError("unresolved servings")
    ins = (
        [entry(*x) for x in overrides[key]]
        if key in overrides
        else [i for line in s["ingredients"] if (i := ingredient(line))]
    )
    prep = int(re.search(r"Prep: (\d+)", s["timing"])[1])
    preheat = 2 if key in ["air-fryer-halloumi", "air-fryer-muffins"] else 3
    text = " ".join(x["name"] for x in ins).lower()
    allergens = []
    patterns = {
        "milk": "butter|milk|cream|cheese|cheddar|mozzarella|camembert|ricotta|paneer|feta|halloumi|yoghurt|brioche|chocolate|pastry",
        "egg": r"\beggs?\b|brioche|mayonnaise",
        "wheat": "soy sauce|flour|wheat|pasta|bread|pastry|panko|macaroni|flatbread|brioche|wrap|sourdough|bagel|biscuit|vegetarian sausage",
        "gluten": "soy sauce|flour|wheat|pasta|bread|pastry|panko|macaroni|flatbread|brioche|wrap|sourdough|bagel|biscuit|soy sauce|oat|vegetarian sausage",
        "sesame": "sesame|tahini|hummus",
        "soy": "soy|miso|tofu|vegetarian sausage|chocolate",
        "peanut": "peanut",
        "tree-nut": "marzipan|almond|pecan|hazelnut|pesto",
        "sulphites": "fruit mince|mincemeat|raisins|sultanas|mixed peel",
    }
    for a, p in patterns.items():
        if re.search(
            p,
            text.replace("almond butter", "almond spread").replace(
                "peanut butter", "peanut spread"
            ),
        ):
            allergens.append(a)
    dietary = ["vegetarian"]
    if not any(a in allergens for a in ["milk", "egg"]) and not re.search(
        r"honey", text
    ):
        dietary.append("vegan")
    if "milk" not in allergens:
        dietary.append("dairy-free")
    # Gluten-free only for simple inherently GF records; sauces and spice mixes require label checks.
    if not any(a in allergens for a in ["wheat", "gluten"]) and not re.search(
        r"sauce|paste|bouillon|seasoning|sausage|stock", text
    ):
        dietary.append("gluten-free")
    n = s["nutrition"]
    nutrition = {
        k: round(float(re.search(r"[\d.]+", n[src])[0]), 1)
        for k, src in [
            ("protein", "protein"),
            ("calories", "kcal"),
            ("carbs", "carbs"),
            ("fat", "fat"),
            ("fibre", "fibre"),
        ]
    }
    y = Y.get(key)
    if y and y.get("nutrition"):
        for k, src in [
            ("protein", "proteinContent"),
            ("calories", "calories"),
            ("carbs", "carbohydrateContent"),
            ("fat", "fatContent"),
            ("fibre", "fiberContent"),
        ]:
            if src in y["nutrition"]:
                nutrition[k] = round(
                    float(re.search(r"[\d.]+", y["nutrition"][src])[0]), 1
                )
    ratio = nutrition["calories"] / (
        4 * nutrition["protein"]
        + 4 * nutrition["carbs"]
        + 9 * nutrition["fat"]
        + 2 * nutrition["fibre"]
        or 1
    )
    if not 0.7 < ratio < 1.3:
        raise ValueError("Calories inconsistent with macros: " + str(nutrition))
    nutrition.update(
        method="Publisher per-serving estimate, with source ingredient quantities retained. UK tablespoons converted to 15 ml; Australian tablespoons are 20 ml. Optional toppings excluded unless listed. Unspecified greasing and herb handfuls are approximate. Not a laboratory analysis; brands and produce sizes vary.",
        confidence="source-estimate",
        reference=s["url"],
    )
    source = [
        {
            "title": "Good Food Middle East: " + s["title"],
            "url": s["url"],
            "verifiedAt": "2026-10-11",
        }
    ]
    if y:
        source.append(
            {
                "title": "Good Food: serving and nutrition cross-check",
                "url": y["url"],
                "verifiedAt": "2026-10-11",
            }
        )
    safety = [
        "Use only accessories approved for your air fryer; leave room for airflow. Never preheat with loose baking paper.",
        "Cook in batches when food cannot fit without crowding; extra batches increase total time.",
        "Check packaged ingredients for your allergens; substitutions change nutrition and allergen information.",
    ]
    if "egg" in allergens:
        safety.append(
            "Use intact refrigerated eggs. Cook egg mixtures until completely set; do not taste raw batter."
        )
    safety.append(
        "Refrigerate leftovers promptly within 2 hours in shallow containers at 5°C or colder. Reheat cooked leftovers until steaming hot throughout."
    )
    equipment = ["Basket air fryer"]
    if re.search("tin|ramekin|dish|pan|casserole", " ".join(steps)):
        equipment.append("Air-fryer-safe tin or dish that fits with airflow space")
    if re.search("saucepan|frying pan|boil|pan for", " ".join(steps).lower()):
        equipment.append("Stovetop saucepan or frying pan")
    portion = f"One of {serv} equal portions of the full recipe"
    if key == "air-fryer-halloumi":
        portion = "One slice (one-sixth of the recipe); a small side, not a main meal"
    if key == "air-fryer-arancini":
        prep += 26
        portion = "Three croquettes (one-quarter of the recipe)"
    if key == "air-fryer-falafel":
        portion = "One small patty; a snack portion, not a full meal"
    return {
        "id": key,
        "slug": key,
        "title": title,
        "description": f"{title}, prepared in a basket air fryer with metric ingredients and an attributed per-portion nutrition estimate.",
        "category": cat,
        "tags": [cat, "air fryer"]
        + (["high-protein"] if nutrition["protein"] >= 25 else []),
        "sources": source,
        "prepMinutes": prep,
        "cookMinutes": cook,
        "totalMinutes": prep + cook + rest + preheat,
        "temperatureC": temp,
        "servings": serv,
        "portion": portion,
        "ingredients": ins,
        "steps": steps,
        "preheat": True,
        "preheatMinutes": preheat,
        "turn": "Follow the turning or shaking point in the steps; rotate baking dishes if browning unevenly.",
        "safety": safety,
        "internalTempC": None,
        "nutrition": nutrition,
        "allergens": allergens,
        "dietary": dietary,
        "substitutions": [
            "For ingredient changes, recheck allergens and nutrition. Use vegetarian-labelled cheese, stock and sauces for vegetarian dishes."
        ],
        "oilFree": not bool(re.search("oil|butter|pastry|brioche|cream", text)),
        "storage": "Best freshly cooked. Refrigerate promptly at 5°C or colder; no recipe-specific shelf life has been verified. Reheat until steaming hot throughout.",
        "equipment": equipment,
        "difficulty": "Moderate" if len(steps) > 4 or rest >= 60 else "Easy",
        "image": {
            "src": f"/images/{cat}.webp",
            "alt": f"Illustration representing the {cat.replace('-', ' ')} recipe collection; not a photograph of this dish",
            "credit": "AirFuel Kitchen",
            "licence": "AI-generated illustration; not a photograph of the tested recipe",
        },
    }


out = []
errors = []
for s in S:
    if s["slug"] in skips:
        continue
    if s["slug"] not in R:
        errors.append({"slug": s["slug"], "reason": "No original editorial method"})
        continue
    try:
        out.append(make(s))
    except Exception as e:
        errors.append({"slug": s["slug"], "reason": str(e)})
# Canonical writes happen only after the complete build succeeds in build_adapted.py.
(BASE / "editorial-rejections.json").write_text(
    json.dumps([{"slug": k, "reason": v} for k, v in skips.items()] + errors, indent=2)
)
print("BUILT", len(out))
print(json.dumps(errors, indent=2))
