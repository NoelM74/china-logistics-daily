#!/usr/bin/env node
/**
 * Run the real briefing prompt against several models and score every result
 * with the real validator.
 *
 * Choosing a model from its spec sheet is guessing. Parameter counts and
 * context windows say nothing about whether a model can hold a voice, keep to
 * UK spelling, avoid a list of banned phrases and copy a URL without tidying
 * it. Those are the things this pipeline actually needs, and the validator
 * already knows how to check all of them.
 *
 * Every model gets byte-identical input, so the comparison is fair. Each one's
 * output is written out in full, because the half of this that matters most,
 * whether the prose sounds like a person who ships containers, is a judgement
 * no validator can make for you. Read them.
 *
 *   node scripts/bake-off.mjs
 *   node scripts/bake-off.mjs --models=z-ai/glm-5.3,moonshotai/kimi-k3
 *   node scripts/bake-off.mjs --include-claude    # score the incumbent too
 *   node scripts/bake-off.mjs --runs=3            # same model several times
 *
 * Needs NVIDIA_API_KEY. --include-claude also needs ANTHROPIC_API_KEY.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from './lib/log.mjs';
import { fetchAllFeeds } from './lib/sources.mjs';
import { selectCandidates } from './lib/filter.mjs';
import { enrichAll } from './lib/enrich.mjs';
import { SYSTEM_PROMPT, buildUserPrompt, buildRetryPrompt } from './lib/prompt.mjs';
import { validateBriefing, wordCount } from './lib/validate.mjs';
import { createProvider, explainApiError } from './lib/llm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'bake-off');

const argv = process.argv.slice(2);
const opt = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const flag = (n) => argv.includes(`--${n}`);

/*
 * The shortlist, and why each one is on it.
 *
 * All three of the big open Chinese models carry a 1M context and advertise
 * structured output, so none of them will struggle with the mechanics of the
 * job. The interesting question is prose: these are models trained heavily on
 * American English, and this publication is British. Expect the US-spelling
 * check to be where they lose points, and watch whether the hot takes have an
 * opinion in them or just summarise.
 */
const SHORTLIST = [
  'z-ai/glm-5.3',
  'moonshotai/kimi-k3',
  'deepseek-ai/deepseek-v4.1-flash',
  'z-ai/glm-5.3-flash',
  'nvidia/nemotron-3-ultra-550b-a55b',
];

const DATE =
  opt('date') ??
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const RUNS = Number(opt('runs') ?? 1);
const MAX_TOKENS = Number(opt('max-tokens') ?? 8000);
const MODELS = (opt('models')?.split(',').map((m) => m.trim()).filter(Boolean) ?? SHORTLIST).map(
  (m) => ({ provider: 'nvidia', model: m }),
);
if (flag('include-claude')) {
  MODELS.push({ provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' });
}

/** Cache the candidate set so every model is judged on identical input. */
async function getCandidates() {
  const cached = path.join(OUT_DIR, `candidates-${DATE}.json`);
  try {
    const hit = JSON.parse(await readFile(cached, 'utf8'));
    log.info(`reusing ${hit.length} cached candidates (delete ${path.relative(ROOT, cached)} to refetch)`);
    return hit;
  } catch {
    /* fetch below */
  }

  log.step('fetching feeds');
  const sources = JSON.parse(await readFile(path.join(ROOT, 'sources.json'), 'utf8'));
  const items = await fetchAllFeeds(sources.feeds);

  // Same selection the real pipeline makes, minus the recent-coverage filter:
  // a bake-off wants today's best candidates, not today's uncovered ones.
  let candidates = selectCandidates({
    items,
    keywords: sources.relevanceKeywords,
    windowHours: sources.windowHours,
    recentlyCovered: { urls: [], titles: [] },
    max: sources.maxCandidates,
  });
  if (candidates.length < 6) {
    candidates = selectCandidates({
      items,
      keywords: sources.relevanceKeywords,
      windowHours: sources.widenedWindowHours,
      recentlyCovered: { urls: [], titles: [] },
      max: sources.maxCandidates,
    });
  }
  const enriched = await enrichAll(candidates);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(cached, JSON.stringify(enriched, null, 2), 'utf8');
  return enriched;
}

/** The checks worth reporting separately, because they say different things. */
function categorise(errors) {
  const bucket = (re) => errors.filter((e) => re.test(e)).length;
  return {
    voice: bucket(/banned|slop|em dash|adverb/i),
    spelling: bucket(/US spelling/i),
    sources: bucket(/sourceUrl|source material/i),
    shape: bucket(/missing|minimum|maximum|max \d|chars|tags|too thin/i),
    length: bucket(/\bwords\b/i),
  };
}

/*
 * Scored the way production runs, not on a single shot: up to three attempts,
 * the first held to the strict rules, each retry fed the previous failures.
 * No model passes attempt one cleanly, Claude included, so a one-shot test
 * measures nothing useful. What matters is whether a model reaches a
 * publishable briefing inside the loop, how many attempts it needs, and
 * whether it ever invents a source or slips into slop along the way.
 */
const MAX_ATTEMPTS = 3;

/** "z-ai/glm-5.3" -> "z-ai_glm-5.3", safe as a file name. */
const fileSlug = (model) => model.split('/').join('_');

async function score(entry, candidates, tagsFile, userPrompt, run) {
  const label = `${entry.model}${RUNS > 1 ? ` #${run}` : ''}`;
  const t0 = Date.now();
  const secs = () => Math.round((Date.now() - t0) / 1000);

  let provider;
  try {
    provider = createProvider(entry.provider, { model: entry.model, maxTokens: MAX_TOKENS });
  } catch (err) {
    return { label, ok: false, note: String(err.message ?? err) };
  }

  const turns = [{ role: 'user', content: userPrompt }];
  const seen = { voice: 0, spelling: 0, sources: 0 };
  let firstErrors = null;
  let errors = [];
  let parsed = null;
  let passedAt = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    let res;
    try {
      res = await provider.complete({ system: SYSTEM_PROMPT, turns });
    } catch (err) {
      const hint = explainApiError(err);
      const note = hint ?? String(err.cause?.code ?? err.message ?? err).slice(0, 160);
      if (attempt === 1) return { label, ok: false, seconds: secs(), note };
      errors = [`attempt ${attempt} errored: ${note}`];
      break;
    }

    if (res.stopReason === 'length') {
      errors = [`response hit the ${MAX_TOKENS} token cap and was truncated`];
    } else {
      try {
        const a = res.text.indexOf('{');
        const b = res.text.lastIndexOf('}');
        if (a === -1 || b === -1) throw new Error('no JSON object in the response');
        parsed = JSON.parse(res.text.slice(a, b + 1));
        errors = validateBriefing(parsed, {
          allowedUrls: candidates.map((c) => c.url),
          allowedTags: tagsFile.tags.map((t) => t.slug),
          date: parsed.date ?? DATE,
          strict: attempt === 1,
        });
      } catch (err) {
        await writeFile(path.join(OUT_DIR, `${fileSlug(entry.model)}-raw-${attempt}.txt`), res.text, 'utf8');
        errors = [`could not parse JSON: ${String(err.message ?? err)}`];
      }
    }

    const c = categorise(errors);
    seen.voice += c.voice;
    seen.spelling += c.spelling;
    seen.sources += c.sources;
    if (attempt === 1) firstErrors = errors;
    log.info(`attempt ${attempt}: ${errors.length ? `${errors.length} errors` : 'passes'} (${secs()}s)`);
    for (const e of errors.slice(0, 5)) log.warn(`  · ${e}`);

    if (!errors.length) {
      passedAt = attempt;
      break;
    }
    turns.push({ role: 'assistant', content: res.text }, { role: 'user', content: buildRetryPrompt(errors) });
  }

  let file = null;
  if (parsed) {
    file = path.join(OUT_DIR, `${fileSlug(entry.model)}${RUNS > 1 ? `-${run}` : ''}.json`);
    await writeFile(file, `${JSON.stringify(parsed, null, 2)}
`, 'utf8');
  }

  return {
    label,
    ok: passedAt !== null,
    passedAt,
    attempts,
    seconds: secs(),
    firstErrors: firstErrors ?? [],
    errors,
    seen,
    words: parsed ? wordCount(parsed) : 0,
    stories: parsed?.stories?.length ?? 0,
    sample: parsed?.stories?.[0]?.hotTake ?? '',
    file: file ? path.relative(ROOT, file) : null,
  };
}

async function main() {
  log.step(`bake-off — ${MODELS.length} model(s), ${RUNS} run(s) each`);

  const candidates = await getCandidates();
  const tagsFile = JSON.parse(await readFile(path.join(ROOT, 'tags.json'), 'utf8'));
  const userPrompt = buildUserPrompt({
    date: DATE,
    candidates,
    tags: tagsFile.tags,
    recentHeadlines: [],
    targetStories: '3 to 5',
  });
  log.info(`identical input for every model: ${candidates.length} candidates`);

  const results = [];
  for (const entry of MODELS) {
    for (let run = 1; run <= RUNS; run++) {
      log.step(`${entry.model}${RUNS > 1 ? ` (run ${run})` : ''}`);
      const r = await score(entry, candidates, tagsFile, userPrompt, run);
      results.push(r);

      if (r.note) log.warn(r.note);
      else log.info(r.ok ? `published on attempt ${r.passedAt} after ${r.seconds}s` : `no publishable briefing after ${r.attempts} attempts`);
    }
  }

  // ---- table -----------------------------------------------------------
  const pad = (x, n) => String(x).padEnd(n);
  console.log('\n');
  console.log(`  ${pad('model', 34)}${pad('result', 14)}${pad('1st', 5)}${pad('voice', 7)}${pad('spell', 7)}${pad('src', 5)}${pad('words', 7)}${pad('secs', 6)}`);
  console.log(`  ${'-'.repeat(84)}`);
  for (const r of results) {
    if (r.note) {
      console.log(`  ${pad(r.label, 34)}${pad('no answer', 14)}${r.note.slice(0, 40)}`);
      continue;
    }
    const result = r.ok ? `yes, try ${r.passedAt}` : `no (${r.attempts} tries)`;
    console.log(
      `  ${pad(r.label, 34)}${pad(result, 14)}${pad(r.firstErrors.length, 5)}` +
        `${pad(r.seen.voice, 7)}${pad(r.seen.spelling, 7)}${pad(r.seen.sources, 5)}${pad(r.words, 7)}${pad(r.seconds, 6)}`,
    );
  }

  console.log('\n  result = publishable within the same 3-attempt loop production uses   1st = errors on the strict first attempt');
  console.log('  voice / spell / src = slop, US spellings and invented source URLs, summed over every attempt. src should be 0.\n');
  console.log('  Passing is the floor, not the verdict. Read the hot takes before you choose:\n');
  for (const r of results) {
    if (!r.sample) continue;
    console.log(`  ${r.label}`);
    console.log(`    "${r.sample.slice(0, 190)}${r.sample.length > 190 ? '…' : ''}"`);
    if (r.file) console.log(`    ${r.file}\n`);
  }

  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    const hint = explainApiError(err);
    if (hint) log.error(hint);
    log.error('bake-off failed', { reason: String(err?.stack ?? err) });
    process.exit(1);
  });
