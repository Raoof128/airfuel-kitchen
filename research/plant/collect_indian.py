"""Read public recipe metadata on an allowed site, one page per second."""

import hashlib
import json
import re
import subprocess
import time
from pathlib import Path

BASE = Path("research/plant")
ORIGIN = "https://www.indianveggiedelight.com"
SLUGS = [
    "paneer-tikka",
    "malai-broccoli",
    "sabudana-vada-recipe",
    "bharwa-bhindi-stuffed-okra",
    "masala-peanuts",
    "tandoori-paneer-naan-pizza",
    "aloo-tikki",
    "beetroot-tikki",
    "vegetable-rice-cutlet",
    "maddur-vada",
    "air-fryer-aloo-gobi",
    "gobi-manchurian",
    "air-fryer-banana-chips",
    "air-fryer-eggplant",
    "air-fryer-avocado-fries",
]
rows = []
for slug in SLUGS:
    url = ORIGIN + "/" + slug + "/"
    try:
        raw = subprocess.check_output(
            ["curl", "--max-time", "25", "-fsSL", url], timeout=30
        )
        candidates = re.findall(
            r"<script[^>]*type=[\"\']?application/ld\+json[\"\']?[^>]*>(.*?)</script>",
            raw.decode(),
            re.S,
        )
        recipe = None
        for candidate in candidates:
            stack = [json.loads(candidate)]
            while stack:
                value = stack.pop()
                if isinstance(value, list):
                    stack.extend(value)
                elif isinstance(value, dict):
                    if value.get("@type") == "Recipe":
                        recipe = value
                        break
                    stack.extend(
                        x for x in value.values() if isinstance(x, (dict, list))
                    )
            if recipe:
                break
        if not recipe:
            raise ValueError("No Recipe metadata")
        item = {
            k: recipe.get(k)
            for k in [
                "name",
                "recipeYield",
                "recipeIngredient",
                "recipeInstructions",
                "nutrition",
                "prepTime",
                "cookTime",
                "totalTime",
            ]
        }
        item.update(
            slug=slug,
            sourceUrl=url,
            publisher="Indian Veggie Delight",
            verifiedAt="2026-10-11",
            sha256=hashlib.sha256(raw).hexdigest(),
        )
        rows.append(item)
        Path("/tmp/plant-indian.json").write_text(json.dumps(rows, indent=2))
        BASE.joinpath("indian-facts.json").write_text(
            json.dumps(
                [
                    {k: v for k, v in x.items() if k != "recipeInstructions"}
                    for x in rows
                ],
                indent=2,
            )
            + "\n"
        )
        print(slug, "OK", flush=True)
    except Exception as exc:
        print(slug, str(exc), flush=True)
    time.sleep(1)
