import { describe, expect, it } from "vitest";
import { drawEditorSceneObject, drawSelectedConnectorContacts, getE4ConnectorLayout, hitTestConnectorContact } from "./CanvasViewport";
import type { EditorSceneObject } from "./editor-types";

const layers = [{ id: "connectors", label: "Соединители", visible: true, locked: false }];
const rows = [
  { number: 1, type: "pin", circuit: "Питание", terminal: "T-1", wire: "ПВ", wireSection: "0.5", color: "red", secondaryColor: "white", status: "available", customValues: { zone: "A" } },
  { number: 7, type: "socket", circuit: "Резерв", terminal: "", wire: "", color: "", status: "not-connected", customValues: { zone: "B" } },
];

function connector(orientation: "left" | "right"): EditorSceneObject {
  return {
    id: "X1", kind: "connector", layerId: "connectors", label: "X1", x: 40, y: 30,
    width: 480, height: 124, color: "#123456",
    metadata: { view: "e4", orientation, rows: JSON.stringify(rows), contactCount: "2", designation: "X1", libraryCode: "LIB", partNumber: "ABC-123" },
  };
}

function recorder() {
  const calls: unknown[][] = [];
  let state: Record<string, unknown> = {};
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
        if (key === "measureText") return { width: String(args[0]).length * 6 };
      };
    },
  }) as CanvasRenderingContext2D;
  return {
    context,
    result: async () => {
      expect(stack).toHaveLength(0);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(calls)));
      return {
        // Captured before extraction on 6b1e130. Includes styles, clipping and operation order.
        commandSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
        text: calls.filter(call => call[0] === "fillText").map(call => call.slice(1)),
        contacts: calls.filter(call => call[0] === "arc").map(call => call.slice(1)),
      };
    },
  };
}

describe("connector painting compatibility with the pre-refactor viewport", () => {
  it.each(["left", "right"] as const)("preserves the %s table, two-color cells and disconnected marker", async side => {
    const object = connector(side);
    const trace = recorder();
    drawEditorSceneObject(trace.context, object, false, "e4");
    expect(await trace.result()).toMatchSnapshot();
    const layout = getE4ConnectorLayout(object)!;
    expect(hitTestConnectorContact([object], layers, layout.contactPoints[0]!, 1, "e4")).toEqual({ connectorId: "X1", contactIndex: 0 });
    expect(hitTestConnectorContact([object], layers, layout.contactPoints[1]!, 1, "e4")).toBeNull();
  });

  it("preserves diagnostic borders, custom columns and authoritative widths", async () => {
    const object = connector("left");
    const custom: EditorSceneObject = {
      ...object, metadata: { ...object.metadata, diagnostic: "error", columns: JSON.stringify(["number", "custom:zone", "color"]), columnWidths: "[50,200,230]", columnLabels: JSON.stringify({ "custom:zone": "Зона" }) },
    };
    const trace = recorder();
    drawEditorSceneObject(trace.context, custom, true, "e4");
    expect(await trace.result()).toMatchSnapshot();
    expect(getE4ConnectorLayout(custom)?.columns.map(column => column.width)).toEqual([50, 200, 230]);
  });

  it.each(["e4", "drawing"] as const)("preserves materialized contacts, null slots and selected handles in %s", async view => {
    const object = connector("right");
    const materialized: EditorSceneObject = {
      ...object, metadata: { ...object.metadata, materializedContactPoints: JSON.stringify([
        { x: 12, y: 20, direction: "up", directionVector: { x: 0.6, y: -0.8 }, status: "not-connected" },
        null,
        { x: 42, y: 50, direction: "left", status: "available" },
      ]) },
    };
    const trace = recorder();
    drawEditorSceneObject(trace.context, materialized, true, view);
    drawSelectedConnectorContacts(trace.context, materialized, view, 2);
    expect(await trace.result()).toMatchSnapshot();
    expect(hitTestConnectorContact([materialized], layers, { x: 82, y: 80 }, 2, view)).toEqual({ connectorId: "X1", contactIndex: 2 });
    expect(hitTestConnectorContact([materialized], layers, { x: 52, y: 50 }, 2, view)).toBeNull();
  });

  it("preserves the compact legacy fallback for invalid table metadata", async () => {
    const object = connector("right");
    const legacy = { ...object, metadata: { ...object.metadata, rows: "{broken" } };
    const trace = recorder();
    drawEditorSceneObject(trace.context, legacy, false, "e4");
    drawSelectedConnectorContacts(trace.context, legacy, "e4", 1);
    expect(await trace.result()).toMatchSnapshot();
    expect(getE4ConnectorLayout(legacy)).toBeNull();
    expect(hitTestConnectorContact([legacy], layers, { x: 40, y: 58 }, 1, "e4")).toEqual({ connectorId: "X1", contactIndex: 0 });
  });
});
