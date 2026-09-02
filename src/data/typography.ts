/**
 * Typographic punctuation for prose.
 *
 * The briefing is written by a model, which emits typewriter punctuation:
 * straight apostrophes, straight quotes, three dots. On a site whose whole
 * character is editorial that reads as a draft. Applied once in
 * src/data/briefings.ts so every surface agrees: the pages, the RSS feed and
 * llms.txt cannot drift apart.
 *
 * Deliberately conservative. It only touches punctuation it can identify from
 * the characters either side, and it never runs over a URL, because mangling a
 * source link is a far worse failure than a straight apostrophe.
 */

/** Straight punctuation that has an unambiguous typographic form. */
function punctuate(text: string): string {
  return (
    text
      // Three dots, before anything else touches the string.
      .replace(/\.{3}/g, '…')
      // Apostrophe inside a word: don't, seller's, '90s handled below.
      .replace(/(\p{L})'(\p{L})/gu, '$1\u2019$2')
      // Elided decade or year: '26 -> ’26
      .replace(/(^|[\s(])'(\d)/g, '$1\u2019$2')
      // Possessive on a plural ending in s: sellers' -> sellers’
      .replace(/(\p{L})'(?=\s|$|[.,;:!?)])/gu, '$1\u2019')
      // Opening double quote: start of string, or after space or opening bracket.
      .replace(/(^|[\s([{])"/g, '$1\u201C')
      // Everything left is a closing double quote.
      .replace(/"/g, '\u201D')
  );
}

/**
 * Apply to a prose string. Left alone if it looks like a URL, so this is safe
 * to map over a whole object without knowing which fields are links.
 */
export function typeset(text: string): string {
  if (/^https?:\/\//i.test(text.trim())) return text;
  return punctuate(text);
}

/** Recursively typeset every string in a value, leaving structure untouched. */
export function typesetDeep<T>(value: T, skipKeys: readonly string[] = []): T {
  if (typeof value === 'string') return typeset(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => typesetDeep(v, skipKeys)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = skipKeys.includes(k) ? v : typesetDeep(v, skipKeys);
    }
    return out as unknown as T;
  }
  return value;
}
