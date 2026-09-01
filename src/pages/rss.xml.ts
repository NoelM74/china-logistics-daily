import type { APIRoute } from 'astro';
import { allBriefings } from '../data/briefings';
import { SITE, absolute, publishedISO } from '../data/site';

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const GET: APIRoute = async () => {
  const briefings = (await allBriefings()).slice(0, 30);
  const updated = briefings[0] ? publishedISO(briefings[0].data.date) : new Date().toISOString();

  const items = briefings
    .map((b) => {
      const url = absolute(`/briefing/${b.data.date}`);
      // Bottom line plus every headline and TL;DR — a reader should get the
      // gist without leaving their feed reader.
      const body = [
        `<p><strong>${esc(b.data.bottomLine)}</strong></p>`,
        '<ol>',
        ...b.data.stories.map(
          (s) => `<li><strong>${esc(s.headline)}</strong><br />${esc(s.tldr)}</li>`,
        ),
        '</ol>',
        `<p><a href="${url}">Read the full briefing</a></p>`,
      ].join('');

      return `    <item>
      <title>${esc(b.data.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(publishedISO(b.data.date)).toUTCString()}</pubDate>
      <dc:creator>${esc(SITE.author.name)}</dc:creator>
      <description>${esc(b.data.metaDescription)}</description>
      <content:encoded><![CDATA[${body}]]></content:encoded>
${[...new Set(b.data.stories.flatMap((s) => s.tags))]
  .map((t) => `      <category>${esc(t)}</category>`)
  .join('\n')}
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(SITE.name)}</title>
    <link>${SITE.url}</link>
    <atom:link href="${SITE.url}/rss.xml" rel="self" type="application/rss+xml" />
    <description>${esc(SITE.description)}</description>
    <language>en-gb</language>
    <lastBuildDate>${new Date(updated).toUTCString()}</lastBuildDate>
    <managingEditor>noreply@china-fulfillment.com (${esc(SITE.author.name)})</managingEditor>
    <ttl>360</ttl>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
};

