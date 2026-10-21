// Makes a small WebP thumbnail for every project's cover, so the site can show
// it first and swap in the full image or video once that has loaded.
// Made from the Cover Image, or from the first frame of the Cover Video when
// there is no Cover Image.
// Thumbnails go in images/thumbs/ and build-projects.js adds them to projects.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const matter = require('gray-matter');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');

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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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

// First frame of a video as a PNG, the same frame the video starts on.
const firstFrame = (videoFile) => execFileSync(ffmpegPath, [
  '-v', 'error', '-i', videoFile, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'
], { maxBuffer: 256 * 1024 * 1024 });

const isLocal = (src) => typeof src === 'string' && src !== '' && !/^(https?:|data:)/.test(src);

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
    // The Cover Image if there is one, otherwise the Cover Video.
    const source = isLocal(data.image) ? data.image : isLocal(data.coverVideo) ? data.coverVideo : null;
    if (!source) continue;
    const fromVideo = source === data.coverVideo;

    const file = findFile(source);
    if (!file) {
      console.warn(`! ${filename}: cover ${fromVideo ? 'video' : 'image'} not found (${source})`);
      continue;
    }

    const key = source.normalize('NFC');
    const name = thumbName(source);
    const output = path.join(thumbsDir, name);
    const sourceHash = crypto.createHash('sha1').update(fs.readFileSync(file)).update(settings).digest('hex');

    // Skip covers that haven't changed since last time.
    if (manifest[key] && manifest[key].hash === sourceHash && fs.existsSync(output)) {
      nextManifest[key] = manifest[key];
      continue;
    }

    let input = file;
    if (fromVideo) {
      try {
        input = firstFrame(file);
      } catch (error) {
        console.warn(`! ${filename}: could not read a frame from ${source}`);
        continue;
      }
    }

    const buffer = await makeThumbnail(input);
    fs.writeFileSync(output, buffer);
    const { width, height } = await sharp(buffer).metadata();
    nextManifest[key] = { thumbnail: `/images/thumbs/${name}`, hash: sourceHash };
    console.log(`✓ ${filename}${fromVideo ? ' (video frame)' : ''}: ${width}×${height}, ${(buffer.length / 1024).toFixed(1)} KB`);
  }

  // Remove thumbnails whose cover is no longer used.
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
