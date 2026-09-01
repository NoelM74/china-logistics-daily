#!/usr/bin/env node
/**
 * Daily briefing pipeline.
 *
 *   fetch feeds -> pre-filter -> enrich -> generate -> validate -> write
 *
 * Exits non-zero without writing anything if the run cannot produce a briefing
 * that passes validation. GitHub Actions turns that into a failure email, and
 * yesterday's briefing stays on the homepage (PRD §11). The site never shows an
 * error state because a failed run simply does not commit.
 *
 * Flags:
 *   --dry-run       run every stage, print the result, write nothing
 *   --date=YYYY-MM-DD   generate for a specific day (backfill / re-run)
 *   --no-llm        stop after enrichment and dump candidates (no API key needed)
 *   --force         overwrite an existing briefing for that date
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

import { log, summary } from './lib/log.mjs';
import { fetchAllFeeds } from './lib/sources.mjs';
import { selectCandidates } from './lib/filter.mjs';
import { enrichAll } from './lib/enrich.mjs';
import { SYSTEM_PROMPT, buildUserPrompt, buildRetryPrompt } from './lib/prompt.mjs';
import { validateBriefing, wordCount } from './lib/validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = path.join(ROOT, 'src', 'content', 'briefings');

// Sonnet: the daily driver for this job. Cost note in PRD §5.5.
const MODEL = process.env.BRIEFING_MODEL ?? 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 8000;
const TARGET_STORIES = '3 to 5';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const DRY_RUN = flag('dry-run');
const NO_LLM = flag('no-llm');
const FORCE = flag('force');

/** Today in Europe/Dublin — the audience's timezone (PRD §11). */
function todayInDublin() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Dublin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const DATE = opt('date') ?? todayInDublin();

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/** Headlines and source URLs from the last N briefings, for dedupe + continuity. */
async function recentBriefings(limit = 7) {
  let files = [];
  try {
    files = (await readdir(CONTENT_DIR)).filter((f) => f.endsWith('.json')).sort().reverse();
  } catch {
    return { urls: [], titles: [], headlines: [] };
  }

  const urls = [];
  const titles = [];
  const headlines = [];

  for (const f of files.slice(0, limit)) {
    try {
      const b = await readJson(path.join(CONTENT_DIR, f));
      for (const s of b.stories ?? []) {
        if (s.sourceUrl) urls.push(s.sourceUrl);
        if (s.headline) titles.push(s.headline);
      }
      if (headlines.length < 3 && b.stories?.length) {
        headlines.push(...b.stories.slice(0, 3).map((s) => s.headline));
      }
    } catch (err) {
      log.warn(`could not read ${f}`, { reason: String(err.message ?? err) });
    }
  }
  return { urls, titles, headlines: headlines.slice(0, 9) };
}

/** Strip fences and pull the outermost JSON object, defensively (PRD §5.1). */
function parseModelJson(raw) {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('no JSON object in response');

  return JSON.parse(text.slice(start, end + 1));
}

async function callModel(client, messages) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages,
    // Prefill forces the response to open as JSON, which removes the single
    // most common failure mode (a chatty preamble before the object).
  });

  const text = res.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');

  return { text, usage: res.usage, stopReason: res.stop_reason };
}

async function main() {
  log.step(`China Logistics Daily — ${DATE}`);
  if (DRY_RUN) log.info('dry run: nothing will be written');

  const outFile = path.join(CONTENT_DIR, `${DATE}.json`);
  if (!FORCE && !DRY_RUN) {
    try {
      await readFile(outFile);
      log.info(`${DATE}.json already exists. Nothing to do. Use --force to regenerate.`);
      return 0;
    } catch {
      /* not there, carry on */
    }
  }

  // ---- 1. sources ------------------------------------------------------
  log.step('fetching feeds');
  const sources = await readJson(path.join(ROOT, 'sources.json'));
  const tagsFile = await readJson(path.join(ROOT, 'tags.json'));
  const items = await fetchAllFeeds(sources.feeds);

  if (!items.length) {
    log.error('every feed failed. Aborting without commit.');
    return 1;
  }

  // ---- 2. filter -------------------------------------------------------
  log.step('filtering candidates');
  const covered = await recentBriefings(7);
  log.info('recent coverage', { urls: covered.urls.length, headlines: covered.titles.length });

  let candidates = selectCandidates({
    items,
    keywords: sources.relevanceKeywords,
    windowHours: sources.windowHours,
    recentlyCovered: covered,
    max: sources.maxCandidates,
  });

  // Slow news day: widen the window before giving up (PRD §11).
  if (candidates.length < 6) {
    log.warn(`only ${candidates.length} candidates, widening to ${sources.widenedWindowHours}h`);
    candidates = selectCandidates({
      items,
      keywords: sources.relevanceKeywords,
      windowHours: sources.widenedWindowHours,
      recentlyCovered: covered,
      max: sources.maxCandidates,
    });
  }

  if (candidates.length < 2) {
    log.error(`only ${candidates.length} usable candidates. Aborting without commit.`);
    return 1;
  }

  // ---- 3. enrich -------------------------------------------------------
  log.step('extracting article text');
  const enriched = await enrichAll(candidates);

  if (NO_LLM) {
    log.step('no-llm: candidate dump');
    for (const [i, c] of enriched.entries()) {
      console.log(
        `\n${String(i + 1).padStart(2, '0')}. [${c.score}] ${c.title}\n    ${c.sourceName} | ${c.extractSource}\n    ${c.url}\n    ${c.extract.slice(0, 220)}...`,
      );
    }
    const dumpPath = path.join(ROOT, `candidates-${DATE}.json`);
    await writeFile(dumpPath, JSON.stringify(enriched, null, 2), 'utf8');
    log.info(`wrote ${dumpPath}`);
    return 0;
  }

  // ---- 4. generate -----------------------------------------------------
  if (!process.env.ANTHROPIC_API_KEY) {
    log.error('ANTHROPIC_API_KEY is not set. Aborting without commit.');
    return 1;
  }

  log.step(`generating with ${MODEL}`);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const userPrompt = buildUserPrompt({
    date: DATE,
    candidates: enriched,
    tags: tagsFile.tags,
    recentHeadlines: covered.headlines,
    targetStories: TARGET_STORIES,
  });

  const allowedUrls = enriched.map((c) => c.url);
  const allowedTags = tagsFile.tags.map((t) => t.slug);

  const messages = [
    { role: 'user', content: userPrompt },
    { role: 'assistant', content: '{' },
  ];

  let briefing = null;
  let errors = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { text, usage, stopReason } = await callModel(client, messages);
    totalUsage.input_tokens += usage?.input_tokens ?? 0;
    totalUsage.output_tokens += usage?.output_tokens ?? 0;

    log.info(`attempt ${attempt}`, {
      in: usage?.input_tokens,
      out: usage?.output_tokens,
      stop: stopReason,
    });

    if (stopReason === 'max_tokens') {
      errors = [`response hit the ${MAX_TOKENS} token cap and was truncated`];
      log.warn(errors[0]);
    } else {
      try {
        // The assistant turn was prefilled with "{", so add it back.
        const parsed = parseModelJson(text.trimStart().startsWith('{') ? text : `{${text}`);
        errors = validateBriefing(parsed, {
          allowedUrls,
          allowedTags,
          date: DATE,
          strict: attempt === 1,
        });
        if (!errors.length) {
          briefing = parsed;
          break;
        }
        log.warn(`validation failed (${errors.length})`);
        for (const err of errors) log.warn(`  · ${err}`);
      } catch (err) {
        errors = [`could not parse JSON: ${String(err.message ?? err)}`];
        log.warn(errors[0]);
      }
    }

    if (attempt === 1) {
      log.info('retrying once with the validation errors fed back');
      messages.push(
        { role: 'assistant', content: `{${text}` },
        { role: 'user', content: buildRetryPrompt(errors) },
        { role: 'assistant', content: '{' },
      );
    }
  }

  const cost = estimateCost(totalUsage);
  log.info('token usage', {
    input: totalUsage.input_tokens,
    output: totalUsage.output_tokens,
    approxUSD: cost,
  });

  if (!briefing) {
    log.error('generation failed validation twice. Aborting without commit.');
    await summary([
      `### ❌ Briefing ${DATE} failed`,
      '',
      `Candidates: ${enriched.length}. Tokens: ${totalUsage.input_tokens} in / ${totalUsage.output_tokens} out (~$${cost}).`,
      '',
      'Validation errors:',
      ...errors.map((e) => `- ${e}`),
    ]);
    return 1;
  }

  // ---- 5. write --------------------------------------------------------
  briefing.generatedAt = new Date().toISOString();
  briefing.model = MODEL;
  briefing.sourceCount = enriched.length;

  const wc = wordCount(briefing);
  log.step('result');
  log.info(`"${briefing.title}"`);
  log.info('shape', {
    stories: briefing.stories.length,
    hooks: briefing.contentHooks.length,
    faq: briefing.faq.length,
    words: wc,
  });
  for (const s of briefing.stories) log.info(`  · ${s.headline}  [${s.tags.join(', ')}]`);

  if (DRY_RUN) {
    console.log('\n' + JSON.stringify(briefing, null, 2));
    log.info('dry run: not written');
    return 0;
  }

  await mkdir(CONTENT_DIR, { recursive: true });
  await writeFile(outFile, `${JSON.stringify(briefing, null, 2)}\n`, 'utf8');
  log.info(`wrote ${path.relative(ROOT, outFile)}`);

  await summary([
    `### ✅ Briefing ${DATE}`,
    '',
    `**${briefing.title}**`,
    '',
    briefing.bottomLine,
    '',
    `| | |`,
    `|---|---|`,
    `| Stories | ${briefing.stories.length} |`,
    `| Words | ${wc} |`,
    `| Candidates considered | ${enriched.length} |`,
    `| Tokens | ${totalUsage.input_tokens} in / ${totalUsage.output_tokens} out |`,
    `| Approx cost | $${cost} |`,
    '',
    ...briefing.stories.map((s) => `- ${s.headline}`),
  ]);

  return 0;
}

/** Rough Sonnet pricing, for the per-run cost line in the Actions log. */
function estimateCost({ input_tokens = 0, output_tokens = 0 }) {
  return ((input_tokens / 1e6) * 3 + (output_tokens / 1e6) * 15).toFixed(4);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log.error('unhandled failure', { reason: String(err?.stack ?? err) });
    process.exit(1);
  });
