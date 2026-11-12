import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SqliteSiteRepository } from '../../src/sites/infrastructure/sqlite-site.repository';
import { Site } from '../../src/sites/domain/site';
import { SiteValidationError } from '../../src/sites/domain/errors';

const temps: string[] = [];
function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-sqlite-'));
  temps.push(dir);
  return path.join(dir, 'sites.db');
}
afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop() as string, { recursive: true, force: true });
});

const a = Site.create({ id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' });

test('kalıcılık: close + reopen aynı veriyi okur', async () => {
  const file = tmpDb();
  const repo = new SqliteSiteRepository(file);
  await repo.save(a);
  repo.close();

  const reopened = new SqliteSiteRepository(file);
  const found = await reopened.findById('kahve');
  assert.ok(found);
  assert.equal(found.name, 'Kahve');
  assert.equal(found.localePrefix('en'), '/en');
  reopened.close();
});

test('locales JSON kolon olarak saklanır (SiteProps ile birebir)', async () => {
  const file = tmpDb();
  const repo = new SqliteSiteRepository(file);
  await repo.save(a);
  repo.close();

  const raw = new Database(file);
  const row = raw.prepare('SELECT locales, default_locale FROM sites WHERE id = ?').get('kahve') as { locales: string; default_locale: string };
  raw.close();
  assert.deepEqual(JSON.parse(row.locales), ['tr', 'en']);
  assert.equal(row.default_locale, 'tr');
});

test('read-time revalidation: bozuk satır Site.create ile reddedilir', async () => {
  const file = tmpDb();
  const repo = new SqliteSiteRepository(file);
  const raw = new Database(file);
  raw.prepare('INSERT INTO sites (id, name, locales, default_locale) VALUES (?, ?, ?, ?)')
    .run('bozuk', 'Bozuk', JSON.stringify(['tr']), 'en');
  raw.close();

  await assert.rejects(() => repo.findAll(), SiteValidationError);
  repo.close();
});