import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

// P2.1 HTTP API e2e: gerçek express sunucusu (rastgele port) + gerçek fetch.
// Her test izole temp sites.json üzerinde koşar; committed config'e dokunmaz.
const orig = { storage: process.env.ASTROPRESS_STORAGE, file: process.env.ASTROPRESS_SITES_FILE };
let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) { await cleanup(); cleanup = null; }
  if (orig.storage === undefined) delete process.env.ASTROPRESS_STORAGE;
  else process.env.ASTROPRESS_STORAGE = orig.storage;
  if (orig.file === undefined) delete process.env.ASTROPRESS_SITES_FILE;
  else process.env.ASTROPRESS_SITES_FILE = orig.file;
});

async function boot(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-http-'));
  const file = path.join(dir, 'sites.json');
  process.env.ASTROPRESS_STORAGE = 'file';
  process.env.ASTROPRESS_SITES_FILE = file;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  cleanup = async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return `http://127.0.0.1:${port}`;
}

function send(url: string, method: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const valid = { id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' };

test('GET /sites boş registry → 200 []', async () => {
  const url = await boot();
  const res = await fetch(`${url}/sites`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), []);
});

test('POST /sites geçerli site → 201 + JSON gövde + diske kalıcı', async () => {
  const url = await boot();
  const res = await send(`${url}/sites`, 'POST', valid);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), valid);

  const list = await (await fetch(`${url}/sites`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'kahve');

  const persisted = JSON.parse(fs.readFileSync(process.env.ASTROPRESS_SITES_FILE as string, 'utf8'));
  assert.deepEqual(persisted[0], valid);
});

test('POST /sites aynı id tekrar → 409', async () => {
  const url = await boot();
  assert.equal((await send(`${url}/sites`, 'POST', valid)).status, 201);
  const dup = await send(`${url}/sites`, 'POST', valid);
  assert.equal(dup.status, 409);
});

test('POST /sites geçersiz gövde → 400 (slug/name/locale/defaultLocale)', async () => {
  const url = await boot();
  const invalids = [
    { id: 'Bad Slug', name: 'X', locales: ['tr'], defaultLocale: 'tr' },
    { id: 'ok', name: '   ', locales: ['tr'], defaultLocale: 'tr' },
    { id: 'ok', name: 'X', locales: [], defaultLocale: 'tr' },
    { id: 'ok', name: 'X', locales: ['tr'], defaultLocale: 'en' },
    { id: 'ok', name: 'X', locales: ['tr-TR'], defaultLocale: 'tr-TR' },
  ];
  for (const body of invalids) {
    const res = await send(`${url}/sites`, 'POST', body);
    assert.equal(res.status, 400, `beklenen 400: ${JSON.stringify(body)}`);
  }
});

test('GET /sites/:id var → 200, yok → 404', async () => {
  const url = await boot();
  await send(`${url}/sites`, 'POST', valid);
  const found = await fetch(`${url}/sites/kahve`);
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), valid);
  const missing = await fetch(`${url}/sites/yok`);
  assert.equal(missing.status, 404);
});

test('PUT /sites/:id/locales geçerli → 200 güncellenir', async () => {
  const url = await boot();
  await send(`${url}/sites`, 'POST', valid);
  const res = await send(`${url}/sites/kahve/locales`, 'PUT', { locales: ['en', 'tr'], defaultLocale: 'en' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { id: 'kahve', name: 'Kahve', locales: ['en', 'tr'], defaultLocale: 'en' });
});

test('PUT /sites/:id/locales bilinmeyen site → 404', async () => {
  const url = await boot();
  const res = await send(`${url}/sites/yok/locales`, 'PUT', { locales: ['tr'], defaultLocale: 'tr' });
  assert.equal(res.status, 404);
});

test('PUT /sites/:id/locales geçersiz → 400', async () => {
  const url = await boot();
  await send(`${url}/sites`, 'POST', valid);
  const res = await send(`${url}/sites/kahve/locales`, 'PUT', { locales: ['tr'], defaultLocale: 'en' });
  assert.equal(res.status, 400);
});