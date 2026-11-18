import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
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
  constructor(@Inject(BUILDS_FILE) private readonly file: string) {}

  private readAll(): BuildJob[] {
    if (!fs.existsSync(this.file)) return [];
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as BuildJobProps[];
    return raw.map((p) => BuildJob.create(p));
  }

  private writeAll(jobs: BuildJob[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const props = jobs.map((j) => j.toProps());
    fs.writeFileSync(this.file, JSON.stringify(props, null, 2), 'utf8');
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