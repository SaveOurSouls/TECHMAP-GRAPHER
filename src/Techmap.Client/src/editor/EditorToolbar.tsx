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
  { id: "select", label: "Выбор", shortcut: "V", glyph: "↖", views: ["e4", "drawing"] },
  { id: "pan", label: "Перемещение поля", shortcut: "H", glyph: "✋", views: ["e4", "drawing"] },
  { id: "connector", label: "Соединитель", shortcut: "C", glyph: "▣", views: ["e4", "drawing"] },
  { id: "wire", label: "Провод", shortcut: "W", glyph: "╱", views: ["e4", "drawing"] },
  { id: "text", label: "Текст", shortcut: "T", glyph: "T", views: ["e4", "drawing"] },
  { id: "dimension-horizontal", label: "Горизонтальный размер", shortcut: "", glyph: "↔", views: ["drawing"] },
  { id: "dimension-vertical", label: "Вертикальный размер", shortcut: "", glyph: "↕", views: ["drawing"] },
  { id: "dimension", label: "Свободный размер", shortcut: "D", glyph: "⤢", views: ["drawing"] },
];

export interface EditorToolbarProps {
  readonly view: HarnessEditorView;
  readonly activeTool: EditorTool;
  readonly zoom: number;
  readonly onToolChange: (tool: EditorTool) => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onZoomChange: (zoom: number) => void;
  readonly onFitView: () => void;
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
            onClick={() => onToolChange(tool.id)}
          >
            <span aria-hidden="true">{tool.glyph}</span>
            <small>{tool.shortcut}</small>
          </button>
        ))}
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
