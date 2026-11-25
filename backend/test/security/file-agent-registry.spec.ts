import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileAgentRegistry, defaultAgentsFile } from '../../src/security/infrastructure/file-agent-registry';
import { UnknownAgentError } from '../../src/security/domain/errors';

const FIXTURE = {
  operator: { name: 'İnsan Operatör', perms: { create: true, edit: true, delete: true, commerce: true, publish: true } },
  'content-studio': { name: 'İçerik Stüdyosu', perms: { create: true, edit: true, delete: true, commerce: false, publish: false } },
  'commerce-bot': { name: 'Commerce Bot', perms: { create: false, edit: true, delete: false, commerce: true, publish: false } },
  'seo-agent': { name: 'SEO Agent', perms: { create: false, edit: true, delete: false, commerce: false, publish: false } },
  reader: { name: 'Salt Okunur', perms: { create: false, edit: false, delete: false, commerce: false, publish: false } },
};

const origAgentsFile = process.env.ASTROPRESS_AGENTS_FILE;
let tmpDir: string | null = null;
afterEach(() => {
  if (tmpDir) { fs.rmSync(tmpDir, { recursive: true, force: true }); tmpDir = null; }
  if (origAgentsFile === undefined) delete process.env.ASTROPRESS_AGENTS_FILE;
  else process.env.ASTROPRESS_AGENTS_FILE = origAgentsFile;
});

function makeRegistry(): FileAgentRegistry {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-registry-'));
  const file = path.join(tmpDir, 'agents.json');
  fs.writeFileSync(file, JSON.stringify(FIXTURE), 'utf8');
  return new FileAgentRegistry(file);
}

test('getAgent known returns {id,name,perms}', async () => {
  const agent = await makeRegistry().getAgent('content-studio');
  assert.deepEqual(agent, {
    id: 'content-studio',
    name: 'İçerik Stüdyosu',
    perms: { create: true, edit: true, delete: true, commerce: false, publish: false },
  });
});

test('getAgent unknown rejects UnknownAgentError with MCP-parity message', async () => {
  const registry = makeRegistry();
  await assert.rejects(registry.getAgent('hacker'), UnknownAgentError);
  await assert.rejects(registry.getAgent('hacker'), /Bilinmeyen agent: hacker/);
});

test('getAgent prototype-chain names reject UnknownAgentError (own-property guard)', async () => {
  const registry = makeRegistry();
  for (const id of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    await assert.rejects(registry.getAgent(id), UnknownAgentError);
    await assert.rejects(registry.getAgent(id), /Bilinmeyen agent: /);
  }
});

test('listAgents returns all 5 agents', async () => {
  const agents = await makeRegistry().listAgents();
  assert.equal(agents.length, 5);
  assert.deepEqual(agents.map((a) => a.id).sort(), ['commerce-bot', 'content-studio', 'operator', 'reader', 'seo-agent']);
});

test('defaultAgentsFile honors ASTROPRESS_AGENTS_FILE env override', () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-registry-'));
  const custom = path.join(tmpDir, 'custom-agents.json');
  process.env.ASTROPRESS_AGENTS_FILE = custom;
  assert.equal(defaultAgentsFile(), custom);
});

test('defaultAgentsFile walks to astro.config.mjs root and returns agents.json', () => {
  delete process.env.ASTROPRESS_AGENTS_FILE;
  const file = defaultAgentsFile();
  assert.equal(path.basename(file), 'agents.json');
  assert.ok(fs.existsSync(path.join(path.dirname(file), 'astro.config.mjs')));
});