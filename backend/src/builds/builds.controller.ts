import { Controller, Get, Param, Post } from '@nestjs/common';
import { EnqueueBuild } from './application/enqueue-build';
import { GetBuildJob } from './application/get-build-job';
import { ListBuildJobs } from './application/list-build-jobs';

@Controller('builds')
export class BuildsController {
  constructor(
    private readonly enqueueBuild: EnqueueBuild,
    private readonly getBuildJob: GetBuildJob,
    private readonly listBuildJobs: ListBuildJobs,
  ) {}

  @Post()
  enqueue() {
    return this.enqueueBuild.execute();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.getBuildJob.execute(id);
  }

  @Get()
  list() {
    return this.listBuildJobs.execute();
  }
}