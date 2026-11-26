import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ReadinessState } from '../../src/health/readiness-state';
import type { EventStore } from '../../src/builds/application/ports';
import type { PostgresEventStore } from '../../src/builds/infrastructure/postgres-event-store';

// PG-down full boot sites factory'de brick olur (init catch'siz, kapsam-dışı) → ES factory
// seam testi doğru seviye (spec karar 10). Storage axis import-time → env önce, dinamik import sonra.
const origStorage = process.env.ASTROPRESS_STORAGE;
afterEach(() => {
  if (origStorage === undefined) delete process.env.ASTROPRESS_STORAGE;
  else process.env.ASTROPRESS_STORAGE = origStorage;
});

test('eventStoreProvider (postgres): init fail → store döner + eventStore degraded (boot-safe)', async () => {
  process.env.ASTROPRESS_STORAGE = 'postgres';
  const { eventStoreProvider } = await import('../../src/builds/builds.module');
  const provider = eventStoreProvider as { useFactory: (url: string, r: ReadinessState) => Promise<EventStore> };
  const readiness = new ReadinessState();
  // Kapalı port → anında ECONNREFUSED; init catch → warn + degraded, throw YOK.
  const store = await provider.useFactory('postgres://astropress:astropress@127.0.0.1:1/none', readiness);
  assert.ok(store, 'degraded boot store instance döndürmeli (brick yok)');
  assert.equal(readiness.snapshot().components.eventStore, 'degraded');
  await (store as PostgresEventStore).close();
});