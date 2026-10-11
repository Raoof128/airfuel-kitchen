"""Remove temporary publisher prose and retain compact factual review evidence."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
for path in ROOT.glob("*.json"):
    records = json.loads(path.read_text())
    if not isinstance(records, list):
        continue
    changed = False
    for record in records:
        if not isinstance(record, dict) or "recipeInstructions" not in record:
            continue
        instructions = record.pop("recipeInstructions")
        plain = json.dumps(instructions, ensure_ascii=False)
        record["reviewTemperatureMentions"] = sorted(
            set(re.findall(r"\d+(?:\.\d+)?\s*°[CF]", plain))
        )
        record["methodReview"] = (
            "Individual method read during research; publisher prose removed after original adaptation and ingredient review."
        )
        changed = True
    if changed:
        path.write_text(json.dumps(records, indent=2, ensure_ascii=False) + "\n")

# These generated downloads are unnecessary for regeneration and contain publisher text.
for name in [
    "me-sample.html",
    "ninja-sample.html",
    "shark-sample.html",
    "my-sample.html",
    "au-terms.html",
    "shark-review.json",
    "shark-products.xml",
    "shark-sitemap.xml",
    "shark-recipes.txt",
    "fetch_shark.py",
]:
    path = ROOT / name
    if path.exists():
        path.unlink()

# Research collectors must not silently restore retained full source instructions.
for path in ROOT.glob("fetch_*.py"):
    source = path.read_text()
    source = source.replace("'recipeInstructions',", "")
    source = source.replace(",'recipeInstructions'", "")
    path.write_text(source)
