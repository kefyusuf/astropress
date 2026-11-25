import { BuildJob } from './build-job';

export type BuildEvent =
  | { streamId: string; version: number; ts: string; type: 'BuildQueued'; payload: { createdAt: string } }
  | { streamId: string; version: number; ts: string; type: 'BuildStarted'; payload: { startedAt: string } }
  | { streamId: string; version: number; ts: string; type: 'BuildSucceeded'; payload: { finishedAt: string; exitCode: number; logTail: string } }
  | { streamId: string; version: number; ts: string; type: 'BuildFailed'; payload: { finishedAt: string; error: string; exitCode?: number; logTail?: string } }
  | { streamId: string; version: number; ts: string; type: 'DispatchLost'; payload: { finishedAt: string } };

// Event dizisinden aggregate reconstruct (tek fold: save + recovery rebuild ortak).
// Yasadışı geçiş domain markX guard'ından BuildValidationError fırlatır.
export function foldBuildJob(events: BuildEvent[]): BuildJob | null {
  let job: BuildJob | null = null;
  for (const e of events) {
    switch (e.type) {
      case 'BuildQueued':
        job = BuildJob.newQueued(e.streamId, e.payload.createdAt);
        break;
      case 'BuildStarted':
        job = job!.markRunning(e.payload.startedAt);
        break;
      case 'BuildSucceeded':
        job = job!.markSucceeded({ ok: true, exitCode: e.payload.exitCode, logTail: e.payload.logTail }, e.payload.finishedAt);
        break;
      case 'BuildFailed':
        job = job!.markFailed(e.payload.error, e.payload.finishedAt, e.payload.exitCode, e.payload.logTail);
        break;
      case 'DispatchLost':
        job = job!.markDispatchLost(e.payload.finishedAt);
        break;
    }
  }
  return job;
}