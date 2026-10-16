import { updateLayers, replaceRequired, validateLayers, moveLayer } from "./editor-command-invariants";
import { type HarnessDesignDocument } from "./model";
import { type EditorCommand } from "./editor-command-types";

export function applyLayersCommand(document: HarnessDesignDocument, command: Extract<EditorCommand, { type: "update-layer" | "replace-layers" | "move-layer" }>): HarnessDesignDocument {
  switch (command.type) {

    case "update-layer":
      return updateLayers(document, command.view, (layers) =>
        replaceRequired(layers, command.layerId, (layer) => ({
          ...layer,
          visible: command.visible ?? layer.visible,
          locked: command.locked ?? layer.locked,
        }), "Слой не найден."));

    case "replace-layers":
      validateLayers(command.layers);
      return updateLayers(document, command.view, () => command.layers.map((layer) => ({ ...layer })));

    case "move-layer":
      return updateLayers(document, command.view, (layers) => moveLayer(layers, command.layerId, command.direction));
  }
}
