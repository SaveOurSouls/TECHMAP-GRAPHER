import { builtInWireColors, resolveWireColorHex } from "../editor/wire-reference-catalog";

/** Pure display formatters for production wire labels. They never mutate the
 * saved harness or infer electrical data from a technical identifier. */

const technicalId = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

export function formatWireName(mark: string): string {
  const clean = mark.replace(technicalId, "").replace(/[·;,|]+/g, " ").replace(/\s+/g, " ").trim();
  return clean && clean !== "Марка не назначена" ? `Провод ${clean}` : "Провод";
}

export function formatWireMaterial(mark: string, section: string, color: string): string {
  const size = section.trim();
  const numeric = size.replace(/\s*(?:awg|мм\s*[²2]|mm\s*[²2])$/iu, "");
  const cleanMark = size ? mark.trim().replace(new RegExp(`(?:\\s*[·,;/]\\s*|\\s+)${escapeRegExp(numeric)}\\s*(?:awg|мм\\s*[²2]|mm\\s*[²2])?`, "iu"), "").replace(/[·,;/\\s]+$/u, "").trim() : mark.trim();
  return [cleanMark || mark.trim(), size, color.trim()].filter(Boolean).join(" · ");
}

export function formatStoredWireSection(section: string, reference: string, unit?: "awg" | "mm2"): string {
  const value = section.trim();
  if (!value || /awg|(?:мм|mm)\s*[²2]/iu.test(value)) return value;
  if (unit === "awg") return `${value}AWG`;
  if (unit === "mm2") return `${value} мм²`;
  const match = reference.match(new RegExp(`(?:^|[^0-9])${escapeRegExp(value).replace(/,/g, "[,.]")}\\s*(awg|(?:мм|mm)\\s*[²2])`, "iu"));
  return match ? (match[1]!.toLocaleLowerCase().includes("awg") ? `${value}AWG` : `${value} мм²`) : value;
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export interface WireColorIndicator { readonly known: boolean; readonly primary: string; readonly secondary: string | null; readonly background: string; }

/** Resolves one or two stored color designations using the existing palette. */
export function formatWireColorIndicator(primary: string, secondary = ""): WireColorIndicator {
  const neutral = "#D9E2E7";
  const knownColor = (value: string) => /^#[0-9a-f]{6}$/iu.test(value)
    || builtInWireColors.some(color => color.name.toLocaleLowerCase("ru-RU").replace(/ё/g, "е") === value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е"));
  const firstValue = primary.trim();
  const secondValue = secondary.trim();
  if (!knownColor(firstValue) || (secondValue && !knownColor(secondValue)))
    return { known: false, primary: neutral, secondary: null, background: neutral };
  const first = resolveWireColorHex(firstValue);
  const second = secondValue ? resolveWireColorHex(secondValue) : null;
  return { known: true, primary: first, secondary: second, background: second ? `linear-gradient(225deg, ${first} 0 49%, #8da0aa 49% 51%, ${second} 51% 100%)` : first };
}

export function formatWireTerminalPair(from: string, to: string): string {
  const left = from.trim(), right = to.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} - ${right}`;
}

