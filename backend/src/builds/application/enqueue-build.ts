import { Inject, Injectable } from '@nestjs/common';
import { BuildJob } from '../domain/build-job';
import { BuildQueueFullError } from '../domain/errors';
import { BUILD_JOB_REPOSITORY, BuildJobRepository } from './ports';
import { BuildWorker } from './build-worker';

export const BUILD_QUEUE_LIMIT = Symbol('BUILD_QUEUE_LIMIT');

// Module-level monotonic counter: concurrent POST'larda id collision yok.
let seq = 0;

@Injectable()
export class EnqueueBuild {
  constructor(
    @Inject(BUILD_JOB_REPOSITORY) private readonly repo: BuildJobRepository,
    private readonly worker: BuildWorker,
    @Inject(BUILD_QUEUE_LIMIT) private readonly limit: number,
  ) {}

  async execute(): Promise<BuildJob> {
    const all = await this.repo.findAll();
    const queued = all.filter((j) => j.status === 'queued').length;
    if (queued >= this.limit) throw new BuildQueueFullError(this.limit);
    const id = `build-${++seq}-${Date.now().toString(36)}`;
    const job = BuildJob.newQueued(id, new Date().toISOString());
    await this.repo.save(job);
    this.worker.kick();
    return job;
  }
}