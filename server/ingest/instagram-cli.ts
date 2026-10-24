/**
 * CLI: discover candidate activities from Instagram via Apify.
 *
 *   node server/ingest/instagram-cli.ts --url https://www.instagram.com/<profile>/ \
 *     [--url ...] [--limit 20] [--newer-than "14 days"] [--category music] \
 *     [--out candidates.json] [--push]
 *
 * Without APIFY_API_TOKEN in server/.env it prints setup instructions and exits.
 * `--push` writes to the private `activity_candidates` table for review; it
 * never publishes anything.
 */
import { writeFileSync } from 'node:fs';

import { normalizeActivity } from '../../src/core/normalize.ts';
import { CATEGORIES, type Activity, type Category } from '../../src/core/types.ts';
import { loadServerEnv, parseArgs, redact } from './env.ts';
import { instagramPostToCandidate, runInstagramScraper, type PostSkipReason } from './instagram.ts';
import { createSupabaseWriter } from './supabaseWriter.ts';

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const env = loadServerEnv();
  const urls = flags.url ?? [];

  if (!env.apifyToken) {
    console.log(
      [
        'Instagram ingestion is optional and not configured.',
        '1. Copy server/.env.example to server/.env',
        '2. Set APIFY_API_TOKEN (Apify Console → Settings → API & Integrations)',
        '3. Run: node server/ingest/instagram-cli.ts --url https://www.instagram.com/<profile>/',
        'The app works fully without this.',
      ].join('\n'),
    );
    return;
  }
  if (!urls.length) throw new Error('Pass at least one --url (an Instagram profile, post or hashtag URL).');
  const category = flags.category?.[0];
  if (category && !(CATEGORIES as readonly string[]).includes(category)) {
    throw new Error(`--category must be one of: ${CATEGORIES.join(', ')}`);
  }
  const limit = Math.min(Math.max(Number(flags.limit?.[0] ?? 20) || 20, 1), 100);

  console.log(`Running ${env.apifyActorId} for ${urls.length} URL(s), up to ${limit} posts each…`);
  const items = await runInstagramScraper({
    token: env.apifyToken,
    actorId: env.apifyActorId,
    input: {
      directUrls: urls,
      resultsType: 'posts',
      resultsLimit: limit,
      addParentData: false,
      ...(flags['newer-than']?.[0] ? { onlyPostsNewerThan: flags['newer-than'][0] } : {}),
    },
  });

  const now = new Date();
  const skipped: Partial<Record<PostSkipReason | 'invalid', number>> = {};
  const candidates: { activity: Activity; raw: unknown; reviewHints: string[] }[] = [];
  for (const item of items) {
    const converted = instagramPostToCandidate(item, category ? { category: category as Category } : {});
    if (!converted.ok) {
      skipped[converted.reason] = (skipped[converted.reason] ?? 0) + 1;
      continue;
    }
    const normalized = normalizeActivity(converted.candidate.record, { platform: 'instagram', now });
    if (!normalized.ok) {
      skipped.invalid = (skipped.invalid ?? 0) + 1;
      continue;
    }
    candidates.push({
      activity: normalized.activity,
      raw: converted.candidate.raw,
      reviewHints: converted.candidate.reviewHints,
    });
  }
  // IDs derive from the post shortcode, so the same post fetched twice collapses here.
  const byId = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates) if (!byId.has(c.activity.id)) byId.set(c.activity.id, c);
  const keep = [...byId.values()];

  console.log(`${items.length} items → ${keep.length} candidates. Skipped: ${JSON.stringify(skipped)}`);
  console.log(
    'Candidates are unverified. Check date, place, price and availability with the organizer before publishing.',
  );

  const out = flags.out?.[0];
  if (out) {
    writeFileSync(
      out,
      JSON.stringify(
        keep.map(({ activity, reviewHints }) => ({ activity, reviewHints })),
        null,
        2,
      ),
    );
    console.log(`Wrote ${out}`);
  }
  if (flags.push) {
    if (!env.supabaseUrl || !env.supabaseSecretKey)
      throw new Error('--push needs SUPABASE_URL and SUPABASE_SECRET_KEY in server/.env');
    const writer = createSupabaseWriter({ url: env.supabaseUrl, secretKey: env.supabaseSecretKey });
    const written = await writer.upsertCandidates(keep);
    console.log(`Upserted ${written} rows into activity_candidates (not public).`);
  }
}

main().catch((error: unknown) => {
  const env = loadServerEnv();
  console.error(redact(`Error: ${(error as Error).message}`, env.apifyToken, env.supabaseSecretKey));
  process.exitCode = 1;
});
