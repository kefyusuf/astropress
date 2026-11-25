import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ROOT } from './store.mjs';

// HTTP sunucusunu ephemeral port'ta spawn et; stdout'tan gerçek port'u parse et.
const child = spawn(process.execPath, ['mcp/http-server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, MCP_PORT: '0', HOST: '127.0.0.1' },
});
let port;
try {
  port = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('MCP HTTP startup timeout')), 15000);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/http:\/\/127\.0\.0\.1:(\d+)\/mcp/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('MCP HTTP server exited early: ' + code)); });
  });
} catch (e) {
  child.kill(); // startup hatasında yetim (orphan) process bırakma; ölü child'da kill zararsız
  throw e;
}

const connect = async (agentId) => {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { 'X-Astropress-Agent': agentId } },
  });
  const client = new Client({ name: 'astropress-smoke-http', version: '0.0.0' });
  await client.connect(transport);
  return client;
};
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return JSON.parse(r.content[0].text);
};
const denied = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return r.isError === true;
};
const distPage = (slug) => path.join(ROOT, 'dist', 'blog', slug, 'index.html');
const distEnPage = (slug) => path.join(ROOT, 'dist', 'en', 'blog', slug, 'index.html');

let fail = 0;
const check = (label, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + label); if (!cond) fail++; };

try {
  // Guardrail zinciri (operator, publish yetkili → human).
  const op = await connect('operator');
  check('HTTP whoami operator perms', (await call(op, 'whoami')).perms.publish === true);
  const created = await call(op, 'create_content', { collection: 'blog', title: 'HTTP Smoke Yazısı', excerpt: 'HTTP smoke taslağı.' });
  const slug = created.slug;
  check('HTTP create forces draft', created.status === 'draft');
  await call(op, 'run_build');
  check('HTTP guardrail: draft NOT in dist', !fs.existsSync(distPage(slug)));
  const req = await call(op, 'request_publish', { collection: 'blog', slug });
  check('HTTP request_publish queues approval', req.status === 'approval');
  await call(op, 'approve_task', { taskId: req.taskId });
  check('HTTP approve publishes', (await call(op, 'read_content', { collection: 'blog', slug })).data.status === 'published');
  await call(op, 'run_build');
  check('HTTP published page IS in dist', fs.existsSync(distPage(slug)));
  await call(op, 'delete_content', { collection: 'blog', slug });
  await call(op, 'run_build');
  check('HTTP delete removes page from dist', !fs.existsSync(distPage(slug)));
  check('HTTP audit records actions', (await call(op, 'audit_log', { limit: 50 })).some((e) => e.action === 'approve_task'));

  // i18n: EN /en/ altına build, TR'ye sızmaz.
  const en = await call(op, 'create_content', { collection: 'blog', title: 'HTTP EN Post', lang: 'en', translationOf: 'v60-pour-over' });
  const enSlug = en.slug;
  const enReq = await call(op, 'request_publish', { collection: 'blog', slug: enSlug });
  await call(op, 'approve_task', { taskId: enReq.taskId });
  await call(op, 'run_build');
  check('HTTP i18n EN under /en/blog/', fs.existsSync(distEnPage(enSlug)));
  check('HTTP i18n EN NOT in TR /blog/', !fs.existsSync(distPage(enSlug)));
  await call(op, 'delete_content', { collection: 'blog', slug: enSlug });
  await call(op, 'run_build');
  await op.close();

  // RBAC: content-studio (create/edit/delete var, commerce/publish yok).
  const cs = await connect('content-studio');
  check('HTTP RBAC cs create allowed', (await call(cs, 'create_content', { collection: 'blog', title: 'HTTP RBAC Deneme' })).status === 'draft');
  check('HTTP RBAC cs commerce denied', await denied(cs, 'update_content', { collection: 'products', slug: 'ethiopia-yirgacheffe', price: 999 }));
  check('HTTP RBAC cs approve denied', await denied(cs, 'approve_task', { taskId: 'x' }));
  await call(cs, 'delete_content', { collection: 'blog', slug: 'http-rbac-deneme' });
  await cs.close();

  // RBAC: commerce-bot (commerce var, create yok).
  const cb = await connect('commerce-bot');
  check('HTTP RBAC cb create denied', await denied(cb, 'create_content', { collection: 'blog', title: 'X' }));
  check('HTTP RBAC cb price allowed', (await call(cb, 'update_content', { collection: 'products', slug: 'ethiopia-yirgacheffe', price: 420 })).status === 'published');
  await cb.close();

  // RBAC: reader + session isolation (iki agent ayrı oturum, her biri kendi kimliğinde).
  const rd = await connect('reader');
  check('HTTP RBAC reader create denied', await denied(rd, 'create_content', { collection: 'blog', title: 'X' }));
  const op2 = await connect('operator');
  check('HTTP session isolation: reader whoami', (await call(rd, 'whoami')).id === 'reader');
  check('HTTP session isolation: operator whoami', (await call(op2, 'whoami')).id === 'operator');
  check('HTTP RBAC denials audited', (await call(op2, 'audit_log', { limit: 60 })).some((e) => e.action === 'denied'));
  await rd.close();
  await op2.close();

  // Bilinmeyen agent header → initialize 400 → connect reddedilir.
  let unknownRejected = false;
  try { const bad = await connect('hacker'); await bad.close(); } catch { unknownRejected = true; }
  check('HTTP unknown agent header rejected', unknownRejected);

  // DELETE sonrası oturum kapanır (session map temizlenir) — spec §13.8.
  const dt = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { 'X-Astropress-Agent': 'reader' } },
  });
  const dc = new Client({ name: 'astropress-smoke-http', version: '0.0.0' });
  await dc.connect(dt);
  const staleSid = dt.sessionId;
  await dt.terminateSession(); // DELETE gönderir → onclose → map temizliği (SDK 1.32.2: close() yalnız lokal abort)
  await dc.close(); // lokal temizlik — DELETE göndermez; terminateSession'dan SONRA olmalı (close, abort controller'ı iptal eder)
  const stale = await fetch(`http://127.0.0.1:${port}/mcp`, { headers: { 'Mcp-Session-Id': staleSid } });
  check('HTTP DELETE cleanup: stale session rejected', stale.status === 400 || stale.status === 404);

  // reader delete reddi (stdio parity).
  const rd2 = await connect('reader');
  check('HTTP RBAC reader delete denied', await denied(rd2, 'delete_content', { collection: 'blog', slug: 'v60-pour-over' }));
  await rd2.close();

  // EN translationOf kalıcılığı (stdio parity).
  const op3 = await connect('operator');
  const en2 = await call(op3, 'create_content', { collection: 'blog', title: 'HTTP EN Readback', lang: 'en', translationOf: 'v60-pour-over' });
  check('HTTP i18n EN translationOf persisted', (await call(op3, 'read_content', { collection: 'blog', slug: en2.slug })).data.translationOf === 'v60-pour-over');
  await call(op3, 'delete_content', { collection: 'blog', slug: en2.slug });
  await op3.close();

  // Bozuk request target → 400, sunucu ÇÖKMEZ (regression: new URL try içinde olmalı).
  let malformedHandled = false;
  try {
    const raw = await new Promise((resolve, reject) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.write('GET http://localhost:badport/mcp HTTP/1.1\r\nHost: localhost\r\n\r\n');
      });
      let buf = '';
      const timer = setTimeout(() => { sock.destroy(); reject(new Error('raw socket timeout')); }, 5000);
      sock.on('data', (d) => { buf += d.toString(); if (buf.includes('\r\n\r\n')) { clearTimeout(timer); sock.destroy(); resolve(buf); } });
      sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    const alive = await fetch(`http://127.0.0.1:${port}/mcp`);
    malformedHandled = raw.startsWith('HTTP/1.1 400') && alive.status === 400;
  } catch { malformedHandled = false; }
  check('HTTP malformed target → 400 + server alive', malformedHandled);
} finally {
  child.kill();
}

console.log(fail === 0 ? '\nSMOKE-HTTP OK' : '\nSMOKE-HTTP FAILED (' + fail + ')');
process.exit(fail === 0 ? 0 : 1);
