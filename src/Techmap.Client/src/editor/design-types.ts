import { type connectorBaseColumnKeys } from "./connector-presentation";
import { type TerminationComponent, type TerminationDocument } from "./termination-model";
import { type WireBlankEnd } from "../WireBlankCatalog";
import { type DrawingDocuments } from "./drawing-documents";
import { type PhysicalTopology } from "./physical-topology-model";
import { type ManufacturingRoute } from "../manufacturing/route-model";

export type EditorView = "e4" | "drawing";
export interface Point {
  readonly x: number;
  readonly y: number;
}
export type ConnectorContactStatus = "available" | "not-connected";
export type ConnectorLibraryContactKind = "signal" | "power" | "third";
export type ConnectorLibraryBinding =
  | { readonly mode: "series"; readonly seriesId: string; readonly partNumber: string }
  | {
      readonly mode: "template";
      readonly contactNumbering?: "source-v1";
      readonly templateId: string;
      readonly templateVersion: number;
      readonly versionSha256: string;
      readonly articleVariantId: string;
      readonly article: ComponentTemplateArticleKeySnapshot;
      readonly snapshot: ComponentTemplateMaterializedSnapshot;
    }
  | { readonly mode: "free" };
export interface ComponentTemplateArticleKeySnapshot {
  readonly sourceId: string;
  readonly entityType: string;
  readonly articleKey: string;
}
export interface ComponentTemplateAssetSnapshot {
  readonly assetId: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly fileName: string;
  readonly mediaType: string;
}
export interface ComponentTemplateContactRepresentationSnapshot {
  readonly viewId: string;
  readonly viewName: string;
  readonly viewKind: "e4" | "drawing" | "additional";
  readonly pointId: string;
  readonly occurrenceKey?: string;
  readonly x: number;
  readonly y: number;
  readonly direction: "left" | "right" | "up" | "down";
}
export interface ComponentTemplateContactSnapshot {
  /** Logical-contact ID for fixed contacts and the stable occurrence key for repeated contacts. */
  readonly logicalContactId: string;
  readonly prototypeLogicalContactId: string;
  readonly sourceNumber: string;
  readonly name: string;
  readonly circuitText: string | null;
  readonly contactTypeGroupId: string | null;
  readonly contactType: string;
  readonly allowedTerminalArticleKeys: readonly ComponentTemplateArticleKeySnapshot[];
  readonly representations: readonly ComponentTemplateContactRepresentationSnapshot[];
}
/**
 * Placement-owned materialization of one exact template article. The full
 * reusable template remains in the project component snapshot; this compact
 * copy is enough for the editor to reopen and route the instance without
 * following a newer library head.
 */
export interface ComponentTemplateMaterializedSnapshot {
  readonly templateId: string;
  readonly templateVersion: number;
  readonly versionSha256: string;
  readonly code: string;
  readonly name: string;
  readonly articleVariantId: string;
  readonly article: ComponentTemplateArticleKeySnapshot;
  readonly articleBindings: readonly ComponentTemplateArticleKeySnapshot[];
  readonly assets: readonly ComponentTemplateAssetSnapshot[];
  readonly contacts: readonly ComponentTemplateContactSnapshot[];
}
export interface ConnectorLibraryContact {
  readonly kind: ConnectorLibraryContactKind;
  readonly ordinal: number;
}
export type ConnectorSchematicOrientation = "contacts-left" | "contacts-right";
export type ConnectorBaseColumnKey = typeof connectorBaseColumnKeys[number];
export interface ConnectorBaseColumn {
  readonly key: ConnectorBaseColumnKey;
  readonly visible: boolean;
}
export interface ConnectorCustomField {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
}
export interface ConnectorSchematicPresentation {
  /** Instance-only E4 row order. Contact identity and drawing geometry stay canonical. */
  readonly rowOrder?: readonly string[];
  readonly showName?: boolean;
  readonly orientation: ConnectorSchematicOrientation;
  readonly baseColumns: readonly ConnectorBaseColumn[];
  readonly customFields: readonly ConnectorCustomField[];
}
export type ConnectorE4TableColumn =
  | { readonly kind: "base"; readonly key: ConnectorBaseColumnKey; readonly x: number; readonly width: number }
  | { readonly kind: "custom"; readonly id: string; readonly label: string; readonly x: number; readonly width: number };
export interface ConnectorE4TableGeometry {
  readonly width: number;
  readonly height: number;
  readonly titleHeight: number;
  readonly headerHeight: number;
  readonly rowHeight: number;
  readonly footerHeight: number;
  readonly columns: readonly ConnectorE4TableColumn[];
  readonly contactPoints: Readonly<Record<string, Point>>;
}
export interface ConnectorContact {
  /** Undefined inherits the library name; an empty string is an intentional override. */
  readonly nameOverride?: string;
  readonly id: string;
  /** Stable template logical ID, or a repeat occurrence key for a materialized row. */
  readonly logicalContactId?: string;
  readonly number: number;
  readonly contactType: string;
  readonly circuit: string;
  readonly terminalArticle: string;
  readonly terminalDetails?: {
    readonly manufacturer: string;
    readonly series: string;
    readonly description: string;
    readonly article?: string;
    /** Catalog L+ and L- snapshots, in millimetres. L- is stored as a signed value. */
    readonly lengthPlusMm?: number | null;
    readonly lengthMinusMm?: number | null;
  };
  readonly wire: string;
  readonly wireSection?: string;
  readonly wireDiameterMm?: number;
  /** Published wire variant selected in the E4 contact table. */
  readonly materialBinding?: WireMaterialBinding;
  readonly color: string;
  /** Empty or missing means that the wire has one insulation color. */
  readonly secondaryColor?: string;
  /** Automatic values follow a directly connected contact; manual values are preserved. */
  readonly colorMode?: "auto" | "manual";
  readonly connectionStatus: ConnectorContactStatus;
  readonly customValues: Readonly<Record<string, string>>;
  readonly libraryContact?: ConnectorLibraryContact | null;
}
export interface ConnectorDrawingPlacement {
  readonly rotationDegrees?:number;
  readonly scale?:number;
  readonly drawingId: string;
  readonly visible: boolean;
  readonly offset: Point;
}
export interface ConnectorInstance {
  readonly terminationComponent?: TerminationComponent;
  readonly drawingPlacements?: readonly ConnectorDrawingPlacement[];
  /** v5 uses the editable E4 table; graphical points belong to the drawing. */
  readonly e4TableMode?: boolean;
  /** Versioned compatibility supplement; never changes the pinned template. */
  readonly terminalCatalog?: ConnectorTerminalCatalog;
  readonly id: string;
  readonly designation: string;
  /** Editable footer code for a free connector. Series connectors derive it from their library. */
  readonly libraryCode?: string;
  readonly partNumber: string;
  readonly contacts: readonly ConnectorContact[];
  readonly schematic: ConnectorSchematicPresentation;
  readonly positions: Readonly<Record<EditorView, Point>>;
  readonly layerIds: Readonly<Record<EditorView, string>>;
  readonly libraryBinding?: ConnectorLibraryBinding;
}
export interface ConnectorTerminalCatalog {
  readonly templateId: string;
  readonly version: number;
  readonly versionSha256: string;
  readonly byContact: Readonly<Record<string, readonly string[]>>;
}
export type WireEndpoint =
  | { readonly connectorId: string; readonly contactId: string; readonly junctionId?: never; readonly screenId?: never }
  | { readonly junctionId: string; readonly connectorId: ""; readonly contactId: ""; readonly screenId?: never }
  | { readonly screenId: string; readonly screenTerminalSide?: WireScreenEndpointSide; readonly connectorId: ""; readonly contactId: ""; readonly junctionId?: never };
export interface E4Junction {
  readonly id: string;
  readonly position: Point;
  readonly wireIds: readonly string[];
}
export interface DiffPairGroup {
  readonly id: string;
  readonly wireIds: readonly [string, string];
  readonly step: number;
  readonly amplitude: number;
  readonly variant: 1 | 2;
}
export interface WireScreenGroup {
  readonly id: string;
  readonly wireIds: readonly string[];
  readonly position: number;
  readonly label: string;
  readonly width: number;
  /** Conducting terminal display. Missing in legacy JSON means `above`. */
  readonly terminalSide?: WireScreenTerminalSide;
}
export type WireScreenTerminalSide = "above" | "below" | "both";
export type WireScreenEndpointSide = Exclude<WireScreenTerminalSide, "both">;
export type WireCrossingStyle = "none" | "bridge";
export type E4RouteLeadDirection = "left" | "right" | "up" | "down" | null;
export interface E4RouteAnchor {
  readonly leadLength?: number;
  readonly position: Point;
  readonly leadDirection: E4RouteLeadDirection;
}
export interface WireInstance {
  /** Per-conductor values; shared contact rows must never overwrite these. */
  readonly wireMark?: string;
  readonly wireSection?: string;
  readonly secondaryColor?: string;
  readonly wireDiameterMm?: number;
  readonly id: string;
  readonly from: WireEndpoint;
  readonly to: WireEndpoint;
  readonly circuit: string;
  readonly color: string;
  /** Contact whose table color drives a direct contact-to-contact wire. */
  readonly colorSource?: WireColorSource | null;
  /** Exact immutable reference-catalog record selected for this wire. */
  readonly materialBinding?: WireMaterialBinding;
  /** Exact immutable stripping profiles selected independently for both wire ends. */
  readonly stripProfiles?: WireEndStripProfiles;
  /**
   * Endpoints for an isolated drawing wire. They intentionally do not imply
   * an electrical or physical connection and are used only in the drawing
   * view; ordinary wires omit this field.
   */
  readonly drawingEndpoints?: Readonly<{ from: Point; to: Point }>;
  /** Presentation of free ends in an isolated drawing copy. */
  readonly drawingEndStyles?: Readonly<{ from: WireBlankEnd; to: WireBlankEnd }>;
  /** Physical source length. Null means that the wire is intentionally incomplete. */
  readonly lengthMm: number | null;
  /** Signed technological correction at the `from` end, in millimetres. */
  readonly endCorrectionFromMm: number;
  /** Signed technological correction at the `to` end, in millimetres. */
  readonly endCorrectionToMm: number;
  /** Positive step used to round only the final cut length upwards. */
  readonly cutRoundingStepMm: number;
  readonly e4Route: readonly Point[];
  /** Missing in older documents and treated as automatic. */
  readonly e4RouteMode?: "auto" | "manual";
  /** Normalized distance along the complete E4 route. Missing means centered. */
  readonly e4LabelPosition?: number;
  readonly drawingRoute: readonly Point[];
  readonly layerIds: Readonly<Record<EditorView, string>>;
}
export interface WireColorSource {
  readonly connectorId: string;
  readonly contactId: string;
}
/**
 * Stable catalog identity and compact display snapshot stored with a wire.
 * The snapshot identity prevents a later catalog publication from silently
 * changing the material selected for an existing harness.
 */
export interface WireMaterialBinding {
  readonly outerDiameterMm?: number;
  /** Unit belonging to the selected catalogue section; it is never converted. */
  readonly sectionUnit?: "awg" | "mm2";
  readonly sourceId: string;
  readonly snapshotId: string;
  readonly snapshotSha256: string;
  readonly recordId: string;
  readonly entityType: "wire" | "cable";
  readonly sourceKey: string;
  readonly displayName: string;
}
/**
 * One physical multicore cable. Its electrical conductors remain regular
 * wires, while material consumption and cut length belong to this container.
 */
export interface CableInstance {
  readonly id: string;
  readonly memberWireIds: readonly string[];
  readonly materialBinding?: WireMaterialBinding;
  readonly lengthMm: number | null;
  readonly endCorrectionFromMm: number;
  readonly endCorrectionToMm: number;
  readonly cutRoundingStepMm: number;
  readonly sheathStrip?: { readonly fromMm: number | null; readonly toMm: number | null };
}
export interface WireEndStripProfiles {
  readonly from?: WireStripProfileBinding;
  readonly to?: WireStripProfileBinding;
}
/**
 * Exact catalog snapshot and normalized layer geometry for one end treatment.
 * Layer indices run from the central conductor outwards. Both diameter and
 * cumulative strip length therefore grow with the index.
 */
export interface WireStripProfileBinding {
  readonly sourceId: string;
  readonly snapshotId: string;
  readonly snapshotSha256: string;
  readonly recordId: string;
  readonly entityType: "coax-termination";
  readonly sourceKey: string;
  readonly displayName: string;
  readonly layers: readonly WireStripProfileLayer[];
}
export interface WireStripProfileLayer {
  readonly index: number;
  readonly diameterMm: number;
  /** Cumulative length from the common cut end, in millimetres. */
  readonly stripLengthMm: number;
}
export interface WireStripStep {
  readonly index: number;
  readonly diameterMm: number;
  readonly cumulativeLengthMm: number;
  /** Length added outside the previous, more internal layer. */
  readonly stepLengthMm: number;
}
export interface WireCutLengthCalculation {
  readonly sourceLengthMm: number | null;
  readonly endCorrectionFromMm: number;
  readonly endCorrectionToMm: number;
  readonly cutRoundingStepMm: number;
  readonly unroundedTotalMm: number | null;
  readonly cutLengthMm: number | null;
  readonly materialConsumptionMm: number | null;
  readonly isComplete: boolean;
}
export interface EditorLayer {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly visible: boolean;
  readonly locked: boolean;
}
export interface EditorViewState {
  readonly layers: readonly EditorLayer[];
  readonly wireCrossingStyle: WireCrossingStyle;
  /** E4 automatic/manual route geometry. Missing legacy values are orthogonal. */
  readonly e4RoutingMode?: "orthogonal" | "angular";
}
export interface HarnessDesignDocument {
  readonly drawingDocuments?: DrawingDocuments;
  readonly physicalTopology?: PhysicalTopology;
  readonly schemaVersion: 1;
  /** Minimum writer contract required to safely preserve this document. */
  readonly requiredWriterContractVersion?: 1 | 2 | 3;
  readonly terminations?: TerminationDocument;
  readonly manufacturingRoute?: ManufacturingRoute;
  /** User-created wire colors retained by this harness even when temporarily unused. */
  readonly customWireColors?: readonly string[];
  readonly connectors: readonly ConnectorInstance[];
  readonly wires: readonly WireInstance[];
  readonly cables: readonly CableInstance[];
  readonly junctions: readonly E4Junction[];
  readonly diffPairs: readonly DiffPairGroup[];
  readonly screens: readonly WireScreenGroup[];
  readonly views: Readonly<Record<EditorView, EditorViewState>>;
}
export interface WireScreenConnectionGeometry {
  readonly center: Point;
  readonly bodyConnectionPoint: Point;
  readonly connectionPoint: Point;
  readonly terminalSide: WireScreenEndpointSide;
  readonly terminals: readonly {
    readonly side: WireScreenEndpointSide;
    readonly bodyConnectionPoint: Point;
    readonly connectionPoint: Point;
  }[];
  readonly orientation: "horizontal" | "vertical";
  readonly alongSize: number;
  readonly crossSize: number;
}
