import {describe,it,expect} from "vitest";
import {spacedHandleBounds,zoomDrawingCamera} from "./drawing-viewport";
describe("drawing viewport and compact handles",()=>{
  it("anchors wheel zoom at the same screen point and clamps extremes",()=>{
    const camera={x:100,y:-40,zoom:2},point={x:160,y:70};
    const next=zoomDrawingCamera(camera,point,-120);
    expect((point.x-next.x)*next.zoom).toBeCloseTo((point.x-camera.x)*camera.zoom);
    expect((point.y-next.y)*next.zoom).toBeCloseTo((point.y-camera.y)*camera.zoom);
    expect(zoomDrawingCamera({...camera,zoom:32},point,-100).zoom).toBe(32);
  });
  it("separates corner targets at tiny scales while leaving large bounds unchanged",()=>{
    const compact=spacedHandleBounds(10,10,12,12,.2,.1);
    expect((compact.right-compact.left)*.2).toBeCloseTo(28);
    expect((compact.bottom-compact.top)*.1).toBeCloseTo(28);
    expect(compact.compact).toBe(true);
    expect(spacedHandleBounds(0,0,100,90,1)).toEqual({left:0,top:0,right:100,bottom:90,compact:false});
  });
});
