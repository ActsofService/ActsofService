// Makes lighter web versions of the images and videos used by the projects,
// so the site loads fast without visibly losing quality. The originals in
// images/uploads are never changed; the web versions go in images/optimized/
// and build-projects.js points projects.json at them.
// A media item is skipped when its "Optimize" checkbox in the CMS is unticked.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const matter = require('gray-matter');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');

// Images: WebP, at most this many pixels on the longest side
// (enough for a sharp full-screen image on a retina screen).
const MAX_IMAGE_SIZE = 2400;
const PHOTO_QUALITY = 85;    // JPG sources
const GRAPHIC_QUALITY = 90;  // PNG sources: often flat colors and text
// GIFs: animated WebP
const MAX_GIF_SIZE = 1600;
const GIF_QUALITY = 85;
// Videos: H.264 MP4, plays everywhere. Lower CRF = better quality and bigger
// files; 20 looks the same as the original for these kinds of videos.
const MAX_VIDEO_SIZE = 1920;
const VIDEO_CRF = 20;
// Only use a web version when it's at least this much smaller than the original.
const MIN_SAVING = 0.10;

const root = path.join(__dirname, '..');
const projectsDir = path.join(root, 'content/projects');
const outDir = path.join(root, 'images/optimized');
const manifestFile = path.join(outDir, 'manifest.json');

// Files with å/ä/ö can be stored in two different Unicode forms, so try both.
const findFile = (publicPath) => {
  const relative = publicPath.replace(/^\//, '');
  for (const form of ['NFC', 'NFD']) {
    const candidate = path.join(root, relative.normalize(form));
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

// "/images/uploads/grön bild.JPG" -> "gron-bild-1a2b3c4d"
const outputBase = (publicPath) => {
  const base = path.basename(publicPath, path.extname(publicPath))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'media';
  const hash = crypto.createHash('sha1').update(publicPath.normalize('NFC')).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
};

const isLocal = (src) => typeof src === 'string' && src !== '' && !/^(https?:|data:)/.test(src);
const optimizeOn = (value) => value !== false && value !== 'false';

// Every media file used by a project, and whether it's only used as a silent loop.
const collectMedia = () => {
  const media = new Map();
  const use = (src, { optimize, silent }) => {
    if (!isLocal(src) || !optimizeOn(optimize)) return;
    const key = src.normalize('NFC');
    const entry = media.get(key) || { src, silent: true };
    entry.silent = entry.silent && silent;
    media.set(key, entry);
  };
  for (const filename of fs.readdirSync(projectsDir).filter(f => f.endsWith('.md'))) {
    const { data } = matter(fs.readFileSync(path.join(projectsDir, filename), 'utf8'));
    use(data.image, { optimize: data.optimizeCover, silent: true });
    use(data.coverVideo, { optimize: data.optimizeCover, silent: true });
    for (const item of data.gallery || []) {
      if (!item || typeof item !== 'object') continue;
      const silent = (item.mediaType || '').toLowerCase() === 'looping video';
      for (const field of ['image', 'gif', 'poster']) use(item[field], { optimize: item.optimize, silent: true });
      use(item.video, { optimize: item.optimize, silent });
    }
  }
  return media;
};

const optimizeImage = async (file, out) => {
  const isPng = path.extname(file).toLowerCase() === '.png';
  await sharp(file, { limitInputPixels: false })
    .rotate() // respect the camera's orientation
    .resize({ width: MAX_IMAGE_SIZE, height: MAX_IMAGE_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: isPng ? GRAPHIC_QUALITY : PHOTO_QUALITY, smartSubsample: true, effort: 5 })
    .toFile(out);
};

const optimizeGif = async (file, out) => {
  await sharp(file, { animated: true, limitInputPixels: false })
    .resize({ width: MAX_GIF_SIZE, height: MAX_GIF_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: GIF_QUALITY, effort: 4 })
    .toFile(out);
};

const optimizeVideo = (file, out, silent) => {
  const fit = `scale='if(gte(iw,ih),min(${MAX_VIDEO_SIZE},iw),-2)':'if(gte(iw,ih),-2,min(${MAX_VIDEO_SIZE},ih))'`;
  execFileSync(ffmpegPath, [
    '-v', 'error', '-y', '-i', file,
    '-vf', fit,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(VIDEO_CRF), '-pix_fmt', 'yuv420p',
    ...(silent ? ['-an'] : ['-c:a', 'aac', '-b:a', '160k']),
    '-movflags', '+faststart', // starts playing before the whole file has loaded
    out
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
};

// Width and height of an image, so the site can reserve its space before it loads.
const imageSize = async (file) => {
  const meta = await sharp(file, { limitInputPixels: false }).metadata();
  const height = meta.pageHeight || meta.height;
  return meta.orientation >= 5 ? [height, meta.width] : [meta.width, height];
};

const kindOf = (src) => {
  const ext = path.extname(src).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'].includes(ext)) return 'image';
  if (ext === '.gif') return 'gif';
  if (['.mp4', '.mov', '.m4v', '.webm'].includes(ext)) return 'video';
  return null;
};

const main = async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  const nextManifest = {};
  const settings = JSON.stringify({ MAX_IMAGE_SIZE, PHOTO_QUALITY, GRAPHIC_QUALITY, MAX_GIF_SIZE, GIF_QUALITY, MAX_VIDEO_SIZE, VIDEO_CRF, MIN_SAVING });
  let before = 0, after = 0;

  for (const [key, { src, silent }] of collectMedia()) {
    const kind = kindOf(src);
    if (!kind) continue;
    const file = findFile(src);
    if (!file) {
      console.warn(`! not found: ${src}`);
      continue;
    }
    const size = fs.statSync(file).size;
    const ext = kind === 'video' ? '.mp4' : '.webp';
    const name = outputBase(src) + ext;
    const out = path.join(outDir, name);
    const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).update(settings).update(String(silent)).digest('hex');

    // Skip media that hasn't changed since last time.
    const previous = manifest[key];
    if (previous && previous.hash === hash && (!previous.optimized || fs.existsSync(path.join(root, previous.optimized)))) {
      if (kind !== 'video' && !previous.size) {
        previous.size = await imageSize(previous.optimized ? path.join(root, previous.optimized) : file);
      }
      nextManifest[key] = previous;
      before += size;
      after += previous.optimized ? fs.statSync(path.join(root, previous.optimized)).size : size;
      continue;
    }

    try {
      if (kind === 'image') await optimizeImage(file, out);
      if (kind === 'gif') await optimizeGif(file, out);
      if (kind === 'video') optimizeVideo(file, out, silent);
    } catch (error) {
      console.warn(`! could not optimize ${src}: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
      continue;
    }

    const newSize = fs.statSync(out).size;
    // MOV files are always converted: not every browser can play them.
    const worthIt = newSize <= size * (1 - MIN_SAVING) || path.extname(src).toLowerCase() === '.mov';
    if (!worthIt) fs.unlinkSync(out);
    nextManifest[key] = { optimized: worthIt ? `/images/optimized/${name}` : null, hash };
    if (kind !== 'video') nextManifest[key].size = await imageSize(worthIt ? out : file);
    before += size;
    after += worthIt ? newSize : size;
    const mb = (bytes) => (bytes / 1e6).toFixed(1);
    console.log(worthIt
      ? `✓ ${src}: ${mb(size)} MB → ${mb(newSize)} MB`
      : `· ${src}: kept the original (${mb(size)} MB, a web version wasn't smaller)`);
  }

  // Remove web versions that are no longer used.
  const keep = new Set(Object.values(nextManifest).filter(e => e.optimized).map(e => path.basename(e.optimized)));
  for (const file of fs.readdirSync(outDir)) {
    if (file !== 'manifest.json' && !keep.has(file)) fs.unlinkSync(path.join(outDir, file));
  }

  fs.writeFileSync(manifestFile, JSON.stringify(nextManifest, null, 2) + '\n');
  console.log(`${Object.keys(nextManifest).length} media files: ${(before / 1e6).toFixed(0)} MB → ${(after / 1e6).toFixed(0)} MB`);
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
