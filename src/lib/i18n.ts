import { getCollection, type CollectionEntry } from 'astro:content';
import { defaultLocale, localePrefix, locales, type Locale } from './site.config';

export type Lang = Locale;
export type Col = 'blog' | 'products' | 'pages';
type Entry = { id: string; data: { lang?: Lang; translationOf?: string } };

// Çeviri anahtarı: default dil kaydı kendi id'sini taşır; diğer diller translationOf ile ona
// bağlanır. Anahtar `translationOf ?? id` — hangi dil default olursa olsun simetrik eşleşir
// (issue #14: eski counterpart() tek yönlüydü ve defaultLocale değişince kırılıyordu).
const translationKey = (e: Entry): string => e.data.translationOf || e.id;

export const langOf = (entry: Entry): Lang => entry.data.lang ?? defaultLocale;

// Generic: çağıran collection tipine göre daraltılmış entry dizisi döner (Home'daki
// products.map p.data.price erişimi astro check altında geçerli olur — issue #14).
export async function publishedIn<C extends Col>(collection: C, lang?: Lang): Promise<Array<CollectionEntry<C>>> {
  const all = (await getCollection(collection, ({ data }) => data.status === 'published')) as Array<CollectionEntry<C>>;
  return lang ? all.filter((e) => langOf(e) === lang) : all;
}

export function hrefFor(collection: Col, entry: Entry): string {
  const prefix = localePrefix(langOf(entry));
  return collection === 'pages' ? `${prefix}/${entry.id}/` : `${prefix}/${collection}/${entry.id}/`;
}

// Karşı dil kaydı — çift yönlü ve defaultLocale-bağımsız.
export async function counterpart(collection: Col, entry: Entry) {
  const lang = langOf(entry);
  const all = await publishedIn(collection);
  const key = translationKey(entry);
  return all.find((e) => langOf(e) !== lang && translationKey(e) === key);
}

export interface LangLink {
  lang: Lang;
  href: string;
  active: boolean;
}

// Dil değiştirici bağlantıları: her dil kendi çevirisine gider; çeviri yoksa o dilin köküne
// düşer. 1 dilde liste tek aktif öğeden oluşur → switcher gizlenir; 2 dilde eski davranış;
// 3+ dilde her dil kendi URL'ini alır (eski other() hepsini tek URL'ye gönderiyordu — issue #14).
export async function entryHrefs(collection: Col, entry: Entry): Promise<LangLink[]> {
  const all = await publishedIn(collection);
  const key = translationKey(entry);
  return locales.map((l) => {
    if (l === langOf(entry)) return { lang: l, href: hrefFor(collection, entry), active: true };
    const match = all.find((e) => langOf(e) === l && translationKey(e) === key);
    return { lang: l, href: match ? hrefFor(collection, match) : `${localePrefix(l)}/`, active: false };
  });
}

export function homeHrefs(lang: Lang): LangLink[] {
  return locales.map((l) => ({ lang: l, href: `${localePrefix(l)}/`, active: l === lang }));
}

// x-default hreflang hedefi: listedeki default locale bağlantısı.
export function defaultHref(links: LangLink[]): string {
  return links.find((l) => l.lang === defaultLocale)?.href ?? links[0]?.href ?? '/';
}

// Fiyat biçimleme: locale-bağımlı Intl.NumberFormat (eski sabit ₺ — issue #14).
export const formatPrice = (n: number, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'TRY' }).format(n);
