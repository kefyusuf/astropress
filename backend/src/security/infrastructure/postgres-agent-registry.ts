import fs from 'node:fs';
import { Pool } from 'pg';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Agent, Perms } from '../domain/agent';
import { UnknownAgentError } from '../domain/errors';
import { AgentRegistry } from '../application/agent-registry';

interface AgentRow { id: string; name: string; perms: string }

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  perms TEXT NOT NULL
)`;

// Postgres registry (Faz-4): agents.json config-as-code boot-seed (idempotent upsert, drift boot'ta düzelir);
// okumalar per-request query → multi-instance freshness (cache yok). PostgresSiteRepository emsali.
@Injectable()
export class PostgresAgentRegistry implements AgentRegistry, OnModuleDestroy {
  private readonly pool: Pool;
  private readonly seed: Record<string, { name: string; perms: Perms }>;

  constructor(url: string, agentsFile: string) {
    if (!url) throw new Error('DATABASE_URL tanımlı değil (ASTROPRESS_STORAGE=postgres)');
    this.pool = new Pool({ connectionString: url });
    this.seed = JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
  }

  async init(): Promise<void> {
    await this.pool.query(CREATE_TABLE);
    for (const [id, a] of Object.entries(this.seed)) {
      await this.pool.query(
        `INSERT INTO agents (id, name, perms) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, perms = EXCLUDED.perms`,
        [id, a.name, JSON.stringify(a.perms)],
      );
    }
  }

  async getAgent(id: string): Promise<Agent> {
    const result = await this.pool.query('SELECT id, name, perms FROM agents WHERE id = $1', [id]);
    if (!result.rows.length) throw new UnknownAgentError(id);
    return this.toAgent(result.rows[0] as AgentRow);
  }

  async listAgents(): Promise<Agent[]> {
    const result = await this.pool.query('SELECT id, name, perms FROM agents');
    return result.rows.map((r: AgentRow) => this.toAgent(r));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  onModuleDestroy(): void {
    void this.close();
  }

  private toAgent(row: AgentRow): Agent {
    return { id: row.id, name: row.name, perms: JSON.parse(row.perms) as Perms };
  }
}