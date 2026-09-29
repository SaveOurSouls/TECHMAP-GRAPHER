from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math
OUT=Path('design/references/harness-cross-sections/v3')
W,H=1600,1050
OD={30:.89,28:.99,26:1.08,24:1.23,22:1.42,20:1.62}
RING=['#f58220','#d92d73','#1fa44a','#3f42d9','#0aa7c4']
SETS=[[30,28],[26,30,24],[30,28,24,22],[20,30,26,28,24]]
def font(n,b=False):
 try:return ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf' if b else 'C:/Windows/Fonts/segoeui.ttf',n)
 except:return ImageFont.load_default()
Ftitle=font(28,True); Fsmall=font(14); Frow=font(16,True)
def arrow(d,x1,y,x2):
 d.line((x1,y,x2-22,y),fill='black',width=12); d.polygon([(x2,y),(x2-28,y-22),(x2-28,y+22)],fill='black')
def positions(n,cx,cy,r):
 if n==2:return [(cx-r,cy),(cx+r,cy)]
 if n==3:return [(cx,cy-r*0.86),(cx-r*0.86,cy+r*0.5),(cx+r*0.86,cy+r*0.5)]
 if n==4:return [(cx-r*0.86,cy-r*0.86),(cx+r*0.86,cy-r*0.86),(cx-r*0.86,cy+r*0.86),(cx+r*0.86,cy+r*0.86)]
 return [(cx-r*0.86,cy-r*0.86),(cx+r*0.86,cy-r*0.86),(cx+r*0.86,cy+r*0.86),(cx,cy+r*1.13),(cx-r*0.86,cy+r*0.86)]
def cross(d,cx,cy,ws,kind):
 outer=90
 if kind=='nylon': d.ellipse((cx-outer-8,cy-outer-8,cx+outer+8,cy+outer+8),fill='#bce8e9',outline='black',width=7)
 elif kind=='heat':
  d.ellipse((cx-outer-14,cy-outer-14,cx+outer+14,cy+outer+14),fill='#f6d48e',outline='black',width=8)
  d.ellipse((cx-outer-5,cy-outer-5,cx+outer+5,cy+outer+5),outline='#1ea4b6',width=5)
 else: d.ellipse((cx-outer,cy-outer,cx+outer,cy+outer),fill='white',outline='black',width=8)
 r=30; pos=positions(len(ws),cx,cy,r)
 for i,(x,y) in enumerate(pos):
  d.ellipse((x-r,y-r,x+r,y+r),fill=RING[i],outline='black',width=4)
  d.ellipse((x-r+13,y-r+13,x+r-13,y+r-13),fill='white')
def side(d,x,y,w,ws,kind):
 n=len(ws); gap=3; band=30; total=n*band+(n-1)*gap; top=y+52-total/2
 # Outer jacket and translucent sleeve
 if kind=='bare':
  d.rounded_rectangle((x-8,top-8,x+w+8,top+total+8),8,fill='black')
 elif kind=='nylon':
  d.rounded_rectangle((x-12,top-12,x+w+12,top+total+12),8,fill='#bce8e9',outline='black',width=7)
  d.rounded_rectangle((x-4,top-4,x+w+4,top+total+4),5,fill='white',outline='#1b9eaa',width=4)
 elif kind=='heat':
  d.rounded_rectangle((x-14,top-14,x+w+14,top+total+14),8,fill='#f6d48e',outline='black',width=8)
  d.rounded_rectangle((x-7,top-7,x+w+7,top+total+7),5,fill='#bce8e9',outline='#1b9eaa',width=5)
 for i,wg in enumerate(ws):
  yy=top+i*(band+gap); col=RING[i]
  d.rounded_rectangle((x,yy,x+w,yy+band),5,fill=col,outline='black',width=3)
  d.rectangle((x+13,yy+10,x+w-13,yy+band-10),fill='white')

def make(kind,name,title):
 im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im)
 d.rounded_rectangle((40,36,W-40,H-36),20,outline='#d5dde0',width=2)
 d.text((78,65),title,font=Ftitle,fill='#183238')
 d.text((78,106),'Направление вида',font=Fsmall,fill='#6a777c')
 for i,ws in enumerate(SETS):
  y=230+i*185; arrow(d,80,y,190); cross(d,315,y,ws,kind); side(d,575,y,760,ws,kind); d.text((470,y-10),f'{len(ws)}',font=Frow,fill='#183238',anchor='mm')
  d.text((1365,y-10),f'{len(ws)} провод'+('' if len(ws)==1 else 'а'),font=Fsmall,fill='#6a777c',anchor='lm')
 d.text((78,982),'Круг — поперечное сечение. Справа — ортогональная проекция сверху без перспективы.',font=Fsmall,fill='#6a777c')
 im.save(OUT/name)
make('bare','01-reference-style-bare.png','UL1061 · без общей оболочки')
make('nylon','02-reference-style-nylon.png','UL1061 · полупрозрачная нейлоновая оплётка')
make('heat','03-reference-style-nylon-heatshrink.png','UL1061 · нейлонка и термоусадка')
print('ok')

