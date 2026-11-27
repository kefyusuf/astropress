// Tek doğruluk kaynağı: repo kökündeki COMMITTED sites.json (backend FileSiteRepository yazar).
// .astropress/ yalnız runtime state (audit/tasks) tutar; config orada DEĞİL.
// defaultLocale kökte (öneksiz), diğerleri /<locale> altında. Mevcut site ASTROPRESS_SITE ile seçilir (yoksa ilk).
import sites from '../../sites.json';

const current = sites.find((s) => s.id === process.env.ASTROPRESS_SITE) ?? sites[0];
// Boş sites.json / kayıp kayıt: undefined üzerinde çalışıp build'i yarım yolda çökertmek
// yerine import anında fail-fast (issue #14).
if (!current) throw new Error('sites.json boş veya geçersiz — en az bir site tanımlı olmalı');

export const siteConfig = {
  id: current.id,
  name: current.name,
  defaultLocale: current.defaultLocale,
  locales: current.locales,
};

export type Locale = string;

export const defaultLocale: Locale = siteConfig.defaultLocale;
export const locales: readonly Locale[] = siteConfig.locales;
export const otherLocales: Locale[] = siteConfig.locales.filter((l) => l !== siteConfig.defaultLocale);

export function localePrefix(locale: Locale): string {
  return locale === siteConfig.defaultLocale ? '' : `/${locale}`;
}