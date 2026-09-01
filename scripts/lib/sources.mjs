import { XMLParser } from 'fast-xml-parser';
import { log } from './log.mjs';

const UA =
  'Mozilla/5.0 (compatible; ChinaLogisticsDaily/1.0; +https://news.china-fulfillment.com/about/)';

/** Aggregator links we cannot resolve to a real publisher URL. */
const UNRESOLVABLE = /^https?:\/\/(news\.google\.com|www\.bing\.com\/news|news\.yahoo\.com\/rss)/i;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
});

const asArray = (x) => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);
const text = (v) => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return String(v['#text'] ?? v['@href'] ?? '');
};

/** Strip HTML and collapse whitespace. Feed descriptions are full of markup. */
export function stripHtml(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Google News wraps every link in a redirector and suffixes the publisher name
 * onto the title (" - The Loadstar"). Unwrap what we can so dedupe and the
 * hallucination guard both work on the real destination.
 */
function normaliseGoogleNews(item) {
  const m = item.title.match(/^(.*?)\s+-\s+([^-]{2,40})$/);
  if (m) {
    item.title = m[1].trim();
    item.sourceName = m[2].trim();
  }
  try {
    const u = new URL(item.url);
    if (u.hostname === 'news.google.com') {
      const real = u.searchParams.get('url');
      if (real) item.url = real;
    }
  } catch {
    /* leave as-is */
  }
  return item;
}

/** One canonical form per article, so the same story from two feeds collapses. */
export function normaliseUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.protocol = 'https:';
    u.hostname = u.hostname.replace(/^www\./, '');
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref|source|CMP|cmpid)/i.test(k)) u.searchParams.delete(k);
    }
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return raw;
  }
}

function itemsFromFeed(xml, feed) {
  const doc = parser.parse(xml);
  const out = [];

  // RSS 2.0
  for (const it of asArray(doc?.rss?.channel?.item)) {
    const url = text(it.link) || text(it.guid);
    if (!url) continue;
    out.push({
      title: stripHtml(text(it.title)),
      url,
      publishedAt: text(it.pubDate) || text(it['dc:date']),
      description: stripHtml(text(it.description) || text(it['content:encoded'])),
      sourceName: stripHtml(text(it.source)) || feed.name,
      feed: feed.name,
      topic: feed.topic ?? 'logistics',
      weight: feed.weight ?? 1,
    });
  }

  // Atom
  for (const it of asArray(doc?.feed?.entry)) {
    const link = asArray(it.link).find((l) => !l['@rel'] || l['@rel'] === 'alternate') ?? it.link;
    const url = text(link) || text(it.id);
    if (!url) continue;
    out.push({
      title: stripHtml(text(it.title)),
      url,
      publishedAt: text(it.updated) || text(it.published),
      description: stripHtml(text(it.summary) || text(it.content)),
      sourceName: stripHtml(text(doc?.feed?.title)) || feed.name,
      feed: feed.name,
      topic: feed.topic ?? 'logistics',
      weight: feed.weight ?? 1,
    });
  }

  return out;
}

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml = await res.text();
    const parsed = itemsFromFeed(xml, feed)
      .map((i) => (feed.type === 'query' ? normaliseGoogleNews(i) : i))
      .map((i) => ({ ...i, url: normaliseUrl(i.url) }))
      .filter((i) => i.title && i.url.startsWith('http'));

    // Anything still pointing at an aggregator redirector is dropped. We cannot
    // resolve those server-side, so citing one would mean publishing a source
    // link we never actually fetched. See DECISIONS.md.
    const items = parsed.filter((i) => !UNRESOLVABLE.test(i.url));
    const dropped = parsed.length - items.length;

    log.info(`  ok   ${feed.name}`, dropped ? { items: items.length, dropped } : { items: items.length });
    return items;
  } catch (err) {
    // PRD §11: a dead feed is skipped and logged, never fatal.
    log.warn(`  dead ${feed.name}`, { reason: String(err.message ?? err) });
    return [];
  }
}

/** Pull every feed in parallel. Returns a flat item list; failures are dropped. */
export async function fetchAllFeeds(feeds) {
  const results = await Promise.all(feeds.map(fetchFeed));
  const items = results.flat();
  const live = results.filter((r) => r.length > 0).length;
  log.info(`feeds live: ${live}/${feeds.length}`, { items: items.length });
  return items;
}
