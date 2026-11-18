import { Inject, Injectable } from '@nestjs/common';
import { BuildJob } from '../domain/build-job';
import { BuildJobNotFoundError } from '../domain/errors';
import { BUILD_JOB_REPOSITORY, BuildJobRepository } from './ports';

@Injectable()
export class GetBuildJob {
  constructor(@Inject(BUILD_JOB_REPOSITORY) private readonly repo: BuildJobRepository) {}

  async execute(id: string): Promise<BuildJob> {
    const job = await this.repo.findById(id);
    if (!job) throw new BuildJobNotFoundError(id);
    return job;
  }
}