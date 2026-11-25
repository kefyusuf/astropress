import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { BuildJob } from '../../domain/build-job';
import { BUILD_JOB_REPOSITORY, BUILD_RUNNER, BuildJobRepository, BuildRunner } from '../../application/ports';
import { BUILD_RETENTION } from '../../application/build-worker';
import { BUILD_QUEUE_NAME, BUILD_QUEUE } from './build-queue';
import { REDIS_URL, createRedisConnection } from '../../../infrastructure/redis-connection';

@Injectable()
export class BullMqBuildWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMqBuildWorker.name);
  private worker: Worker | null = null;
  private connection: IORedis | null = null;

  constructor(
    @Inject(BUILD_JOB_REPOSITORY) private readonly repo: BuildJobRepository,
    @Inject(BUILD_RUNNER) private readonly runner: BuildRunner,
    @Inject(BUILD_RETENTION) private readonly retention: number,
    @Inject(REDIS_URL) private readonly url: string,
    @Inject(BUILD_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Boot-safe: Redis yoksa Worker error event log'lanır, app brick OLMAZ (sites API boot eder).
    try {
      this.connection = createRedisConnection(this.url);
      this.worker = new Worker(BUILD_QUEUE_NAME, (job) => this.process(job), {
        connection: this.connection,
        concurrency: 1, // serial → dist/ yarışı yok (file mode parity)
        maxStalledCount: 1,
        stalledInterval: 30000,
      });
      this.worker.on('error', (err) => this.logger.warn(`bullmq worker error: ${err.message}`));
    } catch (err) {
      this.logger.warn(`bullmq worker init başarısız, devam ediliyor: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Boot recover parity (spec §7): stale running mirror → failed interrupted (BuildWorker.recover emsali).
    // Best-effort: repo hatası boot'u brick ETMEZ (Redis-down dahil). Processor running-guard ile idempotent:
    // recover failed yazarsa processor terminal skip eder; interrupted running asla re-run edilmez.
    try {
      const all = await this.repo.findAll();
      for (const job of all) {
        if (job.status === 'running') {
          await this.repo.save(job.markFailed('interrupted', new Date().toISOString()));
        } else if (job.status === 'queued') {
          const bullJob = await this.boundedGetJob(job.id);
          if (!bullJob) await this.repo.save(job.markDispatchLost(new Date().toISOString()));
        }
      }
    } catch (err) {
      this.logger.warn(`bullmq boot recover başarısız, devam ediliyor: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Boot-safe: getJob unreachable Redis'te hang eder (throw etmez). 2s timeout race → reject →
  // onModuleInit catch → skip. katılımcı promise'ler handle'lı (unhandled-rejection crash yok).
  private boundedGetJob(id: string): Promise<Job | undefined> {
    const getJob = this.queue.getJob(id);
    getJob.catch(() => {});
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('getJob timeout — Redis unreachable')), 2000);
      timer.unref();
    });
    return Promise.race([getJob, timeout]).finally(() => clearTimeout(timer));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close().catch(() => {});
    // Worker'ın main connection'ı shared (caller-owned) → worker.close() disconnect etmez; biz ederiz.
    // (blockingConnection duplicate'i shared:false olduğundan worker.close() onu zaten kapatır.)
    this.connection?.disconnect();
  }

  // Parity guard: interrupted running re-run EDİLMEZ; terminal idempotent skip.
  private async process(bullJob: Job<{ jobId: string }>): Promise<void> {
    const build = await this.repo.findById(bullJob.data.jobId);
    if (!build) { this.logger.warn(`repo mirror yok: ${bullJob.data.jobId}`); return; }
    if (build.status === 'succeeded' || build.status === 'failed') return; // idempotent
    if (build.status === 'running') {
      // stale crash → interrupted failed (file recover parity), re-run YOK
      await this.repo.save(build.markFailed('interrupted', new Date().toISOString()));
      await this.repo.pruneTerminal(this.retention);
      return;
    }
    // queued → run
    const running = build.markRunning(new Date().toISOString());
    await this.repo.save(running);
    const result = await this.runner.run(build.id);
    const done = new Date().toISOString();
    const finished = result.ok
      ? running.markSucceeded(result, done)
      : running.markFailed(result.error ?? 'build failed', done, result.exitCode, result.logTail);
    await this.repo.save(finished);
    await this.repo.pruneTerminal(this.retention);
  }
}
