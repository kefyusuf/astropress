import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-mcp-http-'));
process.env.ASTROPRESS_CONTENT = path.join(tmp, 'content');
process.env.ASTROPRESS_STATE = path.join(tmp, 'state');

const { createMcpHttpServer } = await import('../mcp/http-server.mjs');

const TOKEN = 'test-mcp-token-0123456789';
const AUTH = { Authorization: `Bearer ${TOKEN}` };

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const authed = createMcpHttpServer({ token: TOKEN });
const open = createMcpHttpServer({}); // token yok — kimlik doğrulamasız transport
const port = await listen(authed);
const openPort = await listen(open);
const base = `http://127.0.0.1:${port}`;
const openBase = `http://127.0.0.1:${openPort}`;

test.after(() => {
  for (const s of [authed, open]) { s.close(); s.closeAllConnections?.(); }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const connect = async (baseUrl, agentId, token = TOKEN) => {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { 'X-Astropress-Agent': agentId, ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
  });
  const client = new Client({ name: 'ap-test', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport };
};

test('Token yok → 401; yanlış token → 401', async () => {
  assert.equal((await fetch(`${base}/mcp`)).status, 401);
  assert.equal((await fetch(`${base}/mcp`, { headers: { Authorization: 'Bearer yanlis-token-12345678' } })).status, 401);
});

test('Token ile initialize → oturum kurulur ve whoami çalışır', async () => {
  const { client, transport } = await connect(base, 'reader');
  const r = await client.callTool({ name: 'whoami' });
  assert.equal(JSON.parse(r.content[0].text).id, 'reader');
  assert.ok(transport.sessionId, 'oturum id dönmedi');
  await client.close();
});

test('Kimlik doğrulamasız transportta publish yetkili kimlik (operator) 403 — spoofing kapalı', async () => {
  await assert.rejects(() => connect(openBase, 'operator', ''), /yasak|403/);
});

test('Kimlik doğrulamasız transportta düşük yetkili kimlik çalışır', async () => {
  const { client } = await connect(openBase, 'content-studio', '');
  const r = await client.callTool({ name: 'whoami' });
  assert.equal(JSON.parse(r.content[0].text).id, 'content-studio');
  await client.close();
});

test('Cross-Origin POST → 403 (Origin allowlist)', async () => {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { ...AUTH, Origin: 'http://evil.example.com', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(r.status, 403);
});

test('Bilinmeyen Mcp-Session-Id → 404 (POST + GET), sid\u2019siz GET → 400', async () => {
  const post = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { ...AUTH, 'Mcp-Session-Id': 'yok-boyle-oturum', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(post.status, 404);
  const get = await fetch(`${base}/mcp`, { headers: { ...AUTH, 'Mcp-Session-Id': 'yok-boyle-oturum' } });
  assert.equal(get.status, 404);
  const bare = await fetch(`${base}/mcp`, { headers: { ...AUTH } });
  assert.equal(bare.status, 400);
});

test('>1MB gövde → 413 (socket kırpma değil)', async () => {
  const big = 'x'.repeat(1.5 * 1024 * 1024);
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { big } }),
  });
  assert.equal(r.status, 413);
});

test('Session TTL: süresi geçen oturum 404 döner', async () => {
  const ttlServer = createMcpHttpServer({ token: TOKEN, sessionTtlMs: 80 });
  const ttlPort = await listen(ttlServer);
  try {
    const { client, transport } = await connect(`http://127.0.0.1:${ttlPort}`, 'reader');
    const sid = transport.sessionId;
    await client.close(); // lokal kapanış — sunucudaki oturum map'te kalır
    await new Promise((r) => setTimeout(r, 200));
    const r = await fetch(`http://127.0.0.1:${ttlPort}/mcp`, { headers: { ...AUTH, 'Mcp-Session-Id': sid } });
    assert.equal(r.status, 404);
  } finally {
    ttlServer.close();
    ttlServer.closeAllConnections?.();
  }
});

test('Max session sınırı: en eski oturum düşer, yenisi çalışır', async () => {
  const ms = createMcpHttpServer({ token: TOKEN, maxSessions: 1 });
  const msPort = await listen(ms);
  try {
    const { transport: t1 } = await connect(`http://127.0.0.1:${msPort}`, 'reader');
    const { transport: t2, client: c2 } = await connect(`http://127.0.0.1:${msPort}`, 'reader');
    const ping = (sid) => fetch(`http://127.0.0.1:${msPort}/mcp`, {
      method: 'POST',
      headers: { ...AUTH, 'Mcp-Session-Id': sid, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    const old = await ping(t1.sessionId);
    const fresh = await ping(t2.sessionId);
    assert.equal(old.status, 404);
    assert.equal(fresh.status, 200);
    await c2.close();
  } finally {
    ms.close();
    ms.closeAllConnections?.();
  }
});

test('Bilinmeyen agent kimliği initialize\u2019da 400 döner', async () => {
  await assert.rejects(() => connect(base, 'hacker'), /400|Bilinmeyen/);
});
