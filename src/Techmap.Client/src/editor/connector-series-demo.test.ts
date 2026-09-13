import { describe, expect, it } from "vitest";
import {
  builtInConnectorSeries,
  builtInConnectorTemplates,
  builtInFreeConnectorTemplate,
  createBuiltInConnectorInstance,
  createConnectorFromSeries,
  createConnectorInstanceFromFreeTemplate,
  createConnectorInstanceFromSeries,
  connectorSeriesCatalogId,
  findBuiltInConnectorSeries,
  findBuiltInConnectorTemplate,
  freeConnectorTemplateCatalogId,
} from "./connector-series-demo";
import { createConnector } from "./commands";

describe("built-in connector series demo", () => {
  it("models XS-04 and XS-10 as articles of one series with all three contact kinds", () => {
    expect(builtInConnectorSeries).toHaveLength(1);
    const series = builtInConnectorSeries[0]!;
    expect(series).toMatchObject({
      id: "xs-demo-series",
      name: "Серия XS",
      thirdContactTypeLabel: "коаксиальный",
    });
    expect(series.articles.map((article) => ({
      partNumber: article.partNumber,
      counts: article.contactCounts,
    }))).toEqual([
      { partNumber: "XS-04", counts: { signal: 2, power: 1, third: 1 } },
      { partNumber: "XS-10", counts: { signal: 6, power: 2, third: 2 } },
    ]);
    for (const article of series.articles) {
      expect(article.allowedTerminalArticles.signal.length).toBeGreaterThanOrEqual(2);
      expect(article.allowedTerminalArticles.power.length).toBeGreaterThanOrEqual(2);
      expect(article.allowedTerminalArticles.third.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("exposes one series template and one independent free template", () => {
    expect(builtInConnectorTemplates).toEqual([
      expect.objectContaining({
        id: "catalog-connector-series:xs-demo-series", kind: "series", seriesId: "xs-demo-series", defaultPartNumber: "XS-04",
      }),
      expect.objectContaining({
        id: "catalog-connector-free", kind: "free", partNumber: "FREE-CONNECTOR", defaultContactCount: 4,
      }),
    ]);
    expect(findBuiltInConnectorSeries("xs-demo-series").articles).toHaveLength(2);
    expect(findBuiltInConnectorTemplate(connectorSeriesCatalogId("xs-demo-series")).kind).toBe("series");
    expect(freeConnectorTemplateCatalogId).toBe("catalog-connector-free");
  });

  it("creates a ready ConnectorInstance for XS-04", () => {
    const connector = createConnectorInstanceFromSeries(
      builtInConnectorSeries[0]!,
      "XS-04",
      { id: "x1", designation: "XS1", e4Position: { x: 20, y: 30 } },
    );

    expect(connector).toMatchObject({
      id: "x1",
      designation: "XS1",
      partNumber: "XS-04",
      libraryBinding: { mode: "series", seriesId: "xs-demo-series", partNumber: "XS-04" },
      positions: { e4: { x: 20, y: 30 }, drawing: { x: 20, y: 30 } },
      layerIds: { e4: "connectors", drawing: "connectors" },
    });
    expect(connector.contacts.map((contact) => contact.contactType)).toEqual([
      "сигнальный", "сигнальный", "силовой", "коаксиальный",
    ]);
    expect(connector.contacts.map((contact) => contact.libraryContact)).toEqual([
      { kind: "signal", ordinal: 1 },
      { kind: "signal", ordinal: 2 },
      { kind: "power", ordinal: 1 },
      { kind: "third", ordinal: 1 },
    ]);
  });

  it("creates XS-10 through its legacy catalog ID and keeps an explicit drawing position", () => {
    const connector = createBuiltInConnectorInstance("catalog-xs-10", {
      id: "x10",
      designation: "XS10",
      e4Position: { x: 10, y: 20 },
      drawingPosition: { x: 100, y: 200 },
    });

    expect(connector.partNumber).toBe("XS-10");
    expect(connector.contacts).toHaveLength(10);
    expect(connector.contacts.filter((contact) => contact.libraryContact?.kind === "signal")).toHaveLength(6);
    expect(connector.contacts.filter((contact) => contact.libraryContact?.kind === "power")).toHaveLength(2);
    expect(connector.contacts.filter((contact) => contact.libraryContact?.kind === "third")).toHaveLength(2);
    expect(connector.positions.drawing).toEqual({ x: 100, y: 200 });
  });

  it("allows the series catalog item to select either article", () => {
    const connector = createBuiltInConnectorInstance(connectorSeriesCatalogId("xs-demo-series"), {
      id: "x10",
      designation: "XS10",
      partNumber: "XS-10",
      e4Position: { x: 0, y: 0 },
    });
    expect(connector.partNumber).toBe("XS-10");
    expect(connector.contacts).toHaveLength(10);
    expect(() => createBuiltInConnectorInstance(connectorSeriesCatalogId("xs-demo-series"), {
      id: "bad",
      designation: "XS0",
      partNumber: "XS-99",
      e4Position: { x: 0, y: 0 },
    })).toThrow(/отсутствует в серии/);
  });

  it("applies the default or selected article to an existing MVP connector", () => {
    const base = createConnector("base", "XS5", 1, { x: 5, y: 6 });
    expect(createConnectorFromSeries(base, builtInConnectorSeries[0]!).partNumber).toBe("XS-04");
    const selected = createConnectorFromSeries(base, builtInConnectorSeries[0]!, "XS-10");
    expect(selected).toMatchObject({
      id: "base",
      designation: "XS5",
      partNumber: "XS-10",
      libraryBinding: { mode: "series", seriesId: "xs-demo-series", partNumber: "XS-10" },
    });
    expect(selected.contacts).toHaveLength(10);
  });

  it("creates a free ConnectorInstance whose rows are independent of the series", () => {
    const connector = createConnectorInstanceFromFreeTemplate(builtInFreeConnectorTemplate, {
      id: "free-1",
      designation: "XS99",
      e4Position: { x: 15, y: 25 },
      contactCount: 3,
    });

    expect(connector).toMatchObject({
      partNumber: "FREE-CONNECTOR",
      libraryBinding: { mode: "free" },
    });
    expect(connector.contacts.map((contact) => ({
      id: contact.id,
      number: contact.number,
      libraryContact: contact.libraryContact,
    }))).toEqual([
      { id: "free-1:contact:1", number: 1, libraryContact: null },
      { id: "free-1:contact:2", number: 2, libraryContact: null },
      { id: "free-1:contact:3", number: 3, libraryContact: null },
    ]);
  });

  it("uses the free template default and validates lookup and row count", () => {
    expect(createBuiltInConnectorInstance("catalog-connector-free", {
      id: "free-1", designation: "XS1", e4Position: { x: 0, y: 0 },
    }).contacts).toHaveLength(4);
    expect(() => createBuiltInConnectorInstance("catalog-connector-free", {
      id: "free-1", designation: "XS1", e4Position: { x: 0, y: 0 }, freeContactCount: 0,
    })).toThrow(/от 1 до 300/);
    expect(() => findBuiltInConnectorTemplate("missing")).toThrow(/не найден/);
    expect(() => findBuiltInConnectorSeries("missing")).toThrow(/не найдена/);
  });

  it("does not mutate shared demonstration definitions while creating instances", () => {
    const before = JSON.stringify({ builtInConnectorSeries, builtInConnectorTemplates });
    createBuiltInConnectorInstance("catalog-xs-04", {
      id: "x1", designation: "XS1", e4Position: { x: 0, y: 0 },
    });
    createBuiltInConnectorInstance("catalog-connector-free", {
      id: "x2", designation: "XS2", e4Position: { x: 0, y: 0 }, freeContactCount: 8,
    });
    expect(JSON.stringify({ builtInConnectorSeries, builtInConnectorTemplates })).toBe(before);
  });
});
