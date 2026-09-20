import { PhysicalCoveringsPanel } from "./PhysicalCoveringsPanel";
import { coveringPaths, coveringMaterial } from "./physical-coverings";
import { PhysicalTopologyPanel } from "./PhysicalTopologyPanel";
import { physicalNodePoint, physicalSegmentPoints, physicalWirePoints } from "./physical-topology";
import { projectE4DrawingCompanions } from "./component-template-view-renderer";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { applyEditorCommand, createWire, e4RoutingIssues, type EditorCommand } from "./commands";
import { InfoHint } from "../InfoHint";
import { terminalArticleLabel } from "./terminal-article-label";
import { refreshedTemplateTerminalCatalog } from "./template-terminal-catalog";
import {
  createHarnessDesignApi,
  parseRecoverableHarnessDesignContent,
  type HarnessDesignApi,
  type HarnessDesignResource,
} from "./design-api";
import { DesignSaveCoordinator } from "./design-save-coordinator";
import {
  readHarnessDesignRecoveryDraft,
  removeHarnessDesignRecoveryDraft,
  writeHarnessDesignRecoveryDraft,
} from "./design-recovery-draft";
import {
  createComponentPlacementApi,
  componentPlacementRequest,
  type PlaceComponentRequest,
  type ProjectComponentPlacementGraph,
  type ProjectComponentSnapshotResource,
} from "./component-placement-api";
import { createComponentTemplateApi, type ComponentTemplateApi } from "../component-library/component-template-api";
import { isTemplateContentV3, isTemplateContentV4, isTemplateContentV5 } from "../component-library/template-content";
import {
  createConnectorInstanceFromComponentTemplateV3,
  firstPlaceableArticleVariantId,
  rematerializeComponentTemplateConnectorArticle,
} from "./component-template-placement";
import {
  materializedContactWorldRepresentation,
  selectMaterializedContactRepresentation,
} from "./materialized-contact-representation";
import type { ComponentTemplateViewInstance } from "./component-template-view-renderer";
import { useEditorReferenceCatalog, useTerminalArticleLookup } from "./editor-reference-catalog";
import type { EditorCatalogItem, EditorLayer as UiLayer, EditorSceneObject, HarnessEditorView } from "./editor-types";
import { HarnessEditorWorkspace, type EditorSaveState } from "./HarnessEditorWorkspace";
import { CableSelectionPanel } from "./CableSelectionPanel";
import { E4ConnectorInspector } from "./E4ConnectorInspector";
import { collectE4Diagnostics } from "./e4-diagnostics";
import {
  builtInConnectorSeries,
  createBuiltInConnectorInstance,
} from "./connector-series-demo";
import type { E4DifferentialPairState, E4ScreenState } from "./e4-wire-selection-state";
import { builtInWireColors, createCustomWireColor, resolveWireColorHex } from "./wire-reference-catalog";
import { buildWireStripProfileGeometry } from "./wire-strip-profile-geometry";
import { createEditorHistory, executeEditorCommand, redoEditorCommand, undoEditorCommand, type EditorHistory } from "./history";
import {
  connectorContactPosition,
  connectorE4TableGeometry,
  connectorContactName,
  calculateWireCutLength,
  createJunctionEndpoint,
  createScreenEndpoint,
  createOrthogonalE4Route,
  createEmptyHarnessDesign,
  findWireEndpoint,
  isJunctionEndpoint,
  isScreenEndpoint,
  wireEndpointE4Anchor,
  type EditorLayer,
  type HarnessDesignDocument,
  type WireEndpoint,
  type WireEndStripProfiles,
  type WireStripProfileBinding,
} from "./model";

import { buildHarnessSelectionIndex, resolveHarnessSelection } from "./harness-selection";
import { HarnessRelationsPanel } from "./HarnessRelationsPanel";

export interface HarnessDesignEditorProps {
  readonly config: RuntimeConfig;
  readonly session: LocalSession;
  readonly projectId: string;
  readonly harnessId: string;
  readonly harnessDesignation: string;
  readonly initialView: HarnessEditorView;
  readonly harnessQuantity?: number;
  readonly initialReveal?: { readonly projectId: string; readonly harnessId: string; readonly objectId: string };
  readonly apiOverride?: HarnessDesignApi;
  readonly componentPlacementApiOverride?: ReturnType<typeof createComponentPlacementApi>;
  readonly onClose?: () => void;
  readonly onViewChange?: (view: HarnessEditorView) => void;
}

export type ProjectComponentSnapshotLookup = ReadonlyMap<string, ProjectComponentSnapshotResource>;

/** Resolves every project placement to the exact immutable snapshot returned for this harness. */
export function buildProjectComponentSnapshotLookup(
  graph: ProjectComponentPlacementGraph,
): ProjectComponentSnapshotLookup {
  const snapshots = new Map(graph.snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]));
  const result = new Map<string, ProjectComponentSnapshotResource>();
  for (const placement of graph.placements) {
    const snapshot = snapshots.get(placement.snapshotId);
    if (!snapshot) throw new Error("Для библиотечного компонента отсутствует закреплённый снимок.");
    if (result.has(placement.placementId)) {
      throw new Error("Сервер вернул повторяющееся размещение библиотечного компонента.");
    }
    result.set(placement.placementId, snapshot);
  }
  return result;
}

/** Keeps a graph response from an editor generation that is no longer visible out of current state. */
export function acceptProjectComponentSnapshotLookup(
  current: ProjectComponentSnapshotLookup,
  graph: ProjectComponentPlacementGraph,
  responseGeneration: number,
  currentGeneration: number,
): ProjectComponentSnapshotLookup {
  return responseGeneration === currentGeneration
    ? buildProjectComponentSnapshotLookup(graph)
    : current;
}

/** Builds render inputs only when the editable instance still matches its project-owned snapshot. */
export function buildComponentTemplateViewInstances(
  document: HarnessDesignDocument,
  snapshotsByPlacement: ProjectComponentSnapshotLookup,
): readonly ComponentTemplateViewInstance[] {
  return document.connectors.flatMap((connector): readonly ComponentTemplateViewInstance[] => {
    const binding = connector.libraryBinding;
    const snapshot = snapshotsByPlacement.get(connector.id);
    if (binding?.mode !== "template" || !snapshot ||
        (!isTemplateContentV3(snapshot.content) && !isTemplateContentV4(snapshot.content) && !isTemplateContentV5(snapshot.content))) return [];
    const articleVariant = snapshot.content.articleVariants.find((candidate) => candidate.id === binding.articleVariantId);
    const exactVersion = binding.templateId === snapshot.sourceTemplateId &&
      binding.templateVersion === snapshot.sourceVersion &&
      binding.versionSha256 === snapshot.sourceVersionSha256;
    const exactArticle = articleVariant?.sourceId.trim().normalize("NFC").toLowerCase() === binding.article.sourceId &&
      articleVariant.entityType.trim().normalize("NFC").toLowerCase() === binding.article.entityType &&
      articleVariant.articleKey === binding.article.articleKey;
    if (!exactVersion || !exactArticle) return [];
    try {
      const materialized = createConnectorInstanceFromComponentTemplateV3({
        templateId: snapshot.sourceTemplateId,
        version: snapshot.sourceVersion,
        versionSha256: snapshot.sourceVersionSha256,
        code: snapshot.code,
        name: snapshot.name,
        articleBindings: snapshot.articleBindings,
        assets: snapshot.assets,
        content: snapshot.content,
      }, {
        id: connector.id,
        designation: connector.designation,
        articleVariantId: binding.articleVariantId,
        e4Position: connector.positions.e4,
        drawingPosition: connector.positions.drawing,
        layerIds: connector.layerIds,
      });
      const exactMaterialization = materialized.libraryBinding?.mode === "template" &&
        JSON.stringify(binding.snapshot) === JSON.stringify(materialized.libraryBinding.snapshot);
      if (!exactMaterialization) return [];
    } catch {
      return [];
    }
    return [{
      objectId: connector.id,
      snapshotId: snapshot.snapshotId,
      articleVariantId: binding.articleVariantId,
      content: snapshot.content,
      ...(connector.drawingPlacements ? {drawingPlacements:connector.drawingPlacements} : {}),
    }];
  });
}

interface PendingComponentPlacement {
  readonly body: PlaceComponentRequest;
  readonly nextHistory: EditorHistory;
  readonly connectorId: string;
  /** Prevents a late response for a previously opened harness changing the current editor. */
  readonly loadGeneration: number;
}

interface HarnessEditorErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onRecover: () => void;
  readonly onError: (message: string) => void;
}

interface HarnessEditorErrorBoundaryState {
  readonly error: Error | null;
}

/** Keeps an unexpected editor render failure visible and recoverable instead of leaving a blank page. */
export class HarnessEditorErrorBoundary extends Component<
  HarnessEditorErrorBoundaryProps,
  HarnessEditorErrorBoundaryState
> {
  override state: HarnessEditorErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): HarnessEditorErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    this.props.onError(error.message || "Ошибка отображения редактора.");
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <div className="he-loading error" role="alert">
      <strong>Редактор не смог отобразить последнее изменение.</strong>
      <span>{this.state.error.message}</span>
      <button type="button" onClick={() => {
        this.setState({ error: null });
        this.props.onRecover();
      }}>Вернуться к редактору</button>
    </div>;
  }
}

export function normalizeEditorSelection(
  selectedIds: readonly string[],
  selectedPrimaryId: string | null,
  availableObjectIds: ReadonlySet<string>,
): { readonly objectIds: readonly string[]; readonly primaryObjectId: string | null } {
  const objectIds = [...new Set(selectedIds)].filter((id) => availableObjectIds.has(id));
  const primaryObjectId = selectedPrimaryId && availableObjectIds.has(selectedPrimaryId)
    ? selectedPrimaryId
    : objectIds.at(-1) ?? null;
  if (primaryObjectId && !objectIds.includes(primaryObjectId)) objectIds.push(primaryObjectId);
  return { objectIds, primaryObjectId };
}

export function selectedEditorDeletionCommands(
  document: HarnessDesignDocument,
  selectedObjectIds: readonly string[],
): readonly EditorCommand[] {
  const selectedIds = new Set(selectedObjectIds);
  return [
    ...document.wires
      .filter((wire) => selectedIds.has(wire.id))
      .map((wire): EditorCommand => ({ type: "remove-wire", wireId: wire.id })),
    ...document.connectors
      .filter((connector) => selectedIds.has(connector.id))
      .map((connector): EditorCommand => ({ type: "remove-connector", connectorId: connector.id })),
  ];
}

function toUiLayers(document: HarnessDesignDocument, view: HarnessEditorView): readonly UiLayer[] {
  return [...document.views[view].layers]
    .sort((left, right) => right.order - left.order)
    .map((layer) => ({ id: layer.id, label: layer.name, visible: layer.visible, locked: layer.locked }));
}

function contactPointForWire(
  document: HarnessDesignDocument,
  endpoint: WireEndpoint,
  otherEndpoint: WireEndpoint,
  view: HarnessEditorView,
  materializedConnectorIds?: ReadonlySet<string>,
) {
  // Routing, screen ports and painting must share the exact same endpoints,
  // including when the graphical snapshot has not loaded yet.
  if (view === "e4") return wireEndpointE4Anchor(document, endpoint)?.position ?? null;
  if (isJunctionEndpoint(endpoint) || isScreenEndpoint(endpoint)) return findWireEndpoint(document, endpoint, view);
  const connectorId = endpoint.connectorId;
  const contactId = endpoint.contactId;
  const otherConnectorId = isJunctionEndpoint(otherEndpoint) || isScreenEndpoint(otherEndpoint)
    ? ""
    : otherEndpoint.connectorId;
  const connector = document.connectors.find((item) => item.id === connectorId);
  const other = document.connectors.find((item) => item.id === otherConnectorId);
  if (!connector) return null;
  const useMaterialized = connector.libraryBinding?.mode === "template" &&
    (materializedConnectorIds === undefined || materializedConnectorIds.has(connector.id));
  const materialized = useMaterialized
    ? materializedContactWorldRepresentation(connector, contactId, view)
    : null;
  if (materialized) return materialized.position;
  const fallbackConnector = connector.libraryBinding?.mode === "template"
    ? { ...connector, libraryBinding: { mode: "free" as const } }
    : connector;
  const point = connectorContactPosition(fallbackConnector, contactId, view);
  if (!point) return null;
  const height = Math.max(72, 44 + connector.contacts.length * 16);
  const useLeft = other ? other.positions[view].x < connector.positions[view].x : false;
  return {
    x: useLeft ? connector.positions[view].x : connector.positions[view].x + 118,
    y: Math.min(point.y, connector.positions[view].y + height - 12),
  };
}

/** Graph failures are retryable without replacing the editable harness document. */
export function ComponentGraphErrorAlert({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return <div className="he-save-message" role="alert">
    <span>{message}</span>
    <button type="button" onClick={onRetry}>Повторить загрузку видов</button>
  </div>;
}

export function designToScene(
  document: HarnessDesignDocument,
  view: HarnessEditorView,
  diagnosticObjectIds: ReadonlySet<string> = new Set(),
  materializedConnectorIds?: ReadonlySet<string>,
): readonly EditorSceneObject[] {
  const connectors: EditorSceneObject[] = document.connectors.map((connector) => {
    const geometry = view === "e4" ? connectorE4TableGeometry(connector) : null;
    const seriesBinding = connector.libraryBinding?.mode === "series" ? connector.libraryBinding : null;
    const metadata: Record<string, string> = { contactCount: String(connector.contacts.length) };
    if (connector.libraryBinding?.mode === "template" &&
        (materializedConnectorIds === undefined || materializedConnectorIds.has(connector.id))) {
      const materializedContactPoints = connector.contacts.map((contact) => {
        const representation = selectMaterializedContactRepresentation(connector, contact.id, view);
        return representation ? {
          x: representation.x,
          y: representation.y,
          direction: representation.direction,
          status: contact.connectionStatus,
        } : null;
      });
      if (materializedContactPoints.some((point) => point !== null)) {
        metadata.materializedContactPoints = JSON.stringify(materializedContactPoints);
      }
    }
    if (view === "e4" && geometry) {
      const columnIds = geometry.columns.map((column) => column.kind === "base"
        ? column.key
        : `custom:${column.id}`);
      const customLabels = Object.fromEntries(geometry.columns.flatMap((column) =>
        column.kind === "custom" ? [[`custom:${column.id}`, column.label]] : []));
      Object.assign(metadata, {
        view: "e4",
        orientation: connector.schematic.orientation === "contacts-left" ? "left" : "right",
        designation: connector.designation,
        libraryCode: seriesBinding
          ? builtInConnectorSeries.find((series) => series.id === seriesBinding.seriesId)?.name ?? seriesBinding.seriesId
          : connector.libraryCode ?? "FREE",
        partNumber: connector.partNumber,
        columns: JSON.stringify(columnIds),
        columnLabels: JSON.stringify(customLabels),
        rows: JSON.stringify(connector.contacts.map((contact) => ({
            number: contact.number,
            contactType: contact.contactType,
            circuit: contact.circuit,
            terminal: terminalArticleLabel(contact.terminalArticle),
            name: connectorContactName(connector, contact),
            wire: contact.wire,
            color: contact.color,
            secondaryColor: contact.secondaryColor ?? "",
            status: contact.connectionStatus,
            customValues: contact.customValues,
          }))),
        ...(diagnosticObjectIds.has(connector.id) ? { diagnostic: "error" } : {}),
      });
    }
    return {
      id: connector.id,
      layerId: connector.layerIds[view],
      kind: "connector" as const,
      label: connector.designation,
      x: connector.positions[view].x,
      y: connector.positions[view].y,
      width: geometry?.width ?? 118,
      height: geometry?.height ?? Math.max(72, 44 + connector.contacts.length * 16),
      color: "#416579",
      metadata,
    };
  });
  const wires: EditorSceneObject[] = document.wires.flatMap((wire, index) => {
    const start = contactPointForWire(document, wire.from, wire.to, view, materializedConnectorIds);
    const end = contactPointForWire(document, wire.to, wire.from, view, materializedConnectorIds);
    if (!start || !end) return [];
    const physicalPoints = view === "drawing" ? physicalWirePoints(document, wire.id, start, end) : null;
    const points = view === "drawing" ? physicalPoints ?? [start, ...wire.drawingRoute, end] : [start, ...wire.e4Route, end];
    const fromAnchor = view === "e4" ? wireEndpointE4Anchor(document, wire.from) : null;
    const toAnchor = view === "e4" ? wireEndpointE4Anchor(document, wire.to) : null;
    const cutLength = calculateWireCutLength(wire);
    const stripProfileDisplayWarning = view === "drawing"
      ? wireStripProfileDisplayWarning(points, wire.stripProfiles)
      : null;
    return [{
      id: wire.id,
      layerId: wire.layerIds[view],
      kind: "wire" as const,
      label: `${wire.circuit || `W${index + 1}`}${view === "drawing" && !physicalPoints && !wire.drawingRoute.length ? " · маршрут не задан" : ""}`,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      color: wire.color,
      points,
      ...(view === "drawing" && wire.stripProfiles ? { stripProfiles: wire.stripProfiles } : {}),
      metadata: {
        physicalRoute: String(!!physicalPoints),
        routeMissing: String(view === "drawing" && !physicalPoints && wire.drawingRoute.length === 0),
        lengthKnown: String(cutLength.isComplete),
        lengthMm: cutLength.sourceLengthMm === null ? "" : String(cutLength.sourceLengthMm),
        endCorrectionFromMm: String(cutLength.endCorrectionFromMm),
        endCorrectionToMm: String(cutLength.endCorrectionToMm),
        cutRoundingStepMm: String(cutLength.cutRoundingStepMm),
        cutLengthMm: cutLength.cutLengthMm === null ? "" : String(cutLength.cutLengthMm),
        materialStatus: cutLength.materialConsumptionMm === null ? "excluded" : "included",
        materialSourceKey: wire.materialBinding?.sourceKey ?? "",
        materialDisplayName: wire.materialBinding?.displayName ?? "",
        materialEntityType: wire.materialBinding?.entityType ?? "",
        e4LabelPosition: String(wire.e4LabelPosition ?? 0.5),
        ...(stripProfileDisplayWarning ? { stripProfileDisplayWarning } : {}),
        ...(view === "e4" ? {
          view: "e4",
          fromSide: fromAnchor?.leadDirection ?? "",
          toSide: toAnchor?.leadDirection ?? "",
          leadLength: "24",
        } : {}),
      },
    }];
  });
  const dimensions: EditorSceneObject[] = view === "drawing" ? document.wires.flatMap((wire) => {
    const start = contactPointForWire(document, wire.from, wire.to, view, materializedConnectorIds);
    const end = contactPointForWire(document, wire.to, wire.from, view, materializedConnectorIds);
    if (!start || !end) return [];
    const y = Math.max(start.y, end.y) + 70;
    const cutLength = calculateWireCutLength(wire);
    return [{
      id: `dimension:${wire.id}`,
      layerId: "dimensions",
      kind: "dimension" as const,
      label: cutLength.sourceLengthMm === null ? "Длина не задана" : `${cutLength.sourceLengthMm} мм`,
      x: 0, y: 0, width: 0, height: 0, color: "#55798e",
      points: [{ x: start.x, y }, { x: end.x, y }],
    }];
  }) : [];
  const physical: EditorSceneObject[] = view === "drawing" && document.physicalTopology ? [
    ...document.physicalTopology.segments.map((segment, i): EditorSceneObject => ({ id: segment.id, kind: "physical-segment", label: `S${i + 1}`, layerId: "wires", x: 0, y: 0, width: 0, height: 0, color: "#85a2b3", points: physicalSegmentPoints(document, segment) })),
    ...document.physicalTopology.nodes.map((node, i): EditorSceneObject => { const p = physicalNodePoint(document, node); return { id: node.id, kind: "physical-node", label: node.connectorId ? "Выход" : `Узел ${i + 1}`, layerId: "wires", x: p.x - 5, y: p.y - 5, width: 10, height: 10, color: "#1179ac" }; }),
  ] : [];
  const coverings: EditorSceneObject[] = view === "drawing" ? (document.physicalTopology?.coverings ?? []).map(c => { const paths=coveringPaths(document,c); return {id:c.id,kind:"physical-covering" as const,layerId:"wires",x:0,y:0,width:c.width,height:0,color:c.color,label:c.name,points:paths.flat(),paths}; }) : [];
  return [...connectors, ...coverings, ...physical, ...wires, ...dimensions];
}

type WireUpdateCommand = Extract<EditorCommand, { readonly type: "update-wire" }>;

export type WireMaterialCatalogUpdateResult =
  | { readonly ok: true; readonly command: WireUpdateCommand }
  | { readonly ok: false; readonly error: string };

/** Builds an immutable material assignment without depending on editor or React state. */
export function wireMaterialUpdateFromCatalogItem(
  item: EditorCatalogItem,
  selectedWireId: string | null,
): WireMaterialCatalogUpdateResult {
  if (!selectedWireId) {
    return { ok: false, error: "Сначала выберите один провод, затем дважды щёлкните материал в справочнике." };
  }
  if (item.entityType !== "wire" && item.entityType !== "cable") {
    return { ok: false, error: "Выбранная справочная позиция не является проводом или кабелем." };
  }
  if (!item.sourceId || !item.snapshotId || !item.snapshotSha256 || !item.recordId || !item.sourceKey) {
    return { ok: false, error: "Справочная позиция не содержит данных опубликованной версии." };
  }
  return {
    ok: true,
    command: {
      type: "update-wire",
      wireId: selectedWireId,
      materialBinding: {
        sourceId: item.sourceId,
        snapshotId: item.snapshotId,
        snapshotSha256: item.snapshotSha256,
        recordId: item.recordId,
        entityType: item.entityType,
        sourceKey: item.sourceKey,
        displayName: item.referenceDisplayName || item.sourceKey,
      },
    },
  };
}

export async function loadComponentTemplateForPlacement(
  api: ComponentTemplateApi,
  templateId: string,
  catalogVersion: number,
) {
  const draft = await api.getDraft(templateId);
  return draft
    ? api.publishDraft(templateId, draft.baseVersion, draft.draftRevision)
    : api.getVersion(templateId, catalogVersion);
}

type CableUpdateCommand = Extract<EditorCommand, { readonly type: "update-cable" }>;

export function cableMaterialUpdateFromCatalogItem(
  item: EditorCatalogItem,
  cableId: string | null,
): { readonly ok: true; readonly command: CableUpdateCommand } | { readonly ok: false; readonly error: string } {
  if (!cableId) return { ok: false, error: "Сначала создайте кабель из выбранных проводов." };
  if (item.entityType !== "cable") return { ok: false, error: "Для общего материала выберите кабель." };
  if (!item.sourceId || !item.snapshotId || !item.snapshotSha256 || !item.recordId || !item.sourceKey) {
    return { ok: false, error: "Справочная позиция не содержит данных опубликованной версии." };
  }
  return { ok: true, command: { type: "update-cable", cableId, materialBinding: {
    sourceId: item.sourceId, snapshotId: item.snapshotId, snapshotSha256: item.snapshotSha256,
    recordId: item.recordId, entityType: "cable", sourceKey: item.sourceKey,
    displayName: item.referenceDisplayName || item.sourceKey,
  } } };
}

/** Reports saved end treatments that cannot be projected on the current route. */
export function wireStripProfileDisplayWarning(
  points: readonly { readonly x: number; readonly y: number }[],
  profiles: WireEndStripProfiles | undefined,
): string | null {
  if (!profiles) return null;
  const hiddenEnds = (["from", "to"] as const).filter((end) => {
    const profile = profiles[end];
    return profile !== undefined && buildWireStripProfileGeometry(points, end, profile) === null;
  });
  return hiddenEnds.length > 0 ? hiddenEnds.join(",") : null;
}

type WireStripProfileCommand = Extract<EditorCommand, { readonly type: "set-wire-strip-profile" }>;

export type WireStripProfileCatalogUpdateResult =
  | { readonly ok: true; readonly command: WireStripProfileCommand }
  | { readonly ok: false; readonly error: string };

/** Builds an exact end-treatment assignment from a published БД.КОАКС row. */
export function wireStripProfileUpdateFromCatalogItem(
  item: EditorCatalogItem,
  selectedWireId: string | null,
  end: "from" | "to",
  disabled = false,
): WireStripProfileCatalogUpdateResult {
  if (!selectedWireId) {
    return { ok: false, error: "Сначала выберите один провод на чертеже, затем профиль разделки." };
  }
  if (disabled) return { ok: false, error: "Слой выбранного провода заблокирован." };
  if (item.entityType !== "coax-termination" || !item.coaxTerminationCandidate) {
    return { ok: false, error: "Выбранная справочная позиция не является профилем разделки." };
  }
  const candidate = item.coaxTerminationCandidate;
  if (candidate.state !== "ready" || !candidate.binding) {
    return {
      ok: false,
      error: candidate.diagnostics[0]?.message || "Профиль разделки заполнен не полностью.",
    };
  }
  const profile: WireStripProfileBinding = {
    ...candidate.binding,
    displayName: item.referenceDisplayName || item.title || candidate.binding.sourceKey,
  };
  return { ok: true, command: { type: "set-wire-strip-profile", wireId: selectedWireId, end, profile } };
}

/** Translates inspector metadata into a command while preserving omitted-versus-null length semantics. */
export function editorWireUpdateCommand(
  selected: EditorSceneObject,
  previous: EditorSceneObject,
): WireUpdateCommand {
  const parseMetadataNumber = (key: string): number | undefined => {
    const value = selected.metadata?.[key];
    if (value === undefined || value.trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const lengthKnownChanged = selected.metadata?.lengthKnown !== previous.metadata?.lengthKnown;
  const lengthChanged = selected.metadata?.lengthMm !== previous.metadata?.lengthMm;
  const lengthMm = parseMetadataNumber("lengthMm");
  const endCorrectionFromMm = parseMetadataNumber("endCorrectionFromMm");
  const endCorrectionToMm = parseMetadataNumber("endCorrectionToMm");
  const cutRoundingStepMm = parseMetadataNumber("cutRoundingStepMm");
  return {
    type: "update-wire",
    wireId: selected.id,
    circuit: selected.label === previous.label ? undefined : selected.label,
    color: selected.color === previous.color ? undefined : selected.color,
    lengthMm: lengthKnownChanged && selected.metadata?.lengthKnown === "false"
      ? null
      : selected.metadata?.lengthKnown === "true" && (lengthKnownChanged || lengthChanged) && lengthMm !== undefined
        ? lengthMm
        : undefined,
    endCorrectionFromMm: selected.metadata?.endCorrectionFromMm !== previous.metadata?.endCorrectionFromMm
      ? endCorrectionFromMm : undefined,
    endCorrectionToMm: selected.metadata?.endCorrectionToMm !== previous.metadata?.endCorrectionToMm
      ? endCorrectionToMm : undefined,
    cutRoundingStepMm: selected.metadata?.cutRoundingStepMm !== previous.metadata?.cutRoundingStepMm
      ? cutRoundingStepMm : undefined,
  };
}

function fromUiLayers(layers: readonly UiLayer[], previous: readonly EditorLayer[]): readonly EditorLayer[] {
  return layers.map((layer, index) => ({
    id: layer.id,
    name: previous.find((item) => item.id === layer.id)?.name ?? layer.label,
    order: layers.length - index - 1,
    visible: layer.visible,
    locked: layer.locked,
  }));
}

export function snapRoutePoint(
  start: { readonly x: number; readonly y: number },
  point: { readonly x: number; readonly y: number },
  enabled: boolean,
) {
  if (!enabled) return point;
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const distance = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + Math.cos(angle) * distance, y: start.y + Math.sin(angle) * distance };
}

export function HarnessDesignEditor({
  config,
  session,
  projectId,
  harnessId,
  harnessDesignation,
  initialView, harnessQuantity = 1, initialReveal,
  apiOverride,
  componentPlacementApiOverride,
  onClose,
  onViewChange,
}: HarnessDesignEditorProps) {
  const api = useMemo(() => apiOverride ?? createHarnessDesignApi(config, session), [apiOverride, config, session]);
  const componentTemplateApi = useMemo(() => createComponentTemplateApi(config, session), [config, session]);
  const componentPlacementApi = useMemo(
    () => componentPlacementApiOverride ?? createComponentPlacementApi(config, session),
    [componentPlacementApiOverride, config, session],
  );
  const catalog = useEditorReferenceCatalog(config, session);
  const terminalLookup = useTerminalArticleLookup(config, session);
  const [view, setView] = useState<HarnessEditorView>(initialView);
  const [resource, setResource] = useState<HarnessDesignResource | null>(null);
  const [history, setHistory] = useState<EditorHistory | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedObjectIds, setSelectedObjectIds] = useState<readonly string[]>([]);
  const [relatedSourceIds, setRelatedSourceIds] = useState<readonly string[]>([]);
  const [wholeNet, setWholeNet] = useState(false);
  const [revealRequest, setRevealRequest] = useState<{token: number; objectIds: readonly string[]} | undefined>();
  const selectionIndex = useMemo(() => history ? buildHarnessSelectionIndex(history.present) : null, [history?.present]);
  const related = useMemo(() => selectionIndex ? resolveHarnessSelection(selectionIndex, relatedSourceIds.length ? relatedSourceIds : selectedObjectIds, wholeNet) : {wireIds: [], componentIds: [], rowIds: [], unresolvedIds: []}, [selectionIndex, relatedSourceIds, selectedObjectIds, wholeNet]);
  const [activeWireStripEnd, setActiveWireStripEnd] = useState<"from" | "to">("from");
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<EditorSaveState>("saved");
  const [drawingSnapEnabled, setDrawingSnapEnabled] = useState(true);
  const [e4Detached, setE4Detached] = useState(false);
  const [refreshingTerminals, setRefreshingTerminals] = useState(false);
  const [uiFailureNonce, setUiFailureNonce] = useState(0);
  const [movePreview, setMovePreview] = useState<{
    readonly objectId: string;
    readonly point: { readonly x: number; readonly y: number };
  } | null>(null);
  const [message, setMessage] = useState("Загружаем документ жгута…");
  const [recoveryDraft, setRecoveryDraft] = useState<{
    readonly content: HarnessDesignDocument;
    readonly baseRevision: number;
  } | null>(null);
  const [componentSnapshotsByPlacement, setComponentSnapshotsByPlacement] =
    useState<ProjectComponentSnapshotLookup>(() => new Map());
  const [componentGraphMessage, setComponentGraphMessage] = useState("");
  const historyRef = useRef<EditorHistory | null>(null);
  const resourceRef = useRef<HarnessDesignResource | null>(null);
  const savedJsonRef = useRef("");
  const savingRef = useRef(false);
  const saveCoordinatorRef = useRef<DesignSaveCoordinator | null>(null);
  const loadGeneration = useRef(0);
  const componentGraphRequestGeneration = useRef(0);
  const previewFrameRef = useRef<number | null>(null);
  const pendingMovePreviewRef = useRef<typeof movePreview>(null);
  const placementBusyRef = useRef(false);
  const placementOperationRef = useRef<symbol | null>(null);
  const pendingPlacementRef = useRef<PendingComponentPlacement | null>(null);
  const [placementBusy, setPlacementBusy] = useState(false);
  const [placementPending, setPlacementPending] = useState(false);

  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { resourceRef.current = resource; }, [resource]);
  useEffect(() => setView(initialView), [initialView]);

  const refreshComponentGraph = useCallback(async (editorGeneration: number): Promise<void> => {
    const requestGeneration = ++componentGraphRequestGeneration.current;
    try {
      const graph = await componentPlacementApi.list(projectId, harnessId);
      if (editorGeneration !== loadGeneration.current ||
          requestGeneration !== componentGraphRequestGeneration.current) return;
      setComponentSnapshotsByPlacement((current) =>
        acceptProjectComponentSnapshotLookup(current, graph, editorGeneration, loadGeneration.current));
      setComponentGraphMessage("");
    } catch (error) {
      if (editorGeneration !== loadGeneration.current ||
          requestGeneration !== componentGraphRequestGeneration.current) return;
      setComponentSnapshotsByPlacement(new Map());
      setComponentGraphMessage(error instanceof Error
        ? `Не удалось загрузить закреплённые виды компонентов: ${error.message}`
        : "Не удалось загрузить закреплённые виды компонентов.");
    }
  }, [componentPlacementApi, harnessId, projectId]);
  const resolveComponentTemplateAssetUrl = useCallback(
    (snapshotId: string, assetId: string) =>
      componentPlacementApi.assetContentUrl(projectId, harnessId, snapshotId, assetId),
    [componentPlacementApi, harnessId, projectId],
  );

  useEffect(() => {
    const generation = ++loadGeneration.current;
    placementOperationRef.current = null;
    placementBusyRef.current = false;
    pendingPlacementRef.current = null;
    setPlacementBusy(false);
    setPlacementPending(false);
    setResource(null);
    setHistory(null);
    setSelectedObjectId(null);
    setSelectedObjectIds([]);
    setRelatedSourceIds([]); setWholeNet(false); setRevealRequest(undefined);
    setE4Detached(false);
    setEditingObjectId(null);
    setMovePreview(null);
    setComponentSnapshotsByPlacement(new Map());
    setComponentGraphMessage("");
    setMessage("Загружаем документ жгута…");
    setRecoveryDraft(null);
    setSaveState("saved");
    const designRequest = api.get(projectId, harnessId).then((loaded) => {
      if (generation !== loadGeneration.current) return;
      if (initialReveal?.projectId === projectId && initialReveal.harnessId === harnessId) {
        const found = resolveHarnessSelection(buildHarnessSelectionIndex(loaded.content), [initialReveal.objectId]);
        setRelatedSourceIds([initialReveal.objectId]);
        setRevealRequest({token: Date.now(), objectIds: [...found.wireIds, ...found.componentIds]});
      }
      const savedJson = JSON.stringify(loaded.content);
      let recoveryMessage = loaded.recoveryWarning ?? "";
      const draft = readHarnessDesignRecoveryDraft(window.localStorage, projectId, harnessId);
      if (draft) {
        try {
          const recoveredDraft = parseRecoverableHarnessDesignContent(draft.content);
          if (JSON.stringify(recoveredDraft.content) !== savedJson) {
            setRecoveryDraft({ content: recoveredDraft.content, baseRevision: draft.baseRevision });
            const revisionWarning = draft.baseRevision === loaded.revision
              ? ""
              : ` Черновик создан от ревизии ${draft.baseRevision}, на сервере уже ревизия ${loaded.revision}; после восстановления внимательно проверьте изменения.`;
            recoveryMessage = `Найдены несохранённые изменения этого жгута. Серверный документ открыт без изменений; восстановите черновик кнопкой ниже.${revisionWarning}`;
          } else {
            removeHarnessDesignRecoveryDraft(window.localStorage, projectId, harnessId);
          }
        } catch {
          recoveryMessage = `${recoveryMessage ? `${recoveryMessage} ` : ""}Найден локальный черновик, но он повреждён и не применён.`;
        }
      }
      setResource(loaded);
      setHistory(createEditorHistory(loaded.content));
      savedJsonRef.current = savedJson;
      setMessage(recoveryMessage);
    }).catch((error: unknown) => {
      if (generation !== loadGeneration.current) return;
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить документ жгута.");
    });

    const componentGraphRequest = refreshComponentGraph(generation);
    void Promise.allSettled([designRequest, componentGraphRequest]);
    return () => {
      loadGeneration.current += 1;
      componentGraphRequestGeneration.current += 1;
    };
  }, [api, harnessId, projectId, refreshComponentGraph]);

  const saveOnce = useCallback(async (): Promise<boolean> => {
      savingRef.current = true;
      try {
        const currentHistory = historyRef.current;
        const currentResource = resourceRef.current;
        if (!currentHistory || !currentResource) return true;
        const content = currentHistory.present;
        const serialized = JSON.stringify(content);
        if (serialized === savedJsonRef.current) return true;
        setSaveState("saving");
        const saved = await api.save(projectId, harnessId, currentResource.revision, content);
        const savedJson = JSON.stringify(saved.content);
        savedJsonRef.current = savedJson;
        resourceRef.current = saved;
        setResource(saved);
        if (historyRef.current === currentHistory) {
          const acknowledgedHistory = { ...currentHistory, present: saved.content };
          historyRef.current = acknowledgedHistory;
          setHistory(acknowledgedHistory);
          setSaveState("saved");
          if (!recoveryDraft) removeHarnessDesignRecoveryDraft(window.localStorage, projectId, harnessId);
        } else {
          setSaveState("changed");
        }
        setMessage(saved.recoveryWarning ?? "");
        return true;
      } catch (error: unknown) {
        setSaveState("error");
        setMessage(error instanceof Error ? error.message : "Не удалось сохранить документ жгута.");
        return false;
      } finally {
        savingRef.current = false;
      }
  }, [api, harnessId, projectId, recoveryDraft]);

  const flushSave = useCallback((): Promise<boolean> => {
    if (!saveCoordinatorRef.current) {
      saveCoordinatorRef.current = new DesignSaveCoordinator(saveOnce);
    }
    return saveCoordinatorRef.current.flush();
  }, [saveOnce]);

  useEffect(() => {
    saveCoordinatorRef.current = null;
  }, [saveOnce]);

  useEffect(() => {
    if (!history) return;
    if (JSON.stringify(history.present) === savedJsonRef.current) {
      if (!savingRef.current) setSaveState("saved");
      return;
    }
    const baseRevision = resourceRef.current?.revision;
    if (baseRevision !== undefined && !recoveryDraft) {
      writeHarnessDesignRecoveryDraft(
        window.localStorage,
        projectId,
        harnessId,
        baseRevision,
        history.present,
      );
    }
    setSaveState("changed");
    const timer = window.setTimeout(() => void flushSave(), 650);
    return () => window.clearTimeout(timer);
  }, [flushSave, harnessId, history, projectId, recoveryDraft]);

  useEffect(() => {
    if (!history) return;
    const availableObjectIds = new Set([
      ...history.present.connectors.map((item) => item.id),
      ...history.present.wires.map((item) => item.id),
      ...history.present.physicalTopology?.coverings?.map(c => c.id) ?? [],
      ...history.present.physicalTopology?.nodes.map(n => n.id) ?? [],
      ...history.present.physicalTopology?.segments.map(n => n.id) ?? [],
    ]);
    const normalized = normalizeEditorSelection(selectedObjectIds, selectedObjectId, availableObjectIds);
    if (normalized.primaryObjectId !== selectedObjectId) setSelectedObjectId(normalized.primaryObjectId);
    if (normalized.objectIds.length !== selectedObjectIds.length ||
        normalized.objectIds.some((id, index) => id !== selectedObjectIds[index])) {
      setSelectedObjectIds(normalized.objectIds);
    }
  }, [history, selectedObjectId, selectedObjectIds]);

  useEffect(() => {
    if (editingObjectId && (view !== "e4" || editingObjectId !== selectedObjectId)) setEditingObjectId(null);
  }, [editingObjectId, selectedObjectId, view]);

  useEffect(() => setActiveWireStripEnd("from"), [selectedObjectId]);

  const previewResult = useMemo(() => {
    if (!history) return { document: null, error: null };
    if (!movePreview) return { document: history.present, error: null };
    try {
      const topology = history.present.physicalTopology;
      const node = topology?.nodes.find(n => n.id === movePreview.objectId);
      if (node && topology) {
        const origin = history.present.connectors.find(c => c.id === node.connectorId)?.positions.drawing ?? {x:0,y:0};
        return { document: applyEditorCommand(history.present, {type:"set-physical-topology",topology:{...topology,nodes:topology.nodes.map(n => n.id===node.id ? {...n,position:{x:movePreview.point.x+5-origin.x,y:movePreview.point.y+5-origin.y}} : n)}}), error:null };
      }
      return { document: applyEditorCommand(history.present, {
        type: "move-connector",
        connectorId: movePreview.objectId,
        view,
        position: movePreview.point,
      }), error: null };
    } catch (error) {
      // An impossible placement still follows the pointer, but no previous
      // wire trace is drawn beneath it. Releasing it leaves the saved scene
      // intact and the normal command reports why it could not be placed.
      return {
        document: {
          ...history.present,
          connectors: history.present.connectors.map((connector) => connector.id === movePreview.objectId
            ? { ...connector, positions: { ...connector.positions, [view]: movePreview.point } }
            : connector),
          wires: history.present.wires.filter((wire) => ![wire.from, wire.to].some((endpoint) =>
            !isJunctionEndpoint(endpoint) && !isScreenEndpoint(endpoint) && endpoint.connectorId === movePreview.objectId)),
        },
        error: error instanceof Error ? error.message : "Трассировка невозможна.",
      };
    }
  }, [history, movePreview, view]);

  const routingIssues = useMemo(() => view === "e4" && previewResult.document
    ? e4RoutingIssues(previewResult.document) : [], [previewResult.document, view]);

  const run = useCallback((command: EditorCommand): boolean => {
    if (placementBusyRef.current || pendingPlacementRef.current) return false;
    const current = historyRef.current;
    if (!current) return false;
    try {
      const next = executeEditorCommand(current, command);
      historyRef.current = next;
      setHistory(next);
      setMessage("");
      return true;
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Не удалось изменить документ жгута.");
      return false;
    }
  }, []);

  const previewObjectMove = useCallback((objectId: string, point: { readonly x: number; readonly y: number } | null) => {
    pendingMovePreviewRef.current = point ? { objectId, point } : null;
    if (!point) {
      if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
      setMovePreview(null);
      return;
    }
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = requestAnimationFrame(() => {
      previewFrameRef.current = null;
      setMovePreview(pendingMovePreviewRef.current);
    });
  }, []);

  useEffect(() => {
    if (!history) return;
    const upgrade = (document: HarnessDesignDocument) => {
      let changed = document;
      for (const connector of document.connectors) {
        if (!connector.e4TableMode && componentSnapshotsByPlacement.get(connector.id)?.content.schemaVersion === 5) {
          changed = applyEditorCommand(changed, { type: "use-e4-table", connectorId: connector.id });
        }
      }
      return changed;
    };
    try {
      const present = upgrade(history.present);
      if (present === history.present) return;
      // A geometry migration is not an operator edit. Upgrade the undo states
      // as well, otherwise Ctrl+Z would immediately reapply the same migration.
      const changed = { present, past: history.past.map(upgrade), future: history.future.map(upgrade) };
      historyRef.current = changed;
      setHistory(changed);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось восстановить табличные точки Э4.");
    }
  }, [history, componentSnapshotsByPlacement]);

  useEffect(() => () => {
    if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current);
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = historyRef.current;
      if (!current || JSON.stringify(current.present) === savedJsonRef.current) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (placementBusyRef.current || pendingPlacementRef.current) return;
      if (event.key === "Escape" && editingObjectId) {
        event.preventDefault();
        setEditingObjectId(null);
        return;
      }
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape") { setRelatedSourceIds([]); setSelectedObjectId(null); setSelectedObjectIds([]); return; }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedObjectIds.length > 0) {
        const current = historyRef.current?.present;
        if (!current) return;
        const commands = selectedEditorDeletionCommands(current, selectedObjectIds);
        if (commands.length > 0) event.preventDefault();
        for (const command of commands) run(command);
        if (commands.length > 0) {
          setSelectedObjectId(null);
          setSelectedObjectIds([]);
        }
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        setHistory((current) => current ? undoEditorCommand(current) : current);
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        setHistory((current) => current ? redoEditorCommand(current) : current);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editingObjectId, run, selectedObjectIds]);

  if (!history || !resource) {
    return <div className={`he-loading ${saveState === "error" ? "error" : ""}`} role="status">{message}</div>;
  }

  const diagnostics = view === "e4" ? collectE4Diagnostics(history.present) : [];
  const diagnosticObjectIds = new Set(diagnostics.map((diagnostic) => diagnostic.target.objectId));
  const componentTemplateViewInstances = buildComponentTemplateViewInstances(
    previewResult.document ?? history.present,
    componentSnapshotsByPlacement,
  );
  const materializedConnectorIds = new Set(componentTemplateViewInstances.map((instance) => instance.objectId));
  const hasComponentGraphIntegrityMismatch = history.present.connectors.some((connector) =>
    connector.libraryBinding?.mode === "template" && componentSnapshotsByPlacement.has(connector.id) &&
    !materializedConnectorIds.has(connector.id));
  const componentGraphIntegrityMessage = componentGraphMessage || (hasComponentGraphIntegrityMismatch
    ? "Закреплённые контактные данные компонента не совпадают со снимком проекта. Используется резервное отображение."
    : "");
  const scene = designToScene(
    previewResult.document ?? history.present,
    view,
    diagnosticObjectIds,
    materializedConnectorIds,
  );
  const layers = toUiLayers(history.present, view);
  const selectedConnector = view === "e4" && selectedObjectId
    ? history.present.connectors.find((connector) => connector.id === selectedObjectId) ?? null
    : null;
  const selectedConnectorLayer = selectedConnector
    ? layers.find((layer) => layer.id === selectedConnector.layerIds.e4)
    : null;
  const selectedSeriesId = selectedConnector?.libraryBinding?.mode === "series"
    ? selectedConnector.libraryBinding.seriesId
    : null;
  const selectedConnectorSeries = selectedSeriesId
    ? builtInConnectorSeries.find((series) => series.id === selectedSeriesId)
    : undefined;
  const selectedTemplateSnapshot = selectedConnector?.libraryBinding?.mode === "template"
    ? componentSnapshotsByPlacement.get(selectedConnector.id) ?? null
    : null;
  const selectedTemplateArticleOptions = selectedTemplateSnapshot &&
      (isTemplateContentV3(selectedTemplateSnapshot.content) || isTemplateContentV4(selectedTemplateSnapshot.content) || isTemplateContentV5(selectedTemplateSnapshot.content))
    ? selectedTemplateSnapshot.content.articleVariants.map((article) => ({
        articleVariantId: article.id,
        articleKey: article.articleKey,
      }))
    : [];
  const selectTemplateArticle = selectedConnector && selectedTemplateSnapshot &&
      (isTemplateContentV3(selectedTemplateSnapshot.content) || isTemplateContentV4(selectedTemplateSnapshot.content) || isTemplateContentV5(selectedTemplateSnapshot.content))
    ? (articleVariantId: string) => {
        try {
          if (selectedConnector.libraryBinding?.mode === "template" &&
              selectedConnector.libraryBinding.articleVariantId === articleVariantId) return;
          const content = selectedTemplateSnapshot.content;
          if (!isTemplateContentV3(content) && !isTemplateContentV4(content) && !isTemplateContentV5(content)) return;
          const connector = rematerializeComponentTemplateConnectorArticle(selectedConnector, {
            templateId: selectedTemplateSnapshot.sourceTemplateId,
            version: selectedTemplateSnapshot.sourceVersion,
            versionSha256: selectedTemplateSnapshot.sourceVersionSha256,
            code: selectedTemplateSnapshot.code,
            name: selectedTemplateSnapshot.name,
            articleBindings: selectedTemplateSnapshot.articleBindings,
            assets: selectedTemplateSnapshot.assets,
            content,
          }, articleVariantId);
          run({ type: "apply-template-article", connectorId: selectedConnector.id, connector });
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Не удалось выбрать артикул семейства.");
        }
      }
    : undefined;
  const refreshTemplateTerminals = selectedConnector && selectedTemplateSnapshot
      ? async () => {
        if (refreshingTerminals) return;
        const generation = loadGeneration.current;
        const connectorId = selectedConnector.id;
        setRefreshingTerminals(true);
        try {
          const latest = await componentTemplateApi.get(selectedTemplateSnapshot.sourceTemplateId);
          if (generation !== loadGeneration.current) return;
          const current = historyRef.current?.present.connectors.find(item => item.id === connectorId);
          if (!current) return;
          const catalog = refreshedTemplateTerminalCatalog(current, latest);
          run({ type: "refresh-template-terminals", connectorId, catalog });
        } catch (error) {
          if (generation === loadGeneration.current) setMessage(error instanceof Error ? error.message : "Не удалось обновить совместимые терминалы.");
        } finally {
          setRefreshingTerminals(false);
        }
      }
    : undefined;
  const customWireColorHexes = [...new Set([
    ...(history.present.customWireColors ?? []),
    ...history.present.connectors.flatMap((connector) => connector.contacts
      .flatMap((contact) => [contact.color, contact.secondaryColor ?? ""])),
  ].flatMap((value) => {
    const normalized = value.trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(normalized) ? [normalized] : [];
  }))];
  const editorWireColors = [
    ...builtInWireColors,
    ...customWireColorHexes.map((hex) => createCustomWireColor(hex)),
  ];
  const placeCatalogItem = async (item: EditorCatalogItem, point?: { readonly x: number; readonly y: number }) => {
    if (item.entityType === "protective-covering") {
      const t = history.present.physicalTopology;
      if (view !== "drawing" || !t) { setMessage("Сначала создайте и выберите физические участки на Чертеже."); return; }
      try {
        const material = coveringMaterial(item);
        const existing = t.coverings?.find(c => selectedObjectIds.includes(c.id));
        const spans = t.segments.filter(s => selectedObjectIds.includes(s.id)).map(s => ({segmentId:s.id,from:0,to:1}));
        if (!existing && !spans.length) throw new Error("Выберите участки или оболочку для назначения защиты.");
        run({type:"set-physical-topology",topology:{...t,coverings:existing ? t.coverings?.map(c=>c.id===existing.id?{...c,material,name:material.displayName}:c) : [...t.coverings ?? [],{id:crypto.randomUUID(),name:material.displayName,material,spans,width:18,color:"#687e8a",lengthMm:null}]}});
      } catch(error) { setMessage(error instanceof Error ? error.message : "Не удалось назначить защиту."); }
      return;
    }
    if (item.placement === "reference-only" && item.entityType === "coax-termination") {
      if (view !== "drawing") {
        setMessage("Профиль разделки назначается проводу только в режиме «Чертёж».");
        return;
      }
      const selectedWireId = selectedObjectIds.length === 1 &&
        history.present.wires.some((wire) => wire.id === selectedObjectIds[0])
        ? selectedObjectIds[0]!
        : null;
      const selectedWire = selectedWireId
        ? history.present.wires.find((wire) => wire.id === selectedWireId)
        : undefined;
      const locked = selectedWire
        ? history.present.views.drawing.layers.some((layer) => layer.id === selectedWire.layerIds.drawing && layer.locked)
        : false;
      const result = wireStripProfileUpdateFromCatalogItem(item, selectedWireId, activeWireStripEnd, locked);
      if (!result.ok) setMessage(result.error);
      else run(result.command);
      return;
    }
    if (item.placement === "reference-only" && (item.entityType === "wire" || item.entityType === "cable")) {
      if (item.entityType === "cable" && selectedCable) {
        const result = cableMaterialUpdateFromCatalogItem(item, selectedCable.id);
        if (!result.ok) setMessage(result.error);
        else run(result.command);
        return;
      }
      const selectedWireId = selectedObjectIds.length === 1 &&
        history.present.wires.some((wire) => wire.id === selectedObjectIds[0])
        ? selectedObjectIds[0]!
        : null;
      const result = wireMaterialUpdateFromCatalogItem(item, selectedWireId);
      if (!result.ok) setMessage(result.error);
      else run(result.command);
      return;
    }
    if (item.placement !== "connector") return;
    const generation = loadGeneration.current;
    const id = crypto.randomUUID();
    const index = history.present.connectors.length;
    let preview: ReturnType<typeof createBuiltInConnectorInstance>;
    let isPersistentTemplate = false;
    if (item.componentTemplateId && item.componentTemplateVersion) {
      try {
        const template = await loadComponentTemplateForPlacement(
          componentTemplateApi, item.componentTemplateId, item.componentTemplateVersion);
        if (generation !== loadGeneration.current) return;
        if (!isTemplateContentV3(template.content) && !isTemplateContentV4(template.content) && !isTemplateContentV5(template.content)) {
          throw new Error("Для размещения в жгуте требуется шаблон v3 или v4.");
        }
        // A catalog card represents the whole series. Its cached article
        // metadata may predate the loaded immutable version, whose first real
        // variant is the deterministic initial selection.
        const variantId = firstPlaceableArticleVariantId(template.content);
        const variant = template.content.articleVariants.find(candidate => candidate.id === variantId);
        if (!variant) throw new Error("В библиотечном шаблоне нет варианта артикула для размещения.");
        preview = createConnectorInstanceFromComponentTemplateV3({
          templateId: template.templateId,
          version: template.version,
          versionSha256: template.versionSha256,
          code: template.code,
          name: template.name,
          articleBindings: template.articleBindings,
          assets: template.assets,
          content: template.content,
        }, {
          id,
          designation: `XS${index + 1}`,
          articleVariantId: variant.id,
          e4Position: { x: 0, y: 0 },
        });
        isPersistentTemplate = true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Не удалось разместить библиотечный компонент.");
        return;
      }
    } else {
      preview = createBuiltInConnectorInstance(item.id, {
        id,
        designation: `XS${index + 1}`,
        e4Position: { x: 0, y: 0 },
        partNumber: item.defaultPartNumber,
      });
    }
    const nextE4Y = history.present.connectors.reduce((bottom, connector) => Math.max(
      bottom,
      connector.positions.e4.y + connectorE4TableGeometry(connector).height + 90,
    ), 100);
    const placement = point ?? { x: 120, y: nextE4Y };
    const command: EditorCommand = {
      type: "add-connector",
      connector: { ...preview, positions: { e4: placement, drawing: placement } },
    };
    if (isPersistentTemplate) {
      const currentHistory = historyRef.current;
      const currentResource = resourceRef.current;
      if (!currentHistory || !currentResource) return;
      if (!(await flushSave())) return;
      if (generation !== loadGeneration.current) return;
      const latestHistory = historyRef.current;
      const latestResource = resourceRef.current;
      if (!latestHistory || !latestResource) return;
      let nextHistory: EditorHistory;
      try {
        nextHistory = executeEditorCommand(latestHistory, command);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Не удалось разместить компонент.");
        return;
      }
      const pending: PendingComponentPlacement = pendingPlacementRef.current ?? {
        body: componentPlacementRequest(command.connector, latestResource.revision, crypto.randomUUID()),
        nextHistory,
        connectorId: preview.id,
        loadGeneration: generation,
      };
      pendingPlacementRef.current = pending;
      setPlacementPending(true);
      try {
        const result = await componentPlacementApi.place(projectId, harnessId, pending.body);
        const authoritative = await api.get(projectId, harnessId);
        if (pending.loadGeneration !== loadGeneration.current || pendingPlacementRef.current !== pending) return;
        nextHistory = pending.nextHistory;
        if (authoritative.revision !== result.resultingRevision ||
            !authoritative.content.connectors.some((connector) => connector.id === pending.connectorId)) {
          throw new Error("Сервер не подтвердил компонент в документе жгута.");
        }
        historyRef.current = nextHistory;
        setHistory(nextHistory);
        const saved = { ...authoritative, content: nextHistory.present };
        resourceRef.current = saved;
        setResource(saved);
        savedJsonRef.current = JSON.stringify(nextHistory.present);
        setSaveState("saved");
        pendingPlacementRef.current = null;
        setPlacementPending(false);
        void refreshComponentGraph(pending.loadGeneration);
      } catch (error) {
        // The exact command is kept for the next activation. If the response was
        // lost after the server committed it, the idempotent command journal
        // returns the already accepted result instead of creating a duplicate.
        if (pending.loadGeneration === loadGeneration.current && pendingPlacementRef.current === pending) {
          setMessage(error instanceof Error ? error.message : "Не удалось закрепить компонент в проекте.");
        }
        return;
      }
    } else {
      run(command);
    }
    setSelectedObjectId(id);
    setSelectedObjectIds([id]);
  };

  const retryPendingPlacement = async () => {
    if (placementBusyRef.current) return;
    const pending = pendingPlacementRef.current;
    if (!pending || pending.loadGeneration !== loadGeneration.current) return;
    const operation = Symbol("component-placement-retry");
    placementOperationRef.current = operation;
    placementBusyRef.current = true;
    setPlacementBusy(true);
    try {
      const result = await componentPlacementApi.place(projectId, harnessId, pending.body);
      const authoritative = await api.get(projectId, harnessId);
      if (pending.loadGeneration !== loadGeneration.current || pendingPlacementRef.current !== pending) return;
      if (authoritative.revision !== result.resultingRevision ||
          !authoritative.content.connectors.some((connector) => connector.id === pending.connectorId)) {
        throw new Error("Сервер не подтвердил компонент в документе жгута.");
      }
      historyRef.current = pending.nextHistory;
      setHistory(pending.nextHistory);
      const saved = { ...authoritative, content: pending.nextHistory.present };
      resourceRef.current = saved;
      setResource(saved);
      savedJsonRef.current = JSON.stringify(pending.nextHistory.present);
      pendingPlacementRef.current = null;
      setPlacementPending(false);
      void refreshComponentGraph(pending.loadGeneration);
      setSaveState("saved");
      setMessage("");
      setSelectedObjectId(pending.connectorId);
      setSelectedObjectIds([pending.connectorId]);
    } catch (error) {
      if (pending.loadGeneration === loadGeneration.current && pendingPlacementRef.current === pending) {
        setMessage(error instanceof Error ? error.message : "Не удалось закрепить компонент в проекте.");
      }
    } finally {
      if (placementOperationRef.current === operation) {
        placementOperationRef.current = null;
        placementBusyRef.current = false;
        setPlacementBusy(false);
      }
    }
  };

  const addCatalogItem = async (item: EditorCatalogItem, point?: { readonly x: number; readonly y: number }) => {
    if (placementBusyRef.current) return;
    if (pendingPlacementRef.current) {
      await retryPendingPlacement();
      return;
    }
    const persistent = Boolean(item.componentTemplateId && item.componentTemplateVersion);
    if (!persistent) {
      await placeCatalogItem(item, point);
      return;
    }
    if (placementBusyRef.current) return;
    const operation = Symbol("component-placement");
    placementOperationRef.current = operation;
    placementBusyRef.current = true;
    setPlacementBusy(true);
    try {
      await placeCatalogItem(item, point);
    } finally {
      if (placementOperationRef.current === operation) {
        placementOperationRef.current = null;
        placementBusyRef.current = false;
        setPlacementBusy(false);
      }
    }
  };

  const addRoutePoint = (point: { readonly x: number; readonly y: number }) => {
    if (view !== "drawing" || !selectedObjectId) return;
    const topology = history.present.physicalTopology;
    const segment = topology?.segments.find(s => s.id === selectedObjectId);
    if (topology && segment) { run({ type: "set-physical-topology", topology: { ...topology, segments: topology.segments.map(s => s.id === segment.id ? { ...s, bends: [...physicalSegmentPoints(history.present, s).slice(1, -1), point] } : s) } }); return; }
    const wire = history.present.wires.find((item) => item.id === selectedObjectId);
    if (!wire || topology?.routes.some(r => r.wireId === wire.id)) return;
    const renderedWire = scene.find((item) => item.id === wire.id);
    const start = wire.drawingRoute.at(-1) ?? renderedWire?.points?.[0] ??
      findWireEndpoint(history.present, wire.from, "drawing");
    if (!start) return;
    const next = snapRoutePoint(start, point, drawingSnapEnabled);
    run({ type: "set-wire-route", wireId: wire.id, route: [...wire.drawingRoute, next] });
  };

  const createRoutedWire = (id: string, from: WireEndpoint, to: WireEndpoint) => {
    const contactValues = [from, to].flatMap((endpoint) => {
      if (isJunctionEndpoint(endpoint) || isScreenEndpoint(endpoint)) return [];
      const connector = history.present.connectors.find((item) => item.id === endpoint.connectorId);
      const contact = connector?.contacts.find((item) => item.id === endpoint.contactId);
      return contact ? [contact] : [];
    });
    const circuit = contactValues.find((contact) => contact.circuit.trim())?.circuit ?? "";
    const colorName = contactValues.find((contact) => contact.color.trim())?.color ?? "";
    const colorContact = contactValues.find((contact) => contact.color.trim());
    const colorSource = colorContact
      ? [from, to].find((endpoint) => !isJunctionEndpoint(endpoint) && !isScreenEndpoint(endpoint) &&
        endpoint.contactId === colorContact.id)
      : !isJunctionEndpoint(from) && !isScreenEndpoint(from) ? from : undefined;
    const wire = createWire(
      id, from, to, null, circuit, resolveWireColorHex(colorName), 0, 0, 1,
      colorSource ? { connectorId: colorSource.connectorId, contactId: colorSource.contactId } : undefined,
    );
    const start = wireEndpointE4Anchor(history.present, from);
    const end = wireEndpointE4Anchor(history.present, to);
    return start && end ? { ...wire, e4Route: createOrthogonalE4Route(start, end) } : wire;
  };

  const selectedWireIds = selectedObjectIds.filter((id) => history.present.wires.some((wire) => wire.id === id));
  const selectedCable = history.present.cables.find((cable) =>
    cable.memberWireIds.length === selectedWireIds.length &&
    cable.memberWireIds.every((wireId) => selectedWireIds.includes(wireId))) ?? null;
  const selectedWiresLocked = selectedWireIds.some((wireId) => {
    const wire = history.present.wires.find((item) => item.id === wireId);
    return wire ? history.present.views.drawing.layers.some((layer) => layer.id === wire.layerIds.drawing && layer.locked) : false;
  });
  const selectedDiffPair = history.present.diffPairs.find((group) =>
    group.wireIds.length === selectedWireIds.length && group.wireIds.every((id) => selectedWireIds.includes(id))) ?? null;
  const selectedScreen = history.present.screens.find((group) =>
    group.wireIds.length === selectedWireIds.length && group.wireIds.every((id) => selectedWireIds.includes(id))) ?? null;

  const changeDiffPair = (state: E4DifferentialPairState | null) => {
    if (selectedWireIds.length !== 2) return;
    if (state === null) {
      if (selectedDiffPair) run({ type: "remove-diff-pair", groupId: selectedDiffPair.id });
      return;
    }
    if (selectedDiffPair) {
      run({
        type: "update-diff-pair",
        groupId: selectedDiffPair.id,
        variant: state.variant,
        step: state.twistPitchMm,
      });
      return;
    }
    run({
      type: "create-diff-pair",
      group: {
        id: crypto.randomUUID(),
        wireIds: [selectedWireIds[0]!, selectedWireIds[1]!],
        variant: state.variant,
        step: state.twistPitchMm,
        amplitude: 7,
      },
    });
  };

  const changeScreen = (state: E4ScreenState | null) => {
    if (selectedWireIds.length < 1) return;
    if (state === null) {
      if (selectedScreen) run({ type: "remove-screen", screenId: selectedScreen.id });
      return;
    }
    const position = state.positionPercent / 100;
    if (selectedScreen) {
      run({ type: "update-screen", screenId: selectedScreen.id, position, terminalSide: state.terminalSide });
    } else {
      run({
        type: "create-screen",
        screen: { id: crypto.randomUUID(), wireIds: selectedWireIds, position, label: "Экран", width: 46, terminalSide: state.terminalSide },
      });
    }
  };

  return (
    <div className={`he-host ${placementBusy ? "is-placement-busy" : ""}`}>
      {message && <div className="he-save-message" role="alert">{message.startsWith("Схема открыта в безопасном режиме")
        ? <>Маршруты требуют проверки. <InfoHint>{message} Редактирование доступно; перемещение блока повторяет поиск маршрутов.</InfoHint></>
        : message}</div>}
      {routingIssues.length > 0 && <div className="he-save-message" role="status">
        Трассировка: {routingIssues.length} требуют перестроения.
        <InfoHint>Изменения сохраняются. Раздвиньте блоки: при каждом перемещении выполняется поиск маршрутов.
          {routingIssues.map((issue) => <div key={issue.wireId}>{issue.wireId}: {issue.message}</div>)}
        </InfoHint>
      </div>}
      {recoveryDraft && <div className="he-recovery-draft" role="alert">
        <span>Есть несохранённый локальный черновик от ревизии {recoveryDraft.baseRevision}. Серверный документ не заменён.</span>
        <button type="button" onClick={() => {
          const next = createEditorHistory(recoveryDraft.content);
          historyRef.current = next;
          setHistory(next);
          setRecoveryDraft(null);
          setMessage("Локальный черновик восстановлен. Сохраняем его на сервере…");
        }}>Восстановить</button>
        <button type="button" onClick={() => {
          removeHarnessDesignRecoveryDraft(window.localStorage, projectId, harnessId);
          setRecoveryDraft(null);
          setMessage("");
        }}>Оставить серверную версию</button>
      </div>}
      {componentGraphIntegrityMessage && <ComponentGraphErrorAlert
        message={componentGraphIntegrityMessage}
        onRetry={() => void refreshComponentGraph(loadGeneration.current)}
      />}
      <HarnessEditorErrorBoundary
        key={`${harnessId}:${uiFailureNonce}`}
        onError={(failure) => setMessage(`Ошибка отображения: ${failure}`)}
        onRecover={() => {
          setEditingObjectId(null);
          setMovePreview(null);
          setUiFailureNonce((value) => value + 1);
        }}
      ><HarnessEditorWorkspace
        harnessId={harnessId}
        harnessDesignation={harnessDesignation}
        view={view}
        objects={scene}
        layers={layers}
        catalogItems={catalog.items}
        catalogSources={catalog.sources}
        selectedCatalogSourceId={catalog.selectedSourceId}
        catalogQuery={catalog.query}
        catalogLoadState={catalog.loadState}
        catalogMessage={catalog.message}
        catalogHasMore={catalog.hasMore}
        selectedObjectId={selectedObjectId}
        selectedObjectIds={selectedObjectIds}
        highlightedObjectIds={related.wireIds}
        revealRequest={revealRequest}
        relationPanel={<>{view === "drawing" && history.present.physicalTopology && <PhysicalCoveringsPanel topology={history.present.physicalTopology} selectedIds={selectedObjectIds} onChange={topology=>run({type:"set-physical-topology",topology})} onReveal={id=>{setRelatedSourceIds([]);setSelectedObjectId(id);setSelectedObjectIds([id]);}} />}{view === "drawing" && <PhysicalTopologyPanel document={history.present} selectedId={selectedObjectId} selectedIds={selectedObjectIds} onChange={topology => run({ type: "set-physical-topology", topology })} onSelect={(id,additive) => { setRelatedSourceIds([]); setSelectedObjectId(id); setSelectedObjectIds(additive ? [...new Set([...selectedObjectIds,id])] : [id]); }} />}<HarnessRelationsPanel document={history.present} projectId={projectId} harnessId={harnessId} quantity={harnessQuantity} related={related} wholeNet={wholeNet} onWholeNet={setWholeNet} unsaved={saveState !== "saved"} hiddenCount={related.wireIds.filter(id => { const wire = history.present.wires.find(w => w.id === id); return wire && layers.some(layer => layer.id === wire.layerIds[view] && !layer.visible); }).length}
          onClear={() => {setRelatedSourceIds([]); setSelectedObjectId(null); setSelectedObjectIds([]);}}
          onReveal={id => {
            const found = id && selectionIndex ? resolveHarnessSelection(selectionIndex, [id], wholeNet) : related;
            if (id) { setRelatedSourceIds([id]); setSelectedObjectId(null); setSelectedObjectIds([]); }
            setEditingObjectId(null); setView("drawing"); onViewChange?.("drawing");
            setRevealRequest({token: Date.now(), objectIds: [...found.wireIds, ...found.componentIds]});
          }} /></>}
        cables={(previewResult.document ?? history.present).cables}
        e4Overlays={view === "e4" ? {
          crossingStyle: history.present.views.e4.wireCrossingStyle,
          junctions: history.present.junctions,
          diffPairs: history.present.diffPairs,
          screens: history.present.screens,
        } : undefined}
        componentTemplateViewInstances={componentTemplateViewInstances}
        resolveComponentTemplateAssetUrl={resolveComponentTemplateAssetUrl}
        saveState={saveState}
        onSaveRequest={() => void flushSave()}
        onDrawingMove={(connectorId,drawingId,offset)=>run({type:"set-drawing-placement",connectorId,drawingId,offset})}
        propertyInspector={selectedObjectId && (history.present.physicalTopology?.coverings?.some(c=>c.id===selectedObjectId) || history.present.physicalTopology?.nodes.some(n=>n.id===selectedObjectId) || history.present.physicalTopology?.segments.some(s=>s.id===selectedObjectId)) ? <></> : selectedConnector ? (<>
          {view==="e4" && (()=>{
            const instance=componentTemplateViewInstances.find(i=>i.objectId===selectedConnector.id);
            const drawings=instance ? projectE4DrawingCompanions(instance,{x:0,y:0},300,resolveComponentTemplateAssetUrl) : [];
            return drawings.length ? <section className="he-companion-list" aria-label="Рисунки компонента"><header className="ui-section-heading"><strong>Рисунки артикула</strong><InfoHint>Показать или скрыть рисунок на Э4. Перетаскивайте рисунок мышью; прямая пунктирная линия связывает его с таблицей. Группа фигур перемещается как один рисунок.</InfoHint></header>{drawings.map(d=><label key={d.drawingId}><input type="checkbox" aria-label={`Показать ${d.label}`} checked={d.visible} disabled={selectedConnectorLayer?.locked===true} onChange={e=>run({type:"set-drawing-placement",connectorId:selectedConnector.id,drawingId:d.drawingId,visible:e.target.checked})}/>{d.label}</label>)}</section> : null;
          })()}
          <E4ConnectorInspector
            connector={selectedConnector}
            onRefreshTerminals={refreshTemplateTerminals}
            refreshingTerminals={refreshingTerminals}
            series={selectedConnectorSeries}
            templateArticleOptions={selectedTemplateArticleOptions}
            onTemplateArticleSelect={selectTemplateArticle}
            terminalArticles={terminalLookup.articles}
            onTerminalSearch={terminalLookup.search}
            wireColors={editorWireColors}
            disabled={selectedConnectorLayer?.locked === true}
            onCommand={run}
          />
        </>) : view === "drawing" && selectedWireIds.length >= 2 ? (
          <CableSelectionPanel
            selectedWireIds={selectedWireIds}
            cable={selectedCable}
            disabled={selectedWiresLocked}
            onCreate={() => run({ type: "add-cable", cable: {
              id: crypto.randomUUID(), memberWireIds: selectedWireIds, lengthMm: null,
              endCorrectionFromMm: 0, endCorrectionToMm: 0, cutRoundingStepMm: 1,
            } })}
            onUpdate={(patch) => selectedCable && run({ type: "update-cable", cableId: selectedCable.id, ...patch })}
            onMaterialClear={() => selectedCable && run({ type: "update-cable", cableId: selectedCable.id, materialBinding: null })}
            onRemove={() => selectedCable && run({ type: "remove-cable", cableId: selectedCable.id })}
          />
        ) : undefined}
        canvasEditor={selectedConnector ? (
          <E4ConnectorInspector
            connector={selectedConnector}
            onRefreshTerminals={refreshTemplateTerminals}
            refreshingTerminals={refreshingTerminals}
            series={selectedConnectorSeries}
            templateArticleOptions={selectedTemplateArticleOptions}
            onTemplateArticleSelect={selectTemplateArticle}
            terminalArticles={terminalLookup.articles}
            onTerminalSearch={terminalLookup.search}
            wireColors={editorWireColors}
            disabled={selectedConnectorLayer?.locked === true}
            onCommand={run}
            mode="canvas"
            editing={editingObjectId === selectedConnector.id}
            onEditingChange={(editing) => setEditingObjectId(editing ? selectedConnector.id : null)}
          />
        ) : undefined}
        diagnostics={[...diagnostics.map((diagnostic) => ({
          id: diagnostic.id,
          objectId: diagnostic.target.objectId,
          label: diagnostic.designation,
          message: diagnostic.message,
        })), ...routingIssues.map((issue) => ({
          id: `routing:${issue.wireId}`, objectId: issue.wireId,
          label: history.present.wires.find((wire) => wire.id === issue.wireId)?.circuit || issue.wireId,
          message: issue.message,
        }))]}
        previewMessage={previewResult.error}
        onViewChange={(nextView) => {
          setEditingObjectId(null);
          setView(nextView);
          onViewChange?.(nextView);
        }}
        onSelectedObjectChange={(objectId) => {
          setRelatedSourceIds([]);
          setSelectedObjectId(objectId);
          setEditingObjectId((current) => current === objectId ? current : null);
        }}
        onSelectedObjectIdsChange={setSelectedObjectIds}
        onCatalogItemActivate={addCatalogItem}
        onCatalogSourceChange={catalog.selectSource}
        onCatalogQueryChange={catalog.changeQuery}
        onCatalogLoadMore={catalog.loadMore}
        onCatalogRetry={catalog.retry}
        onWireMaterialClear={(wireId) => run({ type: "update-wire", wireId, materialBinding: null })}
        selectedWireStripProfiles={selectedObjectIds.length === 1
          ? history.present.wires.find((wire) => wire.id === selectedObjectIds[0])?.stripProfiles
          : undefined}
        activeWireStripEnd={activeWireStripEnd}
        onActiveWireStripEndChange={setActiveWireStripEnd}
        onWireStripProfileClear={(wireId, end) => run({ type: "set-wire-strip-profile", wireId, end, profile: null })}
        onObjectMove={(objectId, point) => {
          const topology = history.present.physicalTopology;
          const node = topology?.nodes.find(n => n.id === objectId);
          if (topology && node) { const origin = history.present.connectors.find(c => c.id === node.connectorId)?.positions.drawing ?? {x:0,y:0}; run({type:"set-physical-topology",topology:{...topology,nodes:topology.nodes.map(n=> n.id===node.id ? {...n,position:{x:point.x+5-origin.x,y:point.y+5-origin.y}} : n)}}); }
          else run({type:"move-connector",connectorId:objectId,view,position:point});
        }}
        onObjectMovePreview={previewObjectMove}
        onObjectEditRequest={(objectId) => {
          setSelectedObjectId(objectId);
          setSelectedObjectIds([objectId]);
          setEditingObjectId(objectId);
        }}
        onWireConnect={(from, to) => {
          const resolveEndpoint = (endpoint: typeof from): WireEndpoint | null => {
            if ("screenId" in endpoint) return createScreenEndpoint(endpoint.screenId, endpoint.screenTerminalSide);
            const connector = history.present.connectors.find((item) => item.id === endpoint.connectorId);
            const contact = connector?.contacts[endpoint.contactIndex];
            return contact ? { connectorId: endpoint.connectorId, contactId: contact.id } : null;
          };
          const fromEndpoint = resolveEndpoint(from);
          const toEndpoint = resolveEndpoint(to);
          if (!fromEndpoint || !toEndpoint) return;
          const id = crypto.randomUUID();
          run({
            type: "add-wire",
            wire: createRoutedWire(id, fromEndpoint, toEndpoint),
          });
          setSelectedObjectId(id);
          setSelectedObjectIds([id]);
        }}
        onWireReconnect={(wireId, end, target) => {
          const endpoint: WireEndpoint | null = "screenId" in target
            ? createScreenEndpoint(target.screenId, target.screenTerminalSide)
            : (() => {
              const connector = history.present.connectors.find((item) => item.id === target.connectorId);
              const contact = connector?.contacts[target.contactIndex];
              return contact ? { connectorId: target.connectorId, contactId: contact.id } : null;
            })();
          if (!endpoint) return;
          run({
            type: "reconnect-wire",
            wireId,
            end,
            endpoint,
          });
          setSelectedObjectId(wireId);
          setSelectedObjectIds([wireId]);
        }}
        onWireConnectToWire={(from, targetWireId, point) => {
          const fromEndpoint: WireEndpoint | null = "screenId" in from
            ? createScreenEndpoint(from.screenId, from.screenTerminalSide)
            : (() => {
              const connector = history.present.connectors.find((item) => item.id === from.connectorId);
              const contact = connector?.contacts[from.contactIndex];
              return contact ? { connectorId: from.connectorId, contactId: contact.id } : null;
            })();
          const targetWire = history.present.wires.find((item) => item.id === targetWireId);
          if (!fromEndpoint || !targetWire) return;
          const wireId = crypto.randomUUID();
          const existingJunction = history.present.junctions.find((junction) =>
            junction.wireIds.includes(targetWireId) &&
            Math.hypot(junction.position.x - point.x, junction.position.y - point.y) < 0.01);
          const junctionId = existingJunction?.id ?? crypto.randomUUID();
          const toEndpoint = createJunctionEndpoint(junctionId);
          const base = createWire(wireId, fromEndpoint, toEndpoint, null, targetWire.circuit);
          const start = wireEndpointE4Anchor(history.present, fromEndpoint);
          const branchWire = start ? {
            ...base,
            e4Route: createOrthogonalE4Route(start, { position: point, leadDirection: null }),
          } : base;
          const succeeded = existingJunction
            ? run({ type: "add-wire", wire: branchWire, targetWireId })
            : run({
              type: "create-junction",
              junction: { id: junctionId, position: point, wireIds: [targetWireId, wireId] },
              branchWire,
            });
          if (succeeded) {
            setSelectedObjectId(wireId);
            setSelectedObjectIds([wireId]);
          }
        }}
        onWireReconnectToWire={(wireId, end, targetWireId, point) => {
          const existingJunction = history.present.junctions.find((junction) =>
            junction.wireIds.includes(targetWireId) &&
            Math.hypot(junction.position.x - point.x, junction.position.y - point.y) < 0.01);
          const succeeded = existingJunction
            ? run({
              type: "connect-wire-to-wire",
              wireId,
              end,
              targetWireId,
              junctionId: existingJunction.id,
              position: existingJunction.position,
            })
            : run({
              type: "connect-wire-to-wire",
              wireId,
              end,
              targetWireId,
              junctionId: crypto.randomUUID(),
              position: point,
            });
          if (succeeded) {
            setSelectedObjectId(wireId);
            setSelectedObjectIds([wireId]);
          }
        }}
        onE4WireSegmentMove={(wireId, segmentIndex, coordinate) => run({
          type: "move-e4-wire-segment",
          wireId,
          segmentIndex,
          position: { x: coordinate, y: coordinate },
          detached: e4Detached,
        })}
        e4Detached={e4Detached}
        onE4DetachedChange={setE4Detached}
        onE4Reroute={() => {
          if (run({ type: "reroute-e4-wires", wireIds: selectedWireIds })) setE4Detached(false);
        }}
        onE4WireRoutePointRemove={(wireId, routeIndex) => run({
          type: "remove-e4-wire-route-point",
          wireId,
          pointIndex: routeIndex,
        })}
        onE4WireLabelPositionChange={(wireId, position) => run({
          type: "set-e4-wire-label-position",
          wireId,
          position,
        })}
        onE4ScreenPositionChange={(screenId, position) => run({
          type: "update-screen",
          screenId,
          position,
        })}
        onE4CrossingStyleChange={(style) => run({ type: "set-wire-crossing-style", view: "e4", style })}
        onE4DifferentialPairChange={changeDiffPair}
        onE4ScreenChange={changeScreen}
        onE4ClearGroup={() => {
          for (const group of history.present.diffPairs.filter((item) =>
            item.wireIds.some((id) => selectedWireIds.includes(id)))) {
            run({ type: "remove-diff-pair", groupId: group.id });
          }
          for (const screen of history.present.screens.filter((item) =>
            item.wireIds.some((id) => selectedWireIds.includes(id)))) {
            run({ type: "remove-screen", screenId: screen.id });
          }
        }}
        onWireRoutePointMove={(wireId, routeIndex, point) => {
          const topology = history.present.physicalTopology;
          const segment = topology?.segments.find(s => s.id === wireId);
          if (topology && segment) { run({type:"set-physical-topology",topology:{...topology,segments:topology.segments.map(s => s.id===wireId ? {...s,bends:physicalSegmentPoints(history.present,s).slice(1,-1).map((p,i)=>i===routeIndex?point:p)} : s)}}); return; }
          const wire = history.present.wires.find((item) => item.id === wireId);
          if (!wire || routeIndex < 0 || routeIndex >= wire.drawingRoute.length) return;
          const route = wire.drawingRoute.map((item, index) => index === routeIndex ? point : item);
          run({ type: "set-wire-route", wireId, route });
        }}
        onWireRoutePointRemove={(wireId, routeIndex) => {
          const topology = history.present.physicalTopology;
          const segment = topology?.segments.find(s => s.id === wireId);
          if (topology && segment) { run({type:"set-physical-topology",topology:{...topology,segments:topology.segments.map(s => s.id===wireId ? {...s,bends:physicalSegmentPoints(history.present,s).slice(1,-1).filter((_,i)=>i!==routeIndex)} : s)}}); return; }
          const wire = history.present.wires.find((item) => item.id === wireId);
          if (!wire || routeIndex < 0 || routeIndex >= wire.drawingRoute.length) return;
          run({ type: "set-wire-route", wireId, route: wire.drawingRoute.filter((_, index) => index !== routeIndex) });
        }}
        drawingSnapEnabled={history.present.physicalTopology?.snap ?? drawingSnapEnabled}
        onDrawingSnapChange={enabled => { setDrawingSnapEnabled(enabled); if (history.present.physicalTopology) run({type:"set-physical-topology",topology:{...history.present.physicalTopology,snap:enabled}}); }}
        onCanvasDoubleClick={addRoutePoint}
        onObjectsChange={(objects) => {
          const selected = selectedObjectId ? objects.find((item) => item.id === selectedObjectId) : null;
          if (!selected || selected.id.startsWith("dimension:")) return;
          const previous = scene.find((item) => item.id === selected.id);
          if (!previous) return;
          if (selected.kind === "connector") {
            if (selected.x !== previous.x || selected.y !== previous.y) {
              run({ type: "move-connector", connectorId: selected.id, view, position: { x: selected.x, y: selected.y } });
            } else if (selected.label !== previous.label) {
              run({ type: "update-connector", connectorId: selected.id, designation: selected.label });
            }
          } else if (selected.kind === "wire") {
            run(editorWireUpdateCommand(selected, previous));
          }
        }}
        onLayersChange={(nextLayers) => run({
          type: "replace-layers",
          view,
          layers: fromUiLayers(nextLayers, history.present.views[view].layers),
        })}
        onClose={onClose ? async () => {
          if (await flushSave()) onClose();
        } : undefined}
      /></HarnessEditorErrorBoundary>
      {(placementBusy || placementPending) && <div className={placementBusy ? "he-placement-busy" : "he-placement-pending"} role="status" aria-live="polite">
        {placementBusy
          ? "Закрепляем версию компонента в жгуте…"
          : <><span>Ответ сервера не получен. Повтор запроса безопасен и не создаст копию.</span><button type="button" onClick={() => void retryPendingPlacement()}>Повторить</button></>}
      </div>}
    </div>
  );
}
