from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math
OUT=Path('design/references/harness-cross-sections/v2')
W,H=1800,1200
OD={30:.89,28:.99,26:1.08,24:1.23,22:1.42,20:1.62}
COL=['#eb6b3f','#4c88c7','#88bf3f','#be63a5','#ce9647','#3da09d','#8a6ac2','#d85f5f','#6a8799','#d6ad39']
SETS=[[30,28],[26,30,24],[30,28,24,22],[20,30,26,28,24]]

def font(n,b=False):
  try:return ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf' if b else 'C:/Windows/Fonts/segoeui.ttf',n)
  except:return ImageFont.load_default()
T,S,H2,BODY,SM,MONO=font(34,1),font(17),font(20,1),font(15),font(12),font(13,1)
def tx(d,x,y,s,f=BODY,c='#18333a',anchor='la'): d.text((x,y),s,font=f,fill=c,anchor=anchor)
def tangent(ws):
  ws=sorted(ws,reverse=True); rows=[]; rest=list(ws)
  for n in (1,2,3,4):
    if not rest: break
    rows.append(rest[:n]); rest=rest[n:]
  while rest: rows.append(rest[:4]); rest=rest[4:]
  out=[]; y=0
  for row in rows:
    x=0
    for i,w in enumerate(row):
      r=OD[w]/2; x=r if i==0 else x+OD[row[i-1]]/2+r; out.append((x,y,r,w))
    y += max(OD[w]/2 for w in row)*2
  minx=min(x-r for x,y,r,w in out); miny=min(y-r for x,y,r,w in out)
  return [(x-minx,y-miny,r,w) for x,y,r,w in out]
def extent(ws,extra=0):
  p=tangent(ws); return max(max(x+r for x,y,r,w in p)-min(x-r for x,y,r,w in p),max(y+r for x,y,r,w in p)-min(y-r for x,y,r,w in p))+extra
def base(title,sub,accent='#1b7e88',dark=False):
  im=Image.new('RGB',(W,H),'#f5f8f9' if not dark else '#17252a'); d=ImageDraw.Draw(im)
  for x in range(40,W-40,24): d.line((x,40,x,H-40),fill='#e3eaed' if not dark else '#263940')
  for y in range(40,H-40,24): d.line((40,y,W-40,y),fill='#e3eaed' if not dark else '#263940')
  if dark:
    tx(d,100,92,title,T,'#eef6f7'); tx(d,100,142,sub,S,'#a3bbc0')
  else:
    d.rounded_rectangle((82,72,1718,186),18,fill='white',outline='#d5e0e4'); d.rounded_rectangle((82,72,94,186),6,fill=accent); tx(d,120,98,title,T); tx(d,120,144,sub,S,'#63777e')
  return im
def layer(d,cx,cy,r,kind):
  if kind=='nylon':
    d.ellipse((cx-r,cy-r,cx+r,cy+r),fill='#c5e5e6',outline='#0d7780',width=3)
    for a in range(0,360,15):
      x1=cx+math.cos(math.radians(a))*r; y1=cy+math.sin(math.radians(a))*r; x2=cx+math.cos(math.radians(a+45))*r; y2=cy+math.sin(math.radians(a+45))*r; d.line((x1,y1,x2,y2),fill='#4a9aa1',width=1)
  elif kind=='heat': d.ellipse((cx-r,cy-r,cx+r,cy+r),fill='#f3dba6',outline='#b27515',width=3)
  elif kind=='screen':
    d.ellipse((cx-r,cy-r,cx+r,cy+r),fill='#c7cdd0',outline='#26363d',width=3)
    for a in range(0,360,12):
      x1=cx+math.cos(math.radians(a))*r; y1=cy+math.sin(math.radians(a))*r; x2=cx+math.cos(math.radians(a+30))*r; y2=cy+math.sin(math.radians(a+30))*r; d.line((x1,y1,x2,y2),fill='#7b8a8e',width=1)
def cross(d,cx,cy,ws,kind='bare',scale=28,screen=False):
  extra=(.65 if kind=='nylon' else 1.1 if kind=='heat' else 0)+(0.35 if screen else 0)
  outer=extent(ws,extra); r=outer*scale/2
  if screen: layer(d,cx,cy,r,'screen'); r*=.88
  if kind!='bare': layer(d,cx,cy,r,kind)
  p=tangent(ws); minx=min(x-r0 for x,y,r0,w in p); miny=min(y-r0 for x,y,r0,w in p)
  for i,(x,y,rr,w) in enumerate(p):
    px=cx+(x-minx)*scale; py=cy+(y-miny)*scale; rad=rr*scale
    d.ellipse((px-rad,py-rad,px+rad,py+rad),fill=COL[i%len(COL)],outline='#24363d',width=2)
    d.ellipse((px-rad*.22,py-rad*.22,px+rad*.22,py+rad*.22),fill='#d29a35',outline='#795b1a',width=1)
def orthographic(d,x,y,w,ws,kind='bare',screen=False):
  # Strict orthographic top projection: no diagonal perspective, no tapered ends, fixed-height rectangular envelope.
  h=74; cy=y+h/2; outer=extent(ws,(.65 if kind=='nylon' else 1.1 if kind=='heat' else 0)+(0.35 if screen else 0))
  if screen:
    d.rectangle((x,cy-h/2,x+w,cy+h/2),fill='#c7cdd0',outline='#26363d',width=2)
    for xx in range(x+8,x+w,12): d.line((xx,cy-h/2,xx,cy+h/2),fill='#77858a',width=1)
  if kind!='bare': d.rectangle((x+8,cy-h/2+5,x+w-8,cy+h/2-5),fill='#c5e5e6' if kind=='nylon' else '#f3dba6',outline='#0d7780' if kind=='nylon' else '#b27515',width=2)
  visible=ws[:max(1,math.ceil(len(ws)*.65))]
  for i,wg in enumerate(visible):
    yy=cy+(i-(len(visible)-1)/2)*11; d.line((x+18,yy,x+w-18,yy),fill=COL[i%len(COL)],width=max(5,int(OD[wg]*3)))
  if len(visible)<len(ws): tx(d,x+w-14,cy+17,f'видно {len(visible)} из {len(ws)}',SM,'#60767c','ra')
  tx(d,x+w/2,cy+53,f'Ø {outer:.2f} мм · 120 мм',SM,'#60767c','ma')
def row(d,y,title,ws,kind='bare',screen=False,dark=False):
  fill='#24373d' if dark else 'white'; outline='#496169' if dark else '#d5e1e5'; d.rounded_rectangle((82,y,1718,y+170),16,fill=fill,outline=outline,width=1)
  tx(d,112,y+20,title,H2,'#eef6f7' if dark else '#19343b'); tx(d,112,y+54,'UL1061 · '+' / '.join(map(str,ws))+' AWG',MONO,'#b5cdd2' if dark else '#28454d'); cross(d,230,y+102,ws,kind,22 if dark else 22,screen); orthographic(d,410,y+65,1220,ws,kind,screen)
  tx(d,112,y+143,'поперечник',SM,'#9ab4bb' if dark else '#60767c'); tx(d,230,y+143,'слой оболочки',SM,'#9ab4bb' if dark else '#60767c'); tx(d,410,y+143,'строгая ортографическая проекция сверху',SM,'#9ab4bb' if dark else '#60767c')
# A
im=base('UL1061 · ортографические сечения и 2D-проекция','Без изометрии: одинаковый масштаб по длине, параллельные линии, фронтальный круг сечения.','#1b7e88'); d=ImageDraw.Draw(im); tx(d,112,222,'Вариант A · слоистый каталог',H2); tx(d,112,254,'Референсная структура: проводник → изоляция → внутренняя оболочка → экран → внешняя оболочка.',SM,'#63777e')
for i,ws in enumerate(SETS): row(d,286+i*184,f'{len(ws)} провода',ws,'heat',True)
im.save(OUT/'option-a-orthographic-layered.png')
# B
im=base('UL1061 · ортографический плотный жгут','Плотная касательная укладка с заполнителями и экраном; боковой вид строго сверху.','#d49a32',True); d=ImageDraw.Draw(im); tx(d,100,210,'Вариант B · инженерная плотная укладка',H2,'#eef6f7'); tx(d,100,248,'Без перспективы и без сходящихся линий: только фронтальный круг и прямоугольная проекция длины.',SM,'#a3bbc0')
for i,ws in enumerate(SETS): row(d,282+i*184,f'{len(ws)} провода',ws,'nylon',True,True)
im.save(OUT/'option-b-orthographic-dense.png')
# C
im=base('UL1061 · ортографическое сравнение оболочек','Один набор жил в трёх исполнениях: без оболочки, нейлоновая оплётка, термоусадка.','#5e82a8'); d=ImageDraw.Draw(im); tx(d,112,222,'Вариант C · сравнение оболочек',H2); tx(d,112,254,'Каждая строка — одинаковый набор проводов; меняется только полупрозрачный внешний слой.',SM,'#63777e')
cols=[('Без оболочки','bare',80),('Нейлоновая оплётка','nylon',650),('Нейлонка + термоусадка','heat',1220)]
for title,kind,x in cols:
 d.rounded_rectangle((x,286,x+500,1110),16,fill='white',outline='#d5e1e5'); tx(d,x+22,310,title,H2); tx(d,x+22,344,'строгая проекция сверху',SM,'#63777e')
 for i,ws in enumerate(SETS):
  y=390+i*170; tx(d,x+22,y,f'{len(ws)} провода',H2); cross(d,x+112,y+66,ws,kind,17,screen=(kind!='bare')); orthographic(d,x+205,y+30,260,ws,kind,screen=(kind!='bare'))
im.save(OUT/'option-c-orthographic-sheaths.png')
print('ok')

