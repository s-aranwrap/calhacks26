/**
 * Rule-based extraction of an event's date, time and price from an Instagram
 * caption, for the San Francisco demo.
 *
 * It is deliberately conservative: it returns an event only when the caption
 * names exactly one date and at least one clock time. Anything ambiguous
 * (several dates, no time, a date in the past) is skipped rather than guessed.
 * Results are still estimates, so the pipeline marks price and duration
 * "estimated" and the record "unverified".
 */

export interface ExtractedEvent {
  /** Wall-clock start in the event's zone, "YYYY-MM-DD HH:MM". */
  startWall: string;
  endWall?: string;
  priceMin?: number;
  priceMax?: number;
  isFree?: boolean;
  /** The caption snippets the values came from, for debugging and review. */
  evidence: string[];
}

export type ExtractResult =
  { ok: true; event: ExtractedEvent } | { ok: false; reason: 'no_date' | 'ambiguous_date' | 'no_time' | 'too_old' };

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const WEEKDAY_NAMES = Object.keys(WEEKDAYS)
  .sort((a, b) => b.length - a.length)
  .join('|');

const pad = (n: number) => String(n).padStart(2, '0');

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Calendar date of an instant in a time zone. */
function dateInZone(ms: number, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ms);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function dayNumber(d: CalendarDate): number {
  return Date.UTC(d.year, d.month - 1, d.day) / 86_400_000;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** Picks the year that puts month/day closest after the post (from a week before to ~10 months after). */
function inferYear(month: number, day: number, posted: CalendarDate): CalendarDate | null {
  for (const year of [posted.year, posted.year + 1, posted.year - 1]) {
    if (!isRealDate(year, month, day)) continue;
    const delta = dayNumber({ year, month, day }) - dayNumber(posted);
    // Up to two months back, so a recent past date is reported as too old rather than missing.
    if (delta >= -60 && delta <= 300) return { year, month, day };
  }
  return null;
}

function findDates(text: string, posted: CalendarDate): { dates: CalendarDate[]; evidence: string[] } {
  const found: CalendarDate[] = [];
  const evidence: string[] = [];
  const add = (d: CalendarDate | null, snippet: string) => {
    if (!d) return;
    if (!found.some((f) => f.year === d.year && f.month === d.month && f.day === d.day)) found.push(d);
    evidence.push(snippet.trim());
  };

  // "Nov 8", "November 8th", "Sat, Nov 8"
  for (const m of text.matchAll(
    new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?::|am|pm))`, 'gi'),
  )) {
    add(inferYear(MONTHS[m[1]!.toLowerCase()]!, Number(m[2]), posted), m[0]);
  }
  // "8 Nov", "8th November"
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAMES})\\b`, 'gi'))) {
    add(inferYear(MONTHS[m[2]!.toLowerCase()]!, Number(m[1]), posted), m[0]);
  }
  // "11/8" or "11/8/26" (US month/day). Not preceded/followed by digits, so prices like 1/2 off in "1/2/3" don't match.
  for (const m of text.matchAll(/(?<![\d/])(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])(?:\/(\d{2}|\d{4}))?(?![\d/])/g)) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (m[3]) {
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      if (isRealDate(year, month, day)) add({ year, month, day }, m[0]);
    } else {
      add(inferYear(month, day, posted), m[0]);
    }
  }

  if (found.length === 0) {
    // Relative words, only when no explicit date was written.
    const relative = text.match(/\b(tonight|today|tomorrow)\b/i);
    if (relative) {
      const offset = relative[1]!.toLowerCase() === 'tomorrow' ? 1 : 0;
      const d = new Date(Date.UTC(posted.year, posted.month - 1, posted.day + offset));
      add({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, relative[0]);
    } else {
      const weekdays = [...text.matchAll(new RegExp(`\\b(?:this\\s+)?(${WEEKDAY_NAMES})\\b`, 'gi'))];
      const distinct = new Set(weekdays.map((w) => WEEKDAYS[w[1]!.toLowerCase()]));
      if (distinct.size === 1) {
        const target = [...distinct][0]!;
        const postedWeekday = new Date(Date.UTC(posted.year, posted.month - 1, posted.day)).getUTCDay();
        const offset = (target - postedWeekday + 7) % 7;
        const d = new Date(Date.UTC(posted.year, posted.month - 1, posted.day + offset));
        add({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, weekdays[0]![0]);
      }
    }
  }
  return { dates: found, evidence };
}

function to24h(hour: number, meridiem: string | undefined): number {
  if (!meridiem) return hour;
  const pm = meridiem.toLowerCase().startsWith('p');
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

function findTimes(text: string): { start: [number, number]; end?: [number, number]; evidence: string } | null {
  // Ranges like "7-10pm", "7:30 pm – 10 pm", "11am to 2pm"
  const range = text.match(
    /\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)/i,
  );
  if (range) {
    const endMer = range[6]!;
    let startHour = to24h(Number(range[1]), range[3] ?? endMer);
    const endHour = to24h(Number(range[4]), endMer);
    if (!range[3] && startHour > endHour) startHour -= 12; // "11-2pm" means 11am–2pm
    if (startHour >= 0 && startHour < 24 && endHour < 24 && Number(range[1]) <= 12 && Number(range[4]) <= 12) {
      return { start: [startHour, Number(range[2] ?? 0)], end: [endHour, Number(range[5] ?? 0)], evidence: range[0] };
    }
  }
  const single = text.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/i);
  if (single && Number(single[1]) >= 1 && Number(single[1]) <= 12) {
    return { start: [to24h(Number(single[1]), single[3]), Number(single[2] ?? 0)], evidence: single[0] };
  }
  const noon = text.match(/\b(noon|midday)\b/i);
  if (noon) return { start: [12, 0], evidence: noon[0] };
  const twentyFour = text.match(/\b(1[3-9]|2[0-3]):([0-5]\d)\b/);
  if (twentyFour) return { start: [Number(twentyFour[1]), Number(twentyFour[2])], evidence: twentyFour[0] };
  return null;
}

const FREE_WORDS =
  /\b(free (?:entry|admission|event|show|to attend|for all|and open to the public)|admission (?:is )?free|no cover|free with rsvp)\b/i;
/** A line that opens with "Free …" ("Free outdoor movie night!"). */
const FREE_LEADING = /^\s*free\b(?![\w-])/im;
/** All-caps FREE as its own word ("FREE show"), but not "gluten-FREE". */
const FREE_CAPS = /(?<![\w-])FREE(?![\w-])/;

function findPrice(text: string): Pick<ExtractedEvent, 'priceMin' | 'priceMax' | 'isFree'> & { evidence?: string } {
  const free = text.match(FREE_WORDS) ?? text.match(FREE_CAPS) ?? text.match(FREE_LEADING);
  const dollars = text.match(/\$(\d{1,4})(?:\.(\d{2}))?(?:\s*(?:-|–|to)\s*\$?(\d{1,4}))?/);
  if (free && dollars) return {}; // conflicting signals: leave the price unknown
  if (free) return { isFree: true, evidence: free[0] };
  if (dollars) {
    const min = Number(`${dollars[1]}${dollars[2] ? `.${dollars[2]}` : ''}`);
    const max = dollars[3] ? Number(dollars[3]) : undefined;
    return { priceMin: min, ...(max !== undefined && max > min ? { priceMax: max } : {}), evidence: dollars[0] };
  }
  return {};
}

/**
 * @param postedAtIso when the post was published (used to infer the year and "tonight")
 * @param now drop events that started more than a few hours before this
 */
export function extractEventFromCaption(
  caption: string,
  postedAtIso: string,
  now: Date,
  timeZone = 'America/Los_Angeles',
): ExtractResult {
  const postedMs = Date.parse(postedAtIso);
  const posted = dateInZone(Number.isFinite(postedMs) ? postedMs : now.getTime(), timeZone);
  const { dates, evidence } = findDates(caption, posted);
  if (dates.length === 0) return { ok: false, reason: 'no_date' };
  if (dates.length > 1) return { ok: false, reason: 'ambiguous_date' };
  const time = findTimes(caption);
  if (!time) return { ok: false, reason: 'no_time' };

  const date = dates[0]!;
  const today = dateInZone(now.getTime(), timeZone);
  if (dayNumber(date) < dayNumber(today)) return { ok: false, reason: 'too_old' };

  const ymd = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
  const price = findPrice(caption);
  const event: ExtractedEvent = {
    startWall: `${ymd} ${pad(time.start[0])}:${pad(time.start[1])}`,
    ...(time.end ? { endWall: `${ymd} ${pad(time.end[0])}:${pad(time.end[1])}` } : {}),
    ...(price.isFree ? { isFree: true } : {}),
    ...(price.priceMin !== undefined ? { priceMin: price.priceMin } : {}),
    ...(price.priceMax !== undefined ? { priceMax: price.priceMax } : {}),
    evidence: [...evidence, time.evidence, ...(price.evidence ? [price.evidence] : [])],
  };
  // An end time earlier than the start (e.g. "10pm-2am") crosses midnight; drop the end rather than guess.
  if (event.endWall && event.endWall <= event.startWall) delete event.endWall;
  return { ok: true, event };
}

/** Category guess from caption keywords; first match wins, so order matters. */
const CATEGORY_KEYWORDS: [string, RegExp][] = [
  ['games', /\b(trivia|game night|board games?|bingo|karaoke)\b/i],
  ['music', /\b(live music|concert|dj|band|jazz|open mic|choir|symphony|gig)\b/i],
  ['fitness', /\b(run club|running|yoga|hike|bike ride|cycling|dance class|salsa|climbing|pilates)\b/i],
  ['community', /\b(volunteer|clean[- ]?up|meetup|community|swap)\b/i],
  ['learning', /\b(talk|lecture|panel|class|workshop|science|book club)\b/i],
  ['arts', /\b(art|gallery|exhibit(?:ion)?|mural|craft|paint(?:ing)?|pottery|film|movies?|screening|comedy|improv)\b/i],
  ['food', /\b(food|market|tasting|brunch|dinner|pop[- ]?up|beer|wine|coffee)\b/i],
  ['outdoors', /\b(park|beach|picnic|garden|outdoor)\b/i],
  ['culture', /\b(museum|festival|parade|history|cultural)\b/i],
];

export function guessCategory(caption: string, fallback: string): string {
  return CATEGORY_KEYWORDS.find(([, re]) => re.test(caption))?.[0] ?? fallback;
}
