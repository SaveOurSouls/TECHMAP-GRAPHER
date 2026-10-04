import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { physicalFixture } from "../editor/physical-topology-fixture";
import { buildRouteSourceItems } from "../manufacturing/route-source";
import { RouteV2CompositionTable } from "./RouteV2CompositionTable";
import { createInitialRouteV2 } from "./route-v2-model";

describe("Route v2 composition table", () => {
  it("renders every selected source and preserves a visible row for a missing source", () => {
    const document = physicalFixture();
    const sources = buildRouteSourceItems(document);
    const initial = createInitialRouteV2(document).nodes[0]!;
    const node = { ...initial, refs: [...initial.refs, { kind: "wire" as const, id: "missing-wire" }] };
    const markup = renderToStaticMarkup(createElement(RouteV2CompositionTable, { document, node, sources }));
    expect(markup.match(/<tr>/g)).toHaveLength(5);
    for (const item of sources.filter(source => source.ref.kind === "wire")) expect(markup).toContain(item.title);
    expect(markup).toContain("missing-wire");
    expect(markup).toContain("Объект отсутствует в исходном чертеже");
    for (const column of ["Объект", "Материал", "Длина", "Концы", "Разделка"]) expect(markup).toContain(column);
  });

  it("shows end articles, strip profiles and explicit saved strip lengths", () => {
    const document = physicalFixture();
    const initial = createInitialRouteV2(document).nodes[0]!;
    const node = { ...initial, refs: [initial.refs[0]!], quantity: 3 };
    const sources = buildRouteSourceItems(document).map(item => ({ ...item, terminalFrom: "PIN-A", terminalTo: "PIN-B", stripProfiles: { from: { displayName: "Зачистка A" }, to: { displayName: "Зачистка B" } } })) as ReturnType<typeof buildRouteSourceItems>;
    const withRoute = { ...document, manufacturingRoute: { rows: [{ terminalRequirements: [{ wireId: "W1", end: "from", stripLengthMm: 4.5 }, { wireId: "W1", end: "to", stripLengthMm: 7 }] }] } } as unknown as typeof document;
    const markup = renderToStaticMarkup(createElement(RouteV2CompositionTable, { document: withRoute, node, sources }));
    for (const value of ["PIN-A", "PIN-B", "Зачистка A", "Зачистка B", "4.5 мм", "7 мм", "3 шт."]) expect(markup).toContain(value);
  });

  it("makes an unselected composition explicitly empty", () => {
    const document = physicalFixture();
    const node = { ...createInitialRouteV2(document).nodes[0]!, refs: [] };
    const markup = renderToStaticMarkup(createElement(RouteV2CompositionTable, { document, node, sources: buildRouteSourceItems(document) }));
    expect(markup).toContain("Состав пуст. Выберите полуфабрикаты ниже.");
    expect(markup).not.toContain("ПФ-01");
  });
});
