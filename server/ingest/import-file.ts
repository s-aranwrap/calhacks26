/**
 * CLI: validate and normalize a CSV/JSON activity file, optionally upserting
 * it into the Supabase catalog.
 *
 *   node server/ingest/import-file.ts data/samples/activities.sample.csv \
 *     [--currency GBP] [--time-zone Europe/London] [--out normalized.json] \
 *     [--push] [--publish]
 *
 * Without --push nothing leaves your machine, so it doubles as a validator.
 * Rows are written unpublished unless --publish is given.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { detectFormat, importActivities, summarizeImport } from '../../src/core/importer.ts';
import { loadServerEnv, parseArgs, redact } from './env.ts';
import { createSupabaseWriter } from './supabaseWriter.ts';

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const file = positional[0];
  if (!file)
    throw new Error(
      'Usage: node server/ingest/import-file.ts <file.csv|file.json> [--out out.json] [--push] [--publish]',
    );

  const text = readFileSync(file, 'utf8');
  const format = detectFormat(basename(file), text);
  const report = importActivities(text, format, {
    now: new Date(),
    defaultCurrency: flags.currency?.[0]?.toUpperCase() ?? 'USD',
    ...(flags['time-zone']?.[0] ? { defaultTimeZone: flags['time-zone'][0] } : {}),
  });

  console.log(`${basename(file)} (${format}): ${summarizeImport(report)}`);
  if (report.unknownColumns.length) console.log(`Unknown columns ignored: ${report.unknownColumns.join(', ')}`);
  for (const issue of report.invalid.slice(0, 20)) {
    console.log(`  ✗ row ${issue.row}${issue.title ? ` (${issue.title})` : ''}: ${issue.messages.join('; ')}`);
  }
  for (const issue of report.warnings.slice(0, 20)) {
    console.log(`  ! row ${issue.row}${issue.title ? ` (${issue.title})` : ''}: ${issue.messages.join('; ')}`);
  }
  if (report.warnings.length > 20) console.log(`  … and ${report.warnings.length - 20} more warnings`);

  const out = flags.out?.[0];
  if (out) {
    writeFileSync(out, JSON.stringify(report.activities, null, 2));
    console.log(`Wrote ${report.activities.length} normalized activities to ${out}`);
  }

  if (flags.push) {
    const env = loadServerEnv();
    if (!env.supabaseUrl || !env.supabaseSecretKey)
      throw new Error('--push needs SUPABASE_URL and SUPABASE_SECRET_KEY in server/.env');
    const published = !!flags.publish;
    const writer = createSupabaseWriter({ url: env.supabaseUrl, secretKey: env.supabaseSecretKey });
    const written = await writer.upsertActivities(report.activities, published);
    console.log(
      `Upserted ${written} activities (${published ? 'published' : 'unpublished, use --publish to make them visible'}).`,
    );
  }
  if (report.invalid.some((i) => i.row > 0)) process.exitCode = 2;
}

main().catch((error: unknown) => {
  const env = loadServerEnv();
  console.error(redact(`Error: ${(error as Error).message}`, env.supabaseSecretKey));
  process.exitCode = 1;
});
