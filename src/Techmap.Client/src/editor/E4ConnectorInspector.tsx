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
  readonly templateArticleOptions?: readonly {
    readonly articleVariantId: string;
    readonly articleKey: string;
  }[];
  readonly onTemplateArticleSelect?: (articleVariantId: string) => void;
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

export function wireColorSwatchBackground(
  primary: string,
  secondary: string,
  choices: readonly WireColorReference[],
): string {
  const primaryHex = colorHex(primary, choices);
  return secondary
    ? `linear-gradient(225deg, ${primaryHex} 0 49%, #8da0aa 49% 51%, ${colorHex(secondary, choices)} 51% 100%)`
    : primaryHex;
}

export function updateWireQueryState(
  current: Readonly<Record<string, string>>,
  contactId: string,
  query: string | null,
): Readonly<Record<string, string>> {
  if (query !== null) return { ...current, [contactId]: query };
  if (current[contactId] === undefined) return current;
  const next = { ...current };
  delete next[contactId];
  return next;
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
  open,
  onOpenChange,
  onChange,
}: {
  readonly contact: ConnectorContact;
  readonly choices: readonly WireColorReference[];
  readonly disabled: boolean;
  readonly editing: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChange: (patch: Pick<ConnectorContact, "color" | "secondaryColor">) => void;
}) {
  const primary = contact.color;
  const secondary = contact.secondaryColor ?? "";
  const swatchStyle = {
    background: wireColorSwatchBackground(primary, secondary, choices),
  };
  if (!editing) {
    return <span className="e4cce-color-readonly" title={[primary, secondary].filter(Boolean).join(" / ")}>
      <i className="e4cce-color-swatch" style={swatchStyle} aria-hidden="true" />
      <span>{[primary, secondary].filter(Boolean).join(" / ") || " "}</span>
    </span>;
  }
  return (
    <div className={`e4cce-color-editor ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="e4cce-color-summary"
        aria-label={`Цвет, контакт ${contact.number}`}
        aria-expanded={open}
        title="Основной и второй цвет провода"
        onClick={() => onOpenChange(!open)}
      >
        <i className="e4cce-color-swatch" style={swatchStyle} aria-hidden="true" />
        <span>{[primary, secondary].filter(Boolean).join(" / ") || "—"}</span>
      </button>
      <div className="e4cce-color-popover" hidden={!open}>
        <label>Основной цвет
          <select
            value={primary}
            disabled={disabled}
            onChange={(event) => {
              onChange({ color: event.target.value, secondaryColor: secondary });
              onOpenChange(false);
            }}
          >
            <option value="">—</option>
            {choices.map((choice) => <option key={choice.id} value={choice.name}>{choice.name}</option>)}
          </select>
        </label>
        <label>Второй цвет
          <select
            value={secondary}
            disabled={disabled}
            onChange={(event) => {
              onChange({ color: primary, secondaryColor: event.target.value });
              onOpenChange(false);
            }}
          >
            <option value="">Пусто · одноцветный</option>
            {choices.map((choice) => <option key={choice.id} value={choice.name}>{choice.name}</option>)}
          </select>
        </label>
        <label className="e4cce-palette"><span>Новый цвет</span>
          <span className="e4cce-palette-control">
            <i className="e4cce-color-swatch" style={{ background: colorHex(primary, choices) }} aria-hidden="true" />
            <input
              type="color"
              aria-label={`Новый цвет из палитры, контакт ${contact.number}`}
              disabled={disabled}
              value={colorHex(primary, choices)}
              onChange={(event) => {
                onChange({ color: event.currentTarget.value.toUpperCase(), secondaryColor: secondary });
                onOpenChange(false);
              }}
            />
          </span>
        </label>
      </div>
    </div>
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
  templateArticleOptions = [],
  onTemplateArticleSelect,
  terminalArticles = [],
  onTerminalSearch,
  wireArticles = builtInWireReferences.map((wire) => wire.designation),
  onWireSearch,
  wireColors,
  editing,
  onEditingChange,
}: E4ConnectorInspectorProps) {
  const [designation, setDesignation] = useState(connector.designation);
  const [libraryCode, setLibraryCode] = useState(connector.libraryCode ?? "FREE");
  const [partNumber, setPartNumber] = useState(connector.partNumber);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [wireQueries, setWireQueries] = useState<Readonly<Record<string, string>>>({});
  const [openColorContactId, setOpenColorContactId] = useState<string | null>(null);
  const canvasEditorRef = useRef<HTMLElement | null>(null);
  const cancelIdentityBlurRef = useRef(false);
  const canvasEditing = mode !== "canvas" || editing === true;

  useEffect(() => setDesignation(connector.designation), [connector.id, connector.designation]);
  useEffect(() => setLibraryCode(connector.libraryCode ?? "FREE"), [connector.id, connector.libraryCode]);
  useEffect(() => setPartNumber(connector.partNumber), [connector.id, connector.partNumber]);
  useEffect(() => {
    if (!openColorContactId) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && canvasEditorRef.current?.contains(target) &&
          (target as Element).closest?.(".e4cce-color-editor")) return;
      // Dismiss during capture, then let the same click reach the next cell or
      // the empty canvas. This keeps editing a one-click operation.
      setOpenColorContactId(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [openColorContactId]);

  const commitIdentity = () => {
    if (cancelIdentityBlurRef.current) {
      cancelIdentityBlurRef.current = false;
      return;
    }
    const nextDesignation = designation.trim();
    const hasLibraryIdentity = connector.libraryBinding?.mode === "series" ||
      connector.libraryBinding?.mode === "template";
    const nextLibraryCode = hasLibraryIdentity
      ? connector.libraryCode ?? "FREE"
      : libraryCode.trim();
    const nextPartNumber = hasLibraryIdentity ? connector.partNumber : partNumber.trim();
    if (!nextDesignation || !nextLibraryCode || !nextPartNumber) {
      setDesignation(connector.designation);
      setLibraryCode(connector.libraryCode ?? "FREE");
      setPartNumber(connector.partNumber);
      return;
    }
    if (nextDesignation !== connector.designation || nextLibraryCode !== (connector.libraryCode ?? "FREE") ||
        nextPartNumber !== connector.partNumber) {
      onCommand({
        type: "update-connector",
        connectorId: connector.id,
        designation: nextDesignation,
        libraryCode: hasLibraryIdentity ? undefined : nextLibraryCode,
        partNumber: hasLibraryIdentity ? undefined : nextPartNumber,
      });
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
    const isTemplate = connector.libraryBinding?.mode === "template";
    const isLibrary = isSeries || isTemplate;
    const article = isSeries && series ? findConnectorSeriesArticle(series, connector.partNumber) : null;
    const displayedLibraryCode = isSeries
      ? series?.name ?? connector.libraryBinding?.seriesId ?? "СЕРИЯ"
      : isTemplate ? connector.libraryBinding.snapshot.code : connector.libraryCode ?? "FREE";
    const colorChoices = wireColors ?? connectorColorChoices(connector);
    const geometry = connectorE4TableGeometry(connector);
    const columns = geometry.columns.map((column) => column.kind === "base"
      ? { id: column.key, label: baseColumnLabels[column.key], width: column.width }
      : { id: `custom:${column.id}` as const, label: column.label, width: column.width });
    return (
      <section
          ref={canvasEditorRef}
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
            disabled={disabled || isLibrary || nextContactNumber(connector) === null}
            title={isLibrary ? "Число строк задаётся выбранным библиотечным артикулом" : "Добавить строку контакта"}
            onClick={addContact}
          >⊕ {isLibrary ? "Строки из артикула" : "Добавить строку"}</button>
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
                  const templateContact = isTemplate
                    ? connector.libraryBinding.snapshot.contacts.find((candidate) =>
                      candidate.logicalContactId === contact.logicalContactId)
                    : undefined;
                  const terminalOptions = contact.libraryContact && article
                    ? article.allowedTerminalArticles[contact.libraryContact.kind]
                    : templateContact?.allowedTerminalArticleKeys.map((candidate) => candidate.articleKey) ?? [];
                  const lockedByLibrary = isLibrary && (column.id === "number" || column.id === "contactType");
                  const lockedByLibraryTitle = isTemplate
                    ? "Номер и тип заданы закреплённым шаблоном"
                    : "Номер и тип заданы артикулом серии";
                  const input = column.id === "color" ? (
                    <ColorCellEditor
                      contact={contact}
                      choices={colorChoices}
                      disabled={disabled}
                      editing={canvasEditing}
                      open={openColorContactId === contact.id}
                      onOpenChange={(open) => setOpenColorContactId(open ? contact.id : null)}
                      onChange={(patch) => updateContact(contact, patch)}
                    />
                  ) : column.id === "terminal" && isLibrary ? (
                    <select
                      value={value}
                      disabled={disabled || !canvasEditing}
                      aria-label={`${column.label}, контакт ${contact.number}`}
                      title="Допустимые терминалы для этого типа контакта"
                      onChange={(event) => updateContact(contact, { terminalArticle: event.target.value })}
                    >
                      <option value="">—</option>
                      {isSeries && !terminalOptions.includes(value) && value && <option value={value}>{value}</option>}
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
                        const query = event.currentTarget.value;
                        updateContact(contact, { wire: query });
                        setWireQueries((current) => updateWireQueryState(current, contact.id, query));
                        onWireSearch?.(query);
                      }}
                      onFocus={(event) => {
                        // React clears currentTarget after the handler. Capture
                        // the value before scheduling the functional update.
                        const query = event.currentTarget.value;
                        setWireQueries((current) => updateWireQueryState(current, contact.id, query));
                      }}
                      onBlur={() => setTimeout(() => setWireQueries((current) =>
                        updateWireQueryState(current, contact.id, null)), 120)}
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
                            setWireQueries((current) => updateWireQueryState(current, contact.id, null));
                          }}
                        >{wire.designation}</button>)}
                    </div>}
                  </div> : <input
                    type={column.id === "number" ? "number" : "text"}
                    min={column.id === "number" ? 1 : undefined}
                    max={column.id === "number" ? 300 : undefined}
                    value={value}
                    list={column.id === "terminal" && !isLibrary ? `terminal-articles-${connector.id}` : undefined}
                    disabled={disabled || !canvasEditing || lockedByLibrary}
                    title={lockedByLibrary ? lockedByLibraryTitle : undefined}
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
                      disabled={disabled || isLibrary}
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
                {canvasEditing && !isLibrary ? <input
                  className="e4cce-footer-code"
                  aria-label="Код свободного блока"
                  maxLength={120}
                  disabled={disabled}
                  value={libraryCode}
                  onChange={(event) => setLibraryCode(event.target.value)}
                  onBlur={commitIdentity}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setLibraryCode(connector.libraryCode ?? "FREE");
                    }
                  }}
                /> : <span className="e4cce-footer-code" title={displayedLibraryCode}>{displayedLibraryCode}</span>}
                {canvasEditing && !isLibrary ? <input
                  className="e4cce-footer-article"
                  aria-label="Артикул свободного блока"
                  maxLength={512}
                  disabled={disabled}
                  value={partNumber}
                  onChange={(event) => setPartNumber(event.target.value)}
                  onBlur={commitIdentity}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setPartNumber(connector.partNumber);
                    }
                  }}
                /> : <span className="e4cce-footer-article" title={connector.partNumber}>{connector.partNumber}</span>}
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
        <label>{connector.libraryBinding?.mode === "series" ? "Артикул серии" :
          connector.libraryBinding?.mode === "template" ? "Артикул шаблона" : "Артикул"}
          {connector.libraryBinding?.mode === "series" && series ? (
            <select value={connector.partNumber} disabled={disabled} onChange={(event) => selectArticle(event.target.value)}>
              {series.articles.map((article) => (
                <option key={article.partNumber} value={article.partNumber}>{article.partNumber}</option>
              ))}
            </select>
          ) : connector.libraryBinding?.mode === "template" && templateArticleOptions.length > 0 && onTemplateArticleSelect ? (
            <select
              aria-label="Артикул шаблона"
              value={connector.libraryBinding.articleVariantId}
              disabled={disabled}
              onChange={(event) => onTemplateArticleSelect(event.currentTarget.value)}
            >
              {templateArticleOptions.map((article) => (
                <option key={article.articleVariantId} value={article.articleVariantId}>{article.articleKey}</option>
              ))}
            </select>
          ) : connector.libraryBinding?.mode === "template" ? (
            <span className="e4ci-readonly-value" title="Артикул закреплён выбранным вариантом шаблона">
              {connector.partNumber}
            </span>
          ) : (
            <input
              value={partNumber}
              maxLength={512}
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
          : connector.libraryBinding?.mode === "template"
            ? templateArticleOptions.length > 0 && onTemplateArticleSelect
              ? "Артикул выбирается из семейства. Код, число и типы контактов обновляются по выбранному варианту."
              : "Артикул, код, число и типы контактов закреплены версией шаблона. Цепи, провода, цвета и совместимые терминалы можно редактировать."
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
