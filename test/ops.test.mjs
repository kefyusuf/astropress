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

const FULL = { create: true, edit: true, delete: true, commerce: true, publish: true, build: true };
const STUDIO = { create: true, edit: true, delete: true, commerce: false, publish: false, build: false };
const COMMERCE = { create: false, edit: true, delete: false, commerce: true, publish: false, build: false };
const READER = { create: false, edit: false, delete: false, commerce: false, publish: false, build: false };

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
  const req = ops.requestPublish({ collection: 'blog', slug }, 'agent', FULL);
  assert.equal(req.status, 'approval');
  assert.ok(ops.tasks({ status: 'approval' }).some((t) => t.id === req.taskId));
  const ap = ops.approve({ taskId: req.taskId }, 'human', FULL);
  assert.equal(ap.published, 'blog/' + slug);
  assert.equal(ops.read({ collection: 'blog', slug }).data.status, 'published');
});

test('approve: publish yetkisi yoksa agent kendi onaylayamaz', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'Self Approve' }, 'agent', STUDIO);
  const req = ops.requestPublish({ collection: 'blog', slug }, 'agent', STUDIO);
  assert.throws(() => ops.approve({ taskId: req.taskId }, 'content-studio', STUDIO), /Yetki yok: publish/);
  assert.equal(ops.read({ collection: 'blog', slug }).data.status, 'draft');
});

test('reject: publish yetkisi ister, içerik taslak kalır', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'Reddedilecek' }, 'agent', FULL);
  const req = ops.requestPublish({ collection: 'blog', slug }, 'agent', FULL);
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

// --- Issue #9: RBAC, published koruması, TOCTOU, doğrulama ---

test('requestPublish: edit yetkisi ister — reader denied (kabul kriteri)', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'RP Reader' }, 'human', FULL);
  assert.throws(() => ops.requestPublish({ collection: 'blog', slug }, 'reader', READER), /Yetki yok: edit/);
});

test('requestPublish: aynı kayıt için bekleyen mükerrer görev açılmaz', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'Dedup' }, 'human', FULL);
  const r1 = ops.requestPublish({ collection: 'blog', slug }, 'human', FULL);
  const r2 = ops.requestPublish({ collection: 'blog', slug }, 'human', FULL);
  assert.equal(r2.taskId, r1.taskId);
  assert.match(r2.note, /bekleyen onay görevi/);
});

test('requestPublish: contentHash + requestedBy saklanır; taslak değişirse approve hata verir (TOCTOU)', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'Hash Guard' }, 'human', FULL);
  const req = ops.requestPublish({ collection: 'blog', slug }, 'human', FULL);
  const t = ops.tasks({ status: 'approval' }).find((x) => x.id === req.taskId);
  assert.equal(t.requestedBy, 'human');
  assert.match(t.contentHash, /^[0-9a-f]{64}$/);
  ops.update({ collection: 'blog', slug, title: 'Onay Sonrası Değişim' }, 'human', FULL);
  assert.throws(() => ops.approve({ taskId: req.taskId }, 'human', FULL), /değişti/);
});

test('update: yayındaki içerik düzenlemesi review\u2019a düşer; commerce-only yayın bozmaz', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'Pub Edit' }, 'human', FULL);
  const req = ops.requestPublish({ collection: 'blog', slug }, 'human', FULL);
  ops.approve({ taskId: req.taskId }, 'human', FULL);
  const r = ops.update({ collection: 'blog', slug, title: 'Yayında Değişim' }, 'human', FULL);
  assert.equal(r.status, 'review');
  assert.match(r.note, /inceleme revizyonu/);

  const p = ops.create({ collection: 'products', title: 'Ürün P' }, 'human', FULL);
  const preq = ops.requestPublish({ collection: 'products', slug: p.slug }, 'human', FULL);
  ops.approve({ taskId: preq.taskId }, 'human', FULL);
  const pr = ops.update({ collection: 'products', slug: p.slug, price: 42, stock: 3 }, 'commerce-bot', COMMERCE);
  assert.equal(pr.status, 'published');
  assert.equal(pr.note, undefined);
});

test('update: negatif/sonlu olmayan price ve stock reddedilir (YAML .nan/.inf önleme)', () => {
  const { slug } = ops.create({ collection: 'products', title: 'Validation' }, 'human', FULL);
  assert.throws(() => ops.update({ collection: 'products', slug, price: -5 }, 'commerce-bot', COMMERCE), /Geçersiz price/);
  assert.throws(() => ops.update({ collection: 'products', slug, stock: Number.NaN }, 'commerce-bot', COMMERCE), /Geçersiz stock/);
  assert.throws(() => ops.update({ collection: 'products', slug, stock: Infinity }, 'commerce-bot', COMMERCE), /Geçersiz stock/);
});

test('remove: yayındaki kayıt delete yetkisiyle silinemez (kabul kriteri)', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'PubDel' }, 'human', FULL);
  const req = ops.requestPublish({ collection: 'blog', slug }, 'human', FULL);
  ops.approve({ taskId: req.taskId }, 'human', FULL);
  assert.throws(() => ops.remove({ collection: 'blog', slug }, 'content-studio', STUDIO), /Yetki yok: publish/);
  ops.remove({ collection: 'blog', slug }, 'human', FULL); // publish yetkili silebilir
});

test('reject: onay beklemeyen görev reddedilemez', () => {
  const { slug } = ops.create({ collection: 'blog', title: 'RejectGuard' }, 'human', FULL);
  const req = ops.requestPublish({ collection: 'blog', slug }, 'human', FULL);
  ops.approve({ taskId: req.taskId }, 'human', FULL);
  assert.throws(() => ops.reject({ taskId: req.taskId }, 'human', FULL), /onay beklemiyor/);
});

test('build: build yetkisi ister — reader denied', () => {
  assert.throws(() => ops.build('reader', READER), /Yetki yok: build/);
});

test('audit: gerçek aktör kimliği jsonl\u2019e yazılır (KIND flattening yok)', () => {
  ops.create({ collection: 'blog', title: 'Audit Actor' }, 'content-studio', STUDIO);
  const log = ops.audit({ limit: 100 });
  const entry = log.find((e) => e.action === 'create_content' && e.detail.includes('audit-actor'));
  assert.ok(entry, 'create_content audit kaydı bulunamadı');
  assert.equal(entry.actor, 'content-studio');
});