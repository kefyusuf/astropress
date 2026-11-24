import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createRedisConnection } from './redis-connection';

export const BUILD_QUEUE = Symbol('BUILD_QUEUE');
export const BUILD_QUEUE_NAME = 'astropress-builds';

// BullMQ'ya geçirilen IORedis instance "shared" (caller-owned) sayılır: queue.close() connection'ı
// DISCONNECT ETMEZ. Handle leak (socket açık kalır → node --test exit etmez) olmasın diye instance'ı
// kayıt ediyoruz; closeBuildQueue teardown'da açıkça disconnect eder.
const queueConnections = new WeakMap<Queue, IORedis>();

export function createBuildQueue(url: string, retention: number): Queue {
  const connection = createRedisConnection(url);
  const queue = new Queue(BUILD_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 1, // parity: no auto-retry
      removeOnComplete: { count: retention }, // Redis memory bound (repo prune'dan bağımsız)
      removeOnFail: { count: retention },
    },
  });
  queueConnections.set(queue, connection);
  return queue;
}

// Teardown: önce BullMQ close (listener cleanup), sonra shared connection disconnect (handle serbest).
export async function closeBuildQueue(queue: Queue): Promise<void> {
  await queue.close();
  queueConnections.get(queue)?.disconnect();
}