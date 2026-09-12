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
  { id: "dimension", label: "Размер", shortcut: "D", glyph: "↔", views: ["drawing"] },
];

export interface EditorToolbarProps {
  readonly view: HarnessEditorView;
  readonly activeTool: EditorTool;
  readonly onToolChange: (tool: EditorTool) => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onResetView: () => void;
}

export function EditorToolbar({
  view,
  activeTool,
  onToolChange,
  onZoomIn,
  onZoomOut,
  onResetView,
}: EditorToolbarProps) {
  return (
    <aside className="he-toolbar" aria-label="Инструменты редактора">
      <div className="he-toolbar-group">
        {tools.filter((tool) => tool.views.includes(view)).map((tool) => (
          <button
            className={activeTool === tool.id ? "he-tool active" : "he-tool"}
            type="button"
            key={tool.id}
            title={`${tool.label} · ${tool.shortcut}`}
            aria-label={`${tool.label}, клавиша ${tool.shortcut}`}
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
        <button className="he-tool" type="button" aria-label="Уменьшить масштаб" title="Уменьшить" onClick={onZoomOut}>−</button>
        <button className="he-tool he-fit-tool" type="button" aria-label="Показать весь лист" title="Показать весь лист" onClick={onResetView}>⌂</button>
      </div>
    </aside>
  );
}

