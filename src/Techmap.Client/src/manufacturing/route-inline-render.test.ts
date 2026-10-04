import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createConnector, createWire } from "../editor/commands";
import { createEmptyHarnessDesign } from "../editor/model";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { addAssemblyRow, generateRoute, mergeRouteRows } from "./route-commands";
import { buildRouteSourceItems } from "./route-source";
import { RouteRowInline, WireBlankStageDrawing } from "./ManufacturingRoutePanel";

const config: RuntimeConfig = { configVersion: 1, basePath: "/", apiBasePath: "/api", appVersion: "test", apiVersion: "1", schemaVersion: "1" };
const session: LocalSession = { csrfNonce: "test", instanceId: "test" };

describe("inline route row", () => {
  it("keeps a pinned template visible when the active catalog is unavailable", () => {
    const row = { id: "r", kind: "semiFinished" as const, title: "Провод", comment: "", sourceObjects: [{ kind: "wire" as const, id: "wire" }], dependsOn: [], operations: [], prepared: false, presentation: { backgroundOpacity: .25, objects: [] }, wireBlankSelections: [{ wireId: "wire", binding: { sourceId: "technology-wire-blanks" as const, entityType: "wire-blank" as const, snapshotId: "11111111-1111-4111-8111-111111111111", snapshotSha256: "a".repeat(64), recordId: "b".repeat(64), sourceKey: "ПФП-01", displayName: "Сохранённый шаблон", visual: { start: "cut", end: "cut", color: "#26609e", templateId: "01-cut", photoDataUrl: null } } }] };
    const item = { ref: { kind: "wire" as const, id: "wire" }, title: "Провод", lengthMm: null, color: null, material: "", materialArticle: "", section: "", terminalFrom: "", terminalTo: "" };
    const markup = renderToStaticMarkup(createElement(WireBlankStageDrawing, { row, items: [item], snapshot: null, error: null, disabled: false, update: () => {} }));
    expect(markup).toContain("Сохранённый шаблон (закреплённая версия)");
    expect(markup).toContain("alt=\"Сохранённый шаблон: После резки — После резки\"");
    expect(markup).toContain("Справочник «Полуфабрикаты провода» недоступен");
  });
  it("renders the complete editor in one row without a nested dialog", () => {
    const a = createConnector("a", "X1", 1, { x: 0, y: 0 });
    const b = createConnector("b", "X2", 1, { x: 100, y: 0 });
    const document = { ...createEmptyHarnessDesign(), connectors: [a, b], wires: [createWire("wire", { connectorId: a.id, contactId: a.contacts[0]!.id }, { connectorId: b.id, contactId: b.contacts[0]!.id }, 100, "Питание", "#f00")] };
    const route = generateRoute(document, "a".repeat(64), 2);
    const row = route.rows[0]!;
    const markup = renderToStaticMarkup(createElement(RouteRowInline, {
      config, session, projectId: "p", harnessId: "h", row, route, document, sources: buildRouteSourceItems(document), ordinal: 1,
      disabled: false, selected: false, onSelect: () => {}, update: () => {}, setPhotoBusy: () => {},
    }));
    expect(markup).not.toContain("<dialog");
    expect(markup).toContain("Индекс");
    expect(markup).toContain("Шаблон полуфабриката");
    expect(markup).toContain("Операции");
    expect(markup).toContain("Фото этапа");
    expect(markup).toContain('class="route-material-table route-material-table-components"');
    expect(markup).toContain('<th>Разделка</th><th>Кол-во</th><th>Запас</th><th>Время</th>');
    expect(markup).toContain('<td class="route-metric-cell"><label>Кол-во');
    expect(markup).toContain('class="route-operations-table"');
    expect(markup).toContain('+ Добавить операцию');
    expect(markup).toContain('class="route-row-delete"');
    expect(markup).toContain('title="Удалить полуфабрикат"');
    expect(markup).not.toContain('route-drawing-mode');
    expect(markup).not.toContain('Режим новой операции');
    expect(markup).not.toContain('Режим операции 1');
    expect(markup).not.toContain('type="radio"');
    expect(markup).not.toContain('class="route-terminal-requirements"');
    expect(markup).toContain("Открыть редактор рисунка");
    expect(markup).not.toContain("Копия чертежа этапа");
  });

  it("shows terminal articles instead of encoded keys in tables and drawing", () => {
    const key = "3:JST|13:SXH-002T-P0.6|0:|3:XHP";
    const a = createConnector("a", "X1", 1, { x: 0, y: 0 });
    const b = createConnector("b", "X2", 1, { x: 100, y: 0 });
    const connectors = [a, b].map(connector => ({ ...connector, contacts: connector.contacts.map(contact => ({ ...contact, terminalArticle: key })) }));
    const document = { ...createEmptyHarnessDesign(), connectors, wires: [createWire("wire", { connectorId: a.id, contactId: a.contacts[0]!.id }, { connectorId: b.id, contactId: b.contacts[0]!.id }, 100, "Питание", "#f00")] };
    const route = generateRoute(document, "a".repeat(64), 1);
    const markup = renderToStaticMarkup(createElement(RouteRowInline, {
      config, session, projectId: "p", harnessId: "h", row: route.rows[0]!, route, document, sources: buildRouteSourceItems(document), ordinal: 1,
      disabled: false, selected: false, onSelect: () => {}, update: () => {}, setPhotoBusy: () => {},
    }));
    expect(markup).toContain("SXH-002T-P0.6");
    expect(markup).not.toContain(key);
  });

  it("renders one independent metric set for each semi-finished row", () => {
    const a = createConnector("a", "X1", 1, { x: 0, y: 0 });
    const b = createConnector("b", "X2", 1, { x: 100, y: 0 });
    const c = createConnector("c", "X3", 1, { x: 200, y: 0 });
    const document = { ...createEmptyHarnessDesign(), connectors: [a, b, c], wires: [
      createWire("wire-1", { connectorId: a.id, contactId: a.contacts[0]!.id }, { connectorId: b.id, contactId: b.contacts[0]!.id }, 100, "Питание", "#f00"),
      createWire("wire-2", { connectorId: b.id, contactId: b.contacts[0]!.id }, { connectorId: c.id, contactId: c.contacts[0]!.id }, 200, "Сигнал", "#00f"),
    ] };
    const generated = generateRoute(document, "a".repeat(64), 1);
    const row = { ...generated.rows[0]!, index: "ПФ-01", quantity: 2, reserve: 1, operationTimeMinutes: 7 };
    const route = { ...generated, rows: [row] };
    const markup = renderToStaticMarkup(createElement(RouteRowInline, {
      config, session, projectId: "p", harnessId: "h", row, route, document, sources: buildRouteSourceItems(document), ordinal: 1,
      disabled: false, selected: false, onSelect: () => {}, update: () => {}, setPhotoBusy: () => {},
    }));
    expect(markup).toContain('class="route-material-table route-material-table-components"');
    expect(markup).toContain('<th>Разделка</th><th>Кол-во</th><th>Запас</th><th>Время</th>');
    expect(markup).toContain('<strong>ПФ-01</strong><span>X1:1 → X2:1 · Питание</span>');
    expect(markup).toContain('value="2"');
    expect(markup).toContain('value="1"');
    expect(markup).toContain('value="7"');
    expect(markup).not.toContain('route-component-metrics');
    expect(markup).toContain("14 мин");
    expect(markup).not.toContain("Сводка объединённого полуфабриката");
    expect(markup).not.toContain('<tfoot><tr><td class="route-metric-cell"><label>Кол-во');
  });

  it("labels a grouped operation without presenting it as another product", () => {
    const a = createConnector("a", "X1", 1, { x: 0, y: 0 });
    const b = createConnector("b", "X2", 1, { x: 100, y: 0 });
    const c = createConnector("c", "X3", 1, { x: 200, y: 0 });
    const document = { ...createEmptyHarnessDesign(), connectors: [a, b, c], wires: [
      createWire("one", { connectorId: a.id, contactId: a.contacts[0]!.id }, { connectorId: b.id, contactId: b.contacts[0]!.id }, 100),
      createWire("two", { connectorId: b.id, contactId: b.contacts[0]!.id }, { connectorId: c.id, contactId: c.contacts[0]!.id }, 100),
    ] };
    const generated = generateRoute(document, "a".repeat(64));
    const route = mergeRouteRows(generated, generated.rows.map(row => row.id), "shared");
    const row = route.rows.at(-1)!;
    const markup = renderToStaticMarkup(createElement(RouteRowInline, {
      config, session, projectId: "p", harnessId: "h", row, route, document, sources: buildRouteSourceItems(document), ordinal: 3,
      disabled: false, selected: false, onSelect: () => {}, update: () => {}, setPhotoBusy: () => {},
    }));
    expect(markup).toContain("ОБЩАЯ ОПЕРАЦИЯ");
    expect(markup).toContain("Участники общей операции");
    expect(markup).not.toContain("Состав сборки");
    expect(markup).not.toContain("route-material-table-scroll");
  });

  it("shows a clickable operation field and a 0–100 harness background control", () => {
    const document = createEmptyHarnessDesign();
    const route = addAssemblyRow(generateRoute(document, "a".repeat(64), 1), "assembly", "Сборка", [], []);
    const row = { ...route.rows[0]!, operations: [{ id: "op", mode: "assembly" as const, note: "", binding: null }] };
    const markup = renderToStaticMarkup(createElement(RouteRowInline, {
      config, session, projectId: "p", harnessId: "h", row, route, document, sources: [], ordinal: 1,
      disabled: false, selected: false, onSelect: () => {}, update: () => {}, setPhotoBusy: () => {},
    }));
    expect(markup).toContain('aria-label="Операция 1: не выбрана"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('class="route-operation-number"');
    expect(markup).toContain('Переместить операцию 1 ниже');
    expect(markup).not.toContain('Режим операции 1');
    expect(markup).not.toContain('type="radio"');
    expect(markup).toContain('min="0" max="100" step="1"');
  });

  it("shows an empty assembly with its own add-resource action and saved fragment", () => {
    const document = createEmptyHarnessDesign();
    const route = addAssemblyRow(generateRoute(document, "a".repeat(64), 1), "assembly", "Сборка", [], []);
    const markup = renderToStaticMarkup(createElement(RouteRowInline, {
      config, session, projectId: "p", harnessId: "h", row: route.rows[0]!, route, document, sources: [], ordinal: 1,
      disabled: false, selected: false, onSelect: () => {}, update: () => {}, setPhotoBusy: () => {},
    }));
    expect(markup).toContain("Состав сборки");
    expect(markup).toContain('+ Добавить');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).not.toContain("Перетащите карточку сюда");
    expect(markup).toContain("Изменить фрагмент");
    expect(markup).toContain("Откройте режим рисунка и сохраните фрагмент сборки");
  });
});
