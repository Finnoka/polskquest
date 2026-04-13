#!/usr/bin/env node
/**
 * merge_synonyms.cjs — merge CSV rows that share the same English translation
 *
 * Usage:
 *   node merge_synonyms.cjs --file=a1_translated.csv [--out=a1_merged.csv]
 *
 * What it does:
 *   Reads a CSV produced by translate.cjs. Groups rows by their English
 *   translation (case-insensitive). For each group, it:
 *     1. Keeps the row with the LOWEST frequency_rank as the "primary" entry
 *     2. Adds all other Polish forms as additional accepted_answers
 *     3. Sets context_hint / subtext if any forms differ (e.g. "tu / tutaj")
 *
 * Example:
 *   tu,here,[here],1
 *   tutaj,here,[here],2
 *   → tu,here,[here,tutaj,tu],1  (tutaj row is merged in, tu kept as primary)
 *
 * The output CSV is ready to re-seed with seed_vocabulary.cjs.
 */

const fs = require("fs");

const args = {};
for (const a of process.argv.slice(2)) {
  const [k, v] = a.replace(/^--/, "").split("=");
  args[k] = v ?? true;
}

const inFile  = args.file;
const outFile = args.out ?? inFile.replace(/\.csv$/, "_merged.csv");

if (!inFile) {
  console.error("Usage: node merge_synonyms.cjs --file=<csv> [--out=<csv>]");
  process.exit(1);
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function splitLine(line) {
  const out = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1]==='"') { cur+='"'; i++; } else inQ=!inQ; }
    else if (c === ',' && !inQ) { out.push(cur); cur=""; }
    else cur += c;
  }
  out.push(cur); return out;
}

function parseCSV(text) {
  const lines   = text.split("\n").filter(l => l.trim());
  const headers = splitLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = splitLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? "").trim()]));
  });
}

function csvCell(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  return (s.includes(",") || s.includes('"') || s.includes("\n"))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Load ──────────────────────────────────────────────────────────────────────
const rows = parseCSV(fs.readFileSync(inFile, "utf-8"))
  .filter(r => r.polish && r.english);

console.log(`Loaded ${rows.length} rows from ${inFile}`);

// ── Group by English translation (case-insensitive) ───────────────────────────
const groups = new Map();
for (const row of rows) {
  const key = row.english.toLowerCase().trim();
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

const synonymGroups = [...groups.values()].filter(g => g.length > 1);
console.log(`Found ${synonymGroups.length} synonym groups (${synonymGroups.reduce((n,g)=>n+g.length,0)} rows total)`);
if (synonymGroups.length <= 10) {
  for (const g of synonymGroups) {
    console.log(`  "${g[0].english}" ← ${g.map(r=>r.polish).join(", ")}`);
  }
} else {
  console.log("  (showing first 10)");
  for (const g of synonymGroups.slice(0,10)) {
    console.log(`  "${g[0].english}" ← ${g.map(r=>r.polish).join(", ")}`);
  }
}

// ── Merge ─────────────────────────────────────────────────────────────────────
const merged = [];
const absorbed = new Set(); // frequency_ranks of rows merged into another

for (const [, group] of groups) {
  if (group.length === 1) {
    merged.push(group[0]);
    continue;
  }

  // Sort by frequency_rank ascending — lowest rank = most common = primary
  group.sort((a, b) => parseInt(a.frequency_rank||"9999") - parseInt(b.frequency_rank||"9999"));
  const primary = group[0];
  const secondary = group.slice(1);

  // Collect all Polish forms
  const allPolish = group.map(r => r.polish);

  // Parse existing accepted_answers for primary
  let accepted = [];
  try { accepted = JSON.parse(primary.accepted_answers || "[]"); } catch { accepted = [primary.english.toLowerCase()]; }

  // Add all Polish forms to accepted_answers
  for (const p of allPolish) {
    const pl = p.toLowerCase();
    if (!accepted.includes(pl)) accepted.push(pl);
    // Also add diacritic-stripped version
    const stripped = pl.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/ł/g,"l").replace(/ń/g,"n").replace(/[źż]/g,"z")
      .replace(/ć/g,"c").replace(/ś/g,"s").replace(/ó/g,"o")
      .replace(/ę/g,"e").replace(/ą/g,"a");
    if (!accepted.includes(stripped)) accepted.push(stripped);
  }

  // Build subtext showing all forms: "tu / tutaj"
  const formsLabel = allPolish.join(" / ");
  const subtext = group.length > 1 ? `(also: ${secondary.map(r=>r.polish).join(", ")})` : (primary.subtext || "");

  merged.push({
    ...primary,
    accepted_answers: JSON.stringify(accepted),
    subtext,
  });

  // Mark secondary rows as absorbed (we'll skip them)
  for (const r of secondary) absorbed.add(r.frequency_rank + ":" + r.polish);
}

// Filter out absorbed secondary rows (already merged into primary)
// (Since we built merged from groups, we're already good — merged only has primaries)

console.log(`\nMerged into ${merged.length} rows (${rows.length - merged.length} rows absorbed as synonyms)`);

// ── Write output ──────────────────────────────────────────────────────────────
const header = "polish,english,category,subtext,accepted_answers,frequency_rank";
const lines  = merged.map(r => [
  r.polish, r.english, r.category || "misc",
  r.subtext || "", r.accepted_answers || "[]",
  r.frequency_rank || "",
].map(csvCell).join(","));

fs.writeFileSync(outFile, [header, ...lines].join("\n") + "\n", "utf-8");
console.log(`\n✓ Written to ${outFile}`);
console.log(`\nRe-seed with:`);
console.log(`  node seed_vocabulary.cjs --file=${outFile} --level=<level>`);
