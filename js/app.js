/* ============================================================
   Zozdle — game engine
   - Daily: date-seeded, same word for everyone, shareable.
   - Practice: endless random words.
   - Twist: each game's word is 4, 5 OR 6 letters.
   - Guesses validated against ~53k real words of that length.
   ============================================================ */
(function () {
  "use strict";

  const Z = window.ZOZDLE || {};
  const CFG = window.ZOZDLE_CONFIG || {};
  const ANSWERS = Z.answers || { 4: [], 5: [], 6: [] };
  const LENGTHS = (CFG.lengths && CFG.lengths.length ? CFG.lengths : [4, 5, 6]);
  const ROWS = CFG.rows || 6;
  const EPOCH = CFG.launch ? new Date(CFG.launch + "T00:00:00") : new Date(2025, 0, 1); // launch day → puzzle #1
  const DAY = 86400000;

  // valid-guess set, built lazily from the packed string
  let VALID = null;
  function validSet() {
    if (!VALID) VALID = new Set((Z.validRaw || "").split("\n"));
    return VALID;
  }

  // online (Supabase) helpers — present only when signed in
  function onlineDaily() { const o = window.ZOZDLE_ONLINE; return !!(o && o.enabled && o.user); }
  function patToEval(pat) { const m = { G: "correct", Y: "present", X: "absent" }; return pat.split("").map((c) => m[c] || "absent"); }

  /* ---------- storage ---------- */
  const KEY = { daily: "zozdle-daily-v1", practice: "zozdle-practice-v1", archive: "zozdle-archive-v1", stats: "zozdle-stats-v1", set: "zozdle-settings-v1", seen: "zozdle-seen-help" };
  const load = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  /* ---------- seeded RNG ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function dayIndex(d = new Date()) {
    const m = new Date(d); m.setHours(0, 0, 0, 0);
    const e = new Date(EPOCH); e.setHours(0, 0, 0, 0);
    return Math.floor((m - e) / DAY);
  }
  function pickWord(rng) {
    const len = LENGTHS[Math.floor(rng() * LENGTHS.length)];
    const list = ANSWERS[len];
    const word = list[Math.floor(rng() * list.length)];
    return { len, word };
  }
  function dailyPuzzle(di) {
    const seed = ((di + 1) * 2654435761) >>> 0;
    return pickWord(mulberry32(seed));
  }
  function randomPuzzle() {
    const seed = ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1;
    return pickWord(mulberry32(seed));
  }

  /* ---------- state ---------- */
  const settings = Object.assign(
    { hard: false, crt: true, motion: false },
    load(KEY.set, {})
  );
  let state = null; // {mode, len, answer, di?, guesses:[], evals:[], row, current, done, win}

  /* ---------- elements ---------- */
  const $ = (s) => document.querySelector(s);
  const board = $("#board");
  const kb = $("#keyboard");
  const toasts = $("#toasts");
  const subMode = $("#sub-mode");
  const subLen = $("#sub-len");
  let tiles = []; // [row][col] -> element

  /* ---------- toast ---------- */
  let toastTimer;
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

  /* ---------- board / keyboard build ---------- */
  function buildBoard(len) {
    board.style.setProperty("--cols", len);
    board.innerHTML = "";
    tiles = [];
    for (let r = 0; r < ROWS; r++) {
      const row = document.createElement("div");
      row.className = "row";
      const rowTiles = [];
      for (let c = 0; c < len; c++) {
        const t = document.createElement("div");
        t.className = "tile";
        const g = document.createElement("span");
        g.className = "glyph";
        t.appendChild(g);
        row.appendChild(t);
        rowTiles.push(t);
      }
      board.appendChild(row);
      tiles.push(rowTiles);
    }
  }

  const KB_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  const keyEls = {};
  function buildKeyboard() {
    kb.innerHTML = "";
    KB_ROWS.forEach((line, i) => {
      const row = document.createElement("div");
      row.className = "krow";
      if (i === 2) row.appendChild(makeKey("enter", "Enter", true));
      for (const ch of line) row.appendChild(makeKey(ch, ch));
      if (i === 2) {
        const bk = makeKey("back", "", true);
        bk.innerHTML = '<svg class="ic"><use href="#i-back"/></svg>';
        bk.setAttribute("aria-label", "Backspace");
        row.appendChild(bk);
      }
      kb.appendChild(row);
    });
  }
  function makeKey(key, label, wide) {
    const b = document.createElement("button");
    b.className = "key" + (wide ? " wide" : "");
    b.dataset.key = key;
    b.textContent = label;
    b.addEventListener("click", () => handleKey(key));
    if (/^[a-z]$/.test(key)) keyEls[key] = b;
    return b;
  }
  function paintKeyboard() {
    for (const ch in keyEls) keyEls[ch].classList.remove("correct", "present", "absent");
    const best = {};
    state.evals.forEach((ev, r) => {
      const g = state.guesses[r];
      for (let i = 0; i < g.length; i++) {
        const s = ev[i], ch = g[i], cur = best[ch];
        if (s === "correct" || (s === "present" && cur !== "correct") || (s === "absent" && !cur))
          best[ch] = s;
      }
    });
    for (const ch in best) keyEls[ch] && keyEls[ch].classList.add(best[ch]);
  }

  /* ---------- evaluate ---------- */
  function evaluate(guess, answer) {
    const len = answer.length;
    const res = new Array(len).fill("absent");
    const counts = {};
    for (const c of answer) counts[c] = (counts[c] || 0) + 1;
    for (let i = 0; i < len; i++)
      if (guess[i] === answer[i]) { res[i] = "correct"; counts[guess[i]]--; }
    for (let i = 0; i < len; i++)
      if (res[i] !== "correct" && counts[guess[i]] > 0) { res[i] = "present"; counts[guess[i]]--; }
    return res;
  }

  /* ---------- hard-mode constraints ---------- */
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

  /* ---------- input ---------- */
  let locked = false;
  function modalOpen() { return !!document.querySelector(".backdrop.open"); }

  function handleKey(key) {
    if (locked || state.done || modalOpen()) return;
    if (key === "enter") return submit();
    if (key === "back") {
      if (state.current.length === 0) return;
      state.current = state.current.slice(0, -1);
      const t = tiles[state.row][state.current.length];
      t.querySelector(".glyph").textContent = "";
      t.classList.remove("filled");
      return;
    }
    if (/^[a-z]$/.test(key) && state.current.length < state.len) {
      const i = state.current.length;
      state.current += key;
      const t = tiles[state.row][i];
      t.querySelector(".glyph").textContent = key;
      t.classList.add("filled");
    }
  }

  function shakeRow(msg, bad) {
    toast(msg, bad);
    const row = board.children[state.row];
    row.classList.add("shake");
    row.addEventListener("animationend", () => row.classList.remove("shake"), { once: true });
  }

  async function submit() {
    const guess = state.current;
    if (guess.length < state.len) return shakeRow("Not enough letters", true);
    if (!validSet().has(guess)) return shakeRow("Not in word list", true);
    const he = hardError(guess);
    if (he) return shakeRow(he, true);

    // server-authoritative daily: the answer lives on the server; it scores the guess
    if (state.server) {
      locked = true;
      const res = await window.ZOZDLE_ONLINE.submitGuess(guess);
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
    const rowTiles = tiles[r];
    const win = ev.every((s) => s === "correct");
    const step = settings.motion ? 0 : 230;

    const finish = () => {
      paintKeyboard();
      locked = false;
      if (win) onWin(r);
      else if (state.row >= ROWS) onLose();
      else persistGame();
    };

    if (settings.motion) {
      rowTiles.forEach((t, i) => applyReveal(t, ev[i]));
      finish();
      return;
    }
    rowTiles.forEach((t, i) => {
      setTimeout(() => {
        t.classList.add("reveal");
        setTimeout(() => applyReveal(t, ev[i]), 250);
        t.addEventListener("animationend", () => t.classList.remove("reveal"), { once: true });
        if (i === rowTiles.length - 1) setTimeout(finish, 300);
      }, i * step);
    });
  }
  function applyReveal(t, s) {
    t.classList.remove("filled");
    t.classList.add(s);
  }

  /* ---------- win / lose ---------- */
  function onWin(r) {
    const row = board.children[r];
    if (!settings.motion) {
      row.classList.add("bounce");
      row.addEventListener("animationend", () => row.classList.remove("bounce"), { once: true });
    }
    state.done = true; state.win = true;
    toast(["Genius!", "Magnificent!", "Impressive!", "Splendid!", "Great!", "Phew!"][r] || "Solved!");
    if (state.server) { const o = window.ZOZDLE_ONLINE; o && o.refreshProfile && o.refreshProfile(); }
    else { if (state.mode === "daily") recordStats(true, r + 1); persistGame(); }
    if (state.mode === "archive") return; // archive: no daily stats modal
    setTimeout(openStats, 1500);
  }
  function onLose() {
    state.done = true; state.win = false;
    if (state.server) { const o = window.ZOZDLE_ONLINE; o && o.refreshProfile && o.refreshProfile(); }
    else { if (state.mode === "daily") recordStats(false, 0); persistGame(); }
    if (state.mode === "archive") { toast("The word was " + state.answer.toUpperCase(), true); return; }
    setTimeout(openStats, 900);
  }

  /* ---------- stats ---------- */
  function blankStats() { return { played: 0, wins: 0, cur: 0, max: 0, lastWinDay: null, lastDay: null, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } }; }
  function recordStats(win, tries) {
    const s = load(KEY.stats, blankStats());
    if (s.lastDay === state.di) return; // already recorded today
    s.played++;
    if (win) {
      s.wins++; s.dist[tries] = (s.dist[tries] || 0) + 1;
      s.cur = s.lastWinDay === state.di - 1 ? s.cur + 1 : 1;
      s.lastWinDay = state.di;
      s.max = Math.max(s.max, s.cur);
    } else { s.cur = 0; }
    s.lastDay = state.di;
    save(KEY.stats, s);
  }

  /* ---------- persistence (daily resume) ---------- */
  function persistDaily() {
    if (state.mode !== "daily" || state.server) return; // server games persist server-side
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
    state = { mode: "practice", di: null, len: saved.len, answer: saved.answer, guesses: [], evals: [], row: 0, current: "", done: !!saved.done, win: !!saved.win };
    (saved.guesses || []).forEach((g) => { state.guesses.push(g); state.evals.push(evaluate(g, saved.answer)); });
    state.row = state.guesses.length;
    setupBoard();
  }
  function promptResume(saved) {
    resumePractice(saved);    // show the in-progress game behind the prompt
    openModal("#m-resume");   // dismissing the prompt = continue (no progress lost)
  }

  /* ---------- new game ---------- */
  function startDaily() {
    const di = dayIndex();
    const saved = load(KEY.daily, null);
    let p;
    if (saved && saved.di === di) p = { len: saved.len, word: saved.answer };
    else p = dailyPuzzle(di);

    state = { mode: "daily", di, len: p.len, answer: p.word || p.word, guesses: [], evals: [], row: 0, current: "", done: false, win: false };
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
    saved.guesses.forEach((g) => {
      state.guesses.push(g);
      state.evals.push(evaluate(g, state.answer));
    });
    state.row = state.guesses.length;
    state.done = saved.done; state.win = saved.win;
  }
  function setupBoard() {
    buildBoard(state.len);
    subMode.textContent = state.mode === "daily" ? "Daily" : state.mode === "archive" ? "Archive" : "Practice";
    subLen.textContent = state.len;
    // paint any replayed rows instantly
    state.evals.forEach((ev, r) => {
      for (let i = 0; i < state.len; i++) {
        const t = tiles[r][i];
        t.querySelector(".glyph").textContent = state.guesses[r][i];
        applyReveal(t, ev[i]);
      }
    });
    paintKeyboard();
  }

  /* ---------- share ---------- */
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
    } catch { /* fall through to copy */ }
    try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
    catch { toast("Could not copy", true); }
  }

  /* ---------- definition (free dictionaryapi.dev, enhancement only) ---------- */
  const defCache = {};
  function firstDefinition(data) {
    for (const entry of data || [])
      for (const m of entry.meanings || [])
        for (const d of m.definitions || []) {
          const text = (d.definition || "").replace(/^\(heading\)\s*/i, "").trim();
          if (text) return { pos: m.partOfSpeech || "", text };
        }
    return null;
  }
  function renderDef(el, info) {
    el.classList.remove("err");
    el.innerHTML = `<span class="pos">${info.pos}</span> ${info.text}`;
  }
  function defFallback(el, word) {
    el.classList.add("err");
    el.innerHTML = `Definition unavailable — <a href="https://www.merriam-webster.com/dictionary/${word}" target="_blank" rel="noopener">look it up &#8599;</a>`;
  }
  async function showDefinition(word) {
    const el = $("#definition");
    if (defCache[word]) return defCache[word] === "none" ? defFallback(el, word) : renderDef(el, defCache[word]);
    el.classList.remove("err");
    el.textContent = "Looking up definition…";
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      if (!res.ok) throw new Error("not found");
      const info = firstDefinition(await res.json());
      if (!info) throw new Error("empty");
      defCache[word] = info;
      renderDef(el, info);
    } catch {
      defCache[word] = "none";
      defFallback(el, word);
    }
  }

  /* ---------- modals ---------- */
  function openModal(id) { closeModals(); $(id).classList.add("open"); }
  function closeModals() { document.querySelectorAll(".backdrop.open").forEach((b) => b.classList.remove("open")); }

  function openStats() {
    const o = window.ZOZDLE_ONLINE;
    const distSection = $("#dist-section");
    if (state && state.server && o && o.profile) {
      // signed-in server game: show authoritative profile stats, hide local distribution
      const p = o.profile;
      $("#st-played").textContent = p.total_played;
      $("#st-win").textContent = p.total_played ? Math.round((p.total_wins / p.total_played) * 100) : 0;
      $("#st-streak").textContent = p.current_streak;
      $("#st-max").textContent = p.max_streak;
      if (distSection) distSection.classList.add("hidden");
    } else {
      const s = load(KEY.stats, blankStats());
      $("#st-played").textContent = s.played;
      $("#st-win").textContent = s.played ? Math.round((s.wins / s.played) * 100) : 0;
      $("#st-streak").textContent = s.cur;
      $("#st-max").textContent = s.max;
      if (distSection) distSection.classList.remove("hidden");
      const maxBar = Math.max(1, ...Object.values(s.dist));
      const distEl = $("#dist");
      distEl.innerHTML = "";
      const curTries = state.done && state.win && state.mode === "daily" ? state.guesses.length : -1;
      for (let i = 1; i <= ROWS; i++) {
        const n = s.dist[i] || 0;
        const wrap = document.createElement("div");
        wrap.className = "dist-row";
        wrap.innerHTML =
          `<span>${i}</span><span class="dist-bar${i === curTries ? " cur" : ""}" style="width:${Math.max(8, (n / maxBar) * 100)}%">${n}</span>`;
        distEl.appendChild(wrap);
      }
    }
    const lbBtn = $("#btn-leaderboard");
    if (lbBtn) lbBtn.classList.toggle("hidden", !(o && o.enabled && o.user));

    // end banner / reveal word
    const banner = $("#end-banner");
    if (state.done) {
      banner.classList.remove("hidden");
      $("#reveal-word").innerHTML = state.win
        ? `★ ${state.answer.toUpperCase()} ★`
        : `The word was ${state.answer.toUpperCase()}`;
      showDefinition(state.answer);
    } else banner.classList.add("hidden");

    // daily countdown vs practice replay
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

  /* ---------- settings ---------- */
  function applySettings() {
    document.documentElement.style.setProperty("--crt", settings.crt ? 0.5 : 0);
    $("#set-hard").checked = settings.hard;
    $("#set-crt").checked = settings.crt;
    $("#set-motion").checked = settings.motion;
  }

  /* ---------- mode switch ---------- */
  function syncTabs(mode) {
    $("#mode-daily").setAttribute("aria-pressed", String(mode === "daily"));
    $("#mode-archive").setAttribute("aria-pressed", String(mode === "archive"));
    $("#mode-practice").setAttribute("aria-pressed", String(mode === "practice"));
  }
  function setMode(mode) {
    syncTabs(mode);
    if (mode === "daily") { if (onlineDaily()) startDailyServer(); else startDaily(); }
    else {
      if (state && state.mode === "practice") return;      // already in practice
      const saved = load(KEY.practice, null);
      if (saved && !saved.done && (saved.guesses || []).length > 0) promptResume(saved); // ask
      else if (saved && !saved.done) resumePractice(saved); // in progress but no guesses → just resume
      else startPractice();                                  // none or finished → fresh word
    }
  }

  /* ---------- archive ---------- */
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtDate(di) {
    const d = new Date(EPOCH); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + di);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function loadArchive(di) {
    const p = dailyPuzzle(di);
    const rec = load(KEY.archive, {})[di];
    state = { mode: "archive", di, len: p.len, answer: p.word, guesses: [], evals: [], row: 0, current: "", done: false, win: false };
    if (rec) {
      (rec.guesses || []).forEach((g) => { state.guesses.push(g); state.evals.push(evaluate(g, p.word)); });
      state.row = state.guesses.length; state.done = !!rec.done; state.win = !!rec.win;
    }
    syncTabs("archive");
    setupBoard();
    subMode.textContent = "Archive · " + fmtDate(di);
  }
  function openArchive() { buildCalendar(); openModal("#m-archive"); }
  function selectArchiveDay(di) {
    if (load(KEY.archive, {})[di]?.done) return toast("You already guessed this word!");
    closeModals();
    loadArchive(di);
  }
  function buildCalendar() {
    const cal = $("#archive-cal");
    const archive = load(KEY.archive, {});
    const todayDi = dayIndex();
    const start = new Date(EPOCH); start.setHours(0, 0, 0, 0);
    const now = new Date();
    let y = start.getFullYear(), m = start.getMonth();
    const endY = now.getFullYear(), endM = now.getMonth();
    let html = `<div class="cal-dow">${["S", "M", "T", "W", "T", "F", "S"].map((d) => `<span>${d}</span>`).join("")}</div>`;
    while (y < endY || (y === endY && m <= endM)) {
      html += `<div class="cal-month">${MONTHS[m]} ${y}</div><div class="cal-grid">`;
      const lead = new Date(y, m, 1).getDay();
      for (let i = 0; i < lead; i++) html += `<span class="cal-cell blank"></span>`;
      const days = new Date(y, m + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const cd = new Date(y, m, d); cd.setHours(0, 0, 0, 0);
        const di = dayIndex(cd);
        let cls = "cal-cell", click = false;
        if (di < 0) cls += " blank";
        else if (di > todayDi) cls += " future";
        else {
          const rec = archive[di];
          if (rec && rec.done) cls += " done";
          else if (rec) cls += " progress";
          else if (di === todayDi) cls += " today";
          else cls += " miss";
          click = true;
        }
        html += `<button class="${cls}" ${click ? `data-di="${di}"` : "disabled"}>${di < 0 ? "" : d}</button>`;
      }
      html += `</div>`;
      m++; if (m > 11) { m = 0; y++; }
    }
    cal.innerHTML = html;
    cal.querySelectorAll("[data-di]").forEach((b) => (b.onclick = () => selectArchiveDay(+b.dataset.di)));
    cal.scrollTop = cal.scrollHeight; // start at the most recent month
  }

  /* ---------- wire up ---------- */
  let inited = false;
  function init() {
    if (inited) return; // guard against a double DOMContentLoaded
    inited = true;
    // hooks for the online layer (js/online.js)
    window.ZOZDLE_GAME = {
      toast,
      isDaily: () => !!(state && state.mode === "daily"),
      reloadDaily: () => { if (state && state.mode === "daily") setMode("daily"); },
    };
    buildKeyboard();
    applySettings();
    setMode("daily");

    // header
    $("#btn-help").addEventListener("click", () => openModal("#m-help"));
    $("#btn-stats").addEventListener("click", openStats);
    $("#btn-settings").addEventListener("click", () => openModal("#m-settings"));
    $("#mode-daily").addEventListener("click", () => setMode("daily"));
    $("#mode-archive").addEventListener("click", openArchive);
    $("#mode-practice").addEventListener("click", () => setMode("practice"));
    $("#btn-share").addEventListener("click", share);
    $("#btn-newpractice").addEventListener("click", () => { closeModals(); startPractice(); });
    $("#resume-continue").addEventListener("click", closeModals); // board already shows the resumed game
    $("#resume-reset").addEventListener("click", () => { closeModals(); startPractice(); });
    const lbBtn = $("#btn-leaderboard");
    if (lbBtn) lbBtn.addEventListener("click", () => { const o = window.ZOZDLE_ONLINE; if (o && o.openCompete) o.openCompete(); });

    // settings toggles
    $("#set-hard").addEventListener("change", (e) => {
      if (e.target.checked && state && state.row > 0 && !state.done) {
        e.target.checked = false; toast("Can't enable hard mode mid-game", true); return;
      }
      settings.hard = e.target.checked; save(KEY.set, settings);
    });
    $("#set-crt").addEventListener("change", (e) => { settings.crt = e.target.checked; save(KEY.set, settings); applySettings(); });
    $("#set-motion").addEventListener("change", (e) => { settings.motion = e.target.checked; save(KEY.set, settings); });

    // close handlers
    document.querySelectorAll("[data-close]").forEach((b) =>
      b.addEventListener("click", closeModals));
    document.querySelectorAll(".backdrop").forEach((bd) =>
      bd.addEventListener("click", (e) => { if (e.target === bd) closeModals(); }));

    // physical keyboard
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") return closeModals();
      if (modalOpen()) return;
      if (e.key === "Enter") { e.preventDefault(); handleKey("enter"); }
      else if (e.key === "Backspace") { e.preventDefault(); handleKey("back"); }
      else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toLowerCase());
    });

    // first-time help
    if (!localStorage.getItem(KEY.seen)) {
      openModal("#m-help");
      localStorage.setItem(KEY.seen, "1");
    }

    // service worker
    if ("serviceWorker" in navigator)
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
