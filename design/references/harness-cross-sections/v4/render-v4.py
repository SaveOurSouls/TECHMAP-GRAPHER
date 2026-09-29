from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math, json
OUT=Path('design/references/harness-cross-sections/v4'); OUT.mkdir(parents=True,exist_ok=True)
W,H=1600,1050
OD={30:.89,28:.99,26:1.08,24:1.23,22:1.42,20:1.62}
COL=['#f58220','#d92d73','#1fa44a','#3f42d9','#0aa7c4']
SETS=[[30,28],[26,30,24],[30,28,24,22],[20,30,26,28,24]]

def F(n,b=False):
 try:return ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf' if b else 'C:/Windows/Fonts/segoeui.ttf',n)
 except:return ImageFont.load_default()
TITLE,SM,ROW=F(28,1),F(14),F(16,1)
def seed(n):
 return {2:[(-1,0),(1,0)],3:[(0,-.9),(-.95,.72),(.95,.72)],4:[(-.7,-.7),(.7,-.7),(-.7,.7),(.7,.7)],5:[(-.74,-.72),(.74,-.72),(-.94,.52),(0,.88),(.94,.52)]}[n]
def feasible(ws,s):
 rs=[OD[w]/2 for w in ws]; pp=seed(len(ws)); cx=sum(x for x,y in pp)/len(pp); cy=sum(y for x,y in pp)/len(pp); p=[((x-cx)*s,(y-cy)*s) for x,y in pp]
 return all(math.hypot(p[i][0]-p[j][0],p[i][1]-p[j][1]) >= rs[i]+rs[j]-1e-8 for i in range(len(ws)) for j in range(i))
def pack(ws):
 lo,hi=.0,5.0
 for _ in range(70):
  mid=(lo+hi)/2
  if feasible(ws,mid): hi=mid
  else: lo=mid
 s=hi; rs=[OD[w]/2 for w in ws]; pp=seed(len(ws)); cx=sum(x for x,y in pp)/len(pp); cy=sum(y for x,y in pp)/len(pp); p=[((x-cx)*s,(y-cy)*s) for x,y in pp]
 # optimize enclosing circle center for the fixed tangent packing
 ux=sum(x for x,y in p)/len(p); uy=sum(y for x,y in p)/len(p); step=1.0
 def radius(x,y): return max(math.hypot(px-x,py-y)+r for (px,py),r in zip(p,rs))
 best=radius(ux,uy)
 for _ in range(20):
  cand=(ux,uy,best)
  for dx,dy in ((step,0),(-step,0),(0,step),(0,-step),(step,step),(-step,step),(step,-step),(-step,-step)):
   rr=radius(ux+dx,uy+dy)
   if rr<cand[2]: cand=(ux+dx,uy+dy,rr)
  ux,uy,best=cand; step*=.55
 base=list(zip(p,rs,ws))
 # Rotate the same tangent packing to maximize visible first-hit segments.
 best_choice=None
 for deg in range(0,180,2):
  a=math.radians(deg); ca,sa=math.cos(a),math.sin(a)
  rp=[]
  for (px,py),r,w in base:
   rp.append(((px*ca-py*sa,px*sa+py*ca),r,w))
  rox=ux*ca-uy*sa; roy=ux*sa+uy*ca
  try:
   seg=projection_segments(rp,(rox,roy,best))
   uniq=len(set(idx for idx,_,_ in seg)); score=(uniq,-len(seg),-deg)
  except NameError:
   score=(0,0,-deg)
  if best_choice is None or score>best_choice[0]: best_choice=(score,rp,(rox,roy,best))
 return best_choice[1],best_choice[2]
def tx(d,x,y,s,f=SM,c='#263b40',anchor='la'): d.text((x,y),s,font=f,fill=c,anchor=anchor)
def arrow(d,x1,y,x2): d.line((x1,y,x2-22,y),fill='black',width=12); d.polygon([(x2,y),(x2-28,y-22),(x2-28,y+22)],fill='black')
def draw_pack(d,cx,cy,ws,kind):
 items,(ox,oy,R)=pack(ws); scale=33
 # outer envelope is the minimum enclosing circle for the packed centers
 if kind=='bare': d.ellipse((cx-R*scale,cy-R*scale,cx+R*scale,cy+R*scale),fill='white',outline='black',width=8)
 elif kind=='nylon': d.ellipse((cx-R*scale,cy-R*scale,cx+R*scale,cy+R*scale),fill='#bce8e9',outline='black',width=8)
 else:
  d.ellipse((cx-(R+.16)*scale,cy-(R+.16)*scale,cx+(R+.16)*scale,cy+(R+.16)*scale),fill='#f6d48e',outline='black',width=8)
  d.ellipse((cx-(R+.06)*scale,cy-(R+.06)*scale,cx+(R+.06)*scale,cy+(R+.06)*scale),outline='#1ba5b7',width=5)
 for i,((x,y),r,w) in enumerate(items):
  px=cx+(x-ox)*scale; py=cy+(y-oy)*scale; rr=r*scale
  d.ellipse((px-rr,py-rr,px+rr,py+rr),fill=COL[i],outline='black',width=4)
  d.ellipse((px-rr+13,py-rr+13,px+rr-13,py+rr-13),fill='white')
def projection_segments(items, outer):
 # Ray cast from left to right through the cross-section. For each scanline
 # perpendicular to the viewing direction, keep only the first wire hit.
 ox, oy, _ = outer
 samples=260
 y0=oy-outer[2]; y1=oy+outer[2]
 visible=[]
 for k in range(samples):
  sy=y0+(k+0.5)*(y1-y0)/samples
  hits=[]
  for idx,((cx,cy),r,w) in enumerate(items):
   dy=sy-cy
   if abs(dy)<=r:
    xleft=cx-math.sqrt(max(0.0,r*r-dy*dy))
    hits.append((xleft,idx))
  visible.append(min(hits)[1] if hits else None)
 seg=[]; cur=None; first=0
 for k,val in enumerate(visible+[None]):
  if val!=cur:
   if cur is not None: seg.append((cur,first,k))
   cur=val; first=k
 return seg

def side(d,x,y,w,ws,kind,items,outer):
 # Orthographic projection generated from first-hit ray casting.
 _,_,R=outer; h=max(86,int(2*R*33)); top=y+52-h/2
 if kind=='bare':
  d.rounded_rectangle((x-8,top-8,x+w+8,top+h+8),8,fill='black')
 elif kind=='nylon':
  d.rounded_rectangle((x-12,top-12,x+w+12,top+h+12),8,fill='#bce8e9',outline='black',width=7)
  d.rounded_rectangle((x-4,top-4,x+w+4,top+h+4),5,fill='white',outline='#1b9eaa',width=4)
 else:
  d.rounded_rectangle((x-14,top-14,x+w+14,top+h+14),8,fill='#f6d48e',outline='black',width=8)
  d.rounded_rectangle((x-7,top-7,x+w+7,top+h+7),5,fill='#bce8e9',outline='#1b9eaa',width=5)
 segments=projection_segments(items,outer)
 for idx,a,b in segments:
  yy1=top+a*h/260; yy2=top+b*h/260
  if yy2-yy1<6: continue
  d.rounded_rectangle((x,yy1,x+w,yy2),5,fill=COL[idx],outline='black',width=3)
  inset=min(13,max(2,(yy2-yy1)*.22)); inset=min(inset,(yy2-yy1)/2-1)
  d.rectangle((x+inset,yy1+inset*.65,x+w-inset,yy2-inset*.65),fill='white')
def render(kind,name,title):
 im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im); d.rounded_rectangle((40,36,W-40,H-36),20,outline='#d5dde0',width=2); tx(d,78,65,title,TITLE); tx(d,78,106,'Стрелка задаёт направление вида; окружности упакованы в минимальный внешний контур.',SM,'#6a777c')
 measures=[]
 for i,ws in enumerate(SETS):
  y=230+i*185; arrow(d,80,y,190); items,outer=pack(ws); draw_pack(d,315,y,ws,kind); side(d,575,y,760,ws,kind,items,outer); tx(d,470,y-10,f'{len(ws)}',ROW,'#183238','mm'); tx(d,1365,y-10,f'{len(ws)} провод'+('' if len(ws)==1 else 'а'),SM,'#6a777c','lm'); items,(ox,oy,R)=pack(ws); segments=projection_segments(items,(ox,oy,R)); measures.append({'count':len(ws),'awg':ws,'outer_diameter_mm':round(2*R,3),'projection_segments':len(segments),'tangent_min_gap_mm':round(min(math.hypot(items[i][0][0]-items[j][0][0],items[i][0][1]-items[j][0][1])-items[i][1]-items[j][1] for i in range(len(items)) for j in range(i)),6)})
 tx(d,78,982,'Критерий: соседние окружности касаются; весь набор вписан в минимальную внешнюю окружность.',SM,'#6a777c'); im.save(OUT/name); return measures
allm={}
allm['bare']=render('bare','01-packed-reference-bare.png','UL1061 · плотная упаковка без оболочки')
allm['nylon']=render('nylon','02-packed-reference-nylon.png','UL1061 · плотная упаковка под нейлонкой')
allm['heat']=render('heat','03-packed-reference-nylon-heatshrink.png','UL1061 · плотная упаковка под нейлонкой и термоусадкой')
(OUT/'packing-metrics.json').write_text(json.dumps(allm,ensure_ascii=False,indent=2),encoding='utf-8')
print('ok')


