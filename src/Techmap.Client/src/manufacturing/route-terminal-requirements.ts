import type { HarnessDesignDocument, WireEndpoint } from "../editor/model";
import type { ReferenceCatalogApi } from "../reference-catalog-api";
import type { ManufacturingRoute } from "./route-model";

export interface RouteTerminalRequirement {
  readonly wireId: string;
  readonly end: "from" | "to";
  readonly terminalArticle: string;
  readonly stripLengthMm: number | null;
  readonly binding: null | {
    readonly sourceId: string;
    readonly entityType: "terminal";
    readonly snapshotId: string;
    readonly snapshotSha256: string;
    readonly recordId: string;
    readonly sourceKey: string;
    readonly displayName: string;
  };
}

type ResolvedNorm = Pick<RouteTerminalRequirement, "binding" | "stripLengthMm">;
const unknownNorm: ResolvedNorm = { binding: null, stripLengthMm: null };
const hash = (value: string) => /^[a-f\d]{64}$/i.test(value);

function stripLength(value: unknown): number | null {
  const raw = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  if (!/^\d+(?:[.,]\d{1,3})?$/.test(raw)) return null;
  const number = Number(raw.replace(",", "."));
  return Number.isFinite(number) && number <= 1e9 ? number : null;
}

/** Explicit generation/rebase pins current terminal norms. Rendering never refreshes them. */
export async function resolveRouteTerminalRequirements(
  document: HarnessDesignDocument,
  route: ManufacturingRoute,
  referenceApi: Pick<ReferenceCatalogApi, "searchCatalog">,
): Promise<ManufacturingRoute> {
  const wires = new Map(document.wires.map(wire => [wire.id, wire]));
  const connectors = new Map(document.connectors.map(connector => [connector.id, connector]));
  const cache = new Map<string, Promise<ResolvedNorm>>();

  function resolveNorm(sourceId: string, article: string): Promise<ResolvedNorm> {
    const key = JSON.stringify([sourceId, article]);
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = (async (): Promise<ResolvedNorm> => {
      try {
        const page = await referenceApi.searchCatalog(sourceId, {
          text: null, exactSourceKey: article, entityTypes: ["terminal"], filters: [],
          filterLogic: "all", sort: "source-key-asc", pageSize: 2, cursor: null,
        });
        const record = page.items[0];
        if (page.nextCursor !== null || page.items.length !== 1 || !record || record.entityType !== "terminal" || record.sourceKey !== article ||
          !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(page.snapshotId) || page.snapshotId === "00000000-0000-0000-0000-000000000000" ||
          !hash(page.snapshotSha256) || !hash(record.recordId)) return unknownNorm;
        const name = record.payload.displayName ?? record.payload.name;
        return {
          binding: { sourceId, entityType: "terminal", snapshotId: page.snapshotId, snapshotSha256: page.snapshotSha256,
            recordId: record.recordId, sourceKey: record.sourceKey,
            displayName: typeof name === "string" && name.trim() && name.length <= 512 ? name : article },
          stripLengthMm: stripLength(record.payload.stripLengthMm),
        };
      } catch {
        // Unavailable catalog data must remain visibly unknown, never become a guessed norm.
        return unknownNorm;
      }
    })();
    cache.set(key, pending);
    return pending;
  }

  async function resolveEnd(wireId: string, end: "from" | "to", endpoint: WireEndpoint): Promise<RouteTerminalRequirement> {
    const connector = connectors.get(endpoint.connectorId);
    const contact = connector?.contacts.find(candidate => candidate.id === endpoint.contactId);
    const article = contact?.terminalArticle ?? "";
    const result = { wireId, end, terminalArticle: article, ...unknownNorm };
    if (!article || !contact?.logicalContactId || connector?.libraryBinding?.mode !== "template") return result;
    const keys = connector.libraryBinding.snapshot.contacts.find(candidate => candidate.logicalContactId === contact.logicalContactId)?.allowedTerminalArticleKeys ?? [];
    const sources = [...new Set(keys.filter(key => key.entityType === "terminal" && key.articleKey === article && key.sourceId.trim()).map(key => key.sourceId))];
    if (sources.length !== 1) return result;
    return { ...result, ...await resolveNorm(sources[0]!, article) };
  }

  const rows = [...route.rows];
  let nextRow = 0;
  // Bound catalog traffic even for routes with thousands of wire ends.
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (nextRow < rows.length) {
      const index = nextRow++, row = rows[index]!;
      const requirements: RouteTerminalRequirement[] = [];
      for (const ref of row.sourceObjects) {
        if (ref.kind !== "wire") continue;
        const wire = wires.get(ref.id);
        if (!wire) continue;
        requirements.push(await resolveEnd(wire.id, "from", wire.from), await resolveEnd(wire.id, "to", wire.to));
      }
      if (requirements.length) rows[index] = { ...row, terminalRequirements: requirements };
    }
  }));
  return { ...route, rows };
}
