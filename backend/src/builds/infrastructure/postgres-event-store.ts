import { Pool } from 'pg';
import { BuildEvent } from '../domain/build-event';
import { ConcurrencyError } from '../domain/errors';
import { EventStore } from '../application/ports';

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS build_events (
  stream_id TEXT NOT NULL,
  version INT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (stream_id, version)
)`;

export class PostgresEventStore implements EventStore {
  private readonly pool: Pool;
  constructor(url: string) {
    if (!url) throw new Error('DATABASE_URL tanımlı değil (ASTROPRESS_STORAGE=postgres)');
    this.pool = new Pool({ connectionString: url });
  }

  async init(): Promise<void> { await this.pool.query(CREATE_TABLE); }
  async close(): Promise<void> { await this.pool.end(); }

  async append(streamId: string, events: BuildEvent[], expectedVersion: number): Promise<void> {
    if (events.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT COALESCE(MAX(version), 0) AS v FROM build_events WHERE stream_id = $1', [streamId]);
      const current = Number(res.rows[0].v);
      if (current !== expectedVersion) throw new ConcurrencyError(streamId, expectedVersion, current);
      for (const e of events) {
        await client.query(
          'INSERT INTO build_events (stream_id, version, type, payload, ts) VALUES ($1, $2, $3, $4, $5)',
          [streamId, e.version, e.type, JSON.stringify(e.payload), e.ts],
        );
      }
      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (err?.code === '23505') throw new ConcurrencyError(streamId, expectedVersion);
      throw err;
    } finally {
      client.release();
    }
  }

  async readStream(streamId: string): Promise<BuildEvent[]> {
    const res = await this.pool.query(
      'SELECT stream_id, version, type, payload, ts FROM build_events WHERE stream_id = $1 ORDER BY version', [streamId],
    );
    return res.rows.map((r: any) => this.toEvent(r));
  }

  async readAll(): Promise<BuildEvent[]> {
    const res = await this.pool.query('SELECT stream_id, version, type, payload, ts FROM build_events ORDER BY stream_id, version');
    return res.rows.map((r: any) => this.toEvent(r));
  }

  private toEvent(row: any): BuildEvent {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return { streamId: row.stream_id, version: Number(row.version), ts: new Date(row.ts).toISOString(), type: row.type, payload } as BuildEvent;
  }
}