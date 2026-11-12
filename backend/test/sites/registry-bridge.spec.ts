import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteSiteRepository } from '../../src/sites/infrastructure/sqlite-site.repository';
import { seedFromJson, exportToJson } from '../../src/sites/infrastructure/registry-bridge';

const temps: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-bridge-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop() as string, { recursive: true, force: true });
});

const seed = [
  { id: 'kozkahve', name: 'Köz Kahve', locales: ['tr', 'en'], defaultLocale: 'tr' },
  { id: 'coffee', name: 'Coffee', locales: ['en', 'tr'], defaultLocale: 'en' },
];
const byId = (arr: { id: string }[]) => [...arr].sort((x, y) => x.id.localeCompare(y.id));

test('seed → export round-trip: veri birebir korunur', async () => {
  const dir = tmpDir();
  const jsonFile = path.join(dir, 'sites.json');
  const out = path.join(dir, 'out.json');
  fs.writeFileSync(jsonFile, JSON.stringify(seed, null, 2), 'utf8');
  const repo = new SqliteSiteRepository(path.join(dir, 'sites.db'));
  try {
    assert.equal(await seedFromJson(repo, jsonFile), 2);
    assert.equal(await exportToJson(repo, out), 2);
    const exported = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.deepEqual(byId(exported), byId(seed));
  } finally { repo.close(); }
});

test('seed idempotent: tekrar seed kayıt sayısını değiştirmez', async () => {
  const dir = tmpDir();
  const jsonFile = path.join(dir, 'sites.json');
  fs.writeFileSync(jsonFile, JSON.stringify(seed), 'utf8');
  const repo = new SqliteSiteRepository(path.join(dir, 'sites.db'));
  try {
    await seedFromJson(repo, jsonFile);
    await seedFromJson(repo, jsonFile);
    assert.equal((await repo.findAll()).length, 2);
  } finally { repo.close(); }
});

test('seed: dosya yoksa 0 · export: boş DB → []', async () => {
  const dir = tmpDir();
  const repo = new SqliteSiteRepository(path.join(dir, 'sites.db'));
  try {
    assert.equal(await seedFromJson(repo, path.join(dir, 'yok.json')), 0);
    const out = path.join(dir, 'out.json');
    assert.equal(await exportToJson(repo, out), 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), []);
  } finally { repo.close(); }
});