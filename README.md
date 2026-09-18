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
