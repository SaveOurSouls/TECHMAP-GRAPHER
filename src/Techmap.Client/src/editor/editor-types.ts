import type { WireEndStripProfiles } from "./model";

export type HarnessEditorView = "e4" | "drawing";

export type EditorTool =
  | "select"
  | "pan"
  | "connector"
  | "wire"
  | "text"
  | "dimension";

export type EditorObjectKind = "connector" | "wire" | "text" | "dimension";

export interface EditorPoint {
  readonly x: number;
  readonly y: number;
}

export interface EditorSceneObject {
  readonly id: string;
  readonly layerId: string;
  readonly kind: EditorObjectKind;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly points?: readonly EditorPoint[];
  /** End-treatment presentation shares the wire identity and drawing layer. */
  readonly stripProfiles?: WireEndStripProfiles;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface EditorLayer {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  readonly locked: boolean;
}

export type CoaxTerminationCatalogDiagnosticCode =
  | "snapshot-identity-missing"
  | "record-identity-invalid"
  | "layers-missing"
  | "layer-invalid"
  | "layer-index-duplicate"
  | "layer-diameter-missing"
  | "layer-strip-length-missing";

export interface CoaxTerminationCatalogDiagnostic {
  readonly code: CoaxTerminationCatalogDiagnosticCode;
  readonly message: string;
  readonly layerIndex?: number;
}

/** A normalized active layer. Missing D or L is retained so an incomplete
 * published catalog row remains visible and can explain why it cannot bind. */
export interface CoaxTerminationCatalogLayer {
  readonly index: number;
  readonly diameterMm: number | null;
  readonly stripLengthMm: number | null;
}

export interface CoaxTerminationCatalogBinding {
  readonly sourceId: string;
  readonly snapshotId: string;
  readonly snapshotSha256: string;
  readonly recordId: string;
  readonly entityType: "coax-termination";
  readonly sourceKey: string;
  readonly layers: readonly {
    readonly index: number;
    readonly diameterMm: number;
    readonly stripLengthMm: number;
  }[];
}

export interface CoaxTerminationCatalogCandidate {
  readonly state: "ready" | "incomplete";
  readonly layers: readonly CoaxTerminationCatalogLayer[];
  readonly diagnostics: readonly CoaxTerminationCatalogDiagnostic[];
  /** Present only for an exact immutable snapshot and complete D+L layers. */
  readonly binding: CoaxTerminationCatalogBinding | null;
}

export interface EditorCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly category: string;
  readonly accent: string;
  readonly placement?: "connector" | "reference-only";
  readonly sourceId?: string;
  readonly snapshotId?: string;
  readonly snapshotSha256?: string;
  readonly recordId?: string;
  readonly sourceKey?: string;
  readonly entityType?: string;
  readonly referenceDisplayName?: string;
  readonly coaxTerminationCandidate?: CoaxTerminationCatalogCandidate;
  /** Library template metadata used when placing connector instances. */
  readonly templateKind?: "series" | "free";
  readonly seriesId?: string;
  readonly defaultPartNumber?: string;
  /** Exact immutable persistent template version used for a library placement. */
  readonly componentTemplateId?: string;
  readonly componentTemplateVersion?: number;
  /** All articles exposed by this family card. The editor places the family
   * with its first article and lets the selected instance switch the article. */
  readonly componentArticles?: readonly {
    readonly sourceId: string;
    readonly entityType: string;
    readonly articleKey: string;
  }[];
  readonly componentArticle?: {
    readonly sourceId: string;
    readonly entityType: string;
    readonly articleKey: string;
  };
}

export interface EditorCatalogSource {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface EditorCamera {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly zoom: number;
}
