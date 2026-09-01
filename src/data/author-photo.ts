import { existsSync } from 'node:fs';
import path from 'node:path';
import { SITE } from './site';

/**
 * Whether a real photograph of the author is present in public/.
 *
 * Checked at build time so dropping the file in is the whole job: the about
 * page swaps its placeholder for the image and Person schema gains an
 * `image` property, with no code change. Runs during SSG only.
 */
export const hasAuthorPhoto: boolean = (() => {
  const candidates = ['.jpg', '.jpeg', '.png', '.webp'].map((ext) =>
    SITE.author.photo.replace(/\.[a-z]+$/i, ext),
  );
  return candidates.some((rel) => existsSync(path.join(process.cwd(), 'public', rel)));
})();

/** The photo path that actually exists, or the configured default. */
export const authorPhotoPath: string = (() => {
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const rel = SITE.author.photo.replace(/\.[a-z]+$/i, ext);
    if (existsSync(path.join(process.cwd(), 'public', rel))) return rel;
  }
  return SITE.author.photo;
})();
