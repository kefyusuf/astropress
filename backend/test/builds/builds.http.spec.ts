import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { BUILD_RUNNER, BuildRunner } from '../../src/builds/application/ports';
import { BuildResult } from '../../src/builds/domain/build-job';
import { BlockingBuildRunner, FakeBuildRunner } from './fake-build-runner';

const origState = process.env.ASTROPRESS_STATE;
const origQueueLimit = process.env.ASTROPRESS_BUILD_QUEUE_LIMIT;
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (cleanup) { await cleanup(); cleanup = null; }
  if (origState === undefined) delete process.env.ASTROPRESS_STATE;
  else process.env.ASTROPRESS_STATE = origState;
  if (origQueueLimit === undefined) delete process.env.ASTROPRESS_BUILD_QUEUE_LIMIT;
  else process.env.ASTROPRESS_BUILD_QUEUE_LIMIT = origQueueLimit;
});

async function boot(runner: BuildRunner): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-builds-http-'));
  process.env.ASTROPRESS_STATE = dir;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BUILD_RUNNER).useValue(runner)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  cleanup = async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return `http://127.0.0.1:${port}`;
}

async function poll(url: string, id: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i++) {
    const job = await (await fetch(`${url}/builds/${id}`)).json();
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job terminal statusa ulaşmadı');
}

test('POST /builds → 201 queued + id', async () => {
  const url = await boot(new FakeBuildRunner());
  const res = await fetch(`${url}/builds`, { method: 'POST' });
  assert.equal(res.status, 201);
  const job = await res.json();
  assert.equal(job.status, 'queued');
  // crypto.randomUUID (issue #12): restart/replica'da çakışmayan id formatı.
  assert.match(String(job.id), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('POST → GET poll → succeeded', async () => {
  const url = await boot(new FakeBuildRunner());
  const created = await (await fetch(`${url}/builds`, { method: 'POST' })).json();
  const job = await poll(url, created.id);
  assert.equal(job.status, 'succeeded');
  assert.equal(job.exitCode, 0);
});

test('GET /builds/:id missing → 404', async () => {
  const url = await boot(new FakeBuildRunner());
  assert.equal((await fetch(`${url}/builds/yok`)).status, 404);
});

test('GET /builds → list contains job', async () => {
  const url = await boot(new FakeBuildRunner());
  const created = await (await fetch(`${url}/builds`, { method: 'POST' })).json();
  await poll(url, created.id);
  const list = await (await fetch(`${url}/builds`)).json();
  assert.ok(list.some((j: Record<string, unknown>) => j.id === created.id));
});

test('failure path: fake ok:false → GET failed', async () => {
  const results: BuildResult[] = [{ ok: false, exitCode: 1, logTail: 'err', error: 'boom' }];
  const url = await boot(new FakeBuildRunner(results));
  const created = await (await fetch(`${url}/builds`, { method: 'POST' })).json();
  const job = await poll(url, created.id);
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'boom');
});

// D2 queue-bound: queued depth >= limit → POST /builds 429 (BuildQueueFullError). Blocking runner kuyruğu dolu tutar.
test('queue full → POST /builds 429 (queue-bound)', async () => {
  process.env.ASTROPRESS_BUILD_QUEUE_LIMIT = '2';
  const runner = new BlockingBuildRunner();
  const url = await boot(runner);
  try {
    const j1 = await (await fetch(`${url}/builds`, { method: 'POST' })).json();
    for (let i = 0; i < 200; i++) {
      const s = await (await fetch(`${url}/builds/${j1.id}`)).json();
      if (s.status === 'running') break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal((await fetch(`${url}/builds`, { method: 'POST' })).status, 201); // queued depth 1
    assert.equal((await fetch(`${url}/builds`, { method: 'POST' })).status, 201); // queued depth 2
    const full = await fetch(`${url}/builds`, { method: 'POST' }); // depth 2 >= limit 2
    assert.equal(full.status, 429);
    assert.equal((await full.json()).error, 'BuildQueueFullError');
  } finally {
    runner.unblock();
  }
});