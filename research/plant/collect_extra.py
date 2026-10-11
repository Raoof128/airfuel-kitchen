import urllib.request, re, json, time, hashlib, urllib.robotparser
from pathlib import Path

urls = [
    "https://www.bbcgoodfood.com/recipes/" + s
    for s in [
        "air-fryer-cauliflower-popcorn-with-soured-cream-herb-dressing",
        "air-fryer-clementine-chilli-halloumi-skewers",
        "air-fryer-spring-rolls",
        "air-fryer-sweetcorn-fritters",
        "green-goddess-bowl-with-crispy-sesame-tofu",
    ]
] + [
    "https://www.loveandlemons.com/" + s + "/"
    for s in ["air-fryer-onion-rings", "air-fryer-fried-pickles", "air-fryer-eggplant"]
]
out = []
for u in urls:
    try:
        rp = urllib.robotparser.RobotFileParser(
            "/".join(u.split("/")[:3]) + "/robots.txt"
        )
        rp.read()
        if not rp.can_fetch("ChatGPT-User", u):
            raise ValueError("robots disallows")
        with urllib.request.urlopen(u, timeout=35) as res:
            raw = res.read()
            final = res.url
        s = raw.decode()
        found = None
        for j in re.findall(
            r"<script[^>]*type=[\"\']?application/ld\+json[\"\']?[^>]*>(.*?)</script>",
            s,
            re.S,
        ):
            stack = [json.loads(j)]
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
            raise ValueError("no recipe")
        found["sourceUrl"] = final
        found["slug"] = u.rstrip("/").split("/")[-1]
        found["sha256"] = hashlib.sha256(raw).hexdigest()
        out.append(found)
        print(len(out), found["slug"], flush=True)
    except Exception as e:
        print(u, str(e), flush=True)
    Path("/tmp/plant-extra.json").write_text(json.dumps(out, indent=2))
    time.sleep(1)
