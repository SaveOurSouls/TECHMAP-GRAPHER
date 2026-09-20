export interface DrawingCamera { x:number; y:number; zoom:number }
/** Fixed-size point grips, compensated for camera and object scale. */
export function drawingHandleRadii(screenScale:number, scaleX:number, scaleY:number, nearestWorldDistance=Infinity) {
  const pixels=Math.max(2,Math.min(5,nearestWorldDistance*screenScale/4));
  return {rx:pixels/Math.max(.0001,screenScale*Math.abs(scaleX)),ry:pixels/Math.max(.0001,screenScale*Math.abs(scaleY))};
}
export function zoomDrawingCamera(camera:DrawingCamera, point:{x:number;y:number}, delta:number):DrawingCamera {
  const zoom=Math.max(.1,Math.min(32,camera.zoom*Math.exp(-Math.max(-300,Math.min(300,delta))*.002)));
  return {zoom,x:point.x-(point.x-camera.x)*camera.zoom/zoom,y:point.y-(point.y-camera.y)*camera.zoom/zoom};
}
/** Keep controls at least 28 screen pixels apart even on tiny geometry. */
export function spacedHandleBounds(left:number,top:number,right:number,bottom:number,pixelsX:number,pixelsY=pixelsX) {
  const cx=(left+right)/2,cy=(top+bottom)/2,hw=Math.max(Math.abs(right-left)/2,14/Math.max(.0001,pixelsX)),hh=Math.max(Math.abs(bottom-top)/2,14/Math.max(.0001,pixelsY));
  return {left:cx-hw,right:cx+hw,top:cy-hh,bottom:cy+hh,compact:Math.abs(right-left)*pixelsX<56||Math.abs(bottom-top)*pixelsY<56};
}
