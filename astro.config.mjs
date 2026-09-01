// @ts-check
import { defineConfig } from 'astro/config';
import sitemap, { ChangeFreqEnum } from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://chinalogisticsdaily.com',
  output: 'static',
  // Trailing-slash policy: enforced in one place. Every internal link in the
  // codebase ends with "/" so Cloudflare Pages never has to 307 us.
  trailingSlash: 'always',
  build: { format: 'directory' },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/og/'),
      serialize(item) {
        if (item.url === 'https://chinalogisticsdaily.com/') {
          item.changefreq = ChangeFreqEnum.DAILY;
          item.priority = 1.0;
        } else if (item.url.includes('/briefing/')) {
          item.changefreq = ChangeFreqEnum.MONTHLY;
          item.priority = 0.8;
        } else if (item.url.includes('/topics/')) {
          item.changefreq = ChangeFreqEnum.WEEKLY;
          item.priority = 0.6;
        }
        return item;
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
