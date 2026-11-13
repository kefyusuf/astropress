import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { SkipTest } from './site-repository.contract';

// Postgres HTTP e2e: gerçek express + fetch, gerçek Postgres sunucusu.
// Skip-if-unavailable: DATABASE_URL unset → static skip; ulaşılamaz → t.skip().
const url = process.env.DATABASE_URL;
const skip = url ? undefined : 'DATABASE_URL tanımlı değil — Postgres e2e atlandı';
const orig = { storage: process.env.ASTROPRESS_STORAGE, dbUrl: process.env.DATABASE_URL };
let cleanup: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (cleanup) { await cleanup(); cleanup = null; }
  if (orig.storage === undefined) delete process.env.ASTROPRESS_STORAGE;
  else process.env.ASTROPRESS_STORAGE = orig.storage;
  if (orig.dbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = orig.dbUrl;
});

async function boot(): Promise<string> {
  const p = new Pool({ connectionString: url! });
  try {
    await p.query('SELECT 1');
    await p.query(`CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, name TEXT NOT NULL, locales TEXT NOT NULL, default_locale TEXT NOT NULL)`);
    await p.query('TRUNCATE sites');
  } catch {
    await p.end().catch(() => {});
    throw new SkipTest('Postgres sunucusuna ulaşılamıyor');
  }
  await p.end();
  process.env.ASTROPRESS_STORAGE = 'postgres';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  cleanup = async () => {
    await app.close();
    const c = new Pool({ connectionString: url! });
    try { await c.query('TRUNCATE sites'); } finally { await c.end(); }
  };
  return `http://127.0.0.1:${port}`;
}

function send(base: string, method: string, body?: unknown) {
  return fetch(base, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const valid = { id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' };

test('HTTP API postgres modunda: POST → GET → PUT zinciri (controller→use-case→DB)', { skip }, async (t) => {
  let base: string;
  try { base = await boot(); }
  catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  assert.deepEqual(await (await fetch(`${base}/sites`)).json(), []);
  assert.equal((await send(`${base}/sites`, 'POST', valid)).status, 201);
  const found = await fetch(`${base}/sites/kahve`);
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), valid);
  const put = await send(`${base}/sites/kahve/locales`, 'PUT', { locales: ['en', 'tr'], defaultLocale: 'en' });
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), { id: 'kahve', name: 'Kahve', locales: ['en', 'tr'], defaultLocale: 'en' });
  assert.equal((await fetch(`${base}/sites/yok`)).status, 404);
});