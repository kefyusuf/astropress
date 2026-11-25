import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Test } from '@nestjs/testing';
import { SitesModule } from '../../src/sites/sites.module';
import { RegisterSite } from '../../src/sites/application/register-site';
import { ConfigureSiteLocales } from '../../src/sites/application/configure-site-locales';
import { GetSite } from '../../src/sites/application/get-site';
import { ListSites } from '../../src/sites/application/list-sites';
import { SITE_REPOSITORY } from '../../src/sites/application/ports';
import { InMemorySiteRepository } from '../../src/sites/infrastructure/in-memory-site.repository';
import { FileSiteRepository } from '../../src/sites/infrastructure/file-site.repository';
import { SiteAlreadyExistsError } from '../../src/sites/domain/errors';

const orig = { storage: process.env.ASTROPRESS_STORAGE, file: process.env.ASTROPRESS_SITES_FILE };
afterEach(() => {
  if (orig.storage === undefined) delete process.env.ASTROPRESS_STORAGE;
  else process.env.ASTROPRESS_STORAGE = orig.storage;
  if (orig.file === undefined) delete process.env.ASTROPRESS_SITES_FILE;
  else process.env.ASTROPRESS_SITES_FILE = orig.file;
});

test('SitesModule memory modunda DI ile çözer ve uçtan uca çalıştırır', async () => {
  process.env.ASTROPRESS_STORAGE = 'memory';
  const moduleRef = await Test.createTestingModule({ imports: [SitesModule] }).compile();

  assert.ok(moduleRef.get(SITE_REPOSITORY) instanceof InMemorySiteRepository);
  const register = moduleRef.get(RegisterSite);
  const configure = moduleRef.get(ConfigureSiteLocales);
  const get = moduleRef.get(GetSite);
  const list = moduleRef.get(ListSites);

  const site = await register.execute({ id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' });
  assert.equal(site.localePrefix('en'), '/en');
  assert.equal((await get.execute('kahve')).id, 'kahve');
  assert.equal((await list.execute()).length, 1);

  const updated = await configure.execute({ siteId: 'kahve', locales: ['en', 'tr'], defaultLocale: 'en' });
  assert.equal(updated.localePrefix('en'), '');

  await assert.rejects(
    () => register.execute({ id: 'kahve', name: 'Kahve', locales: ['tr'], defaultLocale: 'tr' }),
    SiteAlreadyExistsError,
  );

  await moduleRef.close();
});

test('SitesModule file modunda git-native adapter bağlar ve kalıcı yazar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-di-'));
  const file = path.join(dir, 'sites.json');
  process.env.ASTROPRESS_STORAGE = 'file';
  process.env.ASTROPRESS_SITES_FILE = file;
  try {
    const moduleRef = await Test.createTestingModule({ imports: [SitesModule] }).compile();
    assert.ok(moduleRef.get(SITE_REPOSITORY) instanceof FileSiteRepository);

    const register = moduleRef.get(RegisterSite);
    await register.execute({ id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' });

    assert.ok(fs.existsSync(file), 'sites.json diske yazılmalı');
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(persisted[0].id, 'kahve');
    assert.equal(persisted[0].defaultLocale, 'tr');

    await moduleRef.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});