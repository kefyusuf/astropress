import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import IORedis from 'ioredis';
import { BUILD_RUNNER } from '../../src/builds/application/ports';
import { FakeBuildRunner } from './fake-build-runner';

class SkipTest extends Error {}
const redisUrl = process.env.REDIS_URL;
const skip = redisUrl ? undefined : 'REDIS_URL tanımlı değil — bullmq readiness testleri atlandı';

const orig = { state: process.env.ASTROPRESS_STATE, builds: process.env.ASTROPRESS_BUILDS, redis: process.env.REDIS_URL, storage: process.env.ASTROPRESS_STORAGE };
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (cleanup) { await cleanup(); cleanup = null; }
  for (const [k, v] of [['ASTROPRESS_STATE', orig.state], ['ASTROPRESS_BUILDS', orig.builds], ['REDIS_URL', orig.redis], ['ASTROPRESS_STORAGE', orig.storage]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// Engine axis import-time okunur → env set'ten SONRA dinamik import (bullmq-builds.spec.ts emsali).
async function boot(url: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-readiness-'));
  process.env.ASTROPRESS_STATE = dir;
  process.env.ASTROPRESS_BUILDS = 'bullmq';
  process.env.REDIS_URL = url;
  delete process.env.ASTROPRESS_STORAGE; // file ES → eventStore ready; degrade sadece buildEngine
  const { AppModule } = await import('../../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BUILD_RUNNER).useValue(new FakeBuildRunner()).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  cleanup = async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return `http://127.0.0.1:${port}`;
}

test('bullmq + Redis up → readyz 200, her iki component ready', { skip }, async (t) => {
  const c = new IORedis(redisUrl!, { maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true });
  try { await c.connect(); await c.ping(); }
  catch { t.skip('Redis sunucusuna ulaşılamıyor'); return; }
  finally { c.disconnect(); }
  const base = await boot(redisUrl!);
  const res = await fetch(`${base}/readyz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ready', components: { eventStore: 'ready', buildEngine: 'ready' } });
});

test('bullmq + Redis down → boot brick olmaz; readyz 503 buildEngine degraded; sites 200', { skip }, async () => {
  // Kapalı port: anında ECONNREFUSED (unroutable IP hang ederdi). Bounded ready await 2s → degraded.
  const base = await boot('redis://127.0.0.1:6390');
  const res = await fetch(`${base}/readyz`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.components.buildEngine, 'degraded');
  assert.equal(body.components.eventStore, 'ready');
  assert.equal((await fetch(`${base}/sites`)).status, 200, 'boot-safe: sites API degrade boot\'ta çalışır');
});