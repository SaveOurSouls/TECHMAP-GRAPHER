import {
  type TemplateContentV3 as TemplateContentV2,
  type ViewContactPointV3 as ViewContactPointV2,
  type LogicalContactV3 as LogicalContactV2,
  type BundlePortV3 as BundlePortV2,
} from "./template-model-v3";
import {
  renameViewV3 as renameViewV2,
  addAdditionalViewV3,
  deleteAdditionalViewV3 as deleteAdditionalViewV2,
  renameLayerV3 as renameLayerV2,
  reorderLayerV3 as reorderLayerV2,
  deleteLayerV3 as deleteLayerV2,
  type LogicalContactEditV3 as LogicalContactEditV2,
  type ContactPointEditV3 as ContactPointEditV2,
  constantExpressionV3 as constantExpressionV2,
  type BundlePortEditV3 as BundlePortEditV2,
  type NodeEditV3 as NodeEditV2,
} from "./template-commands-v3";
import { constantValue, type EditableNode, nodePosition, nodeDimensions, editDimension } from "./library-node-editing";
import { InfoHint } from "../InfoHint";
import { type ContactDirectionV2, type ImageNodeV2 } from "./template-model-v2";
import { type DrawingHatch, hatchKinds, hatchLabels } from "./drawing-hatch";
import { DraftNumberInput } from "./DraftNumberInput";

export function ViewAndLayerProperties({ content, viewId, layerId, change, command, selectLayer, selectView }: { content: TemplateContentV2; viewId: string; layerId: string | null; change: (content: TemplateContentV2, selection?: string | null) => void; command: (action: () => TemplateContentV2, selection?: string | null) => void; selectLayer: (id: string) => void; selectView: (id: string) => void }) {
  const view = content.views.find(item => item.id === viewId)!, layer = view.layers.find(item => item.id === layerId);
  return <><label>Название вида<input value={view.name} onChange={event => command(() => renameViewV2(content, view.id, event.target.value))} /></label>{view.kind === "additional" && <button className="danger-action" onClick={() => { const [next,id] = addAdditionalViewV3(deleteAdditionalViewV2(content, view.id),view.name); command(() => next, null); selectView(id); }}>Удалить дополнительный вид</button>}{layer && <><label>Название слоя<input value={layer.name} disabled={layer.locked} onChange={event => command(() => renameLayerV2(content, view.id, layer.id, event.target.value))} /></label><div className="property-order"><button disabled={layer.locked || view.layers[0]!.id === layer.id} onClick={() => command(() => reorderLayerV2(content, view.id, layer.id, view.layers.indexOf(layer) - 1))}>Выше</button><button disabled={layer.locked || view.layers.at(-1)!.id === layer.id} onClick={() => command(() => reorderLayerV2(content, view.id, layer.id, view.layers.indexOf(layer) + 1))}>Ниже</button></div><button className="danger-action" disabled={layer.locked || view.layers.length === 1} onClick={() => { const fallback = view.layers.find(item => item.id !== layer.id)!; change(deleteLayerV2(content, view.id, layer.id), null); selectLayer(fallback.id); }}>Удалить слой</button></>}</>;
}
export function ContactPointProperties({ point, logical, groups, editLogical, editPoint, remove, tableBound }: { tableBound?: boolean; point: ViewContactPointV2; logical: LogicalContactV2; groups: TemplateContentV2["contactTypeGroups"]; editLogical: (changes: LogicalContactEditV2) => void; editPoint: (changes: ContactPointEditV2) => void; remove: () => void }) {
  const x = constantValue(point.x), y = constantValue(point.y);
  return <>
    <strong>Общие данные контакта</strong>
    {tableBound && <InfoHint>Номер, название, цепь, тип и стандартный терминал наследуются из строки таблицы Э4. Здесь меняется только положение точки.</InfoHint>}
    <label>Номер контакта<input disabled={tableBound} value={logical.number} onChange={event => editLogical({ number: event.target.value })} /></label>
    <label>Название<input disabled={tableBound} value={logical.name} onChange={event => editLogical({ name: event.target.value })} /></label>
    <label>Цепь<input disabled={tableBound} value={logical.circuitText ?? ""} onChange={event => editLogical({ circuitText: event.target.value })} placeholder="Например, DATA+" /></label>
    <label>Группа контакта<select disabled={tableBound} value={logical.contactTypeGroupId ?? ""} onChange={event => editLogical({ contactTypeGroupId: event.target.value || null })}><option value="">Не задана</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <strong>Точка в активном виде</strong>
    {x !== null && y !== null ? <div className="coordinate-grid">
      <NumericField label="X" value={x} change={value => editPoint({ x: constantExpressionV2(value) })} />
      <NumericField label="Y" value={y} change={value => editPoint({ y: constantExpressionV2(value) })} />
    </div> : <p className="readonly-note">Положение задано параметрами и сохраняется только для чтения.</p>}
    <label>Направление<select value={point.direction} onChange={event => editPoint({ direction: event.target.value as ContactDirectionV2 })}><option value="left">Влево</option><option value="right">Вправо</option><option value="up">Вверх</option><option value="down">Вниз</option></select></label>
    <button className="danger-action" type="button" onClick={remove}>Удалить точку из вида</button>
  </>;
}
export function BundlePortProperties({ port, edit, remove }: { port: BundlePortV2; edit: (changes: BundlePortEditV2) => void; remove: () => void }) {
  const x = constantValue(port.x), y = constantValue(port.y);
  return <>
    <label>Название<input value={port.name} onChange={event => edit({ name: event.target.value })} /></label>
    {x !== null && y !== null ? <div className="coordinate-grid">
      <NumericField label="X" value={x} change={value => edit({ x: constantExpressionV2(value) })} />
      <NumericField label="Y" value={y} change={value => edit({ y: constantExpressionV2(value) })} />
    </div> : <p className="readonly-note">Положение задано параметрами и сохраняется только для чтения.</p>}
    <label>Направление<select value={port.direction} onChange={event => edit({ direction: event.target.value as ContactDirectionV2 })}><option value="left">Влево</option><option value="right">Вправо</option><option value="up">Вверх</option><option value="down">Вниз</option></select></label>
    <p className="readonly-note">Общий выход связывает геометрию жгута и не создаёт электрический контакт.</p>
    <button className="danger-action" type="button" onClick={remove}>Удалить общий выход из вида</button>
  </>;
}
export function NodeProperties({ node, disabled, edit, move, toggleLock, section, textEditorRef }: { section: "geometry" | "stroke" | "fill"; textEditorRef: React.RefObject<HTMLInputElement | null>; node: EditableNode; disabled: boolean; edit: (changes: NodeEditV2) => void; move: (x: number, y: number) => void; toggleLock: () => void }) {
  const position = nodePosition(node), dimensions = nodeDimensions(node);
  const strokeWidth = constantValue(node.stroke.width) ?? 0;
  const canFill = node.kind === "rectangle" || node.kind === "ellipse" || node.kind === "closedContour" || node.kind === "bezier" && node.geometry.closed;
  const fillEnabled = canFill && node.fill.color !== null;
  const updateStroke = (changes: Partial<typeof node.stroke>) => edit({ stroke: { ...node.stroke, ...changes } });
const colors = ["#27445a", "#000000", "#111827", "#6b7280", "#ffffff", "#dc2626", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed"];
  return <>
    {section === "geometry" && <button type="button" onClick={toggleLock}>{node.locked ? "Разблокировать объект" : "Заблокировать объект"}</button>}
    {section !== "geometry" && <section className="node-style-panel" aria-label="Стиль фигуры">
      <strong>Стиль</strong>
      {section === "fill" && canFill && <div className="style-section">
        <label className="check-field"><input type="checkbox" checked={fillEnabled} disabled={disabled} onChange={event => edit({ fill: { ...node.fill, color: event.target.checked ? node.fill.color ?? "#ffffff" : null } })} />Заливка</label>
        {fillEnabled && <>
          <label>{node.fill.hatch ? "Цвет штриховки" : "Цвет заливки"}<input type="color" value={node.fill.color ?? "#ffffff"} disabled={disabled} onChange={event => edit({ fill: { ...node.fill, color: event.target.value } })} /></label>
          <div className="style-swatches" aria-label="Быстрый выбор цвета заливки">{colors.map(color => <button key={color} type="button" aria-label={`Цвет заливки ${color}`} title={color} style={{background:color}} disabled={disabled} onClick={() => edit({fill:{...node.fill,color}})} />)}</div>
          <label>Штриховка<select disabled={disabled} value={node.fill.hatch?.kind ?? "solid"} onChange={e => edit({fill: e.target.value === "solid" ? {color:node.fill.color} : {...node.fill,hatch:{...node.fill.hatch,kind:e.target.value as DrawingHatch["kind"],spacing:node.fill.hatch?.spacing ?? 8,angle:node.fill.hatch?.angle ?? 45}}})}><option value="solid">Сплошная</option>{hatchKinds.map(kind => <option key={kind} value={kind}>{hatchLabels[kind]}</option>)}</select></label>
          {node.fill.hatch && <>
            <label className="check-field"><input type="checkbox" checked={!!node.fill.hatch.backgroundColor} disabled={disabled} onChange={e=>edit({fill:{...node.fill,hatch:{...node.fill.hatch!,backgroundColor:e.target.checked?"#ffffff":null}}})}/>Фон штриховки</label>
            <label>Цвет фона<input type="color" value={node.fill.hatch.backgroundColor ?? "#ffffff"} disabled={disabled} onChange={e=>edit({fill:{...node.fill,hatch:{...node.fill.hatch!,backgroundColor:e.target.value}}})}/></label>
            <div className="style-swatches" aria-label="Быстрый выбор цвета фона">{colors.map(color=><button key={color} type="button" title={color} aria-label={`Цвет фона ${color}`} style={{background:color}} disabled={disabled} onClick={()=>edit({fill:{...node.fill,hatch:{...node.fill.hatch!,backgroundColor:color}}})}/>)}</div>
          </>}
          {node.fill.hatch && <div className="coordinate-grid"><NumericField label="Шаг штриховки" min={2} max={100} value={node.fill.hatch.spacing} disabled={disabled} change={spacing => { if(spacing>=2 && spacing<=100) edit({fill:{...node.fill,hatch:{...node.fill.hatch!,spacing}}}); }} /><NumericField label="Угол штриховки, °" min={-360} max={360} value={node.fill.hatch.angle} disabled={disabled} change={angle => { if(Math.abs(angle)<=360) edit({fill:{...node.fill,hatch:{...node.fill.hatch!,angle}}}); }} /></div>}
          <InfoHint>Мотивы для разрезов: линии, сетка, пары, точки и кладка. Назначение материала выбирает автор; набор не заменяет требования ГОСТ 2.306 и ISO 128 к конкретному документу. Меньше шаг — плотнее штриховка.</InfoHint>
        </>}
      </div>}
      {section === "stroke" && <div className="style-section">
        <label>Цвет линии<input type="color" value={node.stroke.color} disabled={disabled} onChange={event => updateStroke({ color: event.target.value })} /></label>
        <div className="style-swatches" aria-label="Быстрый выбор цвета линии">{colors.map(color => <button key={color} type="button" title={color} aria-label={`Цвет линии ${color}`} style={{ background: color }} className={node.stroke.color.toLowerCase() === color ? "active" : ""} disabled={disabled} onClick={() => updateStroke({ color })} />)}</div>
        <div className="style-row"><NumericField label="Толщина" value={strokeWidth} min={0} max={24} step={0.5} immediate disabled={disabled || node.stroke.width.kind !== "constant"} change={value => { if (value >= 0 && value <= 24) updateStroke({ width: constantExpressionV2(value) }); }} />
          <label>Штрих<select value={node.stroke.dash ?? "solid"} disabled={disabled} onChange={event => updateStroke({ dash: event.target.value as NonNullable<typeof node.stroke.dash> })}><option value="solid">Сплошная</option><option value="dash">Штрих</option><option value="dot">Точки</option><option value="dash-dot">Штрих-точка</option></select></label></div>
      </div>}
    </section>}
    {section === "geometry" && <>
    {node.kind === "text" && <label>Текст<input ref={textEditorRef} aria-label="Содержимое текста" value={node.geometry.text} disabled={disabled} onChange={event => edit({ geometry: { ...node.geometry, text: event.target.value } })} /></label>}
    <div className="coordinate-grid"><NumericField label="X" value={position.x} disabled={disabled} change={value => move(value, position.y)} /><NumericField label="Y" value={position.y} disabled={disabled} change={value => move(position.x, value)} />{dimensions && <><NumericField label="Ширина" value={dimensions.width} min={1} disabled={disabled} change={value => editDimension(node, "width", value, edit)} /><NumericField label="Высота" value={dimensions.height} min={1} disabled={disabled} change={value => editDimension(node, "height", value, edit)} /></>}</div>
    <NumericField label="Прозрачность, %" value={Math.round((1-node.opacity)*100)} min={0} max={100} step={1} disabled={disabled} change={value => { if (value >= 0 && value <= 100) edit({ opacity: 1-value/100 }); }} />
    {(node.kind === "line" || node.kind === "polyline" || node.kind === "bezier" || node.kind === "closedContour") && <InfoHint>Перетаскивайте маркеры точек. Двойной щелчок по сегменту добавляет вершину, по внутренней вершине — удаляет её.</InfoHint>}
    {(node.kind === "line" || node.kind === "polyline") && <NumericField label="Радиус изгиба" value={constantValue(node.geometry.bendRadius) ?? 0} min={0} disabled={disabled || node.geometry.bendRadius.kind !== "constant"} change={value => { if (value >= 0) edit({ geometry: { ...node.geometry, bendRadius: constantExpressionV2(value) } }); }} />}
    {node.kind === "image" && <ImageProperties node={node} disabled={disabled} edit={edit} />}
    </>}
  </>;
}
function ImageProperties({ node, disabled, edit }: { node: ImageNodeV2; disabled: boolean; edit: (changes: NodeEditV2) => void }) {
  const crop = (key: "cropX" | "cropY" | "cropWidth" | "cropHeight", value: number) => { if (value >= 0 && value <= 1) edit({ geometry: { ...node.geometry, [key]: value } }); };
  return <><label className="check-field"><input type="checkbox" checked={node.geometry.underlay} disabled={disabled} onChange={event => edit({ geometry: { ...node.geometry, underlay: event.target.checked } })} />Подложка</label><div className="coordinate-grid"><NumericField label="Crop X" value={node.geometry.cropX} disabled={disabled} change={value => crop("cropX", value)} /><NumericField label="Crop Y" value={node.geometry.cropY} disabled={disabled} change={value => crop("cropY", value)} /><NumericField label="Crop ширина" value={node.geometry.cropWidth} disabled={disabled} change={value => crop("cropWidth", value)} /><NumericField label="Crop высота" value={node.geometry.cropHeight} disabled={disabled} change={value => crop("cropHeight", value)} /></div></>;
}
export function NumericField({ label, value, disabled, min, max, step, immediate = false, change }: { label: string; value: number; disabled?: boolean; min?: number; max?: number; step?: number; immediate?: boolean; change: (value: number) => void }) {
  return <label>{label}<DraftNumberInput value={value} min={min} max={max} step={step} disabled={disabled} immediate={immediate} onValueChange={change} /></label>;
}
