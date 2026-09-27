import type { Point } from "./model";

/** A bounded transition with tangents aligned to the common sleeve axis.
 * Lateral interpolation remains inside the two endpoint offsets even when
 * the available shoulder is shorter than the distance between members. */
export function bundleTransitionPoint(a:Point,b:Point,tangent:Point,t:number,radius:number):Point {
  const mix=(p:Point,q:Point,u:number)=>({x:p.x+(q.x-p.x)*u,y:p.y+(q.y-p.y)*u});
  if(t<=0)return a;if(t>=1)return b;
  const norm=Math.hypot(tangent.x,tangent.y)||1,u={x:tangent.x/norm,y:tangent.y/norm};
  const dx=b.x-a.x,dy=b.y-a.y,longitudinal=dx*u.x+dy*u.y,lateral=-dx*u.y+dy*u.x;
  if(radius<=0||Math.abs(lateral)<1e-6)return mix(a,b,t);
  const eased=t*t*t*(10+t*(-15+6*t));
  return {x:a.x+u.x*longitudinal*t-u.y*lateral*eased,
    y:a.y+u.y*longitudinal*t+u.x*lateral*eased};
}
