import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { PostgresSiteRepository } from '../../src/sites/infrastructure/postgres-site.repository';
import { Site } from '../../src/sites/domain/site';
import { SiteValidationError } from '../../src/sites/domain/errors';
import { SkipTest } from './site-repository.contract';

const url = process.env.DATABASE_URL;
const skip = url ? undefined : 'DATABASE_URL tanımlı değil — Postgres unit atlandı';

async function freshRepo(): Promise<PostgresSiteRepository> {
  const repo = new PostgresSiteRepository(url!);
  try { await repo.init(); }
  catch { await repo.close().catch(() => {}); throw new SkipTest('Postgres sunucusuna ulaşılamıyor'); }
  const p = new Pool({ connectionString: url! });
  try { await p.query('TRUNCATE sites'); } finally { await p.end(); }
  return repo;
}

const a = Site.create({ id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' });

test('postgres kalıcılık: close + reopen aynı veriyi okur', { skip }, async (t) => {
  let repo: PostgresSiteRepository | null = null;
  try { repo = await freshRepo(); }
  catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    await repo.save(a);
    await repo.close();
    repo = null;
    const reopened = new PostgresSiteRepository(url!);
    await reopened.init();
    try {
      const found = await reopened.findById('kahve');
      assert.ok(found);
      assert.equal(found.name, 'Kahve');
      assert.equal(found.localePrefix('en'), '/en');
    } finally { await reopened.close(); }
  } finally { if (repo) await repo.close().catch(() => {}); }
});

test('postgres locales JSON kolon olarak saklanır (SiteProps ile birebir)', { skip }, async (t) => {
  let repo: PostgresSiteRepository | null = null;
  try { repo = await freshRepo(); }
  catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    await repo.save(a);
    const p = new Pool({ connectionString: url! });
    try {
      const result = await p.query('SELECT locales, default_locale FROM sites WHERE id = $1', ['kahve']);
      const row = result.rows[0] as { locales: string; default_locale: string };
      assert.deepEqual(JSON.parse(row.locales), ['tr', 'en']);
      assert.equal(row.default_locale, 'tr');
    } finally { await p.end(); }
  } finally { if (repo) await repo.close().catch(() => {}); }
});

test('postgres read-time revalidation: bozuk satır Site.create ile reddedilir', { skip }, async (t) => {
  let repo: PostgresSiteRepository | null = null;
  try { repo = await freshRepo(); }
  catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    const p = new Pool({ connectionString: url! });
    try {
      await p.query(
        'INSERT INTO sites (id, name, locales, default_locale) VALUES ($1, $2, $3, $4)',
        ['bozuk', 'Bozuk', JSON.stringify(['tr']), 'en'],
      );
    } finally { await p.end(); }
    await assert.rejects(() => repo!.findAll(), SiteValidationError);
  } finally { if (repo) await repo.close().catch(() => {}); }
});