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

test('setHash + findAgentByHash roundtrip → agentId', () => {
  const { store } = setup();
  store.setHash('content-studio', hashToken('astro_secret'));
  assert.equal(store.findAgentByHash(hashToken('astro_secret')), 'content-studio');
});

test('findAgentByHash unknown → null', () => {
  const { store } = setup();
  store.setHash('content-studio', hashToken('astro_secret'));
  assert.equal(store.findAgentByHash(hashToken('astro_wrong')), null);
});

test('missing file → findAgentByHash null; setHash creates file', () => {
  const { store, file } = setup();
  assert.equal(store.findAgentByHash(hashToken('astro_x')), null);
  assert.ok(!fs.existsSync(file));
  store.setHash('reader', hashToken('astro_x'));
  assert.ok(fs.existsSync(file));
  assert.equal(store.findAgentByHash(hashToken('astro_x')), 'reader');
});

test('rotation: setHash same agent twice → latest wins, old null', () => {
  const { store } = setup();
  store.setHash('reader', hashToken('astro_old'));
  store.setHash('reader', hashToken('astro_new'));
  assert.equal(store.findAgentByHash(hashToken('astro_new')), 'reader');
  assert.equal(store.findAgentByHash(hashToken('astro_old')), null);
});

test('timing-safe: equal-length different hash → null (throw YOK)', () => {
  const { store } = setup();
  store.setHash('reader', hashToken('astro_a'));
  assert.equal(store.findAgentByHash(hashToken('astro_b')), null);
});

test('multiple agents: distinct hashes resolve correctly', () => {
  const { store } = setup();
  store.setHash('reader', hashToken('astro_r'));
  store.setHash('operator', hashToken('astro_o'));
  assert.equal(store.findAgentByHash(hashToken('astro_r')), 'reader');
  assert.equal(store.findAgentByHash(hashToken('astro_o')), 'operator');
});