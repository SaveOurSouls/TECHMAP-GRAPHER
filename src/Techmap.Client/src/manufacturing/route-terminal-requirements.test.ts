import { describe, expect, it, vi } from "vitest";
import { createConnector, createWire } from "../editor/commands";
import { createEmptyHarnessDesign, type ComponentTemplateArticleKeySnapshot, type ConnectorInstance, type HarnessDesignDocument } from "../editor/model";
import type { ReferenceCatalogApi, ReferenceCatalogSearchPage } from "../reference-catalog-api";
import type { ManufacturingRoute } from "./route-model";
import { resolveRouteTerminalRequirements } from "./route-terminal-requirements";

const article = "ACME | REEL-1 | BAG-1 | S1";
const qualified = { sourceId: "technology-terminals", entityType: "terminal", articleKey: article };
const snapshotId = "11111111-1111-4111-8111-111111111111";
function fixture(keys: readonly ComponentTemplateArticleKeySnapshot[] = [qualified]): { document: HarnessDesignDocument; route: ManufacturingRoute } {
  const connector = createConnector("x", "X1", 1, { x: 0, y: 0 });
  const bound: ConnectorInstance = {
    ...connector, contacts: connector.contacts.map(c => ({ ...c, logicalContactId: "logical-10", terminalArticle: article })),
    libraryBinding: { mode: "template", templateId: snapshotId, templateVersion: 1, versionSha256: "c".repeat(64), articleVariantId: "variant", article: { sourceId: "connectors", entityType: "connector", articleKey: "BODY" }, snapshot: {
      templateId: snapshotId, templateVersion: 1, versionSha256: "c".repeat(64), code: "X", name: "Connector", articleVariantId: "variant",
      article: { sourceId: "connectors", entityType: "connector", articleKey: "BODY" }, articleBindings: [], assets: [],
      contacts: [{ logicalContactId: "logical-10", prototypeLogicalContactId: "logical-10", sourceNumber: "10", name: "Contact", circuitText: null,
        contactTypeGroupId: null, contactType: "signal", allowedTerminalArticleKeys: keys, representations: [] }],
    } },
  };
  const wire = createWire("w", { connectorId: bound.id, contactId: bound.contacts[0]!.id }, { connectorId: bound.id, contactId: bound.contacts[0]!.id }, 100);
  const document = { ...createEmptyHarnessDesign(), connectors: [bound], wires: [wire] };
  const route: ManufacturingRoute = { contractVersion: 1, source: { fingerprintVersion: 1, sha256: "d".repeat(64) }, status: "draft", rows: [
    { id: "row", kind: "semiFinished", title: "Wire", comment: "", sourceObjects: [{ kind: "wire", id: "w" }], dependsOn: [], operations: [], prepared: false, presentation: { backgroundOpacity: .25, objects: [] } },
    { id: "assembly", kind: "assembly", title: "Assembly", comment: "", sourceObjects: [], dependsOn: ["row"], operations: [], prepared: false, presentation: { backgroundOpacity: .25, objects: [] } },
  ] };
  return { document, route };
}
function catalog(stripLengthMm: unknown = "4,125") {
  const page: ReferenceCatalogSearchPage = { snapshotId, snapshotSha256: "a".repeat(64), nextCursor: null,
    items: [{ recordId: "b".repeat(64), entityType: "terminal", sourceKey: article, sourceLocation: null, payload: { stripLengthMm, name: "Terminal" } }] };
  const searchCatalog = vi.fn<ReferenceCatalogApi["searchCatalog"]>().mockResolvedValue(page);
  return { page, searchCatalog };
}

describe("pinned route terminal requirements", () => {
  it("pins the exact source-qualified terminal snapshot and decimal norm without changing construction or strip profiles", async () => {
    const { document, route } = fixture(), api = catalog();
    const before = JSON.stringify({ document, route });
    const result = await resolveRouteTerminalRequirements(document, route, api);
    expect(api.searchCatalog).toHaveBeenCalledTimes(1);
    expect(api.searchCatalog).toHaveBeenCalledWith("technology-terminals", expect.objectContaining({ exactSourceKey: article, entityTypes: ["terminal"], text: null }));
    expect(result.rows[0]!.terminalRequirements).toEqual(["from", "to"].map(end => ({ wireId: "w", end, terminalArticle: article, stripLengthMm: 4.125,
      binding: { sourceId: "technology-terminals", entityType: "terminal", snapshotId, snapshotSha256: "a".repeat(64), recordId: "b".repeat(64), sourceKey: article, displayName: "Terminal" } })));
    expect(result.rows[1]).toBe(route.rows[1]);
    expect(JSON.stringify({ document, route })).toBe(before);
    expect(result.rows[0]).not.toHaveProperty("stripProfiles");
  });

  it.each([{ keys: [] }, { keys: [qualified, { ...qualified, sourceId: "other-terminal-source" }] }])("keeps missing or ambiguous source identity unknown", async ({ keys }) => {
    const { document, route } = fixture(keys), api = catalog();
    const result = await resolveRouteTerminalRequirements(document, route, api);
    expect(api.searchCatalog).not.toHaveBeenCalled();
    expect(result.rows[0]!.terminalRequirements?.every(req => req.binding === null && req.stripLengthMm === null)).toBe(true);
  });

  it("does not infer source identity from the compatibility-only catalog", async () => {
    const { document, route } = fixture([]), api = catalog();
    const legacy = { ...document, connectors: document.connectors.map(c => ({ ...c, terminalCatalog: { templateId: snapshotId, version: 2, versionSha256: "f".repeat(64), byContact: { "logical-10": [article] } } })) };
    const result = await resolveRouteTerminalRequirements(legacy, route, api);
    expect(api.searchCatalog).not.toHaveBeenCalled();
    expect(result.rows[0]!.terminalRequirements?.[0]?.binding).toBeNull();
  });

  it.each(["3–5", "4 mm", "1e2", "-1", "1.2345", "1000000001", "", null])("preserves the pinned identity but keeps invalid norm %s unknown", async value => {
    const { document, route } = fixture(), api = catalog(value);
    const result = await resolveRouteTerminalRequirements(document, route, api);
    expect(result.rows[0]!.terminalRequirements?.[0]).toMatchObject({ stripLengthMm: null, binding: { snapshotId } });
  });

  it.each([0, "0", "3.25", " 3,250 "])("accepts an explicit scalar norm %s", async value => {
    const { document, route } = fixture(), api = catalog(value);
    const result = await resolveRouteTerminalRequirements(document, route, api);
    expect(result.rows[0]!.terminalRequirements?.[0]?.stripLengthMm).toBe(Number(String(value).trim().replace(",", ".")));
  });

  it.each(["missing", "duplicate", "more", "wrong-key", "wrong-type", "bad-hash", "bad-uuid", "offline"])("keeps %s lookup unknown", async mutation => {
    const { document, route } = fixture(), api = catalog();
    let page = api.page;
    if (mutation === "missing") page = { ...page, items: [] };
    if (mutation === "duplicate") page = { ...page, items: [...page.items, ...page.items] };
    if (mutation === "more") page = { ...page, nextCursor: "next" };
    if (mutation === "wrong-key") page = { ...page, items: [{ ...page.items[0]!, sourceKey: "other" }] };
    if (mutation === "wrong-type") page = { ...page, items: [{ ...page.items[0]!, entityType: "wire" }] };
    if (mutation === "bad-hash") page = { ...page, snapshotSha256: "wrong" };
    if (mutation === "bad-uuid") page = { ...page, snapshotId: "00000000-0000-0000-0000-000000000000" };
    api.searchCatalog.mockResolvedValue(page);
    if (mutation === "offline") api.searchCatalog.mockRejectedValue(new Error("offline"));
    const result = await resolveRouteTerminalRequirements(document, route, api);
    expect(result.rows[0]!.terminalRequirements?.[0]).toMatchObject({ stripLengthMm: null, binding: null });
  });

  it("keeps junction ends unknown without borrowing the opposite contact's terminal", async () => {
    const { document, route } = fixture(), api = catalog();
    const source = { ...document, wires: document.wires.map(w => ({ ...w, from: { junctionId: "j", connectorId: "" as const, contactId: "" as const } })) };
    const result = await resolveRouteTerminalRequirements(source, route, api);
    expect(result.rows[0]!.terminalRequirements?.[0]).toEqual({ wireId: "w", end: "from", terminalArticle: "", stripLengthMm: null, binding: null });
    expect(result.rows[0]!.terminalRequirements?.[1]?.stripLengthMm).toBe(4.125);
  });
});
