import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/Techmap.Client/src/editor/harness-editor.css";
import { CanvasViewport, pipeMidpoints } from "../src/Techmap.Client/src/editor/CanvasViewport";
import { createEmptyHarnessDesign, defaultLayerIds, parseHarnessDesignDocument } from "../src/Techmap.Client/src/editor/model";
import { createJoiningPipe } from "../src/Techmap.Client/src/editor/physical-joining-pipes";
import { physicalTopologyScene } from "../src/Techmap.Client/src/editor/physical-scene";
import { coveringScene } from "../src/Techmap.Client/src/editor/covering-layout";
import { applyEditorCommand } from "../src/Techmap.Client/src/editor/commands";
import { resolvePhysicalRoutePointCommand } from "../src/Techmap.Client/src/editor/physical-route-point-command";
import { emptyDrawingDocuments } from "../src/Techmap.Client/src/editor/drawing-documents";

const empty = createEmptyHarnessDesign();
const source = { ...empty, drawingDocuments: { ...emptyDrawingDocuments(), bendRadius: 24 }, physicalTopology: {
  snap: true,
  nodes: [
    { id: "a", position: { x: 0, y: 0 } }, { id: "b", position: { x: 600, y: 0 } },
    { id: "c", position: { x: 0, y: 140 } }, { id: "d", position: { x: 600, y: 210 } },
  ],
  segments: [
    { id: "p0", from: "a", to: "b", path: { kind: "polyline", points: [{ x: 80, y: 30 }, { x: 500, y: 30 }] } },
    { id: "p1", from: "c", to: "d", path: { kind: "polyline", points: [{ x: 80, y: 170 }, { x: 500, y: 190 }] } },
  ], routes: [],
} };
const joining = createJoiningPipe(source as any, [["p0"], ["p1"]], "op");
const initial = { ...source, physicalTopology: { ...source.physicalTopology, joiningPipes: [joining], coverings: [
  { id: "sleeve", name: "Оболочка ОП", width: 0, color: "#3c8b78", lengthMm: null, spans: [{ segmentId: "op", from: .12, to: .88 }] },
] } };

function App() {
  const [document, setDocument] = useState<any>(initial);
  const [preview, setPreview] = useState<any>(null);
  const [selected, setSelected] = useState<string | null>("p1");
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => {
    if (!preview) return document;
    try { const command = resolvePhysicalRoutePointCommand(document, preview.id, preview.index, preview.point, preview.mode, preview.insert); return command ? applyEditorCommand(document, command) : document; }
    catch (cause) { setTimeout(() => setError(cause instanceof Error ? cause.stack ?? String(cause) : String(cause)), 0); return document; }
  }, [document, preview]);
  const objects = useMemo(() => [...physicalTopologyScene(shown), ...coveringScene(shown)], [shown]);
  const camera = { zoom: 1, offsetX: 210, offsetY: 270 };
  const layers = [
    { id: defaultLayerIds.wires, label: "Пайпы", visible: true, locked: false },
    { id: defaultLayerIds.connectionPoints, label: "Точки", visible: true, locked: false },
    { id: "coverings", label: "Оболочки", visible: true, locked: false },
  ];
  const emit = (entry: any) => setEvents(previous => [...previous, entry]);
  const qa = { document, preview, previewCommand: preview ? resolvePhysicalRoutePointCommand(document, preview.id, preview.index, preview.point, preview.mode, preview.insert) : null, events, error, handles: Object.fromEntries(objects.filter(o => o.kind === "physical-segment").map(o => [o.id, { points: o.points, handles: o.pipe?.handles, authoredHandleIndices: o.pipe?.authoredHandleIndices, authoredHandleRegions: o.pipe?.authoredHandleRegions, midpoints: pipeMidpoints(o), controlledMidpoints: o.pipe?.controlledMidpoints }])) };
  (window as any).qa = qa;
  (window as any).qaPerformance = { resolvePhysicalRoutePointCommand, applyEditorCommand, physicalTopologyScene };
  return <main>
    <header><strong>OP midpoint QA</strong><span>synthetic document · actual CanvasViewport / production resolver</span><button onClick={() => { setDocument(initial); setPreview(null); setEvents([]); setError(null); }}>Reset</button><button onClick={() => { try { setDocument(parseHarnessDesignDocument(JSON.parse(JSON.stringify(document)))); setPreview(null); emit({ phase: "save-load" }); } catch (cause) { setError(cause instanceof Error ? cause.stack ?? String(cause) : String(cause)); } }}>Save/load</button></header>
    <div className="qa-canvas"><CanvasViewport view="drawing" tool="select" camera={camera} objects={objects as any} layers={layers} selectedObjectId={selected} onCameraChange={() => {}} onObjectSelect={setSelected} onCatalogDrop={() => {}}
      onWireRoutePointPreview={(id, index, point, mode, insert) => { setPreview(point ? { id, index, point, mode, insert } : null); emit({ phase: "preview", id, index, point, mode, insert }); }}
      onWireRoutePointMove={(id, index, point, mode, insert) => { emit({ phase: "commit", id, index, point, mode, insert }); try { const command = resolvePhysicalRoutePointCommand(document, id, index, point, mode, insert); if (command) setDocument(applyEditorCommand(document, command)); else setError(`No command for ${id}:${index}`); } catch (cause) { setError(cause instanceof Error ? cause.stack ?? String(cause) : String(cause)); } }}
    />{[
      { text: "П1 · XS4", x: 18, y: -28 },
      { text: "П2 · XS2", x: 18, y: 215 },
      { text: "ОП · оболочка", x: 268, y: -42 },
    ].map(label => <span className="qa-label" key={label.text} style={{ left: camera.offsetX + label.x, top: camera.offsetY + label.y }}>{label.text}</span>)}</div>
    <pre id="qa-state">{JSON.stringify({ selected, events: events.slice(-3), handles: qa.handles }, null, 2)}</pre>
  </main>;
}

const style = document.createElement("style");
style.textContent = "body{margin:0;background:#e9eff1;font:13px system-ui;color:#182b35}main{height:100vh;display:flex;flex-direction:column}header{height:48px;display:flex;align-items:center;gap:20px;padding:0 18px;background:#fff;border-bottom:1px solid #cad6da}header span{color:#61747c}header button:first-of-type{margin-left:auto}header button:last-of-type{margin-left:0}.qa-canvas{position:relative;flex:1;min-height:450px}.qa-canvas .he-canvas-frame{width:100%;height:100%}.qa-canvas .he-canvas{width:100%;height:100%}.qa-label{position:absolute;pointer-events:none;background:#fff9;padding:3px 5px;color:#176079;font-size:12px;font-weight:700}pre{height:180px;overflow:auto;margin:0;padding:8px 18px;background:#15252c;color:#bbdcda;font:11px Consolas,monospace}";
document.head.append(style);
createRoot(document.getElementById("root")!).render(<App />);
