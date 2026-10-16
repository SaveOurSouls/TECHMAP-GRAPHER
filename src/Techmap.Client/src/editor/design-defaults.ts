import { type EditorLayer, type HarnessDesignDocument } from "./design-types";

export const defaultE4WireLead = 24;
export const e4ScreenAlongSize = 18;
export const defaultLayerIds = {
  connectors: "connectors",
  wires: "wires",
  dimensions: "dimensions",
  connectionPoints: "connection-points",
  materialIndexes: "material-indexes",
} as const;
function defaultLayers(): readonly EditorLayer[] {
  return [
    { id: defaultLayerIds.materialIndexes, name: "Индексы материалов и позиции", order: 4, visible: true, locked: false },
    { id: defaultLayerIds.connectionPoints, name: "Точки соединения", order: 3, visible: true, locked: false },
    { id: defaultLayerIds.dimensions, name: "Размеры", order: 2, visible: true, locked: false },
    { id: defaultLayerIds.connectors, name: "Соединители", order: 1, visible: true, locked: false },
    { id: defaultLayerIds.wires, name: "Провода", order: 0, visible: true, locked: false },
  ];
}
export function createEmptyHarnessDesign(): HarnessDesignDocument {
  return {
    schemaVersion: 1,
    customWireColors: [],
    connectors: [],
    wires: [],
    cables: [],
    junctions: [],
    diffPairs: [],
    screens: [],
    views: {
      e4: { layers: defaultLayers(), wireCrossingStyle: "none", e4RoutingMode: "orthogonal" },
      drawing: { layers: defaultLayers(), wireCrossingStyle: "none" },
    },
  };
}
