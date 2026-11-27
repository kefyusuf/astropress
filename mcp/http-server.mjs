import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './factory.mjs';
import { getAgent } from './auth.mjs';

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 100;
const MAX_BODY_BYTES = 1024 * 1024;

function json(res, code, obj, extra = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // Socket'i kırpma yerine gövdeyi boşa akıt: düzgün 413 yanıtı verilebilir.
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

/**
 * MCP Streamable HTTP sunucusu (issue #9 sıkılaştırması).
 * - Auth: MCP_BEARER_TOKEN tanımlıysa tüm istekler Bearer token ister (timing-safe).
 *   Tanımsızsa (lokal dev) transport kimlik doğrulamasızdır ama publish yetkili kimlikler
 *   (örn. operator) 403 ile reddedilir — header spoofing ile yetki yükseltme kapalı.
 * - Origin: tarayıcı isteklerinde Origin başlığı kendi Host'u veya MCP_ALLOWED_ORIGINS
 *   allowlist'i dışındaysa 403.
 * - Oturumlar: TTL (vars. 30dk) + üst sınır (vars. 100); TTL aşımı ve en eski oturum
 *   kapatılır (bellek sızıntısı DoS kapalı). Bilinmeyen Mcp-Session-Id → 404 (spec).
 * - >1MB gövde → 413 (socket kırpma yerine).
 */
export function createMcpHttpServer(options = {}) {
  const port = options.port ?? Number(process.env.MCP_PORT ?? 4323);
  const token = options.token ?? process.env.MCP_BEARER_TOKEN;
  const tokenHash = token ? crypto.createHash('sha256').update(token).digest() : null;
  const allowedOrigins = new Set(
    String(options.allowedOrigins ?? process.env.MCP_ALLOWED_ORIGINS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  );
  const sessionTtlMs = options.sessionTtlMs ?? (Number(process.env.MCP_SESSION_TTL_MS) || DEFAULT_SESSION_TTL_MS);
  const maxSessions = options.maxSessions ?? (Number(process.env.MCP_MAX_SESSIONS) || DEFAULT_MAX_SESSIONS);
  const allowAnyHost = options.allowAnyHost ?? process.env.MCP_ALLOW_ANY_HOST === '1';
  const hostAllowlist = new Set(options.hostAllowlist ?? ['localhost', '127.0.0.1', '::1']);

  const transports = new Map(); // sessionId → { transport, server, lastSeen }

  const authorized = (req) => {
    if (!tokenHash) return true; // token modu değil: transport kimlik doğrulamasız (operator yasağı aşağıda)
    const m = /^Bearer\s+(\S+)\s*$/i.exec(String(req.headers.authorization || ''));
    if (!m) return false;
    const h = crypto.createHash('sha256').update(m[1]).digest();
    return crypto.timingSafeEqual(h, tokenHash);
  };

  const originAllowed = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true; // tarayıcı dışı istemciler Origin göndermez
    if (allowedOrigins.size === 0) {
      const host = req.headers.host; // allowlist yoksa yalnız same-origin kabul
      return origin === `http://${host}` || origin === `https://${host}`;
    }
    return allowedOrigins.has(String(origin));
  };

  const hostAllowed = (req) => {
    if (allowAnyHost) return true;
    const raw = String(req.headers.host || '');
    const host = (raw.startsWith('[') ? raw.slice(1, raw.indexOf(']')) : raw.split(':')[0]).toLowerCase();
    return hostAllowlist.has(host); // Host büyük/küçük harf duyarsız (RFC 9110)
  };

  const closeEntry = (entry) => {
    try { entry.transport.close(); } catch { /* idempotent temizlik */ }
  };

  const sweepSessions = () => {
    const now = Date.now();
    for (const [sid, entry] of transports) {
      if (now - entry.lastSeen > sessionTtlMs) {
        transports.delete(sid);
        closeEntry(entry);
      }
    }
    while (transports.size > maxSessions) {
      let oldest = null;
      for (const [sid, entry] of transports) {
        if (!oldest || entry.lastSeen < oldest[1].lastSeen) oldest = [sid, entry];
      }
      if (!oldest) break;
      transports.delete(oldest[0]);
      closeEntry(oldest[1]);
    }
  };

  const server = http.createServer(async (req, res) => {
    try {
      // URL parse try içinde: bozuk target (ERR_INVALID_URL) sunucuyu çökertmez, 400 döner.
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/mcp') return json(res, 404, { error: 'not found' });
      if (!hostAllowed(req)) return json(res, 403, { error: 'forbidden host' });
      if (!originAllowed(req)) return json(res, 403, { error: 'forbidden origin' });
      if (!authorized(req)) return json(res, 401, { error: 'Yetkisiz — Bearer token gerekli' });

      // Sweep, lookup'tan ÖNCE: süresi geçen oturum bu istekle dirilmesin (bayat referans yok).
      sweepSessions();
      const sid = req.headers['mcp-session-id'];
      const entry = sid ? transports.get(String(sid)) : undefined;
      if (entry) entry.lastSeen = Date.now();

      // Bilinmeyen/eski oturum id → 404 Not Found (Streamable HTTP spec; 400 değil).
      if (sid && !entry) return json(res, 404, { error: 'Oturum bulunamadı — yeni oturum için initialize gerekli' });

      // Yeni oturum: yalnız Mcp-Session-Id olmayan POST (initialize).
      if (req.method === 'POST' && !entry) {
        const agentId = req.headers['x-astropress-agent'] || 'content-studio';
        let agent;
        try { agent = getAgent(agentId); }
        catch (e) { return json(res, 400, { error: e.message }); }
        if (!tokenHash && agent.perms.publish) {
          return json(res, 403, { error: 'Kimlik doğrulamasız transportta publish yetkili kimlik yasak — MCP_BEARER_TOKEN yapılandırın' });
        }
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
            onsessioninitialized: (id) => { transports.set(id, { transport, server: mcpServer, lastSeen: Date.now() }); },
          });
          transport.onclose = () => {
            if (transport.sessionId) transports.delete(transport.sessionId);
            closeServer();
          };
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res, body);
          if (!transport.sessionId) closeServer(); // geçersiz initialize → kaynak temizliği
        } catch (e) {
          // Throw sonrası temizlik (cleanup): kayıtlı oturumu sil + sunucuyu kapat.
          // Idempotent: onclose zinciri tekrar silse/kapatsa da güvenli; hata dış catch'e iletilir.
          if (transport?.sessionId) transports.delete(transport.sessionId);
          closeServer();
          throw e;
        }
        return;
      }

      if (!entry) return json(res, 400, { error: 'Mcp-Session-Id gerekli' });
      const body = req.method === 'POST' ? await readBody(req) : undefined;
      await entry.transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 400, { error: e.message });
    }
  });
  server.port = port;
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const PORT = Number(process.env.MCP_PORT ?? 4323);
  const HOST = process.env.HOST || '127.0.0.1';
  const server = createMcpHttpServer();
  server.listen(PORT, HOST, () => {
    const actual = server.address().port;
    console.log(`AstroPress MCP HTTP → http://${HOST}:${actual}/mcp`);
  });
}