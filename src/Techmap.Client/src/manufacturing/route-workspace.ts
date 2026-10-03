import { HarnessDesignApiError, type HarnessDesignApi, type HarnessDesignResource } from "../editor/design-api";
import type { ManufacturingRoute } from "./route-model";
import { previewRouteRebase } from "./route-rebase";
import { orderRouteRows } from "./route-order";

export interface RouteWorkspaceState {
  resource: HarnessDesignResource | null;
  route: ManufacturingRoute | undefined;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  sourcePreview: ReturnType<typeof previewRouteRebase> | null;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Serializes refresh/save, retaining edits made while requests are in flight. */
export class RouteWorkspace {
  private state: RouteWorkspaceState = { resource: null, route: undefined, dirty: false, saving: false, error: null, sourcePreview: null };
  private baseline: HarnessDesignResource | null = null;
  private listeners = new Set<() => void>();
  private pending: Promise<unknown> = Promise.resolve();
  private refreshPending: Promise<boolean> | null = null;
  private editVersion = 0;
  constructor(
    private api: HarnessDesignApi,
    private projectId: string,
    private harnessId: string,
    private resolve: (resource: HarnessDesignResource, route: ManufacturingRoute) => Promise<ManufacturingRoute>,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<RouteWorkspaceState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  edit = (route: ManufacturingRoute) => {
    this.editVersion++;
    this.publish({ route, dirty: !same(route, this.baseline?.content.manufacturingRoute), error: null });
  };
  private enqueue(task: () => Promise<boolean>): Promise<boolean> {
    const next = this.pending.then(task).catch(error => {
      this.publish({ error: error instanceof Error ? error.message : "Не удалось синхронизировать маршрут." });
      return false;
    });
    this.pending = next;
    return next;
  }
  private async refresh(acceptRemovals = false): Promise<boolean> {
    const latest = await this.api.get(this.projectId, this.harnessId);
    const remote = latest.content.manufacturingRoute;
    if (this.baseline && !same(remote, this.baseline.content.manufacturingRoute) && this.state.dirty && !same(remote, this.state.route)) {
      // Expose live dimensions, but retain the old baseline so a retry cannot overwrite another author's route.
      this.publish({ resource: latest });
      throw new Error("Маршрут изменён в другом окне. Ваши правки сохранены в открытой строке; согласуйте изменения перед сохранением.");
    }
    let current = this.state.dirty ? this.state.route : remote;
    let preview: ReturnType<typeof previewRouteRebase> | null = null;
    if (current && latest.sourceFingerprint && current.source.sha256 !== latest.sourceFingerprint) {
      preview = previewRouteRebase(current, latest.content, latest.sourceFingerprint, latest.harnessQuantity);
      if (preview.removed.some(ref => ref.kind !== "wire") && !acceptRemovals) {
        this.baseline = latest;
        this.publish({ resource: latest, route: current, sourcePreview: preview, error: null });
        return false;
      }
      const version = this.editVersion;
      const resolved = await this.resolve(latest, preview.route);
      if (version !== this.editVersion && this.state.route) {
        // Catalogue lookup may finish after a keystroke; apply only its derived norms to the latest edits.
        preview = previewRouteRebase(this.state.route, latest.content, latest.sourceFingerprint, latest.harnessQuantity);
        const requirements = resolved.rows.flatMap(row => row.terminalRequirements ?? []);
        current = { ...preview.route, rows: preview.route.rows.map(row => ({ ...row,
          terminalRequirements: requirements.filter(requirement => row.sourceObjects.some(ref => ref.kind === "wire" && ref.id === requirement.wireId)),
        })) };
      } else current = resolved;
    }
    if (current) current = { ...current, rows: orderRouteRows(current.rows, latest.content) };
    this.baseline = latest;
    this.publish({ resource: latest, route: current, dirty: !same(current, remote), sourcePreview: null, error: null });
    return true;
  }
  sync = (): Promise<boolean> => {
    if (this.refreshPending) return this.refreshPending;
    const result = this.enqueue(() => this.refresh());
    this.refreshPending = result;
    void result.finally(() => { this.refreshPending = null; });
    return result;
  };
  acceptSourceChanges = () => this.enqueue(() => this.refresh(true));
  save = (): Promise<boolean> => this.enqueue(async () => {
    this.publish({ saving: true });
    try {
      let conflicts = 0;
      do {
        if (!await this.refresh()) return false;
        if (!this.state.dirty) return true;
        const base = this.baseline!, route = this.state.route, version = this.editVersion;
        try {
          const result = await this.api.save(this.projectId, this.harnessId, base.revision, { ...base.content, manufacturingRoute: route });
          this.baseline = result;
          this.publish({ resource: result, route: version === this.editVersion ? result.content.manufacturingRoute : this.state.route,
            dirty: version !== this.editVersion && !same(this.state.route, result.content.manufacturingRoute), error: null });
          conflicts = 0;
        } catch (error) {
          if (!(error instanceof HarnessDesignApiError) || error.code !== "design_revision_conflict" || ++conflicts >= 3) throw error;
        }
      } while (this.state.dirty);
      return true;
    } finally { this.publish({ saving: false }); }
  });
}
