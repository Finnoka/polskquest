#!/usr/bin/env node
/**
 * translate.cjs — PolskQuest vocabulary translator with contextual examples
 *
 * For each Polish word this script produces:
 *   polish          — the word itself
 *   english         — primary English translation
 *   category        — guessed POS (verb/noun/adj/adverb/misc)
 *   example_pl      — a short Polish example sentence using the word
 *   example_en      — DeepL English translation of that sentence
 *   accepted_answers— JSON array of valid English answers (synonyms + variants)
 *   frequency_rank  — 1-based position within this level
 *
 * Usage:
 *   node translate.cjs <wordlist.txt> <level> <count> [--offset=N]
 *
 * Recommended (non-overlapping):
 *   node translate.cjs pl_50k.txt a1   700 --offset=0
 *   node translate.cjs pl_50k.txt a2  1300 --offset=700
 *   node translate.cjs pl_50k.txt b1  1000 --offset=2000
 *   node translate.cjs pl_50k.txt b2  2000 --offset=3000
 *   node translate.cjs pl_50k.txt c1  5000 --offset=5000
 *
 * Env vars:
 *   DEEPL_API_KEY   (ends in :fx for free tier)
 *
 * DeepL call strategy:
 *   Pass 1: translate words in batches of 40 → english + accepted variants
 *   Pass 2: translate example sentences in batches of 20 → example_en
 *   This keeps each request well under DeepL's limits.
 */

const fs    = require("fs");
const https = require("https");

// ── Args ──────────────────────────────────────────────────────────────────────
const [,, wordlistPath, level, countStr, ...flags] = process.argv;
if (!wordlistPath || !level || !countStr) {
  console.error("Usage: node translate.cjs <wordlist.txt> <level> <count> [--offset=N]");
  process.exit(1);
}
const count  = parseInt(countStr, 10);
const offset = (() => {
  const f = flags.find(f => f.startsWith("--offset="));
  return f ? parseInt(f.split("=")[1], 10) : 0;
})();

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
if (!DEEPL_API_KEY) {
  console.error("ERROR: Set DEEPL_API_KEY before running.");
  process.exit(1);
}

const WORD_BATCH   = 40;   // words per DeepL call (pass 1)
const SENT_BATCH   = 20;   // sentences per DeepL call (pass 2)
const DELAY_MS     = 400;  // polite delay between API calls
const OUT_FILE     = `${level}_translated.csv`;

// ── Load & clean word list ─────────────────────────────────────────────────────
const allLines = fs.readFileSync(wordlistPath, "utf-8")
  .split("\n")
  .map(l => l.trim())
  .filter(Boolean)
  .map(l => l.replace(/\s+\d+$/, "").trim());

const slice = allLines.slice(offset, offset + count);
if (!slice.length) {
  console.error(`No words at offset ${offset} (file has ${allLines.length} lines).`);
  process.exit(1);
}

const seen = new Set();
const words = slice.filter(w => { if (seen.has(w)) return false; seen.add(w); return true; });

console.log(`\nPolskQuest translate — level="${level}", offset=${offset}, words=${words.length}`);

// ── Known-answers table (function words DeepL gets wrong in isolation) ────────
// These words are highly context-dependent; we hard-code safe translations
// and still generate example sentences for them using the sentence templates.
const KNOWN = {
  "nie":    { english:"no",       accepted:["no","not","nope","nah"],                                  cat:"core" },
  "to":     { english:"this",     accepted:["this","it","that"],                                       cat:"core" },
  "się":    { english:"oneself",  accepted:["oneself","self","himself","herself","itself","yourself","themselves"], cat:"core" },
  "w":      { english:"in",       accepted:["in","at","into","within","inside"],                       cat:"preposition" },
  "na":     { english:"on",       accepted:["on","at","onto","for","upon"],                            cat:"preposition" },
  "i":      { english:"and",      accepted:["and"],                                                    cat:"conjunction" },
  "z":      { english:"with",     accepted:["with","from","out of","of"],                              cat:"preposition" },
  "że":     { english:"that",     accepted:["that","so that"],                                         cat:"conjunction" },
  "do":     { english:"to",       accepted:["to","into","until","up to"],                              cat:"preposition" },
  "o":      { english:"about",    accepted:["about","of","at","for","around"],                         cat:"preposition" },
  "jak":    { english:"how",      accepted:["how","like","as","what"],                                 cat:"adverb" },
  "co":     { english:"what",     accepted:["what","which","that"],                                    cat:"pronoun" },
  "a":      { english:"and",      accepted:["and","but","while","whereas"],                            cat:"conjunction" },
  "ale":    { english:"but",      accepted:["but","however","yet"],                                    cat:"conjunction" },
  "już":    { english:"already",  accepted:["already","now","yet","anymore"],                          cat:"adverb" },
  "ten":    { english:"this",     accepted:["this","that","the"],                                      cat:"pronoun" },
  "ta":     { english:"this",     accepted:["this","that","the"],                                      cat:"pronoun" },
  "po":     { english:"after",    accepted:["after","along","for","in","by","per"],                    cat:"preposition" },
  "przez":  { english:"through",  accepted:["through","across","by","via","for","because of"],         cat:"preposition" },
  "przy":   { english:"near",     accepted:["near","by","at","with","next to"],                        cat:"preposition" },
  "za":     { english:"behind",   accepted:["behind","after","for","in","beyond","past"],              cat:"preposition" },
  "od":     { english:"from",     accepted:["from","since","of","away from"],                          cat:"preposition" },
  "bez":    { english:"without",  accepted:["without"],                                                cat:"preposition" },
  "nad":    { english:"above",    accepted:["above","over","by","at"],                                 cat:"preposition" },
  "pod":    { english:"under",    accepted:["under","below","beneath","near"],                         cat:"preposition" },
  "czy":    { english:"whether",  accepted:["whether","if","or","do","does","is","are"],               cat:"conjunction" },
  "tak":    { english:"yes",      accepted:["yes","yeah","yep","so","thus"],                           cat:"core" },
  "tu":     { english:"here",     accepted:["here","right here"],                                     cat:"adverb" },
  "tutaj":  { english:"here",     accepted:["here","right here","over here"],                          cat:"adverb" },
  "tam":    { english:"there",    accepted:["there","over there"],                                     cat:"adverb" },
  "mi":     { english:"me",       accepted:["me","to me","for me"],                                    cat:"pronoun" },
  "mnie":   { english:"me",       accepted:["me","myself"],                                            cat:"pronoun" },
  "mu":     { english:"him",      accepted:["him","to him","for him"],                                 cat:"pronoun" },
  "go":     { english:"him",      accepted:["him","it","his"],                                         cat:"pronoun" },
  "jego":   { english:"his",      accepted:["his","him","its"],                                        cat:"pronoun" },
  "jej":    { english:"her",      accepted:["her","hers","its"],                                       cat:"pronoun" },
  "ich":    { english:"their",    accepted:["their","theirs","them"],                                  cat:"pronoun" },
  "być":    { english:"to be",    accepted:["to be","be"],                                             cat:"verb" },
  "mieć":   { english:"to have",  accepted:["to have","have"],                                         cat:"verb" },
  "jest":   { english:"is",       accepted:["is","it is","there is"],                                  cat:"verb" },
  "są":     { english:"are",      accepted:["are","they are","there are"],                             cat:"verb" },
  "był":    { english:"was",      accepted:["was","had been","were"],                                   cat:"verb" },
  "była":   { english:"was",      accepted:["was","had been","were"],                                   cat:"verb" },
  "było":   { english:"was",      accepted:["was","had been","it was"],                                cat:"verb" },
  "może":   { english:"maybe",    accepted:["maybe","perhaps","possibly","can","could","may"],          cat:"adverb" },
  "tylko":  { english:"only",     accepted:["only","just","solely"],                                   cat:"adverb" },
  "jeszcze":{ english:"still",    accepted:["still","yet","even","more","another"],                    cat:"adverb" },
  "też":    { english:"also",     accepted:["also","too","as well"],                                   cat:"adverb" },
  "więc":   { english:"so",       accepted:["so","therefore","thus","hence"],                          cat:"conjunction" },
  "bo":     { english:"because",  accepted:["because","for","since","as"],                             cat:"conjunction" },
  "kiedy":  { english:"when",     accepted:["when","while","as","whenever"],                           cat:"adverb" },
  "gdzie":  { english:"where",    accepted:["where","wherever"],                                       cat:"adverb" },
  "który":  { english:"which",    accepted:["which","who","that"],                                     cat:"pronoun" },
  "która":  { english:"which",    accepted:["which","who","that"],                                     cat:"pronoun" },
  "które":  { english:"which",    accepted:["which","who","that"],                                     cat:"pronoun" },
  "pan":    { english:"sir",      accepted:["sir","mr","you","gentleman"],                             cat:"noun" },
  "pani":   { english:"ma'am",    accepted:["ma'am","mrs","ms","miss","you","lady"],                   cat:"noun" },
  "bardzo": { english:"very",     accepted:["very","much","greatly","a lot"],                          cat:"adverb" },
  "dobrze": { english:"well",     accepted:["well","good","okay","ok","alright","fine"],               cat:"adverb" },
  "teraz":  { english:"now",      accepted:["now","right now","at the moment"],                        cat:"adverb" },
  "potem":  { english:"then",     accepted:["then","after that","afterwards","later"],                 cat:"adverb" },
  "zawsze": { english:"always",   accepted:["always","every time"],                                    cat:"adverb" },
  "nigdy":  { english:"never",    accepted:["never","not ever"],                                       cat:"adverb" },
  "może":   { english:"maybe",    accepted:["maybe","perhaps","possibly","can","may"],                 cat:"adverb" },
  "trochę": { english:"a little", accepted:["a little","a bit","somewhat","slightly"],                 cat:"adverb" },
  "dużo":   { english:"a lot",    accepted:["a lot","much","many","lots","plenty"],                    cat:"adverb" },
  "mało":   { english:"little",   accepted:["little","few","not much","not many"],                    cat:"adverb" },
  "coś":    { english:"something",accepted:["something","anything"],                                  cat:"pronoun" },
  "nic":    { english:"nothing",  accepted:["nothing","not anything"],                                 cat:"pronoun" },
  "ktoś":   { english:"someone",  accepted:["someone","somebody","anyone"],                            cat:"pronoun" },
  "nikt":   { english:"nobody",   accepted:["nobody","no one","none"],                                 cat:"pronoun" },
  "wszystko":{ english:"everything",accepted:["everything","all","it all"],                            cat:"pronoun" },
  "każdy":  { english:"every",    accepted:["every","each","everyone","everybody","each one"],         cat:"pronoun" },
  "żaden":  { english:"none",     accepted:["none","no","neither","not any"],                         cat:"pronoun" },
  "mój":    { english:"my",       accepted:["my","mine"],                                              cat:"pronoun" },
  "twój":   { english:"your",     accepted:["your","yours"],                                           cat:"pronoun" },
  "jego":   { english:"his",      accepted:["his","its","him"],                                        cat:"pronoun" },
  "nasz":   { english:"our",      accepted:["our","ours"],                                             cat:"pronoun" },
  "wasz":   { english:"your",     accepted:["your","yours"],                                           cat:"pronoun" },
  "ich":    { english:"their",    accepted:["their","theirs","them"],                                  cat:"pronoun" },
  "tu":     { english:"here",     accepted:["here","right here"],                                     cat:"adverb" },
};

// ── POS-aware example sentence templates ──────────────────────────────────────
// Templates produce a short natural Polish sentence using the word.
// The sentence is then sent to DeepL to get an accurate English translation.
// We use different templates per word-class to maximise contextual accuracy.
//
// {W} = the Polish word being taught
// Templates are short (≤8 words) so DeepL uses them accurately.

const TEMPLATES = {
  verb:        w => `Lubię ${w}.`,                      // "I like to [verb]"
  verb_alt:    w => `Muszę ${w} dzisiaj.`,              // "I must [verb] today"
  noun:        w => `To jest ${w}.`,                    // "This is a [noun]"
  noun_alt:    w => `Widzę ${w} tutaj.`,                // "I see a [noun] here"
  adjective:   w => `To jest bardzo ${w}.`,             // "This is very [adj]"
  adverb:      w => `Mówię ${w} po polsku.`,            // "I speak Polish [adv]"
  preposition: w => `Idę ${w} domu.`,                   // "I go [prep] home" (do/od/etc)
  conjunction: w => `Chcę herbaty, ${w} nie kawy.`,     // "I want tea, [conj] not coffee"
  pronoun:     w => `Daj ${w} książkę.`,                // "Give [pron] a book"
  core:        w => `Rozumiem. ${w}.`,                  // "I understand. [yes/no]"
  misc:        w => `Słowo: ${w}.`,                     // fallback: "Word: [word]"
};

// Map guessCategory result to template key
const CAT_TO_TEMPLATE = {
  verb: "verb", noun: "noun", adjective: "adjective",
  adverb: "adverb", preposition: "preposition",
  conjunction: "conjunction", pronoun: "pronoun",
  core: "core", misc: "misc",
};

function guessCategory(polish) {
  if (/ować$|ić$|yć$|ąć$|eć$|nąć$|[aeo]ć$/.test(polish)) return "verb";
  if (/ość$|anie$|enie$|cie$|stwo$|[aei]nia$|ek$|ka$|ko$/.test(polish)) return "noun";
  if (/ny$|na$|ne$|wy$|wa$|we$|ski$|ska$|skie$|owy$|owa$|owe$|liwy$|liwa$|liwe$/.test(polish)) return "adjective";
  if (/nie$|wie$|owo$|alnie$|rze$/.test(polish)) return "adverb";
  return "misc";
}

function makeSentence(polish, cat) {
  const k = KNOWN[polish.toLowerCase()];
  const effectiveCat = k?.cat ?? cat;
  const tkey = CAT_TO_TEMPLATE[effectiveCat] ?? "misc";
  // Alternate template for verbs/nouns to give variety
  const useAlt = Math.random() > 0.6;
  if (useAlt && tkey === "verb"  && TEMPLATES.verb_alt)  return TEMPLATES.verb_alt(polish);
  if (useAlt && tkey === "noun"  && TEMPLATES.noun_alt)  return TEMPLATES.noun_alt(polish);
  return TEMPLATES[tkey](polish);
}

// ── Build accepted_answers array from a raw DeepL english string ──────────────
function buildAccepted(english, extra = []) {
  const base = (english ?? "").toLowerCase().trim();
  if (!base) return JSON.stringify(extra.length ? extra : []);
  const v = new Set([base, ...extra.map(s => s.toLowerCase())]);
  if (base.startsWith("to "))           v.add(base.slice(3));
  const noArt = base.replace(/^(a|an|the) /, "");
  if (noArt !== base)                   v.add(noArt);
  if (noArt.startsWith("to "))          v.add(noArt.slice(3));
  for (const sep of ["/", ","]) {
    if (base.includes(sep)) {
      for (const p of base.split(sep)) {
        const t = p.trim();
        if (t) { v.add(t); if (t.startsWith("to ")) v.add(t.slice(3)); }
      }
    }
  }
  return JSON.stringify([...v].filter(Boolean));
}

// ── CSV helpers ───────────────────────────────────────────────────────────────
function csvCell(val) {
  if (val == null) return "";
  const s = String(val);
  return (s.includes(",") || s.includes('"') || s.includes("\n"))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── DeepL API call ────────────────────────────────────────────────────────────
function deepl(texts, sourceLang = "PL") {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ text: texts, target_lang: "EN", source_lang: sourceLang });
    const host = DEEPL_API_KEY.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
    const req  = https.request(
      { hostname: host, path: "/v2/translate", method: "POST",
        headers: { "Authorization": "DeepL-Auth-Key " + DEEPL_API_KEY,
                   "Content-Type": "application/json",
                   "Content-Length": Buffer.byteLength(payload) } },
      res => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            if (j.translations) resolve(j.translations.map(t => t.text));
            else reject(new Error(JSON.stringify(j)));
          } catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // ── Step 1: Word translation (pass 1) ────────────────────────────────────────
  console.log(`\n[1/2] Translating ${words.length} words…`);
  const wordData = new Array(words.length);  // { english, accepted, cat }

  // Words in KNOWN table — resolve immediately, no API call needed
  const needsApi = [];
  for (let i = 0; i < words.length; i++) {
    const w   = words[i];
    const key = w.toLowerCase();
    if (KNOWN[key]) {
      const k = KNOWN[key];
      wordData[i] = { english: k.english, accepted: JSON.stringify(k.accepted), cat: k.cat };
    } else {
      needsApi.push({ i, w });
    }
  }

  let apiDone = 0;
  for (const batch of chunks(needsApi, WORD_BATCH)) {
    const texts = batch.map(x => x.w);
    let results;
    try {
      results = await deepl(texts);
    } catch (e) {
      console.error(`\n  Word translation error: ${e.message} — using empty strings`);
      results = texts.map(() => "");
    }
    for (let j = 0; j < batch.length; j++) {
      const { i, w } = batch[j];
      const english  = results[j] ?? "";
      const cat      = guessCategory(w);
      wordData[i] = { english, accepted: buildAccepted(english), cat };
    }
    apiDone += batch.length;
    process.stdout.write(`\r  ${apiDone + (words.length - needsApi.length)}/${words.length} words`);
    if (apiDone < needsApi.length) await sleep(DELAY_MS);
  }
  console.log(" ✓");

  // ── Step 2: Example sentence translation (pass 2) ────────────────────────────
  console.log(`\n[2/2] Generating & translating ${words.length} example sentences…`);
  const examples = new Array(words.length);  // { pl, en }

  // Build all Polish sentences first (local, instant)
  const sentences = words.map((w, i) => makeSentence(w, wordData[i]?.cat ?? "misc"));

  let sentDone = 0;
  for (const batch of chunks(
    words.map((_, i) => i),  // indices
    SENT_BATCH
  )) {
    const texts = batch.map(i => sentences[i]);
    let results;
    try {
      results = await deepl(texts);
    } catch (e) {
      console.error(`\n  Sentence translation error: ${e.message}`);
      results = texts.map(() => "");
    }
    for (let j = 0; j < batch.length; j++) {
      const i = batch[j];
      examples[i] = { pl: sentences[i], en: results[j] ?? "" };
    }
    sentDone += batch.length;
    process.stdout.write(`\r  ${sentDone}/${words.length} sentences`);
    if (sentDone < words.length) await sleep(DELAY_MS);
  }
  console.log(" ✓");

  // ── Write CSV ─────────────────────────────────────────────────────────────────
  const header = "polish,english,category,example_pl,example_en,accepted_answers,frequency_rank";
  const lines  = words.map((w, i) => {
    const d = wordData[i];
    const e = examples[i];
    return [
      w,
      d.english,
      d.cat,
      e.pl,
      e.en,
      d.accepted,
      i + 1,
    ].map(csvCell).join(",");
  });

  fs.writeFileSync(OUT_FILE, [header, ...lines].join("\n") + "\n", "utf-8");
  console.log(`\n✓ Written ${words.length} words → ${OUT_FILE}`);
  console.log(`\nNext: node seed_vocabulary.cjs --file=${OUT_FILE} --level=${level}`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
