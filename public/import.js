// TT11 Tracker — one-time browser-based importer.
// Same parsing logic as scripts/import-from-sheet.mjs, ported to run in the
// browser (FileReader instead of fs) so it can be used from a phone/tablet
// with no terminal access — just open this page and pick the CSV file(s).

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{2})$/;
const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function toIsoDate(ddmmyy) {
  const m = ddmmyy.match(DATE_RE);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  const year = 2000 + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const jsDate = new Date(year, month - 1, day);
  if (jsDate.getFullYear() !== year || jsDate.getMonth() !== month - 1 || jsDate.getDate() !== day) return null;
  return { iso, dayOfWeek: WEEKDAY_ABBR[jsDate.getDay()] };
}

function synthesizeGames(winner, wentToThree) {
  const other = winner === "adam" ? "dave" : "adam";
  return wentToThree ? [winner, other, winner] : [winner, winner];
}

function extractDayMatches(row, warnings) {
  const matches = [];
  const first = (row[2] ?? "").trim();
  if (first === "" || /^no game$/i.test(first)) return matches;

  for (let slot = 0; slot < 15; slot++) {
    const aCell = (row[2 + slot * 2] ?? "").trim();
    const dCell = (row[3 + slot * 2] ?? "").trim();
    if (aCell === "" && dCell === "") break;

    const a = Number(aCell);
    const d = Number(dCell);
    if (!Number.isInteger(a) || !Number.isInteger(d) || (a !== 2 && d !== 2)) {
      warnings.push(`skipping malformed match slot ${slot + 1} on row starting "${row[1] ?? ""}": "${aCell}" / "${dCell}"`);
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

function computeMonthWinner(monthLabel, matches) {
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
    if (day.adam === day.dave) continue;
    dayTally[day.adam > day.dave ? "adam" : "dave"]++;
  }

  if (dayTally.adam === dayTally.dave) return "DRAW";
  return dayTally.adam > dayTally.dave ? "ADAM" : "DAVE";
}

function parseFiles(fileTexts) {
  // fileTexts: [{ name, text }]
  const allMatches = [];
  const monthChecks = [];
  const warnings = [];
  const perFile = [];

  for (const { name, text } of fileTexts) {
    const rows = parseCsv(text);
    let daysFound = 0;

    for (const row of rows) {
      const dateCell = (row[1] ?? "").trim();

      const check = monthWinnerCheck(row);
      if (check) { monthChecks.push(check); continue; }

      const parsedDate = toIsoDate(dateCell);
      if (!parsedDate) continue;

      const dayMatches = extractDayMatches(row, warnings);
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
    perFile.push({ name, daysFound });
  }

  allMatches.sort((a, b) => a.playedDate.localeCompare(b.playedDate) || a.matchNumber - b.matchNumber);

  const monthResults = [];
  for (const check of monthChecks) {
    if (!check.recorded) continue;
    const computed = computeMonthWinner(check.month, allMatches);
    monthResults.push({ month: check.month, recorded: check.recorded, computed, ok: computed === check.recorded.toUpperCase() });
  }

  const totals = { adam: 0, dave: 0 };
  for (const m of allMatches) totals[m.winner]++;
  const days = new Set(allMatches.map((m) => m.playedDate)).size;

  return { allMatches, perFile, monthResults, warnings, totals, days };
}

// ---------------------------------------------------------------- UI wiring

const fileInput = document.getElementById("file-input");
const fileList = document.getElementById("file-list");
const previewBtn = document.getElementById("preview-btn");
const importBtn = document.getElementById("import-btn");
const summaryCard = document.getElementById("summary-card");
const summaryBody = document.getElementById("summary-body");
const logEl = document.getElementById("log");
const warningExisting = document.getElementById("warning-existing");
const existingCountEl = document.getElementById("existing-count");

let parsedResult = null;

function log(line) {
  logEl.hidden = false;
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

fileInput.addEventListener("change", () => {
  const files = [...fileInput.files];
  fileList.textContent = files.length
    ? `${files.length} file${files.length === 1 ? "" : "s"} selected: ${files.map((f) => f.name).join(", ")}`
    : "";
  previewBtn.disabled = files.length === 0;
  importBtn.disabled = true;
  summaryCard.hidden = true;
  parsedResult = null;
});

async function readFilesAsText(files) {
  return Promise.all(files.map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, text: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  })));
}

previewBtn.addEventListener("click", async () => {
  previewBtn.disabled = true;
  logEl.hidden = true;
  logEl.textContent = "";
  try {
    const files = [...fileInput.files];
    const fileTexts = await readFilesAsText(files);
    parsedResult = parseFiles(fileTexts);

    const { allMatches, perFile, monthResults, warnings, totals, days } = parsedResult;

    const lines = [];
    for (const f of perFile) lines.push(`${f.name}: ${f.daysFound} day(s) with matches found`);
    lines.push("");
    lines.push(`${allMatches.length} matches across ${days} days`);
    lines.push(`Adam ${totals.adam} — ${totals.dave} Dave (match wins)`);
    if (monthResults.length) {
      lines.push("");
      lines.push("Sanity check against the sheet's own \"MONTH WINNER\" rows:");
      for (const r of monthResults) {
        lines.push(`  ${r.ok ? "OK  " : "MISMATCH"} ${r.month}: sheet says ${r.recorded}, computed ${r.computed}`);
      }
    }
    if (warnings.length) {
      lines.push("");
      lines.push(`${warnings.length} warning(s):`);
      for (const w of warnings.slice(0, 20)) lines.push(`  ! ${w}`);
      if (warnings.length > 20) lines.push(`  ...and ${warnings.length - 20} more`);
    }
    log(lines.join("\n"));

    summaryBody.innerHTML = `
      <span><strong>${allMatches.length}</strong> matches parsed across <strong>${days}</strong> days</span>
      <span>Adam ${totals.adam} — ${totals.dave} Dave</span>
      ${monthResults.some((r) => !r.ok) ? `<span style="color:var(--red)">Some month-winner checks didn't match — see log below (this is a data quirk to review, not necessarily an import error).</span>` : ""}
    `;
    summaryCard.hidden = false;
    importBtn.disabled = allMatches.length === 0;
  } catch (err) {
    log(`Error while parsing: ${err.message}`);
  } finally {
    previewBtn.disabled = false;
  }
});

async function fetchExistingCount() {
  try {
    const res = await fetch("/api/matches");
    if (!res.ok) return null;
    const data = await res.json();
    return data.length;
  } catch {
    return null;
  }
}

importBtn.addEventListener("click", async () => {
  if (!parsedResult) return;
  importBtn.disabled = true;
  previewBtn.disabled = true;
  log("\nImporting...");

  let imported = 0, skipped = 0, failed = 0;
  for (const m of parsedResult.allMatches) {
    try {
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(m),
      });
      if (res.status === 201) {
        imported++;
      } else if (res.status === 409) {
        skipped++;
      } else {
        failed++;
        const body = await res.json().catch(() => ({}));
        log(`  ! ${m.playedDate} match ${m.matchNumber}: ${res.status} ${body.error || ""}`);
      }
    } catch (err) {
      failed++;
      log(`  ! ${m.playedDate} match ${m.matchNumber}: ${err.message}`);
    }
  }

  log(`\nDone. Imported ${imported}, already present (skipped) ${skipped}, failed ${failed}.`);
  if (failed === 0) {
    log("\nAll good — open the app and your history should be there.");
  }
  importBtn.disabled = false;
  previewBtn.disabled = false;
});

fetchExistingCount().then((count) => {
  if (count) {
    existingCountEl.textContent = String(count);
    warningExisting.hidden = false;
  }
});
