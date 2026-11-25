import { BuildJob, BuildResult } from '../domain/build-job';
import { BuildEvent } from '../domain/build-event';

export const BUILD_JOB_REPOSITORY = Symbol('BUILD_JOB_REPOSITORY');
export const BUILD_RUNNER = Symbol('BUILD_RUNNER');

export interface BuildRunner {
  run(jobId: string): Promise<BuildResult>;
}

// Single-flight varsayımı (M3): file mode BuildWorker.drain'in race-freedom'ı file adapter'ın SENKRON
// read/write body'lerine bağlıdır (run-to-completion → lost-wakeup yok). E'de async engine (BullMQ)
// BuildDispatcher port + BullMQ Worker'ın kendi concurrency control'ü ile ayrı ele alınır; file mode
// drain sync-varsayımı korunur. Adapter swap'ında file drain değişmez, bullmq processor parity-guard'lı.
export interface BuildJobRepository {
  save(job: BuildJob): Promise<void>;
  findById(id: string): Promise<BuildJob | null>;
  findAll(): Promise<BuildJob[]>;
  pruneTerminal(keep: number): Promise<void>;
}

export const BUILD_DISPATCHER = Symbol('BUILD_DISPATCHER');

// Engine seam (E): orchestration dispatch'i soyutlar. file adapter BuildWorker.kick (sync drain),
// bullmq adapter queue.add (durable). EnqueueBuild concrete worker yerine bu port'a bağlanır.
export interface BuildDispatcher {
  dispatch(job: BuildJob): Promise<void>;
}

export const EVENT_STORE = Symbol('EVENT_STORE');

// Optimistic concurrency: actual stream version !== expectedVersion → ConcurrencyError.
// expectedVersion = stream'deki mevcut event sayısı (yeni stream = 0). Batch atomik.
export interface EventStore {
  append(streamId: string, events: BuildEvent[], expectedVersion: number): Promise<void>;
  readStream(streamId: string): Promise<BuildEvent[]>;
  readAll(): Promise<BuildEvent[]>;
}

// Eşzamanlı build sayısı (file N-pool + BullMQ concurrency). default 1 → serial parity.
export const BUILD_CONCURRENCY = Symbol('BUILD_CONCURRENCY');