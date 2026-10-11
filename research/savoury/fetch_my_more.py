"""Read individually discovered public recipe metadata; retain for temporary method review."""
import json,re,subprocess,time,html,hashlib
from pathlib import Path
ROOT=Path(__file__).parent
selected=['coconut-shrimp-1','tasty-chicken-patties','tuna-patties','bacon-wrapped-shrimp','chicken-with-bacon','prosciutto-wrapped-asparagus','bacon-brussels-sprouts','spring-rolls','chicken-spring-rolls','beef-vegetable-skewers']
allowed=set((ROOT/'my-recipes.txt').read_text().splitlines())
rows=[];dest=ROOT/'my-review.json'
if dest.exists():rows=json.loads(dest.read_text())
for slug in selected:
 u='https://sharkninja.my/blogs/ninja-kitchen-recipes/'+slug
 if u not in allowed or any(x['slug']==slug for x in rows):continue
 try:
  r=subprocess.run(['curl','-fsSL','--connect-timeout','8','--max-time','25',u],capture_output=True,text=True)
  if r.returncode:raise ValueError(r.stderr[-200:])
  found=None
  for script in re.findall(r'<script[^>]*type=[\"\']application/ld\+json[\"\'][^>]*>(.*?)</script>',r.stdout,re.S):
   try:stack=[json.loads(script)]
   except ValueError:continue
   while stack:
    v=stack.pop()
    if isinstance(v,list):stack.extend(v)
    elif isinstance(v,dict):
     if v.get('@type')=='Recipe':found=v;break
     stack.extend(x for x in v.values() if isinstance(x,(dict,list)))
   if found:break
  if not found:raise ValueError('No recipe metadata')
  row={k:found.get(k) for k in ['name','recipeYield','recipeIngredient','prepTime','cookTime','nutrition']}
  row.update(url=u,slug=slug,verifiedAt='2026-10-11',httpStatus=200,sha256=hashlib.sha256(r.stdout.encode()).hexdigest())
  rows.append(row);dest.write_text(json.dumps(rows,indent=2)+'\n');print(slug,flush=True)
 except Exception as e:print('FAILED',slug,e,flush=True)
 time.sleep(.5)
