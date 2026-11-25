import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BuildResult } from '../domain/build-job';
import { BuildRunner } from '../application/ports';
import { BuildWorkspace } from './build-workspace';

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
  private readonly logger = new Logger(AstroBuildRunner.name);
  constructor(
    @Inject(ASTROPRESS_ROOT) private readonly root: string,
    @Inject(BuildWorkspace) private readonly workspace: BuildWorkspace,
  ) {}

  // Async spawn (spawnSync DEĞİL). Daima BuildResult resolve eder (throw ETMEZ).
  // Per-build izole root (dist + .astro) → N eşzamanlı build yarışmaz. cleanup finally (ephemeral).
  async run(jobId: string): Promise<BuildResult> {
    let iso: string;
    try {
      iso = this.workspace.create(this.root, jobId);
    } catch (err) {
      return { ok: false, exitCode: -1, logTail: '', error: `workspace create: ${err instanceof Error ? err.message : String(err)}` };
    }
    try {
      return await this.runAstro(iso);
    } finally {
      try { this.workspace.cleanup(jobId); }
      catch (err) { this.logger.warn(`workspace cleanup: ${err instanceof Error ? err.message : String(err)}`); }
    }
  }

  private runAstro(iso: string): Promise<BuildResult> {
    return new Promise((resolve) => {
      // astro CLI entry versiyonla değişir (5: astro.js, 7: bin/astro.mjs) → package.json bin'den çöz.
      // root'a anchored require: astro real root node_modules'ta (iso'da junction).
      const rootRequire = createRequire(path.join(this.root, 'package.json'));
      const astroPkg = rootRequire('astro/package.json');
      const binRel = typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin.astro;
      const astroCli = path.join(path.dirname(rootRequire.resolve('astro/package.json')), binRel);
      // --root iso → .astro cache iso'da (content collection isolation); --outDir iso/dist → çıktı isolation.
      const child = spawn(process.execPath, [astroCli, 'build', '--root', iso, '--outDir', path.join(iso, 'dist')], { cwd: iso, detached: true });
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