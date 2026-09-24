import { InfoHint } from "../InfoHint";
import { DraftNumberInput } from "../component-library/DraftNumberInput";
import type { EditorCommand } from "./commands";
import type { HarnessDesignDocument } from "./model";
import { PhysicalTopologyPanel } from "./PhysicalTopologyPanel";
import { PhysicalCoveringsPanel } from "./PhysicalCoveringsPanel";
import { DrawingRotationControl } from "./DrawingRotationControl";
import { DrawingScaleControl } from "./DrawingScaleControl";
import { DRAWING_VIEW_PLACEMENT_ID,drawingRotation,drawingScale } from "./drawing-scale";
import { projectComponentTemplateView,type ComponentTemplateViewInstance } from "./component-template-view-renderer";
import { resolveWireColorHex } from "./wire-reference-catalog";

export function DrawingObjectProperties({document,objectId,selectedIds,onCommand,onSelect,instances}: {
  document:HarnessDesignDocument;objectId:string;onCommand:(command:EditorCommand)=>boolean;
  selectedIds:readonly string[];
  onSelect:(id:string)=>void;instances:readonly ComponentTemplateViewInstance[];
}) {
  const t=document.physicalTopology,connector=document.connectors.find(c=>c.id===objectId),wire=document.wires.find(w=>w.id===objectId);
  const topology=t&&(t.nodes.some(n=>n.id===objectId)||t.segments.some(s=>s.id===objectId)||wire);
  const cover=t?.coverings?.some(c=>c.id===objectId);
  return <>
    {connector&&<section className="he-context-fields" aria-label="Рисунок соединителя">
      <strong>{connector.designation}</strong>
      <label>Масштаб<DrawingScaleControl value={drawingScale(connector.drawingPlacements)} label="Масштаб рисунка на чертеже" disabled={connector.libraryBinding?.mode!=="template"} onChange={scale=>onCommand({type:"set-drawing-placement",connectorId:objectId,drawingId:DRAWING_VIEW_PLACEMENT_ID,scale})}/></label>
      <DrawingRotationControl value={drawingRotation(connector.drawingPlacements)} disabled={connector.libraryBinding?.mode!=="template"} onChange={rotationDegrees=>{
        const instance=instances.find(i=>i.objectId===objectId),bounds=instance?projectComponentTemplateView(instance,"drawing",connector.positions.drawing)?.bounds:undefined;
        onCommand({type:"set-drawing-placement",connectorId:objectId,drawingId:DRAWING_VIEW_PLACEMENT_ID,rotationDegrees,...(bounds?{rotationCenter:{x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2}}:{})});
      }}/><InfoHint>Масштаб и поворот доступны библиотечному рисунку и применяются вместе с контактами и направлениями выходов. Для редактирования самого рисунка откройте библиотеку.</InfoHint>
    </section>}
    {wire&&<section className="he-context-fields" aria-label="Свойства провода">
      <label>Цепь<input aria-label="Цепь провода" value={wire.circuit} onChange={e=>onCommand({type:"update-wire",wireId:objectId,circuit:e.target.value})}/></label>
      <label>Цвет<input type="color" aria-label="Цвет провода" value={resolveWireColorHex(wire.color)} onChange={e=>onCommand({type:"update-wire",wireId:objectId,color:e.target.value})}/></label>
      <label>Поправка A, мм<DraftNumberInput aria-label="Поправка A, мм" value={wire.endCorrectionFromMm} onValueChange={endCorrectionFromMm=>onCommand({type:"update-wire",wireId:objectId,endCorrectionFromMm})}/></label>
      <label>Поправка B, мм<DraftNumberInput aria-label="Поправка B, мм" value={wire.endCorrectionToMm} onValueChange={endCorrectionToMm=>onCommand({type:"update-wire",wireId:objectId,endCorrectionToMm})}/></label>
      <InfoHint>Цвет и цепь общие с Э4. Поправки учитываются в длине заготовки; размеры участков задаются на поле.</InfoHint>
    </section>}
    {topology&&<PhysicalTopologyPanel mode="object" document={document} selectedId={objectId} selectedIds={selectedIds.includes(objectId)?selectedIds:[objectId]} onChange={topology=>onCommand({type:"set-physical-topology",topology})} onSelect={onSelect}/>}
    {t?.segments.some(s=>s.id===objectId)&&<button type="button" className="ui-control" onClick={()=>{
      const segments=t.segments.filter(s=>s.id===objectId||selectedIds.includes(s.id)),id=crypto.randomUUID();
      if(onCommand({type:"set-physical-topology",topology:{...t,coverings:[...t.coverings??[],{id,name:"Оболочка",width:0,color:"#84959f",lengthMm:null,spans:segments.map(s=>({segmentId:s.id,from:0,to:1}))}]}}))onSelect(id);
    }}>Оболочка на выделенные пайпы</button>}
    {t?.segments.some(s=>s.id===objectId)&&<button type="button" className="ui-control" onClick={()=>onCommand({type:"remove-physical-segment",segmentId:objectId})}>Удалить пайп</button>}
    {cover&&t&&<PhysicalCoveringsPanel compact document={document} topology={t} selectedIds={[objectId]} onChange={topology=>onCommand({type:"set-physical-topology",topology})} onReveal={onSelect}/>}
  </>;
}
