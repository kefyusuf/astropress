import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { BuildJob } from '../../domain/build-job';
import { BuildDispatcher } from '../../application/ports';
import { BUILD_QUEUE, closeBuildQueue } from './build-queue';

@Injectable()
export class BullMqDispatcher implements BuildDispatcher, OnModuleDestroy {
  constructor(@Inject(BUILD_QUEUE) private readonly queue: Queue) {}

  // Durable trigger: jobId option BullMQ dedup sağlar (aynı build id iki kez işlenmez).
  async dispatch(job: BuildJob): Promise<void> {
    await this.queue.add('build', { jobId: job.id }, { jobId: job.id });
  }

  // Teardown: queue + shared connection kapanır (app.close() → hanging handle kalmaz).
  async onModuleDestroy(): Promise<void> {
    await closeBuildQueue(this.queue).catch(() => {});
  }
}