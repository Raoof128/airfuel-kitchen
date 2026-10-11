"""Fetch public recipe facts after checking robots; no photos or full HTML retained."""
import json,re,time,urllib.request,urllib.robotparser, pathlib,html
ROOT=pathlib.Path(__file__).parent
BASE='https://www.bbcgoodfood.com'
def fetch(url):
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'AirFuelResearch/1.0 (personal recipe research)'}),timeout=30) as r:return r.read().decode()
def discover():
 urls=set()
 for page in range(1,7):
  url=BASE+'/recipes/collection/air-fryer-recipes'+('' if page==1 else '?page='+str(page))
  try:
   text=fetch(url);urls.update(re.findall('https://www.bbcgoodfood.com/recipes/[a-z0-9-]+',text))
  except Exception as e: print('FAIL',url,str(e),flush=True)
  time.sleep(.7)
 (ROOT/'discovered.txt').write_text('\n'.join(sorted(urls)))
 print(len(urls),'URLs discovered',flush=True)
def extract():
 robots=urllib.robotparser.RobotFileParser(BASE+'/robots.txt');robots.parse(fetch(BASE+'/robots.txt').splitlines())
 (ROOT/'robots.txt').write_text(fetch(BASE+'/robots.txt'))
 out=[];reject=[]
 for url in (ROOT/'discovered.txt').read_text().splitlines():
  if not re.search(r'chicken|turkey|beef|steak|pork|lamb|sausage|fish|salmon|prawn|shrimp|ham|meat|bacon|tuna|cod|haddock|duck',url):continue
  if not robots.can_fetch('AirFuelResearch',url):reject.append({'url':url,'reason':'robots exclusion'});continue
  try:
   text=fetch(url)
   if '"isAccessibleForFree":false' in text or '"isAccessibleForFree": false' in text:raise ValueError('premium page')
   recipes=[json.loads(a) for a in re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',text)]
   recipes=[r for r in recipes if isinstance(r,dict) and r.get('@type')=='Recipe']
   if len(recipes)!=1:raise ValueError('missing unique recipe schema')
   r=recipes[0]
   for k in ['image','description','publisher','author','headline','keywords','mainEntityOfPage','@context','@id','aggregateRating','video']:r.pop(k,None)
   if not r.get('recipeInstructions') or not r.get('nutrition'):raise ValueError('missing accessible method or nutrition')
   r['verifiedAt']='2026-10-11';r['httpStatus']=200;out.append(r); print('OK',r['name'],flush=True)
   (ROOT/'source-facts-review.json').write_text(json.dumps(out,indent=2))
  except Exception as e:reject.append({'url':url,'reason':str(e)});print('FAIL',url,str(e),flush=True)
  time.sleep(.7)
 (ROOT/'rejected.json').write_text(json.dumps(reject,indent=2))
if __name__=='__main__':discover();extract()
