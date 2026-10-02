const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const path = require("node:path");

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
    await page.goto("http://127.0.0.1:5183/qa-op-midpoint.html", { waitUntil: "load" });
    await page.locator("canvas.he-canvas").waitFor();
    const before = await page.evaluate(() => ({ handles: window.qa.handles.p1, count: window.qa.document.physicalTopology.segments.find(s => s.id === "p1").path.points.length }));
    const handle = before.handles.midpoints.find(point => point.index === 0);
    if (!handle) throw new Error("Outer leading midpoint 0 unavailable");
    const bounds = await page.locator("canvas.he-canvas").boundingBox();
    const start = { x: bounds.x + 210 + handle.point.x, y: bounds.y + 270 + handle.point.y };
    const steps = [
      { name: "down1", dx: -10, dy: 30, ctrl: true, shift: false },
      { name: "down2", dx: -25, dy: 70, ctrl: true, shift: false },
      { name: "up1", dx: 10, dy: -45, ctrl: true, shift: false },
      { name: "down3", dx: -15, dy: 55, ctrl: true, shift: false },
      { name: "free", dx: -22, dy: 90, ctrl: false, shift: false },
      { name: "ctrl-shift", dx: 5, dy: -55, ctrl: true, shift: true },
      { name: "return", dx: -25, dy: 70, ctrl: true, shift: false },
    ];
    const shots = process.env.QA_SHOTS || process.env.TEMP;
    await page.screenshot({ path: path.join(shots, "qa-op-sequence-before.png") });
    await page.keyboard.down("Control");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const readings = [];
    let ctrl = true, shift = false;
    for (const step of steps) {
      if (step.ctrl !== ctrl) { await page.keyboard[step.ctrl ? "down" : "up"]("Control"); ctrl = step.ctrl; }
      if (step.shift !== shift) { await page.keyboard[step.shift ? "down" : "up"]("Shift"); shift = step.shift; }
      await page.mouse.move(start.x + step.dx, start.y + step.dy, { steps: 8 });
      const reading = await page.evaluate(() => {
        const preview = window.qa.preview;
        const handles = window.qa.handles.p1;
        const target = preview?.point;
        return { preview, points: handles.points, distance: target ? Math.min(...handles.handles.map(handle => Math.hypot(target.x - handle.x, target.y - handle.y))) : null, guide: document.querySelector('[aria-label="Привязка трассы"] polyline')?.getAttribute("points") ?? null, error: window.qa.error };
      });
      readings.push({ name: step.name, ...reading });
      if (["down2", "up1", "return"].includes(step.name)) await page.screenshot({ path: path.join(shots, `qa-op-sequence-${step.name}.png`) });
    }
    await page.mouse.up();
    await page.keyboard.up("Control");
    const after = await page.evaluate(() => ({ handles: window.qa.handles.p1, count: window.qa.document.physicalTopology.segments.find(s => s.id === "p1").path.points.length, commits: window.qa.events.filter(event => event.phase === "commit"), error: window.qa.error }));
    await page.screenshot({ path: path.join(shots, "qa-op-sequence-after.png") });
    const lastTarget = readings.at(-1).preview.point;
    const authored = after.handles.authoredHandleIndices.findIndex(value => value > 0 && Math.hypot(after.handles.handles[after.handles.authoredHandleIndices.indexOf(value)].x - lastTarget.x, after.handles.handles[after.handles.authoredHandleIndices.indexOf(value)].y - lastTarget.y) < 1);
    if (authored < 0) throw new Error("Created authored handle was not found");
    const savedPointIndex = after.handles.authoredHandleIndices[authored] - 1;
    const grip = after.handles.handles[authored];
    const gripScreen = { x: bounds.x + 210 + grip.x, y: bounds.y + 270 + grip.y };
    await page.keyboard.down("Control");
    await page.mouse.move(gripScreen.x, gripScreen.y);
    await page.mouse.down();
    const editReadings = [];
    for (const step of [{ name: "edit-down", dx: 35, dy: 55 }, { name: "edit-up", dx: 15, dy: -45 }, { name: "edit-return", dx: 35, dy: 55 }]) {
      await page.mouse.move(gripScreen.x + step.dx, gripScreen.y + step.dy, { steps: 8 });
      const state = await page.evaluate(savedPointIndex => {
        const preview = window.qa.preview, pipe = window.qa.handles.p1;
        const edited = pipe.authoredHandleIndices.findIndex(value => value === savedPointIndex + 1);
        return { preview, scene: pipe.points, distance: edited < 0 ? Infinity : Math.hypot(pipe.handles[edited].x - preview.point.x, pipe.handles[edited].y - preview.point.y), error: window.qa.error };
      }, savedPointIndex);
      editReadings.push({ name: step.name, ...state });
      if (step.name === "edit-up") await page.screenshot({ path: path.join(shots, "qa-op-sequence-edit-up.png") });
    }
    await page.mouse.up();
    await page.keyboard.up("Control");
    const editedAfter = await page.evaluate(() => ({ scene: window.qa.handles.p1.points, count: window.qa.document.physicalTopology.segments.find(s => s.id === "p1").path.points.length, commits: window.qa.events.filter(event => event.phase === "commit"), error: window.qa.error }));
    await page.screenshot({ path: path.join(shots, "qa-op-sequence-edited-after.png") });
    await page.getByRole("button", { name: "Save/load" }).click();
    const reloaded = await page.evaluate(() => ({ scene: window.qa.handles.p1.points, count: window.qa.document.physicalTopology.segments.find(s => s.id === "p1").path.points.length, handles: window.qa.handles.p1, error: window.qa.error }));
    await page.screenshot({ path: path.join(shots, "qa-op-sequence-reloaded.png") });
    const refreshedIndex = reloaded.handles.authoredHandleIndices.findIndex(value => value === savedPointIndex + 1);
    if (refreshedIndex < 0) throw new Error("Saved authored handle missing after load");
    const refreshed = reloaded.handles.handles[refreshedIndex];
    await page.keyboard.down("Control");
    await page.mouse.move(bounds.x + 210 + refreshed.x, bounds.y + 270 + refreshed.y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 210 + refreshed.x - 20, bounds.y + 270 + refreshed.y + 30, { steps: 8 });
    const loadedPreview = await page.evaluate(savedPointIndex => {
      const preview = window.qa.preview, pipe = window.qa.handles.p1;
      const edited = pipe.authoredHandleIndices.findIndex(value => value === savedPointIndex + 1);
      return { preview, scene: pipe.points, distance: edited < 0 ? Infinity : Math.hypot(pipe.handles[edited].x - preview.point.x, pipe.handles[edited].y - preview.point.y), error: window.qa.error };
    }, savedPointIndex);
    await page.screenshot({ path: path.join(shots, "qa-op-sequence-loaded-during.png") });
    await page.mouse.up();
    await page.keyboard.up("Control");
    const loadedAfter = await page.evaluate(() => ({ scene: window.qa.handles.p1.points, count: window.qa.document.physicalTopology.segments.find(s => s.id === "p1").path.points.length, commits: window.qa.events.filter(event => event.phase === "commit"), error: window.qa.error }));
    await page.screenshot({ path: path.join(shots, "qa-op-sequence-loaded-after.png") });
    const result = { start, beforeCount: before.count, afterCount: after.count, editedCount: editedAfter.count, reloadedCount: reloaded.count, loadedCount: loadedAfter.count, reloadSceneEqual: JSON.stringify(reloaded.scene) === JSON.stringify(editedAfter.scene), loadedPreviewEqualsCommit: JSON.stringify(loadedPreview.scene) === JSON.stringify(loadedAfter.scene), loadedDistance: loadedPreview.distance, loadedInsert: loadedPreview.preview?.insert, loadedScene: process.env.QA_VERBOSE ? loadedAfter.scene : undefined, readings: readings.map(({ points, ...reading }) => reading), editReadings: editReadings.map(({ scene, ...reading }) => reading), visibleChanged: readings.every(reading => JSON.stringify(reading.points) !== JSON.stringify(before.handles.points)), previewEqualsCommit: JSON.stringify(readings.at(-1).points) === JSON.stringify(after.handles.points), editPreviewEqualsCommit: JSON.stringify(editReadings.at(-1).scene) === JSON.stringify(editedAfter.scene), commits: loadedAfter.commits, errors: [...errors, after.error, editedAfter.error, reloaded.error, loadedPreview.error, loadedAfter.error].filter(Boolean) };
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length || !result.visibleChanged || !result.previewEqualsCommit || !result.editPreviewEqualsCommit || !result.loadedPreviewEqualsCommit || !result.reloadSceneEqual || result.loadedDistance > 1 || result.loadedInsert || result.commits.length !== 3 || result.afterCount !== result.beforeCount + 1 || result.editedCount !== result.afterCount || result.reloadedCount !== result.editedCount || result.loadedCount !== result.reloadedCount || result.readings.some(reading => reading.distance > 1) || result.editReadings.some(reading => reading.distance > 1 || reading.preview.insert)) process.exitCode = 1;
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
