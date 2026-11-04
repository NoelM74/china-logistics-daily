#!/usr/bin/env node
/**
 * Renders public/favicon.svg into the raster icons Google and Apple want.
 * Run once after the SVG changes: node scripts/make-favicons.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile('public/favicon.svg');
const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

await writeFile('public/favicon-48x48.png', await png(48));
await writeFile('public/apple-touch-icon.png', await png(180));

// A .ico is a small header plus PNG data. One 48px image is enough.
const img = await png(48);
const head = Buffer.alloc(22);
head.writeUInt16LE(1, 2); // type: icon
head.writeUInt16LE(1, 4); // one image
head.writeUInt8(48, 6); // width
head.writeUInt8(48, 7); // height
head.writeUInt16LE(1, 10); // planes
head.writeUInt16LE(32, 12); // bits per pixel
head.writeUInt32LE(img.length, 14);
head.writeUInt32LE(22, 18); // data offset
await writeFile('public/favicon.ico', Buffer.concat([head, img]));
console.log('wrote favicon.ico, favicon-48x48.png, apple-touch-icon.png');
