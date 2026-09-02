import { getCollection, type CollectionEntry } from 'astro:content';
import { typesetDeep } from './typography';

export type Briefing = CollectionEntry<'briefings'>;

/*
 * Fields that must survive untouched. sourceUrl is a link and date is parsed
 * downstream; everything else is prose and gets typographic punctuation.
 */
const VERBATIM = ['sourceUrl', 'date', 'model'] as const;

/**
 * All briefings, newest first. Future-dated files are excluded so a briefing
 * committed early (or a seed with a typo'd date) can never appear before its
 * day. Comparison is on the date string because both sides are YYYY-MM-DD.
 */
export async function allBriefings(): Promise<Briefing[]> {
  const today = new Date().toISOString().slice(0, 10);
  const items = await getCollection('briefings', ({ data }) => data.date <= today);
  return items
    .map((item) => ({ ...item, data: typesetDeep(item.data, VERBATIM) }))
    .sort((a, b) => b.data.date.localeCompare(a.data.date));
}

export async function latestBriefing(): Promise<Briefing | undefined> {
  return (await allBriefings())[0];
}

/** Every tag used by a briefing, deduped, in story order. */
export function briefingTags(b: Briefing): string[] {
  return [...new Set(b.data.stories.flatMap((s) => s.tags))];
}

/**
 * Briefings sharing the most tags with this one, newest first as a tiebreak.
 * Backfilled with recent briefings so every page reaches the two-related-links
 * minimum (PRD §8) even in the first week when the archive is thin.
 */
export function relatedBriefings(current: Briefing, pool: Briefing[], limit = 3): Briefing[] {
  const mine = new Set(briefingTags(current));
  const others = pool.filter((b) => b.id !== current.id);

  const scored = others
    .map((b) => ({ b, score: briefingTags(b).filter((t) => mine.has(t)).length }))
    .sort((x, y) => y.score - x.score || y.b.data.date.localeCompare(x.b.data.date));

  const picked = scored.filter((s) => s.score > 0).slice(0, limit).map((s) => s.b);
  if (picked.length >= limit) return picked;

  const seen = new Set(picked.map((b) => b.id));
  for (const b of others) {
    if (picked.length >= limit) break;
    if (!seen.has(b.id)) picked.push(b);
  }
  return picked;
}

export async function briefingsByTag(slug: string): Promise<Briefing[]> {
  const all = await allBriefings();
  return all.filter((b) => briefingTags(b).includes(slug));
}
