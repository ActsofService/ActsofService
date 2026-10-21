// Runs when the site is published (see .github/workflows/static.yml).
// Makes a page for every project, e.g. /helvete/index.html, so each project
// has its own address. The page is a copy of index.html with the project's
// own title, description and share image; the site's script then opens the
// project. Also writes sitemap.xml for search engines.
// The pages are only made for publishing and are not saved in the repo.

const fs = require('fs');
const path = require('path');

const SITE = 'https://actsofservice.se';
const root = path.join(__dirname, '..');
const projects = JSON.parse(fs.readFileSync(path.join(root, 'projects.json'), 'utf8'));
const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const escapeAttr = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Replaces one tag's value in the template, and fails loudly if the tag is gone.
const setValue = (html, pattern, value) => {
  if (!pattern.test(html)) throw new Error(`index.html no longer has ${pattern}`);
  return html.replace(pattern, (match, before, after) => `${before}${escapeAttr(value)}${after}`);
};

const urls = [`${SITE}/`];

for (const project of projects) {
  if (!project.slug) continue;
  const url = `${SITE}/${project.slug}/`;
  const title = `${project.title} – Acts of Service`;
  const description = project.summary || `${project.title} by Acts of Service.`;
  const image = project.shareImage ? `${SITE}${project.shareImage}` : `${SITE}/images/share.png`;

  let html = template;
  html = setValue(html, /(<title>)[^<]*(<\/title>)/, title);
  html = setValue(html, /(<meta name="description" content=")[^"]*(">)/, description);
  html = setValue(html, /(<link rel="canonical" href=")[^"]*(">)/, url);
  html = setValue(html, /(<meta property="og:title" content=")[^"]*(">)/, title);
  html = setValue(html, /(<meta property="og:description" content=")[^"]*(">)/, description);
  html = setValue(html, /(<meta property="og:url" content=")[^"]*(">)/, url);
  html = setValue(html, /(<meta property="og:image" content=")[^"]*(">)/, image);

  const dir = path.join(root, project.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  urls.push(url);
}

fs.writeFileSync(path.join(root, 'sitemap.xml'), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(url => `  <url><loc>${url}</loc></url>`),
  '</urlset>',
  ''
].join('\n'));

console.log(`Made ${urls.length - 1} project pages and sitemap.xml`);
