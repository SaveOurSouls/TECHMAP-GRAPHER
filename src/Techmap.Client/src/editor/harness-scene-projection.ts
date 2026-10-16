import { type HarnessDesignDocument, type WireEndpoint, wireEndpointE4Anchor, isJunctionEndpoint, isScreenEndpoint, findWireEndpoint, connectorContactPosition, connectorE4Contacts, connectorE4TableGeometry, connectorContactName, calculateWireCutLength } from "./model";
import { type HarnessEditorView, type EditorSceneObject } from "./editor-types";
import { type DrawingPerimeters } from "./drawing-object-perimeter";
import { materializedContactWorldRepresentation, selectMaterializedContactRepresentation } from "./materialized-contact-representation";
import { terminationSceneObject } from "./termination-scene";
import { drawingLocalPoint, drawingLocalDirection, DRAWING_VIEW_PLACEMENT_ID, drawingLocalDirectionVector } from "./drawing-scale";
import { builtInConnectorSeries } from "./connector-series-demo";
import { terminalArticleLabel } from "./terminal-article-label";
import { physicalWirePoints, physicalWireDisplay } from "./physical-wire-geometry";
import { drawingWireWidth } from "./drawing-thickness";
import { wireStripProfileDisplayWarning } from "./harness-catalog-adapters";
import { drawingBendRadius } from "./drawing-route-path";
import { freeTwistedPairPaths } from "./drawing-twisted-pair";
import { drawingDimensionScene } from "./drawing-dimensions";
import { physicalTopologyScene, orderPhysicalScene } from "./physical-scene";
import { coveringScene } from "./covering-layout";
import { withPreparationDrawingArtwork } from "./preparation-drawing";
import { drawingDocumentScene } from "./drawing-documents";
import { drawingObjectIndexScene } from "./drawing-indices";

function contactPointForWire(
  document: HarnessDesignDocument,
  endpoint: WireEndpoint,
  otherEndpoint: WireEndpoint,
  view: HarnessEditorView,
  materializedConnectorIds?: ReadonlySet<string>,
  drawingConnectorIds?: ReadonlySet<string>,
  perimeters?: DrawingPerimeters,
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
  if(connector.terminationComponent)return connectorContactPosition(connector,contactId,view);
  const useMaterialized = connector.libraryBinding?.mode === "template" &&
    (materializedConnectorIds === undefined || materializedConnectorIds.has(connector.id));
  const materialized = useMaterialized
    ? materializedContactWorldRepresentation(connector, contactId, view)
    : null;
  if (materialized) return materialized.position;
  if(view==="drawing"&&useMaterialized&&drawingConnectorIds?.has(connector.id))return null;
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
export function designToScene(
  document: HarnessDesignDocument,
  view: HarnessEditorView,
  diagnosticObjectIds: ReadonlySet<string> = new Set(),
  materializedConnectorIds?: ReadonlySet<string>,
  quantity=1,
  drawingConnectorIds?: ReadonlySet<string>,
  perimeters?: DrawingPerimeters,
): readonly EditorSceneObject[] {
  const connectors: EditorSceneObject[] = document.connectors.map((connector) => {
    if(connector.terminationComponent)return terminationSceneObject(document,connector,view);
    const displayedContacts = view === "e4" ? connectorE4Contacts(connector) : connector.contacts;
    const geometry = view === "e4" ? connectorE4TableGeometry(connector) : null;
    const seriesBinding = connector.libraryBinding?.mode === "series" ? connector.libraryBinding : null;
    const metadata: Record<string, string> = { contactCount: String(connector.contacts.length) };
    if (connector.libraryBinding?.mode === "template" &&
        (materializedConnectorIds === undefined || materializedConnectorIds.has(connector.id))) {
      const materializedContactPoints = displayedContacts.map((contact) => {
        const representation = selectMaterializedContactRepresentation(connector, contact.id, view);
        return representation ? {
          ...(view==="drawing"?drawingLocalPoint(representation,connector.drawingPlacements):{x:representation.x,y:representation.y}),
          direction: view === "drawing"
            ? drawingLocalDirection(representation.direction, connector.drawingPlacements)
            : representation.direction,
          ...(view === "drawing" && connector.drawingPlacements?.some(placement =>
            placement.drawingId === DRAWING_VIEW_PLACEMENT_ID && placement.rotationDegrees)
            ? { directionVector: drawingLocalDirectionVector(representation.direction, connector.drawingPlacements) }
            : {}),
          status: contact.connectionStatus,
        } : null;
      });
      if (view==="drawing" && drawingConnectorIds?.has(connector.id) || materializedContactPoints.some((point) => point !== null)) {
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
        columnWidths: JSON.stringify(geometry.columns.map(column => column.width)),
        columnLabels: JSON.stringify(customLabels),
        rows: JSON.stringify(displayedContacts.map((contact) => ({
            number: contact.number,
            contactType: contact.contactType,
            circuit: contact.circuit,
            terminal: terminalArticleLabel(contact.terminalArticle),
            name: connectorContactName(connector, contact),
            wire: contact.wire,
            wireSection: contact.wireSection ?? "",
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
    const start = view === "drawing" && wire.drawingEndpoints ? wire.drawingEndpoints.from : contactPointForWire(document, wire.from, wire.to, view, materializedConnectorIds,drawingConnectorIds);
    const end = view === "drawing" && wire.drawingEndpoints ? wire.drawingEndpoints.to : contactPointForWire(document, wire.to, wire.from, view, materializedConnectorIds,drawingConnectorIds);
    if (!start || !end) return [];
    const physicalPoints = view === "drawing" ? physicalWirePoints(document, wire.id, start, end) : null;
    const wireDisplay = view === "drawing" && physicalPoints ? physicalWireDisplay(document,wire.id,start,end) : undefined;
    const roundRoute = wireDisplay && document.physicalTopology?.routes.find(route=>route.wireId===wire.id)?.steps.some(step=>document.physicalTopology?.segments.find(segment=>segment.id===step.segmentId)?.mode==="round");
    const wireWidth = drawingWireWidth(document,wire);
    const points = view === "drawing" ? physicalPoints ?? [start, ...wire.drawingRoute, end] : [start, ...wire.e4Route, end];
    const fromAnchor = view === "e4" ? wireEndpointE4Anchor(document, wire.from) : null;
    const toAnchor = view === "e4" ? wireEndpointE4Anchor(document, wire.to) : null;
    const cutLength = calculateWireCutLength(wire);
    const stripProfileDisplayWarning = view === "drawing"
      ? wireStripProfileDisplayWarning(points, wire.stripProfiles)
      : null;
    const singlePipeRoute = view === "drawing" ? document.physicalTopology?.routes.find(route => route.wireId === wire.id && route.steps.length === 1) : undefined;
    const localVolume = singlePipeRoute ? document.physicalTopology?.segments.find(segment => segment.id === singlePipeRoute.steps[0]!.segmentId)?.volumeShading : undefined;
    return [{
      id: wire.id,
      layerId: wire.layerIds[view],
      kind: "wire" as const,
      label: `${wire.circuit || `W${index + 1}`}${view === "drawing" && !wire.drawingEndpoints && !physicalPoints && !wire.drawingRoute.length ? " · маршрут не задан" : ""}`,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      color: wire.color,
      points,
      // Isolated routes keep their own editable polyline points, but they still
      // use the drawing bend radius for rendering.  A zero radius made every
      // detached corner sharp and made the radius control appear ineffective.
      ...(view === "drawing" ? {routeRadius: drawingBendRadius(document)} : {}),
      ...(wireDisplay ? {paths:wireDisplay.selectionPaths,visibleWireStrokes:roundRoute||wireDisplay.twisted?wireDisplay.visibleStrokes:wireDisplay.paths.map(points=>({points,width:wireWidth}))} : {}),
      ...(view === "drawing" && wire.stripProfiles ? { stripProfiles: wire.stripProfiles } : {}),
      ...(view === "drawing" && wire.drawingEndStyles ? { drawingEndStyles: wire.drawingEndStyles } : {}),
      metadata: {
        ...(localVolume !== undefined ? { volumeShading: String(localVolume) } : {}),
        drawingWidth:String(wireWidth),
        physicalRoute: String(!!physicalPoints),
        routeMissing: String(view === "drawing" && !wire.drawingEndpoints && !physicalPoints && wire.drawingRoute.length === 0),
        lengthKnown: String(cutLength.isComplete),
        lengthMm: cutLength.sourceLengthMm === null ? "" : String(cutLength.sourceLengthMm),
        endCorrectionFromMm: String(cutLength.endCorrectionFromMm),
        endCorrectionToMm: String(cutLength.endCorrectionToMm),
        cutRoundingStepMm: String(cutLength.cutRoundingStepMm),
        cutLengthMm: cutLength.cutLengthMm === null ? "" : String(cutLength.cutLengthMm),
        materialStatus: cutLength.materialConsumptionMm === null ? "excluded" : "included",
        freeFrom: String(!!wire.drawingEndpoints && !document.connectors.some(connector => connector.id === wire.from.connectorId)),
        freeTo: String(!!wire.drawingEndpoints && !document.connectors.some(connector => connector.id === wire.to.connectorId)),
        detachedDrawing: String(!!wire.drawingEndpoints),
        drawingPairId: document.diffPairs.find(pair => pair.wireIds.includes(wire.id))?.id ?? "",
        drawingPairWireIds: JSON.stringify(document.diffPairs.find(pair => pair.wireIds.includes(wire.id))?.wireIds ?? []),
        materialSourceKey: wire.materialBinding?.sourceKey ?? "",
        materialRecordId: wire.materialBinding?.recordId ?? "",
        wireMark: [wire.from,wire.to].flatMap(end=>"connectorId" in end
          ? document.connectors.find(connector=>connector.id===end.connectorId)?.contacts.filter(contact=>contact.id===end.contactId)??[] : [])
          .find(contact=>contact.wire.trim())?.wire??"",
        materialDisplayName: wire.materialBinding?.displayName ?? "",
        materialEntityType: wire.materialBinding?.entityType ?? "",
        e4LabelPosition: String(wire.e4LabelPosition ?? 0.5),
        ...(stripProfileDisplayWarning ? { stripProfileDisplayWarning } : {}),
        ...(view === "e4" ? {
          view: "e4",
          e4RouteMode: wire.e4RouteMode ?? "auto",
          fromSide: fromAnchor?.leadDirection ?? "",
          toSide: toAnchor?.leadDirection ?? "",
          leadLength: "24",
        } : {}),
      },
    }];
  });
  if (view === "drawing") for (const group of document.diffPairs) {
    const pair = group.wireIds.map(id => wires.find(wire => wire.id === id));
    if (pair.some(wire => !wire || wire.metadata?.physicalRoute === "true")) continue;
    const twisted = freeTwistedPairPaths(group, pair.map(wire => ({
      id: wire!.id, points: wire!.points ?? [], width: Number(wire!.metadata?.drawingWidth ?? 2.5),
    })), document.drawingDocuments?.physicalScale ?? 1, group.wireIds.every(id => document.wires.find(w => w.id === id)?.drawingEndpoints));
    for (const wire of pair) {
      const display = twisted.get(wire!.id);
      if (!display) continue;
      const index = wires.findIndex(item => item.id === wire!.id);
      wires[index] = { ...wire!, paths: [display.path], visibleWireStrokes: display.strokes };
    }
  }
  const dimensions: EditorSceneObject[] = view === "drawing" ? drawingDimensionScene(document,wires,perimeters) : [];
  const physical = view === "drawing" ? physicalTopologyScene(document) : [];
  const coverings: EditorSceneObject[] = view === "drawing" ? coveringScene(document) : [];
  const drawingPhysical= view === "drawing" ? orderPhysicalScene(document,[...physical,...wires,...coverings]) : [];
  const objects=[...(view === 'drawing' ? withPreparationDrawingArtwork(document,connectors,wires) : connectors), ...(view === "drawing" ? drawingPhysical : wires), ...dimensions, ...drawingDocumentScene(document,quantity,perimeters,view)];
  return view === "drawing" ? [...objects,...drawingObjectIndexScene(document,objects)] : objects;
}
