# Huddle

**Less scrolling. More living.**

Huddle helps you find something worth doing nearby, decide quickly, and put your phone away. Pick a mood, get exactly three suggestions, commit to one, and the app narrows down to that single plan until you're done. Afterwards you can leave an emoji reaction and a private note, and a small penguin joins your huddle.

It's built to be closed. There are no feeds, streaks, followers, or accounts, and nothing is tracked.

---

## Contents

1. [Core user flow](#core-user-flow)
2. [What works without any credentials](#what-works-without-any-credentials)
3. [Getting started](#getting-started)
4. [Tests, type checking and linting](#tests-type-checking-and-linting)
5. [What has been verified](#what-has-been-verified)
6. [Architecture](#architecture)
7. [Data model](#data-model)
8. [Recommendation logic](#recommendation-logic)
9. [Offline storage](#offline-storage)
10. [Importing CSV/JSON activity data](#importing-csvjson-activity-data)
11. [Configuring Supabase](#configuring-supabase-optional)
12. [Configuring Apify for Instagram discovery](#configuring-apify-for-instagram-discovery-optional)
13. [Security and privacy](#security-and-privacy)
14. [Design decisions worth knowing](#design-decisions-worth-knowing)
15. [Known limitations and extension points](#known-limitations-and-extension-points)

---

## Core user flow

1. **Welcome.** Type a city or neighbourhood, or tap "Use my location". There's no account and no interests questionnaire.
2. **Discover.** Pick a mood (Surprise me / Chill / Social / Active / Creative), optionally adjust budget, distance and time, then tap **Find my next quest**.
3. **Three quests.** Each card shows when, where, how far, how long, cost, a challenge level (Easy / Moderate / Stretch), source and trust status, and why it was suggested. You can:
   - **Try this:** open the details.
   - **Not for me:** hide it, with an optional reason (too expensive, too far, wrong timing, not available, not my thing).
   - **Show me three more:** a deliberate action rather than infinite scroll. After three rounds Huddle suggests adjusting filters instead.
4. **Details.** Every fact is labeled verified, estimated or unknown. Primary action: **I'm going** (events) or **I'll try this** (evergreen). You can also save it for later.
5. **Focused adventure.** Discover now leads with this plan. You get directions, the organizer link, **I did it!**, and **Change of plans**, which takes one tap and has no penalty.
6. **After.** An optional emoji reaction and a private reflection. Both are stored on the phone and feed back into future suggestions.
7. **My adventures.** Planned, Saved and Completed, plus your penguin huddle.
8. **Settings.** Location, interests, default filters, nudge level, unverified listings, CSV/JSON import, JSON export, delete history, and privacy info.

## What works without any credentials

Everything in the core flow above. With no `.env` at all, Huddle:

- runs fully offline after install,
- shows a bundled **sample catalog** of about 40 activities in *Pebblewick*, a made-up harbour town. Every sample record is labeled "Sample" in the UI, and sample venues have no directions link,
- stores everything personal in SQLite on the phone,
- lets you import your own CSV/JSON list of real activities from Settings. These replace the sample town.

Supabase (a shared online catalog) and Apify (Instagram discovery) are optional add-ons.

## Getting started

### Prerequisites

- **Node.js 22.18+** (or 24+). Tests and scripts use Node's built-in TypeScript support and test runner.
- npm 10+
- To run on a phone, either:
  - **Expo Go** for **SDK 57**. Note: Expo released SDK 58 on 15 Oct 2026, and the store versions of Expo Go will switch to SDK 58 "in the next few weeks", after which they won't open SDK 57 projects. If that has happened, use a development build (below) or upgrade (see [limitations](#known-limitations-and-extension-points)). Expo Go also now requires signing in to an Expo account.
  - or a **development build**: `npx expo run:ios` (Xcode) or `npx expo run:android` (Android Studio).

### Install and run

```bash
npm install
npx expo install --check   # confirms native module versions match SDK 57
npm run typecheck
npm test
npx expo start             # scan the QR code with Expo Go, or press i / a
```

Optional: `cp .env.example .env` to connect Supabase (see below). Restart with `npx expo start -c` after changing `.env`.

## Tests, type checking and linting

| Command | What it does |
| --- | --- |
| `npm test` | Runs the unit tests in `tests/` with Node's built-in test runner (no Jest, no React Native needed). |
| `npm run typecheck` | Type-checks the app (`tsconfig.json`) and, more strictly, the Node-runnable code: core, data adapters, server scripts and tests (`tsconfig.node.json`). |
| `npm run lint` | `expo lint` with `eslint-config-expo`. |
| `npm run check` | All three. |
| `npm run db:check` | Applies `supabase/migrations` to a throwaway local PostgreSQL and asserts the row-level security rules. Needs PostgreSQL 15+ binaries; optional. |

The tests cover:

- budget, distance and time filtering, including missing values,
- ranking, category diversity, the stretch cap, the novelty and comfort slots,
- dismissal cooldowns and the effect of "not my thing", "too expensive" and emoji reactions,
- deduplication (source IDs, canonical URLs, fingerprints, merge rules),
- expired, sold-out, cancelled and undated events,
- malformed and missing optional data, time zones and DST,
- the rule that discovery returns exactly three when three are eligible and fewer, honestly, otherwise,
- the SQLite store (run against real SQLite through `node:sqlite`), the Supabase adapter (fake `fetch`), the catalog fallback chain, the CSV/JSON importer, and the Apify client and normalizer.

## What has been verified

This is exactly what was run while building this MVP, and what wasn't. The build environment couldn't reach the npm registry, so the Expo/React Native dependencies were never installed there.

**Run and passing**
- `npm test`: 150 tests, 0 failures (Node 22.23).
- `tsc -p tsconfig.node.json`: strict type check of core, data, server and tests against real `@types/node`.
- Type check of all app screens and components against the real **React 19 and React Native 0.86.3 type definitions** and the real Ionicons glyph list. Expo modules were represented by hand-written type stubs mirroring their SDK 57 source. That catches mistakes in this code, not every possible mismatch with Expo's APIs.
- The SQL migration applied to PostgreSQL 16, with RLS checks for `anon`, `authenticated` and `service_role`. Sample rows round-tripped through Postgres and back through the app's normalizer unchanged.
- Both ingestion CLIs, end to end, on the sample files and without credentials.

**Not run**
- `npm install`, `expo lint`, Metro bundling, and the app on a simulator or device. Please run `npm run check` and `npx expo start` first. If anything fails, the error will most likely be in an Expo API detail rather than in the logic.
- The Supabase adapter against a live project, and the Apify integration against the live API (no credentials).

## Architecture

```
huddle/
├── src/
│   ├── app/                    Screens (Expo Router, file-based). Thin: wiring + layout only.
│   │   ├── _layout.tsx         Fonts, SQLiteProvider, AppProvider, navigation stack, error boundary
│   │   ├── index.tsx           Gate: welcome on first run, otherwise Discover
│   │   ├── welcome.tsx         Onboarding (name, mascot, tagline, location)
│   │   ├── (tabs)/             Discover · My adventures · Settings
│   │   ├── quests.tsx          The three recommendations
│   │   ├── activity/[id].tsx   Details and commitment
│   │   └── adventure/[id].tsx  Focused plan, completion, reaction and reflection
│   ├── core/                   Pure TypeScript domain logic. No React Native imports. Runs in Node.
│   │   ├── types.ts            Activity, Venue, ActivitySource, UserPreferences, ActivityFeedback, CompletedQuest…
│   │   ├── normalize.ts        Untrusted record → validated Activity (shared by every source)
│   │   ├── dedupe.ts           Cross-source deduplication and merge rules
│   │   ├── availability.ts     Expiry and honest availability labels
│   │   ├── challenge.ts        Easy / Moderate / Stretch from four explainable factors
│   │   ├── learning.ts         On-device preference learning from feedback
│   │   ├── recommend.ts        Eligibility → scoring → diverse selection
│   │   ├── importer.ts, csv.ts CSV/JSON import with row-level reporting
│   │   ├── format.ts, time.ts  Display formatting with certainty; time-zone-safe parsing
│   │   ├── urls.ts             URL safety (http/https only) and canonicalization
│   │   └── ports.ts            ActivityRepository and UserStore interfaces
│   ├── data/
│   │   ├── fixtures/           Sample catalog (fictional town, dates relative to today)
│   │   ├── repositories/       demoRepository, supabaseRepository (fetch/PostgREST)
│   │   ├── local/              SQLite user store + migrations, preference validation
│   │   ├── catalogService.ts   Remote → cache → imported → demo fallback chain
│   │   └── config.ts           Public env config (refuses secret keys)
│   ├── state/                  AppProvider (React context) and the expo-sqlite bridge
│   ├── services/               Device integrations: location, file pick/share
│   └── ui/                     Theme, mascot, components (QuestCard, notices, badges…)
├── server/ingest/              Node-only scripts: CSV/JSON import CLI, Apify Instagram ingestion, Supabase writer
├── supabase/migrations/        Catalog schema + RLS
├── data/samples/               Sample CSV and JSON import files
├── tests/                      node:test suites (core, data, server)
└── scripts/                    Migration check, icon generator
```

**Layering rules**

- `src/core` has no dependencies at all. The recommender, normalizer and importer are the same code in the app, the server scripts and the tests.
- Screens talk to `useApp()` (in `src/state/AppProvider.tsx`). The provider calls core logic and the `UserStore` and `ActivityRepository` interfaces, so screens never touch SQL or HTTP.
- A new activity source only needs to produce records in the [import format](#importing-csvjson-activity-data), or implement `ActivityRepository`. The recommender and UI don't change.
- Imports inside `src/core` and `src/data` use explicit `.ts` extensions so Node can run them directly. Metro resolves them too. App code imports them through the `@/` alias.

## Data model

All types are in `src/core/types.ts`.

| Model | Purpose |
| --- | --- |
| `Activity` | One catalog entry. `kind: 'event' \| 'evergreen'`. Events have `startAt` / `endAt` / `timeZone`; evergreen activities have free-text `openingHours`. Optional: `venue`, `duration`, `price`, `imageUrl`, `whatToExpect`, `whyTry`, `restrictions`, `challenge` factors. |
| `Venue` | Name, address, area, latitude, longitude (all but name optional). |
| `ActivitySource` | Platform (`demo`, `organizer`, `csv`, `json`, `instagram`, `manual`, `supabase`), URL, source ID, label, **`publishedAt`** (when the source posted it, separate from the event start) and `retrievedAt`. |
| `verification` | `status` (`verified`, `unverified`, `candidate`, `demo`) + `lastCheckedAt`. |
| `Price`, `Duration` | Values plus `certainty: 'verified' \| 'estimated'`. A missing value means unknown. |
| `availability` | `available`, `limited`, `sold_out`, `cancelled`, `unknown` (default). |
| `UserPreferences` | Location, interests, budget, distance, time, nudge level, include-unverified, currency. |
| `ActivityFeedback` | A dismissal with an optional reason and a snapshot of what the activity looked like (category, tags, price, distance, time), so learning survives catalog changes. |
| `AdventureEntry` | Saved / planned / completed state per activity, with timestamps, a snapshot of the activity, an emoji `reaction`, and a private `reflection`. |
| `CompletedQuest` | The completed view of an adventure, used in history and the export. |

**Trust rules enforced by `normalize.ts`.** A record can't claim `verified` without a valid `last_checked_at`. Instagram records start as `candidate`, which never shows in the app. Demo fixtures are always `demo`. Field certainty can't exceed record certainty. Only `http(s)` links survive, and only `https` images.

## Recommendation logic

`recommend()` in `src/core/recommend.ts` is a pure function covered by tests. It has three stages.

**1. Eligibility (hard rules).** The first rule an activity fails is recorded, so an empty result can suggest which filter to loosen.

- not a candidate, not cancelled or sold out, not ended (end time, or start + duration, or start + 3 h), has a start date if it's an event, not more than 45 days away
- unverified listings excluded only if the user turned them off
- not already planned or completed; not dismissed recently (21 days, 30 for "not available", 120 for "not my thing")
- not already shown this discovery session ("three more" never repeats)
- matches the mood ("Surprise me" matches everything)
- **known** price ≤ budget, **known** distance ≤ max distance, **known** minimum duration ≤ available time. Unknown values never exclude anything; they cost a little score and are labeled "unknown".
- "Gentle" nudge excludes Stretch activities

**2. Scoring (soft signals).** Every bonus carries a reason:

| Signal | Effect |
| --- | --- |
| Interest match | +2, "One of your interests" |
| Learned affinity (completions × reaction, saves, plans, "not my thing"; half-life 45 days) | up to about ±4.5, "Similar to things you've enjoyed" |
| Free / fits budget | +1.2 / +0.4 |
| Within walking distance / ≤ 5 km | +1.2 / +0.6, "About a 10 minute walk" |
| Fits available time | +0.4 |
| Event starting within 24 h / 72 h | +0.8 / +0.4 |
| Freshly verified / unverified | +0.8 / −0.6 |
| Unknown price, distance, duration | −0.3 to −1 |
| Learned "too expensive", "too far", "wrong timing" | −1 to −1.5 for similar price, distance or time of day |
| Novelty (category not tried and not an interest, or intrinsically unusual) | +0.6 balanced, +1.2 bold, "A new creative experience for you" |
| Challenge vs nudge | Stretch −0.5 (balanced) or +0.5 (bold) |
| Randomness | large for "Surprise me", tiny tie-breaker otherwise (seeded) |

**3. Selection.** Greedy picks with a diversity penalty for the same category or venue. At most one Stretch activity (balanced) or two (bold), unless nothing else is eligible. One slot is reserved for something new and shown last as "A little different", and at least one Easy option is kept when available. Exactly three are returned when three are eligible. Otherwise the result is `limited` or `empty` with filter suggestions, and nothing is padded.

The challenge level (`challenge.ts`) sums four 0–2 factors (novelty, social exposure, physical effort, commitment). Catalog records can set any factor; otherwise they're inferred from category, tags, duration and price. 0–2 is Easy, 3–4 Moderate, 5+ Stretch. The details screen lists the factors in plain words.

## Offline storage

SQLite via `expo-sqlite`, database `huddle.db`, schema in `src/data/local/sqliteUserStore.ts`. Migrations are tracked with `PRAGMA user_version`.

| Table | Contents |
| --- | --- |
| `preferences` | One JSON row, re-validated on every read |
| `feedback` | Dismissals and reasons |
| `adventures` | Saved / planned / completed state, reaction, reflection, activity snapshot |
| `catalog_cache` | `imported` (your CSV/JSON imports) and `remote` (last good Supabase copy, for offline use) |

The store is written against a four-method `SqlDatabase` interface. The app passes expo-sqlite; tests pass Node's `node:sqlite`, so the real SQL is exercised in CI.

**Export** (Settings) writes `huddle-history-YYYY-MM-DD.json` and opens the share sheet. The file contains preferences, saved, planned, completed (with reactions and reflections) and feedback. **Delete history** removes feedback and adventures after a confirmation; preferences and imported activities stay.

## Importing CSV/JSON activity data

There are two ways in, and both use the same normalizer and deduplication:

- **In the app:** Settings → *Import CSV or JSON*. Imported activities are stored on the phone and replace the sample town. Re-importing updates matching listings.
- **From the command line**, which also works as a validator:
  ```bash
  npm run import:file -- data/samples/activities.sample.csv --currency GBP --out normalized.json
  # add --push (and optionally --publish) to upsert into Supabase; see below
  ```
  Exit code 2 means some rows were skipped. Each one is reported with its line number and reason.

**Format.** CSV with a header row, or JSON (an array, or `{ "activities": [...] }`), using these snake_case fields. Only `title` is required. Lists (`moods`, `tags`) can be JSON arrays or `|`-separated text.

| Field | Notes |
| --- | --- |
| `id` | Optional stable ID (`[A-Za-z0-9_.:-]`). If absent, it's derived from platform + `source_id`, else the canonical `source_url`, else title + start + venue. |
| `kind` | `event` or `evergreen`. Inferred from `start_at` if omitted. |
| `title`, `description` | Required title (≤ 140 chars). |
| `category` | `outdoors`, `arts`, `music`, `food`, `learning`, `community`, `wellness`, `fitness`, `games`, `culture`, `other` |
| `moods` | Any of `chill`, `social`, `active`, `creative`. Inferred from the category if empty, with a warning. |
| `tags` | Free tags. Some feed the challenge level, e.g. `first-time`, `open-mic`, `walk`, `strenuous`, `booking-required`, `beginner-friendly`. |
| `venue_name`, `address`, `area`, `latitude`, `longitude` | Coordinates enable distance. Invalid, half-filled or `0,0` coordinates are dropped. |
| `start_at`, `end_at`, `time_zone` | ISO 8601 **with offset** (`2026-11-20T19:00:00+00:00`), or local wall time (`2026-11-18 19:30`) **plus** an IANA `time_zone`. Local times without a zone are rejected rather than guessed. |
| `opening_hours` | Free text for evergreen activities |
| `duration_min_minutes`, `duration_max_minutes`, `duration_certainty` | `verified` or `estimated` |
| `is_free`, `price_min`, `price_max`, `currency`, `price_certainty`, `price_note` | `price_min = 0` or `is_free = true` means free. No price means unknown. |
| `source_platform`, `source_id`, `source_url`, `source_label`, `source_published_at` | Only `http(s)` URLs are kept |
| `verification_status`, `last_checked_at` | `verified` needs `last_checked_at`, otherwise it's downgraded |
| `availability` | `available`, `limited`, `sold_out`, `cancelled`, `unknown` |
| `image_url` | `https` only |
| `what_to_expect`, `why_try`, `restrictions` | Shown on cards and details |
| `challenge_novelty`, `challenge_social`, `challenge_physical`, `challenge_commitment` | 0, 1 or 2 to override inference |

Samples: `data/samples/activities.sample.csv` and `data/samples/activities.sample.json`. They're fictional and their events are dated November 2026, so edit the dates if you're reading this later.

## Configuring Supabase (optional)

1. **Create a project** at supabase.com.
2. **Apply the schema** in `supabase/migrations/`. Either run `supabase link --project-ref <ref> && supabase db push`, or paste the SQL file into the SQL editor. It creates:
   - `activities`: the published catalog. RLS lets `anon` and `authenticated` **only read rows that are `published` and not candidates**. Writes are blocked by RLS and by revoked privileges. Check constraints mirror the app's trust rules (no published candidates, `verified` needs `last_checked_at`, http(s) links only, and so on).
   - `activity_candidates`: discovered posts awaiting review. RLS is on with no policies, so only the service role can access it.
3. **Configure the app.** `cp .env.example .env` and set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (a `sb_publishable_…` key or the legacy anon key). Restart with `npx expo start -c`. The app refuses keys that look secret.
4. **Load data** with server-side credentials: `cp server/.env.example server/.env`, set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, then:
   ```bash
   npm run import:file -- your-activities.csv --push            # upsert, unpublished
   npm run import:file -- your-activities.csv --push --publish  # visible in the app
   ```

**Runtime behaviour.** The app fetches published rows over PostgREST with plain `fetch` (8 s timeout) and caches the last good copy in SQLite. If the network fails it uses that copy (*"Showing the copy saved 2 days ago"*). If there's no copy and nothing imported, it falls back to sample data and says so. Distance filtering happens on the device; PostGIS isn't needed at this size.

## Configuring Apify for Instagram discovery (optional)

Instagram ingestion is a **server-side, manual, review-first** tool. It never runs in the app, never publishes, and isn't needed for anything else.

1. Create an Apify account and copy a personal API token (Apify Console → Settings → API & Integrations).
2. `cp server/.env.example server/.env` and set `APIFY_API_TOKEN`. Never put it in `.env` or any `EXPO_PUBLIC_` variable.
3. Run it for a few accounts you have a legitimate reason to monitor (your own organization, partners who agreed):
   ```bash
   npm run ingest:instagram -- --url https://www.instagram.com/<profile>/ --limit 20 \
     --newer-than "14 days" --category music --out candidates.json
   # add --push to store candidates in the private activity_candidates table
   ```

**What it does with each post.** It calls `apify/instagram-scraper` (`run-sync-get-dataset-items`, token in the `Authorization` header) and retries 429/5xx responses with backoff. Error items and malformed items are skipped and counted. From each post it keeps only what the post contains: the caption's first line as the title, the caption, hashtags as tags, the tagged location name, the post URL and shortcode, the owner, and the publish time. It **does not** parse dates, prices or addresses out of captions. Phrases that look like dates or prices are saved as `review_hints` for a human to check. Image URLs aren't stored.

**Promoting a candidate.** Check the details with the organizer, add the activity to a CSV with `verification_status=verified` and `last_checked_at`, import it with `--push --publish`, then mark the candidate `approved`.

**Limitations and terms.** Instagram's Terms of Use restrict automated data collection, and Apify's actor scrapes public pages without Instagram's API. Whether and how you use it is your responsibility; get permission from account owners where appropriate and follow Apify's and Instagram's terms. Results can be incomplete or change without notice, field names may change when the actor is updated (check its input schema in Apify Console if a run fails), runs cost Apify credits, and the synchronous endpoint stops waiting after 300 s. A post is not proof that an event exists, is current, has space, or costs what the caption says. That's why everything stays a candidate.

## Security and privacy

- **No secrets in the app.** Only the Supabase URL and publishable key may be public. Server secrets live in `server/.env`, which is git-ignored and separate from the app's `.env`. `resolveConfig` refuses `sb_secret_` or `service_role` keys. Server scripts redact secrets from error output.
- **RLS** limits the public key to published catalog rows. Writes require the secret key on a server.
- **Private data stays on the device.** Preferences, location, plans, reactions and reflections are stored only in the app's SQLite database. Nothing personal is uploaded. There's no analytics, crash reporting or tracking SDK.
- **Untrusted links.** Only `http(s)` source URLs (and `https` images) survive normalization, so imported data can't open other URL schemes through the app.
- **Location** is requested only when the user taps "Use my location", with a plain-language permission string. Manual entry is the default.

## Design decisions worth knowing

These are places where the implementation deliberately interprets or adjusts the brief:

- **One way into details per card.** "Try this" and "View details" in the brief both open the details screen, so each card has one primary action (*Try this*, or tapping the card) plus *Not for me*.
- **Sample data lives in a made-up town.** Offline use, a typed city name and a distance filter don't fit together: a typed name has no coordinates without an online geocoder. Distances for sample data are measured from Pebblewick's town square. For imported or Supabase data, distances use your device location when you allow it. Otherwise they're shown as unknown, never guessed.
- **"Show me three more" has a soft stop.** After three rounds the main button becomes *Adjust my filters*, with *Show three more anyway* as a smaller link. Dismissed cards collapse instead of refilling, so the screen can't turn into a swipe feed.
- **Tests use `node:test`, not Jest.** The business logic is pure TypeScript, so the tests run in Node in about a second with no React Native toolchain. It also means `src/core` can't accidentally import React Native. If you later add component tests, `jest-expo` can sit alongside.
- **No `supabase-js` in the app.** One read query doesn't justify the dependency and its React Native polyfills; plain `fetch` against PostgREST does the job.
- **Candidates get their own table** so that unreviewed discoveries can't leak into the public catalog, even by a mistaken `published = true`.
- **Expo SDK 57** rather than the 9-day-old SDK 58: SDK 57 is the version the store Expo Go app supports today, and SDK 58 changes Expo Router in ways worth adopting deliberately.

## Known limitations and extension points

**Limitations**
- **Not yet run on a device in this build environment.** See [What has been verified](#what-has-been-verified).
- **Expo Go and SDK 58.** When store Expo Go moves to SDK 58, run `npx expo install expo@^58.0.0 --fix` and follow Expo's *SDK 57 → 58 Expo Router migration guide*. This code already uses the patterns it recommends: `useRouter()` hooks, a `discover` route instead of a duplicate index, no `initialRouteName`, and custom headers.
- Typed place names get coordinates only if location permission was already granted and the platform geocoder is reachable. Otherwise distance stays unknown.
- No currency conversion. Prices in another currency are treated as unknown for budget filtering. Sample prices use whatever currency you pick.
- Opening hours are free text, so "open right now" isn't computed. Recurring events need one row per date.
- Reflections are protected by the OS app sandbox and device encryption, not encrypted separately.
- iOS and Android only. Web would need expo-sqlite's web setup.
- Screen-reader labels, roles and 44–52 pt touch targets are in place but haven't been audited with VoiceOver or TalkBack.

**Extension points**
- New sources: emit the [import format](#importing-csvjson-activity-data) or implement `ActivityRepository` (`src/core/ports.ts`).
- Larger catalogs: add a PostGIS `geography` column and an RPC like `nearby_activities(lat, lng, km)`, then pass the user's area to `supabaseRepository`.
- A small review UI for `activity_candidates`; an organizer submission form that writes candidates.
- An optional, user-initiated reminder notification for a planned event (opt-in, single notification, no re-engagement pushes).
- Sync or backup, only as an explicit, user-chosen feature. Export already gives users a portable copy.
