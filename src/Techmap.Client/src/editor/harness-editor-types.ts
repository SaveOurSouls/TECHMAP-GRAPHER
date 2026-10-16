import { type RuntimeConfig } from "../runtime-config";
import { type LocalSession } from "../local-session";
import { type HarnessEditorView, type EditorSceneObject } from "./editor-types";
import { type HarnessDesignApi } from "./design-api";
import { createComponentPlacementApi, type PlaceComponentRequest } from "./component-placement-api";
import { type HarnessSectionId } from "./HarnessSectionNavigation";
import { type HarnessDesignDocument } from "./model";
import { type EditorHistory } from "./history";

export interface HarnessDesignEditorProps {
  readonly config: RuntimeConfig;
  readonly session: LocalSession;
  readonly projectId: string;
  readonly harnessId: string;
  readonly harnessDesignation: string;
  readonly initialView: HarnessEditorView;
  readonly harnessQuantity?: number;
  readonly initialReveal?: { readonly projectId: string; readonly harnessId: string; readonly objectId: string };
  readonly apiOverride?: HarnessDesignApi;
  readonly componentPlacementApiOverride?: ReturnType<typeof createComponentPlacementApi>;
  readonly onClose?: () => void;
  readonly onViewChange?: (view: HarnessEditorView) => void;
  readonly onRouteRequest?: () => void;
  readonly onSectionChange?: (section: HarnessSectionId) => void | Promise<void>;
  /** Edits an independent drawing copy in memory until the operator explicitly saves it. */
  readonly localCopy?: {
    readonly initialDocument: HarnessDesignDocument;
    readonly hiddenObjectIds?: readonly string[];
    readonly backgroundOpacity?: number;
    readonly onSave: (document: HarnessDesignDocument, hiddenObjectIds: readonly string[], backgroundOpacity: number) => void;
    readonly onCancel: () => void;
    readonly onHiddenObjectIdsChange?: (ids: readonly string[]) => void;
    readonly onBackgroundOpacityChange?: (opacity: number) => void;
    readonly onDraftChange?: (document: HarnessDesignDocument, hiddenObjectIds: readonly string[], backgroundOpacity: number) => void;
    /** Creates a detached material fragment from the current working copy. */
    readonly onIsolateObjects?: (document: HarnessDesignDocument, objectIds: readonly string[], scene?: readonly EditorSceneObject[]) => HarnessDesignDocument | null;
    readonly onObjectsSave?: (document: HarnessDesignDocument, objectIds: readonly string[], scene: readonly EditorSceneObject[]) => void;
    /** Allow an existing isolated copy to be committed without a geometry edit. */
    readonly allowCleanSave?: boolean;
    /** Capture selection on the dimmed drawing without changing its geometry. */
    readonly captureSelection?: boolean;
    readonly revealedObjectIds?: readonly string[];
  };
}
export interface PendingComponentPlacement {
  readonly body: PlaceComponentRequest;
  readonly nextHistory: EditorHistory;
  readonly connectorId: string;
  /** Prevents a late response for a previously opened harness changing the current editor. */
  readonly loadGeneration: number;
}
