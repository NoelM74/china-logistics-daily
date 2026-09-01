import type { APIRoute } from 'astro';
import { SITE } from '../data/site';

/**
 * Generated rather than static, so the Sitemap directive is always derived
 * from SITE.url. A hardcoded domain in public/robots.txt is exactly the kind
 * of thing that silently rots after a domain move.
 */

/** Search crawlers. Everything is open. */
const SEARCH = ['*', 'Googlebot', 'Bingbot', 'DuckDuckBot', 'Slurp', 'Baiduspider', 'YandexBot'];

/**
 * AI crawlers, explicitly welcomed. Being cited by these is the point of the
 * site rather than a side effect (PRD §9), so they are named individually
 * instead of relying on the wildcard.
 */
const AI = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'Claude-SearchBot',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot',
  'Applebot-Extended',
  'CCBot',
  'meta-externalagent',
  'Amazonbot',
  'DuckAssistBot',
  'cohere-ai',
  'YouBot',
  'Bytespider',
  'Diffbot',
  'omgili',
  'Timpibot',
];

export const GET: APIRoute = async () => {
  const block = (agents: string[]) =>
    agents.map((a) => `User-agent: ${a}\nAllow: /`).join('\n\n');

  const body = `# ${SITE.name} — ${SITE.url}
# A daily briefing on China logistics, freight, tariffs and ecommerce fulfilment.

${block(SEARCH)}

# --- AI and answer engines, explicitly welcomed --------------------------
# Being cited by these is the point of this site, not a side effect.
# Attribution guidance for models is at ${SITE.url}/llms.txt

${block(AI)}

Sitemap: ${SITE.url}/sitemap-index.xml
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
