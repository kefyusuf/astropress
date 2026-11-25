import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runEventStoreContract } from './event-store.contract';
import { FileEventStore } from '../../src/builds/infrastructure/file-event-store';

runEventStoreContract('file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astropress-events-'));
  return { store: new FileEventStore(dir), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
});