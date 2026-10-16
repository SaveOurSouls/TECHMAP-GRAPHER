import { type Point, type ConnectorInstance, type ConnectorContact, createDefaultConnectorBaseColumns, defaultLayerIds, type WireEndpoint, type WireColorSource, type WireInstance, calculateWireCutLength } from "./model";
import { requireConnectorText, requirePartNumberText } from "./editor-command-invariants";

export function createConnector(
  id: string,
  designation: string,
  contactCount: number,
  e4Position: Point,
  drawingPosition: Point = e4Position,
  partNumber: string = designation,
): ConnectorInstance {
  if (!Number.isSafeInteger(contactCount) || contactCount < 1 || contactCount > 300) {
    throw new Error("Число контактов должно быть от 1 до 300.");
  }
  const normalizedDesignation = designation.trim();
  requireConnectorText(normalizedDesignation, "Укажите обозначение соединителя.");
  const normalizedPartNumber = partNumber.trim();
  requirePartNumberText(normalizedPartNumber, "Укажите артикул шаблона соединителя.");
  const contacts: ConnectorContact[] = Array.from({ length: contactCount }, (_, index) => ({
    id: `${id}:contact:${index + 1}`,
    number: index + 1,
    contactType: "",
    circuit: "",
    terminalArticle: "",
    wire: "",
    color: "",
    secondaryColor: "",
    connectionStatus: "available",
    customValues: {},
  }));
  return {
    id,
    designation: normalizedDesignation,
    libraryCode: "FREE",
    partNumber: normalizedPartNumber,
    contacts,
    schematic: {
      orientation: "contacts-right",
      baseColumns: createDefaultConnectorBaseColumns(),
      customFields: [],
    },
    positions: { e4: e4Position, drawing: drawingPosition },
    layerIds: { e4: defaultLayerIds.connectors, drawing: defaultLayerIds.connectors },
    libraryBinding: { mode: "free" },
  };
}
export function createWire(
  id: string,
  from: WireEndpoint,
  to: WireEndpoint,
  lengthMm: number | null = 100,
  circuit = "",
  color = "#334155",
  endCorrectionFromMm = 0,
  endCorrectionToMm = 0,
  cutRoundingStepMm = 1,
  colorSource?: WireColorSource,
): WireInstance {
  const wire: WireInstance = {
    id,
    from,
    to,
    circuit: circuit.trim(),
    color,
    colorSource,
    lengthMm,
    endCorrectionFromMm,
    endCorrectionToMm,
    cutRoundingStepMm,
    e4Route: [],
    e4RouteMode: "auto",
    e4LabelPosition: 0.5,
    drawingRoute: [],
    layerIds: { e4: defaultLayerIds.wires, drawing: defaultLayerIds.wires },
  };
  calculateWireCutLength(wire);
  return wire;
}
