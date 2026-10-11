import urllib.request, re, json, time
from pathlib import Path

records = json.loads(Path("/tmp/plant-sources.json").read_text())
out = {}
for r in records:
    u = "https://www.bbcgoodfood.com/recipes/" + r["slug"]
    try:
        with urllib.request.urlopen(u, timeout=30) as res:
            s = res.read().decode()
            final = res.url
        for j in re.findall(
            r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', s, re.S
        ):
            d = json.loads(j)
            if d.get("@type") == "Recipe":
                out[r["slug"]] = {
                    "url": final,
                    "yield": d.get("recipeYield"),
                    "nutrition": d.get("nutrition"),
                    "note": list(
                        set(
                            re.findall(
                                r'Per (?:serving|biscuit|cookie|slice|doughnut)[^"<]{0,80}',
                                s,
                            )
                        )
                    ),
                    "verifiedAt": "2026-10-11",
                }
        print(
            r["slug"],
            out.get(r["slug"], {}).get("yield"),
            out.get(r["slug"], {}).get("note"),
            flush=True,
        )
    except Exception as e:
        print(type(e).__name__, str(e), flush=True)
    Path("research/plant/yields.json").write_text(json.dumps(out, indent=2))
    time.sleep(0.4)
