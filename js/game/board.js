const KB_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

export function createBoard({ boardEl, keyboardEl, rows, onKey }) {
  let tiles = [];
  const keyEls = {};

  function buildBoard(len) {
    boardEl.style.setProperty("--cols", len);
    boardEl.innerHTML = "";
    tiles = [];
    for (let r = 0; r < rows; r++) {
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
      boardEl.appendChild(row);
      tiles.push(rowTiles);
    }
  }

  function makeKey(key, label, wide) {
    const b = document.createElement("button");
    b.className = "key" + (wide ? " wide" : "");
    b.dataset.key = key;
    b.textContent = label;
    b.addEventListener("click", () => onKey(key));
    if (/^[a-z]$/.test(key)) keyEls[key] = b;
    return b;
  }

  function buildKeyboard() {
    keyboardEl.innerHTML = "";
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
      keyboardEl.appendChild(row);
    });
  }

  function paintKeyboard(guesses, evals) {
    for (const ch in keyEls) keyEls[ch].classList.remove("correct", "present", "absent");
    const best = {};
    evals.forEach((ev, r) => {
      const g = guesses[r];
      for (let i = 0; i < g.length; i++) {
        const s = ev[i], ch = g[i], cur = best[ch];
        if (s === "correct" || (s === "present" && cur !== "correct") || (s === "absent" && !cur))
          best[ch] = s;
      }
    });
    for (const ch in best) keyEls[ch] && keyEls[ch].classList.add(best[ch]);
  }

  function applyReveal(tile, status) {
    tile.classList.remove("filled");
    tile.classList.add(status);
  }

  return {
    buildBoard,
    buildKeyboard,
    paintKeyboard,
    applyReveal,
    getTile: (row, col) => tiles[row][col],
    getRowTiles: (row) => tiles[row],
    getRowEl: (row) => boardEl.children[row],
  };
}
