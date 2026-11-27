import fs from 'node:fs';
import path from 'node:path';

// Tek doğruluk kaynağı (issue #13): repo kökü astro.config.mjs işaretçisiyle bulunur —
// file-token-store/file-agent-registry/build-workspace/build-runner/sqlite/db-file'da
// tekrarlanan walk temizlenir. Bulunamazsa fail-fast (sessiz yanlış dizin yok).
export function resolveRepoRoot(): string {
  let dir = __dirname;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'astro.config.mjs'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Repo kökü bulunamadı: astro.config.mjs işaretçisi yukarı yürüyüşte yok — fail-fast');
    }
    dir = parent;
  }
}
