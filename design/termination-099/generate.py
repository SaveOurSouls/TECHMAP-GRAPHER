from pathlib import Path
import json, html, textwrap
import xml.etree.ElementTree as ET

OUT=Path(__file__).parent
INK='#334155'; MUTED='#64748b'; BLUE='#1684ba'; PAPER='#ffffff'; METAL='#dbe5ee'; EDGE='#8593a3'; INS='#d95f59'; TIN='#dae5ee'; COPPER='#c98755'; SEAL='#59a69b'
PALETTE={'paper':PAPER,'outline':INK,'metal':METAL,'tin':TIN,'insulation':INS,'wire':'#69798a','anchor':BLUE,'copper':COPPER,'seal':SEAL}
W,H=220,100
ITEMS=[
 ('nki-ring','НКИ · кольцевой','terminal','ring','L / L1 / D / B / d1 / P / S','Изолированный обжим и кольцевой лепесток'),
 ('nvi-fork','НВИ · вилочный','terminal','fork','L / L1 / D / B / d1 / P / S','Открытая вилка без дополнительного порта'),
 ('nshvi-single','НШВИ · одинарный','terminal','ferrule','L / L1 / C / W / A','Трубчатая втулка с изолированным раструбом'),
 ('nshvi-double','НШВИ-2 · двойной','terminal','ferrule-double','L / L1 / C / W / A','Один общий вход; ×2 — аннотация'),
 ('nvsh-alias-pin-blade','НВШ (alias) · pin blade','terminal','blade','проектные поля L / W / t','Предложенная геометрия; расшифровка не утверждается'),
 ('din-sc-ring','DIN / SC · силовой кольцевой','terminal','power-ring','поля каталога C3: d2 / d / D / B / E / L','Медь лужёная; на C3 маркировка SC. DIN не подтверждён'),
 ('pin-round','Pin · круглый штырь','terminal','pin','проектные поля L / d','Боковой вид цилиндрического контакта'),
 ('socket-round','Socket · круглая розетка','terminal','socket','проектные поля L / d','Боковой вид с гнездом; сочленение не порт'),
 ('flat-male','Flat male · плоский штырь','terminal','male','проектные поля L / W / t','Плоская контактная лопатка'),
 ('flat-female','Flat female · плоская розетка','terminal','female','проектные поля L / W / t','Сложенный пружинный контакт с гнездом'),
 ('flag','Флажковый · угловая розетка','terminal','flag','проектные поля L / W / t','Контактная часть развёрнута к оси обжима'),
 ('sleeve-insulated','Гильза · изолированная','sleeve','sleeve-insulated','проектные поля L / D / d','Два крайних входа; изоляция показана цветом'),
 ('sleeve-bare','Гильза · неизолированная','sleeve','sleeve-bare','проектные поля L / D / d','Два крайних входа; один общий объём гильзы'),
 ('sleeve-ultrasonic','Гильза · УЗ сварка','sleeve','sleeve-ultrasonic','проектные поля L / D / d','УЗ шов — операция, не отдельный порт'),
]
VARIANTS=[('none','без разделки'),('copper','медь'),('tinned-copper','лужёная медь'),('pin','pin'),('socket','socket'),('pin-seal','pin+seal'),('socket-seal','socket+seal'),('lug','lug')]

def e(s): return html.escape(str(s),quote=True)
def rect(x,y,w,h,fill='none',rx=0): return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"/>'
def path(d,fill='none',extra=''): return f'<path d="{d}" fill="{fill}" {extra}/>'
def line(x1,y1,x2,y2,extra=''): return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" {extra}/>'
def circle(x,y,r,fill='none',extra=''): return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" {extra}/>'
def anchor(x,y,i='wire-entry'): return circle(x,y,4.8,PAPER,f'id="anchor-{i}" data-role="wire-entry" stroke="{BLUE}" stroke-width="2.2"')
def text(x,y,s,cls='text',extra=''): return f'<text x="{x}" y="{y}" class="{cls}" {extra}>{e(s)}</text>'
STYLE=f'''<style>svg{{font-family:Arial,'Segoe UI',sans-serif}} .geom{{stroke:{INK};stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}} .geom text{{stroke:none;stroke-width:0}} .detail{{stroke:{EDGE};stroke-width:1;fill:none}} .wire{{stroke:#69798a;stroke-width:3;fill:none;stroke-linecap:round}} .text{{font-size:12px;fill:{INK};stroke:none}} .small{{font-size:10px;fill:{MUTED};stroke:none}} .title{{font-size:25px;fill:#0f172a;font-weight:700;stroke:none}} .card-title{{font-size:17px;fill:#1e293b;font-weight:700;stroke:none}} .view{{font-size:11px;fill:#237ca3;font-weight:700;stroke:none}} .badge{{font-size:11px;fill:{BLUE};font-weight:700;stroke:none}} .dim{{stroke:#5f8f87;stroke-width:1;fill:none}} .dimtext{{font-size:11px;fill:#427a70;stroke:none}}</style>'''

def shell(title,content,w=W,h=H):
 # Composite sheets reuse symbols; remove duplicate DOM ids while keeping data-role for QA.
 if (w,h)!=(W,H):
  import re
  content=re.sub(r' id="anchor-[^"]+"','',content)
 return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title"><title id="title">{e(title)}</title>{STYLE}{content}</svg>\n'

def body(family,view):
 # All primary terminal bodies start at x=32,y=50. Sleeve bodies end at x=188.
 s=[]; mono=view=='e4'; metal='none' if mono else METAL; ins='none' if mono else INS
 s.append(line(7,50,32,50,'class="wire"'))
 if family.startswith('sleeve'):
  s.append(line(188,50,213,50,'class="wire"'))
  s.append(rect(32,37 if mono else 31,156,26 if mono else 38,('none' if mono else (INS if family=='sleeve-insulated' else TIN)),5))
  if not mono:
   s.extend([path('M38 36 H180 M38 64 H180',extra='class="detail"'),line(61,32,61,68,'class="detail"'),line(159,32,159,68,'class="detail"')])
  if family=='sleeve-ultrasonic':
   s.append(path('M101 34 L104 66 M108 34 L111 66 M115 34 L118 66',extra='stroke="#8c60a5" stroke-width="2.3"'))
 elif family in ('ring','fork'):
  if mono:
   s.append(rect(32,42,65,16))
   if family=='ring': s.extend([line(97,50,119,50),circle(137,50,18),circle(137,50,9)])
   else: s.append(path('M97 50 H117 M155 28 H131 Q110 50 131 72 H155 M155 38 H134 Q123 50 134 62 H155'))
  else:
   s.append(path('M32 32 H82 L95 37 V63 L82 68 H32 Z',ins))
   s.append(path('M83 37 H107 L126 29 Q166 18 177 50 Q166 82 126 71 L107 63 H83 Z',metal))
   if family=='ring': s.append(circle(151,50,13,PAPER))
   else: s.append(path('M182 37 H151 Q133 50 151 63 H182 Z',PAPER,'stroke="none"'))
   s.append(path('M36 37 H80 M36 63 H80 M89 40 V60',extra='class="detail"'))
 elif family in ('ferrule','ferrule-double'):
  double=family.endswith('double')
  if mono:
   s.append(rect(32,38 if double else 42,54,24 if double else 16))
   s.append(rect(86,44,79,12))
  else:
   s.append(path(('M32 29 H64 Q76 29 85 40 H92 V60 H85 Q76 71 64 71 H32 Z' if double else 'M32 31 H63 Q78 31 91 41 V59 Q78 69 63 69 H32 Z'),ins))
   s.append(rect(91 if not double else 92,41,81,18,metal,2))
   s.extend([path('M97 45 H167 M97 55 H167',extra='class="detail"'),path('M38 35 H63 M38 65 H63',extra='class="detail"')])
  if double: s.append(text(178,29,'×2','badge'))
 elif family=='power-ring':
  if mono: s.extend([rect(32,39,72,22),line(104,50,120,50),circle(143,50,22),circle(143,50,10)])
  else:
   s.extend([path('M32 33 H82 L102 40 V60 L82 67 H32 Z',metal),path('M82 39 H109 L128 25 H160 L180 40 V60 L160 75 H128 L109 61 H82 Z',TIN),circle(151,50,14,PAPER),path('M36 37 H77 M36 63 H77 M37 42 H71 M37 58 H71',extra='class="detail"')])
 elif family in ('pin','socket','blade','male','female','flag'):
  s.append(rect(32,42 if mono else 34,58,16 if mono else 32,ins,3 if not mono else 0))
  if family=='pin':
   s.append(path('M90 44 H153 L165 47 V53 L153 56 H90 Z',metal))
   if not mono:s.append(path('M98 47 H151',extra='class="detail"'))
  elif family=='socket':
   s.append(path('M90 40 H166 V60 H90 Z',metal))
   s.append(path('M167 45 H133 V55 H167',PAPER))
   if not mono:s.append(path('M98 44 H127 M98 56 H127',extra='class="detail"'))
  elif family in ('blade','male'):
   s.append(path(('M90 42 H169 L178 50 L169 58 H90 Z' if family=='blade' else 'M90 36 H173 L181 43 V57 L173 64 H90 Z'),metal))
   if family=='male':s.append(circle(143,50,4.5,PAPER))
   if not mono:s.append(line(97,50,127,50,'class="detail"'))
  elif family=='female':
   s.append(path('M90 33 H172 V67 H90 Z',metal))
   s.append(path('M169 43 H126 V57 H169',PAPER))
   if not mono:s.append(path('M99 39 H163 M99 61 H163 M111 34 V66',extra='class="detail"'))
  elif family=='flag':
   s.append(path('M90 42 H115 V14 H147 V64 H90 Z',metal))
   s.append(path('M125 16 V38 H137 V16',PAPER))
   if not mono:s.append(path('M119 44 H143 M94 57 H138',extra='class="detail"'))
  if not mono:s.append(path('M37 39 H83 M37 61 H83',extra='class="detail"'))
 return '<g class="geom">'+''.join(s)+'</g>'

def symbol(family,view):
 s=body(family,view)
 s+=anchor(32,50,'wire-entry-a' if family.startswith('sleeve') else 'wire-entry')
 if family.startswith('sleeve'):s+=anchor(188,50,'wire-entry-b')
 return s

def prep_symbol(key,view):
 s=line(7,50,32,50,'class="wire"')
 if view=='drawing':return s+anchor(32,50)+text(48,54,'Разделка','small')
 geom=[]
 if key in ('copper','tinned-copper'):
  color=COPPER if key=='copper' else TIN
  geom=[path('M32 50 H159',extra=f'stroke="{color}" stroke-width="6"'),path('M36 46 H159 M36 54 H159',extra=f'stroke="{EDGE}" stroke-width="0.6"')]
 elif key in ('pin','socket','pin-seal','socket-seal'):
  geom=[rect(32,42,52,16,'none'),path('M84 44 H156 L164 50 L156 56 H84 Z' if key.startswith('pin') else 'M84 38 H164 V62 H84 Z')]
  if key.startswith('socket'):geom.append(path('M164 44 H135 V56 H164',PAPER))
  if key.endswith('seal'):geom.append(rect(36,37,22,26,SEAL,3))
 elif key=='lug':geom=[rect(32,42,68,16),line(100,50,120,50),circle(138,50,18),circle(138,50,9)]
 elif key=='none':geom=[line(32,50,143,50),line(143,44,143,56)]
 return s+'<g class="geom">'+''.join(geom)+'</g>'+anchor(32,50)

manifest={'schema':'termination-099/v1','designStatus':'project-symbols','units':'viewBox units, illustrative scale','viewBox':[0,0,W,H],'colorTokens':PALETTE,'terminationVariants':[label for _,label in VARIANTS],'assets':[]}

def record(id,name,kind,family,note):
 anchors=[{'id':'anchor-wire-entry','role':'wire-entry','x':32,'y':50,'normal':[-1,0]}] if kind!='sleeve' else [{'id':'anchor-wire-entry-a','role':'wire-entry','x':32,'y':50,'normal':[-1,0]},{'id':'anchor-wire-entry-b','role':'wire-entry','x':188,'y':50,'normal':[1,0]}]
 return {'id':id,'name':name,'kind':kind,'geometryFamily':family,'views':{v:f'{id}-{v}.svg' for v in ('e4','drawing')},'anchors':anchors,'pivot':{'x':110 if kind=='sleeve' else 32,'y':50},'electricalPointCount':2 if kind=='sleeve' else 1,'countAnnotationPolicy':'multiple wires share one existing anchor; ×2/×3/×4 is annotation only','note':note}

for id,name,kind,family,dims,note in ITEMS:
 for view in ('e4','drawing'):(OUT/f'{id}-{view}.svg').write_text(shell(name+' — '+('Э4' if view=='e4' else 'Чертёж'),symbol(family,view)),encoding='utf-8')
 r=record(id,name,kind,family,note);r['dimensionFields']=dims;r['catalogAlias']='НВШ' if family=='blade' else None;r['standardClaim']=None;manifest['assets'].append(r)
for key,label in VARIANTS:
 id='preparation-'+key
 for view in ('e4','drawing'):(OUT/f'{id}-{view}.svg').write_text(shell('Разделка — '+label+' — '+view,prep_symbol(key,view)),encoding='utf-8')
 r=record(id,'Разделка: '+label,'preparation',key,'Чертёж — один общий точечный вид для всех вариантов; Э4 — выбранный вариант');manifest['assets'].append(r)
manifest['references']={'C1':{'image':'codex-clipboard-bbee8c8c-ddbe-40a1-b1c6-01db61a7f201.png','observed':'НКИ/НВИ: L/L1/D/B/d1/P/S, кольцо и открытая вилка'},'C2':{'image':'codex-clipboard-0a619538-77d8-4e08-97e3-ceb9a7c7cbfc.png','observed':'трубчатые варианты; НШВИ-2 — расширение проекта; поля L/L1/C/W/A'},'C3':{'image':'codex-clipboard-306a0705-ae92-40d4-a24c-71cd5ab21328.png','observed':'трубчатые медные лужёные SC; d2/d/D/B/E/L; DIN не указан'},'C4':{'image':'codex-clipboard-b83f3bf3-8029-4807-a459-21fa6222fbc1.png','observed':'кольцевые/вилки, butt, bullet, male/female, pin, flag'},'C5':{'image':'codex-clipboard-f5014f2a-7c14-43b0-8b8e-0efc9e102b57.png','observed':'визуальное разнообразие ring/fork/round/flat/flag/sleeve'}}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Russian atlas: generous two-column cards, distinct views.
AW=1180; AH=2020
parts=[rect(0,0,AW,AH,'#f3f6fa'),text(28,45,'099 · Атлас оконцовок','title'),text(28,71,'Проектные символы Э4 и Чертежа · единая электрическая точка для каждого наконечника'),text(28,93,'Кольцо, вилка и сочленение не добавляют портов. Гильзы: только два крайних входа. ×2/×3/×4: аннотация.','small'),rect(28,109,1124,32,'#e1f0f8',8),anchor(45,125),text(59,129,'Синий якорь = вход провода; материал и геометрия не определяют связность. Масштаб изображений условный.','small')]
for i,(id,name,kind,family,dims,note) in enumerate(ITEMS):
 x=28+(i%2)*572;y=162+(i//2)*210
 parts.append(f'<g transform="translate({x},{y})">'+rect(0,0,552,192,PAPER,12)+text(18,28,name,'card-title')+text(18,49,note,'small')+text(18,70,'Э4 · условный вид','view')+text(292,70,'Чертёж · боковой / сверху','view')+f'<g transform="translate(8,69)">{symbol(family,"e4")}</g><g transform="translate(281,69)">{symbol(family,"drawing")}</g>'+text(18,178,'Размерные поля: '+dims,'small')+text(423,178,'2 края' if kind=='sleeve' else '1 вход','badge')+'</g>')
# compact eight preparation specimens
py=1650
parts += [rect(28,py,1124,306,PAPER,12),text(46,py+29,'Универсальная «Разделка»','card-title'),text(46,py+52,'Чертёж: одна точка. Э4: восемь вариантов одного объекта; выбор сохраняется отдельно от геометрии.'),line(46,py+78,88,py+78,'class="wire"'),anchor(88,py+78),text(105,py+82,'общая точка Чертежа','small')]
for i,(key,label) in enumerate(VARIANTS):
 xx=46+(i%4)*272; yy=py+101+(i//4)*96
 parts += [text(xx,yy+13,label,'view'),f'<g transform="translate({xx},{yy+18}) scale(.88)">{prep_symbol(key,"e4")}</g>']
parts += [text(28,1993,'НВШ — alias с предложенной геометрией pin blade. C3 — SC; норматив DIN не подтверждён. Не нормативные УГО.','small')]
(OUT/'atlas.svg').write_text(shell('Атлас оконцовок 099',''.join(parts),AW,AH),encoding='utf-8')

# Independent flow panels 2,3,4, sleeve, preparation point.
FW,FH=1160,690; p=[rect(0,0,FW,FH,'#f3f6fa'),text(28,44,'099 · Многопроводные подключения','title'),text(28,73,'Несколько проводов присоединяются к существующему якорю. Счётчик ×n не является портом.')]
for i,n in enumerate((2,3,4)):
 x=28+i*378;y=101
 p.append(f'<g transform="translate({x},{y})">'+rect(0,0,348,228,PAPER,12)+text(18,29,f'{n} провода · один наконечник','card-title'))
 for k in range(n):
  sy=71+k*(100/(n-1));p.append(path(f'M22 {sy} H55 Q89 {sy} 130 122','none','class="wire"'))
 p.append('<g transform="translate(98,72) scale(1.05)">'+symbol('ring','drawing')+'</g>')
 p.append(text(252,70,f'×{n}','badge')+text(18,208,'Якорь общий; каждый провод сохраняет свой ID.','small')+'</g>')
p += [rect(28,355,539,260,PAPER,12),text(47,386,'Гильза · 2 + 2 по краям','card-title'),path('M50 440 H100 Q135 440 166 480 M50 525 H100 Q135 525 166 480 M545 440 H505 Q469 440 435 480 M545 525 H505 Q469 525 435 480','none','class="wire"'),f'<g transform="translate(112,394) scale(1.72)">{symbol("sleeve-insulated","drawing")}</g>',text(47,583,'Две точки на краях: A и B. В каждой точке — несколько проводов.','small'),rect(594,355,538,260,PAPER,12),text(613,386,'Разделка · точка на Чертеже','card-title'),path('M616 480 H840','none','class="wire"'),anchor(840,480),text(858,484,'одна точка','small'),text(613,548,'Э4: без разделки · медь · лужёная медь · pin · socket','small'),text(613,572,'pin+seal · socket+seal · lug. Восемь вариантов одного объекта.','small'),text(28,655,'Все изображения — проектные макеты. Геометрия не определяет электрическую связность или производственную длину.','small')]
(OUT/'flows.svg').write_text(shell('Потоки многопроводных оконцовок 099',''.join(p),FW,FH),encoding='utf-8')

# C1/C2 field definitions, not numerical dimensions.
DW,DH=1180,460
q=[rect(0,0,DW,DH,'#f3f6fa'),text(28,44,'099 · Поля размеров C1 / C2','title'),text(28,70,'Иллюстративная геометрия. Размеры артикула задаются данными каталога; пиксели не являются миллиметрами.')]
for x,fam,name in [(70,'ring','C1 · НКИ / НВИ'),(650,'ferrule-double','C2 · НШВИ · трубчатые варианты')]:
 q+=[text(x,115,name,'card-title'),f'<g transform="translate({x+12},136) scale(1.9)">{symbol(fam,"drawing")}</g>']
 q+=[line(x+73,143,x+354,143,'class="dim"'),line(x+73,137,x+73,151,'class="dim"'),line(x+354,137,x+354,151,'class="dim"'),text(x+204,135,'L' if fam=='ring' else 'L1','dimtext')]
 if fam=='ring':
  q += [text(x,345,'L — общая длина · L1 — зона металлического обжима','small'),text(x,367,'D — отверстие кольца / раскрытие вилки · B — ширина лепестка','small'),text(x,389,'d1 — входной диаметр · P — длина хвостовой зоны · S — толщина','small')]
 else:
  q += [text(x,345,'L — металлическая втулка · L1 — общая длина','small'),text(x,367,'C — диаметр втулки · W — габарит раструба','small'),text(x,389,'A — поперечный габарит; НШВИ-2 — расширение проекта','small')]
q += [text(28,431,'Схема только сохраняет названия полей приложений; значения и допуски не выдуманы.','small')]
(OUT/'dimensions.svg').write_text(shell('Размерные поля 099',''.join(q),DW,DH),encoding='utf-8')

# structural validation, deterministic and no external packages required
for p in OUT.glob('*.svg'):
 root=ET.parse(p).getroot(); ids=[n.get('id') for n in root.iter() if n.get('id')];assert len(ids)==len(set(ids)), ('duplicate ids',p.name)
for a in manifest['assets']:
 for view,file in a['views'].items():
  root=ET.parse(OUT/file).getroot(); found=[n for n in root.iter() if n.get('data-role')=='wire-entry'];assert len(found)==a['electricalPointCount'],(a['id'],view)
  for expected in a['anchors']:
   node=next(n for n in found if n.get('id')==expected['id']);assert float(node.get('cx'))==expected['x'] and float(node.get('cy'))==expected['y']
print(f'OK: {len(manifest["assets"])} assets, 8 preparation variants, {len(list(OUT.glob("*.svg")))} valid SVGs; anchor coordinates verified')
