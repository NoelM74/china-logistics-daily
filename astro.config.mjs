// @ts-check
import { defineConfig } from 'astro/config';
import sitemap, { ChangeFreqEnum } from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync } from 'node:fs';

// Newest edition, for the lastmod on the pages that list editions.
const newest = readdirSync('src/content/briefings')
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, 10))
  .sort()
  .at(-1);

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
        // Without lastmod Google has no freshness signal for a site that
        // changes every morning. An edition is never edited after it publishes,
        // so its own date is exact; the listing pages change with the newest one.
        const day = item.url.split('/briefing/')[1]?.slice(0, 10);
        if (day) item.lastmod = day;
        else if (item.url === 'https://chinalogisticsdaily.com/' || item.url.includes('/archive/') || item.url.includes('/topics/')) item.lastmod = newest;

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
