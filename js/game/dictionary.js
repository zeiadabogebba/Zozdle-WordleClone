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
  el.textContent = "";
  const pos = document.createElement("span");
  pos.className = "pos";
  pos.textContent = info.pos;
  el.appendChild(pos);
  el.appendChild(document.createTextNode(" " + info.text));
}

function defFallback(el, word) {
  el.classList.add("err");
  el.innerHTML = `Definition unavailable — <a href="https://www.merriam-webster.com/dictionary/${word}" target="_blank" rel="noopener">look it up &#8599;</a>`;
}

export async function showDefinition(el, word) {
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
