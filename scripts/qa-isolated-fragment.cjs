const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const assert = require('node:assert/strict');
const path = require('node:path');
async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
  page.setDefaultTimeout(7000);
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname.endsWith('/component-placements') ? { placements: [], snapshots: [] }
      : pathname.endsWith('/component-templates') ? { items: [] }
      : pathname.endsWith('/material-library') ? { materials: [] }
      : { snapshotId: '00000000-0000-4000-8000-000000000099', sourceId: 'technology-wires', contractVersion: 1, capturedUtc: '2026-10-04T00:00:00Z', sourceKind: 'qa', versionFingerprint: 'empty', sha256: 'a'.repeat(64), records: [], diagnostics: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  try {
    await page.goto(process.env.QA_URL || 'http://127.0.0.1:5190/qa-isolated-fragment.html');
    await page.locator('canvas.he-canvas').waitFor();
    await page.getByRole('button', { name: 'Выбрать W1', exact: true }).click();
    await page.getByLabel('W1: режим to', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('W1: режим to', { exact: true }).inputValue(), 'tin');
    await page.getByLabel('W1: режим to', { exact: true }).selectOption('terminal');
    assert.equal(await page.evaluate(() => window.qa068.draft.wires[0].drawingEndStyles.to), 'terminal');
    const end = page.getByLabel('Свободные концы проводов', { exact: true }).locator('circle').first();
    const b = await end.boundingBox(); assert.ok(b);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 - 40, b.y + b.height / 2 + 50, { steps: 4 }); await page.mouse.up();
    const endpoint = await page.evaluate(() => window.qa068.draft.wires[0].drawingEndpoints.to);
    assert.deepEqual(endpoint, { x: 660, y: 178 });
    async function endMenu() {
      const point = await page.getByLabel('Свободные концы проводов', { exact: true }).locator('circle').first().boundingBox();
      await page.mouse.click(point.x + point.width / 2, point.y + point.height / 2, { button: 'right' });
    }
    await endMenu();
    await page.getByRole('button', { name: 'Распрямить пару', exact: true }).click();
    assert.equal(await page.evaluate(() => window.qa068.draft.diffPairs.length), 0);
    const midpoint = page.getByLabel('Изгибы свободных проводов', { exact: true }).locator('circle').first();
    const m = await midpoint.boundingBox(); assert.ok(m);
    await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
    await page.mouse.down(); await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2 + 55, { steps: 5 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.qa068.draft.wires[0].drawingRoute.length), 1);
    assert.deepEqual(await page.evaluate(() => window.qa068.draft.wires[0].drawingEndpoints.to), endpoint);
    const bend = await page.evaluate(() => window.qa068.draft.wires[0].drawingRoute[0]);
    const endBox = await end.boundingBox();
    const bendScreen = { x: endBox.x + endBox.width / 2 + bend.x - endpoint.x, y: endBox.y + endBox.height / 2 + bend.y - endpoint.y };
    await page.mouse.move(bendScreen.x, bendScreen.y);
    await page.mouse.down(); await page.mouse.move(bendScreen.x + 20, bendScreen.y + 25, { steps: 4 }); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.qa068.draft.wires[0].drawingRoute[0]), { x: bend.x + 20, y: bend.y + 25 });
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.qa068.draft.wires[0].drawingRoute[0]), bend);
    await page.getByRole('button', { name: 'Выбрать W2', exact: true }).click({ modifiers: ['Control'] });
    await page.getByLabel('Общий режим to', { exact: true }).selectOption('sealed');
    assert.deepEqual(await page.evaluate(() => window.qa068.draft.wires.map(w => w.drawingEndStyles.to)), ['sealed', 'sealed']);
    await endMenu();
    await page.getByRole('button', { name: 'Свить пару', exact: true }).click();
    assert.equal(await page.evaluate(() => window.qa068.draft.diffPairs.length), 1);
    await page.getByRole('button', { name: 'Выбрать W1', exact: true }).click();
    await endMenu();
    await page.getByRole('button', { name: 'Оконцовка конца', exact: true }).click();
    assert.equal(await page.getByLabel('W1: режим to', { exact: true }).evaluate(el => el === document.activeElement), true);
    await page.getByRole('button', { name: 'Сохранить фрагмент', exact: true }).click();
    await page.getByRole('button', { name: 'QA открыть сохранённый фрагмент', exact: true }).click();
    await page.locator('canvas.he-canvas').waitFor();
    assert.equal(await page.evaluate(() => window.qa068.draft.wires[0].drawingRoute.length), 1);
    assert.equal(await page.evaluate(() => window.qa068.draft.diffPairs.length), 1);
    assert.equal(await page.evaluate(() => window.qa068.draft.drawingDocuments.dimensions.length), 2);
    assert.deepEqual(await page.evaluate(() => window.qa068.draft.wires.map(w => w.lengthMm)), [385, 385]);
    assert.equal(await page.evaluate(() => window.qa068.sourceUnchanged), true);
    await page.setViewportSize({ width: 1000, height: 800 });
    if (!await page.getByRole('button', { name: 'Выбрать W1', exact: true }).isVisible()) await page.getByRole('button', { name: 'Показать объекты', exact: true }).click();
    await page.getByRole('button', { name: 'Выбрать W1', exact: true }).click();
    await page.getByRole('button', { name: 'Свойства и слои', exact: true }).click();
    await page.getByRole('button', { name: 'Вписать в экран', exact: true }).click();
    await endMenu(); await page.getByRole('button', { name: 'Оконцовка конца', exact: true }).click();
    assert.equal(await page.getByLabel('W1: режим to', { exact: true }).isVisible(), true);
    console.log('UI PASS: inherited/individual/bulk ends, endpoint drag, midpoint insertion, bend move/undo, pair context menu, dimensions, Save/reopen, narrow viewport, source unchanged; API writes:', writes.length);
    await page.screenshot({ path: path.join(process.env.QA_SHOTS || '.', 'qa-isolated-fragment.png'), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  } catch (error) { console.error(error); await page.screenshot({ path: path.join(process.env.QA_SHOTS || '.', 'qa-isolated-fragment-failure.png'), fullPage: true }); throw error; }
  finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
