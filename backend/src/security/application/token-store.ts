import { createHash } from 'node:crypto';

export const TOKEN_STORE = Symbol('TOKEN_STORE');

// API key hash: high-entropy random token → sha256 hex (GitHub/Sanctum normu; parola değil, slow hash YAGNI).
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface TokenStore {
  findAgentByHash(hash: string): Promise<string | null>;
  setHash(agentId: string, hash: string): Promise<void>;
}