// Start: node src/Techmap.Client/node_modules/vite/bin/vite.js --config scripts/qa-route-fragment-flicker-vite.config.mjs
// Set PLAYWRIGHT_PATH to the installed playwright package and optionally QA_CHROME.
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const assert = require('node:assert/strict');
const path = require('node:path');
async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, deviceScaleFactor: 1 });
  const errors = [], requests = [], writes = [], samples = [];
  let graphs = 0;
  page.on('pageerror', e => errors.push(e.stack || e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/api/**', async route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    requests.push(pathname);
    if (request.method() !== 'GET') writes.push(`${request.method()} ${pathname}`);
    let body;
    if (pathname.endsWith('/component-placements')) {
      graphs++;
      body = await page.evaluate(() => window.qa.graph);
      await new Promise(resolve => setTimeout(resolve, 80));
    } else if (pathname.endsWith('/component-templates')) body = { items: [] };
    else if (pathname.endsWith('/reference-sources/technology-wires/active')) body = {
      snapshotId: '00000000-0000-4000-8000-000000000099', sourceId: 'technology-wires', contractVersion: 1,
      capturedUtc: '2026-10-04T00:00:00Z', sourceKind: 'qa', versionFingerprint: 'empty',
      sha256: 'a'.repeat(64), records: [], diagnostics: [],
    };
    else if (pathname.endsWith('/material-library')) body = { materials: [] };
    else { errors.push(`Unexpected API request: ${pathname}`); body = { message: 'Unconfigured QA endpoint' }; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const modeButton = mode => page.getByRole('group', { name: 'Версия фрагмента' }).getByRole('button', { name: mode === 'source' ? 'Исходная копия' : 'Изолированный фрагмент', exact: true });
  const opacity = () => page.getByLabel(/^Фон жгута:/);
  const rotation = () => page.getByRole('textbox', { name: 'Поворот разъёма на чертеже' });
  async function selectConnector() {
    await page.getByRole('button', { name: 'Выбрать XS1', exact: true }).click();
    await page.locator('canvas.he-canvas').click({ button: 'right', position: { x: 20, y: 20 } });
    await rotation().waitFor();
    assert.equal(await rotation().isEnabled(), true, 'fixture must use a library connector');
  }
  async function setOpacity(value) { await opacity().fill(String(value)); await opacity().blur(); }
  async function stable(label) {
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    const before = graphs;
    const result = await page.evaluate(() => new Promise(resolve => {
      const canvas = document.querySelector('canvas.he-canvas');
      const baseline = canvas.toDataURL(), started = performance.now(), pollStart = window.qa.clones;
      let frames = 0, changed = 0, replaced = 0;
      function frame() {
        frames++;
        const current = document.querySelector('canvas.he-canvas');
        if (current !== canvas) replaced++;
        if (!current || current.toDataURL() !== baseline) changed++;
        if (performance.now() - started < 4400) requestAnimationFrame(frame);
        else resolve({ frames, changed, replaced, polls: window.qa.clones - pollStart });
      }
      requestAnimationFrame(frame);
    }));
    samples.push({ label, graphsBefore: before, graphsAfter: graphs, ...result });
    assert.ok(result.frames > 10);
    assert.ok(result.polls >= 2, 'cover two real polling intervals');
    assert.equal(graphs, before, `${label}: polling must not reload connector graph`);
    assert.equal(result.replaced, 0, `${label}: canvas must stay mounted`);
    assert.equal(result.changed, 0, `${label}: canvas pixels must not flicker`);
  }
  async function changeMode(mode) {
    await modeButton(mode).click();
    await page.locator('canvas.he-canvas').waitFor();
    await page.waitForTimeout(200);
    assert.equal(await modeButton(mode).getAttribute('aria-pressed'), 'true');
  }
  try {
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:5184/qa-route-fragment-flicker.html', { waitUntil: 'load', timeout: 20000 });
    await page.locator('canvas.he-canvas').waitFor();
    await page.waitForTimeout(300);
    assert.ok(graphs >= 1, 'graph must actually load');
    await page.evaluate(() => window.qa.reset('source'));
    await page.waitForTimeout(300);
    await selectConnector();
    await page.getByRole('button', { name: 'Повернуть на 15°', exact: true }).click();
    assert.equal(await rotation().inputValue(), '15');
    await stable('source edited');
    assert.equal(await rotation().inputValue(), '15', 'selection and edit survive polling');
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(await rotation().inputValue(), '0', 'undo history survives polling');
    await page.evaluate(() => window.qa.reset('isolated'));
    await page.waitForTimeout(300);
    await selectConnector();
    await page.getByRole('button', { name: 'Повернуть на 15°', exact: true }).click();
    await setOpacity(22);
    await stable('persisted isolated edited');
    await changeMode('source');
    await selectConnector();
    await page.getByRole('button', { name: 'Повернуть на 15°', exact: true }).click();
    await setOpacity(37);
    await page.getByRole('checkbox', { name: 'Скрыть XS2', exact: true }).uncheck();
    await changeMode('isolated');
    await selectConnector();
    assert.equal(await rotation().inputValue(), '15', 'isolated geometry survives switch');
    assert.equal(await opacity().inputValue(), '22', 'isolated opacity survives switch');
    await changeMode('source');
    await selectConnector();
    assert.equal(await rotation().inputValue(), '15', 'source geometry survives switch');
    assert.equal(await opacity().inputValue(), '37', 'source opacity survives switch');
    assert.equal(await page.getByRole('checkbox', { name: 'Показать XS2', exact: true }).isChecked(), false);
    await page.evaluate(() => window.qa.cloneProps());
    await page.getByRole('button', { name: 'Сохранить фрагмент', exact: true }).click();
    const saved = await page.evaluate(() => window.qa);
    assert.equal(saved.saved, 1);
    assert.equal(saved.open, false);
    assert.equal(saved.savedCallbackRevision, saved.clones, 'save uses the latest parent callback');
    assert.equal(saved.presentation.backgroundOpacity, .37);
    assert.ok(saved.presentation.drawingCopy.hiddenObjectIds.includes('xs2'));
    assert.equal(saved.sourceUnchanged, true);
    const isolatedConnector = saved.presentation.isolatedDrawingCopy.document.connectors.find(c => c.designation === 'XS1');
    assert.ok(Object.values(isolatedConnector.drawingPlacements).some(p => p.rotationDegrees === 15));
    await page.evaluate(() => window.qa.reset('source'));
    await page.waitForTimeout(300);
    const beforeCancel = await page.evaluate(() => JSON.stringify(window.qa.presentation));
    await selectConnector();
    await page.getByRole('button', { name: 'Повернуть на 15°', exact: true }).click();
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    const cancelled = await page.evaluate(() => ({ saved: window.qa.saved, cancelled: window.qa.cancelled, open: window.qa.open, sourceUnchanged: window.qa.sourceUnchanged, presentation: JSON.stringify(window.qa.presentation) }));
    assert.equal(cancelled.cancelled, 1);
    assert.equal(cancelled.saved, 0);
    assert.equal(cancelled.open, false);
    assert.equal(cancelled.sourceUnchanged, true);
    assert.equal(cancelled.presentation, beforeCancel);
    // A newly isolated draft must remain reachable before its first Save.
    await page.evaluate(() => window.qa.reset('source'));
    await page.waitForTimeout(300);
    await selectConnector();
    await page.getByRole('button', { name: 'Изолировать', exact: true }).click();
    await page.waitForTimeout(300);
    assert.equal(await modeButton('isolated').getAttribute('aria-pressed'), 'true');
    await stable('new isolated draft');
    await changeMode('source');
    assert.equal(await modeButton('isolated').isEnabled(), true);
    await changeMode('isolated');
    await page.getByRole('button', { name: 'Сохранить фрагмент', exact: true }).click();
    const newCopy = await page.evaluate(() => window.qa.presentation);
    assert.equal(newCopy.drawingCopy.document.connectors.length, 2);
    assert.equal(newCopy.isolatedDrawingCopy.document.connectors.length, 1);
    assert.deepEqual(writes, [], 'local editing must not write API data');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, graphs, samples, writes, errors, checks: ['source and isolated frames', 'undo after polling', 'mode drafts and opacity', 'both drafts saved', 'new isolation and save', 'latest callback', 'cancel', 'source unchanged'] }, null, 2));
  } finally {
    await page.screenshot({ path: path.join(process.env.QA_SHOTS || process.env.TEMP, 'qa-route-fragment-flicker.png') });
    if (errors.length) console.error(JSON.stringify({ errors, requests }, null, 2));
    await browser.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
