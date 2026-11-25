import IORedis from 'ioredis';
import { OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
// v6.8.0: ThrottlerStorageRecord kök index'ten re-export edilmiyor (TS2724); gerçek tip
// tanımlandığı modülden import edilir. Shape: { totalHits, timeToExpire, isBlocked, timeToBlockExpire }.
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

// H1: fixed-window increment+expire tek atomik Lua script (rate limiter sektör normu).
// Redis single-threaded script execution → INCR↔PEXPIRE crash penceresi ve concurrent block yarışı
// kökten kapanır. I1 (freeze-hits, set-once NX) parity script içinde; I2 (saniye) dönüşümü TS'te.
// Dönüş: [totalHits, pttlMs, isBlocked(0|1), blockMs] — ms fallback'leri (>0 ? pttl : ttl) eski TS parity birebir.
const LUA_INCREMENT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = redis.call('GET', KEYS[1])
  local pttl = redis.call('PTTL', KEYS[1])
  return { tonumber(hits) or 0, pttl > 0 and pttl or tonumber(ARGV[1]), 1, blockTtl }
end
local total = redis.call('INCR', KEYS[1])
if total == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local pttl = redis.call('PTTL', KEYS[1])
if pttl == -1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1]); pttl = redis.call('PTTL', KEYS[1])
end
if total > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3], 'NX')
  return { total, pttl > 0 and pttl or tonumber(ARGV[1]), 1, tonumber(ARGV[3]) }
end
return { total, pttl > 0 and pttl or tonumber(ARGV[1]), 0, 0 }
`;

// Custom Redis storage (E + H1): guard/config değişmez (D1 seam); sadece storage provider swap.
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  constructor(private readonly redis: IORedis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    await this.waitReady();
    const redisKey = `throttler:${throttlerName}:${key}`;
    const blockKey = `${redisKey}:block`;
    const [totalHits, pttlMs, blocked, blockMs] = (await this.redis.eval(
      LUA_INCREMENT, 2, redisKey, blockKey, ttl, limit, blockDuration,
    )) as [number, number, number, number];
    // I2 parity: saniye (Math.ceil(ms/1000)) — in-memory service.js:79,82; guard header'a raw yazar.
    return {
      totalHits,
      timeToExpire: Math.ceil(pttlMs / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(blockMs / 1000),
    };
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