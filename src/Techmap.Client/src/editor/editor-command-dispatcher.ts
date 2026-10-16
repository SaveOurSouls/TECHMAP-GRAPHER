import { type HarnessDesignDocument } from "./model";
import { type EditorCommand } from "./editor-command-types";
import { isTerminationCommand, applyTerminationCommand, reconcileTerminationReferences } from "./termination-commands";
import { pipeMeasuredWireLength, reconcileDrawingDimensions } from "./drawing-dimensions";
import { snapshotSharedWireProperties } from "./editor-command-invariants";
import { refreshAutomaticPhysicalRoutes } from "./physical-wire-routing";
import { prunePhysicalTopology } from "./physical-topology";
import { reconcileDrawingDocuments } from "./drawing-documents";
import { validateTerminationComponents, validateTerminationCircuits } from "./termination-model";
import { applyE4Command } from "./commands-e4";
import { applyPhysicalCommand } from "./commands-physical";
import { applyConnectorsCommand } from "./commands-connectors";
import { applyWiresCommand } from "./commands-wires";
import { applyGroupsCommand } from "./commands-groups";
import { applyLayersCommand } from "./commands-layers";

export function applyEditorCommand(
  document: HarnessDesignDocument,
  command: EditorCommand,
): HarnessDesignDocument {
  if(isTerminationCommand(command)) return applyTerminationCommand(document,command);
  if(command.type==="update-wire"&&command.lengthMm!==undefined&&(document.drawingDocuments?.dimensions?.some(d=>d.wireId===command.wireId&&!d.auxiliary)||pipeMeasuredWireLength(document,command.wireId).managed))throw new Error("Длина задана размерами на чертеже. Измените размер либо удалите его для ручного ввода.");
  const source = snapshotSharedWireProperties(document,command);
  const changed = reconcileDrawingDimensions(source, refreshAutomaticPhysicalRoutes(source, prunePhysicalTopology(applyCommand(source, command))));
  const result = reconcileTerminationReferences(reconcileDrawingDocuments(source, changed));
  validateTerminationComponents(result);
  if(result.terminations||result.connectors.some(c=>c.terminationComponent)||result.wires.some(w=>w.wireMark!==undefined||w.wireSection!==undefined||w.secondaryColor!==undefined||w.wireDiameterMm!==undefined)){
    validateTerminationCircuits(result);
    return {...result,requiredWriterContractVersion:3};
  }
  return result;
}

function applyCommand(document: HarnessDesignDocument, command: EditorCommand): HarnessDesignDocument {
if(isTerminationCommand(command)) return applyTerminationCommand(document,command);
  switch (command.type) {
    case "edit-e4-bend": return applyE4Command(document, command);
    case "add-visible-pipe-dimension": return applyPhysicalCommand(document, command);
    case "remove-physical-bend": return applyPhysicalCommand(document, command);
    case "edit-physical-bend": return applyPhysicalCommand(document, command);
    case "edit-joining-pipe-bend": return applyPhysicalCommand(document, command);
    case "move-joining-pipe": return applyPhysicalCommand(document, command);
    case "update-joining-pipe-exit": return applyPhysicalCommand(document, command);
    case "update-joining-pipe-member-bend": return applyPhysicalCommand(document, command);
    case "update-joining-pipe-member-boundary": return applyPhysicalCommand(document, command);
    case "clear-joining-pipe-member-boundary": return applyPhysicalCommand(document, command);
    case "update-joining-pipe": return applyPhysicalCommand(document, command);
    case "move-physical-node": return applyPhysicalCommand(document, command);
    case "set-drawing-documents": return applyPhysicalCommand(document, command);
    case "set-physical-topology": return applyPhysicalCommand(document, command);
    case "remove-physical-segment": return applyPhysicalCommand(document, command);
    case "add-connector": return applyConnectorsCommand(document, command);
    case "set-drawing-placement": return applyWiresCommand(document, command);
    case "set-contact-side-view": return applyConnectorsCommand(document, command);
    case "move-connector": return applyConnectorsCommand(document, command);
    case "update-connector": return applyConnectorsCommand(document, command);
    case "apply-connector-article": return applyConnectorsCommand(document, command);
    case "use-e4-table": return applyE4Command(document, command);
    case "refresh-template-terminals": return applyWiresCommand(document, command);
    case "apply-template-article": return applyWiresCommand(document, command);
    case "flip-connector-orientation": return applyConnectorsCommand(document, command);
    case "update-contact": return applyConnectorsCommand(document, command);
    case "reset-contact-color-auto": return applyConnectorsCommand(document, command);
    case "add-contact": return applyConnectorsCommand(document, command);
    case "move-contact-row": return applyConnectorsCommand(document, command);
    case "remove-contact": return applyConnectorsCommand(document, command);
    case "set-name-column-visibility": return applyConnectorsCommand(document, command);
    case "toggle-base-column-visibility": return applyConnectorsCommand(document, command);
    case "add-custom-field": return applyConnectorsCommand(document, command);
    case "remove-custom-field": return applyConnectorsCommand(document, command);
    case "toggle-custom-field-visibility": return applyConnectorsCommand(document, command);
    case "remove-connector": return applyConnectorsCommand(document, command);
    case "add-cable": return applyWiresCommand(document, command);
    case "update-cable": return applyWiresCommand(document, command);
    case "set-cable-members": return applyWiresCommand(document, command);
    case "remove-cable": return applyWiresCommand(document, command);
    case "add-wire": return applyWiresCommand(document, command);
    case "remove-wire": return applyWiresCommand(document, command);
    case "update-wire": return applyWiresCommand(document, command);
    case "set-wire-strip-profile": return applyWiresCommand(document, command);
    case "set-wire-drawing-end-style": return applyWiresCommand(document, command);
    case "set-wire-drawing-end-styles": return applyWiresCommand(document, command);
    case "set-wire-drawing-endpoints-x": return applyWiresCommand(document, command);
    case "set-wire-drawing-endpoint": return applyWiresCommand(document, command);
    case "set-e4-wire-label-position": return applyE4Command(document, command);
    case "reconnect-wire": return applyWiresCommand(document, command);
    case "set-wire-route": return applyWiresCommand(document, command);
    case "set-e4-wire-route": return applyE4Command(document, command);
    case "move-e4-wire-route-point": return applyE4Command(document, command);
    case "remove-e4-wire-route-point": return applyE4Command(document, command);
    case "reroute-e4-wires": return applyE4Command(document, command);
    case "move-e4-wire-segment": return applyE4Command(document, command);
    case "set-wire-crossing-style": return applyE4Command(document, command);
    case "set-e4-routing-mode": return applyE4Command(document, command);
    case "create-junction": return applyGroupsCommand(document, command);
    case "move-junction": return applyGroupsCommand(document, command);
    case "remove-junction": return applyGroupsCommand(document, command);
    case "connect-wire-to-junction": return applyGroupsCommand(document, command);
    case "connect-wire-to-wire": return applyGroupsCommand(document, command);
    case "edit-detached-wire-bend": return applyWiresCommand(document, command);
    case "remove-detached-wire-bend": return applyWiresCommand(document, command);
    case "set-detached-wire-pair": return applyWiresCommand(document, command);
    case "create-diff-pair": return applyGroupsCommand(document, command);
    case "update-diff-pair": return applyGroupsCommand(document, command);
    case "remove-diff-pair": return applyGroupsCommand(document, command);
    case "create-screen": return applyGroupsCommand(document, command);
    case "update-screen": return applyGroupsCommand(document, command);
    case "remove-screen": return applyGroupsCommand(document, command);
    case "update-layer": return applyLayersCommand(document, command);
    case "replace-layers": return applyLayersCommand(document, command);
    case "move-layer": return applyLayersCommand(document, command);
  }
}
