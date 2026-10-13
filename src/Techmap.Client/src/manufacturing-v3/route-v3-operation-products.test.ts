import { describe, expect, it } from "vitest";
import { physicalFixture } from "../editor/physical-topology-fixture";
import { buildRouteSourceItems } from "../manufacturing/route-source";
import { assignRouteV3OperationProducts, routeV3AssignedProductIds, routeV3OperationProjectTimes, routeV3Products, type RouteV3Operation } from "./route-v3-operations";
import { parseRouteV3, type RouteV3Node } from "./route-v3-model";

const operation = (patch: Partial<RouteV3Operation> = {}): RouteV3Operation => ({ id: "cut", title: "Резка", kind: "running", lengthMm: 1000, speedMmPerMinute: 1, employees: 1, quantity: 1, minutesEach: 0, feedTimeSecondsPerMeter: 10, toolCycleTimeSeconds: 2, toolOperationCount: 1, additionalTimeSeconds: 3, manualWorkTimeSeconds: 1, manualTakeTimeSeconds: 1, manualRemoveTimeSeconds: 1, setupTimeSeconds: 12, parallelCapacity: 1, ...patch });
const cutNode = (ids: readonly string[]): RouteV3Node => ({ id: "prepared:wire", kind: "semiFinished", title: "Провода", refs: ids.map(id => ({ kind: "wire", id })), fragmentIds: [], x: 0, y: 0, operations: [operation()] });

describe("Route v3 operation products", () => {
  it("creates one product per wire and one product for an assembly", () => {
    const cut = cutNode(["W1", "W2"]);
    expect(routeV3Products(cut).map(product => product.id)).toEqual(["product:prepared:wire:wire:W1", "product:prepared:wire:wire:W2"]);
    expect(routeV3Products({ ...cut, id: "assembly", kind: "assembly", refs: [{ kind: "wire", id: "W1" }] }).map(product => product.id)).toEqual(["product:assembly"]);
  });
  it("requires output selection for a multi-output operation and preserves partial assignment", () => {
    const node = cutNode(["W1", "W2"]), products = routeV3Products(node);
    expect(routeV3AssignedProductIds(node, operation())).toEqual([]);
    const assigned = assignRouteV3OperationProducts(node, "cut", [products[0]!.id]);
    expect(assigned[0]!.outputProductIds).toEqual([products[0]!.id]);
    const updated = { ...node, operations: assigned };
    expect(routeV3AssignedProductIds(updated, assigned[0]!)).toEqual([products[0]!.id]);
    const document = { version: 1 as const, preparedRefs: [], fragments: [], nodes: [updated], edges: [], generated: false, backgroundOpacity: .2 };
    expect(parseRouteV3(JSON.parse(JSON.stringify(document)))).toEqual(document);
    const reduced = cutNode(["W2"]);
    expect(routeV3AssignedProductIds(reduced, assigned[0]!)).toEqual([routeV3Products(reduced)[0]!.id]);
    expect(routeV3AssignedProductIds(reduced, operation({ outputProductIds: [] }))).toEqual([routeV3Products(reduced)[0]!.id]);
    expect(parseRouteV3(JSON.parse(JSON.stringify({ ...document, nodes: [{ ...reduced, operations: assigned }] })))).not.toBeNull();
  });
  it("counts four identical wires in one cycle with capacity five and scales N before rounding", () => {
    const base = physicalFixture();
    const source = { ...base, wires: [...base.wires, { ...base.wires[0]!, id: "W4" }] };
    const node = cutNode(["W1", "W2", "W3", "W4"]);
    const products = routeV3Products(node);
    const assigned = operation({ outputProductIds: products.map(product => product.id), parallelCapacity: 5 });
    const result = routeV3OperationProjectTimes(assigned, node, source, 1);
    expect(result.cycles).toBe(1);
    expect(result.setupMinutes).toBe(12 / 60);
    const twice = routeV3OperationProjectTimes(assigned, node, source, 2);
    expect(twice.cycles).toBe(2);
  });
  it("splits different lengths into independent modes and leaves missing setup unknown", () => {
    const base = physicalFixture();
    const source = { ...base, wires: base.wires.map((wire, index) => ({ ...wire, lengthMm: index === 0 ? 1000 : index === 1 ? 2000 : 3000 })) };
    const items = buildRouteSourceItems(source);
    const node = cutNode(["W1", "W2"]);
    const result = routeV3OperationProjectTimes(operation({ outputProductIds: routeV3Products(node).map(product => product.id), parallelCapacity: 5, setupTimeSeconds: null }), node, source, 1);
    expect(result.projectMinutes).toBeNull();
    expect(result.assignedRefs).toHaveLength(2);
    expect(items.filter(item => item.ref.kind === "wire")).toHaveLength(3);
    const complete = routeV3OperationProjectTimes(operation({ outputProductIds: routeV3Products(node).map(product => product.id), parallelCapacity: 1, setupTimeSeconds: 12 }), node, source, 1);
    expect(complete.cycles).toBe(2);
    expect(complete.projectMinutes).toBeGreaterThan(0);
  });
  it("rejects invalid product refs and duplicate products on roundtrip", () => {
    const base = { version: 1 as const, preparedRefs: [], fragments: [], nodes: [cutNode(["W1"])], edges: [], generated: false, backgroundOpacity: .2 };
    expect(parseRouteV3({ ...base, nodes: [{ ...cutNode(["W1"]), products: [{ id: "p", nodeId: "wrong", kind: "source", ref: { kind: "wire", id: "W1" } }] }] })).toBeNull();
    expect(parseRouteV3({ ...base, nodes: [{ ...cutNode(["W1"]), products: [{ id: "p", nodeId: "prepared:wire", kind: "source", ref: { kind: "wire", id: "W1" } }, { id: "p", nodeId: "prepared:wire", kind: "source", ref: { kind: "wire", id: "W1" } }] }] })).toBeNull();
  });
  it("charges one setup for a repeated homogeneous run and one setup for four variants in five slots", () => {
    const base = physicalFixture();
    const source = { ...base, wires: Array.from({ length: 100 }, (_, index) => ({ ...base.wires[0]!, id: `W${index + 1}`, lengthMm: 1000, colorSource: null })) };
    const refs = source.wires.map(wire => wire.id);
    const node = cutNode(refs);
    const products = routeV3Products(node);
    const repeated = routeV3OperationProjectTimes(operation({ outputProductIds: products.map(product => product.id), parallelCapacity: 1 }), node, source, 1);
    expect(repeated.cycles).toBe(100);
    expect(repeated.setupMinutes).toBe(12 / 60);
    const four = cutNode(["W1", "W2", "W3", "W4"]);
    const fourProducts = routeV3Products(four);
    const variants = { ...source, wires: source.wires.map((wire, index) => ({ ...wire, color: index < 4 ? `#00000${index}` : wire.color })) };
    const variantItems = buildRouteSourceItems(variants).slice(0, 4);
    expect(new Set(variantItems.map(item => item.color)).size).toBe(4);
    const parallel = routeV3OperationProjectTimes(operation({ outputProductIds: fourProducts.map(product => product.id), parallelCapacity: 5 }), four, variants, 1);
    expect(parallel.cycles).toBe(1);
    expect(parallel.setupMinutes).toBe(12 / 60);
    const six = cutNode(["W1", "W2", "W3", "W4", "W5", "W6"]);
    const sixVariants = { ...variants, wires: variants.wires.map((wire, index) => ({ ...wire, color: index < 6 ? `#00000${index}` : wire.color })) };
    const changedSet = routeV3OperationProjectTimes(operation({ outputProductIds: routeV3Products(six).map(product => product.id), parallelCapacity: 5 }), six, sixVariants, 1);
    expect(changedSet.cycles).toBe(2);
    expect(changedSet.setupMinutes).toBe(24 / 60);
    const sequential = routeV3OperationProjectTimes(operation({ outputProductIds: routeV3Products(four).map(product => product.id), parallelCapacity: 1 }), four, variants, 1);
    expect(sequential.cycles).toBe(4);
    expect(sequential.setupMinutes).toBe(48 / 60);
  });
});
