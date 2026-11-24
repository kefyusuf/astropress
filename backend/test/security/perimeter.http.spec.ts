import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module';
import { BUILD_RUNNER } from '../../src/builds/application/ports';
import { FakeBuildRunner } from '../builds/fake-build-runner';

const DEFAULT_AGENTS = {
  operator: { name: 'İnsan Operatör', perms: { create: true, edit: true, delete: true, commerce: true, publish: true } },
  'content-studio': { name: 'İçerik Stüdyosu', perms: { create: true, edit: true, delete: true, commerce: false, publish: false } },
  'commerce-bot': { name: 'Commerce Bot', perms: { create: false, edit: true, delete: false, commerce: true, publish: false } },
  'seo-agent': { name: 'SEO Agent', perms: { create: false, edit: true, delete: false, commerce: false, publish: false } },
  reader: { name: 'Salt Okunur', perms: { create: false, edit: false, delete: false, commerce: false, publish: false } },
};

const validSite = { id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' };

const orig = {
  state: process.env.ASTROPRESS_STATE,
  sitesFile: process.env.ASTROPRESS_SITES_FILE,
  agents: process.env.ASTROPRESS_AGENTS_FILE,
  rateLimit: process.env.ASTROPRESS_RATE_LIMIT,
  allowAnyHost: process.env.ASTROPRESS_ALLOW_ANY_HOST,
  redisUrl: process.env.REDIS_URL,
};
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (cleanup) { await cleanup(); cleanup = null; }
  const restore: Record<string, string | undefined> = {
    ASTROPRESS_STATE: orig.state,
    ASTROPRESS_SITES_FILE: orig.sitesFile,
    ASTROPRESS_AGENTS_FILE: orig.agents,
    ASTROPRESS_RATE_LIMIT: orig.rateLimit,
    ASTROPRESS_ALLOW_ANY_HOST: orig.allowAnyHost,
    REDIS_URL: orig.redisUrl,
  };
  for (const [key, val] of Object.entries(restore)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
});

// main.ts production parser config'ini replike eder (spec §8): AppModule-boot testleri main.ts'yi görmez.
async function boot(opts: { agents?: Record<string, unknown>; rateLimit?: number; runner?: FakeBuildRunner } = {}): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-perimeter-'));
  process.env.ASTROPRESS_STATE = dir;
  // Sites file adapter ASTROPRESS_SITES_FILE ile izole edilir (sites.http.spec.ts emsali);
  // yoksa POST committed kök sites.json'a yazar → config kirlenir + test idempotent olmaz.
  process.env.ASTROPRESS_SITES_FILE = path.join(dir, 'sites.json');
  const agentsFile = path.join(dir, 'agents.json');
  fs.writeFileSync(agentsFile, JSON.stringify(opts.agents ?? DEFAULT_AGENTS), 'utf8');
  process.env.ASTROPRESS_AGENTS_FILE = agentsFile;
  if (opts.rateLimit !== undefined) process.env.ASTROPRESS_RATE_LIMIT = String(opts.rateLimit);
  else delete process.env.ASTROPRESS_RATE_LIMIT;
  // Perimeter testleri guard davranışını doğrular (storage-agnostic): her boot taze in-memory
  // throttler ister. Ambient REDIS_URL Redis storage'ı boot'lar arası kalıcı yapar → state leak.
  // Redis STORAGE doğruluğu ayrı redis-throttler.spec.ts'de (flushdb izolasyonlu) test edilir.
  delete process.env.REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BUILD_RUNNER).useValue(opts.runner ?? new FakeBuildRunner())
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  // Kasıtlı 413 (PayloadTooLargeError, HttpException değil) Nest ExceptionsHandler ERROR log'u basar → test çıktısı pristine kalsın.
  app.useLogger(false);
  app.useBodyParser('json', { limit: '1mb' });
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  cleanup = async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return `http://127.0.0.1:${port}`;
}

async function send(url: string, method: string, body?: unknown, agent?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (agent) headers['X-Astropress-Agent'] = agent;
  return fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

// Host header'ı kesin kontrol için raw socket (undici Host override belirsiz; mcp/smoke-http.mjs emsali).
function rawStatus(url: string, host: string, agent?: string): Promise<number> {
  const port = Number(new URL(url).port);
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      const lines = ['GET /sites HTTP/1.1', `Host: ${host}`, 'Connection: close'];
      if (agent) lines.push(`X-Astropress-Agent: ${agent}`);
      sock.write(lines.join('\r\n') + '\r\n\r\n');
    });
    let buf = '';
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('raw socket timeout')); }, 5000);
    sock.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('\r\n\r\n')) { clearTimeout(timer); sock.destroy(); resolve(Number(buf.split(' ')[1])); }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// --- HOST ---
test('host: evil Host header → 403', async () => {
  const url = await boot();
  assert.equal(await rawStatus(url, 'evil.com'), 403);
});

test('host: localhost Host header → 200', async () => {
  const url = await boot();
  assert.equal(await rawStatus(url, 'localhost'), 200);
});

test('host: 127.0.0.1 Host header → 200', async () => {
  const url = await boot();
  assert.equal(await rawStatus(url, '127.0.0.1'), 200);
});

test('host: ASTROPRESS_ALLOW_ANY_HOST=1 → evil Host passes', async () => {
  const url = await boot();
  process.env.ASTROPRESS_ALLOW_ANY_HOST = '1';
  assert.equal(await rawStatus(url, 'evil.com'), 200);
});

// --- IDENTITY ---
test('identity: no header → default content-studio (POST sites → 201)', async () => {
  const url = await boot();
  const res = await send(`${url}/sites`, 'POST', validSite);
  assert.equal(res.status, 201);
});

test('identity: unknown agent header → 401', async () => {
  const url = await boot();
  const res = await send(`${url}/sites`, 'GET', undefined, 'hacker');
  assert.equal(res.status, 401);
});

// --- BODY ---
test('body: >1MB POST → 413', async () => {
  const url = await boot();
  const big = { id: 'x', name: 'a'.repeat(2 * 1024 * 1024), locales: ['tr'], defaultLocale: 'tr' };
  const res = await send(`${url}/sites`, 'POST', big);
  assert.equal(res.status, 413);
});

// --- RBAC ---
test('rbac: reader GET sites → 200 (public read)', async () => {
  const url = await boot();
  const res = await send(`${url}/sites`, 'GET', undefined, 'reader');
  assert.equal(res.status, 200);
});

test('rbac: reader POST sites → 403 (create denied)', async () => {
  const url = await boot();
  const res = await send(`${url}/sites`, 'POST', validSite, 'reader');
  assert.equal(res.status, 403);
});

test('rbac: content-studio POST sites → 201 (create allowed)', async () => {
  const url = await boot();
  const res = await send(`${url}/sites`, 'POST', validSite, 'content-studio');
  assert.equal(res.status, 201);
});

test('rbac: commerce-bot POST sites → 403 (create:false)', async () => {
  const url = await boot();
  const res = await send(`${url}/sites`, 'POST', validSite, 'commerce-bot');
  assert.equal(res.status, 403);
});

test('rbac: seo-agent PUT locales → 200 (edit allowed)', async () => {
  const url = await boot();
  await send(`${url}/sites`, 'POST', validSite, 'content-studio');
  const res = await send(`${url}/sites/kahve/locales`, 'PUT', { locales: ['tr', 'en'], defaultLocale: 'tr' }, 'seo-agent');
  assert.equal(res.status, 200);
});

test('rbac: reader PUT locales → 403 (edit denied)', async () => {
  const url = await boot();
  await send(`${url}/sites`, 'POST', validSite, 'content-studio');
  const res = await send(`${url}/sites/kahve/locales`, 'PUT', { locales: ['tr', 'en'], defaultLocale: 'tr' }, 'reader');
  assert.equal(res.status, 403);
});

test('rbac: content-studio POST builds → 201 (edit allowed)', async () => {
  const url = await boot();
  const res = await send(`${url}/builds`, 'POST', {}, 'content-studio');
  assert.equal(res.status, 201);
});

test('rbac: reader POST builds → 403 (edit denied, resource gap closed)', async () => {
  const url = await boot();
  const res = await send(`${url}/builds`, 'POST', {}, 'reader');
  assert.equal(res.status, 403);
});

// --- RATE-LIMIT ---
test('rate-limit: mutation over low limit → 429', async () => {
  const url = await boot({ rateLimit: 2 });
  assert.equal((await send(`${url}/builds`, 'POST', {}, 'content-studio')).status, 201);
  assert.equal((await send(`${url}/builds`, 'POST', {}, 'content-studio')).status, 201);
  assert.equal((await send(`${url}/builds`, 'POST', {}, 'content-studio')).status, 429);
});

test('rate-limit: GET exempt (many GETs, no 429)', async () => {
  const url = await boot({ rateLimit: 2 });
  for (let i = 0; i < 5; i++) {
    assert.equal((await send(`${url}/sites`, 'GET', undefined, 'content-studio')).status, 200);
  }
});

test('rate-limit: per-agent isolation (A throttled, B passes)', async () => {
  const url = await boot({ rateLimit: 2 });
  await send(`${url}/builds`, 'POST', {}, 'content-studio');
  await send(`${url}/builds`, 'POST', {}, 'content-studio');
  assert.equal((await send(`${url}/builds`, 'POST', {}, 'content-studio')).status, 429);
  assert.equal((await send(`${url}/builds`, 'POST', {}, 'commerce-bot')).status, 201);
});