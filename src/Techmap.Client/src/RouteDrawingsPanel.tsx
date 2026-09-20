import { useEffect, useMemo, useState } from "react";
import type { RuntimeConfig } from "./runtime-config";
import type { LocalSession } from "./local-session";
import { createComponentPlacementApi, type ProjectComponentPlacementGraph } from "./editor/component-placement-api";
import { isTemplateContentV5 } from "./component-library/template-content";
import { articleDrawingView, findArticleDrawing } from "./component-library/drawing-bindings";
import { projectTemplateContentV5ToV3 } from "./component-library/template-model-v5";
import { projectTemplateContentV3CoreToV2 } from "./component-library/template-commands-v3";
import { TemplateCanvasV2 } from "./component-library/TemplateCanvasV2";
import { withDrawingArticleCounts } from "./component-library/drawing-array-commands";
import { materializeArticleVariantV3 } from "./component-library/template-article-materialization-v3";
import "./component-library/component-library.css";
import { InfoHint } from "./InfoHint";

export function RouteDrawingsPanel({config,session,projectId,harnessId}:{config:RuntimeConfig;session:LocalSession;projectId:string;harnessId:string}) {
  const api=useMemo(()=>createComponentPlacementApi(config,session),[config,session]);
  const [graph,setGraph]=useState<ProjectComponentPlacementGraph|null>(null),[error,setError]=useState("");
  useEffect(()=>{let cancelled=false;setGraph(null);setError("");void api.list(projectId,harnessId).then(value=>{if(!cancelled)setGraph(value);}).catch(e=>{if(!cancelled)setError(String(e.message));});return()=>{cancelled=true;};},[api,projectId,harnessId]);
  const drawings=graph?.placements.flatMap(placement=>{
    const snapshot=graph.snapshots.find(s=>s.snapshotId===placement.snapshotId);
    if(!snapshot||!isTemplateContentV5(snapshot.content))return [];
    const content=snapshot.content,article=content.articleVariants.find(a=>a.articleKey===placement.articleKey&&a.sourceId.toLowerCase()===placement.sourceId.toLowerCase()&&a.entityType.toLowerCase()===placement.entityType.toLowerCase());
    const binding=findArticleDrawing(content.articleDrawings,article?.id??null,"route");
    if(!binding?.viewId||!binding.nodeIds.length&&!binding.contactPointIds.length)return [];
    const graphic=withDrawingArticleCounts(projectTemplateContentV5ToV3(content));
    const core=projectTemplateContentV3CoreToV2(graphic);
    const parameters=materializeArticleVariantV3({...graphic,articleVariants:graphic.articleVariants.map(a=>({...a,contactGroups:null}))},article!.id).overrides;
    return [{placement,snapshot,article,parameters,viewId:binding.viewId,core:{...core,views:core.views.map(v=>articleDrawingView(v,content.articleDrawings,article!.id,"route"))}}];
  })??[];
  return <section className="route-drawings"><header><strong>Рисунки маршрута</strong><InfoHint>Показаны рисунки раздела «Маршрут» из закреплённых версий компонентов жгута.</InfoHint></header>{error&&<p role="alert">{error}</p>}{graph&&!drawings.length&&<p>Для компонентов жгута рисунки маршрута не назначены.</p>}{drawings.map(item=><figure key={item.placement.placementId}><figcaption>{item.snapshot.code} · {item.article?.articleKey}</figcaption><TemplateCanvasV2 content={item.core} parameterDefaults={item.parameters} viewId={item.viewId} selectedId={null} onSelect={()=>{}} resolveAssetUrl={id=>api.assetContentUrl(projectId,harnessId,item.snapshot.snapshotId,id)}/></figure>)}</section>;
}
