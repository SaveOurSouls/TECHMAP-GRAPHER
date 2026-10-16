export { type HarnessDesignEditorProps } from "./harness-editor-types";
export {
  type ProjectComponentSnapshotLookup,
  buildProjectComponentSnapshotLookup,
  acceptProjectComponentSnapshotLookup,
  buildComponentTemplateViewInstances,
  loadComponentTemplateForPlacement,
  useLocalCopyTemplateViews,
  loadComponentTemplateForLocalCopy,
  localTemplateSnapshot,
  saveLocalDrawingCopy,
} from "./harness-component-snapshots";
export { HarnessEditorErrorBoundary, ComponentGraphErrorAlert } from "./HarnessEditorBoundary";
export { normalizeEditorSelection, selectedEditorDeletionCommands, snapRoutePoint } from "./harness-selection-adapters";
export { designToScene } from "./harness-scene-projection";
export {
  type WireMaterialCatalogUpdateResult,
  wireMaterialUpdateFromCatalogItem,
  cableMaterialUpdateFromCatalogItem,
  wireStripProfileDisplayWarning,
  type WireStripProfileCatalogUpdateResult,
  wireStripProfileUpdateFromCatalogItem,
  editorWireUpdateCommand,
} from "./harness-catalog-adapters";
export { HarnessDesignEditor } from "./HarnessDesignEditorSurface";
