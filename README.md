# Huddle

**Less scrolling. More living.**

Huddle is a phone app that suggests something to do nearby. You pick a mood, and it gives you exactly three ideas. You commit to one, and then the app gets out of your way so you can go do it. Afterwards you can leave a quick emoji and a private note, and a little penguin joins your "huddle".

There are no accounts, feeds, likes or streaks. Everything personal stays on your phone.

This version is a working demo for **San Francisco**.

---

## What's in this project, in plain terms

| Piece | What it is | Do you need to touch it? |
| --- | --- | --- |
| **The app** | What you open on your iPhone through Expo Go. | Just run it (see below). |
| **San Francisco places** | About 20 well-known SF spots built into the app: Lands End, Dolores Park, the Ferry Building, SFMOMA and others. | No. They work right away. |
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

Out of the box, the app only knows the always-there SF places. This step adds **upcoming events** found on Instagram.

### How it works

1. A script asks **Apify**, a scraping service you already have credits with, for recent posts from a short list of SF accounts.
2. For each post, it looks for **one clear date and time** in the caption, such as "Sat, Nov 8 · 6–10pm". Posts without one are skipped, including "25 things to do this week" roundups. That's on purpose: a missing event is better than a wrong date.
3. Optionally, it looks up the venue's location on OpenStreetMap, so the app can show distances.
4. It saves the events into the app. They appear on cards labeled **Unverified**, with a link back to the original post.

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

> 🔒 **Keep the token secret.** It belongs only in `server/.env`, which is set up never to be uploaded to GitHub. Don't put it in the other `.env` file at the top of the project, or anywhere starting with `EXPO_PUBLIC_`. Those get built into the app, where anyone could read them.

### Collecting events

```bash
npm run ingest:sf -- --dry-run     # preview: shows the sources and the max number of posts. Free.
npm run ingest:sf -- --geocode     # the real run: uses a few cents of Apify credit
```

When it finishes, it prints how many events it saved and why it skipped the rest. Restart with `npx expo start -c` to see them in the app.

**Re-running without spending credits.** Every run is saved. To re-process the last one after changing a setting:
```bash
npm run ingest:sf -- --from-raw latest
```

**Changing which accounts are checked.** Edit `server/ingest/sf/sources.json`.
- `@funcheap` and `@exploratorium` are confirmed real accounts.
- `@sfmoma` and `@calacademy` are likely right but unconfirmed. Remove any account that comes back with 0 posts.
- `limit` is the number of posts to take from each account.

**Cost safety.** The default list fetches at most 86 posts, which costs cents. The script refuses any run over 150 posts unless you add `--yes`.

---

## 3. How to read what the app shows

- **Unverified:** nobody has checked the details with the organizer yet. That's true of everything in the demo. Check the linked post or website before you go.
- **"estimate" next to a price or duration:** a best guess, for example a price read out of an Instagram caption.
- **"unknown":** the information isn't available, so Huddle says so instead of making something up. Opening hours and museum prices are deliberately left out for this reason.
- **Distances:** measured from **Union Square** until you tap "Use my location" in Settings while you're in or near SF.
- **Easy / Moderate / Stretch:** how much of a step outside your comfort zone something is. It's based on how new, social, physical or committing the activity is.

---

## 4. Your privacy

- No account, no tracking and no analytics.
- Your plans, reactions and notes are stored **only on your phone**. **Settings → Export history** gives you a copy. **Delete history** erases them.
- Your location is used on the phone to work out distances and is never sent anywhere.

---

## 5. The two `.env` files, explained

| File | What it's for | Needed for the demo? |
| --- | --- | --- |
| `server/.env` | Secrets for the scripts that run on **your computer**: the Apify token, and later a Supabase secret key. Never shipped in the app. | **Yes**, if you want Instagram events. |
| `.env` (top of the project) | Public settings built **into the app**: the Supabase address and its public key. `EXPO_PUBLIC_CITY_PACK=none` swaps SF for a made-up sample town. | **No.** |

Both have an `.example` version showing the format. Only the `.example` files go on GitHub.

---

## 6. Where things live (for when you're poking around)

```
src/app/                 the app's screens
src/data/packs/          the built-in San Francisco places and events
server/ingest/           the Instagram/Apify scripts (run on your computer, not the phone)
server/ingest/sf/        the SF account list, saved runs and the location lookup cache
supabase/                the online database setup (not needed yet)
tests/                   automated checks: run with `npm test`
docs/TECHNICAL.md        the full technical reference: architecture, data format, recommendation logic, security
```

---

## 7. What's not done yet

- **Review before publishing.** Instagram events go straight into the app (labeled Unverified) to keep the demo simple. Before a public launch, someone should check them first.
- **Smarter caption reading.** The date detection is rule-based, so posts listing several events are skipped. An AI step could pull out more events reliably.
- **One shared list for everyone.** Supabase is set up in the code, but not switched on. Right now each new batch of events reaches your phone through the app's own files.
- **Not yet tested much on real phones.** It builds and passes its automated checks, but please report anything odd, and say which screen it was on.

For developers: setup details, the data format, how recommendations are ranked, and the security model are all in **[docs/TECHNICAL.md](docs/TECHNICAL.md)**.
