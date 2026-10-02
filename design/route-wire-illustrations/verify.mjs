import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { artworkEnds, renderPartSvg, renderWireSvg } from "../../src/Techmap.Client/src/wire-blank-artwork.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../src/Techmap.Client/public/route-wire-illustrations");
const normalized = value => value.replaceAll("\r\n", "\n");
const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
assert.equal(manifest.schemaVersion, 2);
assert.equal(manifest.entries.length, 13);
assert.deepEqual(Object.keys(manifest.parts.ends), artworkEnds);
assert.equal(manifest.parts.rightTransform, "translate(1200 0) scale(-1 1)");
for (const entry of manifest.entries) {
  assert.equal(normalized(readFileSync(join(out, entry.file), "utf8")), renderWireSvg(entry), entry.file);
}
for (const part of ["body", ...artworkEnds]) {
  const file = part === "body" ? manifest.parts.body : manifest.parts.ends[part];
  assert.equal(normalized(readFileSync(join(out, file), "utf8")), renderPartSvg(part), file);
}
assert.equal(readdirSync(out).filter(name => name.endsWith(".svg")).length, 13);
assert.equal(readdirSync(join(out, "parts")).filter(name => name.endsWith(".svg")).length, 7);
const cut = readFileSync(join(out, "01-cut.svg"), "utf8");
assert.match(cut, /M220 94V146/);
assert.doesNotMatch(cut, /Q213 101/);
console.log("Verified 13 illustrations, 7 composable parts, and square cut edges.");
