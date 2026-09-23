import type { Point } from "./model";
import type { PhysicalCovering } from "./physical-coverings";

/** Persisted topology only. Generated routing vertices never enter this model. */
export type PhysicalDirection = "left" | "right" | "up" | "down";
export interface PhysicalNode { readonly id: string; readonly position: Point; readonly connectorId?: string; readonly wireIds?: readonly string[]; readonly direction?: PhysicalDirection; readonly contactDirections?: Readonly<Record<string, PhysicalDirection>> }
export interface PhysicalSegment { readonly id: string; readonly from: string; readonly to: string; readonly bends: readonly Point[]; readonly width?:number; readonly color?:string; readonly showWires?:boolean; readonly specificationItemId?:string; readonly routing?: "auto" | "fixed" }
export interface PhysicalStep { readonly segmentId: string; readonly reverse: boolean }
export interface PhysicalRoute { readonly wireId: string; readonly steps: readonly PhysicalStep[]; readonly automatic?:boolean }
export interface PhysicalTopology {
  readonly coverings?: readonly PhysicalCovering[];
  readonly nodes: readonly PhysicalNode[];
  readonly segments: readonly PhysicalSegment[];
  readonly routes: readonly PhysicalRoute[];
  readonly snap: boolean;
}
export const emptyPhysicalTopology = (): PhysicalTopology => ({ nodes: [], segments: [], routes: [], snap: true });
