#!/usr/bin/env node
/**
 * Run every committed briefing through the same validator the pipeline uses.
 *
 * Catches a hand-edited or hand-authored briefing that would have been
 * rejected had the generator produced it. Runs in CI on every push.
 *
 *   npm run content:check
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBriefing, wordCount } from './lib/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src', 'content', 'briefings');

const tags = JSON.parse(await readFile(path.join(ROOT, 'tags.json'), 'utf8'));
const allowedTags = tags.tags.map((t) => t.slug);

let files = [];
try {
  files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort();
} catch {
  console.log('No briefings directory yet. Nothing to check.');
  process.exit(0);
}

if (!files.length) {
  console.log('No briefings committed yet. Nothing to check.');
  process.exit(0);
}

let failed = 0;

for (const file of files) {
  const date = file.replace(/\.json$/, '');
  const briefing = JSON.parse(await readFile(path.join(DIR, file), 'utf8'));

  // Committed briefings are checked against their own source URLs: the point
  // here is voice, shape and spelling, not re-litigating where they came from.
  const allowedUrls = (briefing.stories ?? []).map((s) => s.sourceUrl).filter(Boolean);

  const errors = validateBriefing(briefing, {
    allowedUrls,
    allowedTags,
    date,
    strict: false,
  });

  const wc = wordCount(briefing);
  if (errors.length) {
    failed++;
    console.log(`\n✗ ${file}  (${wc} words)`);
    for (const e of errors) console.log(`    · ${e}`);
  } else {
    console.log(`✓ ${file}  ${wc} words, ${briefing.stories.length} stories`);
  }
}

console.log('');
if (failed) {
  console.error(`${failed} of ${files.length} briefings failed validation.`);
  process.exit(1);
}
console.log(`All ${files.length} briefings pass.`);
