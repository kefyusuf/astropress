import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { BuildJob } from '../domain/build-job';
import { BUILD_JOB_REPOSITORY, BUILD_RUNNER, BUILD_CONCURRENCY, BuildJobRepository, BuildRunner, BuildDispatcher } from './ports';
import { ReadinessState } from '../../health/readiness-state';

export const BUILD_RETENTION = Symbol('BUILD_RETENTION');

@Injectable()
export class BuildWorker implements OnModuleInit, OnModuleDestroy, BuildDispatcher {
  private readonly logger = new Logger(BuildWorker.name);
  private drainPromise: Promise<void> | null = null;
  private readonly claimed = new Set<string>();
  private stopping = false;

  constructor(
    @Inject(BUILD_JOB_REPOSITORY) private readonly repo: BuildJobRepository,
    @Inject(BUILD_RUNNER) private readonly runner: BuildRunner,
    @Inject(BUILD_RETENTION) private readonly retention: number,
    @Inject(BUILD_CONCURRENCY) private readonly concurrency: number = 1,
    @Optional() private readonly readiness?: ReadinessState,
  ) {}

  async onModuleInit(): Promise<void> {
    let ok = true;
    try {
      await this.recover();
      this.kick(); // I2: queued job'ları restart'ta resume et (background drain). Interrupted running retry EDİLMEZ.
    } catch (err) {
      ok = false;
      // Boot recovery best-effort: never brick the app (sites API dahil tüm backend boot eder).
      this.logger.warn(`boot recovery başarısız, devam ediliyor: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.readiness?.set('buildEngine', ok);
  }

  // Boot recovery: önceki crash'ten kalan running job'lar failed (interrupted). Empty/no-running ise write YOK.
  // queued job'lar onModuleInit'teki kick ile resume edilir (I2); interrupted running job'lar retry EDİLMEZ.
  async recover(): Promise<void> {
    const all = await this.repo.findAll();
    for (const job of all) {
      if (job.status === 'running') {
        await this.repo.save(job.markFailed('interrupted', new Date().toISOString()));
      }
    }
  }

  kick(): void {
    // Fire-and-forget ama rejection handle edilir (Node≥20 unhandled-rejection → process crash önlenir).
    this.drain().catch((err) => {
      this.logger.warn(`drain başarısız: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  // BuildDispatcher seam (E): file mode dispatch = kick (background drain). job zaten repo'da queued.
  async dispatch(_job: BuildJob): Promise<void> {
    this.kick();
  }

  // Single-flight: aktif drain varsa aynı promise döner (çift işleme yok).
  drain(): Promise<void> {
    if (!this.drainPromise) {
      this.drainPromise = this.runDrain().finally(() => { this.drainPromise = null; });
    }
    return this.drainPromise;
  }

  // N-worker pool: her worker FIFO queued claim eder (claimed Set çift-claim guard). N=1 → serial parity.
  private async runDrain(): Promise<void> {
    const workers: Promise<void>[] = [];
    for (let i = 0; i < this.concurrency; i++) workers.push(this.workerLoop());
    await Promise.all(workers);
  }

  private async workerLoop(): Promise<void> {
    for (;;) {
      const running = await this.claimNext();
      if (!running) return;
      try {
        const result = await this.runner.run(running.id);
        const done = new Date().toISOString();
        const finished = result.ok
          ? running.markSucceeded(result, done)
          : running.markFailed(result.error ?? 'build failed', done, result.exitCode, result.logTail);
        await this.repo.save(finished);
        await this.repo.pruneTerminal(this.retention); // D2: terminal history keep-last-N (queued/running korunur)
      } finally {
        this.claimed.delete(running.id);
      }
    }
  }

  // Atomik claim: findAll await sonrası SYNC filter+add (arada await yok) → iki loop aynı job'ı seçemez.
  private async claimNext(): Promise<BuildJob | null> {
    if (this.stopping) return null; // shutdown: yeni claim yok (issue #12)
    const all = await this.repo.findAll();
    const next = all
      .filter((j) => j.status === 'queued' && !this.claimed.has(j.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!next) return null;
    this.claimed.add(next.id);
    try {
      const running = next.markRunning(new Date().toISOString());
      await this.repo.save(running);
      return running;
    } catch (err) {
      // save başarısız → claimed Set sızıntısı + workerLoop ölümü yerine temiz bırak (issue #12).
      this.claimed.delete(next.id);
      throw err;
    }
  }

  // Graceful shutdown (issue #12): yeni claim durdur; aktif build bounded beklenir.
  // 10sn'yi aşan build'ler runner timeout'undan önce kontrollü biter; aşım zorla bırak.
  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.drainPromise) {
      await Promise.race([
        this.drainPromise.catch(() => {}),
        new Promise((r) => setTimeout(r, 10000).unref()),
      ]);
    }
  }
}