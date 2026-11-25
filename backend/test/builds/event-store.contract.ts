import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventStore } from '../../src/builds/application/ports';
import { BuildEvent } from '../../src/builds/domain/build-event';
import { ConcurrencyError } from '../../src/builds/domain/errors';

export interface EventStoreHarness { store: EventStore; cleanup?: () => void | Promise<void> }
export class SkipTest extends Error {}

const NOW = '2026-11-25T10:00:00.000Z';
const q = (v: number): BuildEvent => ({ streamId: 'b1', version: v, ts: NOW, type: 'BuildQueued', payload: { createdAt: NOW } });
const s = (v: number): BuildEvent => ({ streamId: 'b1', version: v, ts: NOW, type: 'BuildStarted', payload: { startedAt: NOW } });

export function runEventStoreContract(label: string, makeStore: () => EventStoreHarness | Promise<EventStoreHarness>, opts?: { skip?: string }): void {
  const testOpts = opts?.skip ? { skip: opts.skip } : {};
  const harness = async (t: any) => {
    try { return await makeStore(); }
    catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return null; } throw e; }
  };

  test(`[${label}] boş stream: readStream [], readAll []`, testOpts, async (t) => {
    const h = await harness(t); if (!h) return;
    try {
      assert.deepEqual(await h.store.readStream('b1'), []);
      assert.deepEqual(await h.store.readAll(), []);
    } finally { await h.cleanup?.(); }
  });

  test(`[${label}] append + readStream (version sıralı)`, testOpts, async (t) => {
    const h = await harness(t); if (!h) return;
    try {
      await h.store.append('b1', [q(1)], 0);
      await h.store.append('b1', [s(2)], 1);
      const evs = await h.store.readStream('b1');
      assert.deepEqual(evs.map((e) => e.version), [1, 2]);
      assert.deepEqual(evs.map((e) => e.type), ['BuildQueued', 'BuildStarted']);
    } finally { await h.cleanup?.(); }
  });

  test(`[${label}] optimistic conflict: yanlış expectedVersion → ConcurrencyError`, testOpts, async (t) => {
    const h = await harness(t); if (!h) return;
    try {
      await h.store.append('b1', [q(1)], 0);
      await assert.rejects(() => h.store.append('b1', [s(2)], 5), ConcurrencyError);
    } finally { await h.cleanup?.(); }
  });

  test(`[${label}] readAll tüm stream'leri döner`, testOpts, async (t) => {
    const h = await harness(t); if (!h) return;
    try {
      await h.store.append('b1', [q(1)], 0);
      await h.store.append('b2', [{ ...q(1), streamId: 'b2' }], 0);
      const all = await h.store.readAll();
      assert.equal(all.length, 2);
      assert.deepEqual(all.map((e) => e.streamId).sort(), ['b1', 'b2']);
    } finally { await h.cleanup?.(); }
  });

  test(`[${label}] immutable: append sonrası readStream değişmez (ekleme hariç)`, testOpts, async (t) => {
    const h = await harness(t); if (!h) return;
    try {
      await h.store.append('b1', [q(1)], 0);
      const before = await h.store.readStream('b1');
      await h.store.readStream('b1');
      assert.deepEqual(await h.store.readStream('b1'), before);
    } finally { await h.cleanup?.(); }
  });
}