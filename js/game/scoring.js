export function evaluate(guess, answer) {
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

export function patToEval(pat) {
  const m = { G: "correct", Y: "present", X: "absent" };
  return pat.split("").map((c) => m[c] || "absent");
}

export function replayGuesses(guesses, answer) {
  return (guesses || []).map((g) => evaluate(g, answer));
}
