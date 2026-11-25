import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UnauthorizedException } from '@nestjs/common';
import { TokenIdentityResolver } from '../../src/security/infrastructure/token-identity.resolver';
import { FileAgentRegistry } from '../../src/security/infrastructure/file-agent-registry';
import { TokenStore, hashToken } from '../../src/security/application/token-store';
import { AgentRequest } from '../../src/security/interface/agent-request';

const FIXTURE = {
  'content-studio': { name: 'İçerik Stüdyosu', perms: { create: true, edit: true, delete: true, commerce: false, publish: false } },
  reader: { name: 'Salt Okunur', perms: { create: false, edit: false, delete: false, commerce: false, publish: false } },
};

// In-memory TokenStore stub (unit izolasyon; FileTokenStore ayrı spec'te).
class StubTokenStore implements TokenStore {
  private readonly map = new Map<string, string>();
  async findAgentByHash(hash: string): Promise<string | null> {
    for (const [agentId, stored] of this.map) if (stored === hash) return agentId;
    return null;
  }
  async setHash(agentId: string, hash: string): Promise<void> { this.map.set(agentId, hash); }
}

let dir: string;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

async function setup(): Promise<{ resolver: TokenIdentityResolver; store: StubTokenStore }> {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-token-resolver-'));
  const file = path.join(dir, 'agents.json');
  fs.writeFileSync(file, JSON.stringify(FIXTURE), 'utf8');
  const store = new StubTokenStore();
  await store.setHash('content-studio', hashToken('astro_valid'));
  return { resolver: new TokenIdentityResolver(store, new FileAgentRegistry(file)), store };
}

function req(headers: Record<string, string>): AgentRequest {
  return { method: 'GET', headers };
}

test('valid bearer → correct agent', async () => {
  const { resolver } = await setup();
  const agent = await resolver.resolve(req({ authorization: 'Bearer astro_valid' }));
  assert.equal(agent.id, 'content-studio');
});

test('missing authorization → 401 (fallback YOK)', async () => {
  const { resolver } = await setup();
  await assert.rejects(resolver.resolve(req({})), UnauthorizedException);
});

test('non-Bearer scheme → 401', async () => {
  const { resolver } = await setup();
  await assert.rejects(resolver.resolve(req({ authorization: 'Basic astro_valid' })), UnauthorizedException);
});

test('unknown token → 401', async () => {
  const { resolver } = await setup();
  await assert.rejects(resolver.resolve(req({ authorization: 'Bearer astro_wrong' })), UnauthorizedException);
});

test('X-Astropress-Agent ignored (no bearer → 401)', async () => {
  const { resolver } = await setup();
  await assert.rejects(resolver.resolve(req({ 'x-astropress-agent': 'content-studio' })), UnauthorizedException);
});

test('registry drift: hash → unknown agentId → 401', async () => {
  const { resolver, store } = await setup();
  await store.setHash('ghost', hashToken('astro_ghost'));
  await assert.rejects(resolver.resolve(req({ authorization: 'Bearer astro_ghost' })), UnauthorizedException);
});

test('bearer case-insensitive scheme', async () => {
  const { resolver } = await setup();
  const agent = await resolver.resolve(req({ authorization: 'bearer astro_valid' }));
  assert.equal(agent.id, 'content-studio');
});