/**
 * Fetch the two brand webfonts from Fontshare into public/fonts/.
 *
 * Runs as `prebuild`, so Cloudflare Pages and GitHub Actions both get them
 * without binaries living in git. Boska and Satoshi are free for web use under
 * the ITF Free Font Licence.
 *
 * The file URLs on Fontshare's CDN are content-hashed and rotate, so we ask the
 * CSS API where the files are rather than hardcoding paths that will rot. We
 * take woff2 for the browser and ttf for satori, which cannot read woff2.
 *
 * This step never fails the build. If Fontshare is unreachable the site falls
 * back to the stacks in src/styles/global.css and OG images use their own
 * fallback. Degraded texture, working site.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// woff2 ships to the CDN; the static TTFs exist only so satori can render OG
// cards at build time, so they stay out of public/ and out of the deploy.
const OUT = path.join(ROOT, 'public', 'fonts');
const BUILD_ONLY = path.join(ROOT, '.fonts');
// One request per family: the API silently ignores every f[] after the first.
// Variable faces for the browser, plus pinned static weights for satori:
// opentype.js chokes on a variable font's fvar table, so OG images need
// single-weight files.
const CSS_APIS = [
  'https://api.fontshare.com/v2/css?f[]=boska@1,2',
  'https://api.fontshare.com/v2/css?f[]=satoshi@1',
  'https://api.fontshare.com/v2/css?f[]=boska@700',
  'https://api.fontshare.com/v2/css?f[]=satoshi@500',
];
const UA = 'Mozilla/5.0 (compatible; china-logistics-daily-build/1.0)';

/**
 * Which @font-face blocks we want and what to call the files locally.
 * `formats` picks which files to keep: woff2 for the site, ttf for satori.
 * `weight` disambiguates the variable face from the pinned static one, which
 * both arrive with the same family and style.
 */
const WANTED = [
  { family: 'Boska', style: 'normal', variable: true, base: 'Boska-Variable', formats: ['woff2'] },
  { family: 'Satoshi', style: 'normal', variable: true, base: 'Satoshi-Variable', formats: ['woff2'] },
  { family: 'Boska', style: 'normal', variable: false, base: 'Boska-Bold', formats: ['truetype'] },
  { family: 'Satoshi', style: 'normal', variable: false, base: 'Satoshi-Medium', formats: ['truetype'] },
];

const exists = (p) =>
  access(p, constants.F_OK).then(
    () => true,
    () => false,
  );

async function get(url, as = 'text') {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, attempt * 900));
    }
  }
}

/** Pull family / style / file URLs out of the Fontshare stylesheet. */
function parseFaces(css) {
  const faces = [];
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const family = block.match(/font-family:\s*'([^']+)'/)?.[1];
    const style = block.match(/font-style:\s*(\w+)/)?.[1] ?? 'normal';
    const weight = block.match(/font-weight:\s*([^;]+)/)?.[1]?.trim() ?? '400';
    // "200 900" is a variable range; a bare number is a pinned static weight.
    const variable = /\s/.test(weight);
    if (!family) continue;

    const urls = {};
    for (const [, raw, fmt] of block.matchAll(/url\('([^']+)'\)\s*format\('([^']+)'\)/g)) {
      urls[fmt] = raw.startsWith('//') ? `https:${raw}` : raw;
    }
    faces.push({ family, style, weight, variable, urls });
  }
  return faces;
}

async function save(file, url, dir = OUT) {
  const dest = path.join(dir, file);
  if (await exists(dest)) return { file, status: 'cached' };
  const buf = await get(url, 'buffer');
  if (buf.byteLength < 2048) throw new Error(`suspiciously small (${buf.byteLength}B)`);
  await writeFile(dest, buf);
  return { file, status: 'downloaded', bytes: buf.byteLength };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(BUILD_ONLY, { recursive: true });

  const faces = [];
  for (const api of CSS_APIS) {
    try {
      faces.push(...parseFaces(await get(api)));
    } catch (err) {
      console.warn(`[fonts] could not reach Fontshare (${err.message}) for ${api}`);
    }
  }
  if (!faces.length) {
    console.warn('[fonts] no font metadata retrieved. Using fallback stacks.');
    return;
  }

  const results = [];
  for (const want of WANTED) {
    const face = faces.find(
      (f) => f.family === want.family && f.style === want.style && f.variable === want.variable,
    );
    if (!face) {
      results.push({ file: want.base, status: 'missing', error: 'no matching @font-face' });
      continue;
    }

    const ext = { woff2: 'woff2', truetype: 'ttf' };
    const jobs = want.formats
      .filter((f) => face.urls[f])
      .map((f) => ({
        file: `${want.base}.${ext[f]}`,
        url: face.urls[f],
        dir: f === 'truetype' ? BUILD_ONLY : OUT,
      }));

    for (const job of jobs) {
      try {
        results.push(await save(job.file, job.url, job.dir));
      } catch (err) {
        results.push({ file: job.file, status: 'failed', error: String(err.message ?? err) });
      }
    }
  }

  for (const r of results) {
    const detail = r.bytes ? ` (${Math.round(r.bytes / 1024)}kB)` : r.error ? ` — ${r.error}` : '';
    console.log(`[fonts] ${r.status.padEnd(10)} ${r.file}${detail}`);
  }

  const bad = results.filter((r) => r.status === 'failed' || r.status === 'missing');
  if (bad.length) {
    console.warn(
      `[fonts] ${bad.length}/${results.length} unavailable. Building with fallback stacks — ` +
        'the site works, it just loses the brand typeface.',
    );
  }
}

await main();
