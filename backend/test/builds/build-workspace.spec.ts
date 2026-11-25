import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BuildWorkspace } from '../../src/builds/infrastructure/build-workspace';

let dir: string;
let root: string;
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

// Sahte source root: src/ + node_modules/ dir, astro.config.mjs + package.json file.
function makeRoot(): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-ws-root-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'page.astro'), '<h1>hi</h1>');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'dep.js'), 'module.exports=1');
  fs.writeFileSync(path.join(root, 'astro.config.mjs'), 'export default {}');
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}');
  return root;
}
function makeWorkspace(): BuildWorkspace {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-ws-'));
  return new BuildWorkspace(dir);
}

test('create: src/node_modules link, config copy, .astro/dist gerçek per-build dir', () => {
  const r = makeRoot();
  const ws = makeWorkspace();
  const iso = ws.create(r, 'job-1');
  assert.equal(iso, path.join(dir, 'job-1'));
  assert.equal(fs.readFileSync(path.join(iso, 'src', 'page.astro'), 'utf8'), '<h1>hi</h1>');
  assert.equal(fs.readFileSync(path.join(iso, 'node_modules', 'dep.js'), 'utf8'), 'module.exports=1');
  assert.equal(fs.readFileSync(path.join(iso, 'package.json'), 'utf8'), '{"name":"x"}');
  assert.ok(fs.statSync(path.join(iso, '.astro')).isDirectory());
  assert.ok(fs.statSync(path.join(iso, 'dist')).isDirectory());
  assert.ok(!fs.lstatSync(path.join(iso, '.astro')).isSymbolicLink());
});

test('create: olmayan source entry atlanır (public/tsconfig yok → hata yok)', () => {
  const r = makeRoot();
  const ws = makeWorkspace();
  const iso = ws.create(r, 'job-2');
  assert.ok(!fs.existsSync(path.join(iso, 'public')));
  assert.ok(!fs.existsSync(path.join(iso, 'tsconfig.json')));
  assert.ok(fs.existsSync(path.join(iso, 'src')));
});

test('cleanup: farm silinir AMA gerçek root node_modules/src KORUNUR (junction follow YOK)', () => {
  const r = makeRoot();
  const ws = makeWorkspace();
  ws.create(r, 'job-3');
  ws.cleanup('job-3');
  assert.ok(!fs.existsSync(path.join(dir, 'job-3')), 'farm silinmeli');
  assert.ok(fs.existsSync(path.join(r, 'node_modules', 'dep.js')), 'gerçek node_modules silinmemeli');
  assert.ok(fs.existsSync(path.join(r, 'src', 'page.astro')), 'gerçek src silinmemeli');
});

test('cleanupAll: leftover farm\'ları siler (boot recovery)', () => {
  const r = makeRoot();
  const ws = makeWorkspace();
  ws.create(r, 'left-1');
  ws.create(r, 'left-2');
  ws.cleanupAll();
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.ok(fs.existsSync(path.join(r, 'node_modules', 'dep.js')), 'gerçek root korunur');
});

test('cleanupAll: workspaceDir yok → no-op (brick yok)', () => {
  dir = path.join(os.tmpdir(), 'astropress-ws-missing-' + Date.now());
  const ws = new BuildWorkspace(dir);
  ws.cleanupAll();
  assert.ok(!fs.existsSync(dir));
});