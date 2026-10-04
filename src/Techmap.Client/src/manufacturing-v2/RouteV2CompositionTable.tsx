import type { HarnessDesignDocument } from "../editor/model";
import { terminalArticleLabel } from "../editor/terminal-article-label";
import { routeSourceDesignation, type RouteSourceItem, type RouteSourceRef } from "../manufacturing/route-source";
import type { RouteV2Node } from "./route-v2-model";

const sourceKey = (ref: RouteSourceRef) => ref.kind + ":" + ref.id;

export function RouteV2CompositionTable({ node, document, sources }: { node: RouteV2Node; document: HarnessDesignDocument; sources: readonly RouteSourceItem[] }) {
  const requirements = document.manufacturingRoute?.rows.flatMap(row => row.terminalRequirements ?? []) ?? [];
  const detail = (item: RouteSourceItem, end: "from" | "to") => {
    const saved = requirements.find(value => value.wireId === item.ref.id && value.end === end);
    return { article: terminalArticleLabel(saved?.terminalArticle || (end === "from" ? item.terminalFrom : item.terminalTo)) || "—", profile: item.stripProfiles?.[end]?.displayName ?? "—", length: saved?.stripLengthMm == null ? "—" : saved.stripLengthMm + " мм" };
  };
  return <div className="route-v2-table-wrap"><table className="route-v2-source-table" aria-label="Полуфабрикаты карточки"><thead><tr><th scope="col">Объект</th><th scope="col">Материал</th><th scope="col">Длина</th><th scope="col">Концы</th><th scope="col">Разделка</th><th scope="col">Кол-во</th><th scope="col">Запас</th><th scope="col">Время</th></tr></thead><tbody>
    {node.refs.map((ref, index) => {
      const item = sources.find(value => sourceKey(value.ref) === sourceKey(ref));
      if (!item) return <tr key={sourceKey(ref)}><td><strong>{ref.id}</strong></td><td colSpan={7}>Объект отсутствует в исходном чертеже. Уберите его из состава или восстановите источник.</td></tr>;
      const from = detail(item, "from"), to = detail(item, "to");
      return <tr key={sourceKey(ref)}><td><strong>ПФ-{String(index + 1).padStart(2, "0")}</strong><span>{item.title}</span></td><td>{routeSourceDesignation(item)}</td><td>{item.lengthMm == null ? "—" : item.lengthMm + " мм"}</td><td>{ref.kind === "wire" ? <><span>Н: {from.article}</span><span>К: {to.article}</span></> : "—"}</td><td>{ref.kind === "wire" ? <><span>Н: {from.profile} · {from.length}</span><span>К: {to.profile} · {to.length}</span></> : "—"}</td><td>{node.quantity} шт.</td><td>—</td><td>—</td></tr>;
    })}
    {!node.refs.length && <tr><td colSpan={8} className="route-v2-empty">Состав пуст. Выберите полуфабрикаты ниже.</td></tr>}
  </tbody></table></div>;
}
