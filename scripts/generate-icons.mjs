// Renders the app icon, Android adaptive icon and splash image from assets/mascot.svg.
// Optional dev tool: `npm i --no-save sharp && node scripts/generate-icons.mjs`.
// The generated PNGs are committed, so you only need this after changing the mascot.
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const svg = readFileSync(new URL('../assets/mascot.svg', import.meta.url));
const IVORY = { r: 0xfb, g: 0xf7, b: 0xef, alpha: 1 };
const out = (name) => new URL(`../assets/images/${name}`, import.meta.url).pathname;

async function mascot(size) {
  return sharp(svg, { density: 1200 }).resize(size, size).png().toBuffer();
}

async function canvas(size, inner, background, name) {
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: await mascot(inner), gravity: 'center' }])
    .png()
    .toFile(out(name));
}

await canvas(1024, 760, IVORY, 'icon.png');
// Android adaptive icons crop to a circle/squircle; keep the penguin inside the 66% safe zone.
await canvas(1024, 600, { r: 0, g: 0, b: 0, alpha: 0 }, 'adaptive-icon.png');
await canvas(512, 512, { r: 0, g: 0, b: 0, alpha: 0 }, 'splash-icon.png');
console.log('icons written to assets/images');
