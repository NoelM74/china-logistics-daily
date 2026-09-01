#!/usr/bin/env node
/**
 * One-off: pull the generated topic artwork, resize and convert to WebP.
 *
 * These are evergreen assets, generated once and committed, so this is not a
 * build step. Kept in the repo so the provenance of every image is recorded
 * and so the set can be regenerated in the same style later.
 *
 * The artwork is illustration, not photography, and it is used only on topic
 * hubs. It is deliberately never placed on an individual briefing story: an
 * AI-generated image beside a news report invites the reader to take it as a
 * photograph of the reported event, and the site's whole claim is that
 * nothing here is invented.
 *
 *   node scripts/fetch-topic-art.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'topics');

/** Generated with google/nano-banana-pro on 2026-09-01. */
const ART = {
  'sea-freight':
    'https://replicate.delivery/xezq/VitzC82ucCbsNZtIETfV1oCbxJD6ftznewDXmJHJikMv9PSuA/tmp7oilcagd.png',
  'air-freight':
    'https://replicate.delivery/xezq/7xti3vmzwYKLG1y3NKKFqcFb1uTwJtQo2W7OJwpa1OVEASyF/tmpjqiev5m8.png',
  'rail-freight':
    'https://replicate.delivery/xezq/B9DNmP983fwGdSWG12rpCVgmDs20NyeeFNH1GkEd3Z6hBQSuA/tmpvupwrniy.png',
  'tariffs-duties':
    'https://replicate.delivery/xezq/HnYBmH84ZvoZLtxYcZVSxwQwNEZ76pT1AeUeIBIGavaLBIJXA/tmp4fe2q5n6.png',
  'amazon-fba':
    'https://replicate.delivery/xezq/G3mca9PT7iLVElAwaimL6wtzuieOE9f56GHz28VI1ggmBIJXA/tmpof6dpuzx.png',
  'ports-congestion':
    'https://replicate.delivery/xezq/weoTcmLLufi2YUw3IFI1t9hzCQ5jBwGWzff7RuuDtoytJgkcB/tmpyrxf4tpi.png',
  manufacturing:
    'https://replicate.delivery/xezq/rh2YwK2G0IrpL5C8wuZL4SeJTwxqoey6xq7hfVbEJ4lqFQSuA/tmpsjuvc0f1.png',
  'de-minimis':
    'https://replicate.delivery/xezq/Cj3XI8y6PV4TCBj9o455NN8f2UUXcPAzPkdAYQff0MLIQQSuA/tmparvd9cdq.png',
  'ireland-imports':
    'https://replicate.delivery/xezq/aWaK8EgENl42ANpQrRAZ7fSfLulhZnpr6JBaKCIbJufbHQSuA/tmpcyy9719g.png',
  'fuel-surcharges':
    'https://replicate.delivery/xezq/b2QWEdCQQVZmNJjNBK6tgZJVLpnF4ZKWIZT5FYsVMpvEBSyF/tmpasslln0i.png',
  'quality-control':
    'https://replicate.delivery/xezq/JP6lOvphJaamJFZ6y3n0FfWrcbfizd7jgz7Al6SJMk2sEIJXA/tmp89c3_7xt.png',
  'regulation-china':
    'https://replicate.delivery/xezq/MIPj32JK4SJ4HxYyflkCJfe5L5Ym3HtDzA8fHByIuoDmUgkcB/tmp16uwdp_u.png',
  'peak-season':
    'https://replicate.delivery/xezq/KlqW70BVf2RLLKCf3AHkOKDS0jOTkewc7MDQ4i6MIHjGLQSuA/tmp1_4_bkpl.png',
  'customs-eu':
    'https://replicate.delivery/xezq/zwdOi1aFWnr4D5f0J1kEKjaw6yEA6PuJOuiZZjXzaZmMDkkLA/tmpui_gnhg_.png',
  'customs-uk':
    'https://replicate.delivery/xezq/uh6OgGz2RFrGEZ2zRL9XVTcuISf3tksDgcnuPJPv1nUcDkkLA/tmp2rte4ep0.png',
  'customs-us':
    'https://replicate.delivery/xezq/lWFgOIVH5fU2TyrQVFVgNoM9FU4BS9kNyfM8fQINJYVzOQSuA/tmp5c5nof9u.png',
  'ecommerce-platforms':
    'https://replicate.delivery/xezq/xSiQ0QogQBocGBPzTrDuZe94SFx3amaQFC0ZwNorlCHYEkkLA/tmp7_ggvm6_.png',
  sourcing:
    'https://replicate.delivery/xezq/NDEWfekVjXviwEqsTwG7QLxpW7E2vkv5cwtxfmEc1RKaSQSuA/tmp4eq6zsmq.png',
  masthead:
    'https://replicate.delivery/xezq/eyttuGhzo0UeBU3afloU2EJyoYZOXCbOp3VE0MoAlccOUQSuA/tmpy7u8f418.png',
};

const WIDTH = 1600;

async function main() {
  await mkdir(OUT, { recursive: true });
  let total = 0;

  for (const [slug, url] of Object.entries(ART)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      console.warn(`[art] ${slug}: HTTP ${res.status}, skipped`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());

    const out = await sharp(buf)
      .resize({ width: WIDTH, withoutEnlargement: true })
      .webp({ quality: 78, effort: 6 })
      .toBuffer();

    await writeFile(path.join(OUT, `${slug}.webp`), out);
    total += out.byteLength;
    console.log(
      `[art] ${slug.padEnd(22)} ${Math.round(buf.byteLength / 1024)}kB png -> ${Math.round(out.byteLength / 1024)}kB webp`,
    );
  }

  console.log(
    `[art] ${Object.keys(ART).length} images, ${Math.round(total / 1024)}kB total in public/topics`,
  );
}

await main();
