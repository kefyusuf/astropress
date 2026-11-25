import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { BuildJob } from '../../domain/build-job';
import { BuildDispatcher } from '../../application/ports';
import { BUILD_QUEUE, closeBuildQueue } from './build-queue';

@Injectable()
export class BullMqDispatcher implements BuildDispatcher, OnModuleDestroy {
  private readonly logger = new Logger(BullMqDispatcher.name);

  constructor(@Inject(BUILD_QUEUE) private readonly queue: Queue) {}

  // Durable trigger: jobId option BullMQ dedup sağlar (aynı build id iki kez işlenmez).
  async dispatch(job: BuildJob): Promise<void> {
    try {
      await this.queue.add('build', { jobId: job.id }, { jobId: job.id });
    } catch (err) {
      // spec §11 "handle (log)": rejection log'lanır + RETHROW → POST 500 fail-closed (R11 ruling).
      // İşlenmeyecek queued mirror 201 success olarak bildirilmez (dürüst failure sinyali).
      this.logger.warn(`build dispatch başarısız (${job.id}): ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  // Teardown: queue + shared connection kapanır (app.close() → hanging handle kalmaz).
  async onModuleDestroy(): Promise<void> {
    await closeBuildQueue(this.queue).catch(() => {});
  }
}
