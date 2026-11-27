import type { Locale } from './site.config';

// UI metinleri locale'e bağlıdır (default-ness'e DEĞİL): kök dili flip olsa da
// her sayfa kendi dilinin metnini gösterir. Mevcut TR/EN çıktısı birebir korunur.
interface Ui {
  description: string;
  shop: string;
  about: string;
  aboutSlug: string;
  footerManagedPre: string;
  footerManagedPost: string;
  footerTagline: string;
  homeTitle: string;
  kicker: string;
  heroTitlePre: string;
  heroTitleAccent: string;
  heroBody: string;
  featured: string;
  productsCount: (n: number) => string;
  latest: string;
  coproduction: string;
  dateLocale: string;
  badgePost: string;
  badgeProduct: string;
  badgePage: string;
  stock: string;
}

export const ui: Record<Locale, Ui> = {
  tr: {
    description: 'Köz Kahve — üçüncü nesil kahve, doğru kavurma.',
    shop: 'Mağaza',
    about: 'Hakkımızda',
    aboutSlug: 'hakkimizda',
    // set:html yerine parçalı: brand sabit <strong> ile Base'te render edilir (XSS yüzeyi yok, issue #11)
    footerManagedPre: '© 2026 Köz Kahve · ',
    footerManagedPost: ' ile yönetiliyor',
    footerTagline: 'Astro statik çıktı · agent + insan ortak üretimi',
    homeTitle: 'Köz Kahve — üçüncü nesil kahve, doğru kavurma',
    kicker: 'Küçük parti · doğrudan ticaret',
    heroTitlePre: 'Üçüncü nesil kahve, ',
    heroTitleAccent: 'doğru kavurma.',
    heroBody: "Çekirdekten fincana izlenebilir tedarik; her parti için ayrı kavurma profili. Astro ile statik, hızlı ve agent'larla yönetilen bir mağaza.",
    featured: 'Öne çıkan çekirdekler',
    productsCount: (n) => `${n} ürün · stoklar senkron`,
    latest: "Blog'dan son yazılar",
    coproduction: 'agent + insan ortak üretimi',
    dateLocale: 'tr-TR',
    badgePost: 'Yazı',
    badgeProduct: 'Ürün',
    badgePage: 'Sayfa',
    stock: 'stok:',
  },
  en: {
    description: 'Köz Kahve — third-wave coffee, roasted right.',
    shop: 'Shop',
    about: 'About',
    aboutSlug: 'about',
    footerManagedPre: '© 2026 Köz Kahve · managed with ',
    footerManagedPost: '',
    footerTagline: 'Astro static output · agent + human co-production',
    homeTitle: 'Köz Kahve — third-wave coffee, roasted right',
    kicker: 'Small batch · direct trade',
    heroTitlePre: 'Third-wave coffee, ',
    heroTitleAccent: 'roasted right.',
    heroBody: 'Traceable supply from bean to cup; a separate roast profile for every batch. A fast, static store managed with agents, built on Astro.',
    featured: 'Featured beans',
    productsCount: (n) => `${n} products · stock in sync`,
    latest: 'Latest from the blog',
    coproduction: 'agent + human co-production',
    dateLocale: 'en-US',
    badgePost: 'Post',
    badgeProduct: 'Product',
    badgePage: 'Page',
    stock: 'stock:',
  },
};