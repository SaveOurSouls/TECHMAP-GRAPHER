import { useEffect, useRef, useState } from "react";
import type { EditorCommand } from "./commands";
import {
  findConnectorSeriesArticle,
  selectConnectorSeriesArticle,
  type ConnectorSeries,
} from "./connector-series";
import {
  connectorBaseColumnKeys,
  connectorE4TableGeometry,
  type ConnectorBaseColumnKey,
  type ConnectorContact,
  type ConnectorInstance,
} from "./model";
import {
  builtInWireColors,
  builtInWireReferences,
  filterWireSuggestions,
  type WireColorReference,
} from "./wire-reference-catalog";
import "./e4-connector-inspector.css";

export interface E4ConnectorInspectorProps {
  readonly connector: ConnectorInstance;
  readonly disabled: boolean;
  readonly onCommand: (command: EditorCommand) => void;
  readonly mode?: "panel" | "canvas";
  readonly series?: ConnectorSeries;
  readonly terminalArticles?: readonly string[];
  readonly onTerminalSearch?: (query: string) => void;
  readonly wireArticles?: readonly string[];
  readonly onWireSearch?: (query: string) => void;
  readonly wireColors?: readonly WireColorReference[];
  readonly editing?: boolean;
  readonly onEditingChange?: (editing: boolean) => void;
}

const baseColumnLabels: Readonly<Record<ConnectorBaseColumnKey, string>> = {
  number: "№",
  contactType: "Тип",
  circuit: "Цепь",
  terminal: "Терминал",
  wire: "Провод",
  color: "Цвет",
};

function normalizedColorKey(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function colorHex(value: string, choices: readonly WireColorReference[]): string {
  if (/^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim();
  return choices.find((choice) => normalizedColorKey(choice.name) === normalizedColorKey(value))?.hex ?? "#D9E2E7";
}

function connectorColorChoices(connector: ConnectorInstance): readonly WireColorReference[] {
  const known = new Set(builtInWireColors.map((color) => normalizedColorKey(color.name)));
  const customValues = connector.contacts.flatMap((contact) => [contact.color, contact.secondaryColor ?? ""])
    .filter((value) => value.trim() !== "" && !known.has(normalizedColorKey(value)));
  return [
    ...builtInWireColors,
    ...[...new Set(customValues)].map((value) => ({
      id: `custom:${normalizedColorKey(value)}`,
      name: value,
      hex: /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : "#D9E2E7",
      kind: "custom" as const,
    })),
  ];
}

function ColorCellEditor({
  contact,
  choices,
  disabled,
  editing,
  onChange,
}: {
  readonly contact: ConnectorContact;
  readonly choices: readonly WireColorReference[];
  readonly disabled: boolean;
  readonly editing: boolean;
  readonly onChange: (patch: Pick<ConnectorContact, "color" | "secondaryColor">) => void;
}) {
  const primary = contact.color;
  const secondary = contact.secondaryColor ?? "";
  const swatchStyle = {
    background: secondary
      ? `linear-gradient(225deg, ${colorHex(primary, choices)} 0 49%, #8da0aa 49% 51%, ${colorHex(secondary, choices)} 51% 100%)`
      : colorHex(primary, choices),
  };
  if (!editing) {
    return <span className="e4cce-color-readonly" title={[primary, secondary].filter(Boolean).join(" / ")}>
      <i style={swatchStyle} aria-hidden="true" />
      <span>{[primary, secondary].filter(Boolean).join(" / ") || " "}</span>
    </span>;
  }
  return (
    <details className="e4cce-color-editor">
      <summary aria-label={`Цвет, контакт ${contact.number}`} title="Основной и второй цвет провода">
        <i style={swatchStyle} aria-hidden="true" />
        <span>{[primary, secondary].filter(Boolean).join(" / ") || "—"}</span>
      </summary>
      <div className="e4cce-color-popover">
        <label>Основной цвет
          <select
            value={primary}
            disabled={disabled}
            onChange={(event) => onChange({ color: event.target.value, secondaryColor: secondary })}
          >
            <option value="">—</option>
            {choices.map((choice) => <option key={choice.id} value={choice.name}>{choice.name}</option>)}
          </select>
        </label>
        <label>Второй цвет
          <select
            value={secondary}
            disabled={disabled}
            onChange={(event) => onChange({ color: primary, secondaryColor: event.target.value })}
          >
            <option value="">Пусто · одноцветный</option>
            {choices.map((choice) => <option key={choice.id} value={choice.name}>{choice.name}</option>)}
          </select>
        </label>
        <label className="e4cce-palette">Новый цвет
          <input
            type="color"
            aria-label={`Новый цвет из палитры, контакт ${contact.number}`}
            disabled={disabled}
            value={colorHex(primary, choices)}
            onChange={(event) => onChange({ color: event.target.value.toUpperCase(), secondaryColor: secondary })}
          />
        </label>
      </div>
    </details>
  );
}

function nextCustomFieldId(connector: ConnectorInstance, label: string): string {
  const slug = label
    .normalize("NFC")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "") || "поле";
  const prefix = `custom-${slug}`;
  const used = new Set(connector.schematic.customFields.map((field) => field.id));
  if (!used.has(prefix)) return prefix;
  let suffix = 2;
  while (used.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

function nextContactNumber(connector: ConnectorInstance): number | null {
  const used = new Set(connector.contacts.map((contact) => contact.number));
  for (let number = 1; number <= 300; number += 1) if (!used.has(number)) return number;
  return null;
}

function nextContactId(connector: ConnectorInstance, number: number): string {
  const prefix = `${connector.id}:contact:${number}`;
  const used = new Set(connector.contacts.map((contact) => contact.id));
  if (!used.has(prefix)) return prefix;
  let suffix = 2;
  while (used.has(`${prefix}:${suffix}`)) suffix += 1;
  return `${prefix}:${suffix}`;
}

/** Contact values live on the E4 object itself. The side panel only edits
 * identity and the set of visible fields. */
export function E4ConnectorInspector({
  connector,
  disabled,
  onCommand,
  mode = "panel",
  series,
  terminalArticles = [],
  onTerminalSearch,
  wireArticles = builtInWireReferences.map((wire) => wire.designation),
  onWireSearch,
  wireColors,
  editing,
  onEditingChange,
}: E4ConnectorInspectorProps) {
  const [designation, setDesignation] = useState(connector.designation);
  const [partNumber, setPartNumber] = useState(connector.partNumber);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [wireQueries, setWireQueries] = useState<Readonly<Record<string, string>>>({});
  const cancelIdentityBlurRef = useRef(false);
  const canvasEditing = mode !== "canvas" || editing === true;

  useEffect(() => setDesignation(connector.designation), [connector.id, connector.designation]);
  useEffect(() => setPartNumber(connector.partNumber), [connector.id, connector.partNumber]);

  const commitIdentity = () => {
    if (cancelIdentityBlurRef.current) {
      cancelIdentityBlurRef.current = false;
      return;
    }
    const nextDesignation = designation.trim();
    const nextPartNumber = connector.libraryBinding?.mode === "series" ? connector.partNumber : partNumber.trim();
    if (!nextDesignation || !nextPartNumber) {
      setDesignation(connector.designation);
      setPartNumber(connector.partNumber);
      return;
    }
    if (nextDesignation !== connector.designation || nextPartNumber !== connector.partNumber) {
      onCommand({ type: "update-connector", connectorId: connector.id, designation: nextDesignation, partNumber: nextPartNumber });
    }
  };

  const selectArticle = (nextPartNumber: string) => {
    if (!series || nextPartNumber === connector.partNumber) return;
    const selected = selectConnectorSeriesArticle(connector, series, nextPartNumber).connector;
    onCommand({
      type: "apply-connector-article",
      connectorId: connector.id,
      partNumber: selected.partNumber,
      contacts: selected.contacts,
      libraryBinding: selected.libraryBinding,
    });
  };

  const addCustomField = () => {
    const label = newFieldLabel.trim();
    if (!label) return;
    onCommand({
      type: "add-custom-field",
      connectorId: connector.id,
      field: { id: nextCustomFieldId(connector, label), label, visible: true },
    });
    setNewFieldLabel("");
  };

  const updateContact = (contact: ConnectorInstance["contacts"][number], patch: Partial<typeof contact>) => {
    onCommand({
      type: "update-contact",
      connectorId: connector.id,
      contactId: contact.id,
      number: patch.number,
      contactType: patch.contactType,
      circuit: patch.circuit,
      terminalArticle: patch.terminalArticle,
      wire: patch.wire,
      color: patch.color,
      secondaryColor: patch.secondaryColor,
      connectionStatus: patch.connectionStatus,
      customValues: patch.customValues,
    });
  };

  const addContact = () => {
    const number = nextContactNumber(connector);
    if (number === null) return;
    onCommand({
      type: "add-contact",
      connectorId: connector.id,
      contact: {
        id: nextContactId(connector, number), number, contactType: "", circuit: "",
        terminalArticle: "", wire: "", color: "", secondaryColor: "", connectionStatus: "available", customValues: {},
      },
    });
  };

  if (mode === "canvas") {
    const isSeries = connector.libraryBinding?.mode === "series";
    const article = isSeries && series ? findConnectorSeriesArticle(series, connector.partNumber) : null;
    const libraryCode = isSeries ? series?.name ?? connector.libraryBinding?.seriesId ?? "СЕРИЯ" : "FREE";
    const colorChoices = wireColors ?? connectorColorChoices(connector);
    const geometry = connectorE4TableGeometry(connector);
    const columns = geometry.columns.map((column) => column.kind === "base"
      ? { id: column.key, label: baseColumnLabels[column.key], width: column.width }
      : { id: `custom:${column.id}` as const, label: column.label, width: column.width });
    return (
      <section
          className={`e4-connector-canvas-editor ${connector.schematic.orientation} ${canvasEditing ? "is-editing" : "is-readonly"}`}
          aria-label={`Поля соединителя ${connector.designation}`}
          title={canvasEditing ? "Редактирование включено. Escape — закончить" : "Зажмите и перетащите. Двойной клик — редактировать"}
          onKeyDown={(event) => {
            if (event.key === "Escape" && canvasEditing) {
              event.stopPropagation();
              onEditingChange?.(false);
            }
          }}
        >
        <datalist id={`terminal-articles-${connector.id}`}>
          {terminalArticles.map((terminal) => <option key={terminal} value={terminal} />)}
        </datalist>
        <div
          className="e4cce-title"
          title={canvasEditing ? "Редактирование" : "Перетащить соединитель"}
        >
          <button
            type="button"
            className="e4cce-title-add"
            disabled={disabled || !canvasEditing || isSeries || nextContactNumber(connector) === null}
            title={isSeries ? "Число строк задаётся выбранным артикулом серии" : "Добавить строку контакта"}
            onClick={addContact}
          >⊕ {isSeries ? "Строки из артикула" : "Добавить строку"}</button>
          {canvasEditing ? (
            <input
              type="text"
              value={designation}
              disabled={disabled}
              aria-label="Обозначение соединителя"
              title="Обозначение соединителя"
              onChange={(event) => setDesignation(event.target.value)}
              onBlur={commitIdentity}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setDesignation(connector.designation);
                  onEditingChange?.(false);
                }
              }}
            />
          ) : <strong title={connector.designation}>{connector.designation}</strong>}
        </div>
        <div className="e4cce-table-scroll">
          <table>
            <colgroup>{columns.length === 0
              ? <col style={{ width: geometry.width }} />
              : columns.map((column) => <col key={column.id} style={{ width: column.width }} />)}</colgroup>
            <thead><tr>
              {columns.length === 0 ? <th className="e4cce-empty-column">Нет видимых полей</th> : columns.map((column) => (
                <th key={column.id} title="Изменить видимость поля">
                  <span>{column.label}</span>
                  <button
                    type="button"
                    aria-label={`Скрыть поле ${column.label}`}
                    disabled={disabled || !canvasEditing}
                    onClick={() => column.id.startsWith("custom:")
                      ? onCommand({ type: "toggle-custom-field-visibility", connectorId: connector.id, fieldId: column.id.slice(7) })
                      : onCommand({ type: "toggle-base-column-visibility", connectorId: connector.id, key: column.id as ConnectorBaseColumnKey })}
                  >◉</button>
                </th>
              ))}
            </tr></thead>
            <tbody>{connector.contacts.map((contact) => (
              <tr key={contact.id}>
                {columns.length === 0 ? <td className="e4cce-empty-column">&nbsp;</td> : columns.map((column) => {
                  const value = column.id === "number" ? String(contact.number)
                    : column.id === "contactType" ? contact.contactType
                      : column.id === "circuit" ? contact.circuit
                        : column.id === "terminal" ? contact.terminalArticle
                          : column.id === "wire" ? contact.wire
                            : column.id === "color" ? contact.color
                              : contact.customValues[column.id.slice(7)] ?? "";
                  const terminalOptions = contact.libraryContact && article
                    ? article.allowedTerminalArticles[contact.libraryContact.kind]
                    : [];
                  const lockedBySeries = isSeries && (column.id === "number" || column.id === "contactType");
                  const input = column.id === "color" ? (
                    <ColorCellEditor
                      contact={contact}
                      choices={colorChoices}
                      disabled={disabled}
                      editing={canvasEditing}
                      onChange={(patch) => updateContact(contact, patch)}
                    />
                  ) : column.id === "terminal" && isSeries ? (
                    <select
                      value={value}
                      disabled={disabled || !canvasEditing}
                      aria-label={`${column.label}, контакт ${contact.number}`}
                      title="Допустимые терминалы для этого типа контакта"
                      onChange={(event) => updateContact(contact, { terminalArticle: event.target.value })}
                    >
                      <option value="">—</option>
                      {!terminalOptions.includes(value) && value && <option value={value}>{value}</option>}
                      {terminalOptions.map((terminal) => <option key={terminal} value={terminal}>{terminal}</option>)}
                    </select>
                  ) : column.id === "wire" ? <div className="e4cce-wire-picker">
                    <input
                      type="text"
                      value={value}
                      disabled={disabled || !canvasEditing}
                      aria-label={`${column.label}, контакт ${contact.number}`}
                      autoComplete="off"
                      onChange={(event) => {
                        const query = event.target.value;
                        updateContact(contact, { wire: query });
                        setWireQueries((current) => ({ ...current, [contact.id]: query }));
                        onWireSearch?.(query);
                      }}
                      onFocus={(event) => setWireQueries((current) => ({ ...current, [contact.id]: event.currentTarget.value }))}
                      onBlur={() => setTimeout(() => setWireQueries((current) => {
                        const next = { ...current };
                        delete next[contact.id];
                        return next;
                      }), 120)}
                    />
                    {wireQueries[contact.id] !== undefined && <div className="e4cce-wire-suggestions" role="listbox" aria-label={`Подсказки проводов, контакт ${contact.number}`}>
                      {filterWireSuggestions(wireQueries[contact.id] ?? "")
                        .filter((wire) => wireArticles.includes(wire.designation))
                        .map((wire) => <button
                          type="button"
                          key={wire.id}
                          onPointerDown={(event) => event.preventDefault()}
                          onClick={() => {
                            updateContact(contact, { wire: wire.designation });
                            setWireQueries((current) => {
                              const next = { ...current };
                              delete next[contact.id];
                              return next;
                            });
                          }}
                        >{wire.designation}</button>)}
                    </div>}
                  </div> : <input
                    type={column.id === "number" ? "number" : "text"}
                    min={column.id === "number" ? 1 : undefined}
                    max={column.id === "number" ? 300 : undefined}
                    value={value}
                    list={column.id === "terminal" && !isSeries ? `terminal-articles-${connector.id}` : undefined}
                    disabled={disabled || !canvasEditing || lockedBySeries}
                    title={lockedBySeries ? "Номер и тип заданы артикулом серии" : undefined}
                    aria-label={`${column.label}, контакт ${contact.number}`}
                    onChange={(event) => {
                      if (column.id === "number") {
                        const number = Number(event.target.value);
                        if (Number.isSafeInteger(number) && number >= 1 && number <= 300) updateContact(contact, { number });
                      } else if (column.id.startsWith("custom:")) {
                        updateContact(contact, { customValues: { ...contact.customValues, [column.id.slice(7)]: event.target.value } });
                      } else {
                        const patch = column.id === "contactType" ? { contactType: event.target.value }
                          : column.id === "circuit" ? { circuit: event.target.value }
                            : column.id === "terminal" ? { terminalArticle: event.target.value }
                              : column.id === "wire" ? { wire: event.target.value }
                                : { color: event.target.value };
                        updateContact(contact, patch);
                        if (column.id === "terminal") onTerminalSearch?.(event.target.value);
                      }
                    }}
                  />;
                  const cell = column.id === "color" ? input
                    : canvasEditing ? input : <span className="e4cce-readonly-value">{value || " "}</span>;
                  return <td key={column.id} className={column.id === "number" ? "e4cce-number" : undefined}>{cell}{column.id === "number" && canvasEditing && <span className="e4cce-row-actions">
                    <button
                      type="button"
                      className={contact.connectionStatus === "not-connected" ? "active" : ""}
                      disabled={disabled}
                      aria-label={`Контакт ${contact.number} не подключён`}
                      aria-pressed={contact.connectionStatus === "not-connected"}
                      title={contact.connectionStatus === "not-connected" ? "Снять отметку «не подключено»" : "Пометить как не подключено"}
                      onClick={() => updateContact(contact, { connectionStatus: contact.connectionStatus === "not-connected" ? "available" : "not-connected" })}
                    >×</button>
                    <button
                      type="button"
                      disabled={disabled || isSeries}
                      aria-label={`Удалить контакт ${contact.number}`}
                      title={`Удалить контакт ${contact.number}`}
                      onClick={() => onCommand({ type: "remove-contact", connectorId: connector.id, contactId: contact.id })}
                    >−</button>
                  </span>}</td>;
                })}
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={Math.max(1, columns.length)}>
              <div className="e4cce-footer">
                <span className="e4cce-footer-code" title={libraryCode}>{libraryCode}</span>
                <span className="e4cce-footer-article" title={connector.partNumber}>{connector.partNumber}</span>
              </div>
            </td></tr></tfoot>
          </table>
        </div>
      </section>
    );
  }

  return (
    <section className="e4-connector-inspector" aria-label={`Соединитель ${connector.designation}`}>
      <header className="e4ci-header">
        <div><span className="e4ci-eyebrow">Схема Э4 · соединитель</span><strong>{connector.designation}</strong></div>
        <button
          type="button"
          className="e4ci-flip-button"
          disabled={disabled}
          onClick={() => onCommand({ type: "flip-connector-orientation", connectorId: connector.id })}
          title="Перенести контакты на другую сторону"
        >⇆ Зеркальный вид</button>
      </header>

      <div className="e4ci-identity">
        <label>Обозначение
          <input
            value={designation}
            maxLength={120}
            disabled={disabled}
            onChange={(event) => setDesignation(event.target.value)}
            onBlur={commitIdentity}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); commitIdentity(); event.currentTarget.blur(); }
              if (event.key === "Escape") {
                cancelIdentityBlurRef.current = true;
                setDesignation(connector.designation);
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <label>{connector.libraryBinding?.mode === "series" ? "Артикул серии" : "Артикул"}
          {connector.libraryBinding?.mode === "series" && series ? (
            <select value={connector.partNumber} disabled={disabled} onChange={(event) => selectArticle(event.target.value)}>
              {series.articles.map((article) => (
                <option key={article.partNumber} value={article.partNumber}>{article.partNumber}</option>
              ))}
            </select>
          ) : (
            <input
              value={partNumber}
              maxLength={120}
              disabled={disabled}
              onChange={(event) => setPartNumber(event.target.value)}
              onBlur={commitIdentity}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); commitIdentity(); event.currentTarget.blur(); }
                if (event.key === "Escape") {
                  cancelIdentityBlurRef.current = true;
                  setPartNumber(connector.partNumber);
                  event.currentTarget.blur();
                }
              }}
            />
          )}
        </label>
        <span className="e4ci-readonly-note">{connector.libraryBinding?.mode === "series"
          ? "Артикул определяет число и типы контактов. Значения цепей сохраняются для совпавших строк."
          : "Свободный экземпляр: строки и поля можно менять независимо от библиотеки."}</span>
      </div>

      <div className="e4ci-canvas-edit-note">
        <strong>Поля редактируются на объекте</strong>
        <span>Изменяйте значения контактов прямо в таблице схемы Э4. Кнопки глаза в заголовках скрывают поле.</span>
      </div>

      <details className="e4ci-column-settings" open>
        <summary>Поля таблицы · скрыть / показать</summary>
        <div className="e4ci-base-columns">
          {connectorBaseColumnKeys.map((key) => {
            const visible = connector.schematic.baseColumns.find((item) => item.key === key)?.visible ?? true;
            return (
              <button
                type="button"
                className={visible ? "e4ci-column-toggle active" : "e4ci-column-toggle"}
                key={key}
                disabled={disabled}
                aria-pressed={visible}
                title={visible ? `Скрыть поле «${baseColumnLabels[key]}»` : `Показать поле «${baseColumnLabels[key]}»`}
                onClick={() => onCommand({ type: "toggle-base-column-visibility", connectorId: connector.id, key })}
              >
                <span aria-hidden="true">{visible ? "◉" : "○"}</span>
                <span>{baseColumnLabels[key]}</span>
                <small>{visible ? "видимо" : "скрыто"}</small>
              </button>
            );
          })}
        </div>
        <div className="e4ci-custom-columns">
          <div className="e4ci-section-title"><strong>Справочные поля</strong><span>Дополнительные текстовые колонки</span></div>
          {connector.schematic.customFields.length === 0 && <p>Дополнительных полей пока нет.</p>}
          {connector.schematic.customFields.map((field) => (
            <div className="e4ci-custom-column" key={field.id}>
              <button
                type="button"
                className={field.visible ? "active" : ""}
                disabled={disabled}
                onClick={() => onCommand({ type: "toggle-custom-field-visibility", connectorId: connector.id, fieldId: field.id })}
                aria-pressed={field.visible}
                title={field.visible ? "Скрыть поле" : "Показать поле"}
              >{field.visible ? "◉" : "○"}</button>
              <span>{field.label}</span>
              <button
                type="button"
                className="danger"
                disabled={disabled}
                onClick={() => onCommand({ type: "remove-custom-field", connectorId: connector.id, fieldId: field.id })}
                title="Удалить справочное поле и его значения"
              >×</button>
            </div>
          ))}
          <div className="e4ci-add-field">
            <input
              value={newFieldLabel}
              maxLength={120}
              disabled={disabled}
              placeholder="Название нового поля"
              aria-label="Название нового справочного поля"
              onChange={(event) => setNewFieldLabel(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomField(); } }}
            />
            <button type="button" disabled={disabled || !newFieldLabel.trim()} onClick={addCustomField}>Добавить</button>
          </div>
        </div>
      </details>
    </section>
  );
}
