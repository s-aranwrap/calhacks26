/**
 * CSV/JSON import. Shared by the in-app importer (Settings) and the
 * server-side CLI, and built on the same normalize + dedupe pipeline as every
 * other source.
 *
 * JSON input may be an array of records or `{ "activities": [...] }`.
 * CSV input uses the same column names (see IMPORT_FIELDS / README).
 */
import { parseCsv } from './csv.ts';
import { dedupeActivities, type DuplicateReport } from './dedupe.ts';
import { IMPORT_FIELDS, normalizeActivity, type NormalizeContext } from './normalize.ts';
import type { Activity } from './types.ts';

export type ImportFormat = 'csv' | 'json';

export interface ImportRowIssue {
  /** 1-based CSV line or JSON array index + 1. */
  row: number;
  title?: string;
  messages: string[];
}

export interface ImportReport {
  format: ImportFormat;
  totalRows: number;
  activities: Activity[];
  invalid: ImportRowIssue[];
  warnings: ImportRowIssue[];
  duplicates: DuplicateReport[];
  unknownColumns: string[];
}

export const MAX_IMPORT_ROWS = 5000;

export function detectFormat(fileName: string | undefined, text: string): ImportFormat {
  const lower = fileName?.toLowerCase() ?? '';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.csv')) return 'csv';
  const first = text.trimStart()[0];
  return first === '[' || first === '{' ? 'json' : 'csv';
}

export function importActivities(
  text: string,
  format: ImportFormat,
  ctx: Omit<NormalizeContext, 'platform'> & { platform?: NormalizeContext['platform'] },
): ImportReport {
  const report: ImportReport = {
    format,
    totalRows: 0,
    activities: [],
    invalid: [],
    warnings: [],
    duplicates: [],
    unknownColumns: [],
  };
  const normalizeCtx: NormalizeContext = { ...ctx, platform: ctx.platform ?? format };

  let records: { row: number; value: unknown }[] = [];
  if (format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      report.invalid.push({ row: 0, messages: [`invalid JSON: ${(error as Error).message}`] });
      return report;
    }
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { activities?: unknown }).activities)
        ? (parsed as { activities: unknown[] }).activities
        : null;
    if (!list) {
      report.invalid.push({ row: 0, messages: ['JSON must be an array of activities or { "activities": [...] }'] });
      return report;
    }
    records = list.map((value, index) => ({ row: index + 1, value }));
    const keys = new Set<string>();
    for (const r of list) if (r && typeof r === 'object') Object.keys(r).forEach((k) => keys.add(k));
    report.unknownColumns = [...keys].filter(
      (k) => !(IMPORT_FIELDS as readonly string[]).includes(k) && k !== 'duration_minutes',
    );
  } else {
    const csv = parseCsv(text);
    for (const e of csv.errors) report.invalid.push({ row: e.line, messages: [e.message] });
    records = csv.rows.map((r) => ({ row: r.line, value: r.values }));
    report.unknownColumns = csv.headers.filter(
      (h) => h && !(IMPORT_FIELDS as readonly string[]).includes(h) && h !== 'duration_minutes',
    );
  }

  report.totalRows = records.length;
  if (records.length > MAX_IMPORT_ROWS) {
    report.invalid.push({ row: 0, messages: [`only the first ${MAX_IMPORT_ROWS} rows were imported`] });
    records = records.slice(0, MAX_IMPORT_ROWS);
  }

  const valid: Activity[] = [];
  for (const { row, value } of records) {
    const result = normalizeActivity(value, normalizeCtx);
    const title = value && typeof value === 'object' ? (value as { title?: unknown }).title : undefined;
    const label = typeof title === 'string' && title.trim() ? { title: title.trim().slice(0, 80) } : {};
    if (!result.ok) {
      report.invalid.push({ row, ...label, messages: [...result.errors, ...result.warnings] });
      continue;
    }
    if (result.warnings.length) report.warnings.push({ row, ...label, messages: result.warnings });
    valid.push(result.activity);
  }

  const deduped = dedupeActivities(valid);
  report.activities = deduped.activities;
  report.duplicates = deduped.duplicates;
  return report;
}

/** One-line human summary, e.g. "12 activities imported · 2 rows skipped · 1 duplicate merged". */
export function summarizeImport(report: ImportReport): string {
  const parts = [`${report.activities.length} ${report.activities.length === 1 ? 'activity' : 'activities'} imported`];
  const skipped = report.invalid.filter((i) => i.row > 0).length;
  if (skipped) parts.push(`${skipped} ${skipped === 1 ? 'row' : 'rows'} skipped`);
  if (report.duplicates.length)
    parts.push(`${report.duplicates.length} duplicate${report.duplicates.length === 1 ? '' : 's'} merged`);
  return parts.join(' · ');
}
