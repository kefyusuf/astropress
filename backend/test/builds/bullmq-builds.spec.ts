import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { BUILD_DISPATCHER, BUILD_RUNNER, BuildRunner } from '../../src/builds/application/ports';
import { BuildJob } from '../../src/builds/domain/build-job';
import { BUILD_QUEUE, createBuildQueue, closeBuildQueue } from '../../src/builds/infrastructure/bullmq/build-queue';
import { BullMqBuildWorker } from '../../src/builds/infrastructure/bullmq/bullmq-build-worker';
import { BlockingBuildRunner, FakeBuildRunner } from './fake-build-runner';

class SkipTest extends Error {}
const redisUrl = process.env.REDIS_URL;
const skip = redisUrl ? undefined : 'REDIS_URL tanımlı değil — bullmq testleri atlandı';
const NOW = '2026-11-23T10:00:00.000Z';

const origState = process.env.ASTROPRESS_STATE;
const origBuilds = process.env.ASTROPRESS_BUILDS;
const origRedis = process.env.REDIS_URL;
const origQueueLimit = process.env.ASTROPRESS_BUILD_QUEUE_LIMIT;
const origRetention = process.env.ASTROPRESS_BUILD_RETENTION;
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (cleanup) { await cleanup(); cleanup = null; }
  for (const [k, v] of [['ASTROPRESS_STATE', origState], ['ASTROPRESS_BUILDS', origBuilds], ['REDIS_URL', origRedis], ['ASTROPRESS_BUILD_QUEUE_LIMIT', origQueueLimit], ['ASTROPRESS_BUILD_RETENTION', origRetention]] as const) {
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
// T2-M2: dispatcher constructor assertion engine seçimini KALICI pinler (static-import false-green regresyonuna karşı).
// seed: boot'tan ÖNCE repo dosyasını tohumlar (crash/restart senaryoları: stale running, queued mirror).
async function boot(runner: BuildRunner, url: string = redisUrl!, seed?: (dir: string) => void): Promise<{ url: string; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-bullmq-'));
  process.env.ASTROPRESS_STATE = dir;
  process.env.ASTROPRESS_BUILDS = 'bullmq';
  process.env.REDIS_URL = url;
  if (seed) seed(dir);
  const { AppModule } = await import('../../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BUILD_RUNNER).useValue(runner).compile();
  assert.equal(moduleRef.get(BUILD_DISPATCHER).constructor.name, 'BullMqDispatcher'); // T2-M2 engine pin
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  // Teardown race guard: BullMQ shared-connection init (INFO roundtrip) bitmeden disconnect edilirse
  // initializing promise unhandled reject eder ("Stream isn't writeable") + yarım-init socket linger
  // eder (node --test hang). Redis UP testlerinde queue+worker ready beklenir; boot-safe test
  // (unreachable url) bu guard'a girmez — init zaten async, boot brick olmaz.
  if (url === redisUrl) {
    await moduleRef.get<Queue>(BUILD_QUEUE).waitUntilReady();
    const w = moduleRef.get(BullMqBuildWorker) as unknown as { worker: { waitUntilReady(): Promise<unknown> } | null };
    await w.worker?.waitUntilReady();
  }
  const port = (app.getHttpServer().address() as AddressInfo).port;
  cleanup = async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { url: `http://127.0.0.1:${port}`, dir };
}

// flushdb izolasyonu: her yeni test temiz Redis ile başlar (jobId dedup + leftover job false-green önlenir).
async function flushRedis(): Promise<void> {
  const c = new IORedis(redisUrl!, { maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true });
  try { await c.connect(); await c.flushdb(); }
  finally { c.disconnect(); }
}

// Repo read-model tohumu. True ES (Faz-3): event log tek kaynak, mirror init'te event'lerden rebuild
// edilir → tohum hem mirror'ı hem event log'u yazar (crash/restart senaryoları event'lerden reconstruct).
function seedJobs(dir: string, jobs: BuildJob[]): void {
  fs.writeFileSync(path.join(dir, 'builds.json'), JSON.stringify(jobs.map((j) => j.toProps()), null, 2));
  const eventsDir = path.join(dir, 'build-events');
  fs.mkdirSync(eventsDir, { recursive: true });
  for (const j of jobs) {
    const evs = eventsForJob(j);
    fs.writeFileSync(path.join(eventsDir, encodeURIComponent(j.id) + '.jsonl'), evs.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }
}

// Tohum job'ın status'üne denk event chain (fold ile birebir reconstruct edilebilir).
function eventsForJob(j: BuildJob): Array<Record<string, unknown>> {
  const p = j.toProps();
  const ev = (version: number, type: string, payload: Record<string, unknown>) =>
    ({ streamId: p.id, version, ts: p.createdAt, type, payload });
  const evs: Array<Record<string, unknown>> = [ev(1, 'BuildQueued', { createdAt: p.createdAt })];
  if (p.status === 'queued') return evs;
  if (p.error === 'dispatch-lost') { evs.push(ev(2, 'DispatchLost', { finishedAt: p.finishedAt })); return evs; }
  evs.push(ev(2, 'BuildStarted', { startedAt: p.startedAt }));
  if (p.status === 'running') return evs;
  if (p.status === 'succeeded') evs.push(ev(3, 'BuildSucceeded', { finishedAt: p.finishedAt, exitCode: p.exitCode, logTail: p.logTail }));
  else evs.push(ev(3, 'BuildFailed', { finishedAt: p.finishedAt, error: p.error, exitCode: p.exitCode, logTail: p.logTail }));
  return evs;
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
  const { url } = await boot(new FakeBuildRunner());
  const res = await fetch(`${url}/builds`, { method: 'POST' });
  assert.equal(res.status, 201); // minor #5: HTTP contract parity — POST 201
  const created = await res.json();
  assert.equal(created.status, 'queued');
  const job = await poll(url, created.id);
  assert.equal(job.status, 'succeeded');
  assert.equal(job.exitCode, 0);
});

test('bullmq: HTTP contract parity — GET missing 404, list contains job', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  const { url } = await boot(new FakeBuildRunner());
  assert.equal((await fetch(`${url}/builds/yok`)).status, 404);
  const created = await (await fetch(`${url}/builds`, { method: 'POST' })).json();
  await poll(url, created.id);
  const list = await (await fetch(`${url}/builds`)).json();
  assert.ok(list.some((j: Record<string, unknown>) => j.id === created.id));
});

test('bullmq: failure path → failed (attempts=1, no retry)', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  const { url } = await boot(new FakeBuildRunner([{ ok: false, exitCode: 1, logTail: 'err', error: 'boom' }]));
  const created = await (await fetch(`${url}/builds`, { method: 'POST' })).json();
  const job = await poll(url, created.id);
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'boom');
});

// R2 / acceptance #7 (spec §17.7 + §20): boot-safe. Redis DOWN (kasıtlı unreachable address) iken app
// boot eder (listen resolve) ve file read-model GET /builds 200 döner — Redis'siz de sites/builds API ayakta.
// REDIS_URL set ise bu test SKIP OLMAZ (kendi unreachable URL'ini kullanır, pingRedis çağırmaz).
test('bullmq: boot-safe — Redis unreachable iken app boot eder + GET /builds 200', { skip }, async () => {
  const { url } = await boot(new FakeBuildRunner(), 'redis://127.0.0.1:6390'); // nothing listening
  const res = await fetch(`${url}/builds`);
  assert.equal(res.status, 200);
  const list = await res.json();
  assert.ok(Array.isArray(list));
});

// Important #1 (spec §7:173): boot recover parity. Önceki crash'ten kalan stale running mirror,
// Redis job'ı OLMADAN (job gone) repo'da durur → onModuleInit best-effort recover failed (interrupted)
// yapar (BuildWorker.recover emsali). Re-run YOK.
test('bullmq: boot recover — stale running mirror (Redis job yok) → failed interrupted, re-run YOK', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  await flushRedis();
  const runner = new FakeBuildRunner();
  const stale = BuildJob.newQueued('build-stale-boot', NOW).markRunning(NOW);
  const { url } = await boot(runner, redisUrl!, (dir) => seedJobs(dir, [stale]));
  const job = await (await fetch(`${url}/builds/build-stale-boot`)).json();
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'interrupted');
  assert.equal(runner.calls, 0, 'interrupted running re-run EDİLMEZ');
});

// Important #2a (spec §12:268, acceptance #6): crash-recovery parity — stale running mirror + Redis job
// queue'da → processor running-guard failed (interrupted), runner ZERO call. Boot recover ile idempotent.
test('bullmq: crash-recovery parity — stale running + Redis job → processor guard failed interrupted, re-run YOK', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  await flushRedis();
  const runner = new FakeBuildRunner();
  const id = 'build-stale-guard';
  const queue = createBuildQueue(redisUrl!, 50);
  await queue.add('build', { jobId: id }, { jobId: id });
  await closeBuildQueue(queue);
  const stale = BuildJob.newQueued(id, NOW).markRunning(NOW);
  const { url } = await boot(runner, redisUrl!, (dir) => seedJobs(dir, [stale]));
  const job = await poll(url, id);
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'interrupted');
  assert.equal(runner.calls, 0, 'stale running re-run EDİLMEZ (processor guard)');
});

// Important #2b (spec §12:268, acceptance #6): durability — queued job Redis'te Worker YOKKEN durur
// (waiting), sonra fresh app/Worker boot → resume → succeeded. Form: "job in Redis before Worker exists,
// then Worker resumes" (true two-app restart yerine kabul edilen hafif form — brief onayı).
test('bullmq: durability — queued job Worker\'dan önce Redis\'te waiting, fresh Worker resume eder', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  await flushRedis();
  const id = 'build-durable-1';
  const queue = createBuildQueue(redisUrl!, 50);
  await queue.add('build', { jobId: id }, { jobId: id });
  const bullJob = await queue.getJob(id);
  assert.ok(bullJob, 'job Redis\'te olmalı');
  assert.equal(await bullJob!.getState(), 'waiting'); // Worker yok → waiting (durable)
  await closeBuildQueue(queue);
  const runner = new FakeBuildRunner();
  const { url } = await boot(runner, redisUrl!, (dir) => seedJobs(dir, [BuildJob.newQueued(id, NOW)]));
  const job = await poll(url, id);
  assert.equal(job.status, 'succeeded');
  assert.equal(runner.calls, 1);
});

// T2-M4 (D2 bullmq): queue-bound 429 repo read-model'den — seeded queued mirrors + BlockingBuildRunner
// (worker en fazla 1'ini running'e alır → queued depth >= limit her durumda). POST → 429.
test('bullmq: queue full → POST 429 (D2 queue-bound, repo read-model)', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  await flushRedis();
  process.env.ASTROPRESS_BUILD_QUEUE_LIMIT = '2';
  const runner = new BlockingBuildRunner();
  const seeds = [1, 2, 3].map((i) => BuildJob.newQueued(`build-qf-${i}`, NOW));
  const queue = createBuildQueue(redisUrl!, 50);
  for (const s of seeds) await queue.add('build', { jobId: s.id }, { jobId: s.id });
  await closeBuildQueue(queue);
  const { url } = await boot(runner, redisUrl!, (dir) => seedJobs(dir, seeds));
  try {
    const full = await fetch(`${url}/builds`, { method: 'POST' });
    assert.equal(full.status, 429);
    assert.equal((await full.json()).error, 'BuildQueueFullError');
  } finally {
    runner.unblock(); // app.close() active job'ı bekler → gate release şart (hang yok)
  }
});

// T2-M4 (D2 bullmq): retention prune — processor terminal save sonrası pruneTerminal(retention).
// Küçük retention (2): eski terminal'lar budanır, queued/running mirror'lar KORUNUR.
test('bullmq: retention prune — terminal keep-last-N, queued/running korunur (D2)', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  await flushRedis();
  process.env.ASTROPRESS_BUILD_RETENTION = '2';
  const runner = new BlockingBuildRunner();
  const { url, dir } = await boot(runner); // Redis boş → worker idle, seed write yarışsız
  try {
    // finishedAt GEÇMİŞte: yeni terminal job (actual now) keep-last-N'de en yeni olarak korunur.
    const old = (i: number) => BuildJob.newQueued(`build-old-${i}`, NOW).markRunning(NOW)
      .markSucceeded({ ok: true, exitCode: 0, logTail: 'ok' }, `2020-01-0${i}T00:00:00.000Z`);
    const qKeep = BuildJob.newQueued('build-keep-queued', NOW);
    const rKeep = BuildJob.newQueued('build-keep-running', NOW).markRunning(NOW);
    seedJobs(dir, [...[1, 2, 3, 4].map(old), qKeep, rKeep]);
    const created = await (await fetch(`${url}/builds`, { method: 'POST' })).json();
    for (let i = 0; i < 200; i++) { // worker job'ı running'e alıp gate'te bloklanana kadar bekle
      const s = await (await fetch(`${url}/builds/${created.id}`)).json();
      if (s.status === 'running') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    runner.unblock();
    const done = await poll(url, created.id);
    assert.equal(done.status, 'succeeded');
    const list = await (await fetch(`${url}/builds`)).json() as Record<string, unknown>[];
    const byId = new Map(list.map((j) => [j.id as string, j]));
    assert.equal(byId.get('build-keep-queued')?.status, 'queued', 'queued prune EDİLMEZ');
    assert.equal(byId.get('build-keep-running')?.status, 'running', 'running prune EDİLMEZ');
    const terminals = list.filter((j) => j.status === 'succeeded' || j.status === 'failed');
    assert.equal(terminals.length, 2, 'keep-last-2 terminal');
    assert.ok(!byId.has('build-old-1'), 'en eski terminal budanmalı');
    assert.ok(byId.has(created.id), 'yeni terminal korunmalı');
  } finally {
    runner.unblock();
  }
});

test('bullmq: orphan queued mirror (dispatch yok) boot → failed dispatch-lost', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  await flushRedis();
  const orphan = BuildJob.newQueued('build-orphan-1', NOW);
  const { url } = await boot(new FakeBuildRunner(), redisUrl!, (dir) => seedJobs(dir, [orphan]));
  const job = await (await fetch(`${url}/builds/build-orphan-1`)).json();
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'dispatch-lost');
});

test('bullmq: dispatched queued mirror korunur (false-positive yok)', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  await flushRedis();
  const id = 'build-dispatched-1';
  const q = createBuildQueue(redisUrl!, 50);
  await q.add('build', { jobId: id }, { jobId: id });
  await closeBuildQueue(q);
  const seeded = BuildJob.newQueued(id, NOW);
  const { url } = await boot(new FakeBuildRunner(), redisUrl!, (dir) => seedJobs(dir, [seeded]));
  const job = await poll(url, id);
  assert.equal(job.status, 'succeeded');
});

test('bullmq: Redis-down orphan reconcile boot-safe (skip, brick yok)', { skip }, async (t) => {
  try { await pingRedis(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  const { url } = await boot(new FakeBuildRunner(), 'redis://127.0.0.1:1', (dir) => seedJobs(dir, [BuildJob.newQueued('build-x', NOW)]));
  const res = await fetch(`${url}/builds/build-x`);
  assert.equal(res.status, 200);
});
