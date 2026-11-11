# AstroPress

Astro tabanlı, WordPress tarzı yönetim arayüzü + AI agent orkestrasyonu konsept prototipi.
Tek dosya (`index.html`), bağımlılıksız vanilla JS; derleme adımı yok.

> Durum: **konsept prototipi**. Tüm agent görevleri, build ve pazaryeri senkronu tarayıcı içinde
> simüle edilir; gerçek API çağrısı veya ağ isteği yapılmaz. Amaç, "agent-native CMS" konumlandırmasının
> ürün hissini doğrulamaktır.

## Neden bu konsept?

- Salt WordPress klonu kalabalık bir pazarda (WP, Elementor/Astra, Webflow, Framer, Wix, Lovable/v0/Bolt)
  farklılaşmaz; talep sıfıra yakındır.
- Fark yaratan katman: **agent'ların siteyi güvenle yönetebilmesi** — içerik, ürün, fiyat, çeviri ve
  görsel işlerinin MCP/skill arayüzüyle operasyonu, üstünde guardrail (yetki sınırı), insan onayı ve
  denetim kaydı (audit log).
- TR e-ticaret bağlaçları (Trendyol / Hepsiburada senkronu) yerel pazarda first-mover avantajı sağlar.

## Özellikler

- **İçerik yönetimi (CRUD):** yazı / sayfa / ürün; arama, durum-tür filtresi, sıralama, kayıtlı görünümler,
  toplu seçim (yayınla / taslağa al / sil), sürükle-bırak sıralama, silmede geri al (undo).
- **Agent filosu:** her agent için model, araçlar (skills) ve ayrı yetki matrisi
  (`create / edit / publish / commerce`). Yayınlama ve fiyat/stok yetkisi kapalıyken görev insan onayına düşer.
- **Görev kuyruğu:** canlı ilerleme, log akışı, onayla / reddet / iptal / yeniden dene; guardrail'e takılan
  görevler "Onay Bekliyor" durumunda durur.
- **AI komut çubuğu:** doğal dilde komut → intent ayrıştırma → doğru agent'a görev atama
  (örn. `yeni yazı: soğuk demleme`, `seo denetimi`, `ürünleri Trendyol ile senkronla`).
- **Site Stüdyosu:** canlı önizleme + 9 tema kontrolü (renk, ölçek, radius, yoğunluk, hero düzeni,
  koyu mod, animasyon hızı, grid), sıfırla / rastgele / JSON dışa aktar.
- **Astro Build & Deploy simülasyonu:** statik çıktı derleme günlüğü, sayfa sayısı ve build süresi.
- **Etkinlik / denetim akışı:** insan ve agent eylemleri zaman damgasıyla listelenir.
- Açık / koyu tema (`light-dark()`), 320px'e kadar duyarlı yerleşim, `prefers-reduced-motion` desteği.

## Çalıştırma

Herhangi bir statik sunucu ya da doğrudan tarayıcı:

```bash
# seçenek 1: dosyayı aç
open index.html            # macOS
start index.html           # Windows

# seçenek 2: statik sunucu
npx serve .
# veya
python -m http.server 8000
```

Derleme, kurulum veya bağımlılık gerekmez.

## Mimari notları

- Tek IIFE içinde durum (`state`) + view render fonksiyonları; olay delegasyonu (`data-action`).
- Görev motoru tek bir `setInterval` tick'i ile ilerler; eşzamanlılık sınırı 2 çalışan görev.
- Guardrail modeli: `agent.perms.publish` / `agent.perms.commerce` kapalıysa ilgili görev
  `needsApproval=true` ile üretilir ve onay kuyruğunda bekler.
- Tema değişkenleri önizleme köküne CSS custom property olarak uygulanır; dışa aktarılan JSON
  Astro tema config'ine dönüştürülmek üzere tasarlanmıştır.

## Yol haritası (üretimleşme)

1. Gerçek Astro content collections + `astro build` entegrasyonu (statik çıktıya derleme).
2. MCP araç köprüsü: agent'ların CMS'i gerçek tool çağrılarıyla yönetmesi.
3. Kalıcı depolama (SQLite/Postgres) ve çoklu site desteği.
4. Pazaryeri bağlaçlarının gerçek API'lerle değiştirilmesi (Trendyol, Hepsiburada).
5. i18n (TR/EN) ve rol tabanlı erişim kontrolü.

## Lisans

Henüz belirlenmedi — konsept aşaması.