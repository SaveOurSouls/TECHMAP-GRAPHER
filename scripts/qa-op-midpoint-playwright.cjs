const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const path = require("node:path");

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.goto("http://127.0.0.1:5183/qa-op-midpoint.html", { waitUntil: "load", timeout: 15000 });
  await page.locator("canvas.he-canvas").waitFor();
  const dir = process.env.QA_SHOTS || process.env.TEMP;
  const before = path.join(dir, "qa-op-midpoint-before.png");
  await page.screenshot({ path: before });
  const first = await page.evaluate(() => ({ title: document.title, handles: window.qa.handles, canvas: document.querySelector("canvas.he-canvas").getBoundingClientRect().toJSON() }));
  const scenarios = [
    { name: "free", keys: [] },
    { name: "ctrl", keys: ["Control"] },
    { name: "ctrl-shift", keys: ["Control", "Shift"] },
  ];
  const index = Number(process.env.QA_INDEX || 8);
  const kind = process.env.QA_KIND || "midpoint";
  const results = [];
  for (const scenario of scenarios) {
    await page.getByRole("button", { name: "Reset" }).click();
    const handle = await page.evaluate(({ index, kind }) => {
      const pipe = window.qa.handles.p1;
      const points = kind === "corner" ? pipe.handles.map((point, index) => ({ point, index })) : pipe.midpoints;
      const candidate = points.find(p => p.index === index);
      if (!candidate) throw new Error(`${kind} ${index} unavailable; available: ${points.map(p => p.index).join(",")}`);
      return { candidate, points };
    }, { index, kind });
    const bounds = await page.locator("canvas.he-canvas").boundingBox();
    const start = { x: bounds.x + 210 + handle.candidate.point.x, y: bounds.y + 270 + handle.candidate.point.y };
    const target = { x: start.x - 32, y: start.y + 72 };
    for (const key of scenario.keys) await page.keyboard.down(key);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.screenshot({ path: path.join(dir, `qa-op-${kind}-${index}-${scenario.name}-during.png`) });
    const during = await page.evaluate(() => ({ preview: window.qa.preview, command: window.qa.previewCommand, error: window.qa.error, handles: window.qa.handles.p1, guide: document.querySelector('[aria-label="Привязка трассы"]')?.outerHTML ?? null }));
    await page.mouse.up();
    for (const key of [...scenario.keys].reverse()) await page.keyboard.up(key);
    await page.screenshot({ path: path.join(dir, `qa-op-${kind}-${index}-${scenario.name}-after.png`) });
    const after = await page.evaluate(() => ({ error: window.qa.error, events: window.qa.events.slice(-3), handles: window.qa.handles.p1, storedPoints: window.qa.document.physicalTopology.segments.find(s => s.id === "p1").path.points }));
    results.push({ name: scenario.name, handle: handle.candidate, start, target, during, after });
  }
  const checks = results.map(result => ({
    name: result.name,
    changed: JSON.stringify(result.during.handles.points) !== JSON.stringify(first.handles.p1.points),
    previewEqualsCommit: JSON.stringify(result.during.handles.points) === JSON.stringify(result.after.handles.points),
    commits: result.after.events.filter(event => event.phase === "commit").length,
    error: result.after.error,
    storedPointCount: result.after.storedPoints.length,
    insert: result.during.preview?.insert,
    targetToEditedHandle: result.during.preview?.point && result.during.command ? (() => {
      const pipe = result.during.handles;
      if (result.during.command.type !== "edit-physical-bend") return null;
      const authoredValue = result.during.command.index + 1;
      const edited = pipe.authoredHandleIndices.findIndex(value => value === authoredValue);
      const handle = edited >= 0 ? pipe.handles[edited] : null;
      return handle ? Math.hypot(handle.x - result.during.preview.point.x, handle.y - result.during.preview.point.y) : null;
    })() : null,
    actualShoulderAngles: result.during.command?.type === "edit-physical-bend" ? (() => {
      const pipe = result.during.handles;
      const edited = pipe.authoredHandleIndices.findIndex(value => value === result.during.command.index + 1);
      if (edited < 0) return null;
      const route = [pipe.points[0], ...pipe.handles, pipe.points.at(-1)];
      const at = edited + 1;
      const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      return { incoming: angle(route[at - 1], route[at]), outgoing: angle(route[at], route[at + 1]) };
    })() : null,
    angularGuideMatch: result.name === "free" ? null : (() => {
      const pipe = result.during.handles;
      const command = result.during.command;
      if (command?.type !== "edit-physical-bend") return null;
      const edited = pipe.authoredHandleIndices.findIndex(value => value === command.index + 1);
      if (edited < 0) return null;
      const route = [pipe.points[0], ...pipe.handles, pipe.points.at(-1)];
      const region = pipe.authoredHandleRegions?.[edited];
      let firstHandle = edited, lastHandle = edited;
      if (command.mode === "carry" && region) {
        while (firstHandle > 0 && pipe.authoredHandleIndices[firstHandle - 1] > 0 && pipe.authoredHandleRegions[firstHandle - 1] === region) firstHandle--;
        while (lastHandle + 1 < pipe.handles.length && pipe.authoredHandleIndices[lastHandle + 1] > 0 && pipe.authoredHandleRegions[lastHandle + 1] === region) lastHandle++;
      }
      const first = firstHandle + 1, last = lastHandle + 1;
      const actual = [Math.atan2(route[first].y - route[first - 1].y, route[first].x - route[first - 1].x), Math.atan2(route[last + 1].y - route[last].y, route[last + 1].x - route[last].x)].map(angle => angle * 180 / Math.PI);
      const serialized = result.during.guide?.match(/points="([^"]+)"/)?.[1];
      if (!serialized) return null;
      const guide = serialized.split(" ").map(item => { const [x, y] = item.split(",").map(Number); return { x: x - 210, y: y - 270 }; });
      if (guide.length < 2) return null;
      const direction = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      const rays = guide.length === 2 ? [direction(guide[0], guide[1])] : [direction(guide[0], guide[1]), direction(guide[1], guide[2])];
      const gridResiduals = rays.map(angle => Math.abs(angle / 30 - Math.round(angle / 30)) * 30);
      const angularDistance = (a, b) => {
        const residual = Math.abs(((a - b + 540) % 360) - 180);
        return Math.min(residual, Math.abs(180 - residual));
      };
      const matches = rays.length === 2
        ? [angularDistance(rays[0], actual[0]), angularDistance(rays[1], actual[1])]
        : [Math.min(...actual.map(shoulder => angularDistance(rays[0], shoulder)))];
      return { actual, rays, gridResiduals, matches };
    })(),
  }));
  console.log(JSON.stringify({ title: first.title, before, kind, index, checks, errors, results: process.env.QA_VERBOSE ? results : undefined }, null, 2));
  if (errors.length || checks.some(check => !check.changed || !check.previewEqualsCommit || check.commits !== 1 || check.error || check.targetToEditedHandle === null || check.targetToEditedHandle > 1 || check.insert !== (kind === "midpoint") || check.storedPointCount !== (kind === "midpoint" ? 3 : 2) || check.name !== "free" && (check.angularGuideMatch === null || check.angularGuideMatch.gridResiduals.some(residual => residual > 1) || check.angularGuideMatch.matches.some(residual => residual > 1)))) process.exitCode = 1;
  await browser.close();
}
run().catch(error => { console.error(error); process.exitCode = 1; });
