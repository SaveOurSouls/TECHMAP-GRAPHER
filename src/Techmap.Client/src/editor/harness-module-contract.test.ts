import { expect, it } from "vitest";
import * as editor from "./HarnessDesignEditor";
import { HarnessDesignEditor } from "./HarnessDesignEditorSurface";
import { designToScene } from "./harness-scene-projection";
import * as snapshots from "./harness-component-snapshots";
import * as catalog from "./harness-catalog-adapters";
import { normalizeEditorSelection, selectedEditorDeletionCommands } from "./harness-selection-adapters";
import { HarnessEditorErrorBoundary } from "./HarnessEditorBoundary";

it("preserves editor facade identities without exposing controller or scene internals", () => {
  expect(editor.HarnessDesignEditor).toBe(HarnessDesignEditor);
  expect(editor.designToScene).toBe(designToScene);
  expect(editor.HarnessEditorErrorBoundary).toBe(HarnessEditorErrorBoundary);
  expect(editor.normalizeEditorSelection).toBe(normalizeEditorSelection);
  expect(editor.selectedEditorDeletionCommands).toBe(selectedEditorDeletionCommands);
  for (const name of ["buildProjectComponentSnapshotLookup", "acceptProjectComponentSnapshotLookup",
    "buildComponentTemplateViewInstances", "loadComponentTemplateForPlacement", "useLocalCopyTemplateViews",
    "loadComponentTemplateForLocalCopy", "localTemplateSnapshot", "saveLocalDrawingCopy"] as const) {
    expect(editor[name]).toBe(snapshots[name]);
  }
  for (const name of ["wireMaterialUpdateFromCatalogItem", "cableMaterialUpdateFromCatalogItem",
    "wireStripProfileDisplayWarning", "wireStripProfileUpdateFromCatalogItem", "editorWireUpdateCommand"] as const) {
    expect(editor[name]).toBe(catalog[name]);
  }
  for (const name of ["useHarnessDesignEditor", "contactPointForWire", "toUiLayers", "fromUiLayers"]) {
    expect(editor).not.toHaveProperty(name);
  }
});
