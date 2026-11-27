import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { AstroBuildRunner, defaultRoot, killTree, buildEnv } from '../../src/builds/infrastructure/astro-build-runner';
import { BuildWorkspace } from '../../src/builds/infrastructure/build-workspace';

// Gerçek astro build (birkaç sn): isolation dürüst kanıtı. run(jobId) → izole root, cleanup finally (ephemeral).
test('AstroBuildRunner gerçek astro build → ok exit 0, workspace cleanup (root/dist DEĞİL)', async () => {
  const root = defaultRoot();
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-runner-ws-'));
  const runner = new AstroBuildRunner(root, new BuildWorkspace(wsDir));
  const result = await runner.run('real-job-1');
  try {
    assert.equal(result.ok, true, `build failed: ${result.error}\n${result.logTail}`);
    assert.equal(result.exitCode, 0);
    assert.ok(result.logTail.length > 0);
    assert.ok(!fs.existsSync(path.join(wsDir, 'real-job-1')), 'workspace cleanup edilmeli (ephemeral)');
  } finally { fs.rmSync(wsDir, { recursive: true, force: true }); }
});

test('run(jobId): spawn --root iso --outDir iso/dist, cwd iso (mock spawn)', async () => {
  const root = defaultRoot();
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-runner-ws-'));
  const runner = new AstroBuildRunner(root, new BuildWorkspace(wsDir));
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const m = mock.method(childProcess, 'spawn', (_cmd: string, args: string[], opts: { cwd: string }) => {
    calls.push({ args, cwd: opts.cwd });
    const child = new EventEmitter() as EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
    child.pid = 999;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    setImmediate(() => { child.stdout.emit('data', Buffer.from('ok')); child.emit('close', 0); });
    return child as unknown as ChildProcess;
  });
  try {
    const result = await runner.run('mock-job');
    assert.equal(result.ok, true);
    const iso = path.join(wsDir, 'mock-job');
    assert.ok(calls[0].args.includes('--root') && calls[0].args.includes(iso), '--root iso');
    assert.ok(calls[0].args.includes('--outDir') && calls[0].args.includes(path.join(iso, 'dist')), '--outDir iso/dist');
    assert.equal(calls[0].cwd, iso, 'cwd iso');
  } finally { m.mock.restore(); fs.rmSync(wsDir, { recursive: true, force: true }); }
});

test('isolation create hatası → BuildResult failed (run throw ETMEZ)', async () => {
  const root = defaultRoot();
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-runner-ws-'));
  const ws = new BuildWorkspace(wsDir);
  ws.create = () => { throw new Error('junction fail'); };
  const runner = new AstroBuildRunner(root, ws);
  try {
    const result = await runner.run('fail-job');
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, -1);
    assert.match(result.error ?? '', /junction fail/);
  } finally { fs.rmSync(wsDir, { recursive: true, force: true }); }
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

test('killTree win32 → child.kill(SIGKILL) (taskkill spawn yok — statik olmayan argüman kuralı, issue #11 notu)', () => {
  const { child, kills } = fakeChild(4321);
  const spawns: Array<[string, string[]]> = [];
  const m = mock.method(childProcess, 'spawn', (cmd: string, args: string[]) => {
    spawns.push([cmd, args]);
    return undefined as any;
  });
  try {
    forcePlatform('win32', () => killTree(child));
    assert.equal(spawns.length, 0, 'win32 spawn yok — TerminateProcess yolu');
    assert.deepEqual(kills, ['SIGKILL'], 'child.kill SIGKILL kullanılır');
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

test('buildEnv: DATABASE_URL / REDIS_URL / secret env\u2019ler build sürecine sızmaz (kabul kriteri)', () => {
  const saved: Record<string, string | undefined> = {
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    ASTROPRESS_TOKEN_SECRET: process.env.ASTROPRESS_TOKEN_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.DATABASE_URL = 'postgres://secret@example.com/db';
  process.env.REDIS_URL = 'redis://secret@example.com:6379';
  process.env.ASTROPRESS_TOKEN_SECRET = 'topsecret';
  process.env.NODE_ENV = 'test';
  try {
    const env = buildEnv();
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.REDIS_URL, undefined);
    assert.equal(env.ASTROPRESS_TOKEN_SECRET, undefined);
    assert.equal(env.NODE_ENV, 'test');
    assert.ok(env.PATH, 'PATH taşınmalı (astro build çalışsın)');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
