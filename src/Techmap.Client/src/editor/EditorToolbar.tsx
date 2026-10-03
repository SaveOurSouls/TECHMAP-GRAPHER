import { editorZoomPresets } from "./editor-camera";
import type { EditorTool, HarnessEditorView } from "./editor-types";

interface ToolDefinition {
  readonly id: EditorTool;
  readonly label: string;
  readonly shortcut: string;
  readonly glyph: string;
  readonly views: readonly HarnessEditorView[];
}

const tools: readonly ToolDefinition[] = [
  { id: "position-rail", label: "Привязка позиций", shortcut: "R", glyph: "┄", views: ["drawing"] },
  { id: "dimension-auxiliary", label: "Вспомогательный размер", shortcut: "", glyph: "↔", views: ["drawing"] },
  { id: "select", label: "Выбор", shortcut: "V", glyph: "↖", views: ["e4", "drawing"] },
  { id: "pan", label: "Перемещение поля", shortcut: "H", glyph: "✋", views: ["e4", "drawing"] },
  { id: "connector", label: "Соединитель", shortcut: "C", glyph: "▣", views: ["e4", "drawing"] },
  { id: "wire", label: "Провод", shortcut: "W", glyph: "╱", views: ["e4", "drawing"] },
  { id: "text", label: "Текст", shortcut: "T", glyph: "T", views: ["e4", "drawing"] },
  { id: "graphic-contact", label: "Графический контакт", shortcut: "", glyph: "⊕", views: ["e4", "drawing"] },
  { id: "graphic-line", label: "Линия", shortcut: "", glyph: "╱", views: ["e4", "drawing"] },
  { id: "graphic-polyline", label: "Полилиния", shortcut: "", glyph: "⌁", views: ["e4", "drawing"] },
  { id: "graphic-rectangle", label: "Прямоугольник", shortcut: "", glyph: "□", views: ["e4", "drawing"] },
  { id: "graphic-ellipse", label: "Эллипс", shortcut: "", glyph: "○", views: ["e4", "drawing"] },
  { id: "graphic-bezier", label: "Кривая Безье", shortcut: "", glyph: "∿", views: ["e4", "drawing"] },
  { id: "graphic-closed-contour", label: "Замкнутый контур", shortcut: "", glyph: "◇", views: ["e4", "drawing"] },
  { id: "graphic-text", label: "Текст фигуры", shortcut: "", glyph: "T+", views: ["e4", "drawing"] },
];

export function editorToolShortcut(event: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "altKey" | "metaKey" | "isComposing">, view: HarnessEditorView): EditorTool | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return null;
  const shortcut = event.code.startsWith("Key") ? event.code.slice(3) : event.key.toUpperCase();
  // Keep existing keyboard workflows available without a separate dimensions menu.
  if(shortcut==="D"&&view==="drawing")return "dimension";
  return tools.find(tool => tool.shortcut && tool.shortcut === shortcut && tool.views.includes(view))?.id ?? null;
}

export interface EditorToolbarProps {
  readonly view: HarnessEditorView;
  readonly activeTool: EditorTool;
  readonly zoom: number;
  readonly onToolChange: (tool: EditorTool) => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomChange: (zoom: number) => void;
  readonly onFitView: () => void;
  readonly selectedGraphic?: boolean;
  readonly canPasteGraphic?: boolean;
  readonly onCopy?:()=>void;
  readonly onPaste?:()=>void;
  readonly onDelete?:()=>void;
  readonly onUndo?:()=>void;
  readonly angleStep?:number;
  readonly onAngleStepChange?:(degrees:number)=>void;
  readonly snaps?:{corners:boolean;contours:boolean;tangents:boolean};
  readonly onSnapsChange?:(snaps:{corners:boolean;contours:boolean;tangents:boolean})=>void;
}

export function EditorToolbar({
  view,
  activeTool,
  zoom,
  onToolChange,
  onZoomIn,
  onZoomOut,
  onZoomChange,
  onFitView,
  selectedGraphic=false,canPasteGraphic=false,onCopy,onPaste,onDelete,onUndo,angleStep=15,onAngleStepChange,snaps,onSnapsChange,
}: EditorToolbarProps) {
  const zoomIsPreset = editorZoomPresets.some((preset) => Math.abs(preset - zoom) < 0.001);

  return (
    <aside className="he-toolbar" aria-label="Инструменты редактора">
      <div className="he-toolbar-group">
        {tools.filter((tool) => tool.views.includes(view)).map((tool) => (
          <button
            className={activeTool === tool.id ? "he-tool active" : "he-tool"}
            type="button"
            key={tool.id}
            title={tool.shortcut?`${tool.label} · ${tool.shortcut}`:tool.label}
            aria-label={tool.shortcut?`${tool.label}, клавиша ${tool.shortcut}`:tool.label}
            aria-pressed={activeTool === tool.id}
            aria-keyshortcuts={tool.shortcut || undefined}
            onClick={() => onToolChange(tool.id)}
          >
            <span aria-hidden="true">{tool.glyph}</span>
            <small>{tool.shortcut}</small>
          </button>
        ))}
      </div>
      <div className="he-toolbar-group" aria-label="Правка графики">
        <button className="he-tool" type="button" aria-label="Копировать фигуры" disabled={!selectedGraphic} onClick={onCopy}>⧉</button>
        <button className="he-tool" type="button" aria-label="Вставить фигуры" disabled={!canPasteGraphic} onClick={onPaste}>▣</button>
        <button className="he-tool" type="button" aria-label="Удалить выбранную фигуру" disabled={!selectedGraphic} onClick={onDelete}>⌫</button>
        <button className="he-tool" type="button" aria-label="Отменить" onClick={onUndo}>↶</button>
        <select className="he-graphic-angle" aria-label="Шаг угловой привязки" title="Угол привязки" value={angleStep} onChange={event=>onAngleStepChange?.(Number(event.target.value))}><option value={15}>15°</option><option value={30}>30°</option><option value={45}>45°</option><option value={90}>90°</option></select>
        {snaps&&<><label className="he-graphic-snap" title="Привязка к углам"><input aria-label="Углы" type="checkbox" checked={snaps.corners} onChange={event=>onSnapsChange?.({...snaps,corners:event.target.checked})}/>⌟</label><label className="he-graphic-snap" title="Привязка к контурам"><input aria-label="Контуры" type="checkbox" checked={snaps.contours} onChange={event=>onSnapsChange?.({...snaps,contours:event.target.checked})}/>◇</label><label className="he-graphic-snap" title="Привязка касательной к окружности"><input aria-label="Касательные" type="checkbox" checked={snaps.tangents} onChange={event=>onSnapsChange?.({...snaps,tangents:event.target.checked})}/>∠</label></>}
      </div>
      <div className="he-toolbar-group he-zoom-tools" aria-label="Масштаб">
        <button className="he-tool" type="button" aria-label="Увеличить масштаб" title="Увеличить" onClick={onZoomIn}>+</button>
        <select
          className="he-zoom-select"
          aria-label="Масштаб редактора"
          title="Масштаб редактора"
          value={zoomIsPreset ? String(zoom) : "custom"}
          onChange={(event) => event.target.value === "fit"
            ? onFitView()
            : event.target.value !== "custom" && onZoomChange(Number(event.target.value))}
        >
          {!zoomIsPreset && <option value="custom">{Math.round(zoom * 100)}%</option>}
          {editorZoomPresets.map((preset) => (
            <option key={preset} value={preset}>{Math.round(preset * 100)}%</option>
          ))}
          <option value="fit">Вписать в экран</option>
        </select>
        <button className="he-tool" type="button" aria-label="Уменьшить масштаб" title="Уменьшить" onClick={onZoomOut}>−</button>
        <button className="he-tool he-fit-tool" type="button" aria-label="Вписать в экран" title="Вписать в экран" onClick={onFitView}>⌂</button>
      </div>
    </aside>
  );
}
