import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EnqueueBuild } from '../../src/builds/application/enqueue-build';
import { BuildWorker } from '../../src/builds/application/build-worker';
import { FileBuildJobRepository } from '../../src/builds/infrastructure/file-build-job.repository';
import { BuildJob } from '../../src/builds/domain/build-job';
import { BuildQueueFullError } from '../../src/builds/domain/errors';
import { FakeBuildRunner } from './fake-build-runner';
import { BuildDispatcher } from '../../src/builds/application/ports';

const NOW = '2026-11-23T10:00:00.000Z';
let dir: string;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

function setup(limit: number) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-enqueue-'));
  const repo = new FileBuildJobRepository(path.join(dir, 'builds.json'));
  const worker = new BuildWorker(repo, new FakeBuildRunner(), 50);
  const enqueue = new EnqueueBuild(repo, worker, limit);
  return { repo, worker, enqueue };
}

test('queue at limit → execute throws BuildQueueFullError', async () => {
  const { repo, enqueue } = setup(2);
  await repo.save(BuildJob.newQueued('a', NOW));
  await repo.save(BuildJob.newQueued('b', NOW));
  await assert.rejects(() => enqueue.execute(), BuildQueueFullError);
});

test('below limit → execute enqueues queued job', async () => {
  const { repo, worker, enqueue } = setup(2);
  await repo.save(BuildJob.newQueued('a', NOW));
  const job = await enqueue.execute();
  await worker.drain();
  assert.equal(job.status, 'queued');
  assert.ok(job.id.startsWith('build-'));
  assert.ok(await repo.findById(job.id));
});

test('empty queue → execute enqueues', async () => {
  const { worker, enqueue } = setup(1);
  const job = await enqueue.execute();
  await worker.drain();
  assert.equal(job.status, 'queued');
});

test('terminal jobs do not count toward queue bound', async () => {
  const { repo, worker, enqueue } = setup(1);
  await repo.save(
    BuildJob.newQueued('done', NOW).markRunning(NOW).markSucceeded({ ok: true, exitCode: 0, logTail: 'ok' }, NOW),
  );
  const job = await enqueue.execute();
  await worker.drain();
  assert.equal(job.status, 'queued');
});

test('running job does not count toward queued bound', async () => {
  const { repo, worker, enqueue } = setup(1);
  await repo.save(BuildJob.newQueued('run', NOW).markRunning(NOW));
  const job = await enqueue.execute();
  await worker.drain();
  assert.equal(job.status, 'queued');
});

test('execute dispatches job via BuildDispatcher port (seam)', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-enqueue-'));
  const repo = new FileBuildJobRepository(path.join(dir, 'builds.json'));
  const dispatched: BuildJob[] = [];
  // T1-a: ORDERING kanıtı — dispatch() ANINDA job repo'da persist edilmiş mi? (eventual persistence değil)
  let atDispatch: BuildJob | null = null;
  const fakeDispatcher: BuildDispatcher = {
    dispatch: async (j) => { dispatched.push(j); atDispatch = await repo.findById(j.id); },
  };
  const enqueue = new EnqueueBuild(repo, fakeDispatcher, 10);
  const job = await enqueue.execute();
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].id, job.id);
  assert.ok(atDispatch, 'job dispatch ANINDA repo\'da olmalı (save-önce-dispatch ordering)');
  const persisted = atDispatch as BuildJob | null;
  assert.equal(persisted!.id, job.id);
  assert.equal(persisted!.status, 'queued');
  assert.ok(await repo.findById(job.id), 'repo save dispatch-öncesi');
});
