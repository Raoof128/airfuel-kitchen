"""Small, paced public Ninja AU collection discovery; no media retained."""
import concurrent.futures, json, re, subprocess, time
from pathlib import Path
ROOT=Path(__file__).parent

def get(url):
 result=subprocess.run(['curl','-fsSL','--connect-timeout','8','--max-time','25',url],capture_output=True,text=True)
 if result.returncode: raise RuntimeError(result.stderr[-300:])
 return result.stdout
try:
 robots=get('https://ninjakitchen.com.au/robots.txt')
 (ROOT/'ninja-robots.txt').write_text(robots)
except Exception as e:raise SystemExit(str(e))
links=set()
for page in range(1,24):
 try:
  raw=get(f'https://ninjakitchen.com.au/blogs/recipes?page={page}')
  urls=re.findall(r'href=[\"\']([^\"\']*blogs/recipes/[^\"\']+)',raw)
  links.update('https://ninjakitchen.com.au'+u if u.startswith('/') else u for u in urls if '?' not in u)
  print(page,len(links),flush=True)
  (ROOT/'ninja-discovered.txt').write_text('\n'.join(sorted(links))+'\n')
 except Exception as e:print('Failed',page,str(e),flush=True)
 time.sleep(.5)
