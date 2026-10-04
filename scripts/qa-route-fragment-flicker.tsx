import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/Techmap.Client/src/styles.css";
import "../src/Techmap.Client/src/editor/harness-editor.css";
import { createConnector, createWire } from "../src/Techmap.Client/src/editor/commands";
import { createEmptyHarnessDesign, createOrthogonalE4Route, wireEndpointE4Anchor, type HarnessDesignDocument } from "../src/Techmap.Client/src/editor/model";
import { generateRoute } from "../src/Techmap.Client/src/manufacturing/route-commands";
import type { RouteRow } from "../src/Techmap.Client/src/manufacturing/route-model";
import { RouteAssemblyDrawing } from "../src/Techmap.Client/src/manufacturing/RouteAssemblyDrawing";
import { newTemplateContentV2, addBasicNodeV2, addContactPointV2 } from "../src/Techmap.Client/src/component-library/template-commands-v2";
import { upgradeTemplateContentV2ToV3 } from "../src/Techmap.Client/src/component-library/template-upgrade-v3";
import { createConnectorInstanceFromComponentTemplateV3 } from "../src/Techmap.Client/src/editor/component-template-placement";
import { parseComponentPlacementGraph } from "../src/Techmap.Client/src/editor/component-placement-api";
import { buildComponentTemplateViewInstances, buildProjectComponentSnapshotLookup } from "../src/Techmap.Client/src/editor/HarnessDesignEditor";

const config = { configVersion: 1 as const, basePath: "/", apiBasePath: "/api/", appVersion: "qa", apiVersion: "1", schemaVersion: "1" };
const session = { csrfNonce: "qa", instanceId: "qa" };
const templateId = "44444444-4444-4444-8444-444444444444", snapshotId = "22222222-2222-4222-8222-222222222222";
const connectorId = "33333333-3333-4333-8333-333333333333";
const article = { sourceId: "technology-database", entityType: "connector", articleKey: "B2B-XH-A" };
let contentV2 = newTemplateContentV2();
const drawing = contentV2.views.find(view => view.kind === "drawing")!;
[contentV2] = addBasicNodeV2(contentV2, drawing.id, drawing.layers[0]!.id, "ellipse");
[contentV2] = addContactPointV2(contentV2, drawing.id, { number: "1", x: { kind: "constant", value: 240 }, y: { kind: "constant", value: 135 } });
const content = upgradeTemplateContentV2ToV3(contentV2).content;
const variant = { id: crypto.randomUUID(), ...article, parameterValues: [], contactGroups: null };
content.articleVariants.push(variant);
const template = { templateId, version: 7, versionSha256: "a".repeat(64), code: "XH", name: "JST XH", articleBindings: [article], assets: [], content };
const connector = createConnectorInstanceFromComponentTemplateV3(template, { id: connectorId, designation: "XS1", articleVariantId: variant.id, e4Position: { x: 100, y: 120 } });
const target = createConnector("xs2", "XS2", 1, { x: 620, y: 140 });
const wire = createWire("w1", { connectorId, contactId: connector.contacts[0]!.id }, { connectorId: target.id, contactId: target.contacts[0]!.id }, 520, "Питание", "#ce4b4b");
const wireBase = { ...createEmptyHarnessDesign(), connectors: [connector, target], wires: [wire] };
const sourceDocument: HarnessDesignDocument = { ...wireBase, wires: [{ ...wire, e4Route: createOrthogonalE4Route(wireEndpointE4Anchor(wireBase, wire.from)!, wireEndpointE4Anchor(wireBase, wire.to)!) }] };
const sourceJson = JSON.stringify(sourceDocument);
const graph = parseComponentPlacementGraph({
  placements: [{ placementId: connector.id, harnessId: "h", snapshotId, ...article, instance: { id: connector.id }, createdUtc: "2026-09-14T00:00:00Z", updatedUtc: "2026-09-14T00:00:00Z" }],
  snapshots: [{ snapshotId, projectId: "p", sourceTemplateId: templateId, sourceVersion: 7, sourceVersionSha256: template.versionSha256, code: template.code, name: template.name, articleBindings: [article], assets: [], schemaVersion: 3, content, createdUtc: "2026-09-14T00:00:00Z", updatedUtc: "2026-09-14T00:00:00Z" }],
}, "p", "h");
if (buildComponentTemplateViewInstances(sourceDocument, buildProjectComponentSnapshotLookup(graph)).length !== 1) throw new Error("QA connector artwork must materialize");
const route = generateRoute(sourceDocument, "a".repeat(64), 1).rows[0]!;
const initialRow: RouteRow = { ...route, kind: "assembly", title: "QA фрагмент XS1", presentation: {
  objects: [], backgroundOpacity: .71,
  drawingCopy: { document: structuredClone(sourceDocument), hiddenObjectIds: [] },
  isolatedDrawingCopy: { document: structuredClone(sourceDocument), hiddenObjectIds: [target.id] },
} };
interface QaState {
  graph: typeof graph; row: RouteRow; presentation: RouteRow["presentation"]; source: HarnessDesignDocument;
  clones: number; saved: number; cancelled: number; open: boolean; sourceUnchanged: boolean;
  savedCallbackRevision: number | null;
  reset: (variant: "source" | "isolated") => void; cloneProps: () => void;
}
declare global { interface Window { qa: QaState } }
function App() {
  const [row, setRow] = useState(initialRow), [open, setOpen] = useState(true), [remount, setRemount] = useState(0);
  const [clones, setClones] = useState(0), [saved, setSaved] = useState(0), [cancelled, setCancelled] = useState(0);
  const [savedCallbackRevision, setSavedCallbackRevision] = useState<number | null>(null);
  const [source, setSource] = useState(sourceDocument);
  const reset = (variant: "source" | "isolated") => {
    const copy = structuredClone(initialRow);
    if (variant === "source") delete copy.presentation.isolatedDrawingCopy;
    setRow(copy); setSource(structuredClone(sourceDocument)); setOpen(true); setSaved(0); setCancelled(0);
    setRemount(value => value + 1); setSavedCallbackRevision(null);
  };
  const cloneProps = () => {
    setSource(current => structuredClone(current)); setRow(current => structuredClone(current)); setClones(value => value + 1);
  };
  useEffect(() => { const timer = window.setInterval(cloneProps, 2000); return () => window.clearInterval(timer); }, []);
  window.qa = { graph, row, presentation: row.presentation, source, clones, saved, cancelled, open, savedCallbackRevision,
    sourceUnchanged: JSON.stringify(source) === sourceJson, reset, cloneProps };
  return <main><header><strong>Route fragment flicker QA</strong><button type="button" onClick={() => reset("source")}>QA reset source</button><button type="button" onClick={() => reset("isolated")}>QA reset isolated</button><button type="button" onClick={cloneProps}>QA clone props</button></header>{open && <RouteAssemblyDrawing key={remount} row={row} document={source} items={[]} config={config} session={session} projectId="p" harnessId="h"
    onSave={presentation => { setSavedCallbackRevision(clones); setRow(current => ({ ...current, presentation })); setSaved(value => value + 1); setOpen(false); }}
    onCancel={() => { setCancelled(value => value + 1); setOpen(false); }} />}</main>;
}
const style = document.createElement("style");
style.textContent = "body{margin:0;background:#e9eff1;font:13px system-ui;color:#182b35}main{height:100vh;display:flex;flex-direction:column}main>header{height:48px;display:flex;align-items:center;gap:12px;padding:0 18px;background:#fff;border-bottom:1px solid #cad6da}";
document.head.append(style);
createRoot(document.getElementById("root")!).render(createElement(App));
