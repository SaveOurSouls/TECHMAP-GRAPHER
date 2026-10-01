import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createConnector, createWire } from "../editor/commands";
import { createEmptyHarnessDesign } from "../editor/model";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { addAssemblyRow, generateRoute } from "./route-commands";
import { buildRouteSourceItems } from "./route-source";
import { RouteRowInline } from "./ManufacturingRoutePanel";

const config: RuntimeConfig = { configVersion: 1, basePath: "/", apiBasePath: "/api", appVersion: "test", apiVersion: "1", schemaVersion: "1" };
const session: LocalSession = { csrfNonce: "test", instanceId: "test" };

describe("inline route row", () => {
  it("renders the complete editor in one row without a nested dialog", () => {
    const a = createConnector("a", "X1", 1, { x: 0, y: 0 });
    const b = createConnector("b", "X2", 1, { x: 100, y: 0 });
    const document = { ...createEmptyHarnessDesign(), connectors: [a, b], wires: [createWire("wire", { connectorId: a.id, contactId: a.contacts[0]!.id }, { connectorId: b.id, contactId: b.contacts[0]!.id }, 100, "Питание", "#f00")] };
    const route = generateRoute(document, "a".repeat(64), 2);
    const row = route.rows[0]!;
    const markup = renderToStaticMarkup(createElement(RouteRowInline, {
      config, session, projectId: "p", row, route, document, sources: buildRouteSourceItems(document), ordinal: 1,
      disabled: false, selected: false, onSelect: () => {}, update: () => {}, setPhotoBusy: () => {},
    }));
    expect(markup).not.toContain("<dialog");
    expect(markup).toContain("Индекс");
    expect(markup).toContain("Длина резки остаётся заданной в жгуте");
    expect(markup).toContain("Операции");
    expect(markup).toContain("Фото этапа");
    expect(markup).toContain('class="route-material-table"');
    expect(markup).toContain('class="route-metrics-table"');
  });

  it("shows terminal articles instead of encoded keys in tables and drawing", () => {
    const key = "3:JST|13:SXH-002T-P0.6|0:|3:XHP";
    const a = createConnector("a", "X1", 1, { x: 0, y: 0 });
    const b = createConnector("b", "X2", 1, { x: 100, y: 0 });
    const connectors = [a, b].map(connector => ({ ...connector, contacts: connector.contacts.map(contact => ({ ...contact, terminalArticle: key })) }));
    const document = { ...createEmptyHarnessDesign(), connectors, wires: [createWire("wire", { connectorId: a.id, contactId: a.contacts[0]!.id }, { connectorId: b.id, contactId: b.contacts[0]!.id }, 100, "Питание", "#f00")] };
    const route = generateRoute(document, "a".repeat(64), 1);
    const markup = renderToStaticMarkup(createElement(RouteRowInline, {
      config, session, projectId: "p", row: route.rows[0]!, route, document, sources: buildRouteSourceItems(document), ordinal: 1,
      disabled: false, selected: false, onSelect: () => {}, update: () => {}, setPhotoBusy: () => {},
    }));
    expect(markup).toContain("SXH-002T-P0.6");
    expect(markup).not.toContain(key);
  });

  it("shows a clickable operation field and a 0–100 harness background control", () => {
    const document = createEmptyHarnessDesign();
    const route = addAssemblyRow(generateRoute(document, "a".repeat(64), 1), "assembly", "Сборка", [], []);
    const row = { ...route.rows[0]!, operations: [{ id: "op", mode: "assembly" as const, note: "", binding: null }] };
    const markup = renderToStaticMarkup(createElement(RouteRowInline, {
      config, session, projectId: "p", row, route, document, sources: [], ordinal: 1,
      disabled: false, selected: false, onSelect: () => {}, update: () => {}, setPhotoBusy: () => {},
    }));
    expect(markup).toContain('aria-label="Операция 1: не выбрана"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('min="0" max="100" step="1"');
  });

  it("shows an empty assembly as a drop target and only its saved fragment", () => {
    const document = createEmptyHarnessDesign();
    const route = addAssemblyRow(generateRoute(document, "a".repeat(64), 1), "assembly", "Сборка", [], []);
    const markup = renderToStaticMarkup(createElement(RouteRowInline, {
      config, session, projectId: "p", row: route.rows[0]!, route, document, sources: [], ordinal: 1,
      disabled: false, selected: false, onSelect: () => {}, update: () => {}, setPhotoBusy: () => {},
    }));
    expect(markup).toContain("Состав сборки");
    expect(markup).toContain("Перетащите карточку сюда");
    expect(markup).toContain("Изменить фрагмент");
    expect(markup).toContain("Откройте режим рисунка и сохраните фрагмент сборки");
  });
});
