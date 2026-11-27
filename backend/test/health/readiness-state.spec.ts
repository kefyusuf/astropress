import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadinessState } from '../../src/health/readiness-state';

test('snapshot: boş component map → ready (vacuous; boot listen öncesi kaydeder)', () => {
  assert.deepEqual(new ReadinessState().snapshot(), { status: 'ready', components: {} });
});

test('set: tüm component ok → ready + map', () => {
  const r = new ReadinessState();
  r.set('eventStore', true);
  r.set('buildEngine', true);
  assert.deepEqual(r.snapshot(), { status: 'ready', components: { eventStore: 'ready', buildEngine: 'ready' } });
});

test('set: tek degraded → status degraded', () => {
  const r = new ReadinessState();
  r.set('eventStore', true);
  r.set('buildEngine', false);
  assert.deepEqual(r.snapshot(), { status: 'degraded', components: { eventStore: 'ready', buildEngine: 'degraded' } });
});

test('set: degraded → heal (true ile üzerine yaz)', () => {
  const r = new ReadinessState();
  r.set('buildEngine', false);
  r.set('buildEngine', true);
  assert.equal(r.snapshot().status, 'ready');
});

test('shutdown degrade: onApplicationShutdown → degraded + shutdown component (issue #16)', () => {
  const r = new ReadinessState();
  r.set('buildEngine', true);
  assert.equal(r.snapshot().status, 'ready');
  r.onApplicationShutdown();
  assert.equal(r.snapshot().status, 'degraded');
  assert.equal(r.snapshot().components.shutdown, 'degraded');
});