import type { EditorSceneObject } from "./editor-types";
import { wireBlankEnds, wireBlankEndLabels, type WireBlankEnd } from "../WireBlankCatalog";

export function FreeWireEndsPanel({ objects, selectedIds, disabled, onStyle, onStyles, onEndpoint, onBulkX }: {
  readonly objects: readonly EditorSceneObject[]; readonly selectedIds: readonly string[]; readonly disabled: boolean;
  readonly onStyle: (wireId: string, end: "from" | "to", style: WireBlankEnd) => void;
  readonly onStyles: (wireIds: readonly string[], end: "from" | "to", style: WireBlankEnd) => void;
  readonly onEndpoint: (wireId: string, end: "from" | "to", position: { x: number; y: number }) => void;
  readonly onBulkX?: (wireIds: readonly string[], end: "from" | "to", x: number) => void;
}) {
  const wires = objects.filter(item => item.kind === "wire" && selectedIds.includes(item.id) && (item.metadata?.freeFrom === "true" || item.metadata?.freeTo === "true"));
  if (!wires.length) return null;
  const style = (wire: EditorSceneObject, end: "from" | "to") => wire.drawingEndStyles?.[end] ?? "cut";
  return <section className="he-free-wire-ends" aria-label="Свободные концы проводов">
    <h3>Свободные концы</h3>
    {wires.map(wire => <div className="he-free-wire-row" key={wire.id}><strong>{wire.label || wire.id}</strong>{(["from", "to"] as const).filter(end => wire.metadata?.[end === "from" ? "freeFrom" : "freeTo"] === "true").map(end => {
      const point = end === "from" ? wire.points?.[0] : wire.points?.at(-1);
      return <label key={end}>{end === "from" ? "Начало" : "Конец"}
        <select aria-label={`${wire.label || wire.id}: режим ${end}`} value={style(wire, end)} disabled={disabled} onChange={event => onStyle(wire.id, end, event.target.value as WireBlankEnd)}>{wireBlankEnds.map(item => <option key={item} value={item}>{wireBlankEndLabels[item]}</option>)}</select>
        {point && <span className="he-free-wire-coordinates"><input aria-label={`${wire.label || wire.id}: X ${end}`} type="number" value={point.x} disabled={disabled} onChange={event => onEndpoint(wire.id, end, { x: Number(event.target.value), y: point.y })} /><input aria-label={`${wire.label || wire.id}: Y ${end}`} type="number" value={point.y} disabled={disabled} onChange={event => onEndpoint(wire.id, end, { x: point.x, y: Number(event.target.value) })} /></span>}
      </label>;
    })}</div>)}
    {wires.length > 1 && <div className="he-free-wire-bulk"><strong>Для всех выбранных</strong>{(["from", "to"] as const).map(end => <div key={end}><select aria-label={`Общий режим ${end}`} defaultValue="" disabled={disabled} onChange={event => { if (event.target.value) onStyles(wires.map(item => item.id), end, event.target.value as WireBlankEnd); event.currentTarget.value = ""; }}><option value="">{end === "from" ? "Начало…" : "Конец…"}</option>{wireBlankEnds.map(item => <option key={item} value={item}>{wireBlankEndLabels[item]}</option>)}</select>{onBulkX && <input aria-label={`Общая координата X ${end}`} type="number" disabled={disabled} placeholder="X" onChange={event => { const x = Number(event.target.value); if (Number.isFinite(x)) onBulkX(wires.map(item => item.id), end, x); }} />}</div>)}</div>}
  </section>;
}
