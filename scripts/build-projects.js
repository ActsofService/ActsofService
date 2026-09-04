const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const projectsDir = path.join(__dirname, '../content/projects');
const outFile = path.join(__dirname, '../projects.json');

const files = fs.existsSync(projectsDir)
  ? fs.readdirSync(projectsDir).filter(f => f.endsWith('.md'))
  : [];

const projects = files.map(filename => {
  const raw = fs.readFileSync(path.join(projectsDir, filename), 'utf8');
  const { data, content } = matter(raw);
  return {
    title: data.title,
    descriptionEnglish: data.descriptionEnglish || data.description || '',
    descriptionSwedish: data.descriptionSwedish || '',
    image: data.image,
    gallery: data.gallery || [],
    date: data.date,
    commissioner: data.commissioner || '',
    category: data.category || '',
    link: data.link || null,
    body: content
  };
}).sort((a, b) => new Date(b.date) - new Date(a.date));

fs.writeFileSync(outFile, JSON.stringify(projects, null, 2));
console.log(`Wrote ${projects.length} projects to projects.json`);
