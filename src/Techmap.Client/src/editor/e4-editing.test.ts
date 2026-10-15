import {expect,it} from "vitest";
import {moveE4Ends,movedE4Junctions,resolveE4JunctionMoves,orthogonalE4Deformation,editedE4Points} from "./e4-editing";
import {createEmptyHarnessDesign} from "./model";
import {createWire} from "./commands";

it.each(['carry','adjacent'] as const)('C3 keeps leads and all shoulders orthogonal when a bend crosses the lower corner (%s)',mode=>{
 const before=[{x:0,y:0},{x:24,y:0},{x:280,y:0},{x:280,y:200},{x:576,y:200},{x:600,y:200}];
 const raw=editedE4Points(before,1,{x:320,y:240},mode,false,false);
 const result=orthogonalE4Deformation(before,raw,{position:before[0]!,leadDirection:'right'},
   {position:before.at(-1)!,leadDirection:'left'},mode,2);
 expect(result.points[0]).toEqual(before[0]);expect(result.points.at(-1)).toEqual(before.at(-1));
 expect(result.points.some(p=>p.x===320&&p.y===240)).toBe(true);
 for(let i=1;i<result.points.length;i++)expect(result.points[i]!.x===result.points[i-1]!.x||result.points[i]!.y===result.points[i-1]!.y).toBe(true);
 expect(result.points[1]!.y).toBe(0);expect(result.points.at(-2)!.y).toBe(200);
});
it("moves a shared shoulder once when both ends move together",()=>{
 const points=[{x:0,y:0},{x:50,y:50},{x:100,y:0}];
 expect(moveE4Ends(points,{x:20,y:30},{x:120,y:30},"carry")).toEqual([{x:20,y:30},{x:70,y:80},{x:120,y:30}]);
 expect(moveE4Ends(points,{x:20,y:30},{x:100,y:0},"carry")[1]).toEqual({x:70,y:80});
 expect(moveE4Ends(points,{x:20,y:30},{x:120,y:30},"adjacent")[1]).toEqual({x:50,y:50});
});
it("resolves conflicting carrier proposals by junction order independently of wire array order",()=>{
 const a=createWire("a",{connectorId:"x",contactId:"1"},{connectorId:"y",contactId:"1"});
 const b=createWire("b",{connectorId:"x",contactId:"2"},{connectorId:"y",contactId:"2"});
 const branch=createWire("branch",{connectorId:"x",contactId:"3"},{connectorId:"",contactId:"",junctionId:"j"});
 const d={...createEmptyHarnessDesign(),wires:[branch,b,a],junctions:[{id:"j",position:{x:80,y:50},wireIds:["branch","a","b"]}]};
 const proposals=new Map([["b",new Map([["j",{x:110,y:90}]])],["branch",new Map([["j",{x:500,y:500}]])],["a",new Map([["j",{x:100,y:70}]])]]);
 expect(resolveE4JunctionMoves(d,proposals).get("j")).toEqual({x:100,y:70});
 expect(resolveE4JunctionMoves({...d,wires:[a,b,branch]},proposals)).toEqual(resolveE4JunctionMoves(d,proposals));
 expect(resolveE4JunctionMoves(d,new Map([["branch",proposals.get("branch")!]]))).toEqual(new Map());
});
it("maps junctions by their original segment and excludes unrelated crossings",()=>{
 const d={...createEmptyHarnessDesign(),junctions:[{id:"attached",position:{x:25,y:0},wireIds:["w","branch"]},{id:"other",position:{x:25,y:0},wireIds:["unrelated"]}]};
 expect([...movedE4Junctions(d,"w",[{x:0,y:0},{x:100,y:0}],[{x:0,y:0},{x:100,y:80}])]).toEqual([["attached",{x:25,y:20}]]);
});
