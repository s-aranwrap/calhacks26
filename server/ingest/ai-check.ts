/**
 * CLI: checks the AI service in server/.env with one tiny request.
 *
 *   npm run ai:check                       # reads a sample caption
 *   npm run ai:check -- --image flyer.jpg  # also reads a flyer image from your computer
 *
 * Uses one request of your free daily quota (two with --image). Nothing is cached or saved.
 */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { EVENTS_SCHEMA, validateAiEvents } from './aiExtract.ts';
import { providerFromEnv, QuotaError, type AiImage } from './aiProviders.ts';
import { loadServerEnv, parseArgs, redact } from './env.ts';

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function localDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const env = loadServerEnv();
  const now = new Date();
  const today = localDate(now);
  // A date three days out, written the way a real caption would write it.
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const soonText = soon.toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const caption = `Big night this week!! 🎶 Jazz in the courtyard ${soonText}, 7–9pm @ Yerba Buena Gardens. Free, bring friends. Tickets for our NYE party go on sale Dec 1.`;

  const provider = providerFromEnv(env);
  console.log(`Service: ${provider.name}`);
  await provider.prepare();
  console.log(`Model:   ${provider.model}`);
  console.log(`\nSample caption:\n  ${caption}\n`);

  const system =
    'You extract events from Instagram captions for a San Francisco activity app. Only include attendable events; ignore ticket-sale dates. date_quote must be copied exactly.';
  const started = Date.now();
  const answer = await provider.ask({
    system,
    schema: EVENTS_SCHEMA,
    image: null,
    text: `Posted on ${today}.\n\nCaption:\n"""\n${caption}\n"""\n\nAnswer with JSON: {"events": [...]}.`,
  });
  const { events, dropped } = validateAiEvents(answer, caption, today, today);
  console.log(`Answer in ${((Date.now() - started) / 1000).toFixed(1)} s:`);
  for (const e of events) {
    console.log(
      `  ✓ ${e.title} · ${e.startWall ?? `${e.date} (time not listed)`}${e.venue ? ` · ${e.venue}` : ''}${e.isFree ? ' · free' : ''}`,
    );
  }
  if (dropped) console.log(`  (${dropped} event(s) dropped by the safety checks)`);

  const ok = events.length === 1 && events[0]!.startWall?.endsWith('19:00');
  console.log(
    ok
      ? '\nIt works: one event, at 7 PM, and the ticket-sale date was ignored.'
      : events.length === 0
        ? '\nThe service answered but found no event. Try once more; if it keeps happening, set a different model in server/.env.'
        : '\nThe service works, but the answer was off (wrong time or an extra event). Fine for a test; the safety checks catch the worst of it.',
  );

  const imagePath = flags.image?.[0];
  if (imagePath) {
    const type = TYPES[extname(imagePath).toLowerCase()];
    if (!type) throw new Error('--image needs a .jpg, .png or .webp file.');
    const image: AiImage = { media_type: type, data: readFileSync(imagePath).toString('base64') };
    console.log(`\nReading the image ${imagePath}…`);
    const imageAnswer = await provider.ask({
      system: `${system} The image is the post, often a flyer; set seen_in to "image" when the date is only in the image.`,
      schema: EVENTS_SCHEMA,
      image,
      text: `Posted on ${today}.\n\nCaption:\n"""\nLink in bio!\n"""\n\nAnswer with JSON: {"events": [...]}.`,
    });
    const fromImage = validateAiEvents(imageAnswer, 'Link in bio!', today, today, { imageSent: true });
    if (fromImage.events.length === 0)
      console.log('  No upcoming events found in the image (past dates are left out).');
    for (const e of fromImage.events) {
      console.log(`  ✓ ${e.title} · ${e.startWall ?? `${e.date} (time not listed)`}${e.venue ? ` · ${e.venue}` : ''}`);
    }
  }
}

main().catch((error: unknown) => {
  const env = loadServerEnv();
  const message = redact((error as Error).message, env.geminiApiKey, env.anthropicApiKey);
  if (error instanceof QuotaError) {
    console.error(`The free quota is used up for today (or you're sending too fast). Try again later.\n  ${message}`);
  } else if (/HTTP 400|HTTP 403|API key|API_KEY_INVALID/i.test(message)) {
    console.error(`The key was rejected. Check GEMINI_API_KEY in server/.env: no quotes, no spaces.\n  ${message}`);
  } else {
    console.error(`Error: ${message}`);
  }
  process.exitCode = 1;
});
