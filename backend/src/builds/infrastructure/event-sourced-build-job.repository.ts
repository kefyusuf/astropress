import fs from 'node:fs';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BuildJob } from '../domain/build-job';
import { BuildEvent, foldBuildJob } from '../domain/build-event';
import { BuildJobRepository, EventStore, EVENT_STORE } from '../application/ports';
import { BUILDS_FILE, FileBuildJobRepository } from './file-build-job.repository';

// save'de status farkından event türet (eski→yeni). Aynı status → no-op.
function deriveEvents(current: BuildJob | null, job: BuildJob, expectedVersion: number): BuildEvent[] {
  const oldStatus = current?.status ?? null;
  if (oldStatus === job.status) return [];
  const base = { streamId: job.id, version: expectedVersion + 1, ts: new Date().toISOString() };
  switch (job.status) {
    case 'queued':
      return [{ ...base, type: 'BuildQueued', payload: { createdAt: job.createdAt } }];
    case 'running':
      return [{ ...base, type: 'BuildStarted', payload: { startedAt: job.startedAt! } }];
    case 'succeeded':
      return [{ ...base, type: 'BuildSucceeded', payload: { finishedAt: job.finishedAt!, exitCode: job.exitCode!, logTail: job.logTail ?? '' } }];
    case 'failed':
      if (oldStatus === 'queued') return [{ ...base, type: 'DispatchLost', payload: { finishedAt: job.finishedAt! } }];
      return [{ ...base, type: 'BuildFailed', payload: { finishedAt: job.finishedAt!, error: job.error ?? 'build failed', exitCode: job.exitCode, logTail: job.logTail } }];
  }
}

@Injectable()
export class EventSourcedBuildJobRepository implements BuildJobRepository, OnModuleInit {
  private readonly logger = new Logger(EventSourcedBuildJobRepository.name);
  private readonly mirror: FileBuildJobRepository;

  constructor(
    @Inject(EVENT_STORE) private readonly store: EventStore,
    @Inject(BUILDS_FILE) private readonly mirrorFile: string,
  ) {
    this.mirror = new FileBuildJobRepository(mirrorFile);
  }

  // Full recovery: event'lerden mirror'ı sıfırdan rebuild (mirror silinse/bozulsa bile).
  async onModuleInit(): Promise<void> {
    try {
      const events = await this.store.readAll();
      const byStream = new Map<string, BuildEvent[]>();
      for (const e of events) {
        const arr = byStream.get(e.streamId) ?? [];
        arr.push(e);
        byStream.set(e.streamId, arr);
      }
      fs.rmSync(this.mirrorFile, { force: true });
      for (const evs of byStream.values()) {
        const job = foldBuildJob(evs.sort((a, b) => a.version - b.version));
        if (job) await this.mirror.save(job);
      }
    } catch (err) {
      this.logger.warn(`event store mirror rebuild başarısız, devam ediliyor: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async save(job: BuildJob): Promise<void> {
    const events = await this.store.readStream(job.id);
    const current = foldBuildJob(events);
    const expectedVersion = events.length;
    const newEvents = deriveEvents(current, job, expectedVersion);
    if (newEvents.length > 0) await this.store.append(job.id, newEvents, expectedVersion);
    await this.mirror.save(job);
  }

  async findById(id: string): Promise<BuildJob | null> { return this.mirror.findById(id); }
  async findAll(): Promise<BuildJob[]> { return this.mirror.findAll(); }
  async pruneTerminal(keep: number): Promise<void> { return this.mirror.pruneTerminal(keep); }
}