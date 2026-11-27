import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuildExceptionFilter } from '../../src/builds/infrastructure/build-exception.filter';
import { BuildQueueFullError, BuildValidationError, ConcurrencyError } from '../../src/builds/domain/errors';

// Issue #12: ConcurrencyError → 409 Conflict (500 değil).
function capture(exception: unknown): { status: number; body: unknown } {
  let captured: { status: number; body: unknown } | null = null;
  const res = {
    code: 0,
    status(code: number): unknown { this.code = code; return this; },
    json(b: unknown): void { captured = { status: this.code, body: b }; },
  };
  new BuildExceptionFilter().catch(exception as never, { switchToHttp: () => ({ getResponse: () => res }) } as never);
  assert.ok(captured, 'filter yanıt yazmalı');
  return captured;
}

test('ConcurrencyError → 409 Conflict (kabul kriteri)', () => {
  const { status, body } = capture(new ConcurrencyError('stream-1', 3, 2));
  assert.equal(status, 409);
  assert.equal((body as { error: string }).error, 'ConcurrencyError');
});

test('BuildValidationError → 400, BuildQueueFullError → 429 (mevcut eşleme korunur)', () => {
  assert.equal(capture(new BuildValidationError('x')).status, 400);
  assert.equal(capture(new BuildQueueFullError(10)).status, 429);
});

test('positiveIntEnv: geçersiz değer fail-fast, tanımsız fallback', () => {
  const { positiveIntEnv } = require('../../src/builds/infrastructure/builds-env') as typeof import('../../src/builds/infrastructure/builds-env');
  process.env.AP_TEST_POSITIVE = '-1';
  assert.throws(() => positiveIntEnv('AP_TEST_POSITIVE', 10), /pozitif tam sayı/);
  process.env.AP_TEST_POSITIVE = 'abc';
  assert.throws(() => positiveIntEnv('AP_TEST_POSITIVE', 10), /pozitif tam sayı/);
  delete process.env.AP_TEST_POSITIVE;
  assert.equal(positiveIntEnv('AP_TEST_POSITIVE', 10), 10);
  process.env.AP_TEST_POSITIVE = '7';
  assert.equal(positiveIntEnv('AP_TEST_POSITIVE', 10), 7);
  delete process.env.AP_TEST_POSITIVE;
});
