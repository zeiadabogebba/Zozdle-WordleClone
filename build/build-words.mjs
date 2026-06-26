/* ============================================================
   Zozdle — word-list build step  (run once, commit the output)

     node build/build-words.mjs

   Inputs  (build/sources/, git-ignored):
     common10k.txt   google-10000-english-no-swears  → ANSWER candidates
     words_alpha.txt dwyl/english-words ~370k         → GUESS validation

   Outputs (js/, committed, precached by sw.js):
     js/words-answers.js   window.ZOZDLE.answers = {4:[…],5:[…],6:[…]}
     js/words-valid.js     window.ZOZDLE.validRaw = "abc\n…"  (4–6 letters)

   Twist: answers are 4, 5 OR 6 letters. Guesses accept any valid word
   of the matching length.
   ============================================================ */

import { readFileSync, writeFileSync } from "node:fs";

const LENGTHS = [4, 5, 6];
const SRC = "build/sources";

/* Small safety blocklist. The answer source is already "no swears", and the
   validation source (words_alpha) is the *guess* list — but we never want a
   slur surfaced as the daily answer or silently accepted, so strip the worst
   from both. Keep lowercase. Extend freely. */
const BLOCK = new Set([
  // slurs
  "nigga","nigger","faggot","fag","retard","retards","spic","chink","kike",
  "wetback","coon","dyke","tranny","negro","negroes","gook",
  // profanity that can slip through length filters
  "shit","shits","piss","pissy","cunt","cunts","twat","twats","cock","cocks",
  "dick","dicks","prick","pricks","slut","sluts","whore","whores","bitch",
  "bitches","bastard","damn","crap","turd","arse","wank","wanker","jizz",
  "anus","anal","penis","vagina","semen","horny","sluts","boner",
]);

/* Proper-noun cleanup for ANSWERS only (guesses stay permissive).
   We subtract personal names + countries/places + obvious slang, but KEEP a
   whitelist of real words that merely happen to also be names (rose, grace…).
   Tune any of these sets to taste. */
const COUNTRIES_PLACES = new Set([
  // countries (single-word, 4–6 letters)
  "china","japan","india","egypt","spain","italy","korea","france","mexico",
  "canada","brazil","russia","kenya","sudan","ghana","syria","libya","israel",
  "jordan","angola","taiwan","poland","norway","sweden","greece","turkey",
  "cuba","chile","peru","iran","iraq","nepal","qatar","yemen","panama",
  "uganda","zambia","serbia","latvia","cyprus","malta","gabon","benin",
  "congo","samoa","haiti","ghana","rwanda","malawi","gambia","kosovo","oman",
  "laos","mali","togo","chad","niger","tonga","palau","nauru","fiji",
  // US states / regions / cities that show up in common lists
  "texas","ohio","utah","idaho","maine","miami","dallas","austin","boston",
  "denver","vegas","oregon","kansas","nevada","hawaii","alaska","aspen",
  "europe","asia","africa","america","london","paris","berlin","tokyo",
  "moscow","dublin","vienna","geneva","quebec","ottawa","sydney","cairo",
]);

const EXTRA_BLOCK = new Set([
  // nicknames / slang / abbreviations that slip past the name list
  "kenny","celebs","admin","blog","blogs","email","emails","url","urls",
  "webcam","online","logos","intel","yahoo","gmail","html","xbox","ipod",
  "fucks","damn",
  // common first names the dominictarr list misses (curated from a 20k name DB,
  // keeping only clear personal names — real words are protected by KEEP)
  "adam","aaron","alan","albert","alfred","allan","allen","andrew","arnold",
  "arthur","brad","brian","bruce","bryan","burton","calvin","carl","carlo",
  "carlos","carter","chan","chen","chuck","clark","colin","craig","curtis",
  "daniel","darwin","dave","david","davis","dennis","derek","diego","donald",
  "doug","duncan","dylan","edgar","edward","elvis","eric","erik","eugene",
  "evans","floyd","gary","gerald","gordon","greg","hans","harold","harris",
  "harvey","hugh","hugo","isaac","jacob","james","jason","jeff","jeremy",
  "jimmy","joel","john","johnny","jones","jose","joseph","josh","joshua",
  "juan","julian","justin","karl","keith","kent","kevin","kirk","kurt",
  "larry","lewis","lloyd","logan","louis","luis","luke","luther","marc",
  "marco","mario","marvin","matt","milan","milton","monroe","morris","moses",
  "murray","nathan","neil","nelson","oliver","oscar","owen","palmer","parker",
  "paul","pete","peter","philip","pierre","ralph","reid","rick","robert",
  "roland","ronald","ross","samuel","scott","simon","singh","stan","steve",
  "steven","stuart","taylor","thomas","todd","travis","troy","tyler","vernon",
  "wagner","walter","warner","wayne","wesley","wilson",
  // places / proper nouns
  "bali","scotia","dakota","disney","salem","venice","arabia","puerto",
  "allah","jesus","santa",
]);

// real words to KEEP even though they collide with a name/place/brand
const KEEP = new Set([
  "bell","bill","bird","dale","dawn","dell","deny","doll","else","gale","gene",
  "glad","glen","gray","hope","jade","jean","lane","page","rose","star","amber",
  "angel","april","berry","brook","bunny","camel","candy","carol","carry",
  "coral","daisy","faith","fancy","glory","grace","happy","heath","holly",
  "honey","honor","ivory","jewel","june","lucky","mercy","merry","olive",
  "pearl","penny","robin","shell","storm","sunny","teddy","cherry","aurora",
  "easter","marina","myrtle","velvet","willow","china","turkey","guinea",
  "jersey","mason","sandy","frank","summer","crystal","ginger","ruby","pearl",
  "iris","ivy","dove","fawn","reed","heather","jasmine","melody","faith",
]);

const onlyAZ = (w) => /^[a-z]+$/.test(w);

function readWords(file) {
  return readFileSync(`${SRC}/${file}`, "utf8")
    .split(/\r?\n/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
}

// ---- validation list: every real word of length 4–6 -------------------------
const validByLen = { 4: new Set(), 5: new Set(), 6: new Set() };
const validAll = new Set();
for (const w of readWords("words_alpha.txt")) {
  if (!LENGTHS.includes(w.length) || !onlyAZ(w) || BLOCK.has(w)) continue;
  validByLen[w.length].add(w);
  validAll.add(w);
}

// names list (subtracted from answers, not from guesses)
const NAMES = new Set(readWords("first-names.txt"));

const isProperNoun = (w) =>
  !KEEP.has(w) && (NAMES.has(w) || COUNTRIES_PLACES.has(w) || EXTRA_BLOCK.has(w));

// ---- answer list: common words that are ALSO valid, minus proper nouns -----
const answers = { 4: [], 5: [], 6: [] };
const seen = new Set();
let droppedProper = 0;
for (const w of readWords("common10k.txt")) {
  if (!LENGTHS.includes(w.length) || !onlyAZ(w) || BLOCK.has(w)) continue;
  if (!validByLen[w.length].has(w)) continue; // must be a real, guessable word
  if (isProperNoun(w)) { droppedProper++; continue; } // skip names/places/slang
  if (seen.has(w)) continue;
  seen.add(w);
  answers[w.length].push(w);
}
for (const n of LENGTHS) answers[n].sort();

// ---- emit -------------------------------------------------------------------
const banner = "/* AUTO-GENERATED by build/build-words.mjs — do not edit by hand. */\n";

writeFileSync(
  "js/words-answers.js",
  banner +
    "window.ZOZDLE = window.ZOZDLE || {};\n" +
    "window.ZOZDLE.answers = " +
    JSON.stringify(answers) +
    ";\n"
);

const validRaw = [...validAll].sort().join("\n");
writeFileSync(
  "js/words-valid.js",
  banner +
    "window.ZOZDLE = window.ZOZDLE || {};\n" +
    "window.ZOZDLE.validRaw = " +
    JSON.stringify(validRaw) +
    ";\n"
);

// ---- report -----------------------------------------------------------------
const fmt = (n) => n.toLocaleString("en-US");
console.log(`dropped ${droppedProper} proper-noun/slang answers.`);
console.log("ANSWERS (common & valid):");
for (const n of LENGTHS) console.log(`  ${n}-letter: ${fmt(answers[n].length)}`);
console.log(`  total:    ${fmt(answers[4].length + answers[5].length + answers[6].length)}`);
console.log("VALIDATION (any real word):");
for (const n of LENGTHS) console.log(`  ${n}-letter: ${fmt(validByLen[n].size)}`);
console.log(`  total:    ${fmt(validAll.size)}`);
console.log("\nsamples:");
for (const n of LENGTHS)
  console.log(`  ${n}: ${answers[n].slice(0, 8).join(", ")} …`);
