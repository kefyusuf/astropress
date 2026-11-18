import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { BUILD_RUNNER } from '../../src/builds/application/ports';
import { BuildResult } from '../../src/builds/domain/build-job';
import { FakeBuildRunner } from './fake-build-runner';

const origState = process.env.ASTROPRESS_STATE;
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (cleanup) { await cleanup(); cleanup = null; }
  if (origState === undefined) delete process.env.ASTROPRESS_STATE;
  else process.env.ASTROPRESS_STATE = origState;
});

async function boot(runner: FakeBuildRunner): Promise<string> {
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
  assert.ok(String(job.id).startsWith('build-'));
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