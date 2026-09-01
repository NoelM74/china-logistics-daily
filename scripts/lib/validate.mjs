import { normaliseUrl } from './sources.mjs';

/**
 * Everything that must be true before a briefing is allowed to reach the repo
 * (PRD §5.1 step 5). Returns a list of human-readable errors; empty means pass.
 *
 * These run against generated output nobody will read before it publishes, so
 * the bar is deliberately unforgiving. A failed run costs one day of archive.
 * A published hallucination costs the credibility the whole site trades on.
 */

const MIN_STORIES = 2; // PRD §11: a 2-story day beats skipping the day
const PREFERRED_MIN_STORIES = 3;
const MIN_WORDS = 1000;

/** Slop patterns from the stop-slop ruleset, as publish-blocking checks. */
const BANNED_PATTERNS = [
  { re: /—/, label: 'em dash' },
  { re: /\bhere's (?:the thing|what|why|how)\b/i, label: '"here\'s the thing/what/why"' },
  { re: /\blet that sink in\b/i, label: '"let that sink in"' },
  { re: /\bmake no mistake\b/i, label: '"make no mistake"' },
  { re: /\bthe (?:truth|reality) is\b/i, label: '"the truth/reality is"' },
  { re: /\bit turns out\b/i, label: '"it turns out"' },
  { re: /\bin today's\b/i, label: '"in today\'s"' },
  { re: /\bat the end of the day\b/i, label: '"at the end of the day"' },
  { re: /\bgame[- ]changer\b/i, label: '"game-changer"' },
  { re: /\bdeep dive\b/i, label: '"deep dive"' },
  { re: /\blean into\b/i, label: '"lean into"' },
  { re: /\bdouble down\b/i, label: '"double down"' },
  { re: /\bmoving forward\b/i, label: '"moving forward"' },
  { re: /\bit's worth noting\b/i, label: '"it\'s worth noting"' },
  { re: /\bwhen it comes to\b/i, label: '"when it comes to"' },
  { re: /\bnavigat(?:e|ing) (?:the |these |this )?(?:challeng|complex|uncertain|landscape)/i, label: '"navigate the challenges/landscape"' },
  { re: /\bwhat if I told you\b/i, label: '"what if I told you"' },
  { re: /\bthink about it\b/i, label: '"think about it"' },
  { re: /\bplot twist\b/i, label: '"plot twist"' },
  { re: /\bthe stakes are high\b/i, label: '"the stakes are high"' },
  { re: /\bthe implications are significant\b/i, label: '"the implications are significant"' },
];

/** US spellings that must not appear in prose. Domain names are exempted. */
const US_SPELLINGS = [
  [/\bfulfillment\b/i, 'fulfilment'],
  [/\bfulfill(?:s|ed|ing)?\b/i, 'fulfil'],
  [/\borganiz(?:e|ed|es|ing|ation)\b/i, 'organise'],
  [/\boptimiz(?:e|ed|es|ing|ation)\b/i, 'optimise'],
  [/\banalyz(?:e|ed|es|ing)\b/i, 'analyse'],
  [/\bcenter(?:s|ed)?\b/i, 'centre'],
  [/\bdefense\b/i, 'defence'],
  [/\blabor\b/i, 'labour'],
  [/\bcolor(?:s|ed)?\b/i, 'colour'],
];

const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

/** Prose only — strips URLs so china-fulfillment.com never trips a spelling check. */
function proseOf(b) {
  const parts = [
    b.title,
    b.metaDescription,
    b.bottomLine,
    ...b.stories.flatMap((s) => [
      s.headline,
      s.tldr,
      s.whatHappened,
      s.whyItMatters,
      s.hotTake,
      ...(s.actions ?? []),
    ]),
    ...(b.contentHooks ?? []),
    ...(b.faq ?? []).flatMap((f) => [f.question, f.answer]),
  ];
  return parts
    .filter((p) => typeof p === 'string')
    .join('\n')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\w.-]+\.(?:com|net|org|io|cn|ie|co\.uk)\b/gi, ' ');
}

export function wordCount(b) {
  return words(proseOf(b));
}

export function validateBriefing(briefing, { allowedUrls, allowedTags, date, strict = true }) {
  const e = [];
  const b = briefing;

  if (!b || typeof b !== 'object') return ['output is not an object'];

  // ---- shape -----------------------------------------------------------
  for (const k of ['date', 'title', 'metaDescription', 'bottomLine']) {
    if (typeof b[k] !== 'string' || !b[k].trim()) e.push(`missing or empty "${k}"`);
  }
  if (b.date && b.date !== date) e.push(`date is "${b.date}", expected "${date}"`);
  if (b.title && b.title.length > 70) e.push(`title is ${b.title.length} chars, max 70`);
  if (b.metaDescription && b.metaDescription.length > 170)
    e.push(`metaDescription is ${b.metaDescription.length} chars, max 170`);

  if (!Array.isArray(b.stories) || b.stories.length < MIN_STORIES) {
    e.push(`only ${b.stories?.length ?? 0} stories, minimum ${MIN_STORIES}`);
    return e; // nothing further is meaningful
  }
  if (b.stories.length > 5) e.push(`${b.stories.length} stories, maximum 5`);
  if (strict && b.stories.length < PREFERRED_MIN_STORIES)
    e.push(`only ${b.stories.length} stories, want at least ${PREFERRED_MIN_STORIES}`);

  // ---- stories ---------------------------------------------------------
  const allowed = new Set(allowedUrls.map(normaliseUrl));

  b.stories.forEach((s, i) => {
    const at = `story ${i + 1}`;
    for (const k of [
      'headline',
      'tldr',
      'whatHappened',
      'whyItMatters',
      'hotTake',
      'sourceUrl',
      'sourceName',
    ]) {
      if (typeof s?.[k] !== 'string' || !s[k].trim()) e.push(`${at}: missing "${k}"`);
    }
    if (!Array.isArray(s?.actions) || s.actions.length < 1)
      e.push(`${at}: needs at least one action`);
    if (Array.isArray(s?.actions) && s.actions.length > 3)
      e.push(`${at}: ${s.actions.length} actions, maximum 3`);

    if (!Array.isArray(s?.tags) || s.tags.length < 3)
      e.push(`${at}: needs 3 to 6 tags, got ${s?.tags?.length ?? 0}`);
    if (Array.isArray(s?.tags)) {
      if (s.tags.length > 6) e.push(`${at}: ${s.tags.length} tags, maximum 6`);
      for (const t of s.tags) {
        if (!allowedTags.includes(t)) e.push(`${at}: tag "${t}" is not in the controlled list`);
      }
    }

    // Hallucination guard: the URL must be one we actually handed the model.
    if (typeof s?.sourceUrl === 'string' && s.sourceUrl.trim()) {
      if (!allowed.has(normaliseUrl(s.sourceUrl))) {
        e.push(`${at}: sourceUrl "${s.sourceUrl}" was not in the source material`);
      }
    }

    if (typeof s?.tldr === 'string' && words(s.tldr) > 32)
      e.push(`${at}: tldr is ${words(s.tldr)} words, max about 25`);
    if (typeof s?.whatHappened === 'string' && words(s.whatHappened) < 45)
      e.push(`${at}: whatHappened is too thin (${words(s.whatHappened)} words)`);
    if (typeof s?.whyItMatters === 'string' && words(s.whyItMatters) < 45)
      e.push(`${at}: whyItMatters is too thin (${words(s.whyItMatters)} words)`);
  });

  // ---- briefing-level sections ----------------------------------------
  if (!Array.isArray(b.contentHooks) || b.contentHooks.length < 6)
    e.push(`needs 8 to 12 content hooks, got ${b.contentHooks?.length ?? 0}`);
  if (Array.isArray(b.contentHooks) && b.contentHooks.length > 14)
    e.push(`${b.contentHooks.length} content hooks, maximum 14`);

  if (!Array.isArray(b.faq) || b.faq.length < 3)
    e.push(`needs 3 to 5 FAQ entries, got ${b.faq?.length ?? 0}`);
  if (Array.isArray(b.faq)) {
    if (b.faq.length > 6) e.push(`${b.faq.length} FAQ entries, maximum 6`);
    b.faq.forEach((f, i) => {
      if (!f?.question?.trim() || !f?.answer?.trim()) e.push(`faq ${i + 1}: missing question or answer`);
      else if (words(f.answer) > 95) e.push(`faq ${i + 1}: answer is ${words(f.answer)} words, max 80`);
    });
  }

  // ---- length ----------------------------------------------------------
  const wc = wordCount(b);
  if (wc < MIN_WORDS) e.push(`briefing is ${wc} words, minimum ${MIN_WORDS}`);

  // ---- voice -----------------------------------------------------------
  const prose = proseOf(b);
  for (const { re, label } of BANNED_PATTERNS) {
    const hit = prose.match(re);
    if (hit) e.push(`banned pattern ${label} (found "${hit[0]}")`);
  }
  for (const [re, correction] of US_SPELLINGS) {
    const hit = prose.match(re);
    if (hit) e.push(`US spelling "${hit[0]}" in prose, use "${correction}"`);
  }

  return e;
}
