// Optional PNG export. SVG/HTML generation itself uses only Python's stdlib.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const names = fs.readdirSync(__dirname)
    .filter(name => /^(plate_\d\d|overview_48)\.svg$/.test(name)).sort();
  for (const name of names) {
    const source = path.join(__dirname, name);
    await sharp(fs.readFileSync(source), { density: 108 }).png()
      .toFile(source.replace(/\.svg$/, '.png'));
    process.stdout.write(`Rendered ${name}\n`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
