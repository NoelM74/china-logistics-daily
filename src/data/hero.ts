/**
 * Route-chart hero bands, generated inline at build time.
 *
 * Why generated rather than stock photography: every logistics site uses the
 * same three container-terminal photos, licence provenance has to be tracked
 * forever, and a 200kB JPEG undoes the performance work. This is about 2kB of
 * markup with no HTTP request at all.
 *
 * Inlined rather than served as a file because the band is decorative. As an
 * <img> it became the largest contentful paint and cost about 11 Lighthouse
 * performance points; inline it costs nothing and cannot shift layout.
 *
 * The motif is great-circle lanes leaving a port cluster, seeded from the date
 * or tag slug, so every page gets its own arrangement and it never changes
 * once published.
 */

const NAVY = '#0A152A';
const NAVY_2 = '#132540';
const ACCENT = '#047857';
const MINT = '#10B981';
const PAPER = '#F4F6FB';

const W = 1200;
const H = 200;

/** Deterministic PRNG, so a given seed always renders the same band. */
function seeded(str: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function heroBand(seed: string, laneCount = 5): string {
  const rnd = seeded(seed);
  const parts: string[] = [];
  const originX = 120;
  const originY = H * 0.5;

  for (let i = 0; i < laneCount; i++) {
    const endX = W - 40 - rnd() * 120;
    const endY = 30 + rnd() * (H - 60);
    // Control point above the chord gives the great-circle bow.
    const cx = originX + (endX - originX) * (0.35 + rnd() * 0.3);
    const cy = originY - (60 + rnd() * 90);
    const width = 1 + rnd() * 1.6;
    const light = rnd() > 0.62;
    const stroke = light ? MINT : ACCENT;
    parts.push(
      `<path d="M${originX} ${originY} Q${cx.toFixed(0)} ${cy.toFixed(0)} ${endX.toFixed(0)} ${endY.toFixed(0)}" fill="none" stroke="${stroke}" stroke-width="${width.toFixed(2)}" opacity="${(0.35 + rnd() * 0.45).toFixed(2)}" stroke-linecap="round"/>`,
      `<circle cx="${endX.toFixed(0)}" cy="${endY.toFixed(0)}" r="${(2 + rnd() * 2).toFixed(1)}" fill="${stroke}" opacity="${(0.5 + rnd() * 0.4).toFixed(2)}"/>`,
    );
  }

  for (let i = 1; i < 4; i++) {
    parts.push(
      `<line x1="0" y1="${(H / 4) * i}" x2="${W}" y2="${(H / 4) * i}" stroke="${PAPER}" stroke-width="0.5" opacity="0.06"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false" style="display:block;width:100%;height:100%">
<defs><linearGradient id="hg-${seed.replace(/[^a-z0-9]/gi, '')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${NAVY}"/><stop offset="1" stop-color="${NAVY_2}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#hg-${seed.replace(/[^a-z0-9]/gi, '')})"/>
${parts.join('')}
<circle cx="${originX}" cy="${originY}" r="7" fill="${MINT}"/>
<circle cx="${originX}" cy="${originY}" r="14" fill="none" stroke="${MINT}" stroke-width="1.2" opacity="0.55"/>
<circle cx="${originX}" cy="${originY}" r="24" fill="none" stroke="${MINT}" stroke-width="0.8" opacity="0.25"/>
</svg>`;
}
