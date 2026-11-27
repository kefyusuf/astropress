import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './store.mjs';

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'agents.json'), 'utf8'));

export const AGENT_ID = process.env.ASTROPRESS_AGENT || 'content-studio';

export function getAgent(id = AGENT_ID) {
  const a = registry[id];
  if (!a) throw new Error('Bilinmeyen agent: ' + id);
  return { id, name: a.name, perms: a.perms };
}

export function listAgents() {
  return Object.entries(registry).map(([id, a]) => ({ id, name: a.name, perms: a.perms }));
}

// İnsan tüm yetkilere sahiptir; publish yetkisini approve_task üzerinden kullanır.
export const HUMAN = { id: 'human', name: 'İnsan', perms: { create: true, edit: true, delete: true, commerce: true, publish: true, build: true } };
