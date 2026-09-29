from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math
OUT=Path('design/references/harness-cross-sections'); W,H=1800,1200
OD={30:.89,28:.99,26:1.08,24:1.23,22:1.42,20:1.62}; C=['#e05252','#2f6eb5','#e4b84d','#5aa86b','#9a68b8','#db7d45','#2e9c9c','#d45a8a','#59677b','#cb9743']
B=[[30],[30,28],[26,30,24],[30,28,24,22],[20,30,26,28,24],[22,30,28,26,24,20],[30,28,24,22,20,30,26],[28,24,22,20,30,26,28,24],[30,28,26,24,22,20,30,26,24],[30,28,26,24,22,20,30,28,26,24]]
def F(n,b=0):
 try:return ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf' if b else 'C:/Windows/Fonts/segoeui.ttf',n)
 except:return ImageFont.load_default()
T,S,SS,BODY,SM,MONO=F(34,1),F(17),F(18,1),F(15),F(12),F(13,1)
def txt(d,x,y,s,f=BODY,fill='#2b4148'): d.text((x,y),s,font=f,fill=fill)
def pack(ws):
 rows=[]; rest=list(ws)
 for n in (1,2,3,4):
  if not rest: break
  rows.append(rest[:n]); rest=rest[n:]
 while rest: rows.append(rest[:4]); rest=rest[4:]
 out=[]; y=0
 for row in rows:
  x=0
  for i,w in enumerate(row):
   r=OD[w]/2
   x = r if i==0 else x+OD[row[i-1]]/2+r
   out.append((x,y,r,w))
  y += max(OD[w]/2 for w in row)*2
 minx=min(a-r for a,b,r,w in out); miny=min(b-r for a,b,r,w in out)
 return [(a-minx,b-miny,r,w) for a,b,r,w in out]
def dims(ws,s='none'):
 p=pack(ws); core=max(max(a+r for a,b,r,w in p)-min(a-r for a,b,r,w in p),max(b+r for a,b,r,w in p)-min(b-r for a,b,r,w in p)); extra=.62 if s=='nylon' else 1.02 if s=='heat' else 0; return core,core+extra
def grid(im):
 d=ImageDraw.Draw(im)
 for x in range(40,W-40,24): d.line((x,40,x,H-40),fill='#e6edf0')
 for y in range(40,H-40,24): d.line((40,y,W-40,y),fill='#e6edf0')
def base(title,sub,accent):
 im=Image.new('RGB',(W,H),'#f8fbfc'); grid(im); d=ImageDraw.Draw(im); d.rounded_rectangle((82,76,1718,186),18,fill='white'); d.rounded_rectangle((82,76,94,186),6,fill=accent); txt(d,120,96,title,T,'#17343b'); txt(d,120,146,sub,S,'#60747b'); return im
def cross(d,cx,cy,ws,s='none',scale=28):
 core,outer=dims(ws,s); p=pack(ws)
 if s=='nylon':
  r=outer*scale/2; d.ellipse((cx-r,cy-r,cx+r,cy+r),fill='#bfe2e5',outline='#117b87',width=2)
  for a in range(0,360,14):
   x1=cx+math.cos(math.radians(a))*r; y1=cy+math.sin(math.radians(a))*r; x2=cx+math.cos(math.radians(a+50))*r; y2=cy+math.sin(math.radians(a+50))*r; d.line((x1,y1,x2,y2),fill='#5baeb6',width=1)
 if s=='heat':
  r=outer*scale/2; d.ellipse((cx-r,cy-r,cx+r,cy+r),fill='#f8dfaa',outline='#b97812',width=2)
 for i,(x,y,r,awg) in enumerate(p):
  px=cx+x*scale; py=cy+y*scale; rr=r*scale; d.ellipse((px-rr,py-rr,px+rr,py+rr),fill=C[i%len(C)],outline='white',width=2); cr=max(2,rr*.22); d.ellipse((px-cr,py-cr,px+cr,py+cr),fill='#d5a53f',outline='#9c6e18')
def side(d,x,y,w,ws,s='none'):
 cy=y+44; visible=ws[:max(1,math.ceil(len(ws)*.65))]
 if s=='nylon': d.rounded_rectangle((x,cy-32,x+w,cy+32),22,fill='#c5e6e8',outline='#117b87',width=2); txt(d,x+12,cy-48,'нейлонка · полупрозрачная',SM,'#60747b')
 if s=='heat': d.rounded_rectangle((x,cy-32,x+w,cy+32),22,fill='#f7e0ad',outline='#b97812',width=2); txt(d,x+12,cy-48,'термоусадка · полупрозрачная',SM,'#60747b')
 for i,awg in enumerate(visible):
  yy=cy+(i-(len(visible)-1)/2)*10; pts=[(x+14,yy),(x+w*.28,yy+(3 if i%2 else -3)),(x+w*.67,yy+(2 if i%3 else -2)),(x+w-14,yy)]; d.line(pts,fill=C[i%len(C)],width=max(4,int(OD[awg]*3)),joint='curve')
 if len(visible)<len(ws): txt(d,x+w-170,cy+12,f'видно {len(visible)} из {len(ws)}',SM,'#60747b')
 _,o=dims(ws,s); d.line((x,cy+48,x+w,cy+48),fill='#9aa9ae'); txt(d,x+w/2-80,cy+56,f'120 мм · Ø {o:.2f} мм',SM,'#5d7077')
def card(d,x,y,w,h,idx,ws,s='none'):
 d.rounded_rectangle((x,y,x+w,y+h),18,fill='white',outline='#d8e4e8'); txt(d,x+24,y+16,f'{idx}. {len(ws)} провод'+('' if len(ws)==1 else 'а'),SS,'#17343b'); txt(d,x+24,y+43,'UL1061 · '+' / '.join(map(str,ws))+' AWG',MONO,'#17343b'); cross(d,x+88,y+92,ws,s,16 if s=='none' else 18); _,o=dims(ws,s); txt(d,x+24,y+114,f'Ø {o:.2f} мм',SM,'#5d7077'); side(d,x+280,y+48,w-310,ws,s)
# Sheet 1
im=base('UL1061 · поперечные сечения 1–10 проводов','Касательная укладка без перекрытий. 2D-вид сбоку — условная проекция сверху.','#0f6b78'); d=ImageDraw.Draw(im); txt(d,112,226,'Поперечное сечение',SS,'#17343b'); txt(d,378,226,'2D-вид сбоку · вид сверху',SS,'#17343b'); txt(d,112,254,'Ориентировочные наружные диаметры: 30 AWG 0,89 · 28 AWG 0,99 · 26 AWG 1,08 · 24 AWG 1,23 · 22 AWG 1,42 · 20 AWG 1,62 мм',SM,'#60747b')
for i,ws in enumerate(B): card(d,98+(i%2)*800,284+(i//2)*158,760,142,i+1,ws)
txt(d,112,1125,'Все окружности касаются соседних. Наружный диаметр зависит от производителя и цвета; сверяйте с каталогом.',SM,'#60747b'); im.save(OUT/'01-ul1061-1-10.png')
# Sheets 2-3
def sheath(name,title,sub,s,accent,note):
 im=base(title,sub,accent); d=ImageDraw.Draw(im); txt(d,112,226,'Поперечное сечение',SS,'#17343b'); txt(d,378,226,'2D-вид сбоку · условная проекция сверху',SS,'#17343b'); txt(d,112,254,note,SM,'#60747b'); sets=[[30,28],[26,30,24],[30,28,24,22],[20,30,26,28,24]]
 for i,ws in enumerate(sets): card(d,98,284+i*178,1604,160,i+2,ws,s)
 d.rounded_rectangle((98,1044,1702,1122),16,fill='white',outline='#d8e4e8'); txt(d,122,1068,'Нейлоновая оплётка: стенка ≈ 0,30 мм · зазор ≈ 0,50 мм' if s=='nylon' else 'Термоусадка: стенка после усадки ≈ 0,45 мм · внутренний диаметр до усадки выбирается с запасом',SM,'#2b4148'); txt(d,122,1095,'Оболочка полупрозрачная; нижние провода в боковой проекции намеренно скрыты верхними слоями.',SM,'#60747b'); im.save(OUT/name)
sheath('02-ul1061-nylon-braid.png','UL1061 · 2–5 проводов под нейлоновой оплёткой','Касательная укладка внутри полупрозрачной оболочки.','nylon','#188b99','Номинальный внутренний диаметр оплётки = габарит пучка + 0,50 мм; сетка условная.')
sheath('03-ul1061-nylon-plus-heatshrink.png','UL1061 · 2–5 проводов под нейлонкой и термоусадкой','Два слоя оболочки; внешняя термоусадка полупрозрачная.','heat','#b97812','В поперечнике видны проводники, зазор и внешний контур; окружности проводов не перекрываются.')
print('rendered')



