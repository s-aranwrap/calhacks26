/**
 * CLI: refresh opening hours for the San Francisco starter places from Google
 * Maps, through Apify's Google Maps scraper.
 *
 *   npm run hours:sf -- --dry-run          # list the places and the rough cost. Free.
 *   npm run hours:sf                       # run Apify and write src/data/packs/sfHours.generated.ts
 *   npm run hours:sf -- --from-raw latest  # reprocess the last saved run without Apify
 *
 * Places that are public streets or stairways are skipped (they have no
 * hours). A result is used only when it's within 400 m of the place, so a
 * wrong Google match can't overwrite good hours.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SF_EVERGREEN_RECORDS } from '../../src/data/packs/sfEvergreen.ts';
import { loadServerEnv, parseArgs, redact } from './env.ts';
import { runApifyActor } from './instagram.ts';
import { placesToHours, renderHoursModule, type PlaceQuery } from './placeHours.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RAW_DIR = here('./sf/raw-hours/');
const OUT = here('../../src/data/packs/sfHours.generated.ts');

/** No opening hours to look up. */
const SKIP = new Set([
  'sf-lombard-street',
  'sf-balmy-alley',
  'sf-embarcadero-walk',
  'sf-filbert-steps',
  'sf-chinatown-walk',
]);

export function placeQueries(): PlaceQuery[] {
  return SF_EVERGREEN_RECORDS.flatMap((r) => {
    const id = String(r.id);
    if (SKIP.has(id) || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return [];
    return [
      {
        id,
        query: `${String(r.venue_name ?? r.title)}, San Francisco, CA`,
        latitude: r.latitude,
        longitude: r.longitude,
      },
    ];
  });
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const env = loadServerEnv();
  const now = new Date();
  const queries = placeQueries();
  let items: unknown[];

  const fromRaw = flags['from-raw']?.[0];
  if (fromRaw) {
    const latest = readdirSync(RAW_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .at(-1);
    const path = fromRaw === 'latest' ? (latest ? `${RAW_DIR}${latest}` : undefined) : fromRaw;
    if (!path) throw new Error('No saved hours runs yet. Run without --from-raw first.');
    items = JSON.parse(readFileSync(path, 'utf8')) as unknown[];
    console.log(`Reprocessing ${items.length} saved places from ${path} (no Apify credits used).`);
  } else {
    console.log(`${queries.length} places to look up on Google Maps:`);
    for (const q of queries) console.log(`  ${q.query}`);
    console.log(
      `One result per place. At about $4 per 1,000 places that's roughly $${((queries.length / 1000) * 4).toFixed(2)}; check your Apify plan.`,
    );
    if (flags['dry-run']) return;
    if (!env.apifyToken) throw new Error('Set APIFY_API_TOKEN in server/.env (see server/.env.example).');
    console.log(`Running ${env.apifyPlacesActorId}… (this can take a minute or two)`);
    items = await runApifyActor({
      token: env.apifyToken,
      actorId: env.apifyPlacesActorId,
      timeoutSecs: 280,
      input: {
        searchStringsArray: queries.map((q) => q.query),
        locationQuery: 'San Francisco, CA, USA',
        maxCrawledPlacesPerSearch: 1,
        language: 'en',
        maxReviews: 0,
        maxImages: 0,
        scrapeReviewsPersonalData: false,
      },
    });
    mkdirSync(RAW_DIR, { recursive: true });
    const rawFile = `${RAW_DIR}${now.toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(rawFile, JSON.stringify(items, null, 2));
    console.log(`Saved ${items.length} raw places to ${rawFile}`);
  }

  const checkedOn = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const { hours, report } = placesToHours(items, queries, checkedOn);
  writeFileSync(OUT, renderHoursModule(hours, now.toISOString()));
  console.log(
    `\nHours for ${report.matched.length} of ${queries.length} places written to src/data/packs/sfHours.generated.ts`,
  );
  if (report.noHours.length) console.log(`No hours on Google: ${report.noHours.join(', ')}`);
  if (report.tooFar.length)
    console.log(`Google matched a different place (kept the old hours): ${report.tooFar.join(', ')}`);
  if (report.missing.length) console.log(`No result: ${report.missing.join(', ')}`);
  console.log('Restart the app with `npx expo start -c` to see them.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const env = loadServerEnv();
    console.error(redact(`Error: ${(error as Error).message}`, env.apifyToken));
    process.exitCode = 1;
  });
}
