import { BuildValidationError } from './errors';

export type BuildStatus = 'queued' | 'running' | 'succeeded' | 'failed';

// Domain value object: build çalıştırmanın sonucu (application buna bağımlı, tersi değil).
export interface BuildResult {
  ok: boolean;
  exitCode: number;     // spawn fail/timeout: -1
  logTail: string;      // stdout+stderr son ~8 satır
  error?: string;       // spawn fail/timeout mesajı
}

export interface BuildJobProps {
  id: string;
  status: BuildStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  logTail?: string;
  error?: string;
}

const STATUSES: readonly BuildStatus[] = ['queued', 'running', 'succeeded', 'failed'];

export class BuildJob {
  readonly id: string;
  readonly status: BuildStatus;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly exitCode?: number;
  readonly logTail?: string;
  readonly error?: string;

  private constructor(props: BuildJobProps) {
    this.id = props.id;
    this.status = props.status;
    this.createdAt = props.createdAt;
    this.startedAt = props.startedAt;
    this.finishedAt = props.finishedAt;
    this.exitCode = props.exitCode;
    this.logTail = props.logTail;
    this.error = props.error;
  }

  static create(props: BuildJobProps): BuildJob {
    // typeof guard'ları: coerce geçişi + 500 TypeError yerine 400 BuildValidationError (issue #10).
    if (typeof props?.id !== 'string' || !props.id.trim() || props.id.length > 128) {
      throw new BuildValidationError('Build job id boş olamaz (string, ≤128)');
    }
    if (!STATUSES.includes(props.status)) {
      throw new BuildValidationError(`Geçersiz status: ${String(props?.status)}`);
    }
    if (typeof props?.createdAt !== 'string' || Number.isNaN(Date.parse(props.createdAt))) {
      throw new BuildValidationError(`Geçersiz createdAt: ${String(props?.createdAt)}`);
    }
    if (props.status === 'running' && !props.startedAt) {
      throw new BuildValidationError('running job startedAt gerektirir');
    }
    if ((props.status === 'succeeded' || props.status === 'failed') && !props.finishedAt) {
      throw new BuildValidationError('terminal job finishedAt gerektirir');
    }
    if (props.startedAt !== undefined && (typeof props.startedAt !== 'string' || Number.isNaN(Date.parse(props.startedAt)))) {
      throw new BuildValidationError(`Geçersiz startedAt: ${String(props.startedAt)}`);
    }
    if (props.finishedAt !== undefined && (typeof props.finishedAt !== 'string' || Number.isNaN(Date.parse(props.finishedAt)))) {
      throw new BuildValidationError(`Geçersiz finishedAt: ${String(props.finishedAt)}`);
    }
    if (props.exitCode !== undefined && typeof props.exitCode !== 'number') {
      throw new BuildValidationError(`Geçersiz exitCode: ${props.exitCode}`);
    }
    return new BuildJob(props);
  }

  static newQueued(id: string, now: string): BuildJob {
    return BuildJob.create({ id, status: 'queued', createdAt: now });
  }

  markRunning(now: string): BuildJob {
    if (this.status !== 'queued') {
      throw new BuildValidationError(`markRunning yalnız queued'den çağrılır: ${this.status}`);
    }
    return BuildJob.create({ ...this.toProps(), status: 'running', startedAt: now });
  }

  markSucceeded(result: BuildResult, now: string): BuildJob {
    if (this.status !== 'running') {
      throw new BuildValidationError(`markSucceeded yalnız running'den çağrılır: ${this.status}`);
    }
    return BuildJob.create({
      ...this.toProps(),
      status: 'succeeded',
      finishedAt: now,
      exitCode: result.exitCode,
      logTail: result.logTail,
    });
  }

  markFailed(error: string, now: string, exitCode?: number, logTail?: string): BuildJob {
    if (this.status !== 'running') {
      throw new BuildValidationError(`markFailed yalnız running'den çağrılır: ${this.status}`);
    }
    return BuildJob.create({
      ...this.toProps(),
      status: 'failed',
      finishedAt: now,
      error,
      exitCode,
      logTail,
    });
  }

  markDispatchLost(now: string): BuildJob {
    if (this.status !== 'queued') {
      throw new BuildValidationError(`markDispatchLost yalnız queued'den çağrılır: ${this.status}`);
    }
    return BuildJob.create({ ...this.toProps(), status: 'failed', finishedAt: now, error: 'dispatch-lost' });
  }

  toProps(): BuildJobProps {
    return {
      id: this.id,
      status: this.status,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      exitCode: this.exitCode,
      logTail: this.logTail,
      error: this.error,
    };
  }
}