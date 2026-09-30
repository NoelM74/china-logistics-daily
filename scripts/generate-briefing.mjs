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
import { log, summary } from './lib/log.mjs';
import { fetchAllFeeds } from './lib/sources.mjs';
import { selectCandidates } from './lib/filter.mjs';
import { enrichAll } from './lib/enrich.mjs';
import { SYSTEM_PROMPT, buildUserPrompt, buildRetryPrompt } from './lib/prompt.mjs';
import { validateBriefing, wordCount, normaliseBriefing } from './lib/validate.mjs';
import { createProvider, explainApiError, DEFAULT_MODELS } from './lib/llm.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIR = path.join(ROOT, 'src', 'content', 'briefings');

/*
 * Who writes the briefing. BRIEFING_PROVIDER is "nvidia" (the free
 * build.nvidia.com catalogue) or "anthropic" (Claude). BRIEFING_FALLBACK names
 * a second provider, used only when the first cannot produce a briefing that
 * validates, so a free tier with no SLA cannot cost a day of the archive.
 */
// `||`, not `??`, throughout: an unset GitHub repository variable reaches the
// job as an empty string, which `??` lets straight through.
const env = (k) => process.env[k]?.trim() || undefined;
const PROVIDER = (env('BRIEFING_PROVIDER') || 'anthropic').toLowerCase();
const FALLBACK = (env('BRIEFING_FALLBACK') || '').toLowerCase();
const MODEL = env('BRIEFING_MODEL') || DEFAULT_MODELS[PROVIDER] || DEFAULT_MODELS.anthropic;
const MAX_TOKENS = Number(env('BRIEFING_MAX_TOKENS')) || 8000;
const TARGET_STORIES = '3 to 5';

// Three, not two. The retry that fixes the length routinely breaks something
// else (a starved story, a lost tag), and with only two attempts that second
// error lost the day: 28 and 30 September. A third attempt costs a few cents on
// a bad day and nothing on a good one.
const MAX_ATTEMPTS = 3;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const DRY_RUN = flag('dry-run');
const NO_LLM = flag('no-llm');
const FORCE = flag('force');

/**
 * Today in Asia/Shanghai, which is the edition's calendar. Runs start from
 * 16:00 UTC, when it is already the next morning in China, so the date must
 * come from there rather than from the runner's clock.
 */
function todayInEditionZone() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const DATE = opt('date') ?? todayInEditionZone();

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
  const userPrompt = buildUserPrompt({
    date: DATE,
    candidates: enriched,
    tags: tagsFile.tags,
    recentHeadlines: covered.headlines,
    targetStories: TARGET_STORIES,
  });

  const allowedUrls = enriched.map((c) => c.url);
  const allowedTags = tagsFile.tags.map((t) => t.slug);

  let briefing = null;
  let errors = [];
  let usedModel = MODEL;
  const totalUsage = { input_tokens: 0, output_tokens: 0 };

  /*
   * One provider, two attempts. The first is held to the strict rules; the
   * second gets the failures fed back and slightly looser limits, so a day is
   * never lost over a detail the model can fix when told what it was.
   */
  async function attemptWith(provider, model) {
    const turns = [{ role: 'user', content: userPrompt }];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { text, usage, stopReason } = await provider.complete({
        system: SYSTEM_PROMPT,
        turns,
      });
      totalUsage.input_tokens += usage?.input_tokens ?? 0;
      totalUsage.output_tokens += usage?.output_tokens ?? 0;

      log.info(`attempt ${attempt}`, {
        in: usage?.input_tokens,
        out: usage?.output_tokens,
        stop: stopReason,
      });

      if (stopReason === 'length') {
        errors = [`response hit the ${MAX_TOKENS} token cap and was truncated`];
        log.warn(errors[0]);
      } else {
        try {
          const parsed = normaliseBriefing(parseModelJson(text));
          errors = validateBriefing(parsed, {
            allowedUrls,
            allowedTags,
            date: DATE,
            strict: attempt === 1,
          });
          if (!errors.length) {
            usedModel = model;
            return parsed;
          }
          log.warn(`validation failed (${errors.length})`);
          for (const err of errors) log.warn(`  · ${err}`);
        } catch (err) {
          errors = [`could not parse JSON: ${String(err.message ?? err)}`];
          log.warn(errors[0]);
          // Say what came back. Kimi once answered a retry with 32 tokens and
          // the log gave no way to tell what they were.
          log.warn(`  response began: ${JSON.stringify(String(text).slice(0, 240))}`);
        }
      }

      if (attempt < MAX_ATTEMPTS) {
        log.info('retrying once with the validation errors fed back');
        turns.push(
          { role: 'assistant', content: text },
          { role: 'user', content: buildRetryPrompt(errors) },
        );
      }
    }
    return null;
  }

  /*
   * Providers in order of preference. The fallback exists because the free
   * NVIDIA tier has no SLA: it is a fine way to write a newspaper and a poor
   * way to guarantee one. It only costs money on the days the first choice
   * cannot deliver.
   */
  const chain = [
    { name: PROVIDER, model: MODEL },
    ...(FALLBACK && FALLBACK !== PROVIDER
      ? [{ name: FALLBACK, model: env('BRIEFING_FALLBACK_MODEL') || DEFAULT_MODELS[FALLBACK] }]
      : []),
  ];

  for (const [i, link] of chain.entries()) {
    let provider;
    try {
      provider = createProvider(link.name, { model: link.model, maxTokens: MAX_TOKENS });
    } catch (err) {
      log.warn(`${link.name}: ${String(err.message ?? err)}`);
      continue;
    }

    log.step(`generating with ${link.name} / ${link.model}${i > 0 ? ' (fallback)' : ''}`);
    try {
      briefing = await attemptWith(provider, link.model);
    } catch (err) {
      const hint = explainApiError(err);
      log.warn(`${link.name} failed: ${String(err.message ?? err).slice(0, 200)}`);
      if (hint) log.warn(hint);
      errors = [`${link.name}: ${String(err.message ?? err).slice(0, 200)}`];
    }
    if (briefing) break;
    if (i < chain.length - 1) log.warn(`falling back to ${chain[i + 1].name}`);
  }

  const cost = estimateCost(totalUsage, usedModel);
  log.info('token usage', {
    input: totalUsage.input_tokens,
    output: totalUsage.output_tokens,
    approxUSD: cost,
  });

  if (!briefing) {
    log.error('generation failed validation on every attempt. Aborting without commit.');
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
  briefing.model = usedModel;
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

/**
 * Rough per-run cost for the Actions log. The build.nvidia.com catalogue is
 * free at the tier this runs on, so a NVIDIA run reports zero rather than
 * quietly showing Anthropic's prices for tokens nobody was billed for.
 */
function estimateCost({ input_tokens = 0, output_tokens = 0 }, model = MODEL) {
  if (!/^claude/.test(model)) return '0.0000';
  return ((input_tokens / 1e6) * 3 + (output_tokens / 1e6) * 15).toFixed(4);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const hint = explainApiError(err);
    if (hint) log.error(hint);
    log.error('unhandled failure', { reason: String(err?.stack ?? err) });
    process.exit(1);
  });
