import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/Techmap.Client/src/styles.css";
import { HarnessDesignEditor, designToScene } from "../src/Techmap.Client/src/editor/HarnessDesignEditor";
import { createConnector, createWire } from "../src/Techmap.Client/src/editor/commands";
import { createEmptyHarnessDesign, createOrthogonalE4Route, wireEndpointE4Anchor, type HarnessDesignDocument } from "../src/Techmap.Client/src/editor/model";
import { createIndependentIsolatedDocument, createRouteDrawingCopy, parseRouteDrawingCopy } from "../src/Techmap.Client/src/manufacturing/route-drawing-copy";

const connectors = [createConnector("X1", "XS1", 2, { x: 100, y: 100 }), createConnector("X2", "XS2", 2, { x: 700, y: 100 })];
const base: HarnessDesignDocument = { ...createEmptyHarnessDesign(), connectors, wires: [0, 1].map(i => createWire(`W${i + 1}`,
  { connectorId: "X1", contactId: connectors[0]!.contacts[i]!.id }, { connectorId: "X2", contactId: connectors[1]!.contacts[i]!.id }, 385, `W${i + 1}`, i ? "#146fc9" : "#bd3737")) };
const source = { ...base, wires: base.wires.map(w => ({ ...w, e4Route: createOrthogonalE4Route(wireEndpointE4Anchor(base, w.from)!, wireEndpointE4Anchor(base, w.to)!) })),
  diffPairs: [{ id: "pair", wireIds: ["W1", "W2"] as const, step: 40, amplitude: 6, variant: 1 as const }] };
const original = JSON.stringify(source);
const initial = createIndependentIsolatedDocument(source, designToScene(source, "drawing"), ["X1", "W1", "W2"], new Map([["W1", { from: "cut", to: "tin" }], ["W2", { from: "cut", to: "copper" }]]))!;
const qa = { draft: initial, saved: null as HarnessDesignDocument | null, sourceUnchanged: true };
(window as unknown as { qa068: typeof qa }).qa068 = qa;
const config = { configVersion: 1 as const, basePath: "/", apiBasePath: "/api/", appVersion: "qa", apiVersion: "1", schemaVersion: "1" };
const session = { csrfNonce: "qa", instanceId: "qa" };
function App() {
  const [document, setDocument] = useState(initial), [open, setOpen] = useState(true), [revision, setRevision] = useState(0);
  return <main>{!open && <button onClick={() => { setDocument(parseRouteDrawingCopy(createRouteDrawingCopy(qa.saved!)).document); setRevision(value => value + 1); setOpen(true); }}>QA открыть сохранённый фрагмент</button>}{open && <HarnessDesignEditor key={revision} config={config} session={session} projectId="p" harnessId="h" harnessDesignation="QA изоляция" initialView="drawing" localCopy={{ initialDocument: document, backgroundOpacity: 0,
    onDraftChange: value => { qa.draft = value; qa.sourceUnchanged = JSON.stringify(source) === original; },
    onSave: value => { qa.saved = value; setOpen(false); }, onCancel: () => setOpen(false),
  }} />}</main>;
}
document.body.style.margin = "0";
createRoot(document.getElementById("root")!).render(createElement(App));
