import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module';
import { BUILD_RUNNER } from '../../src/builds/application/ports';
import { FakeBuildRunner } from '../builds/fake-build-runner';
import { PostgresTokenStore } from '../../src/security/infrastructure/postgres-token-store';
import { hashToken } from '../../src/security/application/token-store';
import { SkipTest } from '../sites/site-repository.contract';

// Postgres perimeter e2e: boot-seed agents + token verify DB üzerinden, gerçek express + fetch.
const url = process.env.DATABASE_URL;
const skip = url ? undefined : 'DATABASE_URL tanımlı değil — Postgres perimeter atlandı';

const AGENTS = {
  'content-studio': { name: 'İçerik Stüdyosu', perms: { create: true, edit: true, delete: true, commerce: false, publish: false } },
  reader: { name: 'Salt Okunur', perms: { create: false, edit: false, delete: false, commerce: false, publish: false } },
};
const TOKENS = { 'content-studio': 'astro_cs_pg', reader: 'astro_reader_pg' };
const validSite = { id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' };

const orig = {
  storage: process.env.ASTROPRESS_STORAGE,
  dbUrl: process.env.DATABASE_URL,
  state: process.env.ASTROPRESS_STATE,
  sitesFile: process.env.ASTROPRESS_SITES_FILE,
  agents: process.env.ASTROPRESS_AGENTS_FILE,
  auth: process.env.ASTROPRESS_AUTH,
  rateLimit: process.env.ASTROPRESS_RATE_LIMIT,
  redisUrl: process.env.REDIS_URL,
};
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (cleanup) { await cleanup(); cleanup = null; }
  const restore: Record<string, string | undefined> = {
    ASTROPRESS_STORAGE: orig.storage,
    DATABASE_URL: orig.dbUrl,
    ASTROPRESS_STATE: orig.state,
    ASTROPRESS_SITES_FILE: orig.sitesFile,
    ASTROPRESS_AGENTS_FILE: orig.agents,
    ASTROPRESS_AUTH: orig.auth,
    ASTROPRESS_RATE_LIMIT: orig.rateLimit,
    REDIS_URL: orig.redisUrl,
  };
  for (const [key, val] of Object.entries(restore)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
});

async function boot(opts: { auth?: 'header' | 'token'; tokens?: Record<string, string> } = {}): Promise<string> {
  const p = new Pool({ connectionString: url! });
  try {
    await p.query('SELECT 1');
    await p.query('CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, name TEXT NOT NULL, locales TEXT NOT NULL, default_locale TEXT NOT NULL)');
    await p.query('TRUNCATE sites');
    await p.query('DROP TABLE IF EXISTS agents');
    await p.query('DROP TABLE IF EXISTS agent_tokens');
  } catch {
    await p.end().catch(() => {});
    throw new SkipTest('Postgres sunucusuna ulaşılamıyor');
  }
  await p.end();
  process.env.ASTROPRESS_STORAGE = 'postgres';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-perimeter-pg-'));
  process.env.ASTROPRESS_STATE = dir;
  process.env.ASTROPRESS_SITES_FILE = path.join(dir, 'sites.json');
  const agentsFile = path.join(dir, 'agents.json');
  fs.writeFileSync(agentsFile, JSON.stringify(AGENTS), 'utf8');
  process.env.ASTROPRESS_AGENTS_FILE = agentsFile;
  if (opts.auth) process.env.ASTROPRESS_AUTH = opts.auth;
  else delete process.env.ASTROPRESS_AUTH;
  delete process.env.ASTROPRESS_RATE_LIMIT;
  delete process.env.REDIS_URL;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BUILD_RUNNER).useValue(new FakeBuildRunner())
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  app.useLogger(false);
  app.useBodyParser('json', { limit: '1mb' });
  await app.listen(0);
  if (opts.tokens) {
    const store = new PostgresTokenStore(url!);
    await store.init();
    for (const [agentId, plaintext] of Object.entries(opts.tokens)) await store.setHash(agentId, hashToken(plaintext));
    await store.close();
  }
  const port = (app.getHttpServer().address() as AddressInfo).port;
  cleanup = async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
    const c = new Pool({ connectionString: url! });
    try {
      await c.query('TRUNCATE sites');
      await c.query('DROP TABLE IF EXISTS agents');
      await c.query('DROP TABLE IF EXISTS agent_tokens');
    } finally { await c.end(); }
  };
  return `http://127.0.0.1:${port}`;
}

async function send(base: string, method: string, body?: unknown, agent?: string, bearer?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (agent) headers['X-Astropress-Agent'] = agent;
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  return fetch(base, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function withBoot(t: { skip: (m: string) => void }, opts: { auth?: 'header' | 'token'; tokens?: Record<string, string> }, fn: (base: string) => Promise<void>): Promise<void> {
  let base: string;
  try { base = await boot(opts); }
  catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  await fn(base);
}

test('postgres token mode: valid bearer POST sites → 201 (boot-seed agent)', { skip }, async (t) => {
  await withBoot(t, { auth: 'token', tokens: TOKENS }, async (base) => {
    assert.equal((await send(`${base}/sites`, 'POST', validSite, undefined, 'astro_cs_pg')).status, 201);
  });
});

test('postgres token mode: invalid bearer → 401', { skip }, async (t) => {
  await withBoot(t, { auth: 'token', tokens: TOKENS }, async (base) => {
    assert.equal((await send(`${base}/sites`, 'GET', undefined, undefined, 'astro_wrong')).status, 401);
  });
});

test('postgres token mode: reader bearer POST → 403 (RBAC seeded perms)', { skip }, async (t) => {
  await withBoot(t, { auth: 'token', tokens: TOKENS }, async (base) => {
    assert.equal((await send(`${base}/sites`, 'POST', validSite, undefined, 'astro_reader_pg')).status, 403);
  });
});

test('postgres header mode: bilinen agent GET → 200, unknown → 401 (orthogonal axis)', { skip }, async (t) => {
  await withBoot(t, {}, async (base) => {
    assert.equal((await send(`${base}/sites`, 'GET', undefined, 'reader')).status, 200);
    assert.equal((await send(`${base}/sites`, 'GET', undefined, 'hacker')).status, 401);
  });
});

test('cross-instance mint: dış store setHash → çalışan app bearer anında geçerli', { skip }, async (t) => {
  await withBoot(t, { auth: 'token' }, async (base) => {
    assert.equal((await send(`${base}/sites`, 'POST', validSite, undefined, 'astro_ext')).status, 401);
    const external = new PostgresTokenStore(url!);
    await external.init();
    try { await external.setHash('content-studio', hashToken('astro_ext')); }
    finally { await external.close(); }
    assert.equal((await send(`${base}/sites`, 'POST', validSite, undefined, 'astro_ext')).status, 201);
  });
});