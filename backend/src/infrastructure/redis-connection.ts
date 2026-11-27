import IORedis from 'ioredis';

export const REDIS_URL = Symbol('REDIS_URL');

export function defaultRedisUrl(): string {
  return process.env.REDIS_URL ?? 'redis://localhost:6379';
}

// BullMQ Worker blocking connection maxRetriesPerRequest:null ister. retryStrategy DEFAULT kalır:
// Redis yoksa reconnect dener (null DEĞİL). Boot-safe'lik 'error' listener + async Worker init
// ile sağlanır (aşağıya bkz.) — retryStrategy ile değil.
export function createRedisConnection(url: string): IORedis {
  const connection = new IORedis(url, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  // Boot-safe (acceptance #7): Redis down'da ioredis 'error' event'i unhandled kalırsa Node process crash eder.
  // BullMQ kendi listener'ını bağlar; bağımsız garanti için connection-level listener.
  // Rate-limited structured log (issue #16): hata seli logu boğmasın — 30sn'de bir kayıt,
  // URL/credential sızdırmadan yalnız hata kodu.
  let lastLoggedAt = 0;
  connection.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastLoggedAt < 30000) return;
    lastLoggedAt = now;
    const code = (err as { code?: string }).code ?? 'REDIS_ERROR';
    console.warn(JSON.stringify({ level: 'warn', msg: 'redis connection error', code }));
  });
  return connection;
}
