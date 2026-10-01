import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// Stable, self-contained technical illustrations. The drawn 5 mm strip is
// symbolic: physical dimensions and terminal selection come from route data.
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../src/Techmap.Client/public/route-wire-illustrations");
mkdirSync(out, { recursive: true });

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

const defs = `<defs>
  <linearGradient id="jacket" x2="0" y2="1"><stop stop-color="#264b82"/><stop offset=".18" stop-color="#5386c3"/><stop offset=".44" stop-color="#26609e"/><stop offset=".76" stop-color="#174574"/><stop offset="1" stop-color="#102f51"/></linearGradient>
  <linearGradient id="metal" x2="0" y2="1"><stop stop-color="#e9eff2"/><stop offset=".24" stop-color="#aebfc8"/><stop offset=".47" stop-color="#f7fafb"/><stop offset=".72" stop-color="#8d9ca5"/><stop offset="1" stop-color="#657783"/></linearGradient>
  <linearGradient id="copper" x2="0" y2="1"><stop stop-color="#e7ab73"/><stop offset=".48" stop-color="#b76739"/><stop offset="1" stop-color="#814529"/></linearGradient>
  <linearGradient id="tin" x2="0" y2="1"><stop stop-color="#f7faf9"/><stop offset=".5" stop-color="#b7c4c7"/><stop offset="1" stop-color="#738b92"/></linearGradient>
  <linearGradient id="seal" x2="0" y2="1"><stop stop-color="#a6c7a4"/><stop offset=".45" stop-color="#648e75"/><stop offset="1" stop-color="#355b53"/></linearGradient>
  <clipPath id="wire"><rect x="220" y="96" width="760" height="48" rx="17"/></clipPath>
</defs>`;

const jacket = `<rect x="220" y="96" width="760" height="48" rx="17" fill="url(#jacket)" stroke="#25445f" stroke-width="2.5"/>
  <path d="M235 102H965" stroke="#b5d0ea" stroke-width="3" opacity=".5" clip-path="url(#wire)"/>
  <path d="M237 138H963" stroke="#092b51" stroke-width="3" opacity=".55" clip-path="url(#wire)"/>`;

function strands(tinned = false) {
  const fill = tinned ? "url(#tin)" : "url(#copper)";
  const stroke = tinned ? "#7b929a" : "#8b4d2e";
  return `<path d="M146 105 Q144 120 146 135 L220 135 L220 105 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>
    ${Array.from({length: 9}, (_, i) => { const y = 107 + i * 3.2; return `<path d="M148 ${y.toFixed(1)} Q180 ${(y + (i % 2 ? 1.4 : -1)).toFixed(1)} 218 ${y.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="1.3" opacity=".82"/>`; }).join("")}
    <path d="M221 98V142" stroke="#153c67" stroke-width="3"/>
    <path d="M146 105V135" stroke="${stroke}" stroke-width="1.8"/>`;
}

function cut() {
  return `<path d="M220 101 Q213 101 213 108V132Q213 139 220 139" fill="#163d68" stroke="#183a5d" stroke-width="2"/>
    <path d="M214 110V130" stroke="#6887aa" stroke-width="2" opacity=".65"/>`;
}

function terminal({ sealed = false, pin = false } = {}) {
  const seal = sealed ? `<path d="M222 98 Q229 87 241 88H280Q293 88 300 98V143Q293 153 280 153H241Q229 152 222 142Z" fill="url(#seal)" stroke="#315748" stroke-width="2.4"/>
    <path d="M239 89V152M252 88V153M265 88V153M279 89V152" stroke="#d0e0c6" stroke-width="5" opacity=".75"/>
    <path d="M242 90V151M255 89V152M268 89V152M282 90V151" stroke="#3e6857" stroke-width="2" opacity=".65"/>` : "";
  const contact = pin
    ? `<path d="M40 111H84L98 105H139V135H98L84 129H40Z" fill="url(#metal)" stroke="#4c626b" stroke-width="2.5"/>
       <path d="M44 118H93" stroke="#fff" stroke-width="2" opacity=".75"/>`
    : `<path d="M47 96H136V144H47Q39 144 39 136V104Q39 96 47 96Z" fill="url(#metal)" stroke="#4c626b" stroke-width="2.5"/>
       <path d="M47 104H112V136H47Z" fill="#4b626f" stroke="#213a48" stroke-width="2"/>
       <path d="M53 109H106V131H53Z" fill="#d5e0e3" opacity=".87"/>
       <path d="M80 104V136M93 104V136" stroke="#72848c" stroke-width="2"/>
       <path d="M118 93L129 85L134 97" fill="url(#metal)" stroke="#4c626b" stroke-width="1.5"/>`;
  return `${seal}
    <path d="M177 108L219 108V132H177Z" fill="url(#copper)" stroke="#8b4d2e" stroke-width="1.5"/>
    ${Array.from({length: 7}, (_, i) => `<path d="M179 ${111 + i * 3}H218" stroke="#87492a" stroke-width="1" opacity=".8"/>`).join("")}
    <path d="M139 101H165L177 107V133L165 139H139Z" fill="url(#metal)" stroke="#536671" stroke-width="2"/>
    ${contact}
    <path d="M139 100H154L166 106L170 113L161 117L149 111H139M139 140H154L166 134L170 127L161 123L149 129H139" fill="url(#metal)" stroke="#536671" stroke-width="2"/>
    <path d="M168 103H207L218 109V131L207 137H168L177 130V110Z" fill="url(#metal)" stroke="#526771" stroke-width="2.2"/>
    <path d="M181 104V136M193 103V137M204 105V135" stroke="#6f838d" stroke-width="2.2"/>
    <path d="M205 101Q224 90 239 96L245 104L236 112L221 107L211 111M205 139Q224 150 239 144L245 136L236 128L221 133L211 129" fill="url(#metal)" stroke="#4d626e" stroke-width="2"/>
    <path d="M219 108Q228 113 239 108M219 132Q228 127 239 132" fill="none" stroke="#556a72" stroke-width="2"/>
    <path d="M125 98H136M125 142H136" stroke="#6d8088" stroke-width="2"/>`;
}

function endpoint(type) {
  switch (type) {
    case "cut": return cut();
    case "copper": return strands();
    case "tin": return strands(true);
    case "terminal": return terminal();
    case "sealed": return terminal({sealed:true});
    case "sealed-pin": return terminal({sealed:true,pin:true});
    default: throw Error(`Unknown endpoint ${type}`);
  }
}

function svg(item) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="240" viewBox="0 0 1200 240" role="img" aria-labelledby="title desc">
  <title id="title">${item.title}</title><desc id="desc">Схематичный вид провода с технологической обработкой концов. Цвет изоляции условный.</desc>
  ${defs}
  ${jacket}
  <g>${endpoint(item.left)}</g>
  <g transform="translate(1200 0) scale(-1 1)">${endpoint(item.right)}</g>
</svg>\n`;
}

for (const item of cases) writeFileSync(join(out, `${item.id}.svg`), svg(item), "utf8");
writeFileSync(join(out, "manifest.json"), JSON.stringify({ schemaVersion: 1, viewBox: [0, 0, 1200, 240], entries: cases.map(({id,title,left,right}) => ({id,title,left,right,file:`${id}.svg`})) }, null, 2) + "\n", "utf8");
console.log(`Generated ${cases.length} illustrations in ${out}`);
