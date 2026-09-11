/* Pure geometry. Screen units only; never used to infer material millimetres. */
(function(root){
 const add=(a,b)=>({x:a.x+b.x,y:a.y+b.y}), sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y}), mul=(a,k)=>({x:a.x*k,y:a.y*k});
 const len=a=>Math.hypot(a.x,a.y), unit=a=>mul(a,1/len(a));
 function route(points,radius){
  if(points.length<2||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))||!Number.isFinite(radius)||radius<0)throw Error('Invalid route');
  if(points.slice(1).some((p,i)=>len(sub(p,points[i]))<1e-6))throw Error('Duplicate points');
  const result=[points[0]],bends=[];let minRadius=Infinity;
  for(let i=1;i<points.length-1;i++){
   const prev=points[i-1],p=points[i],next=points[i+1],a=unit(sub(p,prev)),b=unit(sub(next,p));
   const cross=a.x*b.y-a.y*b.x,angle=Math.acos(Math.max(-1,Math.min(1,a.x*b.x+a.y*b.y)));
   if(angle<1e-6){result.push(p);continue;}
   if(Math.PI-angle<1e-5)throw Error('Reversal requires another point');
   if(radius===0){result.push(p);bends.push({from:result.length-1,to:result.length-1,radius:0});minRadius=0;continue;}
   const trim=Math.min(radius*Math.tan(angle/2),len(sub(p,prev))*.49,len(sub(next,p))*.49),r=trim/Math.tan(angle/2),sign=Math.sign(cross);
   const start=sub(p,mul(a,trim)),end=add(p,mul(b,trim)),center=add(start,{x:-a.y*sign*r,y:a.x*sign*r});
   result.push(start);const from=result.length-1,base=Math.atan2(start.y-center.y,start.x-center.x),n=Math.max(4,Math.ceil(angle*r/2));
   for(let j=1;j<n;j++){let q=base+sign*angle*j/n;result.push({x:center.x+r*Math.cos(q),y:center.y+r*Math.sin(q)});}
   result.push(end);bends.push({from,to:result.length-1,radius:r});minRadius=Math.min(minRadius,r);
  }
  result.push(points.at(-1));let distance=0;
  const samples=result.map((p,i)=>{if(i)distance+=len(sub(p,result[i-1]));return {...p,s:distance};});
  return {samples,length:distance,minRadius,bends:bends.map(b=>({start:samples[b.from].s,end:samples[b.to].s,radius:b.radius}))};
 }
 function at(path,s,u=0){
  const list=path.samples;s=Math.max(0,Math.min(path.length,s));let lo=1,hi=list.length-1;
  while(lo<hi){const m=(lo+hi)>>1;if(list[m].s<s)lo=m+1;else hi=m;}
  const a=list[lo-1],b=list[lo],d=b.s-a.s,t=d?(s-a.s)/d:0,v=unit(sub(b,a));
  return {x:a.x+(b.x-a.x)*t-v.y*u,y:a.y+(b.y-a.y)*t+v.x*u};
 }
 const overlapsTightBend=(path,start,end,width)=>path.bends.some(b=>b.end>=start&&b.start<=end&&b.radius<=width/2);
 const api={route,at,overlapsTightBend};if(typeof module!=='undefined')module.exports=api;else root.Geometry=api;
})(typeof window==='undefined'?globalThis:window);
