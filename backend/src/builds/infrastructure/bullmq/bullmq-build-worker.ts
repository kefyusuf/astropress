import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { BuildJob } from '../../domain/build-job';
import { BUILD_JOB_REPOSITORY, BUILD_RUNNER, BUILD_CONCURRENCY, BuildJobRepository, BuildRunner } from '../../application/ports';
import { BUILD_RETENTION } from '../../application/build-worker';
import { BUILD_QUEUE_NAME, BUILD_QUEUE } from './build-queue';
import { REDIS_URL, createRedisConnection } from '../../../infrastructure/redis-connection';
import { ReadinessState } from '../../../health/readiness-state';
import { positiveIntEnv } from '../builds-env';

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
    @Inject(BUILD_CONCURRENCY) private readonly concurrency: number,
    @Optional() private readonly readiness?: ReadinessState,
  ) {}

  async onModuleInit(): Promise<void> {
    // H2: tek ok flag — init-fail + recover-ok kombinasyonu ready RAPORLAMAZ (overwrite yok).
    let ok = true;
    // Boot-safe: Redis yoksa Worker error event log'lanır, app brick OLMAZ (sites API boot eder).
    try {
      this.connection = createRedisConnection(this.url);
      this.worker = new Worker(BUILD_QUEUE_NAME, (job) => this.process(job), {
        connection: this.connection,
        concurrency: this.concurrency, // N (Redis job-lock native claim; N=1 serial parity)
        // lockDuration ≥ build süresi (issue #12): default 30s, 180s build'te lock düşer ve
        // aynı build çakışırdı. ASTROPRESS_BUILD_LOCK_DURATION ile yapılandırılır (default 240s).
        lockDuration: positiveIntEnv('ASTROPRESS_BUILD_LOCK_DURATION', 240000),
        maxStalledCount: 1,
        stalledInterval: 30000,
      });
      this.worker.on('error', (err) => this.logger.warn(`bullmq worker error: ${err.message}`));
      // failed/stalled görünürlüğü (issue #12): sessiz kayıp yok — structured warn.
      this.worker.on('failed', (job, err) => this.logger.warn(`bullmq job failed: ${job?.id ?? '?'} ${err.message}`));
      this.worker.on('stalled', (jobId) => this.logger.warn(`bullmq job stalled: ${String(jobId)}`));
      // H2 boot promise: 'ready' bounded await → listen worker bağlıyken döner (Redis-up deterministik).
      await this.waitWorkerReady();
    } catch (err) {
      ok = false;
      this.logger.warn(`bullmq worker init başarısız, devam ediliyor: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Boot recover (issue #12 — multi-replica fix): RUNNING job'lara DOKUNULMAZ. Eski davranış
    // yeni kalkan replikanın diğer instance'lardaki aktif build'lerini interrupted yapıyordu;
    // artık BullMQ stalled mekanizması + job-lock sahipliği kurtarır. Yalnız REPLICASIZ
    // dispatch-lost temizliği (queued ve Redis'te karşılığı yok → mirror düzeltilir) kalır.
    try {
      const all = await this.repo.findAll();
      for (const job of all) {
        if (job.status === 'queued') {
          const bullJob = await this.boundedGetJob(job.id);
          if (!bullJob) await this.repo.save(job.markDispatchLost(new Date().toISOString()));
        }
      }
    } catch (err) {
      ok = false;
      this.logger.warn(`bullmq boot recover başarısız, devam ediliyor: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.readiness?.set('buildEngine', ok);
  }

  // H2: bounded 'ready' await (waitReady/boundedGetJob emsali). Timeout/down → reject → init catch →
  // degraded; boot brick OLMAZ. unref: timer process exit'ini tutmaz; off: timeout'ta listener temizliği.
  private waitWorkerReady(timeoutMs = 2000): Promise<void> {
    if (this.connection?.status === 'ready') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onReady = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        this.worker?.off('ready', onReady);
        reject(new Error('bullmq worker ready timeout — Redis unreachable'));
      }, timeoutMs);
      timer.unref();
      this.worker?.once('ready', onReady);
    });
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
    // Bounded shutdown (issue #12): worker.close() 10sn'yi aşarsa zorla devam — SIGTERM
    // temiz kapanmalı; aktif build controller'lı sonlanır (runner timeout'u var).
    if (this.worker) {
      await Promise.race([
        this.worker.close().catch(() => {}),
        new Promise((r) => setTimeout(r, 10000).unref()),
      ]);
    }
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
