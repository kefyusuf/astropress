import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './factory.mjs';
import { getAgent } from './auth.mjs';

const PORT = Number(process.env.MCP_PORT ?? 4323);
const HOST = process.env.HOST || '127.0.0.1';
const ALLOW_ANY_HOST = process.env.MCP_ALLOW_ANY_HOST === '1';
const HOST_ALLOWLIST = new Set(['localhost', '127.0.0.1', '::1']);

const transports = Object.create(null); // sessionId → { transport, server }

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
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

function hostAllowed(req) {
  if (ALLOW_ANY_HOST) return true;
  const raw = req.headers.host || '';
  const host = raw.startsWith('[') ? raw.slice(1, raw.indexOf(']')) : raw.split(':')[0];
  return HOST_ALLOWLIST.has(host.toLowerCase()); // Host büyük/küçük harf duyarsız (case-insensitive, RFC 9110)
}

const server = http.createServer(async (req, res) => {
  try {
    // URL parse try içinde: bozuk target (ERR_INVALID_URL) sunucuyu çökertmez, 400 döner.
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/mcp') return json(res, 404, { error: 'not found' });
    if (!hostAllowed(req)) return json(res, 403, { error: 'forbidden host' });
    const sid = req.headers['mcp-session-id'];
    const entry = sid ? transports[sid] : undefined;

    // Yeni oturum: yalnız Mcp-Session-Id olmayan POST (initialize).
    if (req.method === 'POST' && !entry) {
      const agentId = req.headers['x-astropress-agent'] || 'content-studio';
      let agent;
      try { agent = getAgent(agentId); }
      catch (e) { return json(res, 400, { error: e.message }); }
      const body = await readBody(req);
      const mcpServer = createMcpServer(agent);
      let closed = false;
      const closeServer = () => {
        if (!closed) {
          closed = true;
          mcpServer.close().catch((e) => console.error('MCP server kapatma hatası:', e));
        }
      };
      let transport;
      try {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => { transports[id] = { transport, server: mcpServer }; },
        });
        transport.onclose = () => {
          if (transport.sessionId) delete transports[transport.sessionId];
          closeServer();
        };
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
        if (!transport.sessionId) closeServer(); // geçersiz initialize → kaynak temizliği
      } catch (e) {
        // Throw sonrası temizlik (cleanup): kayıtlı oturumu sil + sunucuyu kapat.
        // Idempotent: onclose zinciri tekrar silse/kapatsa da güvenli; hata dış catch'e iletilir (400).
        if (transport?.sessionId) delete transports[transport.sessionId];
        closeServer();
        throw e;
      }
      return;
    }

    if (!entry) return json(res, 400, { error: 'Mcp-Session-Id gerekli' });
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    await entry.transport.handleRequest(req, res, body);
  } catch (e) {
    if (!res.headersSent) json(res, 400, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  const actual = server.address().port;
  console.log(`AstroPress MCP HTTP → http://${HOST}:${actual}/mcp`);
});
