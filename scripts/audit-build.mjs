#!/usr/bin/env node
/**
 * Post-build audit of dist/.
 *
 * Checks the things the PRD acceptance list cares about and that a unit test
 * cannot see: title and description limits, canonical correctness, schema
 * presence, trailing-slash consistency on every internal link, AI crawler
 * rules, and slop patterns in the rendered copy.
 *
 *   npm run audit
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ORIGIN = 'https://chinalogisticsdaily.com';

const problems = [];
const notes = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

/** Slop patterns, mirroring scripts/lib/validate.mjs. */
const SLOP = [
  [/—/, 'em dash'],
  [/\bhere's (?:the thing|what|why|how)\b/i, "here's the thing/what/why"],
  [/\blet that sink in\b/i, 'let that sink in'],
  [/\bmake no mistake\b/i, 'make no mistake'],
  [/\bin today's\b/i, "in today's"],
  [/\bat the end of the day\b/i, 'at the end of the day'],
  [/\bgame[- ]changer\b/i, 'game-changer'],
  [/\bdeep dive\b/i, 'deep dive'],
  [/\bit's worth noting\b/i, "it's worth noting"],
  [/\bthe stakes are high\b/i, 'the stakes are high'],
];

/** US spellings that must not appear in prose. Domains are stripped first. */
const US = [
  [/\bfulfillment\b/i, 'fulfilment'],
  [/\borganiz(?:e|ed|es|ing|ation)\b/i, 'organise'],
  [/\boptimiz(?:e|ed|es|ing|ation)\b/i, 'optimise'],
  [/\bcenter(?:s|ed)?\b/i, 'centre'],
  [/\blabor\b/i, 'labour'],
];

/** Entities inflate attribute length; measure what a user would see. */
function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#8209;/g, '-')
    .replace(/&nbsp;/g, ' ')
    .replace(/&middot;/g, '.');
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** Visible text only: strip head, script, style and all tags. */
function visibleText(html) {
  return html
    .replace(/<head[\s\S]*?<\/head>/i, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8209;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/&middot;/g, '.')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

const files = await walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const rel = (f) => path.relative(DIST, f).replace(/\\/g, '/');

console.log(`Auditing ${htmlFiles.length} pages in dist/\n`);

// ---------------------------------------------------------------- per page
for (const file of htmlFiles) {
  const name = rel(file);
  const html = await readFile(file, 'utf8');
  const is404 = name === '404.html';

  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
  const desc = decode(html.match(/name="description" content="([^"]*)"/)?.[1] ?? '');
  const canonical = html.match(/rel="canonical" href="([^"]*)"/)?.[1] ?? '';

  if (!title) fail(name, 'no <title>');
  else if (title.length > 60) fail(name, `title ${title.length} chars (max 60): "${title}"`);

  if (!desc) fail(name, 'no meta description');
  else if (desc.length > 155) fail(name, `description ${desc.length} chars (max 155)`);

  if (!canonical) fail(name, 'no canonical');
  else if (!canonical.startsWith(ORIGIN)) fail(name, `canonical not absolute: ${canonical}`);
  else if (!canonical.endsWith('/')) fail(name, `canonical missing trailing slash: ${canonical}`);

  // one H1, exactly
  const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1s !== 1) fail(name, `${h1s} <h1> elements, expected exactly 1`);

  // og + twitter
  for (const tag of ['og:title', 'og:description', 'og:image', 'og:url']) {
    if (!html.includes(`property="${tag}"`)) fail(name, `missing ${tag}`);
  }
  if (!html.includes('name="twitter:card"')) fail(name, 'missing twitter:card');

  // schema graph
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  if (!ld) fail(name, 'no JSON-LD');
  else {
    try {
      const g = JSON.parse(ld);
      const types = (g['@graph'] ?? []).map((n) => n['@type']);
      for (const req of ['NewsMediaOrganization', 'Organization', 'Person', 'WebSite']) {
        if (!types.includes(req)) fail(name, `JSON-LD missing ${req}`);
      }
      if (name.startsWith('briefing/')) {
        for (const req of ['NewsArticle', 'FAQPage', 'BreadcrumbList']) {
          if (!types.includes(req)) fail(name, `JSON-LD missing ${req}`);
        }
      }
    } catch (err) {
      fail(name, `JSON-LD does not parse: ${err.message}`);
    }
  }

  // internal links must already be in final form
  for (const [, hrefValue] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    if (/\.[a-z0-9]{2,5}$/i.test(hrefValue)) continue; // a file
    if (!hrefValue.endsWith('/')) fail(name, `internal link without trailing slash: ${hrefValue}`);
  }

  // external links out of the site must be nofollow, except to our own estate
  for (const [, attrs] of html.matchAll(/<a ([^>]*href="https?:\/\/[^"]*"[^>]*)>/g)) {
    const url = attrs.match(/href="([^"]*)"/)?.[1] ?? '';
    // Our own estate, including the author's LinkedIn: these are the sameAs
    // entity signals from PRD §9 and are followed deliberately.
    if (/china-fulfillment\.com|eriusourcing\.com|linkedin\.com/.test(url)) continue;
    if (!/rel="[^"]*nofollow/.test(attrs)) fail(name, `external link not nofollowed: ${url}`);
  }

  // Slop and spelling in rendered copy. "China Fulfillment" is the company's
  // registered name and keeps its own spelling; the same word used as an
  // ordinary noun must be "fulfilment".
  const text = decode(visibleText(html))
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\w.-]+\.(?:com|net|org|io|cn|ie|co\.uk)\b/gi, ' ')
    .replace(/China Fulfillment/g, 'China Fulfilment');
  for (const [re, label] of SLOP) {
    const hit = text.match(re);
    if (hit) fail(name, `slop pattern "${label}" (found "${hit[0]}")`);
  }
  for (const [re, fix] of US) {
    const hit = text.match(re);
    if (hit) fail(name, `US spelling "${hit[0]}", use "${fix}"`);
  }

  if (is404) continue;
  const words = text.trim().split(/\s+/).length;
  if (words < 120) fail(name, `only ${words} words of visible copy`);
}

// ---------------------------------------------------------------- site-wide
const need = ['robots.txt', 'llms.txt', 'sitemap-index.xml', 'sitemap-0.xml', 'rss.xml', 'favicon.svg'];
for (const f of need) {
  try {
    await stat(path.join(DIST, f));
  } catch {
    fail('site', `missing /${f}`);
  }
}

const robots = await readFile(path.join(DIST, 'robots.txt'), 'utf8').catch(() => '');
for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'OAI-SearchBot']) {
  if (!robots.includes(bot)) fail('robots.txt', `${bot} not listed`);
}
if (!robots.includes('Sitemap:')) fail('robots.txt', 'no Sitemap directive');

const sitemap = await readFile(path.join(DIST, 'sitemap-0.xml'), 'utf8').catch(() => '');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (urls.length < htmlFiles.length - 3) {
  fail('sitemap', `${urls.length} URLs for ${htmlFiles.length} pages`);
}
for (const u of urls) {
  if (u.includes('/404')) fail('sitemap', '404 page is in the sitemap');
  if (!u.endsWith('/')) fail('sitemap', `URL without trailing slash: ${u}`);
}

// OG images referenced must exist on disk
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const og = html.match(/property="og:image" content="([^"]*)"/)?.[1];
  if (!og) continue;
  const p = path.join(DIST, og.replace(ORIGIN, ''));
  try {
    await stat(p);
  } catch {
    fail(rel(file), `og:image missing on disk: ${og}`);
  }
}

// briefing pages: internal-link quotas from PRD §8
for (const file of htmlFiles.filter((f) => rel(f).startsWith('briefing/'))) {
  const html = await readFile(file, 'utf8');
  const services = new Set(
    [...html.matchAll(/href="(https:\/\/www\.china-fulfillment\.com\/[^"]+)"/g)].map((m) => m[1]),
  );
  if (services.size < 3) {
    fail(rel(file), `${services.size} distinct china-fulfillment.com links, need at least 3`);
  }
  const others = new Set(
    [...html.matchAll(/href="\/briefing\/(\d{4}-\d{2}-\d{2})\//g)].map((m) => m[1]),
  );
  others.delete(rel(file).split('/')[1]);
  if (others.size < 2) {
    notes.push(`${rel(file)}: links to ${others.size} other briefings (want 2, archive is young)`);
  }
}

// ---------------------------------------------------------------- report
const totalBytes = files.reduce((n, f) => n, 0);
void totalBytes;

if (notes.length) {
  console.log('Notes\n');
  for (const n of notes) console.log(`  · ${n}`);
  console.log('');
}

if (problems.length) {
  console.log(`${problems.length} problem(s)\n`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log('');
  process.exit(1);
}

console.log(`✓ ${htmlFiles.length} pages, ${urls.length} sitemap URLs, no problems found.`);
