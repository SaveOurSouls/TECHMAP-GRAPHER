import type { TemplateContentV3 } from "./template-model-v3";
import {
  upgradeTemplateContentV3ToV4,
  validateTemplateContentV4,
  type TemplateContentV4,
  type TemplateV4Validation,
} from "./template-model-v4";

/** @deprecated Use TemplateContentV4. */
export type TemplateContentV4Draft = TemplateContentV4;
/** @deprecated Use TemplateV4Validation. */
export type TemplateV4DraftValidation = TemplateV4Validation;

/** @deprecated Use upgradeTemplateContentV3ToV4. */
export function upgradeTemplateContentV3ToV4Draft(content: TemplateContentV3): TemplateContentV4 {
  return upgradeTemplateContentV3ToV4(content).content;
}

/** @deprecated Use validateTemplateContentV4. */
export const validateTemplateContentV4Draft = validateTemplateContentV4;
