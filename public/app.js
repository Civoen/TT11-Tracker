// TT11 Tracker — app logic
// Vanilla JS, no build step. State lives in `state`, every view is re-rendered
// from it, and clicks are handled through one delegated listener on #app.

const PLAYERS = {
  adam: { name: "Adam", short: "Adam" },
  dave: { name: "Dave", short: "Dave" },
};

const PLAY_DAYS = ["Tue", "Wed", "Thu"];
const CACHE_KEY = "tt11-matches-cache";

const state = {
  matches: [],
  loaded: false,
  online: navigator.onLine,
  view: "home",
  log: {
    date: null,
    dayOfWeek: null,
    games: [null, null, null],
  },
};

// ---------------------------------------------------------------- helpers

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function todayDate() {
  return new Date();
}

function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  const day = date.getDate();
  const month = date.toLocaleDateString("en-GB", { month: "short" });
  return `${weekday}, ${day} ${month}`;
}

// This week's Tue / Wed / Thu, as real dates, Monday-start week.
function currentPlayDates(reference = todayDate()) {
  const day = reference.getDay(); // 0 Sun .. 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(reference, mondayOffset);
  return [
    { abbr: "Tue", date: toISO(addDays(monday, 1)) },
    { abbr: "Wed", date: toISO(addDays(monday, 2)) },
    { abbr: "Thu", date: toISO(addDays(monday, 3)) },
  ];
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function toast(message, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- data

async function loadMatches() {
  try {
    const res = await fetch("/api/matches");
    if (!res.ok) throw new Error("bad status");
    const data = await res.json();
    state.matches = data;
    state.loaded = true;
    setOnline(true);
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (err) {
    setOnline(false);
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      state.matches = JSON.parse(cached);
      state.loaded = true;
      toast("Offline — showing the last synced data", true);
    } else {
      toast("Can't reach the server and nothing is cached yet", true);
    }
  }
  renderAll();
}

async function saveMatch(payload) {
  const res = await fetch("/api/matches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Could not save match");
  }
  return res.json();
}

async function deleteMatch(id) {
  const res = await fetch(`/api/matches/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error("Could not delete match");
  }
}

function setOnline(isOnline) {
  state.online = isOnline;
  const icon = document.getElementById("status-icon");
  if (icon) icon.style.opacity = isOnline ? "1" : "0.35";
}

// ---------------------------------------------------------------- derived stats

function matchesForDate(dateStr) {
  return state.matches.filter((m) => m.playedDate === dateStr);
}

function winsFor(matches) {
  const tally = { adam: 0, dave: 0 };
  for (const m of matches) tally[m.winner] += 1;
  return tally;
}

function dayWinner(dateStr) {
  const list = matchesForDate(dateStr);
  if (list.length === 0) return null;
  const { adam, dave } = winsFor(list);
  if (adam === dave) return "tie";
  return adam > dave ? "adam" : "dave";
}

function overallTotals() {
  return winsFor(state.matches);
}

function totalGamesPlayed() {
  return state.matches.reduce((sum, m) => sum + (m.game3 ? 3 : 2), 0);
}

function sessionDates() {
  return [...new Set(state.matches.map((m) => m.playedDate))].sort();
}

function currentStreak() {
  if (state.matches.length === 0) return null;
  const sorted = [...state.matches].sort(
    (a, b) => a.playedDate.localeCompare(b.playedDate) || a.matchNumber - b.matchNumber
  );
  const last = sorted[sorted.length - 1].winner;
  let len = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].winner === last) len++;
    else break;
  }
  return { player: last, length: len };
}

function longestStreaks() {
  const sorted = [...state.matches].sort(
    (a, b) => a.playedDate.localeCompare(b.playedDate) || a.matchNumber - b.matchNumber
  );
  const best = { adam: 0, dave: 0 };
  let run = { player: null, length: 0 };
  for (const m of sorted) {
    if (m.winner === run.player) run.length++;
    else run = { player: m.winner, length: 1 };
    if (run.length > best[run.player]) best[run.player] = run.length;
  }
  return best;
}

function dayOfWeekBreakdown() {
  const out = {};
  for (const abbr of PLAY_DAYS) out[abbr] = { adam: 0, dave: 0 };
  for (const m of state.matches) {
    if (out[m.dayOfWeek]) out[m.dayOfWeek][m.winner] += 1;
  }
  return out;
}

// ---------------------------------------------------------------- log draft

function resetLogDraft(preferredDate) {
  const dates = currentPlayDates();
  const todayIso = toISO(todayDate());
  let chosen = dates.find((d) => d.date === preferredDate);

  if (!chosen) {
    chosen =
      dates.find((d) => d.date === todayIso) ||
      [...dates].reverse().find((d) => d.date < todayIso) ||
      dates[0];
  }

  state.log = { date: chosen.date, dayOfWeek: chosen.abbr, games: [null, null, null] };
}

function draftMatchNumber() {
  return matchesForDate(state.log.date).length + 1;
}

function draftWinner() {
  const [g1, g2, g3] = state.log.games;
  const tally = { adam: 0, dave: 0 };
  if (g1) tally[g1]++;
  if (g2) tally[g2]++;
  if (g3) tally[g3]++;
  if (tally.adam === 2) return "adam";
  if (tally.dave === 2) return "dave";
  return null;
}

function needsGame3() {
  const [g1, g2] = state.log.games;
  return Boolean(g1 && g2 && g1 !== g2);
}

// ---------------------------------------------------------------- rendering

function renderAll() {
  renderHome();
  renderLog();
  renderHistory();
  renderStats();
}

function renderHome() {
  const root = document.getElementById("view-home");
  const totals = overallTotals();
  const totalMatches = totals.adam + totals.dave;

  if (totalMatches === 0) {
    root.innerHTML = `
      <div class="page-heading"><h1>TT11 Tracker</h1><p>Adam vs Dave, best of 3s, Tue / Wed / Thu</p></div>
      <div class="card empty-state">No matches logged yet.<br>Tap <strong>Log</strong> below to start your first session.</div>
    `;
    return;
  }

  const adamPct = Math.round((totals.adam / totalMatches) * 100);
  const davePct = 100 - adamPct;

  const dates = currentPlayDates();
  const todayIso = toISO(todayDate());

  const chips = dates.map((d) => {
    const winner = dayWinner(d.date);
    const isToday = d.date === todayIso;
    const resultLabel = winner === "tie" ? "Split" : winner ? PLAYERS[winner].name : isToday ? "Today" : "—";
    const resultColor = winner === "adam" ? "var(--green)" : winner === "dave" ? "var(--blue)" : "var(--ink-2)";
    return `
      <div class="day-chip ${isToday ? "today" : ""}">
        <span class="day-label" style="${isToday ? "color:var(--red)" : ""}">${d.abbr.toUpperCase()}</span>
        <span class="day-result" style="color:${resultLabel === "Today" ? "var(--ink-2)" : resultColor}">${resultLabel}</span>
      </div>`;
  }).join("");

  const streak = currentStreak();
  const streakBanner = streak && streak.length >= 2
    ? `<div class="banner ${streak.player === "dave" ? "blue" : "green"}">
         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"></path></svg>
         <span>${PLAYERS[streak.player].name} is on a ${streak.length}-match win streak</span>
       </div>`
    : "";

  root.innerHTML = `
    <div class="page-heading"><h1>TT11 Tracker</h1><p>Adam vs Dave, best of 3s, Tue / Wed / Thu</p></div>

    <div class="hero-card">
      <span class="hero-eyebrow">All-time head-to-head</span>
      <div class="hero-row">
        <div class="hero-player"><span class="name" style="color:var(--green-bright)">ADAM</span><span class="num">${totals.adam}</span></div>
        <span class="hero-vs">MATCHES</span>
        <div class="hero-player right"><span class="name" style="color:var(--blue-bright)">DAVE</span><span class="num">${totals.dave}</span></div>
      </div>
      <div class="split-bar">
        <div style="width:${adamPct}%;background:var(--green)"></div>
        <div style="width:${davePct}%;background:var(--blue)"></div>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:10px">
      <span class="section-label">This week</span>
      <div class="chip-row">${chips}</div>
    </div>

    <div class="tile-grid">
      <div class="stat-tile"><span class="value">${totals.adam + totals.dave}</span><span class="label">Bo3s played</span></div>
      <div class="stat-tile"><span class="value">${totalGamesPlayed()}</span><span class="label">Games played</span></div>
      <div class="stat-tile"><span class="value">${sessionDates().length}</span><span class="label">Sessions</span></div>
    </div>

    ${streakBanner}

    <button class="cta" data-action="go-log" type="button">Log Today's Matches</button>
  `;
}

function renderLog() {
  const root = document.getElementById("view-log");
  if (!state.log.date) resetLogDraft();

  const dates = currentPlayDates();
  const chips = dates.map((d) => {
    const selected = d.date === state.log.date;
    return `<div class="day-chip ${selected ? "selected" : ""}" data-action="select-day" data-date="${d.date}" data-abbr="${d.abbr}" role="button" tabindex="0">
      <span class="day-label">${d.abbr.toUpperCase()}</span>
    </div>`;
  }).join("");

  const todaysMatches = matchesForDate(state.log.date).sort((a, b) => a.matchNumber - b.matchNumber);
  const matchNumber = draftMatchNumber();
  const target = Math.max(9, matchNumber);

  const dots = [];
  for (const m of todaysMatches) dots.push(`<div class="dot ${m.winner}"></div>`);
  dots.push(`<div class="dot current"></div>`);
  for (let i = todaysMatches.length + 1; i < target; i++) dots.push(`<div class="dot"></div>`);

  const gameCard = (n, label) => {
    const value = state.log.games[n - 1];
    return `
      <div class="card game-card ${n === 3 ? "deciding" : ""}">
        <span class="game-label">${label}</span>
        <div class="pick-row">
          <button class="pick-btn adam ${value === "adam" ? "picked" : ""}" data-action="pick-game" data-game="${n}" data-player="adam" type="button">Adam</button>
          <button class="pick-btn dave ${value === "dave" ? "picked" : ""}" data-action="pick-game" data-game="${n}" data-player="dave" type="button">Dave</button>
        </div>
      </div>`;
  };

  const winner = draftWinner();
  const gameCards = [gameCard(1, "Game 1"), gameCard(2, "Game 2")];
  if (needsGame3()) gameCards.push(gameCard(3, "Game 3 · Deciding game"));

  const summary = winner
    ? `<div class="banner ${winner === "dave" ? "blue" : "green"}"><span>${PLAYERS[winner].name.toUpperCase()} WINS ${
        state.log.games.filter((g) => g === winner).length
      }–${state.log.games.filter((g) => g && g !== winner).length}</span></div>`
    : `<div class="pending-note"><span>Match winner is set once ${needsGame3() ? "Game 3" : "two games"} are entered</span></div>`;

  const historyRows = todaysMatches.length
    ? todaysMatches.map((m) => `
        <div class="match-row">
          <span class="who">Match ${m.matchNumber}</span>
          <span class="score ${m.winner}">${PLAYERS[m.winner].name} ${m.game3 ? "2–1" : "2–0"}</span>
          <button class="icon-btn" data-action="delete-match" data-id="${m.id}" type="button" aria-label="Delete match ${m.matchNumber}" style="padding:2px">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B72" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"></path></svg>
          </button>
        </div>`).join("")
    : "";

  root.innerHTML = `
    <div class="page-heading"><h1>Log Match</h1><p>${formatDateLong(state.log.date)}</p></div>

    <div class="chip-row">${chips}</div>

    <div class="progress-row">
      <span class="section-label" style="text-transform:none;letter-spacing:0">Match ${matchNumber} of ${target}</span>
    </div>
    <div class="dots">${dots.join("")}</div>

    <div style="display:flex;flex-direction:column;gap:10px">${gameCards.join("")}</div>

    ${summary}

    <button class="cta" data-action="save-match" type="button" ${winner ? "" : "disabled"}>Save Match</button>

    ${todaysMatches.length ? `
      <div style="display:flex;flex-direction:column;gap:2px;padding-top:4px">
        <span class="section-label" style="padding-bottom:6px">Today's matches</span>
        ${historyRows}
      </div>` : ""}
  `;
}

function renderHistory() {
  const root = document.getElementById("view-history");
  const dates = sessionDates().sort().reverse();

  const sessions = dates.map((dateStr) => {
    const dayMatches = matchesForDate(dateStr).sort((a, b) => a.matchNumber - b.matchNumber);
    const { adam, dave } = winsFor(dayMatches);
    const winner = adam === dave ? "tie" : adam > dave ? "adam" : "dave";
    const badgeClass = winner === "tie" ? "split" : winner;
    const badgeLabel = winner === "tie" ? "Split day" : `${PLAYERS[winner].name} won the day`;
    const dots = dayMatches.map((m) => `<div class="dot ${m.winner}"></div>`).join("");

    return `
      <div class="swipe-item" data-date="${dateStr}">
        <div class="swipe-actions">
          <button class="swipe-btn edit" data-action="edit-day" data-date="${dateStr}" type="button" aria-label="Edit ${formatDateLong(dateStr)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
            <span>Edit</span>
          </button>
          <button class="swipe-btn delete" data-action="delete-day" data-date="${dateStr}" type="button" aria-label="Delete ${formatDateLong(dateStr)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>
            <span>Delete</span>
          </button>
        </div>
        <div class="swipe-content card session-card">
          <div class="session-head">
            <span class="session-date">${formatDateLong(dateStr)}</span>
            <span class="day-badge ${badgeClass}">${badgeLabel}</span>
          </div>
          <span class="session-sub">${dayMatches.length} match${dayMatches.length === 1 ? "" : "es"} · Adam ${adam}–${dave} Bo3</span>
          <div class="dots">${dots}</div>
        </div>
      </div>`;
  }).join("");

  root.innerHTML = `
    <div class="page-heading"><h1>History</h1><p>${dates.length} session${dates.length === 1 ? "" : "s"} logged</p></div>
    <div style="display:flex;flex-direction:column;gap:12px">
      ${sessions || `<div class="empty-state">No sessions logged yet.</div>`}
    </div>
  `;
  setupSwipeHandlers(root);
}

function renderStats() {
  const root = document.getElementById("view-stats");
  const totals = overallTotals();
  const totalMatches = totals.adam + totals.dave;

  if (totalMatches === 0) {
    root.innerHTML = `
      <div class="page-heading"><h1>Stats</h1><p>Season to date</p></div>
      <div class="card empty-state">Stats appear once your first match is logged.</div>
    `;
    return;
  }

  const adamPct = Math.round((totals.adam / totalMatches) * 100);
  const davePct = 100 - adamPct;

  const streak = currentStreak();
  const longest = longestStreaks();
  const longestPlayer = longest.adam >= longest.dave ? "adam" : "dave";
  const longestLen = Math.max(longest.adam, longest.dave);

  const leader = totals.adam >= totals.dave ? "adam" : "dave";
  const games = state.matches.reduce((acc, m) => {
    acc.adam += (m.game1 === "adam") + (m.game2 === "adam") + (m.game3 === "adam");
    acc.dave += (m.game1 === "dave") + (m.game2 === "dave") + (m.game3 === "dave");
    return acc;
  }, { adam: 0, dave: 0 });
  const totalGames = games.adam + games.dave;
  const leaderGamePct = totalGames ? Math.round((games[leader] / totalGames) * 100) : 0;

  const dow = dayOfWeekBreakdown();
  const dowRows = PLAY_DAYS.map((abbr) => {
    const { adam, dave } = dow[abbr];
    const total = adam + dave;
    const adamW = total ? Math.round((adam / total) * 100) : 0;
    const daveW = 100 - adamW;
    return `
      <div class="dow-row">
        <span class="dow-label">${abbr.toUpperCase()}</span>
        <div class="split-bar">
          <div style="width:${total ? adamW : 50}%;background:var(--green)"></div>
          <div style="width:${total ? daveW : 50}%;background:var(--blue)"></div>
        </div>
        <span class="dow-count">${adam}–${dave}</span>
      </div>`;
  }).join("");

  root.innerHTML = `
    <div class="page-heading"><h1>Stats</h1><p>Season to date</p></div>

    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      <span class="section-label">Head-to-head win %</span>
      <div class="h2h-row">
        <div class="h2h-side"><span class="name" style="color:var(--green)">ADAM</span><span class="pct">${adamPct}%</span></div>
        <div class="h2h-side"><span class="pct">${davePct}%</span><span class="name" style="color:var(--blue)">DAVE</span></div>
      </div>
      <div class="split-bar lg">
        <div style="width:${adamPct}%;background:var(--green)"></div>
        <div style="width:${davePct}%;background:var(--blue)"></div>
      </div>
    </div>

    <div class="tile-grid two">
      <div class="stat-tile">
        <span class="label">Current streak</span>
        <span class="value" style="color:${streak && streak.length >= 2 ? (streak.player === "adam" ? "var(--green)" : "var(--blue)") : "var(--ink)"}">${streak ? `${PLAYERS[streak.player].name} +${streak.length}` : "—"}</span>
      </div>
      <div class="stat-tile">
        <span class="label">Longest streak</span>
        <span class="value" style="color:${longestLen ? (longestPlayer === "adam" ? "var(--green)" : "var(--blue)") : "var(--ink)"}">${longestLen ? `${PLAYERS[longestPlayer].name} +${longestLen}` : "—"}</span>
      </div>
      <div class="stat-tile">
        <span class="label">${PLAYERS[leader].name}'s game win rate</span>
        <span class="value">${leaderGamePct}%</span>
      </div>
      <div class="stat-tile">
        <span class="label">Games played</span>
        <span class="value">${totalGames}</span>
      </div>
    </div>

    <div class="card" style="display:flex;flex-direction:column;gap:14px">
      <span class="section-label">Performance by day</span>
      <div style="display:flex;flex-direction:column;gap:10px">${dowRows}</div>
    </div>

    <span class="footnote">Stats update automatically after each match is logged.</span>
  `;
}

// ---------------------------------------------------------------- swipe-to-reveal (History)

const SWIPE_OPEN_X = -152; // width of the two revealed action buttons

function closeSwipe(item) {
  if (!item) return;
  const content = item.querySelector(".swipe-content");
  content.style.transition = "transform 0.2s ease";
  content.style.transform = "translateX(0px)";
  item.classList.remove("open");
}

function closeAllSwipes(except) {
  for (const item of document.querySelectorAll(".swipe-item.open")) {
    if (item !== except) closeSwipe(item);
  }
}

function setupSwipeHandlers(root) {
  for (const content of root.querySelectorAll(".swipe-content")) {
    const item = content.closest(".swipe-item");
    let startX = 0, startY = 0, startTranslate = 0, dragging = false, moved = false;

    content.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      closeAllSwipes(item);
      startX = event.clientX;
      startY = event.clientY;
      startTranslate = item.classList.contains("open") ? SWIPE_OPEN_X : 0;
      dragging = true;
      moved = false;
      content.style.transition = "none";
      content.setPointerCapture(event.pointerId);
    });

    content.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      moved = true;
      const translate = Math.min(0, Math.max(SWIPE_OPEN_X, startTranslate + dx));
      content.style.transform = `translateX(${translate}px)`;
    });

    const endDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      content.style.transition = "transform 0.2s ease";
      if (!moved) {
        if (item.classList.contains("open")) closeSwipe(item);
        return;
      }
      const current = startTranslate + (event.clientX - startX);
      const shouldOpen = current < SWIPE_OPEN_X / 2;
      content.style.transform = shouldOpen ? `translateX(${SWIPE_OPEN_X}px)` : "translateX(0px)";
      item.classList.toggle("open", shouldOpen);
    };

    content.addEventListener("pointerup", endDrag);
    content.addEventListener("pointercancel", endDrag);
  }
}

// ---------------------------------------------------------------- navigation

function switchView(name) {
  closeAllSwipes();
  state.view = name;
  for (const section of document.querySelectorAll(".view")) {
    section.hidden = section.dataset.view !== name;
  }
  for (const btn of document.querySelectorAll(".nav-item")) {
    btn.classList.toggle("active", btn.dataset.target === name);
  }
  document.getElementById("views").scrollTo({ top: 0 });
  if (name === "log") renderLog();
}

// ---------------------------------------------------------------- events

document.getElementById("app").addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    const navBtn = event.target.closest(".nav-item");
    if (navBtn) switchView(navBtn.dataset.target);
    return;
  }

  const action = target.dataset.action;

  if (action === "go-log") {
    switchView("log");
  }

  if (action === "select-day") {
    resetLogDraft(target.dataset.date);
    renderLog();
  }

  if (action === "pick-game") {
    const n = Number(target.dataset.game);
    const player = target.dataset.player;
    state.log.games[n - 1] = player;
    if (!needsGame3()) state.log.games[2] = null;
    renderLog();
  }

  if (action === "save-match") {
    const winner = draftWinner();
    if (!winner) return;
    const games = state.log.games.filter(Boolean);
    const payload = {
      playedDate: state.log.date,
      dayOfWeek: state.log.dayOfWeek,
      matchNumber: draftMatchNumber(),
      games,
      winner,
    };
    target.disabled = true;
    try {
      await saveMatch(payload);
      toast(`Match saved — ${PLAYERS[winner].name} won`);
      state.log.games = [null, null, null];
      await loadMatches();
      renderLog();
    } catch (err) {
      toast(err.message, true);
      target.disabled = false;
    }
  }

  if (action === "delete-match") {
    const id = target.dataset.id;
    if (!confirm("Delete this match?")) return;
    try {
      await deleteMatch(id);
      toast("Match deleted");
      await loadMatches();
      renderLog();
    } catch (err) {
      toast(err.message, true);
    }
  }

  if (action === "edit-day") {
    resetLogDraft(target.dataset.date);
    switchView("log");
  }

  if (action === "delete-day") {
    const date = target.dataset.date;
    const dayMatches = matchesForDate(date);
    const count = dayMatches.length;
    if (!confirm(`Delete all ${count} match${count === 1 ? "" : "es"} on ${formatDateLong(date)}? This can't be undone.`)) {
      closeSwipe(target.closest(".swipe-item"));
      return;
    }
    try {
      await Promise.all(dayMatches.map((m) => deleteMatch(m.id)));
      toast("Session deleted");
      await loadMatches();
    } catch (err) {
      toast(err.message, true);
      await loadMatches();
    }
  }
});

// A tap that lands outside any swipe card (a filter chip, the page heading,
// blank space) should close whichever session's Edit/Delete is revealed.
document.getElementById("app").addEventListener("pointerdown", (event) => {
  const item = event.target.closest(".swipe-item");
  closeAllSwipes(item);
});

document.getElementById("status-btn").addEventListener("click", () => {
  toast(state.online ? "Synced with the server" : "Offline — changes will not save right now", !state.online);
});

window.addEventListener("online", () => { setOnline(true); loadMatches(); });
window.addEventListener("offline", () => setOnline(false));

// ---------------------------------------------------------------- boot

switchView("home");
setOnline(navigator.onLine);
loadMatches();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
