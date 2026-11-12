import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileSiteRepository } from '../../src/sites/infrastructure/file-site.repository';
import { Site } from '../../src/sites/domain/site';
import { SiteValidationError } from '../../src/sites/domain/errors';

const temps: string[] = [];
function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-sites-'));
  temps.push(dir);
  return path.join(dir, 'sites.json');
}
afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop() as string, { recursive: true, force: true });
});

const a = Site.create({ id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' });
const b = Site.create({ id: 'coffee', name: 'Coffee', locales: ['en', 'tr'], defaultLocale: 'en' });

test('boş registry: dosya yokken findById null, findAll [], exists false', async () => {
  const repo = new FileSiteRepository(tmpFile());
  assert.equal(await repo.findById('kahve'), null);
  assert.deepEqual(await repo.findAll(), []);
  assert.equal(await repo.exists('kahve'), false);
});

test('save + findById aynı instance üzerinden okur', async () => {
  const repo = new FileSiteRepository(tmpFile());
  await repo.save(a);
  const found = await repo.findById('kahve');
  assert.ok(found);
  assert.equal(found.id, 'kahve');
  assert.equal(found.localePrefix('en'), '/en');
  assert.equal(await repo.exists('kahve'), true);
});

test('git-native kalıcılık: yeni instance aynı dosyayı okur', async () => {
  const file = tmpFile();
  await new FileSiteRepository(file).save(a);
  const reopened = new FileSiteRepository(file);
  const found = await reopened.findById('kahve');
  assert.ok(found);
  assert.equal(found.name, 'Kahve');
  assert.equal(found.defaultLocale, 'tr');
});

test('save upsert: aynı id günceller, findAll tekil kalır', async () => {
  const repo = new FileSiteRepository(tmpFile());
  await repo.save(a);
  const flipped = Site.create({ id: 'kahve', name: 'Kahve', locales: ['en', 'tr'], defaultLocale: 'en' });
  await repo.save(flipped);
  const all = await repo.findAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].defaultLocale, 'en');
  assert.equal(all[0].localePrefix('en'), '');
});

test('findAll tüm siteleri döner; site-başı ana dil korunur', async () => {
  const repo = new FileSiteRepository(tmpFile());
  await repo.save(a);
  await repo.save(b);
  const all = await repo.findAll();
  assert.equal(all.length, 2);
  const siteA = all.find((s) => s.id === 'kahve');
  const siteB = all.find((s) => s.id === 'coffee');
  assert.ok(siteA && siteB);
  assert.equal(siteA.localePrefix('tr'), '');
  assert.equal(siteB.localePrefix('en'), '');
});

test('dosya formatı: SiteProps JSON array (git-native, insan-okunur)', async () => {
  const file = tmpFile();
  await new FileSiteRepository(file).save(a);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(raw));
  assert.deepEqual(raw[0], { id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' });
});

test('persisted veri read-time yeniden validate edilir (Site.create)', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify([{ id: 'Bad Slug', name: 'X', locales: ['tr'], defaultLocale: 'tr' }]), 'utf8');
  const repo = new FileSiteRepository(file);
  await assert.rejects(() => repo.findAll(), SiteValidationError);
});