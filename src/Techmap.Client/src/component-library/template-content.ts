import type { TemplateContent as TemplateContentV1 } from "./template-model";
import {
  upgradeTemplateContentV1ToV2,
  validateTemplateContentV2,
  type TemplateContentV2,
  type TemplateAssetV2,
  type TemplateV2Diagnostic,
  type TemplateV2Upgrade,
} from "./template-model-v2";

export type ComponentTemplateContent = TemplateContentV1 | TemplateContentV2;
export type TemplateEnvelopeAsset = Readonly<TemplateAssetV2>;
export interface TemplateAssetReconciliation {
  readonly assets: TemplateAssetV2[];
  readonly diagnostics: readonly TemplateV2Diagnostic[];
}

export class ComponentTemplateContentError extends Error {
  readonly diagnostics: readonly TemplateV2Diagnostic[];

  constructor(message: string, diagnostics: readonly TemplateV2Diagnostic[] = []) {
    super(message);
    this.name = "ComponentTemplateContentError";
    this.diagnostics = diagnostics;
  }
}

export function parseComponentTemplateContent(value: unknown): ComponentTemplateContent {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new ComponentTemplateContentError("Содержимое шаблона должно быть объектом.");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion === 1) {
    if (!Array.isArray(candidate.views))
      throw new ComponentTemplateContentError("Шаблон v1 не содержит массив видов.");
    return value as TemplateContentV1;
  }
  if (candidate.schemaVersion === 2) {
    const validation = validateTemplateContentV2(value);
    if (!validation.valid)
      throw new ComponentTemplateContentError("Шаблон v2 не прошёл проверку содержимого.", validation.diagnostics);
    return value as TemplateContentV2;
  }
  throw new ComponentTemplateContentError("Шаблон имеет неподдерживаемую схему содержимого.");
}

export function isTemplateContentV1(content: ComponentTemplateContent): content is TemplateContentV1 {
  return content.schemaVersion === 1;
}

export function isTemplateContentV2(content: ComponentTemplateContent): content is TemplateContentV2 {
  return content.schemaVersion === 2;
}

export function upgradeComponentTemplateContentV1(
  content: TemplateContentV1,
  envelopeAssets: readonly TemplateEnvelopeAsset[] = [],
): TemplateV2Upgrade {
  const upgraded = upgradeTemplateContentV1ToV2(content);
  const assets = normalizeTemplateEnvelopeAssets(envelopeAssets);
  const result = { ...upgraded, content: { ...upgraded.content, assets } };
  const validation = validateTemplateContentV2(result.content);
  return validation.valid ? result : { ...result, diagnostics: [...result.diagnostics, ...validation.diagnostics] };
}

export function normalizeTemplateEnvelopeAssets(assets: readonly TemplateEnvelopeAsset[]): TemplateAssetV2[] {
  return assets.map(asset => ({
    assetId: asset.assetId, fileName: asset.fileName, mediaType: asset.mediaType,
    sha256: asset.sha256, sizeBytes: asset.sizeBytes,
  })).sort((left, right) => left.assetId.localeCompare(right.assetId));
}

export function reconcileTemplateEnvelopeAssets(
  content: ComponentTemplateContent,
  envelopeAssets: readonly TemplateEnvelopeAsset[],
): TemplateAssetReconciliation {
  const assets = normalizeTemplateEnvelopeAssets(envelopeAssets);
  if (content.schemaVersion === 1) return { assets, diagnostics: [] };
  const contentAssets = normalizeTemplateEnvelopeAssets(content.assets);
  const matches = contentAssets.length === assets.length && contentAssets.every((asset, index) =>
    asset.assetId === assets[index]!.assetId && asset.fileName === assets[index]!.fileName &&
    asset.mediaType === assets[index]!.mediaType && asset.sha256 === assets[index]!.sha256 &&
    asset.sizeBytes === assets[index]!.sizeBytes);
  return matches ? { assets, diagnostics: [] } : { assets, diagnostics: [{
    code: "asset_envelope_mismatch", path: "$.assets",
    message: "Метаданные assets внутри шаблона v2 не совпадают с assets версии шаблона.",
  }] };
}
