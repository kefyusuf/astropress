import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// node --test glob expansion yalnız Node 21+; Node 20 quoted glob'u literal path sayar
// ("Could not find"). dizin argümanı ve default discovery de uygun değil (kaynak .ts'leri
// çalıştırır). Bu yüzden dist/test altındaki .spec.js'leri fs ile bulup explicit veriyoruz.
function collect(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(p));
    else if (e.name.endsWith('.spec.js')) out.push(p);
  }
  return out;
}

const files = collect(join('dist', 'test')).sort();
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);