import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BuildWorker } from '../../src/builds/application/build-worker';
import { BuildJobRepository } from '../../src/builds/application/ports';
import { FileBuildJobRepository } from '../../src/builds/infrastructure/file-build-job.repository';
import { BuildJob } from '../../src/builds/domain/build-job';
import { BuildResult } from '../../src/builds/domain/build-job';
import { FakeBuildRunner } from './fake-build-runner';

let dir: string;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

function setup(results?: BuildResult[]) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-worker-'));
  const repo = new FileBuildJobRepository(path.join(dir, 'builds.json'));
  const runner = new FakeBuildRunner(results);
  const worker = new BuildWorker(repo, runner);
  return { repo, runner, worker };
}

test('single queued job → drain → succeeded', async () => {
  const { repo, worker } = setup();
  await repo.save(BuildJob.newQueued('a', '2026-11-16T10:00:00.000Z'));
  await worker.drain();
  const job = await repo.findById('a');
  assert.equal(job?.status, 'succeeded');
  assert.equal(job?.exitCode, 0);
});

test('failed build → drain → failed + error', async () => {
  const { repo, worker } = setup([{ ok: false, exitCode: 1, logTail: 'err', error: 'boom' }]);
  await repo.save(BuildJob.newQueued('a', '2026-11-16T10:00:00.000Z'));
  await worker.drain();
  const job = await repo.findById('a');
  assert.equal(job?.status, 'failed');
  assert.equal(job?.error, 'boom');
});

test('serial order: 3 jobs FIFO, maxConcurrent=1', async () => {
  const { repo, runner, worker } = setup();
  await repo.save(BuildJob.newQueued('a', '2026-11-16T10:00:00.000Z'));
  await repo.save(BuildJob.newQueued('b', '2026-11-16T10:00:01.000Z'));
  await repo.save(BuildJob.newQueued('c', '2026-11-16T10:00:02.000Z'));
  await worker.drain();
  assert.equal(runner.maxActive, 1);
  assert.equal(runner.calls, 3);
  for (const id of ['a', 'b', 'c']) assert.equal((await repo.findById(id))?.status, 'succeeded');
});

test('boot recovery: running → failed interrupted', async () => {
  const { repo, worker } = setup();
  await repo.save(BuildJob.newQueued('a', '2026-11-16T10:00:00.000Z').markRunning('2026-11-16T10:00:00.000Z'));
  await worker.recover();
  const job = await repo.findById('a');
  assert.equal(job?.status, 'failed');
  assert.equal(job?.error, 'interrupted');
});

test('concurrency guard: kick twice → single drain', async () => {
  const { repo, runner, worker } = setup();
  await repo.save(BuildJob.newQueued('a', '2026-11-16T10:00:00.000Z'));
  worker.kick();
  worker.kick();
  await worker.drain();
  assert.equal(runner.calls, 1);
});

test('drain empty queue → no-op', async () => {
  const { runner, worker } = setup();
  await worker.drain();
  assert.equal(runner.calls, 0);
});

// I1 hardening: boot never bricks (sites güvende) + kick rejection handled (process crash yok).
test('onModuleInit: findAll rejects → boot safe (resolve, throw YOK)', async () => {
  const repo: BuildJobRepository = {
    save: async () => {},
    findById: async () => null,
    findAll: async () => { throw new Error('IO corrupt'); },
  };
  const worker = new BuildWorker(repo, new FakeBuildRunner());
  await worker.onModuleInit(); // reject ETMEMELI — yoksa tüm backend (sites dahil) boot edemez
});

test('kick: repo rejection → unhandled rejection YOK (process crash önlenir)', async () => {
  const rejections: unknown[] = [];
  const onRej = (e: unknown) => { rejections.push(e); };
  process.on('unhandledRejection', onRej);
  try {
    const repo: BuildJobRepository = {
      save: async () => { throw new Error('IO'); },
      findById: async () => null,
      findAll: async () => { throw new Error('IO'); },
    };
    const worker = new BuildWorker(repo, new FakeBuildRunner());
    worker.kick();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(rejections.length, 0, 'kick drain rejection handle edilmeli');
  } finally {
    process.off('unhandledRejection', onRej);
  }
});