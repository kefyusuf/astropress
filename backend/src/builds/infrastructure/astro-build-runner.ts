import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BuildResult } from '../domain/build-job';
import { BuildRunner } from '../application/ports';
import { BuildWorkspace } from './build-workspace';
import { resolveRepoRoot } from '../../infrastructure/repo-root';

export const ASTROPRESS_ROOT = Symbol('ASTROPRESS_ROOT');

// Repo kökü tek kaynaktan: resolveRepoRoot (issue #13 — 8 dosyadaki tekrarlanan walk temizlendi).
export function defaultRoot(): string {
  return resolveRepoRoot();
}

const TIMEOUT_MS = 180000; // ops.mjs build parity
const TAIL_LINES = 8;
const MAX_OUT_CHARS = 64 * 1024; // ring buffer: sınırsız stdout birikimi OOM DoS değil (issue #11)

// Alt sürece minimum env: PATH + NODE_ENV (+ Windows kernel/shell temel anahtarları).
// DATABASE_URL / REDIS_URL / token secret'ları build sürecine SIZMAZ (issue #11 kabul kriteri).
const WIN32_ENV_KEYS = ['systemroot', 'systemdrive', 'comspec', 'pathext', 'temp', 'tmp', 'appdata', 'localappdata', 'userprofile', 'programdata'];
export function buildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  if (process.env.NODE_ENV !== undefined) env.NODE_ENV = process.env.NODE_ENV;
  if (process.platform === 'win32') {
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && WIN32_ENV_KEYS.includes(k.toLowerCase())) env[k] = v;
    }
  }
  return env;
}

// Timeout'ta child process-tree'yi öldür (orphan grandchild bırakmama hedefi). Cross-platform.
// Windows: taskkill spawn'ı kaldırıldı — statik-argümanlı olmayan spawn kuralı (yerel scan hook)
// doğrulanmış pid ile bile bu çağrıyı blokladığı için child.kill('SIGKILL') (TerminateProcess)
// kullanılır; astro build'in esbuild service'i parent ölümünde self-exit eder (issue #11 notu).
// POSIX: detached → process-group SIGTERM, 2s sonra SIGKILL eskalasyonu (issue #11).
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) { child.kill(); return; }
  if (process.platform === 'win32') {
    try { child.kill('SIGKILL'); } catch { /* en iyi efor */ }
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      child.kill(); // group kill başarısız (ESRCH/EPERM) → en azından child'ı öldür
    }
    const escalate = setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* zaten ölü */ } }
    }, 2000);
    escalate.unref?.();
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
      // runAstro timeout yolunda kill sonrası kısa exit beklemesi yapar; cleanup güvenli (issue #11).
      try { this.workspace.cleanup(jobId); }
      catch (err) { this.logger.warn(`workspace cleanup: ${err instanceof Error ? err.message : String(err)}`); }
    }
  }

  private runAstro(iso: string): Promise<BuildResult> {
    return new Promise((resolve) => {
      // astro CLI entry versiyonla değişir (5: astro.js, 7: bin/astro.mjs) → package.json bin'den çöz.
      // root'a anchored require: astro real root node_modules'ta (iso'da junction).
      let astroCli: string;
      try {
        const rootRequire = createRequire(path.join(this.root, 'package.json'));
        const astroPkg = rootRequire('astro/package.json');
        const binRel = typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin.astro;
        const pkgDir = path.dirname(rootRequire.resolve('astro/package.json'));
        const resolved = path.resolve(pkgDir, binRel);
        // bin yolu astro paket dizini içinde doğrulanır (issue #11).
        if (!resolved.startsWith(pkgDir + path.sep) && resolved !== pkgDir) {
          resolve({ ok: false, exitCode: -1, logTail: '', error: 'astro bin yolu paket dizini dışında' });
          return;
        }
        astroCli = resolved;
      } catch (err) {
        resolve({ ok: false, exitCode: -1, logTail: '', error: `astro CLI çözülemedi: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }
      // --root iso → .astro cache iso'da (content collection isolation); --outDir iso/dist → çıktı isolation.
      const child = spawn(process.execPath, [astroCli, 'build', '--root', iso, '--outDir', path.join(iso, 'dist')], { cwd: iso, detached: true, env: buildEnv() });
      let out = ''; // ring buffer: MAX_OUT_CHARS aşılırsa baştan kırp (sabit bellek)
      let settled = false;
      const push = (s: string) => {
        out = out.length + s.length > MAX_OUT_CHARS ? out.slice(Math.max(0, out.length + s.length - MAX_OUT_CHARS)) + s : out + s;
      };
      const tail = () => out.split('\n').slice(-TAIL_LINES).join('\n');
      const exited = new Promise<void>((r) => child.on('close', () => r()));
      const finish = (result: BuildResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        killTree(child);
        // Kill sonrası kısa exit beklemesi: cleanup'a önce process çıkışı (Windows file-lock yarışı azalır).
        void Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]).then(() =>
          finish({ ok: false, exitCode: -1, logTail: tail(), error: 'timeout' }),
        );
      }, TIMEOUT_MS);
      child.stdout.on('data', (d) => push(d.toString()));
      child.stderr.on('data', (d) => push(d.toString()));
      child.on('error', (err) => finish({ ok: false, exitCode: -1, logTail: tail(), error: err.message }));
      child.on('close', (code) => finish({ ok: code === 0, exitCode: code ?? -1, logTail: tail() }));
    });
  }
}
