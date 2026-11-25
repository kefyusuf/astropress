import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { defaultSitesFile } from '../../src/sites/infrastructure/file-site.repository';
import { Site } from '../../src/sites/domain/site';

// Committed registry (tek kaynak) sözleşmesi: shipped sites.json domain kurallarını sağlamalı.
// Doğrulama kuralları tek yerde (domain) kalır; bu test onları committed config'e uygular.
// ASTROPRESS_SITES_FILE override'ını geçici kaldırıp gerçek committed dosyayı okur.
function committedRegistry(): any[] {
  const orig = process.env.ASTROPRESS_SITES_FILE;
  delete process.env.ASTROPRESS_SITES_FILE;
  try {
    return JSON.parse(fs.readFileSync(defaultSitesFile(), 'utf8'));
  } finally {
    if (orig === undefined) delete process.env.ASTROPRESS_SITES_FILE;
    else process.env.ASTROPRESS_SITES_FILE = orig;
  }
}

test('committed sites.json boş olmayan bir array', () => {
  const raw = committedRegistry();
  assert.ok(Array.isArray(raw) && raw.length > 0);
});

test('her committed site domain doğrulamasından geçer', () => {
  for (const p of committedRegistry()) {
    const site = Site.create(p);
    assert.ok(site.hasLocale(site.defaultLocale));
  }
});

test('committed site id\'leri tekrarsız', () => {
  const ids = committedRegistry().map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});