import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://kozkahve.com',
  output: 'static',
  build: { inlineStylesheets: 'auto' },
});