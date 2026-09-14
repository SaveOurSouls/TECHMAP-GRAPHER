import type { TemplateContent as TemplateContentV1 } from "./template-model";
import {
  upgradeTemplateContentV1ToV2,
  validateTemplateContentV2,
  type TemplateContentV2,
  type TemplateV2Diagnostic,
  type TemplateV2Upgrade,
} from "./template-model-v2";

export type ComponentTemplateContent = TemplateContentV1 | TemplateContentV2;

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

export function upgradeComponentTemplateContentV1(content: TemplateContentV1): TemplateV2Upgrade {
  return upgradeTemplateContentV1ToV2(content);
}
