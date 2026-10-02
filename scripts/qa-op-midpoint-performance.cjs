const { chromium } = require(process.env.PLAYWRIGHT_PATH);

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.QA_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto("http://127.0.0.1:5183/qa-op-midpoint.html", { waitUntil: "load" });
    await page.locator("canvas.he-canvas").waitFor();
    const data = await page.evaluate(async () => {
      const { resolvePhysicalRoutePointCommand, applyEditorCommand, physicalTopologyScene } = window.qaPerformance;
      const original = window.qa.document;
      const midpoint = window.qa.handles.p1.midpoints.find(item => item.index === 8);
      const target = { x: midpoint.point.x - 32, y: midpoint.point.y + 72 };
      const measure = (document, label) => {
        const values = [];
        for (let i = 0; i < 110; i++) {
          const begin = performance.now();
          const command = resolvePhysicalRoutePointCommand(document, "p1", 8, target, "carry", true);
          if (!command) throw new Error("Resolver returned null");
          const preview = applyEditorCommand(document, command);
          const scene = physicalTopologyScene(preview);
          if (!scene.some(item => item.id === "p1")) throw new Error("Preview scene missing p1");
          values.push(performance.now() - begin);
        }
        const samples = values.slice(10).sort((a, b) => a - b);
        return { label, samples: samples.length, medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * .95)], maxMs: samples.at(-1) };
      };
      const large = { ...original, physicalTopology: { ...original.physicalTopology,
        nodes: [...original.physicalTopology.nodes],
        segments: [...original.physicalTopology.segments],
        joiningPipes: [...original.physicalTopology.joiningPipes],
        coverings: [...original.physicalTopology.coverings],
      } };
      for (let n = 1; n <= 20; n++) {
        const delta = { x: 700 * n, y: 0 };
        const suffix = `copy${n}`;
        large.physicalTopology.nodes.push(...original.physicalTopology.nodes.map(node => ({ ...node, id: `${node.id}-${suffix}`, position: { x: node.position.x + delta.x, y: node.position.y } })));
        large.physicalTopology.segments.push(...original.physicalTopology.segments.map(segment => ({ ...segment, id: `${segment.id}-${suffix}`, from: `${segment.from}-${suffix}`, to: `${segment.to}-${suffix}`, path: { ...segment.path, points: segment.path.points.map(point => ({ x: point.x + delta.x, y: point.y })) } })));
        large.physicalTopology.joiningPipes.push(...original.physicalTopology.joiningPipes.map(pipe => ({ ...pipe, id: `${pipe.id}-${suffix}`, start: { x: pipe.start.x + delta.x, y: pipe.start.y }, end: { x: pipe.end.x + delta.x, y: pipe.end.y }, members: pipe.members.map(member => ({ ...member, segmentIds: member.segmentIds.map(id => `${id}-${suffix}`) })) })));
      }
      return { synthetic: measure(original, "2 segments, 1 OP"), duplicated: measure(large, "42 segments, 21 OP"), browser: navigator.userAgent };
    });
    console.log(JSON.stringify(data, null, 2));
  } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
