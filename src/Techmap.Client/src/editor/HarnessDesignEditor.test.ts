import { describe, expect, it } from "vitest";
import { createConnector, createWire, applyEditorCommand } from "./commands";
import { designToScene } from "./HarnessDesignEditor";
import { createEmptyHarnessDesign } from "./model";

describe("harness design scene adapter", () => {
  it("renders the same domain instances in E4 and drawing with separate positions", () => {
    const x1 = createConnector("x1", "X1", 2, { x: 10, y: 20 }, { x: 100, y: 120 });
    const x2 = createConnector("x2", "X2", 2, { x: 400, y: 20 }, { x: 500, y: 120 });
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
  });
});
