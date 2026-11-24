import IORedis from 'ioredis';
import { OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
// v6.8.0: ThrottlerStorageRecord kök index'ten re-export edilmiyor (TS2724); gerçek tip
// tanımlandığı modülden import edilir. Shape: { totalHits, timeToExpire, isBlocked, timeToBlockExpire }.
// Dönüş değerleri SANİYE (in-memory parity: throttler.service.js:79,82 Math.ceil(ms/1000));
// guard raw değeri doğrudan Retry-After / X-RateLimit-Reset header'ına yazar (dönüşüm yok).
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

// Custom Redis storage (E): fixed-window INCR+PTTL, in-memory default ile parity.
// Guard/config değişmez (D1 seam); sadece storage provider swap.
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  constructor(private readonly redis: IORedis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    await this.waitReady();
    const redisKey = `throttler:${throttlerName}:${key}`;
    const blockKey = `${redisKey}:block`;
    // I1 parity: ÖNCE block durumu okunur. In-memory (throttler.service.js:135-142):
    // blocked iken fireHitCount ÇAĞRILMAZ (hits donar) ve block BİR KEZ kurulur.
    // Guard her istekte increment çağırır (throttler.guard.js:129) → koşulsuz INCR + re-SET
    // sliding block / kalıcı lockout üretirdi; blocked retry'lar burada sayacı ve block TTL'i değiştirmez.
    const blockTtl = await this.redis.pttl(blockKey);
    if (blockTtl > 0) {
      // Donuk sayı GET ile okunur (INCR yok); hit key expire olmuşsa 0 (in-memory pruneExpiredHits emsali).
      const frozenHits = await this.redis.get(redisKey);
      const hitPttl = await this.redis.pttl(redisKey);
      const timeToExpire = Math.ceil((hitPttl > 0 ? hitPttl : ttl) / 1000);
      return { totalHits: frozenHits !== null ? Number(frozenHits) : 0, timeToExpire, isBlocked: true, timeToBlockExpire: Math.ceil(blockTtl / 1000) };
    }
    const totalHits = await this.redis.incr(redisKey);
    if (totalHits === 1) await this.redis.pexpire(redisKey, ttl);
    const pttl = await this.redis.pttl(redisKey);
    // I2 parity: saniye (Math.ceil(ms/1000)) — in-memory service.js:79,82; guard header'a raw yazar.
    const timeToExpire = Math.ceil((pttl > 0 ? pttl : ttl) / 1000);
    let isBlocked = false;
    let timeToBlockExpire = 0;
    if (totalHits > limit) {
      // Block yalnızca blocked DEĞİLKEN kurulur (yukarıdaki early-return) → set-once, non-sliding.
      isBlocked = true;
      timeToBlockExpire = Math.ceil(blockDuration / 1000);
      await this.redis.set(blockKey, '1', 'PX', blockDuration);
    }
    return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
  }

  // createRedisConnection enableOfflineQueue:false → 'ready' ÖNCESİ komutlar anında reject eder
  // ("Stream isn't writeable"). Boot sonrası ilk mutation bu yarışa girer → sınırlı ready beklemesi.
  // Redis down ise: timeout → throw → 500 (fail-closed); boot/istek hang olmaz (boot-safe korunur).
  private waitReady(timeoutMs = 2000): Promise<void> {
    if (this.redis.status === 'ready') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onReady = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        this.redis.off('ready', onReady);
        reject(new Error('Redis throttler storage: connection not ready'));
      }, timeoutMs);
      this.redis.once('ready', onReady);
    });
  }

  // Handle leak guard (build-queue.ts emsali): app.close() connection'ı serbest bırakmazsa
  // node --test child process exit etmez. disconnect() (quit() değil): unreachable connection'da
  // quit() komutu offline-queue-disabled reject eder; disconnect senkron ve her durumda güvenli.
  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
