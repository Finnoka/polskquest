// translate.cjs
const fs = require("fs");

const DEEPL_KEY = process.env.DEEPL_KEY;
const INPUT     = process.argv[2] ?? "pl_50k.txt";
const LEVEL     = process.argv[3] ?? "a1";
const LIMIT     = parseInt(process.argv[4]) ?? 700;
const OUT_FILE  = `${LEVEL}_translated.csv`;

// Hardcoded overrides for grammatical words that DeepL handles poorly in isolation.
// These ~60 words cover the vast majority of top-frequency Polish function words.
const FUNCTION_WORDS = {
  "nie":        { e: "no",          a: ["no","not","nope","nah"] },
  "to":         { e: "this",        a: ["this","it","that"] },
  "się":        { e: "oneself",     a: ["oneself","self","himself","herself","itself"] },
  "w":          { e: "in",          a: ["in","at","into"] },
  "na":         { e: "on",          a: ["on","at","onto","for"] },
  "i":          { e: "and",         a: ["and"] },
  "że":         { e: "that",        a: ["that"] },
  "z":          { e: "from",        a: ["from","with","of","out of"] },
  "do":         { e: "to",          a: ["to","until","into"] },
  "jak":        { e: "how",         a: ["how","like","as"] },
  "co":         { e: "what",        a: ["what","which"] },
  "ale":        { e: "but",         a: ["but","however"] },
  "tak":        { e: "yes",         a: ["yes","yeah","yep","so"] },
  "już":        { e: "already",     a: ["already","now"] },
  "czy":        { e: "whether",     a: ["whether","or","if"] },
  "po":         { e: "after",       a: ["after","along","for","in"] },
  "o":          { e: "about",       a: ["about","of","at"] },
  "go":         { e: "him",         a: ["him","it"] },
  "ten":        { e: "this",        a: ["this","that","the"] },
  "tej":        { e: "this",        a: ["this","of this"] },
  "ze":         { e: "from",        a: ["from","with","out of"] },
  "mi":         { e: "me",          a: ["me","to me"] },
  "mu":         { e: "him",         a: ["him","to him"] },
  "jej":        { e: "her",         a: ["her","its","hers"] },
  "ich":        { e: "their",       a: ["their","them","theirs"] },
  "im":         { e: "them",        a: ["them","to them"] },
  "je":         { e: "them",        a: ["them","it"] },
  "by":         { e: "would",       a: ["would","by"] },
  "być":        { e: "to be",       a: ["to be","be"] },
  "jest":       { e: "is",          a: ["is","it is"] },
  "są":         { e: "are",         a: ["are","they are"] },
  "też":        { e: "also",        a: ["also","too","as well"] },
  "tylko":      { e: "only",        a: ["only","just"] },
  "jeszcze":    { e: "still",       a: ["still","yet","even"] },
  "może":       { e: "maybe",       a: ["maybe","perhaps","can","might"] },
  "przy":       { e: "at",          a: ["at","by","near","with"] },
  "dla":        { e: "for",         a: ["for"] },
  "od":         { e: "from",        a: ["from","since","than"] },
  "przez":      { e: "through",     a: ["through","by","across","for"] },
  "za":         { e: "behind",      a: ["behind","for","after","in"] },
  "przed":      { e: "before",      a: ["before","in front of","ago"] },
  "nad":        { e: "above",       a: ["above","over","by"] },
  "pod":        { e: "under",       a: ["under","below","beneath"] },
  "między":     { e: "between",     a: ["between","among"] },
  "bez":        { e: "without",     a: ["without"] },
  "pan":        { e: "mr",          a: ["mr","sir","mister","you"] },
  "pani":       { e: "mrs",         a: ["mrs","ms","miss","madam","you"] },
  "pan/pani":   { e: "mr/mrs",      a: ["mr","mrs","ms","sir","madam"] },
  "dobrze":     { e: "okay",        a: ["okay","ok","good","well","fine","alright"] },
  "bardzo":     { e: "very",        a: ["very","really","quite"] },
  "dziękuję":   { e: "thank you",   a: ["thank you","thanks","thank u"] },
  "przepraszam":{ e: "sorry",       a: ["sorry","excuse me","pardon","i'm sorry"] },
  "proszę":     { e: "please",      a: ["please","here you go","you're welcome"] },
  "tak":        { e: "yes",         a: ["yes","yeah","yep","so","thus"] },
  "cześć":      { e: "hi",          a: ["hi","hello","hey","bye"] },
  "do widzenia":{ e: "goodbye",     a: ["goodbye","bye","farewell"] },
  "dzień dobry":{ e: "good day",    a: ["good day","good morning","good afternoon"] },
};

async function translateBatch(texts) {
  const res = await fetch("https://api-free.deepl.com/v2/translate", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `DeepL-Auth-Key ${DEEPL_KEY}`
    },
    body: JSON.stringify({ text: texts, source_lang: "PL", target_lang: "EN-GB" })
  });
  if (!res.ok) throw new Error(`DeepL ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.translations.map(t => t.text.toLowerCase().trim());
}

function buildAccepted(english) {
  const set = new Set([english]);

  // Strip/add articles
  if (english.startsWith("the ")) set.add(english.slice(4));
  if (english.startsWith("a "))   set.add(english.slice(2));
  if (english.startsWith("an "))  set.add(english.slice(3));

  // Verb infinitive pairs
  if (english.startsWith("to "))  set.add(english.slice(3));
  else if (!english.includes(" ") && english.length > 3) set.add(`to ${english}`);

  // Contraction pairs
  const pairs = {
    "it is":"it's", "do not":"don't", "i am":"i'm", "you are":"you're",
    "is not":"isn't", "are not":"aren't", "does not":"doesn't",
    "it's":"it is", "don't":"do not", "i'm":"i am", "you're":"you are"
  };
  if (pairs[english]) set.add(pairs[english]);

  // yes/no variants
  if (english === "yes") { set.add("yeah"); set.add("yep"); }
  if (english === "no")  { set.add("nope"); set.add("nah"); }

  return [...set].filter(t => t.length > 0 && t.length < 50);
}

async function main() {
  if (!DEEPL_KEY) { console.error("Set DEEPL_KEY env var"); process.exit(1); }

  const lines = fs.readFileSync(INPUT, "utf-8").trim().split("\n").slice(0, LIMIT * 2);
  const words = lines
    .map(l => l.split(/\s+/)[0].trim().toLowerCase())
    .filter(w => w.length > 0)
    .slice(0, LIMIT);

  console.log(`\n🔤 Translating ${words.length} words for ${LEVEL.toUpperCase()}...\n`);

  // Split into function words (use hardcoded) vs content words (use DeepL)
  const needsDeepL  = words.filter(w => !FUNCTION_WORDS[w]);
  const fromHardcode = words
    .filter(w => FUNCTION_WORDS[w])
    .map(w => ({ polish: w, english: FUNCTION_WORDS[w].e, accepted: FUNCTION_WORDS[w].a }));

  console.log(`  📖 Hardcoded: ${fromHardcode.length} function words`);
  console.log(`  🌐 DeepL:     ${needsDeepL.length} content words\n`);

  // Translate content words in batches
  const BATCH = 50;
  const fromDeepL = [];
  for (let i = 0; i < needsDeepL.length; i += BATCH) {
    const chunk       = needsDeepL.slice(i, i + BATCH);
    const translated  = await translateBatch(chunk);
    chunk.forEach((polish, j) => {
      const english = translated[j].replace(/[.,;]$/, "").trim();
      fromDeepL.push({ polish, english, accepted: buildAccepted(english) });
    });
    process.stdout.write(`  Translated ${Math.min(i + BATCH, needsDeepL.length)}/${needsDeepL.length}\r`);
    if (i + BATCH < needsDeepL.length) await new Promise(r => setTimeout(r, 200));
  }

  // Reassemble in original word order
  const lookup = new Map([
    ...fromHardcode.map(r => [r.polish, r]),
    ...fromDeepL.map(r => [r.polish, r]),
  ]);

  const rows = words.map((w, i) => ({ ...lookup.get(w), rank: i + 1 }))
                    .filter(r => r.english);

  console.log(`\n✅ ${rows.length} words ready\n`);
  console.log("Sample:");
  rows.slice(0, 8).forEach(r =>
    console.log(`  ${r.polish.padEnd(14)} → "${r.english}" | ${JSON.stringify(r.accepted)}`)
  );

  const header = "polish,english,category,subtext,accepted_answers,frequency_rank";
  const csv = [header, ...rows.map(r => {
    const accepted = JSON.stringify(r.accepted).replace(/"/g, '""');
    return `${r.polish},${r.english},misc,,"${accepted}",${r.rank}`;
  })].join("\n");

  fs.writeFileSync(OUT_FILE, csv);
  console.log(`\n📄 Written to ${OUT_FILE}`);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });