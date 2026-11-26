# F — Hardening Backlog (Group E borç kapanışı)

- **Tarih:** 2026-11-24
- **Durum:** Tasarım kararları onaylandı (boot reconcile · NX/heal koru · readiness ertele) → spec review bekliyor
- **Faz:** P2.4 Faz-2 hardening backlog → Group D (D1+D2 COMPLETE) → Group E (COMPLETE) → **Group F** (hardening)
- **Yazar:** Yusuf KEF <kefyusuf@gmail.com>
- **Sınıflandırma:** architectural (brainstorming HARD-GATE: onay olmadan implementasyon yok)
- **İlişkili:** E durable engine (5 commit, COMPLETE) · D1 security perimeter (COMPLETE) · D2 resource-caps (COMPLETE)

## 1. Bağlam

Group E (BullMQ+Redis opt-in durable engine) final-review'ından kalan küçük borç kalemleri. Bu faz
architectural yeni subsystem DEĞİL; mevcut akışlarda davranış-koruyan hardening + bir recovery boşluğunun
kapanması + doc hizalama. Koda karşı doğrulama (2026-11-24) kapsamı daralttı:

**Zaten kapalı (doğrulandı, bu fazda iş yok):**
- **Spec §11 errata kodda uygulanmış:** `bullmq-dispatcher.ts:18-21` dispatch rejection'ı log + RETHROW →
  POST **500 fail-closed** (R11 ruling). Kalan iş yalnız spec dokümanını koda hizalamak (F4).
- **mcp/auth.mjs → D1 parity kapalı:** D1'de `agents.json` köke promote edildi; `mcp/auth.mjs` `ROOT`
  üzerinden okuyor (`store.mjs`), `getAgent`/`listAgents`/`HUMAN`/`AGENT_ID` davranışı değişmedi.
- **MCP HTTP hardening kapalı:** `mcp/http-server.mjs:46-47` URL parse try içinde (bozuk target → 400,
  crash yok); her iki MCP dosyasında 1MB body-limit; eksik session 400, yanlış path 404.

**Gerçekten açık (bu fazın işi):**
- `main.ts` `enableShutdownHooks` YOK → SIGTERM/SIGINT'de `app.close()` tetiklenmez → `OnModuleDestroy`
  (queue/worker teardown) çalışmaz, socket handle leak.
- **Orphan queued mirror:** `enqueue-build.ts:25-26` queued mirror'ı dispatch-ÖNCE kaydeder. Dispatch fail
  (Redis down) → POST 500 ama mirror repo'da `queued` kalır; BullMQ'da karşılığı yok. Boot recover yalnız
  `running`'yi temizler (`bullmq-build-worker.ts:43`); `pruneTerminal` yalnız terminal prune eder → orphan
  queued sonsuza dek kalır + queue-full sayacını (`queued >= limit`) şişirip yeni build'leri bloke eder.
- **Shared-infra relocation:** `redis-connection.ts` `builds/infrastructure/bullmq/` altında ama
  `security.module.ts:10` cross-module import ediyor (security → builds infra bağımlılık kokusu).
- **Throttler atomicity:** INCR+koşullu PEXPIRE+NX block (`redis-throttler.storage.ts`); d142f28 NX/heal
  race'i mitigate etti, INCR→PEXPIRE arası atomik değil (heal penceresi). Karar: koru (aşağıda).

## 2. Hedefler / hedef-dışı

**Hedefler**
- Graceful shutdown: sinyal → `app.close()` → mevcut teardown zinciri (handle leak yok).
- Orphan queued mirror boot'ta reconcile → `failed 'dispatch-lost'` (queue-full şişmesi + hayalet queued yok).
- `redis-connection.ts` nötr shared konuma taşı (security → builds cross-module bağımlılık kalksın), API değişmez.
- E-spec §11'i koda hizala (dispatch fail → 500).
- Kararları kayda geçir: throttler NX/heal (mitigated, accepted), readiness Faz-3, auth parity kapalı.
- Mevcut regresyon bracket'ini yeşil tut (file mode Redis'siz + bullmq/throttler skip-if-unavailable).

**Hedef-dışı (bu fazda yok)**
- Readiness promise / health endpoint — Faz-3 EventStore recovery tasarımıyla birlikte (tüketici yok, YAGNI).
- Lua atomik throttler increment — NX/heal yeterli; Faz-3'te yeniden değerlendir.
- Dispatch-fail compensating write — boot reconcile seçildi (crash boşluğunu da kapatır); ikinci path yok.
- Multi-instance concurrency N, gerçek token/OAuth, distributed registry — Faz-2+/Faz-3.
- EventStore / full recovery — Faz-3.
- sites `src/` + MCP + admin dokunuşu — frozen.

## 3. Onaylanan kararlar

| # | Karar | Seçim | Gerekçe |
|---|---|---|---|
| 1 | Orphan mirror reconcile | **Boot reconcile** (`onModuleInit`, `queue.getJob` yoksa `markDispatchLost`) | save-ile-dispatch arası crash boşluğunu da kapatır; compensating write tek başına yetmez; boot-safe best-effort |
| 2 | Queued→failed geçişi | **Yeni domain metodu `markDispatchLost`** | `markFailed` yalnız `running`'den çağrılır (build-job.ts:100); queued→markRunning→markFailed sahte state uydurur → reddedildi; dar amaçlı geçiş |
| 3 | Throttler atomicity | **NX/heal koru** (Lua YOK) | heal penceresi nadir, worst-case bir istek fazla geçer (rate-limit, güvenlik değil); Lua karmaşıklık+test yükü; YAGNI, Faz-3'te yeniden |
| 4 | Readiness | **Ertele → Faz-3** | tüketen orchestrator/health-check yok; boot-safe zaten log+degrade; EventStore recovery ile birlikte anlamlı |
| 5 | Relocation hedefi | **`backend/src/infrastructure/redis-connection.ts`** | nötr infra katmanı; `src/`'de infrastructure/shared yok (çakışma yok); security+builds eşit mesafede |
| 6 | Errata | **Doc-only hizalama** | kod zaten R11 ruling (500 fail-closed); spec §11 güncellenir, kod değişmez |

## 4. Bileşenler / dosya dokunuşları

### F1 — enableShutdownHooks
- **MODIFIED `backend/src/main.ts`:** `app.enableShutdownHooks()` (`app.listen`'dan önce). NestJS
  SIGTERM/SIGINT/SIGHUP vb. → `app.close()` → `OnModuleDestroy` (BullMqDispatcher.closeBuildQueue +
  BullMqBuildWorker.worker.close/disconnect). Mevcut teardown zinciri değişmez, yalnız sinyal wiring eklenir.
- **Test:** process-level graceful shutdown (aşağıda §6).

### F2 — Orphan-mirror boot reconcile + domain geçişi
- **MODIFIED `backend/src/builds/domain/build-job.ts`:** `markDispatchLost(now: string): BuildJob` —
  yalnız `queued`'den çağrılır (değilse `BuildValidationError`); `status:'failed'`, `finishedAt:now`,
  `error:'dispatch-lost'`. `markFailed` (running-only) değişmez.
- **MODIFIED `backend/src/builds/infrastructure/bullmq/bullmq-build-worker.ts`:**
  - `@Inject(BUILD_QUEUE) queue: Queue` constructor'a eklenir (token bullmq engineProviders'da mevcut).
  - `onModuleInit` recover bloğunda (running→interrupted sonrası): her `queued` mirror için
    `await this.queue.getJob(job.id)`; sonuç null/undefined ise `repo.save(job.markDispatchLost(now))`.
  - Best-effort try/catch: Redis down → `boundedGetJob` 2s timeout reject → log warn + skip (boot brick OLMAZ).
    **Not:** BullMQ 5.81.6 `getJob` unreachable Redis'te throw ETMEZ, connection-ready await ile hang eder →
    naive await boot'u brick eder; bu yüzden 2s unref'd timeout race (katılımcı promise'ler handle'lı).
  - Re-run YOK (parity no-retry); terminal idempotent.
- **Edge not:** queued mirror + null `getJob` normalde orphan (never dispatched). Başarıyla dispatch edilmiş
  job'ın mirror'ı processor tarafından running→terminal yapılır; `queued` kalmaz → false-positive yok.
  `removeOnComplete`/`removeOnFail` retention'ı terminal job'ları Redis'ten siler ama mirror zaten terminal.
- **Test:** `build-job.spec.ts` (markDispatchLost queued→failed; running/terminal'den throw) +
  `bullmq-builds.spec.ts` reconcile senaryoları (§6).

### F3 — Shared-infra relocation (behavior-preserving)
- **MOVED `backend/src/builds/infrastructure/bullmq/redis-connection.ts` → `backend/src/infrastructure/redis-connection.ts`**
  (`git mv` — commit onayı ayrı). Export API değişmez: `REDIS_URL` Symbol, `defaultRedisUrl()`, `createRedisConnection(url)`.
- **MODIFIED importlar (4):** `security/security.module.ts:10`, `builds/builds.module.ts:10`,
  `builds/infrastructure/bullmq/build-queue.ts:3`, `builds/infrastructure/bullmq/bullmq-build-worker.ts:8`.
- **Test:** mevcut bracket davranış-koruyan kanıt (file + bullmq + throttler semantiği değişmez).

### F4 — Spec §11 errata (doc-only)
- **MODIFIED `docs/superpowers/specs/2026-11-23-e-bullmq-redis-design.md` §11 satır 254:**
  "Redis unreachable (dispatch) → ... POST 201 (queued, degrade)" → "POST **500 fail-closed** (R11 ruling;
  queued mirror boot reconcile ile temizlenir — Group F)". Kod değişikliği yok.

## 5. Hata yönetimi

| Durum | Davranış | Sonuç |
|---|---|---|
| SIGTERM/SIGINT | `enableShutdownHooks` → `app.close()` → OnModuleDestroy | queue/worker disconnect, handle leak yok, clean exit |
| Dispatch fail (Redis down) | dispatcher log + rethrow (mevcut R11) | POST 500; queued mirror orphan kalır → boot reconcile temizler |
| Boot: queued mirror + BullMQ job yok | `markDispatchLost` | failed 'dispatch-lost'; queue-full sayacı düzelir |
| Boot: queued mirror + BullMQ job var | dokunma | queued korunur (worker işler) |
| Boot reconcile Redis down | `boundedGetJob` 2s timeout reject → catch → log warn + skip | boot-safe, app boot eder (sites API çalışır) |
| `markDispatchLost` queued-dışı state | `BuildValidationError` | domain invariant korunur |

## 6. Test stratejisi (TDD)

- **Bracket (değişmez, yeşil kalır):** file mode backend testleri (Redis'siz) + bullmq/throttler
  (Redis varsa pass, yoksa skip-if-unavailable) + Postgres skip-if-unavailable + root 30 / smoke 23 /
  smoke:http 24 / price-420 TR+EN invariant. `--test-concurrency=1` (serial, Redis paylaşımlı state yarışı yok).
- **F2 domain (YENİ, `build-job.spec.ts`):** `markDispatchLost` queued→failed (error 'dispatch-lost',
  finishedAt set); running/succeeded/failed'den çağrılırsa `BuildValidationError`. Red→green.
- **F2 reconcile (YENİ, `bullmq-builds.spec.ts`, skip-if-unavailable Redis):**
  - orphan: queued mirror save + dispatch ETME → boot (worker onModuleInit) → failed 'dispatch-lost'.
  - dispatched queued mirror (queue.add yapılmış) → boot → queued korunur (false-positive yok).
  - Redis-down reconcile → boot brick olmaz, skip (boot-safe).
  - queue-full: orphan reconcile sonrası queued sayacı düşer → yeni POST kabul.
- **F1 shutdown (YENİ, integration):** backend process spawn (file mode, Redis'siz boot) → SIGTERM →
  timeout guard ile clean exit (code 0) + handle kalmadığı doğrulanır. Mevcut teardown testleri
  `app.close()` path'ini zaten örtüyor; bu test sinyal wiring'ini ekler.
- **F3 relocation:** yeni test yok; mevcut bracket davranış-koruyan kanıt (import path değişikliği, API aynı).
- **F4 errata:** doc, test yok.

## 7. Tradeoff tablosu

| Karar | Seçilen | Alternatif | Tradeoff |
|---|---|---|---|
| Reconcile yeri | boot reconcile | dispatch-fail compensating write / ikisi | crash boşluğu kapanır vs tek path basitlik; boot best-effort Redis-down skip |
| Queued→failed | yeni `markDispatchLost` | markFailed gevşet / markRunning köprüsü | dar amaçlı invariant vs sahte state / geniş risk |
| Throttler | NX/heal koru | Lua atomik | YAGNI basitlik vs tam atomiklik (nadir heal penceresi kabul) |
| Readiness | Faz-3 ertele | minimal boot promise / healthz | tüketici yokken yüzey ekleme vs şimdi çözüm |
| Relocation | nötr `src/infrastructure/` | builds altında bırak / shared/ | cross-module koku kalkar vs dosya churn (4 import) |

## 8. Kapsam-dışı kalan borç (roadmap seam'leri)

- **Faz-3 EventStore:** event-sourced tam recovery + readiness promise + throttler atomicity yeniden değerlendirme. *(readiness + Lua atomicity: 2026-11-25 hardening fazında tamamlandı — bkz. 2026-11-25-hardening-readiness-lua-design.md)*
- **Concurrency-N seam:** parity concurrency 1 → N worker (multi-instance yatay ölçek).
- **Faz-2+ auth:** gerçek token/OAuth + distributed registry (D1 seam'leri).
- **Item 8 Pazaryeri:** Trendyol/Hepsiburada — gerçek API anahtarı gerektirir, external blocked (goal dışı).