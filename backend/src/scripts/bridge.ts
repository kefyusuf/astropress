import 'reflect-metadata';
import { SqliteSiteRepository, defaultDbFile } from '../sites/infrastructure/sqlite-site.repository';
import { FileSiteRepository, defaultSitesFile } from '../sites/infrastructure/file-site.repository';
import { seedFromJson, exportToJson } from '../sites/infrastructure/registry-bridge';
import { SiteRepository } from '../sites/application/ports';

// Model A köprü CLI: committed sites.json ↔ storage.
// Kullanım: npm --prefix backend run seed|export (ASTROPRESS_STORAGE=file|sqlite; önce build).
async function main(): Promise<void> {
  const cmd = process.argv[2];
  const mode = process.env.ASTROPRESS_STORAGE || 'file';
  const jsonFile = defaultSitesFile();
  const repo: SiteRepository =
    mode === 'sqlite' ? new SqliteSiteRepository(defaultDbFile()) : new FileSiteRepository(jsonFile);
  try {
    if (cmd === 'seed') {
      const n = await seedFromJson(repo, jsonFile);
      console.log(`seed: ${n} site → ${mode}`);
    } else if (cmd === 'export') {
      const n = await exportToJson(repo, jsonFile);
      console.log(`export: ${n} site → ${jsonFile}`);
    } else {
      console.error('Kullanım: bridge seed|export');
      process.exitCode = 1;
    }
  } finally {
    if (repo instanceof SqliteSiteRepository) repo.close();
  }
}

void main();