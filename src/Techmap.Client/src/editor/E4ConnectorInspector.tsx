import { useEffect, useMemo, useState } from "react";
import type { EditorCommand } from "./commands";
import {
  connectorBaseColumnKeys,
  type ConnectorBaseColumnKey,
  type ConnectorContact,
  type ConnectorInstance,
} from "./model";
import "./e4-connector-inspector.css";

export interface E4ConnectorInspectorProps {
  readonly connector: ConnectorInstance;
  readonly disabled: boolean;
  readonly onCommand: (command: EditorCommand) => void;
}

const baseColumnLabels: Readonly<Record<ConnectorBaseColumnKey, string>> = {
  number: "№",
  contactType: "Тип",
  circuit: "Цепь",
  terminal: "Терминал",
  wire: "Провод",
  color: "Цвет",
};

function nextContactNumber(connector: ConnectorInstance): number | null {
  const used = new Set(connector.contacts.map((contact) => contact.number));
  for (let number = 1; number <= 300; number += 1) {
    if (!used.has(number)) return number;
  }
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

function visibleBaseColumns(connector: ConnectorInstance): ReadonlySet<ConnectorBaseColumnKey> {
  return new Set(connector.schematic.baseColumns.filter((column) => column.visible).map((column) => column.key));
}

export function E4ConnectorInspector({ connector, disabled, onCommand }: E4ConnectorInspectorProps) {
  const [designation, setDesignation] = useState(connector.designation);
  const [partNumber, setPartNumber] = useState(connector.partNumber);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const shownBaseColumns = useMemo(() => visibleBaseColumns(connector), [connector]);
  const visibleCustomFields = connector.schematic.customFields.filter((field) => field.visible);
  const availableContactNumber = nextContactNumber(connector);

  useEffect(() => setDesignation(connector.designation), [connector.id, connector.designation]);
  useEffect(() => setPartNumber(connector.partNumber), [connector.id, connector.partNumber]);

  const commitIdentity = () => {
    const nextDesignation = designation.trim();
    const nextPartNumber = partNumber.trim();
    if (!nextDesignation || !nextPartNumber) {
      setDesignation(connector.designation);
      setPartNumber(connector.partNumber);
      return;
    }
    if (nextDesignation !== connector.designation || nextPartNumber !== connector.partNumber) {
      onCommand({
        type: "update-connector",
        connectorId: connector.id,
        designation: nextDesignation,
        partNumber: nextPartNumber,
      });
    }
  };

  const updateContact = (contact: ConnectorContact, patch: Partial<ConnectorContact>) => {
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
      connectionStatus: patch.connectionStatus,
      customValues: patch.customValues,
    });
  };

  const addContact = () => {
    if (availableContactNumber === null) return;
    const customValues = Object.fromEntries(connector.schematic.customFields.map((field) => [field.id, ""]));
    onCommand({
      type: "add-contact",
      connectorId: connector.id,
      contact: {
        id: nextContactId(connector, availableContactNumber),
        number: availableContactNumber,
        contactType: "",
        circuit: "",
        terminalArticle: "",
        wire: "",
        color: "",
        connectionStatus: "available",
        customValues,
      },
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

  return (
    <section className="e4-connector-inspector" aria-label={`Соединитель ${connector.designation}`}>
      <header className="e4ci-header">
        <div>
          <span className="e4ci-eyebrow">Схема Э4 · соединитель</span>
          <strong>{connector.designation}</strong>
        </div>
        <button
          type="button"
          className="e4ci-flip-button"
          disabled={disabled}
          onClick={() => onCommand({ type: "flip-connector-orientation", connectorId: connector.id })}
          title="Перенести контакты на другую сторону"
        >
          ⇆ Зеркальный вид
        </button>
      </header>

      <div className="e4ci-identity">
        <label>
          Обозначение
          <input
            value={designation}
            maxLength={120}
            disabled={disabled}
            onChange={(event) => setDesignation(event.target.value)}
            onBlur={commitIdentity}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitIdentity();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                setDesignation(connector.designation);
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <label>
          Артикул
          <input
            value={partNumber}
            maxLength={120}
            disabled={disabled}
            onChange={(event) => setPartNumber(event.target.value)}
            onBlur={commitIdentity}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitIdentity();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                setPartNumber(connector.partNumber);
                event.currentTarget.blur();
              }
            }}
          />
        </label>
        <span className="e4ci-readonly-note">Обозначение экземпляра и артикул шаблона хранятся отдельно.</span>
      </div>

      <details className="e4ci-column-settings">
        <summary>Колонки таблицы</summary>
        <div className="e4ci-base-columns">
          {connectorBaseColumnKeys.map((key) => {
            const column = connector.schematic.baseColumns.find((item) => item.key === key);
            return (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={column?.visible ?? true}
                  disabled={disabled}
                  onChange={() => onCommand({
                    type: "toggle-base-column-visibility",
                    connectorId: connector.id,
                    key,
                  })}
                />
                <span>{baseColumnLabels[key]}</span>
                <small>обязательная</small>
              </label>
            );
          })}
        </div>
        <div className="e4ci-custom-columns">
          <div className="e4ci-section-title">
            <strong>Справочные колонки</strong>
            <span>Текстовые поля для контактов</span>
          </div>
          {connector.schematic.customFields.length === 0 && (
            <p>Дополнительных колонок пока нет.</p>
          )}
          {connector.schematic.customFields.map((field) => (
            <div className="e4ci-custom-column" key={field.id}>
              <button
                type="button"
                className={field.visible ? "active" : ""}
                disabled={disabled}
                onClick={() => onCommand({
                  type: "toggle-custom-field-visibility",
                  connectorId: connector.id,
                  fieldId: field.id,
                })}
                aria-pressed={field.visible}
                title={field.visible ? "Скрыть колонку" : "Показать колонку"}
              >
                {field.visible ? "◉" : "○"}
              </button>
              <span>{field.label}</span>
              <button
                type="button"
                className="danger"
                disabled={disabled}
                onClick={() => onCommand({ type: "remove-custom-field", connectorId: connector.id, fieldId: field.id })}
                title="Удалить справочную колонку и её значения"
              >
                ×
              </button>
            </div>
          ))}
          <div className="e4ci-add-field">
            <input
              value={newFieldLabel}
              maxLength={120}
              disabled={disabled}
              placeholder="Название новой колонки"
              aria-label="Название новой справочной колонки"
              onChange={(event) => setNewFieldLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustomField();
                }
              }}
            />
            <button type="button" disabled={disabled || !newFieldLabel.trim()} onClick={addCustomField}>Добавить</button>
          </div>
        </div>
      </details>

      <div className="e4ci-table-section">
        <div className="e4ci-section-title">
          <strong>Контакты</strong>
          <span>{connector.contacts.length} из 300</span>
        </div>
        <div className="e4ci-table-scroll">
          <table>
            <thead>
              <tr>
                {shownBaseColumns.has("number") && <th className="number">№</th>}
                {shownBaseColumns.has("contactType") && <th>Тип</th>}
                {shownBaseColumns.has("circuit") && <th>Цепь</th>}
                {shownBaseColumns.has("terminal") && <th>Терминал</th>}
                {shownBaseColumns.has("wire") && <th>Провод</th>}
                {shownBaseColumns.has("color") && <th>Цвет</th>}
                {visibleCustomFields.map((field) => <th key={field.id}>{field.label}</th>)}
                <th className="status">Не подключено</th>
                <th className="actions"><span className="e4ci-visually-hidden">Действия</span></th>
              </tr>
            </thead>
            <tbody>
              {connector.contacts.map((contact) => (
                <tr key={contact.id}>
                  {shownBaseColumns.has("number") && (
                    <td className="number">
                      <input
                        type="number"
                        min="1"
                        max="300"
                        value={contact.number}
                        disabled={disabled}
                        aria-label={`Номер контакта ${contact.number}`}
                        onChange={(event) => {
                          const number = Number(event.target.value);
                          if (Number.isSafeInteger(number) && number >= 1 && number <= 300) updateContact(contact, { number });
                        }}
                      />
                    </td>
                  )}
                  {shownBaseColumns.has("contactType") && (
                    <td><input value={contact.contactType} disabled={disabled} aria-label={`Тип контакта ${contact.number}`} onChange={(event) => updateContact(contact, { contactType: event.target.value })} /></td>
                  )}
                  {shownBaseColumns.has("circuit") && (
                    <td><input value={contact.circuit} disabled={disabled} aria-label={`Цепь контакта ${contact.number}`} onChange={(event) => updateContact(contact, { circuit: event.target.value })} /></td>
                  )}
                  {shownBaseColumns.has("terminal") && (
                    <td><input value={contact.terminalArticle} disabled={disabled} aria-label={`Терминал контакта ${contact.number}`} onChange={(event) => updateContact(contact, { terminalArticle: event.target.value })} /></td>
                  )}
                  {shownBaseColumns.has("wire") && (
                    <td><input value={contact.wire} disabled={disabled} aria-label={`Провод контакта ${contact.number}`} onChange={(event) => updateContact(contact, { wire: event.target.value })} /></td>
                  )}
                  {shownBaseColumns.has("color") && (
                    <td><input value={contact.color} disabled={disabled} aria-label={`Цвет провода контакта ${contact.number}`} onChange={(event) => updateContact(contact, { color: event.target.value })} /></td>
                  )}
                  {visibleCustomFields.map((field) => (
                    <td key={field.id}>
                      <input
                        value={contact.customValues[field.id] ?? ""}
                        disabled={disabled}
                        aria-label={`${field.label}, контакт ${contact.number}`}
                        onChange={(event) => updateContact(contact, {
                          customValues: { ...contact.customValues, [field.id]: event.target.value },
                        })}
                      />
                    </td>
                  ))}
                  <td className="status">
                    <input
                      type="checkbox"
                      checked={contact.connectionStatus === "not-connected"}
                      disabled={disabled}
                      aria-label={`Контакт ${contact.number} не подключён`}
                      onChange={(event) => updateContact(contact, {
                        connectionStatus: event.target.checked ? "not-connected" : "available",
                      })}
                    />
                  </td>
                  <td className="actions">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onCommand({ type: "remove-contact", connectorId: connector.id, contactId: contact.id })}
                      title={`Удалить контакт ${contact.number}`}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="e4ci-add-contact"
          disabled={disabled || availableContactNumber === null}
          onClick={addContact}
        >
          ＋ Добавить контакт
        </button>
      </div>
    </section>
  );
}
