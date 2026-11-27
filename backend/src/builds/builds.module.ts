import { Module, Logger } from '@nestjs/common';
import { BUILD_JOB_REPOSITORY, BUILD_RUNNER, BUILD_DISPATCHER, BUILD_CONCURRENCY, EVENT_STORE, EventStore } from './application/ports';
import { BUILDS_FILE, defaultBuildsFile } from './infrastructure/file-build-job.repository';
import { FileEventStore, defaultEventsDir } from './infrastructure/file-event-store';
import { BuildWorkspace, BUILD_WORKSPACE_DIR, defaultWorkspaceDir } from './infrastructure/build-workspace';
import { PostgresEventStore } from './infrastructure/postgres-event-store';
import { EventSourcedBuildJobRepository } from './infrastructure/event-sourced-build-job.repository';
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
import { DATABASE_URL } from '../sites/infrastructure/postgres-site.repository';
import { HealthModule } from '../health/health.module';
import { ReadinessState } from '../health/readiness-state';
import { positiveIntEnv } from './infrastructure/builds-env';

// ASTROPRESS_BUILDS engine axis (file default | bullmq). ASTROPRESS_STORAGE'tan orthogonal.
const engine = process.env.ASTROPRESS_BUILDS ?? 'file';

// ASTROPRESS_STORAGE storage axis: postgres → PostgresEventStore; diğer (file/memory/sqlite) → FileEventStore.
// H2: factory readiness sinyali yazar (boot-safe catch korunur). Named export: factory seam testi (spec karar 10).
const storage = process.env.ASTROPRESS_STORAGE;
export const eventStoreProvider = storage === 'postgres'
  ? {
      provide: EVENT_STORE,
      useFactory: async (url: string, readiness: ReadinessState): Promise<EventStore> => {
        const store = new PostgresEventStore(url);
        try {
          await store.init();
          readiness.set('eventStore', true);
        } catch (err) {
          new Logger('PostgresEventStore').warn(`init başarısız, devam: ${err instanceof Error ? err.message : String(err)}`);
          readiness.set('eventStore', false);
        }
        return store;
      },
      inject: [DATABASE_URL, ReadinessState],
    }
  : {
      provide: EVENT_STORE,
      useFactory: (readiness: ReadinessState): EventStore => {
        readiness.set('eventStore', true);
        return new FileEventStore(defaultEventsDir());
      },
      inject: [ReadinessState],
    };

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
  // HealthModule explicit import: standalone BuildsModule boot'unda (builds.module.spec) @Global
  // kayıtlı olmaz → ReadinessState çözülmez. AppModule'da çift import zararsız (Nest dedupe).
  imports: [HealthModule],
  controllers: [BuildsController],
  providers: [
    { provide: BUILDS_FILE, useFactory: () => defaultBuildsFile() },
    { provide: BUILD_WORKSPACE_DIR, useFactory: () => defaultWorkspaceDir() },
    BuildWorkspace,
    { provide: ASTROPRESS_ROOT, useFactory: () => defaultRoot() },
    { provide: DATABASE_URL, useFactory: () => process.env.DATABASE_URL || '' },
    // Runtime pozitif tam sayı doğrulama (issue #12): negatif/NaN fail-fast.
    { provide: BUILD_QUEUE_LIMIT, useFactory: () => positiveIntEnv('ASTROPRESS_BUILD_QUEUE_LIMIT', 10) },
    { provide: BUILD_RETENTION, useFactory: () => positiveIntEnv('ASTROPRESS_BUILD_RETENTION', 50) },
    { provide: BUILD_CONCURRENCY, useFactory: () => positiveIntEnv('ASTROPRESS_BUILD_CONCURRENCY', 1) },
    eventStoreProvider,
    { provide: BUILD_JOB_REPOSITORY, useClass: EventSourcedBuildJobRepository },
    { provide: BUILD_RUNNER, useClass: AstroBuildRunner },
    ...engineProviders,
    EnqueueBuild,
    GetBuildJob,
    ListBuildJobs,
  ],
  exports: [BUILD_JOB_REPOSITORY, BUILD_RUNNER, BUILD_DISPATCHER, EnqueueBuild, GetBuildJob, ListBuildJobs],
})
export class BuildsModule {}