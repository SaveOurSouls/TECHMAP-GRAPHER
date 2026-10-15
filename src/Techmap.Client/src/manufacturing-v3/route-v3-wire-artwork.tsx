import { buildRouteV3SourceItems } from './route-v3-wire-terminals';
import { WireBlankPreview } from "../WireBlankCatalogEditor";
import { type WireBlank, type WireBlankEnd } from "../WireBlankCatalog";
import { resolveWireColorHex } from "../editor/wire-reference-catalog";
import type { HarnessDesignDocument } from "../editor/model";
import { routeSourceWireColor, type RouteSourceItem } from "../manufacturing/route-source";
import { automaticWireEnd, compactWireEnd, displayWireSection, wireMarkWithoutSection, wireSemiFinishedProperties } from "../manufacturing/cut-list-properties";
import { formatWireMaterial, formatWireName } from "../manufacturing/wire-display-formatters";
import type { RouteV3WireArtworkOverride } from "./route-v3-model";
import { effectiveEndPreparation } from '../editor/termination-model';
import { routeV3WireEndArtifacts } from './route-v3-wire-terminals';
import { getTerminationSymbol } from '../termination-library/symbol';
import { renderWireSvg } from '../wire-blank-artwork.mjs';

/** E4 owns source material and end preparation. A V3 override is intentionally
 * sparse: removing it restores the current E4 projection without altering E4. */
export interface RouteV3WireArtwork {
  readonly wireId: string; readonly start: WireBlankEnd; readonly end: WireBlankEnd; readonly color: string;
  readonly name: string; readonly mark: string; readonly section: string; readonly colorLabel: string; readonly terminalFrom: string; readonly terminalTo: string; readonly automatic: boolean;
}
export function routeV3WireArtwork(document: HarnessDesignDocument, wireId: string, override?: RouteV3WireArtworkOverride): RouteV3WireArtwork | null {
  const wire = document.wires.find(candidate => candidate.id === wireId);
  const item = buildRouteV3SourceItems(document).find(candidate => candidate.ref.kind === "wire" && candidate.ref.id === wireId);
  if (!wire || !item) return null;
  const contact = (endpoint: typeof wire.from) => document.connectors.find(connector => connector.id === endpoint.connectorId)?.contacts.find(candidate => candidate.id === endpoint.contactId);
  const from = contact(wire.from), to = contact(wire.to);
  const canonicalEnd=(end:'from'|'to'):WireBlankEnd=>{
    const p=effectiveEndPreparation(document,{wireId,end});
    if (routeV3WireEndArtifacts(document, wireId, end).some(a => a.kind === 'terminal')) return p?.mode === 'pin-sealed' ? 'sealed-pin' : p?.mode === 'socket-sealed' ? 'sealed' : 'terminal';
    if(document.terminations?.groups.some(g=>g.memberEnds.some(e=>e.wireId===wireId&&e.end===end)))return p?.stripLengthMm?'copper':'cut';
    if(!p)return automaticWireEnd(end==='from'?from:to);
    return p.mode==='lug'||p.mode==='pin'||p.mode==='socket'?'terminal':p.mode==='pin-sealed'?'sealed-pin':p.mode==='socket-sealed'?'sealed':p.mode;
  };
  const start=override?.start??canonicalEnd('from'),end=override?.end??canonicalEnd('to');
  const properties = wireSemiFinishedProperties(document, wireId, { from:start, to:end });
  return {
    wireId, start, end, color: override?.color ?? resolveWireColorHex(item.color || wire.color || ""),
    name: properties?.name ?? formatWireName(wireMarkWithoutSection(item.material, item.section)), mark: properties?.mark ?? wireMarkWithoutSection(item.material, item.section), section: properties?.section ?? displayWireSection(item.section, item.material),
    colorLabel: item.color || wire.color || "Цвет не назначен", terminalFrom: routeV3WireEndArtifacts(document,wireId,'from').length ? item.terminalFrom : properties?.terminalFrom ?? compactWireEnd(from, override?.start ?? automaticWireEnd(from), "from"), terminalTo: routeV3WireEndArtifacts(document,wireId,'to').length ? item.terminalTo : properties?.terminalTo ?? compactWireEnd(to, override?.end ?? automaticWireEnd(to), "to"), automatic: !override,
  };
}
export function routeV3WireMaterial(document: HarnessDesignDocument, wireId: string): string {
  const properties = wireSemiFinishedProperties(document, wireId);
  return properties ? formatWireMaterial(properties.mark, properties.section, properties.color) : "Материал не назначен";
}
export function RouteV3WireArtworkPreview({ document, item, override }: { readonly document: HarnessDesignDocument; readonly item: RouteSourceItem; readonly override?: RouteV3WireArtworkOverride }) {
  const artwork = routeV3WireArtwork(document, item.ref.id, override);
  if (!artwork) return null;
  const color = routeSourceWireColor(item);
  const row: WireBlank = { id: artwork.wireId, index: artwork.wireId, title: artwork.name, color: artwork.color, start: artwork.start, end: artwork.end, templateId: "01-cut", photoDataUrl: null, originalPayload: {} };
  const terminal = (end: 'from' | 'to', style: WireBlankEnd) => {
    // Sealed pin/socket preparations retain the existing calibrated rubber and
    // contact drawing. A plain terminal is replaced by its assigned library form.
    if (style !== 'terminal') return null;
    const artifact = routeV3WireEndArtifacts(document, item.ref.id, end).find(a => a.kind === 'terminal');
    return artifact ? getTerminationSymbol({ symbolId: artifact.symbolId, color: artifact.color }, 'drawing') : null;
  };
  const left = terminal('from', artwork.start), right = terminal('to', artwork.end);
  const title = `${artwork.name}: Н: ${artwork.terminalFrom || "Без разделки"}; К: ${artwork.terminalTo || "Без разделки"}`;
  const endImage = (symbol: NonNullable<typeof left>) => {
    const anchor = symbol.anchors.find(a => a.role === 'wire-entry') ?? symbol.pivot;
    return <image href={symbol.href} x={980 - anchor.x} y={120 - anchor.y} width={220} height={100} />;
  };
  return <span className="route-v3-wire-artwork" data-wire-artwork={artwork.automatic ? "e4" : "manual"}>
    {left || right ? <svg className="wire-blank-preview" viewBox="0 0 1200 240" role="img" aria-label={title}>
      <image href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderWireSvg({left:left?'cut':artwork.start,right:right?'cut':artwork.end,color:artwork.color}))}`} width={1200} height={240} />
      {left && <g data-wire-end="from" transform="translate(1200 0) scale(-1 1)">{endImage(left)}</g>}
      {right && <g data-wire-end="to">{endImage(right)}</g>}
    </svg> : <WireBlankPreview row={row} alt={title} />}
    <small className="route-v3-wire-artwork__name">{artwork.name}</small>
    <small className="route-v3-wire-artwork__details">{artwork.mark} · {artwork.section} · <i className="route-v3-color-swatch" style={{ background: color.background }} aria-hidden="true" />{artwork.colorLabel}</small>
    <small className="route-v3-wire-artwork__ends"><span>Н: {artwork.terminalFrom || "Без разделки"}</span><span>К: {artwork.terminalTo || "Без разделки"}</span></small>
  </span>;
}
