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
 ('flag','Флажковый · цельная изоляция','terminal','flag','проектные поля L / W / t','Компактный профиль C1; полупрозрачная оболочка и плоский металл'),
 ('flag-bare-open','Неизолированный обжимной флажок','terminal','flag-bare-open','проектные поля L / W / t','Компактные крылья; головка над основанием, окно под ней'),
 ('flag-bare-pressed-smooth','Неизолированный опрессовочный · гладкий','terminal','flag-bare-pressed-smooth','проектные поля L / W / t','Два диаметра; трубка проходит под головкой до её края'),
 ('flag-bare-pressed-ribbed','Неизолированный опрессовочный · рифлёный','terminal','flag-bare-pressed-ribbed','проектные поля L / W / t','Один диаметр, рёбра; трубка под головкой до её края'),
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

def receptacle_head(mono):
 # C1: 7.3 axial x 6.6 wide, at 5.6 drawing units/mm. Shared by both angles.
 metal='#fff' if mono else 'url(#metal)'
 recess='#fff' if mono else '#74808b'
 s=[path('M0 -15.48 Q0 -18.48 3 -18.48 H37.88 Q40.88 -18.48 40.88 -15.48 V15.48 Q40.88 18.48 37.88 18.48 H3 Q0 18.48 0 15.48 Z',metal)]
 # Backing plate windows and retaining dimple, without an arrow-shaped tongue.
 for x in (6,29):s.append(rect(x,-8.2,5.2,16.4,recess,0.5))
 s.append(path('M17 -4 H22 Q27 -4 27 0 Q27 4 22 4 H17 Z',recess))
 # Longitudinal rolled lips with rounded ends and a central receiving channel.
 s.append(path('M3 -18.48 H37.88 Q40.88 -18.48 40.88 -15.48 V-9.6 Q40.88 -7.4 37.88 -7.4 H3 Q0 -7.4 0 -10.4 V-15.48 Q0 -18.48 3 -18.48 Z',metal))
 s.append(path('M3 7.4 H37.88 Q40.88 7.4 40.88 10.4 V15.48 Q40.88 18.48 37.88 18.48 H3 Q0 18.48 0 15.48 V10.4 Q0 7.4 3 7.4 Z',metal))
 if not mono:
  s += [path('M4 -15.7 H36.88 M4 10.1 H36.88 M18 -2.6 H22 Q25 -2.6 25 0 Q25 2.6 22 2.6',extra='class="detail"'),path('M39 -15.4 Q36.2 -12.9 39 -10 M39 10.3 Q36.2 12.9 39 15.4',extra='class="detail"')]
 return ''.join(s)

def flag_body(family,mono,cuff):
 # Orthographic profile: wire enters from left; head is above the right-hand base.
 metal='#fff' if mono else 'url(#metal)'
 s=[]; details=[]
 if family=='flag':
  # C1 f8726991: preserve the photo profile in source coordinates, then rotate -90°.
  # x'=32+.12*(source_y-25); y'=50-.12*(source_x-97.5). Isotropic scale .12.
  color={'red':'#d86b70','blue':'#55a8d5','yellow':'#dbc257'}[cuff]
  outer='M19 25 H176 Q180 25 180 29 V170 H470 Q476 170 476 176 V430 Q476 436 470 436 H39 Q33 436 33 430 V182 L20 172 Q15 168 15 162 V29 Q15 25 19 25 Z'
  s.append('<g transform="matrix(0,-.12,.12,0,29,61.7)">')
  if not mono:
   # All internal parts stay in the photo plane; no receiving-face projection or coils.
   # The broad backing and its window sit beneath the actual translucent polymer fill.
   s.append(path('M62 198 H433 V411 H62 Z M139 244 H205 V369 H139 Z','#a8b4bc',extra='fill-rule="evenodd" fill-opacity=".34" stroke="#6b7e8b" stroke-opacity=".32" stroke-width="3"'))
   s.append(path('M281 211 H431 V401 H281 V360 H303 V252 H281 Z','#8597a4',extra='fill-opacity=".35" stroke="#617687" stroke-opacity=".38" stroke-width="3"'))
   # Two longitudinal spring edges; understated rounded planar strips, not end-view arcs.
   s.append('<g fill="#697f8f" fill-opacity=".46" stroke="#5d7485" stroke-opacity=".4" stroke-width="3">'+rect(292,210,26,190,'#697f8f',8)+rect(394,210,26,190,'#697f8f',8)+'</g>')
   s.append(path('M318 270 H394 V340 H318 Z','#b4c0c9',extra='fill-opacity=".32" stroke="#647a8c" stroke-opacity=".35" stroke-width="3"'))
   s.append(path(outer,color,extra='fill-opacity=".61" stroke="#638da6" stroke-width="6.5"'))
   s.append(path('M40 183 H462 V421 H46 M24 164 H173 M36 188 V419',extra='stroke="#5e9dc0" stroke-opacity=".28" stroke-width="2.7"'))
  else:
   s.append(path(outer,'#fff',extra='stroke-width="6.5"'))
  s.append('</g>')
 elif family=='flag-bare-open':
  # C1 rotated to left wire entry. Head above right crimp base, large window beneath.
  # Lower crimp strip continues to the right support; two upright arms frame the window.
  s.append(path('M32 45 H64 V29 H69 V45 H84 V29 H90 V55 H32 Z',metal))
  # Compact curled wings, two pairs along the crimp base; not triangular ears.
  s.append(path('M34 45 C32 41 32 35 37 34 C42 34 47 36 48 40 L49 45 Z',metal))
  s.append(path('M34 55 C32 59 32 65 37 66 C42 66 47 64 48 60 L49 55 Z',metal))
  s.append(path('M60 45 C58 41 58 38 62 37 C66 37 71 39 72 42 L73 45 Z',metal))
  s.append(path('M60 55 C58 59 58 62 62 63 C66 63 71 61 72 58 L73 55 Z',metal))
  # Uniform scale keeps head proportions. Window (69..84, 30..45) is under the head.
  s.append('<g transform="translate(77.064,30) rotate(-90) scale(.7)">'+receptacle_head(mono)+'</g>')
  if not mono:
   details += [path('M36 43 Q35 40 37 37 Q41 36 45 39 M36 57 Q35 60 37 63 Q41 64 45 61 M62 43 Q61 41 63 39 Q66 39 69 41 M62 57 Q61 59 63 61 Q66 61 69 59 M36 48 H80 M36 52 H80 M66 32 V36 M87 32 V52',extra='class="detail"')]
 elif family.startswith('flag-bare-pressed'):
  # C2 mounting silhouette: tube continues UNDER the head to precisely the same x90 edge.
  # Tube top is y37 and head underside is y37: there is no side neck or bridge.
  if family.endswith('smooth'):
   s.append(path('M32 37 Q32 33 37 33 H54 Q58 33 58 37 H86 Q90 37 90 41 V59 Q90 63 86 63 H58 Q58 67 54 67 H37 Q32 67 32 63 Z',metal))
   s.append(path('M35 35 C31 39 31 61 35 65',extra='class="detail"'))
   if not mono:details += [path('M38 37 H53 M38 63 H53 M58 38 Q54 50 58 62 M63 41 H86 M63 59 H86',extra='class="detail"')]
  else:
   s.append(path('M32 41 Q32 37 37 37 H86 Q90 37 90 41 V59 Q90 63 86 63 H37 Q32 63 32 59 Z',metal))
   s.append(path('M35 39 C31 42 31 58 35 61',extra='class="detail"'))
   for xx in range(43,87,8):s.append(path(f'M{xx} 38 Q{xx-3} 50 {xx} 62',extra='stroke="#81909b" stroke-width=".65"'))
   if not mono:details += [path('M38 41 H86 M38 59 H86',extra='class="detail"')]
  # Same placement and proportions for both pressed families; only tube profile changes.
  s.append('<g transform="translate(73.7376,37) rotate(-90) scale(.88)">'+receptacle_head(mono)+'</g>')
 return ''.join(s)+(''.join(details) if not mono else '')

def body(family,view,cuff='red',leads=True):
 # Both views use exactly the same profile paths. E4 omits highlights/ribs only.
 mono=view=='e4'; metal='#fff' if mono else 'url(#metal)'; ins='#fff' if mono else f'url(#{cuff})'
 s=[]; details=[]
 def shape(d,fill=metal): s.append(path(d,fill))
 def detail(d): details.append(path(d,extra='class="detail"'))
 if leads:s.append(line(7,50,32,50,'class="wire"'))
 if family=='flag' or family.startswith('flag-bare-'):
  s.append(flag_body(family,mono,cuff))
 elif family.startswith('sleeve'):
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
  if family not in ('female','flag'):
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
   # Narrow 2.3 mm neck flares smoothly to the 6.6 mm rolled head.
   shape('M86 43.56 H90 C98 43.56 101 34.5 107.6 31.52 V68.48 C101 65.5 98 56.44 90 56.44 H86 Z')
   detail('M90 46 Q99 45 105 38 M90 54 Q99 55 105 62')
   s.append('<g transform="translate(107.6,50)">'+receptacle_head(mono)+'</g>')
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
manifest['receptacleRevision']={'date':'2026-10-15','reference':'codex-clipboard-af5ec56d-26e0-4073-9720-5d65b12e714e.png','headRatio':[7.3,6.6],'neckWidthRatio':2.3,'note':'Straight female proportions unchanged. Bare flags reuse a projected 90-degree metal head; insulated flag has a separate complete polymer shell.'}
manifest['profileReferences']={'C1':'codex-clipboard-99230161-c64b-4f61-a8d4-82cdf7de665d.png','C2':'codex-clipboard-264c60fd-81a9-4f6d-8a74-6fef23089339.png','C3':'codex-clipboard-95e2c17e-9767-4ea0-a922-72615987b6fb.png'}
manifest['viewContract']='same silhouette paths; E4 monochrome with reduced detail; drawing moderate gradients and stamped folds'
manifest['flagRevision']={'date':'2026-10-15','references':{'C1':'codex-clipboard-c79a2619-0c4f-4f4f-b776-fd8d82ab0573.png','C2':'codex-clipboard-cbe9281b-f537-420a-9cee-934ff16a733d.png','C3':'codex-clipboard-82516bcf-e1ff-459f-9497-6e34da26ec65.png','C4':'codex-clipboard-e9959775-cb16-458e-843d-fb46a7f5f527.png','C5':'codex-clipboard-c8fe8adc-8155-4eb6-92c3-d4717a3e38a3.png'},'observation':'C1/C2 open-wing crimp and large bridge window; C3 fully insulated elbow; C4 superseded wrong straight-cuff profile; C5 two distinct bare pressed tubes: smooth two-diameter and ribbed one-diameter','portPolicy':'one wire-entry at 32,50; receptacle opening is geometry only'}
manifest['flat2dRevision']={'date':'2026-10-15','references':{'C1':'codex-clipboard-1e6840a4-2b7d-4e8f-b846-85d3a98a8a60.png','C2':'codex-clipboard-48f88ebf-fc92-4343-a0a1-b61410ccc19a.png'},'openCrimp':'uniform head scale .7, head right edge x90 and top y1.384; compact curled wings; window x69..84/y30..45 directly beneath head, above second wing pair','pressed':'identical head placement for smooth/ribbed, uniform head scale .88; head underside y37 meets tube top y37; tube/head right edge x90; head top y1.0256; no side bridge','insulated':'flat orthographic L silhouette; solid fill, no gradients/opacity/face/loop curls; coplanar metal outline','ports':'existing id, one anchor (32,50), pivot (32,50), viewBox 220x100 unchanged'}
manifest['flagRevision']['status']='historical: profile geometry superseded by flat2dRevision'
manifest['insulatedFlagRevision']={'date':'2026-10-15','reference':'codex-clipboard-f8726991-e275-41a2-98f0-d305978b0667.png','sourceProfile':{'bounds':[15,25,476,436],'mainBody':[33,170,476,436],'shortInput':[15,25,180,180],'sourceInputCenter':[97.5,25]},'sourceToLocalMatrix':[0,-.12,.12,0,29,61.7],'scale':.12,'drawing':'flat 2D internal backing, window and two longitudinal spring edges below real fill-opacity .61 polymer; no face plate, arcs, perspective or gradients','e4':'monochrome silhouette only','port':'one unchanged anchor32,50, normal[-1,0], pivot32,50; top-entry sheet is rotation of same symbol'}
manifest['flat2dRevision']['insulatedStatus']='historical solid fill and long silhouette superseded by insulatedFlagRevision; bare profiles remain current'
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# Russian atlas: generous two-column cards, distinct views.
AW=1180; atlas_rows=(len(ITEMS)+1)//2; py=162+atlas_rows*210+18; AH=py+370
parts=[rect(0,0,AW,AH,'#f3f6fa'),text(28,45,'099 · Атлас оконцовок','title'),text(28,71,'Проектные символы Э4 и Чертежа · единая электрическая точка для каждого наконечника'),text(28,93,'Кольцо, вилка и сочленение не добавляют портов. Гильзы: только два крайних входа. ×2/×3/×4: аннотация.','small'),rect(28,109,1124,32,'#e1f0f8',8),anchor(45,125),text(59,129,'Синий якорь = вход провода; материал и геометрия не определяют связность. Масштаб изображений условный.','small')]
for i,(id,name,kind,family,dims,note) in enumerate(ITEMS):
 x=28+(i%2)*572;y=162+(i//2)*210
 parts.append(f'<g transform="translate({x},{y})">'+rect(0,0,552,192,PAPER,12)+text(18,28,name,'card-title')+text(18,49,note,'small')+text(18,70,'Э4 · условный вид','view')+text(292,70,'Чертёж · боковой / сверху','view')+f'<g transform="translate(8,69)">{symbol(family,"e4")}</g><g transform="translate(281,69)">{symbol(family,"drawing")}</g>'+text(18,178,'Размерные поля: '+dims,'small')+text(423,178,'2 края' if kind=='sleeve' else '1 вход','badge')+'</g>')
# compact eight preparation specimens
# py is derived from family count above
parts += [rect(28,py,1124,306,PAPER,12),text(46,py+29,'Универсальная «Разделка»','card-title'),text(46,py+52,'Чертёж: одна точка. Э4: восемь вариантов одного объекта; выбор сохраняется отдельно от геометрии.'),line(46,py+78,88,py+78,'class="wire"'),anchor(88,py+78),text(105,py+82,'общая точка Чертежа','small')]
for i,(key,label) in enumerate(VARIANTS):
 xx=46+(i%4)*272; yy=py+101+(i//4)*96
 parts += [text(xx,yy+13,label,'view'),f'<g transform="translate({xx},{yy+18}) scale(.88)">{prep_symbol(key,"e4")}</g>']
parts += [text(28,AH-27,'НВШ — alias с предложенной геометрией pin blade. C3 от 14.10.2026 — SC; DIN не подтверждён. Не нормативные УГО.','small')]
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
for i,(fam,label) in enumerate([('ring','НКИ · круглая головка / плавная шейка'),('fork','НВИ · U-вилка / параллельные зубцы'),('pin','Bullet male · закруглённый нос'),('socket','Bullet female · приёмная втулка'),('male','Flat male · штампованная лопатка'),('female','Flat female · пружинные завальцовки'),('flag','Флажковый · цельный Г-корпус'),('ferrule-double','НШВИ-2 · расширенный раструб')]):
 x=28+(i%2)*608;y=119+(i//2)*290
 large_scale=2.4 if fam=='flag' else 2.7
 large_x,large_y=(200,55) if fam=='flag' else (2,20)
 r += [rect(x,y,584,270,PAPER,10),text(x+18,y+28,label,'card-title'),text(x+18,y+49,'Чертёж · профиль по фото','view'),f'<g transform="translate({x+large_x},{y+large_y}) scale({large_scale})">{symbol(fam,"drawing",cuff="blue" if fam=="flag" else "red")}</g>',text(x+18,y+231,'Э4 · тот же внешний контур','view'),f'<g transform="translate({x+164},{y+191}) scale(.9)">{symbol(fam,"e4")}</g>']
cy=1304
r += [rect(28,cy,1192,250,PAPER,10),text(46,cy+31,'Манжеты · три цвета одного профиля','card-title')]
for i,(col,label) in enumerate([('red','красная'),('blue','синяя'),('yellow','жёлтая')]):
 xx=48+i*394
 r += [text(xx,cy+60,label,'view'),f'<g transform="translate({xx-7},{cy+66}) scale(1.8)">{symbol("ring","drawing",cuff=col)}</g>']
r += [text(46,cy+222,'Цвет не подтверждает диапазон сечения, материал или соответствие стандарту. Якори не изменены.','small'),text(28,1600,'Самостоятельные векторные профили по визуальным ориентирам владельца. Проектные символы; не нормативные УГО.','small')]
(OUT/'profile-detail.svg').write_text(shell('Оконцовки · увеличенные профили 15.10.2026',''.join(r),PDW,PDH),encoding='utf-8')

# Direct comparison of the two revised female forms.
RW,RH=1120,640
v=[rect(0,0,RW,RH,'#f3f6fa'),text(28,44,'Flat female и плоский изолированный флажок','title'),text(28,73,'Прямая головка: исторический референс 7,3 / 6,6 / 2,3. Флажок: плоский 2D Г-профиль.'),text(28,96,'Слева — открытая металлическая головка. Справа — компактный корпус C1, сквозь изоляцию читается плоский металл.','small')]
for i,(fam,label) in enumerate([('female','Прямая · Flat female'),('flag','Изолированный флажок · компактный C1')]):
 x=24+i*548;y=120
 v += [rect(x,y,524,450,PAPER,12),text(x+20,y+32,label,'card-title'),text(x+20,y+58,'Чертёж · открытый металл' if fam=='female' else 'Чертёж · цельная Г-изоляция','view'),f'<g transform="translate({x-10},{y+76}) scale(3)">{symbol(fam,"drawing",cuff="blue")}</g>',text(x+20,y+310,'Э4 · общий профиль и один якорь','view'),f'<g transform="translate({x+70},{y+320}) scale(1.65)">{symbol(fam,"e4")}</g>']
v += [text(28,601,'Прямая female сохранена. Изолированный флажок показан ортогонально без объёмного торца и дугообразных петель.','small'),text(28,622,'Синий круг — только вход провода. Приёмное гнездо и окна металлической части не являются портами.','small')]
(OUT/'receptacle-detail.svg').write_text(shell('Прямая и угловая плоские розетки',''.join(v),RW,RH),encoding='utf-8')

# Four stable flag families, plus color alternatives of the same insulated item.
FW2,FH2=1240,1445
f=[rect(0,0,FW2,FH2,'#f3f6fa'),text(28,44,'099 · Четыре конструкции флажкового контакта','title'),text(28,72,'Один вход провода слева. Ось сочленения вертикальна; гнездо не является дополнительным портом.'),text(28,94,'Последняя правка C1/C2: головка над основанием; трубка под головкой; изоляция строго плоская 2D.','small')]
flagitems=[('flag','Изолированный флажок · компактный C1','Короткий широкий ввод; полупрозрачная оболочка, металл в одной плоскости'),('flag-bare-open','Неизолированный обжимной · C1','Компактные крылья; окно под головкой над правой частью основания'),('flag-bare-pressed-smooth','Неизолированный опрессовочный · гладкий','C2: двухдиаметральная трубка тянется под головкой до её края'),('flag-bare-pressed-ribbed','Неизолированный опрессовочный · рифлёный','C2: однодиаметральная трубка с рёбрами под той же головкой')]
for i,(fam,label,note) in enumerate(flagitems):
 x=28+(i%2)*608;y=119+(i//2)*440
 f += [rect(x,y,584,420,PAPER,12),text(x+18,y+30,label,'card-title'),text(x+18,y+52,note,'small'),text(x+18,y+80,fam,'small'),f'<g transform="translate({x+20},{y+105}) scale(2.8)">{symbol(fam,"drawing",cuff="blue")}</g>',text(x+18,y+366,'Э4 · тот же профиль / один вход','view'),f'<g transform="translate({x+240},{y+315}) scale(1.25)">{symbol(fam,"e4")}</g>']
fy=1025
f += [rect(28,fy,1192,336,PAPER,12),text(46,fy+32,'Компактный профиль C1 · синяя и жёлтая полупрозрачная оболочка','card-title')]
for i,(col,label) in enumerate([('blue','Синий корпус'),('yellow','Жёлтый корпус')]):
 xx=46+i*596
 f += [text(xx,fy+58,label,'view'),f'<g transform="translate({xx+14},{fy+80}) scale(2.8)">{symbol("flag","drawing",cuff=col)}</g>']
f += [text(46,fy+309,'Цвет не подтверждает сечение. Контуры — проектная визуализация, без выдуманных размеров и нормативных заявлений.','small'),text(28,FH2-27,'flag сохранён как существующий ID; три неизолированных конструкции имеют собственные стабильные ID.','small')]
(OUT/'flag-variants.svg').write_text(shell('Четыре варианта флажковых наконечников',''.join(f),FW2,FH2),encoding='utf-8')

# Latest insulated-only photo comparison; top-entry is +90° rotation of the working symbol.
IW,IH=1240,1120
z=[rect(0,0,IW,IH,'#f3f6fa'),text(28,44,'099 · Изолированный флажок · пропорции нового C1','title'),text(28,72,'Пропорции корпуса и короткого широкого ввода сохранены по фотографии.'),text(28,95,'Плоский металл под настоящей полупрозрачной оболочкой. Без изометрии, торцевой площадки и дуг.','small')]
z += [rect(28,125,584,520,PAPER,12),text(46,158,'Как на фотографии · ввод сверху','card-title'),text(46,182,'Тот же рабочий символ, повёрнутый на +90°','small'),f'<g transform="translate(175,225) scale(6) rotate(90) translate(-32,-50)">{symbol("flag","drawing",cuff="blue",leads=False)}</g>',line(175,202,175,225,'class="wire"'),text(46,611,'Примерные пропорции широкого корпуса и короткого ввода сверены с фотографией.','small')]
z += [rect(636,125,584,520,PAPER,12),text(654,158,'Э4 · рабочая ориентация','card-title'),text(654,182,'Ввод слева · один якорь (32,50) · монохромный силуэт','small'),f'<g transform="translate(750,490) scale(6) translate(-32,-50)">{symbol("flag","e4",leads=False)}</g>',line(727,490,750,490,'class="wire"'),text(654,611,'Поворот вида не меняет ID, электрические связи или число портов.','small')]
for i,(col,label) in enumerate([('blue','Синяя оболочка · рабочий вид'),('yellow','Жёлтая оболочка · рабочий вид')]):
 x=28+i*608
 z += [rect(x,676,584,355,PAPER,12),text(x+18,709,label,'card-title'),f'<g transform="translate({x+165},956) scale(4) translate(-32,-50)">{symbol("flag","drawing",cuff=col,leads=False)}</g>',line(x+142,956,x+165,956,'class="wire"'),text(x+18,1006,'Металл в одной плоскости; заливка оболочки fill-opacity = 0,61.','small')]
z += [text(28,1067,'C1: codex-clipboard-f8726991-e275-41a2-98f0-d305978b0667.png. Цвет не задаёт сечение или материал.','small'),text(28,1094,'Профиль и масштаб — визуальная модель по фото; не размерный чертёж изделия и не нормативное УГО.','small')]
(OUT/'insulated-flag-detail.svg').write_text(shell('Изолированный флажок по новому C1',''.join(z),IW,IH),encoding='utf-8')

# structural validation, deterministic and no external packages required
for p in OUT.glob('*.svg'):
 root=ET.parse(p).getroot(); ids=[n.get('id') for n in root.iter() if n.get('id')];assert len(ids)==len(set(ids)), ('duplicate ids',p.name)
for a in manifest['assets']:
 for view,file in a['views'].items():
  root=ET.parse(OUT/file).getroot(); found=[n for n in root.iter() if n.get('data-role')=='wire-entry'];assert len(found)==a['electricalPointCount'],(a['id'],view)
  for expected in a['anchors']:
   node=next(n for n in found if n.get('id')==expected['id']);assert float(node.get('cx'))==expected['x'] and float(node.get('cy'))==expected['y']
print(f'OK: {len(manifest["assets"])} assets, 8 preparation variants, {len(list(OUT.glob("*.svg")))} valid SVGs; anchor coordinates verified')
