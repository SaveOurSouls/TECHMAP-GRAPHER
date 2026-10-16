import { describe, expect, it } from "vitest";
import { physicalFixture } from "../editor/physical-topology-fixture";
import { emptyTerminationDocument } from "../editor/termination-model";
import { createInitialRouteV3, generateRouteV3, parseRouteV3, type RouteV3Document } from "./route-v3-model";
import { applyWirePreparation, buildWirePreparationStages, wirePreparationDefault, wirePreparationEnds } from "./route-v3-wire-preparation";
import { editableRouteV3, refreshRouteV3 } from "./route-v3-graph";
import { routeV3OperationFromCatalog } from "./route-v3-operations";
import type { ReferenceCatalogSnapshot } from "../reference-catalog-api";
import type { WirePreparationScheme } from "../WirePreparationCatalog";
import { importWirePreparationTsv, wirePreparationRequest, wirePreparationDraft, wirePreparationReady } from "../WirePreparationCatalog";
import seed from "../wire-preparation-seed.json";
import { wireBlankDraft, wireBlankRequest, type WireBlank } from "../WireBlankCatalog";

const catalog: ReferenceCatalogSnapshot = { snapshotId: "snap", sourceId: "ops", sha256: "abc", sourceKind: "editable-table", contractVersion: 1, capturedUtc: "2026-10-16", versionFingerprint: "1", sourceUri: null, diagnostics: [], records: [
  { recordId: "cut", entityType: "operation", sourceKey: "1", sourceLocation: null, payload: { name: "Резка", operationType: "Погонная" } },
  { recordId: "crimp", entityType: "operation", sourceKey: "2", sourceLocation: null, payload: { name: "Обжим", operationType: "Статичная" } },
] };
const op = (i: number) => routeV3OperationFromCatalog(catalog.records[i]!, catalog, `op-${i}`);
const schemes: WirePreparationScheme[] = [{ id: "a", name: "Схема A", description: "Два одинаковых обжима по порядку", operations: [op(0), op(1), op(1)] }, { id: "b", name: "Схема B", description: "Резка", operations: [op(0)] }];
const assignments = [{ wireId: "W1", schemeId: "a" }, { wireId: "W2", schemeId: "a" }, { wireId: "W3", schemeId: "b" }];
const source = physicalFixture();
const initial = () => editableRouteV3(generateRouteV3(createInitialRouteV3(source), source));
describe("REQ-152 preparation schemes", () => {
  it("groups by scheme and preserves repeated sequential operations and all product assignments", () => {
    const before = JSON.stringify(source);
    const route = applyWirePreparation(initial(), assignments, schemes);
    expect(route.nodes).toHaveLength(4);
    expect(route.nodes.filter(n => n.wirePreparationStage?.schemeId === "a").map(n => n.operations?.[0]?.title)).toEqual(["Резка", "Обжим", "Обжим"]);
    expect(route.nodes.filter(n => n.wirePreparationStage?.schemeId === "a").every(n => n.refs.length === 2 && n.operations?.[0]?.outputProductIds?.length === 2)).toBe(true);
    expect(route.edges).toHaveLength(2);
    expect(parseRouteV3(JSON.parse(JSON.stringify(route)))).not.toBeNull();
    expect(JSON.stringify(source)).toBe(before);
    const regenerated = refreshRouteV3(editableRouteV3(generateRouteV3(route, source)));
    expect(regenerated.nodes.map(n => n.id)).toEqual(route.nodes.map(n => n.id));
    expect(regenerated.nodes.map(n => n.refs)).toEqual(route.nodes.map(n => n.refs));
  });
  it("rewires subsets to final stages, preserves authored downstream settings and is idempotent", () => {
    const base = initial();
    const route: RouteV3Document = { ...base, nodes: [...base.nodes, { id: "manual", kind: "assembly", title: "Моя сборка", refs: [{ kind: "wire", id: "W1" }], rawRefs: [], inputNodeIds: ["prepared:wire"], fragmentIds: [], x: 900, y: 400, width: 450, operations: [op(1)] }], edges: [{ id: "one", from: "prepared:wire", to: "manual", refs: [{ kind: "wire", id: "W1" }] }] };
    const result = applyWirePreparation(route, assignments, schemes);
    const manual = result.nodes.find(n => n.id === "manual")!;
    expect(manual).toMatchObject({ title: "Моя сборка", width: 450, operations: [op(1)], refs: [{ kind: "wire", id: "W1" }], inputNodeIds: ["wire-preparation:a:2"] });
    expect(manual.y).toBeGreaterThan(result.nodes.find(n => n.id === "wire-preparation:a:2")!.y);
    const repeated = applyWirePreparation(result, assignments, schemes);
    expect(repeated).toEqual(result);
    const changed = applyWirePreparation(result, assignments.map(a => ({ ...a, schemeId: "b" })), schemes);
    expect(changed.nodes.find(n => n.id === "manual")?.refs).toEqual(manual.refs);
    expect(changed.nodes.filter(n => n.wirePreparationStage)).toHaveLength(1);
    expect(parseRouteV3(changed)).not.toBeNull();
  });
  it("does not enable deselected inputs during replacement", () => {
    const route = initial();
    const result = applyWirePreparation({ ...route, nodes: [...route.nodes, { id: "off", title: "Выключено", kind: "assembly", refs: [], rawRefs: [], inputNodeIds: [], fragmentIds: [], x: 32, y: 400 }], edges: [{ id: "off-edge", from: "prepared:wire", to: "off", refs: [{ kind: "wire", id: "W1" }] }] }, assignments, schemes);
    expect(result.nodes.find(n => n.id === "off")?.refs).toEqual([]);
  });
  it("separates a new group from a retained stage instead of overlapping their cards", () => {
    const single = applyWirePreparation(initial(), assignments.map(a => ({ ...a, schemeId: "b" })), schemes);
    const split = applyWirePreparation(single, assignments, schemes);
    for (const a of split.nodes) for (const b of split.nodes) {
      if (a.id === b.id) continue;
      expect(a.x < b.x + 280 && a.x + 280 > b.x && a.y < b.y + 264 && a.y + 264 > b.y).toBe(false);
    }
  });
  it("source refresh keeps manual operations on retained stages and removes deleted wires", () => {
    const route = applyWirePreparation(initial(), assignments, schemes);
    const edited = { ...route, nodes: route.nodes.map(n => ({ ...n, operations: n.operations?.map(o => ({ ...o, employees: 5 })) })), preparedRefs: route.preparedRefs.filter(r => r.id !== "W2") };
    const result = applyWirePreparation(edited, assignments.filter(a => a.wireId !== "W2"), schemes, true);
    expect(result.nodes.every(n => n.refs.every(r => r.id !== "W2"))).toBe(true);
    expect(result.nodes.every(n => n.operations?.[0]?.employees === 5)).toBe(true);
  });
  it("starts every scheme from its own raw material and keeps whole chains in separate columns", () => {
    const swapped = assignments.map(a => ({ ...a, schemeId: a.wireId === "W1" ? "b" : "a" }));
    const single = applyWirePreparation(initial(), swapped.map(a => ({ ...a, schemeId: "b" })), schemes);
    const split = applyWirePreparation(single, swapped, schemes);
    for (const route of [split, generateRouteV3(split, source), applyWirePreparation(split, swapped, schemes)]) {
      const roots = route.nodes.filter(n => n.wirePreparationStage?.step === 0);
      expect(roots).toHaveLength(2);
      expect(new Set(roots.map(n => n.x)).size).toBe(2);
      for (const root of roots) {
        expect(root.inputNodeIds).toEqual([]);
        expect(root.rawRefs).toEqual(root.refs);
        expect(route.edges.some(e => e.to === root.id)).toBe(false);
        const chain = route.nodes.filter(n => n.wirePreparationStage?.schemeId === root.wirePreparationStage!.schemeId);
        expect(chain.every(n => n.x === root.x)).toBe(true);
        expect(chain.slice(1).every(n => n.rawRefs?.length === 0)).toBe(true);
      }
      for (const edge of route.edges) {
        expect(route.nodes.find(n => n.id === edge.from)?.wirePreparationStage?.schemeId).toBe(route.nodes.find(n => n.id === edge.to)?.wirePreparationStage?.schemeId);
      }
    }
  });
  it("replaces individual end preparation without removing a shared downstream crimp", () => {
    const doc = { ...source, terminations: { ...emptyTerminationDocument(), artifacts: [{ id: "terminal", kind: "terminal" as const, symbolId: "nki-ring", article: "TEST" }], groups: [{ id: "g", artifactId: "terminal", target: source.wires[0]!.from, memberEnds: [{ wireId: "W1", end: "from" as const }, { wireId: "W2", end: "from" as const }] }], operations: [
      { id: "strip", kind: "strip" as const, target: { kind: "wireEnd" as const, wireId: "W1", end: "from" as const }, executionCount: 1 },
      { id: "shared", kind: "crimp" as const, target: { kind: "group" as const, groupId: "g" }, dependsOn: ["strip"], executionCount: 1 },
    ] } };
    const route = applyWirePreparation(editableRouteV3(generateRouteV3(createInitialRouteV3(doc), doc)), assignments, schemes);
    for (const result of [route, generateRouteV3(route, doc)]) {
      expect(result.nodes.some(n => n.id === "termination-operation:strip")).toBe(false);
      expect(result.nodes.some(n => n.id === "termination-operation:shared")).toBe(true);
      expect(result.edges.some(e => e.from === "wire-preparation:a:2" && e.to === "termination-operation:shared")).toBe(true);
      expect(result.edges.every(e => result.nodes.some(n => n.id === e.from) && result.nodes.some(n => n.id === e.to))).toBe(true);
    }
  });
  it("rejects missing recipes, malformed persisted steps and empty operations without mutating the graph", () => {
    const route = initial(), before = JSON.stringify(route);
    expect(() => applyWirePreparation(route, assignments, [])).toThrow();
    expect(() => applyWirePreparation(route, assignments, [{ ...schemes[0]!, operations: [null] }, schemes[1]!])).toThrow();
    const good = applyWirePreparation(route, assignments, schemes);
    expect(parseRouteV3({ ...good, wirePreparation: { assignments, schemes: [{ ...schemes[0]!, operations: "bad" }] } })).toBeNull();
    expect(JSON.stringify(route)).toBe(before);
  });
  it("keeps unassigned and newly added wires visible without a fictitious operation", () => {
    const result = buildWirePreparationStages({ schemes, assignments: assignments.slice(0, 2) }, initial().preparedRefs);
    expect(result.nodes.find(n => n.id === "prepared:wire")).toMatchObject({ refs: [{ kind: "wire", id: "W3" }], operations: [] });
  });
  it("distinguishes pin/socket, lugs and seals, and applies mirrored defaults", () => {
    const doc = { ...source, terminations: { ...emptyTerminationDocument(), endPreparations: [{ id: "p1", wireId: "W1", end: "from" as const, mode: "pin" as const }, { id: "p2", wireId: "W1", end: "to" as const, mode: "lug" as const }] } };
    expect(wirePreparationEnds(doc, "W1")).toEqual({ start: "terminal-pin", end: "lug-pin" });
    const blank: WireBlank = { id: "blank", index: "1", title: "Два конца", start: "lug-pin", end: "terminal-pin", color: "#112233", templateId: "generated", photoDataUrl: null, originalPayload: {}, defaultSchemeId: "a" };
    expect(wirePreparationDefault(doc, "W1", [blank])).toEqual(blank);
  });
  it("imports and persists arbitrary sequential columns while rejecting ambiguous operation numbers", () => {
    let n = 0;
    const rows = importWirePreparationTsv("Название\tОписание\tОперация №1\tОперация №2\nСхема\tТекст\t1\t2", [catalog], () => `id-${n++}`);
    expect(rows[0]?.operations.map(op => op?.title)).toEqual(["Резка", "Обжим"]);
    const request = wirePreparationRequest(rows, null);
    expect(wirePreparationDraft({ ...catalog, records: request.records.map(r => ({ ...r, recordId: r.sourceKey, sourceLocation: null })) })).toMatchObject(rows.map(({ originalPayload: _, ...r }) => r));
    expect(() => importWirePreparationTsv("Название\tОписание\t999", [catalog], () => "x")).toThrow(/не найдена/);
    expect(() => importWirePreparationTsv("Схема\tОписание\t1", [catalog, catalog], () => "x")).toThrow(/неоднозначна/);
  });
  it("seeds 24 owner schemes as drafts and covers every endpoint category pair", () => {
    expect(seed.schemes).toHaveLength(24);
    expect(seed.schemes.every(s => !wirePreparationReady(s))).toBe(true);
    const ends = new Set(seed.blanks.flatMap(b => [b.start, b.end]));
    expect(ends.size).toBe(9);
    for (const row of seed.blanks) {
      const rows = wireBlankDraft({ ...catalog, records: [{ entityType: "wire-blank", recordId: row.index, sourceKey: row.index, sourceLocation: null, payload: row }] });
      expect(wireBlankRequest(rows, null).records[0]?.payload.defaultSchemeId).toBe(row.defaultSchemeId);
    }
  });
});
