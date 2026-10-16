import { type TerminationCommand } from "./termination-commands";
import { type Point, type ConnectorInstance, type EditorView, type ConnectorContact, type ConnectorLibraryBinding, type WireMaterialBinding, type ConnectorContactStatus, type ConnectorBaseColumnKey, type ConnectorCustomField, type WireInstance, type CableInstance, type WireColorSource, type WireStripProfileBinding, type WireEndpoint, type WireCrossingStyle, type E4Junction, type DiffPairGroup, type WireScreenGroup, type EditorLayer } from "./model";
import { type PhysicalDragMode } from "./physical-editing";
import { type DimensionMode } from "./drawing-dimensions";
import { type DrawingDocuments } from "./drawing-documents";
import { type PhysicalTopology } from "./physical-topology-model";
import { type CoveringLibrary } from "./covering-library";
import { type WireBlankEnd } from "../WireBlankCatalog";

export type EditorCommand =
  | TerminationCommand
  | {readonly type:"edit-detached-wire-bend";readonly wireId:string;readonly index:number;readonly position:Point;readonly insert?:boolean}
  | {readonly type:"remove-detached-wire-bend";readonly wireId:string;readonly index:number}
  | {readonly type:"set-detached-wire-pair";readonly wireIds:readonly string[];readonly action:"twist"|"straighten";readonly groupId?:string;readonly step?:number;readonly amplitude?:number;readonly variant?:1|2}
  | {readonly type:"edit-e4-bend";readonly wireId:string;readonly index:number;readonly position:Point;readonly mode:PhysicalDragMode;readonly insert?:boolean}
  | {readonly type:"add-visible-pipe-dimension";readonly id:string;readonly segmentId:string;readonly from:number;readonly to:number;readonly pointCount:number;readonly mode:DimensionMode;readonly auxiliary?:boolean}
  | {readonly type:"remove-physical-bend";readonly segmentId:string;readonly index:number}
  | {readonly type:"edit-physical-bend";readonly segmentId:string;readonly index:number;readonly position:Point;readonly mode:PhysicalDragMode;readonly insert?:boolean;readonly region?:"before-enter"|"enter"|"axis"|"exit"|"after-exit";readonly displayPosition?:Point;readonly displayOrigin?:Point}
  | {readonly type:"move-physical-node";readonly nodeId:string;readonly position:Point;readonly mode:PhysicalDragMode}
  | {readonly type:"set-drawing-documents"; readonly documents:DrawingDocuments}
  | { readonly type: "set-physical-topology"; readonly topology: PhysicalTopology; readonly coveringLibrary?:CoveringLibrary }
  | { readonly type: "remove-physical-segment"; readonly segmentId: string }
  | { readonly type: "edit-joining-pipe-bend"; readonly pipeId:string; readonly index:number; readonly position:Point; readonly mode:PhysicalDragMode; readonly insert?:boolean; readonly remove?:boolean }
  | { readonly type: "move-joining-pipe"; readonly pipeId:string; readonly delta:Point }
  | { readonly type: "update-joining-pipe-exit"; readonly pipeId:string; readonly side:"from"|"to"; readonly position:Point }
  | { readonly type: "update-joining-pipe-member-bend"; readonly pipeId:string; readonly memberIndex:number; readonly side:"enter"|"exit"; readonly position?:Point; readonly clear?:boolean; readonly mode?:PhysicalDragMode; readonly origin?:Point; readonly outerOrigin?:Point }
  | { readonly type: "update-joining-pipe-member-boundary"; readonly pipeId:string; readonly memberIndex:number; readonly boundary:"outerEnter"|"axisEnter"|"axisExit"|"outerExit"; readonly origin:Point; readonly position:Point }
  | { readonly type: "clear-joining-pipe-member-boundary"; readonly pipeId:string; readonly memberIndex:number; readonly boundary:"outerEnter"|"outerExit" }
  | { readonly type: "update-joining-pipe"; readonly pipeId:string; readonly start?:Point; readonly end?:Point; readonly mode?:"flat"|"round"; readonly width?:number; readonly color?:string; readonly opacity?:number; readonly volumeShading?:boolean }
  | { readonly type: "add-connector"; readonly connector: ConnectorInstance }
  | { readonly type: "set-drawing-placement"; readonly connectorId:string; readonly drawingId:string; readonly scale?:number; readonly rotationDegrees?:number; readonly rotationCenter?:Point; readonly visible?:boolean; readonly offset?:Point }
  /** Creates, updates or removes the reserved Drawing copy of the E4 contact-side view. */
  | { readonly type: "set-contact-side-view"; readonly connectorId:string; readonly visible?:boolean; readonly offset?:Point; readonly scale?:number; readonly rotationDegrees?:number; readonly remove?:boolean }
  | { readonly type: "use-e4-table"; readonly connectorId: string }
  | { readonly type: "refresh-template-terminals"; readonly connectorId: string; readonly catalog: NonNullable<ConnectorInstance["terminalCatalog"]> }
  | { readonly type: "move-connector"; readonly connectorId: string; readonly view: EditorView; readonly position: Point; readonly physicalDragMode?:PhysicalDragMode }
  | { readonly type: "update-connector"; readonly connectorId: string; readonly designation: string; readonly partNumber?: string; readonly libraryCode?: string }
  | { readonly type: "apply-connector-article"; readonly connectorId: string; readonly partNumber: string; readonly contacts: readonly ConnectorContact[]; readonly libraryBinding: ConnectorLibraryBinding }
  | { readonly type: "apply-template-article"; readonly connectorId: string; readonly connector: ConnectorInstance }
  | { readonly type: "flip-connector-orientation"; readonly connectorId: string }
  | { readonly type: "update-contact"; readonly connectorId: string; readonly contactId: string; readonly nameOverride?: string; readonly number?: number; readonly contactType?: string; readonly circuit?: string; readonly terminalArticle?: string; readonly terminalDetails?: ConnectorContact["terminalDetails"]; readonly wire?: string; readonly wireSection?: string; readonly wireDiameterMm?:number|null; readonly materialBinding?: WireMaterialBinding | null; readonly color?: string; readonly secondaryColor?: string; readonly connectionStatus?: ConnectorContactStatus; readonly customValues?: Readonly<Record<string, string>> }
  | { readonly type: "reset-contact-color-auto"; readonly connectorId: string; readonly contactId: string }
  | { readonly type: "add-contact"; readonly connectorId: string; readonly contact: ConnectorContact }
  | { readonly type: "remove-contact"; readonly connectorId: string; readonly contactId: string }
  | { readonly type: "move-contact-row"; readonly connectorId: string; readonly contactId: string; readonly direction: -1 | 1 }
  | { readonly type: "set-name-column-visibility"; readonly connectorId: string; readonly visible: boolean; readonly scope?: "document" }
  | { readonly type: "toggle-base-column-visibility"; readonly connectorId: string; readonly key: ConnectorBaseColumnKey }
  | { readonly type: "add-custom-field"; readonly connectorId: string; readonly field: ConnectorCustomField }
  | { readonly type: "remove-custom-field"; readonly connectorId: string; readonly fieldId: string }
  | { readonly type: "toggle-custom-field-visibility"; readonly connectorId: string; readonly fieldId: string }
  | { readonly type: "remove-connector"; readonly connectorId: string }
  | { readonly type: "add-wire"; readonly wire: WireInstance; readonly targetWireId?: string }
  | { readonly type: "remove-wire"; readonly wireId: string }
  | { readonly type: "add-cable"; readonly cable: CableInstance }
  | { readonly type: "update-cable"; readonly cableId: string; readonly materialBinding?: WireMaterialBinding | null; readonly lengthMm?: number | null; readonly endCorrectionFromMm?: number; readonly endCorrectionToMm?: number; readonly cutRoundingStepMm?: number; readonly sheathStrip?: CableInstance["sheathStrip"] | null }
  | { readonly type: "set-cable-members"; readonly cableId: string; readonly memberWireIds: readonly string[] }
  | { readonly type: "remove-cable"; readonly cableId: string }
  | { readonly type: "update-wire"; readonly wireId: string; readonly circuit?: string; readonly color?: string; readonly colorSource?: WireColorSource|null; readonly secondaryColor?: string; readonly wireMark?: string; readonly wireSection?: string; readonly wireDiameterMm?:number|null; readonly materialBinding?: WireMaterialBinding | null; readonly lengthMm?: number | null; readonly endCorrectionFromMm?: number; readonly endCorrectionToMm?: number; readonly cutRoundingStepMm?: number }
  | { readonly type: "set-wire-strip-profile"; readonly wireId: string; readonly end: "from" | "to"; readonly profile: WireStripProfileBinding | null }
  | { readonly type: "set-wire-drawing-end-style"; readonly wireId: string; readonly end: "from" | "to"; readonly style: WireBlankEnd }
  | { readonly type: "set-wire-drawing-endpoint"; readonly wireId: string; readonly end: "from" | "to"; readonly position: Point }
  | { readonly type: "set-wire-drawing-end-styles"; readonly wireIds: readonly string[]; readonly end: "from" | "to"; readonly style: WireBlankEnd }
  | { readonly type: "set-wire-drawing-endpoints-x"; readonly wireIds: readonly string[]; readonly end: "from" | "to"; readonly x: number }
  | { readonly type: "set-e4-wire-label-position"; readonly wireId: string; readonly position: number }
  | { readonly type: "reconnect-wire"; readonly wireId: string; readonly end: "from" | "to"; readonly endpoint: WireEndpoint }
  | { readonly type: "set-wire-route"; readonly wireId: string; readonly route: readonly Point[] }
  | { readonly type: "set-e4-wire-route"; readonly wireId: string; readonly route: readonly Point[] }
  | { readonly type: "move-e4-wire-route-point"; readonly wireId: string; readonly pointIndex: number; readonly position: Point }
  | { readonly type: "remove-e4-wire-route-point"; readonly wireId: string; readonly pointIndex: number }
  | { readonly type: "move-e4-wire-segment"; readonly wireId: string; readonly segmentIndex: number; readonly position: Point; readonly detached?: boolean }
  | { readonly type: "reroute-e4-wires"; readonly wireIds: readonly string[] }
  | { readonly type: "set-wire-crossing-style"; readonly view: EditorView; readonly style: WireCrossingStyle }
  | { readonly type: "set-e4-routing-mode"; readonly mode: "orthogonal" | "angular" }
  | { readonly type: "create-junction"; readonly junction: E4Junction; readonly branchWire?: WireInstance }
  | { readonly type: "move-junction"; readonly junctionId: string; readonly position: Point }
  | { readonly type: "remove-junction"; readonly junctionId: string }
  | { readonly type: "connect-wire-to-junction"; readonly wireId: string; readonly end: "from" | "to"; readonly junctionId: string }
  | { readonly type: "connect-wire-to-wire"; readonly wireId: string; readonly end: "from" | "to"; readonly targetWireId: string; readonly junctionId: string; readonly position: Point }
  | { readonly type: "create-diff-pair"; readonly group: DiffPairGroup }
  | { readonly type: "update-diff-pair"; readonly groupId: string; readonly variant?: 1 | 2; readonly step?: number; readonly amplitude?: number }
  | { readonly type: "remove-diff-pair"; readonly groupId: string }
  | { readonly type: "create-screen"; readonly screen: WireScreenGroup }
  | { readonly type: "update-screen"; readonly screenId: string; readonly wireIds?: readonly string[]; readonly position?: number; readonly label?: string; readonly width?: number; readonly terminalSide?: WireScreenGroup["terminalSide"] }
  | { readonly type: "remove-screen"; readonly screenId: string }
  | { readonly type: "update-layer"; readonly view: EditorView; readonly layerId: string; readonly visible?: boolean; readonly locked?: boolean }
  | { readonly type: "replace-layers"; readonly view: EditorView; readonly layers: readonly EditorLayer[] }
  | { readonly type: "move-layer"; readonly view: EditorView; readonly layerId: string; readonly direction: -1 | 1 };
