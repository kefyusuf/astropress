import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldBuildJob, BuildEvent } from '../../src/builds/domain/build-event';
import { BuildValidationError } from '../../src/builds/domain/errors';

const NOW = '2026-11-25T10:00:00.000Z';
const ev = (version: number, type: BuildEvent['type'], payload: any): BuildEvent =>
  ({ streamId: 'b1', version, ts: NOW, type, payload } as BuildEvent);

test('fold boş → null', () => {
  assert.equal(foldBuildJob([]), null);
});

test('fold queued → running → succeeded', () => {
  const job = foldBuildJob([
    ev(1, 'BuildQueued', { createdAt: NOW }),
    ev(2, 'BuildStarted', { startedAt: NOW }),
    ev(3, 'BuildSucceeded', { finishedAt: NOW, exitCode: 0, logTail: 'ok' }),
  ])!;
  assert.equal(job.status, 'succeeded');
  assert.equal(job.exitCode, 0);
  assert.equal(job.logTail, 'ok');
});

test('fold queued → DispatchLost → failed (dispatch-lost)', () => {
  const job = foldBuildJob([
    ev(1, 'BuildQueued', { createdAt: NOW }),
    ev(2, 'DispatchLost', { finishedAt: NOW }),
  ])!;
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'dispatch-lost');
});

test('fold running → BuildFailed (interrupted)', () => {
  const job = foldBuildJob([
    ev(1, 'BuildQueued', { createdAt: NOW }),
    ev(2, 'BuildStarted', { startedAt: NOW }),
    ev(3, 'BuildFailed', { finishedAt: NOW, error: 'interrupted' }),
  ])!;
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'interrupted');
});

test('fold yasadışı geçiş → BuildValidationError', () => {
  assert.throws(() => foldBuildJob([
    ev(1, 'BuildQueued', { createdAt: NOW }),
    ev(2, 'BuildSucceeded', { finishedAt: NOW, exitCode: 0, logTail: 'ok' }),
  ]), BuildValidationError);
});