"""Fetch discovered public recipe facts with robots enforcement and resumable evidence.
Instructions are retained temporarily for editorial review, not shipped as app prose.
"""
import hashlib, json, re, time, urllib.request, urllib.robotparser
from pathlib import Path
BASE=Path(__file__).parent
DEST=BASE/'facts.json'
rows=json.loads(DEST.read_text()) if DEST.exists() else []
seen={r['slug'] for r in rows}
bad=[]
rp=urllib.robotparser.RobotFileParser('https://recipethis.com/robots.txt');rp.read()
for slug in (BASE/'selected-slugs.txt').read_text().splitlines():
    if slug in seen:continue
    url='https://recipethis.com/'+slug+'/'
    try:
        if not rp.can_fetch('ChatGPT-User',url):raise ValueError('robots disallows access')
        with urllib.request.urlopen(url,timeout=25) as response:
            raw=response.read();status=response.status;final=response.url
        found=None
        for script in re.findall(r'<script[^>]*type=[\"\']application/ld\+json[\"\'][^>]*>(.*?)</script>',raw.decode(),re.S):
            stack=[json.loads(script)]
            while stack:
                v=stack.pop()
                if isinstance(v,list):stack.extend(v)
                elif isinstance(v,dict):
                    if v.get('@type')=='Recipe':found=v;break
                    stack.extend(x for x in v.values() if isinstance(x,(dict,list)))
            if found:break
        if not found:raise ValueError('No public Recipe metadata')
        record={k:found.get(k) for k in ['name','recipeYield','prepTime','cookTime','totalTime','recipeIngredient','recipeInstructions','nutrition']}
        record.update(slug=slug,url=final,httpStatus=status,verifiedAt='2026-10-11',sha256=hashlib.sha256(raw).hexdigest())
        rows.append(record);DEST.write_text(json.dumps(rows,indent=2)+'\n');print(len(rows),slug,flush=True)
    except Exception as exc:
        bad.append(dict(url=url,reason=str(exc)));(BASE/'rejected.json').write_text(json.dumps(bad,indent=2)+'\n');print('REJECT',slug,str(exc),flush=True)
    time.sleep(1)
