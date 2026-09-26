import type { HarnessDesignDocument } from "../editor/model";
import { parseManufacturingRoute } from "./route-model";

export interface RouteCutReadiness { readonly ready: boolean; readonly code: "ready" | "route_source_stale" | "route_cut_not_prepared"; readonly message: string }
const notPrepared: RouteCutReadiness = { ready: false, code: "route_cut_not_prepared", message: "Карта резки недоступна: подготовьте в маршруте все заготовки и назначьте закреплённую операцию резки." };
const stale: RouteCutReadiness = { ready: false, code: "route_source_stale", message: "Карта резки недоступна: сохраните изменения конструкции и актуализируйте маршрут." };

/** Same gate as the direct cut-list API; cable members do not create additional blanks. */
export function routeCutReadiness(document: HarnessDesignDocument, sourceFingerprint?: string, unsaved = false): RouteCutReadiness {
  const route = document.manufacturingRoute;
  if (!route) return notPrepared;
  if (unsaved || !sourceFingerprint || route.source.sha256.toLowerCase() !== sourceFingerprint.toLowerCase()) return stale;
  try { parseManufacturingRoute(route); } catch { return notPrepared; }
  const ready = new Set(route.rows.filter(row => row.kind === "semiFinished" && row.prepared && row.operations.some(op => op.binding &&
    ["cut", "cut-strip-from", "cut-strip-to", "cut-strip-both", "cut-crimp"].includes(op.mode))).flatMap(row => row.sourceObjects.map(ref => `${ref.kind}:${ref.id}`)));
  const members = new Set(document.cables.flatMap(cable => cable.memberWireIds));
  const required = [
    ...document.wires.filter(wire => !members.has(wire.id)).map(wire => `wire:${wire.id}`),
    ...document.cables.map(cable => `cable:${cable.id}`),
    ...(document.physicalTopology?.coverings ?? []).map(covering => `covering:${covering.id}`),
  ];
  return required.every(id => ready.has(id)) ? { ready: true, code: "ready", message: "" } : notPrepared;
}
