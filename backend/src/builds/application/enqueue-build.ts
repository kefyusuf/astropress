import { Inject, Injectable } from '@nestjs/common';
import { BuildJob } from '../domain/build-job';
import { BUILD_JOB_REPOSITORY, BuildJobRepository } from './ports';
import { BuildWorker } from './build-worker';

// Module-level monotonic counter: concurrent POST'larda id collision yok.
let seq = 0;

@Injectable()
export class EnqueueBuild {
  constructor(
    @Inject(BUILD_JOB_REPOSITORY) private readonly repo: BuildJobRepository,
    private readonly worker: BuildWorker,
  ) {}

  async execute(): Promise<BuildJob> {
    const id = `build-${++seq}-${Date.now().toString(36)}`;
    const job = BuildJob.newQueued(id, new Date().toISOString());
    await this.repo.save(job);
    this.worker.kick();
    return job;
  }
}