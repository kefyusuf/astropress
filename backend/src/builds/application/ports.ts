import { BuildJob, BuildResult } from '../domain/build-job';

export const BUILD_JOB_REPOSITORY = Symbol('BUILD_JOB_REPOSITORY');
export const BUILD_RUNNER = Symbol('BUILD_RUNNER');

export interface BuildRunner {
  run(): Promise<BuildResult>;
}

// Single-flight varsayımı (M3): BuildWorker.drain'in race-freedom'ı file adapter'ın SENKRON read/write
// body'lerine bağlıdır — save/findAll run-to-completion çalışır, dolayısıyla final findAll ile drain exit
// kararı arasına başka bir save giremez (lost-wakeup yok). Faz-2 async adapter (BullMQ/DB) bu varsayımı
// geçersiz kılar: drain-clear sonrası pendingKick re-check veya post-exit re-read gerekir. Adapter swap'ında
// BuildWorker.drain/runDrain gözden geçirilmeli.
export interface BuildJobRepository {
  save(job: BuildJob): Promise<void>;
  findById(id: string): Promise<BuildJob | null>;
  findAll(): Promise<BuildJob[]>;
  pruneTerminal(keep: number): Promise<void>;
}