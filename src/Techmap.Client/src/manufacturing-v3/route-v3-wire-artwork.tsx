import { WireBlankPreview } from "../WireBlankCatalogEditor";
import { wireBlankEndLabels, type WireBlank, type WireBlankEnd } from "../WireBlankCatalog";
import { resolveWireColorHex } from "../editor/wire-reference-catalog";
import type { HarnessDesignDocument } from "../editor/model";
import { buildRouteSourceItems, type RouteSourceItem } from "../manufacturing/route-source";
import type { RouteV3WireArtworkOverride } from "./route-v3-model";

const truthy = (value: unknown) => typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : typeof value === "string" && !/^(?:|0|нет|no|false)$/i.test(value.trim());
const normalized = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/[\s_-]/g, "");

/** E4 owns source material and end preparation. A V3 override is intentionally
 * sparse: removing it restores the current E4 projection without altering E4. */
export interface RouteV3WireArtwork {
  readonly wireId: string; readonly start: WireBlankEnd; readonly end: WireBlankEnd; readonly color: string;
  readonly mark: string; readonly section: string; readonly colorLabel: string; readonly automatic: boolean;
}
function hasContactFlag(contact: { readonly customValues: Readonly<Record<string, string>>; readonly terminalDetails?: { readonly description: string; readonly article?: string } } | undefined, words: readonly string[]): boolean {
  if (!contact) return false;
  if (Object.entries(contact.customValues).some(([key, value]) => words.some(word => normalized(key).includes(word)) && truthy(value))) return true;
  const details = `${contact.terminalDetails?.description ?? ""} ${contact.terminalDetails?.article ?? ""}`;
  return words.some(word => normalized(details).includes(word));
}
function automaticEnd(contact: { readonly terminalArticle: string; readonly customValues: Readonly<Record<string, string>>; readonly terminalDetails?: { readonly description: string; readonly article?: string } } | undefined): WireBlankEnd {
  if (!contact) return "cut";
  const sealed = hasContactFlag(contact, ["уплотн", "seal"]), terminal = contact.terminalArticle.trim().length > 0;
  if (terminal) return sealed ? "sealed" : "terminal";
  return hasContactFlag(contact, ["пайк", "луж", "solder", "tin"]) ? "tin" : "cut";
}
export function routeV3WireArtwork(document: HarnessDesignDocument, wireId: string, override?: RouteV3WireArtworkOverride): RouteV3WireArtwork | null {
  const wire = document.wires.find(candidate => candidate.id === wireId);
  const item = buildRouteSourceItems(document).find(candidate => candidate.ref.kind === "wire" && candidate.ref.id === wireId);
  if (!wire || !item) return null;
  const contact = (endpoint: typeof wire.from) => document.connectors.find(connector => connector.id === endpoint.connectorId)?.contacts.find(candidate => candidate.id === endpoint.contactId);
  const from = contact(wire.from), to = contact(wire.to);
  return {
    wireId, start: override?.start ?? automaticEnd(from), end: override?.end ?? automaticEnd(to), color: override?.color ?? resolveWireColorHex(item.color || wire.color || ""),
    mark: item.material || from?.wire.trim() || to?.wire.trim() || "Марка не назначена", section: item.section || from?.wireSection?.trim() || to?.wireSection?.trim() || "Сечение не назначено",
    colorLabel: item.color || wire.color || "Цвет не назначен", automatic: !override,
  };
}
export function RouteV3WireArtworkPreview({ document, item, override }: { readonly document: HarnessDesignDocument; readonly item: RouteSourceItem; readonly override?: RouteV3WireArtworkOverride }) {
  const artwork = routeV3WireArtwork(document, item.ref.id, override);
  if (!artwork) return null;
  const row: WireBlank = { id: artwork.wireId, index: artwork.wireId, title: `${artwork.mark} · ${artwork.section}`, color: artwork.color, start: artwork.start, end: artwork.end, templateId: "01-cut", photoDataUrl: null, originalPayload: {} };
  return <span className="route-v3-wire-artwork" data-wire-artwork={artwork.automatic ? "e4" : "manual"}>
    <WireBlankPreview row={row} />
    <small className="route-v3-wire-artwork__details">{artwork.mark} · {artwork.section} · <i style={{ backgroundColor: artwork.color }} aria-hidden="true" />{artwork.colorLabel}</small>
    <small className="route-v3-wire-artwork__ends">{wireBlankEndLabels[artwork.start]} — {wireBlankEndLabels[artwork.end]}</small>
  </span>;
}
