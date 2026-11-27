import { test } from 'node:test';
import assert from 'node:assert/strict';
import IORedis from 'ioredis';
import { RedisThrottlerStorage } from '../../src/security/infrastructure/redis-throttler.storage';

class SkipTest extends Error {}
const redisUrl = process.env.REDIS_URL;
const skip = redisUrl ? undefined : 'REDIS_URL tanımlı değil — redis throttler testleri atlandı';

async function freshStorage(): Promise<{ storage: RedisThrottlerStorage; redis: IORedis }> {
  const redis = new IORedis(redisUrl!, { maxRetriesPerRequest: 1, retryStrategy: () => null, lazyConnect: true });
  try { await redis.connect(); await redis.ping(); }
  catch { redis.disconnect(); throw new SkipTest('Redis sunucusuna ulaşılamıyor'); }
  await redis.flushdb();
  return { storage: new RedisThrottlerStorage(redis), redis };
}

test('increment: fixed-window counts hits + TTL', { skip }, async (t) => {
  let ctx: { storage: RedisThrottlerStorage; redis: IORedis } | null = null;
  try { ctx = await freshStorage(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    const r1 = await ctx.storage.increment('agent-a', 60000, 3, 60000, 'default');
    assert.equal(r1.totalHits, 1);
    // I2 parity: in-memory service saniye döner (Math.ceil(ms/1000), throttler.service.js:79);
    // guard değeri doğrudan Retry-After / X-RateLimit-Reset header'ına yazar (dönüşüm yok).
    assert.ok(r1.timeToExpire > 0 && r1.timeToExpire <= 60);
    assert.equal(r1.isBlocked, false);
    const r2 = await ctx.storage.increment('agent-a', 60000, 3, 60000, 'default');
    assert.equal(r2.totalHits, 2);
  } finally { await ctx.redis.flushdb(); ctx.redis.disconnect(); }
});

test('increment: over limit → isBlocked', { skip }, async (t) => {
  let ctx: { storage: RedisThrottlerStorage; redis: IORedis } | null = null;
  try { ctx = await freshStorage(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    for (let i = 0; i < 3; i++) await ctx.storage.increment('agent-b', 60000, 3, 60000, 'default');
    const blocked = await ctx.storage.increment('agent-b', 60000, 3, 60000, 'default');
    assert.equal(blocked.totalHits, 4);
    assert.equal(blocked.isBlocked, true);
  } finally { await ctx.redis.flushdb(); ctx.redis.disconnect(); }
});

test('increment: per-key isolation', { skip }, async (t) => {
  let ctx: { storage: RedisThrottlerStorage; redis: IORedis } | null = null;
  try { ctx = await freshStorage(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    await ctx.storage.increment('agent-c', 60000, 3, 60000, 'default');
    const other = await ctx.storage.increment('agent-d', 60000, 3, 60000, 'default');
    assert.equal(other.totalHits, 1);
  } finally { await ctx.redis.flushdb(); ctx.redis.disconnect(); }
});

// I1 parity: in-memory block BİR KEZ kurulur (throttler.service.js:138-142) ve blocked iken
// retry'lar block süresini UZATMAZ. Guard her istekte increment çağırır (throttler.guard.js:129);
// sliding block = hammering agent sonsuza dek kilitli (kalıcı lockout) → file-mode'dan sapma.
test('increment: block set-once — retry block TTL uzatmaz (non-sliding)', { skip }, async (t) => {
  let ctx: { storage: RedisThrottlerStorage; redis: IORedis } | null = null;
  try { ctx = await freshStorage(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    for (let i = 0; i < 4; i++) await ctx.storage.increment('agent-e', 60000, 3, 60000, 'default');
    const blockKey = 'throttler:default:agent-e:block';
    const ttlBefore = await ctx.redis.pttl(blockKey);
    assert.ok(ttlBefore > 0, 'over-limit hit block key kurmalı');
    // Deterministik ölçüm: kısa gerçek bekleme → TTL gözle görülür azalır; re-SET olsaydı ~60000'e dönerdi.
    await new Promise((r) => setTimeout(r, 100));
    const retry = await ctx.storage.increment('agent-e', 60000, 3, 60000, 'default');
    assert.equal(retry.isBlocked, true);
    const ttlAfter = await ctx.redis.pttl(blockKey);
    assert.ok(ttlAfter > 0 && ttlAfter < ttlBefore, `block TTL uzamamalı: before=${ttlBefore} after=${ttlAfter}`);
    assert.ok(ttlAfter < 60000, 'block TTL tam blockDuration\'a geri dönmemeli (set-once)');
  } finally { await ctx.redis.flushdb(); ctx.redis.disconnect(); }
});

// I1 parity: blocked iken hits DONAR (throttler.service.js:135-137 `if (!isBlocked) fireHitCount`;
// :145 stored totalHits döner). Redis modunda INCR çalışmaya devam ederse totalHits şişer → sapma.
test('increment: blocked iken totalHits donar (freeze-hits)', { skip }, async (t) => {
  let ctx: { storage: RedisThrottlerStorage; redis: IORedis } | null = null;
  try { ctx = await freshStorage(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    let blocked = await ctx.storage.increment('agent-f', 60000, 3, 60000, 'default');
    for (let i = 0; i < 3; i++) blocked = await ctx.storage.increment('agent-f', 60000, 3, 60000, 'default');
    assert.equal(blocked.isBlocked, true);
    assert.equal(blocked.totalHits, 4, 'block anındaki sayı donmalı (limit+1)');
    for (let i = 0; i < 3; i++) {
      const r = await ctx.storage.increment('agent-f', 60000, 3, 60000, 'default');
      assert.equal(r.isBlocked, true);
      assert.equal(r.totalHits, 4, 'blocked retry totalHits artırmamalı');
    }
    assert.equal(await ctx.redis.get('throttler:default:agent-f'), '4', 'hit key INCR ile şişmemeli');
  } finally { await ctx.redis.flushdb(); ctx.redis.disconnect(); }
});

// I2 parity: timeToExpire / timeToBlockExpire SANİYE (in-memory Math.ceil(ms/1000),
// throttler.service.js:79,82). Guard raw değeri header'a yazar → ms dönmek Retry-After: 60000 üretir.
test('increment: timeToExpire/timeToBlockExpire saniye biriminde (ms değil)', { skip }, async (t) => {
  let ctx: { storage: RedisThrottlerStorage; redis: IORedis } | null = null;
  try { ctx = await freshStorage(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    const r1 = await ctx.storage.increment('agent-g', 60000, 3, 60000, 'default');
    assert.ok(r1.timeToExpire > 0 && r1.timeToExpire <= 60, `timeToExpire saniye olmalı: ${r1.timeToExpire}`);
    let blocked = r1;
    for (let i = 0; i < 3; i++) blocked = await ctx.storage.increment('agent-g', 60000, 3, 60000, 'default');
    assert.equal(blocked.isBlocked, true);
    assert.ok(blocked.timeToBlockExpire > 0 && blocked.timeToBlockExpire <= 60, `timeToBlockExpire saniye olmalı: ${blocked.timeToBlockExpire}`);
    assert.ok(blocked.timeToExpire > 0 && blocked.timeToExpire <= 60, `blocked timeToExpire saniye olmalı: ${blocked.timeToExpire}`);
  } finally { await ctx.redis.flushdb(); ctx.redis.disconnect(); }
});

// Block-PTTL branch: hit window expire olmuş ama block hâlâ aktif → istek blocked durumunu
// block key'den okur (hits donuk, INCR yok, hit key yeniden oluşmaz). In-memory pruneExpiredHits
// live-hit sayısını 0'a indirir ama isBlocked blockExpiresAt'e kadar true kalır (service.js:123,132-137).
test('increment: window expire + block aktif → block key\'den blocked okunur', { skip }, async (t) => {
  let ctx: { storage: RedisThrottlerStorage; redis: IORedis } | null = null;
  try { ctx = await freshStorage(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    for (let i = 0; i < 4; i++) await ctx.storage.increment('agent-h', 60000, 3, 60000, 'default');
    const hitKey = 'throttler:default:agent-h';
    // Deterministik window-expiry simülasyonu: hit key'i test connection'ı ile sil (block key kalır).
    await ctx.redis.del(hitKey);
    const r = await ctx.storage.increment('agent-h', 60000, 3, 60000, 'default');
    assert.equal(r.isBlocked, true, 'block aktifken istek blocked okunmalı');
    assert.equal(r.totalHits, 0, 'hit key yokken donuk sayı 0 (GET, INCR değil)');
    assert.ok(r.timeToBlockExpire > 0 && r.timeToBlockExpire <= 60, 'kalan block TTL saniye olarak dönmeli');
    assert.equal(await ctx.redis.exists(hitKey), 0, 'blocked iken INCR hit key yeniden kurmamalı');
  } finally { await ctx.redis.flushdb(); ctx.redis.disconnect(); }
});

// T3-a: atomic set-once (NX). Lua'da SET script içinde çalışır — block kurulu iken ikinci
// over-limit çağrısı 'SET ... NX' ile TTL'i RESET EDEMEZ (non-sliding). Seam-bağımsız ölçüm:
// block kurulduktan sonra 100ms gerçek bekleme → TTL gözle görülür azalır; reset olsaydı
// ~60000'e dönerdi. Atomiklik (eşzamanlı INCR kaybı yok) ayrı "20 concurrent" testinde.
test('increment: over-limit block set-once (NX, block TTL reset edilmez)', { skip }, async (t) => {
  let ctx: { storage: RedisThrottlerStorage; redis: IORedis } | null = null;
  try { ctx = await freshStorage(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    // limit=3 → block 4. çağrıda kurulur (total > limit).
    for (let i = 0; i < 4; i++) await ctx.storage.increment('agent-nx', 60000, 3, 60000, 'default');
    const blockKey = 'throttler:default:agent-nx:block';
    const ttlBefore = await ctx.redis.pttl(blockKey);
    assert.ok(ttlBefore > 0, 'over-limit hit block key kurmalı');
    await new Promise((r) => setTimeout(r, 100));
    const retry = await ctx.storage.increment('agent-nx', 60000, 3, 60000, 'default');
    assert.equal(retry.isBlocked, true);
    const ttlAfter = await ctx.redis.pttl(blockKey);
    assert.ok(ttlAfter > 0 && ttlAfter < ttlBefore, `block TTL resetlenmemeli (NX set-once): before=${ttlBefore} after=${ttlAfter}`);
    assert.ok(ttlAfter < 60000, `block TTL tam blockDuration\u2019a dönmemeli (set-once): ${ttlAfter}`);
  } finally { await ctx.redis.flushdb(); ctx.redis.disconnect(); }
});

// T3-d: orphan-key heal. Crash INCR ile PEXPIRE arasında kaldıysa hit key TTL'siz orphan (pttl -1)
// olur → sonraki increment unblocked INCR path'inde pexpire ile heal eder (window bounded kalır).
test('increment: TTL-less orphan hit key → pexpire ile heal (crash between INCR/PEXPIRE)', { skip }, async (t) => {
  let ctx: { storage: RedisThrottlerStorage; redis: IORedis } | null = null;
  try { ctx = await freshStorage(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    const hitKey = 'throttler:default:agent-orphan';
    await ctx.redis.set(hitKey, '2'); // TTL yok — crash simülasyonu (INCR oldu, PEXPIRE olmadı)
    assert.equal(await ctx.redis.pttl(hitKey), -1);
    const r = await ctx.storage.increment('agent-orphan', 60000, 5, 60000, 'default');
    assert.equal(r.totalHits, 3);
    assert.equal(r.isBlocked, false);
    const healed = await ctx.redis.pttl(hitKey);
    assert.ok(healed > 0 && healed <= 60000, `orphan key TTL kazanmalı (heal): ${healed}`);
    assert.ok(r.timeToExpire > 0 && r.timeToExpire <= 60, 'timeToExpire saniye parity korunmalı');
  } finally { await ctx.redis.flushdb(); ctx.redis.disconnect(); }
});

// H1 atomiklik kanıtı: 20 eşzamanlı first-hit INCR kaybı olmadan sayılır (tek script = tek atomik adım),
// window tek TTL taşır. Burst sonrası tek increment tam 21 döner.
test('increment: concurrent first-hit burst → atomik sayım (kayıp INCR yok, tek TTL)', { skip }, async (t) => {
  let ctx: { storage: RedisThrottlerStorage; redis: IORedis } | null = null;
  try { ctx = await freshStorage(); } catch (e) { if (e instanceof SkipTest) { t.skip(e.message); return; } throw e; }
  try {
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      ctx.storage.increment('agent-burst', 60000, 100, 60000, 'default')));
    assert.ok(results.every((r) => r.isBlocked === false), 'limit 100 → burst blocked olmamalı');
    const after = await ctx.storage.increment('agent-burst', 60000, 100, 60000, 'default');
    assert.equal(after.totalHits, 21, '20 concurrent + 1 = tam 21 (kayıp INCR yok)');
    const pttl = await ctx.redis.pttl('throttler:default:agent-burst');
    assert.ok(pttl > 0 && pttl <= 60000, `tek window TTL: ${pttl}`);
  } finally { await ctx.redis.flushdb(); ctx.redis.disconnect(); }
});
