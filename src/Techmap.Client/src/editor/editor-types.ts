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
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface EditorLayer {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  readonly locked: boolean;
}

export interface EditorCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly category: string;
  readonly accent: string;
  readonly placement?: "connector" | "reference-only";
  readonly sourceId?: string;
  readonly sourceKey?: string;
  readonly entityType?: string;
  /** Library template metadata used when placing connector instances. */
  readonly templateKind?: "series" | "free";
  readonly seriesId?: string;
  readonly defaultPartNumber?: string;
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
