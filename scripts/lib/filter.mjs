import { normaliseUrl } from './sources.mjs';
import { log } from './log.mjs';

/** Words that carry no signal when comparing two headlines. */
const STOP = new Set(
  'a an the and or but of to in on for with from as at by is are was were be been it its this that new says say'.split(
    ' ',
  ),
);

function titleTokens(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/** Jaccard overlap on content words. Cheap, and good enough for headlines. */
function similarity(a, b) {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

export function withinWindow(item, hours) {
  if (!item.publishedAt) return true; // undated: let relevance decide
  const t = Date.parse(item.publishedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= hours * 3600_000;
}

/**
 * Score an item for China-logistics relevance. This is the pre-filter that
 * keeps token spend down (PRD §5.1 step 2).
 *
 * What counts as a signal depends on the publication. A Loadstar piece about
 * Ningbo does not need the word "freight" in it, and an SCMP piece about port
 * throughput does not need the word "China". Requiring both signals from every
 * feed threw away most of the genuinely relevant coverage.
 */
export function relevanceScore(item, keywords) {
  const hay = `${item.title} ${item.description}`.toLowerCase();
  const china = keywords.china.filter((k) => hay.includes(k)).length;
  const logistics = keywords.logistics.filter((k) => hay.includes(k)).length;

  switch (item.topic) {
    case 'logistics': // trade press: subject is implied, China is not
      if (!china) return 0;
      break;
    case 'china': // China press: country is implied, logistics is not
      if (!logistics) return 0;
      break;
    default: // general seller press: needs both
      if (!china || !logistics) return 0;
  }

  // Title hits count double — a keyword in the headline is a stronger signal
  // than one buried in a summary.
  const titleHay = item.title.toLowerCase();
  const titleBonus =
    keywords.china.filter((k) => titleHay.includes(k)).length +
    keywords.logistics.filter((k) => titleHay.includes(k)).length;

  return china * 2 + logistics + titleBonus * 2 + (item.weight ?? 1);
}

/** Drop exact-URL repeats, keeping the highest-weight copy of each. */
function dedupeByUrl(items) {
  const best = new Map();
  for (const item of items) {
    const key = normaliseUrl(item.url);
    const prev = best.get(key);
    if (!prev || (item.weight ?? 1) > (prev.weight ?? 1)) best.set(key, { ...item, url: key });
  }
  return [...best.values()];
}

/** Collapse near-identical headlines — the same wire story from six outlets. */
function dedupeByTitle(items, threshold = 0.6) {
  const kept = [];
  for (const item of items) {
    const dupe = kept.find((k) => similarity(k.title, item.title) >= threshold);
    if (!dupe) kept.push(item);
  }
  return kept;
}

/**
 * Full candidate pipeline: window, relevance, dedupe against itself, then
 * against what we already published in the last 7 briefings.
 */
export function selectCandidates({ items, keywords, windowHours, recentlyCovered, max }) {
  const seenUrls = new Set(recentlyCovered.urls.map(normaliseUrl));
  const seenTitles = recentlyCovered.titles;

  const inWindow = items.filter((i) => withinWindow(i, windowHours));

  const scored = inWindow
    .map((i) => ({ ...i, score: relevanceScore(i, keywords) }))
    .filter((i) => i.score > 0);

  const fresh = dedupeByTitle(dedupeByUrl(scored))
    .filter((i) => !seenUrls.has(i.url))
    .filter((i) => !seenTitles.some((t) => similarity(t, i.title) >= 0.55))
    .sort((a, b) => b.score - a.score);

  log.info('candidate funnel', {
    fetched: items.length,
    inWindow: inWindow.length,
    relevant: scored.length,
    afterDedupe: fresh.length,
    taking: Math.min(max, fresh.length),
  });

  return fresh.slice(0, max);
}
