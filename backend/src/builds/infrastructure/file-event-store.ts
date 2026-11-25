import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { BuildEvent } from '../domain/build-event';
import { ConcurrencyError } from '../domain/errors';
import { EventStore } from '../application/ports';

export const EVENTS_DIR = Symbol('EVENTS_DIR');

export function defaultEventsDir(): string {
  if (process.env.ASTROPRESS_STATE) return path.join(process.env.ASTROPRESS_STATE, 'build-events');
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'astro.config.mjs'))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(dir, '.astropress', 'build-events');
}

@Injectable()
export class FileEventStore implements EventStore {
  private readonly logger = new Logger(FileEventStore.name);
  constructor(@Inject(EVENTS_DIR) private readonly dir: string) {}

  private file(streamId: string): string {
    return path.join(this.dir, encodeURIComponent(streamId) + '.jsonl');
  }

  private readLines(file: string): BuildEvent[] {
    if (!fs.existsSync(file)) return [];
    // Transient IO (EBUSY/EPERM) propagate eder — quarantine ETME.
    const raw = fs.readFileSync(file, 'utf8');
    const events: BuildEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line) as BuildEvent); }
      catch (err) {
        this.logger.warn(`event log bozuk, quarantine: ${err instanceof Error ? err.message : String(err)}`);
        this.quarantine(file);
        return [];
      }
    }
    return events;
  }

  private quarantine(file: string): void {
    try { fs.renameSync(file, `${file}.corrupt`); }
    catch (err) { this.logger.warn(`quarantine rename başarısız: ${err instanceof Error ? err.message : String(err)}`); }
  }

  async append(streamId: string, events: BuildEvent[], expectedVersion: number): Promise<void> {
    const file = this.file(streamId);
    const current = this.readLines(file).length;
    if (current !== expectedVersion) throw new ConcurrencyError(streamId, expectedVersion, current);
    if (events.length === 0) return;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }

  async readStream(streamId: string): Promise<BuildEvent[]> {
    return this.readLines(this.file(streamId));
  }

  async readAll(): Promise<BuildEvent[]> {
    if (!fs.existsSync(this.dir)) return [];
    const out: BuildEvent[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith('.jsonl')) continue;
      out.push(...this.readLines(path.join(this.dir, name)));
    }
    return out;
  }
}