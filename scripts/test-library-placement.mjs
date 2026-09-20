// Run against the packaged server in a newly created, isolated test data root.
// Uses the production client materializer/request builder and real HTTP APIs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const clientRoot = join(root, 'src/Techmap.Client');
const require = createRequire(join(clientRoot, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const packageRoot = resolve(process.argv[2] ?? join(root, 'artifacts/m4-03-r6-final/TECHMAP-GRAPHER'));
const checkDeletion = process.argv.includes('--check-deletion');
const checkTerminalLabels = process.argv.includes('--check-terminal-labels');
const terminalKey = '3:JST|14:SPH-002T-P0.5S|0:|3:PHR';
const testsRoot = join(root, 'artifacts/library-placement-smoke');
await mkdir(testsRoot, { recursive: true });
const dataRoot = await mkdtemp(join(testsRoot, 'test-'));
let server = spawn(join(packageRoot, 'Techmap.Server.exe'), ['--no-browser', `--data-root=${dataRoot}`], {
  cwd: packageRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', chunk => { log += chunk; });
server.stderr.on('data', chunk => { log += chunk; });
const vite = await createServer({ root: clientRoot, configFile: false, server: { middlewareMode: true }, appType: 'custom' });
try {
  const url = await new Promise((res, rej) => {
    const timeout = setTimeout(() => { clearInterval(timer); rej(new Error(`Server timeout: ${log}`)); }, 30000);
    const timer = setInterval(() => {
      const match = /TECHMAP_HOST_URL=(https?:\/\/[^\s]+)/.exec(log);
      if (match) { clearInterval(timer); clearTimeout(timeout); res(match[1]); }
      else if (server.exitCode !== null) { clearInterval(timer); clearTimeout(timeout); rej(new Error(log)); }
    }, 100);
  });
  const origin = new URL(url).origin;
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const cookie = page.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const fetcher = (path, init = {}) => fetch(new URL(String(path), origin), {
    ...init, headers: { ...init.headers, Cookie: cookie, Origin: origin },
  });
  const html = await page.text();
  for (const [, asset] of html.matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g)) {
    const response = await fetcher(new URL(asset, url));
    assert.equal(response.status, 200, `Missing packaged client asset: ${asset}`);
    assert.ok(!response.headers.get('content-type')?.includes('text/html'));
  }
  const session = await (await fetcher('/api/v1/session')).json();
  const config = await (await fetcher('/runtime-config.json')).json();
  const module = path => vite.ssrLoadModule(`/src/${path}`);
  const { createProjectApi } = await module('project-api.ts');
  const { createComponentTemplateApi } = await module('component-library/component-template-api.ts');
  const { newTemplateContentV3, addContactPointV3, addContactTypeGroupV3, addArticleVariantsV3, setArticleVariantContactGroupV3 } = await module('component-library/template-commands-v3.ts');
  const { upgradeTemplateContentV3ToV4 } = await module('component-library/template-model-v4.ts');
  const { upgradeTemplateContentV4ToV5 } = await module('component-library/template-model-v5.ts');
  const { createConnectorInstanceFromComponentTemplateV3 } = await module('editor/component-template-placement.ts');
  const { componentPlacementRequest, createComponentPlacementApi } = await module('editor/component-placement-api.ts');
  const { createHarnessDesignApi } = await module('editor/design-api.ts');
  const projects = createProjectApi(config, session, fetcher);
  const templates = createComponentTemplateApi(config, session, fetcher);
  const placements = createComponentPlacementApi(config, session, fetcher);
  const designs = createHarnessDesignApi(config, session, fetcher);
  assert.equal((await projects.listProjects()).length, 0);
  let project = await projects.createProject({ designation: 'API-SMOKE', name: 'Isolated placement test', status: 'draft' });
  project = (await projects.addHarness(project.projectId, { commandId: crypto.randomUUID(), expectedRevision: 0 }, {
    designation: 'TEST-HARNESS', quantity: 1,
  })).project;
  const harnessId = project.harnesses[0].harnessId;
  let content = newTemplateContentV3();
  [content] = addContactPointV3(content, content.views[0].id, { number: '1', name: 'Test contact' });
  const article = { sourceId: process.argv.includes('--independent-e4') ? 'БД.СОЕД' : 'smoke-library', entityType: 'connector', articleKey: 'TEST-ARTICLE' };
  content.articleVariants = [{ ...article, id: crypto.randomUUID(), parameterValues: [], contactGroups: null }];
  content = upgradeTemplateContentV3ToV4(content).content;
  if (!process.argv.includes('--v4')) {
    content = upgradeTemplateContentV4ToV5(content).content;
    content.logicalContacts = [];
    content.repeaters = [];
    content.views = content.views.map(view => ({ ...view, contactPoints: [] }));
  }
  if (process.argv.includes('--independent-e4')) {
    const { createE4ConnectorSeriesTableFromV3 } = await module('component-library/e4-connector-series-table.ts');
    const { createTemplateContentV5FromEditor } = await module('component-library/template-model-v5.ts');
    const { parseConnectorSchematic } = await module('editor/model.ts');
    let core = newTemplateContentV3();
    let group;
    [core, group] = addContactTypeGroupV3(core, 'Signal');
    core = addArticleVariantsV3(core, [article]);
    core = setArticleVariantContactGroupV3(core, core.articleVariants[0].id, group, 12, []);
    const defaults = parseConnectorSchematic(undefined);
    const preset = { ...defaults, orientation: 'contacts-left',
      baseColumns: defaults.baseColumns.map(column => ({ ...column, visible: column.key !== 'wire' })),
      customFields: [{ id: 'note', label: 'Note', visible: true }] };
    content = createTemplateContentV5FromEditor(core, createE4ConnectorSeriesTableFromV3(core, true), [], [], preset).content;
    if (checkTerminalLabels) {
      const terminal = { sourceId: 'technology-terminals', entityType: 'terminal', articleKey: terminalKey };
      content.compatibleTerminalArticleKeys = [terminal];
      content.terminalContactTypeBindings = [{ terminalArticleKey: terminal, contactTypeGroupId: group, standard: true }];
      content.e4ConnectorTable.seriesDefaults = content.e4ConnectorTable.seriesDefaults.map(row => ({
        ...row, values: { ...row.values, standardTerminalArticleKey: terminal },
      }));
    }
  }
  if (process.argv.includes('--check-drawing-editor')) {
    const { projectTemplateContentV5ToV3, createTemplateContentV5FromEditor, projectTemplateContentV5TableToV1 } = await module('component-library/template-model-v5.ts');
    const { addBasicNodeV3, editContactPointV3, setRootNodeRotationAroundCenterV3, resizeNodeV3 } = await module('component-library/template-commands-v3.ts');
    const { drawingSelection } = await module('component-library/drawing-bindings.ts');
    let core = projectTemplateContentV5ToV3(content);
    const drawing = core.views.find(view => view.kind === 'drawing'), layer = drawing.layers[0];
    let nodeId, pointId;
    [core,nodeId] = addBasicNodeV3(core,drawing.id,layer.id,'rectangle');
    [core,pointId] = addContactPointV3(core,drawing.id,{number:'1',name:'Test drawing point',contactTypeGroupId:core.contactTypeGroups[0].id});
    core = setRootNodeRotationAroundCenterV3(core,drawing.id,layer.id,nodeId,37);
    core = resizeNodeV3(core,drawing.id,layer.id,nodeId,'se',20,15);
    core = editContactPointV3(core,drawing.id,pointId,{x:{kind:'constant',value:123},y:{kind:'constant',value:234}});
    core.views.find(view => view.id === drawing.id).layers[0].nodes[0].fill={color:'#2563eb',hatch:{kind:'cross',spacing:8,angle:30}};
    const selection = drawingSelection(core.views.find(view => view.id === drawing.id),[nodeId,pointId],core.articleVariants[0].id);
    content = createTemplateContentV5FromEditor(core,projectTemplateContentV5TableToV1(content),content.compatibleTerminalArticleKeys,content.terminalContactTypeBindings,content.e4Presentation,[selection],[{logicalContactId:core.logicalContacts[0].id,seriesRowId:content.e4ConnectorTable.seriesDefaults[0].rowId}]).content;
  }
  if (process.argv.includes('--check-purpose')) {
    content = { ...content, e4ConnectorTable: { ...content.e4ConnectorTable,
      columns: content.e4ConnectorTable.columns.map(column => column.id === 'name' ? { ...column, visible: false } : column) } };
  }
  const initial = await templates.create({ code: 'API-SMOKE', name: 'Test series', articleBindings: [article], content });
  const draft = await templates.saveDraft(initial.templateId, { expectedVersion: initial.version, expectedDraftRevision: 0,
    code: initial.code, name: 'Published newer draft', articleBindings: [article], content });
  const published = await templates.publishDraft(initial.templateId, initial.version, draft.draftRevision);
  assert.ok(published.version > initial.version);
  const preview = createConnectorInstanceFromComponentTemplateV3(published, {
    id: crypto.randomUUID(), designation: 'XS1', e4Position: { x: 120, y: 100 },
  });
  const body = componentPlacementRequest(preview, 0, crypto.randomUUID());
  const result = await placements.place(project.projectId, harnessId, body);
  const graph = await placements.list(project.projectId, harnessId);
  const saved = await designs.get(project.projectId, harnessId);
  let latestTemplateVersion = published.version;
  const snapshot = graph.snapshots[0];
  assert.equal(snapshot.sourceTemplateId, preview.libraryBinding.templateId);
  assert.equal(snapshot.sourceVersion, preview.libraryBinding.templateVersion);
  assert.equal(snapshot.sourceVersionSha256, preview.libraryBinding.versionSha256);
  for (const key of ['sourceId', 'entityType', 'articleKey']) assert.equal(graph.placements[0][key], preview.libraryBinding.article[key]);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.content.connectors[0].libraryBinding)),
    JSON.parse(JSON.stringify(preview.libraryBinding)));
  assert.deepEqual(await placements.place(project.projectId, harnessId, body), result);
  if (checkTerminalLabels) {
    const { terminalArticleLabel } = await module('editor/terminal-article-label.ts');
    assert.equal(saved.content.connectors[0].contacts[0].terminalArticle, terminalKey);
    assert.equal(terminalArticleLabel(saved.content.connectors[0].contacts[0].terminalArticle), 'SPH-002T-P0.5S');
  }
  if (process.argv.includes('--independent-e4')) {
    assert.equal(saved.content.connectors[0].contacts.length, 12);
    assert.deepEqual(saved.content.connectors[0].schematic, { ...content.e4Presentation, showName: content.e4ConnectorTable.columns.find(column => column.id === "name")?.visible ?? true });
    assert.deepEqual((await templates.get(initial.templateId)).content.e4Presentation, content.e4Presentation);
  }
  if (process.argv.includes('--check-drawing-editor')) {
    const restored = await templates.get(initial.templateId);
    assert.deepEqual(restored.content.articleDrawings, content.articleDrawings);
    assert.deepEqual(restored.content.drawingContactBindings, content.drawingContactBindings);
    const drawing = restored.content.views.find(view => view.kind === 'drawing');
    assert.deepEqual(drawing.layers[0].nodes[0].fill.hatch,{kind:'cross',spacing:8,angle:30});
    const contact = saved.content.connectors[0].libraryBinding.snapshot.contacts[0];
    assert.equal(contact.sourceNumber,'1');
    assert.equal(contact.representations[0].x,123);
    assert.equal(contact.representations[0].y,234);
    const { projectComponentTemplateView } = await module('editor/component-template-view-renderer.ts');
    const rendered = projectComponentTemplateView({objectId:preview.id,snapshotId:'smoke',content:restored.content,articleVariantId:content.articleVariants[0].id},'drawing',{x:0,y:0});
    assert.equal(rendered.commands.length,1);
    assert.equal(rendered.commands[0].hatch.kind,'cross');
  }
  let terminalRefreshChecked = false;
  if (process.argv.includes('--check-terminal-refresh')) {
    const { refreshedTemplateTerminalCatalog } = await module('editor/template-terminal-catalog.ts');
    const { applyEditorCommand } = await module('editor/commands.ts');
    const terminal = { sourceId: 'technology-terminals', entityType: 'terminal', articleKey: 'TEST-NEW-TERMINAL' };
    const latest = await templates.save(published.templateId, {
      expectedVersion: published.version, code: published.code, name: published.name,
      articleBindings: [article], content: { ...content,
        compatibleTerminalArticleKeys: [...content.compatibleTerminalArticleKeys, terminal] },
    });
    latestTemplateVersion = latest.version;
    const before = saved.content.connectors[0];
    const catalog = refreshedTemplateTerminalCatalog(before, latest);
    let updated = applyEditorCommand(saved.content, { type: 'refresh-template-terminals', connectorId: before.id, catalog });
    updated = applyEditorCommand(updated, { type: 'update-contact', connectorId: before.id,
      contactId: before.contacts[0].id, terminalArticle: terminal.articleKey });
    const written = await designs.save(project.projectId, harnessId, saved.revision, updated);
    const reread = await designs.get(project.projectId, harnessId);
    assert.equal(reread.revision, written.revision);
    assert.equal(reread.content.connectors[0].contacts[0].terminalArticle, terminal.articleKey);
    assert.deepEqual(reread.content.connectors[0].libraryBinding, before.libraryBinding);
    assert.equal(reread.content.connectors[0].e4TableMode, true);
    const unchangedGraph = await placements.list(project.projectId, harnessId);
    assert.equal(unchangedGraph.snapshots[0].sourceVersion, published.version);
    assert.equal(unchangedGraph.snapshots[0].sourceVersionSha256, published.versionSha256);
    terminalRefreshChecked = true;
  }
  let drawingPlacementExpected = null;
  if (process.argv.includes('--check-drawing-placement')) {
    const { applyEditorCommand } = await module('editor/commands.ts');
    const current = await designs.get(project.projectId,harnessId);
    const drawingId = content.views.find(v=>v.kind==='drawing').layers[0].nodes[0].id;
    let updated = applyEditorCommand(current.content,{type:'set-drawing-placement',connectorId:preview.id,drawingId,offset:{x:330,y:90}});
    updated = applyEditorCommand(updated,{type:'set-drawing-placement',connectorId:preview.id,drawingId,visible:false});
    await designs.save(project.projectId,harnessId,current.revision,updated);
    const reread = await designs.get(project.projectId,harnessId);
    drawingPlacementExpected = [{drawingId,visible:false,offset:{x:330,y:90}}];
    assert.deepEqual(reread.content.connectors[0].drawingPlacements,drawingPlacementExpected);
    assert.deepEqual(reread.content.connectors[0].positions,current.content.connectors[0].positions);
    assert.deepEqual(reread.content.connectors[0].libraryBinding,current.content.connectors[0].libraryBinding);
    const graphAgain = await placements.list(project.projectId,harnessId);
    assert.deepEqual(graphAgain.placements[0].instance.drawingPlacements,drawingPlacementExpected);
  }
  let purposeExpected = null;
  if (process.argv.includes('--check-purpose')) {
    const { applyEditorCommand } = await module('editor/commands.ts');
    const { connectorContactName, connectorE4TableGeometry } = await module('editor/model.ts');
    assert.equal(preview.schematic.showName, false);
    assert.ok(!connectorE4TableGeometry(preview).columns.some(column => column.id === 'template-name'));
    let current = await designs.get(project.projectId, harnessId);
    for (const nameOverride of ['Ручное назначение', '']) {
      let updated = applyEditorCommand(current.content, { type: 'update-contact', connectorId: preview.id,
        contactId: preview.contacts[0].id, nameOverride });
      updated = applyEditorCommand(updated, { type: 'set-name-column-visibility', connectorId: preview.id, visible: true, scope: 'document' });
      await designs.save(project.projectId, harnessId, current.revision, updated);
      current = await designs.get(project.projectId, harnessId);
      assert.equal(connectorContactName(current.content.connectors[0], current.content.connectors[0].contacts[0]), nameOverride);
      assert.deepEqual(JSON.parse(JSON.stringify(current.content.connectors[0].libraryBinding)), JSON.parse(JSON.stringify(preview.libraryBinding)));
      assert.equal(current.content.connectors[0].schematic.showName, true);
    }
    const hidden = applyEditorCommand(current.content, { type: 'set-name-column-visibility', connectorId: preview.id, visible: false });
    await designs.save(project.projectId, harnessId, current.revision, hidden);
    purposeExpected = { nameOverride: '', showName: false };
    const graphAgain = await placements.list(project.projectId, harnessId);
    assert.equal(graphAgain.placements[0].instance.contacts[0].nameOverride, '');
    assert.equal(graphAgain.placements[0].instance.schematic.showName, false);
  }
  let stripProfilesChecked = false;
  if (process.argv.includes('--check-strip-profiles')) {
    const { createConnector, createWire } = await module('editor/commands.ts');
    const { createMutationHeaders } = await module('local-session.ts');
    const left = createConnector(crypto.randomUUID(), 'STRIP-X1', 1, { x: 500, y: 100 });
    const right = createConnector(crypto.randomUUID(), 'STRIP-X2', 1, { x: 800, y: 100 });
    const wire = createWire(crypto.randomUUID(),
      { connectorId: left.id, contactId: left.contacts[0].id },
      { connectorId: right.id, contactId: right.contacts[0].id });
    const profile = { sourceId: 'test-coax', snapshotId: crypto.randomUUID(),
      snapshotSha256: 'a'.repeat(64), recordId: 'b'.repeat(64), entityType: 'coax-termination',
      sourceKey: 'TEST-STRIP', displayName: 'Test strip', layers: [
        { index: 1, diameterMm: 1, stripLengthMm: 2.5 },
        { index: 3, diameterMm: 3, stripLengthMm: 7.5 },
      ] };
    wire.stripProfiles = { from: profile, to: { ...profile, sourceKey: 'TEST-STRIP-TO' } };
    const valid = await designs.save(project.projectId, harnessId, saved.revision, {
      ...saved.content, connectors: [...saved.content.connectors, left, right], wires: [wire],
    });
    const invalid = JSON.parse(JSON.stringify(valid.content));
    invalid.wires[0].stripProfiles.to.layers[1].stripLengthMm = 1;
    const rejected = await fetcher(`/api/v1/projects/${project.projectId}/harnesses/${harnessId}/design`, {
      method: 'PUT', headers: createMutationHeaders(session),
      body: JSON.stringify({ expectedRevision: valid.revision, schemaVersion: 1, content: invalid }),
    });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).field, 'content.wires[0].stripProfiles.to.layers[1].stripLengthMm');
    const unchanged = await designs.get(project.projectId, harnessId);
    assert.equal(unchanged.revision, valid.revision);
    assert.deepEqual(unchanged.content.wires[0].stripProfiles, valid.content.wires[0].stripProfiles);
    stripProfilesChecked = true;
  }
  let routingChecked = false;
  let routingHarnessId;
  let routingExpected;
  if (process.argv.includes('--check-routing')) {
    const { applyEditorCommand, createConnector, createWire, e4RoutingIssues } = await module('editor/commands.ts');
    const { createEmptyHarnessDesign, createScreenEndpoint, createJunctionEndpoint, wireEndpointE4Anchor } = await module('editor/model.ts');
    project = (await projects.addHarness(project.projectId, { commandId: crypto.randomUUID(), expectedRevision: project.revision }, {
      designation: 'ROUTING', quantity: 1,
    })).project;
    routingHarnessId = project.harnesses.find(harness => harness.designation === 'ROUTING').harnessId;
    const empty = await designs.get(project.projectId, routingHarnessId);
    let scene = createEmptyHarnessDesign();
    scene = applyEditorCommand(scene, { type: 'add-connector', connector: createConnector('x1', 'X1', 2, { x: 0, y: 0 }) });
    scene = applyEditorCommand(scene, { type: 'add-connector', connector: createConnector('x2', 'X2', 2, { x: 1000, y: 0 }) });
    scene = applyEditorCommand(scene, { type: 'flip-connector-orientation', connectorId: 'x2' });
    for (let i = 1; i <= 2; i++) scene = applyEditorCommand(scene, { type: 'add-wire', wire: createWire(`w${i}`,
      { connectorId: 'x1', contactId: `x1:contact:${i}` }, { connectorId: 'x2', contactId: `x2:contact:${i}` }) });
    scene = applyEditorCommand(scene, { type: 'move-connector', connectorId: 'x2', view: 'e4', position: { x: 200, y: 30 } });
    assert.ok(e4RoutingIssues(scene).length > 0);
    scene = applyEditorCommand(scene, { type: 'update-contact', connectorId: 'x1', contactId: 'x1:contact:1', color: 'Красный' });
    const blocked = await designs.save(project.projectId, routingHarnessId, empty.revision, scene);
    assert.deepEqual(blocked.content.connectors[1].positions.e4, { x: 200, y: 30 });
    assert.equal(blocked.content.connectors[0].contacts[0].color, 'Красный');
    scene = applyEditorCommand(blocked.content, { type: 'move-connector', connectorId: 'x2', view: 'e4', position: { x: 1000, y: 0 } });
    assert.equal(e4RoutingIssues(scene).length, 0);
    scene = applyEditorCommand(scene, { type: 'create-screen', screen: { id: 'screen', wireIds: ['w2'], position: 0.5, width: 16, label: 'SH' } });
    const targetY = wireEndpointE4Anchor(scene, scene.wires[0].from).position.y;
    scene = applyEditorCommand(scene, { type: 'create-junction', junction: {
      id: 'j', position: { x: 850, y: targetY }, wireIds: ['w1', 'branch'],
    }, branchWire: createWire('branch', createScreenEndpoint('screen'), createJunctionEndpoint('j')) });
    scene = applyEditorCommand(scene, { type: 'update-screen', screenId: 'screen', position: 0.7 });
    assert.deepEqual(scene.wires.find(wire => wire.id === 'branch').e4Route, []);
    const routed = await designs.save(project.projectId, routingHarnessId, blocked.revision, scene);
    const reread = await designs.get(project.projectId, routingHarnessId);
    assert.equal(reread.revision, routed.revision);
    assert.deepEqual(reread.content.wires.find(wire => wire.id === 'branch').e4Route, []);
    assert.equal(e4RoutingIssues(reread.content).length, 0);
    routingExpected = { connectors: reread.content.connectors, junctions: reread.content.junctions, screens: reread.content.screens };
    routingChecked = true;
  }
  let cableStripChecked = false;
  let cableHarnessId;
  let expectedCable;
  if (process.argv.includes('--check-cable-strip')) {
    const { applyEditorCommand, createConnector, createWire } = await module('editor/commands.ts');
    const { createEmptyHarnessDesign, calculateCableSheathStrip } = await module('editor/model.ts');
    const { buildCableSheathGeometry } = await module('editor/cable-sheath-geometry.ts');
    const { designToScene } = await module('editor/HarnessDesignEditor.tsx');
    const { createMutationHeaders } = await module('local-session.ts');
    project = (await projects.addHarness(project.projectId, { commandId: crypto.randomUUID(), expectedRevision: project.revision }, {
      designation: 'CABLE-STRIP', quantity: 2,
    })).project;
    cableHarnessId = project.harnesses.find(harness => harness.designation === 'CABLE-STRIP').harnessId;
    let document = createEmptyHarnessDesign();
    for (const [id, x] of [['a', 0], ['b', 600]]) document = applyEditorCommand(document, {
      type: 'add-connector', connector: createConnector(id, id, 2, { x, y: 0 }),
    });
    document = applyEditorCommand(document, { type: 'flip-connector-orientation', connectorId: 'b' });
    for (let i = 1; i <= 2; i++) document = applyEditorCommand(document, { type: 'add-wire', wire: createWire(`cw${i}`,
      { connectorId: 'a', contactId: `a:contact:${i}` }, { connectorId: 'b', contactId: `b:contact:${i}` }) });
    document = applyEditorCommand(document, { type: 'add-cable', cable: {
      id: 'CABLE', memberWireIds: ['cw1', 'cw2'], lengthMm: 100,
      endCorrectionFromMm: -1.25, endCorrectionToMm: 2, cutRoundingStepMm: 1,
      sheathStrip: { fromMm: 10, toMm: 20 },
    } });
    const stored = await designs.save(project.projectId, cableHarnessId, 0, document);
    const reread = await designs.get(project.projectId, cableHarnessId);
    expectedCable = reread.content.cables[0];
    assert.deepEqual(expectedCable.sheathStrip, { fromMm: 10, toMm: 20 });
    assert.deepEqual(calculateCableSheathStrip(expectedCable), { fromMm: 8.75, toMm: 22, totalMm: 100.75, isComplete: true });
    const objects = designToScene(reread.content, 'drawing');
    const full = buildCableSheathGeometry({ ...expectedCable, sheathStrip: undefined }, objects);
    const stripped = buildCableSheathGeometry(expectedCable, objects);
    assert.ok(stripped && full && stripped.length < full.length);
    const cutResponse = await fetcher(`/api/v1/projects/${project.projectId}/harnesses/${cableHarnessId}/cut-list`);
    assert.equal(cutResponse.status, 200);
    const cut = await cutResponse.json();
    assert.equal(cut.items.length, 1);
    assert.equal(cut.items[0].cutLengthMm, 101);
    assert.equal(cut.items[0].totalMetres, 0.202);
    if (process.argv.includes('--check-selection')) {
      const { buildLiveCutList } = await module('editor/live-cut-list.ts');
      const { buildHarnessSelectionIndex, resolveHarnessSelection } = await module('editor/harness-selection.ts');
      const live = buildLiveCutList(reread.content, project.projectId, cableHarnessId, 2);
      assert.equal(live.status, cut.status);
      for (const key of ['wireId', 'sourceLengthMm', 'endCorrectionFromMm', 'endCorrectionToMm', 'roundingStepMm', 'cutLengthMm', 'pieces', 'totalMetres', 'status', 'warnings']) {
        assert.deepEqual(live.items[0][key], cut.items[0][key], `Live cut list mismatch: ${key}`);
      }
      const before = JSON.stringify(reread.content);
      const index = buildHarnessSelectionIndex(reread.content);
      assert.deepEqual(resolveHarnessSelection(index, [cut.items[0].wireId]).wireIds, ['cw1', 'cw2']);
      assert.deepEqual(resolveHarnessSelection(index, ['a']).wireIds, ['cw1', 'cw2']);
      assert.deepEqual(resolveHarnessSelection(index, ['cw1'], true).wireIds, ['cw1']);
      assert.equal(JSON.stringify(reread.content), before);
    }
    const invalid = JSON.parse(JSON.stringify(reread.content));
    invalid.cables[0].sheathStrip.toMm = 100;
    const rejected = await fetcher(`/api/v1/projects/${project.projectId}/harnesses/${cableHarnessId}/design`, {
      method: 'PUT', headers: createMutationHeaders(session),
      body: JSON.stringify({ expectedRevision: stored.revision, schemaVersion: 1, content: invalid }),
    });
    assert.equal(rejected.status, 400);
    const unchanged = await designs.get(project.projectId, cableHarnessId);
    assert.equal(unchanged.revision, stored.revision);
    assert.deepEqual(unchanged.content.cables[0], expectedCable);
    const copy = await projects.copyProject(project.projectId);
    const copiedHarness = copy.harnesses.find(harness => harness.designation === 'CABLE-STRIP');
    assert.deepEqual((await designs.get(copy.projectId, copiedHarness.harnessId)).content.cables[0], expectedCable);
    cableStripChecked = true;
  }
  let physicalTopologyChecked = false;
  let physicalHarnessId;
  let expectedTopology;
  if (process.argv.includes('--check-topology')) {
    const { applyEditorCommand, createConnector, createWire } = await module('editor/commands.ts');
    const { createEmptyHarnessDesign } = await module('editor/model.ts');
    const { physicalSegmentPoints, splitPhysicalSegment } = await module('editor/physical-topology.ts');
    const { buildHarnessSelectionIndex, resolveHarnessSelection } = await module('editor/harness-selection.ts');
    project = (await projects.addHarness(project.projectId, {commandId:crypto.randomUUID(),expectedRevision:project.revision}, {designation:'PHYSICAL-ROUTES',quantity:1})).project;
    physicalHarnessId=project.harnesses.find(h=>h.designation==='PHYSICAL-ROUTES').harnessId;
    let d=createEmptyHarnessDesign();
    for(const [id,x,y] of [['A',0,0],['B',700,500],['C',1400,1000]]) d=applyEditorCommand(d,{type:'add-connector',connector:createConnector(id,id,2,{x,y})});
    const end=(id,n)=>({connectorId:id,contactId:`${id}:contact:${n}`});
    for(const [id,a,an,b,bn] of [['W1','A',1,'B',1],['W2','A',2,'C',1],['W3','B',2,'C',2]]) d=applyEditorCommand(d,{type:'add-wire',wire:createWire(id,end(a,an),end(b,bn),100)});
    const topology={snap:true,nodes:[{id:'NA',connectorId:'A',position:{x:170,y:60}},{id:'NB',connectorId:'B',position:{x:170,y:60}},{id:'NC',connectorId:'C',position:{x:170,y:60}},{id:'J',position:{x:500,y:260}}],segments:[{id:'S0',from:'NA',to:'J',bends:[{x:300,y:60}]},{id:'S1',from:'J',to:'NB',bends:[]},{id:'S2',from:'J',to:'NC',bends:[]}],routes:[{wireId:'W1',steps:[{segmentId:'S0',reverse:false},{segmentId:'S1',reverse:false}]},{wireId:'W2',steps:[{segmentId:'S0',reverse:false},{segmentId:'S2',reverse:false}]},{wireId:'W3',steps:[{segmentId:'S1',reverse:true},{segmentId:'S2',reverse:false}]}]};
    d=applyEditorCommand(d,{type:'set-physical-topology',topology});
    if(process.argv.includes('--check-coverings')) {
      const {createReferenceCatalogApi}=await module('reference-catalog-api.ts');
      const {coveringPaths,pathLength}=await module('editor/physical-coverings.ts');
      const api=createReferenceCatalogApi(config,session,fetcher);
      const publication=await api.publishEditableTable('technology-database',{expectedActiveSnapshotId:null,sourceKind:'manual',sourceUri:null,records:[{entityType:'protective-covering',sourceKey:'TEST-BRAID',payload:{name:'Test braid'}}]});
      const snapshot=publication.snapshot,record=snapshot.records[0];
      const material={sourceId:'technology-database',snapshotId:snapshot.snapshotId,snapshotSha256:snapshot.sha256,recordId:record.recordId,entityType:'protective-covering',sourceKey:record.sourceKey,displayName:'Test braid'};
      d=applyEditorCommand(d,{type:'set-physical-topology',topology:{...d.physicalTopology,coverings:[{id:'COVER',name:'Test braid',material,width:30,color:'#748895',lengthMm:120,spans:[{segmentId:'S0',from:.1,to:.9}]}]}});
      const before=coveringPaths(d,d.physicalTopology.coverings[0]).reduce((sum,p)=>sum+pathLength(p),0);
      const split=splitPhysicalSegment(d,'S0',1,'BEND','S3');
      const after=coveringPaths({...d,physicalTopology:split},split.coverings[0]).reduce((sum,p)=>sum+pathLength(p),0);
      assert.ok(Math.abs(before-after)<1e-6);
      assert.deepEqual(resolveHarnessSelection(buildHarnessSelectionIndex(d),['COVER']).wireIds,['W1','W2']);
      assert.equal(d.cables.length,0);
    }

    d=applyEditorCommand(d,{type:'set-physical-topology',topology:splitPhysicalSegment(d,'S0',1,'BEND','S3')});
    d=applyEditorCommand(d,{type:'move-connector',connectorId:'A',view:'drawing',position:{x:30,y:50}});
    assert.deepEqual(physicalSegmentPoints(d,d.physicalTopology.segments[0])[0],{x:200,y:110});
    assert.deepEqual(resolveHarnessSelection(buildHarnessSelectionIndex(d),['S1']).wireIds.sort(),['W1','W3']);
    assert.deepEqual(resolveHarnessSelection(buildHarnessSelectionIndex(d),['W1'],true).wireIds,['W1']);
    if(process.argv.includes('--check-documents')) {
      const {buildDrawingBom,moveDrawingAnnotation,drawingDocumentScene}=await module('editor/drawing-documents.ts');
      const rows=buildDrawingBom(d),row=rows.find(r=>r.objectIds.includes('A'));
      d=applyEditorCommand(d,{type:'set-drawing-documents',documents:{tables:[{id:'BOM',kind:'bom',position:{x:100,y:1200}},{id:'CONNECTIONS',kind:'connections',position:{x:100,y:1650}}],leaders:[{id:'LEADER',objectId:'A',rowKey:row.key,anchorOffset:{x:10,y:10},circle:{x:200,y:-50}}],bomOrder:rows.map(r=>r.key)}});
      const moved=moveDrawingAnnotation(d,'LEADER',{x:220,y:-80});
      assert.deepEqual(moved.leaders[0].anchorOffset,{x:10,y:10});
      d=applyEditorCommand(d,{type:'set-drawing-documents',documents:moved});
      const scene=drawingDocumentScene(d);
      assert.deepEqual(JSON.parse(scene.find(o=>o.id==='BOM').metadata.headers),['Поз.','Обозначение','Наименование','Кол-во','Примечание']);
      assert.equal(scene.find(o=>o.id==='LEADER').label,String(row.position));
    }
    await designs.save(project.projectId,physicalHarnessId,0,d);
    if(process.argv.includes('--check-documents')) assert.deepEqual((await designs.get(project.projectId,physicalHarnessId)).content.drawingDocuments,d.drawingDocuments);

    expectedTopology=d.physicalTopology;
    assert.deepEqual((await designs.get(project.projectId,physicalHarnessId)).content.physicalTopology,expectedTopology);
    physicalTopologyChecked=true;
  }
  let deleted = false;
  if (checkDeletion) {
    const kept = await projects.copyProject(project.projectId);
    await assert.rejects(() => projects.deleteProject(project.projectId, 0), /изменился|конфликт/i);
    await projects.deleteProject(project.projectId, project.revision);
    await assert.rejects(() => projects.getProject(project.projectId), /не найден/i);
    assert.equal((await projects.getProject(kept.projectId)).harnesses.length, project.harnesses.length);
    assert.equal((await templates.get(initial.templateId)).version, latestTemplateVersion);
    deleted = true;
  }
  let restartChecked = false;
  if (process.argv.includes('--check-restart')) {
    const stopped = once(server, 'exit');
    server.kill();
    await stopped;
    const firstLog = log;
    log = '';
    server = spawn(join(packageRoot, 'Techmap.Server.exe'), ['--no-browser', `--data-root=${dataRoot}`], {
      cwd: packageRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', chunk => { log += chunk; });
    server.stderr.on('data', chunk => { log += chunk; });
    const restartedUrl = await new Promise((res, rej) => {
      const deadline = Date.now() + 30000;
      const timer = setInterval(() => {
        const match = /TECHMAP_HOST_URL=(https?:\/\/[^\s]+)/.exec(log);
        if (match) { clearInterval(timer); res(match[1]); }
        else if (server.exitCode !== null || Date.now() > deadline) {
          clearInterval(timer); rej(new Error(`Restart failed: ${log}`));
        }
      }, 100);
    });
    const restartedPage = await fetch(restartedUrl);
    assert.equal(restartedPage.status, 200);
    const restartedCookie = restartedPage.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const restartedProjects = await fetch(new URL('/api/v1/projects', restartedUrl), { headers: { Cookie: restartedCookie } });
    assert.equal(restartedProjects.status, 200);
    const restartedTemplate = await fetch(new URL(`/api/v1/component-templates/${initial.templateId}`, restartedUrl), { headers: { Cookie: restartedCookie } });
    const reloadedTemplate = await restartedTemplate.json();
    assert.equal(reloadedTemplate.version, latestTemplateVersion);
    if (process.argv.includes('--check-drawing-editor')) { assert.deepEqual(reloadedTemplate.content.articleDrawings, content.articleDrawings); assert.deepEqual(reloadedTemplate.content.drawingContactBindings, content.drawingContactBindings); }
    if (purposeExpected && !deleted) {
      const response = await fetch(new URL(`/api/v1/projects/${project.projectId}/harnesses/${harnessId}/design`, restartedUrl), { headers: { Cookie: restartedCookie } });
      assert.equal(response.status, 200);
      const connector = (await response.json()).content.connectors[0];
      assert.equal(connector.contacts[0].nameOverride, purposeExpected.nameOverride);
      assert.equal(connector.schematic.showName, purposeExpected.showName);
    }
    if(drawingPlacementExpected && !deleted) {
      const response=await fetch(new URL(`/api/v1/projects/${project.projectId}/harnesses/${harnessId}/design`,restartedUrl),{headers:{Cookie:restartedCookie}});
      assert.equal(response.status,200);
      assert.deepEqual((await response.json()).content.connectors[0].drawingPlacements,drawingPlacementExpected);
    }
    if (routingChecked && !deleted) {
      const response = await fetch(new URL(`/api/v1/projects/${project.projectId}/harnesses/${routingHarnessId}/design`, restartedUrl), {
        headers: { Cookie: restartedCookie },
      });
      assert.equal(response.status, 200);
      const content = (await response.json()).content;
      for (const key of Object.keys(routingExpected)) assert.deepEqual(content[key], JSON.parse(JSON.stringify(routingExpected[key])));
      assert.deepEqual(content.wires.find(wire => wire.id === 'branch').e4Route, []);
    }
    if (cableStripChecked && !deleted) {
      const response = await fetch(new URL(`/api/v1/projects/${project.projectId}/harnesses/${cableHarnessId}/design`, restartedUrl), {
        headers: { Cookie: restartedCookie },
      });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).content.cables[0], JSON.parse(JSON.stringify(expectedCable)));
    }
    if (physicalTopologyChecked && !deleted) {
      const response=await fetch(new URL(`/api/v1/projects/${project.projectId}/harnesses/${physicalHarnessId}/design`,restartedUrl),{headers:{Cookie:restartedCookie}});
      assert.equal(response.status,200);
      assert.deepEqual((await response.json()).content.physicalTopology,expectedTopology);
    }
    log = firstLog + '\n--- RESTART ---\n' + log;
    restartChecked = true;
  }
  const report = { status: 'ok', appVersion: config.appVersion, projectId: project.projectId, harnessId,
    templateId: snapshot.sourceTemplateId, catalogVersion: initial.version, placedVersion: snapshot.sourceVersion,
    versionSha256: snapshot.sourceVersionSha256, article, contentSchema: snapshot.schemaVersion,
    revision: saved.revision, purposeChecked: Boolean(purposeExpected), drawingPlacementChecked: Boolean(drawingPlacementExpected), drawingEditorChecked: process.argv.includes('--check-drawing-editor'), stripProfilesChecked, cableStripChecked, coveringsChecked:process.argv.includes('--check-coverings') && physicalTopologyChecked, physicalTopologyChecked, documentsChecked:process.argv.includes('--check-documents') && physicalTopologyChecked, physicalHarnessId, routingChecked, terminalRefreshChecked, terminalLabelsChecked: checkTerminalLabels, deleted, restartChecked, dataRoot };
  await writeFile(join(dataRoot, 'smoke-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.kill();
  await vite.close();
  await writeFile(join(dataRoot, 'server.log'), log);
}
