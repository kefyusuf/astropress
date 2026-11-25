import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MintToken } from '../../src/security/application/mint-token';
import { FileAgentRegistry } from '../../src/security/infrastructure/file-agent-registry';
import { FileTokenStore } from '../../src/security/infrastructure/file-token-store';
import { hashToken } from '../../src/security/application/token-store';
import { UnknownAgentError } from '../../src/security/domain/errors';

const FIXTURE = {
  'content-studio': { name: 'İçerik Stüdyosu', perms: { create: true, edit: true, delete: true, commerce: false, publish: false } },
  reader: { name: 'Salt Okunur', perms: { create: false, edit: false, delete: false, commerce: false, publish: false } },
};

let dir: string;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

function setup(): { mint: MintToken; store: FileTokenStore } {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-mint-'));
  const agentsFile = path.join(dir, 'agents.json');
  fs.writeFileSync(agentsFile, JSON.stringify(FIXTURE), 'utf8');
  const store = new FileTokenStore(path.join(dir, 'agent-tokens.json'));
  return { mint: new MintToken(new FileAgentRegistry(agentsFile), store), store };
}

test('execute valid agent → astro_ token, hash stored', async () => {
  const { mint, store } = setup();
  const token = await mint.execute('content-studio');
  assert.match(token, /^astro_[A-Za-z0-9_-]{43}$/);
  assert.equal(store.findAgentByHash(hashToken(token)), 'content-studio');
});

test('execute unknown agent → UnknownAgentError', async () => {
  const { mint } = setup();
  await assert.rejects(mint.execute('ghost'), UnknownAgentError);
});

test('rotation: second execute → new token valid, old token null', async () => {
  const { mint, store } = setup();
  const first = await mint.execute('reader');
  const second = await mint.execute('reader');
  assert.notEqual(first, second);
  assert.equal(store.findAgentByHash(hashToken(second)), 'reader');
  assert.equal(store.findAgentByHash(hashToken(first)), null);
});

test('tokens unique across agents', async () => {
  const { mint, store } = setup();
  const a = await mint.execute('reader');
  const b = await mint.execute('content-studio');
  assert.notEqual(a, b);
  assert.equal(store.findAgentByHash(hashToken(a)), 'reader');
  assert.equal(store.findAgentByHash(hashToken(b)), 'content-studio');
});