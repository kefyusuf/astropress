import { Pool } from 'pg';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { TokenStore } from '../application/token-store';

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS agent_tokens (
  agent_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE
)`;

// Postgres token store (Faz-4): runtime authoritative (seed YOK). agent_id PK = rotate=replace parity;
// hash index lookup (high-entropy sha256 — timing-safe karşılaştırma gerekmez, file adapter'da korunur).
@Injectable()
export class PostgresTokenStore implements TokenStore, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(url: string) {
    if (!url) throw new Error('DATABASE_URL tanımlı değil (ASTROPRESS_STORAGE=postgres)');
    this.pool = new Pool({ connectionString: url });
  }

  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE);
  }

  async findAgentByHash(hash: string): Promise<string | null> {
    const result = await this.pool.query('SELECT agent_id FROM agent_tokens WHERE token_hash = $1', [hash]);
    return result.rows.length ? (result.rows[0] as { agent_id: string }).agent_id : null;
  }

  async setHash(agentId: string, hash: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_tokens (agent_id, token_hash) VALUES ($1, $2)
       ON CONFLICT (agent_id) DO UPDATE SET token_hash = EXCLUDED.token_hash`,
      [agentId, hash],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  onModuleDestroy(): void {
    void this.close();
  }
}