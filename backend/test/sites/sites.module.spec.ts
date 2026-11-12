import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { SitesModule } from '../../src/sites/sites.module';
import { RegisterSite } from '../../src/sites/application/register-site';
import { ConfigureSiteLocales } from '../../src/sites/application/configure-site-locales';
import { GetSite } from '../../src/sites/application/get-site';
import { ListSites } from '../../src/sites/application/list-sites';
import { SITE_REPOSITORY } from '../../src/sites/application/ports';
import { SiteAlreadyExistsError } from '../../src/sites/domain/errors';

test('SitesModule use-case\'leri DI ile çözer ve uçtan uca çalıştırır', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [SitesModule] }).compile();

  const register = moduleRef.get(RegisterSite);
  const configure = moduleRef.get(ConfigureSiteLocales);
  const get = moduleRef.get(GetSite);
  const list = moduleRef.get(ListSites);
  const repo = moduleRef.get(SITE_REPOSITORY);

  assert.ok(repo, 'SITE_REPOSITORY bağlanmalı');

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