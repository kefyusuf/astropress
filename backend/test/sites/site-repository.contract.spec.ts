import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSiteRepositoryContract } from './site-repository.contract';
import { InMemorySiteRepository } from '../../src/sites/infrastructure/in-memory-site.repository';
import { FileSiteRepository } from '../../src/sites/infrastructure/file-site.repository';
import { SqliteSiteRepository } from '../../src/sites/infrastructure/sqlite-site.repository';

// Port tutarlılığı: aynı contract üç adapter'a karşı da geçmeli (regresyon + yeni adapter kanıtı).
function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-contract-'));
}

runSiteRepositoryContract('memory', () => ({ repo: new InMemorySiteRepository() }));

runSiteRepositoryContract('file', () => {
  const dir = tmpDir();
  return {
    repo: new FileSiteRepository(path.join(dir, 'sites.json')),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
});

runSiteRepositoryContract('sqlite', () => {
  const dir = tmpDir();
  const repo = new SqliteSiteRepository(path.join(dir, 'sites.db'));
  return {
    repo,
    cleanup: () => { repo.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
});