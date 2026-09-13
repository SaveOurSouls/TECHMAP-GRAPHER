import { describe, expect, it } from "vitest";
import { createConnector, createWire, applyEditorCommand } from "./commands";
import {
  designToScene,
  normalizeEditorSelection,
  selectedEditorDeletionCommands,
  snapRoutePoint,
} from "./HarnessDesignEditor";
import { connectorE4TableGeometry, createEmptyHarnessDesign } from "./model";

describe("harness design scene adapter", () => {
  it("removes deleted and duplicate ids from multi-selection and promotes a surviving primary object", () => {
    expect(normalizeEditorSelection(
      ["wire-1", "deleted", "wire-1", "wire-2"],
      "deleted",
      new Set(["wire-1", "wire-2"]),
    )).toEqual({ objectIds: ["wire-1", "wire-2"], primaryObjectId: "wire-2" });
    expect(normalizeEditorSelection(["wire-1"], "connector-1", new Set(["wire-1", "connector-1"]))).toEqual({
      objectIds: ["wire-1", "connector-1"], primaryObjectId: "connector-1",
    });
    expect(normalizeEditorSelection(["deleted"], "deleted", new Set())).toEqual({
      objectIds: [], primaryObjectId: null,
    });
  });

  it("deletes selected wires before selected connectors and ignores stale selection", () => {
    const x1 = createConnector("x1", "X1", 1, { x: 0, y: 0 });
    const x2 = createConnector("x2", "X2", 1, { x: 800, y: 0 });
    let document = applyEditorCommand(createEmptyHarnessDesign(), { type: "add-connector", connector: x1 });
    document = applyEditorCommand(document, { type: "add-connector", connector: x2 });
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" }),
    });
    expect(selectedEditorDeletionCommands(document, ["x1", "w1", "removed"])).toEqual([
      { type: "remove-wire", wireId: "w1" },
      { type: "remove-connector", connectorId: "x1" },
    ]);
  });

  it("renders the same domain instances in E4 and drawing with separate positions", () => {
    const x1 = createConnector("x1", "X1", 2, { x: 10, y: 20 }, { x: 100, y: 120 });
    const x2 = createConnector("x2", "X2", 2, { x: 800, y: 20 }, { x: 500, y: 120 });
    let document = applyEditorCommand(createEmptyHarnessDesign(), { type: "add-connector", connector: x1 });
    document = applyEditorCommand(document, { type: "add-connector", connector: x2 });
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:2" }, 350),
    });

    const e4 = designToScene(document, "e4");
    const drawing = designToScene(document, "drawing");

    expect(e4.find((item) => item.id === "x1")).toMatchObject({ x: 10, y: 20 });
    expect(drawing.find((item) => item.id === "x1")).toMatchObject({ x: 100, y: 120 });
    expect(e4.find((item) => item.id === "w1")?.metadata?.lengthMm).toBe("350");
    expect(drawing.find((item) => item.id === "dimension:w1")?.label).toBe("350 мм");
    expect(drawing.find((item) => item.id === "w1")?.points?.[0]?.x).toBe(218);
    expect(drawing.find((item) => item.id === "dimension:w1")?.points?.[0]?.x).toBe(218);
  });

  it("snaps an added route point to a 15 degree direction", () => {
    const snapped = snapRoutePoint({ x: 0, y: 0 }, { x: 100, y: 23 }, true);
    const angleDegrees = Math.atan2(snapped.y, snapped.x) * 180 / Math.PI;
    expect(angleDegrees).toBeCloseTo(15, 8);
    expect(snapRoutePoint({ x: 0, y: 0 }, { x: 100, y: 23 }, false)).toEqual({ x: 100, y: 23 });
  });

  it("passes the persisted E4 table fields and mirrored geometry to the canvas scene", () => {
    let document = applyEditorCommand(createEmptyHarnessDesign(), {
      type: "add-connector",
      connector: createConnector("x1", "XS1", 2, { x: 10, y: 20 }, undefined, "PHR-7"),
    });
    document = applyEditorCommand(document, {
      type: "update-contact", connectorId: "x1", contactId: "x1:contact:1",
      contactType: "сигнальный", circuit: "CAN-H", terminalArticle: "SHP-002P-0.5T",
      wire: "UL1061 28AWG", color: "красный", secondaryColor: "черный", connectionStatus: "not-connected",
    });
    document = applyEditorCommand(document, { type: "flip-connector-orientation", connectorId: "x1" });
    const connector = document.connectors[0]!;
    const geometry = connectorE4TableGeometry(connector);
    const scene = designToScene(document, "e4");
    const object = scene.find((item) => item.id === "x1")!;
    const rows = JSON.parse(object.metadata!.rows!) as Array<Record<string, unknown>>;

    expect(object).toMatchObject({ x: 10, y: 20, width: geometry.width, height: geometry.height });
    expect(object.metadata).toMatchObject({
      view: "e4", orientation: "left", designation: "XS1", libraryCode: "FREE", partNumber: "PHR-7",
    });
    expect(JSON.parse(object.metadata!.columns!)).toEqual([
      "number", "contactType", "circuit", "terminal", "wire", "color",
    ]);
    expect(rows[0]).toMatchObject({
      number: 1, contactType: "сигнальный", circuit: "CAN-H", terminal: "SHP-002P-0.5T",
      wire: "UL1061 28AWG", color: "красный", secondaryColor: "черный", status: "not-connected",
    });
  });

  it("marks every conflicting connector in the E4 scene and clears the marks after correction", () => {
    let document = createEmptyHarnessDesign();
    document = applyEditorCommand(document, {
      type: "add-connector", connector: createConnector("x1", "X1", 1, { x: 0, y: 0 }),
    });
    document = applyEditorCommand(document, {
      type: "add-connector", connector: createConnector("x2", "X2", 1, { x: 600, y: 0 }),
    });
    document = applyEditorCommand(document, {
      type: "update-connector", connectorId: "x2", designation: "x1",
    });
    const duplicateIds = new Set(["x1", "x2"]);
    expect(designToScene(document, "e4", duplicateIds)
      .filter((object) => object.kind === "connector")
      .map((object) => object.metadata?.diagnostic)).toEqual(["error", "error"]);

    document = applyEditorCommand(document, {
      type: "update-connector", connectorId: "x2", designation: "X2",
    });
    expect(designToScene(document, "e4")
      .filter((object) => object.kind === "connector")
      .map((object) => object.metadata?.diagnostic)).toEqual([undefined, undefined]);
  });
});
