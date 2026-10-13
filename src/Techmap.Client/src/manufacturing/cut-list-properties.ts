import { wireBlankEndLabels, type WireBlankEnd } from "../WireBlankCatalog";
import type { ConnectorContact, HarnessDesignDocument, WireEndpoint } from "../editor/model";
import { terminalArticleLabel } from "../editor/terminal-article-label";
import { buildRouteSourceItems } from "./route-source";

export interface WireSemiFinishedProperties {
  readonly name: string;
  readonly mark: string;
  readonly section: string;
  readonly color: string;
  readonly terminalFrom: string;
  readonly terminalTo: string;
}

const compactEndLabels: Readonly<Record<WireBlankEnd, string>> = {
  cut: "Без разделки", copper: "медь", tin: "лужёная медь",
  terminal: "Наконечник", sealed: "Наконечник с уплотнителем",
  "sealed-pin": "Штыревой наконечник с уплотнителем",
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Keeps the unit stored by the selected wire record. It deliberately never converts AWG to mm² or back. */
export function displayWireSection(section: string, reference = ""): string {
  const value = section.trim();
  if (!value) return "Сечение не назначено";
  if (/awg/iu.test(value) || /(?:мм|mm)\s*[²2]/iu.test(value)) return value;
  const escaped = escape(value.replace(/,/g, "__comma__")).replace(/__comma__/g, "[,.]");
  if (new RegExp(`(?:^|[^0-9])${escaped}\\s*awg`, "iu").test(reference)) return `${value}AWG`;
  if (new RegExp(`(?:^|[^0-9])${escaped}\\s*(?:мм|mm)\\s*[²2]`, "iu").test(reference)) return `${value} мм²`;
  return value;
}

/** Removes only the same stored size from a material display name, avoiding the old `28 · 28` repetition. */
export function wireMarkWithoutSection(mark: string, section: string): string {
  const raw = mark.trim();
  const size = section.trim();
  if (!raw || !size) return raw || "Марка не назначена";
  const unitless = size.replace(/\s*(?:awg|мм\s*[²2]|mm\s*[²2])\s*$/iu, "");
  const pattern = escape(unitless.replace(/,/g, "__comma__")).replace(/__comma__/g, "[,.]");
  const stripped = raw
    .replace(new RegExp(`(?:\\s*[·,;/]\\s*|\\s+)${pattern}\\s*(?:awg|мм\\s*[²2]|mm\\s*[²2])?`, "giu"), "")
    .replace(/[·,;/\s]+$/u, "").trim();
  return stripped || raw;
}

function contactAt(document: HarnessDesignDocument, endpoint: WireEndpoint): ConnectorContact | undefined {
  if (!endpoint.connectorId || !endpoint.contactId) return undefined;
  return document.connectors.find(connector => connector.id === endpoint.connectorId)?.contacts.find(contact => contact.id === endpoint.contactId);
}

function sealOf(contact: ConnectorContact): string {
  const direct = contact.customValues.seal?.trim();
  if (direct) return direct;
  return Object.entries(contact.customValues).find(([key, value]) => /уплотн|seal/iu.test(key) && value.trim())?.[1].trim() ?? "";
}

const truthy = (value: unknown) => typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : typeof value === "string" && !/^(?:|0|нет|no|false)$/i.test(value.trim());
const normalized = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/[\s_-]/g, "");
function hasContactFlag(contact: ConnectorContact | undefined, words: readonly string[]): boolean {
  if (!contact) return false;
  if (Object.entries(contact.customValues).some(([key, value]) => words.some(word => normalized(key).includes(word)) && truthy(value))) return true;
  const details = `${contact.terminalDetails?.description ?? ""} ${contact.terminalDetails?.article ?? ""}`;
  return words.some(word => normalized(details).includes(word));
}

export function automaticWireEnd(contact: ConnectorContact | undefined): WireBlankEnd {
  if (!contact) return "cut";
  const sealed = hasContactFlag(contact, ["уплотн", "seal"]), terminal = contact.terminalArticle.trim().length > 0;
  if (terminal) return sealed ? "sealed" : "terminal";
  return hasContactFlag(contact, ["пайк", "луж", "solder", "tin"]) ? "tin" : "cut";
}

/** A terminal stays a terminal in the production text even if its illustration was manually changed. */
export function compactWireEnd(contact: ConnectorContact | undefined, illustratedEnd: WireBlankEnd, side: "from" | "to" = "from"): string {
  const article = contact?.terminalDetails?.article?.trim() || (contact?.terminalArticle ? terminalArticleLabel(contact.terminalArticle).trim() : "");
  if (!article) return compactEndLabels[illustratedEnd];
  const seal = sealOf(contact!);
  return side === "from" ? `${article} / ${seal}` : `${seal} / ${article}`;
}

export function wireSemiFinishedProperties(document: HarnessDesignDocument, wireId: string, ends?: Readonly<{ from: WireBlankEnd; to: WireBlankEnd }>): WireSemiFinishedProperties | null {
  const wire = document.wires.find(candidate => candidate.id === wireId);
  const source = buildRouteSourceItems(document).find(item => item.ref.kind === "wire" && item.ref.id === wireId);
  if (!wire || !source) return null;
  const from = contactAt(document, wire.from), to = contactAt(document, wire.to);
  const material = source.material || from?.wire || to?.wire || "";
  const rawSection = source.section || from?.wireSection || to?.wireSection || "";
  const section = displayWireSection(rawSection, `${material} ${wire.materialBinding?.sourceKey ?? ""}`);
  const name = source.title || wire.circuit.trim() || wire.id;
  return {
    name,
    mark: wireMarkWithoutSection(material, section), section,
    color: source.color || wire.color || "Цвет не назначен",
    terminalFrom: compactWireEnd(from, ends?.from ?? automaticWireEnd(from), "from"),
    terminalTo: compactWireEnd(to, ends?.to ?? automaticWireEnd(to), "to"),
  };
}

/** For ends outside a wire document, retain existing catalog wording except the requested cut label. */
export function compactWireBlankEnd(end: WireBlankEnd): string {
  return end === "cut" ? compactEndLabels.cut : compactEndLabels[end] || wireBlankEndLabels[end];
}
