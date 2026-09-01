# China Logistics Daily

Auto-updating daily news briefing on China logistics, freight, tariffs and
ecommerce fulfilment. Lives at **news.china-fulfillment.com**. A traffic and
authority engine for china-fulfillment.com.

Nobody touches it day to day. A GitHub Actions job reads the trade press every
morning, writes the briefing, validates it, and commits. Cloudflare Pages
deploys the commit.

---

## How it works

```
05:30 UTC  GitHub Actions
             │
             ├─ fetch      23 publisher RSS feeds        ~540 items
             ├─ filter     36h window, China + logistics  ~20 candidates
             ├─ enrich     fetch each article, extract    ~70% full text
             ├─ generate   one Sonnet call, strict JSON
             ├─ validate   shape, sources, voice, length
             └─ commit     src/content/briefings/YYYY-MM-DD.json
                             │
                          Cloudflare Pages builds and deploys
```

A run that cannot produce a briefing passing validation **exits non-zero and
commits nothing**. Actions emails the failure, yesterday's briefing stays on the
homepage, and the site never shows an error state.

## Stack

Astro 5 (static) · Tailwind CSS v4 · Cloudflare Pages · GitHub Actions ·
Anthropic API · satori + resvg for OG images.

## Commands

```bash
npm run dev              # local dev server on :4321
npm run build            # prebuild fetches fonts + OG images, then builds
npm run briefing         # run the pipeline for today, write and commit-ready
npm run briefing:dry     # run everything, print the result, write nothing
npm test                 # prove the publish gate rejects malformed generations
npm run content:check    # validate every committed briefing
npm run audit            # audit dist/ for SEO, schema, slop, links
npm run feeds:verify     # check every feed responds and is publishing
npm run check:layout     # responsive + a11y check (needs: npm i -D puppeteer)
```

`npm test`, `content:check`, `build` and `audit` all run in CI on every push.
`check:layout` drives a real browser across 7 pages at 3 viewports and is not in
CI, because pulling a Chrome download into the daily pipeline for a check that
matters at launch and after design changes is a poor trade. Run it before
cutover and after any layout work:

```bash
npm i -D puppeteer
npm run dev &
npm run check:layout
```

Useful pipeline flags:

```bash
node scripts/generate-briefing.mjs --no-llm              # stop after enrich, dump candidates (no API key needed)
node scripts/generate-briefing.mjs --date=2026-09-03     # backfill a specific day
node scripts/generate-briefing.mjs --date=2026-09-03 --force   # overwrite an existing day
```

## Repository layout

```
sources.json                  feeds + relevance keywords. Edit freely, no code changes.
tags.json                     controlled tag list, hub intros, CTA targets per tag.
scripts/
  generate-briefing.mjs       pipeline orchestrator
  lib/sources.mjs             feed fetch + parse + URL normalisation
  lib/filter.mjs              window, relevance scoring, dedupe
  lib/enrich.mjs              article fetch + Readability extraction
  lib/prompt.mjs              system + user prompts (voice rules live here)
  lib/validate.mjs            the publish gate
  fetch-fonts.mjs             Fontshare download (prebuild)
  generate-og.mjs             OG cards into public/og (prebuild)
  verify-feeds.mjs            feed health check
  validate-content.mjs        re-validate committed briefings
  audit-build.mjs             post-build SEO/schema/copy audit
src/content/briefings/        one JSON per day. This is the archive.
src/data/site.ts              site constants, URL helpers, CTA assignment
src/pages/                    routes
```

## Content model

One JSON file per day. The schema is enforced twice: by Zod in
`src/content.config.ts` at build time, and by `scripts/lib/validate.mjs` before
anything is written.

```jsonc
{
  "date": "2026-09-01",
  "title": "≤60 chars, contains China + the day's topic",
  "metaDescription": "≤155 chars",
  "bottomLine": "2–3 sentences, front-loaded with the day's biggest fact",
  "stories": [{
    "headline": "", "tldr": "", "whatHappened": "", "whyItMatters": "",
    "hotTake": "", "actions": ["…"],
    "sourceUrl": "", "sourceName": "", "tags": ["…"]
  }],
  "contentHooks": ["…"],
  "faq": [{ "question": "", "answer": "" }]
}
```

### The model never writes a URL

Two guards, and they are the reason the site can publish unattended:

1. **`sourceUrl` must be copied from the candidate list.** `validate.mjs`
   compares every `sourceUrl` against the normalised URLs actually fetched that
   run. A URL that was not in the input fails the run.
2. **Internal CTA links come from tags, not from the model.** The model picks
   tags from the controlled list in `tags.json`; `assignCtas()` maps those to
   real china-fulfillment.com service pages, spreading across distinct
   destinations so a briefing links to at least three. The model has no way to
   invent an internal link.

### What blocks a publish

`scripts/lib/validate.mjs` rejects on: fewer than 2 stories, any missing field, a
`sourceUrl` not in the fetched inputs, a tag outside `tags.json`, under 1,000
words, an over-length title or description, and any banned voice pattern (em
dashes, "here's the thing", "game-changer", US spellings in prose, and the rest
of the `stop-slop` list). One retry is attempted with the errors fed back, then
the run aborts.

## Images

Three kinds, and the distinction is deliberate.

| Where | What | Alt text |
|---|---|---|
| Topic hubs, topics index, homepage | Illustration, generated once with `google/nano-banana-pro` in one house style | Real, describing what is depicted |
| Briefing pages | Route band, inline SVG generated from the date | `aria-hidden`, it is decorative |
| Social cards | OG card per briefing, satori + resvg at build | n/a |

**Artwork never appears on an individual briefing story.** An AI-generated
image beside a news report invites the reader to take it as a photograph of the
reported event, and the site's whole claim is that nothing here is invented.
Topic hubs are evergreen and thematic, so illustration is honest there.

Alt text on the route bands is deliberately empty. They carry no information
about the day's news, and keyword alt text on a decorative graphic is stuffing:
Google discounts it and it makes the page worse for screen reader users.

Regenerate or extend the set with `node scripts/fetch-topic-art.mjs`, which
records every prompt and source URL. 18 images, 689kB total, one per page.

The image-SEO opportunity that is still open is **photographs of the actual
operation** in Shenzhen and Zhengzhou. Those would carry real alt text, and
they are worth more for E-E-A-T than any illustration.

## Structured data

One `@graph` per page with stable `@id`s, so entities resolve across the site
instead of each page being an island.

| Page type | Nodes |
|---|---|
| Every page | `Organization`, `Person`, `WebSite` |
| Briefing | `NewsArticle` (+ `about` topic entities), `FAQPage`, `BreadcrumbList` |
| Tag hub, topics index, archive | `CollectionPage` + `ItemList`, `BreadcrumbList` |
| About | `FAQPage`, `BreadcrumbList` |

`Person` carries `sameAs` to LinkedIn, china-fulfillment.com and
eriusourcing.com on every page, and gains an `image` as soon as a photo exists.

## Setup

### 1. GitHub

Create the repo, push, then add one secret:

- `ANTHROPIC_API_KEY` — Settings → Secrets and variables → Actions

Under Settings → Actions → General, set Workflow permissions to
**Read and write**, so the daily job can commit.

### 2. Cloudflare Pages

- Connect the GitHub repo
- Build command: `npm run build`
- Output directory: `dist`
- Node version: `22`
- Custom domain: `news.china-fulfillment.com` (CNAME)

Nothing else. No environment variables are needed at build time.

### 3. Seed the archive

Two briefings are committed (31 August and 1 September 2026), hand-written from
live sources and passing the validator. Add a third through the pipeline:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run briefing
```

Or trigger **Actions → Daily briefing → Run workflow** once the secret is set.

## Before DNS cutover

- [ ] **Add a photograph of Noel** at `public/noel-murphy.jpg` (`.png`/`.webp`
      also work). No code change needed: the about page swaps its placeholder
      automatically and Person schema gains an `image`. A real face is a
      material E-E-A-T signal and `/about/` is the entity anchor for the site.
- [ ] Confirm the `/about/` bio is accurate. It was written from the PRD, and
      nothing in it should go live unverified.
- [ ] Run `npm run briefing` for a third seed day.
- [ ] Verify `ANTHROPIC_API_KEY` is set, then run the workflow manually once and
      watch it commit and deploy.
- [ ] Submit `sitemap-index.xml` in Google Search Console and Bing Webmaster.
- [ ] Run `npm run check:layout` and `npx lighthouse` against the deployed URL.

## Operations

**A feed dies.** It is skipped and logged; the run continues. `npm run
feeds:verify` lists what is healthy. Remove dead entries from `sources.json`.

**A slow news day.** The pipeline widens the window from 36 to 72 hours and
re-filters. If it still cannot find enough, it publishes two stories rather than
skipping the day. Fewer than two usable candidates aborts the run.

**Generation fails validation.** One retry with the errors fed back, then abort
without committing. The Actions run fails and emails.

**Regenerate a day.** Actions → Daily briefing → Run workflow, set `date` and
tick `force`.

**Cost.** One Sonnet call per day, roughly 40–80k input and 4–6k output tokens.
Well under €0.50/day. Every run logs its token usage and an estimated cost, and
writes a job summary.

## Timezone

Everything user-facing is Europe/Dublin. The `date` field is today in Dublin, and
`publishedISO()` stamps 07:00 Dublin time with the correct DST offset. The cron
is UTC because GitHub Actions only speaks UTC.

## Typography and colour

Chosen for reading, and measured rather than assumed:

| | Value | Why |
|---|---|---|
| Body | Satoshi 18px / 1.65 | 18px reads better on a phone than the 17px it started at |
| Line length | 64 characters desktop, 43 mobile | 40rem measure; the comfortable band is 45 to 75 |
| Headlines | Boska 26px mobile, 34px desktop | High-contrast serif carries the editorial voice |
| Section labels | 12px mono, weight 600, full ink | Signposts inside a story, so they are heading-sized not caption-sized |
| Body contrast | 16.2:1 | AAA |
| Metadata contrast | 5.4:1 | AA, verified from rendered pixels |
| Tap targets | 24px minimum | WCAG 2.5.8 |

### Palette

Sampled from china-fulfillment.com so the subdomain reads as the same company.
Navy ink on a cool ground, emerald as the single accent, navy as a field for the
footer and the masthead rule.

| Token | Value | Notes |
|---|---|---|
| `--color-ink` | `#0c1a2e` | the parent site's text navy, 16.15:1 on paper |
| `--color-ink-muted` | `#42576d` | 6.90:1 |
| `--color-ink-faint` | `#51677e` | 5.41:1; datelines are 11px so no large-text exemption |
| `--color-paper` | `#f4f6fb` | the parent site's cool ground |
| `--color-brand-500` | `#047857` | accent, 5.07:1 |
| `--color-brand-600` | `#065f46` | links and hover, 7.11:1 |
| `--color-brand-400` | `#10b981` | 3.49:1, so large text and UI only |
| `--color-navy` | `#0a152a` | footer field; white on it is 18.2:1 |
| `--color-navy-faint` | `#9aacc4` | muted text on navy, 7.86:1 |

Anything on the navy field needs the `.on-navy` scope, which switches datelines
to `--color-navy-faint`. The light-ground greys drop to about 3:1 on navy.

Only two webfonts load, both self-hosted variable woff2 (88kB combined) with
`font-display: swap`. Datelines and labels use the system monospace stack, so
they cost nothing. Verify any change with `npm run check:layout`.

## Conventions

- **UK English in prose**, always. `fulfilment`, `organise`, `optimise`,
  `centre`. The exceptions are the domain `china-fulfillment.com` and the
  company's registered name, China Fulfillment. `npm run audit` enforces this.
- **Trailing slashes on every internal link.** Set once in `astro.config.mjs` and
  applied by `href()` in `src/data/site.ts`. Never hand-write an internal path.
  The audit fails the build if one slips through.
- **No em dashes anywhere**, including titles and code comments that render.

See [DECISIONS.md](DECISIONS.md) for where this build departs from the PRD and
why.
