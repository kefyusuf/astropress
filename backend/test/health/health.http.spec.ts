import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { BUILD_RUNNER } from '../../src/builds/application/ports';
import { FakeBuildRunner } from '../builds/fake-build-runner';

// Health yüzeyi: file mode (infra'sız), perimeter boot deseni (perimeter.http.spec.ts emsali).
const orig = {
  state: process.env.ASTROPRESS_STATE,
  sitesFile: process.env.ASTROPRESS_SITES_FILE,
  agents: process.env.ASTROPRESS_AGENTS_FILE,
  auth: process.env.ASTROPRESS_AUTH,
  redis: process.env.REDIS_URL,
};
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (cleanup) { await cleanup(); cleanup = null; }
  for (const [k, v] of [['ASTROPRESS_STATE', orig.state], ['ASTROPRESS_SITES_FILE', orig.sitesFile], ['ASTROPRESS_AGENTS_FILE', orig.agents], ['ASTROPRESS_AUTH', orig.auth], ['REDIS_URL', orig.redis]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

async function boot(auth?: 'header' | 'token'): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-health-'));
  process.env.ASTROPRESS_STATE = dir;
  process.env.ASTROPRESS_SITES_FILE = path.join(dir, 'sites.json');
  const agentsFile = path.join(dir, 'agents.json');
  fs.writeFileSync(agentsFile, JSON.stringify({
    'content-studio': { name: 'İçerik Stüdyosu', perms: { create: true, edit: true, delete: true, commerce: false, publish: false } },
  }), 'utf8');
  process.env.ASTROPRESS_AGENTS_FILE = agentsFile;
  if (auth) process.env.ASTROPRESS_AUTH = auth; else delete process.env.ASTROPRESS_AUTH;
  delete process.env.REDIS_URL; // in-memory throttler, boot'lar arası state leak yok
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BUILD_RUNNER).useValue(new FakeBuildRunner()).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  cleanup = async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return `http://127.0.0.1:${port}`;
}

// Host header'ı fetch ile override edilemez (undici) → raw http request.
function rawGet(base: string, p: string, host: string): Promise<number> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: u.hostname, port: u.port, path: p, headers: { Host: host } }, (res) => {
      res.resume(); resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
  });
}

test('healthz: 200 ok (liveness, engine state\'inden bağımsız)', async () => {
  const base = await boot();
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('readyz: file boot → 200 ready + component map', async () => {
  const base = await boot();
  const res = await fetch(`${base}/readyz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ready', components: { eventStore: 'ready', buildEngine: 'ready' } });
});

test('token mode: healthz/readyz bearer\'sız 200 (public probe); sites perimeter intact (401)', async () => {
  const base = await boot('token');
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/readyz`)).status, 200);
  assert.equal((await fetch(`${base}/sites`)).status, 401, 'health public ama diğer route\'lar fail-closed kalmalı');
});

test('healthz: forbidden Host → 403 (HostMiddleware health dahil aktif)', async () => {
  const base = await boot();
  assert.equal(await rawGet(base, '/healthz', 'evil.example'), 403);
});