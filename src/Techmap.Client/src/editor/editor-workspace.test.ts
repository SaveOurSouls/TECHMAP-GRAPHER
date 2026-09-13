import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  buildE4OrthogonalRoute,
  e4ContactMarker,
  e4WireSegments,
  findE4CommonParallelSpan,
  getE4DifferentialPairLayout,
  getE4ScreenLayout,
  getVisibleE4SceneOverlays,
  getE4ConnectorLayout,
  getE4WireCrossings,
  getE4WireRoute,
  hitTestE4Screen,
  hitTestE4WireSegment,
  hitTestConnectorContact,
  hitTestEditorScene,
  hitTestWireSegment,
  hitTestWireEnd,
  hitTestWireRoutePoint,
  moveE4OrthogonalSegment,
  objectsInPaintOrder,
  parseE4SceneOverlays,
  projectPointToOrthogonalSegment,
} from "./CanvasViewport";
import { panEditorCamera, screenToWorld, worldToScreen, zoomEditorCameraAt } from "./editor-camera";
import { moveLayer, toggleLayerLock, toggleLayerVisibility, updateEditorObject } from "./editor-state";
import type { EditorLayer, EditorSceneObject } from "./editor-types";
import { HarnessEditorWorkspace, reconcileWorkspaceSelection } from "./HarnessEditorWorkspace";

const layers: readonly EditorLayer[] = [
  { id: "top", label: "Верхний", visible: true, locked: false },
  { id: "bottom", label: "Нижний", visible: true, locked: false },
];

const objects: readonly EditorSceneObject[] = [
  { id: "lower", layerId: "bottom", kind: "connector", label: "XS2", x: 10, y: 10, width: 50, height: 40, color: "#222222" },
  { id: "upper", layerId: "top", kind: "connector", label: "XS1", x: 10, y: 10, width: 50, height: 40, color: "#111111" },
  { id: "wire", layerId: "bottom", kind: "wire", label: "W1", x: 0, y: 0, width: 0, height: 0, color: "#cc0000", points: [{ x: 100, y: 100 }, { x: 180, y: 100 }] },
];

describe("harness editor workspace", () => {
  it("reconciles controlled and local multi-selection after scene objects disappear", () => {
    expect(reconcileWorkspaceSelection(
      ["wire", "removed", "wire"],
      "removed",
      objects,
    )).toEqual({ objectIds: ["wire"], primaryObjectId: "wire" });
    expect(reconcileWorkspaceSelection([], "upper", objects)).toEqual({
      objectIds: ["upper"], primaryObjectId: "upper",
    });
    expect(reconcileWorkspaceSelection(["dimension:wire"], "dimension:wire", [{
      id: "dimension:wire", layerId: "top", kind: "dimension", label: "100 мм",
      x: 0, y: 0, width: 0, height: 0, color: "#000", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    }])).toEqual({ objectIds: [], primaryObjectId: null });
  });

  it("renders a complete two-view editor shell with real controls", () => {
    const markup = renderToStaticMarkup(createElement(HarnessEditorWorkspace, {
      harnessId: "harness-a",
      harnessDesignation: "ЖГ-01",
      objects,
      layers,
      selectedObjectId: "upper",
      onObjectsChange: vi.fn(),
      onLayersChange: vi.fn(),
    }));

    expect(markup).toContain("Редактор жгута ЖГ-01");
    expect(markup).toContain("Схема Э4");
    expect(markup).toContain("Чертёж");
    expect(markup).toContain("Инструменты редактора");
    expect(markup).toContain("Поле схемы Э4");
    expect(markup).toContain("Свойства");
    expect(markup).toContain("Слои");
    expect(markup).toContain("Объекты и материалы");
    expect(markup).toContain("Артикул, название или характеристика");
    expect(markup).toContain("Соединители");
    expect(markup).toContain("XS-04");
    expect(markup).toContain("XS-10");
    expect(markup).not.toContain("Размер, клавиша D");
  });

  it("renders server-backed catalog navigation, loading state and pagination action", () => {
    const markup = renderToStaticMarkup(createElement(HarnessEditorWorkspace, {
      harnessId: "harness-a",
      harnessDesignation: "ЖГ-01",
      objects,
      layers,
      catalogSources: [
        { id: "terminals", label: "Терминалы", description: "БД.ТЕР" },
        { id: "cables", label: "Кабели", description: "СПР.КАБ" },
      ],
      selectedCatalogSourceId: "terminals",
      catalogQuery: "M39029",
      catalogLoadState: "ready",
      catalogHasMore: true,
      catalogItems: [{
        id: "reference:terminals:1",
        title: "M39029/57-354",
        subtitle: "Сигнальный контакт · 0,35–0,5 мм²",
        category: "Терминалы",
        accent: "#8a6635",
        placement: "reference-only",
      }],
    }));

    expect(markup).toContain("Терминалы");
    expect(markup).toContain("Кабели");
    expect(markup).toContain('value="M39029"');
    expect(markup).toContain("M39029/57-354");
    expect(markup).toContain("0,35–0,5 мм²");
    expect(markup).toContain("Показать ещё");
    expect(markup).toContain('draggable="false"');
  });

  it("keeps the world point under the cursor while zooming and reverses transforms", () => {
    const camera = { offsetX: 40, offsetY: -20, zoom: 1.25 };
    const anchor = { x: 315, y: 220 };
    const worldBefore = screenToWorld(camera, anchor);
    const zoomed = zoomEditorCameraAt(camera, anchor, 2.5);
    const worldAfter = screenToWorld(zoomed, anchor);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 10);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 10);
    expect(worldToScreen(zoomed, worldAfter)).toEqual(anchor);
    expect(panEditorCamera(camera, 12, -7)).toEqual({ offsetX: 52, offsetY: -27, zoom: 1.25 });
  });

  it("honors visual layer order, visibility and polyline selection", () => {
    expect(objectsInPaintOrder(objects, layers).map((object) => object.id)).toEqual(["lower", "wire", "upper"]);
    expect(hitTestEditorScene(objects, layers, { x: 20, y: 20 }, 1)).toBe("upper");

    const hiddenTop = toggleLayerVisibility(layers, "top");
    expect(hitTestEditorScene(objects, hiddenTop, { x: 20, y: 20 }, 1)).toBe("lower");
    expect(hitTestEditorScene(objects, hiddenTop, { x: 140, y: 104 }, 1)).toBe("wire");

    const reordered = moveLayer(layers, "bottom", 0);
    expect(hitTestEditorScene(objects, reordered, { x: 20, y: 20 }, 1)).toBe("lower");
  });

  it("finds a numbered connector contact for the wire tool", () => {
    const connector: EditorSceneObject = {
      id: "X1", layerId: "top", kind: "connector", label: "X1",
      x: 100, y: 100, width: 118, height: 132, color: "#123456",
      metadata: { contactCount: "4" },
    };
    expect(hitTestConnectorContact([connector], layers, { x: 218, y: 150 }, 1)).toEqual({
      connectorId: "X1",
      contactIndex: 1,
    });
  });

  it("builds mirrored E4 connector tables and exposes only the number-column outer contact edge", () => {
    const rows = JSON.stringify([
      { number: 1, contactType: "S", circuit: "PWR", terminal: "M39029", wire: "МС 0,5", color: "красный", status: "available", customValues: { note: "A" } },
      { number: 2, contactType: "S", circuit: "GND", terminal: "M39029", wire: "МС 0,5", color: "чёрный", status: "not-connected", customValues: { note: "B" } },
    ]);
    const right: EditorSceneObject = {
      id: "X-right", layerId: "top", kind: "connector", label: "X1",
      x: 100, y: 80, width: 118, height: 72, color: "#123456",
      metadata: {
        view: "e4", orientation: "right", designation: "X1", partNumber: "D-SUB-9",
        columns: JSON.stringify(["color", "wire", "terminal", "circuit", "contactType", "number"]),
        rows,
      },
    };
    const left: EditorSceneObject = {
      ...right,
      id: "X-left",
      x: 800,
      metadata: {
        ...right.metadata,
        orientation: "left",
        columns: JSON.stringify(["number", "contactType", "circuit", "terminal", "wire", "color"]),
      },
    };
    const rightLayout = getE4ConnectorLayout(right)!;
    const leftLayout = getE4ConnectorLayout(left)!;

    expect(rightLayout.columns.map((column) => column.id)).toEqual(["color", "wire", "terminal", "circuit", "contactType", "number"]);
    expect(leftLayout.columns.map((column) => column.id)).toEqual(["number", "contactType", "circuit", "terminal", "wire", "color"]);
    expect(rightLayout.width).toBeGreaterThan(right.width);
    expect(rightLayout.height).toBe(124);
    expect(rightLayout.contactPoints[0]).toEqual({ x: right.x + rightLayout.width, y: 144 });
    expect(leftLayout.contactPoints[0]).toEqual({ x: left.x, y: 144 });

    expect(hitTestConnectorContact([right], layers, rightLayout.contactPoints[0]!, 1, "e4")).toEqual({ connectorId: "X-right", contactIndex: 0 });
    expect(hitTestConnectorContact([right], layers, rightLayout.contactPoints[1]!, 1, "e4")).toBeNull();
    expect(hitTestConnectorContact([left], layers, leftLayout.contactPoints[0]!, 1, "e4")).toEqual({ connectorId: "X-left", contactIndex: 0 });
    const rightNumber = rightLayout.columns.at(-1)!;
    expect(hitTestConnectorContact([right], layers, { x: rightNumber.x, y: rightLayout.contactPoints[0]!.y }, 1, "e4")).toBeNull();
    expect(hitTestConnectorContact([left], layers, { x: left.x + leftLayout.width, y: leftLayout.contactPoints[0]!.y }, 1, "e4")).toBeNull();
    expect(e4ContactMarker("available")).toBe("");
    expect(e4ContactMarker("not-connected")).toBe("--X");
  });

  it("supports hidden and custom E4 columns while preserving Drawing connector fallback", () => {
    const connector: EditorSceneObject = {
      id: "X-custom", layerId: "top", kind: "connector", label: "X3",
      x: 50, y: 60, width: 118, height: 100, color: "#123456",
      metadata: {
        view: "e4", orientation: "right", contactCount: "2",
        columns: JSON.stringify(["circuit", "custom:note"]),
        columnLabels: JSON.stringify({ "custom:note": "Примечание" }),
        rows: JSON.stringify([
          { number: 1, contactType: "", circuit: "A1", terminal: "", wire: "", color: "", status: "available", customValues: { note: "Экран" } },
          { number: 2, contactType: "", circuit: "A2", terminal: "", wire: "", color: "", status: "available", customValues: { note: "Резерв" } },
        ]),
      },
    };
    const layout = getE4ConnectorLayout(connector)!;
    expect(layout.columns.map((column) => [column.id, column.label])).toEqual([
      ["circuit", "Цепь"],
      ["custom:note", "Примечание"],
    ]);
    expect(layout.contactPoints[0]!.x).toBe(connector.x + layout.width);
    const drawingContact = { x: connector.x, y: connector.y + 28 };
    expect(hitTestConnectorContact([connector], layers, drawingContact, 1, "drawing")).toEqual({ connectorId: "X-custom", contactIndex: 0 });
    expect(hitTestConnectorContact([connector], layers, { ...drawingContact, x: connector.x + connector.width }, 1, "drawing")).toEqual({ connectorId: "X-custom", contactIndex: 0 });
  });

  it("finds editable route points and wire ends without treating ends as route points", () => {
    const routedWire: EditorSceneObject = {
      id: "W1", layerId: "bottom", kind: "wire", label: "W1",
      x: 0, y: 0, width: 0, height: 0, color: "#222222",
      points: [{ x: 10, y: 20 }, { x: 100, y: 80 }, { x: 180, y: 20 }],
    };
    expect(hitTestWireRoutePoint(routedWire, { x: 104, y: 84 }, 1)).toBe(0);
    expect(hitTestWireRoutePoint(routedWire, { x: 10, y: 20 }, 1)).toBeNull();
    expect(hitTestWireEnd(routedWire, { x: 12, y: 22 }, 1)).toBe("from");
    expect(hitTestWireEnd(routedWire, { x: 181, y: 21 }, 1)).toBe("to");
  });

  it("creates straight E4 leads and orthogonal elbows while preserving a complete model route", () => {
    expect(buildE4OrthogonalRoute([{ x: 0, y: 10 }, { x: 100, y: 60 }])).toEqual([
      { x: 0, y: 10 },
      { x: 24, y: 10 },
      { x: 76, y: 10 },
      { x: 76, y: 60 },
      { x: 100, y: 60 },
    ]);
    const complete: EditorSceneObject = {
      id: "complete", layerId: "top", kind: "wire", label: "W1",
      x: 0, y: 0, width: 0, height: 0, color: "#222222",
      points: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 60 }, { x: 100, y: 60 }],
      metadata: { view: "e4", fromSide: "right", toSide: "left", leadLength: "24" },
    };
    expect(getE4WireRoute(complete)).toBe(complete.points);
    expect(e4WireSegments(complete.points!).map((segment) => segment.orientation)).toEqual([
      "horizontal", "vertical", "horizontal",
    ]);
  });

  it("projects, finds and moves an internal E4 segment without moving endpoints", () => {
    const points = [
      { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 50 },
      { x: 76, y: 50 }, { x: 76, y: 0 }, { x: 100, y: 0 },
    ];
    const wire: EditorSceneObject = {
      id: "route", layerId: "top", kind: "wire", label: "W1",
      x: 0, y: 0, width: 0, height: 0, color: "#222222", points,
      metadata: { view: "e4" },
    };
    expect(projectPointToOrthogonalSegment({ x: 45, y: 54 }, points[2]!, points[3]!)).toEqual({
      point: { x: 45, y: 50 }, distance: 4, position: 21 / 52, orientation: "horizontal",
    });
    expect(hitTestE4WireSegment([wire], layers, { x: 50, y: 54 }, 1)).toMatchObject({
      wireId: "route", index: 2, orientation: "horizontal", point: { x: 50, y: 50 },
    });
    expect(hitTestWireSegment([wire], layers, { x: 10, y: 3 }, 1)).toMatchObject({ wireId: "route", index: 0 });
    expect(moveE4OrthogonalSegment(points, 2, 70)).toEqual([
      { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 70 },
      { x: 76, y: 70 }, { x: 76, y: 0 }, { x: 100, y: 0 },
    ]);
  });

  it("finds crossings, omits explicit junctions and derives a movable screen on a common span", () => {
    const wires: readonly EditorSceneObject[] = [
      { id: "h1", layerId: "bottom", kind: "wire", label: "W1", x: 0, y: 0, width: 0, height: 0, color: "#c00", points: [{ x: 0, y: 40 }, { x: 120, y: 40 }], metadata: { view: "e4" } },
      { id: "h2", layerId: "bottom", kind: "wire", label: "W2", x: 0, y: 0, width: 0, height: 0, color: "#00c", points: [{ x: 20, y: 60 }, { x: 100, y: 60 }], metadata: { view: "e4" } },
      { id: "v", layerId: "top", kind: "wire", label: "W3", x: 0, y: 0, width: 0, height: 0, color: "#090", points: [{ x: 70, y: 0 }, { x: 70, y: 100 }], metadata: { view: "e4" } },
    ];
    expect(getE4WireCrossings(wires, layers).map((item) => item.point)).toEqual([
      { x: 70, y: 40 }, { x: 70, y: 60 },
    ]);
    expect(getE4WireCrossings(wires, layers, [{ id: "j1", position: { x: 70, y: 40 }, wireIds: ["h1", "v"] }])).toHaveLength(1);
    const span = findE4CommonParallelSpan(wires, ["h1", "h2"]);
    expect(span).toMatchObject({ orientation: "horizontal", start: 20, end: 100, crossMinimum: 40, crossMaximum: 60 });
    const screen = { id: "s1", wireIds: ["h1", "h2"], position: 0.25, label: "Экран", width: 18 };
    expect(getE4ScreenLayout(screen, wires)).toMatchObject({ center: { x: 40, y: 50 }, orientation: "horizontal" });
    expect(hitTestE4Screen([screen], wires, { x: 40, y: 50 }, 1)?.id).toBe("s1");
    expect(hitTestE4Screen([screen], wires, { x: 48, y: 68 }, 1_000)).toBeNull();
    expect(getE4DifferentialPairLayout({
      id: "dp", wireIds: ["h1", "h2"], step: 25, amplitude: 6, variant: 2,
    }, wires)).toMatchObject({ variant: 2, crossMinimum: 40, crossMaximum: 60 });
    expect(getE4DifferentialPairLayout({
      id: "dp-overlap", wireIds: ["h1", "h1"], step: 25, amplitude: 6, variant: 1,
    }, wires)).toMatchObject({ crossMinimum: 34, crossMaximum: 46 });
  });

  it("reports one bridge at a polyline vertex and only suppresses a junction for its own wires", () => {
    const crossingWires: readonly EditorSceneObject[] = [
      {
        id: "under", layerId: "bottom", kind: "wire", label: "W1",
        x: 0, y: 0, width: 0, height: 0, color: "#c00",
        points: [{ x: 0, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 90 }], metadata: { view: "e4" },
      },
      {
        id: "over", layerId: "top", kind: "wire", label: "W2",
        x: 0, y: 0, width: 0, height: 0, color: "#00c",
        points: [{ x: 70, y: 0 }, { x: 70, y: 40 }, { x: 120, y: 40 }], metadata: { view: "e4" },
      },
    ];
    expect(getE4WireCrossings(crossingWires, layers)).toEqual([{
      point: { x: 70, y: 40 }, overWireId: "over", underWireId: "under", overOrientation: "vertical",
    }]);
    expect(getE4WireCrossings(crossingWires, layers, [{
      id: "own", position: { x: 70, y: 40 }, wireIds: ["under", "over"],
    }])).toEqual([]);
    expect(getE4WireCrossings(crossingWires, layers, [{
      id: "other", position: { x: 70, y: 40 }, wireIds: ["third", "fourth"],
    }])).toEqual([]);
  });

  it("finds a common span in polynomial time for a large routed bundle", () => {
    const bundle = Array.from({ length: 20 }, (_, wireIndex): EditorSceneObject => ({
      id: `bundle-${wireIndex}`,
      layerId: "top",
      kind: "wire",
      label: `W${wireIndex + 1}`,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      color: "#222222",
      points: [
        { x: 0, y: wireIndex * 8 }, { x: 100, y: wireIndex * 8 },
        { x: 100, y: 300 + wireIndex * 8 }, { x: 220, y: 300 + wireIndex * 8 },
        { x: 220, y: 600 + wireIndex * 8 }, { x: 360, y: 600 + wireIndex * 8 },
        { x: 360, y: 900 + wireIndex * 8 }, { x: 460, y: 900 + wireIndex * 8 },
      ],
      metadata: { view: "e4" },
    }));
    expect(findE4CommonParallelSpan(bundle, bundle.map((wire) => wire.id))).toMatchObject({
      orientation: "vertical", start: 152, end: 300,
    });
  });

  it("does not hit-test a screen when any of its wires is on a hidden layer", () => {
    const screenWires: readonly EditorSceneObject[] = [
      { id: "visible", layerId: "top", kind: "wire", label: "W1", x: 0, y: 0, width: 0, height: 0, color: "#c00", points: [{ x: 0, y: 40 }, { x: 100, y: 40 }], metadata: { view: "e4" } },
      { id: "hidden", layerId: "bottom", kind: "wire", label: "W2", x: 0, y: 0, width: 0, height: 0, color: "#00c", points: [{ x: 0, y: 60 }, { x: 100, y: 60 }], metadata: { view: "e4" } },
    ];
    const screen = { id: "screen", wireIds: ["visible", "hidden"], position: 0.5, label: "SH", width: 18 };
    const layersWithHiddenBottom = layers.map((layer) => layer.id === "bottom" ? { ...layer, visible: false } : layer);
    expect(hitTestE4Screen([screen], screenWires, { x: 50, y: 50 }, 1)).toMatchObject({ id: "screen" });
    expect(hitTestE4Screen([screen], screenWires, { x: 50, y: 50 }, 1, layersWithHiddenBottom)).toBeNull();
    const overlays = getVisibleE4SceneOverlays({
      crossingStyle: "bridge",
      junctions: [{ id: "j", position: { x: 50, y: 50 }, wireIds: ["visible", "hidden"] }],
      diffPairs: [{ id: "d", wireIds: ["visible", "hidden"], step: 20, amplitude: 4 }],
      screens: [screen],
    }, screenWires, layersWithHiddenBottom);
    expect(overlays.junctions).toEqual([]);
    expect(overlays.diffPairs).toEqual([]);
    expect(overlays.screens).toEqual([]);
  });

  it("keeps screen position normalized while following aligned spans through a bend", () => {
    const routed: readonly EditorSceneObject[] = [
      {
        id: "route-a", layerId: "top", kind: "wire", label: "A",
        x: 0, y: 0, width: 0, height: 0, color: "#c00", metadata: { view: "e4" },
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }],
      },
      {
        id: "route-b", layerId: "top", kind: "wire", label: "B",
        x: 0, y: 0, width: 0, height: 0, color: "#00c", metadata: { view: "e4" },
        points: [{ x: 0, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 120 }, { x: 200, y: 120 }],
      },
    ];
    const base = { id: "screen", wireIds: ["route-a", "route-b"], label: "SH", width: 18 };
    expect(getE4ScreenLayout({ ...base, position: 0.1 }, routed)).toMatchObject({
      center: { x: 26, y: 10 }, orientation: "horizontal", pathLength: 260,
    });
    expect(getE4ScreenLayout({ ...base, position: 0.5 }, routed)).toMatchObject({
      center: { x: 90, y: 70 }, orientation: "vertical", pathLength: 260,
    });
    expect(getE4ScreenLayout({ ...base, position: 0.9 }, routed)).toMatchObject({
      center: { x: 174, y: 110 }, orientation: "horizontal", pathLength: 260,
    });
  });

  it("accepts model overlay metadata and drops malformed groups", () => {
    const carrier: EditorSceneObject = {
      id: "W1", layerId: "top", kind: "wire", label: "W1", x: 0, y: 0, width: 0, height: 0,
      color: "#222222", points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      metadata: {
        view: "e4",
        crossingStyle: "bridge",
        junctions: JSON.stringify([{ id: "j1", position: { x: 50, y: 0 }, wireIds: ["W1", "W2"] }]),
        diffPairs: JSON.stringify([{ id: "d1", wireIds: ["W1", "W2"], step: 25, amplitude: 5 }]),
        screens: JSON.stringify([{ id: "s1", wireIds: ["W1"], position: 0.5, label: "SH", width: 18 }, { id: "bad", wireIds: [], position: 5, width: 0 }]),
      },
    };
    const parsed = parseE4SceneOverlays([carrier]);
    expect(parsed.crossingStyle).toBe("bridge");
    expect(parsed.junctions).toHaveLength(1);
    expect(parsed.diffPairs).toHaveLength(1);
    expect(parsed.screens.map((screen) => screen.id)).toEqual(["s1"]);
  });

  it("updates immutable scene and layer state without changing unrelated entries", () => {
    const edited = updateEditorObject(objects, "upper", { label: "XP1", x: 45 });
    expect(edited).not.toBe(objects);
    expect(edited[0]).toBe(objects[0]);
    expect(edited[1]).toMatchObject({ id: "upper", label: "XP1", x: 45 });

    const locked = toggleLayerLock(layers, "bottom");
    expect(locked[0]).toBe(layers[0]);
    expect(locked[1]).toMatchObject({ id: "bottom", locked: true });
    expect(moveLayer(layers, "missing", 0)).toBe(layers);
  });
});
