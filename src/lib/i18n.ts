import { getCollection } from 'astro:content';

export type Lang = 'tr' | 'en';
export type Col = 'blog' | 'products' | 'pages';
type Entry = { id: string; data: { lang?: Lang; translationOf?: string } };

export const other = (lang: Lang): Lang => (lang === 'tr' ? 'en' : 'tr');
export const langOf = (entry: Entry): Lang => entry.data.lang ?? 'tr';

export async function publishedIn(collection: Col, lang: Lang) {
  const all = await getCollection(collection, ({ data }) => data.status === 'published');
  return all.filter((e) => langOf(e) === lang);
}

export function hrefFor(collection: Col, entry: Entry): string {
  const prefix = langOf(entry) === 'en' ? '/en' : '';
  return collection === 'pages' ? `${prefix}/${entry.id}/` : `${prefix}/${collection}/${entry.id}/`;
}

export async function counterpart(collection: Col, entry: Entry) {
  const lang = langOf(entry);
  const candidates = await publishedIn(collection, other(lang));
  return lang === 'tr'
    ? candidates.find((e) => e.data.translationOf === entry.id)
    : candidates.find((e) => e.id === entry.data.translationOf);
}

export async function altHref(collection: Col, entry: Entry): Promise<string> {
  const cp = await counterpart(collection, entry);
  if (cp) return hrefFor(collection, cp);
  return other(langOf(entry)) === 'en' ? '/en/' : '/';
}