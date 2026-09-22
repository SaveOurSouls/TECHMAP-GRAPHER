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
/** Keep grip anchors on the contour; callers shrink handles for compact geometry. */
export function spacedHandleBounds(left:number,top:number,right:number,bottom:number,pixelsX:number,pixelsY=pixelsX) {
  return {left:Math.min(left,right),right:Math.max(left,right),top:Math.min(top,bottom),bottom:Math.max(top,bottom),compact:Math.abs(right-left)*pixelsX<56||Math.abs(bottom-top)*pixelsY<56};
}

/** Small figures need smaller grips, not a larger invisible selection frame. */
export function boxHandleRadius(widthPixels:number,heightPixels:number):number {
  return Math.max(.5, Math.min(5.5,Math.abs(widthPixels)/4,Math.abs(heightPixels)/4));
}
