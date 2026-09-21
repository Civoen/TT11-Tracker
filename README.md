# TT11 Tracker

A table tennis match tracker for Adam and Dave — installable as an app on
both of your iPhones, backed by Cloudflare Pages so either phone can log a
game and both see the same history.

- **Frontend**: plain HTML/CSS/JS, no build step, in `public/`
- **API**: Pages Functions in `functions/api/matches/` (`index.js` handles
  `GET`/`POST /api/matches`, `[id].js` handles `DELETE /api/matches/:id`),
  sharing their logic with `functions/_lib/matches.js`
- **Storage**: an R2 bucket, one object per match

Everything below is Cloudflare's free tier.

## 1. Create the R2 bucket

```
npm install -g wrangler   # if you don't have it
wrangler login
wrangler r2 bucket create tt11-tracker-matches
```

That's it — no schema, no migration. `wrangler.toml` already points at a
bucket with this name; if you name yours differently, update
`bucket_name` there to match.

## 2. Push this to GitHub

```
cd tt11-tracker
git init
git add .
git commit -m "TT11 Tracker"
```

Create a repo on GitHub (private if you'd like) and push this to it. This
is mainly for version history — deploys happen via Wrangler (step 3) or,
if you'd rather Cloudflare deploy on every push, via Git-connected Pages
Builds (step 3b).

## 3. Deploy

The simplest path, from your machine:

```
npm install
npm run deploy
```

This runs `wrangler pages deploy public`, which uploads `public/` as the
site and `functions/` as the API, and prints the live `*.pages.dev` URL
when done. The **first time** you deploy a given project name, add the R2
binding once (either flag works the same way):

```
npx wrangler pages deploy public --r2=MATCHES=tt11-tracker-matches
```

After that first deploy, the binding is remembered by the Pages project,
so plain `npm run deploy` is enough for every deploy after.

### 3b. Or: auto-deploy from GitHub (recommended if you already created a Pages project)

If you already have a `tt11-tracker` project connected to this repo (e.g.
from an earlier deploy attempt) and want Cloudflare to deploy automatically
on every push instead of running `npm run deploy` yourself:

1. Cloudflare dashboard → your **tt11-tracker** Pages project → **Settings → Builds & deployments**
2. Build output directory: `public` (Cloudflare auto-detects `functions/` for the API — no build command needed, this has no build step)
3. **Settings → Functions → R2 bucket bindings** → add binding `MATCHES` → bucket `tt11-tracker-matches` (do this for both **Production** and **Preview** environments)
4. Push to the connected branch (or click **Retry deployment** on the latest one) — you'll get the same `*.pages.dev` URL, now actually serving the app instead of 404ing

(If you're setting this up fresh instead: **Workers & Pages → Create → Pages → Connect to Git**, then steps 2–3 above.)

Either way, a custom domain can be added later from the project's
**Custom domains** tab.

## 4. Install it on both iPhones

On each iPhone, in **Safari** (must be Safari, not Chrome, for iOS installs):

1. Open the `*.pages.dev` (or custom domain) link
2. Tap the Share icon → **Add to Home Screen**
3. It opens full-screen, with its own icon, like a native app

Both of Adam's and Dave's phones hit the same Pages project and bucket, so
a match logged on either one shows up for both after a refresh/reopen.

## How the data model works

- Every **match** is a best-of-3, stored as one R2 object at
  `matches/{date}_{matchNumber}.json` (e.g. `matches/2026-09-16_001.json`)
  — up to 3 individual game winners, plus the overall match winner (first
  to 2).
- The same fields are duplicated onto the object's **custom metadata**, so
  listing every match (Home, History, Stats) is one R2 `list()` call that
  reads metadata only — it never has to fetch hundreds of individual
  object bodies just to render a screen.
- A **day** (any weekday — Mon and Fri included, since matches occasionally
  happen outside the usual Tue/Wed/Thu) isn't stored separately — it's
  just every match sharing the same date. "Who won the day" is computed as
  whoever won more matches on that date.
- All stats (streaks, win %, day-of-week breakdown) are computed in the
  browser from the full match list — there's no separate stats object to
  keep in sync.
- Deleting a match is a single R2 delete of that one object — no rewriting
  of a shared file.

## Importing historical data from the spreadsheet

If you've been tracking matches in a Google Sheet, there's a one-time
importer for it. It expects the layout of the "ElevenVR Championship"
sheet: a date column, followed by up to 15 (Adam, Dave) best-of-3 score
pairs per day (e.g. `1,2` = Dave won that match 2-1), with `NO GAME` or a
blank row meaning no play that day.

Export the sheet first — open the tab for a given year, then **File →
Download → Comma Separated Values (.csv)**. If your history spans more
than one year, each year is likely its own tab; export each one
separately.

**No terminal? Use the in-app importer** — open `https://tt11-tracker.pages.dev/import`
in Safari or Chrome (works on your phone too), choose your CSV file(s),
tap **Preview** to see a parsed summary (including a cross-check against
the sheet's own monthly "MONTH WINNER" rows) with nothing sent anywhere
yet, then tap **Import**. It's safe to run more than once — matches
already present are skipped (matched by date + match number), so if it's
interrupted partway through, running it again just picks up where it left
off. This page ships with the app; there's nothing extra to deploy.

**Prefer a terminal?** The same logic is in
`scripts/import-from-sheet.mjs`:

```
npm install
node scripts/import-from-sheet.mjs 2025.csv 2026.csv --dry-run
```

`--dry-run` parses everything and prints the same kind of summary without
sending anything anywhere. Once that looks right:

```
node scripts/import-from-sheet.mjs 2025.csv 2026.csv --url https://tt11-tracker.pages.dev
```

(or `--url http://localhost:8787` against `npm run dev` first, if you'd
rather test against a local copy before touching the real bucket).

**One caveat**: the sheet records each match's *final* score, not the
order games were played in. For any match that went to a deciding third
game, the importer reconstructs a plausible order (the decider is always
credited to whoever actually won — the only way a real best-of-3 can end)
so match winners, day winners, and total game-win counts all come out
accurate; only the exact game-by-game sequence for 2-1 matches is
synthetic, since the sheet never captured that.

## Local development

```
npm install
npm run dev
```

`wrangler pages dev` runs the static assets, the Functions API, and a
local R2 bucket all together — no need to touch the real bucket.

## Notes / things you might want to extend later

- **No login/auth** — anyone with the link can log or delete matches. Fine
  for a link only the two of you have; say if you want a shared PIN added.
- **Offline**: the app shell (and the last-synced match list) works offline
  via the service worker, but logging a new match needs a connection —
  it'll show an error and let you retry rather than silently queuing.
- **Corrections**: each match in the Log view's "today's matches" list has
  a small ✕ to delete a mis-logged entry.
- **Concurrent writes**: two different matches never collide (different R2
  keys). The one edge case — both phones logging the exact same match
  number for the exact same date at the exact same instant — is caught by
  a check-then-write, not a true database transaction. In practice, for
  two people taking turns logging games, this won't come up.
