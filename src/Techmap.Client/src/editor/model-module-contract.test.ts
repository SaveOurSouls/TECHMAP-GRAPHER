import { expect, it } from "vitest";
import * as model from "./model";
import * as module0 from "./connector-presentation";
import * as module1 from "./wire-measurements";
import * as module2 from "./design-defaults";
import * as module3 from "./design-document-parser";
import * as module4 from "./design-e4-geometry";
import * as module5 from "./design-connector-parser";
import * as module6 from "./design-wire-parser";

it("preserves all original runtime model exports without leaking parser internals", () => {
  expect({ ...model }).toEqual({
    connectorBaseColumnKeys: module0.connectorBaseColumnKeys,
    templateNameColumnId: module0.templateNameColumnId,
    connectorContactName: module0.connectorContactName,
    connectorE4TableMetrics: module0.connectorE4TableMetrics,
    connectorE4FooterWidth: module0.connectorE4FooterWidth,
    connectorE4TableColumnWidth: module0.connectorE4TableColumnWidth,
    templateTerminalChoices: module0.templateTerminalChoices,
    calculateCableSheathStrip: module1.calculateCableSheathStrip,
    calculateWireStripSteps: module1.calculateWireStripSteps,
    defaultWireCutRoundingStepMm: module1.defaultWireCutRoundingStepMm,
    calculateWireCutLength: module1.calculateWireCutLength,
    defaultE4WireLead: module2.defaultE4WireLead,
    e4ScreenAlongSize: module2.e4ScreenAlongSize,
    defaultLayerIds: module2.defaultLayerIds,
    createDefaultConnectorBaseColumns: module0.createDefaultConnectorBaseColumns,
    connectorE4Contacts: module0.connectorE4Contacts,
    connectorE4TableGeometry: module0.connectorE4TableGeometry,
    createEmptyHarnessDesign: module2.createEmptyHarnessDesign,
    parseHarnessDesignDocument: module3.parseHarnessDesignDocument,
    isJunctionEndpoint: module4.isJunctionEndpoint,
    createJunctionEndpoint: module4.createJunctionEndpoint,
    isScreenEndpoint: module4.isScreenEndpoint,
    createScreenEndpoint: module4.createScreenEndpoint,
    wireEndpointE4Anchor: module4.wireEndpointE4Anchor,
    wireScreenConnectionGeometry: module4.wireScreenConnectionGeometry,
    wireScreenConnectionPoint: module4.wireScreenConnectionPoint,
    validateE4Polyline: module4.validateE4Polyline,
    validateOrthogonalE4Route: module4.validateOrthogonalE4Route,
    createOrthogonalE4Route: module4.createOrthogonalE4Route,
    connectorContactPosition: module0.connectorContactPosition,
    findWireEndpoint: module4.findWireEndpoint,
    parseDrawingPlacements: module5.parseDrawingPlacements,
    validateConnectorLibraryMetadata: module5.validateConnectorLibraryMetadata,
    parseConnectorSchematic: module5.parseConnectorSchematic,
    normalizeCableInstance: module6.normalizeCableInstance,
    parseOuterDiameter: module1.parseOuterDiameter,
    normalizeWireStripProfileBinding: module6.normalizeWireStripProfileBinding,
    wireE4PathContainsPoint: module4.wireE4PathContainsPoint,
    wireGroupHasScreenCrossSection: module4.wireGroupHasScreenCrossSection,
    wireGroupHasCommonE4ParallelSpan: module4.wireGroupHasCommonE4ParallelSpan,
  });
});
