import { expect, it } from "vitest";
import * as library from "./ComponentLibrary";
import * as module0 from "./library-draft-adapters";
import * as module1 from "./library-node-editing";
import * as module2 from "./library-catalog-adapters";
import * as module3 from "./ComponentLibrarySurface";

it("preserves all original library exports without exposing editor internals", () => {
  expect({ ...library }).toEqual({
    TEMPLATE_UNDO_LIMIT: module0.TEMPLATE_UNDO_LIMIT,
    pushTemplateUndo: module0.pushTemplateUndo,
    reconcileE4ConnectorTable: module0.reconcileE4ConnectorTable,
    applySeriesTerminalsToEditor: module0.applySeriesTerminalsToEditor,
    addSeriesArticles: module0.addSeriesArticles,
    isTemplateUndoShortcut: module1.isTemplateUndoShortcut,
    isTemplateAssetReferencedV2: module1.isTemplateAssetReferencedV2,
    connectorArticleSearchRequest: module2.connectorArticleSearchRequest,
    connectorArticleInputs: module2.connectorArticleInputs,
    terminalArticleSearchRequest: module2.terminalArticleSearchRequest,
    terminalArticleInputs: module2.terminalArticleInputs,
    LEGACY_TERMINAL_REFERENCE_SOURCE: module2.LEGACY_TERMINAL_REFERENCE_SOURCE,
    searchTerminalArticles: module2.searchTerminalArticles,
    terminalCatalogLabel: module2.terminalCatalogLabel,
    shouldAutoSaveTemplate: module0.shouldAutoSaveTemplate,
    addLegacyArticleBindingsToV3: module0.addLegacyArticleBindingsToV3,
    articleBindingsFromTemplateV3: module0.articleBindingsFromTemplateV3,
    createTemplateImageNodeV2: module1.createTemplateImageNodeV2,
    nextTemplateSelectionV2: module1.nextTemplateSelectionV2,
    ComponentLibrary: module3.ComponentLibrary,
    nodeDimensions: module1.nodeDimensions,
    editDimension: module1.editDimension,
  });
});
