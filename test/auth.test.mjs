import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ASTROPRESS_AGENT = 'content-studio';
const auth = await import('../mcp/auth.mjs');

test('varsayılan kimlik content-studio', () => {
  assert.equal(auth.AGENT_ID, 'content-studio');
  assert.equal(auth.getAgent().id, 'content-studio');
});

test('operator (insan) tüm yetkilere sahip', () => {
  const p = auth.getAgent('operator').perms;
  assert.deepEqual(p, { create: true, edit: true, delete: true, commerce: true, publish: true, build: true });
});

test('build yetkisi yalnız operatörde (RBAC: run_build korunur)', () => {
  for (const a of auth.listAgents()) {
    assert.equal(a.perms.build, a.id === 'operator', a.id + ' build yetkisi yanlış');
  }
});

test('content-studio: create/edit/delete var, commerce/publish yok', () => {
  const p = auth.getAgent('content-studio').perms;
  assert.equal(p.create, true);
  assert.equal(p.edit, true);
  assert.equal(p.delete, true);
  assert.equal(p.commerce, false);
  assert.equal(p.publish, false);
});

test('commerce-bot: create yok, commerce var', () => {
  const p = auth.getAgent('commerce-bot').perms;
  assert.equal(p.create, false);
  assert.equal(p.commerce, true);
  assert.equal(p.publish, false);
});

test('reader: salt okunur (tüm yetkiler kapalı)', () => {
  const p = auth.getAgent('reader').perms;
  assert.ok(Object.values(p).every((v) => v === false));
});

test('hiçbir agent publish yetkisine sahip değil (self-approve deliği kapalı)', () => {
  for (const a of auth.listAgents()) {
    if (a.id === 'operator') continue;
    assert.equal(a.perms.publish, false, a.id + ' publish:false olmalı');
  }
});

test('bilinmeyen agent hata verir', () => {
  assert.throws(() => auth.getAgent('hacker'), /Bilinmeyen agent/);
});

test('listAgents: kayıt defterinin tamamı', () => {
  const ids = auth.listAgents().map((a) => a.id).sort();
  assert.deepEqual(ids, ['commerce-bot', 'content-studio', 'operator', 'reader', 'seo-agent']);
});

test('HUMAN: tüm yetkiler açık', () => {
  assert.equal(auth.HUMAN.id, 'human');
  assert.ok(Object.values(auth.HUMAN.perms).every((v) => v === true));
});