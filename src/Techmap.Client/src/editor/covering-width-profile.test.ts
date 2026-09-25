import { expect, it } from "vitest";
import { coveringWidthProfile, profileHalfWidth } from "./covering-width-profile";
import { coveringScene, moveCovering } from "./covering-layout";
import { coveringSurfaces } from "./covering-renderer";
import { physicalFixture } from "./physical-topology-fixture";
import type { CoveringKind, PhysicalCovering } from "./physical-coverings";
import type { HarnessDesignDocument } from "./model";

it("has two sharp corners per change and flat supports; ramps never enter the thicker support",()=>{
 const profile=coveringWidthProfile(0,100,[30,70],x=>x>=30&&x<=70?15:5);
 expect(profile).toEqual([{at:0,halfWidth:5},{at:25,halfWidth:5},{at:30,halfWidth:15},{at:70,halfWidth:15},{at:75,halfWidth:5},{at:100,halfWidth:5}]);
 expect(profileHalfWidth(profile,27.5)).toBe(10);
 expect(profileHalfWidth(profile,50)).toBe(15);
 expect(profileHalfWidth(profile,90)).toBe(5);
});
it("caps neighbouring ramps without inversion on short intervals and follows scale",()=>{
 const profile=coveringWidthProfile(0,100,[40,41,42,43],x=>x>=40&&x<41||x>=42&&x<43?50:1);
 expect(profile.every((p,i)=>i===0||p.at>profile[i-1]!.at)).toBe(true);
 const scaled=coveringWidthProfile(0,200,[80,82,84,86],x=>x>=80&&x<82||x>=84&&x<86?100:2);
 expect(scaled).toEqual(profile.map(p=>({at:p.at*2,halfWidth:p.halfWidth*2})));
});

function fixture(kind:CoveringKind):HarnessDesignDocument {
 const doc=physicalFixture();
 const cover=(id:string,width:number,from:number,to:number):PhysicalCovering=>({id,name:id,kind,width,color:"#8899aa",lengthMm:null,spans:[{segmentId:"S0",from,to}]});
 return {...doc,drawingDocuments:{tables:[],leaders:[],bomOrder:[],bendRadius:0},physicalTopology:{...doc.physicalTopology!,snap:false,
 nodes:[{id:"NA",position:{x:0,y:0}},{id:"J",position:{x:300,y:0}}],
 segments:[{id:"S0",from:"NA",to:"J",path:{kind:"routed",points:[]},width:10}],routes:[],
 coverings:[cover("lower",30,.3,.7),cover("upper",0,.1,.9)]}};
}
it.each<CoveringKind>(["heat-shrink","nylon","braid","metal-braid","tape","band"])("%s follows both lower sleeve boundaries with Z contours and preserved identities",kind=>{
 const doc=fixture(kind),before=JSON.stringify(doc),surface=coveringSurfaces(coveringScene(doc)[1]!)[0]!;
 const left=surface.polygon.slice(0,surface.path.length);
 expect(left).toEqual([{x:30,y:5.25},{x:85,y:5.25},{x:90,y:15.25},{x:210,y:15.25},{x:215,y:5.25},{x:270,y:5.25}]);
 const right=surface.polygon.slice(surface.path.length).reverse();
 expect(right).toEqual(left.map(p=>({x:p.x,y:-p.y})));
 expect(JSON.stringify(doc)).toBe(before);
 // Sleeve movement exposes a different range of the same support profile.
 const moved=moveCovering(doc,"upper",0,"body",{x:50,y:0},{x:65,y:0})!;
 const after={...doc,physicalTopology:{...doc.physicalTopology!,coverings:[doc.physicalTopology!.coverings![0]!,moved]}};
 expect(coveringSurfaces(coveringScene(after)[1]!)[0]!.polygon).toContainEqual({x:90,y:15.25});
 const vertical={...doc,physicalTopology:{...doc.physicalTopology!,nodes:[{id:"NA",position:{x:0,y:0}},{id:"J",position:{x:0,y:300}}]}};
 expect(coveringSurfaces(coveringScene(vertical)[1]!)[0]!.polygon).toEqual(surface.polygon.map(p=>({x:-p.y,y:p.x})));
});
it("retains ramp corners when a sleeve ends within a ramp and when the pipe bends",()=>{
 const doc=fixture("heat-shrink"),coverings=doc.physicalTopology!.coverings!;
 const clipped={...doc,physicalTopology:{...doc.physicalTopology!,coverings:[coverings[0]!,{...coverings[1]!,spans:[{segmentId:"S0",from:87.5/300,to:.9}]}]}};
 const surface=coveringSurfaces(coveringScene(clipped)[1]!)[0]!;
 expect(surface.polygon[0]).toEqual({x:87.5,y:10.25});
 expect(surface.polygon[1]).toEqual({x:90,y:15.25});
 const bent={...doc,physicalTopology:{...doc.physicalTopology!,nodes:[{id:"NA",position:{x:0,y:0}},{id:"J",position:{x:150,y:150}}],segments:[{...doc.physicalTopology!.segments[0]!,path:{kind:"routed" as const,points:[{x:150,y:0}]}}]}};
 const bentSurface=coveringSurfaces(coveringScene(bent)[1]!)[0]!;
 expect(bentSurface.polygon).toContainEqual({x:90,y:15.25});
 expect(bentSurface.polygon).toContainEqual({x:150-15.25,y:60});
 expect(bentSurface.polygon).toContainEqual({x:150-5.25,y:65});
 expect(bentSurface.polygon.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).toBe(true);
});
