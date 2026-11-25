import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileEventStore } from '../../src/builds/infrastructure/file-event-store';
import { EventSourcedBuildJobRepository } from '../../src/builds/infrastructure/event-sourced-build-job.repository';
import { BuildJob } from '../../src/builds/domain/build-job';

const NOW = '2026-11-25T10:00:00.000Z';
let dir: string;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

function make() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-esrepo-'));
  const store = new FileEventStore(path.join(dir, 'events'));
  const mirrorFile = path.join(dir, 'builds.json');
  const repo = new EventSourcedBuildJobRepository(store, mirrorFile);
  return { repo, store, mirrorFile };
}
// Real application flow incremental save: queued → running → terminal (event chain tam).
async function saveTerminal(repo: EventSourcedBuildJobRepository, id: string, fin: string) {
  await repo.save(BuildJob.newQueued(id, NOW));
  await repo.save(BuildJob.newQueued(id, NOW).markRunning(NOW));
  await repo.save(BuildJob.newQueued(id, NOW).markRunning(NOW).markSucceeded({ ok: true, exitCode: 0, logTail: 'ok' }, fin));
}

test('save + findById round-trip (queued)', async () => {
  const { repo } = make();
  const job = BuildJob.newQueued('b1', NOW);
  await repo.save(job);
  assert.deepEqual((await repo.findById('b1'))?.toProps(), job.toProps());
});

test('save transition → event append (queued→running→succeeded)', async () => {
  const { repo, store } = make();
  await repo.save(BuildJob.newQueued('b1', NOW));
  await repo.save(BuildJob.newQueued('b1', NOW).markRunning(NOW));
  await repo.save(BuildJob.newQueued('b1', NOW).markRunning(NOW).markSucceeded({ ok: true, exitCode: 0, logTail: 'ok' }, NOW));
  const evs = await store.readStream('b1');
  assert.deepEqual(evs.map((e) => e.type), ['BuildQueued', 'BuildStarted', 'BuildSucceeded']);
  assert.deepEqual(evs.map((e) => e.version), [1, 2, 3]);
  assert.equal((await repo.findById('b1'))?.status, 'succeeded');
});

test('aynı status save → no-op (event append yok)', async () => {
  const { repo, store } = make();
  await repo.save(BuildJob.newQueued('b1', NOW));
  await repo.save(BuildJob.newQueued('b1', NOW));
  assert.equal((await store.readStream('b1')).length, 1);
});

test('findAll + upsert tekil kalır', async () => {
  const { repo } = make();
  await repo.save(BuildJob.newQueued('a', NOW));
  await repo.save(BuildJob.newQueued('b', NOW));
  await repo.save(BuildJob.newQueued('a', NOW).markRunning(NOW));
  const all = await repo.findAll();
  assert.equal(all.length, 2);
  assert.equal(all.find((j) => j.id === 'a')?.status, 'running');
});

test('FULL RECOVERY: mirror silinse bile init eventlerden rebuild eder', async () => {
  const { repo, store, mirrorFile } = make();
  await repo.save(BuildJob.newQueued('b1', NOW));
  await repo.save(BuildJob.newQueued('b1', NOW).markRunning(NOW));
  await repo.save(BuildJob.newQueued('b1', NOW).markRunning(NOW).markSucceeded({ ok: true, exitCode: 0, logTail: 'ok' }, NOW));
  fs.rmSync(mirrorFile, { force: true });
  const repo2 = new EventSourcedBuildJobRepository(store, mirrorFile);
  await repo2.onModuleInit();
  const found = await repo2.findById('b1');
  assert.equal(found?.status, 'succeeded');
  assert.equal(found?.exitCode, 0);
});

test('pruneTerminal yalnız mirror budar, event log immutable kalır', async () => {
  const { repo, store } = make();
  await saveTerminal(repo, 'old', '2026-11-25T10:00:00.000Z');
  await saveTerminal(repo, 'new', '2026-11-25T10:00:01.000Z');
  await repo.pruneTerminal(1);
  assert.deepEqual((await repo.findAll()).map((j) => j.id), ['new']);
  assert.equal((await store.readStream('old')).length, 3);
});

test('recovery: interrupted running → BuildFailed event (fail-only)', async () => {
  const { repo, store } = make();
  await repo.save(BuildJob.newQueued('b1', NOW));
  await repo.save(BuildJob.newQueued('b1', NOW).markRunning(NOW));
  const running = await repo.findById('b1');
  await repo.save(running!.markFailed('interrupted', NOW));
  const evs = await store.readStream('b1');
  assert.equal(evs[evs.length - 1].type, 'BuildFailed');
  assert.equal((await repo.findById('b1'))?.error, 'interrupted');
});