import { describe, expect, it } from "vitest";
import { drawingConnectorIndexLabel, getEditorSceneBounds } from "./canvas-scene-bounds";
import * as viewport from "./CanvasViewport";
import type { E4SceneOverlays } from "./canvas-e4-scene";
import type { EditorSceneObject } from "./editor-types";
import type { CableInstance } from "./model";
import { newTemplateContentV3 } from "../component-library/template-commands-v3";
import { createTemplateContentV5FromEditor } from "../component-library/template-model-v5";
import { createE4ConnectorSeriesTableFromV3 } from "../component-library/e4-connector-series-table";
import type { ComponentTemplateViewInstance } from "./component-template-view-renderer";

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
const layers = immutable([
  { id: "main", label: "Сцена", visible: true, locked: true },
  { id: "hidden", label: "Скрытый", visible: false, locked: false },
]);
function object(id: string, kind: EditorSceneObject["kind"], extra: Partial<EditorSceneObject> = {}): EditorSceneObject {
  return { id, kind, layerId: "main", label: "", x: 10, y: 20, width: 40, height: 30, color: "#123456", ...extra };
}
const wires = immutable([
  object("A", "wire", { points: [{ x: 0, y: 10 }, { x: 180, y: 10 }] }),
  object("B", "wire", { points: [{ x: 0, y: 30 }, { x: 180, y: 30 }] }),
]);

describe("scene bounds compatibility with the pre-extraction viewport", () => {
  it("preserves the existing public viewport exports without exposing the accumulator", () => {
    expect(viewport.getEditorSceneBounds).toBe(getEditorSceneBounds);
    expect(viewport.drawingConnectorIndexLabel).toBe(drawingConnectorIndexLabel);
    expect(viewport).not.toHaveProperty("expandSceneBounds");
  });

  it("keeps empty/hidden scenes empty and visible locked objects in the fit", () => {
    expect(getEditorSceneBounds([], layers, "drawing")).toBeNull();
    expect(getEditorSceneBounds([object("hidden", "connector", { layerId: "hidden" })], layers, "e4")).toBeNull();
    expect(getEditorSceneBounds([object("missing", "specification-item", { layerId: "missing" })], layers, "drawing")).toBeNull();
    expect(getEditorSceneBounds([object("locked", "specification-item", { width: 0, height: -5 })], layers, "drawing"))
      .toEqual({ minX: 10, minY: 20, maxX: 11, maxY: 21 });
  });

  it("keeps trimmed indices outside artwork and beside point-only preparations", () => {
    const bounds = immutable({ minX: -30, minY: 50, maxX: 10, maxY: 110 });
    expect(drawingConnectorIndexLabel(object("X", "connector", { label: "  XS1  " }), bounds))
      .toEqual({ text: "XS1", x: -25, y: 42, minX: -25, minY: 27, maxX: 3, maxY: 45 });
    expect(drawingConnectorIndexLabel(object("X", "connector", { label: " Р1 ", metadata: { terminationPointOnly: "true" } }), bounds))
      .toEqual({ text: "Р1", x: 4, y: 92, minX: 0, minY: 82, maxX: 32, maxY: 102 });
  });

  it.each(["left", "right"] as const)("keeps %s table and materialized primary/secondary contact extents", orientation => {
    const connector = immutable(object("X", "connector", { label: "XS1", metadata: {
      view: "e4", orientation, contactCount: "2", rows: JSON.stringify([
        { number: 1, type: "pin", circuit: "A", terminal: "T", wire: "W", color: "red", status: "available", customValues: {} },
        { number: 2, type: "socket", circuit: "B", terminal: "", wire: "", color: "", status: "not-connected", customValues: {} },
      ]),
    } }));
    const pinned = immutable({ ...connector, metadata: { ...connector.metadata, materializedContactPoints: JSON.stringify([
      null, { x: -80, y: 140, direction: "left", status: "not-connected" },
    ]) } });
    expect({ table: getEditorSceneBounds([connector], layers, "e4"),
      legacyDrawing: getEditorSceneBounds([connector], layers, "drawing"),
      materializedDrawing: getEditorSceneBounds([pinned], layers, "drawing"),
      materializedE4: getEditorSceneBounds([pinned], layers, "e4") }).toMatchSnapshot();
  });

  it("keeps strip outlines and cable sheaths in Drawing bounds while E4 uses its labels", () => {
    const strip = immutable({ ...wires[0]!, stripProfiles: { from: {
      sourceId: "source", snapshotId: "snapshot", snapshotSha256: "a".repeat(64), recordId: "r",
      entityType: "coax-termination" as const, sourceKey: "coax", displayName: "Coax",
      layers: [{ index: 1, diameterMm: 1, stripLengthMm: 4 }, { index: 2, diameterMm: 4, stripLengthMm: 8 }],
    } } });
    const cable: CableInstance = immutable({ id: "C", memberWireIds: ["A", "B"], lengthMm: 250,
      endCorrectionFromMm: 0, endCorrectionToMm: 0, cutRoundingStepMm: 1 });
    const labelled = immutable({ ...wires[0]!, label: "LONG-WIRE-INDEX", metadata: { e4LabelPosition: "invalid" } });
    expect({ strip: getEditorSceneBounds([strip], layers, "drawing"),
      e4Strip: getEditorSceneBounds([strip], layers, "e4"),
      sheath: getEditorSceneBounds(wires, layers, "drawing", undefined, [], undefined, [cable]),
      strippedSheath: getEditorSceneBounds(wires, layers, "drawing", undefined, [], undefined, [{ ...cable, sheathStrip: { fromMm: 100, toMm: 150 } }]),
      e4Label: getEditorSceneBounds([labelled], layers, "e4"),
      e4DefaultLabel: getEditorSceneBounds([{ ...labelled, metadata: undefined }], layers, "e4"),
    }).toMatchSnapshot();
  });

  it("keeps junctions, pair spans, screen terminals and visibility filtering in E4 bounds", () => {
    const overlays: E4SceneOverlays = immutable({ crossingStyle: "bridge",
      junctions: [{ id: "J", wireIds: ["A", "B"], position: { x: 250, y: -100 } }],
      diffPairs: [{ id: "D", wireIds: ["A", "B"], step: 24, amplitude: 40 }],
      screens: [{ id: "S", wireIds: ["A", "B"], position: 0.5, width: 100, label: "Экран", terminalSide: "both" }],
    });
    expect({ junction: getEditorSceneBounds(wires, layers, "e4", { ...overlays, diffPairs: [], screens: [] }),
      pair: getEditorSceneBounds(wires, layers, "e4", { ...overlays, junctions: [], screens: [] }),
      screen: getEditorSceneBounds(wires, layers, "e4", { ...overlays, junctions: [], diffPairs: [] }),
      hiddenMember: getEditorSceneBounds([wires[0]!, { ...wires[1]!, layerId: "hidden" }], layers, "e4", overlays),
      drawingIgnoresOverlays: getEditorSceneBounds(wires, layers, "drawing", overlays),
    }).toMatchSnapshot();
  });

  it("keeps rotated termination labels, badges and explicit-index suppression", () => {
    const connector = immutable(object("T", "connector", { label: "  НКИ-1  ", metadata: {
      terminationSymbol: "test-symbol", terminationRotation: "90", terminationScale: "2", terminationBadge: "badge",
      terminationLocalBounds: "[20,10,200,90]", materializedContactPoints: JSON.stringify([{ x: -90, y: 84, direction: "left", status: "available" }]),
    } }));
    const index = immutable(object("index", "object-index", { layerId: "hidden", metadata: { indexObjectId: "T" } }));
    const pointOnly = immutable({ ...connector, metadata: { ...connector.metadata, terminationPointOnly: "true" } });
    expect({ drawing: getEditorSceneBounds([connector], layers, "drawing"), e4: getEditorSceneBounds([connector], layers, "e4"),
      explicitHiddenIndex: getEditorSceneBounds([connector, index], layers, "drawing"),
      pointOnly: getEditorSceneBounds([pointOnly], layers, "drawing"),
    }).toMatchSnapshot();
  });

  it("keeps rotated library artwork, Drawing contact-side view and E4 companion extents", () => {
    const variant = { id: "00000000-0000-4000-8000-000000000001", sourceId: "test", entityType: "connector", articleKey: "X", parameterValues: [], contactGroups: null };
    const content = { ...newTemplateContentV3(), articleVariants: [variant] };
    const layer = content.views[1]!.layers[0]!;
    const constant = (value: number) => ({ kind: "constant", value } as const);
    layer.nodes = [{ id: "00000000-0000-4000-8000-000000000002", kind: "rectangle", layerId: layer.id, visible: true, locked: false, opacity: 1,
      transform: { translateX: constant(0), translateY: constant(0), rotationDegrees: constant(0), scaleX: constant(1), scaleY: constant(1) },
      stroke: { color: "#000000", width: constant(2) }, fill: { color: null },
      geometry: { x: constant(3), y: constant(4), width: constant(12), height: constant(8), cornerRadii: [constant(0), constant(0), constant(0), constant(0)] },
    }];
    const v5 = createTemplateContentV5FromEditor(content, createE4ConnectorSeriesTableFromV3(content), []).content;
    const instance: ComponentTemplateViewInstance = immutable({ objectId: "X", snapshotId: "snapshot", articleVariantId: variant.id, content: v5,
      drawingPlacements: [{ drawingId: "view:drawing", visible: true, offset: { x: 50, y: -200 }, rotationDegrees: 90, scale: 2 },
        { drawingId: "view:contact-side", visible: true, offset: { x: 220, y: 40 }, scale: 1 }],
    });
    const connector = immutable(object("X", "connector", { label: "XS1" }));
    expect({ drawing: getEditorSceneBounds([connector], layers, "drawing", undefined, [instance]),
      e4: getEditorSceneBounds([connector], layers, "e4", undefined, [instance]),
      hiddenCompanions: getEditorSceneBounds([connector], layers, "drawing", undefined, [{ ...instance,
        drawingPlacements: instance.drawingPlacements!.map(placement => ({ ...placement, visible: false })),
      }]),
    }).toMatchSnapshot();
  });
});
