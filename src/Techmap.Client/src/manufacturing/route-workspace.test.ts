import { describe, expect, it, vi } from "vitest";
import { createConnector, createWire } from "../editor/commands";
import { createEmptyHarnessDesign, type HarnessDesignDocument } from "../editor/model";
import { HarnessDesignApiError, type HarnessDesignApi, type HarnessDesignResource } from "../editor/design-api";
import { generateRoute } from "./route-commands";
import { RouteWorkspace } from "./route-workspace";
import { buildRouteSourceItems } from "./route-source";

const resource = (content: HarnessDesignDocument, revision: number, fingerprint: string): HarnessDesignResource => ({
  harnessId: "11111111-1111-4111-8111-111111111111", schemaVersion: 1, revision,
  content, updatedUtc: new Date(0).toISOString(), sourceFingerprint: fingerprint, harnessQuantity: 2,
});
function document(length: number, route?: HarnessDesignDocument["manufacturingRoute"]): HarnessDesignDocument {
  const from = createConnector("a", "X1", 1, { x: 0, y: 0 });
  const to = createConnector("b", "X2", 1, { x: 100, y: 0 });
  return { ...createEmptyHarnessDesign(), connectors: [from, to], wires: [createWire("wire", { connectorId: from.id, contactId: from.contacts[0]!.id }, { connectorId: to.id, contactId: to.contacts[0]!.id }, length, "Питание", "#f00")], ...(route ? { manufacturingRoute: route } : {}) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(callback => { resolve = callback; });
  return { promise, resolve };
}
function setup() {
  const source = document(100);
  let current = resource({ ...source, manufacturingRoute: generateRoute(source, "a".repeat(64), 2) }, 1, "a".repeat(64));
  const api = {
    get: vi.fn(async () => current),
    save: vi.fn(async (_p: string, _h: string, revision: number, content: HarnessDesignDocument) => {
      expect(revision).toBe(current.revision);
      current = resource(content, revision + 1, current.sourceFingerprint!);
      return current;
    }),
  };
  const resolve = vi.fn(async (_resource: HarnessDesignResource, route: NonNullable<HarnessDesignDocument["manufacturingRoute"]>) => route);
  const workspace = new RouteWorkspace(api, "p", "h", resolve);
  const edit = (comment: string) => { const route = workspace.getSnapshot().route!; workspace.edit({ ...route, rows: route.rows.map(row => ({ ...row, comment })) }); };
  return { api, resolve, workspace, edit, get: () => current, set: (next: HarnessDesignResource) => { current = next; } };
}

describe("RouteWorkspace", () => {
  it("refreshes drawing source while preserving inline comment and saves against the newest revision", async () => {
    const initialDocument = document(100);
    const initialRoute = generateRoute(initialDocument, "a".repeat(64), 2);
    let current = resource({ ...initialDocument, manufacturingRoute: initialRoute }, 1, "a".repeat(64));
    const api: HarnessDesignApi = {
      get: async () => current,
      save: async (_project, _harness, revision, content) => { expect(revision).toBe(2); current = resource(content, 3, "b".repeat(64)); return current; },
    };
    const workspace = new RouteWorkspace(api, "p", "h", async (_resource, route) => route);
    expect(await workspace.sync()).toBe(true);
    const initial = workspace.getSnapshot().route!;
    workspace.edit({ ...initial, rows: initial.rows.map(row => ({ ...row, comment: "Не терять" })) });
    current = resource(document(180, current.content.manufacturingRoute), 2, "b".repeat(64));
    expect(await workspace.sync()).toBe(true);
    const refreshed = workspace.getSnapshot();
    expect(refreshed.resource?.sourceFingerprint).toBe("b".repeat(64));
    expect(refreshed.route?.rows[0]?.comment).toBe("Не терять");
    expect(refreshed.route?.source.sha256).toBe("b".repeat(64));
    expect(await workspace.save()).toBe(true);
    expect(current.content.manufacturingRoute?.rows[0]?.comment).toBe("Не терять");
  });

  it("requires an explicit decision when an edited route loses a source object", async () => {
    let base = document(100);
    const initialRoute = generateRoute(base, "a".repeat(64), 2);
    base = { ...base, manufacturingRoute: initialRoute };
    let current = resource(base, 1, "a".repeat(64));
    const api: HarnessDesignApi = { get: async () => current, save: async () => current };
    const workspace = new RouteWorkspace(api, "p", "h", async (_resource, route) => route);
    await workspace.sync();
    workspace.edit({ ...initialRoute, rows: initialRoute.rows.map(row => ({ ...row, comment: "локально" })) });
    const removed = document(100);
    current = resource({ ...removed, wires: [] , manufacturingRoute: initialRoute }, 2, "c".repeat(64));
    expect(await workspace.sync()).toBe(false);
    expect(workspace.getSnapshot().sourcePreview?.removed.length).toBeGreaterThan(0);
    expect(workspace.getSnapshot().route?.rows[0]?.comment).toBe("локально");
    expect(await workspace.acceptSourceChanges()).toBe(true);
    expect(workspace.getSnapshot().sourcePreview).toBeNull();
    expect(workspace.getSnapshot().route?.rows[0]?.sourceObjects).toEqual([]);
    expect(workspace.getSnapshot().route?.rows[0]?.comment).toBe("локально");
  });

  it("automatically rebases an already stale route on opening and preserves unknown length", async () => {
    const f = setup(), base = f.get();
    f.set(resource({ ...base.content, wires: base.content.wires.map(wire => ({ ...wire, lengthMm: null })) }, 2, "b".repeat(64)));
    await f.workspace.sync();
    const state = f.workspace.getSnapshot();
    expect(state.route?.source.sha256).toBe("b".repeat(64));
    expect(buildRouteSourceItems(state.resource!.content)[0]!.lengthMm).toBeNull();
    expect(state.dirty).toBe(true);
    expect(await f.workspace.save()).toBe(true);
  });

  it("retains edits typed during terminal resolution", async () => {
    const f = setup();
    await f.workspace.sync();
    f.set(resource(document(250, f.get().content.manufacturingRoute), 2, "b".repeat(64)));
    const lookup = deferred<NonNullable<HarnessDesignDocument["manufacturingRoute"]>>();
    f.resolve.mockImplementationOnce(() => lookup.promise);
    const sync = f.workspace.sync();
    await vi.waitFor(() => expect(f.resolve).toHaveBeenCalledOnce());
    f.edit("Набрано во время запроса");
    lookup.resolve(f.resolve.mock.calls[0]![1]);
    await sync;
    expect(f.workspace.getSnapshot().route?.rows[0]?.comment).toBe("Набрано во время запроса");
    expect(buildRouteSourceItems(f.workspace.getSnapshot().resource!.content)[0]!.lengthMm).toBe(250);
  });

  it("drains edits typed during save without a late response replacing them", async () => {
    const f = setup();
    await f.workspace.sync();
    f.edit("Первое");
    const ack = deferred<HarnessDesignResource>();
    f.api.save.mockImplementationOnce(async (_p, _h, revision, content) => { const result = resource(content, revision + 1, "a".repeat(64)); await ack.promise; f.set(result); return result; });
    const saving = f.workspace.save();
    await vi.waitFor(() => expect(f.api.save).toHaveBeenCalledOnce());
    f.edit("Второе");
    ack.resolve(f.get());
    expect(await saving).toBe(true);
    expect(f.get().content.manufacturingRoute?.rows[0]?.comment).toBe("Второе");
    expect(f.workspace.getSnapshot().dirty).toBe(false);
    expect(f.api.save).toHaveBeenCalledTimes(2);
  });

  it("retries a drawing revision race with the newest drawing content", async () => {
    const f = setup();
    await f.workspace.sync();
    f.edit("Операция технолога");
    f.api.save.mockImplementationOnce(async () => {
      f.set(resource(document(777, f.get().content.manufacturingRoute), 2, "b".repeat(64)));
      throw new HarnessDesignApiError("Conflict", "design_revision_conflict", 2);
    });
    expect(await f.workspace.save()).toBe(true);
    expect(f.get().content.wires[0]!.lengthMm).toBe(777);
    expect(f.get().content.manufacturingRoute?.rows[0]?.comment).toBe("Операция технолога");
    expect(f.get().content.manufacturingRoute?.source.sha256).toBe("b".repeat(64));
  });

  it("blocks overwriting a route edited elsewhere even on repeated retries", async () => {
    const f = setup();
    await f.workspace.sync();
    f.edit("Моя правка");
    const original = f.get().content.manufacturingRoute!;
    const remote = { ...original, rows: original.rows.map(row => ({ ...row, comment: "Другое окно" })) };
    f.set(resource(document(321, remote), 2, "b".repeat(64)));
    expect(await f.workspace.save()).toBe(false);
    expect(await f.workspace.save()).toBe(false);
    expect(f.api.save).not.toHaveBeenCalled();
    expect(f.workspace.getSnapshot().route?.rows[0]?.comment).toBe("Моя правка");
    expect(f.workspace.getSnapshot().error).toContain("другом окне");
    expect(buildRouteSourceItems(f.workspace.getSnapshot().resource!.content)[0]!.lengthMm).toBe(321);
  });

  it("does not invalidate preparation for view-only revisions or duplicate polling", async () => {
    const f = setup(), route = f.get().content.manufacturingRoute!;
    f.set({ ...f.get(), content: { ...f.get().content, manufacturingRoute: { ...route, rows: route.rows.map(row => ({ ...row, prepared: true })) } } });
    await f.workspace.sync();
    f.set({ ...f.get(), revision: 2 });
    const refresh = f.workspace.sync();
    expect(f.workspace.sync()).toBe(refresh);
    await refresh;
    expect(f.workspace.getSnapshot().route?.rows[0]?.prepared).toBe(true);
    expect(f.workspace.getSnapshot().dirty).toBe(false);
    expect(f.resolve).not.toHaveBeenCalled();
  });
});
