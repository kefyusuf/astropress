import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-ops-'));
process.env.ASTROPRESS_CONTENT = path.join(tmp, 'content');
process.env.ASTROPRESS_STATE = path.join(tmp, 'state');
const store = await import('../mcp/store.mjs');
const ops = await import('../mcp/ops.mjs');

const FULL = { create: true, edit: true, delete: true, commerce: true, publish: true };
const STUDIO = { create: true, edit: true, delete: true, commerce: false, publish: false };
const COMMERCE = { create: false, edit: true, delete: false, commerce: true, publish: false };
const READER = { create: false, edit: false, delete: false, commerce: false, publish: false };

test('create: her zaman draft üretir', () => {
  const r = ops.create({ collection: 'blog', title: 'Guardrail Yazı' }, 'agent', FULL);
  assert.equal(r.status, 'draft');
  assert.equal(ops.read({ collection: 'blog', slug: r.slug }).data.status, 'draft');
});

test('create: lang + translationOf taşır', () => {
  const r = ops.create({ collection: 'blog', title: 'EN Post', lang: 'en', translationOf: 'guardrail-yazi' }, 'agent', FULL);
  const d = ops.read({ collection: 'blog', slug: r.slug }).data;
  assert.equal(d.lang, 'en');
  assert.equal(d.translationOf, 'guardrail-yazi');
});

test('create: create yetkisi yoksa reddeder + audit', () => {
  assert.throws(() => ops.create({ collection: 'blog', title: 'X' }, 'reader', READER), /Yetki yok: create/);
  assert.ok(ops.audit({ limit: 50 }).some((e) => e.action === 'denied' && /create/.test(e.detail)));
});

test('update: status alanını değiştiremez (draft kalır)', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'Status Korunur' }, 'agent', FULL);
  ops.update({ collection: 'blog', slug, title: 'Yeni Başlık', status: 'published' }, 'agent', FULL);
  const d = ops.read({ collection: 'blog', slug }).data;
  assert.equal(d.title, 'Yeni Başlık');
  assert.equal(d.status, 'draft');
});

test('update: fiyat commerce yetkisi ister', () => {
  const { slug } = ops.create({ collection: 'products', title: 'Ürün' }, 'human', FULL);
  assert.throws(() => ops.update({ collection: 'products', slug, price: 999 }, 'content-studio', STUDIO), /Yetki yok: commerce/);
  const ok = ops.update({ collection: 'products', slug, price: 250, stock: 7 }, 'commerce-bot', COMMERCE);
  assert.equal(ok.status, 'draft');
  const d = ops.read({ collection: 'products', slug }).data;
  assert.equal(d.price, 250);
  assert.equal(d.stock, 7);
});

test('update: edit yetkisi yoksa reddeder', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'Edit Yok' }, 'human', FULL);
  assert.throws(() => ops.update({ collection: 'blog', slug, title: 'X' }, 'reader', READER), /Yetki yok: edit/);
});

test('remove: delete yetkisi ister', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'Silinecek' }, 'human', FULL);
  assert.throws(() => ops.remove({ collection: 'blog', slug }, 'reader', READER), /Yetki yok: delete/);
  ops.remove({ collection: 'blog', slug }, 'human', FULL);
  assert.throws(() => ops.read({ collection: 'blog', slug }), /İçerik yok/);
});

test('yayın zinciri: requestPublish → approve (publish yetkili)', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'Yayın Akışı' }, 'agent', FULL);
  const req = ops.requestPublish({ collection: 'blog', slug }, 'agent');
  assert.equal(req.status, 'approval');
  assert.ok(ops.tasks({ status: 'approval' }).some((t) => t.id === req.taskId));
  const ap = ops.approve({ taskId: req.taskId }, 'human', FULL);
  assert.equal(ap.published, 'blog/' + slug);
  assert.equal(ops.read({ collection: 'blog', slug }).data.status, 'published');
});

test('approve: publish yetkisi yoksa agent kendi onaylayamaz', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'Self Approve' }, 'agent', STUDIO);
  const req = ops.requestPublish({ collection: 'blog', slug }, 'agent');
  assert.throws(() => ops.approve({ taskId: req.taskId }, 'content-studio', STUDIO), /Yetki yok: publish/);
  assert.equal(ops.read({ collection: 'blog', slug }).data.status, 'draft');
});

test('reject: publish yetkisi ister, içerik taslak kalır', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'Reddedilecek' }, 'agent', FULL);
  const req = ops.requestPublish({ collection: 'blog', slug }, 'agent');
  assert.throws(() => ops.reject({ taskId: req.taskId }, 'agent', STUDIO), /Yetki yok: publish/);
  ops.reject({ taskId: req.taskId }, 'human', FULL);
  assert.equal(ops.read({ collection: 'blog', slug }).data.status, 'draft');
  assert.ok(ops.tasks().find((t) => t.id === req.taskId).status === 'rejected');
});

test('approve: bilinmeyen görev hatası', () => {
  assert.throws(() => ops.approve({ taskId: 'yok' }, 'human', FULL), /Görev yok/);
});

test('list: collection filtresi', () => {
  const blogs = ops.list({ collection: 'blog' });
  assert.ok(blogs.length > 0 && blogs.every((i) => i.collection === 'blog'));
});