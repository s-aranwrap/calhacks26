# Huddle

**Less wondering. More waddling.**

Huddle is a phone app that suggests something to do nearby. You pick a mood, and it gives you exactly three ideas. You commit to one, and then the app gets out of your way so you can go do it. Afterwards you can leave a quick emoji and a private note, and a little penguin joins your "huddle".

There are no accounts, feeds, likes or streaks. Everything personal stays on your phone.

This version is a working demo for **San Francisco**.

---

## What's in this project, in plain terms

| Piece | What it is | Do you need to touch it? |
| --- | --- | --- |
| **The app** | What you open on your iPhone through Expo Go. | Just run it (see below). |
| **San Francisco places** | About 20 well-known SF spots built into the app (Lands End, Dolores Park, SFMOMA and others), with opening hours where we could find them, plus a few weekly events such as the Ferry Plaza Farmers Market. | No. They work right away. |
| **Opening hours refresh** | A script that pulls current hours for those places from Google Maps (via Apify). | Optional. Run it now and then. |
| **Instagram events** | A script that collects upcoming SF events from Instagram posts (via Apify) and adds them to the app. | Optional. Run it when you want fresh events. |
| **Supabase** | An online database for sharing one activity list across everyone's phones. | Not for the demo. Ignore it for now. |

---

## 1. Run the app on your iPhone

**One-time setup on your computer**
1. Install **Node.js** version 22.18 or newer from nodejs.org. Check it with `node -v`.
2. Open a terminal in the `huddle` folder and run:
   ```bash
   npm install
   ```
   This downloads everything the app needs. It takes a minute or two.

**One-time setup on your iPhone**
1. Install **Expo Go** from the App Store.
2. Open it and sign in with a free Expo account.

**Every time you want to use it**
1. Make sure your computer and iPhone are on the **same Wi-Fi**.
2. In the terminal, run:
   ```bash
   npx expo start
   ```
3. A QR code appears. Scan it with the iPhone's **Camera** app and tap **Open in Expo Go**.
4. The first load takes 30–60 seconds. Then you'll see the penguin welcome screen.

While `npx expo start` is running, the app on your phone updates by itself whenever the project files change.

**If it doesn't open**
- **Spins forever or can't connect:** stop it with `Ctrl+C`, then run `npx expo start --tunnel`.
- **"Project is incompatible with this version of Expo Go":** this project uses Expo SDK 58. If your App Store copy of Expo Go is still on SDK 57, run `eas go` to install an SDK 58 version on your iPhone. That may need an Apple Developer account.
- **A red error screen:** copy the message and send it to whoever is helping you with the code.

---

## 2. Add Instagram events (optional)

Out of the box, the app knows the always-there SF places and a few weekly events. This step adds **upcoming events** found on Instagram.

### How it works

1. A script asks **Apify**, a scraping service you already have credits with, for recent posts from a short list of SF accounts.
2. It reads every caption looking for events. It understands:
   - **Single events:** "Sat, Nov 8 · 6–10pm · $15"
   - **Roundups**, one event per line: "Sat 11/1 · Night Market @ Dolores Park · 5–10pm", or a "SATURDAY 11/1" heading with events listed under it. Each line becomes its own event, with its own title, venue, time and price.
   - **Dates without a time:** "Open studios Nov 8". These show as "time not listed".
   - **Runs:** "on view through Jan 4", "Nov 7–9". These show as "On now · through Mon, Jan 4".
   - **Weekly regulars:** "Trivia every Tuesday, 7pm". Huddle shows the next one.
   
   It ignores dates that aren't event dates ("tickets on sale Oct 30", "thanks for coming Oct 12"), anything already over, and roundups with no details per event ("25 things to do this week").
3. Optionally, it looks up each venue on OpenStreetMap, so the app can show distances.
4. Optionally, an **AI model** (free Google Gemini by default) reads the captions and flyers too (see below). It handles chatty, oddly formatted captions better than the built-in rules.
5. It saves the events into the app. They appear on cards labeled **Unverified**, with a link back to the original post.

### Setup (once)

1. Copy your **Apify API token** from Apify Console → **Settings → API & Integrations**.
2. In the terminal, from the `huddle` folder:
   ```bash
   cp server/.env.example server/.env
   ```
3. Open `server/.env` in a text editor and fill in these two lines (no quotes, no spaces around `=`):
   ```
   APIFY_API_TOKEN=paste-your-token-here
   NOMINATIM_EMAIL=your@email.com
   ```
   Leave the Supabase lines alone. The demo doesn't use them.

> 🔒 **Keep the tokens secret.** It belongs only in `server/.env`, which is set up never to be uploaded to GitHub. Don't put it in the other `.env` file at the top of the project, or anywhere starting with `EXPO_PUBLIC_`. Those get built into the app, where anyone could read them.

### Collecting events

```bash
npm run ingest:sf -- --dry-run     # preview: shows the sources and the max number of posts. Free.
npm run ingest:sf -- --geocode     # the real run: uses a few cents of Apify credit
```

When it finishes, it prints how many events it saved and why it skipped the rest. Restart with `npx expo start -c` to see them in the app.

**Letting an AI read the captions (optional, free, recommended).** The built-in rules handle common layouts, but captions are messy. An AI model reads each caption, and with `--images` each flyer too, and lists the events in it. The default is **Google Gemini's free tier**, which costs nothing.
1. Get a free key at **aistudio.google.com/apikey**. Sign in with a Google account; no card is needed. Add it to `server/.env`:
   ```
   GEMINI_API_KEY=paste-your-key-here
   ```
2. Check it works. This uses one request of your free quota:
   ```bash
   npm run ai:check                        # reads a sample caption; should end with "It works"
   npm run ai:check -- --image flyer.jpg   # optional: also reads a flyer saved on your computer
   ```
3. Add `--ai` to any run, or `--images` to read flyers too. It works on a saved run as well, so you don't spend Apify credits again:
   ```bash
   npm run ingest:sf -- --from-raw latest --ai --geocode
   ```

Some things to know about the free tier:
- **Daily limit.** It limits how many requests you can make per day. If a run hits the limit, the script says so and finishes the rest with the built-in rules. Run the same command the next day and it picks up where it stopped, because every answer is saved.
- **It's a bit slow on purpose.** The script waits about 5 seconds between requests to stay under the per-minute limit, so 150 posts take about 12 minutes.
- **Privacy.** Google may use free-tier requests to improve its products. That's fine for public Instagram posts, but don't put anything private through it.

Other options in `server/.env`:
- **Ollama** is free and runs entirely on your computer, with no limits and no account. Install it from ollama.com, run `ollama pull gemma3:4b` (a few GB), and set `OLLAMA_MODEL=gemma3:4b`. It's slower and makes more mistakes than Gemini, especially on flyers.
- **The Claude API** is paid, roughly a cent or two per run. Set `ANTHROPIC_API_KEY` and `AI_PROVIDER=anthropic`.

Whichever you use, the model has to quote the text each date came from. An event whose quote isn't in the caption is thrown out. If the service can't be reached, that post falls back to the built-in rules.

**Re-running without spending credits.** Every run is saved. To re-process the last one after changing a setting:
```bash
npm run ingest:sf -- --from-raw latest
```

**Changing which accounts are checked.** Edit `server/ingest/sf/sources.json`.
- `@funcheap` and `@exploratorium` are confirmed real accounts.
- `@sfmoma` and `@calacademy` are likely right but unconfirmed. Remove any account that comes back with 0 posts.
- `limit` is the number of posts to take from each account.

**Cost safety.** The default list fetches at most 86 posts, which costs cents. The script refuses any run over 300 posts (about $0.80) unless you add `--yes`. You can change that limit with `maxResultsPerRun` in `sources.json`.

### Finding accounts that actually post events

Most of what makes Instagram useful depends on which accounts you scrape. Museums mostly post art, not dated events. Venues, curators and neighborhood accounts post a lot more. The probe tries out a list of candidate accounts and tells you which ones are worth keeping:

```bash
npm run probe:sf -- --dry-run              # lists the ~30 candidates and the cost (about $0.40). Free.
npm run probe:sf                           # fetches 5 recent posts from each and scores them
npm run probe:sf -- --from-raw latest --images   # re-score the same posts with the AI reading flyers too
npm run probe:sf -- --from-raw latest --adopt    # add every account that gave events to sources.json
```

It prints one line per account:
```
  GOOD        4 events /  5 posts  thechapelsf  e.g. Band night | DJ night
  some        1 events /  5 posts  sfrecpark
  no events   0 events /  5 posts  deyoungmuseum
  no posts    0 events /  0 posts  gamhsf
```
"no posts" usually means the handle is wrong, the account is private, or it hasn't posted in 30 days. The candidates in `server/ingest/sf/candidates.json` are a starting point I put together from memory and research, and **none are confirmed**, so expect a few misses. Add accounts you find to that file: just the URL, a category, and a note.

**Reading flyers.** Many venues put the date and time on the flyer image and write only "link in bio" in the caption. With `--images` (on `ingest:sf` or `probe:sf`), the AI looks at each post's image as well as its caption. Instagram image links expire after a few days, so use `--images` on a fresh run, or a `--from-raw` run within a day or two of it. Dates read from an image can't be checked against the caption, so those events carry a note saying they came from the image.

---

## 3. Opening hours

The museums, library, arcade, gardens and city parks come with opening hours, so Huddle can say **"Open now · until 5 PM"** or **"Opens at 10 AM"**, and it won't suggest somewhere that's closed for the rest of the day. The detail screen shows the full week and where the hours came from.

The built-in hours were looked up by hand on Oct 25, 2026. Several came from travel sites rather than the venue's own page, because those pages couldn't be reached, so they're labeled "check before you go". To refresh them from Google Maps:

```bash
npm run hours:sf -- --dry-run   # lists the ~17 places and the rough cost (well under $1). Free.
npm run hours:sf                # the real run, usually 2–6 minutes; writes src/data/packs/sfHours.generated.ts
```

A Google result is only used if it's within 400 m of the place, so a wrong match can't replace good hours. Streets, stairways and neighborhoods (Lombard Street, the Filbert Steps, Chinatown and so on) are skipped, because they have no hours. Some places are still missing hours, such as Lands End and the Japanese Tea Garden. Those say "Opening hours unknown" until the refresh finds them.

Hours are written like `Mo-Fr 10:00-17:00; Sa off` (the OpenStreetMap format). To fix one by hand, edit `src/data/packs/sfHours.ts`.

---

## 4. How to read what the app shows

- **Unverified:** nobody has checked the details with the organizer yet. That's true of everything in the demo. Check the linked post or website before you go.
- **"estimate" next to a price or duration:** a best guess, for example a price read out of an Instagram caption.
- **"unknown":** the information isn't available, so Huddle says so instead of making something up. Museum ticket prices are left out for this reason.
- **"time not listed":** the post gave a date but no time. Check the post before you go.
- **"Open now · until 5 PM":** worked out from the place's weekly hours. Holidays and special closures aren't included.
- **Distances:** measured from **Union Square** until you tap "Use my location" in Settings while you're in or near SF.
- **Easy / Moderate / Stretch:** how much of a step outside your comfort zone something is. It's based on how new, social, physical or committing the activity is.

---

## 5. Your privacy

- No account, no tracking and no analytics.
- Your plans, reactions and notes are stored **only on your phone**. **Settings → Export history** gives you a copy. **Delete history** erases them.
- Your location is used on the phone to work out distances and is never sent anywhere.

---

## 6. The two `.env` files, explained

| File | What it's for | Needed for the demo? |
| --- | --- | --- |
| `server/.env` | Secrets for the scripts that run on **your computer**: the Apify token, the optional AI key (free Gemini by default), and later a Supabase secret key. Never shipped in the app. | **Yes**, if you want Instagram events or fresh hours. |
| `.env` (top of the project) | Public settings built **into the app**: the Supabase address and its public key. `EXPO_PUBLIC_CITY_PACK=none` swaps SF for a made-up sample town. | **No.** |

Both have an `.example` version showing the format. Only the `.example` files go on GitHub.

---

## 7. Where things live (for when you're poking around)

```
src/app/                 the app's screens
src/data/packs/          the built-in San Francisco places, hours, weekly events and Instagram events
server/ingest/           the Instagram/Apify scripts (run on your computer, not the phone)
server/ingest/sf/        the SF account list, saved runs and the location lookup cache
supabase/                the online database setup (not needed yet)
tests/                   automated checks: run with `npm test`
docs/TECHNICAL.md        the full technical reference: architecture, data format, recommendation logic, security
```

---

## 8. What's not done yet

- **Review before publishing.** Instagram events go straight into the app (labeled Unverified) to keep the demo simple. Before a public launch, someone should check them first.
- **Event images.** Instagram image links expire, so cards don't show photos yet, even though the AI can read them during ingestion.
- **Holiday hours.** Weekly hours don't know about holidays or one-off closures.
- **One shared list for everyone.** Supabase is set up in the code, but not switched on. Right now each new batch of events reaches your phone through the app's own files.
- **Not yet tested much on real phones.** It builds and passes its automated checks, but please report anything odd, and say which screen it was on.

For developers: setup details, the data format, how recommendations are ranked, and the security model are all in **[docs/TECHNICAL.md](docs/TECHNICAL.md)**.
