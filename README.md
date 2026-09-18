# TT11 Tracker

A table tennis match tracker for Adam and Dave — installable as an app on
both of your iPhones, backed by a single Cloudflare Worker so either phone
can log a game and both see the same history.

- **Frontend**: plain HTML/CSS/JS, no build step, in `public/`
- **API + hosting**: one Worker (`src/index.js`) — it serves the static PWA
  via its assets binding and handles `/api/matches` itself
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
if you'd rather Cloudflare deploy on every push, via Git-connected Workers
Builds (step 3b).

## 3. Deploy

The simplest path, from your machine:

```
npm install
npm run deploy
```

Wrangler reads `wrangler.toml`, bundles `src/index.js`, uploads `public/`
as static assets, and wires up the `MATCHES` R2 binding automatically. It
prints the live `*.workers.dev` URL when done.

### 3b. Or: auto-deploy from GitHub (optional)

If you'd rather Cloudflare deploy automatically on every push instead of
running `npm run deploy` yourself:

1. Cloudflare dashboard → **Workers & Pages → Create → Workers → Connect to Git**
2. Pick the repo you pushed
3. It detects `wrangler.toml` and uses that for build settings, bindings included
4. Deploy — you'll get the same kind of `*.workers.dev` URL

Either way, a custom domain can be added later from the Worker's **Settings → Domains & Routes**.

## 4. Install it on both iPhones

On each iPhone, in **Safari** (must be Safari, not Chrome, for iOS installs):

1. Open the `*.workers.dev` (or custom domain) link
2. Tap the Share icon → **Add to Home Screen**
3. It opens full-screen, with its own icon, like a native app

Both of Adam's and Dave's phones hit the same Worker and bucket, so a
match logged on either one shows up for both after a refresh/reopen.

## How the data model works

- Every **match** is a best-of-3, stored as one R2 object at
  `matches/{date}_{matchNumber}.json` (e.g. `matches/2026-09-16_001.json`)
  — up to 3 individual game winners, plus the overall match winner (first
  to 2).
- The same fields are duplicated onto the object's **custom metadata**, so
  listing every match (Home, History, Stats) is one R2 `list()` call that
  reads metadata only — it never has to fetch hundreds of individual
  object bodies just to render a screen.
- A **day** (Tuesday / Wednesday / Thursday) isn't stored separately — it's
  just every match sharing the same date. "Who won the day" is computed as
  whoever won more matches on that date.
- All stats (streaks, win %, day-of-week breakdown) are computed in the
  browser from the full match list — there's no separate stats object to
  keep in sync.
- Deleting a match is a single R2 delete of that one object — no rewriting
  of a shared file.

## Importing historical data from the spreadsheet

If you've been tracking matches in a Google Sheet, `scripts/import-from-sheet.mjs`
is a one-time importer for it. It expects the layout of the "ElevenVR
Championship" sheet: a date column, followed by up to 15 (Adam, Dave)
best-of-3 score pairs per day (e.g. `1,2` = Dave won that match 2-1), with
`NO GAME` or a blank row meaning no play that day.

Export the sheet first — open the tab for a given year, then **File →
Download → Comma Separated Values (.csv)**. If your history spans more
than one year, each year is likely its own tab; export each one
separately (the script takes multiple files in one run).

```
npm install
node scripts/import-from-sheet.mjs 2025.csv 2026.csv --dry-run
```

`--dry-run` parses everything and prints a summary — including a
cross-check against the sheet's own monthly "MONTH WINNER" rows — without
sending anything anywhere. Once that looks right:

```
node scripts/import-from-sheet.mjs 2025.csv 2026.csv --url https://tt11-tracker.<you>.workers.dev
```

(or `--url http://localhost:8787` against `npm run dev` first, if you'd
rather test against a local copy before touching the real bucket).

It's safe to re-run — matches already present are skipped (matched by
date + match number), so if a run fails partway through, running it again
just picks up where it left off.

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

`wrangler dev` runs the Worker, the static assets, and a local R2 bucket
all together — no need to touch the real bucket.

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
