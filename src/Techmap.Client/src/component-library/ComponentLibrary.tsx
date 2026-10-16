export { type Draft } from "./library-editor-types";
export {
  TEMPLATE_UNDO_LIMIT,
  pushTemplateUndo,
  reconcileE4ConnectorTable,
  applySeriesTerminalsToEditor,
  addSeriesArticles,
  shouldAutoSaveTemplate,
  addLegacyArticleBindingsToV3,
  articleBindingsFromTemplateV3,
} from "./library-draft-adapters";
export {
  isTemplateUndoShortcut,
  isTemplateAssetReferencedV2,
  createTemplateImageNodeV2,
  nextTemplateSelectionV2,
  nodeDimensions,
  editDimension,
} from "./library-node-editing";
export {
  connectorArticleSearchRequest,
  connectorArticleInputs,
  terminalArticleSearchRequest,
  terminalArticleInputs,
  LEGACY_TERMINAL_REFERENCE_SOURCE,
  searchTerminalArticles,
  terminalCatalogLabel,
} from "./library-catalog-adapters";
export { ComponentLibrary } from "./ComponentLibrarySurface";
