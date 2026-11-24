import IORedis from 'ioredis';

export const REDIS_URL = Symbol('REDIS_URL');

export function defaultRedisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

// BullMQ Worker blocking connection maxRetriesPerRequest:null ister. retryStrategy boot-safe:
// Redis yoksa sonsuz retry yerine null (connection error event'e düşer, app brick olmaz).
export function createRedisConnection(url: string): IORedis {
  const connection = new IORedis(url, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  // Boot-safe (acceptance #7): Redis down'da ioredis 'error' event'i unhandled kalırsa Node process crash eder.
  // BullMQ kendi listener'ını bağlar; bağımsız garanti için connection-level no-op listener (asıl log
  // Worker/Queue seviyesinde). Böylece unreachable Redis boot'u brick etmez.
  connection.on('error', () => {});
  return connection;
}