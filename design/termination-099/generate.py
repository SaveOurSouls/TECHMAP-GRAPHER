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
STYLE=f'''<style>svg{{font-family:Arial,'Segoe UI',sans-serif}} .geom{{stroke:{INK};stroke-width:.8;stroke-linecap:round;stroke-linejoin:round}} .geom text{{stroke:none;stroke-width:0}} .detail{{stroke:{EDGE};stroke-width:.55;fill:none}} .wire{{stroke:#69798a;stroke-width:1.6;fill:none;stroke-linecap:round}} .text{{font-size:12px;fill:{INK};stroke:none}} .small{{font-size:10px;fill:{MUTED};stroke:none}} .title{{font-size:25px;fill:#0f172a;font-weight:700;stroke:none}} .card-title{{font-size:17px;fill:#1e293b;font-weight:700;stroke:none}} .view{{font-size:11px;fill:#237ca3;font-weight:700;stroke:none}} .badge{{font-size:11px;fill:{BLUE};font-weight:700;stroke:none}} .dim{{stroke:#5f8f87;stroke-width:.55;fill:none}} .dimtext{{font-size:11px;fill:#427a70;stroke:none}}</style>'''

def shell(title,content,w=W,h=H):
 # Composite sheets reuse symbols; remove duplicate DOM ids while keeping data-role for QA.
 if (w,h)!=(W,H):
  import re
  content=re.sub(r' id="anchor-[^"]+"','',content)
 return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title"><title id="title">{e(title)}</title>{STYLE}{DEFS}{content}</svg>\n'

DEFS='''<defs>
<linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8c1ca"/><stop offset=".25" stop-color="#fafcfd"/><stop offset=".48" stop-color="#d1d8df"/><stop offset=".72" stop-color="#eef2f5"/><stop offset="1" stop-color="#99a7b5"/></linearGradient>
<linearGradient id="red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a7383b"/><stop offset=".25" stop-color="#ed7778"/><stop offset=".48" stop-color="#d95054"/><stop offset=".8" stop-color="#c34347"/><stop offset="1" stop-color="#993439"/></linearGradient>
<linearGradient id="blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#235783"/><stop offset=".25" stop-color="#65a2ce"/><stop offset=".5" stop-color="#397fb3"/><stop offset="1" stop-color="#23557d"/></linearGradient>
<linearGradient id="yellow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b88c29"/><stop offset=".27" stop-color="#ffe6a1"/><stop offset=".55" stop-color="#e9bd4d"/><stop offset="1" stop-color="#b48c32"/></linearGradient>
</defs>'''

def body(family,view,cuff='red',leads=True):
 # Both views use exactly the same profile paths. E4 omits highlights/ribs only.
 mono=view=='e4'; metal='#fff' if mono else 'url(#metal)'; ins='#fff' if mono else f'url(#{cuff})'
 s=[]; details=[]
 def shape(d,fill=metal): s.append(path(d,fill))
 def detail(d): details.append(path(d,extra='class="detail"'))
 if leads:s.append(line(7,50,32,50,'class="wire"'))
 if family.startswith('sleeve'):
  if leads:s.append(line(188,50,213,50,'class="wire"'))
  if family=='sleeve-insulated':
   shape('M32 38 Q32 35 37 35 C60 35 62 39 78 39 H142 C158 39 160 35 183 35 Q188 35 188 38 V62 Q188 65 183 65 C160 65 158 61 142 61 H78 C62 61 60 65 37 65 Q32 65 32 62 Z',ins)
   detail('M35 39 C58 39 63 43 78 43 H142 C157 43 162 39 185 39 M35 61 C58 61 63 57 78 57 H142 C157 57 162 61 185 61')
   detail('M38 36 C35 42 35 58 38 64 M182 36 C185 42 185 58 182 64')
  else:
   shape('M32 39 Q32 37 36 37 H184 Q188 37 188 39 V61 Q188 63 184 63 H36 Q32 63 32 61 Z')
   detail('M35 41 H185 M35 59 H185 M39 38 V62 M181 38 V62 M88 38 V62 M132 38 V62')
   if family=='sleeve-ultrasonic':
    for xx in range(99,123,4):details.append(path(f'M{xx} 41 l3 18',extra='stroke="#776782" stroke-width=".6"'))
 elif family in ('ferrule','ferrule-double'):
  double=family.endswith('double');yy=34 if double else 38
  shape(f'M32 {yy} Q32 {yy-2} 36 {yy-2} H66 Q70 {yy-2} 74 {yy+2} L86 44 V56 L74 {98-yy} Q70 {102-yy} 66 {102-yy} H36 Q32 {102-yy} 32 {100-yy} Z',ins)
  shape('M86 43 H174 Q177 43 177 45 V55 Q177 57 174 57 H86 Z')
  detail('M90 45 H174 M90 55 H174 M36 39 H64 M36 61 H64')
  detail(f'M38 {yy} C35 42 35 58 38 {100-yy}')
  if double:s.append(text(184,29,'×2','badge'))
 elif family=='power-ring':
  shape('M32 35 Q32 33 37 33 H82 Q92 33 105 42 C118 43 129 38 139 32 A23 23 0 1 1 139 68 C129 62 118 57 105 58 Q92 67 82 67 H37 Q32 67 32 65 Z')
  s.append(circle(153,50,12.5,PAPER))
  detail('M37 37 H80 Q91 37 103 44 M37 63 H80 Q91 63 103 56 M38 36 V64 M88 36 V64')
  detail('M116 46 Q126 42 132 38 M116 54 Q126 58 132 62')
 else:
  # Moulded bell-mouth entry and a taper onto the exposed crimp barrel.
  shape('M32 37 Q32 35 36 35 L47 37 Q51 38 57 38 H74 Q80 38 85 42 L88 45 V55 L85 58 Q80 62 74 62 H57 Q51 62 47 63 L36 65 Q32 65 32 63 Z',ins)
  # Metal neck / open stamped transition, clearly narrower than the cuff.
  shape('M86 43 L91 40 L97 43 H109 V57 H97 L91 60 L86 57 Z')
  detail('M89 44 L94 47 H108 M89 56 L94 53 H108 M97 43 V57')
  detail('M35 39 L48 41 Q54 42 75 42 M35 61 L48 59 Q54 58 75 58 M37 37 Q34 49 37 63')
  if family=='ring':
   # Full circular head with a smooth concave neck; not a pointed leaf.
   shape('M105 43 C120 43 127 39 137 33 A22 22 0 1 1 137 67 C127 61 120 57 105 57 Z')
   s.append(circle(151,50,12,PAPER))
   detail('M111 46 C123 46 127 41 132 39 M111 54 C123 54 127 59 132 61')
  elif family=='fork':
   # U slot opens right, with parallel teeth, rounded tips and a circular throat.
   shape('M105 43 C116 43 122 32 133 31 H174 Q177 31 177 34 V39 Q177 42 174 42 H144 A8 8 0 0 0 144 58 H174 Q177 58 177 61 V66 Q177 69 174 69 H133 C122 68 116 57 105 57 Z')
   detail('M111 46 Q122 44 133 35 H173 M111 54 Q122 56 133 65 H173')
  elif family=='blade':
   shape('M106 45 H175 Q180 45 180 50 Q180 55 175 55 H106 Z')
   detail('M111 47 H174')
  elif family=='pin':
   # Bullet pin: shoulder, cylinder and hemispherical mating nose.
   shape('M106 43 H119 Q122 43 122 39 H163 A11 11 0 0 1 163 61 H122 Q122 57 119 57 H106 Z')
   detail('M124 42 H162 Q169 42 171 47 M124 58 H162 M123 40 V60')
  elif family=='socket':
   shape('M106 43 H118 Q123 43 125 38 H174 Q181 38 181 50 Q181 62 174 62 H125 Q123 57 118 57 H106 Z')
   # Recess and curled rim distinguish the receiving mouth without adding a port.
   s.append(path('M175 40 C181 40 181 60 175 60 C168 60 168 40 175 40 Z','#fff' if mono else '#7d8a97'))
   detail('M125 42 H170 M125 58 H170 M175 43 C172 43 172 57 175 57 M132 39 V61')
  elif family=='male':
   shape('M106 44 L115 36 H174 L181 41 V59 L174 64 H115 L106 56 Z')
   s.append(circle(150,50,3.8,PAPER))
   detail('M117 39 H173 L177 43 M117 61 H173 L177 57 M119 43 H133 M119 57 H133')
   # Narrow raised stamped detent beside the fastening hole.
   detail('M134 45 Q139 41 144 45 M134 55 Q139 59 144 55')
  elif family=='female':
   shape('M106 43 L117 33 H171 Q179 33 181 40 V60 Q179 67 171 67 H117 L106 57 Z')
   s.append(path('M128 42 H177 V58 H128 Z','#fff' if mono else '#8996a3'))
   # Rolled upper/lower spring folds and a sprung tongue inside the mouth.
   s.append(path('M120 34 H173 Q178 34 178 40 H128 Q122 40 120 44 Z',metal))
   s.append(path('M120 66 H173 Q178 66 178 60 H128 Q122 60 120 56 Z',metal))
   s.append(path('M130 47 H168 L173 50 L168 53 H130 Z',metal))
   detail('M124 36 H172 M124 64 H172 M133 49 H165 M113 44 V56')
  elif family=='flag':
   # True 90° folded female contact above the crimp axis.
   shape('M106 43 H117 Q121 43 121 39 V20 Q121 14 127 14 H157 Q164 14 164 21 V53 Q164 59 158 59 H106 Z')
   s.append(path('M132 17 H153 V42 H132 Z','#fff' if mono else '#8996a3'))
   s.append(path('M123 19 Q123 15 129 15 V43 H122 Z',metal))
   s.append(path('M157 15 Q163 15 163 21 V47 H156 V19 Z',metal))
   s.append(path('M138 18 V36 L142 41 L146 36 V18 Z',metal))
   detail('M126 20 V38 M160 21 V45 M123 49 Q126 54 134 54 H158')
 s='<g class="geom">'+''.join(s)+((''.join(details)) if not mono else '')+'</g>'
 return s

def symbol(family,view,cuff='red',leads=True):
 s=body(family,view,cuff,leads)
 s+=anchor(32,50,'wire-entry-a' if family.startswith('sleeve') else 'wire-entry')
 if family.startswith('sleeve'):s+=anchor(188,50,'wire-entry-b')
 return s

def prep_symbol(key,view):
 if view=='drawing':return line(7,50,32,50,'class="wire"')+anchor(32,50)+text(48,54,'Разделка','small')
 if key in ('pin','socket','pin-seal','socket-seal','lug'):
  family='ring' if key=='lug' else ('pin' if key.startswith('pin') else 'socket')
  s=body(family,'e4')
  if key.endswith('seal'):
   s+='<g class="geom">'+path('M38 36 Q46 32 53 36 V64 Q46 68 38 64 Z','#fff')+path('M42 36 V64 M48 35 V65',extra='class="detail"')+'</g>'
  return s+anchor(32,50)
 s=line(7,50,32,50,'class="wire"')
 if key in ('copper','tinned-copper'):
  col=COPPER if key=='copper' else '#a8b5c1'
  s+=path('M32 48 H163 M32 50 H163 M32 52 H163',extra=f'stroke="{col}" stroke-width=".8"')
 else:s+='<g class="geom">'+path('M32 50 H157 M157 46 V54')+'</g>'
 return s+anchor(32,50)

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
manifest['profileRevision']='2026-10-15-photo-profiles'
manifest['profileReferences']={'C1':'codex-clipboard-99230161-c64b-4f61-a8d4-82cdf7de665d.png','C2':'codex-clipboard-264c60fd-81a9-4f6d-8a74-6fef23089339.png','C3':'codex-clipboard-95e2c17e-9767-4ea0-a922-72615987b6fb.png'}
manifest['viewContract']='same silhouette paths; E4 monochrome with reduced detail; drawing moderate gradients and stamped folds'
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
parts += [text(28,1993,'НВШ — alias с предложенной геометрией pin blade. C3 от 14.10.2026 — SC; DIN не подтверждён. Не нормативные УГО.','small')]
(OUT/'atlas.svg').write_text(shell('Атлас оконцовок 099',''.join(parts),AW,AH),encoding='utf-8')

# Independent flow panels 2,3,4, sleeve, preparation point.
FW,FH=1160,690; p=[rect(0,0,FW,FH,'#f3f6fa'),text(28,44,'099 · Многопроводные подключения','title'),text(28,73,'Несколько проводов присоединяются к существующему якорю. Счётчик ×n не является портом.')]
for i,n in enumerate((2,3,4)):
 x=28+i*378;y=101
 p.append(f'<g transform="translate({x},{y})">'+rect(0,0,348,228,PAPER,12)+text(18,29,f'{n} провода · один наконечник','card-title'))
 for k in range(n):
  sy=71+k*(100/(n-1));p.append(path(f'M22 {sy} H55 Q89 {sy} 130 122','none','class="wire"'))
 p.append('<g transform="translate(98,72) scale(1.05)">'+symbol('ring','drawing',leads=False)+'</g>')
 p.append(text(252,70,f'×{n}','badge')+text(18,208,'Якорь общий; каждый провод сохраняет свой ID.','small')+'</g>')
p += [rect(28,355,539,260,PAPER,12),text(47,386,'Гильза · 2 + 2 по краям','card-title'),path('M50 440 H100 Q135 440 166 480 M50 525 H100 Q135 525 166 480 M545 440 H505 Q469 440 435 480 M545 525 H505 Q469 525 435 480','none','class="wire"'),f'<g transform="translate(112,394) scale(1.72)">{symbol("sleeve-insulated","drawing",leads=False)}</g>',text(47,583,'Две точки на краях: A и B. В каждой точке — несколько проводов.','small'),rect(594,355,538,260,PAPER,12),text(613,386,'Разделка · точка на Чертеже','card-title'),path('M616 480 H840','none','class="wire"'),anchor(840,480),text(858,484,'одна точка','small'),text(613,548,'Э4: без разделки · медь · лужёная медь · pin · socket','small'),text(613,572,'pin+seal · socket+seal · lug. Восемь вариантов одного объекта.','small'),text(28,655,'Все изображения — проектные макеты. Геометрия не определяет электрическую связность или производственную длину.','small')]
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

# Enlarged sheet for silhouette / fold inspection and neutral color comparison.
PDW,PDH=1240,1630
r=[rect(0,0,PDW,PDH,'#f3f6fa'),text(28,44,'099 · Профили по фотографиям · 15.10.2026','title'),text(28,72,'C1–C3: плавная шейка, раструб манжеты, штампованные переходы и контактные пружины.'),text(28,94,'Э4 сохраняет тот же силуэт. Красный / синий / жёлтый здесь — варианты показа, без привязки к сечению.','small')]
for i,(fam,label) in enumerate([('ring','НКИ · круглая головка / плавная шейка'),('fork','НВИ · U-вилка / параллельные зубцы'),('pin','Bullet male · закруглённый нос'),('socket','Bullet female · приёмная втулка'),('male','Flat male · штампованная лопатка'),('female','Flat female · пружинные завальцовки'),('flag','Флажковый · контакт под 90°'),('ferrule-double','НШВИ-2 · расширенный раструб')]):
 x=28+(i%2)*608;y=119+(i//2)*290
 r += [rect(x,y,584,270,PAPER,10),text(x+18,y+28,label,'card-title'),text(x+18,y+49,'Чертёж · профиль по фото','view'),f'<g transform="translate({x+2},{y+20}) scale(2.7)">{symbol(fam,"drawing")}</g>',text(x+18,y+231,'Э4 · тот же внешний контур','view'),f'<g transform="translate({x+164},{y+191}) scale(.9)">{symbol(fam,"e4")}</g>']
cy=1304
r += [rect(28,cy,1192,250,PAPER,10),text(46,cy+31,'Манжеты · три цвета одного профиля','card-title')]
for i,(col,label) in enumerate([('red','красная'),('blue','синяя'),('yellow','жёлтая')]):
 xx=48+i*394
 r += [text(xx,cy+60,label,'view'),f'<g transform="translate({xx-7},{cy+66}) scale(1.8)">{symbol("ring","drawing",cuff=col)}</g>']
r += [text(46,cy+222,'Цвет не подтверждает диапазон сечения, материал или соответствие стандарту. Якори не изменены.','small'),text(28,1600,'Самостоятельные векторные профили по визуальным ориентирам владельца. Проектные символы; не нормативные УГО.','small')]
(OUT/'profile-detail.svg').write_text(shell('Оконцовки · увеличенные профили 15.10.2026',''.join(r),PDW,PDH),encoding='utf-8')

# structural validation, deterministic and no external packages required
for p in OUT.glob('*.svg'):
 root=ET.parse(p).getroot(); ids=[n.get('id') for n in root.iter() if n.get('id')];assert len(ids)==len(set(ids)), ('duplicate ids',p.name)
for a in manifest['assets']:
 for view,file in a['views'].items():
  root=ET.parse(OUT/file).getroot(); found=[n for n in root.iter() if n.get('data-role')=='wire-entry'];assert len(found)==a['electricalPointCount'],(a['id'],view)
  for expected in a['anchors']:
   node=next(n for n in found if n.get('id')==expected['id']);assert float(node.get('cx'))==expected['x'] and float(node.get('cy'))==expected['y']
print(f'OK: {len(manifest["assets"])} assets, 8 preparation variants, {len(list(OUT.glob("*.svg")))} valid SVGs; anchor coordinates verified')
