import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './store.mjs';

// Tek doğruluk kaynağı: committed kök sites.json (root build + backend FileSiteRepository ile aynı dosya).
const sites = JSON.parse(fs.readFileSync(path.join(ROOT, 'sites.json'), 'utf8'));
const current = sites.find((s) => s.id === process.env.ASTROPRESS_SITE) ?? sites[0];

export const site = {
  id: current.id,
  name: current.name,
  defaultLocale: current.defaultLocale,
  locales: current.locales,
};
export const locales = site.locales;
export const defaultLocale = site.defaultLocale;
export const normalizeLang = (lang) => (locales.includes(lang) ? lang : defaultLocale);