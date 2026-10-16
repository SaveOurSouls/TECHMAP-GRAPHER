import { describe, expect, it } from "vitest";
import {
  coveringDragBlockedByPhysicalNode, getVisibleCableSheathScene, hitTestCableSheath,
  hitTestEditorScene, hitTestWireEnd, hitTestWireRoutePoint,
  numberedPipeBendHandles, pipeMidpoints,
} from "./canvas-scene-hit-test";
import * as hitTesting from "./canvas-scene-hit-test";
import * as viewport from "./CanvasViewport";
import { hitTestConnectorContact } from "./canvas-connector-layout";
import type { EditorSceneObject } from "./editor-types";
import type { CableInstance } from "./model";

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}
const layers = immutable([{ id: "main", label: "Сцена", visible: true, locked: false }]);
const point = { x: 10, y: 10 };
function object(id: string, kind: EditorSceneObject["kind"], extra: Partial<EditorSceneObject> = {}): EditorSceneObject {
  return { id, kind, layerId: "main", label: id, x: 0, y: 0, width: 40, height: 40, color: "#123456", ...extra };
}

describe("scene hit-test compatibility with the pre-extraction viewport", () => {
  it("keeps the existing viewport exports bound to the extracted implementations", () => {
    const names = ["getDrawingWireStripProfileGeometries", "hitTestWireRoutePoint", "numberedPipeBendHandles",
      "pipeMidpoints", "e4Midpoints", "hitTestWireEnd", "getVisibleCableSheathScene", "hitTestCableSheath",
      "hitTestEditorScene", "coveringDragBlockedByPhysicalNode"] as const;
    for (const name of names) expect(viewport[name]).toBe(hitTesting[name]);
    expect(viewport).not.toHaveProperty("containsPoint");
    expect(viewport).not.toHaveProperty("pointToSegmentDistance");
  });

  it("preserves the drawing priority of indices, nodes, coverings, pipes and wires", () => {
    const path = [{ x: 0, y: 10 }, { x: 40, y: 10 }];
    const objects = immutable([
      object("wire", "wire", { points: path }),
      object("pipe", "physical-segment", { points: path, width: 8 }),
      object("cover", "physical-covering", { points: path, width: 12 }),
      object("node", "physical-node"),
      object("index", "object-index", { layerId: "legacy-index-layer" }),
    ]);
    expect([0, 1, 2, 3, 4].map(removed =>
      hitTestEditorScene(objects.slice(0, objects.length - removed), layers, point, 1, "drawing")))
      .toEqual(["index", "node", "cover", "pipe", "wire"]);
  });

  it.each([[true, false], [true, true], [false, false], [false, true]])(
    "keeps selection and covering-drag policy with visible=%s locked=%s", (visible, locked) => {
      const objects = immutable([object("node", "physical-node")]);
      const currentLayers = immutable([{ ...layers[0]!, visible: visible!, locked: locked! }]);
      expect(hitTestEditorScene(objects, currentLayers, point, 1, "drawing")).toBe(visible ? "node" : null);
      expect(coveringDragBlockedByPhysicalNode(objects, currentLayers, point, 1, "drawing")).toBe(visible && !locked);
    },
  );

  it("selects painted drawing wire strokes rather than the hidden physical route", () => {
    const objects = immutable([object("wire", "wire", {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      visibleWireStrokes: [{ points: [{ x: 0, y: 40 }, { x: 100, y: 40 }], width: 4 }],
    })]);
    expect(hitTestEditorScene(objects, layers, { x: 50, y: 40 }, 1, "drawing")).toBe("wire");
    expect(hitTestEditorScene(objects, layers, { x: 50, y: 0 }, 1, "drawing")).toBeNull();
    expect(hitTestEditorScene(objects, layers, { x: 50, y: 0 }, 1, "e4")).toBe("wire");
    expect(hitTestEditorScene(objects, layers, { x: 50, y: 44 }, 1, "drawing")).toBe("wire");
    expect(hitTestEditorScene(objects, layers, { x: 50, y: 45 }, 1, "drawing")).toBeNull();
    expect(hitTestEditorScene(objects, layers, { x: 50, y: 43 }, 10, "drawing")).toBeNull();
  });

  it("preserves endpoint tolerance, bend tie-breaking and physical-route protection", () => {
    const wire = immutable(object("wire", "wire", { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 0 }, { x: 100, y: 0 }] }));
    expect(hitTestWireEnd(wire, { x: 0, y: 0 }, 1)).toBe("from");
    expect(hitTestWireEnd(wire, { x: 100, y: 0 }, 1)).toBe("to");
    expect(hitTestWireEnd(wire, { x: 6, y: 0 }, 2)).toBeNull();
    expect(hitTestWireRoutePoint(wire, { x: 20, y: 0 }, 1)).toBe(1);
    expect(hitTestWireRoutePoint(wire, { x: 0, y: 0 }, 1)).toBeNull();
    expect(hitTestWireRoutePoint({ ...wire, metadata: { physicalRoute: "true" } }, { x: 20, y: 0 }, 1)).toBeNull();
  });

  it("keeps controlled pipe handles excluded and transition midpoints available", () => {
    const pipe = immutable(object("pipe", "physical-segment", {
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      pipe: { role: "pipe", controls: [], wireIds: [], handles: [{ x: 20, y: 0 }, { x: 50, y: 0 }, { x: 80, y: 0 }],
        controlledHandles: [1], controlledMidpoints: [1],
        midpoints: [{ x: 10, y: 0 }, { x: 35, y: 0 }, { x: 65, y: 0 }, { x: 90, y: 0 }],
        joiningTransitionMidpoints: [{ index: 2, memberIndex: 0, side: "exit" }],
      },
    }));
    expect(numberedPipeBendHandles(pipe)).toEqual([0, 2]);
    expect(pipeMidpoints(pipe)).toEqual([{ index: 2, point: { x: 65, y: 0 } }]);
    expect(hitTestWireRoutePoint(pipe, { x: 50, y: 0 }, 1)).toBeNull();
    expect(hitTestWireRoutePoint(pipe, { x: 80, y: 0 }, 1)).toBe(2);
  });

  it("keeps sheath edge selection, reverse order, invalid zoom and hidden-member filtering", () => {
    const cable: CableInstance = immutable({ id: "C1", memberWireIds: ["A", "B"], lengthMm: 250, endCorrectionFromMm: 0, endCorrectionToMm: 0, cutRoundingStepMm: 1 });
    const objects = immutable([
      object("A", "wire", { points: [{ x: 20, y: 20 }, { x: 120, y: 20 }] }),
      object("B", "wire", { points: [{ x: 30, y: 30 }, { x: 110, y: 30 }] }),
    ]);
    const allLayers = immutable([...layers, { id: "other", label: "Второй", visible: true, locked: false }]);
    const scene = getVisibleCableSheathScene([cable], objects, allLayers);
    expect(scene.incompatibleCableIds).toEqual([]);
    expect(scene.geometries).toHaveLength(1);
    const geometries = immutable([scene.geometries[0]!, { ...scene.geometries[0]!, cableId: "C2" }]);
    expect(hitTestCableSheath(geometries, { x: 60, y: 14 }, Number.NaN)?.cableId).toBe("C2");
    expect(hitTestCableSheath(geometries, { x: 60, y: 14 }, 0)?.cableId).toBe("C2");
    expect(hitTestCableSheath(geometries, { x: 60, y: 25 }, 1)).toBeNull();
    const differentLayers = immutable(objects.map((item, index) => index === 1 ? { ...item, layerId: "other" } : item));
    expect(getVisibleCableSheathScene([cable], differentLayers, allLayers)).toEqual({ geometries: [], incompatibleCableIds: ["C1"] });
    expect(getVisibleCableSheathScene([cable], differentLayers, allLayers.map(layer => ({ ...layer, visible: layer.id !== "other" })))).toEqual({ geometries: [], incompatibleCableIds: [] });
    expect(getVisibleCableSheathScene([{ ...cable, sheathStrip: { fromMm: 100, toMm: 150 } }], objects, allLayers)).toEqual({ geometries: [], incompatibleCableIds: [] });
  });

  it("keeps materialized contacts selectable above overlapping wire artwork", () => {
    const connector = object("X", "connector", { width: 100, height: 100, metadata: {
      materializedContactPoints: JSON.stringify([null, { x: 120, y: 20, direction: "right", status: "available" }]),
    } });
    const objects = immutable([connector, object("wire", "wire", { points: [{ x: 110, y: 20 }, { x: 150, y: 20 }] })]);
    expect(hitTestEditorScene(objects, layers, { x: 120, y: 20 }, 1, "drawing")).toBe("X");
    expect(hitTestConnectorContact(objects, layers, { x: 120, y: 20 }, 1, "drawing")).toEqual({ connectorId: "X", contactIndex: 1 });
  });
});
