import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySiteRepository } from '../../src/sites/infrastructure/in-memory-site.repository';
import { RegisterSite } from '../../src/sites/application/register-site';
import { ConfigureSiteLocales } from '../../src/sites/application/configure-site-locales';
import { GetSite } from '../../src/sites/application/get-site';
import { ListSites } from '../../src/sites/application/list-sites';
import {
  SiteAlreadyExistsError,
  SiteNotFoundError,
  SiteValidationError,
} from '../../src/sites/domain/errors';

function setup() {
  const repo = new InMemorySiteRepository();
  return {
    repo,
    register: new RegisterSite(repo),
    configure: new ConfigureSiteLocales(repo),
    get: new GetSite(repo),
    list: new ListSites(repo),
  };
}

const a = { id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' };
const b = { id: 'coffee', name: 'Coffee', locales: ['en', 'tr'], defaultLocale: 'en' };

test('RegisterSite siteyi kaydeder ve döner', async () => {
  const { register, get } = setup();
  const site = await register.execute(a);
  assert.equal(site.id, 'kahve');
  assert.equal(site.localePrefix('en'), '/en');
  const found = await get.execute('kahve');
  assert.equal(found.name, 'Kahve');
});

test('RegisterSite aynı id ile ikinci kaydı reddeder', async () => {
  const { register } = setup();
  await register.execute(a);
  await assert.rejects(() => register.execute(a), SiteAlreadyExistsError);
});

test('RegisterSite geçersiz props için domain hatası verir', async () => {
  const { register } = setup();
  await assert.rejects(() => register.execute({ ...a, defaultLocale: 'de' }), SiteValidationError);
});

test('ConfigureSiteLocales ana dili ve dilleri günceller, name korunur', async () => {
  const { register, configure } = setup();
  await register.execute(a);
  const updated = await configure.execute({ siteId: 'kahve', locales: ['en', 'tr'], defaultLocale: 'en' });
  assert.equal(updated.defaultLocale, 'en');
  assert.equal(updated.localePrefix('en'), '');
  assert.equal(updated.localePrefix('tr'), '/tr');
  assert.equal(updated.name, 'Kahve');
});

test('ConfigureSiteLocales olmayan site için hata verir', async () => {
  const { configure } = setup();
  await assert.rejects(
    () => configure.execute({ siteId: 'yok', locales: ['tr'], defaultLocale: 'tr' }),
    SiteNotFoundError,
  );
});

test('ConfigureSiteLocales geçersiz locale için hata verir', async () => {
  const { register, configure } = setup();
  await register.execute(a);
  await assert.rejects(
    () => configure.execute({ siteId: 'kahve', locales: ['tr'], defaultLocale: 'en' }),
    SiteValidationError,
  );
});

test('GetSite olmayan site için hata verir', async () => {
  const { get } = setup();
  await assert.rejects(() => get.execute('yok'), SiteNotFoundError);
});

test('ListSites boşken [] döner, sonra tüm siteleri döner', async () => {
  const { register, list } = setup();
  assert.deepEqual(await list.execute(), []);
  await register.execute(a);
  await register.execute(b);
  const all = await list.execute();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((s) => s.id).sort(), ['coffee', 'kahve']);
});

test('çoklu site: her site kendi ana dilini bağımsız tutar (A:/=TR, B:/=EN)', async () => {
  const { register, get } = setup();
  await register.execute(a);
  await register.execute(b);
  const siteA = await get.execute('kahve');
  const siteB = await get.execute('coffee');
  assert.equal(siteA.localePrefix('tr'), '');
  assert.equal(siteA.localePrefix('en'), '/en');
  assert.equal(siteB.localePrefix('en'), '');
  assert.equal(siteB.localePrefix('tr'), '/tr');
});