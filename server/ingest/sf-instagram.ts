/**
 * CLI: build the San Francisco demo's Instagram events pack.
 *
 *   npm run ingest:sf -- --dry-run          # show what would run and the max result count
 *   npm run ingest:sf                       # run Apify, save raw items, write the pack
 *   npm run ingest:sf -- --geocode          # also look up venue coordinates (OpenStreetMap)
 *   npm run ingest:sf -- --from-raw latest  # reprocess the last saved run, no Apify credits used
 *   npm run ingest:sf -- --ai               # also let Claude read captions (needs ANTHROPIC_API_KEY)
 *
 * Sources and per-source limits live in server/ingest/sf/sources.json. A run
 * that could return more than `maxResultsPerRun` posts is refused unless you
 * pass --yes, so credits can't run away by accident.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createAiExtractor, DEFAULT_AI_MODEL } from './aiExtract.ts';
import { loadServerEnv, parseArgs, redact } from './env.ts';
import { createGeocoder, SF_BOUNDS } from './geocode.ts';
import { runInstagramScraper } from './instagram.ts';
import { maxResults, postsToRecords, renderPackModule, type SfSourcesConfig } from './sfPipeline.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const CONFIG = here('./sf/sources.json');
const RAW_DIR = here('./sf/raw/');
const GEOCACHE = here('./sf/geocache.json');
const AI_CACHE = here('./sf/ai-cache.json');
const PACK = here('../../src/data/packs/sfInstagram.generated.ts');

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as SfSourcesConfig;
  const now = new Date();
  const env = loadServerEnv();
  let items: unknown[];

  const fromRaw = flags['from-raw']?.[0];
  if (fromRaw) {
    const file =
      fromRaw === 'latest'
        ? readdirSync(RAW_DIR)
            .filter((f) => f.endsWith('.json'))
            .sort()
            .at(-1)
        : undefined;
    const path = fromRaw === 'latest' ? (file ? `${RAW_DIR}${file}` : undefined) : fromRaw;
    if (!path) throw new Error('No saved runs in server/ingest/sf/raw yet. Run without --from-raw first.');
    items = JSON.parse(readFileSync(path, 'utf8')) as unknown[];
    console.log(`Reprocessing ${items.length} saved items from ${path} (no Apify credits used).`);
  } else {
    const cap = Number(flags['max-results']?.[0] ?? config.maxResultsPerRun);
    const planned = maxResults(config);
    console.log(`Sources (${config.sources.length}), posts newer than ${config.newerThan}:`);
    for (const s of config.sources)
      console.log(`  ${s.limit.toString().padStart(3)}  ${s.url}${s.confirmed ? '' : '  (unconfirmed)'}`);
    console.log(
      `At most ${planned} posts. At roughly $1.50–2.70 per 1,000 that's under $${((planned / 1000) * 2.7).toFixed(2)}; check your Apify plan.`,
    );
    if (flags['dry-run']) return;
    if (planned > cap && !flags.yes) {
      throw new Error(`That's more than the ${cap}-post safety limit. Lower the limits in sources.json or pass --yes.`);
    }
    if (!env.apifyToken) throw new Error('Set APIFY_API_TOKEN in server/.env (see server/.env.example).');

    // The actor applies one resultsLimit to all URLs in a run, so group sources by limit.
    const byLimit = new Map<number, string[]>();
    for (const s of config.sources) byLimit.set(s.limit, [...(byLimit.get(s.limit) ?? []), s.url]);
    items = [];
    for (const [limit, urls] of byLimit) {
      console.log(`Running ${env.apifyActorId} for ${urls.length} URL(s), up to ${limit} posts each…`);
      const batch = await runInstagramScraper({
        token: env.apifyToken,
        actorId: env.apifyActorId,
        input: {
          directUrls: urls,
          resultsType: 'posts',
          resultsLimit: limit,
          onlyPostsNewerThan: config.newerThan,
          addParentData: false,
        },
      });
      items.push(...batch);
    }
    mkdirSync(RAW_DIR, { recursive: true });
    const rawFile = `${RAW_DIR}${now.toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(rawFile, JSON.stringify(items, null, 2));
    console.log(`Saved ${items.length} raw items to ${rawFile}`);
  }

  const geocoder = flags.geocode
    ? createGeocoder({
        bounds: SF_BOUNDS,
        cacheFile: GEOCACHE,
        userAgent: `HuddleDemo/1.0 (${process.env.NOMINATIM_EMAIL ?? 'set NOMINATIM_EMAIL in server/.env'})`,
      })
    : undefined;

  let ai: ReturnType<typeof createAiExtractor> | undefined;
  if (flags.ai) {
    if (!env.anthropicApiKey) throw new Error('--ai needs ANTHROPIC_API_KEY in server/.env (see server/.env.example).');
    ai = createAiExtractor({
      apiKey: env.anthropicApiKey,
      model: env.anthropicModel ?? DEFAULT_AI_MODEL,
      cacheFile: AI_CACHE,
      timeZone: config.timeZone,
    });
    console.log(
      `Reading captions with ${env.anthropicModel ?? DEFAULT_AI_MODEL} (answers are cached in server/ingest/sf/ai-cache.json).`,
    );
  }

  const { records, report } = await postsToRecords(items, config, {
    now,
    ...(geocoder ? { geocode: geocoder.lookup } : {}),
    ...(ai ? { aiExtract: ai.extract } : {}),
  });
  geocoder?.save();
  ai?.save();

  writeFileSync(PACK, renderPackModule(records, now.toISOString()));
  console.log(
    `\n${report.kept} events from ${report.postsWithEvents} of ${report.items} posts written to src/data/packs/sfInstagram.generated.ts`,
  );
  if (ai) {
    console.log(
      `Claude: ${ai.stats.calls} new calls, ${ai.stats.cached} cached, ${ai.stats.failures} failed (rules used instead), ${ai.stats.dropped} events dropped for not matching the caption. ${report.fromAi} events came from Claude.`,
    );
  }
  console.log(`Posts skipped: ${JSON.stringify(report.skipped)}`);
  console.log(`Events per source: ${JSON.stringify(report.perSource)}`);
  console.log(
    'Skip reasons: no_date = no date found; no_time = only a weekday with no time; too_old = already over; ambiguous_date = a roundup without per-event details.',
  );
}

main().catch((error: unknown) => {
  const env = loadServerEnv();
  console.error(
    redact(`Error: ${(error as Error).message}`, env.apifyToken, env.supabaseSecretKey, env.anthropicApiKey),
  );
  process.exitCode = 1;
});
