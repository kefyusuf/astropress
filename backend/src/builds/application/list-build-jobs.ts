import { Inject, Injectable } from '@nestjs/common';
import { BuildJob } from '../domain/build-job';
import { BUILD_JOB_REPOSITORY, BuildJobRepository } from './ports';

@Injectable()
export class ListBuildJobs {
  constructor(@Inject(BUILD_JOB_REPOSITORY) private readonly repo: BuildJobRepository) {}

  async execute(): Promise<BuildJob[]> {
    const all = await this.repo.findAll();
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}