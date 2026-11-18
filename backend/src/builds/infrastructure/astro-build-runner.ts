import { spawn } from 'node:child_process';
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

@Injectable()
export class AstroBuildRunner implements BuildRunner {
  constructor(@Inject(ASTROPRESS_ROOT) private readonly root: string) {}

  // Async spawn (spawnSync DEĞİL). Daima BuildResult resolve eder (throw ETMEZ).
  run(): Promise<BuildResult> {
    return new Promise((resolve) => {
      const astroCli = path.join(this.root, 'node_modules', 'astro', 'astro.js');
      const child = spawn(process.execPath, [astroCli, 'build'], { cwd: this.root });
      let out = '';
      let settled = false;
      const tail = () => out.split('\n').slice(-TAIL_LINES).join('\n');
      const timer = setTimeout(() => {
        child.kill();
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