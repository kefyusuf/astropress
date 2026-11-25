import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';

// Windows SIGTERM graceful delivery yok (process.kill anında öldürür) → POSIX-only, CI linux'ta koşar.
const skip = process.platform === 'win32' ? 'SIGTERM graceful shutdown POSIX-only (CI linux)' : undefined;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); });
  });
}

test('backend SIGTERM → graceful shutdown (enableShutdownHooks)', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-shutdown-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['dist/src/main.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ASTROPRESS_STATE: dir, ASTROPRESS_BUILDS: 'file' },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('boot timeout')), 15000);
      child.stdout.on('data', (d) => { if (String(d).includes('AstroPress backend HTTP')) { clearTimeout(timer); resolve(); } });
      child.on('error', reject);
    });
    child.kill('SIGTERM');
    const code = await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(code, 0);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});