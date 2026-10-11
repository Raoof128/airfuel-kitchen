import urllib.request, re, json, time
from pathlib import Path

records = json.loads(Path("/tmp/plant-sources.json").read_text())
out = {}
for r in records:
    if "Serves" in r["timing"]:
        continue
    u = "https://www.bbcgoodfood.com/recipes/" + r["slug"]
    try:
        with urllib.request.urlopen(u, timeout=30) as res:
            s = res.read().decode()
        for j in re.findall(
            r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', s, re.S
        ):
            d = json.loads(j)
            if d.get("@type") == "Recipe":
                out[r["slug"]] = {
                    "url": u,
                    "yield": d.get("recipeYield"),
                    "nutrition": d.get("nutrition"),
                    "verifiedAt": "2026-10-11",
                }
        print(r["slug"], out.get(r["slug"], {}).get("yield"), flush=True)
    except Exception as e:
        print(type(e).__name__, str(e), flush=True)
    Path("research/plant/yields.json").write_text(json.dumps(out, indent=2))
    time.sleep(1)
