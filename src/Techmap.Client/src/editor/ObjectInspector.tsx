import { useEffect, useState } from "react";
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

/** Returns null for valid intermediate text that must stay editable but must not reach the document. */
export function parseWireCorrectionDraft(value: string): number | null {
  const normalized = value.trim();
  if (normalized === "" || normalized === "-" || normalized === "+" ||
      normalized === "." || normalized === "-." || normalized === "+.") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function WireCorrectionInput({
  label,
  value,
  disabled,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <label>
    {label}
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        const parsed = parseWireCorrectionDraft(next);
        if (parsed !== null) onCommit(String(parsed));
      }}
      onBlur={() => {
        if (parseWireCorrectionDraft(draft) === null) setDraft(value);
      }}
    />
  </label>;
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

  const wireLengthKnown = selectedObject.kind === "wire" && selectedObject.metadata?.lengthKnown !== "false";
  const wireCutLengthMm = selectedObject.kind === "wire" ? selectedObject.metadata?.cutLengthMm : undefined;

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
        <>
          <label className="he-toggle-field">
            <input
              type="checkbox"
              aria-label="Длина задана"
              checked={wireLengthKnown}
              disabled={disabled}
              onChange={(event) => onChange(selectedObject.id, {
                metadata: {
                  ...selectedObject.metadata,
                  lengthKnown: String(event.target.checked),
                  lengthMm: event.target.checked ? selectedObject.metadata?.lengthMm || "0" : "",
                },
              })}
            />
            <span>Длина задана</span>
          </label>
          <label>
            Абсолютная длина, мм
            <input
              type="number"
              aria-label="Абсолютная длина, мм"
              min="0"
              step="0.001"
              value={selectedObject.metadata?.lengthMm ?? ""}
              disabled={disabled || !wireLengthKnown}
              onChange={(event) => onChange(selectedObject.id, {
                metadata: { ...selectedObject.metadata, lengthMm: event.target.value },
              })}
            />
          </label>
          <div className="he-field-pair">
            <WireCorrectionInput
              key={`${selectedObject.id}:from`}
              label="Поправка начала, мм"
              value={selectedObject.metadata?.endCorrectionFromMm ?? "0"}
              disabled={disabled}
              onCommit={(value) => onChange(selectedObject.id, {
                metadata: { ...selectedObject.metadata, endCorrectionFromMm: value },
              })}
            />
            <WireCorrectionInput
              key={`${selectedObject.id}:to`}
              label="Поправка конца, мм"
              value={selectedObject.metadata?.endCorrectionToMm ?? "0"}
              disabled={disabled}
              onCommit={(value) => onChange(selectedObject.id, {
                metadata: { ...selectedObject.metadata, endCorrectionToMm: value },
              })}
            />
          </div>
          <label>
            Шаг округления длины резки, мм
            <input
              type="number"
              aria-label="Шаг округления длины резки, мм"
              min="0.001"
              step="0.001"
              value={selectedObject.metadata?.cutRoundingStepMm ?? "1"}
              disabled={disabled}
              onChange={(event) => onChange(selectedObject.id, {
                metadata: { ...selectedObject.metadata, cutRoundingStepMm: event.target.value },
              })}
            />
          </label>
          {wireLengthKnown ? (
            <div className="he-wire-length-status is-complete" role="status">
              <span>Расчётная длина резки</span>
              <strong>{wireCutLengthMm || "—"} мм</strong>
              <small>Длина готова для карты резки</small>
            </div>
          ) : (
            <div className="he-wire-length-status is-incomplete" role="alert">
              <strong>Длина провода не задана</strong>
              <span>Провод исключён из материалов до заполнения длины.</span>
            </div>
          )}
        </>
      )}
      {(selectedObject.kind === "connector" || selectedObject.kind === "text") && (
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
      )}
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
