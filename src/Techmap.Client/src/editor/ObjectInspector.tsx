import type { EditorSceneObject, HarnessEditorView } from "./editor-types";

export interface ObjectInspectorProps {
  readonly view: HarnessEditorView;
  readonly selectedObject: EditorSceneObject | null;
  readonly disabled: boolean;
  readonly onChange: (
    objectId: string,
    patch: Partial<Pick<EditorSceneObject, "label" | "x" | "y" | "color" | "metadata">>,
  ) => void;
}

const kindLabels: Readonly<Record<EditorSceneObject["kind"], string>> = {
  connector: "Соединитель",
  wire: "Провод",
  text: "Текст",
  dimension: "Размер",
};

function finiteNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ObjectInspector({ view, selectedObject, disabled, onChange }: ObjectInspectorProps) {
  if (!selectedObject) {
    return (
      <div className="he-inspector-empty">
        <span className="he-inspector-empty-glyph" aria-hidden="true">◎</span>
        <strong>Объект не выбран</strong>
        <span>Выберите объект на поле, чтобы изменить его параметры.</span>
      </div>
    );
  }

  return (
    <form className="he-property-form" onSubmit={(event) => event.preventDefault()}>
      <div className="he-selected-object">
        <span className={`he-object-symbol ${selectedObject.kind}`} aria-hidden="true" />
        <div>
          <strong>{kindLabels[selectedObject.kind]}</strong>
          <span>{selectedObject.id}</span>
        </div>
      </div>
      <label>
        {selectedObject.kind === "wire" ? "Цепь / обозначение" : "Обозначение"}
        <input
          value={selectedObject.label}
          disabled={disabled}
          onChange={(event) => onChange(selectedObject.id, { label: event.target.value })}
        />
      </label>
      {selectedObject.kind === "wire" && (
        <label>
          Абсолютная длина, мм
          <input
            type="number"
            min="0.001"
            step="0.1"
            value={selectedObject.metadata?.lengthMm ?? ""}
            disabled={disabled}
            onChange={(event) => onChange(selectedObject.id, {
              metadata: { ...selectedObject.metadata, lengthMm: event.target.value },
            })}
          />
        </label>
      )}
      <div className="he-field-pair">
        <label>
          X
          <input
            type="number"
            value={selectedObject.x}
            disabled={disabled}
            onChange={(event) => onChange(selectedObject.id, {
              x: finiteNumber(event.target.value, selectedObject.x),
            })}
          />
        </label>
        <label>
          Y
          <input
            type="number"
            value={selectedObject.y}
            disabled={disabled}
            onChange={(event) => onChange(selectedObject.id, {
              y: finiteNumber(event.target.value, selectedObject.y),
            })}
          />
        </label>
      </div>
      <label>
        Цвет
        <span className="he-color-field">
          <input
            type="color"
            aria-label="Цвет объекта"
            value={selectedObject.color}
            disabled={disabled}
            onChange={(event) => onChange(selectedObject.id, { color: event.target.value })}
          />
          <code>{selectedObject.color.toUpperCase()}</code>
        </span>
      </label>
      <div className="he-readonly-facts">
        <div><span>Слой</span><strong>{selectedObject.layerId}</strong></div>
        <div><span>Представление</span><strong>{view === "e4" ? "Схема Э4" : "Чертёж"}</strong></div>
      </div>
    </form>
  );
}
