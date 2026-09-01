#!/usr/bin/env node
/**
 * Render an OG card per briefing into public/og/.
 *
 * Runs in `prebuild`, after the fonts land. Doing this as a build script rather
 * than an Astro endpoint keeps the images as plain static files: no route to
 * collide with the site-wide trailing-slash policy, and a rendering failure
 * degrades the card instead of failing the whole build.
 *
 * Existing files are left alone, so a daily build only renders the new day.
 */
import { readFile, readdir, writeFile, mkdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIEFINGS = path.join(ROOT, 'src', 'content', 'briefings');
// Build-only static weights; see scripts/fetch-fonts.mjs.
const FONTS = path.join(ROOT, '.fonts');
const OUT = path.join(ROOT, 'public', 'og');

const W = 1200;
const H = 630;
// Matches the site tokens in src/styles/global.css.
const NAVY = '#0A152A';
const ACCENT = '#047857';
const PAPER = '#F4F6FB';
const INK = '#0C1A2E';
const INK_MUTED = '#42576D';
const RULE = '#C2CBDD';

const exists = (p) => access(p, constants.F_OK).then(() => true, () => false);

const formatDate = (date) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

/** Plain div helper so the satori tree below stays readable. */
const el = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } });

function card({ kicker, headline, footnote }) {
  return el(
    {
      width: W,
      height: H,
      flexDirection: 'column',
      justifyContent: 'space-between',
      backgroundColor: PAPER,
      borderTop: `14px solid ${NAVY}`,
      padding: '58px 72px 52px',
      fontFamily: 'Satoshi',
    },
    [
      el({ flexDirection: 'column', gap: 26 }, [
        el(
          { fontSize: 21, letterSpacing: 2.4, textTransform: 'uppercase', color: INK_MUTED },
          kicker,
        ),
        el(
          {
            fontFamily: 'Boska',
            fontSize: headline.length > 78 ? 58 : 70,
            lineHeight: 1.08,
            letterSpacing: -1.4,
            color: INK,
            maxWidth: 1010,
          },
          headline,
        ),
      ]),
      el({ alignItems: 'flex-end', justifyContent: 'space-between', borderTop: `2px solid ${RULE}`, paddingTop: 26 }, [
        // satori collapses a trailing space inside a span, so the gap does the
        // word spacing instead.
        el({ fontFamily: 'Boska', fontSize: 38, color: INK, letterSpacing: -0.6, gap: 9 }, [
          { type: 'span', props: { children: 'China Logistics' } },
          { type: 'span', props: { style: { color: ACCENT }, children: 'Daily' } },
        ]),
        el({ fontSize: 20, color: INK_MUTED }, footnote),
      ]),
    ],
  );
}

/** A flat brand card, used when the fonts never arrived. */
function fallbackPng() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${PAPER}"/>
    <rect width="${W}" height="14" fill="${NAVY}"/>
    <rect x="72" y="${H - 150}" width="1056" height="2" fill="${RULE}"/>
  </svg>`;
  return new Resvg(svg).render().asPng();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const [bold, medium] = await Promise.all([
    readFile(path.join(FONTS, 'Boska-Bold.ttf')).catch(() => null),
    readFile(path.join(FONTS, 'Satoshi-Medium.ttf')).catch(() => null),
  ]);

  const fonts =
    bold && medium
      ? [
          { name: 'Boska', data: bold, weight: 700, style: 'normal' },
          { name: 'Satoshi', data: medium, weight: 500, style: 'normal' },
        ]
      : null;

  if (!fonts) {
    console.warn('[og] fonts unavailable, writing plain brand cards');
  }

  let briefings = [];
  try {
    briefings = (await readdir(BRIEFINGS)).filter((f) => f.endsWith('.json')).sort().reverse();
  } catch {
    /* no briefings yet */
  }

  const jobs = [
    {
      name: 'default',
      kicker: 'Published every morning, 07:00 Irish time',
      headline: 'The China logistics briefing for people who actually ship.',
      footnote: 'Noel Murphy · news.china-fulfillment.com',
    },
  ];

  for (const file of briefings) {
    const date = file.replace(/\.json$/, '');
    const b = JSON.parse(await readFile(path.join(BRIEFINGS, file), 'utf8'));
    // The top headline makes a more concrete card than the SEO title.
    const headline = b.stories?.[0]?.headline ?? b.title;
    jobs.push({
      name: date,
      kicker: formatDate(date),
      headline: headline.length > 118 ? `${headline.slice(0, 115).trimEnd()}…` : headline,
      footnote: `${b.stories?.length ?? 0} stories · Noel Murphy`,
    });
  }

  let written = 0;
  let skipped = 0;

  for (const job of jobs) {
    const dest = path.join(OUT, `${job.name}.png`);
    if (await exists(dest)) {
      skipped++;
      continue;
    }
    try {
      const png = fonts
        ? new Resvg(await satori(card(job), { width: W, height: H, fonts }), {
            fitTo: { mode: 'width', value: W },
          })
            .render()
            .asPng()
        : fallbackPng();
      await writeFile(dest, png);
      written++;
    } catch (err) {
      console.warn(`[og] ${job.name} failed: ${err.message}`);
      await writeFile(dest, fallbackPng());
      written++;
    }
  }

  console.log(`[og] ${written} written, ${skipped} already present (${jobs.length} total)`);
}

await main();
