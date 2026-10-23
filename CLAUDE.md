# China Logistics Daily

Astro 5 + Tailwind 4 static site at https://chinalogisticsdaily.com (Cloudflare Worker, static assets).
A model writes one briefing a day; GitHub Actions validates, commits and publishes it. Nobody reads it first,
so the validators are the editor. Repo: NoelM74/china-logistics-daily.

## Commands
- `npm test` runs the 19 guard tests for the publish gate. Run it after touching `scripts/lib/validate.mjs`.
- `npm run content:check` validates every committed briefing. `npm run build` then `npm run audit` checks the built site.
- `npm run briefing:dry` runs the whole pipeline without writing. `npm run bake-off` scores models (needs `NVIDIA_API_KEY`).

## How the daily run works
- Edition is dated and published on **Asia/Shanghai**, live by 08:00. Set in `SITE.timeZone` (`src/data/site.ts`).
- `daily-briefing.yml` has three cron slots (16:17, 18:43, 21:29 UTC). GitHub starts them late. The generator is
  idempotent: the first slot to write the day's file wins, the rest exit.
- Writer is chosen by repo **variables**, not code: `BRIEFING_PROVIDER`, `BRIEFING_MODEL` (comma list, tried in order),
  `BRIEFING_FALLBACK`. Provider code is `scripts/lib/llm.mjs`. Today: NVIDIA, Gemma 4 then DeepSeek V4.1 Flash.
- Free NVIDIA models get withdrawn without notice. `model-watch.yml` checks daily and opens a `model-watch` issue.
- `pipeline-failure` issues open and close themselves (alarm job in `daily-briefing.yml`).

## Rules that have already cost us a day
- Never hand-edit `src/content/briefings/*.json`. A hook blocks it. Regenerate with `gh workflow run "Daily briefing" -f date=YYYY-MM-DD -f force=true`.
- Read env vars with `||`, never `??`. An unset GitHub variable arrives as `""`, and `??` lets it through.
- `scripts/lib/validate.mjs` must be at least as strict as `scripts/audit-build.mjs` on anything the audit checks.
  Otherwise a failure lands after the retries are spent.
- US-spelling checks match lowercase only. `Labor` and `Defense` are American proper nouns.
- Reasoning is off for NVIDIA calls (`chat_template_kwargs`). With it on, models spent the whole token budget thinking.
- NVIDIA calls use an undici Agent with no headers timeout. Node's default fetch cuts at 300s.
- Verify a model with a real dry run or bake-off. Being listed on NVIDIA does not mean it answers.

## Site conventions
- UK English. No em dashes in copy. Typographic quotes are applied at load time (`src/data/typography.ts`).
- Every internal link goes through `href()` so it ends in a trailing slash.
- Type: Satoshi for headings and body, Boska for the masthead wordmark only. Boska in headlines was unreadable on phones.
- Illustrations (`public/topics/`) go on topic hubs and the homepage, never on a briefing story.
- The domain is set once in `SITE.url`. `robots.txt` and `llms.txt` are generated from it.

## Working here
- The bot commits briefings to `main`. Run `git pull --rebase origin main` before every push.
- LF/CRLF warnings on commit are normal on this machine. Ignore them.
- Never commit `graphify-out/`, `bake-off/` or `candidates-*.json` (gitignored).
- The user's terminal is PowerShell. Give PowerShell syntax for anything they run (`$env:X = 'y'; cmd`), not `X=y cmd`.
- Never ask for API keys in chat. Use `gh secret set NAME -R NoelM74/china-logistics-daily`, which prompts privately.
