import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Site } from '../../src/sites/domain/site';
import { isValidLocale } from '../../src/sites/domain/locale';
import { SiteValidationError } from '../../src/sites/domain/errors';

const valid = { id: 'kahve', name: 'Kahve Sitesi', locales: ['tr', 'en'], defaultLocale: 'tr' };

test('Site.create geçerli props ile site üretir', () => {
  const site = Site.create(valid);
  assert.equal(site.id, 'kahve');
  assert.equal(site.name, 'Kahve Sitesi');
  assert.deepEqual([...site.locales], ['tr', 'en']);
  assert.equal(site.defaultLocale, 'tr');
});

test('defaultLocale locales içinde olmalı', () => {
  assert.throws(() => Site.create({ ...valid, defaultLocale: 'de' }), SiteValidationError);
});

test('locales boş olamaz', () => {
  assert.throws(() => Site.create({ ...valid, locales: [], defaultLocale: 'tr' }), SiteValidationError);
});

test('locales tekrarlı olamaz', () => {
  assert.throws(() => Site.create({ ...valid, locales: ['tr', 'tr'] }), SiteValidationError);
});

test('geçersiz locale kodu reddedilir', () => {
  assert.throws(() => Site.create({ ...valid, locales: ['tr', 'eng'] }), SiteValidationError);
  assert.equal(isValidLocale('tr'), true);
  assert.equal(isValidLocale('en'), true);
  assert.equal(isValidLocale('TR'), false);
  assert.equal(isValidLocale('t'), false);
  assert.equal(isValidLocale('eng'), false);
  assert.equal(isValidLocale(''), false);
});

test('id slug formatında olmalı', () => {
  assert.throws(() => Site.create({ ...valid, id: 'Kahve Sitesi' }), SiteValidationError);
  assert.throws(() => Site.create({ ...valid, id: '-kahve' }), SiteValidationError);
  assert.throws(() => Site.create({ ...valid, id: '' }), SiteValidationError);
});

test('name boş olamaz', () => {
  assert.throws(() => Site.create({ ...valid, name: '   ' }), SiteValidationError);
});

test('localePrefix: ana dil öneksiz, diğerleri /<locale>', () => {
  const site = Site.create(valid);
  assert.equal(site.localePrefix('tr'), '');
  assert.equal(site.localePrefix('en'), '/en');
});

test('localePrefix: site-başı ana dil değişebilir (B sitesi default en)', () => {
  const site = Site.create({ id: 'coffee', name: 'Coffee Site', locales: ['en', 'tr'], defaultLocale: 'en' });
  assert.equal(site.localePrefix('en'), '');
  assert.equal(site.localePrefix('tr'), '/tr');
});

test('hasLocale yapılandırılmış dilleri bilir', () => {
  const site = Site.create(valid);
  assert.equal(site.hasLocale('tr'), true);
  assert.equal(site.hasLocale('en'), true);
  assert.equal(site.hasLocale('de'), false);
});

test('localePrefix yapılandırılmamış dil için hata verir', () => {
  const site = Site.create(valid);
  assert.throws(() => site.localePrefix('de'), SiteValidationError);
});

test('locales dışarıdan mutate edilemez (defensive copy)', () => {
  const input = { ...valid, locales: ['tr', 'en'] };
  const site = Site.create(input);
  input.locales.push('de');
  assert.equal(site.hasLocale('de'), false);
});