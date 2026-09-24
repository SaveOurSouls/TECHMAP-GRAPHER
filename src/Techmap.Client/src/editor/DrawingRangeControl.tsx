import { useRef } from "react";
import { InfoHint } from "../InfoHint";

/** A drag previews freely, but creates one history entry when it finishes. */
export function DrawingRangeControl({label, accessibleLabel, value, min, max, step, hint, onPreview, onCommit}: {
  label:string; accessibleLabel:string; value:number; min:number; max:number; step:number;
  hint:string; onPreview:(value:number|null)=>void; onCommit:(value:number)=>void;
}) {
  const pending=useRef<number|null>(null);
  const cancel=()=>{pending.current=null;onPreview(null);};
  const commit=()=>{
    const next=pending.current;
    pending.current=null;
    if(next!==null)onCommit(next);
    onPreview(null);
  };
  return <div className="he-thickness-control"><label>{label}<input
    aria-label={accessibleLabel} type="range" min={min} max={max} step={step} value={value}
    onChange={e=>{pending.current=Number(e.target.value);onPreview(pending.current);}}
    onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)}
    onPointerUp={commit} onPointerCancel={cancel} onLostPointerCapture={cancel}
    onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();e.preventDefault();cancel();}}}
    onKeyUp={commit} onBlur={commit}
  /></label><output>{value.toFixed(2)}×</output><InfoHint>{hint}</InfoHint></div>;
}
