import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileTokenStore } from '../../src/security/infrastructure/file-token-store';
import { hashToken } from '../../src/security/application/token-store';

let dir: string;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

function setup(): { store: FileTokenStore; file: string } {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-tokens-'));
  const file = path.join(dir, 'agent-tokens.json');
  return { store: new FileTokenStore(file), file };
}

test('hashToken: deterministic sha256 hex, 64 char', () => {
  const h = hashToken('astro_abc');
  assert.equal(h, hashToken('astro_abc'));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, hashToken('astro_xyz'));
});

test('port async: findAgentByHash/setHash Promise döner', () => {
  const { store } = setup();
  assert.ok(store.setHash('reader', hashToken('astro_p')) instanceof Promise);
  assert.ok(store.findAgentByHash(hashToken('astro_p')) instanceof Promise);
});

test('setHash + findAgentByHash roundtrip → agentId', async () => {
  const { store } = setup();
  await store.setHash('content-studio', hashToken('astro_secret'));
  assert.equal(await store.findAgentByHash(hashToken('astro_secret')), 'content-studio');
});

test('findAgentByHash unknown → null', async () => {
  const { store } = setup();
  await store.setHash('content-studio', hashToken('astro_secret'));
  assert.equal(await store.findAgentByHash(hashToken('astro_wrong')), null);
});

test('missing file → findAgentByHash null; setHash creates file', async () => {
  const { store, file } = setup();
  assert.equal(await store.findAgentByHash(hashToken('astro_x')), null);
  assert.ok(!fs.existsSync(file));
  await store.setHash('reader', hashToken('astro_x'));
  assert.ok(fs.existsSync(file));
  assert.equal(await store.findAgentByHash(hashToken('astro_x')), 'reader');
});

test('rotation: setHash same agent twice → latest wins, old null', async () => {
  const { store } = setup();
  await store.setHash('reader', hashToken('astro_old'));
  await store.setHash('reader', hashToken('astro_new'));
  assert.equal(await store.findAgentByHash(hashToken('astro_new')), 'reader');
  assert.equal(await store.findAgentByHash(hashToken('astro_old')), null);
});

test('timing-safe: equal-length different hash → null (throw YOK)', async () => {
  const { store } = setup();
  await store.setHash('reader', hashToken('astro_a'));
  assert.equal(await store.findAgentByHash(hashToken('astro_b')), null);
});

test('multiple agents: distinct hashes resolve correctly', async () => {
  const { store } = setup();
  await store.setHash('reader', hashToken('astro_r'));
  await store.setHash('operator', hashToken('astro_o'));
  assert.equal(await store.findAgentByHash(hashToken('astro_r')), 'reader');
  assert.equal(await store.findAgentByHash(hashToken('astro_o')), 'operator');
});