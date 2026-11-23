import { Module } from '@nestjs/common';
import { BUILD_JOB_REPOSITORY, BUILD_RUNNER } from './application/ports';
import { BUILDS_FILE, FileBuildJobRepository, defaultBuildsFile } from './infrastructure/file-build-job.repository';
import { ASTROPRESS_ROOT, AstroBuildRunner, defaultRoot } from './infrastructure/astro-build-runner';
import { BUILD_RETENTION, BuildWorker } from './application/build-worker';
import { BUILD_QUEUE_LIMIT, EnqueueBuild } from './application/enqueue-build';
import { GetBuildJob } from './application/get-build-job';
import { ListBuildJobs } from './application/list-build-jobs';
import { BuildsController } from './builds.controller';

@Module({
  controllers: [BuildsController],
  providers: [
    { provide: BUILDS_FILE, useFactory: () => defaultBuildsFile() },
    { provide: ASTROPRESS_ROOT, useFactory: () => defaultRoot() },
    { provide: BUILD_QUEUE_LIMIT, useFactory: () => Number(process.env.ASTROPRESS_BUILD_QUEUE_LIMIT) || 10 },
    { provide: BUILD_RETENTION, useFactory: () => Number(process.env.ASTROPRESS_BUILD_RETENTION) || 50 },
    { provide: BUILD_JOB_REPOSITORY, useClass: FileBuildJobRepository },
    { provide: BUILD_RUNNER, useClass: AstroBuildRunner },
    BuildWorker,
    EnqueueBuild,
    GetBuildJob,
    ListBuildJobs,
  ],
  exports: [BUILD_JOB_REPOSITORY, BUILD_RUNNER, BuildWorker, EnqueueBuild, GetBuildJob, ListBuildJobs],
})
export class BuildsModule {}