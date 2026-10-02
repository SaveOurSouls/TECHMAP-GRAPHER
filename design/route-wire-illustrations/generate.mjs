import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { artworkEnds, artworkViewBox, renderPartSvg, renderWireSvg } from "../../src/Techmap.Client/src/wire-blank-artwork.mjs";

// Artwork is defined once in wire-blank-artwork.mjs. The catalog and route
// render from those same parts; these files are portable assets for export.
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../src/Techmap.Client/public/route-wire-illustrations");
const partsOut = join(out, "parts");
mkdirSync(partsOut, { recursive: true });

const cases = [
  { id: "01-cut", title: "Провод нарезан", left: "cut", right: "cut" },
  { id: "02-strip-one", title: "Зачищен один конец · 5 мм", left: "copper", right: "cut" },
  { id: "02-strip-both", title: "Зачищены оба конца · 5 мм", left: "copper", right: "copper" },
  { id: "03-tin-one", title: "Лужён один конец, другой — медь · 5 мм", left: "tin", right: "copper" },
  { id: "03-tin-both", title: "Лужены оба конца · 5 мм", left: "tin", right: "tin" },
  { id: "04-crimp-copper", title: "Наконечник без уплотнителя + медь", left: "terminal", right: "copper" },
  { id: "04-crimp-tin", title: "Наконечник без уплотнителя + лужение", left: "terminal", right: "tin" },
  { id: "05-crimp-both", title: "Наконечники без уплотнителей с двух сторон", left: "terminal", right: "terminal" },
  { id: "06-seal-copper", title: "Наконечник с уплотнителем + медь", left: "sealed", right: "copper" },
  { id: "06-seal-tin", title: "Наконечник с уплотнителем + лужение", left: "sealed", right: "tin" },
  { id: "07-seal-terminal", title: "Уплотнённый и обычный наконечники", left: "sealed", right: "terminal" },
  { id: "08-seal-both-female", title: "Уплотнители с двух сторон · гнездовые контакты", left: "sealed", right: "sealed" },
  { id: "08-seal-both-mixed", title: "Уплотнители с двух сторон · гнездовой и штыревой контакты", left: "sealed", right: "sealed-pin" },
];

for (const item of cases) writeFileSync(join(out, `${item.id}.svg`), renderWireSvg(item), "utf8");
for (const part of ["body", ...artworkEnds]) writeFileSync(join(partsOut, `${part}.svg`), renderPartSvg(part), "utf8");
writeFileSync(join(out, "manifest.json"), JSON.stringify({
  schemaVersion: 2, viewBox: artworkViewBox.split(" ").map(Number),
  parts: { body: "parts/body.svg", ends: Object.fromEntries(artworkEnds.map(end => [end, `parts/${end}.svg`])), rightTransform: "translate(1200 0) scale(-1 1)" },
  entries: cases.map(({ id, title, left, right }) => ({ id, title, left, right, file: `${id}.svg` })),
}, null, 2) + "\n", "utf8");
console.log(`Generated ${cases.length} illustrations and ${artworkEnds.length + 1} shared parts in ${out}`);
