import { Pool } from 'pg';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Site } from '../domain/site';
import { SiteRepository } from '../application/ports';

export const DATABASE_URL = Symbol('DATABASE_URL');

interface SiteRow {
  id: string;
  name: string;
  locales: string;
  default_locale: string;
}

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  locales TEXT NOT NULL,
  default_locale TEXT NOT NULL
)`;

@Injectable()
export class PostgresSiteRepository implements SiteRepository, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(DATABASE_URL) url: string) {
    if (!url) throw new Error('DATABASE_URL tanımlı değil (ASTROPRESS_STORAGE=postgres)');
    this.pool = new Pool({ connectionString: url });
  }

  // Şema init: factory ve bridge CLI construction sonrası await eder (idempotent).
  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE);
  }

  async save(site: Site): Promise<void> {
    await this.pool.query(
      `INSERT INTO sites (id, name, locales, default_locale) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, locales = EXCLUDED.locales, default_locale = EXCLUDED.default_locale`,
      [site.id, site.name, JSON.stringify([...site.locales]), site.defaultLocale],
    );
  }

  async findById(id: string): Promise<Site | null> {
    const result = await this.pool.query(
      'SELECT id, name, locales, default_locale FROM sites WHERE id = $1', [id],
    );
    return result.rows.length ? this.toSite(result.rows[0] as SiteRow) : null;
  }

  async findAll(): Promise<Site[]> {
    const result = await this.pool.query('SELECT id, name, locales, default_locale FROM sites');
    return result.rows.map((r: SiteRow) => this.toSite(r));
  }

  async exists(id: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM sites WHERE id = $1', [id]);
    return result.rows.length > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  onModuleDestroy(): void {
    void this.close();
  }

  // Persisted veri read-time yeniden validate edilir (tek doğrulama noktası: domain).
  private toSite(row: SiteRow): Site {
    return Site.create({
      id: row.id,
      name: row.name,
      locales: JSON.parse(row.locales) as string[],
      defaultLocale: row.default_locale,
    });
  }
}