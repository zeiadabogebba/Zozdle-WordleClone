import { load, save } from "./storage.js";

export function blankStats() {
  return { played: 0, wins: 0, cur: 0, max: 0, lastWinDay: null, lastDay: null, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } };
}

export function loadStats(statsKey) {
  return load(statsKey, blankStats());
}

export function recordStats(statsKey, di, win, tries) {
  const s = loadStats(statsKey);
  if (s.lastDay === di) return;
  s.played++;
  if (win) {
    s.wins++; s.dist[tries] = (s.dist[tries] || 0) + 1;
    s.cur = s.lastWinDay === di - 1 ? s.cur + 1 : 1;
    s.lastWinDay = di;
    s.max = Math.max(s.max, s.cur);
  } else { s.cur = 0; }
  s.lastDay = di;
  save(statsKey, s);
}

export function recordStatsNoStreak(statsKey, win, tries) {
  const s = loadStats(statsKey);
  s.played++;
  if (win) { s.wins++; s.dist[tries] = (s.dist[tries] || 0) + 1; }
  save(statsKey, s);
}

export function renderDist(rows, dist, curTries) {
  const distSection = document.querySelector("#dist-section");
  const distEl = document.querySelector("#dist");
  if (!dist || !distSection || !distEl) return;
  const vals = Object.values(dist);
  if (vals.length === 0) { distSection.classList.add("hidden"); return; }
  distSection.classList.remove("hidden");
  const maxBar = Math.max(1, ...vals);
  distEl.innerHTML = "";
  for (let i = 1; i <= rows; i++) {
    const n = dist[i] || 0;
    const wrap = document.createElement("div");
    wrap.className = "dist-row";
    wrap.innerHTML = `<span>${i}</span><span class="dist-bar${i === curTries ? " cur" : ""}" style="width:${Math.max(8, (n / maxBar) * 100)}%">${n}</span>`;
    distEl.appendChild(wrap);
  }
}
