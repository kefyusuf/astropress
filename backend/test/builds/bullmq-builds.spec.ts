import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import IORedis from 'ioredis';
import { BUILD_RUNNER, BuildRunner } from '../../src/builds/application/ports';
import { FakeBuildRunner } from './fake-build-runner';

class SkipTest extends Error {}
const redisUrl = process.env.REDIS_URL;
const skip = redisUrl ? undefined : 'REDIS_URL tanımlı değil — bullmq testleri atlandı';

const origState = process.env.ASTROPRESS_STATE;
const origBuilds = process.env.ASTROPRESS_BUILDS;
const origRedis = process.env.REDIS_URL;
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (cleanup) { await cleanup(); cleanup = null; }
  for (const [k, v] of [['ASTROPRESS_STATE', origState], ['ASTROPRESS_BUILDS', origBuilds], ['REDIS_URL', origRedis]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

async function pingRedis(): Promise<void> {
  const c = new IORedis(redisUrl!, { maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true });
  try { await c.connect(); await c.ping(); }
  catch { throw new SkipTest('Redis sunucusuna ulaşılamıyor'); }
  finally { c.disconnect(); }
}

// Engine switch (ASTROPRESS_BUILDS) builds.module YÜKLENİRKEN okunur (import-time). Bu yüzden AppModule'u
// env set edildikten SONRA dinamik import ediyoruz; statik üst-import dosya yüklenirken file mode'u sabitlerdi
// ve testler false-green olurdu. boot() içinde env → import sırası bullmq provider set'ini garanti eder.
async function boot(runner: BuildRunner, url: string = redisUrl!): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-bullmq-'));
  process.env.ASTROPRESS_STATE = dir;
  process.env.ASTROPRESS_BUILDS = 'bullmq';
  process.env.REDIS_URL = url;
  const { AppModule } = await import('../../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BUILD_RUNNER).useValue(runner).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  cleanup = async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return `http://127.0.0.1:${port}`;
}

async function poll(url: string, id: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 300; i++) {
    const job = await (await fetch(`${url}/builds/${id}`)).json();
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job terminal statusa ulaşmadı');
}

test('bullmq: POST → queue.add → Worker → succeeded (repo mirror)', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  const url = await boot(new FakeBuildRunner());
  const created = await (await fetch(`${url}/builds`, { method: 'POST' })).json();
  assert.equal(created.status, 'queued');
  const job = await poll(url, created.id);
  assert.equal(job.status, 'succeeded');
  assert.equal(job.exitCode, 0);
});

test('bullmq: HTTP contract parity — GET missing 404, list contains job', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  const url = await boot(new FakeBuildRunner());
  assert.equal((await fetch(`${url}/builds/yok`)).status, 404);
  const created = await (await fetch(`${url}/builds`, { method: 'POST' })).json();
  await poll(url, created.id);
  const list = await (await fetch(`${url}/builds`)).json();
  assert.ok(list.some((j: Record<string, unknown>) => j.id === created.id));
});

test('bullmq: failure path → failed (attempts=1, no retry)', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  const url = await boot(new FakeBuildRunner([{ ok: false, exitCode: 1, logTail: 'err', error: 'boom' }]));
  const created = await (await fetch(`${url}/builds`, { method: 'POST' })).json();
  const job = await poll(url, created.id);
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'boom');
});

// R2 / acceptance #7 (spec §17.7 + §20): boot-safe. Redis DOWN (kasıtlı unreachable address) iken app
// boot eder (listen resolve) ve file read-model GET /builds 200 döner — Redis'siz de sites/builds API ayakta.
// REDIS_URL set ise bu test SKIP OLMAZ (kendi unreachable URL'ini kullanır, pingRedis çağırmaz).
test('bullmq: boot-safe — Redis unreachable iken app boot eder + GET /builds 200', { skip }, async () => {
  const url = await boot(new FakeBuildRunner(), 'redis://127.0.0.1:6390'); // nothing listening
  const res = await fetch(`${url}/builds`);
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.ok(Array.isArray(list));
});