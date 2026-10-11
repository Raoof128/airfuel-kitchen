import urllib.request, urllib.robotparser, re, json, time, hashlib
from pathlib import Path

slugs = """air-fryer-scrambled-eggs-on-toast
air-fryer-zucchini-fries
air-fryer-zucchini-double-cheese-pizza
air-fryer-pizza-toast
best-ever-philips-airfryer-new-york-cheesecake
air-fryer-onions
puff-pastry-pizza-in-air-fryer
air-fryer-cheese-quiche
air-fryer-breakfast-potatoes
sage-onion-stuffing-balls-in-the-air-fryer
cauliflower-cheese-in-air-fryer
air-fryer-cauliflower-bites
air-fryer-potato-gnocchi
air-fryer-cheese-and-bean-toastie
air-fryer-cabbage
air-fryer-green-bean-casserole
air-fryer-spaghetti-squash-casserole
air-fryer-spaghetti-squash-seeds
air-fryer-spaghetti-squash
air-fryer-acorn-squash
air-fryer-cheese-swirls
air-fryer-frittata
air-fryer-carrot-cake
air-fryer-pancakes
air-fryer-toast
air-fryer-garlic-mushrooms
air-fryer-egg-cups
best-ever-airfryer-vegan-lentil-burgers
air-fryer-grilled-cheese
air-fryer-roasted-beets
air-fryer-crispy-tofu
air-fryer-oatmeal-cookies
how-to-cook-asparagus-in-air-fryer
air-fryer-frozen-green-beans
air-fryer-frozen-corn-on-the-cob
air-fryer-cream-cheese-bagels
air-fryer-butternut-squash
air-fryer-pizza-fries
whole-30-life-changing-airfryer-veggie-pakoras""".splitlines()
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
    Path("/tmp/plant-rt.json").write_text(json.dumps(out, indent=2))
    Path("research/plant/rt-evidence.json").write_text(
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
    Path("research/plant/rt-rejected.json").write_text(json.dumps(bad, indent=2))
    time.sleep(1)
