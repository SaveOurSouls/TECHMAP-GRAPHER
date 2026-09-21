import { useEffect, useState } from "react";
import type { EditorSceneObject, HarnessEditorView } from "./editor-types";
import { calculateWireStripSteps, type WireEndStripProfiles, type WireStripProfileBinding } from "./model";
import { builtInWireColors } from "./wire-reference-catalog";

export interface ObjectInspectorProps {
  readonly view: HarnessEditorView;
  readonly selectedObject: EditorSceneObject | null;
  readonly disabled: boolean;
  readonly onChange: (
    objectId: string,
    patch: Partial<Pick<EditorSceneObject, "label" | "x" | "y" | "color" | "metadata">>,
  ) => void;
  readonly onWireMaterialClear?: (wireId: string) => void;
  readonly wireStripProfiles?: WireEndStripProfiles;
  readonly activeWireStripEnd?: "from" | "to";
  readonly onActiveWireStripEndChange?: (end: "from" | "to") => void;
  readonly onWireStripProfileClear?: (wireId: string, end: "from" | "to") => void;
}

const kindLabels: Readonly<Record<EditorSceneObject["kind"], string>> = {
  "specification-item":"Позиция спецификации",
  "drawing-table": "Таблица",
  "position-leader": "Выноска",
  "leader-anchor": "Якорь выноски",
  "physical-covering": "Оболочка",
  "physical-node": "Узел ветви",
  "physical-segment": "Участок ветви",
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

function WireStripProfilePanel({
  wireId,
  profiles,
  activeEnd,
  disabled,
  onEndChange,
  onClear,
}: {
  readonly wireId: string;
  readonly profiles?: WireEndStripProfiles;
  readonly activeEnd: "from" | "to";
  readonly disabled: boolean;
  readonly onEndChange?: (end: "from" | "to") => void;
  readonly onClear?: (wireId: string, end: "from" | "to") => void;
}) {
  const profile: WireStripProfileBinding | undefined = profiles?.[activeEnd];
  const steps = profile ? calculateWireStripSteps(profile.layers) : [];
  return <section className="he-wire-strip-profile" aria-label="Профиль разделки провода">
    <header>
      <strong>Разделка конца</strong>
      <div className="he-wire-end-tabs" role="tablist" aria-label="Конец провода">
        {(["from", "to"] as const).map((end) => <button
          key={end}
          type="button"
          role="tab"
          aria-selected={activeEnd === end}
          className={activeEnd === end ? "active" : ""}
          disabled={disabled}
          onClick={() => onEndChange?.(end)}
        >{end === "from" ? "Начало" : "Конец"}</button>)}
      </div>
    </header>
    {profile ? <>
      <div className="he-wire-strip-identity">
        <span>{profile.displayName}</span>
        <small>{profile.sourceKey}</small>
      </div>
      <table className="he-wire-strip-table">
        <thead><tr><th>Слой</th><th>D, мм</th><th>L, мм</th><th>Ступень, мм</th></tr></thead>
        <tbody>{steps.map((step) => <tr key={step.index}>
          <th>L{step.index}</th>
          <td>{step.diameterMm}</td>
          <td>{step.cumulativeLengthMm}</td>
          <td>{step.stepLengthMm}</td>
        </tr>)}</tbody>
      </table>
      {onClear && <button className="he-wire-strip-clear" type="button" disabled={disabled}
        onClick={() => onClear(wireId, activeEnd)}>Очистить {activeEnd === "from" ? "начало" : "конец"}</button>}
    </> : <div className="he-wire-strip-empty">
      <span>Профиль не выбран</span>
      <small>Выберите нужный конец и дважды щёлкните профиль разделки в нижнем справочнике.</small>
    </div>}
  </section>;
}

export function ObjectInspector({
  view,
  selectedObject,
  disabled,
  onChange,
  onWireMaterialClear,
  wireStripProfiles,
  activeWireStripEnd = "from",
  onActiveWireStripEndChange,
  onWireStripProfileClear,
}: ObjectInspectorProps) {
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
      {selectedObject.kind === "wire" && <section className="he-wire-material" aria-label="Материал провода">
        <strong>Материал</strong>
        {selectedObject.metadata?.materialSourceKey ? <>
          <span>{selectedObject.metadata.materialDisplayName || selectedObject.metadata.materialSourceKey}</span>
          <small>{selectedObject.metadata.materialSourceKey} · {selectedObject.metadata.materialEntityType === "cable" ? "кабель" : "провод"}</small>
          {onWireMaterialClear && <button type="button" disabled={disabled} onClick={() => onWireMaterialClear(selectedObject.id)}>Очистить материал</button>}
        </> : <>
          <span>Материал не выбран</span>
          <small>Выберите провод или кабель в нижнем справочнике двойным щелчком.</small>
        </>}
      </section>}
      {selectedObject.kind === "wire" && view === "drawing" && (
        <>
          <WireStripProfilePanel
            wireId={selectedObject.id}
            profiles={wireStripProfiles}
            activeEnd={activeWireStripEnd}
            disabled={disabled}
            onEndChange={onActiveWireStripEndChange}
            onClear={onWireStripProfileClear}
          />
          {selectedObject.metadata?.stripProfileDisplayWarning && (
            <div className="he-wire-length-status is-incomplete" role="alert">
              <strong>Разделку невозможно показать</strong>
              <span>У выбранного конца провода нет достаточно длинного направленного участка.</span>
            </div>
          )}
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
        {selectedObject.kind === "wire" && <span className="he-wire-standard-colors" aria-label="Стандартные цвета проводов">
          {builtInWireColors.map((color) => <button
            key={color.id}
            type="button"
            aria-label={color.name}
            title={color.name}
            disabled={disabled}
            className={selectedObject.color.toUpperCase() === color.hex ? "active" : ""}
            style={{ backgroundColor: color.hex }}
            onClick={() => onChange(selectedObject.id, { color: color.hex })}
          />)}
        </span>}
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
