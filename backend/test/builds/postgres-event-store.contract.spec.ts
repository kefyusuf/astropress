import 'reflect-metadata';
import { Pool } from 'pg';
import { runEventStoreContract, SkipTest } from './event-store.contract';
import { PostgresEventStore } from '../../src/builds/infrastructure/postgres-event-store';

async function truncateEvents(url: string): Promise<void> {
  const p = new Pool({ connectionString: url });
  try { await p.query('TRUNCATE build_events'); } finally { await p.end(); }
}

const url = process.env.DATABASE_URL;
if (!url) {
  runEventStoreContract('postgres', () => { throw new Error('unused'); },
    { skip: 'DATABASE_URL tanımlı değil — Postgres event store contract atlandı' });
} else {
  runEventStoreContract('postgres', async () => {
    const store = new PostgresEventStore(url);
    try { await store.init(); }
    catch { await store.close().catch(() => {}); throw new SkipTest('Postgres sunucusuna ulaşılamıyor'); }
    await truncateEvents(url);
    return { store, cleanup: () => store.close() };
  });
}