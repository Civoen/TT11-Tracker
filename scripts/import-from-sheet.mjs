#!/usr/bin/env node
// TT11 Tracker — one-time importer from the "ElevenVR Championship" Google
// Sheet export into the app's /api/matches endpoint.
//
// Usage:
//   node scripts/import-from-sheet.mjs <file.csv> [file2.csv ...] --url https://tt11-tracker.<you>.workers.dev
//   node scripts/import-from-sheet.mjs 2026.csv --dry-run          # preview only, no writes
//   node scripts/import-from-sheet.mjs 2026.csv --url http://localhost:8787
//
// What it expects: a CSV exported from one tab of the sheet (File > Download
// > Comma Separated Values, while that year's tab is open). Each data row is
// a date (DD/MM/YY) followed by up to 15 pairs of (Adam, Dave) scores — one
// pair per best-of-3 match, e.g. "1,2" means Adam won 1 game, Dave won 2, so
// Dave won that match 2-1. "NO GAME" or an empty row means no play that day.
//
// The sheet only records the FINAL score of each match, not the order games
// were played in. For a 2-1 match this script invents a plausible order —
// the winner always takes the deciding (last) game, since that's how a
// best-of-3 actually ends — so match winners, day winners, and total
// game-win counts all come out accurate; only the exact game-by-game
// sequence for 2-1 matches is synthetic.

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const files = [];
let baseUrl = "http://localhost:8787";
let dryRun = false;
let outFile = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--url") baseUrl = args[++i];
  else if (a === "--dry-run") dryRun = true;
  else if (a === "--out") outFile = args[++i];
  else files.push(a);
}

if (files.length === 0) {
  console.error("Usage: node import-from-sheet.mjs <file.csv> [...] [--url <worker-url>] [--dry-run] [--out matches.json]");
  process.exit(1);
}

// ---------------------------------------------------------------- CSV parsing (RFC4180-ish)

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip, \n handles the row break
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- sheet -> matches

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{2})$/;
const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toIsoDate(ddmmyy) {
  const m = ddmmyy.match(DATE_RE);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  const year = 2000 + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const jsDate = new Date(year, month - 1, day);
  // sanity check the date round-trips (catches typos like day 31 in a 30-day month)
  if (jsDate.getFullYear() !== year || jsDate.getMonth() !== month - 1 || jsDate.getDate() !== day) return null;
  return { iso, dayOfWeek: WEEKDAY_ABBR[jsDate.getDay()] };
}

// Builds a plausible game1/game2/game3 sequence from a final match score.
// The decider is always credited to the actual winner — the only order a
// real best-of-3 can end in — so this is a reconstruction, not a guess,
// for who won; only *which* game number the loser's win landed on for a
// 2-1 match is arbitrary (the source data never recorded that).
function synthesizeGames(winner, wentToThree) {
  const other = winner === "adam" ? "dave" : "adam";
  return wentToThree ? [winner, other, winner] : [winner, winner];
}

function extractDayMatches(row) {
  const matches = [];
  const first = (row[2] ?? "").trim();
  if (first === "" || /^no game$/i.test(first)) return matches;

  for (let slot = 0; slot < 15; slot++) {
    const aCell = (row[2 + slot * 2] ?? "").trim();
    const dCell = (row[3 + slot * 2] ?? "").trim();
    if (aCell === "" && dCell === "") break; // end of this day's matches

    const a = Number(aCell);
    const d = Number(dCell);
    if (!Number.isInteger(a) || !Number.isInteger(d) || (a !== 2 && d !== 2)) {
      console.warn(`  ! skipping malformed match slot ${slot + 1} on this row: "${aCell}" / "${dCell}"`);
      continue;
    }

    const winner = a === 2 ? "adam" : "dave";
    const loserWins = a === 2 ? d : a;
    const games = synthesizeGames(winner, loserWins === 1);
    matches.push({ matchNumber: slot + 1, games, winner });
  }
  return matches;
}

function monthWinnerCheck(row) {
  const label = (row[1] ?? "").trim();
  if (!/ WINNER$/i.test(label)) return null;
  const value = (row[22] ?? "").trim();
  return { month: label.replace(/ WINNER$/i, ""), recorded: value };
}

// ---------------------------------------------------------------- run

const allMatches = []; // { playedDate, dayOfWeek, matchNumber, games, winner }
const monthChecks = [];

for (const file of files) {
  console.log(`\nParsing ${file}...`);
  const text = fs.readFileSync(file, "utf8");
  const rows = parseCsv(text);
  let daysFound = 0;

  for (const row of rows) {
    const dateCell = (row[1] ?? "").trim();

    const check = monthWinnerCheck(row);
    if (check) { monthChecks.push(check); continue; }

    const parsedDate = toIsoDate(dateCell);
    if (!parsedDate) continue;

    const dayMatches = extractDayMatches(row);
    if (dayMatches.length === 0) continue;

    daysFound++;
    for (const m of dayMatches) {
      allMatches.push({
        playedDate: parsedDate.iso,
        dayOfWeek: parsedDate.dayOfWeek,
        matchNumber: m.matchNumber,
        games: m.games,
        winner: m.winner,
      });
    }
  }
  console.log(`  found ${daysFound} day(s) with matches`);
}

allMatches.sort((a, b) => a.playedDate.localeCompare(b.playedDate) || a.matchNumber - b.matchNumber);

// ---------------------------------------------------------------- sanity check against the sheet's own "MONTH WINNER" rows

function computeMonthWinner(monthLabel, matches) {
  // monthLabel like "JANUARY" — match it against playedDate's month name.
  // The sheet's month winner is decided by DAYS won that month (same as how
  // the app itself defines a day-win: whoever won more matches that date),
  // not by total match count across the month.
  const monthIndex = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"]
    .indexOf(monthLabel.toUpperCase());
  if (monthIndex < 0) return null;

  const byDate = {};
  for (const m of matches) {
    const mi = Number(m.playedDate.slice(5, 7)) - 1;
    if (mi !== monthIndex) continue;
    (byDate[m.playedDate] ??= { adam: 0, dave: 0 })[m.winner]++;
  }

  const dayTally = { adam: 0, dave: 0 };
  for (const day of Object.values(byDate)) {
    if (day.adam === day.dave) continue; // split day, no day-winner
    dayTally[day.adam > day.dave ? "adam" : "dave"]++;
  }

  if (dayTally.adam === dayTally.dave) return "DRAW";
  return dayTally.adam > dayTally.dave ? "ADAM" : "DAVE";
}

console.log("\n--- Sanity check against the sheet's own \"MONTH WINNER\" rows ---");
for (const check of monthChecks) {
  if (!check.recorded) continue; // month not finished / no value recorded
  const computed = computeMonthWinner(check.month, allMatches);
  const ok = computed === check.recorded.toUpperCase();
  console.log(`${ok ? "OK  " : "MISMATCH"} ${check.month}: sheet says ${check.recorded}, computed from matches: ${computed}`);
}

// ---------------------------------------------------------------- summary

const totals = { adam: 0, dave: 0 };
for (const m of allMatches) totals[m.winner]++;
const days = new Set(allMatches.map((m) => m.playedDate)).size;

console.log(`\n--- Summary ---`);
console.log(`${allMatches.length} matches across ${days} days`);
console.log(`Adam ${totals.adam} — ${totals.dave} Dave (match wins)`);

if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify(allMatches, null, 2));
  console.log(`\nWrote parsed matches to ${outFile}`);
}

if (dryRun) {
  console.log("\n--dry-run set — nothing was sent anywhere.");
  process.exit(0);
}

// ---------------------------------------------------------------- push to the API

console.log(`\nImporting into ${baseUrl} ...`);
let imported = 0, skipped = 0, failed = 0;

for (const m of allMatches) {
  const res = await fetch(`${baseUrl}/api/matches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(m),
  });
  if (res.status === 201) {
    imported++;
  } else if (res.status === 409) {
    skipped++; // already imported — safe to re-run this script
  } else {
    failed++;
    const body = await res.text();
    console.error(`  ! ${m.playedDate} match ${m.matchNumber}: ${res.status} ${body}`);
  }
}

console.log(`\nDone. Imported ${imported}, already present (skipped) ${skipped}, failed ${failed}.`);
if (failed > 0) process.exitCode = 1;
