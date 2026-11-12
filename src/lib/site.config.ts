// Tek doğruluk kaynağı (single source of truth): site kimliği + locale yapılandırması.
// defaultLocale kökte (öneksiz), diğerleri /<locale> altında. Mevcut site TR-default.
// defaultLocale'i değiştirince kök dili otomatik flip olur (route'lar config'den türer).
export const siteConfig = {
  id: 'kozkahve',
  name: 'Köz Kahve',
  defaultLocale: 'tr',
  locales: ['tr', 'en'],
} as const;

export type Locale = (typeof siteConfig.locales)[number];

export const defaultLocale: Locale = siteConfig.defaultLocale;
export const locales: readonly Locale[] = siteConfig.locales;
export const otherLocales: Locale[] = siteConfig.locales.filter((l) => l !== siteConfig.defaultLocale);

export function localePrefix(locale: Locale): string {
  return locale === siteConfig.defaultLocale ? '' : `/${locale}`;
}