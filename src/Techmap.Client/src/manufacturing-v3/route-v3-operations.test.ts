import { describe, expect, it } from "vitest";
import { physicalFixture } from "../editor/physical-topology-fixture";
import type { ReferenceCatalogRecord, ReferenceCatalogSnapshot } from "../reference-catalog-api";
import { routeV3CatalogGroups, routeV3GroupedSourceQuantity, routeV3OperationFromCatalog, routeV3OperationTimes, routeV3SourceGroupKey } from "./route-v3-operations";

const snapshot = { sourceId: "technology-operations", snapshotId: "snapshot", sha256: "a".repeat(64) } as ReferenceCatalogSnapshot;
const record = (type: string, payload: Record<string, unknown>): ReferenceCatalogRecord => ({ recordId: "record", entityType: "operation", sourceKey: "007", sourceLocation: null, payload: { name: "Резка", operationType: type, ...payload } });
const norm = { feedTimeSecondsPerMeter: 4, toolCycleTimeSeconds: 3, toolOperationCount: 2, additionalTimeSeconds: 5, manualWorkTimeSeconds: 7, manualTakeTimeSeconds: 2, manualRemoveTimeSeconds: 1 };

describe("Route v3 БД.ОП time and quantity contract", () => {
  it("keeps the operation name as the title and the catalog type separately", () => {
    const operation = routeV3OperationFromCatalog(record("Погонный", norm), snapshot, "op");
    expect(operation.title).toBe("Резка");
    expect(operation.catalogOperationType).toBe("Погонный");
    expect(operation.category).toBe("Резка");
    expect(operation.subcategory).toBe("007");
    expect(operation.catalogBinding?.displayName).toBe("Резка · № 007");
  });
  it("groups the first level by Название and the second by Номер, not by type", () => {
    const entries = [
      { ...record("Погонный", norm), recordId: "a", sourceKey: "10", payload: { name: "Резка", operationType: "Погонный" } },
      { ...record("Статичный", norm), recordId: "b", sourceKey: "2", payload: { name: "Резка", operationType: "Статичный" } },
      { ...record("Погонный", norm), recordId: "c", sourceKey: "3", payload: { name: "Обжим", operationType: "Погонный" } },
    ];
    const groups = routeV3CatalogGroups(entries);
    expect(groups.map(group => group.name)).toEqual(["Обжим", "Резка"]);
    expect(groups.find(group => group.name === "Резка")?.records.map(entry => entry.sourceKey)).toEqual(["2", "10"]);
    expect(groups.find(group => group.name === "Резка")?.records.map(entry => entry.recordId)).toEqual(["b", "a"]);
  });
  it("pins the catalog snapshot and calculates a running operation in seconds per metre", () => {
    const operation = { ...routeV3OperationFromCatalog(record("Погонный", norm), snapshot, "op"), lengthMm: 2500 };
    expect(operation.catalogBinding).toMatchObject({ sourceId: "technology-operations", snapshotId: "snapshot", recordId: "record", sourceKey: "007" });
    expect(routeV3OperationTimes(operation, 8)).toEqual({ machineMinutes: 21 / 60, humanMinutes: 10 / 60, operationMinutes: 21 / 60, batchMinutes: 168 / 60 });
  });
  it("uses manual plus extra for static operations and keeps unknown norms unknown", () => {
    const operation = routeV3OperationFromCatalog(record("Статичный", norm), snapshot, "op");
    expect(routeV3OperationTimes(operation, 3)).toEqual({ machineMinutes: 11 / 60, humanMinutes: 10 / 60, operationMinutes: 15 / 60, batchMinutes: 45 / 60 });
    const incomplete = routeV3OperationFromCatalog(record("Статичный", { ...norm, manualWorkTimeSeconds: null }), snapshot, "op2");
    expect(routeV3OperationTimes(incomplete, 3).operationMinutes).toBeNull();
    expect(routeV3OperationTimes(incomplete, 3).batchMinutes).toBeNull();
  });
  it("does not invent a formula for variable operations", () => {
    const operation = routeV3OperationFromCatalog(record("Переменный", norm), snapshot, "op");
    expect(routeV3OperationTimes(operation, 3)).toEqual({ machineMinutes: null, humanMinutes: null, operationMinutes: null, batchMinutes: null });
  });
  it("aggregates identical physical wires for the whole harness batch", () => {
    const source = physicalFixture();
    const refs = source.wires.map(wire => ({ kind: "wire" as const, id: wire.id }));
    expect(routeV3SourceGroupKey(refs[0]!, source)).toBe(routeV3SourceGroupKey(refs[1]!, source));
    expect(routeV3GroupedSourceQuantity(refs[0]!, refs, source, 5)).toEqual({ perSemiFinished: 3, perBatch: 15 });
  });
});
