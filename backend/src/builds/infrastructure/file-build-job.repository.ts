import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BuildJob, BuildJobProps } from '../domain/build-job';
import { BuildJobRepository } from '../application/ports';

export const BUILDS_FILE = Symbol('BUILDS_FILE');

// Runtime state: .astropress/builds.json (tasks/audit parity, config değil).
// ASTROPRESS_STATE test izolasyonu için temp'e yönlendirir (store.mjs convention).
// Repo kökü astro.config.mjs işaretçisine yürüyerek bulunur (defaultSitesFile pattern).
export function defaultBuildsFile(): string {
  if (process.env.ASTROPRESS_STATE) return path.join(process.env.ASTROPRESS_STATE, 'builds.json');
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'astro.config.mjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(dir, '.astropress', 'builds.json');
}

@Injectable()
export class FileBuildJobRepository implements BuildJobRepository {
  private readonly logger = new Logger(FileBuildJobRepository.name);

  constructor(@Inject(BUILDS_FILE) private readonly file: string) {}

  private readAll(): BuildJob[] {
    if (!fs.existsSync(this.file)) return [];
    // Transient IO (EBUSY/EPERM) propagate eder — quarantine ETME (state yanlışlıkla destroy edilmez).
    const raw = fs.readFileSync(this.file, 'utf8');
    try {
      const props = JSON.parse(raw) as BuildJobProps[];
      return props.map((p) => BuildJob.create(p));
    } catch (err) {
      // Corrupt content (parse/revalidation/type) → quarantine + empty: boot/guard-safe, slice functional kalır.
      this.logger.warn(`builds.json bozuk, quarantine ediliyor: ${err instanceof Error ? err.message : String(err)}`);
      this.quarantine();
      return [];
    }
  }

  private quarantine(): void {
    try {
      fs.renameSync(this.file, `${this.file}.corrupt`);
    } catch (err) {
      this.logger.warn(`quarantine rename başarısız: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private writeAll(jobs: BuildJob[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const props = jobs.map((j) => j.toProps());
    // Atomic: tmp'ye yaz + rename (same-dir → crash mid-write truncated dosya bırakmaz).
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(props, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  async save(job: BuildJob): Promise<void> {
    const all = this.readAll();
    const i = all.findIndex((j) => j.id === job.id);
    if (i >= 0) all[i] = job;
    else all.push(job);
    this.writeAll(all);
  }

  async findById(id: string): Promise<BuildJob | null> {
    return this.readAll().find((j) => j.id === id) ?? null;
  }

  async findAll(): Promise<BuildJob[]> {
    return this.readAll();
  }
}