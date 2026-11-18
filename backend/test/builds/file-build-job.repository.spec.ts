import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileBuildJobRepository } from '../../src/builds/infrastructure/file-build-job.repository';
import { BuildJob } from '../../src/builds/domain/build-job';

const NOW = '2026-11-16T10:00:00.000Z';
let dir: string;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

function repo(): FileBuildJobRepository {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-builds-'));
  return new FileBuildJobRepository(path.join(dir, 'builds.json'));
}

test('save + findById round-trip', async () => {
  const r = repo();
  const job = BuildJob.newQueued('build-1-x', NOW);
  await r.save(job);
  const found = await r.findById('build-1-x');
  assert.deepEqual(found?.toProps(), job.toProps());
});

test('findById missing → null', async () => {
  const r = repo();
  assert.equal(await r.findById('yok'), null);
});

test('findAll returns all', async () => {
  const r = repo();
  await r.save(BuildJob.newQueued('a', NOW));
  await r.save(BuildJob.newQueued('b', NOW));
  assert.equal((await r.findAll()).length, 2);
});

test('save upsert same id', async () => {
  const r = repo();
  await r.save(BuildJob.newQueued('a', NOW));
  await r.save(BuildJob.newQueued('a', NOW).markRunning(NOW));
  const all = await r.findAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].status, 'running');
});

test('persistence across reopen (new instance)', async () => {
  const r = repo();
  await r.save(BuildJob.newQueued('a', NOW));
  const r2 = new FileBuildJobRepository(path.join(dir, 'builds.json'));
  assert.equal((await r2.findById('a'))?.id, 'a');
});