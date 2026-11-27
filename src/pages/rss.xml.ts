import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getCollection } from 'astro:content';
import { langOf } from '../lib/i18n';
import { siteConfig } from '../lib/site.config';
import { ui } from '../lib/ui';

// RSS feed: default dilin yayındaki yazıları (issue #14).
export async function GET(context: APIContext): Promise<Response> {
  const posts = await getCollection('blog', (e) => e.data.status === 'published' && langOf(e) === siteConfig.defaultLocale)
    .then((posts) => posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf()));
  const t = ui[siteConfig.defaultLocale];
  return rss({
    title: `${siteConfig.name} — ${t.latest}`,
    description: t.description,
    site: context.site ?? 'https://kozkahve.com',
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.excerpt,
      pubDate: p.data.date,
      link: `/blog/${p.id}/`,
    })),
    customData: `<language>${siteConfig.defaultLocale}</language>`,
  });
}
