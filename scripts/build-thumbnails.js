// Makes a small WebP thumbnail of every project's Cover Image, so the site can
// show it first and swap in the full image once that has loaded.
// Thumbnails go in images/thumbs/ and build-projects.js adds them to projects.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const matter = require('gray-matter');
const sharp = require('sharp');

// Each thumbnail aims for TARGET_KB and is never bigger than MAX_KB.
const TARGET_KB = 15;
const MAX_KB = 50;
// Tried from largest to smallest; the largest width that still looks okay wins.
const WIDTHS = [1200, 1000, 800, 640, 480, 400, 320];
// Below this quality the image looks blocky, so a smaller width is used instead.
const MIN_QUALITY = 30;
const MAX_QUALITY = 80;

const root = path.join(__dirname, '..');
const projectsDir = path.join(root, 'content/projects');
const thumbsDir = path.join(root, 'images/thumbs');
const manifestFile = path.join(thumbsDir, 'manifest.json');

// Files with å/ä/ö can be stored in two different Unicode forms, so try both.
const findFile = (publicPath) => {
  const relative = publicPath.replace(/^\//, '');
  for (const form of ['NFC', 'NFD']) {
    const candidate = path.join(root, relative.normalize(form));
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

// "/images/uploads/grön bild.JPG" -> "gron-bild-1a2b3c4d.webp"
const thumbName = (publicPath) => {
  const base = path.basename(publicPath, path.extname(publicPath))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
  const hash = crypto.createHash('sha1').update(publicPath.normalize('NFC')).digest('hex').slice(0, 8);
  return `${base}-${hash}.webp`;
};

// Resized lossless copy, so each quality attempt doesn't have to reopen the full image.
const resize = (input, width) => sharp(input) // GIFs: uses the first frame
  .rotate() // respect the camera's orientation
  .resize({ width, withoutEnlargement: true })
  .toColourspace('srgb')
  .png({ compressionLevel: 0 })
  .toBuffer();

const encode = (resized, quality) => sharp(resized)
  .webp({ quality, effort: 6 })
  .toBuffer();

// Highest quality at this width that stays within maxBytes, or null.
const bestAtWidth = async (input, width, maxBytes) => {
  const pixels = await resize(input, width);
  let low = MIN_QUALITY, high = MAX_QUALITY, best = null;
  while (low <= high) {
    const quality = Math.round((low + high) / 2);
    const buffer = await encode(pixels, quality);
    if (buffer.length <= maxBytes) {
      best = buffer;
      low = quality + 1;
    } else {
      high = quality - 1;
    }
  }
  return best;
};

const makeThumbnail = async (input) => {
  const { width: sourceWidth } = await sharp(input).metadata();
  const widths = [...new Set(WIDTHS.map(w => Math.min(w, sourceWidth)))];
  for (const width of widths) {
    const buffer = await bestAtWidth(input, width, TARGET_KB * 1024);
    if (buffer) return buffer;
  }
  // Even the smallest width is over the target: accept up to MAX_KB.
  const smallest = widths[widths.length - 1];
  const fallback = await bestAtWidth(input, smallest, MAX_KB * 1024);
  return fallback || encode(await resize(input, smallest), MIN_QUALITY);
};

const main = async () => {
  fs.mkdirSync(thumbsDir, { recursive: true });
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  const nextManifest = {};
  const settings = JSON.stringify({ TARGET_KB, MAX_KB, WIDTHS, MIN_QUALITY, MAX_QUALITY });

  const files = fs.readdirSync(projectsDir).filter(f => f.endsWith('.md'));
  for (const filename of files) {
    const { data } = matter(fs.readFileSync(path.join(projectsDir, filename), 'utf8'));
    const image = data.image;
    if (!image || /^(https?:|data:)/.test(image)) continue;

    const input = findFile(image);
    if (!input) {
      console.warn(`! ${filename}: cover image not found (${image})`);
      continue;
    }

    const key = image.normalize('NFC');
    const name = thumbName(image);
    const output = path.join(thumbsDir, name);
    const sourceHash = crypto.createHash('sha1').update(fs.readFileSync(input)).update(settings).digest('hex');

    // Skip images that haven't changed since last time.
    if (manifest[key] && manifest[key].hash === sourceHash && fs.existsSync(output)) {
      nextManifest[key] = manifest[key];
      continue;
    }

    const buffer = await makeThumbnail(input);
    fs.writeFileSync(output, buffer);
    const { width, height } = await sharp(buffer).metadata();
    nextManifest[key] = { thumbnail: `/images/thumbs/${name}`, hash: sourceHash };
    console.log(`✓ ${filename}: ${width}×${height}, ${(buffer.length / 1024).toFixed(1)} KB`);
  }

  // Remove thumbnails whose cover image is no longer used.
  const keep = new Set(Object.values(nextManifest).map(entry => path.basename(entry.thumbnail)));
  for (const file of fs.readdirSync(thumbsDir)) {
    if (file.endsWith('.webp') && !keep.has(file)) fs.unlinkSync(path.join(thumbsDir, file));
  }

  fs.writeFileSync(manifestFile, JSON.stringify(nextManifest, null, 2) + '\n');
  console.log(`${Object.keys(nextManifest).length} thumbnails in images/thumbs`);
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
