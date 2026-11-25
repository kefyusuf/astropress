import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { AstroBuildRunner, defaultRoot, killTree } from '../../src/builds/infrastructure/astro-build-runner';

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

// M2: killTree cross-platform dispatch — deterministic mock (flaky real-grandchild test YOK).
function forcePlatform<T>(plat: NodeJS.Platform, fn: () => T): T {
  const orig = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: plat, configurable: true });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', orig); }
}

function fakeChild(pid: number): { child: ChildProcess; kills: string[] } {
  const kills: string[] = [];
  const child = { pid, kill: (sig?: string) => { kills.push(sig ?? 'SIGTERM'); return true; } };
  return { child: child as unknown as ChildProcess, kills };
}

test('killTree win32 → taskkill /T /F /PID (tree kill, child.kill değil)', () => {
  const { child, kills } = fakeChild(4321);
  const spawns: Array<[string, string[]]> = [];
  const m = mock.method(childProcess, 'spawn', (cmd: string, args: string[]) => {
    spawns.push([cmd, args]);
    return undefined as any;
  });
  try {
    forcePlatform('win32', () => killTree(child));
    assert.equal(spawns.length, 1, 'taskkill spawn edilmeli');
    assert.equal(spawns[0][0], 'taskkill');
    assert.deepEqual(spawns[0][1], ['/T', '/F', '/PID', '4321']);
    assert.equal(kills.length, 0, 'win32 taskkill kullanır, child.kill fallback değil');
  } finally { m.mock.restore(); }
});

test('killTree POSIX → process.kill(-pid, SIGTERM) (process-group leader)', () => {
  const { child, kills } = fakeChild(4321);
  const groupKills: Array<[number, string]> = [];
  const m = mock.method(process, 'kill', (pid: number, sig: string) => {
    groupKills.push([pid, sig]);
    return true;
  });
  try {
    forcePlatform('linux', () => killTree(child));
    assert.deepEqual(groupKills, [[-4321, 'SIGTERM']], 'negatif pid → tüm process-group');
    assert.equal(kills.length, 0, 'group kill başarılı → child.kill fallback yok');
  } finally { m.mock.restore(); }
});

test('killTree POSIX fallback → process.kill throws → child.kill()', () => {
  const { child, kills } = fakeChild(4321);
  const m = mock.method(process, 'kill', () => {
    throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
  });
  try {
    forcePlatform('linux', () => killTree(child));
    assert.equal(kills.length, 1, 'group kill başarısız → en azından child öldürülür');
  } finally { m.mock.restore(); }
});