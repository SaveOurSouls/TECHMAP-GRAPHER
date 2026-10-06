import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { RouteAssemblyDrawing, type RouteAssemblyDrawingProps } from "./RouteAssemblyDrawing";
import { HarnessDesignEditor, type HarnessDesignEditorProps } from "../editor/HarnessDesignEditor";
import { createEmptyHarnessDesign } from "../editor/model";
import { createRouteDrawingCopy } from "./route-drawing-copy";
import { createConnector } from "../editor/commands";

// Run the component's real callbacks and rerenders without a browser. Memo
// identity matters here: changing initialDocument restarts the nested editor.
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: (value: unknown) => { const index = hooks.index++; return hooks.slots[index] ??= { current: value }; },
  useState: (value: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof value === "function" ? value() : value;
    return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next; }];
  },
  useMemo: (factory: () => unknown, deps: readonly unknown[]) => {
    const index = hooks.index++, previous = hooks.slots[index];
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) hooks.slots[index] = { deps, value: factory() };
    return hooks.slots[index].value;
  },
  useEffect: () => {},
}));

beforeEach(() => { hooks.slots = []; hooks.index = 0; });
const find = (node: any, predicate: (element: any) => boolean): any => {
  if (!node || typeof node !== "object") return undefined;
  if (predicate(node)) return node;
  return [node.props?.children].flat(Infinity).map(child => find(child, predicate)).find(Boolean);
};

it("retains editor identity during isolated edits and restores both unsaved drafts on mode switches", () => {
  const source = { ...createEmptyHarnessDesign(), connectors: [createConnector("X", "X1", 2, { x: 40, y: 60 })] };
  const isolated = { ...source, connectors: source.connectors.map(connector => ({ ...connector, designation: "ISOLATED" })) };
  const save = vi.fn();
  const props: RouteAssemblyDrawingProps = {
    config: { configVersion: 1, basePath: "/", apiBasePath: "/api", appVersion: "test", apiVersion: "1", schemaVersion: "1" },
    session: { csrfNonce: "test", instanceId: "test" }, projectId: "p", harnessId: "h", items: [], document: source,
    row: { id: "row", kind: "assembly", title: "Assembly", comment: "", sourceObjects: [], dependsOn: [], operations: [], prepared: false,
      presentation: { backgroundOpacity: 1, objects: [], drawingCopy: createRouteDrawingCopy(source), isolatedDrawingCopy: createRouteDrawingCopy(isolated) } },
    onSave: save, onCancel: vi.fn(),
  };
  const render = () => { hooks.index = 0; return RouteAssemblyDrawing(props) as ReactElement; };
  const localCopy = (tree: ReactElement) => (find(tree, node => node.type === HarnessDesignEditor).props as HarnessDesignEditorProps).localCopy!;
  const switchTo = (tree: ReactElement, label: string) => find(tree, node => node.type === "button" && node.props.children === label).props.onClick();
  let tree = render();
  const initial = localCopy(tree).initialDocument;
  // A local snapshot can be saved even when the editor history is still
  // pristine. This is required for preserving the current view of a regular
  // (non-isolated) fragment.
  find(tree, node => node.type === "button" && node.props.children === "Сохранить текущий вид").props.onClick();
  expect(save).toHaveBeenCalledOnce();
  save.mockClear();
  const isolatedDraft = { ...initial, connectors: initial.connectors.map(connector => ({ ...connector, designation: "EDITED ISOLATED" })) };
  localCopy(tree).onDraftChange!(isolatedDraft, ["hidden"], 0.2);
  tree = render();
  expect(localCopy(tree).initialDocument).toBe(initial);
  switchTo(tree, "Исходная копия");
  tree = render();
  const sourceDraft = { ...localCopy(tree).initialDocument, connectors: source.connectors.map(connector => ({ ...connector, designation: "EDITED SOURCE" })) };
  localCopy(tree).onDraftChange!(sourceDraft, [], 0.7);
  switchTo(tree, "Изолированный фрагмент");
  tree = render();
  expect(localCopy(tree).initialDocument.connectors[0]!.designation).toBe("EDITED ISOLATED");
  expect(localCopy(tree).hiddenObjectIds).toEqual(["hidden"]);
  expect(localCopy(tree).backgroundOpacity).toBe(0.2);
  switchTo(tree, "Исходная копия");
  tree = render();
  expect(localCopy(tree).initialDocument.connectors[0]!.designation).toBe("EDITED SOURCE");
  expect(localCopy(tree).backgroundOpacity).toBe(0.7);
  localCopy(tree).onSave(localCopy(tree).initialDocument, [], 0.7);
  const result = save.mock.calls[0]![0];
  expect(result.drawingCopy.document.connectors[0].designation).toBe("EDITED SOURCE");
  expect(result.isolatedDrawingCopy.document.connectors[0].designation).toBe("EDITED ISOLATED");
});
