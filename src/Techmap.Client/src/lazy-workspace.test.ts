import { beforeEach, expect, it, vi } from "vitest";
import { Children, createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { createLazyWorkspace, WorkspaceLoadBoundary } from "./lazy-workspace";

// Drive retry and rerender while retaining React's real lazy/Suspense and SSR renderer.
const hooks = vi.hoisted(() => ({ cells: [] as unknown[], index: 0 }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.cells)) hooks.cells[index] = initial;
    return [hooks.cells[index], (next: unknown) => {
      hooks.cells[index] = typeof next === "function" ? next(hooks.cells[index]) : next;
    }];
  },
  useMemo: (factory: () => unknown, dependencies: readonly unknown[]) => {
    const index = hooks.index++;
    const previous = hooks.cells[index] as { dependencies: readonly unknown[]; value: unknown } | undefined;
    if (!previous || dependencies.some((value, position) => value !== previous.dependencies[position])) {
      hooks.cells[index] = { dependencies, value: factory() };
    }
    return (hooks.cells[index] as { value: unknown }).value;
  },
}));

interface Props {
  readonly name: string;
  readonly onClose: () => void;
  readonly onNavigationGuard: (guard: () => Promise<boolean>) => void;
}
beforeEach(() => { hooks.cells = []; hooks.index = 0; });
function render(Workspace: (props: Props) => ReactElement, props: Props) {
  hooks.index = 0;
  return Workspace(props);
}
async function markup(tree: ReactElement) {
  const stream = await renderToReadableStream(tree);
  await stream.allReady;
  return new Response(stream).text();
}

it("defers loading, shows status, shares a successful load and forwards navigation callbacks", async () => {
  let resolve!: (module: { default: ComponentType<Props> }) => void;
  let received: Props | undefined;
  const load = vi.fn(() => new Promise<{ default: ComponentType<Props> }>(answer => { resolve = answer; }));
  const Workspace = createLazyWorkspace(load, "Открываем редактор…");
  const props: Props = { name: "Первый жгут", onClose: vi.fn(), onNavigationGuard: vi.fn() };
  expect(load).not.toHaveBeenCalled();
  const first = render(Workspace, props);
  expect(load).not.toHaveBeenCalled();
  const waiting = renderToStaticMarkup(first);
  expect(waiting).toContain('role="status"');
  expect(waiting).toContain("Открываем редактор…");
  const Loaded = (input: Props) => { received = input; return createElement("article", null, input.name); };
  resolve({ default: Loaded });
  expect(await markup(first)).toContain("Первый жгут");
  expect(await markup(render(Workspace, { ...props, name: "Второй жгут" }))).toContain("Второй жгут");
  expect(load).toHaveBeenCalledOnce();
  expect(received!.onClose).toBe(props.onClose);
  expect(received!.onNavigationGuard).toBe(props.onNavigationGuard);
  const guard = async () => false;
  received!.onNavigationGuard(guard);
  received!.onClose();
  expect(props.onNavigationGuard).toHaveBeenCalledExactlyOnceWith(guard);
  expect(props.onClose).toHaveBeenCalledOnce();
});

it("shows a recoverable error and retries a rejected lazy instance with current props", async () => {
  const Loaded = (props: Props) => createElement("article", null, props.name);
  let attempts = 0;
  const load = vi.fn((): Promise<{ default: ComponentType<Props> }> => ++attempts === 1
    ? Promise.reject(new Error("offline")) : Promise.resolve({ default: Loaded }));
  const Workspace = createLazyWorkspace(load, "Открываем маршрут…");
  const props: Props = { name: "Маршрут v3", onClose: vi.fn(), onNavigationGuard: vi.fn() };
  const first = render(Workspace, props);
  renderToStaticMarkup(first);
  await expect(load.mock.results[0]!.value).rejects.toThrow("offline");
  const boundaryProps = first.props as { children: ReactNode; onRetry: () => void };
  const boundary = new WorkspaceLoadBoundary(boundaryProps);
  expect(boundary.render()).toBe(boundaryProps.children);
  boundary.state = WorkspaceLoadBoundary.getDerivedStateFromError();
  const error = boundary.render() as ReactElement<{ children: ReactNode }>;
  expect(renderToStaticMarkup(error)).toContain('role="alert"');
  expect(renderToStaticMarkup(error)).toContain("Повторить загрузку");
  const retry = Children.toArray(error.props.children).find(child => isValidElement(child) && child.type === "button") as ReactElement<{ onClick: () => void }>;
  retry.props.onClick();
  const second = render(Workspace, { ...props, name: "Текущий маршрут" });
  expect(second.key).not.toBe(first.key);
  expect(await markup(second)).toContain("Текущий маршрут");
  expect(load).toHaveBeenCalledTimes(2);
  expect(props.onClose).not.toHaveBeenCalled();
});
