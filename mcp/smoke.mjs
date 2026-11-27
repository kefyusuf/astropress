import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as store from './store.mjs';
import { ROOT } from './store.mjs';

const connect = async (agentId) => {
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['mcp/server.mjs'], cwd: ROOT,
    env: { ...process.env, ASTROPRESS_AGENT: agentId },
  });
  const client = new Client({ name: 'astropress-smoke', version: '0.0.0' });
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

// Smoke gerçek content tree üzerinde çalışır: oluşturulan slug'ları ve değiştirilen
// fiyatı izle; finally'de best-effort geri al (issue #16 — başarısız smoke artık
// gerçek içerikte yetim taslak/yayınlı kayıt/fiyat bırakmaz).
const createdSlugs = [];
const cleanup = { price: null, clients: [] };
function trackCleanup(client) {
  cleanup.clients.push(client);
  return client;
}
async function cleanupFinally() {
  for (const c of cleanup.clients) { try { await c.close(); } catch { /* zaten kapalı */ } }
  try {
    if (cleanup.price !== null) {
      const before = store.readContent('products', 'ethiopia-yirgacheffe');
      await store.writeContent('products', 'ethiopia-yirgacheffe', { ...before.data, price: cleanup.price }, before.body);
      console.log('CLEANUP  ethiopia-yirgacheffe price restored');
    }
  } catch { /* içerik yoksa/no-op */ }
  for (const slug of createdSlugs) {
    try { store.deleteContent('blog', slug); } catch { /* happy-path'te silinmiş */ }
  }
}

// Ana akış: insan-operatör (publish yetkili) — mevcut guardrail zinciri.
try {
  const op = trackCleanup(await connect('operator'));
  const base = await call(op, 'list_content');
  check('list_content returns array', Array.isArray(base));

  const who = await call(op, 'whoami');
  check('whoami returns operator perms', who.id === 'operator' && who.perms.publish === true);

  const created = await call(op, 'create_content', { collection: 'blog', title: 'MCP Smoke Test Yazısı', excerpt: 'Smoke testi taslağı.' });
  const slug = created.slug;
  createdSlugs.push(slug);
  check('create_content forces draft', created.status === 'draft');

  const read1 = await call(op, 'read_content', { collection: 'blog', slug });
  check('read_content shows draft', read1.data.status === 'draft');

  await call(op, 'run_build');
  check('guardrail: draft NOT in dist', !fs.existsSync(distPage(slug)));

  const req = await call(op, 'request_publish', { collection: 'blog', slug });
  check('request_publish queues approval', req.status === 'approval');
  const pending = await call(op, 'list_tasks', { status: 'approval' });
  check('task visible in approval queue', pending.some((t) => t.id === req.taskId));

  await call(op, 'approve_task', { taskId: req.taskId });
  const read2 = await call(op, 'read_content', { collection: 'blog', slug });
  check('approve_task publishes', read2.data.status === 'published');

  await call(op, 'run_build');
  check('published page IS in dist', fs.existsSync(distPage(slug)));

  await call(op, 'delete_content', { collection: 'blog', slug });
  createdSlugs.pop(); // happy-path'te silindi
  await call(op, 'run_build');
  check('delete removes page from dist', !fs.existsSync(distPage(slug)));

  const log = await call(op, 'audit_log', { limit: 50 });
  check('audit_log records actions', log.length > 0 && log.some((e) => e.action === 'approve_task'));

  // i18n: EN içerik /en/ rotasına düşer, TR rotasına sızmaz (dil ayrımı build'de doğrulanır).
  const enCreated = await call(op, 'create_content', { collection: 'blog', title: 'EN Smoke Post', lang: 'en', translationOf: 'v60-pour-over' });
  const enSlug = enCreated.slug;
  createdSlugs.push(enSlug);
  const enRead = await call(op, 'read_content', { collection: 'blog', slug: enSlug });
  check('i18n create carries lang=en + translationOf', enRead.data.lang === 'en' && enRead.data.translationOf === 'v60-pour-over');
  const enReq = await call(op, 'request_publish', { collection: 'blog', slug: enSlug });
  await call(op, 'approve_task', { taskId: enReq.taskId });
  await call(op, 'run_build');
  check('i18n EN page builds under /en/blog/', fs.existsSync(distEnPage(enSlug)));
  check('i18n EN page NOT in TR /blog/', !fs.existsSync(distPage(enSlug)));
  await call(op, 'delete_content', { collection: 'blog', slug: enSlug });
  createdSlugs.pop();
  await call(op, 'run_build');
  check('i18n EN delete removes /en/blog/ page', !fs.existsSync(distEnPage(enSlug)));

  await op.close();

  // RBAC: content-studio (create/edit/delete var, commerce/publish yok).
  const cs = trackCleanup(await connect('content-studio'));
  check('RBAC content-studio create allowed', (await call(cs, 'create_content', { collection: 'blog', title: 'RBAC Deneme' })).status === 'draft');
  createdSlugs.push('rbac-deneme');
  check('RBAC content-studio commerce denied', await denied(cs, 'update_content', { collection: 'products', slug: 'ethiopia-yirgacheffe', price: 999 }));
  check('RBAC content-studio approve denied', await denied(cs, 'approve_task', { taskId: 'x' }));
  await call(cs, 'delete_content', { collection: 'blog', slug: 'rbac-deneme' });
  createdSlugs.pop();
  await cs.close();

  // RBAC: commerce-bot (commerce var, create yok).
  const cb = trackCleanup(await connect('commerce-bot'));
  check('RBAC commerce-bot create denied', await denied(cb, 'create_content', { collection: 'blog', title: 'X' }));
  const before = await call(cb, 'read_content', { collection: 'products', slug: 'ethiopia-yirgacheffe' });
  cleanup.price = before.data.price; // smoke değiştirir, finally geri koyar (issue #16)
  check('RBAC commerce-bot price allowed', (await call(cb, 'update_content', { collection: 'products', slug: 'ethiopia-yirgacheffe', price: 420 })).status === 'published');
  await cb.close();

  // RBAC: reader (salt okunur).
  const rd = trackCleanup(await connect('reader'));
  check('RBAC reader create denied', await denied(rd, 'create_content', { collection: 'blog', title: 'X' }));
  check('RBAC reader delete denied', await denied(rd, 'delete_content', { collection: 'blog', slug: 'v60-pour-over' }));
  await rd.close();

  // Reddedilen eylemler audit'e yazıldı mı?
  const op2 = trackCleanup(await connect('operator'));
  const log2 = await call(op2, 'audit_log', { limit: 60 });
  check('RBAC denials audited', log2.some((e) => e.action === 'denied'));
  await op2.close();
} finally {
  await cleanupFinally();
}

console.log(fail === 0 ? '\nSMOKE OK' : '\nSMOKE FAILED (' + fail + ')');
process.exit(fail === 0 ? 0 : 1);
