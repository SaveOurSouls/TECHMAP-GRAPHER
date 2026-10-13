/** Pure display formatters for production wire labels. They never mutate the
 * saved harness or infer electrical data from a technical identifier. */

const technicalId = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

export function formatWireName(mark: string): string {
  const clean = mark.replace(technicalId, "").replace(/[·;,|]+/g, " ").replace(/\s+/g, " ").trim();
  return clean && clean !== "Марка не назначена" ? `Провод ${clean}` : "Провод";
}

export function formatWireMaterial(mark: string, section: string, color: string): string {
  return [mark.trim(), section.trim(), color.trim()].filter(Boolean).join(" · ");
}

export function formatWireTerminalPair(from: string, to: string): string {
  const left = from.trim(), right = to.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} - ${right}`;
}

