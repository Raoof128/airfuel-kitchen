import json,re,time,pathlib,urllib.request,urllib.robotparser
ROOT=pathlib.Path(__file__).parent
wanted='''air-fryer-steak-fajitas air-fryer-chicken-fajitas air-fryer-ham-steak air-fryer-chicken-drumsticks wagamama-air-fryer-chicken-katsu air-fryer-chicken-kiev-supper air-fryer-corned-beef-hash lemon-rosemary-chicken-potatoes-in-the-air-fryer air-fryer-steak-bites-and-potatoes air-fryer-pork-steak air-fryer-meatball-potato-traybake air-fryer-boneless-skinless-chicken-thighs air-fryer-lamb-salad air-fryer-leftover-turkey-pot-pie bottom-of-the-fridge-leftover-turkey-muffins-in-the-air-fryer best-ever-leftover-turkey-burgers-in-the-air-fryer thai-fish-cakes-air-fryer-style homemade-air-fryer-fishcakes air-fryer-filet-o-fish homemade-fish-fingers-in-air-fryer air-fryer-fish-nuggets cod-in-air-fryer air-fryer-whole-fish air-fryer-tuna-steak air-fryer-bacon-wrapped-scallops air-fryer-chicken-burrito-bowl air-fryer-lamb-steaks chicken-pot-pie-in-air-fryer meat-pie-in-air-fryer air-fryer-pork-apple-burgers air-fryer-shredded-chicken air-fryer-roasted-chicken-with-sage-onion-stuffing air-fryer-turkey-meatballs air-fryer-turkey-dinner-for-two air-fryer-turkey-wings air-fryer-turkey-thighs air-fryer-turkey-legs air-fryer-turkey-twizzlers air-fryer-boneless-turkey-breast air-fryer-turkey-burgers air-fryer-corned-beef-pasty kfc-unbreaded-chicken-tenders-in-air-fryer breaded-air-fryer-pork-chops air-fryer-pork-ribs air-fryer-shrimp-tacos air-fryer-balsamic-chicken-vegetables air-fryer-cajun-shrimp air-fryer-lamb-kofta-kebabs air-fryer-shrimp-fajitas air-fryer-meatloaf air-fryer-chicken-cordon-bleu air-fryer-pork-loin flourless-truly-crispy-calamari-rings-in-the-air-fryer air-fryer-sweet-sour-chicken-balls air-fryer-chicken-thighs-potatoes air-fryer-tandoori-chicken-kebabs nandos-peri-peri-chicken-bowl-in-the-air-fryer air-fryer-filipino-pork-barbecue air-fryer-tuna-melt air-fryer-filipino-chicken-barbecue air-fryer-chicken-taquitos air-fryer-shrimp-scampi air-fryer-greek-chicken-traybake air-fryer-rack-of-lamb air-fryer-lamb-ribs'''.split()
def fetch(u):
 with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'AirFuelResearch/1.0 (personal recipe research)'}),timeout=30) as r:return r.read().decode()
robots=urllib.robotparser.RobotFileParser();robots.parse(fetch('https://recipethis.com/robots.txt').splitlines())
existing=set((ROOT/'discovered-recipethis.txt').read_text().splitlines());out=[];reject=[]
for slug in wanted:
 u='https://recipethis.com/'+slug+'/'
 if u not in existing or not robots.can_fetch('AirFuelResearch',u):continue
 try:
  s=fetch(u)
  rs=[json.loads(x) for x in re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',s)]
  rs=[r for r in rs if isinstance(r,dict) and r.get('@type')=='Recipe']
  if len(rs)!=1:raise ValueError('missing unique recipe')
  r=rs[0]
  if not r.get('nutrition') or not r.get('recipeInstructions'):raise ValueError('no nutrition or method')
  r={k:v for k,v in r.items() if k in ['name','recipeIngredient','recipeYield','prepTime','cookTime','totalTime','nutrition']};r.update(url=u,verifiedAt='2026-10-11',httpStatus=200)
  out.append(r);(ROOT/'more-source-facts-review.json').write_text(json.dumps(out,indent=2));print('OK',slug,flush=True)
 except Exception as e:reject.append({'url':u,'reason':str(e)});print('FAIL',slug,str(e),flush=True)
 time.sleep(1)
(ROOT/'more-rejected.json').write_text(json.dumps(reject,indent=2))
