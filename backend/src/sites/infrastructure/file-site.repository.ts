import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { Site, SiteProps } from '../domain/site';
import { SiteRepository } from '../application/ports';

export const SITES_FILE = Symbol('SITES_FILE');

// Git-native varsayılan: insan-okunur JSON. Testler ASTROPRESS_SITES_FILE ile temp'e yönlendirir.
export function defaultSitesFile(): string {
  return process.env.ASTROPRESS_SITES_FILE || path.join(process.cwd(), '.astropress', 'sites.json');
}

@Injectable()
export class FileSiteRepository implements SiteRepository {
  constructor(@Inject(SITES_FILE) private readonly file: string) {}

  private readAll(): Site[] {
    if (!fs.existsSync(this.file)) return [];
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as SiteProps[];
    return raw.map((p) => Site.create(p));
  }

  private writeAll(sites: Site[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const props: SiteProps[] = sites.map((s) => ({
      id: s.id,
      name: s.name,
      locales: [...s.locales],
      defaultLocale: s.defaultLocale,
    }));
    fs.writeFileSync(this.file, JSON.stringify(props, null, 2), 'utf8');
  }

  async save(site: Site): Promise<void> {
    const all = this.readAll();
    const i = all.findIndex((s) => s.id === site.id);
    if (i >= 0) all[i] = site;
    else all.push(site);
    this.writeAll(all);
  }

  async findById(id: string): Promise<Site | null> {
    return this.readAll().find((s) => s.id === id) ?? null;
  }

  async findAll(): Promise<Site[]> {
    return this.readAll();
  }

  async exists(id: string): Promise<boolean> {
    return this.readAll().some((s) => s.id === id);
  }
}