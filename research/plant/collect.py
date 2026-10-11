"""Rate-limited source verification. Only explicit BBC Good Food ME public URLs.
Robots checked before requests. Source text held in /tmp for editorial review;
committed evidence records status and factual recipe metadata only.
"""

import json, re, time, html, urllib.request, urllib.robotparser, hashlib
from pathlib import Path

ROOT = Path(__file__).parent
BASE = "https://www.bbcgoodfoodme.com"
rp = urllib.robotparser.RobotFileParser(BASE + "/robots.txt")
rp.read()
urls = json.loads((ROOT / "discovered.json").read_text())
exclude = "chicken|turkey|pork|beef|steak|fish|prawn|salmon|shrimp|bacon|lamb|keema|chorizo|sausage|scotch|gyros|roast-dinner|stuffing|ham-toastie"
urls = [u for u in urls if not re.search(exclude, u) or "veggie-sausage" in u]


def clean(x):
    return html.unescape(re.sub("<[^>]+>", " ", x)).strip()


def ls(x):
    return [
        re.sub(r"\s+", " ", clean(v))
        for v in re.findall(r"<li\b[^>]*>(.*?)</li>", x, re.S)
    ]


records = []
rejected = []
for u in urls:
    try:
        if not rp.can_fetch("AirFuelResearch", u):
            raise ValueError("robots disallow")
        with urllib.request.urlopen(u, timeout=40) as r:
            raw = r.read()
            status = r.status
        s = raw.decode()
        slug = u.rstrip("/").split("/")[-1]
        ingr = re.search(r'<div class="ingredient-list">(.*?)</div>', s, re.S)
        method = re.search(r'<div class="method-list">(.*?)</div>', s, re.S)
        nut = re.search(r'<ul class="nutrition-list[^>]*>(.*?)</ul>', s, re.S)
        prep = re.search(r'<div class="preparation">(.*?)</div>', s, re.S)
        if not all([ingr, method, nut, prep]):
            raise ValueError("missing source section")
        nutrition = dict(
            re.findall(
                r'<span>(.*?)</span>\s*<span class="number"[^>]*>(.*?)</span>',
                nut[1],
                re.S,
            )
        )
        rec = {
            "slug": slug,
            "url": u,
            "status": status,
            "verifiedAt": "2026-10-11",
            "sha256": hashlib.sha256(raw).hexdigest(),
            "title": clean(re.search(r"<h1[^>]*>(.*?)</h1>", s, re.S)[1]),
            "ingredients": ls(ingr[1]),
            "method": ls(method[1]),
            "nutrition": nutrition,
            "timing": re.sub(r"\s+", " ", clean(prep[1])),
        }
        records.append(rec)
        Path("/tmp/plant-sources.json").write_text(json.dumps(records, indent=2))
        print(len(records), slug, flush=True)
    except Exception as e:
        rejected.append({"url": u, "reason": str(e)})
        print("REJECT", u, str(e), flush=True)
    time.sleep(1)
(ROOT / "verified-sources.json").write_text(
    json.dumps(
        [
            {k: v for k, v in r.items() if k not in ["method", "ingredients"]}
            for r in records
        ],
        indent=2,
    )
)
(ROOT / "rejected.json").write_text(json.dumps(rejected, indent=2))
