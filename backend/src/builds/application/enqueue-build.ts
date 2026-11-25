import { Inject, Injectable } from '@nestjs/common';
import { BuildJob } from '../domain/build-job';
import { BuildQueueFullError } from '../domain/errors';
import { BUILD_JOB_REPOSITORY, BUILD_DISPATCHER, BuildJobRepository, BuildDispatcher } from './ports';

export const BUILD_QUEUE_LIMIT = Symbol('BUILD_QUEUE_LIMIT');

// Module-level monotonic counter: concurrent POST'larda id collision yok.
let seq = 0;

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
    const id = `build-${++seq}-${Date.now().toString(36)}`;
    const job = BuildJob.newQueued(id, new Date().toISOString());
    await this.repo.save(job); // read-model mirror dispatch-ÖNCE (parity)
    await this.dispatcher.dispatch(job);
    return job;
  }
}