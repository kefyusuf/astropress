import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { PostgresAgentRegistry } from '../../src/security/infrastructure/postgres-agent-registry';
import { UnknownAgentError } from '../../src/security/domain/errors';
import { SkipTest } from '../sites/site-repository.contract';

const url = process.env.DATABASE_URL;
const skip = url ? undefined : 'DATABASE_URL tanımlı değil — Postgres registry unit atlandı';

const FIXTURE = {
  'content-studio': { name: 'İçerik Stüdyosu', perms: { create: true, edit: true, delete: true, commerce: false, publish: false } },
  reader: { name: 'Salt Okunur', perms: { create: false, edit: false, delete: false, commerce: false, publish: false } },
};
const READER_PERMS = { create: false, edit: false, delete: false, commerce: false, publish: false };

function makeAgentsFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-pg-registry-'));
  const file = path.join(dir, 'agents.json');
  fs.writeFileSync(file, JSON.stringify(FIXTURE), 'utf8');
  return file;
}

async function freshRegistry(file: string): Promise<PostgresAgentRegistry> {
  const p = new Pool({ connectionString: url! });
  try {
    await p.query('SELECT 1');
    await p.query('CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, perms TEXT NOT NULL)');
    await p.query('TRUNCATE agents');
  } catch {
    await p.end().catch(() => {});
    throw new SkipTest('Postgres sunucusuna ulaşılamıyor');
  }
  await p.end();
  const registry = new PostgresAgentRegistry(url!, file);
  await registry.init();
  return registry;
}

async function withPg(t: { skip: (m: string) => void }, fn: (file: string) => Promise<void>): Promise<void> {
  const file = makeAgentsFile();
  try { await fn(file); }
  catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
}

test('init boot-seed: agents.json → getAgent fixture değerleri', { skip }, async (t) => {
  await withPg(t, async (file) => {
    const registry = await freshRegistry(file);
    try {
      assert.deepEqual(await registry.getAgent('content-studio'), { id: 'content-studio', name: 'İçerik Stüdyosu', perms: FIXTURE['content-studio'].perms });
    } finally { await registry.close(); }
  });
});

test('getAgent unknown → UnknownAgentError', { skip }, async (t) => {
  await withPg(t, async (file) => {
    const registry = await freshRegistry(file);
    try { await assert.rejects(registry.getAgent('hacker'), UnknownAgentError); }
    finally { await registry.close(); }
  });
});

test('listAgents tüm seed edilmiş agent\'lar', { skip }, async (t) => {
  await withPg(t, async (file) => {
    const registry = await freshRegistry(file);
    try {
      const agents = await registry.listAgents();
      assert.deepEqual(agents.map((a) => a.id).sort(), ['content-studio', 'reader']);
    } finally { await registry.close(); }
  });
});

test('seed idempotent: ikinci init → duplike yok', { skip }, async (t) => {
  await withPg(t, async (file) => {
    const registry = await freshRegistry(file);
    try {
      await registry.init();
      assert.equal((await registry.listAgents()).length, 2);
    } finally { await registry.close(); }
  });
});

test('drift düzeltme: DB name bozulur → init config değerini geri yazar', { skip }, async (t) => {
  await withPg(t, async (file) => {
    const registry = await freshRegistry(file);
    try {
      const p = new Pool({ connectionString: url! });
      try { await p.query(`UPDATE agents SET name = 'Bozuk' WHERE id = 'reader'`); } finally { await p.end(); }
      const healer = new PostgresAgentRegistry(url!, file);
      await healer.init();
      try { assert.equal((await healer.getAgent('reader')).name, 'Salt Okunur'); }
      finally { await healer.close(); }
    } finally { await registry.close(); }
  });
});

test('per-request freshness: config-dışı DB satırı anında görünür (cache yok)', { skip }, async (t) => {
  await withPg(t, async (file) => {
    const registry = await freshRegistry(file);
    try {
      const p = new Pool({ connectionString: url! });
      try {
        await p.query('INSERT INTO agents (id, name, perms) VALUES ($1, $2, $3)', ['ghost', 'Ghost', JSON.stringify(READER_PERMS)]);
      } finally { await p.end(); }
      assert.equal((await registry.getAgent('ghost')).name, 'Ghost');
    } finally { await registry.close(); }
  });
});

test('multi-instance: A seed + config-dışı satır → B aynı DB\'den okur', { skip }, async (t) => {
  await withPg(t, async (file) => {
    const a = await freshRegistry(file);
    try {
      const p = new Pool({ connectionString: url! });
      try {
        await p.query('INSERT INTO agents (id, name, perms) VALUES ($1, $2, $3)', ['ghost', 'Ghost', JSON.stringify(READER_PERMS)]);
      } finally { await p.end(); }
      const b = new PostgresAgentRegistry(url!, file);
      await b.init();
      try {
        assert.equal((await b.getAgent('ghost')).name, 'Ghost');
        assert.equal((await b.getAgent('content-studio')).name, 'İçerik Stüdyosu');
      } finally { await b.close(); }
    } finally { await a.close(); }
  });
});

test('boş url → constructor throw (boot error)', () => {
  const file = makeAgentsFile();
  try {
    assert.throws(() => new PostgresAgentRegistry('', file), /DATABASE_URL tanımlı değil/);
  } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
});