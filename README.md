# AstroPress

[![Lisans: MIT](https://img.shields.io/badge/Lisans-MIT-yellow.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)
![Astro](https://img.shields.io/badge/Astro-5-FF5D01?logo=astro&logoColor=white)

Astro tabanlı **agent-native CMS**: gerçek bir Astro statik site iskeleti + agent'ların siteyi
**güvenle** yönetmesini sağlayan MCP (Model Context Protocol) köprüsü. Guardrail (yetki sınırı),
insan onayı, sunucu tarafı RBAC ve denetim kaydı (audit log) çekirdeğin içindedir — sonradan eklenen
bir eklenti değil. Yanında, ürün hissini doğrulamak için tek dosyalık konsept prototipi (`prototype/`).

> **Durum: çalışan, test edilmiş v1.** İçerik Markdown + content collections olarak durur, `astro build`
> gerçek statik çıktı üretir (TR + `/en/`), MCP sunucusu ve HTTP admin arayüzü aynı guardrail'lerle gerçek
> CRUD + onay akışı işletir. 30 birim/entegrasyon testi + 23 uçtan uca smoke kontrolü + CI. MIT lisanslı.
> Pazaryeri senkronu henüz yok (gerçek API kimliği gerektirir — yol haritasında).

## Neden bu konsept?

- Salt WordPress klonu kalabalık bir pazarda (WP, Elementor/Astra, Webflow, Framer, Wix, Lovable/v0/Bolt)
  farklılaşmaz; talep sıfıra yakındır.
- Fark yaratan katman: **agent'ların siteyi güvenle yönetebilmesi** — içerik, ürün, fiyat, çeviri ve
  görsel işlerinin MCP/skill arayüzüyle operasyonu, üstünde guardrail (yetki sınırı), insan onayı ve
  denetim kaydı (audit log).
- TR e-ticaret bağlaçları (Trendyol / Hepsiburada senkronu) yerel pazarda first-mover avantajı sağlar.

## Mimari

```
  MCP istemcisi (Qoder / Claude / kendi agent'ınız)      Tarayıcı (admin)
            │                                                  │
            ▼                                                  ▼
  mcp/server.mjs (12 tool, stdio)                    mcp/http.mjs (/api + /site/)
            └──────────────────────┬───────────────────────────┘
                                   ▼
              mcp/ops.mjs — TEK guardrail + RBAC kaynağı
              create → draft · yayın = insan onayı · yetki matrisi · audit
                                   ▼
              mcp/store.mjs — Markdown içerik + JSON state
              src/content/*.md · .astropress/{tasks,audit}.json
                                   ▼
              astro build → dist/ (yalnız published, dile göre ayrık)
              TR rotaları (/) + EN rotaları (/en/)
```

MCP ve HTTP **aynı `ops.mjs`'yi** çağırır; guardrail tek kaynakta, iki arayüzde de aynı şekilde zorunlu.

## Hızlı başlangıç

```bash
npm install          # astro, @modelcontextprotocol/sdk, gray-matter, zod
npm run admin        # http://127.0.0.1:4322 — yönetim arayüzü + /site/ önizleme
npm run build        # astro build → dist/ (yalnız published içerik)
npm test             # birim + entegrasyon testleri (30 kontrol)
npm run smoke        # uçtan uca guardrail + RBAC + i18n (23 kontrol, gerçek build'lerle)
```

Örnek site: **Köz Kahve** — üçüncü nesil kahve mağazası (blog + ürünler + sayfalar, TR/EN).

| Script | Ne yapar |
|---|---|
| `npm run dev` | Astro geliştirme sunucusu (`http://localhost:4321`) |
| `npm run build` | `astro build` → `dist/` (yalnız published) |
| `npm run preview` | `dist/` üzerinden statik önizleme |
| `npm run mcp` | MCP stdio sunucusu (agent köprüsü) |
| `npm run mcp:http` | MCP Streamable HTTP sunucusu (`127.0.0.1:4323`, P2.3) |
| `npm run admin` | Yönetim arayüzü + `/api` + `/site/` (`127.0.0.1:4322`) |
| `npm test` | `node:test` birim + entegrasyon (30 kontrol, izole) |
| `npm run smoke` | Uçtan uca guardrail + RBAC + i18n (23 kontrol, gerçek build) |
| `npm run smoke:http` | HTTP transport uçtan uca smoke (24 kontrol, gerçek build) |
| `npm run ci` | `build && test && smoke && smoke:http && backend:ci` — CI'ın yerel eşdeğeri |

## Docker ile geliştirme

Tek imaj, altı servis (compose): `web` (astro dev, 4321), `admin` (http köprü + UI, 4322), `backend` (NestJS HTTP API, 3000), `mcp-http` (MCP Streamable HTTP, 4323), `postgres` (dev DB, 5432), `redis` (`redis:7-alpine`, 6379 — container `compose up` ile **her zaman** başlar; opt-in olan builds **engine**'i (`ASTROPRESS_BUILDS=bullmq`) ve throttler Redis storage, engine default `file`).

```bash
docker compose up --build                  # web + admin + backend + mcp-http + postgres + redis
docker compose run --rm backend npm test   # backend testleri container içinde
docker compose down
```

- **Config tek kaynak:** `sites.json` web/admin'e **read-only** mount edilir; tek yazar `backend`. Config sahipliği container seviyesinde de korunur.
- **State ayrı:** `.astropress/` (audit/tasks) admin'e read-write; config ile karışmaz.
- `ASTROPRESS_SITE` ile site seçilir (boşsa ilk site); `HOST=0.0.0.0` admin'i container dışına açar.
- `backend` servisi NestJS HTTP API'sini `3000` portunda sunar (`PORT` ile değişir); `sites.json`'a tek yazar odur.
- **Bağımlılık değişince** `docker compose up --build -V`: anonymous `node_modules` volume'leri imajdan yenilenir; yoksa eski volume yeni paketleri maskeler (ör. `platform-express` → "No driver (HTTP)" hatası).

## MCP HTTP Transport (Streamable HTTP, P2.3)

MCP sunucusu stdio'ya ek olarak HTTP üzerinden de açılır (`mcp/http-server.mjs`). stdio (`npm run mcp`)
ve admin REST (`npm run admin`, :4322) **değişmeden korunur**; üçü de `mcp/ops.mjs` (guardrail+RBAC) paylaşır,
stdio + HTTP MCP ayrıca `createMcpServer(agent)` factory'sini kullanır.

```bash
npm run mcp:http     # http://127.0.0.1:4323/mcp  (MCP_PORT, HOST override)
npm run smoke:http   # HTTP üzerinden guardrail + RBAC + i18n smoke
```

- **Transport:** Streamable HTTP (güncel MCP spec), tek `/mcp` endpoint (POST/GET/DELETE), stateful session (`Mcp-Session-Id`).
- **Kimlik:** initialize'da `X-Astropress-Agent: <id>` header → agent registry (kök `agents.json`, MCP+backend paylaşır), varsayılan `content-studio`. **auto-HUMAN yok** → guardrail korunur (agent self-publish yapamaz).
- **Güvenlik:** loopback bind + Host allowlist (`localhost`/`127.0.0.1`/`[::1]`, değilse 403). Container'da `HOST=0.0.0.0` + `MCP_ALLOW_ANY_HOST=1`. Production auth (token/OAuth) sonraki faz.
- **Fazlar:** P2.3 stateful in-memory + header kimlik (local dev) → Faz 2 token/OAuth → Faz 3 EventStore/resumability + rate-limit → Faz 4 backend yakınsaması.

## Backend HTTP API (NestJS)

`backend/` ayrı bir workspace: clean architecture (domain ← application use-case/ports ← infrastructure
adapter). Slice'lar: çoklu site registry + site-başı locale config (P1/P2.1) ve **build worker** (P2.4).
Controller → use-case → domain; domain hataları exception filter'lar ile HTTP kodlarına çevrilir (doğrulama tek yerde: domain).

```bash
npm --prefix backend run build && npm --prefix backend start   # http://localhost:3000
npm --prefix backend test                                      # 177 kontrol (74 sites + 64 builds + 39 security; DATABASE_URL unset iken 11 Postgres + REDIS_URL unset iken 9 bullmq + 9 throttler skip)
```

| Endpoint | Ne yapar | Başarı | Hata |
|---|---|---|---|
| `GET /sites` | Tüm siteleri listeler | 200 | — |
| `POST /sites` | Yeni site kaydeder (`{id,name,locales,defaultLocale}`) | 201 | 400 geçersiz · 409 zaten var |
| `GET /sites/:id` | Tek site getirir | 200 | 404 yok |
| `PUT /sites/:id/locales` | Locale + ana dili günceller (`{locales,defaultLocale}`) | 200 | 400 geçersiz · 404 yok |

**Build worker (P2.4)** — async job kuyruğu (queue) + tek serial worker. `POST /builds` job'ı kuyruğa alır,
worker `astro build`'i background'da çalıştırır (tek instance, concurrency 1 → `dist/` yarışı yok). Job state
`.astropress/builds.json`'da kalıcı (runtime state); restart'ta yarım kalan `running` job'lar `failed (interrupted)` recover edilir.

| Endpoint | Ne yapar | Başarı | Hata |
|---|---|---|---|
| `POST /builds` | Build job'ı kuyruğa alır (queued) | 201 | — |
| `GET /builds/:id` | Job durumunu getirir (queued/running/succeeded/failed) | 200 | 404 yok |
| `GET /builds` | Tüm job'ları listeler (yeniden eskiye) | 200 | — |

### Backend Security Perimeter (D1)

MCP köprüsünün güvenlik modeli NestJS backend'e port edildi (merkezi `backend/src/security/`, sites/builds slice'larına dokunmadan).
İstek pipeline'ı: **bind** (`127.0.0.1`, `HOST` env) → **body-limit** (1MB JSON → 413) → **HostMiddleware** (allowlist → 403) →
**IdentityMiddleware** (`X-Astropress-Agent` → `req.agent`, unknown → 401) → **AgentThrottlerGuard** (per-agent, mutations-only → 429) →
**PermissionGuard** (route→perm policy, fail-closed → 403) → controller.

| Route | Method | Yetki |
|---|---|---|
| `/sites`, `/sites/:id`, `/builds`, `/builds/:id` | GET | public (read) |
| `/sites` | POST | `create` |
| `/sites/:id/locales` | PUT | `edit` |
| `/builds` | POST | `edit` (build = operasyonel mutation; reader ✗ — MCP divergence) |

- **Kimlik:** header-claim (loopback-trusted, token yok). Eksik header → default `content-studio` (`publish:false` → self-publish yok). Unknown → 401.
- **Registry:** kök `agents.json` tek-kaynak (sites.json emsali); MCP `auth.mjs` (`ROOT`) + backend `AgentRegistry` birlikte okur.
- **Rate-limit:** `@nestjs/throttler` v6, per-agent tracker (`req.agent.id`), GET exempt (poll-friendly), default 60 mutation/dk/agent/route. Storage: default in-memory; `REDIS_URL` set → Redis storage (multi-instance-ready rate-limit). Guard/config değişmez (D1 seam swap).
- **Fail-closed:** policy map'te olmayan route → 403 (yeni endpoint açıkça eklenmeli). Denied → 403 + `Logger.warn` (full audit store MCP concern).
- **Env:** `HOST` (bind, default `127.0.0.1`), `ASTROPRESS_ALLOW_ANY_HOST=1` (Host kontrol devre-dışı, container), `ASTROPRESS_RATE_LIMIT` (limit override), `ASTROPRESS_AGENTS_FILE` (registry test seam).

| Durum | Kod |
|---|---|
| Yanlış Host | 403 |
| Body >1MB | 413 |
| Unknown agent | 401 |
| RBAC reddi / unmapped route | 403 |
| Rate-limit aşımı (mutation) | 429 |

### Depolama (storage) — `ASTROPRESS_STORAGE`

| Mod | Yetkili kaynak (source of truth) | Kalıcılık | Kullanım |
|---|---|---|---|
| `file` (varsayılan) | committed `sites.json` | git-native | üretim varsayılanı; tek yazar backend |
| `memory` | RAM | geçici (process ömrü) | test / hızlı development |
| `sqlite` | `.astropress/sites.db` | runtime state (gitignore'lu) | ölçek/çok-yazar gerektiğinde opt-in |
| `postgres` | PostgreSQL (`DATABASE_URL`) | runtime state (sunucu) | ölçek/çok-yazar; Docker dev servisi ile |

**Model A — tek kaynak:** root Astro build **her zaman** `sites.json`'ı okur (F0 temeli; canlı servise bağımlılık yok).
`sqlite` modunda DB runtime kaynağıdır; build'den önce `export` ile `sites.json`'a geri yazılır. `seed`/`export`
köprüsü veriyi json ↔ DB arasında taşır (idempotent upsert):

```bash
ASTROPRESS_STORAGE=sqlite npm --prefix backend run seed     # sites.json → DB (önce build gerekir)
ASTROPRESS_STORAGE=sqlite npm --prefix backend run export   # DB → sites.json (root build bunu okur)
ASTROPRESS_STORAGE=postgres DATABASE_URL=postgres://astropress:astropress@localhost:5432/astropress npm --prefix backend run seed
ASTROPRESS_STORAGE=postgres DATABASE_URL=postgres://astropress:astropress@localhost:5432/astropress npm --prefix backend run export
```

- Env override: `ASTROPRESS_SITES_FILE` (json yolu), `ASTROPRESS_DB_FILE` (db yolu), `DATABASE_URL` (postgres bağlantı dizesi) — test izolasyonu; `PORT` portu belirler.
- `sqlite` adapter'ı **better-sqlite3 ^12** (prebuilt binary; node 20/22/24), `postgres` adapter'ı **pg ^8** (Pool, node 20/22/24).
  Dört adapter (`memory`/`file`/`sqlite`/`postgres`) aynı **paylaşımlı contract** testinden geçer → port soyutlaması kanıtlı.
  Postgres testleri `DATABASE_URL` unset iken skip olur (bracket Docker'sız yeşil); Docker dev servisi: `docker compose up -d postgres`.
- Bu slice yerel geliştirme içindir; **D1 security perimeter** (loopback bind + Host guard + header kimlik + RBAC + per-agent rate-limit + 1MB body) MCP modelini backend'e taşır (aşağıya bkz.). Gerçek token/OAuth Faz-2+.

### Builds engine (opt-in durable)

`ASTROPRESS_BUILDS=file` (default, in-process worker) | `bullmq` (Redis durable queue).
`ASTROPRESS_STORAGE`'tan orthogonal — builds state her iki mode'da file read-model.

**Concurrency-N:** `ASTROPRESS_BUILD_CONCURRENCY` (default `1` → serial parity) eşzamanlı build sayısını
belirler; her iki engine'de geçerli (`file` N-pool + claimed Set, `bullmq` Worker `concurrency:N` Redis
native job-lock). N>1 yarışmaz çünkü her build **per-build izole root**'ta koşar: `BuildWorkspace`
`src/public/node_modules` junction/symlink + config copy ile izole root kurar, `dist/` ve `.astro/` cache
build'e özel gerçek dizinlerdir (astro `--root` + `--outDir`). İş bitince workspace cleanup (ephemeral);
boot'ta `cleanupAll` leftover'ları siler. Farm dizini: `ASTROPRESS_STATE/build-workspaces` (yoksa repo
`.astropress/build-workspaces`). Real `node_modules`/`src` korunur (rmSync junction follow etmez).

- `file`: queued job'lar gitignore'lu working-tree dosyası `.astropress/builds.json`'da (repo read-model;
  git-committed durability DEĞİL — process restart'ta dosya durur, kick ile resume (I2)); N-pool, no-retry.
- `bullmq`: `REDIS_URL` (default `redis://localhost:6379`) gerekir; queued job'lar Redis'te survive
  (durability), BullMQ Worker `concurrency:N` / attempts 1 (parity), stalled→failed interrupted.
  HTTP contract her iki mode'da identical (POST 201 · GET 200/404 · list DESC · 429 queue-full).
- **Redis down (opt-in tradeoff):** `ASTROPRESS_BUILDS=bullmq` + Redis down iken app yine boot eder
  (boot-safe connection), GET/read çalışır (file read-model); mutation'lar fail-closed döner:
  build **dispatch** 500'ü ANINDA (`enableOfflineQueue:false` → `queue.add` hemen reject),
  yalnız **throttler** sınırlı bekler (bounded `waitReady` ≤2s) sonra 500 — hang yok, fail-open yok.
  Dispatch-rejection 500 bilinçli (intentional fail-closed): işlenmeyecek queued mirror 201 success
  olarak bildirilmez — dürüst failure sinyali.
  `file` mode Redis gerektirmez; bullmq'nin opt-in olma sebebi budur.

Throttler storage: `REDIS_URL` set → Redis (multi-instance-ready rate-limit); absent → in-memory.
Guard/config değişmez (D1 seam). Docker: `redis:7-alpine` container'ı `compose up` ile her zaman başlar;
opt-in olan builds engine'i (`ASTROPRESS_BUILDS=bullmq`).

## Dizin yapısı

```
├── astro.config.mjs          # site, output: static
├── sites.json                # COMMITTED tek kaynak: site registry (config; tek yazar backend)
├── agents.json               # COMMITTED tek kaynak: agent registry (yetki matrisi; MCP auth.mjs + backend AgentRegistry)
├── src/
│   ├── content.config.ts     # blog / products / pages collection şemaları (zod)
│   ├── content/              # Markdown içerik (frontmatter = CMS alanları)
│   │   ├── blog/             # yazılar (TR + EN)
│   │   ├── products/         # ürünler (price, stock; TR + EN)
│   │   └── pages/            # sabit sayfalar (TR + EN)
│   ├── layouts/Base.astro    # header / footer / meta + TR|EN dil değiştirici
│   ├── lib/i18n.ts           # dil filtreleri, çeviri eşleşmesi, dil başına rota href'leri
│   ├── pages/                # TR rotaları + en/ (EN) rotaları (published-only, dile göre ayrık)
│   └── styles/global.css     # light-dark() tema, duyarlı yerleşim
├── mcp/
│   ├── ops.mjs               # TEK guardrail + RBAC kaynağı: tüm iş mantığı (MCP + HTTP paylaşır)
│   ├── auth.mjs              # agent kimliği (env) + yetki matrisi (kök agents.json'ı ROOT üzerinden okur)
│   ├── factory.mjs           # createMcpServer(agent) — 12 tool kaydı (stdio + HTTP paylaşır)
│   ├── server.mjs            # MCP stdio entrypoint (factory kullanır, ince katman)
│   ├── http.mjs              # HTTP köprüsü: admin arayüzü + /api + /site/ (127.0.0.1)
│   ├── http-server.mjs       # MCP Streamable HTTP transport + stateful session (127.0.0.1:4323)
│   ├── store.mjs             # Markdown okuma/yazma, slug, state, audit
│   ├── smoke.mjs             # SDK istemcisiyle uçtan uca + RBAC + i18n testi (23 kontrol)
│   └── smoke-http.mjs        # HTTP transport uçtan uca smoke (24 kontrol)
├── backend/                  # NestJS + clean architecture (ayrı workspace, HTTP API)
│   ├── src/main.ts           # HTTP bootstrap (PORT, varsayılan 3000)
│   ├── src/app.module.ts     # kök modül: SitesModule + BuildsModule + SecurityModule + global exception filter'lar
│   ├── src/sites/            # domain ← application (use-case/ports) ← infrastructure (adapter)
│   │   ├── sites.controller.ts   # GET/POST /sites · GET /sites/:id · PUT /sites/:id/locales
│   │   └── infrastructure/       # File (git-native) · Sqlite (better-sqlite3) · Postgres (pg) · filter · registry-bridge
│   ├── src/builds/           # build worker slice: domain ← application (worker/use-case/ports) ← infrastructure
│   │   ├── builds.controller.ts  # POST /builds · GET /builds/:id · GET /builds
│   │   └── infrastructure/       # FileBuildJobRepository (.astropress) · AstroBuildRunner (spawn) · filter
│   ├── src/security/         # D1 perimeter: domain (agent/errors) ← infrastructure (AgentRegistry) ← interface (host/identity middleware · permission/throttler guard · policy)
│   ├── src/scripts/bridge.ts # seed/export CLI (sites.json ↔ DB)
│   ├── test/sites/           # node:test: domain/DI/file/sqlite/postgres/HTTP e2e + contract + bridge (74)
│   ├── test/builds/          # node:test: domain/file/worker/HTTP e2e + real-build + bullmq durable engine (64)
│   └── test/security/        # node:test: registry/policy unit + perimeter HTTP e2e + throttler Redis storage (39)
├── admin/index.html          # gerçek yönetim arayüzü (fetch → /api, simülasyon yok)
├── test/*.test.mjs           # node:test birim + entegrasyon suite'i (30 kontrol)
├── .github/workflows/ci.yml  # CI: node 20/22/24 · build · test · smoke
├── prototype/index.html      # konsept prototipi (aşağıda)
├── .astropress/              # tasks.json (onay kuyruğu) + audit.json + builds.json (build job'ları) — gitignore'lu
├── LICENSE                   # MIT
└── package.json
```

## İçerik modeli

Her kayıt bir Markdown dosyası; frontmatter şeması `src/content.config.ts` içinde zod ile doğrulanır:

- Ortak alanlar: `title`, `status` (`draft | review | published`, varsayılan `draft`), `author`,
  `excerpt`, `date`, `seoTitle`, `seoDesc`, `lang` (`tr | en`, varsayılan `tr`), `translationOf`
  (karşı dildeki kaydın slug'ı).
- `products` ek alanları: `price`, `stock`.
- Rotalar `getStaticPaths` içinde **yalnız `status === 'published'`** kayıtları üretir:
  taslaklar derlemeye girmez, URL'leri 404 döner.

### i18n — TR/EN içerik ve rotalar

Çeviri, ayrı bir kayıt olarak modellenir: her dil kendi Markdown dosyasına sahiptir, `translationOf`
ile karşı dildeki slug'a bağlanır (çeviri bayrağı değil, gerçek eşleşme).

- **TR rotaları** (`/`, `/blog/…`, `/products/…`, `/hakkimizda/`) yalnız `lang !== 'en'` içerik üretir.
- **EN rotaları** (`/en/`, `/en/blog/…`, `/en/products/…`, `/en/about/`) yalnız `lang === 'en'` içerik üretir.
- `Base.astro` dile göre gezinme etiketlerini yerelleştirir ve bir **TR | EN** değiştirici gösterir;
  değiştirici, `translationOf` eşleşmesi varsa doğrudan karşı çeviriye, yoksa karşı dilin ana sayfasına gider.
- Dil ayrımı build'de doğrulanır: EN kayıt `/en/blog/…` altına düşer, TR `/blog/…` rotasına sızmaz (smoke).
- Örnek tohumlar: `cold-brew-ratios ↔ cold-brew-oranlari`, `v60-pour-over-en ↔ v60-pour-over`,
  `ethiopia-yirgacheffe-en ↔ ethiopia-yirgacheffe`, `colombia-huila-en ↔ kolombiya-huila`, `about ↔ hakkimizda`.

## MCP köprüsü ve guardrail'ler

`mcp/server.mjs` bir stdio MCP sunucusudur; herhangi bir MCP istemcisi (Qoder, Claude Desktop,
kendi agent'ınız) bağlanıp siteyi gerçek tool çağrılarıyla yönetir.

| Tool | Ne yapar |
|---|---|
| `whoami` | Bu örneğin agent kimliği + yetki matrisi |
| `list_content` | Collection / durum filtresiyle içerik listesi |
| `read_content` | Tek kaydın frontmatter + gövdesi |
| `create_content` | Yeni Markdown kayıt — **status her zaman `draft`**; `lang`/`translationOf` opsiyonel; `create` yetkisi ister |
| `update_content` | Başlık / gövde / SEO / dil günceller (`edit`); fiyat/stok `commerce` yetkisi ister — **status şemada yok** |
| `delete_content` | Kaydı siler (`delete` yetkisi) |
| `request_publish` | Yayın isteğini onay kuyruğuna yazar (`approval` görevi) |
| `approve_task` | **İnsan** onayı (`publish` yetkisi): görevi kapatır, içeriği `published` yapar |
| `reject_task` | İsteği reddeder (`publish` yetkisi), içerik taslak kalır |
| `list_tasks` | Onay kuyruğu / görev geçmişi |
| `run_build` | Gerçek `astro build` çalıştırır, çıktıyı özetler |
| `audit_log` | İnsan + agent eylemlerinin denetim kaydı (reddedilenler dahil) |

Guardrail modeli (kod düzeyinde, sözle değil):

1. **Agent yayınlayamaz.** `create_content` / `update_content` şemalarında `status` alanı yoktur;
   agent ne isterse istesin içeriği `published` yapamaz.
2. **Yayın = insan onayı.** Tek yol `request_publish → approve_task`. Onay bekleyen istek
   `.astropress/tasks.json` kuyruğunda durur.
3. **Her eylem izlenir.** `.astropress/audit.json` actor (insan/agent), eylem ve zaman damgası tutar.
4. **Taslak sızmaz.** Statik rotalar published-only; smoke testi taslağın `dist/`'e girmediğini,
   onay sonrası girdiğini, silme sonrası kaybolduğunu gerçek build'lerle kanıtlar.

### RBAC — agent başına yetki matrisi

Yetki matrisi **şemada değil, sunucuda** zorunlu (MCP `mcp/ops.mjs` + `mcp/auth.mjs`; backend `PermissionGuard`). Kayıt defteri
kök `agents.json` (MCP `auth.mjs` + backend `AgentRegistry` birlikte okur); kimlik sunucu başlatılırken `ASTROPRESS_AGENT` env ile seçilir (varsayılan
`content-studio`). Her agent kendi MCP örneğini kendi kimliğiyle çalıştırır.

| Agent | oluştur | düzenle | sil | fiyat/stok | yayın |
|---|---|---|---|---|---|
| `operator` (insan) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `content-studio` | ✓ | ✓ | ✓ | — | — |
| `commerce-bot` | — | ✓ | — | ✓ | — |
| `seo-agent` | — | ✓ | — | — | — |
| `reader` | — | — | — | — | — |

- Reddedilen eylem `audit.json`'a `denied` olarak yazılır ve tool hatası döner.
- `approve_task`/`reject_task` `publish` yetkisi ister; tüm agent'larda `publish:false` olduğundan
  **agent kendi isteğini kendi onaylayamaz** (delik sunucu tarafında kapalı). İnsan operatör/admin kullanır.
- Admin arayüzü insan olarak tüm yetkilere sahiptir; **Agent'lar** sekmesi matrisi salt-okunur gösterir.
- Smoke testi kimlikler arası izin/red senaryolarını gerçek MCP çağrılarıyla doğrular (23 kontrol).

### MCP istemcisine kayıt

Sunucu kök dizini kendi dosya konumundan çözer; `cwd` gerekmez, mutlak yol yeterli:

```json
{
  "mcpServers": {
    "astropress": {
      "command": "node",
      "args": ["/tam/yol/astropress/mcp/server.mjs"],
      "env": { "ASTROPRESS_AGENT": "content-studio" }
    }
  }
}
```

`env.ASTROPRESS_AGENT` kimliği seçer; her agent için ayrı kayıt açıp farklı yetki verebilirsiniz.

## Test ve kalite

- **Birim + entegrasyon (`npm test`):** `node:test` ile **30 kontrol** — `store` (Türkçe slug, regex +
  path-traversal reddi, CRUD, durum filtresi), `ops` (guardrail: create→draft, update status'u korur,
  commerce gating; RBAC deny + audit; yayın zinciri request→approve/reject), `auth` (yetki matrisi,
  hiçbir agent'ın `publish` yetkisi olmadığı). Testler `ASTROPRESS_CONTENT` / `ASTROPRESS_STATE` env ile
  **izole temp dizinlerde** koşar; gerçek içeriğe/state'e dokunmaz.
- **Uçtan uca (`npm run smoke`):** SDK istemcileriyle sunucuyu farklı kimliklerde spawn eder, **23 kontrol**
  koşar: ana guardrail zinciri (taslak → build'de yok → onay → build'de var → sil → kaybolur) + i18n
  (EN kayıt `lang=en` taşır, `/en/blog/` altına build olur, TR rotasına sızmaz) + RBAC izin/red senaryoları.
  Gerçek MCP çağrıları + gerçek `astro build`. Hepsi geçince `SMOKE OK`, exit 0.
- **MCP HTTP (`npm run smoke:http`):** Streamable HTTP transport üzerinden aynı guardrail + RBAC + i18n
  zinciri + session isolation + DELETE cleanup + bilinmeyen agent reddi. stdio smoke (23) korunur.
- **Backend (`npm run backend:ci`):** NestJS **177 kontrol** (74 sites + 64 builds + 39 security). File-mode default
  (REDIS_URL+DATABASE_URL unset): **148 pass + 29 skip** (11 Postgres + 9 bullmq + 9 throttler skip-if-unavailable);
  Redis'li: **166 pass / 11 skip**. sites: domain + use-case + DI + file/sqlite/postgres adapter
  + **HTTP e2e**: gerçek express sunucusu + `fetch`, 201/400/404/409, file, sqlite ve postgres modları + **paylaşımlı contract**
  (dört adapter aynı port testinden geçer) + **seed/export köprüsü** (json ↔ DB round-trip) + **registry contract**:
  committed `sites.json` her kaydı domain doğrulamasından geçer, id'ler tekrarsız. Config'in bozuk edit'leri build'den
  önce yakalanır; doğrulama kuralları tek yerde (domain) kalır.
- **Build worker (P2.4):** `builds` slice async job worker — serial `BuildWorker` (single-flight drain, concurrency 1),
  file-backed `.astropress/builds.json` (atomic write + corruption self-heal), boot recovery (running → failed interrupted, crash-safe). `BuildRunner` port'u testlerde
  FakeBuildRunner (instant/deterministic), üretimde AstroBuildRunner (async `spawn astro build`, 180s timeout + cross-platform process-tree kill).
  Worker mantığı fake runner ile, spawn wiring tek gerçek-build testi ile kanıtlı. HTTP e2e: gerçek express + `fetch`, 201/404.
- **Operasyonel sınırlar (P2.4 + D1 — local-dev only):** Backend HTTP API **D1 security perimeter** içerir (aşağıya bkz.):
  loopback bind + Host guard + header-claim kimlik + merkezi RBAC + per-agent rate-limit + 1MB body-limit. Gerçek token/OAuth yok
  (loopback-trusted header) → yalnız yerel geliştirme için. Kuyruk bounded (queue-full → 429) + retention (keep-last-N terminal prune)
  uygulandı (D2); `builds.json` her istekte tümüyle parse/revalidate edilir (O(n), retention ile bounded). **Faz-2 in-slice hardening (I1+M2+M3+M4+I2+M1) uygulandı:** atomic state write (tmp+rename →
  crash mid-write truncated dosya bırakmaz), corrupt `builds.json` self-heal (quarantine `.corrupt` + boş state; transient IO rethrow),
  boot/kick crash-safe (backend boot'u brick olmaz, unhandled-rejection yok), timeout cross-platform process-tree kill (orphan grandchild bırakmaz),
  boot queued-resume (restart'ta `queued` job'lar da kurtarılır — I2), sites e2e state isolation (M1).
  **D2 ✔** — builds retention + queue-bound (`ASTROPRESS_BUILD_QUEUE_LIMIT`, default 10 → 429 queue-full; `ASTROPRESS_BUILD_RETENTION`, default 50 keep-last-N terminal prune).
  **Group E ✔** — BullMQ+Redis durable engine (opt-in, `ASTROPRESS_BUILDS=bullmq`) + throttler Redis storage (`REDIS_URL`); engine bölümüne bkz.
  Kalan debt yalnız Faz-2+ / Faz-3: gerçek token/OAuth + distributed registry Faz-2+; multi-instance concurrency N future seam (mevcut parity concurrency 1); Faz 3 (EventStore) tam recovery getirir.
- **CI (`.github/workflows/ci.yml`):** push/PR'da node **20 / 22 / 24** matrisinde `npm ci → build → test → smoke → smoke:http → backend:ci`.
  Yerel eşdeğeri: `npm run ci`.

## Yönetim arayüzü (`npm run admin`)

`http://127.0.0.1:4322` — tek dosya (`admin/index.html`), gerçek `fetch → /api`, simülasyon yok.
Aynı `ops.mjs` guardrail'lerini kullanır; insan aktör olarak etiketlenir.

- **İçerik:** liste + filtre (tür / durum / dil) + arama; oluştur / düzenle / sil. Durum alanı kilitli
  (form yalnız taslak üretir). Editörde `lang` (TR/EN) ve `translationOf` (karşı slug) alanları var;
  listede dil rozeti gösterilir. Ürünlerde fiyat/stok düzenlenebilir (insan `commerce` yetkili).
- **Onay Kuyruğu:** bekleyen yayın istekleri → Onayla / Reddet; geçmiş.
- **Denetim:** insan + agent eylemleri, aktör rozetleriyle (reddedilenler dahil).
- **Agent'lar:** yetki matrisini salt-okunur gösterir (`/api/agents`).
- **Build al:** gerçek `astro build`; **Siteyi gör** → `/site/` derlenen çıktıyı sunar.
- Açık/koyu tema, 320px'e kadar duyarlı (tablo → kart).

`mcp/http.mjs` yalnız `127.0.0.1`'e bağlanır (yerel geliştirme); `/site/` path-traversal'e karşı
normalize + kök sınırıyla korunur, slug'lar `store.mjs`'de regex ile doğrulanır.

## Konsept prototipi (`prototype/index.html`)

Gerçek iskeletin üstüne gelecek yönetim arayüzünün ürün hissi: tek dosya, bağımlılıksız vanilla JS.

- **İçerik CRUD:** arama, filtre, sıralama, kayıtlı görünümler, toplu işlem, sürükle-bırak, undo.
- **Agent filosu:** model, araçlar ve yetki matrisi (`create / edit / publish / commerce`);
  yetki kapalıysa görev insan onayına düşer.
- **Görev kuyruğu:** canlı ilerleme, log, onayla / reddet / iptal / yeniden dene.
- **AI komut çubuğu:** doğal dil → intent → doğru agent'a görev.
- **Site Stüdyosu:** 9 canlı tema kontrolü + mağaza önizlemesi, JSON dışa aktarım.
- **Build simülasyonu**, etkinlik akışı, açık/koyu tema, 320px'e kadar duyarlı.

Çalıştırma: dosyayı tarayıcıda aç (`start prototype/index.html`) veya `npx serve prototype`. Derleme gerekmez.
Not: prototipteki tüm görev/build/senkron işlemleri tarayıcı içinde simülasyondur; gerçek operasyon
MCP köprüsü üzerinden yapılır.

## Yol haritası

1. ~~Gerçek Astro content collections + `astro build`~~ ✔
2. ~~MCP araç köprüsü + guardrail/onay/audit~~ ✔
3. ~~Yönetim arayüzünü gerçek backend'e bağlamak (canlı kuyruk, gerçek build)~~ ✔
4. ~~Rol tabanlı erişim kontrolü (agent yetki matrisi, sunucu tarafı RBAC)~~ ✔
5. ~~i18n (TR/EN) — içerik çevirileri + `/en/` rotaları + dil değiştirici~~ ✔
6. ~~Test altyapısı (`node:test`) + CI (node 20/22/24) + MIT lisans + proje kimliği~~ ✔
7. **Çoklu site registry + yönetim HTTP API** (NestJS backend, P1/P2.1) ✔; **SQLite adapter + seed/export köprüsü** (P2.2a) ✔.
   Depolama varsayılan olarak dosya tabanlı (Markdown + JSON, git-native); `sqlite` + `postgres` opt-in katman olarak eklendi
   (dört adapter aynı contract'tan geçer). Postgres (P2.2b) ✔ — pg.Pool, Docker dev servisi, skip-if-unavailable test.
   **Build worker (P2.4) ✔** — backend `builds` slice: async job kuyruğu + serial worker (file-backed `.astropress/builds.json`),
   `POST/GET /builds`, boot recovery. ~~BullMQ+Redis durable queue (Group E)~~ ✔ — opt-in durable engine + throttler Redis storage
   (`ASTROPRESS_BUILDS=bullmq` + `REDIS_URL`; Docker `redis:7-alpine` + CI redis service). **Concurrency-N ✔** —
   `ASTROPRESS_BUILD_CONCURRENCY` (default 1) ile N eşzamanlı build, per-build izole root (junction farm); multi-instance future seam.
   Strangler: MCP `ops.mjs` şimdilik kalır; BullMQ+Redis opt-in olarak geldi, Faz 3 EventStore.
8. **Pazaryeri bağlaçları** (Trendyol / Hepsiburada): gerçek API kimliği gerektirir; adaptör planlandı,
   canlı anahtarlarla doğrulanacak — simülasyon değil.

## Lisans

[MIT](LICENSE) · © 2026 Yusuf KEF
