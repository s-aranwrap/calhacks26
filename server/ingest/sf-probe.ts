/**
 * CLI: try out candidate Instagram accounts and keep the ones that post events.
 *
 *   npm run probe:sf -- --dry-run          # list candidates and the rough cost. Free.
 *   npm run probe:sf                       # fetch ~5 recent posts per candidate and score them
 *   npm run probe:sf -- --images           # also let an AI model read captions and flyer images (free with GEMINI_API_KEY)
 *   npm run probe:sf -- --from-raw latest  # re-score the last probe without Apify (add --ai to compare)
 *   npm run probe:sf -- --adopt            # after scoring, add accounts that gave events to sources.json
 *
 * Candidates live in server/ingest/sf/candidates.json. Accounts already in
 * sources.json are skipped.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createAiExtractor } from './aiExtract.ts';
import { providerFromEnv } from './aiProviders.ts';
import { loadServerEnv, parseArgs, redact } from './env.ts';
import { runApifyActorAsync } from './instagram.ts';
import { adoptSources, scoreCandidates, type Candidate } from './probe.ts';
import type { SfSourcesConfig } from './sfPipeline.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const SOURCES = here('./sf/sources.json');
const CANDIDATES = here('./sf/candidates.json');
const RAW_DIR = here('./sf/raw-probe/');
const REPORT = here('./sf/probe-report.json');
const AI_CACHE = here('./sf/ai-cache.json');

interface CandidatesFile {
  postsPerAccount: number;
  newerThan: string;
  maxPostsPerProbe: number;
  candidates: Candidate[];
}

const VERDICT_TEXT = {
  good: 'GOOD     ',
  some: 'some     ',
  no_events: 'no events',
  no_posts: 'no posts ',
} as const;

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const env = loadServerEnv();
  const now = new Date();
  const config = JSON.parse(readFileSync(SOURCES, 'utf8')) as SfSourcesConfig;
  const file = JSON.parse(readFileSync(CANDIDATES, 'utf8')) as CandidatesFile;
  const known = new Set(config.sources.map((s) => s.url.replace(/\/+$/, '').toLowerCase()));
  const candidates = file.candidates.filter((c) => !known.has(c.url.replace(/\/+$/, '').toLowerCase()));
  if (candidates.length === 0) {
    console.log('Every candidate is already in sources.json. Add new accounts to server/ingest/sf/candidates.json.');
    return;
  }

  let items: unknown[];
  const fromRaw = flags['from-raw']?.[0];
  if (fromRaw) {
    mkdirSync(RAW_DIR, { recursive: true });
    const latest = readdirSync(RAW_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .at(-1);
    const path = fromRaw === 'latest' ? (latest ? `${RAW_DIR}${latest}` : undefined) : fromRaw;
    if (!path) throw new Error('No saved probes yet. Run without --from-raw first.');
    items = JSON.parse(readFileSync(path, 'utf8')) as unknown[];
    console.log(`Re-scoring ${items.length} saved posts from ${path} (no Apify credits used).`);
  } else {
    const planned = candidates.length * file.postsPerAccount;
    console.log(
      `${candidates.length} candidates, up to ${file.postsPerAccount} posts each from the last ${file.newerThan}:`,
    );
    for (const c of candidates) console.log(`  ${c.url}`);
    console.log(`At most ${planned} posts, roughly $${((planned / 1000) * 2.7).toFixed(2)} of Apify credit.`);
    if (flags['dry-run']) return;
    if (planned > file.maxPostsPerProbe && !flags.yes) {
      throw new Error(`That's over the ${file.maxPostsPerProbe}-post probe limit. Trim candidates.json or pass --yes.`);
    }
    if (!env.apifyToken) throw new Error('Set APIFY_API_TOKEN in server/.env (see server/.env.example).');
    console.log(`Running ${env.apifyActorId}…`);
    items = await runApifyActorAsync({
      token: env.apifyToken,
      actorId: env.apifyActorId,
      onProgress: (status, secs) => console.log(`  ${status.toLowerCase()}… ${secs}s`),
      input: {
        directUrls: candidates.map((c) => c.url),
        resultsType: 'posts',
        resultsLimit: file.postsPerAccount,
        onlyPostsNewerThan: file.newerThan,
        addParentData: false,
      },
    });
    mkdirSync(RAW_DIR, { recursive: true });
    const rawFile = `${RAW_DIR}${now.toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(rawFile, JSON.stringify(items, null, 2));
    console.log(`Saved ${items.length} posts to ${rawFile}`);
  }

  const useAi = Boolean(flags.ai || flags.images);
  let ai: ReturnType<typeof createAiExtractor> | undefined;
  if (useAi) {
    ai = createAiExtractor({
      provider: providerFromEnv(env),
      cacheFile: AI_CACHE,
      timeZone: config.timeZone,
    });
    await ai.prepare();
  }

  const results = await scoreCandidates(items, candidates, config, {
    now,
    ...(ai ? { aiExtract: ai.extract, readImages: Boolean(flags.images) } : {}),
  });
  ai?.save();
  if (ai?.stats.quotaHit) {
    console.log(
      '\nThe free AI quota ran out partway, so some accounts were scored with the rules only. Run it again tomorrow to finish.',
    );
  }
  writeFileSync(REPORT, JSON.stringify({ probedAt: now.toISOString(), usedAi: useAi, results }, null, 2));

  console.log(
    `\nResults${useAi ? ` (with ${ai?.label ?? 'AI'}${flags.images ? ' and images' : ''})` : ' (rules only)'}:`,
  );
  for (const r of results) {
    const handle = r.url.replace('https://www.instagram.com/', '').replace(/\/$/, '');
    const examples = r.examples.length ? `  e.g. ${r.examples.join(' | ')}` : '';
    console.log(
      `  ${VERDICT_TEXT[r.verdict]}  ${String(r.events).padStart(2)} events / ${String(r.posts).padStart(2)} posts  ${handle}${examples}`,
    );
  }
  console.log(`\nFull report: server/ingest/sf/probe-report.json`);
  console.log('"no posts" usually means a wrong handle, a private account, or nothing posted recently.');
  if (!useAi) console.log('Tip: many venues put dates on the flyer, not in the caption. Try again with --images.');

  if (flags.adopt) {
    const { config: next, added } = adoptSources(config, results);
    writeFileSync(SOURCES, `${JSON.stringify(next, null, 2)}\n`);
    const total = next.sources.reduce((sum, s) => sum + s.limit, 0);
    console.log(`\nAdded ${added.length} account(s) to sources.json. A full run now fetches up to ${total} posts.`);
    if (total > next.maxResultsPerRun) {
      console.log(
        `That's over maxResultsPerRun (${next.maxResultsPerRun}): raise it in sources.json or pass --yes to ingest:sf.`,
      );
    }
  } else if (results.some((r) => r.verdict === 'good' || r.verdict === 'some')) {
    console.log('Run again with --adopt (add --from-raw latest to skip Apify) to add the accounts that gave events.');
  }
}

main().catch((error: unknown) => {
  const env = loadServerEnv();
  console.error(redact(`Error: ${(error as Error).message}`, env.apifyToken, env.anthropicApiKey, env.geminiApiKey));
  process.exitCode = 1;
});
