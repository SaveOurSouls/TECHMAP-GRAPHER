import { WireBlankPreview } from "../WireBlankCatalogEditor";
import { type WireBlank, type WireBlankEnd } from "../WireBlankCatalog";
import { resolveWireColorHex } from "../editor/wire-reference-catalog";
import type { HarnessDesignDocument } from "../editor/model";
import { buildRouteSourceItems, type RouteSourceItem } from "../manufacturing/route-source";
import { automaticWireEnd, compactWireEnd, displayWireSection, wireMarkWithoutSection, wireSemiFinishedProperties } from "../manufacturing/cut-list-properties";
import type { RouteV3WireArtworkOverride } from "./route-v3-model";

/** E4 owns source material and end preparation. A V3 override is intentionally
 * sparse: removing it restores the current E4 projection without altering E4. */
export interface RouteV3WireArtwork {
  readonly wireId: string; readonly start: WireBlankEnd; readonly end: WireBlankEnd; readonly color: string;
  readonly name: string; readonly mark: string; readonly section: string; readonly colorLabel: string; readonly terminalFrom: string; readonly terminalTo: string; readonly automatic: boolean;
}
export function routeV3WireArtwork(document: HarnessDesignDocument, wireId: string, override?: RouteV3WireArtworkOverride): RouteV3WireArtwork | null {
  const wire = document.wires.find(candidate => candidate.id === wireId);
  const item = buildRouteSourceItems(document).find(candidate => candidate.ref.kind === "wire" && candidate.ref.id === wireId);
  if (!wire || !item) return null;
  const contact = (endpoint: typeof wire.from) => document.connectors.find(connector => connector.id === endpoint.connectorId)?.contacts.find(candidate => candidate.id === endpoint.contactId);
  const from = contact(wire.from), to = contact(wire.to);
  const properties = wireSemiFinishedProperties(document, wireId, { from: override?.start ?? automaticWireEnd(from), to: override?.end ?? automaticWireEnd(to) });
  return {
    wireId, start: override?.start ?? automaticWireEnd(from), end: override?.end ?? automaticWireEnd(to), color: override?.color ?? resolveWireColorHex(item.color || wire.color || ""),
    name: properties?.name ?? item.title, mark: properties?.mark ?? wireMarkWithoutSection(item.material, item.section), section: properties?.section ?? displayWireSection(item.section, item.material),
    colorLabel: item.color || wire.color || "Цвет не назначен", terminalFrom: properties?.terminalFrom ?? compactWireEnd(from, override?.start ?? automaticWireEnd(from), "from"), terminalTo: properties?.terminalTo ?? compactWireEnd(to, override?.end ?? automaticWireEnd(to), "to"), automatic: !override,
  };
}
export function RouteV3WireArtworkPreview({ document, item, override }: { readonly document: HarnessDesignDocument; readonly item: RouteSourceItem; readonly override?: RouteV3WireArtworkOverride }) {
  const artwork = routeV3WireArtwork(document, item.ref.id, override);
  if (!artwork) return null;
  const row: WireBlank = { id: artwork.wireId, index: artwork.wireId, title: artwork.name, color: artwork.color, start: artwork.start, end: artwork.end, templateId: "01-cut", photoDataUrl: null, originalPayload: {} };
  return <span className="route-v3-wire-artwork" data-wire-artwork={artwork.automatic ? "e4" : "manual"}>
    <WireBlankPreview row={row} />
    <small className="route-v3-wire-artwork__name">ПФ: {artwork.name}</small>
    <small className="route-v3-wire-artwork__details">{artwork.mark} · {artwork.section} · <i style={{ backgroundColor: artwork.color }} aria-hidden="true" />{artwork.colorLabel}</small>
    <small className="route-v3-wire-artwork__ends">{artwork.terminalFrom} — {artwork.terminalTo}</small>
  </span>;
}
