#!/usr/bin/env node
/**
 * Proves the publish gate rejects what it is supposed to reject.
 *
 * PRD §13 asks for a demonstration that a malformed generation is caught. This
 * is that demonstration, as a runnable test rather than a one-off manual check,
 * so the guard cannot quietly rot.
 *
 *   npm test
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBriefing } from './lib/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A fixed, hand-authored briefing, so the tests do not shift under a new
// generated file landing in the archive.
const DATE = '2026-08-31';

const good = JSON.parse(
  await readFile(path.join(ROOT, 'src', 'content', 'briefings', `${DATE}.json`), 'utf8'),
);
const allowedTags = JSON.parse(await readFile(path.join(ROOT, 'tags.json'), 'utf8')).tags.map(
  (t) => t.slug,
);
const allowedUrls = good.stories.map((s) => s.sourceUrl);

const opts = { allowedUrls, allowedTags, date: DATE, strict: false };
const clone = () => JSON.parse(JSON.stringify(good));

/** Each case mutates a valid briefing and names the error we expect back. */
const CASES = [
  ['baseline: unmodified briefing passes', (b) => b, null],

  [
    'hallucinated source URL is rejected',
    (b) => {
      b.stories[0].sourceUrl = 'https://theloadstar.com/invented-article-that-was-never-fetched';
      return b;
    },
    /was not in the source material/,
  ],
  [
    'source URL from a different real site is rejected',
    (b) => {
      b.stories[1].sourceUrl = 'https://www.reuters.com/business/some-plausible-story';
      return b;
    },
    /was not in the source material/,
  ],
  [
    'tag outside the controlled list is rejected',
    (b) => {
      b.stories[0].tags = ['sea-freight', 'air-freight', 'blockchain-logistics'];
      return b;
    },
    /not in the controlled list/,
  ],
  [
    'fewer than two stories is rejected',
    (b) => {
      b.stories = b.stories.slice(0, 1);
      return b;
    },
    /minimum 2/,
  ],
  [
    'missing required field is rejected',
    (b) => {
      delete b.stories[0].hotTake;
      return b;
    },
    /missing "hotTake"/,
  ],
  [
    'wrong date is rejected',
    (b) => {
      b.date = '2026-07-04';
      return b;
    },
    new RegExp(`expected "${DATE}"`),
  ],
  [
    'story with a one-line body is rejected',
    (b) => {
      b.stories[0].whatHappened = 'A short sentence about a thing that happened in China.';
      return b;
    },
    /whatHappened is too thin/,
  ],
  [
    'briefing under 1,000 words is rejected even when every story passes',
    (b) => {
      // Each section clears its own minimum, so only the total can catch this.
      const filler = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
      b.stories = b.stories.slice(0, 2);
      for (const s of b.stories) {
        s.whatHappened = filler(50);
        s.whyItMatters = filler(50);
        s.hotTake = filler(12);
        s.actions = [filler(6)];
      }
      b.contentHooks = Array.from({ length: 8 }, (_, i) => `Hook number ${i} about freight`);
      b.faq = b.faq.slice(0, 3).map((f) => ({ question: f.question, answer: filler(20) }));
      b.bottomLine = filler(20);
      return b;
    },
    /minimum 1000/,
  ],
  [
    'em dash is rejected',
    (b) => {
      b.bottomLine = 'Rates moved this week — and they are not coming back down again soon.';
      return b;
    },
    /em dash/,
  ],
  [
    'AI slop opener is rejected',
    (b) => {
      b.stories[0].hotTake = "Here's the thing: nobody prices weather risk until it is too late.";
      return b;
    },
    /here's the thing/i,
  ],
  [
    'US spelling in prose is rejected',
    (b) => {
      b.stories[0].whyItMatters = `Your fulfillment costs rise. ${b.stories[0].whyItMatters}`;
      return b;
    },
    /US spelling/,
  ],
  [
    'over-length title is rejected',
    (b) => {
      b.title =
        'A very long SEO title about China logistics that runs well past the sixty character limit';
      return b;
    },
    /max 60/,
  ],
  [
    'title over 60 chars is rejected, matching the build audit',
    (b) => {
      b.title = 'China: Typhoon Saudel threatens freight hubs in south and east';
      return b;
    },
    /title is 62 chars, max 60/,
  ],
  [
    'too many tags is rejected',
    (b) => {
      b.stories[0].tags = [
        'sea-freight', 'air-freight', 'rail-freight', 'tariffs-duties',
        'customs-eu', 'customs-uk', 'customs-us',
      ];
      return b;
    },
    /maximum 6/,
  ],
  [
    'overlong FAQ answer is rejected',
    (b) => {
      b.faq[0].answer = Array(110).fill('word').join(' ');
      return b;
    },
    /faq 1: answer is/,
  ],
  [
    'too few content hooks is rejected',
    (b) => {
      b.contentHooks = b.contentHooks.slice(0, 3);
      return b;
    },
    /content hooks/,
  ],
];

let failed = 0;

for (const [name, mutate, expect] of CASES) {
  const errors = validateBriefing(mutate(clone()), opts);

  if (expect === null) {
    if (errors.length) {
      failed++;
      console.log(`✗ ${name}`);
      for (const e of errors) console.log(`    unexpected: ${e}`);
    } else {
      console.log(`✓ ${name}`);
    }
    continue;
  }

  const matched = errors.find((e) => expect.test(e));
  if (matched) {
    console.log(`✓ ${name}`);
  } else {
    failed++;
    console.log(`✗ ${name}`);
    console.log(`    expected an error matching ${expect}`);
    console.log(`    got: ${errors.length ? errors.join(' | ') : '(no errors — it would have published)'}`);
  }
}

console.log('');
if (failed) {
  console.error(`${failed} of ${CASES.length} guard tests failed.`);
  process.exit(1);
}
console.log(`All ${CASES.length} guard tests pass. A malformed generation cannot publish.`);
