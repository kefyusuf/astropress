import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { PostgresTokenStore } from '../../src/security/infrastructure/postgres-token-store';
import { hashToken } from '../../src/security/application/token-store';
import { SkipTest } from '../sites/site-repository.contract';

const url = process.env.DATABASE_URL;
const skip = url ? undefined : 'DATABASE_URL tanımlı değil — Postgres token store unit atlandı';

async function freshStore(): Promise<PostgresTokenStore> {
  const p = new Pool({ connectionString: url! });
  try {
    await p.query('SELECT 1');
    await p.query('CREATE TABLE IF NOT EXISTS agent_tokens (agent_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE)');
    await p.query('TRUNCATE agent_tokens');
  } catch {
    await p.end().catch(() => {});
    throw new SkipTest('Postgres sunucusuna ulaşılamıyor');
  }
  await p.end();
  const store = new PostgresTokenStore(url!);
  await store.init();
  return store;
}

async function withPg(t: { skip: (m: string) => void }, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
}

test('setHash + findAgentByHash roundtrip → agentId', { skip }, async (t) => {
  await withPg(t, async () => {
    const store = await freshStore();
    try {
      await store.setHash('content-studio', hashToken('astro_secret'));
      assert.equal(await store.findAgentByHash(hashToken('astro_secret')), 'content-studio');
    } finally { await store.close(); }
  });
});

test('findAgentByHash unknown → null', { skip }, async (t) => {
  await withPg(t, async () => {
    const store = await freshStore();
    try {
      assert.equal(await store.findAgentByHash(hashToken('astro_wrong')), null);
    } finally { await store.close(); }
  });
});

test('rotation: aynı agent ikinci setHash → yeni geçerli, eski null (rotate=replace)', { skip }, async (t) => {
  await withPg(t, async () => {
    const store = await freshStore();
    try {
      await store.setHash('reader', hashToken('astro_old'));
      await store.setHash('reader', hashToken('astro_new'));
      assert.equal(await store.findAgentByHash(hashToken('astro_new')), 'reader');
      assert.equal(await store.findAgentByHash(hashToken('astro_old')), null);
    } finally { await store.close(); }
  });
});

test('multi-instance: A setHash → B findAgentByHash anında görür', { skip }, async (t) => {
  await withPg(t, async () => {
    const a = await freshStore();
    try {
      await a.setHash('content-studio', hashToken('astro_shared'));
      const b = new PostgresTokenStore(url!);
      await b.init();
      try {
        assert.equal(await b.findAgentByHash(hashToken('astro_shared')), 'content-studio');
      } finally { await b.close(); }
    } finally { await a.close(); }
  });
});

test('kalıcılık: close + reopen aynı hash\'i okur', { skip }, async (t) => {
  await withPg(t, async () => {
    let store: PostgresTokenStore | null = await freshStore();
    try {
      await store.setHash('operator', hashToken('astro_persist'));
      await store.close();
      store = null;
      const reopened = new PostgresTokenStore(url!);
      await reopened.init();
      try {
        assert.equal(await reopened.findAgentByHash(hashToken('astro_persist')), 'operator');
      } finally { await reopened.close(); }
    } finally { if (store) await store.close().catch(() => {}); }
  });
});

test('boş url → constructor throw (boot error)', () => {
  assert.throws(() => new PostgresTokenStore(''), /DATABASE_URL tanımlı değil/);
});