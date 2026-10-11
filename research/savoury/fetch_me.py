import urllib.request,json,re,pathlib,time,html
R=pathlib.Path(__file__).parent
existing={x['url'].rstrip('/').split('/')[-1] for x in json.loads((R/'source-facts-review.json').read_text())}
urls=json.loads((R.parent/'plant/discovered.json').read_text())
def clean(s):return html.unescape(re.sub('<[^>]+>',' ',s)).strip()
out=[];reject=[]
for u in urls:
 slug=u.rstrip('/').split('/')[-1]
 if slug in existing or not re.search('chicken|turkey|pork|beef|meat|fish|prawn|shrimp|salmon|chorizo|gyros|keema|burger|scotch|roast-dinner|buffalo-wings|sausage',slug):continue
 if any(s in slug for s in ['veggie','cauliflower']):continue
 try:
  with urllib.request.urlopen(u,timeout=30) as response:s=response.read().decode()
  title=clean(re.search('<h1[^>]*>(.*?)</h1>',s,re.S).group(1))
  ing=re.search('<div class="ingredient-list">(.*?)</div>',s,re.S).group(1)
  steps=re.search('<div class="method-list">(.*?)</div>',s,re.S).group(1)
  ing=[clean(v) for v in re.findall('<li[^>]*>(.*?)</li>',ing,re.S)]
  steps=[{'text':clean(v)} for v in re.findall('<li[^>]*>(.*?)</li>',steps,re.S)]
  nut=re.search('<ul class="nutrition-list clearfix"[^>]*>(.*?)</ul>',s,re.S).group(1)
  nut=dict(re.findall('<span>(.*?)</span>.*?<span class="number"[^>]*>(.*?)</span>',nut,re.S))
  nk={'kcal':'calories','fat':'fatContent','carbs':'carbohydrateContent','protein':'proteinContent','fibre':'fiberContent'}
  n={nk[k]:v for k,v in nut.items() if k in nk}
  serv=re.search('Serves\s+([^<]+)',s)
  r=dict(name=title,recipeIngredient=ing,recipeInstructions=steps,recipeYield=serv.group(1).strip() if serv else None,nutrition=n,url=u,verifiedAt='2026-10-11',httpStatus=200)
  out.append(r);(R/'me-source-facts-review.json').write_text(json.dumps(out,indent=2));print('OK',slug,flush=True)
 except Exception as e:reject.append({'url':u,'reason':str(e)});print('FAIL',slug,str(e),flush=True)
 time.sleep(.8)
(R/'me-rejected.json').write_text(json.dumps(reject,indent=2))
