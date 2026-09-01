import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { stripHtml } from './sources.mjs';
import { log } from './log.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MAX_EXTRACT_CHARS = 2600;

/**
 * Fetch an article and pull the main text out of it.
 *
 * Falls back to the RSS description whenever the fetch fails, the page is
 * paywalled, or Readability finds nothing usable (PRD §5.1 step 3). A thin
 * extract is fine — the generator is told to work only from what it is given.
 */
async function extractOne(item) {
  try {
    const res = await fetch(item.url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) throw new Error(`content-type ${ct}`);

    const html = await res.text();

    // jsdom is noisy about CSS and unimplemented APIs on news sites; we only
    // want the text, so silence it rather than drown the Actions log.
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(html, { url: item.url, virtualConsole });
    const article = new Readability(dom.window.document).parse();
    dom.window.close();

    const body = stripHtml(article?.textContent ?? '');
    if (body.length < 320) throw new Error(`extract too short (${body.length})`);

    return {
      ...item,
      extract: body.slice(0, MAX_EXTRACT_CHARS),
      extractSource: 'article',
      // Readability often has a cleaner byline/site name than the feed.
      sourceName: article?.siteName || item.sourceName,
    };
  } catch (err) {
    return {
      ...item,
      extract: (item.description || item.title).slice(0, MAX_EXTRACT_CHARS),
      extractSource: 'rss',
      extractError: String(err.message ?? err),
    };
  }
}

/** Enrich candidates with a small concurrency cap so we stay polite. */
export async function enrichAll(items, concurrency = 5) {
  const out = [];
  const queue = [...items];

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item) out.push(await extractOne(item));
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));

  const full = out.filter((i) => i.extractSource === 'article').length;
  log.info('enriched', { total: out.length, fullText: full, rssFallback: out.length - full });

  // Preserve the relevance order the filter produced.
  const rank = new Map(items.map((i, idx) => [i.url, idx]));
  return out.sort((a, b) => (rank.get(a.url) ?? 0) - (rank.get(b.url) ?? 0));
}
