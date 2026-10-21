const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const projectsDir = path.join(__dirname, '../content/projects');
const outFile = path.join(__dirname, '../projects.json');
const thumbsManifestFile = path.join(__dirname, '../images/thumbs/manifest.json');
const optimizedManifestFile = path.join(__dirname, '../images/optimized/manifest.json');

const readJson = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const lookup = (manifest, src) => typeof src === 'string' && src ? manifest[src.normalize('NFC')] || {} : {};

// Thumbnails made by build-thumbnails.js, keyed by cover image or video path.
const thumbs = readJson(thumbsManifestFile);
const thumbnailFor = (src) => lookup(thumbs, src).thumbnail;
const shareImageFor = (src) => lookup(thumbs, src).share;

// Web versions made by optimize-media.js. Unticking "Optimize" in the CMS
// keeps the original file.
const optimized = readJson(optimizedManifestFile);
const optimizeOn = (value) => value !== false && value !== 'false';
const webVersion = (src, optimize) => (optimizeOn(optimize) && lookup(optimized, src).optimized) || src;
// Image sizes, keyed by the path the site uses, so it can reserve the space.
const sizesFor = (data) => {
  const sizes = {};
  const add = (src, optimize) => {
    const size = lookup(optimized, src).size;
    if (size) sizes[webVersion(src, optimize)] = size;
  };
  add(data.image, data.optimizeCover);
  for (const item of data.gallery || []) {
    if (item && typeof item === 'object') ['image', 'gif', 'poster'].forEach(f => add(item[f], item.optimize));
    else if (typeof item === 'string') add(item, true);
  }
  return sizes;
};

// The project's address: "Trubadur av rätta ullen" -> actsofservice.se/trubadur-av-ratta-ullen/
const reservedSlugs = new Set(['admin', 'content', 'fonts', 'images', 'scripts', 'foundry', 'index', '404', 'projects']);
const slugify = (title) => String(title || 'project')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

// A short plain-text summary for link previews and search engines.
const summary = (markdown) => {
  const text = String(markdown || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|\*|\+\+|~~)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 160 ? text.slice(0, 157).replace(/\s+\S*$/, '') + '…' : text;
};

const files = fs.existsSync(projectsDir)
  ? fs.readdirSync(projectsDir).filter(f => f.endsWith('.md'))
  : [];

const projects = files.map(filename => {
  const raw = fs.readFileSync(path.join(projectsDir, filename), 'utf8');
  const { data, content } = matter(raw);
  // A Cover Video always wins; a Cover Image next to it is only its thumbnail.
  const coverMediaType = data.coverVideo ? 'video' : (data.coverMediaType || 'image');
  const gallery = (data.gallery || []).map(item => {
    if (!item || typeof item !== 'object') return typeof item === 'string' ? webVersion(item, true) : item;
    const copy = { ...item };
    for (const field of ['image', 'gif', 'video', 'poster']) {
      if (copy[field]) copy[field] = webVersion(copy[field], item.optimize);
    }
    return copy;
  });
  return {
    title: data.title,
    descriptionEnglish: data.descriptionEnglish || data.description || '',
    descriptionSwedish: data.descriptionSwedish || '',
    summary: summary(data.descriptionEnglish || data.description || data.descriptionSwedish),
    image: webVersion(data.image, data.optimizeCover),
    thumbnail: thumbnailFor(data.image) || thumbnailFor(data.coverVideo) || '',
    shareImage: shareImageFor(data.image) || shareImageFor(data.coverVideo) || '',
    coverMediaType,
    coverVideo: webVersion(data.coverVideo || '', data.optimizeCover),
    gallery,
    sizes: sizesFor(data),
    date: data.date,
    commissioner: data.commissioner || '',
    category: Array.isArray(data.category)
      ? data.category
      : data.category
        ? [data.category]
        : [],
    favorite: data.favorite === true || data.favorite === 'true',
    link: data.link || null,
    body: content
  };
}).sort((a, b) => new Date(b.date) - new Date(a.date));

// Give every project a unique address
const usedSlugs = new Set(reservedSlugs);
projects.forEach(project => {
  const base = slugify(project.title);
  let slug = reservedSlugs.has(base) ? `${base}-project` : base;
  for (let n = 2; usedSlugs.has(slug); n++) slug = `${base}-${n}`;
  usedSlugs.add(slug);
  project.slug = slug;
});

fs.writeFileSync(outFile, JSON.stringify(projects, null, 2));
console.log(`Wrote ${projects.length} projects to projects.json`);
