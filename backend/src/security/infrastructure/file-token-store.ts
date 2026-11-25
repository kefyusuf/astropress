import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { TokenStore } from '../application/token-store';

export const TOKEN_STORE_FILE = Symbol('TOKEN_STORE_FILE');

// Runtime secret state: .astropress/agent-tokens.json (gitignore'lu; committed config DEĞİL).
// ASTROPRESS_STATE test izolasyonu (builds.json emsali). Yalnız sha256 hash saklanır, plaintext yok.
export function defaultTokenStoreFile(): string {
  if (process.env.ASTROPRESS_STATE) return path.join(process.env.ASTROPRESS_STATE, 'agent-tokens.json');
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'astro.config.mjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(dir, '.astropress', 'agent-tokens.json');
}

@Injectable()
export class FileTokenStore implements TokenStore {
  constructor(@Inject(TOKEN_STORE_FILE) private readonly file: string) {}

  private read(): Record<string, string> {
    if (!fs.existsSync(this.file)) return {};
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  async findAgentByHash(hash: string): Promise<string | null> {
    const registry = this.read();
    const presented = Buffer.from(hash, 'hex');
    for (const [agentId, stored] of Object.entries(registry)) {
      const storedBuf = Buffer.from(stored, 'hex');
      // sha256 hex her zaman 64 char → eşit uzunluk; drift'te length guard (timingSafeEqual throw etmesin).
      if (presented.length === storedBuf.length && timingSafeEqual(presented, storedBuf)) return agentId;
    }
    return null;
  }

  async setHash(agentId: string, hash: string): Promise<void> {
    const registry = this.read();
    registry[agentId] = hash;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}