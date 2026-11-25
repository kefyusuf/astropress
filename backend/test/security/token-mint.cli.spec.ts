import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { hashToken } from '../../src/security/application/token-store';

const url = process.env.DATABASE_URL;
const skip = url ? undefined : 'DATABASE_URL tanımlı değil — Postgres CLI testi atlandı';

const FIXTURE = {
  'content-studio': { name: 'İçerik Stüdyosu', perms: { create: true, edit: true, delete: true, commerce: false, publish: false } },
};

function makeAgentsFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-cli-'));
  const file = path.join(dir, 'agents.json');
  fs.writeFileSync(file, JSON.stringify(FIXTURE), 'utf8');
  return file;
}

function runCli(args: string[], env: Record<string, string>) {
  // __dirname = dist/test/security → dist/src/scripts (cwd'den bağımsız, repo walk emsali).
  const script = path.join(__dirname, '..', '..', 'src', 'scripts', 'token-mint.js');
  return spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('CLI file modu: mint → stdout astro_ token (parity)', () => {
  const agentsFile = makeAgentsFile();
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-cli-state-'));
  try {
    const r = runCli(['content-studio'], { ASTROPRESS_AGENTS_FILE: agentsFile, ASTROPRESS_STATE: state, ASTROPRESS_STORAGE: '' });
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^astro_[A-Za-z0-9_-]{43}$/);
  } finally {
    fs.rmSync(path.dirname(agentsFile), { recursive: true, force: true });
    fs.rmSync(state, { recursive: true, force: true });
  }
});

test('CLI postgres: mint → stdout token + DB hash doğrulama', { skip }, async (t) => {
  const p = new Pool({ connectionString: url! });
  try {
    await p.query('SELECT 1');
    await p.query('CREATE TABLE IF NOT EXISTS agent_tokens (agent_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE)');
    await p.query('TRUNCATE agent_tokens');
    await p.query('DROP TABLE IF EXISTS agents');
  } catch {
    await p.end().catch(() => {});
    t.skip('Postgres sunucusuna ulaşılamıyor');
    return;
  }
  await p.end();
  const agentsFile = makeAgentsFile();
  try {
    const r = runCli(['content-studio'], { ASTROPRESS_STORAGE: 'postgres', DATABASE_URL: url!, ASTROPRESS_AGENTS_FILE: agentsFile });
    assert.equal(r.status, 0);
    const token = r.stdout.trim();
    assert.match(token, /^astro_[A-Za-z0-9_-]{43}$/);
    const q = new Pool({ connectionString: url! });
    try {
      const res = await q.query('SELECT token_hash FROM agent_tokens WHERE agent_id = $1', ['content-studio']);
      assert.equal(res.rows.length, 1);
      assert.equal((res.rows[0] as { token_hash: string }).token_hash, hashToken(token));
    } finally { await q.end(); }
  } finally {
    fs.rmSync(path.dirname(agentsFile), { recursive: true, force: true });
    const c = new Pool({ connectionString: url! });
    try { await c.query('DROP TABLE IF EXISTS agents'); await c.query('TRUNCATE agent_tokens'); } finally { await c.end(); }
  }
});

test('CLI postgres: unknown agent → exit 1', { skip }, async (t) => {
  const p = new Pool({ connectionString: url! });
  try {
    await p.query('SELECT 1');
    await p.query('DROP TABLE IF EXISTS agents');
    await p.query('DROP TABLE IF EXISTS agent_tokens');
  } catch {
    await p.end().catch(() => {});
    t.skip('Postgres sunucusuna ulaşılamıyor');
    return;
  }
  await p.end();
  const agentsFile = makeAgentsFile();
  try {
    const r = runCli(['ghost'], { ASTROPRESS_STORAGE: 'postgres', DATABASE_URL: url!, ASTROPRESS_AGENTS_FILE: agentsFile });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Bilinmeyen agent: ghost/);
  } finally {
    fs.rmSync(path.dirname(agentsFile), { recursive: true, force: true });
    const c = new Pool({ connectionString: url! });
    try { await c.query('DROP TABLE IF EXISTS agents'); await c.query('DROP TABLE IF EXISTS agent_tokens'); } finally { await c.end(); }
  }
});