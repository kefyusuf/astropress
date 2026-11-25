import fs from 'node:fs';
import path from 'node:path';
import { Site, SiteProps } from '../domain/site';
import { SiteRepository } from '../application/ports';

// Model A köprüsü: committed sites.json (config) ↔ DB (runtime kaynak).
// seed: json → DB (idempotent upsert). export: DB → json (root build + git için).
// Root Astro build her zaman sites.json okur (F0); DB modunda build öncesi export gerekir.
export async function seedFromJson(repo: SiteRepository, jsonFile: string): Promise<number> {
  if (!fs.existsSync(jsonFile)) return 0;
  const raw = JSON.parse(fs.readFileSync(jsonFile, 'utf8')) as SiteProps[];
  for (const p of raw) {
    await repo.save(Site.create(p));
  }
  return raw.length;
}

export async function exportToJson(repo: SiteRepository, jsonFile: string): Promise<number> {
  const sites = await repo.findAll();
  const props: SiteProps[] = sites.map((s) => ({
    id: s.id,
    name: s.name,
    locales: [...s.locales],
    defaultLocale: s.defaultLocale,
  }));
  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  fs.writeFileSync(jsonFile, JSON.stringify(props, null, 2), 'utf8');
  return props.length;
}