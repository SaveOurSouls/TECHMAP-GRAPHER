import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { hitTestConnectorContact, hitTestEditorScene, hitTestWireEnd, hitTestWireRoutePoint, objectsInPaintOrder } from "./CanvasViewport";
import { panEditorCamera, screenToWorld, worldToScreen, zoomEditorCameraAt } from "./editor-camera";
import { moveLayer, toggleLayerLock, toggleLayerVisibility, updateEditorObject } from "./editor-state";
import type { EditorLayer, EditorSceneObject } from "./editor-types";
import { HarnessEditorWorkspace } from "./HarnessEditorWorkspace";

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
