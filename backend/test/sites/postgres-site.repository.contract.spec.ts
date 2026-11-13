import 'reflect-metadata';
import { Pool } from 'pg';
import { runSiteRepositoryContract, SkipTest } from './site-repository.contract';
import { PostgresSiteRepository } from '../../src/sites/infrastructure/postgres-site.repository';

// Test-local helper: production repo'da truncate() YOK.
async function truncateSites(url: string): Promise<void> {
  const p = new Pool({ connectionString: url });
  try { await p.query('TRUNCATE sites'); } finally { await p.end(); }
}

const url = process.env.DATABASE_URL;
if (!url) {
  runSiteRepositoryContract('postgres', () => { throw new Error('unused'); },
    { skip: 'DATABASE_URL tanımlı değil — Postgres contract atlandı' });
} else {
  runSiteRepositoryContract('postgres', async () => {
    const repo = new PostgresSiteRepository(url);
    try {
      await repo.init();
    } catch {
      await repo.close().catch(() => {});
      throw new SkipTest('Postgres sunucusuna ulaşılamıyor');
    }
    await truncateSites(url);
    return { repo, cleanup: () => repo.close() };
  });
}