# Decisions

Where this build differs from the PRD, or where the PRD left the call open.
Each entry says what was decided, why, and what it would take to reverse.

---

## 1. Google News RSS feeds removed from the source list

**PRD §5.2** names Google News query feeds as "the backbone" of the source list.
They are not in `sources.json`.

**Why.** Google News RSS no longer exposes publisher URLs. Every item link is an
opaque redirector (`news.google.com/rss/articles/CBMi...`) whose real destination
resolves only in a JavaScript browser. Verified during the build:

- The `?url=` query parameter is gone from the modern format.
- The article ID decodes to a protobuf that contains a server-side token, not a URL.
- The `batchexecute` endpoint that used to resolve those tokens now returns an
  empty response.
- Fetching the redirector with any user agent returns a consent wall or a JS
  redirect page, never a `Location` header pointing at the publisher.

Keeping them would have broken three hard requirements at once:

| Requirement | What the redirector does to it |
|---|---|
| §4.1.3 link to the original source | Cites a Google URL, not the publisher |
| §5.1.3 extract article text | Readability gets a consent page, so every story runs on a one-line RSS stub |
| §5.1.5 hallucination guard | The guard compares `sourceUrl` against fetched inputs; a token we never resolved cannot be checked |

**Instead.** The feed list was rebuilt around direct publisher feeds, verified
with `npm run feeds:verify`. 23 feeds, all live, tagged by `topic` so relevance
scoring knows whether China or logistics is the implicit half. Current funnel on
a normal day: ~540 items fetched, ~190 in the 36-hour window, ~20 candidates,
about 70% with full article text.

`fetchFeed()` also drops any item still pointing at an aggregator redirector, so
one can never reach a briefing even if a query feed is added back later.

**To reverse.** Add the query feeds to `sources.json` with `"type": "query"`, and
either resolve the redirectors with a headless browser in the enrich step, or
relax the citation requirement. The parsing code for query feeds is still there.

---

## 2. The homepage runs an excerpt, not the full briefing

**PRD §6.2** offers two ways to handle today's content appearing on both `/` and
`/briefing/YYYY-MM-DD/`, and says to pick one. Picked: the excerpt.

**Why.** The canonical-tag approach mitigates duplication; the excerpt removes
it. The dated permalink owns the full text outright, so its authority is never
split with a homepage whose content changes every day. That matters because the
archive and the tag hubs are the long-term SEO structure, and they are built out
of dated URLs.

GEO is not sacrificed. The blocks written to be quoted are all still on the
homepage, above the fold: the bottom line in full, every story headline, and
every TL;DR, plus today's FAQ. What the homepage omits is the long-form body,
which is exactly the part that would have been duplicated.

**To reverse.** Render `StoryBlock` in `src/pages/index.astro` instead of the
headline and TL;DR list, and point `mainEntityOfPage` at the dated URL.

---

## 3. Seeded with two briefings, not three

**PRD §12** asks for three days of seed briefings before DNS cutover.

**Why two.** The seeds are hand-written from live fetched sources rather than
generated, because the generation step needs `ANTHROPIC_API_KEY`, which lives
with the repo owner. A single fetch window contained genuinely dated source
material for two days (31 August and 1 September 2026) and one day's worth for
30 August. Writing a third briefing would have meant presenting stories under a
date before they were published.

Both seeds pass the pipeline's own validator (`npm run content:check`) and every
factual claim traces to the linked source.

**To finish the job.** Run the pipeline for a third day once the API key is set:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run briefing
```

---

## 4. OG images are generated at build time, not served from a route

Originally an Astro endpoint at `/og/[route].png`. Moved to
`scripts/generate-og.mjs`, which writes into `public/og/`.

**Why.** The site-wide `trailingSlash: 'always'` policy applied to the endpoint
and produced `og:image` URLs ending `.png/`, which no social scraper accepts.
Generating into `public/` sidesteps route semantics entirely, keeps the images as
plain static files, and means a satori failure degrades one card to a plain brand
card rather than failing the whole build. Existing files are skipped, so a daily
build renders one image rather than the entire archive.

---

## 5. Satori needs static font weights

`scripts/fetch-fonts.mjs` pulls five files: three variable woff2 for the browser,
and two pinned static TTFs (`Boska-Bold`, `Satoshi-Medium`) for OG rendering.
opentype.js, which satori uses, throws parsing the `fvar` table of a variable
font. The Fontshare CSS API is queried per family because it silently ignores
every `f[]` parameter after the first.

Fonts are fetched at build time rather than committed. If Fontshare is
unreachable the build continues on the fallback stacks and OG cards render as
plain brand cards.

---

## 6. Em dashes are banned in the site's own copy too

`scripts/lib/validate.mjs` blocks em dashes in generated briefings. The same rule
is applied to hand-written page copy and to page titles, which use a pipe
separator. `npm run audit` enforces it against rendered HTML, so the site chrome
cannot drift from the standard the generator is held to.

---

## 7. `/subscribe/` is noindex until it does something

Email capture is Phase 2 (PRD §12). Rather than ship a form that drops
addresses, the page offers RSS today, says plainly that email is coming, and
carries `noindex` so it cannot rank as a dead end. Wiring an ESP in later is a
change to one file.

---

## 8. Re-skinned to the live parent-site palette, not the PRD's

**PRD §7** specifies jade `#01696F` on off-white `#F7F6F2` as "the
china-fulfillment.com brand system". The site was built to that and then
re-skinned, because sampling the live parent site showed it is navy, not jade.

Measured across three pages of china-fulfillment.com: dominant fields
`#0a152a` / `#0c1a2e` / `#0d2144` navy, ground `#f4f6fb` cool grey, secondary
text `#4a6178` slate, borders `#dae0ec`, and an emerald accent
`#059669` / `#047857`. Jade `#01696F` appears nowhere.

Keeping jade would have missed the point of §7, which is that the subdomain
should read as the same company.

**Mapping.** Navy became the ink and the footer field; emerald became the single
structural accent, taking jade's role unchanged; the ground went cool. Every
value was contrast-checked before use, and the masthead stayed light because a
dark sticky bar costs 11% of a phone screen on a text-heavy daily read.

**To reverse.** The palette is nine tokens in the `@theme` block of
`src/styles/global.css` plus the constants at the top of
`scripts/generate-og.mjs`. Nothing else hardcodes a colour.

---

## 9. Two-story briefings are allowed, three preferred

The validator's hard floor is two stories, matching PRD §11 ("publish a 2-story
briefing rather than skipping the day"). The first generation attempt is run in
strict mode, which also requires three; if that fails, the retry accepts two.
Daily cadence wins over story count, but only after asking twice.
