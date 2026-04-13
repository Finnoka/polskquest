#!/usr/bin/env node
/**
 * seed_vocabulary.cjs — PolskQuest Supabase seeder
 *
 * Usage:
 *   node seed_vocabulary.cjs --file=<level>_translated.csv --level=<level>
 *
 * Options:
 *   --file=PATH    CSV produced by translate.cjs
 *   --level=LEVEL  a1 | a2 | b1 | b2 | c1
 *   --no-clear     Skip deleting existing rows (append mode)
 *   --batch=N      Rows per request — default 100 (keep low to avoid timeouts)
 *
 * Env vars (reads ANY of these names):
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY      ← your service-role key (despite the name)
 *   VITE_SUPABASE_SERVICE_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

const fs    = require("fs");
const https = require("https");

// ── Args ──────────────────────────────────────────────────────────────────────
const args = {};
for (const a of process.argv.slice(2)) {
  const [k, v] = a.replace(/^--/, "").split("=");
  args[k] = v ?? true;
}

const csvPath = args.file;
const level   = args.level?.toLowerCase();
const doClear = !args["no-clear"];
const BATCH   = parseInt(args.batch ?? "100", 10);
const WORDS_PER_STAGE = 50;

if (!csvPath || !level) {
  console.error("Usage: node seed_vocabulary.cjs --file=<csv> --level=<level>");
  process.exit(1);
}

// ── Env vars — accept any of the common names ─────────────────────────────────
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  =
  process.env.VITE_SUPABASE_ANON_KEY        ||
  process.env.VITE_SUPABASE_SERVICE_KEY      ||
  process.env.SUPABASE_SERVICE_KEY           ||
  process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL) { console.error("ERROR: VITE_SUPABASE_URL not set."); process.exit(1); }
if (!SERVICE_KEY)  { console.error("ERROR: VITE_SUPABASE_ANON_KEY not set."); process.exit(1); }

console.log(`Supabase: ${SUPABASE_URL}`);
console.log(`Key prefix: ${SERVICE_KEY.slice(0, 20)}…`);
console.log(`Level: ${level}  |  Batch: ${BATCH}  |  Clear: ${doClear}\n`);

// ── Supabase REST helper with timeout + retry ─────────────────────────────────
function supabaseRequest(method, urlPath, body, attempt = 1) {
  return new Promise((resolve, reject) => {
    const url     = new URL(SUPABASE_URL);
    const payload = body ? JSON.stringify(body) : null;

    const req = https.request({
      hostname: url.hostname,
      path:     `/rest/v1/${urlPath}`,
      method,
      headers: {
        "apikey":        SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type":  "application/json",
        "Prefer":        "return=minimal,resolution=merge-duplicates",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
      timeout: 30000,
    }, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : null);
        } else {
          const msg = `HTTP ${res.statusCode}: ${data}`;
          if (attempt < 3 && res.statusCode >= 500) {
            console.warn(`\n  Retry ${attempt + 1} after: ${msg}`);
            setTimeout(() => supabaseRequest(method, urlPath, body, attempt + 1).then(resolve, reject), 2000);
          } else {
            reject(new Error(msg));
          }
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      if (attempt < 3) {
        console.warn(`\n  Timeout — retry ${attempt + 1}…`);
        setTimeout(() => supabaseRequest(method, urlPath, body, attempt + 1).then(resolve, reject), 3000);
      } else {
        reject(new Error("Timed out after 3 attempts"));
      }
    });

    req.on("error", e => {
      if (attempt < 3) {
        console.warn(`\n  Network error (${e.message}) — retry ${attempt + 1}…`);
        setTimeout(() => supabaseRequest(method, urlPath, body, attempt + 1).then(resolve, reject), 2000);
      } else {
        reject(e);
      }
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function splitCSVLine(line) {
  const out = []; let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQuote && line[i+1] === '"') { cur += '"'; i++; } else inQuote = !inQuote; }
    else if (c === "," && !inQuote) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur); return out;
}

function parseCSV(text) {
  const lines = text.split("\n").filter(l => l.trim());
  const headers = splitCSVLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? "").trim()]));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const rows = parseCSV(fs.readFileSync(csvPath, "utf-8")).filter(r => r.polish && r.english);
  console.log(`Loaded ${rows.length} rows from ${csvPath}`);

  if (doClear) {
    process.stdout.write(`Deleting existing rows for cefr_level='${level}'… `);
    await supabaseRequest("DELETE", `vocabulary?cefr_level=eq.${level}`, null);
    console.log("✓ Cleared");
  }

  const insertRows = rows.map((r, idx) => {
    const rank       = parseInt(r.frequency_rank, 10) || (idx + 1);
    const stageNum   = Math.ceil(rank / WORDS_PER_STAGE);
    const stageId    = `s${stageNum}`;
    const posInStage = ((rank - 1) % WORDS_PER_STAGE) + 1;
    const id         = `${level}-${stageId}-${String(posInStage).padStart(3, "0")}`;
    let accepted = [];
    try { accepted = JSON.parse(r.accepted_answers || "[]"); } catch { accepted = [r.english.toLowerCase()]; }
    return { id, polish: r.polish, english: r.english, category: r.category || "misc",
             subtext: r.subtext || null, accepted_answers: accepted,
             cefr_level: level, stage_id: stageId, frequency_rank: rank };
  });

  const batches = [];
  for (let i = 0; i < insertRows.length; i += BATCH) batches.push(insertRows.slice(i, i + BATCH));

  console.log(`Inserting ${insertRows.length} rows in ${batches.length} batch(es) of ${BATCH}…`);
  let done = 0;
  for (let b = 0; b < batches.length; b++) {
    try {
      await supabaseRequest("POST", "vocabulary", batches[b]);
      done += batches[b].length;
      process.stdout.write(`\r  Batch ${b+1}/${batches.length} — ${done}/${insertRows.length} rows ✓   `);
    } catch (e) {
      console.error(`\n\nBatch ${b+1} FAILED: ${e.message}`);
      console.error(`First row in failed batch: ${JSON.stringify(batches[b][0], null, 2)}`);
      process.exit(1);
    }
    if (b < batches.length - 1) await sleep(150);
  }

  console.log(`\n\n✓ Done — ${done} words seeded for level="${level}"`);
  console.log(`  ${Math.ceil(rows.length / WORDS_PER_STAGE)} stages × ${WORDS_PER_STAGE} words`);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
