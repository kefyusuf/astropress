import type { APIRoute } from 'astro';

// robots.txt: tüm crawl'lere açık; sitemap işaretçisi (issue #14).
export const GET: APIRoute = (): Response => new Response(
  [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${import.meta.env.SITE}/sitemap-index.xml`,
    '',
  ].join('\n'),
  { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
);
