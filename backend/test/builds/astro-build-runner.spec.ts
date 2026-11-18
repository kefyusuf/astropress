import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AstroBuildRunner, defaultRoot } from '../../src/builds/infrastructure/astro-build-runner';

// Gerçek astro build (birkaç sn): spawn wiring'in dürüst kanıtı. Serial runner → dist/ yarışı yok.
test('AstroBuildRunner gerçek astro build → ok, exit 0, dist/ var', async () => {
  const root = defaultRoot();
  const runner = new AstroBuildRunner(root);
  const result = await runner.run();
  assert.equal(result.ok, true, `build failed: ${result.error}\n${result.logTail}`);
  assert.equal(result.exitCode, 0);
  assert.ok(result.logTail.length > 0);
  assert.ok(fs.existsSync(path.join(root, 'dist')), 'dist/ üretilmedi');
});