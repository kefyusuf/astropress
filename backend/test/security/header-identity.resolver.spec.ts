import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UnauthorizedException } from '@nestjs/common';
import { HeaderIdentityResolver } from '../../src/security/infrastructure/header-identity.resolver';
import { FileAgentRegistry } from '../../src/security/infrastructure/file-agent-registry';
import { AgentRequest } from '../../src/security/interface/agent-request';

const FIXTURE = {
  operator: { name: 'İnsan Operatör', perms: { create: true, edit: true, delete: true, commerce: true, publish: true } },
  'content-studio': { name: 'İçerik Stüdyosu', perms: { create: true, edit: true, delete: true, commerce: false, publish: false } },
  reader: { name: 'Salt Okunur', perms: { create: false, edit: false, delete: false, commerce: false, publish: false } },
};

let dir: string;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

function setup(): HeaderIdentityResolver {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-header-resolver-'));
  const file = path.join(dir, 'agents.json');
  fs.writeFileSync(file, JSON.stringify(FIXTURE), 'utf8');
  return new HeaderIdentityResolver(new FileAgentRegistry(file));
}

function req(headers: Record<string, string>): AgentRequest {
  return { method: 'GET', headers };
}

test('no header → default content-studio (parity)', async () => {
  const agent = await setup().resolve(req({}));
  assert.equal(agent.id, 'content-studio');
});

test('known header → agent', async () => {
  const agent = await setup().resolve(req({ 'x-astropress-agent': 'reader' }));
  assert.equal(agent.id, 'reader');
  assert.equal(agent.perms.create, false);
});

test('unknown header → UnauthorizedException (401 parity)', async () => {
  await assert.rejects(setup().resolve(req({ 'x-astropress-agent': 'hacker' })), UnauthorizedException);
});

test('empty header value → default content-studio', async () => {
  const agent = await setup().resolve(req({ 'x-astropress-agent': '' }));
  assert.equal(agent.id, 'content-studio');
});