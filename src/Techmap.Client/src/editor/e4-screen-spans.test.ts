import {expect,it} from "vitest";
import {screenCrossSections,screenSectionAt} from "./e4-screen-spans";
import {getE4ScreenLayout} from "./CanvasViewport";
import type {EditorSceneObject} from "./editor-types";

it("sweeps sloping wires at the actual X without inflating the screen to their complete bounding box",()=>{
 const paths=[{id:"a",points:[{x:0,y:0},{x:200,y:100}]},{id:"b",points:[{x:0,y:40},{x:200,y:140}]}];
 const spans=screenCrossSections(paths);
 expect(spans).toHaveLength(1);
 expect(screenSectionAt(spans[0]!,50)).toEqual({crossMinimum:25,crossMaximum:65});
 const objects:EditorSceneObject[]=paths.map(p=>({...p,kind:"wire",layerId:"wires",label:p.id,x:0,y:0,width:0,height:0,color:"red"}));
 for(const position of [0,.25,.5,.75,1]){
  const layout=getE4ScreenLayout({id:"s",wireIds:["a","b"],position,width:20,label:"S"},objects)!;
  expect(layout.center).toEqual({x:200*position,y:100*position+20});
  expect(layout.crossSize).toBe(58);
  expect(layout.orientation).toBe("horizontal");
 }
});

it("includes all crossed legs and retains a perpendicular fallback for a pure vertical bundle",()=>{
 const paths=[{id:"a",points:[{x:0,y:0},{x:100,y:100},{x:0,y:200}]}];
 expect(screenSectionAt(screenCrossSections(paths)[0]!,50)).toEqual({crossMinimum:50,crossMaximum:150});
 const vertical=screenCrossSections([{id:"a",points:[{x:10,y:0},{x:10,y:200}]}]);
 expect(vertical[0]!.orientation).toBe("vertical");
 expect(screenSectionAt(vertical[0]!,80)).toEqual({crossMinimum:10,crossMaximum:10});
});
