import { type EditorCommand } from "./commands";
import { type EditorCatalogItem, type EditorSceneObject } from "./editor-types";
import { type WireEndStripProfiles, type WireStripProfileBinding } from "./model";
import { buildWireStripProfileGeometry } from "./wire-strip-profile-geometry";

type WireUpdateCommand = Extract<EditorCommand, { readonly type: "update-wire" }>;
export type WireMaterialCatalogUpdateResult =
  | { readonly ok: true; readonly command: WireUpdateCommand }
  | { readonly ok: false; readonly error: string };
/** Builds an immutable material assignment without depending on editor or React state. */
export function wireMaterialUpdateFromCatalogItem(
  item: EditorCatalogItem,
  selectedWireId: string | null,
): WireMaterialCatalogUpdateResult {
  if (!selectedWireId) {
    return { ok: false, error: "Сначала выберите один провод, затем дважды щёлкните материал в справочнике." };
  }
  if (item.entityType !== "wire" && item.entityType !== "cable") {
    return { ok: false, error: "Выбранная справочная позиция не является проводом или кабелем." };
  }
  if (!item.sourceId || !item.snapshotId || !item.snapshotSha256 || !item.recordId || !item.sourceKey) {
    return { ok: false, error: "Справочная позиция не содержит данных опубликованной версии." };
  }
  return {
    ok: true,
    command: {
      type: "update-wire",
      wireId: selectedWireId,
      materialBinding: {
        sourceId: item.sourceId,
        snapshotId: item.snapshotId,
        snapshotSha256: item.snapshotSha256,
        recordId: item.recordId,
        entityType: item.entityType,
        sourceKey: item.sourceKey,
        displayName: item.referenceDisplayName || item.sourceKey,
        ...(item.sectionUnit === undefined ? {} : { sectionUnit: item.sectionUnit }),
    ...(item.outerDiameterMm===undefined?{}:{outerDiameterMm:item.outerDiameterMm}),
      },
    },
  };
}
type CableUpdateCommand = Extract<EditorCommand, { readonly type: "update-cable" }>;
export function cableMaterialUpdateFromCatalogItem(
  item: EditorCatalogItem,
  cableId: string | null,
): { readonly ok: true; readonly command: CableUpdateCommand } | { readonly ok: false; readonly error: string } {
  if (!cableId) return { ok: false, error: "Сначала создайте кабель из выбранных проводов." };
  if (item.entityType !== "cable") return { ok: false, error: "Для общего материала выберите кабель." };
  if (!item.sourceId || !item.snapshotId || !item.snapshotSha256 || !item.recordId || !item.sourceKey) {
    return { ok: false, error: "Справочная позиция не содержит данных опубликованной версии." };
  }
  return { ok: true, command: { type: "update-cable", cableId, materialBinding: {
    sourceId: item.sourceId, snapshotId: item.snapshotId, snapshotSha256: item.snapshotSha256,
    recordId: item.recordId, entityType: "cable", sourceKey: item.sourceKey,
    displayName: item.referenceDisplayName || item.sourceKey,
    ...(item.sectionUnit === undefined ? {} : { sectionUnit: item.sectionUnit }),
    ...(item.outerDiameterMm===undefined?{}:{outerDiameterMm:item.outerDiameterMm}),
  } } };
}
/** Reports saved end treatments that cannot be projected on the current route. */
export function wireStripProfileDisplayWarning(
  points: readonly { readonly x: number; readonly y: number }[],
  profiles: WireEndStripProfiles | undefined,
): string | null {
  if (!profiles) return null;
  const hiddenEnds = (["from", "to"] as const).filter((end) => {
    const profile = profiles[end];
    return profile !== undefined && buildWireStripProfileGeometry(points, end, profile) === null;
  });
  return hiddenEnds.length > 0 ? hiddenEnds.join(",") : null;
}
type WireStripProfileCommand = Extract<EditorCommand, { readonly type: "set-wire-strip-profile" }>;
export type WireStripProfileCatalogUpdateResult =
  | { readonly ok: true; readonly command: WireStripProfileCommand }
  | { readonly ok: false; readonly error: string };
/** Builds an exact end-treatment assignment from a published БД.КОАКС row. */
export function wireStripProfileUpdateFromCatalogItem(
  item: EditorCatalogItem,
  selectedWireId: string | null,
  end: "from" | "to",
  disabled = false,
): WireStripProfileCatalogUpdateResult {
  if (!selectedWireId) {
    return { ok: false, error: "Сначала выберите один провод на чертеже, затем профиль разделки." };
  }
  if (disabled) return { ok: false, error: "Слой выбранного провода заблокирован." };
  if (item.entityType !== "coax-termination" || !item.coaxTerminationCandidate) {
    return { ok: false, error: "Выбранная справочная позиция не является профилем разделки." };
  }
  const candidate = item.coaxTerminationCandidate;
  if (candidate.state !== "ready" || !candidate.binding) {
    return {
      ok: false,
      error: candidate.diagnostics[0]?.message || "Профиль разделки заполнен не полностью.",
    };
  }
  const profile: WireStripProfileBinding = {
    ...candidate.binding,
    displayName: item.referenceDisplayName || item.title || candidate.binding.sourceKey,
  };
  return { ok: true, command: { type: "set-wire-strip-profile", wireId: selectedWireId, end, profile } };
}
/** Translates inspector metadata into a command while preserving omitted-versus-null length semantics. */
export function editorWireUpdateCommand(
  selected: EditorSceneObject,
  previous: EditorSceneObject,
): WireUpdateCommand {
  const parseMetadataNumber = (key: string): number | undefined => {
    const value = selected.metadata?.[key];
    if (value === undefined || value.trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const lengthKnownChanged = selected.metadata?.lengthKnown !== previous.metadata?.lengthKnown;
  const lengthChanged = selected.metadata?.lengthMm !== previous.metadata?.lengthMm;
  const lengthMm = parseMetadataNumber("lengthMm");
  const endCorrectionFromMm = parseMetadataNumber("endCorrectionFromMm");
  const endCorrectionToMm = parseMetadataNumber("endCorrectionToMm");
  const cutRoundingStepMm = parseMetadataNumber("cutRoundingStepMm");
  return {
    type: "update-wire",
    wireId: selected.id,
    circuit: selected.label === previous.label ? undefined : selected.label,
    color: selected.color === previous.color ? undefined : selected.color,
    lengthMm: lengthKnownChanged && selected.metadata?.lengthKnown === "false"
      ? null
      : selected.metadata?.lengthKnown === "true" && (lengthKnownChanged || lengthChanged) && lengthMm !== undefined
        ? lengthMm
        : undefined,
    endCorrectionFromMm: selected.metadata?.endCorrectionFromMm !== previous.metadata?.endCorrectionFromMm
      ? endCorrectionFromMm : undefined,
    endCorrectionToMm: selected.metadata?.endCorrectionToMm !== previous.metadata?.endCorrectionToMm
      ? endCorrectionToMm : undefined,
    cutRoundingStepMm: selected.metadata?.cutRoundingStepMm !== previous.metadata?.cutRoundingStepMm
      ? cutRoundingStepMm : undefined,
  };
}
