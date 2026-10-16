import { afterEach, describe, expect, it, vi } from "vitest";
import { drawEditorSceneObject, drawE4DifferentialPairs, redrawCanvas, type E4SceneOverlays } from "./CanvasViewport";
import type { EditorSceneObject } from "./editor-types";

afterEach(() => vi.unstubAllGlobals());

function recorder() {
  const calls: unknown[][] = [];
  const strokeCounts: Record<string, number> = {};
  let state: Record<string, unknown> = { lineWidth: 1, strokeStyle: "#000000", fillStyle: "#000000" };
  const stack: Record<string, unknown>[] = [];
  const context = new Proxy({}, {
    set: (_target, key, value) => { state[String(key)] = value; calls.push(["set", String(key), value]); return true; },
    get: (_target, key) => {
      if (key in state) return state[String(key)];
      return (...args: unknown[]) => {
        calls.push([String(key), ...args]);
        if (key === "save") stack.push({ ...state });
        if (key === "restore") {
          if (!stack.length) throw new Error("Unbalanced canvas restore");
          state = stack.pop()!;
        }
        if (key === "stroke") {
          const style = `${state.strokeStyle}@${state.lineWidth}`;
          strokeCounts[style] = (strokeCounts[style] ?? 0) + 1;
        }
        if (key === "measureText") return { width: String(args[0]).length * 6 };
      };
    },
  }) as CanvasRenderingContext2D;
  return {
    context, calls, strokeCounts,
    result: async () => {
      expect(stack).toHaveLength(0);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(calls)));
      return {
        // Frozen on 8962aef before extraction; includes exact operation/style order.
        commandSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
        strokeCounts,
        bezierCount: calls.filter(call => call[0] === "bezierCurveTo").length,
        ellipses: calls.filter(call => call[0] === "ellipse").map(call => call.slice(1)),
        arcCount: calls.filter(call => call[0] === "arc").length,
        lastArc: calls.filter(call => call[0] === "arc").at(-1)?.slice(1),
      };
    },
  };
}

function wire(id: string, y: number, color: string): EditorSceneObject {
  return { id, kind: "wire", layerId: "wires", label: "", x: 0, y: 0, width: 0, height: 0, color, points: [{ x: 0, y }, { x: 160, y }], metadata: { view: "e4" } };
}

describe("E4 painting compatibility with the pre-extraction viewport", () => {
  it.each(["#fff", " white ", "rgba(255,255,255,1)", "#d42"])("preserves the wire stroke and white outline for %s", async color => {
    const trace = recorder();
    drawEditorSceneObject(trace.context, wire("A", 20, color), false, "e4");
    expect(trace.strokeCounts[`${color}@3`]).toBe(1);
    expect(trace.strokeCounts["#53636c@5"] ?? 0).toBe(color === "#d42" ? 0 : 1);
    expect(await trace.result()).toMatchSnapshot();
  });

  it.each([1, 2] as const)("preserves differential-pair variant %s, halos and alternating wire colours", async variant => {
    const trace = recorder();
    const objects = [wire("A", 20, "#fff"), wire("B", 44, "#06c")];
    drawE4DifferentialPairs(trace.context, [{ id: "D", wireIds: ["A", "B"], step: 24, amplitude: 6, variant }], objects);
    expect(trace.strokeCounts["#53636c@5"]).toBeGreaterThan(1);
    expect(trace.strokeCounts["#06c@3"]).toBeGreaterThan(1);
    expect(await trace.result()).toMatchSnapshot();
  });

  it.each([false, true])("preserves full redraw order with wires hidden=%s", async hidden => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    const trace = recorder();
    const canvas = { width: 0, height: 0, clientWidth: 240, clientHeight: 120, getContext: () => trace.context } as unknown as HTMLCanvasElement;
    const cross: EditorSceneObject = { ...wire("C", 0, "#d42"), points: [{ x: 80, y: 0 }, { x: 80, y: 90 }] };
    const connector: EditorSceneObject = { id: "X", kind: "connector", layerId: "connectors", label: "X1", x: 200, y: 0, width: 30, height: 100, color: "#123456", metadata: { contactCount: "2" } };
    const objects = [cross, wire("A", 20, "#fff"), wire("B", 44, "#06c"), connector];
    const layers = [
      { id: "connectors", label: "Соединители", visible: true, locked: false },
      { id: "wires", label: "Провода", visible: !hidden, locked: false },
    ];
    const overlays: E4SceneOverlays = {
      crossingStyle: "bridge",
      diffPairs: [{ id: "D", wireIds: ["A", "B"], step: 24, amplitude: 6, variant: 2 }],
      junctions: [{ id: "J", position: { x: 80, y: 44 }, wireIds: ["B", "C"] }],
      screens: [{ id: "S", wireIds: ["A", "B"], position: 0.75, width: 20, label: "Экран", terminalSide: "both" }],
    };
    redrawCanvas(canvas, "e4", { offsetX: 5, offsetY: 7, zoom: 1 }, objects, layers, new Set(["A"]), [], overlays);
    expect(canvas.width).toBe(480);
    expect(canvas.height).toBe(240);
    if (hidden) expect(trace.calls.some(call => call[0] === "ellipse")).toBe(false);
    else {
      expect(trace.calls.findIndex(call => call[0] === "bezierCurveTo")).toBeGreaterThan(-1);
      const screenIndex = trace.calls.findIndex(call => call[0] === "ellipse");
      const finalContactIndex = trace.calls.map(call => call[0]).lastIndexOf("arc");
      expect(screenIndex).toBeGreaterThan(-1);
      expect(finalContactIndex).toBeGreaterThan(screenIndex);
    }
    expect(await trace.result()).toMatchSnapshot();
  });

  it("preserves the shared white stroke for drawing wire paths", async () => {
    const trace = recorder();
    const object = wire("A", 20, "#fff");
    drawEditorSceneObject(trace.context, { ...object, paths: [object.points!], metadata: { drawingWidth: "3" } }, false, "drawing");
    expect(trace.strokeCounts["#53636c@5"]).toBe(1);
    expect(trace.strokeCounts["#fff@3"]).toBe(1);
    expect(await trace.result()).toMatchSnapshot();
  });
});
