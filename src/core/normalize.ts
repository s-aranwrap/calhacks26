/**
 * Normalization: turns an untrusted, loosely-typed record (CSV row, JSON
 * object, Supabase row, scraped post) into a validated `Activity`.
 *
 * Principles:
 * - Never invent facts. Missing or malformed optional fields are dropped with a
 *   warning rather than guessed.
 * - Only `title` is strictly required. Everything else degrades gracefully.
 * - Records cannot promote themselves: "verified" needs a valid `last_checked_at`,
 *   demo fixtures are always "demo", and social-media imports default to "candidate".
 *
 * The flat snake_case record shape below is the documented import format and
 * mirrors the Supabase `activities` table columns, so every source shares one
 * code path.
 */
import {
  ACTIVITY_MOODS,
  CATEGORIES,
  type Activity,
  type ActivityKind,
  type ActivityMood,
  type Availability,
  type Category,
  type Certainty,
  type ChallengeFactors,
  type ChallengeScore,
  type Duration,
  type Price,
  type SourcePlatform,
  type Venue,
  type VerificationStatus,
} from './types.ts';
import { canonicalizeUrl, sanitizeHttpUrl } from './urls.ts';
import { isValidTimeZone, parseImportedDateTime } from './time.ts';
import { isValidLatitude, isValidLongitude, normalizeText, stableHash } from './util.ts';

/** Documented import columns. All optional except `title`. */
export const IMPORT_FIELDS = [
  'id',
  'kind',
  'title',
  'description',
  'category',
  'moods',
  'tags',
  'venue_name',
  'address',
  'area',
  'latitude',
  'longitude',
  'start_at',
  'end_at',
  'time_zone',
  'all_day',
  'opening_hours',
  'opening_hours_source',
  'duration_min_minutes',
  'duration_max_minutes',
  'duration_certainty',
  'is_free',
  'price_min',
  'price_max',
  'currency',
  'price_certainty',
  'price_note',
  'source_platform',
  'source_id',
  'source_url',
  'source_label',
  'source_published_at',
  'verification_status',
  'last_checked_at',
  'availability',
  'image_url',
  'what_to_expect',
  'why_try',
  'restrictions',
  'challenge_novelty',
  'challenge_social',
  'challenge_physical',
  'challenge_commitment',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type RawActivityRecord = Partial<Record<ImportField, unknown>> & Record<string, unknown>;

export interface NormalizeContext {
  /** Platform used when the record doesn't name one (or names one it may not claim). */
  platform: SourcePlatform;
  now: Date;
  defaultCurrency?: string;
  defaultTimeZone?: string;
}

export type NormalizeResult =
  { ok: true; activity: Activity; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

const VERIFICATION_STATUSES: readonly VerificationStatus[] = ['verified', 'unverified', 'candidate', 'demo'];
const AVAILABILITIES: readonly Availability[] = ['available', 'limited', 'sold_out', 'cancelled', 'unknown'];
const PLATFORMS: readonly SourcePlatform[] = ['demo', 'organizer', 'csv', 'json', 'instagram', 'manual', 'supabase'];

/** Default moods when a record doesn't specify any. Inferred, and flagged as such in warnings. */
const CATEGORY_MOODS: Record<Category, ActivityMood[]> = {
  outdoors: ['chill', 'active'],
  arts: ['creative', 'chill'],
  music: ['social', 'chill'],
  food: ['social', 'chill'],
  learning: ['creative'],
  community: ['social'],
  wellness: ['chill'],
  fitness: ['active'],
  games: ['social'],
  culture: ['chill', 'creative'],
  other: ['chill'],
};

const MAX_DURATION_MINUTES = 7 * 24 * 60;

// ---------------------------------------------------------------------------
// Field readers. Each returns undefined for missing/blank input.
// ---------------------------------------------------------------------------

function readString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
}

/** Like readString but keeps paragraph breaks (descriptions). */
function readText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return readString(value, maxLength);
  const cleaned = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
}

function readNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string') {
    const cleaned = value
      .trim()
      .replace(/^[$€£¥]/, '')
      .replace(/,/g, '');
    if (!cleaned) return undefined;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(v)) return true;
    if (['false', 'no', 'n', '0'].includes(v)) return false;
  }
  return undefined;
}

/** Lists may be JSON arrays or strings separated by `|`, `;` or `,`. */
function readList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String);
  }
  if (typeof value === 'string') return value.split(/[|;,]/);
  return [];
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_') as T;
  return allowed.includes(v) ? v : undefined;
}

function readChallengeScore(value: unknown): ChallengeScore | undefined {
  const n = readNumber(value);
  if (n === 0 || n === 1 || n === 2) return n;
  return undefined;
}

// ---------------------------------------------------------------------------

/**
 * Deterministic ID so re-importing the same listing updates rather than
 * duplicates it. Preference: platform+source ID > canonical URL > content fingerprint.
 */
export function deriveActivityId(input: {
  platform: SourcePlatform;
  sourceId?: string;
  sourceUrl?: string;
  title: string;
  startAt?: string;
  venueName?: string;
}): string {
  if (input.sourceId) return `act_${stableHash(`src:${input.platform}:${input.sourceId}`)}`;
  const canonical = canonicalizeUrl(input.sourceUrl);
  if (canonical) return `act_${stableHash(`url:${canonical}`)}`;
  const fingerprint = [
    normalizeText(input.title),
    input.startAt?.slice(0, 16) ?? 'evergreen',
    normalizeText(input.venueName ?? ''),
  ].join('|');
  return `act_${stableHash(`fp:${fingerprint}`)}`;
}

export function normalizeActivity(raw: unknown, ctx: NormalizeContext): NormalizeResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['record is not an object'], warnings };
  }
  // Database rows use null for "no value"; treat it exactly like a missing field.
  const r = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== null && v !== undefined),
  ) as RawActivityRecord;

  const title = readString(r.title, 140);
  if (!title) errors.push('title is required');

  // --- Source & trust -------------------------------------------------------
  const claimedPlatform = readEnum(r.source_platform, PLATFORMS);
  // A record may refine its platform (e.g. "organizer" inside a CSV) but can
  // never claim to be bundled demo content, and demo fixtures stay demo.
  let platform: SourcePlatform = ctx.platform;
  if (ctx.platform !== 'demo' && claimedPlatform && claimedPlatform !== 'demo') platform = claimedPlatform;

  const sourceUrl = sanitizeHttpUrl(r.source_url);
  if (r.source_url && !sourceUrl) warnings.push('source_url dropped: only http(s) links are allowed');
  const sourceId = readString(r.source_id, 128);
  const lastChecked = r.last_checked_at ? parseImportedDateTime(r.last_checked_at) : undefined;
  if (lastChecked && !lastChecked.ok) warnings.push(`last_checked_at ignored (${lastChecked.error})`);
  const lastCheckedAt = lastChecked?.ok ? lastChecked.iso : undefined;

  let status: VerificationStatus =
    readEnum(r.verification_status, VERIFICATION_STATUSES) ??
    (platform === 'instagram' ? 'candidate' : platform === 'demo' ? 'demo' : 'unverified');
  if (r.verification_status && !readEnum(r.verification_status, VERIFICATION_STATUSES)) {
    warnings.push(`unknown verification_status "${String(r.verification_status)}", treated as ${status}`);
  }
  if (ctx.platform === 'demo') status = 'demo';
  if (platform === 'instagram' && status === 'verified' && !lastCheckedAt) status = 'candidate';
  if (status === 'verified' && !lastCheckedAt) {
    status = 'unverified';
    warnings.push('verification_status "verified" needs a valid last_checked_at; downgraded to unverified');
  }
  const isVerified = status === 'verified';

  // --- Basic content -------------------------------------------------------
  const description = readText(r.description, 2000) ?? '';
  if (!description) warnings.push('description is empty');

  let category = readEnum(r.category, CATEGORIES);
  if (!category) {
    if (r.category) warnings.push(`unknown category "${String(r.category)}", using "other"`);
    category = 'other';
  }

  const moodInputs = readList(r.moods);
  let moods = [...new Set(moodInputs.map((m) => readEnum(m, ACTIVITY_MOODS)).filter((m): m is ActivityMood => !!m))];
  const invalidMoods = moodInputs.filter((m) => m.trim() && !readEnum(m, ACTIVITY_MOODS));
  if (invalidMoods.length) warnings.push(`ignored unknown moods: ${invalidMoods.map((m) => m.trim()).join(', ')}`);
  if (!moods.length) {
    moods = CATEGORY_MOODS[category];
    warnings.push(`moods inferred from category (${moods.join(', ')})`);
  }

  const tags = [
    ...new Set(
      readList(r.tags)
        .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
        .filter((t) => t.length > 0 && t.length <= 32),
    ),
  ].slice(0, 12);

  // --- Time ----------------------------------------------------------------
  const timeZoneInput = readString(r.time_zone, 64);
  let timeZone: string | undefined;
  if (timeZoneInput) {
    if (isValidTimeZone(timeZoneInput)) timeZone = timeZoneInput;
    else warnings.push(`time_zone "${timeZoneInput}" is not a valid IANA zone`);
  }
  if (!timeZone && isValidTimeZone(ctx.defaultTimeZone)) timeZone = ctx.defaultTimeZone;

  const explicitKind = readEnum<ActivityKind>(r.kind, ['event', 'evergreen']);
  if (r.kind && !explicitKind) warnings.push(`unknown kind "${String(r.kind)}"`);

  let startAt: string | undefined;
  let endAt: string | undefined;
  // All-day events may give bare dates: the start is local midnight and the end the end of the last day.
  const allDayInput = readBoolean(r.all_day) === true;
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  const asStart = (v: unknown) =>
    allDayInput && typeof v === 'string' && DATE_ONLY.test(v.trim()) ? `${v.trim()} 00:00` : v;
  const asEnd = (v: unknown) =>
    allDayInput && typeof v === 'string' && DATE_ONLY.test(v.trim()) ? `${v.trim()} 23:59` : v;
  if (r.start_at !== undefined && r.start_at !== '') {
    const parsed = parseImportedDateTime(asStart(r.start_at), timeZone);
    if (parsed.ok) startAt = parsed.iso;
    else warnings.push(`start_at ignored (${parsed.error})`);
  }
  if (r.end_at !== undefined && r.end_at !== '') {
    const parsed = parseImportedDateTime(asEnd(r.end_at), timeZone);
    if (parsed.ok) endAt = parsed.iso;
    else warnings.push(`end_at ignored (${parsed.error})`);
  } else if (allDayInput && typeof r.start_at === 'string' && DATE_ONLY.test(r.start_at.trim())) {
    const parsed = parseImportedDateTime(asEnd(r.start_at), timeZone);
    if (parsed.ok) endAt = parsed.iso;
  }
  const kind: ActivityKind = explicitKind ?? (r.start_at ? 'event' : 'evergreen');
  if (kind === 'evergreen' && (startAt || endAt)) {
    warnings.push('evergreen activities ignore start_at/end_at');
    startAt = undefined;
    endAt = undefined;
  }
  if (kind === 'event' && !startAt) {
    warnings.push('event has no valid start time and will not be recommended until one is added');
  }
  if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) {
    warnings.push('end_at is not after start_at; end time dropped');
    endAt = undefined;
  }

  // --- Duration ------------------------------------------------------------
  let duration: Duration | undefined;
  const dMin = readNumber(r.duration_min_minutes ?? r.duration_minutes);
  const dMax = readNumber(r.duration_max_minutes);
  if (dMin !== undefined) {
    if (Number.isNaN(dMin) || dMin <= 0 || dMin > MAX_DURATION_MINUTES) {
      warnings.push('duration_min_minutes must be a positive number of minutes; duration unknown');
    } else {
      let maxMinutes: number | undefined;
      if (dMax !== undefined) {
        if (!Number.isNaN(dMax) && dMax >= dMin && dMax <= MAX_DURATION_MINUTES) maxMinutes = Math.round(dMax);
        else warnings.push('duration_max_minutes ignored (must be ≥ duration_min_minutes)');
      }
      duration = {
        minMinutes: Math.round(dMin),
        ...(maxMinutes !== undefined && maxMinutes !== Math.round(dMin) ? { maxMinutes } : {}),
        certainty: readCertainty(r.duration_certainty, isVerified, 'duration', warnings),
      };
    }
  } else if (startAt && endAt && !allDayInput) {
    // Derived from verified-or-not source times, so it's as certain as the times themselves.
    // (All-day events have no meaningful window: "Nov 8" doesn't mean a 24-hour commitment.)
    const minutes = Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000);
    if (minutes > 0 && minutes <= MAX_DURATION_MINUTES) {
      duration = { minMinutes: minutes, certainty: isVerified ? 'verified' : 'estimated', basis: 'event_window' };
    }
  }

  // --- Price ---------------------------------------------------------------
  let price: Price | undefined;
  const isFree = readBoolean(r.is_free);
  const pMin = readNumber(r.price_min);
  const pMax = readNumber(r.price_max);
  const currencyInput = readString(r.currency, 8)?.toUpperCase();
  const currency = currencyInput && /^[A-Z]{3}$/.test(currencyInput) ? currencyInput : (ctx.defaultCurrency ?? 'USD');
  if (currencyInput && currency !== currencyInput)
    warnings.push(`currency "${currencyInput}" is not an ISO code; using ${currency}`);
  const priceNote = readString(r.price_note, 120);

  if (isFree === true || pMin === 0) {
    price = {
      minAmount: 0,
      currency,
      certainty: readCertainty(r.price_certainty, isVerified, 'price', warnings),
      ...(priceNote ? { note: priceNote } : {}),
    };
    if (pMin !== undefined && pMin > 0) warnings.push('is_free is true but price_min > 0; treated as free');
  } else if (pMin !== undefined) {
    if (Number.isNaN(pMin) || pMin < 0) {
      warnings.push('price_min must be a non-negative number; price unknown');
    } else {
      let maxAmount: number | undefined;
      if (pMax !== undefined) {
        if (!Number.isNaN(pMax) && pMax >= pMin) maxAmount = pMax;
        else warnings.push('price_max ignored (must be ≥ price_min)');
      }
      price = {
        minAmount: pMin,
        ...(maxAmount !== undefined && maxAmount !== pMin ? { maxAmount } : {}),
        currency,
        certainty: readCertainty(r.price_certainty, isVerified, 'price', warnings),
        ...(priceNote ? { note: priceNote } : {}),
      };
    }
  } else if (pMax !== undefined) {
    warnings.push('price_max without price_min; price treated as unknown');
  }

  // --- Venue ---------------------------------------------------------------
  let venue: Venue | undefined;
  const venueName = readString(r.venue_name, 120);
  const address = readString(r.address, 240);
  const area = readString(r.area, 80);
  const lat = readNumber(r.latitude);
  const lng = readNumber(r.longitude);
  let coords: { latitude: number; longitude: number } | undefined;
  if (lat !== undefined || lng !== undefined) {
    if (isValidLatitude(lat) && isValidLongitude(lng) && !(lat === 0 && lng === 0)) {
      coords = { latitude: lat, longitude: lng };
    } else {
      warnings.push('latitude/longitude invalid or incomplete; coordinates dropped');
    }
  }
  if (venueName || address || area || coords) {
    venue = {
      name: venueName ?? area ?? 'Location details unavailable',
      ...(address ? { address } : {}),
      ...(area ? { area } : {}),
      ...(coords ?? {}),
    };
  }

  // --- Misc ----------------------------------------------------------------
  const availabilityInput = readEnum(r.availability, AVAILABILITIES);
  if (r.availability && !availabilityInput)
    warnings.push(`unknown availability "${String(r.availability)}", using unknown`);
  const availability: Availability = availabilityInput ?? 'unknown';

  const imageUrl = sanitizeHttpUrl(r.image_url, { httpsOnly: true });
  if (r.image_url && !imageUrl) warnings.push('image_url dropped: only https images are allowed');

  const publishedAt = r.source_published_at ? parseImportedDateTime(r.source_published_at) : undefined;
  if (publishedAt && !publishedAt.ok) warnings.push(`source_published_at ignored (${publishedAt.error})`);

  const challenge: Partial<ChallengeFactors> = {};
  for (const key of ['novelty', 'social', 'physical', 'commitment'] as const) {
    const rawValue = r[`challenge_${key}`];
    if (rawValue === undefined || rawValue === '') continue;
    const score = readChallengeScore(rawValue);
    if (score === undefined) warnings.push(`challenge_${key} must be 0, 1 or 2`);
    else challenge[key] = score;
  }

  if (errors.length || !title) return { ok: false, errors, warnings };

  const explicitId = readString(r.id, 64);
  const safeExplicitId = explicitId && /^[A-Za-z0-9_.:-]+$/.test(explicitId) ? explicitId : undefined;
  if (explicitId && !safeExplicitId)
    warnings.push('id contains unsupported characters; a stable id was derived instead');
  const id =
    safeExplicitId ??
    deriveActivityId({
      platform,
      title,
      ...(sourceId ? { sourceId } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(startAt ? { startAt } : {}),
      ...(venueName ? { venueName } : {}),
    });

  const openingHours = kind === 'evergreen' ? readString(r.opening_hours, 160) : undefined;
  const openingHoursSource = openingHours ? readString(r.opening_hours_source, 120) : undefined;
  const allDay = kind === 'event' && allDayInput && startAt !== undefined;
  const sourceLabel = readString(r.source_label, 120);
  const whatToExpect = readText(r.what_to_expect, 600);
  const whyTry = readText(r.why_try, 400);
  const restrictions = readText(r.restrictions, 300);

  const activity: Activity = {
    id,
    kind,
    title,
    description,
    category,
    moods,
    tags,
    ...(venue ? { venue } : {}),
    ...(startAt ? { startAt } : {}),
    ...(endAt ? { endAt } : {}),
    ...(allDay ? { allDay: true } : {}),
    ...(timeZone ? { timeZone } : {}),
    ...(openingHours ? { openingHours } : {}),
    ...(openingHoursSource ? { openingHoursSource } : {}),
    ...(duration ? { duration } : {}),
    ...(price ? { price } : {}),
    source: {
      platform,
      ...(sourceUrl ? { url: sourceUrl } : {}),
      ...(sourceId ? { sourceId } : {}),
      ...(sourceLabel ? { label: sourceLabel } : {}),
      ...(publishedAt?.ok ? { publishedAt: publishedAt.iso } : {}),
      retrievedAt: ctx.now.toISOString(),
    },
    verification: { status, ...(lastCheckedAt ? { lastCheckedAt } : {}) },
    availability,
    ...(imageUrl ? { imageUrl } : {}),
    ...(whatToExpect ? { whatToExpect } : {}),
    ...(whyTry ? { whyTry } : {}),
    ...(restrictions ? { restrictions } : {}),
    ...(Object.keys(challenge).length ? { challenge } : {}),
  };
  return { ok: true, activity, warnings };
}

function readCertainty(value: unknown, recordVerified: boolean, field: string, warnings: string[]): Certainty {
  const explicit = readEnum<Certainty>(value, ['verified', 'estimated']);
  if (explicit === 'verified' && !recordVerified) {
    warnings.push(`${field} marked verified on an unverified record; treated as estimated`);
    return 'estimated';
  }
  return explicit ?? (recordVerified ? 'verified' : 'estimated');
}
