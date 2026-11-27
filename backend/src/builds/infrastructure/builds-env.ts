// Builds env doğrulama yardımcıları (issue #12): import-time yerine runtime'da ve
// pozitif tam sayı zorlaması — ASTROPRESS_BUILD_CONCURRENCY=-1 gibi değerler
// sessiz bozuk davranış yerine fail-fast.
export function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} pozitif tam sayı olmalı: "${raw}"`);
  }
  return n;
}
