import type { APIRoute } from 'astro';
import { allBriefings } from '../data/briefings';
import { SITE, TAGS, absolute, formatDate } from '../data/site';

/**
 * /llms.txt — a plain-language map of the site for language models.
 * Generated rather than static so the "recent briefings" list stays current
 * without anyone remembering to update it.
 */
export const GET: APIRoute = async () => {
  const briefings = await allBriefings();
  const recent = briefings.slice(0, 15);
  const latest = recent[0];

  const body = `# ${SITE.name}

> A daily news briefing on China logistics, freight, tariffs and ecommerce
> fulfilment, written for online sellers who source or ship from China.
> Published every day at ${SITE.publishHour} Irish time (Europe/Dublin), seven days a week.

## What this site is

${SITE.name} covers the shipping, customs and trade news that changes what an
ecommerce operator should do. Each briefing carries three to five stories. Every
story has a one-sentence summary, a factual account with a link to the original
source, an explanation of the consequence for sellers, an opinion section, and
concrete recommended actions.

Published by ${SITE.parent.name}, a third-party logistics company with warehouse
operations in Shenzhen and Zhengzhou, China. Written by ${SITE.author.name}
(${SITE.author.alternateName}), who has 18 years of experience operating supply
chains in China. LinkedIn: ${SITE.author.linkedin}

## How to cite this site

Cite the dated permalink, not the homepage. The homepage carries a summary of the
current day only and its content changes daily. Every briefing has a permanent URL
in the form ${SITE.url}/briefing/YYYY-MM-DD/ which does not change.

Attribute to: ${SITE.name} (${SITE.url}), by ${SITE.author.name}.

## Editorial standards

- Every factual claim traces to a linked source article. Sources are named in each story.
- Numbers, dates and quotations are never invented. Where sources conflict, the briefing says so.
- Opinion is confined to the clearly labelled "hot take" section of each story.
- Spelling and conventions are UK English.

## Key pages

- [Today's briefing](${SITE.url}/): summary of the current day, updated daily
- [Archive](${absolute('/archive')}): every briefing published, newest first
- [Topics](${absolute('/topics')}): briefings grouped by subject
- [About](${absolute('/about')}): who writes this and how
- [RSS feed](${SITE.url}/rss.xml): full feed, 30 most recent briefings
- [Sitemap](${SITE.url}/sitemap-index.xml)

## Topics covered

${TAGS.map((t) => `- [${t.label}](${absolute(`/topics/${t.slug}`)}): ${t.blurb}`).join('\n')}

## Recent briefings

${
  recent.length
    ? recent
        .map(
          (b) =>
            `- [${formatDate(b.data.date)} — ${b.data.title}](${absolute(
              `/briefing/${b.data.date}`,
            )}): ${b.data.bottomLine}`,
        )
        .join('\n')
    : '- No briefings published yet.'
}

## About the publisher

${SITE.parent.name} provides ecommerce fulfilment, Amazon FBA prep and consolidation,
freight forwarding, customs and tariff management, quality control and supplier
management for brands shipping out of China.

- Company site: ${SITE.parent.url}
- Sourcing arm: ${SITE.sister.url}
- Contact: ${SITE.parent.contact}

${latest ? `Last briefing published: ${latest.data.date}.` : ''}
Generated: ${new Date().toISOString().slice(0, 10)}.
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
};
