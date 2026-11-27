import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { BuildJob } from '../domain/build-job';
import { BuildQueueFullError } from '../domain/errors';
import { BUILD_JOB_REPOSITORY, BUILD_DISPATCHER, BuildJobRepository, BuildDispatcher } from './ports';

export const BUILD_QUEUE_LIMIT = Symbol('BUILD_QUEUE_LIMIT');

@Injectable()
export class EnqueueBuild {
  constructor(
    @Inject(BUILD_JOB_REPOSITORY) private readonly repo: BuildJobRepository,
    @Inject(BUILD_DISPATCHER) private readonly dispatcher: BuildDispatcher,
    @Inject(BUILD_QUEUE_LIMIT) private readonly limit: number,
  ) {}

  async execute(): Promise<BuildJob> {
    const all = await this.repo.findAll();
    const queued = all.filter((j) => j.status === 'queued').length;
    if (queued >= this.limit) throw new BuildQueueFullError(this.limit);
    // crypto.randomUUID (issue #12): restart/replica'da sıfırlanan ++seq çakışması yok.
    const id = randomUUID();
    const job = BuildJob.newQueued(id, new Date().toISOString());
    await this.repo.save(job); // read-model mirror dispatch-ÖNCE (parity)
    try {
      await this.dispatcher.dispatch(job);
    } catch (err) {
      // Dispatch telafisi (issue #12): Redis hatasında queued yetim kalmasın —
      // mirror'da dispatch-lost yazılır; istemci 500 alır ve yeniden deneyebilir.
      const lost = job.markDispatchLost(new Date().toISOString());
      await this.repo.save(lost).catch(() => {});
      throw err;
    }
    return job;
  }
}
