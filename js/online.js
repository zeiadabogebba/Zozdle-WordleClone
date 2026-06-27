/* ============================================================
   Zozdle — online layer (Supabase): magic-link auth, profile,
   server-authoritative daily RPCs, and the leagues / leaderboards /
   friends'-grids UI. Exposes window.ZOZDLE_ONLINE for app.js.
   If Supabase isn't configured, this disables itself and Zozdle
   runs as the offline single-player game.
   ============================================================ */
(function () {
  "use strict";
  const cfg = window.ZOZDLE_SUPABASE || {};
  const ok = !!(cfg.url && cfg.anonKey && /^https?:\/\//.test(cfg.url) && window.supabase);
  const $ = (s) => document.querySelector(s);

  const O = (window.ZOZDLE_ONLINE = { enabled: ok, user: null, profile: null });

  if (!ok) {
    document.addEventListener("DOMContentLoaded", () =>
      ["#btn-account", "#btn-compete"].forEach((s) => { const b = $(s); if (b) b.classList.add("hidden"); }));
    return;
  }

  const sb = window.supabase.createClient(cfg.url, cfg.anonKey);

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const isDefaultName = (n) => /^player\d+$/i.test(n || "");
  const toast = (m, bad) => (window.ZOZDLE_GAME && window.ZOZDLE_GAME.toast ? window.ZOZDLE_GAME.toast(m, bad) : null);
  const openModal = (sel) => { document.querySelectorAll(".backdrop.open").forEach((b) => b.classList.remove("open")); $(sel).classList.add("open"); };
  const closeModals = () => document.querySelectorAll(".backdrop.open").forEach((b) => b.classList.remove("open"));
  const todayUTC = () => new Date().toISOString().slice(0, 10);

  /* ---------- session / profile ---------- */
  async function loadProfile() {
    if (!O.user) { O.profile = null; return; }
    const { data } = await sb.from("profiles")
      .select("username,current_streak,max_streak,total_wins,total_played")
      .eq("id", O.user.id).single();
    O.profile = data || null;
  }
  O.refreshProfile = async () => { await loadProfile(); updateTopbar(); };

  function updateTopbar() {
    const b = $("#btn-account");
    if (b) b.classList.toggle("on", !!O.user);
  }

  let lastUid;
  function onAuth() {
    updateTopbar();
    const uid = O.user ? O.user.id : null;
    if (uid !== lastUid) {
      const first = lastUid === undefined;
      lastUid = uid;
      const g = window.ZOZDLE_GAME;
      if (g && g.isDaily && g.isDaily()) g.reloadDaily();
      if (!first && O.user && O.profile && isDefaultName(O.profile.username)) openAccount();
    }
  }

  O.ready = new Promise((resolve) => {
    let done = false;
    sb.auth.onAuthStateChange(async (_e, session) => {
      O.user = session ? session.user : null;
      await loadProfile();
      onAuth();
      if (!done) { done = true; resolve(); }
    });
  });

  /* ---------- game RPCs ---------- */
  O.dailyStatus = async () => { const { data, error } = await sb.rpc("daily_status"); if (error) throw error; return data; };
  O.submitGuess = async (g) => { const { data, error } = await sb.rpc("submit_guess", { p_guess: g }); return error ? { error: "network" } : data; };

  /* ---------- auth actions ---------- */
  let pendingEmail = "";
  // code-only: signInWithOtp sends the email containing {{ .Token }}; no link/redirect
  O.signIn = (email) => sb.auth.signInWithOtp({ email });
  O.verify = (email, token) => sb.auth.verifyOtp({ email, token, type: "email" });
  O.signOut = () => sb.auth.signOut();

  /* ---------- social RPCs ---------- */
  O.setUsername = async (n) => { const { data, error } = await sb.rpc("set_username", { p_username: n }); if (error) throw error; if (!data.error) await loadProfile(); return data; };
  O.myLeagues = async () => { const { data, error } = await sb.rpc("my_leagues"); if (error) throw error; return data || []; };
  O.createLeague = async (n) => { const { data, error } = await sb.rpc("create_league", { p_name: n }); if (error) throw error; return data; };
  O.joinLeague = async (c) => { const { data, error } = await sb.rpc("join_league", { p_code: c }); if (error) throw error; return data; };
  O.globalBoard = async () => { const { data, error } = await sb.rpc("global_board", { p_limit: 100 }); if (error) throw error; return data || []; };
  O.leagueBoard = async (id) => { const { data, error } = await sb.rpc("league_board", { p_league: id }); if (error) throw error; return data || []; };
  O.leagueGrids = async (id, d) => { const { data, error } = await sb.rpc("league_day_grids", { p_league: id, p_date: d }); if (error) throw error; return data || []; };
  O.openCompete = () => openCompete();
  O.openAccount = () => openAccount();

  /* ============================================================
     UI
     ============================================================ */
  function openAccount() {
    const body = $("#account-body");
    if (!O.user) {
      body.innerHTML = `
        <p>No passwords — enter your email and we'll send a <strong>6-digit code</strong>.</p>
        <input class="field" id="auth-email" type="email" inputmode="email" placeholder="you@email.com" autocomplete="email" />
        <div class="btn-row"><button class="btn btn-primary" id="auth-send">Send code</button></div>
        <div id="auth-step2" class="hidden">
          <p style="margin-top:12px">Enter the 6-digit code from the email:</p>
          <input class="field code-input" id="auth-code" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code" />
          <div class="btn-row"><button class="btn btn-ghost" id="auth-verify">Sign in</button></div>
        </div>`;
      $("#auth-send").onclick = async () => {
        const email = $("#auth-email").value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Enter a valid email", true);
        const btn = $("#auth-send"); btn.disabled = true;
        const { error } = await O.signIn(email); btn.disabled = false;
        if (error) return toast(error.message || "Couldn't send link", true);
        pendingEmail = email; $("#auth-step2").classList.remove("hidden"); $("#auth-code").focus(); toast("Code sent ✦ — check your email");
      };
      $("#auth-verify").onclick = async () => {
        const token = $("#auth-code").value.trim();
        if (token.length < 6) return toast("Enter the 6-digit code", true);
        const btn = $("#auth-verify"); btn.disabled = true;
        const { error } = await O.verify(pendingEmail, token); btn.disabled = false;
        if (error) return toast("Invalid or expired code", true);
        closeModals(); toast("Signed in ✦");
      };
    } else {
      const p = O.profile || {};
      body.innerHTML = `
        <p>Signed in as <strong>${esc(O.user.email)}</strong></p>
        <label class="field-label" for="uname">Display name — shown on leaderboards</label>
        <input class="field" id="uname" maxlength="16" value="${esc(p.username || "")}" />
        <div class="btn-row"><button class="btn btn-primary" id="uname-save">Save name</button></div>
        <div class="lb" style="margin-top:16px">
          <div class="lb-row"><span class="lb-name">Current streak</span><span class="lb-streak">🔥 ${p.current_streak || 0}</span></div>
          <div class="lb-row"><span class="lb-name">Max streak</span><span class="lb-streak">${p.max_streak || 0}</span></div>
          <div class="lb-row"><span class="lb-name">Wins</span><span class="lb-streak">${p.total_wins || 0}</span></div>
        </div>
        <div class="btn-row" style="margin-top:14px"><button class="btn btn-ghost" id="signout">Sign out</button></div>`;
      $("#uname-save").onclick = async () => {
        const n = $("#uname").value.trim();
        const r = await O.setUsername(n).catch(() => ({ error: "network" }));
        if (r.error) return toast({ format: "3–16 letters, numbers or _", taken: "That name's taken", auth: "Sign in first" }[r.error] || "Couldn't save", true);
        updateTopbar(); toast("Saved ✦");
      };
      $("#signout").onclick = async () => { await O.signOut(); closeModals(); toast("Signed out"); };
    }
    openModal("#m-account");
  }

  function openCompete() {
    if (!O.user) { toast("Sign in to compete", true); return openAccount(); }
    openModal("#m-compete");
    showTab("global");
  }
  function showTab(tab) {
    $("#tab-global").setAttribute("aria-pressed", String(tab === "global"));
    $("#tab-leagues").setAttribute("aria-pressed", String(tab === "leagues"));
    tab === "global" ? renderGlobal() : renderLeagues();
  }

  const loading = `<div class="loading">Loading…</div>`;
  function lbTable(rows) {
    return `<div class="lb">` + rows.map((r, i) =>
      `<div class="lb-row${O.profile && r.username === O.profile.username ? " me" : ""}">
         <span class="lb-rank">${i + 1}</span>
         <span class="lb-name">${esc(r.username)}</span>
         <span class="lb-streak">🔥 ${r.streak}</span>
       </div>`).join("") + `</div>`;
  }

  async function renderGlobal() {
    const body = $("#compete-body"); body.innerHTML = loading;
    try {
      const rows = await O.globalBoard();
      body.innerHTML = rows.length ? lbTable(rows) : `<p class="empty">No players yet — be the first to start a streak!</p>`;
    } catch { body.innerHTML = `<p class="empty">Couldn't load the leaderboard.</p>`; }
  }

  async function renderLeagues() {
    const body = $("#compete-body");
    body.innerHTML = `
      <div class="league-actions">
        <input class="field" id="lg-name" maxlength="40" placeholder="New league name" />
        <button class="btn btn-primary" id="lg-create">Create</button>
      </div>
      <div class="league-actions">
        <input class="field" id="lg-code" maxlength="6" placeholder="Invite code" style="text-transform:uppercase" />
        <button class="btn btn-ghost" id="lg-join">Join</button>
      </div>
      <div id="lg-list" class="lg-list">${loading}</div>`;
    $("#lg-create").onclick = async () => {
      const n = $("#lg-name").value.trim(); if (!n) return toast("Name your league", true);
      try { const r = await O.createLeague(n); toast("Created — code " + r.code); renderLeagues(); }
      catch { toast("Couldn't create league", true); }
    };
    $("#lg-join").onclick = async () => {
      const c = $("#lg-code").value.trim(); if (!c) return toast("Enter an invite code", true);
      const r = await O.joinLeague(c).catch(() => ({ error: "network" }));
      if (r.error) return toast(r.error === "not_found" ? "No league with that code" : "Couldn't join", true);
      toast("Joined " + (r.name || "league")); renderLeagues();
    };
    try {
      const leagues = await O.myLeagues();
      const list = $("#lg-list");
      list.innerHTML = leagues.length ? leagues.map((l) =>
        `<button class="league-item" data-id="${l.id}" data-name="${esc(l.name)}">
           <span class="li-name">${esc(l.name)}</span>
           <span class="li-meta">${l.members} player${l.members === 1 ? "" : "s"} · <b>${esc(l.code)}</b></span>
         </button>`).join("")
        : `<p class="empty">No leagues yet. Create one and share the code with friends.</p>`;
      list.querySelectorAll(".league-item").forEach((b) =>
        b.onclick = () => renderLeagueDetail(b.dataset.id, b.dataset.name));
    } catch { $("#lg-list").innerHTML = `<p class="empty">Couldn't load your leagues.</p>`; }
  }

  function gridCard(r) {
    const cls = { G: "g", Y: "y", X: "x" };
    const rows = (r.patterns || []).map((p) =>
      `<div class="mini-row">` + p.split("").map((c) => `<span class="mini-cell ${cls[c] || "x"}"></span>`).join("") + `</div>`).join("");
    return `<div class="grid-card">
        <div class="grid-head"><span>${esc(r.username)}</span><span class="grid-res">${r.solved ? r.tries + "/6" : "X/6"}</span></div>
        <div class="mini-grid">${rows}</div>
      </div>`;
  }

  async function renderLeagueDetail(id, name) {
    const body = $("#compete-body");
    body.innerHTML = `
      <button class="link-back" id="lg-back">← Leagues</button>
      <h3 class="detail-title">${esc(name)}</h3>
      <div class="seg"><button class="seg-btn on" id="d-board">Standings</button><button class="seg-btn" id="d-grids">Today's grids</button></div>
      <div id="detail-body">${loading}</div>`;
    $("#lg-back").onclick = () => renderLeagues();
    const bBtn = $("#d-board"), gBtn = $("#d-grids"), db = $("#detail-body");
    const showBoard = async () => {
      bBtn.classList.add("on"); gBtn.classList.remove("on"); db.innerHTML = loading;
      try { const rows = await O.leagueBoard(id); db.innerHTML = rows.length ? lbTable(rows) : `<p class="empty">No members yet.</p>`; }
      catch { db.innerHTML = `<p class="empty">Couldn't load standings.</p>`; }
    };
    const showGrids = async () => {
      gBtn.classList.add("on"); bBtn.classList.remove("on"); db.innerHTML = loading;
      try {
        const rows = await O.leagueGrids(id, todayUTC());
        db.innerHTML = rows.length ? rows.map(gridCard).join("")
          : `<p class="empty">🔒 Finish today's Zozdle to reveal everyone's grids.</p>`;
      } catch { db.innerHTML = `<p class="empty">Couldn't load grids.</p>`; }
    };
    bBtn.onclick = showBoard; gBtn.onclick = showGrids;
    showBoard();
  }

  /* ---------- wire topbar + tabs ---------- */
  function wire() {
    const a = $("#btn-account"); if (a) a.onclick = openAccount;
    const c = $("#btn-compete"); if (c) c.onclick = openCompete;
    const tg = $("#tab-global"); if (tg) tg.onclick = () => showTab("global");
    const tl = $("#tab-leagues"); if (tl) tl.onclick = () => showTab("leagues");
    updateTopbar();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
