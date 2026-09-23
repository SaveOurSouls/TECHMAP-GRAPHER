import { describe, expect, it, vi } from "vitest";
import { previewE4ConnectorMove } from "./move-preview";
import { physicalFixture } from "./physical-topology-fixture";
import { applyEditorCommand } from "./commands";
import * as router from "./e4-router";
import { wireEndpointE4Anchor } from "./model";
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from "./history";

describe("E4 drag preview", () => {
  it("keeps anchors connected without routing, mutating history or touching unrelated wires", () => {
    const source = physicalFixture();
    const before = structuredClone(source);
    const route = vi.spyOn(router, "routeE4WireThroughWaypoints");
    try {
      const next = previewE4ConnectorMove(source,"A",{x:-180,y:240});
      expect(route).not.toHaveBeenCalled();
      expect(source).toEqual(before);
      expect(next.wires[2]).toBe(source.wires[2]);
      expect(next.physicalTopology).toBe(source.physicalTopology);
      expect(next.connectors[0]!.positions.drawing).toBe(source.connectors[0]!.positions.drawing);
      for(const wire of next.wires.slice(0,2)) {
        const points = [wireEndpointE4Anchor(next,wire.from)!.position,...wire.e4Route,wireEndpointE4Anchor(next,wire.to)!.position];
        for(let index=1;index<points.length;index++) {
          const a=points[index-1]!,b=points[index]!;
          expect(a.x===b.x || a.y===b.y).toBe(true);
        }
        expect(wire.e4Route).toEqual(expect.arrayContaining([...source.wires.find(w=>w.id===wire.id)!.e4Route]));
      }
    } finally { route.mockRestore(); }
  });
  it("commits the ordinary routed move once; undo returns the exact starting document", () => {
    const source = physicalFixture();
    const command = {type:"move-connector" as const,connectorId:"A",view:"e4" as const,position:{x:-180,y:240}};
    const initial = createEditorHistory(source);
    for(let index=0;index<60;index++) previewE4ConnectorMove(source,"A",{x:-index*3,y:index*4});
    const committed = executeEditorCommand(initial,command);
    expect(committed.present).toEqual(applyEditorCommand(source,command));
    expect(undoEditorCommand(committed).present).toEqual(source);
  });
});
