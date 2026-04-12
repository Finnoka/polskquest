#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════════════════════
 * POLSKQUEST — SUPABASE VOCABULARY SEEDER
 * Phase 10: Seeds the vocabulary table from Polish frequency lists
 *
 * USAGE:
 *   1. npm install @supabase/supabase-js csv-parse
 *   2. Set environment variables:
 *        SUPABASE_URL=https://your-project.supabase.co
 *        SUPABASE_SERVICE_KEY=your-service-role-key   (NOT the anon key!)
 *   3. Obtain a Polish frequency list CSV (see SOURCES below)
 *   4. Run: node seed_vocabulary.js --file=polish_frequency.csv --level=a1
 *
 * SOURCES FOR POLISH FREQUENCY LISTS:
 *   • https://github.com/hermitdave/FrequencyWords  (CC-BY)
 *       → Download pol_50k.txt  (word + frequency count, space-separated)
 *   • Wiktionary frequency lists (public domain)
 *   • SUBTLEX-PL corpus (academic, free for research)
 *
 * CSV FORMAT EXPECTED (auto-detected):
 *   Format A (hermitdave style): "word count"  — space separated, no header
 *   Format B (custom CSV):       polish,english,category,subtext,accepted_answers
 *
 * The script handles Format A automatically by leaving english="" and
 * flagging rows for manual translation. For a full auto-translated seed,
 *  use Format B which you can generate by running the words through a
 * translation API (DeepL, Google Translate, etc.) first.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { createClient } = require("@supabase/supabase-js");
const fs   = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

// ──────────────────────────────────────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL     = process.env.SUPABASE_URL     || "https://YOUR_PROJECT.supabase.co";
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || "YOUR_SERVICE_ROLE_KEY";

// CEFR level → word count targets
const CEFR_TARGETS = {
  a1:   700,
  a2:  2000,
  b1:  3000,
  b2:  5000,
  c1: 10000,
};

// Words per stage (game splits each dungeon into stages of this many words)
const WORDS_PER_STAGE = 50;

// Batch size for Supabase upserts (stay under 1000 to avoid timeouts)
const BATCH_SIZE = 200;

// ──────────────────────────────────────────────────────────────────────────────
// ARG PARSING
// ──────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(a => {
    const [k, v] = a.replace("--", "").split("=");
    args[k] = v ?? true;
  });
  return args;
}

// ──────────────────────────────────────────────────────────────────────────────
// CSV PARSING
// ──────────────────────────────────────────────────────────────────────────────
function parseCsvFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");

  // Detect format
  const firstLine = raw.split("\n")[0].trim();
  const isFormatA = !firstLine.includes(",") && firstLine.split(" ").length === 2;

  if (isFormatA) {
    // Format A: "word count" (hermitdave)
    console.log("📂 Detected Format A (frequency list — no translations)");
    return raw.trim().split("\n").map((line, i) => {
      const [polish, freq] = line.trim().split(/\s+/);
      return {
        polish:           polish ?? "",
        english:          "",                    // needs translation
        category:         "misc",
        subtext:          null,
        accepted_answers: [],
        frequency_rank:   parseInt(freq, 10) || (i + 1),
        needs_translation: true,
      };
    }).filter(r => r.polish.length > 0);
  }

  // Format B: custom CSV with headers
  console.log("📂 Detected Format B (translated CSV)");
  const records = parse(raw, { columns: true, skip_empty_lines: true, trim: true });
  return records.map((r, i) => ({
    polish:           r.polish ?? "",
    english:          r.english ?? "",
    category:         r.category ?? "misc",
    subtext:          r.subtext || null,
    accepted_answers: r.accepted_answers
      ? JSON.parse(r.accepted_answers)
      : [r.english?.toLowerCase()].filter(Boolean),
    frequency_rank:   parseInt(r.frequency_rank, 10) || (i + 1),
    needs_translation: false,
  })).filter(r => r.polish.length > 0);
}

// ──────────────────────────────────────────────────────────────────────────────
// STAGE ASSIGNMENT
//   Given a list of words sorted by frequency_rank, assign each one a
//   cefr_level and stage_id based on their position in the list.
// ──────────────────────────────────────────────────────────────────────────────
function assignStages(words, cefrLevel) {
  return words.map((word, i) => {
    const stageNum = Math.floor(i / WORDS_PER_STAGE) + 1;
    const stageId  = `s${stageNum}`;
    const wordNum  = (i % WORDS_PER_STAGE) + 1;
    const id       = `${cefrLevel}-${stageId}-${String(wordNum).padStart(3, "0")}`;

    return {
      id,
      cefr_level:       cefrLevel,
      stage_id:         stageId,
      polish:           word.polish,
      english:          word.english,
      subtext:          word.subtext,
      category:         word.category,
      accepted_answers: word.accepted_answers.length > 0
        ? word.accepted_answers
        : [word.english.toLowerCase()].filter(Boolean),
      frequency_rank:   word.frequency_rank,
      audio_url:        null,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// SUPABASE BATCH UPSERT
// ──────────────────────────────────────────────────────────────────────────────
async function upsertBatch(supabase, rows, dryRun = false) {
  if (dryRun) {
    console.log(`  [DRY RUN] Would upsert ${rows.length} rows`);
    console.log("  Sample:", JSON.stringify(rows[0], null, 2));
    return;
  }

  const { error } = await supabase
    .from("vocabulary")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("  ✗ Upsert error:", error.message);
    throw error;
  }
  console.log(`  ✓ Upserted ${rows.length} rows`);
}

// ──────────────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  const filePath  = args.file;
  const cefrLevel = (args.level ?? "a1").toLowerCase();
  const dryRun    = args["dry-run"] === true || args["dry-run"] === "true";
  const limit     = parseInt(args.limit, 10) || CEFR_TARGETS[cefrLevel] || 700;

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║          POLSKQUEST — VOCABULARY SEEDER v1.0                ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  if (!filePath) {
    console.error("ERROR: --file argument required");
    console.error("Usage: node seed_vocabulary.js --file=polish_freq.csv --level=a1 [--dry-run]");
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: File not found: ${filePath}`);
    process.exit(1);
  }

  if (!CEFR_TARGETS[cefrLevel]) {
    console.error(`ERROR: Unknown CEFR level: ${cefrLevel}. Use: ${Object.keys(CEFR_TARGETS).join(", ")}`);
    process.exit(1);
  }

  console.log(`📋 Config:`);
  console.log(`   File:       ${filePath}`);
  console.log(`   CEFR Level: ${cefrLevel.toUpperCase()}`);
  console.log(`   Word limit: ${limit}`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Dry run:    ${dryRun ? "YES — no data will be written" : "NO — writing to Supabase"}\n`);

  // Parse CSV
  console.log("1️⃣  Parsing CSV…");
  let words = parseCsvFile(filePath);
  const needsTranslation = words.filter(w => w.needs_translation).length;
  if (needsTranslation > 0) {
    console.warn(`⚠  ${needsTranslation} words have no English translation.`);
    console.warn("   Run a translation pass first, or provide a Format B CSV.");
    console.warn("   Words without translations will be inserted with english='' and skipped in-game.\n");
  }

  // Sort by frequency rank and limit
  words = words
    .sort((a, b) => a.frequency_rank - b.frequency_rank)
    .slice(0, limit);
  console.log(`   Parsed ${words.length} words (limited to ${limit})\n`);

  // Assign stage IDs
  console.log("2️⃣  Assigning stages…");
  const rows = assignStages(words, cefrLevel);
  const stageCount = new Set(rows.map(r => r.stage_id)).size;
  console.log(`   ${rows.length} words assigned to ${stageCount} stages (${WORDS_PER_STAGE} words/stage)\n`);

  // Preview
  console.log("3️⃣  Sample rows:");
  console.log("   " + JSON.stringify(rows[0]));
  if (rows.length > 1) console.log("   " + JSON.stringify(rows[rows.length - 1]));
  console.log();

  if (dryRun) {
    console.log("🔎 DRY RUN complete. No data written.\n");
    return;
  }

  // Connect to Supabase
  console.log("4️⃣  Connecting to Supabase…");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE, {
    auth: { persistSession: false }
  });
  console.log("   Connected.\n");

  // Upsert in batches
  console.log("5️⃣  Upserting to Supabase…");
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    process.stdout.write(`   Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(rows.length/BATCH_SIZE)} `);
    await upsertBatch(supabase, batch, dryRun);
    inserted += batch.length;
  }

  console.log(`\n✅ Done! ${inserted} words seeded into Supabase.`);
  console.log(`   CEFR level ${cefrLevel.toUpperCase()}: ${stageCount} stages × ~${WORDS_PER_STAGE} words/stage\n`);

  // Verification query
  console.log("6️⃣  Verifying…");
  const { count, error } = await supabase
    .from("vocabulary")
    .select("*", { count: "exact", head: true })
    .eq("cefr_level", cefrLevel);

  if (error) {
    console.warn("   ⚠ Could not verify:", error.message);
  } else {
    console.log(`   ✓ ${count} rows confirmed in vocabulary table for ${cefrLevel.toUpperCase()}\n`);
  }
}

main().catch(e => {
  console.error("\n✗ Fatal error:", e.message);
  process.exit(1);
});
