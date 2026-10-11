import urllib.request, urllib.robotparser, re, json, time, hashlib
from pathlib import Path

slugs = """air-fryer-halloumi-greek-salad
air-fryer-halloumi-burgers
air-fryer-quesadilla
air-fryer-tortilla-de-patatas
air-fryer-flour-tortilla-chips""".splitlines()
rp = urllib.robotparser.RobotFileParser("https://recipethis.com/robots.txt")
rp.read()
out = []
bad = []
for slug in slugs:
    u = "https://recipethis.com/" + slug + "/"
    try:
        if not rp.can_fetch("ChatGPT-User", u):
            raise ValueError("robots prohibited")
        with urllib.request.urlopen(u, timeout=35) as res:
            raw = res.read()
            final = res.url
        s = raw.decode()
        found = None
        for j in re.findall(
            r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', s, re.S
        ):
            d = json.loads(j)
            stack = [d]
            while stack:
                v = stack.pop()
                if isinstance(v, list):
                    stack.extend(v)
                elif isinstance(v, dict):
                    if v.get("@type") == "Recipe":
                        found = v
                        break
                    stack.extend(x for x in v.values() if isinstance(x, (dict, list)))
            if found:
                break
        if not found:
            raise ValueError("no recipe metadata")
        found["sourceUrl"] = final
        found["slug"] = slug
        found["sha256"] = hashlib.sha256(raw).hexdigest()
        out.append(found)
        print(len(out), slug, found.get("recipeYield"), flush=True)
    except Exception as e:
        bad.append({"url": u, "reason": str(e)})
        print("REJECT", slug, str(e), flush=True)
    Path("/tmp/plant-rt-more.json").write_text(json.dumps(out, indent=2))
    Path("research/plant/rt-more-evidence.json").write_text(
        json.dumps(
            [
                {
                    k: r.get(k)
                    for k in ["sourceUrl", "slug", "sha256", "recipeYield", "nutrition"]
                }
                for r in out
            ],
            indent=2,
        )
    )
    Path("research/plant/rt-more-rejected.json").write_text(json.dumps(bad, indent=2))
    time.sleep(1)
