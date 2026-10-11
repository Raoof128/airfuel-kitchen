import json, re, html
from pathlib import Path
from adapted import D, FOOD, AFCD
import expanded_afcd
import final_afcd
from build import make, entry, out as bbc_out

source = {
    r["slug"]: r
    for file in [
        "rt-facts.json",
        "extra-facts.json",
        "manual-facts.json",
        "expansion-facts.json",
        "indian-facts.json",
    ]
    for r in json.loads((Path("research/plant") / file).read_text())
}
for value in source.values():
    if "sourceUrl" not in value:
        value["sourceUrl"] = value["url"]
import build

for b in build.S:
    source[b["slug"]] = {**b, "sourceUrl": b["url"], "name": b["title"]}
labels = {
    item["id"]: item
    for item in json.loads(Path("research/plant/product-profiles.json").read_text())
}
AFCD.update(labels)
evidence = []
out = []
for d in D:
    s = source[d["slug"]]
    missing_fibre = False
    product_sources = []
    sums = {k: 0 for k in ["protein", "calories", "carbs", "fat", "fibre"]}
    ins = []
    mapping = []
    for key, g in d["foods"]:
        name, fid, form = FOOD[key]
        f = AFCD[fid]
        if fid in labels:
            product_sources.append(f)
        if f["fibre"] is None:
            missing_fibre = True
        for k in sums:
            sums[k] += (
                g / 100 * (f["energyKj"] / 4.184 if k == "calories" else (f[k] or 0))
            )
        prep = "edible weight; " + (
            "shelled egg weight, approximately 50 g per large egg"
            if key == "egg"
            else "weigh before cooking"
            if form == "raw"
            else form + " input"
        )
        ins.append(entry(g, "g", name, prep, form))
        mapping.append(
            {
                "ingredient": name,
                "grams": g,
                "afcdId": None if fid in labels else fid,
                "referenceId": fid,
                "referenceName": f["name"],
            }
        )
    n = {k: round(v / d["servings"]) for k, v in sums.items()}
    n["calories"] = 5 * round(n["calories"] / 5)
    # Reuse the shared ingredient/diet and safety assembly with explicit adapted facts.
    fake = {
        "slug": d["slug"],
        "title": s["name"],
        "url": s["sourceUrl"],
        "timing": f"Prep: {d['prepMinutes']} mins Serves {d['servings']}",
        "ingredients": ["1 egg"],
        "nutrition": {
            "protein": str(n["protein"]),
            "kcal": str(n["calories"]),
            "carbs": str(n["carbs"]),
            "fat": str(n["fat"]),
            "fibre": str(n["fibre"]),
        },
    }
    import build

    build.R[d["slug"]] = (
        d["category"],
        d["temperatureC"],
        d["cookMinutes"],
        d["rest"],
        d["title"],
        d["steps"],
    )
    build.overrides[d["slug"]] = [
        (i["quantity"], i["unit"], i["name"], i["preparation"], i["form"]) for i in ins
    ]
    r = make(fake)
    r["ingredients"] = ins
    r["sources"] = [
        {
            "title": (
                "Recipe This: "
                if "recipethis" in s["sourceUrl"]
                else "Love & Lemons: "
                if "loveandlemons" in s["sourceUrl"]
                else s.get("publisher", "Good Food") + ": "
            )
            + html.unescape(s["name"]),
            "url": s["sourceUrl"],
            "verifiedAt": "2026-10-11",
        },
        {
            "title": "FSANZ Australian Food Composition Database Release 3",
            "url": "https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/data-files",
            "verifiedAt": "2026-10-11",
        },
    ]
    r["nutrition"] = {
        **n,
        "method": "Calculated from FSANZ AFCD Release 3 per100g edible-input profiles, summed and divided by stated servings. All listed coating/oil counted; evaporation changes serving weight but not total macros. Ingredient IDs and gram weights are in the research register. No cooking-retention adjustment. "
        + d["notes"],
        "confidence": "estimated",
        "reference": "https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/data-files",
    }
    if product_sources:
        r["nutrition"]["method"] = r["nutrition"]["method"].replace(
            "Calculated from FSANZ AFCD Release 3 per100g edible-input profiles",
            "Calculated from FSANZ AFCD Release 3 plus named manufacturer/retailer per100g product labels",
        )
        for product in product_sources:
            r["sources"].append(
                {
                    "title": product["name"] + " nutrition label",
                    "url": product["url"],
                    "verifiedAt": "2026-10-11",
                }
            )
        if missing_fibre:
            r["nutrition"]["fibre"] = None
            r["nutrition"]["method"] += (
                " Fibre is unknown because the gnocchi label does not report it."
            )
    r["description"] = d.get(
        "description",
        d["title"]
        + ". An original metric adaptation with nutrition calculated from Australian food composition data.",
    )
    r["portion"] = (
        f"One of {d['servings']} equal portions; quantities refer to the complete recipe"
    )
    if d["slug"] == "air-fryer-frozen-corn-on-the-cob":
        r["ingredients"][0]["name"] = "frozen sweetcorn cob portions"
        r["ingredients"][0]["preparation"] = (
            "450 g edible kernels, excluding cobs; approximately six mini-cob portions"
        )
    if d["slug"] in [
        "air-fryer-egg-cups",
        "air-fryer-frittata",
        "air-fryer-tortilla-de-patatas",
        "air-fryer-cheesecake",
    ]:
        r["internalTempC"] = 71
    if missing_fibre:
        n["fibre"] = None
        sums["fibre"] = None
    out.append(r)
    evidence.append(
        {
            "slug": r["slug"],
            "techniqueSource": s["sourceUrl"],
            "adaptation": d["notes"],
            "servings": d["servings"],
            "ingredientMatches": mapping,
            "totalsBeforeDivision": sums,
            "roundedPerServing": n,
        }
    )
Path("research/plant/afcd-calculations.json").write_text(
    json.dumps(evidence, indent=2) + "\n"
)
from extra_bbc import records

extra = records()
from expanded_publisher import records as publisher_records

extra += publisher_records()
from indian_publisher import records as indian_records

extra += indian_records()
from final_publisher import records as final_records

extra += final_records()
from polish import polish

Path("src/data/recipes-plant.json").write_text(
    json.dumps(polish(bbc_out + out + extra), indent=2, ensure_ascii=False) + "\n"
)
print(
    "BBC",
    len(bbc_out),
    "AFCD adaptations",
    len(out),
    "TOTAL",
    len(bbc_out + out + extra),
)
