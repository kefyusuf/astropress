import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Test } from '@nestjs/testing';
import { BuildsModule } from '../../src/builds/builds.module';
import { BUILD_JOB_REPOSITORY, EVENT_STORE, BuildJobRepository, EventStore } from '../../src/builds/application/ports';
import { BuildJob } from '../../src/builds/domain/build-job';

const NOW = '2026-11-25T10:00:00.000Z';
let dir: string;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

test('file storage: BUILD_JOB_REPOSITORY event-sourced, EVENT_STORE file adapter', async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-mod-'));
  process.env.ASTROPRESS_STATE = dir;
  process.env.ASTROPRESS_BUILDS = 'file';
  delete process.env.ASTROPRESS_STORAGE;
  const mod = await Test.createTestingModule({ imports: [BuildsModule] }).compile();
  await mod.init();
  const repo = mod.get<BuildJobRepository>(BUILD_JOB_REPOSITORY);
  const store = mod.get<EventStore>(EVENT_STORE);
  await repo.save(BuildJob.newQueued('b1', NOW));
  assert.equal((await store.readStream('b1')).length, 1);
  assert.equal((await repo.findById('b1'))?.id, 'b1');
  await mod.close();
  delete process.env.ASTROPRESS_STATE;
});