import { describe, expect, it } from "vitest";
import {
  getE4BridgeGeometry, getE4DifferentialPairLayouts, getE4ScreenLayout, getE4WireCrossings,
  getVisibleE4SceneOverlays, hitTestE4DifferentialPair, hitTestE4ScreenConnection,
  hitTestE4WireSegment, hitTestWireSegment, parseE4SceneOverlays,
  type E4SceneOverlays,
} from "./CanvasViewport";
import type { EditorPoint, EditorSceneObject } from "./editor-types";

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}

const layers = immutable([
  { id: "top", label: "Верхний", visible: true, locked: true },
  { id: "base", label: "Основной", visible: true, locked: false },
  { id: "hidden", label: "Скрытый", visible: false, locked: false },
]);

function wire(id: string, points: readonly EditorPoint[], layerId = "base"): EditorSceneObject {
  return { id, kind: "wire", layerId, label: id, x: 0, y: 0, width: 0, height: 0, color: "#123456", points, metadata: { view: "e4" } };
}

describe("E4 scene compatibility with the pre-extraction viewport", () => {
  it("retains numeric metadata coercion, defaults and filtering of invalid entries", () => {
    const source = immutable([{ ...wire("source", []), metadata: {
      view: "e4", crossingStyle: "bridge",
      junctions: JSON.stringify([
        { id: "J", position: { x: "10", y: "20" }, wireIds: ["A", "B"] },
        { id: "bad", position: { x: "invalid", y: 20 }, wireIds: ["A"] },
      ]),
      diffPairs: JSON.stringify([
        { id: "D", wireIds: ["A", "B"], step: "24", amplitude: "6", variant: 99 },
        { id: "bad", wireIds: ["A", "B", "C"], step: 24, amplitude: 6 },
      ]),
      screens: JSON.stringify([
        { id: "S", wireIds: ["A", "B"], position: "0.25", width: "20", terminalSide: "invalid" },
        { id: "bad", wireIds: ["A"], position: 2, width: 20 },
      ]),
    } }]);
    expect(parseE4SceneOverlays(source)).toEqual({
      crossingStyle: "bridge",
      junctions: [{ id: "J", position: { x: 10, y: 20 }, wireIds: ["A", "B"] }],
      diffPairs: [{ id: "D", wireIds: ["A", "B"], step: 24, amplitude: 6, variant: 1 }],
      screens: [{ id: "S", wireIds: ["A", "B"], position: 0.25, width: 20, label: "", terminalSide: "above" }],
    });
  });

  it("keeps first metadata precedence and malformed JSON fallbacks", () => {
    const first = { ...wire("first", []), metadata: { view: "e4", crossingStyle: "unknown", junctions: "{broken", diffPairs: "null", screens: "{}" } };
    const second = { ...wire("second", []), metadata: { view: "e4", crossingStyle: "bridge", junctions: '[{"id":"J","position":{"x":0,"y":0},"wireIds":["A"]}]' } };
    expect(parseE4SceneOverlays(immutable([first, second]))).toEqual({ crossingStyle: "none", junctions: [], diffPairs: [], screens: [] });
  });

  it("keeps layer order, lock policy, exclusion and zoom tolerance without mutating routes", () => {
    const points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 60 }, { x: 100, y: 60 }];
    const objects = immutable([wire("base", points), wire("top", points, "top"), wire("hidden", points, "hidden")]);
    expect(hitTestE4WireSegment(objects, layers, { x: 20, y: 30 }, 1)).toMatchObject({ wireId: "base", index: 1 });
    expect(hitTestWireSegment(objects, layers, { x: 20, y: 30 }, 1)).toMatchObject({ wireId: "top", index: 1 });
    expect(hitTestWireSegment(objects, layers, { x: 20, y: 30 }, 1, "top")).toMatchObject({ wireId: "base" });
    expect(hitTestE4WireSegment(objects, layers, { x: 23, y: 30 }, 4)).toBeNull();
    expect(objects.map(object => object.id)).toEqual(["base", "top", "hidden"]);
  });

  it("preserves diagonal crossing direction, bridge geometry and junction suppression", () => {
    const objects = immutable([
      wire("under", [{ x: 0, y: 20 }, { x: 100, y: 20 }]),
      wire("over", [{ x: 0, y: 0 }, { x: 40, y: 40 }], "top"),
    ]);
    const crossings = getE4WireCrossings(objects, layers);
    expect(crossings).toHaveLength(1);
    expect(crossings[0]).toMatchObject({ point: { x: 20, y: 20 }, overWireId: "over", underWireId: "under" });
    expect(crossings[0]!.overDirection?.x).toBeCloseTo(Math.SQRT1_2);
    expect(getE4WireCrossings(objects, layers, [{ id: "J", position: { x: 20, y: 20 }, wireIds: ["under", "over"] }])).toEqual([]);
    expect(getE4BridgeGeometry({ point: { x: 20, y: 20 }, overOrientation: "horizontal" }, 4)).toEqual({
      clearStart: { x: 15, y: 20 }, clearEnd: { x: 25, y: 20 },
      coloredStart: { x: 14, y: 20 }, coloredEnd: { x: 26, y: 20 },
      arcStart: { x: 16, y: 20 }, arcEnd: { x: 24, y: 20 },
    });
  });

  it("retains continuous parallel spans, motif placement and both screen terminals", () => {
    const objects = immutable([
      wire("A", [{ x: 0, y: 10 }, { x: 60, y: 10 }, { x: 180, y: 10 }]),
      wire("B", [{ x: 0, y: 30 }, { x: 180, y: 30 }]),
    ]);
    const pair = { id: "D", wireIds: ["A", "B"] as const, step: 24, amplitude: 6 };
    const screen = { id: "S", wireIds: ["A", "B"], position: 0.5, width: 20, label: "Экран", terminalSide: "both" as const };
    const pairLayouts = getE4DifferentialPairLayouts(pair, objects);
    const screenLayout = getE4ScreenLayout(screen, objects)!;
    // Frozen before extraction on 2d5c1be; do not regenerate to approve a refactor.
    expect({
      pairs: pairLayouts.map(layout => ({ span: layout.span, first: layout.motifs[0], last: layout.motifs.at(-1), count: layout.motifs.length })),
      screen: { center: screenLayout.center, span: screenLayout.span, spans: screenLayout.spans, pathLength: screenLayout.pathLength, terminals: screenLayout.terminals },
    }).toMatchSnapshot();
    for (const terminal of screenLayout.terminals) {
      expect(hitTestE4ScreenConnection([screen], objects, terminal.connectionPoint, 2, layers)).toEqual({ screenId: "S", screenTerminalSide: terminal.side });
    }
    const hiddenLayers = layers.map(layer => ({ ...layer, visible: false }));
    expect(hitTestE4DifferentialPair([pair], objects, { x: 12, y: 20 }, 1, hiddenLayers)).toBeNull();
    expect(hitTestE4ScreenConnection([screen], objects, screenLayout.connectionPoint, 2, hiddenLayers)).toBeNull();
  });

  it("filters overlays by complete visible wire membership without modifying the source", () => {
    const objects = immutable([wire("A", []), wire("B", []), wire("H", [], "hidden")]);
    const overlays: E4SceneOverlays = immutable({
      crossingStyle: "bridge",
      junctions: [{ id: "J", position: { x: 0, y: 0 }, wireIds: ["A", "B"] }, { id: "empty", position: { x: 0, y: 0 }, wireIds: [] }],
      diffPairs: [{ id: "D", wireIds: ["A", "H"], step: 24, amplitude: 6 }],
      screens: [{ id: "S", wireIds: ["missing"], position: 0.5, label: "", width: 20 }],
    });
    expect(getVisibleE4SceneOverlays(overlays, objects, layers)).toEqual({ crossingStyle: "bridge", junctions: [overlays.junctions[0]], diffPairs: [], screens: [] });
    expect(overlays.junctions).toHaveLength(2);
    expect(overlays.diffPairs).toHaveLength(1);
  });
});
