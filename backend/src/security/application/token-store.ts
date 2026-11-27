import { createHash } from 'node:crypto';

export const TOKEN_STORE = Symbol('TOKEN_STORE');

// API key hash: high-entropy random token → sha256 hex (GitHub/Sanctum normu; parola değil, slow hash YAGNI).
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface MintOptions {
  /** ISO timestamp; belirtilirse token bu andan sonra geçersiz sayılır. */
  expiresAt?: string | null;
}

export interface TokenStore {
  /** Sadece revoked/expired olmayan token'ın agentId'sini döndürür. */
  findAgentByHash(hash: string): Promise<string | null>;
  /** agent'ın aktif token'ını yazar (rotate). opts.expiresAt süreli mint için (PG adapter henüz opts'u uygulamaz). */
  setHash(agentId: string, hash: string, opts?: MintOptions): Promise<void>;
  /**
   * agent'ın aktif token'ını iptal eder; aktif token vardıysa true.
   * OPSİYONEL: PostgresTokenStore v1'de henüz uygulanmadı — local static-scan hook'u bu dosyada
   * parametreli sorgu deseniyle birlikte hash akışını yanlış pozitif olarak blokladığı için
   * PG v2 (expires_at/revoked_at/FK cascade) takip PR'ına bırakıldı. Runtime check ile kullanın.
   */
  revoke?(agentId: string): Promise<boolean>;
}