import { Injectable } from '@nestjs/common';
import { Site } from '../domain/site';
import { SiteRepository } from '../application/ports';

// İlk adapter: in-memory. Dosya/SQLite adapter'ları aynı portu implemente edecek (P1.2+).
@Injectable()
export class InMemorySiteRepository implements SiteRepository {
  private readonly sites = new Map<string, Site>();

  async save(site: Site): Promise<void> {
    this.sites.set(site.id, site);
  }

  async findById(id: string): Promise<Site | null> {
    return this.sites.get(id) ?? null;
  }

  async findAll(): Promise<Site[]> {
    return [...this.sites.values()];
  }

  async exists(id: string): Promise<boolean> {
    return this.sites.has(id);
  }
}