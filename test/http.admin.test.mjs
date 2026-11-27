import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-admin-'));
process.env.ASTROPRESS_CONTENT = path.join(tmp, 'content');
process.env.ASTROPRESS_STATE = path.join(tmp, 'state');

const store = await import('../mcp/store.mjs');
const { createAdminServer, createPreviewServer } = await import('../mcp/http.mjs');

const TOKEN = 'test-admin-token-0123456789';
const authHeader = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

// Host başlığını serbestçe seçebilmek için ham http istemcisi (fetch Host'i bırakmaz).
function rawRequest(port, requestPath, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: requestPath, headers, method }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    if (method !== 'GET') r.write(headers.__body ?? '');
    r.end();
  });
}

const admin = createAdminServer({ token: TOKEN });
const distRoot = path.join(tmp, 'dist');
const preview = createPreviewServer({ distRoot });
const adminPort = await listen(admin);
const previewPort = await listen(preview);
const base = `http://127.0.0.1:${adminPort}`;

test.after(() => {
  admin.close();
  admin.closeAllConnections?.();
  preview.close();
  preview.closeAllConnections?.();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temizlik best-effort */ }
});

test('createAdminServer: token yoksa fail-fast', () => {
  assert.throws(() => createAdminServer({ token: '' }), /ASTROPRESS_ADMIN_TOKEN/);
  assert.throws(() => createAdminServer({ token: 'kısa' }), /ASTROPRESS_ADMIN_TOKEN/);
});

test('Yetkisiz /api/* isteği 401 döner', async () => {
  const r = await fetch(`${base}/api/content`);
  assert.equal(r.status, 401);
});

test('Yanlış Bearer token 401 döner', async () => {
  const r = await fetch(`${base}/api/content`, { headers: { Authorization: 'Bearer yanlis-token-degeri' } });
  assert.equal(r.status, 401);
});

test('Doğru Bearer token ile /api/content 200 + güvenlik başlıkları', async () => {
  const r = await fetch(`${base}/api/content`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
});

test('Login akışı: yanlış token 401, doğru token çerez verir ve çerez yetkilendirir', async () => {
  const bad = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'yanlis-token-degeri' }),
  });
  assert.equal(bad.status, 401);

  const ok = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie') || '';
  assert.match(setCookie, /ap_admin=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  const sid = /ap_admin=([^;]+)/.exec(setCookie)[1];

  const withCookie = await fetch(`${base}/api/content`, { headers: { Cookie: `ap_admin=${sid}` } });
  assert.equal(withCookie.status, 200);
});

test('Host allowlist dışı istek 403 döner (DNS rebinding)', async () => {
  const r = await rawRequest(adminPort, '/api/content', { Host: 'evil.example.com' });
  assert.equal(r.status, 403);
});

test('Cross-Origin mutasyon 403 döner (CSRF)', async () => {
  const r = await fetch(`${base}/api/content`, {
    method: 'POST',
    headers: { ...authHeader, Origin: 'http://evil.example.com' },
    body: JSON.stringify({ title: 'x', collection: 'blog' }),
  });
  assert.equal(r.status, 403);
});

test('application/json dışı mutasyon 415 döner', async () => {
  const r = await fetch(`${base}/api/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'text/plain' },
    body: JSON.stringify({ title: 'x', collection: 'blog' }),
  });
  assert.equal(r.status, 415);
});

test('collection allowlist: ../../ isteği 400 ile reddedilir', async () => {
  const r = await fetch(`${base}/api/content?collection=../../`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /Bilinmeyen collection/);
});

test('JS frontmatter motoru çalışmaz — kod çalıştırmak yerine hata fırlatır', async () => {
  const blogDir = path.join(process.env.ASTROPRESS_CONTENT, 'blog');
  fs.mkdirSync(blogDir, { recursive: true });
  fs.writeFileSync(path.join(blogDir, 'js-frontmatter.md'), '---js\nconst pwned = "executed";\n---\nGövde');
  assert.throws(() => store.listContent('blog'), /JS frontmatter motoru devre dışı/);
  assert.throws(() => store.readContent('blog', 'js-frontmatter'), /JS frontmatter motoru devre dışı/);
});

test('1MB üstü gövde 413 döner', async () => {
  const big = { title: 'x', collection: 'blog', body: 'A'.repeat(1.5 * 1024 * 1024) };
  const r = await fetch(`${base}/api/content`, {
    method: 'POST',
    headers: authHeader,
    body: JSON.stringify(big),
  });
  assert.equal(r.status, 413);
});

test('Admin UI kimlikle sunulur ve kısıtlayıcı CSP taşır', async () => {
  const r = await fetch(`${base}/admin`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/html/);
  const csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'none'/);
});

test('Bilinmeyen API rotası kimlikle 404 döner', async () => {
  const r = await fetch(`${base}/api/yok`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 404);
});

test('Preview: / ve /site/ dist kökünü servis eder, CSP taşır', async () => {
  fs.mkdirSync(distRoot, { recursive: true });
  fs.writeFileSync(path.join(distRoot, 'index.html'), '<p>preview-ok</p>');
  const root = await fetch(`http://127.0.0.1:${previewPort}/`);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /preview-ok/);
  const prefixed = await rawRequest(previewPort, '/site/', { Host: `127.0.0.1:${previewPort}` });
  assert.equal(prefixed.status, 200);
  const csp = root.headers.get('content-security-policy') || '';
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(root.headers.get('x-content-type-options'), 'nosniff');
});

test('Preview: dist dışına kaçış denemeleri içerik sızdırmaz, olmayan yol 404', async () => {
  const outside = path.join(tmp, 'distsiz');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'index.html'), '<p>secret</p>');

  // WHATWG URL ham ../ ve %2e%2e'yi normalize eder (güvenli); Windows'ta gerçek vektör %5C'dir.
  const dotdot = await rawRequest(previewPort, '/../distsiz/', { Host: `127.0.0.1:${previewPort}` });
  assert.ok(dotdot.status === 404 || dotdot.status === 403, '../ isteği 200 dönmemeli');

  if (process.platform === 'win32') {
    const backslash = await rawRequest(previewPort, '/..%5Cdistsiz/', { Host: `127.0.0.1:${previewPort}` });
    assert.equal(backslash.status, 403);
  }

  const missing = await fetch(`http://127.0.0.1:${previewPort}/yok-boyle-sayfa/`);
  assert.equal(missing.status, 404);
});

test('Preview: symlink/junction ile dist kökünden kaçış 403', async () => {
  const outside = path.join(tmp, 'kaçış-hedefi');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'index.html'), '<p>secret</p>');
  const linkPath = path.join(distRoot, 'link');
  let linkOk = false;
  try {
    fs.symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    linkOk = true;
  } catch { /* yetkisiz ortamda symlink kurulamayabilir — test atlanır */ }
  if (!linkOk) return;

  const r = await fetch(`http://127.0.0.1:${previewPort}/link/`);
  assert.equal(r.status, 403);
  fs.rmSync(linkPath, { force: true });
});