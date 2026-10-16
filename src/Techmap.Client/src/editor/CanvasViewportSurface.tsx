import { screenToWorld } from "./editor-camera";
import { hitTestEditorScene, e4Midpoints } from "./canvas-scene-hit-test";
import { materialObjectGroup } from "./MaterialObjectsPanel";
import {
  projectE4DrawingCompanions,
  projectComponentTemplateView,
  projectContactSideView,
} from "./component-template-view-renderer";
import { getE4ConnectorLayout } from "./canvas-connector-layout";
import { DRAWING_VIEW_PLACEMENT_ID, CONTACT_SIDE_VIEW_PLACEMENT_ID, drawingScale } from "./drawing-scale";
import { DrawingResizeGrip } from "./DrawingResizeGrip";
import { pipeSceneEditablePoints, pipeSceneWireIds } from "./physical-scene";
import { CanvasObjectHint } from "./CanvasObjectHint";
import { CanvasObjectPopover } from "./CanvasObjectPopover";
import { resolveWireColorHex } from "./wire-reference-catalog";
import { standardCoveringKinds } from "./physical-coverings";
import { objectsInPaintOrder } from "./canvas-paint-order";
import { type CanvasViewportProps } from "./canvas-viewport-types";
import { useCanvasViewport } from "./useCanvasViewport";

export function CanvasViewport(props: CanvasViewportProps) {
  const { activeSelectedIds, allowDrop, camera, cancelPointer, canvasRef, componentTemplateViewInstances, diagnosticOverlay, dimensionMessage, dimensionStart, displayInstances, doubleClick, drop, endPointer, finishGraphicPath, frameRef, freeEndAxes, freeEndpointRefs, graphicPathDraft, graphicStart, hoverGrip, hoverTarget, inlineDoubleClick, inlineDragOffset, inlineEditor, inlineLayout, inlineObject, inlinePointerCancel, inlinePointerDown, inlinePointerMove, inlinePointerUp, layers, localPoint, objectProperties, objects, onDetachedPairAction, onDrawingScale, onFreeWireEndStyleRequest, onFreeWireEndpointMove, onFreeWireEndpointsXChange, onObjectPick, onObjectPickCancel, onObjectSelect, onObjectsIsolate, onObjectsSave, onPhysicalContextAction, onPhysicalNodesConnect, onRelatedObjectsSelect, overlay, pairActionIds, pendingPlacement, physicalGuide, physicalMenu, physicalStart, pointerDown, pointerMove, railDraft, resolveComponentTemplateAssetUrl, selectedObjectId, selectedSet, selectionRectangle, setHoverTarget, setPhysicalMenu, setPlacementPoint, setScalePreview, tool, view, wireReconnect, wireStart } = useCanvasViewport(props);
  return (
    <div ref={frameRef} className={`he-canvas-frame tool-${tool}`}>
      <canvas
        ref={canvasRef}
        className="he-canvas"
        style={pendingPlacement ? { cursor: 'crosshair' } : undefined}
        tabIndex={0}
        aria-label={`${view === "e4" ? "Поле схемы Э4" : "Поле чертежа"}. Масштаб ${Math.round(camera.zoom * 100)} процентов`}
        onPointerDown={pointerDown}
        onKeyDown={event=>{if(onObjectPick&&event.key==='Escape'){event.stopPropagation();onObjectPickCancel?.();}}}
        onPointerMove={pointerMove}
        onPointerLeave={()=>{setHoverTarget(null);setPlacementPoint(null);}}
        onPointerUp={endPointer}
        onPointerCancel={cancelPointer}
        onLostPointerCapture={cancelPointer}
        onDragOver={allowDrop}
        onDrop={drop}
        onDoubleClick={doubleClick}
        onContextMenu={event=>{
          if(pendingPlacement){event.preventDefault();return;}
          if(onObjectPick){event.preventDefault();return;}
          if(tool.startsWith("graphic-")&&graphicPathDraft){event.preventDefault();finishGraphicPath();return;}
          if(view!=="drawing"||(!onPhysicalContextAction&&!objectProperties&&!onObjectsIsolate&&!onObjectsSave&&!onDetachedPairAction&&!onFreeWireEndStyleRequest))return;
          event.preventDefault();
          setHoverTarget(null);
          const point=screenToWorld(camera,localPoint(event.clientX,event.clientY));
          // Endpoint controls remain selectable when a dimension extension or
          // an underpassing twist stroke lies at the same coordinate.
          const freeEndWire=objects.find(o=>o.kind==="wire"&&selectedSet.has(o.id)&&layers.some(l=>l.id===o.layerId&&l.visible)&&(["from","to"] as const).some(end=>{
            const p=end==="from"?o.points?.[0]:o.points?.at(-1);
            return o.metadata?.[end==="from"?"freeFrom":"freeTo"]==="true"&&p&&Math.hypot(p.x-point.x,p.y-point.y)<=7/camera.zoom;
          }));
          const id=freeEndWire?.id??hitTestEditorScene(objects,layers,point,camera.zoom,view,componentTemplateViewInstances,resolveComponentTemplateAssetUrl);
          const object=objects.find(o=>o.id===id) ?? (onObjectsIsolate ? objects.find(o=>selectedSet.has(o.id)) : undefined),layer=layers.find(l=>l.id===object?.layerId);
          if(!object||layer?.locked||(!onObjectsIsolate&&!["wire","connector","physical-node","physical-segment","physical-covering"].includes(object.kind))){setPhysicalMenu(null);return;}
          const isolationIds=selectedSet.has(object.id) ? activeSelectedIds.filter(selectedId=>objects.some(o=>o.id===selectedId)) : [object.id];
          const hasMaterialSelection = isolationIds.some(selectedId => {
            const selectedObject = objects.find(candidate => candidate.id === selectedId);
            return selectedObject && materialObjectGroup(selectedObject.kind) !== null;
          });
          if (onObjectsIsolate && !onObjectsSave && !hasMaterialSelection) { setPhysicalMenu(null); return; }
          if(!selectedSet.has(object.id))onObjectSelect(object.id,false);
          setPhysicalMenu({id:object.id,point,node:object.kind==="physical-node",x:event.clientX,y:event.clientY,isolationIds});
        }}
      />
      {(graphicPathDraft?.points[0]??graphicStart)&&<svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}} aria-label="Первая точка фигуры"><circle cx={(graphicPathDraft?.points[0]??graphicStart)!.x*camera.zoom+camera.offsetX} cy={(graphicPathDraft?.points[0]??graphicStart)!.y*camera.zoom+camera.offsetY} r="4" fill="#fff" stroke="#1179ac" strokeWidth="2"/></svg>}
      {selectionRectangle&&<svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}} aria-label="Рамка выделения"><rect x={Math.min(selectionRectangle.start.x,selectionRectangle.end.x)*camera.zoom+camera.offsetX} y={Math.min(selectionRectangle.start.y,selectionRectangle.end.y)*camera.zoom+camera.offsetY} width={Math.abs(selectionRectangle.end.x-selectionRectangle.start.x)*camera.zoom} height={Math.abs(selectionRectangle.end.y-selectionRectangle.start.y)*camera.zoom} fill="rgba(17,121,172,.10)" stroke="#1179ac" strokeWidth="1" strokeDasharray="5 3"/></svg>}
      {physicalGuide&&<svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}} aria-label="Привязка трассы"><polyline points={physicalGuide.map(p=>`${p.x*camera.zoom+camera.offsetX},${p.y*camera.zoom+camera.offsetY}`).join(" ")} fill="none" stroke="#ca5697" strokeWidth="1" strokeDasharray="5 4"/></svg>}
      {railDraft&&<svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}} aria-label="Предпросмотр линии позиций"><line x1={railDraft.start.x*camera.zoom+camera.offsetX} y1={railDraft.start.y*camera.zoom+camera.offsetY} x2={railDraft.end.x*camera.zoom+camera.offsetX} y2={railDraft.end.y*camera.zoom+camera.offsetY} stroke="#1179ac" strokeWidth="2" strokeDasharray="9 5 2 5"/><circle cx={railDraft.start.x*camera.zoom+camera.offsetX} cy={railDraft.start.y*camera.zoom+camera.offsetY} r="4" fill="#1179ac"/></svg>}
      {tool==="select" && onDrawingScale && objects.filter(o=>o.id===selectedObjectId&&o.kind==="connector"&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)).flatMap(object=>{
        const instance=displayInstances.find(i=>i.objectId===object.id);if(!instance)return [];
        const drawings=view==="e4"?projectE4DrawingCompanions(instance,object,getE4ConnectorLayout(object)?.width??object.width,resolveComponentTemplateAssetUrl).filter(d=>d.visible):[];
        const projected=view==="drawing"?projectComponentTemplateView(instance,view,object,resolveComponentTemplateAssetUrl):null;
        const contactSide=view==="drawing"?projectContactSideView(instance,{x:object.x,y:object.y},projected?.bounds??{minX:object.x,minY:object.y,maxX:object.x+object.width,maxY:object.y+object.height},resolveComponentTemplateAssetUrl):null;
        const targets=view==="e4"?drawings.map(d=>({id:d.drawingId,x:d.bounds.maxX,y:d.bounds.minY,ax:d.bounds.minX,ay:d.bounds.maxY})) : [
          ...(projected?[{id:DRAWING_VIEW_PLACEMENT_ID,x:projected.bounds.maxX,y:projected.bounds.maxY,ax:object.x,ay:object.y}]:[]),
          ...(contactSide?.visible?[{id:CONTACT_SIDE_VIEW_PLACEMENT_ID,x:contactSide.drawing.bounds.maxX,y:contactSide.drawing.bounds.maxY,ax:contactSide.drawing.bounds.minX,ay:contactSide.drawing.bounds.minY}]:[]),
        ];
        return targets.map(t=><DrawingResizeGrip key={`${object.id}:${t.id}`} x={t.x*camera.zoom+camera.offsetX} y={t.y*camera.zoom+camera.offsetY} vx={(t.x-t.ax)*camera.zoom} vy={(t.y-t.ay)*camera.zoom} scale={drawingScale(instance.drawingPlacements,t.id)} preview={scale=>setScalePreview(scale===null?null:{objectId:object.id,drawingId:t.id,scale})} commit={scale=>onDrawingScale(object.id,t.id,scale)}/>);
      })}
      <div className="he-canvas-status" aria-live="polite">
        <span>{Math.round(camera.zoom * 100)}%</span>
        <span>{pendingPlacement ? 'Укажите место контакта щелчком; Escape — отмена' : tool === "position-rail" ? railDraft ? `Нанизано позиций: ${railDraft.leaderIds.length}. Второй щелчок закрепит линию` : "Первый щелчок задаёт начало линии позиций"
          : tool === "wire"
          ? physicalStart ? "Выберите узел или общий выход для завершения канала" : wireReconnect ? "Выберите новый контакт для конца провода"
            : wireStart ? "Выберите второй контакт"
              : "Выберите два контакта; конец выбранного провода можно переподключить"
          : tool === "pan" ? "Тяните поле мышью"
            : objects.find((item) => item.id === selectedObjectId)?.kind === "wire"
              ? view === "drawing"
                ? "Точки трассы: перетащить; двойной щелчок — удалить"
                : "Точки: перенос · середина: добавить · Shift: соседние участки"
              : "Ctrl + колесо — масштаб"}</span>
      </div>
      {view==="drawing"&&tool.startsWith("dimension")&&<><svg className="he-dimension-targets" aria-hidden="true">{objects.filter(o=>(o.kind==="physical-segment"||o.kind==="wire"&&o.metadata?.physicalRoute!=="true")&&layers.some(l=>l.id===o.layerId&&l.visible)).flatMap(w=>(w.kind==="physical-segment"?pipeSceneEditablePoints(w):w.points??[]).map((p,i)=>i!==0&&i!==(w.kind==="physical-segment"?pipeSceneEditablePoints(w):w.points??[]).length-1?null:<circle key={`${w.id}:${i}`} cx={p.x*camera.zoom+camera.offsetX} cy={p.y*camera.zoom+camera.offsetY} r={dimensionStart.some(a=>a.wireId===w.id&&a.index===i)?6:4} fill="white" stroke="#167caf" strokeWidth="2"/>))}</svg><div className="he-dimension-help" role="status">{dimensionMessage||"Выберите два конца участка"}</div></>}
      {hoverGrip&&view==="drawing"&&<svg className="he-covering-grip" aria-hidden="true"><line x1={(hoverGrip.edgeFrom?.x??hoverGrip.point.x-hoverGrip.normal.x*hoverGrip.halfWidth)*camera.zoom+camera.offsetX} y1={(hoverGrip.edgeFrom?.y??hoverGrip.point.y-hoverGrip.normal.y*hoverGrip.halfWidth)*camera.zoom+camera.offsetY} x2={(hoverGrip.edgeTo?.x??hoverGrip.point.x+hoverGrip.normal.x*hoverGrip.halfWidth)*camera.zoom+camera.offsetX} y2={(hoverGrip.edgeTo?.y??hoverGrip.point.y+hoverGrip.normal.y*hoverGrip.halfWidth)*camera.zoom+camera.offsetY} stroke="#00a9db" strokeWidth="6"/><circle cx={hoverGrip.point.x*camera.zoom+camera.offsetX} cy={hoverGrip.point.y*camera.zoom+camera.offsetY} r="5" fill="white" stroke="#007ca8" strokeWidth="2"/></svg>}
      {view==="drawing"&&tool==="select"&&(onFreeWireEndpointMove||onFreeWireEndpointsXChange)&&<svg aria-label="Свободные концы проводов" style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
        {freeEndpointRefs.map(ref=><circle key={`${ref.wireId}:${ref.end}`} cx={ref.point.x*camera.zoom+camera.offsetX} cy={ref.point.y*camera.zoom+camera.offsetY} r={5} fill="white" stroke="#167caf" strokeWidth={2}/>)}
        {freeEndAxes.map(axis=>{const y=(axis.minY+axis.maxY)/2;return <g key={`axis:${axis.end}:${axis.wireIds.join(",")}`}><line x1={axis.x*camera.zoom+camera.offsetX} y1={axis.minY*camera.zoom+camera.offsetY-10} x2={axis.x*camera.zoom+camera.offsetX} y2={axis.maxY*camera.zoom+camera.offsetY+10} stroke="#167caf" strokeWidth={1.5} strokeDasharray="5 4"/><circle cx={axis.x*camera.zoom+camera.offsetX} cy={y*camera.zoom+camera.offsetY} r={8} fill="white" stroke="#167caf" strokeWidth={2}/><path d={`M ${axis.x*camera.zoom+camera.offsetX-3} ${y*camera.zoom+camera.offsetY-3} L ${axis.x*camera.zoom+camera.offsetX+3} ${y*camera.zoom+camera.offsetY} L ${axis.x*camera.zoom+camera.offsetX-3} ${y*camera.zoom+camera.offsetY+3}`} fill="none" stroke="#167caf" strokeWidth={1.5}/></g>;})}
      </svg>}
      {view==="drawing"&&tool==="select"&&<svg aria-label="Изгибы свободных проводов" style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>{objects.filter(o=>o.metadata?.detachedDrawing==="true"&&selectedSet.has(o.id)&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)).flatMap(o=>e4Midpoints(o).map(h=><circle key={`${o.id}:${h.index}`} cx={h.point.x*camera.zoom+camera.offsetX} cy={h.point.y*camera.zoom+camera.offsetY} r={4} fill="#1179ac" opacity={.35}/>))}</svg>}
      <CanvasObjectHint target={physicalMenu?null:hoverTarget}/>
      {physicalMenu&&objects.some(o=>o.id===physicalMenu.id)&&<CanvasObjectPopover key={physicalMenu.id+(physicalMenu.wires?":wires":"")} x={physicalMenu.x} y={physicalMenu.y} label={physicalMenu.wires?"Провода пайпа":"Свойства объекта"} onClose={()=>setPhysicalMenu(null)}>
        {physicalMenu.wires ? <><table className="he-pipe-wires"><thead><tr><th>Провод</th><th>Цепь</th></tr></thead><tbody>{pipeSceneWireIds(objects.find(o=>o.id===physicalMenu.id)).map(id=>{const w=objects.find(o=>o.id===id);return <tr key={id}><td><button className="he-wire-row" onClick={()=>onRelatedObjectsSelect?.([id])}><i style={{background:resolveWireColorHex(w?.color??"")}}/>{`W${objects.filter(o=>o.kind==="wire").findIndex(o=>o.id===id)+1}`}</button></td><td>{w?.label}</td></tr>;})}</tbody></table>{pipeSceneWireIds(objects.find(o=>o.id===physicalMenu.id)).length===0&&<span>Нет назначенных проводов</span>}</> : <>
          {onObjectsIsolate&&physicalMenu.isolationIds?.length&&<button type="button" className="ui-control" onClick={()=>{onObjectsIsolate(physicalMenu.isolationIds!);setPhysicalMenu(null);}}>Изолировать</button>}
          {onObjectsSave&&physicalMenu.isolationIds?.length&&<button type="button" className="ui-control" onClick={()=>{onObjectsSave(physicalMenu.isolationIds!);setPhysicalMenu(null);}}>Сохранить</button>}
          {onDetachedPairAction&&pairActionIds(physicalMenu.id).length===2&&(["twist","straighten"] as const).map(action=><button key={action} type="button" className="ui-control" onClick={()=>{onDetachedPairAction(pairActionIds(physicalMenu.id),action);setPhysicalMenu(null);}}>{action==="twist"?"Свить пару":"Распрямить пару"}</button>)}
          {onFreeWireEndStyleRequest&&(["from","to"] as const).filter(end=>objects.find(o=>o.id===physicalMenu.id)?.metadata?.[end==="from"?"freeFrom":"freeTo"]==="true").map(end=><button key={end} type="button" className="ui-control" onClick={()=>{onFreeWireEndStyleRequest(physicalMenu.id,end);setPhysicalMenu(null);}}>{end==="from"?"Оконцовка начала":"Оконцовка конца"}</button>)}
          {objectProperties?.(physicalMenu.id)}
          {!objectProperties&&onPhysicalContextAction&&objects.some(o=>o.id===physicalMenu.id&&o.kind==="physical-segment")&&<button type="button" className="ui-control" onClick={()=>{onPhysicalContextAction(physicalMenu.id,physicalMenu.point,"remove-pipe");setPhysicalMenu(null);}}>Удалить пайп</button>}
          {physicalMenu.node ? onPhysicalNodesConnect&&<button type="button" className="ui-control" disabled={objects.filter(o=>o.kind==="physical-node"&&!o.metadata?.joiningPipe&&selectedSet.has(o.id)).length!==2} onClick={()=>{const nodes=objects.filter(o=>o.kind==="physical-node"&&!o.metadata?.joiningPipe&&selectedSet.has(o.id));if(nodes.length===2)onPhysicalNodesConnect?.(nodes[0]!.id,nodes[1]!.id);setPhysicalMenu(null);}}>Пайп между двумя узлами</button> : onPhysicalContextAction&&objects.some(o=>o.id===physicalMenu.id&&(o.kind==="physical-segment"||o.kind==="physical-covering"))&&<details className="he-covering-actions"><summary>Оболочки и ответвление</summary><div className="he-context-actions">{([...(objects.find(o=>o.id===physicalMenu.id)?.kind==="physical-segment"&&objects.find(o=>o.id===physicalMenu.id)?.pipe?.role!=="joining-pipe"?["branch" as const]:[]),...standardCoveringKinds] as const).map(action=><button type="button" className="ui-control" key={action} onClick={()=>{const target=objects.find(o=>o.id===physicalMenu.id);onPhysicalContextAction?.(physicalMenu.id,physicalMenu.point,action,target?.kind==="physical-covering"?"covering":"segment");setPhysicalMenu(null);}}>{action==="branch"?"Т-ответвление":action}</button>)}</div></details>}
        </>}
      </CanvasObjectPopover>}
      {overlay && <div className="he-e4-wire-popover">{overlay}</div>}
      {diagnosticOverlay && <div className="he-e4-diagnostic-popover">{diagnosticOverlay}</div>}
      {!pendingPlacement && inlineEditor && inlineObject && inlineLayout && (
        <div
          className={`he-e4-inline-editor ${inlineObject.metadata?.diagnostic === "error" ? "has-error" : ""}`}
          style={{
            left: inlineLayout.x * camera.zoom + camera.offsetX + (inlineDragOffset?.x ?? 0),
            top: inlineLayout.y * camera.zoom + camera.offsetY + (inlineDragOffset?.y ?? 0),
            width: inlineLayout.width,
            height: inlineLayout.height,
            transform: `scale(${camera.zoom})`,
          }}
          onPointerDown={inlinePointerDown}
          onPointerMove={inlinePointerMove}
          onPointerUp={inlinePointerUp}
          onPointerCancel={inlinePointerCancel}
          onLostPointerCapture={inlinePointerCancel}
          onDoubleClick={inlineDoubleClick}
        >{inlineEditor}</div>
      )}
      <ul className="visually-hidden" aria-label="Объекты на поле">
        {objectsInPaintOrder(objects, layers, view).map((object) => <li key={object.id}>{object.label}</li>)}
      </ul>
    </div>
  );
}
