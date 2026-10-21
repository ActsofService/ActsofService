// Runs when the site is published (see .github/workflows/static.yml), after
// build-pages.js. Leaves out original uploads that the site no longer uses
// because a web version replaced them, so the published site stays well under
// GitHub Pages' 1 GB limit. Only the published copy is affected: the originals
// stay in the repo and in the CMS.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestFile = path.join(root, 'images/optimized/manifest.json');
if (!fs.existsSync(manifestFile)) process.exit(0);
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

// Everything the published site can refer to
const sources = ['projects.json', 'contact.json', 'index.html', 'foundry.html', '404.html']
  .filter(file => fs.existsSync(path.join(root, file)))
  .map(file => fs.readFileSync(path.join(root, file), 'utf8'));
const published = sources.join('\n').normalize('NFC');
const isReferenced = (src) => {
  const nfc = src.normalize('NFC');
  return [nfc, encodeURI(nfc), nfc.replace(/^\//, '')].some(form => published.includes(form));
};

let removed = 0, bytes = 0;
for (const [src, entry] of Object.entries(manifest)) {
  if (!entry.optimized || isReferenced(src)) continue;
  for (const form of ['NFC', 'NFD']) {
    const file = path.join(root, src.replace(/^\//, '').normalize(form));
    if (fs.existsSync(file)) {
      bytes += fs.statSync(file).size;
      fs.unlinkSync(file);
      removed++;
      break;
    }
  }
}
console.log(`Left out ${removed} originals replaced by web versions (${(bytes / 1e6).toFixed(0)} MB)`);
