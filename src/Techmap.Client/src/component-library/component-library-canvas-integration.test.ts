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
  it("does not mount drawing controls before a new series has its first saved version", () => {
    harness.canvasProps = null;
    renderToStaticMarkup(createElement(ComponentLibrary, { config, session }));
    expect(harness.canvasProps).toBeNull();
  });
});
