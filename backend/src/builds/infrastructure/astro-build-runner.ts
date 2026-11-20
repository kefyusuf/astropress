import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { BuildResult } from '../domain/build-job';
import { BuildRunner } from '../application/ports';

export const ASTROPRESS_ROOT = Symbol('ASTROPRESS_ROOT');

// Repo kökü: __dirname'den astro.config.mjs işaretçisine yürü (cwd/dist derinliğinden bağımsız).
export function defaultRoot(): string {
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'astro.config.mjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

const TIMEOUT_MS = 180000; // ops.mjs build parity
const TAIL_LINES = 8;

// Timeout'ta child process-tree'yi öldür (orphan grandchild bırakma). Cross-platform.
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) { child.kill(); return; }
  if (process.platform === 'win32') {
    // taskkill /T (tree) /F (force): PID tree-walk — detached gerekmez.
    spawn('taskkill', ['/T', '/F', '/PID', String(pid)]);
  } else {
    // POSIX: detached:true → child process-group leader; -pid tüm gruba SIGTERM.
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      child.kill(); // group kill başarısız (ESRCH/EPERM) → en azından child'ı öldür
    }
  }
}

@Injectable()
export class AstroBuildRunner implements BuildRunner {
  constructor(@Inject(ASTROPRESS_ROOT) private readonly root: string) {}

  // Async spawn (spawnSync DEĞİL). Daima BuildResult resolve eder (throw ETMEZ).
  run(): Promise<BuildResult> {
    return new Promise((resolve) => {
      const astroCli = path.join(this.root, 'node_modules', 'astro', 'astro.js');
      // detached:true → POSIX'te child process-group leader (killTree -pid ile tüm gruba sinyal).
      const child = spawn(process.execPath, [astroCli, 'build'], { cwd: this.root, detached: true });
      let out = '';
      let settled = false;
      const tail = () => out.split('\n').slice(-TAIL_LINES).join('\n');
      const timer = setTimeout(() => {
        killTree(child);
        finish({ ok: false, exitCode: -1, logTail: tail(), error: 'timeout' });
      }, TIMEOUT_MS);
      const finish = (result: BuildResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { out += d.toString(); });
      child.on('error', (err) => finish({ ok: false, exitCode: -1, logTail: tail(), error: err.message }));
      child.on('close', (code) => finish({ ok: code === 0, exitCode: code ?? -1, logTail: tail() }));
    });
  }
}