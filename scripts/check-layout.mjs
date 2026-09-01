#!/usr/bin/env node
/**
 * Responsive and accessibility check against a running site.
 *
 * Covers what static analysis of dist/ cannot see, because it needs layout:
 * horizontal overflow, tap target sizes, heading order, and whether the mobile
 * sticky CTA appears on the right viewports.
 *
 *   npm run dev                # in one terminal
 *   npm run check:layout       # in another
 *   npm run check:layout -- --url=https://news.china-fulfillment.com
 *
 * puppeteer is not a dependency of this project, because pulling a browser
 * download into the daily pipeline for a check that runs at launch and after
 * design changes is not a good trade. Install it when you need this:
 *
 *   npm i -D puppeteer
 */
const BASE =
  process.argv.find((a) => a.startsWith('--url='))?.split('=')[1] ?? 'http://localhost:4321';

let puppeteer;
try {
  ({ default: puppeteer } = await import('puppeteer'));
} catch {
  console.error('puppeteer is not installed. Run:  npm i -D puppeteer\n');
  process.exit(2);
}

const PAGES = [
  '/',
  '/briefing/2026-09-01/',
  '/archive/',
  '/topics/',
  '/topics/sea-freight/',
  '/about/',
  '/subscribe/',
];

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const MIN_TARGET = 24; // WCAG 2.2 AA, 2.5.8 Target Size (Minimum)

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const problems = [];

for (const vp of VIEWPORTS) {
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });

  for (const route of PAGES) {
    const res = await page.goto(BASE + route, { waitUntil: 'networkidle0' });
    if (!res || res.status() >= 400) {
      problems.push(`${vp.name} ${route}: HTTP ${res?.status() ?? 'no response'}`);
      continue;
    }

    const r = await page.evaluate((MIN) => {
      const de = document.documentElement;

      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width > innerWidth + 1 && b.height > 0;
        })
        .slice(0, 4)
        .map((el) => `${el.tagName}.${(el.className || '').toString().trim().slice(0, 40)}`);

      /*
       * WCAG 2.5.8 exempts a target that sits inside a sentence, or whose size
       * is constrained by the line-height of surrounding non-target text. That
       * covers source citations and links inside body copy and headings. Only
       * standalone controls are measured.
       */
      const inlineExempt = (el) => {
        if (el.closest('h1,h2,h3,h4,p,li,dd,dt')) {
          const host = el.closest('h1,h2,h3,h4,p,li,dd,dt');
          const hostText = (host.textContent || '').trim();
          const ownText = (el.textContent || '').trim();
          // The link is part of a longer run of text, so it is inline.
          if (hostText.length > ownText.length + 3) return true;
        }
        return false;
      };

      const small = [...document.querySelectorAll('a[href],button')]
        .map((el) => ({ el, b: el.getBoundingClientRect() }))
        .filter(({ el, b }) => {
          if (b.width === 0 || b.height === 0) return false;
          if (getComputedStyle(el).display === 'none') return false;
          if (inlineExempt(el)) return false;
          return b.height < MIN || b.width < MIN;
        })
        .slice(0, 6)
        .map(
          ({ el, b }) =>
            `${el.tagName}"${(el.textContent || '').trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`,
        );

      const levels = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => +h.tagName[1]);
      const skips = [];
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] - levels[i - 1] > 1) skips.push(`h${levels[i - 1]}->h${levels[i]}`);
      }

      const cta = document.querySelector('.fixed.inset-x-0.bottom-0');
      const imgsNoAlt = [...document.querySelectorAll('img')].filter(
        (i) => !i.hasAttribute('alt'),
      ).length;

      return {
        overflow: de.scrollWidth > innerWidth + 1,
        scrollW: de.scrollWidth,
        wide,
        small,
        skips,
        h1: document.querySelectorAll('h1').length,
        ctaVisible: cta ? getComputedStyle(cta).display !== 'none' : false,
        bodyPadBottom: getComputedStyle(document.body).paddingBottom,
        imgsNoAlt,
        lang: document.documentElement.lang,
        skipLink: Boolean(document.querySelector('.skip-link')),
      };
    }, MIN_TARGET);

    const at = `${vp.name.padEnd(7)} ${route}`;
    if (r.overflow) problems.push(`${at}: horizontal overflow (${r.scrollW}px > ${vp.width}px) via ${r.wide.join(', ')}`);
    if (r.h1 !== 1) problems.push(`${at}: ${r.h1} h1 elements, expected 1`);
    if (r.skips.length) problems.push(`${at}: heading skips ${r.skips.join(', ')}`);
    if (r.small.length) problems.push(`${at}: tap targets under ${MIN_TARGET}px: ${r.small.join(' | ')}`);
    if (r.imgsNoAlt) problems.push(`${at}: ${r.imgsNoAlt} img without alt`);
    if (!r.lang) problems.push(`${at}: <html> has no lang`);
    if (!r.skipLink) problems.push(`${at}: no skip link`);

    const wantCta = vp.width < 768;
    if (r.ctaVisible !== wantCta) problems.push(`${at}: mobile CTA visible=${r.ctaVisible}, expected ${wantCta}`);
    if (wantCta && r.bodyPadBottom === '0px') problems.push(`${at}: mobile CTA shown but body has no bottom padding`);
  }
}

await browser.close();

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
  process.exit(1);
}
console.log(
  `✓ ${PAGES.length} pages × ${VIEWPORTS.length} viewports: no overflow, headings ordered, targets ≥${MIN_TARGET}px, mobile CTA correct.`,
);
