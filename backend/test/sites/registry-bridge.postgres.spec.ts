import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { PostgresSiteRepository } from '../../src/sites/infrastructure/postgres-site.repository';
import { seedFromJson, exportToJson } from '../../src/sites/infrastructure/registry-bridge';
import { SkipTest } from './site-repository.contract';

const url = process.env.DATABASE_URL;
const skip = url ? undefined : 'DATABASE_URL tanımlı değil — Postgres bridge atlandı';
const temps: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-pg-bridge-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop() as string, { recursive: true, force: true });
});

async function freshRepo(): Promise<PostgresSiteRepository> {
  const repo = new PostgresSiteRepository(url!);
  try { await repo.init(); }
  catch { await repo.close().catch(() => {}); throw new SkipTest('Postgres sunucusuna ulaşılamıyor'); }
  const p = new Pool({ connectionString: url! });
  try { await p.query('TRUNCATE sites'); } finally { await p.end(); }
  return repo;
}

const seed = [
  { id: 'kozkahve', name: 'Köz Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' },
  { id: 'coffee', name: 'Coffee', locales: ['en', 'tr'], defaultLocale: 'en' },
];
const byId = (arr: { id: string }[]) => [...arr].sort((x, y) => x.id.localeCompare(y.id));

test('postgres bridge seed → export round-trip: veri birebir korunur', { skip }, async (t) => {
  let repo: PostgresSiteRepository | null = null;
  try { repo = await freshRepo(); }
  catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  const dir = tmpDir();
  const jsonFile = path.join(dir, 'sites.json');
  const out = path.join(dir, 'out.json');
  fs.writeFileSync(jsonFile, JSON.stringify(seed, null, 2), 'utf8');
  try {
    assert.equal(await seedFromJson(repo, jsonFile), 2);
    assert.equal(await exportToJson(repo, out), 2);
    const exported = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.deepEqual(byId(exported), byId(seed));
  } finally { await repo.close().catch(() => {}); }
});

test('postgres bridge seed idempotent: tekrar seed kayıt sayısını değiştirmez', { skip }, async (t) => {
  let repo: PostgresSiteRepository | null = null;
  try { repo = await freshRepo(); }
  catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  const dir = tmpDir();
  const jsonFile = path.join(dir, 'sites.json');
  fs.writeFileSync(jsonFile, JSON.stringify(seed), 'utf8');
  try {
    await seedFromJson(repo, jsonFile);
    await seedFromJson(repo, jsonFile);
    assert.equal((await repo.findAll()).length, 2);
  } finally { await repo.close().catch(() => {}); }
});