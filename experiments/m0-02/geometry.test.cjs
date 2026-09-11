const {test}=require('node:test');
const assert=require('node:assert/strict');
const {route,at,overlapsTightBend}=require('./geometry.js');
const close=(a,b,tolerance=0.05)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
test('Straight section stays straight and has exact length',()=>{
 const p=route([{x:0,y:20},{x:350,y:20},{x:800,y:20}],60);
 close(p.length,800);for(let s=0;s<=800;s+=10){close(at(p,s).y,20);close(at(p,s).x,s);}
});
test('90 degree fillet length agrees with analytic arc',()=>{
 const p=route([{x:0,y:0},{x:100,y:0},{x:100,y:100}],20);
 close(p.length,160+Math.PI*10);close(p.minRadius,20);
 assert.deepEqual(at(p,0),{x:0,y:0});assert.deepEqual(at(p,p.length),{x:100,y:100});
});
test('Curve is confined to the neighbourhood of a corner',()=>{
 const p=route([{x:0,y:0},{x:350,y:0},{x:450,y:-100},{x:800,y:-100}],50);
 for(let s=0;s<300;s+=5)close(at(p,s).y,0);
 for(let s=p.length-300;s<p.length;s+=5)close(at(p,s).y,-100);
});
test('Both bend directions keep finite offsets and monotonic stations',()=>{
 for(const sign of [1,-1]){const p=route([{x:0,y:0},{x:150,y:0},{x:150,y:100*sign},{x:500,y:100*sign}],40);
 assert.ok(p.samples.slice(1).every((a,i)=>a.s>p.samples[i].s));
 for(let s=0;s<p.length;s+=2)for(const u of [-19,0,19]){const q=at(p,s,u);assert.ok(Number.isFinite(q.x)&&Number.isFinite(q.y));}
 }
});
test('Oversized radius is limited to adjacent segment lengths',()=>{
 const p=route([{x:0,y:0},{x:20,y:0},{x:20,y:100}],1000);close(p.minRadius,9.8);
 assert.ok(p.samples.every(p=>p.x>=0&&p.x<=20.001&&p.y>=0&&p.y<=100));
});
test('Zero radius exposes sharp corner without a false safe radius',()=>{
 const p=route([{x:0,y:0},{x:100,y:0},{x:100,y:100}],0);assert.equal(p.minRadius,0);close(p.length,200);
});
test('Out of range stations clamp to ends',()=>{
 const p=route([{x:10,y:0},{x:100,y:0}],5);assert.deepEqual(at(p,-10),{x:10,y:0});assert.deepEqual(at(p,1000),{x:100,y:0});
});
test('Degenerate and invalid geometry is rejected explicitly',()=>{
 for(const pts of [[],[{x:0,y:0}],[{x:0,y:0},{x:0,y:0}],[{x:0,y:0},{x:NaN,y:3}],[{x:0,y:0},{x:100,y:0},{x:0,y:0}]])assert.throws(()=>route(pts,10));
 assert.throws(()=>route([{x:0,y:0},{x:1,y:1}],-1));
});
test('Tight bend warning applies only to the covered section',()=>{
 const p=route([{x:0,y:0},{x:100,y:0},{x:100,y:100}],5);
 assert.equal(overlapsTightBend(p,0,50,20),false);
 assert.equal(overlapsTightBend(p,90,120,20),true);
 assert.equal(overlapsTightBend(p,90,120,4),false);
});
