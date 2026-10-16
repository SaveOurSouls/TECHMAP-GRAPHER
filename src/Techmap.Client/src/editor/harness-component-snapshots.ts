import { type ProjectComponentSnapshotResource, type ProjectComponentPlacementGraph } from "./component-placement-api";
import { type HarnessDesignDocument } from "./model";
import { type ComponentTemplateViewInstance } from "./component-template-view-renderer";
import { isTemplateContentV3, isTemplateContentV4, isTemplateContentV5 } from "../component-library/template-content";
import { createConnectorInstanceFromComponentTemplateV3 } from "./component-template-placement";
import { type ComponentTemplateApi, createComponentTemplateApi } from "../component-library/component-template-api";
import { type RuntimeConfig } from "../runtime-config";
import { type LocalSession } from "../local-session";
import { useMemo, useState, useEffect, useCallback } from "react";

export type ProjectComponentSnapshotLookup = ReadonlyMap<string, ProjectComponentSnapshotResource>;
/** Resolves every project placement to the exact immutable snapshot returned for this harness. */
export function buildProjectComponentSnapshotLookup(
  graph: ProjectComponentPlacementGraph,
): ProjectComponentSnapshotLookup {
  const snapshots = new Map(graph.snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]));
  const result = new Map<string, ProjectComponentSnapshotResource>();
  for (const placement of graph.placements) {
    const snapshot = snapshots.get(placement.snapshotId);
    if (!snapshot) throw new Error("Для библиотечного компонента отсутствует закреплённый снимок.");
    if (result.has(placement.placementId)) {
      throw new Error("Сервер вернул повторяющееся размещение библиотечного компонента.");
    }
    result.set(placement.placementId, snapshot);
  }
  return result;
}
/** Keeps a graph response from an editor generation that is no longer visible out of current state. */
export function acceptProjectComponentSnapshotLookup(
  current: ProjectComponentSnapshotLookup,
  graph: ProjectComponentPlacementGraph,
  responseGeneration: number,
  currentGeneration: number,
): ProjectComponentSnapshotLookup {
  return responseGeneration === currentGeneration
    ? buildProjectComponentSnapshotLookup(graph)
    : current;
}
/** Builds render inputs only when the editable instance still matches its project-owned snapshot. */
export function buildComponentTemplateViewInstances(
  document: HarnessDesignDocument,
  snapshotsByPlacement: ProjectComponentSnapshotLookup,
): readonly ComponentTemplateViewInstance[] {
  return document.connectors.flatMap((connector): readonly ComponentTemplateViewInstance[] => {
    const binding = connector.libraryBinding;
    const snapshot = snapshotsByPlacement.get(connector.id);
    if (binding?.mode !== "template" || !snapshot ||
        (!isTemplateContentV3(snapshot.content) && !isTemplateContentV4(snapshot.content) && !isTemplateContentV5(snapshot.content))) return [];
    const articleVariant = snapshot.content.articleVariants.find((candidate) => candidate.id === binding.articleVariantId);
    const exactVersion = binding.templateId === snapshot.sourceTemplateId &&
      binding.templateVersion === snapshot.sourceVersion &&
      binding.versionSha256 === snapshot.sourceVersionSha256;
    const exactArticle = articleVariant?.sourceId.trim().normalize("NFC").toLowerCase() === binding.article.sourceId &&
      articleVariant.entityType.trim().normalize("NFC").toLowerCase() === binding.article.entityType &&
      articleVariant.articleKey === binding.article.articleKey;
    if (!exactVersion || !exactArticle) return [];
    try {
      const materialized = createConnectorInstanceFromComponentTemplateV3({
        templateId: snapshot.sourceTemplateId,
        version: snapshot.sourceVersion,
        versionSha256: snapshot.sourceVersionSha256,
        code: snapshot.code,
        name: snapshot.name,
        articleBindings: snapshot.articleBindings,
        assets: snapshot.assets,
        content: snapshot.content,
      }, {
        legacyNumberingPreview: binding.contactNumbering === undefined,
        id: connector.id,
        designation: connector.designation,
        articleVariantId: binding.articleVariantId,
        e4Position: connector.positions.e4,
        drawingPosition: connector.positions.drawing,
        layerIds: connector.layerIds,
      });
      const sortedContacts = (contacts: typeof binding.snapshot.contacts) =>
        [...contacts].sort((a,b)=>a.logicalContactId.localeCompare(b.logicalContactId));
      const exactMaterialization = materialized.libraryBinding?.mode === "template" &&
        JSON.stringify({...binding.snapshot,contacts:sortedContacts(binding.snapshot.contacts)}) ===
        JSON.stringify({...materialized.libraryBinding.snapshot,contacts:sortedContacts(materialized.libraryBinding.snapshot.contacts)});
      if (!exactMaterialization) return [];
    } catch {
      return [];
    }
    const contactWireColors: Record<string,string> = {};
    for (const wire of document.wires) for (const endpoint of [wire.from, wire.to]) if (endpoint.connectorId === connector.id) {
      const contact = connector.contacts.find(item => item.id === endpoint.contactId);
      if (contact?.logicalContactId && wire.color && !contactWireColors[contact.logicalContactId]) {
        contactWireColors[contact.logicalContactId] = wire.color;
        if (snapshot.content.schemaVersion === 5) {
          const logicalId = snapshot.content.drawingContactBindings?.find(binding => binding.seriesRowId === contact.logicalContactId)?.logicalContactId;
          if (logicalId) contactWireColors[logicalId] = wire.color;
        }
      }
    }
    return [{
      objectId: connector.id,
      snapshotId: snapshot.snapshotId,
      articleVariantId: binding.articleVariantId,
      content: snapshot.content,
      ...(Object.keys(contactWireColors).length ? {contactWireColors} : {}),
      ...(connector.drawingPlacements ? {drawingPlacements:connector.drawingPlacements} : {}),
    }];
  });
}
export async function loadComponentTemplateForPlacement(
  api: ComponentTemplateApi,
  templateId: string,
  catalogVersion: number,
) {
  const draft = await api.getDraft(templateId);
  return draft
    ? api.publishDraft(templateId, draft.baseVersion, draft.draftRevision)
    : api.getVersion(templateId, catalogVersion);
}
/** Read-only artwork for route previews whose copy contains connectors without project placements. */
const EMPTY_TEMPLATE_INSTANCES: readonly ComponentTemplateViewInstance[] = [];
export function useLocalCopyTemplateViews(
  document: HarnessDesignDocument | undefined,
  config: RuntimeConfig,
  session: LocalSession,
  projectId: string,
  enabled = true,
  projectInstances: readonly ComponentTemplateViewInstance[] = EMPTY_TEMPLATE_INSTANCES,
  projectAssetUrl?: (snapshotId: string, assetId: string) => string,
) {
  const api = useMemo(() => createComponentTemplateApi(config, session), [config, session]);
  const [snapshots, setSnapshots] = useState<ProjectComponentSnapshotLookup>(() => new Map());
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled || !document) return;
    let cancelled = false;
    const bindings = document.connectors.flatMap(connector => connector.libraryBinding?.mode === "template" && !projectInstances.some(instance => instance.objectId === connector.id)
      ? [{connectorId: connector.id, binding: connector.libraryBinding}]
      : []);
    void Promise.all(bindings.map(async ({connectorId, binding}) => {
      const template = await loadComponentTemplateForLocalCopy(api, binding.templateId, binding.templateVersion);
      if (template.versionSha256 !== binding.versionSha256) throw new Error("Версия библиотечного рисунка изменилась.");
      return [connectorId, localTemplateSnapshot(projectId, template)] as const;
    })).then(entries => {
      if (!cancelled) { setSnapshots(new Map(entries)); setError(""); }
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Не удалось загрузить библиотечные рисунки копии.");
    });
    return () => { cancelled = true; };
  }, [api, document?.connectors, enabled, projectId, projectInstances]);
  const instances = useMemo(() => enabled && document
    ? [...projectInstances, ...buildComponentTemplateViewInstances(document, snapshots).filter(instance => !projectInstances.some(project => project.objectId === instance.objectId))] : projectInstances,
    [document, enabled, snapshots, projectInstances]);
  const resolveAssetUrl = useCallback((snapshotId: string, assetId: string) => {
    const snapshot = [...snapshots.values()].find(item => item.snapshotId === snapshotId);
    return snapshot ? api.assetContentUrl(snapshot.sourceTemplateId, snapshot.sourceVersion, assetId)
      : projectAssetUrl?.(snapshotId, assetId) ?? "";
  }, [api, snapshots, projectAssetUrl]);
  return {instances, resolveAssetUrl, error};
}
/** Local drawing copies may read a published snapshot but must never publish a library draft. */
export function loadComponentTemplateForLocalCopy(
  api: ComponentTemplateApi,
  templateId: string,
  catalogVersion: number,
) {
  return api.getVersion(templateId, catalogVersion);
}
/** Adapts a read-only published template response to the renderer snapshot contract. */
export function localTemplateSnapshot(
  projectId: string,
  template: Awaited<ReturnType<ComponentTemplateApi["getVersion"]>>,
): ProjectComponentSnapshotResource {
  return {
    snapshotId: crypto.randomUUID(), projectId, sourceTemplateId: template.templateId,
    sourceVersion: template.version, sourceVersionSha256: template.versionSha256,
    code: template.code, name: template.name, articleBindings: template.articleBindings,
    assets: template.assets, schemaVersion: template.content.schemaVersion, content: template.content,
    createdUtc: template.createdUtc, updatedUtc: template.updatedUtc ?? template.createdUtc,
  };
}
export function saveLocalDrawingCopy(
  document: HarnessDesignDocument,
  hiddenObjectIds: readonly string[],
  backgroundOpacity: number,
  onSave: (document: HarnessDesignDocument, hiddenObjectIds: readonly string[], backgroundOpacity: number) => void,
): void {
  onSave(structuredClone(document), [...hiddenObjectIds], backgroundOpacity);
}
