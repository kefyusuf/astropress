import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { resolveRepoRoot } from '../../infrastructure/repo-root';

export const BUILD_WORKSPACE_DIR = Symbol('BUILD_WORKSPACE_DIR');

// ASTROPRESS_STATE/build-workspaces (varsa) yoksa repo kökü .astropress/build-workspaces (defaultEventsDir emsali).
export function defaultWorkspaceDir(): string {
  if (process.env.ASTROPRESS_STATE) return path.join(process.env.ASTROPRESS_STATE, 'build-workspaces');
  return path.join(resolveRepoRoot(), '.astropress', 'build-workspaces');
}

// dir → junction (win32, admin gerektirmez) / dir symlink (POSIX). node_modules read-only paylaşım.
const LINK_DIRS = ['src', 'public', 'node_modules'];
// config dosyaları copy (win32 file-symlink privilege gerektirmez; küçük dosya).
const COPY_FILES = ['astro.config.mjs', 'package.json', 'tsconfig.json'];

// jobId sözleşmesi: slug-safe, ≤64 — path traversal '../' ve serde gömme reddedilir (issue #11).
const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

@Injectable()
export class BuildWorkspace implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BuildWorkspace.name);
  constructor(@Inject(BUILD_WORKSPACE_DIR) private readonly workspaceDir: string) {}

  // Boot: önceki çalışmadan kalan yetim iso dizinleri temizle (issue #11 — cleanupAll çağrılmıyordu).
  onApplicationBootstrap(): void {
    this.cleanupAll();
  }

  // Shutdown: workspace farm temizliği. Aktif build süreci SIGTERM'de sonlanır (#12 bounded shutdown).
  onModuleDestroy(): void {
    this.cleanupAll();
  }

  private safeIso(jobId: string): string {
    if (typeof jobId !== 'string' || !JOB_ID_PATTERN.test(jobId)) {
      throw new Error(`Geçersiz build job id (slug-safe, ≤64): ${String(jobId).slice(0, 64)}`);
    }
    const root = path.resolve(this.workspaceDir);
    const iso = path.resolve(root, jobId);
    if (!iso.startsWith(root + path.sep) && iso !== root) {
      throw new Error('Workspace kök sınırı aşıldı');
    }
    return iso;
  }

  // root caller'dan (AstroBuildRunner) — circular DI yok. .astro + dist gerçek per-build dir (cache isolation).
  create(root: string, jobId: string): string {
    const iso = this.safeIso(jobId);
    fs.mkdirSync(iso, { recursive: true });
    for (const name of LINK_DIRS) {
      const target = path.join(root, name);
      if (!fs.existsSync(target)) continue;
      fs.symlinkSync(target, path.join(iso, name), process.platform === 'win32' ? 'junction' : 'dir');
    }
    for (const name of COPY_FILES) {
      const target = path.join(root, name);
      if (!fs.existsSync(target)) continue;
      fs.copyFileSync(target, path.join(iso, name));
    }
    fs.mkdirSync(path.join(iso, '.astro'), { recursive: true });
    fs.mkdirSync(path.join(iso, 'dist'), { recursive: true });
    return iso;
  }

  // rmSync junction'ı follow ETMEZ (link'i unlink eder, gerçek node_modules/src korunur).
  cleanup(jobId: string): void {
    try {
      fs.rmSync(this.safeIso(jobId), { recursive: true, force: true });
    } catch (err) {
      // Geçersiz jobId sessiz no-op: cleanup throw etmez, sadece uyarır (issue #11).
      this.logger.warn(`workspace cleanup atlandı: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  cleanupAll(): void {
    if (!fs.existsSync(this.workspaceDir)) return;
    for (const name of fs.readdirSync(this.workspaceDir)) {
      try {
        fs.rmSync(path.join(this.workspaceDir, name), { recursive: true, force: true });
      } catch (err) {
        this.logger.warn(`workspace cleanup başarısız: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
