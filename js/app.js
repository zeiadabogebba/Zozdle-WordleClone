import { evaluate, patToEval, replayGuesses } from "./game/scoring.js";
import { makeDayIndex, makePuzzlePicker } from "./game/rng.js";
import { load, save } from "./game/storage.js";
import { createBoard } from "./game/board.js";
import { blankStats, loadStats, recordStats, recordStatsNoStreak, renderDist } from "./game/stats.js";
import { showDefinition } from "./game/dictionary.js";
import { fmtDate, diToISO, renderCalendarHTML } from "./game/calendar.js";
import { renderNotifySettings, onNotifyToggle } from "./game/notifications-ui.js";

const Z = window.ZOZDLE || {};
const CFG = window.ZOZDLE_CONFIG || {};
const ANSWERS = Z.answers || { 4: [], 5: [], 6: [] };
const LENGTHS = (CFG.lengths && CFG.lengths.length ? CFG.lengths : [4, 5, 6]);
const ROWS = CFG.rows || 6;
const EPOCH = CFG.launch ? new Date(CFG.launch + "T00:00:00") : new Date(2025, 0, 1);
const DAY = 86400000;

const dayIndex = makeDayIndex(EPOCH, DAY);
const { dailyPuzzle, randomPuzzle } = makePuzzlePicker(ANSWERS, LENGTHS);

let VALID = null;
function validSet() {
  if (!VALID) VALID = new Set((Z.validRaw || "").split("\n"));
  return VALID;
}

function onlineDaily() { const o = window.ZOZDLE_ONLINE; return !!(o && o.enabled && o.user); }

const KEY = { daily: "zozdle-daily-v1", practice: "zozdle-practice-v1", archive: "zozdle-archive-v1", stats: "zozdle-stats-v1", set: "zozdle-settings-v1", seen: "zozdle-seen-help" };

const settings = Object.assign(
  { hard: false, crt: true, motion: false },
  load(KEY.set, {})
);
let state = null;

const $ = (s) => document.querySelector(s);
const toasts = $("#toasts");
const subMode = $("#sub-mode");
const subLen = $("#sub-len");

function toast(msg, bad) {
  const el = document.createElement("div");
  el.className = "toast" + (bad ? " bad" : "");
  el.textContent = msg;
  toasts.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, 1100);
}

const Board = createBoard({ boardEl: $("#board"), keyboardEl: $("#keyboard"), rows: ROWS, onKey: (key) => handleKey(key) });

function hardError(guess) {
  if (!settings.hard) return null;
  for (let r = 0; r < state.evals.length; r++) {
    const g = state.guesses[r], ev = state.evals[r];
    for (let i = 0; i < g.length; i++) {
      if (ev[i] === "correct" && guess[i] !== g[i])
        return `${ordinal(i + 1)} letter must be ${g[i].toUpperCase()}`;
    }
    for (let i = 0; i < g.length; i++) {
      if (ev[i] === "present" && !guess.includes(g[i]))
        return `Guess must contain ${g[i].toUpperCase()}`;
    }
  }
  return null;
}
const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - n % 10 == 10) ? 0 : Math.min(n % 10, 4)] || "th");

let locked = false;
function modalOpen() { return !!document.querySelector(".backdrop.open"); }

function handleKey(key) {
  if (locked || state.done || modalOpen()) return;
  if (key === "enter") return submit();
  if (key === "back") {
    if (state.current.length === 0) return;
    state.current = state.current.slice(0, -1);
    const t = Board.getTile(state.row, state.current.length);
    t.querySelector(".glyph").textContent = "";
    t.classList.remove("filled");
    return;
  }
  if (/^[a-z]$/.test(key) && state.current.length < state.len) {
    const i = state.current.length;
    state.current += key;
    const t = Board.getTile(state.row, i);
    t.querySelector(".glyph").textContent = key;
    t.classList.add("filled");
  }
}

function shakeRow(msg, bad) {
  toast(msg, bad);
  const row = Board.getRowEl(state.row);
  row.classList.add("shake");
  row.addEventListener("animationend", () => row.classList.remove("shake"), { once: true });
}

async function submit() {
  const guess = state.current;
  if (guess.length < state.len) return shakeRow("Not enough letters", true);
  if (!validSet().has(guess)) return shakeRow("Not in word list", true);
  const he = hardError(guess);
  if (he) return shakeRow(he, true);

  if (state.server) {
    locked = true;
    const res = state.mode === "archive"
      ? await window.ZOZDLE_ONLINE.submitArchiveGuess(guess, state.archiveDate)
      : await window.ZOZDLE_ONLINE.submitGuess(guess);
    locked = false;
    if (res.error) {
      const msg = { length: "Not enough letters", invalid: "Not in word list",
        finished: "Already finished", no_attempts: "No guesses left",
        auth: "Please sign in", network: "Connection error — try again" }[res.error] || "Try again";
      return shakeRow(msg, true);
    }
    const ev = patToEval(res.pattern);
    state.guesses.push(guess);
    state.evals.push(ev);
    const row = state.row;
    state.row++;
    state.current = "";
    if (res.finished) { state.done = true; state.win = res.solved; state.answer = res.word; }
    revealRow(row, ev, guess);
    return;
  }

  const ev = evaluate(guess, state.answer);
  state.guesses.push(guess);
  state.evals.push(ev);
  const row = state.row;
  state.row++;
  state.current = "";
  revealRow(row, ev, guess);
}

function revealRow(r, ev, guess) {
  locked = true;
  const rowTiles = Board.getRowTiles(r);
  const win = ev.every((s) => s === "correct");
  const step = settings.motion ? 0 : 230;

  const finish = () => {
    Board.paintKeyboard(state.guesses, state.evals);
    locked = false;
    if (win) onWin(r);
    else if (state.row >= ROWS) onLose();
    else persistGame();
  };

  if (settings.motion) {
    rowTiles.forEach((t, i) => Board.applyReveal(t, ev[i]));
    finish();
    return;
  }
  rowTiles.forEach((t, i) => {
    setTimeout(() => {
      t.classList.add("reveal");
      setTimeout(() => Board.applyReveal(t, ev[i]), 250);
      t.addEventListener("animationend", () => t.classList.remove("reveal"), { once: true });
      if (i === rowTiles.length - 1) setTimeout(finish, 300);
    }, i * step);
  });
}

function onWin(r) {
  const row = Board.getRowEl(r);
  if (!settings.motion) {
    row.classList.add("bounce");
    row.addEventListener("animationend", () => row.classList.remove("bounce"), { once: true });
  }
  state.done = true; state.win = true;
  toast(["Genius!", "Magnificent!", "Impressive!", "Splendid!", "Great!", "Phew!"][r] || "Solved!");
  if (state.server) { const o = window.ZOZDLE_ONLINE; o && o.refreshProfile && o.refreshProfile(); }
  else {
    if (state.mode === "daily") recordStats(KEY.stats, state.di, true, r + 1);
    else if (state.mode === "archive") recordStatsNoStreak(KEY.stats, true, r + 1);
    persistGame();
  }
  revealSubline();
  setTimeout(openStats, 1500);
}
function onLose() {
  state.done = true; state.win = false;
  if (state.server) { const o = window.ZOZDLE_ONLINE; o && o.refreshProfile && o.refreshProfile(); }
  else {
    if (state.mode === "daily") recordStats(KEY.stats, state.di, false, 0);
    else if (state.mode === "archive") recordStatsNoStreak(KEY.stats, false, 0);
    persistGame();
  }
  revealSubline();
  if (state.mode === "archive") toast("The word was " + state.answer.toUpperCase(), true);
  setTimeout(openStats, 900);
}

function persistDaily() {
  if (state.mode !== "daily" || state.server) return;
  save(KEY.daily, { di: state.di, len: state.len, answer: state.answer, guesses: state.guesses, done: state.done, win: state.win });
}
function persistPractice() {
  if (state.mode !== "practice") return;
  save(KEY.practice, { len: state.len, answer: state.answer, guesses: state.guesses, done: state.done, win: state.win });
}
function persistArchive() {
  if (state.mode !== "archive") return;
  const a = load(KEY.archive, {});
  a[state.di] = { guesses: state.guesses, done: state.done, win: state.win };
  save(KEY.archive, a);
}
function persistGame() {
  if (state.server) return;
  if (state.mode === "daily") persistDaily();
  else if (state.mode === "practice") persistPractice();
  else if (state.mode === "archive") persistArchive();
}
function resumePractice(saved) {
  const guesses = (saved.guesses || []).slice();
  state = { mode: "practice", di: null, len: saved.len, answer: saved.answer,
    guesses, evals: replayGuesses(guesses, saved.answer), row: guesses.length,
    current: "", done: !!saved.done, win: !!saved.win };
  setupBoard();
}
function promptResume(saved) {
  resumePractice(saved);
  openModal("#m-resume");
}

function startDaily() {
  const di = dayIndex();
  const saved = load(KEY.daily, null);
  let p;
  if (saved && saved.di === di) p = { len: saved.len, word: saved.answer };
  else p = dailyPuzzle(di);

  state = { mode: "daily", di, len: p.len, answer: p.word, guesses: [], evals: [], row: 0, current: "", done: false, win: false };
  if (saved && saved.di === di) replay(saved);
  setupBoard();
}
async function startDailyServer() {
  let res;
  try { res = await window.ZOZDLE_ONLINE.dailyStatus(); }
  catch (e) { toast("Couldn't reach the daily — playing offline", true); return startDaily(); }
  const evals = (res.patterns || []).map(patToEval);
  state = {
    mode: "daily", server: true, di: res.number - 1, len: res.length,
    answer: res.word || null, guesses: (res.guesses || []).slice(),
    evals, row: evals.length, current: "",
    done: !!res.finished, win: !!res.solved,
  };
  setupBoard();
}
function startPractice() {
  const p = randomPuzzle();
  state = { mode: "practice", di: null, len: p.len, answer: p.word, guesses: [], evals: [], row: 0, current: "", done: false, win: false };
  setupBoard();
  persistPractice();
}
function replay(saved) {
  state.guesses = (saved.guesses || []).slice();
  state.evals = replayGuesses(saved.guesses, state.answer);
  state.row = state.guesses.length;
  state.done = saved.done; state.win = saved.win;
}

function revealSubline() {
  const meta = $("#sub-meta"), ans = $("#sub-answer");
  if (!meta || !ans) return;
  if (state.mode === "archive" && state.done && state.answer) {
    ans.textContent = state.answer.toUpperCase();
    ans.classList.toggle("lose", !state.win);
    ans.classList.remove("hidden");
    meta.classList.add("hidden");
  } else {
    ans.classList.add("hidden");
    meta.classList.remove("hidden");
  }
}
function setupBoard() {
  Board.buildBoard(state.len);
  subMode.textContent = state.mode === "daily" ? "Daily" : state.mode === "archive" ? "Archive" : "Practice";
  subLen.textContent = state.len;
  revealSubline();

  state.evals.forEach((ev, r) => {
    for (let i = 0; i < state.len; i++) {
      const t = Board.getTile(r, i);
      t.querySelector(".glyph").textContent = state.guesses[r][i];
      Board.applyReveal(t, ev[i]);
    }
  });
  Board.paintKeyboard(state.guesses, state.evals);
}

function shareText() {
  const sq = { correct: "🟩", present: "🟨", absent: "⬛" };
  const head =
    state.mode === "daily"
      ? `Zozdle #${state.di + 1} ${state.win ? state.guesses.length : "X"}/${ROWS} · ${state.len}`
      : `Zozdle Practice ${state.win ? state.guesses.length : "X"}/${ROWS} · ${state.len}`;
  const grid = state.evals.map((ev) => ev.map((s) => sq[s]).join("")).join("\n");
  return head + (settings.hard ? " *" : "") + "\n" + grid;
}
async function share() {
  const text = shareText();
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ text });
      return;
    }
  } catch {}
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
  catch { toast("Could not copy", true); }
}

function openModal(id) { closeModals(); $(id).classList.add("open"); }
function closeModals() { document.querySelectorAll(".backdrop.open").forEach((b) => b.classList.remove("open")); }

function openStats() {
  const o = window.ZOZDLE_ONLINE;
  const curTries = state.done && state.win && state.mode !== "practice" ? state.guesses.length : -1;
  if (o && o.profile) {
    const p = o.profile;
    $("#st-played").textContent = p.total_played;
    $("#st-win").textContent = p.total_played ? Math.round((p.total_wins / p.total_played) * 100) : 0;
    $("#st-streak").textContent = p.current_streak;
    $("#st-max").textContent = p.max_streak;
    renderDist(ROWS, o.dist || {}, curTries);
  } else {
    const s = loadStats(KEY.stats);
    $("#st-played").textContent = s.played;
    $("#st-win").textContent = s.played ? Math.round((s.wins / s.played) * 100) : 0;
    $("#st-streak").textContent = s.cur;
    $("#st-max").textContent = s.max;
    renderDist(ROWS, s.dist, curTries);
  }
  const lbBtn = $("#btn-leaderboard");
  if (lbBtn) lbBtn.classList.toggle("hidden", !(o && o.enabled && o.user));

  const banner = $("#end-banner");
  if (state.done) {
    banner.classList.remove("hidden");
    $("#reveal-word").innerHTML = state.win
      ? `★ ${state.answer.toUpperCase()} ★`
      : `The word was ${state.answer.toUpperCase()}`;
    showDefinition($("#definition"), state.answer);
  } else banner.classList.add("hidden");

  const isDailyDone = state.mode === "daily" && state.done;
  $("#countdown-wrap").classList.toggle("hidden", !isDailyDone);
  $("#btn-newpractice").classList.toggle("hidden", !(state.mode === "practice" && state.done));
  $("#btn-share").classList.toggle("hidden", !state.done);
  if (isDailyDone) startCountdown();

  openModal("#m-stats");
}

let cdTimer;
function startCountdown() {
  clearInterval(cdTimer);
  const tick = () => {
    const now = new Date();
    const next = new Date(now); next.setHours(24, 0, 0, 0);
    let s = Math.max(0, Math.floor((next - now) / 1000));
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    $("#countdown").textContent = `${h}:${m}:${sec}`;
    if (s <= 0) { clearInterval(cdTimer); setMode("daily"); }
  };
  tick();
  cdTimer = setInterval(tick, 1000);
}

function applySettings() {
  document.documentElement.style.setProperty("--crt", settings.crt ? 0.5 : 0);
  $("#set-hard").checked = settings.hard;
  $("#set-crt").checked = settings.crt;
  $("#set-motion").checked = settings.motion;
}

function syncTabs(mode) {
  $("#mode-daily").setAttribute("aria-pressed", String(mode === "daily"));
  $("#mode-archive").setAttribute("aria-pressed", String(mode === "archive"));
  $("#mode-practice").setAttribute("aria-pressed", String(mode === "practice"));
}
function setMode(mode) {
  syncTabs(mode);
  if (mode === "daily") { if (onlineDaily()) startDailyServer(); else startDaily(); }
  else {
    if (state && state.mode === "practice") return;
    const saved = load(KEY.practice, null);
    if (saved && !saved.done && (saved.guesses || []).length > 0) promptResume(saved);
    else if (saved && !saved.done) resumePractice(saved);
    else startPractice();
  }
}

const archiveOnline = () => { const o = window.ZOZDLE_ONLINE; return !!(o && o.enabled && o.user); };

async function loadArchive(di) {
  syncTabs("archive");
  if (archiveOnline()) {
    let res;
    try { res = await window.ZOZDLE_ONLINE.archiveStatus(diToISO(EPOCH, di)); }
    catch { return toast("Couldn't load that day", true); }
    if (!res || res.error) return toast("Couldn't load that day", true);
    const evals = (res.patterns || []).map(patToEval);
    state = {
      mode: "archive", server: true, archiveDate: diToISO(EPOCH, di), di,
      len: res.length, answer: res.word || null,
      guesses: (res.guesses || []).slice(), evals, row: evals.length,
      current: "", done: !!res.finished, win: !!res.solved,
    };
    setupBoard();
    subMode.textContent = "Archive · " + fmtDate(EPOCH, di);
    return;
  }

  const p = dailyPuzzle(di);
  const rec = load(KEY.archive, {})[di];
  const guesses = rec ? (rec.guesses || []).slice() : [];
  state = {
    mode: "archive", di, len: p.len, answer: p.word,
    guesses, evals: replayGuesses(guesses, p.word), row: guesses.length,
    current: "", done: rec ? !!rec.done : false, win: rec ? !!rec.win : false,
  };
  setupBoard();
  subMode.textContent = "Archive · " + fmtDate(EPOCH, di);
}

async function openArchive() { openModal("#m-archive"); await buildCalendar(); }

async function selectArchiveDay(di) {
  if (di === dayIndex()) { closeModals(); return setMode("daily"); }
  closeModals();
  await loadArchive(di);
  if (state.mode === "archive" && state.done && state.guesses.length) toast("You already guessed this word!");
}

async function buildCalendar() {
  const cal = $("#archive-cal");
  cal.innerHTML = `<div class="loading">Loading…</div>`;
  const todayDi = dayIndex();
  let statusFor;
  if (archiveOnline()) {
    const map = {};
    try {
      const plays = await window.ZOZDLE_ONLINE.myPlays();
      for (const pl of plays) map[pl.puzzle_date] = pl;
    } catch {}
    statusFor = (di) => {
      if (di > todayDi) return "future";
      const pl = map[diToISO(EPOCH, di)];
      if (pl && pl.finished) return "done";
      if (pl) return "progress";
      return di === todayDi ? "today" : "miss";
    };
  } else {
    const archive = load(KEY.archive, {});
    statusFor = (di) => {
      if (di > todayDi) return "future";
      const rec = archive[di];
      if (rec && rec.done) return "done";
      if (rec) return "progress";
      return di === todayDi ? "today" : "miss";
    };
  }
  cal.innerHTML = renderCalendarHTML(EPOCH, dayIndex, statusFor);
  cal.querySelectorAll("[data-di]").forEach((b) => (b.onclick = () => selectArchiveDay(+b.dataset.di)));
  cal.scrollTop = cal.scrollHeight;
}

let inited = false;
function init() {
  if (inited) return;
  inited = true;

  window.ZOZDLE_GAME = {
    toast,
    isDaily: () => !!(state && state.mode === "daily"),
    reloadDaily: () => { if (state && state.mode === "daily") setMode("daily"); },
  };
  Board.buildKeyboard();
  applySettings();
  setMode("daily");

  $("#btn-help").addEventListener("click", () => openModal("#m-help"));
  $("#btn-stats").addEventListener("click", openStats);
  $("#btn-settings").addEventListener("click", () => { openModal("#m-settings"); renderNotifySettings(); });
  $("#mode-daily").addEventListener("click", () => setMode("daily"));
  $("#mode-archive").addEventListener("click", openArchive);
  $("#mode-practice").addEventListener("click", () => setMode("practice"));
  $("#btn-share").addEventListener("click", share);
  $("#btn-newpractice").addEventListener("click", () => { closeModals(); startPractice(); });
  $("#resume-continue").addEventListener("click", closeModals);
  $("#resume-reset").addEventListener("click", () => { closeModals(); startPractice(); });
  const lbBtn = $("#btn-leaderboard");
  if (lbBtn) lbBtn.addEventListener("click", () => { const o = window.ZOZDLE_ONLINE; if (o && o.openCompete) o.openCompete(); });

  $("#set-hard").addEventListener("change", (e) => {
    if (e.target.checked && state && state.row > 0 && !state.done) {
      e.target.checked = false; toast("Can't enable hard mode mid-game", true); return;
    }
    settings.hard = e.target.checked; save(KEY.set, settings);
  });
  $("#set-crt").addEventListener("change", (e) => { settings.crt = e.target.checked; save(KEY.set, settings); applySettings(); });
  $("#set-motion").addEventListener("change", (e) => { settings.motion = e.target.checked; save(KEY.set, settings); });
  $("#set-notify-new").addEventListener("change", (e) => onNotifyToggle("notify_new", e.target, toast));
  $("#set-notify-before").addEventListener("change", (e) => onNotifyToggle("notify_before", e.target, toast));

  document.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", closeModals));
  document.querySelectorAll(".backdrop").forEach((bd) =>
    bd.addEventListener("click", (e) => { if (e.target === bd) closeModals(); }));

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") return closeModals();
    if (modalOpen()) return;
    if (e.key === "Enter") { e.preventDefault(); handleKey("enter"); }
    else if (e.key === "Backspace") { e.preventDefault(); handleKey("back"); }
    else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toLowerCase());
  });

  if (!localStorage.getItem(KEY.seen)) {
    openModal("#m-help");
    localStorage.setItem(KEY.seen, "1");
  }

  if ("serviceWorker" in navigator)
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
