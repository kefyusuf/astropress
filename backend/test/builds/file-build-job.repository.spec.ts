import { test, afterEach, mock } from 'node:test';
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

// I1 hardening: atomic write + corruption self-heal (quarantine) + transient-IO distinction.
test('writeAll atomic: tmp + rename (crash mid-write truncated dosya bırakmaz)', async () => {
  const r = repo();
  const renames: Array<[string, string]> = [];
  const orig = fs.renameSync;
  const m = mock.method(fs, 'renameSync', (from: string, to: string) => { renames.push([from, to]); return orig(from, to); });
  try {
    await r.save(BuildJob.newQueued('a', NOW));
    assert.ok(renames.some(([from, to]) => from.endsWith('.tmp') && to.endsWith('builds.json')), 'tmp→rename atomic write kullanılmalı');
    assert.ok(!fs.existsSync(path.join(dir, 'builds.json.tmp')), '.tmp leftover kalmamalı');
    assert.ok(fs.existsSync(path.join(dir, 'builds.json')));
  } finally { m.mock.restore(); }
});

test('corrupt JSON → self-heal: findAll [] + quarantine .corrupt', async () => {
  const r = repo();
  fs.writeFileSync(path.join(dir, 'builds.json'), '{ bu json değil', 'utf8');
  assert.deepEqual(await r.findAll(), []);
  assert.ok(fs.existsSync(path.join(dir, 'builds.json.corrupt')), 'corrupt dosya quarantine edilmeli');
  assert.ok(!fs.existsSync(path.join(dir, 'builds.json')), 'orijinal corrupt dosya rename edilmeli');
});

test('invalid record (revalidation) → self-heal quarantine', async () => {
  const r = repo();
  fs.writeFileSync(path.join(dir, 'builds.json'), JSON.stringify([{ id: 'a', status: 'queued', createdAt: 'not-a-date' }]), 'utf8');
  assert.deepEqual(await r.findAll(), []);
  assert.ok(fs.existsSync(path.join(dir, 'builds.json.corrupt')));
});

test('transient IO (EBUSY) → rethrow, quarantine YOK (state destroy edilmez)', async () => {
  const r = repo();
  fs.writeFileSync(path.join(dir, 'builds.json'), '[]', 'utf8');
  const m = mock.method(fs, 'readFileSync', () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); });
  try {
    await assert.rejects(() => r.findAll(), /EBUSY/);
    assert.ok(!fs.existsSync(path.join(dir, 'builds.json.corrupt')), 'transient IO quarantine etmemeli');
  } finally { m.mock.restore(); }
});

test('quarantine sonrası save functional state restore eder', async () => {
  const r = repo();
  fs.writeFileSync(path.join(dir, 'builds.json'), 'corrupt', 'utf8');
  await r.findAll(); // quarantine tetiklenir
  await r.save(BuildJob.newQueued('a', NOW));
  assert.equal((await r.findById('a'))?.id, 'a');
});