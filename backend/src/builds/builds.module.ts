import { Module } from '@nestjs/common';
import { BUILD_JOB_REPOSITORY, BUILD_RUNNER, BUILD_DISPATCHER } from './application/ports';
import { BUILDS_FILE, FileBuildJobRepository, defaultBuildsFile } from './infrastructure/file-build-job.repository';
import { ASTROPRESS_ROOT, AstroBuildRunner, defaultRoot } from './infrastructure/astro-build-runner';
import { BUILD_RETENTION, BuildWorker } from './application/build-worker';
import { BUILD_QUEUE_LIMIT, EnqueueBuild } from './application/enqueue-build';
import { GetBuildJob } from './application/get-build-job';
import { ListBuildJobs } from './application/list-build-jobs';
import { BuildsController } from './builds.controller';
import { REDIS_URL, defaultRedisUrl } from '../infrastructure/redis-connection';
import { BUILD_QUEUE, createBuildQueue } from './infrastructure/bullmq/build-queue';
import { BullMqDispatcher } from './infrastructure/bullmq/bullmq-dispatcher';
import { BullMqBuildWorker } from './infrastructure/bullmq/bullmq-build-worker';

// ASTROPRESS_BUILDS engine axis (file default | bullmq). ASTROPRESS_STORAGE'tan orthogonal.
const engine = process.env.ASTROPRESS_BUILDS ?? 'file';

const engineProviders = engine === 'bullmq'
  ? [
      { provide: REDIS_URL, useFactory: () => defaultRedisUrl() },
      { provide: BUILD_QUEUE, useFactory: (url: string, retention: number) => createBuildQueue(url, retention), inject: [REDIS_URL, BUILD_RETENTION] },
      { provide: BUILD_DISPATCHER, useClass: BullMqDispatcher },
      BullMqBuildWorker,
    ]
  : [
      BuildWorker,
      { provide: BUILD_DISPATCHER, useExisting: BuildWorker },
    ];

@Module({
  controllers: [BuildsController],
  providers: [
    { provide: BUILDS_FILE, useFactory: () => defaultBuildsFile() },
    { provide: ASTROPRESS_ROOT, useFactory: () => defaultRoot() },
    { provide: BUILD_QUEUE_LIMIT, useFactory: () => Number(process.env.ASTROPRESS_BUILD_QUEUE_LIMIT) || 10 },
    { provide: BUILD_RETENTION, useFactory: () => Number(process.env.ASTROPRESS_BUILD_RETENTION) || 50 },
    { provide: BUILD_JOB_REPOSITORY, useClass: FileBuildJobRepository },
    { provide: BUILD_RUNNER, useClass: AstroBuildRunner },
    ...engineProviders,
    EnqueueBuild,
    GetBuildJob,
    ListBuildJobs,
  ],
  exports: [BUILD_JOB_REPOSITORY, BUILD_RUNNER, BUILD_DISPATCHER, EnqueueBuild, GetBuildJob, ListBuildJobs],
})
export class BuildsModule {}