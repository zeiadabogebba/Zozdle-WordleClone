export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDayIndex(epoch, dayMs) {
  return function dayIndex(d = new Date()) {
    const m = new Date(d); m.setHours(0, 0, 0, 0);
    const e = new Date(epoch); e.setHours(0, 0, 0, 0);
    return Math.floor((m - e) / dayMs);
  };
}

export function makePuzzlePicker(answers, lengths) {
  function pickWord(rng) {
    const len = lengths[Math.floor(rng() * lengths.length)];
    const list = answers[len];
    const word = list[Math.floor(rng() * list.length)];
    return { len, word };
  }
  return {
    pickWord,
    dailyPuzzle(di) {
      const seed = ((di + 1) * 2654435761) >>> 0;
      return pickWord(mulberry32(seed));
    },
    randomPuzzle() {
      const seed = ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0) || 1;
      return pickWord(mulberry32(seed));
    },
  };
}
