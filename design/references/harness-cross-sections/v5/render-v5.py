from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
from functools import lru_cache
from itertools import combinations, permutations
import math, json
OUT=Path('design/references/harness-cross-sections/v5'); OUT.mkdir(parents=True,exist_ok=True)
W,H=1600,1050
OD={30:.89,28:.99,26:1.08,24:1.23,22:1.42,20:1.62}
COL=['#f58220','#d92d73','#1fa44a','#3f42d9','#0aa7c4']
SETS=[[30,28],[26,30,24],[30,28,24,22],[20,30,26,28,24]]

def F(n,b=False):
 try:return ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf' if b else 'C:/Windows/Fonts/segoeui.ttf',n)
 except:return ImageFont.load_default()
TITLE,SM,ROW=F(28,1),F(14),F(16,1)
def tx(d,x,y,s,f=SM,c='#263b40',anchor='la'): d.text((x,y),s,font=f,fill=c,anchor=anchor)
def lattice_points():
 pts=[]
 for i in range(-2,3):
  for j in range(-2,3):
   x=i+j*.5; y=j*math.sqrt(3)/2
   if math.hypot(x,y)<=2.7: pts.append((x,y))
 return pts
PTS=lattice_points()
def enclosing(p,rs):
 ux=sum(x for x,y in p)/len(p); uy=sum(y for x,y in p)/len(p); step=1.0
 def radius(x,y): return max(math.hypot(px-x,py-y)+r for (px,py),r in zip(p,rs))
 best=radius(ux,uy)
 for _ in range(28):
  cand=(ux,uy,best)
  for dx,dy in ((step,0),(-step,0),(0,step),(0,-step),(step,step),(-step,step),(step,-step),(-step,-step)):
   rr=radius(ux+dx,uy+dy)
   if rr<cand[2]: cand=(ux+dx,uy+dy,rr)
  ux,uy,best=cand; step*=.55
 return ux,uy,best
def circle_intersections(c1,r1,c2,r2):
 x1,y1=c1; x2,y2=c2; dx=x2-x1; dy=y2-y1; d=math.hypot(dx,dy)
 if d<1e-9 or d>r1+r2+1e-8 or d<abs(r1-r2)-1e-8: return []
 a=(r1*r1-r2*r2+d*d)/(2*d); h2=r1*r1-a*a
 if h2<-1e-8: return []
 h=math.sqrt(max(0,h2)); xm=x1+a*dx/d; ym=y1+a*dy/d
 rx=-dy*h/d; ry=dx*h/d
 return [(xm+rx,ym+ry),(xm-rx,ym-ry)] if h>1e-8 else [(xm,ym)]

def valid_position(pos,r,placed):
 return all(math.hypot(pos[0]-x,pos[1]-y)>=r+rr-1e-7 for (x,y),rr in placed)

def contact_count(p,rs):
 return sum(abs(math.hypot(p[i][0]-p[j][0],p[i][1]-p[j][1])-rs[i]-rs[j])<1e-5
            for i in range(len(p)) for j in range(i))

@lru_cache(maxsize=None)
def pack(ws):
 """Enumerate tangent-circle constructions, choosing max contacts then hull."""
 ws=tuple(ws); best=None
 for order in permutations(ws):
  rs=[OD[w]/2 for w in order]
  placements=[[((0.0,0.0),rs[0]),((rs[0]+rs[1],0.0),rs[1])]]
  for k in range(2,len(order)):
   r=rs[k]; next_placements=[]
   for placed in placements:
    seen=set()
    for i,j in combinations(range(len(placed)),2):
     for pos in circle_intersections(placed[i][0],placed[i][1]+r,placed[j][0],placed[j][1]+r):
      key=(round(pos[0],7),round(pos[1],7))
      if key in seen or not valid_position(pos,r,placed): continue
      seen.add(key); next_placements.append(placed+[(pos,r)])
   if not next_placements:
    for placed in placements:
     for (x,y),rr in placed:
      for a in range(0,360,30):
       t=math.radians(a); pos=(x+(rr+r)*math.cos(t),y+(rr+r)*math.sin(t))
       if valid_position(pos,r,placed): next_placements.append(placed+[(pos,r)])
   placements=next_placements
  for placed in placements:
   p=[xy for xy,_ in placed]; ox,oy,R=enclosing(p,rs)
   gaps=[math.hypot(p[i][0]-p[j][0],p[i][1]-p[j][1])-rs[i]-rs[j] for i in range(len(p)) for j in range(i)]
   score=(contact_count(p,rs),-R,-sum(abs(g) for g in gaps))
   if best is None or score>best[0]: best=(score,list(zip(p,rs,order)),(ox,oy,R))
 items=sorted(best[1],key=lambda item: ws.index(item[2]))
 return items,best[2],best[0]
def projection_segments(items,outer):
 ox,oy,R=outer; samples=300; y0=oy-R; y1=oy+R; visible=[]
 for k in range(samples):
  sy=y0+(k+.5)*(y1-y0)/samples; hits=[]
  for idx,((cx,cy),r,w) in enumerate(items):
   dy=sy-cy
   if abs(dy)<=r:
    hits.append((cx-math.sqrt(max(0,r*r-dy*dy)),idx))
  visible.append(min(hits)[1] if hits else None)
 seg=[]; cur=None; first=0
 for k,val in enumerate(visible+[None]):
  if val!=cur:
   if cur is not None: seg.append((cur,first,k))
   cur=val; first=k
 return seg
def arrow(d,x1,y,x2): d.line((x1,y,x2-22,y),fill='black',width=12); d.polygon([(x2,y),(x2-28,y-22),(x2-28,y+22)],fill='black')
def draw_pack(d,cx,cy,ws,kind,overlay=None):
 items,(ox,oy,R),score=pack(tuple(ws)); scale=33
 for i,((x,y),r,w) in enumerate(items):
  px=cx+(x-ox)*scale; py=cy+(y-oy)*scale; rr=r*scale
  # Internal wire contours intentionally removed.
  d.ellipse((px-rr,py-rr,px+rr,py+rr),fill=COL[i])
  d.ellipse((px-rr+13,py-rr+13,px+rr-13,py+rr-13),fill='white')
 # Draw the common jacket after the wires on a transparent overlay so its
 # translucency is preserved in the exported PNG.
 sd=overlay or d
 if kind=='bare': sd.ellipse((cx-R*scale,cy-R*scale,cx+R*scale,cy+R*scale),outline='black',width=8)
 elif kind=='nylon': sd.ellipse((cx-R*scale,cy-R*scale,cx+R*scale,cy+R*scale),fill=(188,232,233,120),outline='black',width=8)
 else:
  sd.ellipse((cx-(R+.16)*scale,cy-(R+.16)*scale,cx+(R+.16)*scale,cy+(R+.16)*scale),fill=(246,212,142,110),outline='black',width=8)
  sd.ellipse((cx-(R+.06)*scale,cy-(R+.06)*scale,cx+(R+.06)*scale,cy+(R+.06)*scale),outline='#1ba5b7',width=5)
def side(d,x,y,w,ws,kind,overlay=None):
 items,(ox,oy,R),score=pack(tuple(ws)); h=max(86,int(2*R*33)); top=y+52-h/2
 seg=projection_segments(items,(ox,oy,R))
 # First-hit wires are solid, without internal black contours.
 for idx,a,b in seg:
  yy1=top+a*h/300; yy2=top+b*h/300
  if yy2-yy1<4: continue
  d.rectangle((x,yy1,x+w,yy2),fill=COL[idx])
 # The common sheath is a translucent rectangle drawn over the projection.
 sd=overlay or d
 if kind=='nylon':
  sd.rounded_rectangle((x-12,top-12,x+w+12,top+h+12),8,fill=(188,232,233,150),outline='black',width=7)
 elif kind=='heat':
  sd.rounded_rectangle((x-14,top-14,x+w+14,top+h+14),8,fill=(246,212,142,125),outline='black',width=8)
  sd.rounded_rectangle((x-7,top-7,x+w+7,top+h+7),5,fill=(188,232,233,95),outline='#1b9eaa',width=5)
 else:
  sd.rounded_rectangle((x-8,top-8,x+w+8,top+h+8),8,outline='black',width=8)
def render(kind,name,title):
 im=Image.new('RGBA',(W,H),(255,255,255,255)); d=ImageDraw.Draw(im); d.rounded_rectangle((40,36,W-40,H-36),20,outline='#d5dde0',width=2); tx(d,78,65,title,TITLE); tx(d,78,106,'Первый цветной пиксель луча формирует видимую проекцию; оболочка накладывается сверху.',SM,'#6a777c')
 metrics=[]
 for i,ws in enumerate(SETS):
  y=230+i*185; arrow(d,80,y,190); overlay=Image.new('RGBA',(W,H),(0,0,0,0)); od=ImageDraw.Draw(overlay); draw_pack(d,315,y,ws,kind,od); side(d,575,y,760,ws,kind,od); tx(d,470,y-10,f'{len(ws)}',ROW,'#183238','mm'); tx(d,1365,y-10,f'{len(ws)} провод'+('' if len(ws)==1 else 'а'),SM,'#6a777c','lm'); im=Image.alpha_composite(im,overlay); d=ImageDraw.Draw(im); items,(ox,oy,R),score=pack(tuple(ws)); gaps=[math.hypot(items[i][0][0]-items[j][0][0],items[i][0][1]-items[j][0][1])-items[i][1]-items[j][1] for i in range(len(items)) for j in range(i)]; metrics.append({'count':len(ws),'awg':ws,'contact_pairs':score[0],'outer_diameter_mm':round(2*R,3),'projection_segments':len(projection_segments(items,(ox,oy,R))),'min_gap_mm':round(min(gaps),6)})
 tx(d,78,982,'Критерий: максимум касаний, затем минимум площади внешнего контура.',SM,'#6a777c'); im.convert('RGB').save(OUT/name); return metrics
allm={'bare':render('bare','01-max-contact-bare.png','UL1061 · максимум касаний без общей оболочки'),'nylon':render('nylon','02-max-contact-nylon.png','UL1061 · максимум касаний под нейлонкой'),'heat':render('heat','03-max-contact-nylon-heatshrink.png','UL1061 · максимум касаний под нейлонкой и термоусадкой')}
(OUT/'packing-metrics.json').write_text(json.dumps(allm,ensure_ascii=False,indent=2),encoding='utf-8')
print('ok')
