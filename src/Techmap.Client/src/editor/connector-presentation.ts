import { type ConnectorInstance, type ConnectorContact, type ConnectorBaseColumnKey, type ConnectorBaseColumn, type ConnectorE4TableGeometry, type ConnectorE4TableColumn, type EditorView, type Point } from "./design-types";
import { terminalArticleLabel } from "./terminal-article-label";
import { drawingLocalPoint } from "./drawing-scale";
import { materializedContactWorldRepresentation } from "./materialized-contact-representation";

export const connectorBaseColumnKeys = [
  "number",
  "contactType",
  "circuit",
  "terminal",
  "wire",
  "wireSection",
  "color",
] as const;
export const templateNameColumnId = "template-name";
export function connectorContactName(connector: ConnectorInstance, contact: ConnectorContact): string {
  return contact.nameOverride ?? (connector.libraryBinding?.mode === "template"
    ? connector.libraryBinding.snapshot.contacts.find(row => row.logicalContactId === contact.logicalContactId)?.name ?? ""
    : "");
}
export const connectorE4TableMetrics = {
  minimumWidth: 118,
  titleHeight: 24,
  headerHeight: 28,
  rowHeight: 24,
  footerHeight: 24,
  characterWidth: 6.2,
  cellHorizontalPadding: 12,
  headerControlWidth: 22,
  customColumnWidth: 64,
  baseColumnWidths: {
    number: 44,
    contactType: 60,
    circuit: 64,
    terminal: 78,
    wire: 72,
    wireSection: 80,
    color: 56,
  } satisfies Readonly<Record<ConnectorBaseColumnKey, number>>,
  maximumColumnWidth: 220,
} as const;
const connectorBaseColumnLabels: Readonly<Record<ConnectorBaseColumnKey, string>> = {
  number: "№",
  contactType: "Тип",
  circuit: "Цепь",
  terminal: "Терминал",
  wire: "Марка",
  wireSection: "Сечение",
  color: "Цвет",
};
function e4TextWidth(text: string): number {
  return Array.from(text.trim()).length * connectorE4TableMetrics.characterWidth;
}
export function connectorE4FooterWidth(libraryCode: string, partNumber: string): number {
  return Math.ceil(
    e4TextWidth(libraryCode) + e4TextWidth(partNumber) + connectorE4TableMetrics.cellHorizontalPadding * 3,
  );
}
/**
 * Shared content-based E4 column sizing for both the canvas drawing and its
 * HTML editor overlay.  It intentionally uses a deterministic font estimate:
 * persisted connector geometry and contact anchors must not depend on the
 * browser's loaded fonts or on a canvas instance.
 */
export function connectorE4TableColumnWidth(
  key: ConnectorBaseColumnKey | null,
  label: string,
  values: readonly string[],
): number {
  const minimum = key === null
    ? connectorE4TableMetrics.customColumnWidth
    : connectorE4TableMetrics.baseColumnWidths[key];
  const headerWidth = e4TextWidth(label) + connectorE4TableMetrics.cellHorizontalPadding +
    connectorE4TableMetrics.headerControlWidth;
  const contentWidth = Math.max(0, ...values.map(e4TextWidth)) + connectorE4TableMetrics.cellHorizontalPadding +
    (key === "terminal" ? 22 : 0);
  return Math.ceil(Math.min(
    connectorE4TableMetrics.maximumColumnWidth,
    Math.max(minimum, headerWidth, contentWidth),
  ));
}
export function templateTerminalChoices(connector: ConnectorInstance, logicalContactId: string | undefined): readonly string[] {
  if (connector.libraryBinding?.mode !== "template" || !logicalContactId) return [];
  return [...new Set([
    ...connector.libraryBinding.snapshot.contacts.find(contact => contact.logicalContactId === logicalContactId)
      ?.allowedTerminalArticleKeys.map(article => article.articleKey) ?? [],
    ...connector.terminalCatalog?.byContact[logicalContactId] ?? [],
  ])];
}
export function createDefaultConnectorBaseColumns(): readonly ConnectorBaseColumn[] {
  return connectorBaseColumnKeys.map((key) => ({ key, visible: true }));
}
export function connectorE4Contacts(connector: ConnectorInstance): readonly ConnectorContact[] {
  const contacts = new Map(connector.contacts.map(contact => [contact.id, contact]));
  const ordered = (connector.schematic.rowOrder ?? []).flatMap(id => {
    const contact = contacts.get(id);
    contacts.delete(id);
    return contact ? [contact] : [];
  });
  return [...ordered, ...contacts.values()];
}
export function connectorE4TableGeometry(connector: ConnectorInstance): ConnectorE4TableGeometry {
  const baseColumns: ConnectorE4TableColumn[] = connector.schematic.baseColumns
    .filter((column) => column.visible)
    .map((column) => ({
      kind: "base",
      key: column.key,
      x: 0,
      width: connectorE4TableColumnWidth(
        column.key,
        connectorBaseColumnLabels[column.key],
        [
          ...connector.contacts.map((contact) => column.key === "number" ? String(contact.number)
            : column.key === "contactType" ? contact.contactType
              : column.key === "circuit" ? contact.circuit
                : column.key === "terminal" ? terminalArticleLabel(contact.terminalArticle)
                  : column.key === "wire" ? contact.wire
                    : column.key === "wireSection" ? contact.wireSection ?? ""
                    // Colour is rendered as a swatch, so its name must not
                    // resize the table and move every connected anchor.
                    : ""),
        ],
      ),
    }));
  const customColumns: ConnectorE4TableColumn[] = connector.schematic.customFields
    .filter((field) => field.visible)
    .map((field) => ({
      kind: "custom",
      id: field.id,
      label: field.label,
      x: 0,
      width: connectorE4TableColumnWidth(
        null,
        field.label,
        connector.contacts.map((contact) => contact.customValues[field.id] ?? ""),
      ),
    }));
  if (connector.libraryBinding?.mode === "template" && connector.schematic.showName !== false) {
    const templateName: ConnectorE4TableColumn = {
      kind: "custom", id: templateNameColumnId, label: "Назначение", x: 0,
      width: connectorE4TableColumnWidth(null, "Назначение", connector.contacts.map(contact => connectorContactName(connector, contact))),
    };
    const numberIndex = baseColumns.findIndex(column => column.kind === "base" && column.key === "number");
    baseColumns.splice(numberIndex < 0 ? baseColumns.length : numberIndex + 1, 0, templateName);
  }
  const contactsFirst = connector.schematic.orientation === "contacts-left";
  const orderedColumns = contactsFirst
    ? [...baseColumns, ...customColumns]
    : [...customColumns, ...baseColumns].reverse();
  let x = 0;
  let columns = orderedColumns.map((column) => {
    const positioned = { ...column, x };
    x += column.width;
    return positioned;
  });
  const libraryCode = connector.libraryBinding?.mode === "series"
    ? connector.libraryBinding.seriesId
    : connector.libraryCode ?? "FREE";
  const width = Math.max(
    connectorE4TableMetrics.minimumWidth,
    x,
    connectorE4FooterWidth(libraryCode, connector.partNumber),
  );
  if (columns.length > 0 && width > x) {
    const flexibleIndex = columns.findIndex((column) => column.kind !== "base" || column.key !== "number");
    const growIndex = flexibleIndex < 0 ? 0 : flexibleIndex;
    columns = columns.map((column, index) => index === growIndex
      ? { ...column, width: column.width + width - x }
      : column);
    let adjustedX = 0;
    columns = columns.map((column) => {
      const positioned = { ...column, x: adjustedX };
      adjustedX += column.width;
      return positioned;
    });
  }
  const height = connectorE4TableMetrics.titleHeight + connectorE4TableMetrics.headerHeight +
    connector.contacts.length * connectorE4TableMetrics.rowHeight + connectorE4TableMetrics.footerHeight;
  const contactX = contactsFirst ? 0 : width;
  const contactPoints = Object.fromEntries(connectorE4Contacts(connector).map((contact, index) => [
    contact.id,
    {
      x: contactX,
      y: connectorE4TableMetrics.titleHeight + connectorE4TableMetrics.headerHeight +
        (index + 0.5) * connectorE4TableMetrics.rowHeight,
    },
  ]));
  return {
    width,
    height,
    titleHeight: connectorE4TableMetrics.titleHeight,
    headerHeight: connectorE4TableMetrics.headerHeight,
    rowHeight: connectorE4TableMetrics.rowHeight,
    footerHeight: connectorE4TableMetrics.footerHeight,
    columns,
    contactPoints,
  };
}
export function connectorContactPosition(
  connector: ConnectorInstance,
  contactId: string,
  view: EditorView,
): Point | null {
  const index = connector.contacts.findIndex((contact) => contact.id === contactId);
  if (index < 0) return null;
  if (connector.terminationComponent) {
    const origin = connector.positions[view];
    const local = {x:index===1?188:32,y:50};
    const point = view==='drawing'?drawingLocalPoint(local,connector.drawingPlacements):local;
    return {x:origin.x+point.x,y:origin.y+point.y};
  }
  const materialized = materializedContactWorldRepresentation(connector, contactId, view);
  if (materialized) return materialized.position;
  const origin = connector.positions[view];
  if (view === "e4") {
    const point = connectorE4TableGeometry(connector).contactPoints[contactId];
    return point ? { x: origin.x + point.x, y: origin.y + point.y } : null;
  }
  return { x: origin.x + 118, y: origin.y + 28 + index * 16 };
}
