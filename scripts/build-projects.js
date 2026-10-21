const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const projectsDir = path.join(__dirname, '../content/projects');
const outFile = path.join(__dirname, '../projects.json');
const thumbsManifestFile = path.join(__dirname, '../images/thumbs/manifest.json');

// Thumbnails made by build-thumbnails.js, keyed by cover image or video path.
const thumbs = fs.existsSync(thumbsManifestFile)
  ? JSON.parse(fs.readFileSync(thumbsManifestFile, 'utf8'))
  : {};
const thumbnailFor = (src) => (typeof src === 'string' && src && thumbs[src.normalize('NFC')] || {}).thumbnail;

const files = fs.existsSync(projectsDir)
  ? fs.readdirSync(projectsDir).filter(f => f.endsWith('.md'))
  : [];

const projects = files.map(filename => {
  const raw = fs.readFileSync(path.join(projectsDir, filename), 'utf8');
  const { data, content } = matter(raw);
  // A Cover Video always wins; a Cover Image next to it is only its thumbnail.
  const coverMediaType = data.coverVideo ? 'video' : (data.coverMediaType || 'image');
  return {
    title: data.title,
    descriptionEnglish: data.descriptionEnglish || data.description || '',
    descriptionSwedish: data.descriptionSwedish || '',
    image: data.image,
    thumbnail: thumbnailFor(data.image) || thumbnailFor(data.coverVideo) || '',
    coverMediaType,
    coverVideo: data.coverVideo || '',
    gallery: data.gallery || [],
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

fs.writeFileSync(outFile, JSON.stringify(projects, null, 2));
console.log(`Wrote ${projects.length} projects to projects.json`);
