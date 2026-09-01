import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { TAG_SLUGS } from './data/site';

const tagEnum = z
  .string()
  .refine((s) => TAG_SLUGS.includes(s), {
    message: `Tag must be one of: ${TAG_SLUGS.join(', ')}`,
  });

const story = z.object({
  headline: z.string().min(10).max(140),
  tldr: z.string().min(20),
  whatHappened: z.string().min(80),
  whyItMatters: z.string().min(80),
  hotTake: z.string().min(40),
  actions: z.array(z.string().min(10)).min(1).max(3),
  sourceUrl: z.string().url(),
  sourceName: z.string().min(2),
  tags: z.array(tagEnum).min(3).max(6),
});

const briefings = defineCollection({
  // id comes from the filename: 2026-09-01.json -> "2026-09-01"
  loader: glob({ pattern: '*.json', base: './src/content/briefings' }),
  schema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().min(10).max(70),
    metaDescription: z.string().min(50).max(170),
    bottomLine: z.string().min(80),
    stories: z.array(story).min(2).max(5),
    contentHooks: z.array(z.string().min(10)).min(6).max(14),
    faq: z
      .array(z.object({ question: z.string().min(10), answer: z.string().min(30) }))
      .min(3)
      .max(6),
    // Stamped by the pipeline. Absent on hand-authored seeds.
    generatedAt: z.string().optional(),
    model: z.string().optional(),
    sourceCount: z.number().optional(),
  }),
});

export const collections = { briefings };
