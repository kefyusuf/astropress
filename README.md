# AstroPress

Astro tabanlı **agent-native CMS**: gerçek bir Astro statik site iskeleti + agent'ların siteyi
güvenle yönetmesini sağlayan MCP (Model Context Protocol) köprüsü. Yanında, ürün hissini doğrulamak
için tek dosyalık etkileşimli konsept prototipi (`index.html`).

> Durum: **çalışan iskelet + gerçek yönetim arayüzü**. İçerik Markdown + content collections olarak durur,
> `astro build` gerçek statik çıktı üretir, MCP sunucusu ve HTTP admin arayüzü aynı guardrail'lerle
> gerçek CRUD + onay akışı işletir. Pazaryeri senkronu henüz simülasyon.

## Neden bu konsept?

- Salt WordPress klonu kalabalık bir pazarda (WP, Elementor/Astra, Webflow, Framer, Wix, Lovable/v0/Bolt)
  farklılaşmaz; talep sıfıra yakındır.
- Fark yaratan katman: **agent'ların siteyi güvenle yönetebilmesi** — içerik, ürün, fiyat, çeviri ve
  görsel işlerinin MCP/skill arayüzüyle operasyonu, üstünde guardrail (yetki sınırı), insan onayı ve
  denetim kaydı (audit log).
- TR e-ticaret bağlaçları (Trendyol / Hepsiburada senkronu) yerel pazarda first-mover avantajı sağlar.

## Hızlı başlangıç (gerçek iskelet)

```bash
npm install          # astro, @modelcontextprotocol/sdk, gray-matter, zod
npm run dev          # http://localhost:4321 — geliştirme sunucusu
npm run build        # astro build → dist/ (yalnız published içerik)
npm run preview      # dist/ üzerinden statik önizleme
npm run mcp          # MCP stdio sunucusunu başlatır (agent köprüsü)
npm run admin        # http://127.0.0.1:4322 — gerçek yönetim arayüzü + /site/ önizleme
npm run smoke        # uçtan uca guardrail + RBAC + i18n testi (23 kontrol, gerçek build'lerle)
```

Örnek site: **Köz Kahve** — üçüncü nesil kahve mağazası (blog + ürünler + sayfalar).

## Dizin yapısı

```
├── astro.config.mjs          # site, output: static
├── src/
│   ├── content.config.ts     # blog / products / pages collection şemaları (zod)
│   ├── content/              # Markdown içerik (frontmatter = CMS alanları)
│   │   ├── blog/             # yazılar
│   │   ├── products/         # ürünler (price, stock)
│   │   └── pages/            # sabit sayfalar
│   ├── layouts/Base.astro    # header / footer / meta + TR|EN dil değiştirici
│   ├── lib/i18n.ts           # dil filtreleri, çeviri eşleşmesi, dil başına rota href'leri
│   ├── pages/                # TR rotaları + en/ (EN) rotaları (published-only, dile göre ayrık)
│   └── styles/global.css     # light-dark() tema, duyarlı yerleşim
├── mcp/
│   ├── ops.mjs             # TEK guardrail + RBAC kaynağı: tüm iş mantığı (MCP + HTTP paylaşır)
│   ├── auth.mjs            # agent kimliği (env) + yetki matrisi + insan yetkileri
│   ├── agents.json         # agent kayıt defteri (yetki matrisi)
│   ├── server.mjs          # MCP stdio sunucusu — 12 tool (ince kayıt katmanı)
│   ├── http.mjs            # HTTP köprüsü: admin arayüzü + /api + /site/ (127.0.0.1)
│   ├── store.mjs           # Markdown okuma/yazma, slug, state, audit
│   └── smoke.mjs           # SDK istemcisiyle uçtan uca + RBAC + i18n testi (23 kontrol)
├── admin/
│   └── index.html          # gerçek yönetim arayüzü (fetch → /api, simülasyon yok)
├── .astropress/              # tasks.json (onay kuyruğu) + audit.json — gitignore'lu
└── index.html                # konsept prototipi (aşağıda)
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

Yetki matrisi **şemada değil, sunucuda** zorunlu (`mcp/ops.mjs` + `mcp/auth.mjs`). Kayıt defteri
`mcp/agents.json`; kimlik sunucu başlatılırken `ASTROPRESS_AGENT` env ile seçilir (varsayılan
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

### Smoke testi

`npm run smoke` SDK istemcileriyle sunucuyu farklı kimliklerde spawn eder ve **23 kontrol** koşar:
ana guardrail zinciri (taslak → build'de yok → onay → build'de var → sil → kaybolur) + i18n
(EN kayıt `lang=en` taşır, `/en/blog/` altına build olur, TR `/blog/` rotasına sızmaz, silme temizler) + RBAC
(content-studio commerce/approve reddi, commerce-bot create reddi / fiyat izni, reader salt-okunur,
reddedilenlerin audit'e yazılması). Hepsi geçince `SMOKE OK` ve exit 0.

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

## Konsept prototipi (`index.html`)

Gerçek iskeletin üstüne gelecek yönetim arayüzünün ürün hissi: tek dosya, bağımlılıksız vanilla JS.

- **İçerik CRUD:** arama, filtre, sıralama, kayıtlı görünümler, toplu işlem, sürükle-bırak, undo.
- **Agent filosu:** model, araçlar ve yetki matrisi (`create / edit / publish / commerce`);
  yetki kapalıysa görev insan onayına düşer.
- **Görev kuyruğu:** canlı ilerleme, log, onayla / reddet / iptal / yeniden dene.
- **AI komut çubuğu:** doğal dil → intent → doğru agent'a görev.
- **Site Stüdyosu:** 9 canlı tema kontrolü + mağaza önizlemesi, JSON dışa aktarım.
- **Build simülasyonu**, etkinlik akışı, açık/koyu tema, 320px'e kadar duyarlı.

Çalıştırma: dosyayı tarayıcıda aç (`start index.html`) veya `npx serve .`. Derleme gerekmez.
Not: prototipteki tüm görev/build/senkron işlemleri tarayıcı içinde simülasyondur; gerçek operasyon
MCP köprüsü üzerinden yapılır.

## Yol haritası

1. ~~Gerçek Astro content collections + `astro build`~~ ✔
2. ~~MCP araç köprüsü + guardrail/onay/audit~~ ✔
3. ~~Yönetim arayüzünü gerçek backend'e bağlamak (canlı kuyruk, gerçek build)~~ ✔
4. Kalıcı depolama (SQLite/Postgres) ve çoklu site desteği.
5. Pazaryeri bağlaçlarının gerçek API'lerle değiştirilmesi (Trendyol, Hepsiburada).
6. ~~Rol tabanlı erişim kontrolü (agent yetki matrisi, sunucu tarafı RBAC)~~ ✔
7. ~~i18n (TR/EN) — içerik çevirileri + `/en/` rotaları + dil değiştirici~~ ✔

## Lisans

Henüz belirlenmedi — konsept aşaması.