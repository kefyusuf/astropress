import { Module } from '@nestjs/common';
import { BUILD_JOB_REPOSITORY, BUILD_RUNNER } from './application/ports';
import { BUILDS_FILE, FileBuildJobRepository, defaultBuildsFile } from './infrastructure/file-build-job.repository';
import { ASTROPRESS_ROOT, AstroBuildRunner, defaultRoot } from './infrastructure/astro-build-runner';
import { BuildWorker } from './application/build-worker';
import { EnqueueBuild } from './application/enqueue-build';
import { GetBuildJob } from './application/get-build-job';
import { ListBuildJobs } from './application/list-build-jobs';
import { BuildsController } from './builds.controller';

@Module({
  controllers: [BuildsController],
  providers: [
    { provide: BUILDS_FILE, useFactory: () => defaultBuildsFile() },
    { provide: ASTROPRESS_ROOT, useFactory: () => defaultRoot() },
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