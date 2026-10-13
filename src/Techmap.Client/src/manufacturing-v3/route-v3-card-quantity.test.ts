import { describe, expect, it } from "vitest";
import { routeV3IsCutCard, routeV3ProcessedQuantity } from "./route-v3-card-quantity";
import { routeV3OperationTimes } from "./route-v3-operations";
import type { RouteV3Node } from "./route-v3-model";

const wire = (id: string) => ({ kind: "wire" as const, id });
const card = (refs: RouteV3Node["refs"], kind: RouteV3Node["kind"] = "semiFinished"): RouteV3Node => ({ id: "prepared:wire", kind, title: "Нарезанные провода", refs, fragmentIds: [], x: 0, y: 0 });

describe("Route v3 operation batch quantity", () => {
  it("repeats cutting for each blank in every harness", () => {
    const node = card([wire("w1"), wire("w2"), wire("w3")]);
    expect(routeV3IsCutCard(node)).toBe(true);
    expect(routeV3ProcessedQuantity(node, 5)).toBe(15);
    const operation = { id: "cut", title: "Резка", kind: "running" as const, lengthMm: 1000, speedMmPerMinute: 1, employees: 1, quantity: 1, minutesEach: 0, feedTimeSecondsPerMeter: 12, toolCycleTimeSeconds: 3, toolOperationCount: 2, additionalTimeSeconds: 3 };
    const times = routeV3OperationTimes(operation, routeV3ProcessedQuantity(node, 5));
    expect(times.operationMinutes).toBe(21 / 60);
    expect(times.batchMinutes).toBe(315 / 60);
  });
  it("uses the card batch for an assembly operation", () => {
    const node = card([wire("w1"), wire("w2"), wire("w3")], "assembly");
    expect(routeV3IsCutCard(node)).toBe(false);
    expect(routeV3ProcessedQuantity(node, 5)).toBe(5);
  });
});
