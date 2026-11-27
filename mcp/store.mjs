import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
// Testler gerçek içerik/state'e dokunmadan izole temp dizinlere yönlendirebilsin diye env override.
export const CONTENT = process.env.ASTROPRESS_CONTENT || path.join(ROOT, 'src', 'content');
export const STATE = process.env.ASTROPRESS_STATE || path.join(ROOT, '.astropress');
export const COLLECTIONS = { blog: 'post', products: 'product', pages: 'page' };

// gray-matter v4, ---js / ---javascript frontmatter bloklarını eval ile çalıştırır (RCE).
// Motorları kalıcı diyete sok: JS frontmatter içeren dosya kod çalıştırmaz, hata fırlatır.
const jsEngineDenied = () => { throw new Error('JS frontmatter motoru devre dışı (güvenlik)'); };
const SAFE_MATTER_OPTIONS = { engines: { js: jsEngineDenied, javascript: jsEngineDenied } };
const safeMatterRead = (file) => matter.read(file, SAFE_MATTER_OPTIONS);

const TR = { 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ö': 'o', 'ç': 'c', 'ı': 'i', 'Ğ': 'g', 'Ü': 'u', 'Ş': 's', 'Ö': 'o', 'Ç': 'c', 'İ': 'i' };
export function slugify(s) {
  return String(s)
    .replace(/[ğüşöçıĞÜŞÖÇİ]/g, (c) => TR[c])
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60) || 'icerik';
}

function fileFor(collection, slug) {
  if (!COLLECTIONS[collection]) throw new Error('Bilinmeyen collection: ' + collection);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('Geçersiz slug: ' + slug);
  return path.join(CONTENT, collection, slug + '.md');
}

export function listContent(collection, status) {
  if (collection && !COLLECTIONS[collection]) throw new Error('Bilinmeyen collection: ' + collection);
  const cols = collection ? [collection] : Object.keys(COLLECTIONS);
  const out = [];
  for (const c of cols) {
    const dir = path.join(CONTENT, c);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const { data } = safeMatterRead(path.join(dir, f));
      if (status && data.status !== status) continue;
      out.push({ id: f.replace(/\.md$/, ''), collection: c, type: COLLECTIONS[c], ...data });
    }
  }
  return out;
}

export function readContent(collection, slug) {
  const p = fileFor(collection, slug);
  if (!fs.existsSync(p)) throw new Error('İçerik yok: ' + collection + '/' + slug);
  const { data, content } = safeMatterRead(p);
  return { data, body: content };
}

export function writeContent(collection, slug, data, body) {
  const p = fileFor(collection, slug);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, matter.stringify(body || '', data), 'utf8');
  return p;
}

export function deleteContent(collection, slug) {
  const p = fileFor(collection, slug);
  if (!fs.existsSync(p)) throw new Error('İçerik yok: ' + collection + '/' + slug);
  fs.unlinkSync(p);
}

export function uniqueSlug(collection, title) {
  let base = slugify(title);
  let slug = base;
  let n = 2;
  while (fs.existsSync(fileFor(collection, slug))) slug = base + '-' + n++;
  return slug;
}

export function ensureState() { fs.mkdirSync(STATE, { recursive: true }); }
export function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(STATE, name), 'utf8')); }
  catch { return fallback; }
}
export function writeJSON(name, obj) {
  ensureState();
  fs.writeFileSync(path.join(STATE, name), JSON.stringify(obj, null, 2), 'utf8');
}

export function audit(actor, action, detail) {
  const log = readJSON('audit.json', []);
  log.push({ ts: new Date().toISOString(), actor, action, detail });
  writeJSON('audit.json', log.slice(-200));
}