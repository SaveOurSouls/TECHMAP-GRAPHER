from pathlib import Path
import json,re,hashlib
root=Path(__file__).resolve().parents[4]
source=root/'design/termination-099'; out=root/'src/Techmap.Client/public/termination-symbols';out.mkdir(parents=True,exist_ok=True)
m=json.loads((source/'manifest.json').read_text(encoding='utf-8'))
files=set()
for a in m['assets']:
 files.update(a['views'].values())
 for color in a.get('colorOptions',[]):files.update(color['views'].values())
for name in sorted(files):
 s=(source/name).read_text(encoding='utf-8')
 if name.endswith('-e4.svg'):
  s=re.sub(r'#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}\b',lambda x:'#ffffff' if x.group().lower() in ('#fff','#ffffff') else '#334155',s)
 (out/name).write_text(s,encoding='utf-8')
m['runtime']={'source':'design/termination-099','e4':'same accepted geometry, monochrome ink; drawing files unchanged','sourceFileSha256':{n:hashlib.sha256((source/n).read_bytes()).hexdigest() for n in sorted(files)}}
(out/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Runtime: {len(files)} accepted symbols copied; E4 monochrome')
