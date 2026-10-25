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

// ---------------------------------------------------------------------------
// Multi-event extraction
// ---------------------------------------------------------------------------
//
// The single-event rules above miss most of what makes Instagram useful:
// roundup posts ("This weekend: Sat 11/8 · Night Market … Sun 11/9 · Swap
// meet …"), date-only announcements ("Open studios Nov 8"), exhibitions that
// run for weeks ("on view through Jan 4") and weekly regulars ("Trivia every
// Tuesday, 7pm"). extractEventsFromCaption reads all of those. It still
// refuses to invent anything: a date with no time becomes an all-day event
// shown as "time not listed", and dates that clearly aren't event dates
// (ticket sales, deadlines, recaps) are ignored.

/** One event read from a caption. Dates are local to the city's time zone. */
export interface CaptionEvent {
  /** Set when the caption lists several events and this one has its own line. */
  title?: string;
  /** "📍 The Chapel", "at Dolores Park", "@ Public Works". */
  venue?: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** Last day of a multi-day run. */
  endDate?: string;
  /** "YYYY-MM-DD HH:MM", only when a clock time was written. */
  startWall?: string;
  endWall?: string;
  /** No clock time (date only, or a multi-day run). */
  allDay: boolean;
  /** Read from "every Tuesday" / "Tuesdays": this is the next occurrence. */
  recurring?: boolean;
  priceMin?: number;
  priceMax?: number;
  isFree?: boolean;
  /** Text the event was read from, for categorizing and review. */
  text: string;
  evidence: string[];
}

export type CaptionSkipReason = 'no_date' | 'ambiguous_date' | 'too_old' | 'no_time';

export interface CaptionExtraction {
  events: CaptionEvent[];
  /** Why nothing was found, when events is empty. */
  skipped?: CaptionSkipReason;
  /** "multi" when the caption was split into several blocks. */
  mode: 'single' | 'multi';
}

interface DateHit {
  start: CalendarDate;
  end?: CalendarDate;
  recurring?: boolean;
  /** Read from a bare weekday name: only trusted together with a clock time. */
  weak?: boolean;
  snippet: string;
}

const ymd = (d: CalendarDate) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;
const addDays = (d: CalendarDate, n: number): CalendarDate => {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
};
const weekdayOf = (d: CalendarDate) => new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();

const FULL_WEEKDAYS = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday';
const SHORT_WEEKDAYS = 'Sun|Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat|SUN|MON|TUES?|WED|THU(?:RS?)?|FRI|SAT';
const MONTH_DAY = `(?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?`;
const NUMERIC_DAY = '(?:1[0-2]|0?[1-9])\\/(?:3[01]|[12]\\d|0?[1-9])(?:\\/(?:\\d{4}|\\d{2}))?';
/** Words just before a date that mean it isn't when the event happens. */
const NON_EVENT_CONTEXT =
  /\b(?:on sale|presale|pre-sale|deadline|apply|applications?|register by|rsvp by|submit|submissions?|enter by|entries|giveaway|winners?|announced|recap|was|were|last (?:week|weekend|night|year)|thank(?:s| you))\b[^.!?\n]{0,25}$/i;
const NOT_A_TIME = '(?!\\s*(?::\\d|am\\b|pm\\b|a\\.m|p\\.m))';

function parseOneDate(text: string, posted: CalendarDate): CalendarDate | null {
  let m = text.match(new RegExp(`^(${MONTH_NAMES})\\.?\\s+(\\d{1,2})`, 'i'));
  if (m) return inferYear(MONTHS[m[1]!.toLowerCase()]!, Number(m[2]), posted);
  m = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (m[3]) {
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return isRealDate(year, month, day) ? { year, month, day } : null;
    }
    return inferYear(month, day, posted);
  }
  return null;
}

/** Explicit dates and date ranges, with the matched text masked out so it isn't read twice. */
function scanExplicitDates(input: string, posted: CalendarDate): DateHit[] {
  let text = input;
  const hits: DateHit[] = [];
  const mask = (m: RegExpMatchArray) => {
    text = text.slice(0, m.index!) + ' '.repeat(m[0].length) + text.slice(m.index! + m[0].length);
  };
  const ignored = (m: RegExpMatchArray) => NON_EVENT_CONTEXT.test(input.slice(Math.max(0, m.index! - 40), m.index!));

  // "Nov 8–10", "Nov 28 - Dec 2", "11/8-11/10"
  const ranges = [
    new RegExp(
      `\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to|through|thru)\\s*(?:(${MONTH_NAMES})\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b${NOT_A_TIME}`,
      'gi',
    ),
    new RegExp(`(?<![\\d/$])(${NUMERIC_DAY})\\s*(?:-|–|—|to|through|thru)\\s*(${NUMERIC_DAY})(?![\\d/])`, 'g'),
  ];
  for (const m of [...input.matchAll(ranges[0]!)]) {
    if (ignored(m)) continue;
    const startMonth = MONTHS[m[1]!.toLowerCase()]!;
    const endMonth = m[3] ? MONTHS[m[3].toLowerCase()]! : startMonth;
    const start = inferYear(startMonth, Number(m[2]), posted);
    let end = start ? inferYear(endMonth, Number(m[4]), start) : null;
    if (start && end && dayNumber(end) < dayNumber(start)) end = inferYear(endMonth, Number(m[4]), addDays(start, 1));
    if (start && end && dayNumber(end) > dayNumber(start) && dayNumber(end) - dayNumber(start) <= 180) {
      hits.push({ start, end, snippet: m[0] });
      mask(m);
    }
  }
  for (const m of [...text.matchAll(ranges[1]!)]) {
    if (ignored(m)) continue;
    const start = parseOneDate(m[1]!, posted);
    const end = start ? parseOneDate(m[2]!, start) : null;
    if (start && end && dayNumber(end) > dayNumber(start) && dayNumber(end) - dayNumber(start) <= 180) {
      hits.push({ start, end, snippet: m[0] });
      mask(m);
    }
  }
  // "on view through Jan 4", "thru 11/30", "until Dec 1"
  const through = new RegExp(
    `\\b(?:now\\s+)?(?:through|thru|until|till)\\s+(?:(?:${FULL_WEEKDAYS}|${SHORT_WEEKDAYS}),?\\s+)?(${MONTH_DAY}|${NUMERIC_DAY})\\b${NOT_A_TIME}`,
    'gi',
  );
  for (const m of [...text.matchAll(through)]) {
    if (ignored(m)) continue;
    const end = parseOneDate(m[1]!, posted);
    if (end && dayNumber(end) >= dayNumber(posted) && dayNumber(end) - dayNumber(posted) <= 180) {
      hits.push({ start: posted, end, snippet: m[0] });
      mask(m);
    }
  }
  // Single dates.
  const singles = [
    new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b${NOT_A_TIME}`, 'gi'),
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAMES})\\b`, 'gi'),
    new RegExp(`(?<![\\d/$.])(${NUMERIC_DAY})(?![\\d/%])`, 'g'),
  ];
  for (const [i, re] of singles.entries()) {
    for (const m of [...text.matchAll(re)]) {
      if (ignored(m)) continue;
      const date =
        i === 0
          ? inferYear(MONTHS[m[1]!.toLowerCase()]!, Number(m[2]), posted)
          : i === 1
            ? inferYear(MONTHS[m[2]!.toLowerCase()]!, Number(m[1]), posted)
            : parseOneDate(m[1]!, posted);
      if (date) hits.push({ start: date, snippet: m[0] });
      mask(m);
    }
  }
  return hits;
}

/** "tonight", "tomorrow", "this weekend", "every Tuesday", "Thursdays", "Sat 7pm". Used only without explicit dates. */
function scanRelativeDates(text: string, posted: CalendarDate): DateHit[] {
  const relative = text.match(/\b(tonight|today|tomorrow|this weekend)\b/i);
  if (relative) {
    const word = relative[1]!.toLowerCase();
    if (word === 'this weekend') {
      const wd = weekdayOf(posted);
      const sat = wd === 0 ? addDays(posted, -1) : addDays(posted, (6 - wd + 7) % 7);
      const start = dayNumber(sat) < dayNumber(posted) ? posted : sat;
      return [{ start, end: addDays(sat, 1), snippet: relative[0] }];
    }
    return [{ start: addDays(posted, word === 'tomorrow' ? 1 : 0), snippet: relative[0] }];
  }
  // Full weekday names (any case), or short ones when a time or number follows ("Sat 7pm").
  const weekdayRe = new RegExp(
    `\\b(every\\s+|each\\s+)?(?:(${FULL_WEEKDAYS})(s)?|(${SHORT_WEEKDAYS})\\b(?=[\\s.,]{1,3}\\d))`,
    'gi',
  );
  const found = new Map<number, DateHit>();
  for (const m of text.matchAll(weekdayRe)) {
    const name = (m[2] ?? m[4] ?? '').toLowerCase();
    const target = WEEKDAYS[name] ?? WEEKDAYS[name.slice(0, 3)];
    if (target === undefined) continue;
    const recurring = Boolean(m[1] || m[3]);
    const offset = (target - weekdayOf(posted) + 7) % 7;
    const existing = found.get(target);
    if (!existing || (recurring && !existing.recurring))
      found.set(target, { start: addDays(posted, offset), recurring, weak: true, snippet: m[0] });
  }
  const hits = [...found.values()];
  // "Open Wednesday to Sunday" lists opening days, not an event: one weekday, or only "every …" ones.
  if (hits.length === 1 || (hits.length > 1 && hits.every((h) => h.recurring))) return hits;
  return [];
}

const PICTOGRAPHS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Separates an already-cleaned "Night Market @ Dolores Park" into a title and a venue. */
function splitTitleVenue(text: string): { title: string; venue?: string } {
  const at = text.match(/\s(?:@|at)\s+((?:the\s+)?[A-Z0-9][^\n|•·,!?]{2,60})$/);
  if (!at) return { title: text };
  return { title: text.slice(0, at.index).trim(), venue: at[1]!.trim().replace(/[\s.,:;–—-]+$/u, '') };
}

/** Strips dates, times, prices, emoji, hashtags and separators from a line to leave a title. */
function cleanTitle(text: string): string {
  return (
    text
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/#[\p{L}\p{N}_]+/gu, ' ')
      .replace(PICTOGRAPHS, ' ')
      .replace(
        new RegExp(`\\b(?:(?:this|next|every)\\s+)?(?:${FULL_WEEKDAYS})s?\\b|\\b(?:${SHORT_WEEKDAYS})\\b\\.?`, 'gi'),
        ' ',
      )
      .replace(new RegExp(`\\b(?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, 'gi'), ' ')
      .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ')
      .replace(
        /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)/gi,
        ' ',
      )
      .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)/gi, ' ')
      .replace(/\$\d+(?:\.\d{2})?(?:\s*(?:-|–|to)\s*\$?\d+)?/g, ' ')
      .replace(/\b(?:tonight|today|tomorrow|this weekend|through|thru|until|free|FREE)\b/g, ' ')
      .replace(/^\s*(?:\d{1,2}[.)]\s+|[-*•▪◦]\s*)/u, ' ')
      .replace(/[|•·]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s:,.;–—-]+|[\s:,.;–—-]+$/gu, '')
      // Words left dangling once the date or time after them is gone: "Pottery class at".
      .replace(/(?:\s+(?:at|on|from|starting|@|this|next|&|and|,))+$/i, '')
      .replace(/[\s:,.;–—-]+$/u, '')
      .trim()
  );
}

/** "25 things to do this week", "10 events this weekend": a list without details per event. */
const ROUNDUP_HEADLINE = /\b\d+\s+(?:things|events|ways|ideas|picks|spots)\b/i;

const letters = (s: string): number => (s.match(/\p{L}/gu) ?? []).length;

function datesIn(text: string, posted: CalendarDate): DateHit[] {
  const explicit = scanExplicitDates(text, posted);
  return explicit.length > 0 ? explicit : scanRelativeDates(text, posted);
}

/** Builds events for one block of caption text that shares a date. */
function eventsForBlock(
  text: string,
  hits: DateHit[],
  today: CalendarDate,
  options: { withTitle: boolean; maxDates: number },
): { events: CaptionEvent[]; skipped?: CaptionSkipReason } {
  const time = findTimes(text);
  const usable = time ? hits : hits.filter((h) => !h.weak);
  const distinct = usable.filter(
    (h, i) =>
      usable.findIndex((o) => ymd(o.start) === ymd(h.start) && ymd(o.end ?? o.start) === ymd(h.end ?? h.start)) === i,
  );
  if (distinct.length === 0) return { events: [], skipped: hits.length > 0 ? 'no_time' : 'no_date' };
  if (distinct.length > options.maxDates) return { events: [], skipped: 'ambiguous_date' };

  const price = findPrice(text);
  const firstLine = text.split('\n').find((l) => letters(cleanTitle(l)) >= 3) ?? '';
  // A 📍 pin anywhere in the block names the venue; otherwise "… @ Venue" / "… at Venue" ends the title.
  const pin = text.match(/📍\s*([^\n|•·]{3,80})/u);
  const pinVenue = pin ? cleanTitle(pin[1]!) : undefined;
  const { title, venue: atVenue } = splitTitleVenue(cleanTitle(firstLine.replace(/📍[^\n]*/u, '')));
  const venueFromBody = pinVenue && letters(pinVenue) >= 3 ? pinVenue : atVenue;

  const events: CaptionEvent[] = [];
  let tooOld = false;
  for (const hit of distinct) {
    let start = hit.start;
    const end = hit.end;
    if (hit.recurring) while (dayNumber(start) < dayNumber(today)) start = addDays(start, 7);
    if (dayNumber(end ?? start) < dayNumber(today)) {
      tooOld = true;
      continue;
    }
    const ongoing = end !== undefined;
    if (ongoing && dayNumber(start) < dayNumber(today)) start = today;
    const day = ymd(start);
    const event: CaptionEvent = {
      date: day,
      allDay: ongoing || !time,
      text,
      evidence: [hit.snippet, ...(time ? [time.evidence] : []), ...(price.evidence ? [price.evidence] : [])],
      ...(ongoing ? { endDate: ymd(end) } : {}),
      ...(hit.recurring ? { recurring: true } : {}),
      ...(options.withTitle && letters(title) >= 3 ? { title: title.slice(0, 100) } : {}),
      ...(venueFromBody ? { venue: venueFromBody.slice(0, 100) } : {}),
      ...(price.isFree ? { isFree: true } : {}),
      ...(price.priceMin !== undefined ? { priceMin: price.priceMin } : {}),
      ...(price.priceMax !== undefined ? { priceMax: price.priceMax } : {}),
    };
    if (!event.allDay && time) {
      event.startWall = `${day} ${pad(time.start[0])}:${pad(time.start[1])}`;
      if (time.end) {
        const endWall = `${day} ${pad(time.end[0])}:${pad(time.end[1])}`;
        if (endWall > event.startWall) event.endWall = endWall;
      }
    }
    events.push(event);
  }
  return events.length > 0 ? { events } : { events, skipped: tooOld ? 'too_old' : 'no_date' };
}

/**
 * Reads every event a caption announces.
 *
 * A caption with date signals on two or more lines is treated as a list: each
 * dated line starts a block, and a line that is only a date header
 * ("SATURDAY 11/8") hands its date to each line under it.
 */
export function extractEventsFromCaption(
  caption: string,
  postedAtIso: string,
  now: Date,
  timeZone = 'America/Los_Angeles',
): CaptionExtraction {
  const postedMs = Date.parse(postedAtIso);
  const posted = dateInZone(Number.isFinite(postedMs) ? postedMs : now.getTime(), timeZone);
  const today = dateInZone(now.getTime(), timeZone);
  const lines = caption.split(/\r?\n/).map((l) => l.trim());
  const explicitHits = lines.map((l) => (l ? scanExplicitDates(l, posted) : []));
  const explicitLines = explicitHits.filter((h) => h.length > 0).length;
  // In a list with real dates, a "THIS WEEKEND IN SF" heading isn't an event of its own.
  const lineHits =
    explicitLines >= 2
      ? explicitHits
      : lines.map((l, i) => (explicitHits[i]!.length ? explicitHits[i]! : l ? scanRelativeDates(l, posted) : []));
  const anchors = lineHits.flatMap((h, i) => (h.length > 0 ? [i] : []));

  if (anchors.length < 2) {
    const result = eventsForBlock(caption, datesIn(caption, posted), today, {
      // The first line minus its date, time and price: "Sat 11/7 · Band night · 8pm" → "Band night".
      withTitle: true,
      // "Open studios Nov 8 & 9" is one event on two days; "25 things to do Nov 3, Nov 4, Nov 5" is a roundup with no details.
      maxDates: ROUNDUP_HEADLINE.test(caption) ? 0 : 2,
    });
    return { mode: 'single', events: result.events, ...(result.skipped ? { skipped: result.skipped } : {}) };
  }

  const events: CaptionEvent[] = [];
  const reasons: CaptionSkipReason[] = [];
  anchors.forEach((anchor, k) => {
    const next = anchors[k + 1] ?? lines.length;
    const header = lines[anchor]!;
    const body = lines.slice(anchor + 1, next).filter((l) => letters(cleanTitle(l)) >= 4 && !/^(?:#\S+\s*)+$/.test(l));
    const headerOnly = letters(cleanTitle(splitTitleVenue(header).title)) < 3;
    const blocks = headerOnly ? body.map((line) => `${line}\n${header}`) : [[header, ...body.slice(0, 2)].join('\n')];
    for (const block of blocks) {
      const result = eventsForBlock(block, lineHits[anchor]!, today, { withTitle: true, maxDates: 3 });
      events.push(...result.events);
      if (result.skipped) reasons.push(result.skipped);
    }
  });
  if (events.length > 0) return { mode: 'multi', events };
  return { mode: 'multi', events, skipped: reasons.includes('too_old') ? 'too_old' : (reasons[0] ?? 'no_date') };
}
