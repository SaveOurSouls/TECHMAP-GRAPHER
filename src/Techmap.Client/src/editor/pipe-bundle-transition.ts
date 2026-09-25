import type { Point } from "./model";

/** Two circular bends joined by a straight shoulder. Both boundary tangents
 * follow the sleeve axis; the arc never enters the covered interval. */
export function bundleTransitionPoint(a:Point,b:Point,tangent:Point,t:number,radius:number):Point {
  const mix=(p:Point,q:Point,u:number)=>({x:p.x+(q.x-p.x)*u,y:p.y+(q.y-p.y)*u});
  if(t<=0)return a;if(t>=1)return b;
  const norm=Math.hypot(tangent.x,tangent.y)||1,u={x:tangent.x/norm,y:tangent.y/norm};
  const dx=b.x-a.x,dy=b.y-a.y,L=dx*u.x+dy*u.y,signed=-dx*u.y+dy*u.x,H=Math.abs(signed);
  if(radius<=0||L<1e-6||H<1e-6)return mix(a,b,t);
  const r=Math.min(radius,L/4),sign=Math.sign(signed);
  let lo=0,hi=Math.PI/2-1e-7;
  for(let i=0;i<50;i++){const angle=(lo+hi)/2,y=L*Math.tan(angle)-2*r*(1/Math.cos(angle)-1);if(y<H)lo=angle;else hi=angle;}
  const angle=(lo+hi)/2,xArc=r*Math.sin(angle),yArc=r*(1-Math.cos(angle)),x=t*L;
  const y=x<xArc?r-Math.sqrt(Math.max(0,r*r-x*x)):x>L-xArc?H-r+Math.sqrt(Math.max(0,r*r-(L-x)*(L-x))):yArc+(x-xArc)*Math.tan(angle);
  return {x:a.x+u.x*x-u.y*y*sign,y:a.y+u.y*x+u.x*y*sign};
}
