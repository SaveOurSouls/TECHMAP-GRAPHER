import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseRuntimeConfig } from "../runtime-config";
import type { TemplateCanvasV2Props } from "./TemplateCanvasV2";

const harness = vi.hoisted(() => ({
  canvasProps: null as TemplateCanvasV2Props | null,
  movePoint: vi.fn(),
  insertPoint: vi.fn(),
  deletePoint: vi.fn(),
}));

vi.mock("./TemplateCanvasV2", () => ({
  TemplateCanvasV2: (props: TemplateCanvasV2Props) => {
    harness.canvasProps = props;
    return createElement("svg", { "data-testid": "template-canvas" });
  },
}));

vi.mock("./template-commands-v3", async importOriginal => {
  const actual = await importOriginal<typeof import("./template-commands-v3")>();
  return {
    ...actual,
    newTemplateContentV3: () => {
      const initial = actual.newTemplateContentV3();
      const view = initial.views[0]!;
      return actual.addBasicNodeV3(initial, view.id, view.layers[0]!.id, "polyline")[0];
    },
    moveNodePointV3: (...args: Parameters<typeof actual.moveNodePointV3>) => {
      harness.movePoint(...args);
      return actual.moveNodePointV3(...args);
    },
    insertNodePointV3: (...args: Parameters<typeof actual.insertNodePointV3>) => {
      harness.insertPoint(...args);
      return actual.insertNodePointV3(...args);
    },
    deleteNodePointV3: (...args: Parameters<typeof actual.deleteNodePointV3>) => {
      harness.deletePoint(...args);
      return actual.deleteNodePointV3(...args);
    },
  };
});

import { ComponentLibrary } from "./ComponentLibrary";

const config = parseRuntimeConfig({
  configVersion: 1,
  basePath: "/",
  apiBasePath: "/api/v1/",
  appVersion: "1",
  apiVersion: "1",
  schemaVersion: "7",
});
const session = { csrfNonce: "A".repeat(43), instanceId: "12345678-1234-4123-8123-123456789abc" };

describe("ComponentLibrary canvas integration", () => {
  it("connects all point-editing callbacks to the v3 commands for the selected canvas node", () => {
    harness.canvasProps = null;
    renderToStaticMarkup(createElement(ComponentLibrary, { config, session }));
    // Rendering invokes the mocked child synchronously, which TypeScript cannot
    // infer from the React server renderer call above.
    const props = harness.canvasProps as unknown as TemplateCanvasV2Props;
    expect(props).not.toBeNull();
    expect(props.onNodePointMove).toEqual(expect.any(Function));
    expect(props.onNodePointInsert).toEqual(expect.any(Function));
    expect(props.onNodePointDelete).toEqual(expect.any(Function));

    const view = props.content.views.find(candidate => candidate.id === props.viewId)!;
    const node = view.layers[0]!.nodes[0]!;
    props.onNodePointMove!(node.id, 1, 7, -3);
    props.onNodePointInsert!(node.id, 0, 125, 100);
    props.onNodePointDelete!(node.id, 1);

    expect(harness.movePoint).toHaveBeenCalledWith(
      expect.anything(), view.id, view.layers[0]!.id, node.id, 1, 7, -3,
    );
    expect(harness.insertPoint).toHaveBeenCalledWith(
      expect.anything(), view.id, view.layers[0]!.id, node.id, 0, 125, 100,
    );
    expect(harness.deletePoint).toHaveBeenCalledWith(
      expect.anything(), view.id, view.layers[0]!.id, node.id, 1,
    );
  });
});
