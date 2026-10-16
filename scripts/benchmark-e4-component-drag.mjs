// Synthetic C1-scale document. Does not open or change a user project.
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const client = join(root, 'src/Techmap.Client');
const require = createRequire(join(client, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const vite = await createServer({ root: client, configFile: false,
  cacheDir: join(root, 'tmp/e4-drag-vite'),
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const load = name => vite.ssrLoadModule(`/src/${name}`);
  const { createEmptyHarnessDesign, wireEndpointE4Anchor, parseHarnessDesignDocument } = await load('editor/model.ts');
  const { createConnector, createWire, applyEditorCommand, e4RoutingIssues } = await load('editor/commands.ts');
  const { e4ConnectivityFingerprint } = await load('editor/e4-connectivity.ts');
  const { designToScene } = await load('editor/HarnessDesignEditor.tsx');
  const { BUILTIN_TERMINATION_RECORDS, createTerminationPlacement } = await load('termination-library/index.ts');
  const connectors = Array.from({ length: 6 }, (_, i) => {
    const c = createConnector(`X${i}`, `XS${i + 1}`, i === 0 ? 13 : 6,
      { x: i % 2 * 1000, y: Math.floor(i / 2) * 600 });
    return i % 2 ? { ...c, schematic: { ...c.schematic, orientation: 'contacts-left' } } : c;
  });
  connectors.push(createConnector('X6', 'XS7', 3, { x: 1800, y: 0 }));
  const record = BUILTIN_TERMINATION_RECORDS.find(r => r.assetId === 'nvi-fork');
  const { connector: terminal, artifact } = createTerminationPlacement(record,
    { id: 'T', designation: 'T1', position: { x: 1000, y: 1450 } });
  connectors.push(terminal);
  const { emptyTerminationDocument } = await load('editor/termination-model.ts');
  let document = { ...createEmptyHarnessDesign(), connectors,
    terminations: { ...emptyTerminationDocument(), artifacts: [artifact] } };
  const wires = Array.from({ length: 12 }, (_, i) => {
    const band = Math.floor(i / 4), row = i % 4;
    const from = connectors[band * 2], to = i === 11 ? terminal : connectors[band * 2 + 1];
    const wire = createWire(`W${i + 1}`, { connectorId: from.id, contactId: from.contacts[row].id },
      { connectorId: to.id, contactId: to.contacts[i === 11 ? 0 : row].id }, 500);
    const a = wireEndpointE4Anchor(document, wire.from).position;
    const b = wireEndpointE4Anchor(document, wire.to).position;
    return { ...wire, e4Route: [{ x: a.x + 24, y: a.y },
      ...(a.y === b.y ? [] : [{ x: 850, y: a.y }, { x: 850, y: b.y }]),
      { x: b.x - 24, y: b.y }] };
  });
  document = { ...document, wires,
    diffPairs: [{ id: 'pair1', wireIds: ['W1', 'W2'], step: 24, amplitude: 8, variant: 1 },
      { id: 'pair2', wireIds: ['W5', 'W6'], step: 24, amplitude: 8, variant: 1 }] };
  document = parseHarnessDesignDocument(document);
  if (process.env.E4_DRAG_FIXTURE) {
    writeFileSync(process.env.E4_DRAG_FIXTURE, JSON.stringify(document));
  } else {
  const previewPath = join(client, 'src/editor/e4-move-preview.ts');
  const preview = existsSync(previewPath) ? (await load('editor/e4-move-preview.ts')).previewE4ConnectorMove : null;
  const summary = values => {
    values.sort((a, b) => a - b);
    return { medianMs: +values[Math.floor(values.length / 2)].toFixed(3),
      p95Ms: +values[Math.floor(values.length * .95)].toFixed(3) };
  };
  const results = [];
  for (const id of ['X0', 'X6', 'T']) for (const mode of ['carry', 'adjacent']) {
    for (const method of preview ? ['command', 'preview'] : ['command']) {
      const geometry = [], total = [];
      for (let i = -1; i < 8; i++) {
        const origin = connectors.find(c => c.id === id).positions.e4;
        const point = { x: origin.x + 15 + i / 10, y: origin.y + 12 };
        const start = performance.now();
        const next = method === 'preview' ? preview(document, id, point, mode)
          : applyEditorCommand(document, { type: 'move-connector', connectorId: id,
            view: 'e4', position: point, physicalDragMode: mode });
        const afterGeometry = performance.now();
        designToScene(next, 'e4');
        if (i >= 0) { geometry.push(afterGeometry - start); total.push(performance.now() - start); }
        // Verify the result outside the timed section. A fast release must
        // still commit valid routes and leave distant pairs untouched.
        if (method === 'command') {
          assert.deepEqual(e4RoutingIssues(next), []);
          assert.equal(e4ConnectivityFingerprint(next), e4ConnectivityFingerprint(document));
          assert.deepEqual(next.wires.map(w => [w.id, w.lengthMm]), document.wires.map(w => [w.id, w.lengthMm]));
          if (id === 'T') assert.deepEqual(next.wires.slice(0, -1), document.wires.slice(0, -1));
        }
      }
      const result = { id, mode, method, geometry: summary(geometry), withScene: summary(total) };
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }
  console.log(JSON.stringify({ node: process.version, connectors: connectors.length,
    wires: wires.length, pairs: document.diffPairs.length, samples: 8, validation: 'PASS', results }, null, 2));
  }
} finally { await vite.close(); }
