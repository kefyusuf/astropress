import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { defaultRoot } from '../../src/builds/infrastructure/astro-build-runner';
import { BuildWorkspace } from '../../src/builds/infrastructure/build-workspace';

// Issue #11 kabul kriteri: script/onerror içeren markdown statik çıktıda çalıştırılabilir
// kod bırakmaz. Gerçek astro build (~sn'ler): rehype-sanitize pipeline'ının uçtan uca kanıtı.
// NOT: execFile cwd = iso — astro CLI bazı çözümlemeleri spawn cwd'sinden yapar; repo-ana
// cwd'sinden spawn edilen build cookie ESM çözümlemesinde patlar (AstroBuildRunner davranışı).
test('XSS markdown → dist temiz (rehype-sanitize uçtan uca)', { timeout: 240000 }, async () => {
  const root = defaultRoot();
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-sanitize-ws-'));
  try {
    const ws = new BuildWorkspace(wsDir);
    const iso = ws.create(root, 'xss-job');
    const blogDir = path.join(iso, 'src', 'content', 'blog');
    fs.mkdirSync(blogDir, { recursive: true });
    fs.writeFileSync(path.join(blogDir, 'xss-test.md'), [
      '---',
      'title: XSS Test',
      'status: published',
      'date: 2026-01-01',
      'lang: tr',
      '---',
      '',
      '<script>alert(1)</script>',
      '',
      '<img src=x onerror=alert(1)>',
      '',
      '[tıkla](javascript:alert(1))',
      '',
    ].join('\n'), 'utf8');

    const rootRequire = createRequire(path.join(root, 'package.json'));
    const astroPkg = rootRequire('astro/package.json');
    const binRel = typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin.astro;
    const astroCli = path.join(path.dirname(rootRequire.resolve('astro/package.json')), binRel);

    const distDir = path.join(iso, 'dist');
    const walk = (d: string): string[] => {
      const out: string[] = [];
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (p.endsWith('.html')) out.push(p);
      }
      return out;
    };

    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, [astroCli, 'build', '--root', iso, '--outDir', distDir], { cwd: iso, timeout: 220000 }, (err) => {
        if (err) reject(err); else resolve();
      });
    });

    const htmls = walk(distDir);
    assert.ok(htmls.length > 0, 'dist HTML üretildi');
    for (const file of htmls) {
      const html = fs.readFileSync(file, 'utf8');
      assert.ok(!html.includes('<script>alert'), `${file}: script kaldı`);
      assert.ok(!html.includes('onerror='), `${file}: onerror kaldı`);
      assert.ok(!html.includes('javascript:alert'), `${file}: javascript: URI kaldı`);
    }
  } finally { fs.rmSync(wsDir, { recursive: true, force: true }); }
});
