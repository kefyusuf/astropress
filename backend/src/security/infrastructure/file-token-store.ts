import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { MintOptions, TokenStore } from '../application/token-store';

export const TOKEN_STORE_FILE = Symbol('TOKEN_STORE_FILE');

// Runtime secret state: .astropress/agent-tokens.json (gitignore'lu; committed config DEĞİL).
// ASTROPRESS_STATE test izolasyonu (builds.json emsali). Yalnız sha256 hash saklanır, plaintext yok.
// Format v2: { version: 2, tokens: { agentId: { hash, expiresAt?, revokedAt? } } } — issue #10.
// Eski Record<agentId, hash> dosyaları okuma sırasında v2'ye yükseltilir (geriye uyum).
interface StoredToken {
  hash: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
}
interface TokenFileV2 {
  version: 2;
  tokens: Record<string, StoredToken>;
}

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

function normalize(raw: unknown): TokenFileV2 {
  if (raw && typeof raw === 'object' && (raw as TokenFileV2).version === 2) return raw as TokenFileV2;
  const legacy = (raw ?? {}) as Record<string, string>;
  const tokens: Record<string, StoredToken> = {};
  for (const [agentId, hash] of Object.entries(legacy)) {
    if (typeof hash === 'string') tokens[agentId] = { hash };
  }
  return { version: 2 as const, tokens };
}

function isExpired(t: StoredToken, now = Date.now()): boolean {
  return t.expiresAt !== undefined && t.expiresAt !== null && Date.parse(t.expiresAt) <= now;
}

function isRevoked(t: StoredToken): boolean {
  return t.revokedAt !== undefined && t.revokedAt !== null;
}

@Injectable()
export class FileTokenStore implements TokenStore {
  constructor(@Inject(TOKEN_STORE_FILE) private readonly file: string) {}

  private read(): TokenFileV2 {
    if (!fs.existsSync(this.file)) return { version: 2, tokens: {} };
    return normalize(JSON.parse(fs.readFileSync(this.file, 'utf8')));
  }

  async findAgentByHash(hash: string): Promise<string | null> {
    const { tokens } = this.read();
    const presented = Buffer.from(hash, 'hex');
    for (const [agentId, t] of Object.entries(tokens)) {
      if (isRevoked(t) || isExpired(t)) continue;
      const storedBuf = Buffer.from(t.hash, 'hex');
      // sha256 hex her zaman 64 char → eşit uzunluk; drift'te length guard (timingSafeEqual throw etmesin).
      if (presented.length === storedBuf.length && timingSafeEqual(presented, storedBuf)) return agentId;
    }
    return null;
  }

  async setHash(agentId: string, hash: string, opts?: MintOptions): Promise<void> {
    const doc = this.read();
    doc.tokens[agentId] = { hash, expiresAt: opts?.expiresAt ?? null, revokedAt: null };
    this.write(doc);
  }

  async revoke(agentId: string): Promise<boolean> {
    const doc = this.read();
    const t = doc.tokens[agentId];
    if (!t || isRevoked(t)) return false;
    t.revokedAt = new Date().toISOString();
    this.write(doc);
    return true;
  }

  private write(doc: TokenFileV2): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    // 0o600: secret state dosyası kullanıcı-özel (issue #10); Windows'ta mode yok sayılır (best-effort).
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}