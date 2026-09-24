import {expect,it} from "vitest";
import {moveE4Ends,movedE4Junctions} from "./e4-editing";
import {createEmptyHarnessDesign} from "./model";
it("moves a shared shoulder once when both ends move together",()=>{
 const points=[{x:0,y:0},{x:50,y:50},{x:100,y:0}];
 expect(moveE4Ends(points,{x:20,y:30},{x:120,y:30},"carry")).toEqual([{x:20,y:30},{x:70,y:80},{x:120,y:30}]);
 expect(moveE4Ends(points,{x:20,y:30},{x:100,y:0},"carry")[1]).toEqual({x:70,y:80});
 expect(moveE4Ends(points,{x:20,y:30},{x:120,y:30},"adjacent")[1]).toEqual({x:50,y:50});
});
it("maps junctions by their original segment and excludes unrelated crossings",()=>{
 const d={...createEmptyHarnessDesign(),junctions:[{id:"attached",position:{x:25,y:0},wireIds:["w","branch"]},{id:"other",position:{x:25,y:0},wireIds:["unrelated"]}]};
 expect([...movedE4Junctions(d,"w",[{x:0,y:0},{x:100,y:0}],[{x:0,y:0},{x:100,y:80}])]).toEqual([["attached",{x:25,y:20}]]);
});
