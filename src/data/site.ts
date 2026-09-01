import tagsData from '../../tags.json';

export const SITE = {
  name: 'China Logistics Daily',
  shortName: 'CLD',
  url: 'https://news.china-fulfillment.com',
  tagline: 'The daily China logistics briefing for people who actually ship',
  description:
    'A daily briefing on China logistics, freight, tariffs and ecommerce fulfilment, written for sellers who ship from China. Published every morning, 07:00 Irish time.',
  locale: 'en_IE',
  lang: 'en-GB',
  timeZone: 'Europe/Dublin',
  publishHour: '07:00',
  parent: {
    name: 'China Fulfillment',
    url: 'https://www.china-fulfillment.com/',
    contact: 'https://www.china-fulfillment.com/contact-us.html',
    about: 'https://www.china-fulfillment.com/about-us.html',
  },
  sister: { name: 'Ériu Sourcing', url: 'https://eriusourcing.com/' },
  author: {
    name: 'Noel Murphy',
    // The name he trades under in China. Goes into Person.alternateName so the
    // two forms resolve to one entity.
    alternateName: 'Noel Murphy 墨菲',
    role: 'Founder, China Fulfillment',
    // Kept short because it is embedded in Person schema on every page.
    bio: '18 years operating supply chains in China. Runs fulfilment out of Shenzhen and Zhengzhou for ecommerce brands shipping worldwide.',
    url: 'https://news.china-fulfillment.com/about/',
    // Canonical www host rather than the cn. regional mirror: same profile,
    // but this is the form Google matches on for sameAs, and the audience is
    // Irish, UK and EU.
    linkedin: 'https://www.linkedin.com/in/noel-murphy-chinafulfillment',
    // Drop a JPEG here and the about page and Person schema pick it up
    // automatically. See src/pages/about.astro.
    photo: '/noel-murphy.jpg',
  },
} as const;

export type TagCta = { label: string; url: string };
export type Tag = {
  slug: string;
  label: string;
  blurb: string;
  cta: TagCta;
  intro: string;
  /** Topic hub artwork. Illustration, never used on a briefing story. */
  art?: { src: string; alt: string };
};

export const TAGS: Tag[] = tagsData.tags;
export const TAG_SLUGS: string[] = TAGS.map((t) => t.slug);
const TAG_BY_SLUG = new Map(TAGS.map((t) => [t.slug, t]));

export function getTag(slug: string): Tag | undefined {
  return TAG_BY_SLUG.get(slug);
}

/** Nav links out to the money site. Order matters — first two get header space. */
export const SERVICE_LINKS = [
  { label: 'D2C fulfilment', url: 'https://www.china-fulfillment.com/ecommerce-fulfillment.html' },
  { label: 'FBA prep & consolidation', url: 'https://www.china-fulfillment.com/amazon-fba-consolidation.html' },
  { label: 'Freight forwarding', url: 'https://www.china-fulfillment.com/international-freight-forwarding-china.html' },
  { label: 'Tariffs & DDP', url: 'https://www.china-fulfillment.com/tariff-management-china.html' },
  { label: 'QC & inspection', url: 'https://www.china-fulfillment.com/quality-control-fba-prep-china.html' },
  { label: 'Supplier management', url: 'https://www.china-fulfillment.com/supplier-management-china.html' },
] as const;

/**
 * Internal URL with the site's trailing-slash policy applied. Single source of
 * truth: every internal link goes through here so nothing ever earns a 307.
 *
 * Files keep their extension and take no trailing slash. Pages always get one.
 */
export function href(path = '/'): string {
  if (/^https?:\/\//.test(path)) return path;
  const clean = `/${path.replace(/^\/+/, '').replace(/\/+$/, '')}`;
  if (clean === '/') return '/';
  return /\.[a-z0-9]{2,5}$/i.test(clean) ? clean : `${clean}/`;
}

export function absolute(path = '/'): string {
  return new URL(href(path), SITE.url).toString();
}

/** "Tuesday, 1 September 2026" — UK English long form. */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "1 Sep 2026" — compact form for cards and lists. */
export function formatDateShort(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

/**
 * Briefings are dated, not timestamped. We publish at 07:00 Europe/Dublin, so
 * stamp that as the ISO publish time rather than pretending it was midnight.
 * Dublin is UTC+1 from late March to late October, UTC otherwise.
 */
export function publishedISO(date: string): string {
  const at7 = new Date(`${date}T07:00:00Z`);
  const name =
    new Intl.DateTimeFormat('en-GB', { timeZone: SITE.timeZone, timeZoneName: 'longOffset' })
      .formatToParts(at7)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  // Intl gives "GMT+01:00" in summer, bare "GMT" in winter.
  const offset = name === 'GMT' ? '+00:00' : name.replace('GMT', '');
  return `${date}T07:00:00${offset}`;
}

/** Split generator prose into paragraphs. Tolerates \n\n, \r\n\r\n or a single \n. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n|\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Assign each story a china-fulfillment.com CTA derived from its own tags.
 *
 * The model never writes a URL for us — it picks tags from the controlled list
 * and we map those to real service pages. That is the whole hallucination
 * guard for internal links. We spread across distinct destinations so a
 * briefing links to several service pages rather than the same one repeatedly
 * (PRD §2: at least 3 contextual internal links per briefing).
 */
export function assignCtas(stories: { tags: string[] }[]): TagCta[] {
  const used = new Set<string>();
  const out: TagCta[] = [];

  for (const s of stories) {
    const candidates = s.tags.map(getTag).filter((t): t is Tag => Boolean(t));
    const fresh = candidates.find((t) => !used.has(t.cta.url));
    const chosen = fresh ?? candidates[0] ?? getTag('sea-freight')!;
    used.add(chosen.cta.url);
    out.push(chosen.cta);
  }
  return out;
}

/**
 * Meta descriptions must not exceed 155 characters (PRD §8). The generator is
 * told the limit but this enforces it, so a long description shortens at a word
 * boundary instead of being truncated mid-word by Google.
 */
export function clampDescription(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:.\s]+$/, '')}…`;
}
