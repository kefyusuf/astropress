import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import rehypeSanitize from 'rehype-sanitize';
import rehypeExternalLinks from 'rehype-external-links';

// Markdown sanitizasyonu (issue #11): agent'ların yazabildiği content HTML'i build
// pipeline'ında temizlenir — script/onerror/javascript: URI statik çıktıya sızmaz.
// Astro 7: markdown.rehypePlugins legacy — plugin'ler unified() processor'ına direkt geçilir.
export default defineConfig({
  site: 'https://kozkahve.com',
  output: 'static',
  build: { inlineStylesheets: 'auto' },
  markdown: {
    processor: unified({
      rehypePlugins: [
        rehypeSanitize,
        [rehypeExternalLinks, { rel: ['noopener', 'noreferrer'] }],
      ],
    }),
  },
});
