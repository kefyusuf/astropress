import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-store-'));
process.env.ASTROPRESS_CONTENT = path.join(tmp, 'content');
process.env.ASTROPRESS_STATE = path.join(tmp, 'state');
const store = await import('../mcp/store.mjs');

test('slugify: Türkçe karakterleri dönüştürür', () => {
  assert.equal(store.slugify('Köz Kahve'), 'koz-kahve');
  assert.equal(store.slugify('ĞÜŞÖÇİ'), 'gusoci');
});

test('slugify: alfanümerik olmayanları temizler, boşluğu tire yapar', () => {
  assert.equal(store.slugify('Hello, World!'), 'hello-world');
  assert.equal(store.slugify('  çok   boşluk  '), 'cok-bosluk');
});

test('slugify: boş girdi için fallback', () => {
  assert.equal(store.slugify('!!!'), 'icerik');
});

test('fileFor: geçersiz slug reddedilir (regex + path traversal)', () => {
  assert.throws(() => store.writeContent('blog', 'Bad Slug', {}, ''), /Geçersiz slug/);
  assert.throws(() => store.writeContent('blog', '../evil', {}, ''), /Geçersiz slug/);
  assert.throws(() => store.writeContent('blog', 'a/b', {}, ''), /Geçersiz slug/);
});

test('fileFor: bilinmeyen collection reddedilir', () => {
  assert.throws(() => store.writeContent('yok', 'gecerli', {}, ''), /Bilinmeyen collection/);
});

test('CRUD: yaz → oku → listele → sil', () => {
  store.writeContent('blog', 'crud-test', { title: 'CRUD', status: 'draft' }, '# Gövde\n');
  const r = store.readContent('blog', 'crud-test');
  assert.equal(r.data.title, 'CRUD');
  assert.match(r.body, /# Gövde/);
  assert.ok(store.listContent('blog').some((i) => i.id === 'crud-test'));
  store.deleteContent('blog', 'crud-test');
  assert.throws(() => store.readContent('blog', 'crud-test'), /İçerik yok/);
});

test('listContent: durum filtresi', () => {
  store.writeContent('blog', 'filtre-draft', { title: 'D', status: 'draft' }, '');
  store.writeContent('blog', 'filtre-pub', { title: 'P', status: 'published' }, '');
  const drafts = store.listContent('blog', 'draft');
  assert.ok(drafts.every((i) => i.status === 'draft'));
  assert.ok(drafts.some((i) => i.id === 'filtre-draft'));
  assert.ok(!drafts.some((i) => i.id === 'filtre-pub'));
});

test('uniqueSlug: çakışmada artırır', () => {
  store.writeContent('pages', 'tekil', { title: 'T' }, '');
  assert.equal(store.uniqueSlug('pages', 'tekil'), 'tekil-2');
  store.writeContent('pages', 'tekil-2', { title: 'T2' }, '');
  assert.equal(store.uniqueSlug('pages', 'tekil'), 'tekil-3');
});

test('audit: append-only jsonl yazar ve okur', () => {
  store.audit('test', 'deneme', 'detay');
  store.audit('test2', 'deneme2', 'detay2');
  const log = store.readAudit(10);
  assert.ok(log.some((e) => e.actor === 'test' && e.action === 'deneme'));
  assert.ok(log.some((e) => e.actor === 'test2' && e.action === 'deneme2'));
  // Append-only: iki kayıt da duruyor (200-kayıt kırpma yok).
  assert.ok(log.filter((e) => e.actor === 'test' || e.actor === 'test2').length >= 2);
});