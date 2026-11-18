import { BuildJob, BuildResult } from '../domain/build-job';

export const BUILD_JOB_REPOSITORY = Symbol('BUILD_JOB_REPOSITORY');
export const BUILD_RUNNER = Symbol('BUILD_RUNNER');

export interface BuildRunner {
  run(): Promise<BuildResult>;
}

export interface BuildJobRepository {
  save(job: BuildJob): Promise<void>;
  findById(id: string): Promise<BuildJob | null>;
  findAll(): Promise<BuildJob[]>;
}