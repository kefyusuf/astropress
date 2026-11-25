import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Site } from '../../src/sites/domain/site';
import { SiteRepository } from '../../src/sites/application/ports';

// Paylaşımlı port sözleşmesi: her adapter (memory/file/sqlite/postgres) aynı davranışı vermeli.
// Factory her test için taze repo + opsiyonel cleanup döner; contract yalnız port metodlarını kullanır.
export interface RepoHarness {
  repo: SiteRepository;
  cleanup?: () => void | Promise<void>;
}

// Test harness'ı Postgres'e ulaşamazsa fırlatır → runner t.skip() ile test atlar (fail değil).
export class SkipTest extends Error {}

export function runSiteRepositoryContract(
  label: string,
  makeRepo: () => RepoHarness | Promise<RepoHarness>,
  opts?: { skip?: string },
): void {
  const a = Site.create({ id: 'kahve', name: 'Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' });
  const b = Site.create({ id: 'coffee', name: 'Coffee', locales: ['en', 'tr'], defaultLocale: 'en' });
  const testOpts = opts?.skip ? { skip: opts.skip } : {};

  test(`[${label}] boş: findById null, findAll [], exists false`, testOpts, async (t) => {
    let harness: RepoHarness;
    try { harness = await makeRepo(); }
    catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
    const { repo, cleanup } = harness;
    try {
      assert.equal(await repo.findById('kahve'), null);
      assert.deepEqual(await repo.findAll(), []);
      assert.equal(await repo.exists('kahve'), false);
    } finally { await cleanup?.(); }
  });

  test(`[${label}] save + findById + exists (domain Site döner)`, testOpts, async (t) => {
    let harness: RepoHarness;
    try { harness = await makeRepo(); }
    catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
    const { repo, cleanup } = harness;
    try {
      await repo.save(a);
      const found = await repo.findById('kahve');
      assert.ok(found);
      assert.equal(found.id, 'kahve');
      assert.equal(found.name, 'Kahve');
      assert.equal(found.defaultLocale, 'tr');
      assert.deepEqual([...found.locales], ['tr', 'en']);
      assert.equal(found.localePrefix('en'), '/en');
      assert.equal(await repo.exists('kahve'), true);
      assert.equal(await repo.exists('yok'), false);
    } finally { await cleanup?.(); }
  });

  test(`[${label}] save upsert: aynı id günceller, findAll tekil kalır`, testOpts, async (t) => {
    let harness: RepoHarness;
    try { harness = await makeRepo(); }
    catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
    const { repo, cleanup } = harness;
    try {
      await repo.save(a);
      await repo.save(Site.create({ id: 'kahve', name: 'Kahve', locales: ['en', 'tr'], defaultLocale: 'en' }));
      const all = await repo.findAll();
      assert.equal(all.length, 1);
      assert.equal(all[0].defaultLocale, 'en');
      assert.deepEqual([...all[0].locales], ['en', 'tr']);
    } finally { await cleanup?.(); }
  });

  test(`[${label}] findAll tüm siteleri döner`, testOpts, async (t) => {
    let harness: RepoHarness;
    try { harness = await makeRepo(); }
    catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
    const { repo, cleanup } = harness;
    try {
      await repo.save(a);
      await repo.save(b);
      const all = await repo.findAll();
      assert.equal(all.length, 2);
      assert.deepEqual(all.map((s) => s.id).sort(), ['coffee', 'kahve']);
    } finally { await cleanup?.(); }
  });

  test(`[${label}] findById bilinmeyen → null`, testOpts, async (t) => {
    let harness: RepoHarness;
    try { harness = await makeRepo(); }
    catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
    const { repo, cleanup } = harness;
    try {
      assert.equal(await repo.findById('yok'), null);
    } finally { await cleanup?.(); }
  });
}