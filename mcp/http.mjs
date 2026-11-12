import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as ops from './ops.mjs';
import { ROOT } from './store.mjs';
import { HUMAN, listAgents } from './auth.mjs';
import { site } from './config.mjs';

const HP = HUMAN.perms;

const PORT = Number(process.env.PORT || 4322);
// Container'da host'tan erişim için 0.0.0.0 gerekir; lokalde varsayılan loopback.
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN = path.join(ROOT, 'admin', 'index.html');
const DIST = path.join(ROOT, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) { reject(new Error('Gövde 1MB sınırını aştı')); req.destroy(); return; }
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

function serveFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function serveSite(res, pathname) {
  const rel = decodeURIComponent(pathname.replace(/^\/site\/?/, ''));
  let file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST + path.sep) && file !== DIST) return json(res, 403, { error: 'forbidden' });
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) && fs.existsSync(file + path.sep + 'index.html')) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'dist içinde yok — önce Build alın' });
  serveFile(res, file);
}

async function api(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;
  const seg = p.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;
  const body = method === 'POST' || method === 'PUT' ? await readBody(req) : {};

  if (p === '/api/content' && method === 'GET') return json(res, 200, ops.list({ collection: q.get('collection') || undefined, status: q.get('status') || undefined }));
  if (p === '/api/content' && method === 'POST') {
    if (!body.title || !body.collection) throw new Error('collection ve title zorunlu');
    return json(res, 200, ops.create(body, 'human', HP));
  }
  if (seg[1] === 'content' && seg.length === 4) {
    const [, , collection, slug] = seg;
    if (method === 'GET') return json(res, 200, ops.read({ collection, slug }));
    if (method === 'PUT') return json(res, 200, ops.update({ ...body, collection, slug }, 'human', HP));
    if (method === 'DELETE') return json(res, 200, ops.remove({ collection, slug }, 'human', HP));
  }
  if (p === '/api/publish' && method === 'POST') return json(res, 200, ops.requestPublish(body, 'human'));
  if (p === '/api/tasks' && method === 'GET') return json(res, 200, ops.tasks({ status: q.get('status') || undefined }));
  if (seg[1] === 'tasks' && seg.length === 4 && method === 'POST') {
    const id = seg[2];
    if (seg[3] === 'approve') return json(res, 200, ops.approve({ taskId: id }, 'human', HP));
    if (seg[3] === 'reject') return json(res, 200, ops.reject({ taskId: id }, 'human', HP));
  }
  if (p === '/api/build' && method === 'POST') return json(res, 200, ops.build('human'));
  if (p === '/api/audit' && method === 'GET') return json(res, 200, ops.audit({ limit: Number(q.get('limit')) || 50 }));
  if (p === '/api/agents' && method === 'GET') return json(res, 200, listAgents());
  if (p === '/api/config' && method === 'GET') return json(res, 200, site);
  return json(res, 404, { error: 'Bilinmeyen API rotası: ' + method + ' ' + p });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/' || url.pathname === '/admin' || url.pathname === '/admin/') return serveFile(res, ADMIN);
    if (url.pathname === '/site' || url.pathname.startsWith('/site/')) return serveSite(res, url.pathname);
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 400, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log('AstroPress admin → http://127.0.0.1:' + PORT + '/  (site önizleme: /site/)');
});