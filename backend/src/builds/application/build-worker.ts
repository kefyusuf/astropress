import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BuildJob } from '../domain/build-job';
import { BUILD_JOB_REPOSITORY, BUILD_RUNNER, BuildJobRepository, BuildRunner, BuildDispatcher } from './ports';

export const BUILD_RETENTION = Symbol('BUILD_RETENTION');

@Injectable()
export class BuildWorker implements OnModuleInit, BuildDispatcher {
  private readonly logger = new Logger(BuildWorker.name);
  private drainPromise: Promise<void> | null = null;

  constructor(
    @Inject(BUILD_JOB_REPOSITORY) private readonly repo: BuildJobRepository,
    @Inject(BUILD_RUNNER) private readonly runner: BuildRunner,
    @Inject(BUILD_RETENTION) private readonly retention: number,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.recover();
      this.kick(); // I2: queued job'ları restart'ta resume et (background drain). Interrupted running retry EDİLMEZ.
    } catch (err) {
      // Boot recovery best-effort: never brick the app (sites API dahil tüm backend boot eder).
      this.logger.warn(`boot recovery başarısız, devam ediliyor: ${err instanceof Error ? err.message : String(err)}`);
    }
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

  // Serial loop: queued job'ları FIFO tek tek işler (concurrency 1 → dist/ yarışı yok).
  private async runDrain(): Promise<void> {
    for (;;) {
      const all = await this.repo.findAll();
      const next = all
        .filter((j) => j.status === 'queued')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!next) return;
      const running = next.markRunning(new Date().toISOString());
      await this.repo.save(running);
      const result = await this.runner.run();
      const done = new Date().toISOString();
      const finished = result.ok
        ? running.markSucceeded(result, done)
        : running.markFailed(result.error ?? 'build failed', done, result.exitCode, result.logTail);
      await this.repo.save(finished);
      await this.repo.pruneTerminal(this.retention); // D2: terminal history keep-last-N (queued/running korunur)
    }
  }
}