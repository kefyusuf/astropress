import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as ops from './ops.mjs';
import { ROOT } from './store.mjs';
import { HUMAN, listAgents } from './auth.mjs';
import { site } from './config.mjs';

const HP = HUMAN.perms;

const ADMIN = path.join(ROOT, 'admin', 'index.html');
const DIST = path.join(ROOT, 'dist');
const PREVIEW_PORT = Number(process.env.ASTROPRESS_PREVIEW_PORT || 4324);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

// --- Güvenlik başlıkları: tüm yanıtlara uygulanır ---
const BASE_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};
// Admin UI kendi inline <script>/<style>'ını kullanır; site önizlemesi artık ayrı origin'de
// sunulduğu için same-origin XSS yolu kapanmıştır (detay: GitHub issue #8).
const ADMIN_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const PREVIEW_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function sendJson(res, code, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...extra,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) {
        // Kalan gövdeyi boşa akıt: socket'i hemen yok etmek yerine yanıta izin ver (413).
        req.removeAllListeners('data');
        req.resume();
        const err = new Error('Gövde 1MB sınırını aştı');
        err.status = 413;
        return reject(err);
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Geçersiz JSON')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > -1) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
      catch { out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); }
    }
  }
  return out;
}

function buildAllowedHosts(port, extra) {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  for (const h of String(extra || '').split(',')) {
    const t = h.trim();
    if (t) hosts.add(t);
  }
  return hosts;
}

// Mutasyonlarda Origin/Referer kontrolü (CSRF). İkisi de yoksa (curl vb. aynı-origin
// sayılmayan istemciler) geçer; tarayıcı cross-origin isteklerinde mutlaka Origin basar.
function originAllowed(req) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (!origin && !referer) return true;
  const host = req.headers.host;
  const expected = new Set([`http://${host}`, `https://${host}`]);
  if (origin) return expected.has(String(origin));
  try { return expected.has(new URL(String(referer)).origin); } catch { return false; }
}

function serveAdminHtml(res) {
  let body;
  try { body = fs.readFileSync(ADMIN); }
  catch { return sendJson(res, 500, { error: 'admin/index.html okunamadı' }); }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy': ADMIN_CSP,
  });
  res.end(body);
}

function serveStatic(res, file, csp) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy': csp,
  });
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    if (res.headersSent) res.destroy();
    else sendJson(res, 500, { error: 'Dosya okunamadı' });
  });
  stream.pipe(res);
}

async function api(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;
  const seg = p.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;
  let body = {};
  if (method === 'POST' || method === 'PUT') {
    try { body = await readBody(req); }
    catch (e) {
      if (e.status === 413) return sendJson(res, 413, { error: e.message });
      throw e;
    }
  }

  if (p === '/api/content' && method === 'GET') return sendJson(res, 200, ops.list({ collection: q.get('collection') || undefined, status: q.get('status') || undefined }));
  if (p === '/api/content' && method === 'POST') {
    if (!body.title || !body.collection) throw new Error('collection ve title zorunlu');
    return sendJson(res, 200, ops.create(body, 'human', HP));
  }
  if (seg[1] === 'content' && seg.length === 4) {
    const [, , collection, slug] = seg;
    if (method === 'GET') return sendJson(res, 200, ops.read({ collection, slug }));
    if (method === 'PUT') return sendJson(res, 200, ops.update({ ...body, collection, slug }, 'human', HP));
    if (method === 'DELETE') return sendJson(res, 200, ops.remove({ collection, slug }, 'human', HP));
  }
  if (p === '/api/publish' && method === 'POST') return sendJson(res, 200, ops.requestPublish(body, 'human', HP));
  if (p === '/api/tasks' && method === 'GET') return sendJson(res, 200, ops.tasks({ status: q.get('status') || undefined }));
  if (seg[1] === 'tasks' && seg.length === 4 && method === 'POST') {
    const id = seg[2];
    if (seg[3] === 'approve') return sendJson(res, 200, ops.approve({ taskId: id }, 'human', HP));
    if (seg[3] === 'reject') return sendJson(res, 200, ops.reject({ taskId: id }, 'human', HP));
  }
  if (p === '/api/build' && method === 'POST') return sendJson(res, 200, ops.build('human', HP));
  if (p === '/api/audit' && method === 'GET') return sendJson(res, 200, ops.audit({ limit: Number(q.get('limit')) || 50 }));
  if (p === '/api/agents' && method === 'GET') return sendJson(res, 200, listAgents());
  if (p === '/api/config' && method === 'GET') return sendJson(res, 200, { ...site, previewUrl: `http://127.0.0.1:${PREVIEW_PORT}/` });
  return sendJson(res, 404, { error: 'Bilinmeyen API rotası: ' + method + ' ' + p });
}

/**
 * Admin HTTP sunucusu. ASTROPRESS_ADMIN_TOKEN zorunludur (fail-fast).
 * Kimlik: Authorization: Bearer <token> veya /api/login ile verilen HttpOnly oturum çerezi.
 * Koruma: Host allowlist (DNS rebinding), Origin/Referer eşleşmesi + application/json
 * zorunluluğu (CSRF), tüm yanıtlarda güvenlik başlıkları. Site önizlemesi bu sunucuda
 * yer almaz — createPreviewServer ile ayrı origin/porta taşınmıştır.
 */
export function createAdminServer(options = {}) {
  const token = options.token ?? process.env.ASTROPRESS_ADMIN_TOKEN;
  if (!token || typeof token !== 'string' || token.length < 16) {
    throw new Error('ASTROPRESS_ADMIN_TOKEN tanımsız veya çok kısa (>=16 karakter) — admin sunucusu başlamıyor (fail-fast).');
  }
  const port = options.port ?? Number(process.env.PORT || 4322);
  const tokenHash = crypto.createHash('sha256').update(token).digest();
  const sessions = new Set();
  const credentialOk = (supplied) => {
    if (!supplied || typeof supplied !== 'string') return false;
    const h = crypto.createHash('sha256').update(supplied).digest();
    return crypto.timingSafeEqual(h, tokenHash);
  };
  const allowAnyHost = process.env.ASTROPRESS_ALLOW_ANY_HOST === '1';
  const extraHosts = options.allowedHosts ?? process.env.ASTROPRESS_ADMIN_ALLOWED_HOSTS;
  // Allowlist gerçek bağlanan portu baz alır (listen(0) ile ephemeral port testleri de geçer).
  const hostAllowed = (host) => {
    const actualPort = server.address()?.port ?? port;
    return buildAllowedHosts(actualPort, extraHosts).has(host);
  };

  const authenticate = (req) => {
    const auth = req.headers.authorization;
    if (auth && /^Bearer\s+\S+\s*$/i.test(String(auth))) return credentialOk(String(auth).replace(/^Bearer\s+/i, '').trim());
    const sid = parseCookies(req.headers.cookie).ap_admin;
    if (sid && sessions.has(sid)) return true;
    return false;
  };

  const server = http.createServer(async (req, res) => {
    try {
      // DNS rebinding: Host başlığı allowlist dışındaysa erken 403.
      if (!allowAnyHost && !hostAllowed(String(req.headers.host || ''))) {
        return sendJson(res, 403, { error: 'Host izinli değil' });
      }
      let url;
      try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
      catch { return sendJson(res, 400, { error: 'Geçersiz istek hedefi' }); }
      const p = url.pathname.replace(/\/+$/, '') || '/';
      const method = req.method;

      // CSRF: tüm /api/* mutasyonları aynı-origin olmalı ve application/json gövde taşımalı.
      if (p.startsWith('/api/') && method !== 'GET') {
        if (!originAllowed(req)) return sendJson(res, 403, { error: 'Origin eşleşmiyor (CSRF koruması)' });
        if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
          return sendJson(res, 415, { error: 'Content-Type application/json olmalı' });
        }
      }

      if (p === '/api/login' && method === 'POST') {
        const body = await readBody(req);
        if (!credentialOk(String(body?.token || ''))) return sendJson(res, 401, { error: 'Token geçersiz' });
        const sid = crypto.randomBytes(24).toString('base64url');
        sessions.add(sid);
        return sendJson(res, 200, { ok: true }, {
          'Set-Cookie': `ap_admin=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        });
      }

      if (!authenticate(req)) {
        return sendJson(res, 401, { error: 'Yetkisiz — Bearer token veya /api/login oturumu gerekli' });
      }

      if (p === '/' || p === '/admin') return serveAdminHtml(res);
      if (p.startsWith('/api/')) return await api(req, res, url);
      return sendJson(res, 404, { error: 'not found' });
    } catch (e) {
      return sendJson(res, e.status || 400, { error: e.message });
    }
  });
  server.port = port;
  return server;
}

/**
 * Derlenen sitenin önizleme sunucusu — admin API'den ayrı origin/porta (same-origin
 * stored XSS izolasyonu, issue #8). Yalnızca GET; dist kökü realpath ile doğrulanır.
 */
export function createPreviewServer(options = {}) {
  const port = options.port ?? PREVIEW_PORT;
  const distRoot = options.distRoot ?? DIST;
  const server = http.createServer((req, res) => {
    try {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Sadece GET' });
      let url;
      try { url = new URL(req.url, 'http://localhost'); }
      catch { return sendJson(res, 400, { error: 'Geçersiz istek hedefi' }); }
      let file = path.normalize(path.join(distRoot, decodeURIComponent(url.pathname.replace(/^\/site\/?/, '/'))));
      if (!file.startsWith(distRoot + path.sep) && file !== distRoot) return sendJson(res, 403, { error: 'forbidden' });
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { error: 'dist içinde yok — önce Build alın' });
      const real = fs.realpathSync(file);
      const realRoot = fs.realpathSync(distRoot);
      if (path.relative(realRoot, real).startsWith('..')) return sendJson(res, 403, { error: 'dist kökünün dışına çıkış yasak' });
      return serveStatic(res, real, PREVIEW_CSP);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  });
  server.port = port;
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const host = process.env.HOST || '127.0.0.1';
  const adminPort = Number(process.env.PORT || 4322);
  createAdminServer().listen(adminPort, host, () => {
    console.log(`AstroPress admin → http://127.0.0.1:${adminPort}/  (Bearer ${process.env.ASTROPRESS_ADMIN_TOKEN ? 'token aktif' : ''})`);
  });
  createPreviewServer().listen(PREVIEW_PORT, host, () => {
    console.log(`AstroPress site önizleme → http://127.0.0.1:${PREVIEW_PORT}/  (admin'den ayrı origin)`);
  });
}