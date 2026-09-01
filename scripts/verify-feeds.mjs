#!/usr/bin/env node
/**
 * Check every feed in sources.json: does it respond, does it parse, and how
 * many items has it published in the last 72 hours.
 *
 * PRD §5.2 asks for feed URLs to be verified rather than trusted. Run this
 * whenever you add a feed, and occasionally to catch ones that have rotted:
 *
 *   npm run feeds:verify
 *   node scripts/verify-feeds.mjs --candidates   # test the candidate list too
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA =
  'Mozilla/5.0 (compatible; ChinaLogisticsDaily/1.0; +https://news.china-fulfillment.com/about/)';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });
const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** Extra feeds worth trying. Run with --candidates to test these. */
const CANDIDATES = [
  ['Container News', 'https://container-news.com/feed/'],
  ['Seatrade Maritime', 'https://www.seatrade-maritime.com/rss.xml'],
  ['The Maritime Executive', 'https://maritime-executive.com/articles.rss'],
  ['Port Technology', 'https://www.porttechnology.org/feed/'],
  ['ShippingWatch', 'https://shippingwatch.com/rss'],
  ['Supply Chain Brain', 'https://www.supplychainbrain.com/rss/articles'],
  ['Logistics Manager', 'https://www.logisticsmanager.com/feed/'],
  ['Air Cargo News', 'https://www.aircargonews.net/feed/'],
  ['Air Cargo Week', 'https://www.aircargoweek.com/feed/'],
  ['STAT Times', 'https://www.stattimes.com/feed'],
  ['China Briefing', 'https://www.china-briefing.com/news/feed/'],
  ['China Briefing (alt)', 'https://www.china-briefing.com/news/rss'],
  ['SCMP Business', 'https://www.scmp.com/rss/92/feed'],
  ['SCMP China Economy', 'https://www.scmp.com/rss/318198/feed'],
  ['Yicai Global', 'https://www.yicaiglobal.com/rss/news.xml'],
  ['Global Times Business', 'https://www.globaltimes.cn/rss/bizchina.xml'],
  ['Ecommerce News Europe', 'https://ecommercenews.eu/feed/'],
  ['Marketplace Pulse', 'https://www.marketplacepulse.com/rss.xml'],
  ['Retail Dive', 'https://www.retaildive.com/feeds/news/'],
  ['Modern Retail', 'https://www.modernretail.co/feed/'],
  ['Practical Ecommerce', 'https://www.practicalecommerce.com/feed'],
  ['Xeneta', 'https://www.xeneta.com/blog/rss.xml'],
  ['Flexport', 'https://www.flexport.com/blog/rss.xml'],
  ['Drewry', 'https://www.drewry.co.uk/feed'],
  ['Lloyds List', 'https://www.lloydslist.com/rss'],
  ['Caixin Global', 'https://www.caixinglobal.com/rss/all.xml'],
  ['Caixin (alt)', 'https://www.caixinglobal.com/feed/'],
  ['Reuters Business', 'https://feeds.reuters.com/reuters/businessNews'],
  ['Hellenic Shipping News', 'https://www.hellenicshippingnews.com/feed/'],
  ['American Journal of Transportation', 'https://www.ajot.com/rss/news'],
];

async function check(name, url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
    });
    if (!res.ok) return { name, url, ok: false, note: `HTTP ${res.status}` };

    const xml = await res.text();
    const doc = parser.parse(xml);
    const items = [...asArray(doc?.rss?.channel?.item), ...asArray(doc?.feed?.entry)];
    if (!items.length) return { name, url, ok: false, note: 'parsed, 0 items' };

    const cutoff = Date.now() - 72 * 3600_000;
    const dated = items.filter((it) => {
      const d = Date.parse(it.pubDate ?? it.updated ?? it.published ?? '');
      return !Number.isNaN(d) && d >= cutoff;
    }).length;

    return {
      name,
      url,
      ok: true,
      items: items.length,
      recent: dated,
      ms: Date.now() - t0,
    };
  } catch (err) {
    return { name, url, ok: false, note: String(err.message ?? err).slice(0, 60) };
  }
}

const useCandidates = process.argv.includes('--candidates');
const list = useCandidates
  ? CANDIDATES
  : JSON.parse(await readFile(path.join(ROOT, 'sources.json'), 'utf8')).feeds.map((f) => [
      f.name,
      f.url,
    ]);

const results = await Promise.all(list.map(([n, u]) => check(n, u)));

const good = results.filter((r) => r.ok).sort((a, b) => b.recent - a.recent);
const bad = results.filter((r) => !r.ok);

console.log(`\nWORKING (${good.length}/${results.length})  [items | last 72h]\n`);
for (const r of good) {
  console.log(`  ${String(r.items).padStart(3)} | ${String(r.recent).padStart(3)}  ${r.name}`);
}
if (bad.length) {
  console.log(`\nNOT USABLE (${bad.length})\n`);
  for (const r of bad) console.log(`  ${r.name.padEnd(36)} ${r.note}`);
}
console.log('');
