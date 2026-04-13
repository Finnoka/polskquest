#!/usr/bin/env node
/**
 * translate.cjs — PolskQuest vocabulary translator
 *
 * Usage:
 *   node translate.cjs <wordlist.txt> <level> <count> [--offset=N]
 *
 * Recommended invocation (non-overlapping slices):
 *   node translate.cjs pl_50k.txt a1   700  --offset=0
 *   node translate.cjs pl_50k.txt a2  2000  --offset=700
 *   node translate.cjs pl_50k.txt b1  3000  --offset=2700
 *   node translate.cjs pl_50k.txt b2  5000  --offset=5700
 *   node translate.cjs pl_50k.txt c1 10000  --offset=10700
 *
 * Env vars:
 *   DEEPL_API_KEY   your DeepL key (ends in :fx for free tier)
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
const offset = (() => { const f = flags.find(f => f.startsWith("--offset=")); return f ? parseInt(f.split("=")[1], 10) : 0; })();

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
if (!DEEPL_API_KEY) { console.error("ERROR: Set DEEPL_API_KEY environment variable before running."); process.exit(1); }

const BATCH_SIZE = 50;
const DELAY_MS   = 350;
const OUT_FILE   = `${level}_translated.csv`;

// ── Load word list — strip trailing frequency counts ─────────────────────────
// Lines in pl_50k.txt are either:
//   "ukrywasz 2304"   (word + space + count)   ← strip the number
//   "ukrywasz"        (word only)               ← keep as-is
const allLines = fs.readFileSync(wordlistPath, "utf-8")
  .split("\n")
  .map(l => l.trim())
  .filter(Boolean)
  .map(l => l.replace(/\s+\d+$/, "").trim());   // ← strip trailing number

const slice = allLines.slice(offset, offset + count);
if (slice.length === 0) {
  console.error(`ERROR: No words at offset ${offset} (file has ${allLines.length} lines).`);
  process.exit(1);
}

// Deduplicate — some word lists repeat entries after stripping counts
const seen = new Set();
const deduped = slice.filter(w => { if (seen.has(w)) return false; seen.add(w); return true; });
if (deduped.length < slice.length)
  console.log(`  (${slice.length - deduped.length} duplicates removed after stripping counts)`);

console.log(`Translating ${deduped.length} words for level="${level}" (offset=${offset})`);

// ── Known multi-answer table for ultra-common function words ─────────────────
// DeepL returns only one translation for short function words.
// This table gives them proper accepted_answers sets.
const KNOWN_ANSWERS = {
  "nie":   { english:"no",       accepted:["no","not","nope","nah"],                         cat:"core" },
  "to":    { english:"this",     accepted:["this","it","that","this is"],                    cat:"core" },
  "się":   { english:"oneself",  accepted:["oneself","self","himself","herself","itself","themselves","yourself"], cat:"core" },
  "w":     { english:"in",       accepted:["in","at","into","within","inside"],              cat:"preposition" },
  "na":    { english:"on",       accepted:["on","at","onto","for","upon"],                   cat:"preposition" },
  "i":     { english:"and",      accepted:["and"],                                           cat:"conjunction" },
  "z":     { english:"with",     accepted:["with","from","out of","of"],                     cat:"preposition" },
  "że":    { english:"that",     accepted:["that","so that"],                                cat:"conjunction" },
  "do":    { english:"to",       accepted:["to","into","until","up to"],                     cat:"preposition" },
  "o":     { english:"about",    accepted:["about","of","at","for","around"],                cat:"preposition" },
  "jak":   { english:"how",      accepted:["how","like","as","what"],                        cat:"adverb" },
  "co":    { english:"what",     accepted:["what","which","that"],                           cat:"pronoun" },
  "a":     { english:"and",      accepted:["and","but","while","whereas"],                   cat:"conjunction" },
  "ale":   { english:"but",      accepted:["but","however","yet"],                           cat:"conjunction" },
  "już":   { english:"already",  accepted:["already","now","yet","anymore"],                 cat:"adverb" },
  "ten":   { english:"this",     accepted:["this","that","the"],                             cat:"pronoun" },
  "ta":    { english:"this",     accepted:["this","that","the"],                             cat:"pronoun" },
  "to":    { english:"this",     accepted:["this","it","that"],                              cat:"pronoun" },
  "po":    { english:"after",    accepted:["after","along","for","in","by","per"],           cat:"preposition" },
  "przez": { english:"through",  accepted:["through","across","by","via","for","because of"],cat:"preposition" },
  "przy":  { english:"near",     accepted:["near","by","at","with","next to"],               cat:"preposition" },
  "za":    { english:"behind",   accepted:["behind","after","for","in","beyond","past"],     cat:"preposition" },
  "od":    { english:"from",     accepted:["from","since","of","away from"],                 cat:"preposition" },
  "bez":   { english:"without",  accepted:["without"],                                       cat:"preposition" },
  "nad":   { english:"above",    accepted:["above","over","by","at"],                        cat:"preposition" },
  "pod":   { english:"under",    accepted:["under","below","beneath","near"],                cat:"preposition" },
  "czy":   { english:"whether",  accepted:["whether","if","or","do","does","is","are"],      cat:"conjunction" },
  "tak":   { english:"yes",      accepted:["yes","yeah","yep","so","thus"],                  cat:"core" },
  "tu":    { english:"here",     accepted:["here"],                                          cat:"adverb" },
  "tam":   { english:"there",    accepted:["there"],                                         cat:"adverb" },
  "mi":    { english:"me",       accepted:["me","to me","for me"],                           cat:"pronoun" },
  "mu":    { english:"him",      accepted:["him","to him","for him"],                        cat:"pronoun" },
  "go":    { english:"him",      accepted:["him","it","his"],                                cat:"pronoun" },
  "jej":   { english:"her",      accepted:["her","hers","its"],                              cat:"pronoun" },
  "ich":   { english:"their",    accepted:["their","theirs","them"],                         cat:"pronoun" },
  "być":   { english:"to be",    accepted:["to be","be"],                                    cat:"verb" },
  "mieć":  { english:"to have",  accepted:["to have","have"],                                cat:"verb" },
  "jest":  { english:"is",       accepted:["is","it is","there is"],                         cat:"verb" },
  "są":    { english:"are",      accepted:["are","they are","there are"],                    cat:"verb" },
  "był":   { english:"was",      accepted:["was","had been"],                                cat:"verb" },
  "była":  { english:"was",      accepted:["was","had been"],                                cat:"verb" },
  "było":  { english:"was",      accepted:["was","had been","it was"],                       cat:"verb" },
  "może":  { english:"maybe",    accepted:["maybe","perhaps","possibly","can","could","may"],cat:"adverb" },
  "tylko": { english:"only",     accepted:["only","just","solely"],                          cat:"adverb" },
  "jeszcze":{ english:"still",   accepted:["still","yet","even","more","another"],           cat:"adverb" },
  "też":   { english:"also",     accepted:["also","too","as well"],                          cat:"adverb" },
  "też":   { english:"also",     accepted:["also","too","as well"],                          cat:"adverb" },
  "więc":  { english:"so",       accepted:["so","therefore","thus","hence"],                 cat:"conjunction" },
  "bo":    { english:"because",  accepted:["because","for","since","as"],                    cat:"conjunction" },
  "kiedy": { english:"when",     accepted:["when","while","as","whenever"],                  cat:"adverb" },
  "gdzie": { english:"where",    accepted:["where","wherever"],                              cat:"adverb" },
  "który": { english:"which",    accepted:["which","who","that"],                            cat:"pronoun" },
  "która": { english:"which",    accepted:["which","who","that"],                            cat:"pronoun" },
  "które": { english:"which",    accepted:["which","who","that"],                            cat:"pronoun" },
  "pan":   { english:"sir",      accepted:["sir","mr","you","gentleman"],                    cat:"noun" },
  "pani":  { english:"ma'am",    accepted:["ma'am","mrs","ms","miss","you","lady"],          cat:"noun" },
  "bardzo": { english:"very",    accepted:["very","much","greatly","a lot"],                 cat:"adverb" },
  "dobrze": { english:"well",    accepted:["well","good","okay","ok","alright","fine"],      cat:"adverb" },
};

// ── DeepL helper — header-based auth ─────────────────────────────────────────
function deeplTranslate(texts) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ text: texts, target_lang: "EN", source_lang: "PL" });
    const host = DEEPL_API_KEY.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";
    const req = https.request(
      { hostname: host, path: "/v2/translate", method: "POST",
        headers: {
          "Authorization":  "DeepL-Auth-Key " + DEEPL_API_KEY,
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(payload),
        }
      },
      res => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.translations) resolve(json.translations.map(t => t.text));
            else reject(new Error(JSON.stringify(json)));
          } catch(e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Category heuristic ────────────────────────────────────────────────────────
function guessCategory(polish) {
  if (/ować$|ić$|yć$|ąć$|eć$|nąć$/.test(polish)) return "verb";
  if (/ość$|anie$|enie$|cie$|stwo$|nia$/.test(polish)) return "noun";
  if (/ny$|na$|ne$|wy$|wa$|we$|ski$|ska$|skie$|owy$|owa$|owe$/.test(polish)) return "adjective";
  if (/nie$|rze$|wie$|owo$|alnie$/.test(polish)) return "adverb";
  return "misc";
}

// ── Build accepted_answers from a DeepL translation ───────────────────────────
// Generates multiple natural variants from a single translation string.
function buildAccepted(english) {
  const base = english.toLowerCase().trim();
  if (!base) return JSON.stringify([]);
  const variants = new Set([base]);

  // Strip "to " prefix for infinitives  →  "to run" → "run"
  if (base.startsWith("to ")) variants.add(base.slice(3));

  // Strip articles  →  "a dog" → "dog",  "the car" → "car"
  const noArticle = base.replace(/^(a|an|the) /, "");
  if (noArticle !== base) variants.add(noArticle);

  // Also strip article then "to "
  if (noArticle.startsWith("to ")) variants.add(noArticle.slice(3));

  // If it's a phrase like "I am" also add "am", "to be" style variants
  // Slash-separated alternatives like "good / okay" → split them
  if (base.includes("/")) {
    for (const part of base.split("/")) {
      const p = part.trim();
      if (p) { variants.add(p); if (p.startsWith("to ")) variants.add(p.slice(3)); }
    }
  }

  // Comma-separated alternatives like "happy, glad" → split them
  if (base.includes(",")) {
    for (const part of base.split(",")) {
      const p = part.trim();
      if (p) variants.add(p);
    }
  }

  return JSON.stringify([...variants].filter(Boolean));
}

// ── CSV escape ────────────────────────────────────────────────────────────────
function csvCell(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const rows    = [];
  const batches = [];
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) batches.push(deduped.slice(i, i + BATCH_SIZE));

  let done = 0;
  for (const batch of batches) {
    // Separate words we already know vs words that need DeepL
    const needsDeepL = batch.filter(w => !KNOWN_ANSWERS[w.toLowerCase()]);
    const deepLWords = [...new Set(needsDeepL)]; // unique within batch

    let translationMap = {};
    if (deepLWords.length > 0) {
      try {
        const results = await deeplTranslate(deepLWords);
        deepLWords.forEach((w, i) => { translationMap[w] = results[i] ?? ""; });
      } catch(e) {
        console.error(`\nDeepL error on batch starting at word ${done+1}:`, e.message);
        deepLWords.forEach(w => { translationMap[w] = ""; });
      }
    }

    for (let j = 0; j < batch.length; j++) {
      const polish = batch[j];
      const key    = polish.toLowerCase();
      const rank   = done + j + 1;

      if (KNOWN_ANSWERS[key]) {
        const k = KNOWN_ANSWERS[key];
        rows.push([polish, k.english, k.cat, "", JSON.stringify(k.accepted), rank]);
      } else {
        const english  = translationMap[polish] ?? "";
        const cat      = guessCategory(polish);
        const accepted = buildAccepted(english);
        rows.push([polish, english, cat, "", accepted, rank]);
      }
    }

    done += batch.length;
    process.stdout.write(`\r  ${done}/${deduped.length} words translated…`);
    if (done < deduped.length) await sleep(DELAY_MS);
  }

  console.log(`\nWriting ${OUT_FILE}…`);
  const header = "polish,english,category,subtext,accepted_answers,frequency_rank";
  const lines  = rows.map(r => r.map(csvCell).join(","));
  fs.writeFileSync(OUT_FILE, [header, ...lines].join("\n") + "\n", "utf-8");
  console.log(`✓ Done — ${rows.length} words written to ${OUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
