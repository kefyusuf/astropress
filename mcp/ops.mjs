import { spawnSync } from 'node:child_process';
import path from 'node:path';
import * as store from './store.mjs';

// Guardrail'ler tek kaynak: create/update status'u asla değiştirmez;
// yayın yalnız requestPublish -> approve (insan) zinciriyle olur.
// RBAC: yetki matrisi sunucu tarafında zorunlu (perms). Reddedilen eylem audit'e yazılır.

function deny(actor, perms, key, detail) {
  if (!perms || !perms[key]) {
    store.audit(actor, 'denied', key + ' ' + detail);
    throw new Error('Yetki yok: ' + key);
  }
}

export function list({ collection, status } = {}) {
  return store.listContent(collection, status);
}

export function read({ collection, slug }) {
  return store.readContent(collection, slug);
}

export function create({ collection, title, excerpt, body, author, lang, translationOf }, actor = 'agent', perms) {
  deny(actor, perms, 'create', collection);
  const slug = store.uniqueSlug(collection, title);
  const data = {
    title, type: store.COLLECTIONS[collection], status: 'draft',
    author: author || (actor === 'human' ? 'İnsan' : 'Agent'),
    excerpt: excerpt || '',
    date: new Date().toISOString().slice(0, 10),
    seoTitle: '', seoDesc: '',
    lang: lang === 'en' ? 'en' : 'tr',
    translationOf: translationOf || '',
  };
  if (collection === 'products') { data.price = 0; data.stock = 0; }
  store.writeContent(collection, slug, data, body || ('# ' + title + '\n\nTaslak — insan incelemesi bekliyor.\n'));
  store.audit(actor, 'create_content', collection + '/' + slug);
  return { slug, status: 'draft', note: 'Yayın için request_publish + approve_task gerekir.' };
}

export function update({ collection, slug, title, excerpt, body, seoTitle, seoDesc, price, stock, lang, translationOf }, actor = 'agent', perms) {
  deny(actor, perms, 'edit', collection + '/' + slug);
  const wantsCommerce = price !== undefined || stock !== undefined;
  if (wantsCommerce) deny(actor, perms, 'commerce', collection + '/' + slug);
  const { data, body: oldBody } = store.readContent(collection, slug);
  if (title !== undefined) data.title = title;
  if (excerpt !== undefined) data.excerpt = excerpt;
  if (seoTitle !== undefined) data.seoTitle = seoTitle;
  if (seoDesc !== undefined) data.seoDesc = seoDesc;
  if (lang !== undefined) data.lang = lang === 'en' ? 'en' : 'tr';
  if (translationOf !== undefined) data.translationOf = translationOf;
  if (collection === 'products' && wantsCommerce) {
    if (price !== undefined) data.price = Number(price);
    if (stock !== undefined) data.stock = Number(stock);
  }
  store.writeContent(collection, slug, data, body !== undefined ? body : oldBody);
  store.audit(actor, 'update_content', collection + '/' + slug);
  return { slug, status: data.status };
}

export function remove({ collection, slug }, actor = 'agent', perms) {
  deny(actor, perms, 'delete', collection + '/' + slug);
  store.deleteContent(collection, slug);
  store.audit(actor, 'delete_content', collection + '/' + slug);
  return { deleted: collection + '/' + slug };
}

export function requestPublish({ collection, slug }, actor = 'agent') {
  const { data } = store.readContent(collection, slug);
  if (data.status === 'published') return { note: 'Zaten yayında.' };
  const tasks = store.readJSON('tasks.json', []);
  const id = 'task-' + (tasks.length + 1) + '-' + Date.now().toString(36);
  tasks.push({ id, collection, slug, title: data.title, status: 'approval', ts: new Date().toISOString() });
  store.writeJSON('tasks.json', tasks);
  store.audit(actor, 'request_publish', collection + '/' + slug);
  return { taskId: id, status: 'approval' };
}

// approve/reject insan yetkisi ister (perms.publish). Agent'lar publish:false olduğundan
// kendi isteğini kendi onaylayamaz — delik sunucu tarafında kapalı.
export function approve({ taskId }, actor = 'human', perms) {
  deny(actor, perms, 'publish', taskId);
  const tasks = store.readJSON('tasks.json', []);
  const t = tasks.find((x) => x.id === taskId);
  if (!t) throw new Error('Görev yok: ' + taskId);
  if (t.status !== 'approval') throw new Error('Görev onay beklemiyor: ' + t.status);
  const { data, body } = store.readContent(t.collection, t.slug);
  data.status = 'published';
  store.writeContent(t.collection, t.slug, data, body);
  t.status = 'done';
  store.writeJSON('tasks.json', tasks);
  store.audit(actor, 'approve_task', t.collection + '/' + t.slug);
  return { taskId, published: t.collection + '/' + t.slug };
}

export function reject({ taskId }, actor = 'human', perms) {
  deny(actor, perms, 'publish', taskId);
  const tasks = store.readJSON('tasks.json', []);
  const t = tasks.find((x) => x.id === taskId);
  if (!t) throw new Error('Görev yok: ' + taskId);
  t.status = 'rejected';
  store.writeJSON('tasks.json', tasks);
  store.audit(actor, 'reject_task', t.collection + '/' + t.slug);
  return { taskId, status: 'rejected' };
}

export function tasks({ status } = {}) {
  const all = store.readJSON('tasks.json', []);
  return status ? all.filter((t) => t.status === status) : all;
}

export function build(actor = 'agent') {
  const astroCli = path.join(store.ROOT, 'node_modules', 'astro', 'astro.js');
  const r = spawnSync(process.execPath, [astroCli, 'build'], { cwd: store.ROOT, encoding: 'utf8', timeout: 180000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  store.audit(actor, 'run_build', ok ? 'ok' : 'fail');
  return { ok, tail: out.split('\n').slice(-8).join('\n') };
}

export function audit({ limit } = {}) {
  const log = store.readJSON('audit.json', []);
  return log.slice(-(limit || 20));
}
