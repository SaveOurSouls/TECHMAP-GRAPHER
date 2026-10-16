import type { ReactElement } from "react";
import type { HarnessDesignDocument } from "../editor/model";
import { WireBlankPreview } from "../WireBlankCatalogEditor";
import type { WireBlank, WireBlankEnd } from "../WireBlankCatalog";
import { RouteCoveringArtwork } from "./route-covering-artwork";
import type { RouteSourceItem, RouteSourceRef } from "./route-source";

type Props = { readonly document: HarnessDesignDocument; readonly ref: RouteSourceRef; readonly item?: RouteSourceItem; readonly className?: string; readonly textureUrls?: Readonly<Record<string, string>> };

const validEnds = new Set<WireBlankEnd>(["cut", "copper", "tin", "terminal", "sealed", "sealed-pin"]);
const end = (value: unknown): WireBlankEnd => validEnds.has(value as WireBlankEnd) ? value as WireBlankEnd : "cut";

function wireBlank(document: HarnessDesignDocument, ref: RouteSourceRef, item?: RouteSourceItem): WireBlank {
  const selected = document.manufacturingRoute?.rows.flatMap(row => row.wireBlankSelections ?? []).find(selection => selection.wireId === ref.id)?.binding;
  const visual = selected?.visual;
  return { id: selected?.recordId ?? `route-source-${ref.id}`, index: selected?.sourceKey ?? ref.id, title: selected?.displayName ?? item?.title ?? "Провод", color: visual?.color ?? item?.color ?? "#26609e", start: end(visual?.start), end: end(visual?.end), templateId: visual?.templateId ?? "01-cut", photoDataUrl: visual?.photoDataUrl ?? null, originalPayload: {} };
}

/** Shared production artwork for source references, including pinned legacy wire visuals. */
export function RouteSourceArtwork({ document, ref, item, className, textureUrls }: Props): ReactElement {
  if (ref.kind === "wire") return <span className={className}><WireBlankPreview row={wireBlank(document, ref, item)} /></span>;
  if (ref.kind === "covering") {
    const covering = document.physicalTopology?.coverings?.find(candidate => candidate.id === ref.id);
    if (covering) return <span className={className}><RouteCoveringArtwork covering={covering} textureUrls={textureUrls} width={560} height={120} /></span>;
  }
  return <span className={className} role="img" aria-label={`Для «${item?.title ?? ref.id}» рисунок отсутствует`} style={{ display: "grid", placeItems: "center", minHeight: 38, color: "#8798a1", fontSize: 9 }}>Рисунок отсутствует</span>;
}
