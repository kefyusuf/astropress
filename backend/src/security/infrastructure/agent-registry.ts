import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { Agent, Perms } from '../domain/agent';
import { UnknownAgentError } from '../domain/errors';

export const AGENTS_FILE = Symbol('AGENTS_FILE');

// Tek doğruluk kaynağı repo kökünde COMMITTED agents.json (config katmanı, sites.json emsali).
// Repo kökü, modül konumundan astro.config.mjs işaretçisine yürüyerek bulunur (cwd/dist derinliğinden bağımsız).
// Testler ASTROPRESS_AGENTS_FILE ile temp'e yönlendirir.
export function defaultAgentsFile(): string {
  if (process.env.ASTROPRESS_AGENTS_FILE) return process.env.ASTROPRESS_AGENTS_FILE;
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'astro.config.mjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(dir, 'agents.json');
}

@Injectable()
export class AgentRegistry {
  private readonly registry: Record<string, { name: string; perms: Perms }>;

  constructor(@Inject(AGENTS_FILE) file: string) {
    this.registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  getAgent(id: string): Agent {
    const a = this.registry[id];
    if (!a) throw new UnknownAgentError(id);
    return { id, name: a.name, perms: a.perms };
  }

  listAgents(): Agent[] {
    return Object.entries(this.registry).map(([id, a]) => ({ id, name: a.name, perms: a.perms }));
  }
}