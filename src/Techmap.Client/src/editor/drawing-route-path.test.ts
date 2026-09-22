import { describe,it,expect } from "vitest";
import { drawingRouteCommands,drawingRouteHitPoints } from "./drawing-route-path";
describe("drawing circular bends",()=>{
 it("keeps straight tangents, endpoints and the original movable corner",()=>{
  const points=[{x:0,y:0},{x:100,y:0},{x:100,y:100}],before=JSON.stringify(points);
  const commands=drawingRouteCommands(points);
  expect(commands).toEqual([{kind:"move",x:0,y:0},{kind:"line",x:76,y:0},{kind:"arc",cornerX:100,cornerY:0,x:100,y:23.999999999999996,radius:24,sweep:1},{kind:"line",x:100,y:100}]);
  expect(JSON.stringify(points)).toBe(before);
  const hit=drawingRouteHitPoints(points);expect(hit[0]).toEqual(points[0]);expect(hit.at(-1)).toEqual(points[2]);
  expect(hit.some(p=>Math.hypot(p.x-100,p.y)<5)).toBe(false);
 });
 it("handles reversed paths, short legs and repeated points without overshoot",()=>{
  for(const points of [[{x:0,y:0},{x:5,y:0},{x:5,y:5}],[{x:5,y:5},{x:5,y:0},{x:0,y:0}],[{x:0,y:0},{x:0,y:0},{x:5,y:0}]]){
   const hit=drawingRouteHitPoints(points);expect(hit[0]).toEqual(points[0]);expect(hit.at(-1)).toEqual(points.at(-1));
   expect(hit.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=-1e-6&&p.x<=5.000001&&p.y>=-1e-6&&p.y<=5.000001)).toBe(true);
  }
 });
});
