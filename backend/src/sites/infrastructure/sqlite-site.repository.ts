import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Site } from '../domain/site';
import { SiteRepository } from '../application/ports';

export const DB_FILE = Symbol('DB_FILE');

// DB runtime state'tir (.astropress/ gitignore'lu) — committed sites.json config olarak kalır (F0).
// Repo kökü astro.config.mjs işaretçisine yürüyerek bulunur (cwd/dist derinliğinden bağımsız).
export function defaultDbFile(): string {
  if (process.env.ASTROPRESS_DB_FILE) return process.env.ASTROPRESS_DB_FILE;
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'astro.config.mjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(dir, '.astropress', 'sites.db');
}

interface SiteRow {
  id: string;
  name: string;
  locales: string;
  default_locale: string;
}

@Injectable()
export class SqliteSiteRepository implements SiteRepository, OnModuleDestroy {
  private readonly db: Database.Database;

  constructor(@Inject(DB_FILE) file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, name TEXT NOT NULL, locales TEXT NOT NULL, default_locale TEXT NOT NULL)',
    );
  }

  async save(site: Site): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO sites (id, name, locales, default_locale) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, locales = excluded.locales, default_locale = excluded.default_locale`,
      )
      .run(site.id, site.name, JSON.stringify([...site.locales]), site.defaultLocale);
  }

  async findById(id: string): Promise<Site | null> {
    const row = this.db.prepare('SELECT id, name, locales, default_locale FROM sites WHERE id = ?').get(id) as SiteRow | undefined;
    return row ? this.toSite(row) : null;
  }

  async findAll(): Promise<Site[]> {
    const rows = this.db.prepare('SELECT id, name, locales, default_locale FROM sites').all() as SiteRow[];
    return rows.map((r) => this.toSite(r));
  }

  async exists(id: string): Promise<boolean> {
    return this.db.prepare('SELECT 1 FROM sites WHERE id = ?').get(id) !== undefined;
  }

  close(): void {
    this.db.close();
  }

  onModuleDestroy(): void {
    this.close();
  }

  // Persisted veri read-time yeniden validate edilir (tek doğrulama noktası: domain).
  private toSite(row: SiteRow): Site {
    return Site.create({ id: row.id, name: row.name, locales: JSON.parse(row.locales) as string[], defaultLocale: row.default_locale });
  }
}