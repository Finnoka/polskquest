import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from "react";

/* ══════════════════════════════════════════════════════════════════════════════
   POLSKQUEST — PHASE 10: INFRASTRUCTURE, CEFR SCALING & INPUT DEBOUNCING

   KEY CHANGES FROM PHASE 9:
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  INPUT LOCK    500ms lock after first Enter → prevents double-tap skip  │
   │  AUDIO SPLIT   Correct ding on submit · Slash/Oof on action button only │
   │  TRAINING MODE Only unseen words shown in Practice (strict filter)      │
   │  AUTO-MASTERY  Dungeon Clear → bulk-mastered all words in that CEFR lvl │
   │  REPLAY MODE   Cleared dungeons/stages can be replayed at 20% gold      │
   │  DEV CHEAT     isUnlocked:true on all dungeons A1→C1 for testing        │
   │  SUPABASE ARCH VocabService swaps mock → Supabase fetch by cefr+stage   │
   │  WORD BANK     Filter by CEFR level · shows unseen count too            │
   └──────────────────────────────────────────────────────────────────────────┘
══════════════════════════════════════════════════════════════════════════════ */


/* ══════════════════════════════════════════════════════════════════════════════
   §1  AUDIO SERVICE v2  (unchanged — battle-tested)
══════════════════════════════════════════════════════════════════════════════ */
class AudioServiceV2 {
  _voices=[]; _voice=null; _warmed=false; _voicePromise=null;
  loadVoices() {
    if (this._voicePromise) return this._voicePromise;
    this._voicePromise = new Promise(resolve => {
      const pick = () => {
        const all    = window.speechSynthesis?.getVoices() ?? [];
        const polish = all.filter(v => v.lang.startsWith("pl"));
        this._voices = polish;
        const premium  = polish.find(v => /Google.*Pl|Microsoft.*Zofia|Zofia|Agnieszka/i.test(v.name));
        const standard = polish.find(v => v.lang === "pl-PL");
        this._voice    = premium ?? standard ?? polish[0] ?? null;
        resolve(polish);
      };
      if (window.speechSynthesis?.getVoices().length > 0) { pick(); return; }
      window.speechSynthesis?.addEventListener("voiceschanged", pick, { once:true });
      setTimeout(pick, 1200);
    });
    return this._voicePromise;
  }
  async preWarm() {
    if (this._warmed || !window.speechSynthesis) return;
    await this.loadVoices();
    const u = new SpeechSynthesisUtterance(" ");
    u.lang="pl-PL"; u.volume=0; u.rate=2.0;
    if (this._voice) u.voice=this._voice;
    window.speechSynthesis.speak(u);
    this._warmed=true;
  }
  speak(text, { rate=0.82, onEnd, onError }={}) {
    if (!window.speechSynthesis) { onError?.("unsupported"); return ()=>{}; }
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    if (!window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    let cancelled=false;
    const tid = setTimeout(() => {
      if (cancelled) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang="pl-PL"; u.rate=rate; u.pitch=1.0; u.volume=1.0;
      if (this._voice) u.voice=this._voice;
      const ka = setInterval(() => {
        if (!window.speechSynthesis.speaking) { clearInterval(ka); return; }
        window.speechSynthesis.pause(); window.speechSynthesis.resume();
      }, 9000);
      u.onend  = () => { clearInterval(ka); if (!cancelled) onEnd?.(); };
      u.onerror = e => { clearInterval(ka); if (!cancelled) onError?.(e.error); };
      window.speechSynthesis.speak(u);
    }, 80);
    return () => { cancelled=true; clearTimeout(tid); window.speechSynthesis.cancel(); };
  }
  stop() { window.speechSynthesis?.cancel(); }
  get voices()        { return this._voices; }
  get selectedVoice() { return this._voice; }
  set selectedVoice(v){ this._voice=v; }
  isSupported()       { return "speechSynthesis" in window; }
}
const AudioService = new AudioServiceV2();


/* ══════════════════════════════════════════════════════════════════════════════
   §2  SFX ENGINE v2 — Phase 9 4-sound split (unchanged)
══════════════════════════════════════════════════════════════════════════════ */
const SFX = (() => {
  let ctx = null;
  const getCtx = () => {
    if (!ctx && typeof AudioContext !== "undefined") ctx = new AudioContext();
    if (!ctx && typeof webkitAudioContext !== "undefined") ctx = new webkitAudioContext(); // eslint-disable-line
    return ctx;
  };
  const tone = (freq, type, startT, dur, gain=0.3, freqEnd=null) => {
    const c = getCtx(); if (!c) return;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.connect(env); env.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startT);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, startT + dur);
    env.gain.setValueAtTime(gain, startT);
    env.gain.exponentialRampToValueAtTime(0.001, startT + dur);
    osc.start(startT); osc.stop(startT + dur);
  };
  const resume = () => { const c = getCtx(); if (c && c.state === "suspended") c.resume(); return c; };
  return {
    successDing() {
      const c = resume(); if (!c) return;
      const t = c.currentTime;
      tone(660, "sine",     t,       0.08, 0.28, 990);
      tone(990, "sine",     t+0.07,  0.14, 0.22, 1320);
      tone(1320,"triangle", t+0.14,  0.08, 0.12);
    },
    incorrectBuzzer() {
      const c = resume(); if (!c) return;
      const t = c.currentTime;
      tone(160, "sawtooth", t,       0.18, 0.32, 100);
      tone(280, "sawtooth", t,       0.12, 0.12, 140);
    },
    bladeSlash() {
      const c = resume(); if (!c) return;
      const t = c.currentTime;
      tone(800,  "sawtooth", t,       0.04, 0.22, 200);
      tone(1600, "sawtooth", t,       0.12, 0.18, 100);
      tone(300,  "sine",     t+0.04,  0.10, 0.10, 80);
    },
    oofImpact() {
      const c = resume(); if (!c) return;
      const t = c.currentTime;
      tone(120,  "square",   t,       0.20, 0.35, 60);
      tone(200,  "sawtooth", t,       0.08, 0.20, 80);
      tone(80,   "sine",     t+0.10,  0.25, 0.28, 40);
    },
    correct() { this.successDing(); },
    wrong()   { this.incorrectBuzzer(); },
  };
})();


/* ══════════════════════════════════════════════════════════════════════════════
   §3  VOCAB SERVICE v2 — Supabase-ready
   
   HOW IT WORKS NOW:
   • In dev (mock mode): reads from MOCK_VOCAB_CHUNKS keyed by "cefrLevel-stageId"
   • In production: swap the fetchChunk body for a Supabase fetch (see comments)
   
   The interface is IDENTICAL so the rest of the app needs zero changes when
   you flip the switch to real data.
══════════════════════════════════════════════════════════════════════════════ */
const VocabService = {
  _cache: new Map(),

  /* ── PRODUCTION: replace this body with the Supabase version below ── */
  // async fetchChunk(chunkId) {
  //   if (this._cache.has(chunkId)) return this._cache.get(chunkId);
  //   // Simulate network latency in mock mode
  //   await new Promise(r => setTimeout(r, 220));
  //   const data = MOCK_VOCAB_CHUNKS[chunkId] ?? [];
  //   this._cache.set(chunkId, data);
  //   return data;
  // },

  /* ── SUPABASE VERSION (uncomment and replace fetchChunk above) ──────────*/
  async fetchChunk(chunkId) {
    if (this._cache.has(chunkId)) return this._cache.get(chunkId);
    const [cefrLevel, stageId] = chunkId.split("-", 2);  // e.g. "a1-s1" → ["a1","s1"]
    const { data, error } = await window.__supabase
      .from("vocabulary")
      .select("*")
      .eq("cefr_level", cefrLevel)
      .eq("stage_id", stageId)
      .order("frequency_rank", { ascending: true });
    if (error) throw error;
    // Map snake_case DB cols → camelCase game format
    const words = (data ?? []).map(r => ({
      id:       r.id,
      polish:   r.polish,
      english:  r.english,
      subtext:  r.subtext ?? null,
      cat:      r.category,
      accepted: r.accepted_answers ?? [r.english.toLowerCase()],
      cefrLevel: r.cefr_level,
      stageId:   r.stage_id,
    }));
    this._cache.set(chunkId, words);
    return words;
  },
  /*── ─────────────────────────────────────────────────────────────────────── */

  /* Fetch ALL words for a given CEFR level (used by auto-mastery + Word Bank) */
  async fetchAllForLevel(cefrLevel) {
    const key = `__all_${cefrLevel}`;
    if (this._cache.has(key)) return this._cache.get(key);
    const allWords = [];
    for (const [chunkId, words] of Object.entries(MOCK_VOCAB_CHUNKS)) {
      if (chunkId.startsWith(cefrLevel + "-")) allWords.push(...words);
    }
    this._cache.set(key, allWords);
    return allWords;
    /* SUPABASE VERSION:
    const { data, error } = await window.__supabase
      .from("vocabulary")
      .select("id")
      .eq("cefr_level", cefrLevel);
    if (error) throw error;
    const result = (data ?? []).map(r => r.id);
    this._cache.set(key, result);
    return result;
    */
  },
};


/* ══════════════════════════════════════════════════════════════════════════════
   §4  MOCK VOCAB CHUNKS  (same data as Phase 9, extended)
══════════════════════════════════════════════════════════════════════════════ */
const MOCK_VOCAB_CHUNKS = {
  "a1-s1": [
    { id:"a1-s1-001", polish:"Dzień dobry",  english:"good day",     subtext:"(formal)",            cat:"greetings", accepted:["good day","good morning","good afternoon"] },
    { id:"a1-s1-002", polish:"Cześć",         english:"hi",           subtext:"(informal)",          cat:"greetings", accepted:["hi","hello","hey","bye"] },
    { id:"a1-s1-003", polish:"Do widzenia",   english:"goodbye",      subtext:"(formal)",            cat:"greetings", accepted:["goodbye","bye","farewell"] },
    { id:"a1-s1-004", polish:"Dobry wieczór", english:"good evening", subtext:null,                  cat:"greetings", accepted:["good evening"] },
    { id:"a1-s1-005", polish:"Dziękuję",      english:"thank you",    subtext:null,                  cat:"greetings", accepted:["thank you","thanks","thank u"] },
    { id:"a1-s1-006", polish:"Proszę",        english:"please",       subtext:"(also: here you go)", cat:"greetings", accepted:["please","here you go","you're welcome","youre welcome"] },
    { id:"a1-s1-007", polish:"Przepraszam",   english:"excuse me",    subtext:"(also: sorry)",       cat:"greetings", accepted:["excuse me","sorry","pardon","i'm sorry","im sorry"] },
    { id:"a1-s1-008", polish:"Tak",           english:"yes",          subtext:null,                  cat:"core",      accepted:["yes","yeah","yep"] },
    { id:"a1-s1-009", polish:"Nie",           english:"no",           subtext:null,                  cat:"core",      accepted:["no","nope","nah"] },
    { id:"a1-s1-010", polish:"Dobrze",        english:"good / okay",  subtext:null,                  cat:"core",      accepted:["good","okay","ok","fine","alright"] },
  ],
  "a1-s2": [
    { id:"a1-s2-001", polish:"Woda",    english:"water",  subtext:null, cat:"food",    accepted:["water"] },
    { id:"a1-s2-002", polish:"Chleb",   english:"bread",  subtext:null, cat:"food",    accepted:["bread"] },
    { id:"a1-s2-003", polish:"Kawa",    english:"coffee", subtext:null, cat:"food",    accepted:["coffee"] },
    { id:"a1-s2-004", polish:"Herbata", english:"tea",    subtext:null, cat:"food",    accepted:["tea"] },
    { id:"a1-s2-005", polish:"Piwo",    english:"beer",   subtext:null, cat:"food",    accepted:["beer"] },
    { id:"a1-s2-006", polish:"Jeden",   english:"one",    subtext:null, cat:"numbers", accepted:["one","1"] },
    { id:"a1-s2-007", polish:"Dwa",     english:"two",    subtext:null, cat:"numbers", accepted:["two","2"] },
    { id:"a1-s2-008", polish:"Trzy",    english:"three",  subtext:null, cat:"numbers", accepted:["three","3"] },
    { id:"a1-s2-009", polish:"Cztery",  english:"four",   subtext:null, cat:"numbers", accepted:["four","4"] },
    { id:"a1-s2-010", polish:"Pięć",    english:"five",   subtext:null, cat:"numbers", accepted:["five","5"] },
  ],
  "a1-s3": Array.from({length:10},(_,i)=>({ id:`a1-s3-${String(i+1).padStart(3,"0")}`, polish:`Kolor ${i+1}`, english:`colour ${i+1}`, subtext:null, cat:"colours", accepted:[`colour ${i+1}`,`color ${i+1}`] })),
  "a1-s4": Array.from({length:10},(_,i)=>({ id:`a1-s4-${String(i+1).padStart(3,"0")}`, polish:`Czas ${i+1}`, english:`time ${i+1}`, subtext:null, cat:"time", accepted:[`time ${i+1}`] })),
  // Stubs for A2, B1 (in production these come from Supabase)
  "a2-s1": Array.from({length:10},(_,i)=>({ id:`a2-s1-${String(i+1).padStart(3,"0")}`, polish:`Słowo A2-${i+1}`, english:`word a2-${i+1}`, subtext:null, cat:"misc", accepted:[`word a2-${i+1}`] })),
  "b1-s1": Array.from({length:10},(_,i)=>({ id:`b1-s1-${String(i+1).padStart(3,"0")}`, polish:`Słowo B1-${i+1}`, english:`word b1-${i+1}`, subtext:null, cat:"misc", accepted:[`word b1-${i+1}`] })),
  "b2-s1": Array.from({length:10},(_,i)=>({ id:`b2-s1-${String(i+1).padStart(3,"0")}`, polish:`Słowo B2-${i+1}`, english:`word b2-${i+1}`, subtext:null, cat:"misc", accepted:[`word b2-${i+1}`] })),
  "c1-s1": Array.from({length:10},(_,i)=>({ id:`c1-s1-${String(i+1).padStart(3,"0")}`, polish:`Słowo C1-${i+1}`, english:`word c1-${i+1}`, subtext:null, cat:"misc", accepted:[`word c1-${i+1}`] })),
};


/* ══════════════════════════════════════════════════════════════════════════════
   §5  MASTERY STORE  (Phase 10 — bulk mastery added for Dungeon Clear)
   
   BUCKET LOGIC:
   ┌───────────────────────────────────────────────────────────────────────┐
   │  unseen     Word never encountered.                                   │
   │  training   Introduced in Practice Mode but not yet used in battle.  │
   │  learning   Seen in battle. Correct answers build toward mastered.   │
   │  mastered   Answered correctly 5× in a streak. PERMANENT. Immune.   │
   └───────────────────────────────────────────────────────────────────────┘
   
   NEW in Phase 10:
   • BULK_MASTER_LEVEL { wordIds: string[] } — used by Dungeon Clear hook
══════════════════════════════════════════════════════════════════════════════ */
const TRAINING_SCORE    = -99;
const MASTERY_THRESHOLD = 5;

const MASTERY_TIERS = {
  unseen:   { label:"Unseen",   color:"#1e293b", dim:"#0f172a" },
  training: { label:"Training", color:"#6366f1", dim:"#312e81" },
  learning: { label:"Learning", color:"#f59e0b", dim:"#78350f" },
  mastered: { label:"Mastered", color:"#10b981", dim:"#064e3b" },
};

function scoreToTier(score, inLedger) {
  if (!inLedger || score === undefined) return "unseen";
  if (score === TRAINING_SCORE)         return "training";
  if (score >= MASTERY_THRESHOLD)       return "mastered";
  return "learning";
}

function ledgerReducer(state, action) {
  const { type, wordId, wordIds } = action;
  switch (type) {
    case "PRACTICE_SEEN":
      if (state[wordId] === undefined) return { ...state, [wordId]: TRAINING_SCORE };
      return state;
    case "BATTLE_CORRECT": {
      if (state[wordId] !== undefined && state[wordId] >= MASTERY_THRESHOLD) return state;
      const prev = state[wordId];
      const cur  = prev === undefined ? 0 : prev === TRAINING_SCORE ? 0 : prev < 0 ? 0 : prev;
      return { ...state, [wordId]: Math.min(MASTERY_THRESHOLD, cur + 1) };
    }
    case "BATTLE_WRONG": {
      if (state[wordId] !== undefined && state[wordId] >= MASTERY_THRESHOLD) return state;
      return { ...state, [wordId]: 0 };
    }
    /* Phase 10 — Dungeon Clear: bulk-upgrade all words for a CEFR level to mastered */
    case "BULK_MASTER_LEVEL": {
      if (!wordIds?.length) return state;
      const patch = {};
      for (const id of wordIds) {
        patch[id] = MASTERY_THRESHOLD; // set to 5 (mastered)
      }
      return { ...state, ...patch };
    }
    default: return state;
  }
}

function tallyLedger(ledger, wordIds) {
  const counts = { unseen:0, training:0, learning:0, mastered:0 };
  for (const id of wordIds) {
    const tier = scoreToTier(ledger[id], id in ledger);
    if (counts[tier] !== undefined) counts[tier]++;
  }
  return counts;
}

function computeMasteryPct(ledger, dungeonTotalWords, allLedgerIds) {
  const masteredCount = allLedgerIds.filter(id => scoreToTier(ledger[id], id in ledger) === "mastered").length;
  const total = dungeonTotalWords ?? Math.max(allLedgerIds.length, 1);
  return total > 0 ? Math.round((masteredCount / total) * 100) : 0;
}


/* ══════════════════════════════════════════════════════════════════════════════
   §6  DUNGEON MANIFEST
   
   Phase 10 changes:
   • All dungeons isUnlocked:true for dev/testing (cheat code)
   • A2, B1, B2, C1 fully stubbed with stages (for replay + progress testing)
   • CEFR word targets: A1=700, A2=2000, B1=3000, B2=5000, C1=10000
══════════════════════════════════════════════════════════════════════════════ */
// Helper to generate stages for a dungeon
function generateStages(dungeonId, totalWords, wordsPerStage = 50) {
  const stageCount = Math.ceil(totalWords / wordsPerStage);
  const stageThemes = [
    { name: "The Gateway",        icon: "🚪" },
    { name: "The Market",         icon: "🏪" },
    { name: "The Forest",         icon: "🌲" },
    { name: "The River",          icon: "🌊" },
    { name: "The Mountain",       icon: "⛰" },
    { name: "The Castle",         icon: "🏰" },
    { name: "The Library",        icon: "📚" },
    { name: "The Temple",         icon: "🏛" },
    { name: "The Academy",        icon: "🎓" },
    { name: "The Tower",          icon: "🗼" },
  ];

  return Array.from({ length: stageCount }, (_, i) => {
    const theme    = stageThemes[i % stageThemes.length];
    const stageNum = i + 1;
    const chunkId  = `${dungeonId}-s${stageNum}`;

    return {
      id:      `${dungeonId}-s${stageNum}`,
      index:   stageNum,
      name:    `${theme.name} ${stageNum}`,
      chunkId,
      icon:    theme.icon,
      color:   "#6366f1",
      rooms: Array.from({ length: 5 }, (_, j) => ({
        id:          `${dungeonId}-s${stageNum}-r${j+1}`,
        name:        `Room ${j+1}`,
        enemyName:   `Stage ${stageNum} Enemy ${j+1}`,
        emoji:       ["👺","🧟","💀","👁","🗡"][j],
        xp:          100 + (stageNum * 5),
        gold:        40  + (stageNum * 2),
        wordSlice:   [j * 10, j * 10 + 10],
      })),
      boss: {
        id:               `${dungeonId}-s${stageNum}-boss`,
        name:             `The ${theme.name} Guardian`,
        enemyName:        `Guardian of Stage ${stageNum}`,
        emoji:            "👑",
        lore:             `Master of words ${(i * wordsPerStage) + 1}–${(i+1) * wordsPerStage}.`,
        xp:               300 + (stageNum * 10),
        gold:             150 + (stageNum * 5),
        bossTimerSeconds: 10,
        wordSlice:        [0, 50],
      },
    };
  });
}

const DUNGEON_MANIFEST = [
  {
    id:"a1", name:"A1 Dungeon", subtitle:"700 Basic Polish Words",
    cefr:"A1", color:"#10b981", bg:"rgba(16,185,129,0.09)",
    border:"rgba(16,185,129,0.26)", icon:"🏰",
    locked:false, isUnlocked:true,
    totalWords:700,
    stages: generateStages("a1", 700),  // 14 stages
  },
  {
    id:"a2", name:"A2 Dungeon", subtitle:"2000 Grammar & Intermediate Vocab",
    cefr:"A2", color:"#3b82f6", bg:"rgba(59,130,246,0.09)",
    border:"rgba(59,130,246,0.26)", icon:"🗼",
    locked:false, isUnlocked:true,
    totalWords:2000,
    stages: generateStages("a2", 2000),  // 40 stages
  },
  {
    id:"b1", name:"B1 Dungeon", subtitle:"3000 Cases, Verbs of Motion & Beyond",
    cefr:"B1", color:"#a855f7", bg:"rgba(168,85,247,0.09)",
    border:"rgba(168,85,247,0.26)", icon:"⚔️",
    locked:false, isUnlocked:true,
    totalWords:3000,
    stages: generateStages("b1", 3000),  // 60 stages
  },
  {
    id:"b2", name:"B2 Dungeon", subtitle:"5000 Advanced Fluency",
    cefr:"B2", color:"#f97316", bg:"rgba(249,115,22,0.09)",
    border:"rgba(249,115,22,0.26)", icon:"🏛",
    locked:false, isUnlocked:true,
    totalWords:5000,
    stages: generateStages("b2", 5000),  // 100 stages
  },
  {
    id:"c1", name:"C1 Dungeon", subtitle:"10000 Near-Native Mastery",
    cefr:"C1", color:"#ec4899", bg:"rgba(236,72,153,0.09)",
    border:"rgba(236,72,153,0.26)", icon:"👑",
    locked:false, isUnlocked:true,
    totalWords:10000,
    stages: generateStages("c1", 10000),  // 200 stages
  },
];


/* ══════════════════════════════════════════════════════════════════════════════
   §7  VOCAB ENGINE v3  (unchanged — stage-scoped generation with mastery weighting)
══════════════════════════════════════════════════════════════════════════════ */
function removeDiacritics(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
          .replace(/ł/g,"l").replace(/ń/g,"n").replace(/[źż]/g,"z")
          .replace(/ć/g,"c").replace(/ś/g,"s").replace(/ó/g,"o")
          .replace(/ę/g,"e").replace(/ą/g,"a");
}

function weightedPick(pool, ledger, excludeId) {
  const eligible = pool.length > 1 ? pool.filter(w => w.id !== excludeId) : pool;
  const weights  = eligible.map(w => {
    const s   = ledger[w.id];
    const tier = scoreToTier(s, w.id in ledger);
    const base = { unseen:5, training:7, learning:6, mastered:1 };
    return base[tier] ?? 5;
  });
  const total = weights.reduce((a,b) => a+b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < eligible.length; i++) { r -= weights[i]; if (r <= 0) return eligible[i]; }
  return eligible[eligible.length - 1];
}

function pickDistractors(correct, pool, n=3) {
  const candidates = pool.filter(w => w.id !== correct.id);
  const diff = candidates.filter(w => w.cat !== correct.cat).sort(() => Math.random()-0.5);
  const same = candidates.filter(w => w.cat === correct.cat).sort(() => Math.random()-0.5);
  const picked = [...diff, ...same].slice(0, n);
  while (picked.length < n) picked.push({ id:`_pad${picked.length}`, english:"—", subtext:null, cat:"_" });
  return picked;
}

function generateQuestion(pool, ledger, lastId) {
  if (!pool || pool.length === 0) return null;
  const word   = weightedPick(pool, ledger, lastId);
  const qTypes = ["reading","reading","listening","listening","writing","writing","writing"];
  const qtype  = qTypes[Math.floor(Math.random() * qTypes.length)];

  if (qtype === "reading") {
    const distractors = pickDistractors(word, pool);
    const options = [...distractors.map(d=>({ label:d.english, subtext:d.subtext })),
                     { label:word.english, subtext:word.subtext }].sort(() => Math.random()-0.5);
    return { id:`${word.id}-r-${Date.now()}`, type:"reading", wordId:word.id, polish:word.polish, english:word.english, options, answer:word.english, cat:word.cat };
  }
  if (qtype === "listening") {
    return { id:`${word.id}-l-${Date.now()}`, type:"listening", wordId:word.id, polish:word.polish, english:word.english, answer:word.english, accepted:word.accepted??[word.english.toLowerCase()], cat:word.cat };
  }
  return { id:`${word.id}-w-${Date.now()}`, type:"writing", wordId:word.id, polish:word.polish, english:word.english, answer:word.polish, accepted:[word.polish.toLowerCase(), removeDiacritics(word.polish.toLowerCase())], cat:word.cat };
}

function checkAnswer(q, raw) {
  const input = raw.trim().toLowerCase();
  if (q.type === "reading") return input === q.answer.toLowerCase();
  const accepted = q.accepted ?? [q.answer.toLowerCase()];
  const norm     = removeDiacritics(input);
  return accepted.some(a => a === input || removeDiacritics(a) === norm);
}


/* ══════════════════════════════════════════════════════════════════════════════
   §8  TUTOR DATABASE (unchanged)
══════════════════════════════════════════════════════════════════════════════ */
const TUTOR_DB = {
  greetings:{ title:"Polish Greeting Registers", coreRule:"Polish distinguishes formal and informal sharply. 'Dzień dobry' for strangers; 'Cześć' only with peers.", breakdown:[{label:"Formal",text:"Dzień dobry (day), Dobry wieczór (evening), Do widzenia (goodbye)."},{label:"Informal",text:"Cześć covers hi AND bye. Nara / Na razie = very casual."},{label:"Proszę",text:"Please / here you go / you're welcome — context determines meaning."}], mnemonic:"Dzień = day → Dzień dobry. Cześć rhymes with 'fresh' — keep it fresh with friends.", antiPattern:"Using Cześć with a teacher — it signals casualness and can read as rude.", analogyEN:"Like 'Good day sir' vs 'Hey!' — same idea, very different register." },
  core:     { title:"Polish Core Words", coreRule:"Tak / Nie / Dobrze / Bardzo — highest-frequency non-pronoun words.", breakdown:[{label:"Tak/Nie",text:"Yes/no. 'Nie' also negates verbs: 'Nie wiem' = I don't know."},{label:"Dobrze",text:"Good + okay: 'Dobrze, rozumiem' = Okay, I understand."},{label:"Bardzo",text:"Very: 'Bardzo dobrze' = very good."}], mnemonic:"Nie = knee (no, bends). Tak = tock (yes, ticks).", antiPattern:"'Nie' in response to a negative question may confuse — Polish double-negatives work differently.", analogyEN:"Dobrze is Italian 'bene' — covers quality and acknowledgement both." },
  food:     { title:"Polish Food & Drink", coreRule:"Food nouns have gender. Masculine: chleb. Feminine: woda, herbata, kawa. Neuter: piwo, mleko.", breakdown:[{label:"Drinks",text:"Woda (water), kawa (coffee), herbata (tea), piwo (beer)."},{label:"Staples",text:"Chleb (bread) — 'ch' like Scottish loch, NOT English chess."},{label:"Gender note",text:"Learning gender with each word now saves enormous headaches later."}], mnemonic:"Chleb = kh-leb (like Russian хлеб). Herbata = hehr-BAH-tah, not herb.", antiPattern:"Pronouncing chleb with English 'ch'. It's a velar fricative — try gargling gently.", analogyEN:"Like café vs caffè — same liquid, different register." },
  numbers:  { title:"Polish Numbers", coreRule:"Learn 1–10 as pure sound first — don't overthink spelling.", breakdown:[{label:"1–3",text:"Jeden, dwa, trzy. Trzy ≈ tsheh — tree without th."},{label:"4–5",text:"Cztery = ch-tereh. Pięć = pyench — nasal ę."},{label:"6–10",text:"Sześć, siedem, osiem, dziewięć, dziesięć."}], mnemonic:"Trzy = tree (3 branches). Cztery starts like Polish 'ch' — like czar.", antiPattern:"Reading 'cz' like English ch in church. Polish cz is always ch as in chess.", analogyEN:"French numbers reward ear-training over eye-reading. Polish is the same." },
  colours:  { title:"Polish Colours", coreRule:"Colours agree in gender and case with the noun they modify.", breakdown:[{label:"Basic",text:"Czerwony (red), niebieski (blue), zielony (green), żółty (yellow)."},{label:"Agreement",text:"Biały kot (white cat-m.), biała kawa (white coffee-f.)."},{label:"Tip",text:"Start with the dictionary form; worry about agreement after."}], mnemonic:"Czerwony = red, think 'czar' — red-hot magic.", antiPattern:"Forgetting gender agreement — in Polish every adjective must match.", analogyEN:"Like French rouge / rouge / rouge — but Polish adds more forms." },
  time:     { title:"Polish Time Words", coreRule:"Days and months are not capitalised in Polish.", breakdown:[{label:"Days",text:"Poniedziałek (Mon), wtorek (Tue), środa (Wed), czwartek (Thu), piątek (Fri)."},{label:"Months",text:"Styczeń (Jan), luty (Feb), marzec (Mar), kwiecień (Apr)..."},{label:"Time",text:"Teraz (now), dzisiaj (today), jutro (tomorrow), wczoraj (yesterday)."}], mnemonic:"Piątek = Friday = five (pięć) — pay day!", antiPattern:"Capitalising Monday as Poniedziałek — Polish doesn't do this.", analogyEN:"Like French lundi, mardi — lowercase, same idea." },
  misc:     { title:"Polish Pronunciation", coreRule:"Highly regular once you know the clusters.", breakdown:[{label:"Key clusters",text:"sz=sh, cz=ch, rz=zh, ł=w. Learn these and most words open up."},{label:"Stress",text:"Penultimate syllable, ~95% of the time."}], mnemonic:"Penultimate: second-to-last syllable. Count from the end.", antiPattern:"Stressing the first syllable (English habit).", analogyEN:"Like Italian — penultimate stress as the reliable default." },
  __default:{ title:"Polish Tip", coreRule:"Chunk whole phrases before analysing grammar.", breakdown:[{label:"Method",text:"Sounds before spellings. Phrases before rules."}], mnemonic:"Dziękuję works before you know it's a verb.", antiPattern:"Trying to understand every rule before speaking.", analogyEN:"Like learning 'I don't know' before auxiliary verbs." },
};


/* ══════════════════════════════════════════════════════════════════════════════
   §9  SHARED UI PRIMITIVES
══════════════════════════════════════════════════════════════════════════════ */
function PlayAudio({ text, size="md", autoPlay=false, onEnd }) {
  const [state, setState] = useState("idle");
  const cancelRef = useRef(null); const alive = useRef(true);
  useEffect(() => { AudioService.loadVoices(); }, []);
  const doSpeak = useCallback(() => {
    if (!AudioService.isSupported()) { setState("error"); return; }
    cancelRef.current?.(); setState("speaking");
    cancelRef.current = AudioService.speak(text, {
      onEnd:  () => { if (alive.current) { setState("idle"); onEnd?.(); }},
      onError:() => { if (alive.current) setState("error"); },
    });
    const t = setTimeout(()=>{ if (alive.current) setState("idle"); }, 10000);
    const p = cancelRef.current;
    cancelRef.current = ()=>{ p?.(); clearTimeout(t); };
  }, [text, onEnd]);
  useEffect(() => {
    alive.current=true;
    if (autoPlay) { const t=setTimeout(doSpeak,120); return ()=>{ clearTimeout(t); cancelRef.current?.(); alive.current=false; }; }
    return ()=>{ cancelRef.current?.(); alive.current=false; };
  }, [autoPlay, doSpeak]);
  const toggle = e => { e?.stopPropagation(); if (state==="speaking") { cancelRef.current?.(); setState("idle"); return; } doSpeak(); };
  const sz = {sm:26,md:34,lg:42}[size];
  return (
    <button onClick={toggle} title={state==="speaking"?"Stop":"Play Polish"}
      style={{ width:sz, height:sz, borderRadius:"50%", flexShrink:0, border:`1px solid ${state==="speaking"?"rgba(16,185,129,0.6)":"rgba(255,255,255,0.1)"}`, background:state==="speaking"?"rgba(16,185,129,0.2)":"rgba(255,255,255,0.05)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", transition:"all 0.18s", animation:state==="speaking"?"speakerPulse 1.2s ease infinite":"none" }}>
      <span style={{ fontSize:sz*0.38, lineHeight:1 }}>{state==="error"?"⚠":state==="speaking"?"◼":"▶"}</span>
    </button>
  );
}

function HpBar({ current, max, color="#10b981", label="" }) {
  const pct = Math.max(0,current/max)*100;
  const c   = pct>50?color:pct>20?"#f59e0b":"#ef4444";
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      {label && <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, fontFamily:"monospace", color:"#334155", letterSpacing:"0.07em" }}><span>{label}</span><span style={{ color:c, fontWeight:700 }}>{current}/{max}</span></div>}
      <div style={{ display:"flex", gap:2 }}>
        {Array.from({length:max}).map((_,i)=>(
          <div key={i} style={{ flex:1, height:5, borderRadius:2, background:i<current?c:"rgba(255,255,255,0.05)", boxShadow:i<current?`0 0 4px ${c}88`:"none", transition:"background 0.25s" }}/>
        ))}
      </div>
    </div>
  );
}

function BossTimer({ totalSeconds, onExpire }) {
  const [rem, setRem] = useState(totalSeconds); const fired=useRef(false);
  useEffect(()=>{
    setRem(totalSeconds); fired.current=false;
    const iv=setInterval(()=>setRem(r=>{ if(r<=1){clearInterval(iv); if(!fired.current){fired.current=true;onExpire?.();} return 0;} return r-1;}),1000);
    return ()=>clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[totalSeconds]);
  const pct=rem/totalSeconds*100; const urg=rem<=3;
  const col=rem>totalSeconds*.55?"#10b981":rem>totalSeconds*.25?"#f59e0b":"#ef4444";
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:3, minWidth:80 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, fontFamily:"monospace" }}>
        <span style={{ color:"#334155" }}>⏱</span>
        <span style={{ color:col, fontWeight:900, fontSize:urg?13:10, animation:urg?"timerPulse 0.45s ease infinite":"none" }}>{rem}s</span>
      </div>
      <div style={{ height:5, background:"rgba(255,255,255,0.05)", borderRadius:3, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background:col, borderRadius:3, transition:"width 1s linear", boxShadow:`0 0 7px ${col}88` }}/>
      </div>
    </div>
  );
}

function TutorPanel({ catKey, onClose }) {
  const [tab,setTab]=useState("breakdown");
  const ex=TUTOR_DB[catKey]??TUTOR_DB.__default;
  return (
    <div style={{ borderRadius:12, overflow:"hidden", border:"1px solid rgba(99,102,241,0.28)", background:"linear-gradient(135deg,rgba(49,46,129,0.16),transparent 55%)", animation:"slideUp 0.28s cubic-bezier(0.34,1.56,0.64,1)" }}>
      <div style={{ padding:"10px 13px", display:"flex", justifyContent:"space-between", alignItems:"flex-start", borderBottom:"1px solid rgba(255,255,255,0.04)", background:"rgba(99,102,241,0.07)" }}>
        <div><div style={{ fontSize:8,color:"#818cf8",fontFamily:"monospace",letterSpacing:"0.14em",marginBottom:2 }}>🎓 TUTOR</div><div style={{ fontSize:11,fontWeight:700,color:"#e2e8f0",fontFamily:"monospace" }}>{ex.title}</div></div>
        <button onClick={onClose} style={{ background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:16,lineHeight:1 }}>×</button>
      </div>
      <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
        {[["breakdown","Rule"],["mnemonic","Memory"],["trap","Trap"],["english","Analogy"]].map(([id,lb])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ flex:1,padding:"6px 4px",border:"none",fontSize:8,fontFamily:"monospace",fontWeight:700,letterSpacing:"0.05em",cursor:"pointer",background:tab===id?"rgba(99,102,241,0.14)":"transparent",borderBottom:`2px solid ${tab===id?"#818cf8":"transparent"}`,color:tab===id?"#818cf8":"#475569",transition:"all 0.12s" }}>{lb}</button>
        ))}
      </div>
      <div style={{ padding:"11px 13px", minHeight:80 }}>
        {tab==="breakdown"&&<div style={{ display:"flex",flexDirection:"column",gap:6,animation:"fadeIn 0.16s" }}><div style={{ fontSize:11,color:"#c7d2fe",lineHeight:1.55,fontStyle:"italic" }}>{ex.coreRule}</div>{ex.breakdown.map((b,i)=>(<div key={i} style={{ padding:"7px 9px",borderRadius:7,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)" }}><div style={{ fontSize:8,color:"#818cf8",fontWeight:700,fontFamily:"monospace",marginBottom:2 }}>{b.label}</div><div style={{ fontSize:11,color:"#94a3b8",lineHeight:1.45 }}>{b.text}</div></div>))}</div>}
        {tab==="mnemonic"&&<div style={{ padding:"12px",borderRadius:8,textAlign:"center",background:"rgba(245,158,11,0.06)",border:"1px solid rgba(245,158,11,0.15)",animation:"fadeIn 0.16s" }}><div style={{ fontSize:14,marginBottom:5 }}>🧠</div><div style={{ fontSize:11,color:"#fcd34d",fontFamily:"monospace",lineHeight:1.5,fontStyle:"italic" }}>{ex.mnemonic}</div></div>}
        {tab==="trap"&&<div style={{ padding:"10px",borderRadius:8,background:"rgba(239,68,68,0.06)",border:"1px solid rgba(239,68,68,0.15)",animation:"fadeIn 0.16s" }}><div style={{ fontSize:8,color:"#f87171",fontWeight:700,fontFamily:"monospace",marginBottom:3 }}>⚠ THE TRAP</div><div style={{ fontSize:11,color:"#fca5a5",lineHeight:1.45 }}>{ex.antiPattern}</div></div>}
        {tab==="english"&&<div style={{ padding:"10px",borderRadius:8,background:"rgba(59,130,246,0.06)",border:"1px solid rgba(59,130,246,0.15)",animation:"fadeIn 0.16s" }}><div style={{ fontSize:8,color:"#93c5fd",fontWeight:700,fontFamily:"monospace",marginBottom:3 }}>🇬🇧 ANCHOR</div><div style={{ fontSize:11,color:"#bfdbfe",lineHeight:1.45 }}>{ex.analogyEN}</div></div>}
      </div>
    </div>
  );
}

function Pill({ icon, val, col, bg, border, anim }) {
  return (
    <div style={{ display:"flex",alignItems:"center",gap:3,padding:"3px 7px",borderRadius:6,background:bg,border:`1px solid ${border}` }}>
      <span style={{ fontSize:9 }}>{icon}</span>
      <span style={{ fontSize:9,fontFamily:"monospace",color:col,fontWeight:700,animation:anim||"none" }}>{val}</span>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §10  PRACTICE MODE  — Phase 10: strict UNSEEN-only filter
   
   Training mode only shows words with `unseen` status.
   Already-seen words appear only in Battles via weightedPick.
══════════════════════════════════════════════════════════════════════════════ */
function PracticeMode({ wordPool, dungeon, stage, room, onComplete, onBack, dispatchLedger, ledger, isReplay }) {
  // Phase 10: filter to only unseen words for practice
  const unseenPool = useMemo(() => {
    return wordPool.filter(w => scoreToTier(ledger[w.id], w.id in ledger) === "unseen");
  }, [wordPool, ledger]);

  // If all words already seen, skip straight to combat
  const practiceWords = unseenPool.length > 0 ? unseenPool : wordPool;
  const isAllSeen     = unseenPool.length === 0;

  const [idx,     setIdx]     = useState(0);
  const [revealed, setReveal] = useState(false);
  const [done,     setDone]   = useState(isAllSeen);

  const word  = practiceWords[idx] ?? practiceWords[0];
  const total = practiceWords.length;

  const markSeen = useCallback(() => {
    if (word) dispatchLedger({ type:"PRACTICE_SEEN", wordId:word.id });
  }, [word, dispatchLedger]);

  const advance = () => {
    markSeen();
    if (idx + 1 >= total) { setDone(true); return; }
    setIdx(i => i + 1);
    setReveal(false);
  };

  if (done) {
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:14, animation:"slideUp 0.3s ease" }}>
        <button onClick={onBack} style={{ background:"none",border:"none",color:"#334155",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0,alignSelf:"flex-start" }}>← {stage.name}</button>
        <div style={{ padding:"22px 18px", borderRadius:14, textAlign:"center", background:"rgba(99,102,241,0.08)", border:"1px solid rgba(99,102,241,0.25)" }}>
          <div style={{ fontSize:32, marginBottom:10 }}>{isAllSeen ? "⚔️" : "🎓"}</div>
          <div style={{ fontSize:14, fontWeight:900, color:"#c7d2fe", fontFamily:"monospace", marginBottom:6 }}>
            {isAllSeen ? "ALL WORDS KNOWN" : "PRACTICE COMPLETE"}
          </div>
          <div style={{ fontSize:10, color:"#475569", fontFamily:"monospace", marginBottom:18 }}>
            {isAllSeen
              ? `All ${wordPool.length} words already in your bank — straight to battle!`
              : `${total} new words moved from Unseen → Training`
            }
          </div>
          <button onClick={onComplete} style={{ padding:"12px 28px", borderRadius:10, fontFamily:"monospace", fontWeight:900, fontSize:12, cursor:"pointer", letterSpacing:"0.08em", background:"linear-gradient(135deg,#4f46e5,#7c3aed)", border:"1px solid #818cf8", color:"#e0e7ff", boxShadow:"0 4px 18px rgba(99,102,241,0.3)" }}>
            ⚔ BEGIN BATTLE
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <button onClick={onBack} style={{ background:"none",border:"none",color:"#334155",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0,alignSelf:"flex-start" }}>← {stage.name}</button>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <div style={{ fontSize:9, fontFamily:"monospace", color:"#6366f1", letterSpacing:"0.14em", fontWeight:700 }}>🎓 PRACTICE MODE</div>
          {isReplay && <span style={{ fontSize:7,padding:"1px 5px",borderRadius:3,background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.3)",color:"#f59e0b",fontFamily:"monospace",fontWeight:700 }}>REPLAY</span>}
        </div>
        <div style={{ fontSize:9, fontFamily:"monospace", color:"#334155" }}>{idx+1} / {total} <span style={{ color:"#1e293b" }}>(unseen only)</span></div>
      </div>
      <div style={{ display:"flex", gap:2 }}>
        {practiceWords.map((_,i)=>(
          <div key={i} style={{ flex:1, height:3, borderRadius:1, background:i<idx?"#6366f1":i===idx?"rgba(99,102,241,0.5)":"rgba(255,255,255,0.05)" }}/>
        ))}
      </div>
      <div style={{ borderRadius:14, overflow:"hidden", border:"1px solid rgba(99,102,241,0.25)", background:"rgba(255,255,255,0.025)", animation:"slideUp 0.2s ease" }} key={word?.id}>
        <div style={{ padding:"28px 20px", textAlign:"center" }}>
          <div style={{ fontSize:8, color:"#475569", fontFamily:"monospace", letterSpacing:"0.14em", marginBottom:8 }}>POLISH</div>
          <div style={{ fontSize:28, fontWeight:900, color:"#f8fafc", fontFamily:"monospace", marginBottom:12 }}>{word?.polish}</div>
          <div style={{ display:"flex", justifyContent:"center" }}>
            <PlayAudio text={word?.polish ?? ""} size="lg" autoPlay key={`auto-${word?.id}`}/>
          </div>
        </div>
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)" }}>
          {!revealed ? (
            <button onClick={()=>setReveal(true)}
              style={{ width:"100%", padding:"14px", background:"rgba(99,102,241,0.08)", border:"none", color:"#6366f1", fontFamily:"monospace", fontWeight:700, fontSize:11, cursor:"pointer", letterSpacing:"0.08em" }}>
              REVEAL MEANING ▼
            </button>
          ) : (
            <div style={{ padding:"16px 20px", textAlign:"center", background:"rgba(99,102,241,0.06)", animation:"fadeIn 0.22s ease" }}>
              <div style={{ fontSize:8, color:"#475569", fontFamily:"monospace", letterSpacing:"0.14em", marginBottom:6 }}>ENGLISH</div>
              <div style={{ fontSize:20, fontWeight:900, color:"#c7d2fe", fontFamily:"monospace", marginBottom:4 }}>{word?.english}</div>
              {word?.subtext && <div style={{ fontSize:10, color:"#475569", fontFamily:"monospace" }}>{word?.subtext}</div>}
            </div>
          )}
        </div>
      </div>
      {revealed && (
        <button onClick={advance}
          style={{ padding:"12px", borderRadius:10, fontFamily:"monospace", fontWeight:900, fontSize:12, cursor:"pointer", letterSpacing:"0.08em", background:idx+1>=total?"linear-gradient(135deg,#4f46e5,#7c3aed)":"rgba(255,255,255,0.04)", border:`1px solid ${idx+1>=total?"#818cf8":"rgba(255,255,255,0.09)"}`, color:idx+1>=total?"#e0e7ff":"#94a3b8", transition:"all 0.18s" }}>
          {idx+1 >= total ? "⚔ PROCEED TO BATTLE" : "NEXT WORD →"}
        </button>
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §11  QUESTION CARD — Phase 10: 500ms Input Lock after first Enter
   
   feedbackStep: "idle" | "locked" | "verified"
   
   LOCK FLOW:
     1. User hits Enter → checkAndReveal() runs, feedbackStep→"locked"
     2. After 500ms → feedbackStep→"verified" (Strike / Take Damage visible)
     3. User hits Enter again → confirmAndAdvance()
   
   This prevents a double-tap from skipping the Explain stage entirely.
══════════════════════════════════════════════════════════════════════════════ */
function QuestionCard({ question, onAnswer, isBoss, bossTimerSeconds, onTimerExpire, onOof }) {
  const [feedbackStep, setFeedbackStep] = useState("idle");  // idle | locked | verified
  const [selected,     setSelected]     = useState(null);
  const [typed,        setTyped]        = useState("");
  const [result,       setResult]       = useState(null);
  const [showTutor,    setShowTutor]    = useState(false);
  const inputRef   = useRef(null);
  const timerKey   = useRef(0);
  const lockTimer  = useRef(null);  // Phase 10: input lock timer

  // Reset on question change
  useEffect(()=>{
    setFeedbackStep("idle"); setSelected(null); setTyped(""); setResult(null); setShowTutor(false);
    timerKey.current++;
    if (lockTimer.current) { clearTimeout(lockTimer.current); lockTimer.current=null; }
    if (question.type !== "reading") setTimeout(()=>inputRef.current?.focus(), 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[question.id]);

  // Cleanup lock timer on unmount
  useEffect(()=>()=>{ if (lockTimer.current) clearTimeout(lockTimer.current); },[]);

  /* STEP 1 → locked → verified: evaluate answer, play Step-1 sound, then unlock after 500ms */
  const checkAndReveal = useCallback(() => {
    if (feedbackStep !== "idle") return;
    const raw = question.type === "reading" ? (selected ?? "") : typed;
    if (!raw.trim()) return;
    const ok  = checkAnswer(question, raw);
    setResult(ok);
    setFeedbackStep("locked");   // Phase 10: lock immediately
    setShowTutor(true);
    if (ok) SFX.successDing(); else SFX.incorrectBuzzer();
    // Unlock after 500ms — prevents accidental double-tap skip
    lockTimer.current = setTimeout(() => {
      setFeedbackStep("verified");
      lockTimer.current = null;
    }, 500);
  }, [feedbackStep, question, selected, typed]);

  /* STEP 2 → advance: play Step-2 sound on action button click */
  const confirmAndAdvance = useCallback(() => {
    if (feedbackStep !== "verified") return;
    const raw = question.type === "reading" ? (selected ?? "") : typed;
    if (result) {
      SFX.bladeSlash();
    } else {
      SFX.oofImpact();
      onOof?.();
    }
    setTimeout(() => onAnswer(result, raw), 120);
  }, [feedbackStep, result, selected, typed, question, onAnswer, onOof]);

  /* Boss timer expiry */
  const handleTimerFire = useCallback(()=>{
    if (feedbackStep !== "idle") return;
    SFX.incorrectBuzzer();
    setResult(false); setFeedbackStep("locked"); setShowTutor(true);
    lockTimer.current = setTimeout(() => {
      setFeedbackStep("verified");
      lockTimer.current = null;
      setTimeout(() => {
        SFX.oofImpact();
        onOof?.();
        onTimerExpire?.();
      }, 900);
    }, 500);
  }, [feedbackStep, onTimerExpire, onOof]);

  /* Global Enter key handler — respects the lock */
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== "Enter") return;
      if (document.activeElement === inputRef.current) return;
      if (feedbackStep === "idle" && canSubmit) { e.preventDefault(); checkAndReveal(); }
      else if (feedbackStep === "verified")      { e.preventDefault(); confirmAndAdvance(); }
      // "locked" state: Enter is silently ignored
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [feedbackStep, checkAndReveal, confirmAndAdvance]);

  const canSubmit = question.type === "reading" ? !!selected : typed.trim().length > 0;
  const isTyping  = question.type !== "reading";
  const isLocked  = feedbackStep === "locked";
  const isVerified= feedbackStep === "verified";

  const fbBtn = result === true
    ? { label:"⚔  Strike!", bg:"linear-gradient(135deg,#065f46,#047857)", border:"#10b981", color:"#ecfdf5", shadow:"0 4px 18px rgba(16,185,129,0.35)" }
    : { label:"Take Damage →", bg:"linear-gradient(135deg,#7f1d1d,#991b1b)", border:"#ef4444", color:"#fecaca", shadow:"0 4px 18px rgba(239,68,68,0.3)" };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{
        borderRadius:13, padding:"15px",
        background:"rgba(255,255,255,0.022)",
        border:`1px solid ${(isVerified||isLocked)?(result?"rgba(16,185,129,0.45)":"rgba(239,68,68,0.45)"):"rgba(255,255,255,0.07)"}`,
        boxShadow:(isVerified||isLocked)?(result?"0 0 20px rgba(16,185,129,0.16)":"0 0 20px rgba(239,68,68,0.14)"):"none",
        transition:"border-color 0.25s, box-shadow 0.25s",
        animation:"slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:14 }}>{question.type==="reading"?"👁":question.type==="listening"?"🔊":"✏️"}</span>
            {question.type==="listening" && <PlayAudio text={question.polish} size="md" autoPlay={feedbackStep==="idle"} key={`auto-${question.id}`}/>}
          </div>
          {isBoss && feedbackStep==="idle" && <BossTimer key={timerKey.current} totalSeconds={bossTimerSeconds} onExpire={handleTimerFire}/>}
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div style={{ fontFamily:"monospace" }}>
            {question.type==="reading"  && <div style={{ fontSize:24, fontWeight:900, color:"#f8fafc" }}>{question.polish}</div>}
            {question.type==="listening"&& <div style={{ fontSize:12, color:"#475569", fontStyle:"italic" }}>Translate what you hear</div>}
            {question.type==="writing"  && <div><div style={{ fontSize:9, color:"#475569", marginBottom:3 }}>How do you say:</div><div style={{ fontSize:20, fontWeight:900, color:"#f8fafc" }}>{question.english}</div></div>}
          </div>
          {question.type==="reading" && <PlayAudio text={question.polish} size="sm"/>}
        </div>

        {/* MC options */}
        {question.type==="reading" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:7 }}>
            {question.options.map((opt,i)=>{
              const sel   = selected===opt.label;
              const right = (isVerified||isLocked) && opt.label.toLowerCase()===question.answer.toLowerCase();
              const wrong = (isVerified||isLocked) && opt.label===selected && !right;
              return (
                <button key={i} onClick={()=>feedbackStep==="idle"&&setSelected(opt.label)}
                  style={{ padding:"10px 9px", borderRadius:10, textAlign:"center", fontFamily:"monospace", fontSize:12, fontWeight:sel?700:400, cursor:feedbackStep==="idle"?"pointer":"default", transition:"all 0.13s", display:"flex", flexDirection:"column", gap:2, alignItems:"center",
                    border:`2px solid ${right?"rgba(16,185,129,0.6)":wrong?"rgba(239,68,68,0.5)":sel?"rgba(99,102,241,0.65)":"rgba(255,255,255,0.07)"}`,
                    background:right?"rgba(16,185,129,0.1)":wrong?"rgba(239,68,68,0.09)":sel?"rgba(99,102,241,0.11)":"rgba(255,255,255,0.02)",
                    color:right?"#6ee7b7":wrong?"#fca5a5":sel?"#c7d2fe":"#94a3b8",
                  }}>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Text input */}
        {isTyping && (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <input ref={inputRef} value={typed} onChange={e=>feedbackStep==="idle"&&setTyped(e.target.value)}
              onKeyDown={e=>{
                if (e.key==="Enter") {
                  e.preventDefault();
                  if (feedbackStep==="idle" && canSubmit) checkAndReveal();
                  else if (feedbackStep==="verified") confirmAndAdvance();
                  // "locked": silently blocked
                }
              }}
              disabled={isVerified||isLocked}
              placeholder={question.type==="listening"?"Type the English meaning…":"Type in Polish…"}
              style={{ padding:"11px 13px", borderRadius:9, fontFamily:"monospace", fontSize:14, background:(isVerified||isLocked)?(result?"rgba(16,185,129,0.09)":"rgba(239,68,68,0.07)"):"rgba(255,255,255,0.05)", border:`1px solid ${(isVerified||isLocked)?(result?"rgba(16,185,129,0.4)":"rgba(239,68,68,0.35)"):"rgba(255,255,255,0.09)"}`, color:"#f8fafc", outline:"none", transition:"border-color 0.2s" }}
              onFocus={e=>feedbackStep==="idle"&&(e.target.style.borderColor="rgba(99,102,241,0.5)")}
              onBlur={e=>feedbackStep==="idle"&&(e.target.style.borderColor="rgba(255,255,255,0.09)")}
            />
            {(isVerified||isLocked) && !result && (
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:8, background:"rgba(16,185,129,0.07)", border:"1px solid rgba(16,185,129,0.18)" }}>
                <PlayAudio text={question.polish} size="sm"/>
                <span style={{ fontSize:12, color:"#6ee7b7", fontFamily:"monospace", fontWeight:700 }}>
                  {question.type==="listening" ? question.english : question.polish}
                </span>
              </div>
            )}
          </div>
        )}

        {/* STEP 1: Check Answer button */}
        {feedbackStep==="idle" && (
          <button onClick={checkAndReveal} disabled={!canSubmit}
            style={{ marginTop:10, width:"100%", padding:"12px", borderRadius:10, fontFamily:"monospace", fontWeight:900, fontSize:11, letterSpacing:"0.1em",
              background:canSubmit?"linear-gradient(135deg,#1d4ed8,#3b82f6)":"rgba(255,255,255,0.03)",
              border:`1px solid ${canSubmit?"#60a5fa":"rgba(255,255,255,0.05)"}`,
              color:canSubmit?"#eff6ff":"#1e293b", cursor:canSubmit?"pointer":"not-allowed",
              transition:"all 0.17s", boxShadow:canSubmit?"0 3px 16px rgba(59,130,246,0.28)":"none",
            }}>CHECK ANSWER <span style={{ opacity:0.5, fontSize:9 }}>[Enter]</span></button>
        )}

        {/* LOCKED: show processing indicator during 500ms lock */}
        {isLocked && (
          <div style={{ marginTop:10, width:"100%", padding:"12px", borderRadius:10, fontFamily:"monospace", fontSize:11, letterSpacing:"0.1em", textAlign:"center", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", color:"#334155" }}>
            {result ? "✓ Correct…" : "✗ Wrong…"}
          </div>
        )}
      </div>

      {/* STEP 2: Tutor + confirm button (only shown in verified state) */}
      {isVerified && (
        <div style={{ display:"flex", flexDirection:"column", gap:8, animation:"slideUp 0.22s ease" }}>
          <button onClick={()=>setShowTutor(p=>!p)}
            style={{ padding:"6px 11px", borderRadius:7, fontSize:9, fontFamily:"monospace", fontWeight:700, cursor:"pointer", alignSelf:"flex-start", background:showTutor?"rgba(99,102,241,0.16)":"rgba(99,102,241,0.07)", border:"1px solid rgba(99,102,241,0.22)", color:"#818cf8", transition:"all 0.14s" }}>
            {showTutor?"✕ Close Explanation":"🎓 Explain This"}
          </button>
          {showTutor && <TutorPanel catKey={question.cat} onClose={()=>setShowTutor(false)}/>}
          <button onClick={confirmAndAdvance}
            style={{ padding:"13px", borderRadius:10, fontFamily:"monospace", fontWeight:900, fontSize:12, letterSpacing:"0.1em", cursor:"pointer",
              background:fbBtn.bg, border:`1px solid ${fbBtn.border}`, color:fbBtn.color,
              boxShadow:fbBtn.shadow, transition:"all 0.17s",
            }}>{fbBtn.label} <span style={{ opacity:0.5, fontSize:9 }}>[Enter]</span></button>
        </div>
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §12  BATTLE SUMMARY OVERLAY
══════════════════════════════════════════════════════════════════════════════ */
function BattleSummary({ stats, room, dungeon, onContinue }) {
  const { newWordsSeen, wordsMastered, goldEarned, xpEarned } = stats;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:500, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.72)", backdropFilter:"blur(6px)", animation:"fadeIn 0.28s ease" }}>
      <div style={{ maxWidth:360, width:"90%", borderRadius:18, overflow:"hidden", background:"#0d1321", border:"1px solid rgba(255,255,255,0.08)", boxShadow:"0 24px 80px rgba(0,0,0,0.8)", animation:"slideUp 0.35s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ padding:"18px 20px", background:`linear-gradient(135deg,${dungeon.bg},transparent)`, borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ fontSize:8, fontFamily:"monospace", color:dungeon.color, letterSpacing:"0.2em", marginBottom:3 }}>PROGRESS REPORT</div>
          <div style={{ fontSize:16, fontWeight:900, color:"#f8fafc", fontFamily:"monospace" }}>{room.enemyName} Defeated</div>
        </div>
        <div style={{ padding:"18px 20px", display:"flex", flexDirection:"column", gap:10 }}>
          {[
            { label:"New Words Seen",  val:newWordsSeen,       col:"#6366f1", icon:"📖" },
            { label:"Words Mastered",  val:wordsMastered,      col:"#10b981", icon:"✓"  },
            { label:"Gold Earned",     val:`+${goldEarned}🪙`, col:"#f59e0b", icon:"🪙" },
            { label:"XP Earned",       val:`+${xpEarned}`,    col:"#818cf8", icon:"⭐" },
          ].map(s=>(
            <div key={s.label} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 10px", borderRadius:8, background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:13 }}>{s.icon}</span>
                <span style={{ fontSize:11, color:"#64748b", fontFamily:"monospace" }}>{s.label}</span>
              </div>
              <span style={{ fontSize:13, fontWeight:900, color:s.col, fontFamily:"monospace" }}>{s.val}</span>
            </div>
          ))}
        </div>
        <div style={{ padding:"0 20px 20px" }}>
          <button onClick={onContinue}
            style={{ width:"100%", padding:"12px", borderRadius:10, fontFamily:"monospace", fontWeight:900, fontSize:11, cursor:"pointer", letterSpacing:"0.08em", background:`linear-gradient(135deg,${dungeon.color}88,${dungeon.color})`, border:`1px solid ${dungeon.color}`, color:"#f8fafc", boxShadow:`0 3px 18px ${dungeon.color}44` }}>
            CONTINUE →
          </button>
        </div>
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §13  REVIVAL OVERLAY
══════════════════════════════════════════════════════════════════════════════ */
function RevivalOverlay({ gold, onSpendGold, onGiveUp }) {
  const canAfford = gold >= 30;
  return (
    <div style={{ position:"fixed", inset:0, zIndex:600, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.88)", backdropFilter:"blur(8px)", animation:"fadeIn 0.3s ease" }}>
      <div style={{ maxWidth:340, width:"90%", borderRadius:18, overflow:"hidden", background:"#0d1321", border:"1px solid rgba(239,68,68,0.4)", boxShadow:"0 24px 80px rgba(239,68,68,0.2)", animation:"slideUp 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ padding:"22px 20px", textAlign:"center", borderBottom:"1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ fontSize:44, marginBottom:10, animation:"float 2s ease infinite" }}>💀</div>
          <div style={{ fontSize:8, fontFamily:"monospace", color:"#ef4444", letterSpacing:"0.2em", marginBottom:4 }}>YOU FELL IN BATTLE</div>
          <div style={{ fontSize:16, fontWeight:900, color:"#f8fafc", fontFamily:"monospace", marginBottom:8 }}>Revival?</div>
          <div style={{ fontSize:10, color:"#475569", fontFamily:"monospace" }}>Spend 30 Gold to gain 1 life and continue — or retreat.</div>
        </div>
        <div style={{ padding:"18px 20px", display:"flex", flexDirection:"column", gap:10 }}>
          <button onClick={canAfford?onSpendGold:undefined} disabled={!canAfford}
            style={{ padding:"13px", borderRadius:10, fontFamily:"monospace", fontWeight:900, fontSize:12, letterSpacing:"0.08em", cursor:canAfford?"pointer":"not-allowed", background:canAfford?"linear-gradient(135deg,#78350f,#d97706)":"rgba(255,255,255,0.03)", border:`1px solid ${canAfford?"#f59e0b":"rgba(255,255,255,0.05)"}`, color:canAfford?"#fef3c7":"#334155", boxShadow:canAfford?"0 3px 16px rgba(245,158,11,0.3)":"none", transition:"all 0.18s" }}>
            🪙 Spend 30 Gold to Revive {!canAfford&&<span style={{ fontSize:9, opacity:0.6 }}>(insufficient)</span>}
          </button>
          <button onClick={onGiveUp}
            style={{ padding:"11px", borderRadius:10, fontFamily:"monospace", fontWeight:700, fontSize:11, letterSpacing:"0.08em", cursor:"pointer", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", color:"#475569", transition:"all 0.18s" }}>
            ← Give Up (Return to Dashboard)
          </button>
        </div>
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §13b  COMBAT SCREEN  — Phase 10: replay mode (gold multiplier)
══════════════════════════════════════════════════════════════════════════════ */
function CombatScreen({ dungeon, stage, room, isBoss, wordPool, ledger, dispatchLedger, onRoomCleared, onPlayerDamage, onBack, lives, onSpendGold, gold, onGiveUp, isReplay }) {
  const [enemyHp,      setEnemyHp]     = useState(10);
  const [question,     setQuestion]    = useState(null);
  const [lastId,       setLastId]      = useState(null);
  const [shakeKey,     setShakeKey]    = useState(0);
  const [oofVignette,  setOofVignette] = useState(false);
  const [phase,        setPhase]       = useState("fighting");
  const [showSummary,  setShowSummary] = useState(false);
  const alive = useRef(true);
  const statsRef = useRef({ newWordsSeen:0, wordsMastered:0 });

  // Phase 10: replay economy — 20% gold rewards
  const effectiveGold = isReplay ? Math.max(1, Math.round(room.gold * 0.20)) : room.gold;
  const effectiveXp   = isReplay ? room.xp : room.xp;  // XP unchanged in replay

  useEffect(()=>{
    alive.current=true; spawn(null);
    return ()=>{ alive.current=false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const spawn = useCallback((prevId) => {
    const q = generateQuestion(wordPool, ledger, prevId);
    if (q) setQuestion(q);
  }, [wordPool, ledger]);

  const triggerOofVignette = useCallback(() => {
    setOofVignette(true);
    setTimeout(() => setOofVignette(false), 600);
  }, []);

  const handleAnswer = useCallback((ok, raw) => {
    if (!alive.current || !question) return;
    const action = ok ? "BATTLE_CORRECT" : "BATTLE_WRONG";
    dispatchLedger({ type:action, wordId:question.wordId });

    if (ok) {
      const prev      = ledger[question.wordId];
      const prevTier  = scoreToTier(prev, question.wordId in ledger);
      const prevScore = prev===undefined?0:prev===TRAINING_SCORE?0:prev<0?0:prev;
      if (prevScore + 1 >= MASTERY_THRESHOLD && prevTier !== "mastered") statsRef.current.wordsMastered++;
      if (prevTier === "unseen" || prevTier === "training") statsRef.current.newWordsSeen++;
    }

    if (ok) {
      const newHp = enemyHp - 1;
      setShakeKey(k=>k+1);
      setEnemyHp(newHp);
      if (newHp <= 0) { setPhase("victory"); return; }
      setTimeout(()=>{ if (alive.current) spawn(question.wordId); }, 280);
    } else {
      onPlayerDamage();
      setTimeout(()=>{ if (alive.current) spawn(question.wordId); }, 380);
    }
    setLastId(question.wordId);
  }, [question, enemyHp, spawn, onPlayerDamage, dispatchLedger, ledger]);

  const handleTimerExpire = useCallback(()=>{
    if (!alive.current) return;
    dispatchLedger({ type:"BATTLE_WRONG", wordId:question?.wordId });
    onPlayerDamage();
    setTimeout(()=>{ if (alive.current) spawn(lastId); }, 360);
  }, [question, lastId, spawn, onPlayerDamage, dispatchLedger]);

  const summaryStats = {
    newWordsSeen:  statsRef.current.newWordsSeen,
    wordsMastered: statsRef.current.wordsMastered,
    goldEarned:    effectiveGold,
    xpEarned:      effectiveXp,
  };

  const showRevival = lives <= 0 && phase === "fighting";

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
        <button onClick={onBack} style={{ background:"none",border:"none",color:"#334155",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0 }}>
          ← {stage.name}
        </button>
        {isReplay && <span style={{ fontSize:7,padding:"1px 5px",borderRadius:3,background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.3)",color:"#f59e0b",fontFamily:"monospace",fontWeight:700 }}>REPLAY · 20% GOLD</span>}
      </div>

      {/* Enemy panel */}
      <div key={shakeKey} style={{ borderRadius:13, padding:"14px 15px",
        background:isBoss?"rgba(239,68,68,0.08)":dungeon.bg,
        border:`1px solid ${isBoss?"rgba(239,68,68,0.32)":dungeon.border}`,
        boxShadow:isBoss?"0 0 30px rgba(239,68,68,0.1)":"none",
        animation:shakeKey>0?"shake 0.36s ease":"none",
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div>
            <div style={{ fontSize:8, fontFamily:"monospace", color:isBoss?"#f87171":dungeon.color, letterSpacing:"0.14em", marginBottom:2 }}>
              {isBoss?"⚠ STAGE BOSS":dungeon.cefr} · {stage.name.toUpperCase()}
            </div>
            <div style={{ fontSize:13, fontWeight:900, color:"#f8fafc", fontFamily:"monospace" }}>{room.enemyName}</div>
            {isBoss && <div style={{ fontSize:9, color:"#334155", fontStyle:"italic", marginTop:2 }}>{room.lore}</div>}
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
            <div style={{ fontSize:40, lineHeight:1, animation:"float 3s ease infinite" }}>
              {phase==="victory"?"💥":room.emoji}
            </div>
            <div style={{ display:"flex", gap:3 }}>
              {Array.from({length:3}).map((_,i)=>(
                <span key={i} style={{ fontSize:14, filter:i<lives?"none":"grayscale(1) opacity(0.25)" }}>❤</span>
              ))}
            </div>
          </div>
        </div>
        <HpBar current={enemyHp} max={10} color={isBoss?"#ef4444":dungeon.color} label={room.enemyName}/>
      </div>

      {oofVignette && (
        <div style={{ position:"fixed",inset:0,pointerEvents:"none",zIndex:999,
          background:"radial-gradient(ellipse at center, transparent 30%, rgba(220,38,38,0.55) 100%)",
          animation:"flashOut 0.6s ease forwards" }}/>
      )}

      {showRevival && (
        <RevivalOverlay gold={gold} onSpendGold={onSpendGold} onGiveUp={onGiveUp}/>
      )}

      {phase==="victory" ? (
        <>
          {showSummary && (
            <BattleSummary
              stats={summaryStats} room={room} dungeon={dungeon}
              onContinue={()=>{ setShowSummary(false); onRoomCleared(effectiveXp, effectiveGold); }}
            />
          )}
          <div style={{ textAlign:"center", padding:"26px 16px", borderRadius:13, background:"rgba(16,185,129,0.07)", border:"1px solid rgba(16,185,129,0.2)", animation:"slideUp 0.38s cubic-bezier(0.34,1.56,0.64,1)" }}>
            <div style={{ fontSize:36, marginBottom:7 }}>🏆</div>
            <div style={{ fontSize:14, fontWeight:900, color:"#34d399", fontFamily:"monospace", marginBottom:3 }}>{room.enemyName} DEFEATED</div>
            <div style={{ fontSize:9, color:"#334155", fontFamily:"monospace", marginBottom:15 }}>+{effectiveXp} XP · +{effectiveGold} 🪙{isReplay?" (replay rate)":""}</div>
            <button onClick={()=>setShowSummary(true)}
              style={{ padding:"10px 26px", borderRadius:9, fontFamily:"monospace", fontWeight:900, fontSize:11, cursor:"pointer", letterSpacing:"0.08em", background:"linear-gradient(135deg,#065f46,#047857)", border:"1px solid #10b981", color:"#ecfdf5", boxShadow:"0 3px 16px rgba(16,185,129,0.28)" }}>
              VIEW PROGRESS REPORT →
            </button>
          </div>
        </>
      ) : (
        !showRevival && question && (
          <QuestionCard
            question={question} onAnswer={handleAnswer}
            isBoss={isBoss} bossTimerSeconds={room.bossTimerSeconds??10}
            onTimerExpire={handleTimerExpire}
            onOof={triggerOofVignette}
          />
        )
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §14  STAGE MAP  — Phase 10: replay button on cleared stages
══════════════════════════════════════════════════════════════════════════════ */
function StageMap({ dungeon, stage, completedRooms, bossCleared, onEnterRoom, onEnterBoss, onBack }) {
  if (!stage || !stage.rooms) return null;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <button onClick={onBack} style={{ background:"none",border:"none",color:"#334155",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0,alignSelf:"flex-start" }}>← {dungeon.name}</button>
      <div style={{ padding:"15px 17px", borderRadius:14, background:dungeon.bg, border:`1px solid ${dungeon.border}`, boxShadow:`0 0 30px ${dungeon.color}12` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:8, fontFamily:"monospace", color:dungeon.color, letterSpacing:"0.18em", marginBottom:2 }}>{dungeon.cefr} · STAGE {stage.index}</div>
            <div style={{ fontSize:17, fontWeight:900, color:"#f8fafc", fontFamily:"monospace" }}>{stage.name}</div>
          </div>
          <div style={{ fontSize:32, animation:"float 4s ease infinite" }}>{stage.icon}</div>
        </div>
        <div style={{ marginTop:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, fontFamily:"monospace", color:"#1e293b", marginBottom:3 }}>
            <span>ROOMS</span>
            <span>{Math.min(completedRooms, stage.rooms.length)}/{stage.rooms.length} + BOSS</span>
          </div>
          <div style={{ display:"flex", gap:3 }}>
            {stage.rooms.map((_,i)=>(
              <div key={i} style={{ flex:1, height:4, borderRadius:2, background:i<completedRooms?dungeon.color:"rgba(255,255,255,0.05)", boxShadow:i<completedRooms?`0 0 4px ${dungeon.color}66`:"none" }}/>
            ))}
            <div style={{ width:16, height:4, borderRadius:2, background:bossCleared?"#ef4444":"rgba(255,255,255,0.05)" }}/>
          </div>
        </div>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
        {stage.rooms.map((room,idx)=>{
          const cleared=idx<completedRooms, current=idx===completedRooms, locked=idx>completedRooms;
          return (
            <button key={room.id}
              disabled={locked}
              onClick={()=>{
                if (current) onEnterRoom(room, false);
                else if (cleared) onEnterRoom(room, true); // replay
              }}
              style={{ width:"100%",textAlign:"left",padding:"12px 14px",borderRadius:10,
                background:cleared?"rgba(16,185,129,0.05)":current?dungeon.bg:"rgba(255,255,255,0.01)",
                border:`1px solid ${cleared?"rgba(16,185,129,0.15)":current?dungeon.border:"rgba(255,255,255,0.04)"}`,
                cursor:locked?"default":"pointer", transition:"all 0.17s" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:20, filter:locked?"grayscale(1) opacity(0.2)":"none" }}>{locked?"🔒":room.emoji}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11,fontWeight:700,color:locked?"#1e293b":"#f8fafc",fontFamily:"monospace",marginBottom:1 }}>{room.name}</div>
                  <div style={{ fontSize:9,color:locked?"#0f172a":"#334155",fontFamily:"monospace" }}>{room.enemyName} · 10HP · +{room.gold}🪙</div>
                </div>
                {current&&<span style={{ fontSize:8,padding:"3px 8px",borderRadius:5,background:`${dungeon.color}1a`,border:`1px solid ${dungeon.color}44`,color:dungeon.color,fontFamily:"monospace",fontWeight:700 }}>ENTER</span>}
                {cleared&&<span style={{ fontSize:8,padding:"3px 7px",borderRadius:5,background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.25)",color:"#f59e0b",fontFamily:"monospace",fontWeight:700 }}>REPLAY ↺</span>}
              </div>
            </button>
          );
        })}

        {(()=>{
          const bossUnlocked = completedRooms >= stage.rooms.length;
          const b = stage.boss;
          return (
            <button
              disabled={!bossUnlocked}
              onClick={()=>bossUnlocked&&onEnterBoss(b, bossCleared)}
              style={{ width:"100%",textAlign:"left",padding:"12px 14px",borderRadius:10,
                background:bossCleared?"rgba(16,185,129,0.05)":bossUnlocked?"rgba(239,68,68,0.08)":"rgba(255,255,255,0.01)",
                border:`1px solid ${bossCleared?"rgba(16,185,129,0.15)":bossUnlocked?"rgba(239,68,68,0.3)":"rgba(255,255,255,0.04)"}`,
                cursor:bossUnlocked?"pointer":"default", transition:"all 0.17s",
                boxShadow:bossUnlocked&&!bossCleared?"0 0 18px rgba(239,68,68,0.1)":"none" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:24,animation:bossUnlocked&&!bossCleared?"float 2s ease infinite":"none",filter:!bossUnlocked?"grayscale(1) opacity(0.2)":"none" }}>
                  {!bossUnlocked?"🔒":b.emoji}
                </span>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:1 }}>
                    <span style={{ fontSize:11,fontWeight:700,color:!bossUnlocked?"#0f172a":"#f8fafc",fontFamily:"monospace" }}>{b.name}</span>
                    {!bossCleared&&bossUnlocked&&<span style={{ fontSize:8,padding:"1px 5px",borderRadius:3,background:"rgba(239,68,68,0.18)",border:"1px solid rgba(239,68,68,0.35)",color:"#f87171",fontFamily:"monospace",fontWeight:700 }}>BOSS</span>}
                  </div>
                  <div style={{ fontSize:9,color:!bossUnlocked?"#0f172a":"#334155",fontFamily:"monospace" }}>{b.enemyName} · 10HP · ⏱ TIMED · +{b.gold}🪙</div>
                </div>
                {bossUnlocked&&!bossCleared&&<span style={{ fontSize:8,padding:"3px 8px",borderRadius:5,background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.35)",color:"#f87171",fontFamily:"monospace",fontWeight:700 }}>FIGHT</span>}
                {bossCleared&&<span style={{ fontSize:8,padding:"3px 7px",borderRadius:5,background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.25)",color:"#f59e0b",fontFamily:"monospace",fontWeight:700 }}>REPLAY ↺</span>}
              </div>
            </button>
          );
        })()}
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §15  DUNGEON SELECT — Phase 10: cleared stages show REPLAY badge + still clickable
══════════════════════════════════════════════════════════════════════════════ */
function DungeonSelect({ dungeon, dungeonProgress, onEnterStage, onBack }) {
  if (!dungeon || !Array.isArray(dungeon.stages)) return null;
  const prog          = dungeonProgress[dungeon.id] ?? { stagesCleared:0 };
  const stagesCleared = prog.stagesCleared ?? 0;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <button onClick={onBack} style={{ background:"none",border:"none",color:"#334155",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0,alignSelf:"flex-start" }}>← Dashboard</button>
      <div style={{ padding:"16px 18px", borderRadius:14, background:dungeon.bg, border:`1px solid ${dungeon.border}`, boxShadow:`0 0 36px ${dungeon.color}12` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:8,fontFamily:"monospace",color:dungeon.color,letterSpacing:"0.18em",marginBottom:3 }}>{dungeon.cefr} · DUNGEON</div>
            <div style={{ fontSize:17,fontWeight:900,color:"#f8fafc",fontFamily:"monospace" }}>{dungeon.name}</div>
            <div style={{ fontSize:10,color:"#475569",marginTop:2 }}>{dungeon.subtitle}</div>
          </div>
          <div style={{ fontSize:36, animation:"float 4s ease infinite" }}>{dungeon.icon}</div>
        </div>
        <div style={{ marginTop:12 }}>
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:8,fontFamily:"monospace",color:"#1e293b",marginBottom:3 }}>
            <span>STAGES</span><span>{stagesCleared}/{dungeon.stages.length}</span>
          </div>
          <div style={{ height:4,background:"rgba(255,255,255,0.04)",borderRadius:2,overflow:"hidden" }}>
            <div style={{ height:"100%",width:`${dungeon.stages.length>0?(stagesCleared/dungeon.stages.length)*100:0}%`,background:dungeon.color,borderRadius:2,transition:"width 0.5s ease" }}/>
          </div>
        </div>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
        {dungeon.stages.map((stage, idx) => {
          const cleared=idx<stagesCleared, current=idx===stagesCleared, locked=idx>stagesCleared;
          const stageRoomsCleared = prog[`s${stage.index}_rooms`]??0;
          const stageBossCleared  = !!(prog[`s${stage.index}_boss`]);
          return (
            <button key={stage.id}
              disabled={locked}
              onClick={()=>!locked&&onEnterStage(stage, cleared)}  // pass isReplay flag
              style={{ width:"100%",textAlign:"left",padding:"13px 15px",borderRadius:11,
                background:cleared?"rgba(16,185,129,0.05)":current?dungeon.bg:"rgba(255,255,255,0.01)",
                border:`1px solid ${cleared?"rgba(16,185,129,0.16)":current?dungeon.border:"rgba(255,255,255,0.04)"}`,
                cursor:!locked?"pointer":"default", opacity:locked?0.4:1, transition:"all 0.17s" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:24, filter:locked?"grayscale(1)":"none" }}>{locked?"🔒":stage.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:2 }}>
                    <span style={{ fontSize:8,padding:"1px 5px",borderRadius:3,background:`${dungeon.color}18`,border:`1px solid ${dungeon.color}44`,color:dungeon.color,fontFamily:"monospace",fontWeight:700 }}>S{stage.index}</span>
                    <span style={{ fontSize:12,fontWeight:700,color:locked?"#1e293b":"#f8fafc",fontFamily:"monospace" }}>{stage.name}</span>
                    {cleared&&<span style={{ fontSize:8,color:"#34d399",fontFamily:"monospace",fontWeight:700 }}>CLEARED ✓</span>}
                  </div>
                  <div style={{ fontSize:9,color:locked?"#0f172a":"#334155",fontFamily:"monospace" }}>{stage.rooms.length} rooms · 1 boss</div>
                  {current&&!locked&&(
                    <div style={{ marginTop:4,display:"flex",gap:2 }}>
                      {stage.rooms.map((_,i)=>(<div key={i} style={{ width:12,height:3,borderRadius:1,background:i<stageRoomsCleared?dungeon.color:"rgba(255,255,255,0.05)" }}/>))}
                      <div style={{ width:6,height:3,borderRadius:1,background:stageBossCleared?"#ef4444":"rgba(255,255,255,0.05)" }}/>
                    </div>
                  )}
                </div>
                {current&&!locked&&<span style={{ fontSize:8,padding:"3px 8px",borderRadius:5,background:`${dungeon.color}1a`,border:`1px solid ${dungeon.color}44`,color:dungeon.color,fontFamily:"monospace",fontWeight:700 }}>ENTER</span>}
                {cleared&&<span style={{ fontSize:8,padding:"3px 7px",borderRadius:5,background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.25)",color:"#f59e0b",fontFamily:"monospace",fontWeight:700 }}>REPLAY ↺</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §16  DASHBOARD COMPONENTS
══════════════════════════════════════════════════════════════════════════════ */
function MasteryRing({ counts, masteryPct, size=110 }) {
  const order  = ["mastered","learning","training","unseen"];
  const colors = { mastered:"#10b981", learning:"#f59e0b", training:"#6366f1", unseen:"#1e293b" };
  const total  = Object.values(counts).reduce((a,b)=>a+b, 0) || 1;
  const R=size/2-10, cx=size/2, circ=2*Math.PI*R;
  let off=0;
  const segs = order.map(t=>{
    const pct  = counts[t]/total;
    const dash = circ*pct;
    const s    = { tier:t, da:`${dash} ${circ-dash}`, do:-off, col:colors[t] };
    off+=dash; return s;
  });
  return (
    <div style={{ position:"relative",width:size,height:size,flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={cx} cy={cx} r={R} fill="none" stroke="#0f172a" strokeWidth={10}/>
        {segs.map(s=>(
          <circle key={s.tier} cx={cx} cy={cx} r={R} fill="none" stroke={s.col} strokeWidth={10}
            strokeDasharray={s.da} strokeDashoffset={s.do} strokeLinecap="butt"
            style={{ transition:"stroke-dasharray 0.6s ease" }}/>
        ))}
      </svg>
      <div style={{ position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center" }}>
        <div style={{ fontSize:17,fontWeight:900,color:"#f8fafc",fontFamily:"monospace",lineHeight:1 }}>{masteryPct}%</div>
        <div style={{ fontSize:7,color:"#334155",fontFamily:"monospace",letterSpacing:"0.08em",marginTop:1 }}>MASTERED</div>
      </div>
    </div>
  );
}

function MacroBar({ dungeonProgress, manifest }) {
  const lvls=["A1","A2","B1","B2","C1"];
  const cefrIds=["a1","a2","b1","b2","c1"];
  const activeIdx = cefrIds.findIndex(id=>{
    const d=manifest.find(x=>x.id===id);
    if (!d) return false;
    const sc=dungeonProgress[id]?.stagesCleared??0;
    return sc < d.stages.length;
  });
  const safeIdx = activeIdx<0 ? cefrIds.length-1 : activeIdx;
  const activeMf=manifest[safeIdx];
  const sc=activeMf?(dungeonProgress[activeMf.id]?.stagesCleared??0):0;
  const ts=activeMf?activeMf.stages.length:1;
  const pct=ts>0?(sc/ts)*100:0;
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:7 }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <div style={{ fontSize:8,fontFamily:"monospace",color:"#334155",letterSpacing:"0.12em" }}>CEFR JOURNEY</div>
        <div style={{ fontSize:9,fontFamily:"monospace",color:"#10b981",fontWeight:700 }}>{lvls[safeIdx]}</div>
      </div>
      <div style={{ display:"flex",gap:4,alignItems:"center" }}>
        {lvls.map((lv,i)=>{
          const done=i<safeIdx, active=i===safeIdx;
          return (
            <div key={lv} style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:2,flex:active?3:1 }}>
              <div style={{ fontSize:7,fontFamily:"monospace",color:done?"#10b981":active?"#f8fafc":"#1e293b",fontWeight:700 }}>{lv}</div>
              <div style={{ height:5,width:"100%",borderRadius:3,background:done?"#10b981":active?"rgba(255,255,255,0.07)":"rgba(255,255,255,0.02)",border:`1px solid ${done?"#10b981":active?"rgba(255,255,255,0.14)":"rgba(255,255,255,0.03)"}`,overflow:"hidden",position:"relative" }}>
                {active&&<div style={{ position:"absolute",top:0,left:0,height:"100%",width:`${pct}%`,background:"linear-gradient(90deg,#6366f1,#818cf8)",borderRadius:3,transition:"width 0.6s ease" }}/>}
                {done&&<div style={{ position:"absolute",inset:0,background:"linear-gradient(90deg,#059669,#10b981)" }}/>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlayerDashboard({ ledger, dungeonProgress, xp, gold, level, hp, onPlay, manifest, onWordBank }) {
  const allIds     = useMemo(()=>Object.keys(ledger),[ledger]);
  const counts     = useMemo(()=>tallyLedger(ledger, allIds),[ledger, allIds]);
  const activeDungeon   = manifest.find(d=>!d.locked) ?? manifest[0];
  const masteryPct      = computeMasteryPct(ledger, activeDungeon?.totalWords, allIds);
  const firstDungeon    = manifest.find(d=>!d.locked);
  const stagesCleared   = firstDungeon?(dungeonProgress[firstDungeon.id]?.stagesCleared??0):0;
  const nextStage       = firstDungeon?.stages[stagesCleared];
  const seenCount = (counts.training??0) + (counts.learning??0) + (counts.mastered??0);

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
      <div style={{ padding:"20px 18px",borderRadius:16,background:"linear-gradient(135deg,rgba(99,102,241,0.12) 0%,rgba(16,185,129,0.06) 100%)",border:"1px solid rgba(99,102,241,0.22)",boxShadow:"0 0 40px rgba(99,102,241,0.08)" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14 }}>
          <div>
            <div style={{ fontSize:8,fontFamily:"monospace",color:"#475569",letterSpacing:"0.18em",marginBottom:4 }}>PLAYER PROGRESSION</div>
            <div style={{ fontSize:20,fontWeight:900,color:"#f8fafc",fontFamily:"monospace",lineHeight:1 }}>Level {level}</div>
            <div style={{ fontSize:10,color:"#475569",fontFamily:"monospace",marginTop:3 }}>{xp} XP · {gold}🪙 Gold</div>
          </div>
          <MasteryRing counts={counts} masteryPct={masteryPct} size={90}/>
        </div>
        <MacroBar dungeonProgress={dungeonProgress} manifest={manifest}/>
      </div>

      <div style={{ padding:"14px 16px",borderRadius:12,background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
          <div style={{ fontSize:9,fontFamily:"monospace",color:"#334155",letterSpacing:"0.12em" }}>WORD MASTERY BUCKETS</div>
          <div style={{ fontSize:8,fontFamily:"monospace",color:"#334155" }}>{activeDungeon?.totalWords??0} words in level</div>
        </div>
        <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
          {Object.entries(MASTERY_TIERS).map(([tier,{label,color}])=>{
            const cnt  = counts[tier]??0;
            const disp = tier==="unseen" ? Math.max(0,(activeDungeon?.totalWords??0)-seenCount) : cnt;
            const pct  = (activeDungeon?.totalWords??1) > 0 ? (disp/(activeDungeon?.totalWords??1))*100 : 0;
            return (
              <div key={tier} style={{ display:"flex",alignItems:"center",gap:10 }}>
                <div style={{ width:7,height:7,borderRadius:"50%",background:color,flexShrink:0 }}/>
                <div style={{ fontSize:10,color:"#475569",fontFamily:"monospace",width:68 }}>{label}</div>
                <div style={{ flex:1,height:4,background:"rgba(255,255,255,0.04)",borderRadius:2,overflow:"hidden" }}>
                  <div style={{ height:"100%",width:`${pct}%`,background:color,borderRadius:2,transition:"width 0.5s ease" }}/>
                </div>
                <div style={{ fontSize:10,color,fontFamily:"monospace",fontWeight:700,width:36,textAlign:"right" }}>{disp}</div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize:8,color:"#1e293b",fontFamily:"monospace",borderTop:"1px solid rgba(255,255,255,0.04)",paddingTop:8,marginTop:8 }}>
          Mastered = 5 correct in a row · Immune to regression once mastered
        </div>
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8 }}>
        {[
          {label:"MASTERED", val:counts.mastered??0, col:"#10b981"},
          {label:"LEARNING", val:counts.learning??0, col:"#f59e0b"},
          {label:"TRAINING", val:counts.training??0, col:"#6366f1"},
        ].map(s=>(
          <div key={s.label} style={{ padding:"12px 10px",borderRadius:10,background:"rgba(255,255,255,0.025)",border:`1px solid ${s.col}22`,textAlign:"center" }}>
            <div style={{ fontSize:18,fontWeight:900,color:s.col,fontFamily:"monospace" }}>{s.val}</div>
            <div style={{ fontSize:7,color:"#334155",fontFamily:"monospace",letterSpacing:"0.08em",marginTop:2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {seenCount > 0 && (
        <button onClick={onWordBank}
          style={{ padding:"11px 16px",borderRadius:10,fontFamily:"monospace",fontWeight:700,fontSize:11,letterSpacing:"0.08em",cursor:"pointer",background:"rgba(99,102,241,0.07)",border:"1px solid rgba(99,102,241,0.22)",color:"#818cf8",display:"flex",alignItems:"center",gap:8,justifyContent:"center",transition:"all 0.18s" }}>
          📚 Word Bank <span style={{ fontSize:9,opacity:0.6 }}>({seenCount} words)</span>
        </button>
      )}

      <button onClick={()=>onPlay()} style={{ padding:"16px",borderRadius:12,fontFamily:"monospace",fontWeight:900,fontSize:14,letterSpacing:"0.1em",cursor:"pointer",background:"linear-gradient(135deg,#4f46e5 0%,#10b981 100%)",border:"none",color:"#f8fafc",boxShadow:"0 4px 24px rgba(99,102,241,0.3), 0 4px 24px rgba(16,185,129,0.15)" }}>
        {nextStage?`▶  ENTER ${nextStage.name.toUpperCase()}`:"▶  BEGIN YOUR JOURNEY"}
      </button>

      <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
        <div style={{ fontSize:8,fontFamily:"monospace",color:"#1e293b",letterSpacing:"0.12em" }}>DUNGEONS</div>
        {manifest.map(d=>{
          const prog=dungeonProgress[d.id]?.stagesCleared??0, tot=d.stages.length;
          return (
            <button key={d.id} onClick={()=>onPlay(d)}
              style={{ width:"100%",textAlign:"left",padding:"11px 14px",borderRadius:10,background:d.bg,border:`1px solid ${d.border}`,cursor:"pointer",transition:"all 0.18s" }}>
              <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                <span style={{ fontSize:22,animation:"float 4s ease infinite" }}>{d.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:2 }}>
                    <span style={{ fontSize:8,padding:"1px 5px",borderRadius:3,background:`${d.color}1a`,border:`1px solid ${d.color}44`,color:d.color,fontFamily:"monospace",fontWeight:900 }}>{d.cefr}</span>
                    <span style={{ fontSize:12,fontWeight:700,color:"#f8fafc",fontFamily:"monospace" }}>{d.name}</span>
                  </div>
                  {tot>0&&<div style={{ height:3,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden" }}><div style={{ height:"100%",width:`${(prog/tot)*100}%`,background:d.color,borderRadius:2 }}/></div>}
                </div>
                <span style={{ fontSize:8,color:d.color,fontFamily:"monospace",fontWeight:700 }}>{prog}/{tot}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §17  WORD BANK VIEW — Phase 10: CEFR level filter + unseen count per level
   
   Allows filtering by CEFR level.
   Shows Polish / English / Audio for every non-Unseen word.
   Also shows a summary row of Unseen counts per level.
══════════════════════════════════════════════════════════════════════════════ */
function WordBankView({ ledger, onBack }) {
  const [filter,      setFilter]      = useState("all");       // all | training | learning | mastered
  const [cefrFilter,  setCefrFilter]  = useState("all");       // all | a1 | a2 | b1 | b2 | c1
  const [search,      setSearch]      = useState("");

  // Gather all seen words + their CEFR level from ALL vocab chunks
  const allVocab = useMemo(() => {
    const words = [];
    for (const [chunkId, chunk] of Object.entries(MOCK_VOCAB_CHUNKS)) {
      const cefrLevel = chunkId.split("-")[0];  // "a1-s1" → "a1"
      for (const w of chunk) {
        const tier = scoreToTier(ledger[w.id], w.id in ledger);
        words.push({ ...w, tier, cefrLevel });
      }
    }
    return words;
  }, [ledger]);

  // Unseen counts per CEFR level (for info row)
  const unseenByLevel = useMemo(() => {
    const m = {};
    for (const w of allVocab) {
      if (!m[w.cefrLevel]) m[w.cefrLevel] = { unseen:0, seen:0 };
      if (w.tier === "unseen") m[w.cefrLevel].unseen++;
      else m[w.cefrLevel].seen++;
    }
    return m;
  }, [allVocab]);

  const seenVocab = useMemo(() => allVocab.filter(w => w.tier !== "unseen"), [allVocab]);

  const filtered = useMemo(() => {
    let list = seenVocab;
    if (cefrFilter !== "all") list = list.filter(w => w.cefrLevel === cefrFilter);
    if (filter !== "all")     list = list.filter(w => w.tier === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(w => w.polish.toLowerCase().includes(q) || w.english.toLowerCase().includes(q));
    }
    const order = { mastered:0, learning:1, training:2 };
    return [...list].sort((a,b) => (order[a.tier]??3) - (order[b.tier]??3));
  }, [seenVocab, cefrFilter, filter, search]);

  const tierColors = { training:"#6366f1", learning:"#f59e0b", mastered:"#10b981" };
  const tierLabels = { training:"Training", learning:"Learning", mastered:"Mastered" };
  const cefrLevels = ["a1","a2","b1","b2","c1"];
  const cefrLabels = { a1:"A1", a2:"A2", b1:"B1", b2:"B2", c1:"C1" };
  const cefrColors = { a1:"#10b981", a2:"#3b82f6", b1:"#a855f7", b2:"#f97316", c1:"#ec4899" };

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
      <button onClick={onBack} style={{ background:"none",border:"none",color:"#334155",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0,alignSelf:"flex-start" }}>← Dashboard</button>

      <div style={{ padding:"14px 16px",borderRadius:13,background:"rgba(99,102,241,0.07)",border:"1px solid rgba(99,102,241,0.22)" }}>
        <div style={{ fontSize:8,fontFamily:"monospace",color:"#818cf8",letterSpacing:"0.18em",marginBottom:3 }}>📚 WORD BANK</div>
        <div style={{ fontSize:16,fontWeight:900,color:"#f8fafc",fontFamily:"monospace" }}>Your Vocabulary</div>
        <div style={{ fontSize:9,color:"#475569",fontFamily:"monospace",marginTop:2 }}>{seenVocab.length} words encountered · {seenVocab.filter(w=>w.tier==="mastered").length} mastered</div>
      </div>

      {/* CEFR level breakdown info */}
      <div style={{ display:"flex",gap:5,flexWrap:"wrap" }}>
        {cefrLevels.map(lv=>{
          const stats = unseenByLevel[lv] ?? { unseen:0, seen:0 };
          const total = stats.unseen + stats.seen;
          if (total === 0) return null;
          return (
            <div key={lv} style={{ padding:"5px 8px",borderRadius:7,background:`${cefrColors[lv]}10`,border:`1px solid ${cefrColors[lv]}33`,fontSize:8,fontFamily:"monospace" }}>
              <span style={{ color:cefrColors[lv],fontWeight:700 }}>{cefrLabels[lv]}</span>
              <span style={{ color:"#475569",marginLeft:5 }}>{stats.seen} seen · {stats.unseen} unseen</span>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search Polish or English…"
        style={{ padding:"9px 13px",borderRadius:9,fontFamily:"monospace",fontSize:12,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",color:"#f8fafc",outline:"none" }}/>

      {/* CEFR filter */}
      <div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>
        <button onClick={()=>setCefrFilter("all")}
          style={{ padding:"5px 9px",borderRadius:6,fontFamily:"monospace",fontWeight:700,fontSize:8,cursor:"pointer",background:cefrFilter==="all"?"rgba(255,255,255,0.08)":"transparent",border:`1px solid ${cefrFilter==="all"?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.04)"}`,color:cefrFilter==="all"?"#f8fafc":"#334155",transition:"all 0.14s" }}>
          ALL LEVELS
        </button>
        {cefrLevels.map(lv=>(
          <button key={lv} onClick={()=>setCefrFilter(lv)}
            style={{ padding:"5px 9px",borderRadius:6,fontFamily:"monospace",fontWeight:700,fontSize:8,cursor:"pointer",background:cefrFilter===lv?`${cefrColors[lv]}22`:"transparent",border:`1px solid ${cefrFilter===lv?`${cefrColors[lv]}55`:"rgba(255,255,255,0.04)"}`,color:cefrFilter===lv?cefrColors[lv]:"#334155",transition:"all 0.14s" }}>
            {cefrLabels[lv]}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div style={{ display:"flex",gap:5 }}>
        {[["all","All"],["mastered","Mastered"],["learning","Learning"],["training","Training"]].map(([key,label])=>(
          <button key={key} onClick={()=>setFilter(key)}
            style={{ flex:1,padding:"6px 4px",borderRadius:7,fontFamily:"monospace",fontWeight:700,fontSize:8,letterSpacing:"0.06em",cursor:"pointer",
              background:filter===key?(key==="all"?"rgba(255,255,255,0.08)":`${tierColors[key]}22`):"transparent",
              border:`1px solid ${filter===key?(key==="all"?"rgba(255,255,255,0.2)":`${tierColors[key]}55`):"rgba(255,255,255,0.04)"}`,
              color:filter===key?(key==="all"?"#f8fafc":tierColors[key]):"#334155",
              transition:"all 0.14s" }}>
            {label}
          </button>
        ))}
      </div>

      {/* Word list */}
      {filtered.length === 0 ? (
        <div style={{ padding:"32px 16px",textAlign:"center",color:"#334155",fontFamily:"monospace",fontSize:10 }}>
          {seenVocab.length === 0 ? "No words yet — start practicing!" : "No words match this filter."}
        </div>
      ) : (
        <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
          {filtered.map(w=>(
            <div key={w.id} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:9,background:"rgba(255,255,255,0.022)",border:"1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ flex:"0 0 auto",minWidth:88 }}>
                <div style={{ fontSize:13,fontWeight:700,color:"#f8fafc",fontFamily:"monospace" }}>{w.polish}</div>
                {w.subtext&&<div style={{ fontSize:8,color:"#475569",fontFamily:"monospace" }}>{w.subtext}</div>}
              </div>
              <div style={{ flex:1,fontSize:11,color:"#94a3b8",fontFamily:"monospace" }}>{w.english}</div>
              <span style={{ fontSize:7,padding:"1px 4px",borderRadius:3,background:`${cefrColors[w.cefrLevel] ?? "#334155"}18`,border:`1px solid ${cefrColors[w.cefrLevel] ?? "#334155"}33`,color:cefrColors[w.cefrLevel] ?? "#334155",fontFamily:"monospace",fontWeight:700,flexShrink:0 }}>
                {cefrLabels[w.cefrLevel] ?? w.cefrLevel?.toUpperCase()}
              </span>
              <span style={{ fontSize:7,padding:"2px 6px",borderRadius:4,background:`${tierColors[w.tier]}18`,border:`1px solid ${tierColors[w.tier]}44`,color:tierColors[w.tier],fontFamily:"monospace",fontWeight:700,flexShrink:0 }}>
                {tierLabels[w.tier]}
              </span>
              <PlayAudio text={w.polish} size="sm"/>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function StageClearedScreen({ stage, dungeon, xpEarned, goldEarned, isLastStage, onContinue }) {
  return (
    <div style={{ textAlign:"center",padding:"40px 18px",display:"flex",flexDirection:"column",alignItems:"center",gap:16,animation:"slideUp 0.45s cubic-bezier(0.34,1.56,0.64,1)" }}>
      <div style={{ fontSize:52,animation:"float 2s ease infinite" }}>{isLastStage?"🏆":stage?.icon}</div>
      <div>
        <div style={{ fontSize:8,fontFamily:"monospace",color:dungeon.color,letterSpacing:"0.2em",marginBottom:4 }}>{isLastStage?"DUNGEON CLEARED":"STAGE CLEARED"}</div>
        <div style={{ fontSize:18,fontWeight:900,color:"#f8fafc",fontFamily:"monospace" }}>{stage?.name}</div>
        {isLastStage && <div style={{ fontSize:9,color:"#10b981",fontFamily:"monospace",marginTop:4 }}>All words in this level have been marked Mastered! ✓</div>}
      </div>
      <div style={{ display:"flex",gap:18,padding:"12px 20px",background:dungeon.bg,borderRadius:11,border:`1px solid ${dungeon.border}` }}>
        <div style={{ textAlign:"center" }}><div style={{ fontSize:8,color:"#334155",fontFamily:"monospace" }}>XP</div><div style={{ fontSize:16,fontWeight:900,color:dungeon.color,fontFamily:"monospace" }}>+{xpEarned}</div></div>
        <div style={{ width:1,background:"rgba(255,255,255,0.05)" }}/>
        <div style={{ textAlign:"center" }}><div style={{ fontSize:8,color:"#334155",fontFamily:"monospace" }}>GOLD</div><div style={{ fontSize:16,fontWeight:900,color:"#f59e0b",fontFamily:"monospace" }}>+{goldEarned}🪙</div></div>
      </div>
      <button onClick={onContinue} style={{ padding:"11px 28px",borderRadius:10,fontFamily:"monospace",fontWeight:900,fontSize:11,cursor:"pointer",letterSpacing:"0.08em",background:`linear-gradient(135deg,${dungeon.color}88,${dungeon.color})`,border:`1px solid ${dungeon.color}`,color:"#f8fafc",boxShadow:`0 3px 20px ${dungeon.color}40` }}>
        {isLastStage?"← DASHBOARD":"NEXT STAGE →"}
      </button>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §18  ROOT APP — GAME STATE MACHINE (Phase 10)
   
   New in Phase 10:
   • isReplay flag propagated through nav → affects gold rewards (20%)
   • Dungeon Clear hook: when final boss of a CEFR level is defeated,
     BULK_MASTER_LEVEL dispatched for all words in that CEFR level
   • All dungeons unlocked for dev (cheat code in manifest)
══════════════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [xp,    setXp]    = useState(0);
  const [gold,  setGold]  = useState(100);
  const [lives, setLives] = useState(3);

  const [ledger, dispatchLedger] = useReducer(ledgerReducer, {});
  const [dungeonProgress, setDungeonProgress] = useState({});

  const [nav, setNav] = useState({
    view:"dashboard",
    dungeon:null,
    stage:null,
    room:null,
    isBoss:false,
    wordPool:null,
    poolReady:false,
    isReplay:false,  // Phase 10: replay mode flag
  });

  const [sessionXp,   setSessionXp]   = useState(0);
  const [sessionGold, setSessionGold] = useState(0);

  useEffect(()=>{
    document.addEventListener("pointerdown", ()=>AudioService.preWarm(), { once:true });
    AudioService.loadVoices();
  },[]);

  const goTo = useCallback((patch) => setNav(n => ({ ...n, ...patch })), []);

  const loadPool = useCallback(async (stage, room) => {
    if (!stage?.chunkId) { goTo({ wordPool:[], poolReady:true }); return; }
    goTo({ poolReady:false });
    try {
      const words  = await VocabService.fetchChunk(stage.chunkId);
      const slice  = room?.wordSlice ?? [0, words.length];
      const sliced = words.slice(slice[0], slice[1]);
      goTo({ wordPool: sliced.length >= 4 ? sliced : words.slice(0, Math.min(10, words.length)), poolReady:true });
    } catch(e) {
      console.error("VocabService error:", e);
      goTo({ wordPool:[], poolReady:true });
    }
  }, [goTo]);

  const enterDungeon = useCallback((dungeon) => {
    if (!dungeon || !Array.isArray(dungeon.stages)) return;
    setLives(3);
    goTo({ view:"dungeon_select", dungeon, stage:null, room:null, isReplay:false });
  }, [goTo]);

  const enterStage = useCallback((dungeon, stage, isReplay=false) => {
    if (!dungeon || !stage || !Array.isArray(stage.rooms)) return;
    goTo({ view:"stage_map", dungeon, stage, room:null, isReplay });
  }, [goTo]);

  const enterRoom = useCallback((dungeon, stage, room, isReplay=false) => {
    if (!dungeon || !stage || !room) return;
    goTo({ view:"practice", dungeon, stage, room, isBoss:false, wordPool:null, poolReady:false, isReplay });
    loadPool(stage, room);
  }, [goTo, loadPool]);

  const enterBoss = useCallback((dungeon, stage, boss, isReplay=false) => {
    if (!dungeon || !stage || !boss) return;
    goTo({ view:"practice", dungeon, stage, room:boss, isBoss:true, wordPool:null, poolReady:false, isReplay });
    loadPool(stage, boss);
  }, [goTo, loadPool]);

  const skipToCombat = useCallback(() => {
    goTo({ view:"combat" });
  }, [goTo]);

  /* ── Phase 10: Dungeon Clear Hook ──────────────────────────────────────────
     When the final boss of a CEFR level is defeated (stagesCleared === total stages),
     bulk-upgrade all words in that CEFR level to "mastered".
  ──────────────────────────────────────────────────────────────────────────── */
  const handleDungeonClear = useCallback(async (dungeon) => {
    try {
      const allWords = await VocabService.fetchAllForLevel(dungeon.id);
      const wordIds  = allWords.map(w => w.id);
      if (wordIds.length > 0) {
        dispatchLedger({ type:"BULK_MASTER_LEVEL", wordIds });
        console.log(`[DungeonClear] Bulk-mastered ${wordIds.length} words for ${dungeon.cefr}`);
      }
    } catch(e) {
      console.error("DungeonClear error:", e);
    }
  }, [dispatchLedger]);

  const handleRoomCleared = useCallback((earnedXp, earnedGold) => {
    const { dungeon, stage, isBoss, isReplay } = nav;
    if (!dungeon || !stage) return;
    setXp(v=>v+earnedXp); setGold(v=>v+earnedGold);
    setSessionXp(v=>v+earnedXp); setSessionGold(v=>v+earnedGold);

    const did  = dungeon.id;
    const sIdx = stage.index;

    let dungeonCleared = false;
    setDungeonProgress(prev => {
      const dp = { ...(prev[did] ?? { stagesCleared:0 }) };
      if (!isBoss) {
        dp[`s${sIdx}_rooms`] = (dp[`s${sIdx}_rooms`]??0) + 1;
      } else {
        dp[`s${sIdx}_boss`] = true;
        dp.stagesCleared    = (dp.stagesCleared??0) + 1;
        // Check if this was the final stage
        if (dp.stagesCleared >= dungeon.stages.length) {
          dungeonCleared = true;
        }
      }
      return { ...prev, [did]:dp };
    });

    // Phase 10: Trigger auto-mastery if dungeon is now cleared
    if (dungeonCleared) {
      handleDungeonClear(dungeon);
    }

    const isLastStage = isBoss && (nav.dungeonProgress?.[did]?.stagesCleared ?? 0) + 1 >= dungeon.stages.length;

    if (isBoss) {
      goTo({ view:"stage_cleared" });
    } else {
      goTo({ view:"stage_map", room:null, isBoss:false, wordPool:null });
    }
  }, [nav, goTo, handleDungeonClear]);

  const handlePlayerDamage = useCallback(() => setLives(l => Math.max(0, l - 1)), []);

  const handleSpendGoldRevive = useCallback(() => {
    if (gold < 30) return;
    setGold(g => g - 30);
    setLives(1);
  }, [gold]);

  const handleGiveUp = useCallback(() => {
    setLives(3);
    goTo({ view:"dashboard", dungeon:null, stage:null, room:null, isBoss:false, wordPool:null, isReplay:false });
  }, [goTo]);

  const level = Math.floor(xp/200)+1;

  const { view, dungeon, stage, room, isBoss, wordPool, poolReady, isReplay } = nav;
  const dp           = dungeon ? (dungeonProgress[dungeon.id] ?? { stagesCleared:0 }) : {};
  const roomsCleared = stage ? (dp[`s${stage.index}_rooms`]??0) : 0;
  const bossCleared  = stage ? !!(dp[`s${stage.index}_boss`]) : false;
  const isLastStage  = dungeon && stage ? stage.index >= dungeon.stages.length : false;

  return (
    <div style={{ minHeight:"100vh", background:"#060a12", color:"#e2e8f0", fontFamily:"'IBM Plex Mono','Courier New',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,700;1,400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideUp{from{opacity:0;transform:translateY(13px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes speakerPulse{0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}50%{box-shadow:0 0 0 5px rgba(16,185,129,0.16)}}
        @keyframes timerPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.16)}}
        @keyframes flashOut{0%{opacity:1}100%{opacity:0}}
        @keyframes goldShimmer{0%,100%{color:#f59e0b}50%{color:#fbbf24}}
        button{font-family:inherit} input{font-family:inherit}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.07)}
      `}</style>

      <div style={{ position:"fixed",inset:0,pointerEvents:"none",zIndex:0 }}>
        <div style={{ position:"absolute",inset:0,background:"radial-gradient(ellipse at 20% 12%,rgba(99,102,241,0.055) 0%,transparent 50%)" }}/>
        <div style={{ position:"absolute",inset:0,background:"radial-gradient(ellipse at 78% 88%,rgba(16,185,129,0.035) 0%,transparent 50%)" }}/>
        <div style={{ position:"absolute",inset:0,backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 23px,rgba(255,255,255,0.006) 23px,rgba(255,255,255,0.006) 24px),repeating-linear-gradient(90deg,transparent,transparent 23px,rgba(255,255,255,0.006) 23px,rgba(255,255,255,0.006) 24px)" }}/>
      </div>

      <div style={{ position:"relative",zIndex:1,maxWidth:480,margin:"0 auto",padding:"0 14px 60px" }}>
        <header style={{ padding:"11px 0 9px",borderBottom:"1px solid rgba(255,255,255,0.05)",marginBottom:14,position:"sticky",top:0,background:"rgba(6,10,18,0.93)",backdropFilter:"blur(14px)",zIndex:50 }}>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7 }}>
            <div>
              <h1 style={{ fontSize:15,fontWeight:900,letterSpacing:"0.15em",color:"#f97316",lineHeight:1 }}>
                POLSK<span style={{ color:"#ef4444" }}>QUEST</span>
                <span style={{ fontSize:8,color:"#334155",marginLeft:7 }}>PHASE 10</span>
              </h1>
              <p style={{ fontSize:7,color:"#1e293b",letterSpacing:"0.1em",marginTop:1 }}>INPUT LOCK · UNSEEN FILTER · AUTO-MASTERY · REPLAY · SUPABASE</p>
            </div>
            <div style={{ display:"flex",gap:4,alignItems:"center" }}>
              {(view==="combat"||view==="practice") ? (
                <div style={{ display:"flex",alignItems:"center",gap:3,padding:"3px 7px",borderRadius:6,background:"rgba(239,68,68,0.09)",border:"1px solid rgba(239,68,68,0.18)" }}>
                  <span style={{ fontSize:9 }}>❤</span>
                  <span style={{ fontSize:9,fontFamily:"monospace",color:"#f87171",fontWeight:700 }}>{lives}/3</span>
                </div>
              ) : (
                <Pill icon="⭐" val={`Lv${level}`} col="#818cf8" bg="rgba(99,102,241,0.09)"  border="rgba(99,102,241,0.18)"/>
              )}
              <Pill icon="🪙" val={`${gold}G`}   col="#f59e0b" bg="rgba(245,158,11,0.09)" border="rgba(245,158,11,0.18)" anim="goldShimmer 3s ease infinite"/>
            </div>
          </div>
          <div style={{ height:3,background:"rgba(255,255,255,0.04)",borderRadius:2,overflow:"hidden" }}>
            <div style={{ height:"100%",width:`${((xp%200)/200)*100}%`,background:"linear-gradient(90deg,#6366f1,#818cf8)",borderRadius:2,transition:"width 0.5s ease" }}/>
          </div>
        </header>

        <div key={view} style={{ animation:"fadeIn 0.22s ease" }}>

          {view==="dashboard" && (
            <PlayerDashboard
              ledger={ledger} dungeonProgress={dungeonProgress}
              xp={xp} gold={gold} level={level} hp={lives}
              manifest={DUNGEON_MANIFEST}
              onPlay={(d) => {
                const target = (d&&typeof d==="object") ? d : DUNGEON_MANIFEST.find(x=>!x.locked);
                if (target) enterDungeon(target);
              }}
              onWordBank={()=>goTo({ view:"word_bank" })}
            />
          )}

          {view==="word_bank" && (
            <WordBankView ledger={ledger} onBack={()=>goTo({ view:"dashboard" })}/>
          )}

          {view==="dungeon_select" && dungeon && (
            <DungeonSelect
              dungeon={dungeon} dungeonProgress={dungeonProgress}
              onEnterStage={(s, replay=false) => enterStage(dungeon, s, replay)}
              onBack={()=>goTo({ view:"dashboard",dungeon:null })}
            />
          )}

          {view==="stage_map" && dungeon && stage && (
            <StageMap
              dungeon={dungeon} stage={stage}
              completedRooms={roomsCleared} bossCleared={bossCleared}
              onEnterRoom={(r, replay=false)  => enterRoom(dungeon, stage, r, replay)}
              onEnterBoss={(b, replay=false)  => enterBoss(dungeon, stage, b, replay)}
              onBack={()=>goTo({ view:"dungeon_select", stage:null })}
            />
          )}

          {view==="practice" && dungeon && stage && room && (
            !poolReady ? (
              <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:"48px 20px" }}>
                <div style={{ fontSize:28,animation:"float 1.5s ease infinite" }}>📖</div>
                <div style={{ fontSize:10,color:"#334155",fontFamily:"monospace",letterSpacing:"0.1em" }}>LOADING WORDS…</div>
              </div>
            ) : (
              <PracticeMode
                wordPool={wordPool??[]} dungeon={dungeon} stage={stage} room={room}
                onComplete={skipToCombat}
                onBack={()=>goTo({ view:"stage_map",room:null,wordPool:null })}
                dispatchLedger={dispatchLedger}
                ledger={ledger}
                isReplay={isReplay}
              />
            )
          )}

          {view==="combat" && dungeon && stage && room && (
            !poolReady ? (
              <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:"48px 20px" }}>
                <div style={{ fontSize:28,animation:"float 1.5s ease infinite" }}>⚔️</div>
                <div style={{ fontSize:10,color:"#334155",fontFamily:"monospace",letterSpacing:"0.1em" }}>LOADING…</div>
              </div>
            ) : (
              <CombatScreen
                dungeon={dungeon} stage={stage} room={room}
                isBoss={isBoss} wordPool={wordPool??[]} ledger={ledger}
                dispatchLedger={dispatchLedger}
                onRoomCleared={handleRoomCleared}
                onPlayerDamage={handlePlayerDamage}
                onBack={()=>goTo({ view:"stage_map",room:null,wordPool:null,isBoss:false })}
                lives={lives}
                gold={gold}
                onSpendGold={handleSpendGoldRevive}
                onGiveUp={handleGiveUp}
                isReplay={isReplay}
              />
            )
          )}

          {view==="stage_cleared" && dungeon && stage && (
            <StageClearedScreen
              stage={stage} dungeon={dungeon}
              xpEarned={sessionXp} goldEarned={sessionGold}
              isLastStage={isLastStage}
              onContinue={()=>{
                setSessionXp(0); setSessionGold(0);
                if (isLastStage) { goTo({ view:"dashboard",dungeon:null,stage:null,room:null }); }
                else { goTo({ view:"dungeon_select",stage:null,room:null,wordPool:null }); }
              }}
            />
          )}

        </div>
      </div>
    </div>
  );
}
