import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuildJob } from '../../src/builds/domain/build-job';
import { BuildValidationError } from '../../src/builds/domain/errors';

const NOW = '2026-11-16T10:00:00.000Z';

test('newQueued geçerli queued job üretir', () => {
  const job = BuildJob.newQueued('build-1-abc', NOW);
  assert.equal(job.status, 'queued');
  assert.equal(job.createdAt, NOW);
  assert.equal(job.id, 'build-1-abc');
});

test('create geçersiz status reddeder', () => {
  assert.throws(
    () => BuildJob.create({ id: 'b', status: 'bogus' as never, createdAt: NOW }),
    BuildValidationError,
  );
});

test('create boş id reddeder', () => {
  assert.throws(() => BuildJob.create({ id: '  ', status: 'queued', createdAt: NOW }), BuildValidationError);
});

test('markRunning queued → running + startedAt', () => {
  const job = BuildJob.newQueued('b', NOW).markRunning(NOW);
  assert.equal(job.status, 'running');
  assert.equal(job.startedAt, NOW);
});

test('markSucceeded running → succeeded + finishedAt + exitCode + logTail', () => {
  const job = BuildJob.newQueued('b', NOW).markRunning(NOW)
    .markSucceeded({ ok: true, exitCode: 0, logTail: 'done' }, NOW);
  assert.equal(job.status, 'succeeded');
  assert.equal(job.finishedAt, NOW);
  assert.equal(job.exitCode, 0);
  assert.equal(job.logTail, 'done');
});

test('markFailed running → failed + error + exitCode', () => {
  const job = BuildJob.newQueued('b', NOW).markRunning(NOW).markFailed('boom', NOW, 1, 'err tail');
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'boom');
  assert.equal(job.finishedAt, NOW);
  assert.equal(job.exitCode, 1);
});

test('illegal transition queued → succeeded reddeder', () => {
  const job = BuildJob.newQueued('b', NOW);
  assert.throws(() => job.markSucceeded({ ok: true, exitCode: 0, logTail: '' }, NOW), BuildValidationError);
});

test('persisted props round-trip revalidation', () => {
  const job = BuildJob.newQueued('b', NOW).markRunning(NOW)
    .markSucceeded({ ok: true, exitCode: 0, logTail: 'ok' }, NOW);
  const restored = BuildJob.create(JSON.parse(JSON.stringify(job.toProps())));
  assert.deepEqual(restored.toProps(), job.toProps());
});

test('create geçersiz createdAt reddeder', () => {
  assert.throws(() => BuildJob.create({ id: 'b', status: 'queued', createdAt: 'garbage' }), BuildValidationError);
});

test('create running startedAt olmadan reddeder', () => {
  assert.throws(() => BuildJob.create({ id: 'b', status: 'running', createdAt: NOW }), BuildValidationError);
});

test('create terminal finishedAt olmadan reddeder', () => {
  assert.throws(() => BuildJob.create({ id: 'b', status: 'succeeded', createdAt: NOW, exitCode: 0 }), BuildValidationError);
});

test('create geçersiz startedAt reddeder', () => {
  assert.throws(() => BuildJob.create({ id: 'b', status: 'running', createdAt: NOW, startedAt: 'garbage' }), BuildValidationError);
});

test('create geçersiz finishedAt reddeder', () => {
  assert.throws(() => BuildJob.create({ id: 'b', status: 'succeeded', createdAt: NOW, finishedAt: 'garbage', exitCode: 0 }), BuildValidationError);
});

test('create terminal sayısal olmayan exitCode reddeder', () => {
  assert.throws(() => BuildJob.create({ id: 'b', status: 'succeeded', createdAt: NOW, finishedAt: NOW, exitCode: '0' as never }), BuildValidationError);
});

test('markFailed exitCode olmadan geçerli failed üretir (spawn fail/timeout)', () => {
  const job = BuildJob.newQueued('b', NOW).markRunning(NOW).markFailed('timeout', NOW);
  assert.equal(job.status, 'failed');
  assert.equal(job.exitCode, undefined);
  assert.equal(job.error, 'timeout');
});

test('markDispatchLost queued → failed + error dispatch-lost + finishedAt', () => {
  const job = BuildJob.newQueued('b', NOW).markDispatchLost(NOW);
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'dispatch-lost');
  assert.equal(job.finishedAt, NOW);
});

test('markDispatchLost queued-dışı state reddeder', () => {
  const running = BuildJob.newQueued('b', NOW).markRunning(NOW);
  assert.throws(() => running.markDispatchLost(NOW), BuildValidationError);
});