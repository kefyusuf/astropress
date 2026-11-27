import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { siteConfig } from './lib/site.config';

const status = z.enum(['draft', 'review', 'published']).default('draft');

const base = {
  title: z.string(),
  status,
  author: z.string().default('İnsan'),
  excerpt: z.string().default(''),
  date: z.coerce.date(),
  seoTitle: z.string().default(''),
  seoDesc: z.string().default(''),
  lang: z.enum(siteConfig.locales as [string, ...string[]]).default(siteConfig.defaultLocale),
  translationOf: z.string().default(''),
};

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({ ...base, type: z.literal('post').default('post') }),
});

const products = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/products' }),
  schema: z.object({
    ...base,
    type: z.literal('product').default('product'),
    // Negatif fiyat ve ondalık/negatif stok kabul edilmez (issue #14).
    price: z.number().nonnegative().default(0),
    stock: z.number().int().nonnegative().default(0),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({ ...base, type: z.literal('page').default('page') }),
});

export const collections = { blog, products, pages };