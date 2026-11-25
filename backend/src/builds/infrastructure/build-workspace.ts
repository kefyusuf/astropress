import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';

export const BUILD_WORKSPACE_DIR = Symbol('BUILD_WORKSPACE_DIR');

// ASTROPRESS_STATE/build-workspaces (varsa) yoksa repo kökü .astropress/build-workspaces (defaultEventsDir emsali).
export function defaultWorkspaceDir(): string {
  if (process.env.ASTROPRESS_STATE) return path.join(process.env.ASTROPRESS_STATE, 'build-workspaces');
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'astro.config.mjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(dir, '.astropress', 'build-workspaces');
}

// dir → junction (win32, admin gerektirmez) / dir symlink (POSIX). node_modules read-only paylaşım.
const LINK_DIRS = ['src', 'public', 'node_modules'];
// config dosyaları copy (win32 file-symlink privilege gerektirmez; küçük dosya).
const COPY_FILES = ['astro.config.mjs', 'package.json', 'tsconfig.json'];

@Injectable()
export class BuildWorkspace {
  private readonly logger = new Logger(BuildWorkspace.name);
  constructor(@Inject(BUILD_WORKSPACE_DIR) private readonly workspaceDir: string) {}

  // root caller'dan (AstroBuildRunner) — circular DI yok. .astro + dist gerçek per-build dir (cache isolation).
  create(root: string, jobId: string): string {
    const iso = path.join(this.workspaceDir, jobId);
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
    fs.rmSync(path.join(this.workspaceDir, jobId), { recursive: true, force: true });
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