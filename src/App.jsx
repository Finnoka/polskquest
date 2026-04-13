import { useState, useEffect, useRef, useCallback, useMemo, useReducer } from "react";
import { createClient } from "@supabase/supabase-js";

/* ── Supabase client ── initialised once from Vite env vars ── */
const _supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_SERVICE_KEY
);

/* ══════════════════════════════════════════════════════════════════════════════
   POLSKQUEST — PHASE 12: SUPABASE LIVE DATA FOR ALL CEFR LEVELS

   KEY CHANGES FROM PHASE 11:
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  SUPABASE ON    fetchChunk & fetchAllForLevel now query Supabase live    │
   │  CASE FLEXIBLE  tries uppercase cefr_level ("B2") then lowercase ("b2") │
   │  NO MOCK BLEED  B2/C1 no longer fall back to placeholder "Słowo" names  │
   │  CLIENT INIT    createClient() from VITE env vars, no window.__supabase  │
   └──────────────────────────────────────────────────────────────────────────┘
══════════════════════════════════════════════════════════════════════════════ */


/* ══════════════════════════════════════════════════════════════════════════════
   §1  AUDIO SERVICE v2  (unchanged)
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
   §2  SFX ENGINE v2  (unchanged)
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
    successDing()    { const c=resume(); if(!c)return; const t=c.currentTime; tone(660,"sine",t,0.08,0.28,990); tone(990,"sine",t+0.07,0.14,0.22,1320); tone(1320,"triangle",t+0.14,0.08,0.12); },
    incorrectBuzzer(){ const c=resume(); if(!c)return; const t=c.currentTime; tone(160,"sawtooth",t,0.18,0.32,100); tone(280,"sawtooth",t,0.12,0.12,140); },
    bladeSlash()     { const c=resume(); if(!c)return; const t=c.currentTime; tone(800,"sawtooth",t,0.04,0.22,200); tone(1600,"sawtooth",t,0.12,0.18,100); tone(300,"sine",t+0.04,0.10,0.10,80); },
    oofImpact()      { const c=resume(); if(!c)return; const t=c.currentTime; tone(120,"square",t,0.20,0.35,60); tone(200,"sawtooth",t,0.08,0.20,80); tone(80,"sine",t+0.10,0.25,0.28,40); },
    correct() { this.successDing(); },
    wrong()   { this.incorrectBuzzer(); },
  };
})();


/* ══════════════════════════════════════════════════════════════════════════════
   §3  VOCAB SERVICE v4 — Supabase-backed, CEFR-isolated fetching

   fetchChunk queries Supabase by (cefr_level, stage_id).
   Tries uppercase cefr_level first ("B2") then lowercase ("b2") to handle
   both import conventions from DeepL.
   fetchAllForLevel fetches the entire level for dungeon-clear mastery marking.
══════════════════════════════════════════════════════════════════════════════ */
const VocabService = {
  _cache: new Map(),

  /* ── SUPABASE VERSION — active ── */
  async fetchChunk(chunkId) {
    if (this._cache.has(chunkId)) return this._cache.get(chunkId);
    // chunkId e.g. "b2-s3"  =>  cefrRaw="b2", stageId="s3"
    const [cefrRaw, stageId] = chunkId.split("-", 2);
    const cefrUpper = cefrRaw.toUpperCase(); // "B2" — typical from DeepL imports
    const cefrLower = cefrRaw.toLowerCase(); // "b2" — fallback

    let data, error;

    // First attempt: uppercase cefr_level (most common from DeepL/Supabase imports)
    ({ data, error } = await _supabase
      .from("vocabulary")
      .select("*")
      .eq("cefr_level", cefrUpper)
      .eq("stage_id", stageId)
      .order("frequency_rank", { ascending: true }));

    // Second attempt: lowercase, in case the table stores lowercase
    if (!error && (!data || data.length === 0)) {
      ({ data, error } = await _supabase
        .from("vocabulary")
        .select("*")
        .eq("cefr_level", cefrLower)
        .eq("stage_id", stageId)
        .order("frequency_rank", { ascending: true }));
    }

    if (error) throw error;

    const words = (data ?? []).map(r => ({
      id:        r.id,
      polish:    r.polish,
      english:   r.english,
      subtext:   r.subtext ?? null,
      cat:       r.category ?? "misc",
      accepted:  r.accepted_answers ?? [r.english.toLowerCase()],
      cefrLevel: cefrLower,
      stageId:   r.stage_id,
    }));
    this._cache.set(chunkId, words);
    return words;
  },


  /* ── SUPABASE VERSION — active ── */
  async fetchAllForLevel(cefrLevel) {
    const key = `__all_${cefrLevel}`;
    if (this._cache.has(key)) return this._cache.get(key);
    const cefrUpper = cefrLevel.toUpperCase();
    const cefrLower = cefrLevel.toLowerCase();

    let data, error;
    ({ data, error } = await _supabase
      .from("vocabulary")
      .select("id, polish, english, subtext, category, accepted_answers, cefr_level, stage_id")
      .eq("cefr_level", cefrUpper));

    if (!error && (!data || data.length === 0)) {
      ({ data, error } = await _supabase
        .from("vocabulary")
        .select("id, polish, english, subtext, category, accepted_answers, cefr_level, stage_id")
        .eq("cefr_level", cefrLower));
    }

    if (error) throw error;

    const words = (data ?? []).map(r => ({
      id:        r.id,
      polish:    r.polish,
      english:   r.english,
      subtext:   r.subtext ?? null,
      cat:       r.category ?? "misc",
      accepted:  r.accepted_answers ?? [r.english.toLowerCase()],
      cefrLevel: cefrLower,
      stageId:   r.stage_id,
    }));
    this._cache.set(key, words);
    return words;
  },
};


/* ══════════════════════════════════════════════════════════════════════════════
   §4  MOCK VOCAB CHUNKS — each CEFR level has its own distinct words
   
   Phase 11 fix: A2, B1, B2, C1 now have genuinely different mock words so
   the "placeholder loop" bug (all levels showing A1 words) is eliminated.
══════════════════════════════════════════════════════════════════════════════ */
const MOCK_VOCAB_CHUNKS = {
  /* ── A1 ── */
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
  // Remaining A1 stages use generated mock data
  ...Object.fromEntries(
    Array.from({length:12}, (_,i) => [`a1-s${i+3}`, Array.from({length:10}, (_,j) => ({
      id:`a1-s${i+3}-${String(j+1).padStart(3,"0")}`, polish:`Słowo A1.${i+3}.${j+1}`,
      english:`a1 word ${i+3}-${j+1}`, subtext:null, cat:"misc",
      accepted:[`a1 word ${i+3}-${j+1}`]
    }))])
  ),

  /* ── A2 — distinctly different vocabulary (grammar, intermediate) ── */
  "a2-s1": [
    { id:"a2-s1-001", polish:"Rozumiem",    english:"I understand",  subtext:null, cat:"phrases", accepted:["i understand","i get it","understood"] },
    { id:"a2-s1-002", polish:"Nie rozumiem",english:"I don't understand", subtext:null, cat:"phrases", accepted:["i don't understand","i do not understand"] },
    { id:"a2-s1-003", polish:"Mówię po angielsku", english:"I speak English", subtext:null, cat:"phrases", accepted:["i speak english"] },
    { id:"a2-s1-004", polish:"Mieszkam w",  english:"I live in",     subtext:null, cat:"phrases", accepted:["i live in"] },
    { id:"a2-s1-005", polish:"Ile kosztuje",english:"how much is it",subtext:null, cat:"shopping", accepted:["how much is it","how much does it cost","how much"] },
    { id:"a2-s1-006", polish:"Gdzie jest",  english:"where is",      subtext:null, cat:"directions", accepted:["where is","where's"] },
    { id:"a2-s1-007", polish:"Na lewo",     english:"to the left",   subtext:null, cat:"directions", accepted:["to the left","on the left","left"] },
    { id:"a2-s1-008", polish:"Na prawo",    english:"to the right",  subtext:null, cat:"directions", accepted:["to the right","on the right","right"] },
    { id:"a2-s1-009", polish:"Prosto",      english:"straight ahead",subtext:null, cat:"directions", accepted:["straight ahead","straight on","straight"] },
    { id:"a2-s1-010", polish:"Niedaleko",   english:"nearby",        subtext:null, cat:"directions", accepted:["nearby","not far","close"] },
  ],
  ...Object.fromEntries(
    Array.from({length:39}, (_,i) => [`a2-s${i+2}`, Array.from({length:10}, (_,j) => ({
      id:`a2-s${i+2}-${String(j+1).padStart(3,"0")}`, polish:`Słowo A2.${i+2}.${j+1}`,
      english:`a2 word ${i+2}-${j+1}`, subtext:null, cat:"misc",
      accepted:[`a2 word ${i+2}-${j+1}`]
    }))])
  ),

  /* ── B1 — cases, verbs of motion ── */
  "b1-s1": [
    { id:"b1-s1-001", polish:"Mianownik",   english:"nominative",    subtext:"(case)",  cat:"grammar", accepted:["nominative"] },
    { id:"b1-s1-002", polish:"Dopełniacz",  english:"genitive",      subtext:"(case)",  cat:"grammar", accepted:["genitive"] },
    { id:"b1-s1-003", polish:"Celownik",    english:"dative",        subtext:"(case)",  cat:"grammar", accepted:["dative"] },
    { id:"b1-s1-004", polish:"Biernik",     english:"accusative",    subtext:"(case)",  cat:"grammar", accepted:["accusative"] },
    { id:"b1-s1-005", polish:"Narzędnik",   english:"instrumental",  subtext:"(case)",  cat:"grammar", accepted:["instrumental"] },
    { id:"b1-s1-006", polish:"Miejscownik", english:"locative",      subtext:"(case)",  cat:"grammar", accepted:["locative"] },
    { id:"b1-s1-007", polish:"Wołacz",      english:"vocative",      subtext:"(case)",  cat:"grammar", accepted:["vocative"] },
    { id:"b1-s1-008", polish:"Iść",         english:"to go (on foot)",subtext:null,     cat:"motion",  accepted:["to go","go","to walk","walk"] },
    { id:"b1-s1-009", polish:"Jechać",      english:"to go (by vehicle)", subtext:null, cat:"motion",  accepted:["to go by vehicle","to drive","to ride","drive"] },
    { id:"b1-s1-010", polish:"Lecieć",      english:"to fly",        subtext:null,      cat:"motion",  accepted:["to fly","fly"] },
  ],
  ...Object.fromEntries(
    Array.from({length:59}, (_,i) => [`b1-s${i+2}`, Array.from({length:10}, (_,j) => ({
      id:`b1-s${i+2}-${String(j+1).padStart(3,"0")}`, polish:`Słowo B1.${i+2}.${j+1}`,
      english:`b1 word ${i+2}-${j+1}`, subtext:null, cat:"misc",
      accepted:[`b1 word ${i+2}-${j+1}`]
    }))])
  ),

  /* ── B2 — advanced fluency ── */
  "b2-s1": Array.from({length:10}, (_,j) => ({
    id:`b2-s1-${String(j+1).padStart(3,"0")}`, polish:`Słowo B2.1.${j+1}`,
    english:`b2 word 1-${j+1}`, subtext:null, cat:"advanced", accepted:[`b2 word 1-${j+1}`]
  })),
  ...Object.fromEntries(
    Array.from({length:99}, (_,i) => [`b2-s${i+2}`, Array.from({length:10}, (_,j) => ({
      id:`b2-s${i+2}-${String(j+1).padStart(3,"0")}`, polish:`Słowo B2.${i+2}.${j+1}`,
      english:`b2 word ${i+2}-${j+1}`, subtext:null, cat:"misc",
      accepted:[`b2 word ${i+2}-${j+1}`]
    }))])
  ),

  /* ── C1 — near-native ── */
  "c1-s1": Array.from({length:10}, (_,j) => ({
    id:`c1-s1-${String(j+1).padStart(3,"0")}`, polish:`Słowo C1.1.${j+1}`,
    english:`c1 word 1-${j+1}`, subtext:null, cat:"native", accepted:[`c1 word 1-${j+1}`]
  })),
  ...Object.fromEntries(
    Array.from({length:199}, (_,i) => [`c1-s${i+2}`, Array.from({length:10}, (_,j) => ({
      id:`c1-s${i+2}-${String(j+1).padStart(3,"0")}`, polish:`Słowo C1.${i+2}.${j+1}`,
      english:`c1 word ${i+2}-${j+1}`, subtext:null, cat:"misc",
      accepted:[`c1 word ${i+2}-${j+1}`]
    }))])
  ),
};


/* ══════════════════════════════════════════════════════════════════════════════
   §5  MASTERY STORE  (unchanged from Phase 10)
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
    case "BULK_MASTER_LEVEL": {
      if (!wordIds?.length) return state;
      const patch = {};
      for (const id of wordIds) patch[id] = MASTERY_THRESHOLD;
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
   §6  PROCEDURAL DUNGEON GENERATOR
   
   Phase 11: Replaces ALL hardcoded stages arrays.
   
   Structure per dungeon:
     • N stages = ceil(totalWords / WORDS_PER_STAGE)
     • Each stage has 5 rooms
     • Each room introduces 10 new words (WORDS_PER_STAGE / 5 = 10)
     • wordSlice per room: non-overlapping windows into the stage's 50-word chunk
     • Boss uses entire stage word pool for final test
   
   Room word slices:
     Room 1: [0, 10]   Room 2: [10, 20]   Room 3: [20, 30]
     Room 4: [30, 40]  Room 5: [40, 50]   Boss:   [0, 50]
══════════════════════════════════════════════════════════════════════════════ */
const WORDS_PER_STAGE = 50;
const ROOMS_PER_STAGE = 5;
const WORDS_PER_ROOM  = WORDS_PER_STAGE / ROOMS_PER_STAGE; // 10

// Rotating pools for procedural variety
const STAGE_THEMES = [
  { name:"The Gateway",      icon:"🚪" }, { name:"The Forest",       icon:"🌲" },
  { name:"The Market",       icon:"🏪" }, { name:"The River",        icon:"🌊" },
  { name:"The Mountain",     icon:"⛰"  }, { name:"The Castle",       icon:"🏰" },
  { name:"The Library",      icon:"📚" }, { name:"The Temple",       icon:"🏛"  },
  { name:"The Academy",      icon:"🎓" }, { name:"The Tower",        icon:"🗼" },
  { name:"The Dungeon",      icon:"⚔️" }, { name:"The Tavern",       icon:"🍺" },
  { name:"The Harbour",      icon:"⚓" }, { name:"The Arena",        icon:"🏟" },
  { name:"The Vault",        icon:"🔐" }, { name:"The Citadel",      icon:"🏯" },
  { name:"The Observatory",  icon:"🔭" }, { name:"The Crossroads",   icon:"🛤"  },
  { name:"The Ruins",        icon:"🏚"  }, { name:"The Fortress",     icon:"🛡"  },
];

const ROOM_ENEMIES = [
  { name:"The Rusty Guard",   emoji:"🧟" }, { name:"The Echo Imp",     emoji:"👺" },
  { name:"The Mimic Spider",  emoji:"🕷" }, { name:"The Fog Specter",  emoji:"👁" },
  { name:"The Hollow Knight", emoji:"🗡" }, { name:"The Word Wraith",  emoji:"💀" },
  { name:"The Ink Golem",     emoji:"📜" }, { name:"The Rune Warden",  emoji:"🔮" },
  { name:"The Tongue Thief",  emoji:"👅" }, { name:"The Cipher Beast", emoji:"🦎" },
];

const BOSS_GUARDIANS = [
  { name:"The Ancient One",    emoji:"🌳", title:"Rex" },
  { name:"The Word Tyrant",    emoji:"🐉", title:"Maximus" },
  { name:"The Grand Linguist", emoji:"👑", title:"Supremus" },
  { name:"The Lexicon Lord",   emoji:"📖", title:"Infinitus" },
  { name:"The Syllable Sphinx",emoji:"🦁", title:"Eternus" },
];

// XP and gold scale gently with stage depth
function stageRewards(stageIndex, dungeonIndex) {
  const depthBonus = Math.floor(stageIndex / 10);
  const cefrBonus  = dungeonIndex * 20;
  return {
    roomXp:   80  + depthBonus * 5  + cefrBonus,
    roomGold: 30  + depthBonus * 2  + cefrBonus / 2,
    bossXp:   250 + depthBonus * 15 + cefrBonus * 2,
    bossGold: 150 + depthBonus * 8  + cefrBonus * 3,
  };
}

function generateDungeonStructure(dungeonId, totalWords, dungeonIndex = 0) {
  const stageCount = Math.ceil(totalWords / WORDS_PER_STAGE);

  return Array.from({ length: stageCount }, (_, i) => {
    const stageNum  = i + 1;
    const theme     = STAGE_THEMES[i % STAGE_THEMES.length];
    const rewards   = stageRewards(i, dungeonIndex);
    const chunkId   = `${dungeonId}-s${stageNum}`;
    const boss      = BOSS_GUARDIANS[i % BOSS_GUARDIANS.length];

    const rooms = Array.from({ length: ROOMS_PER_STAGE }, (_, j) => {
      const enemy     = ROOM_ENEMIES[(i * ROOMS_PER_STAGE + j) % ROOM_ENEMIES.length];
      const sliceStart = j * WORDS_PER_ROOM;
      const sliceEnd   = sliceStart + WORDS_PER_ROOM;
      return {
        id:        `${dungeonId}-s${stageNum}-r${j+1}`,
        name:      `${theme.name} — Room ${j+1}`,
        enemyName: enemy.name,
        emoji:     enemy.emoji,
        xp:        rewards.roomXp,
        gold:      rewards.roomGold,
        wordSlice: [sliceStart, sliceEnd],
      };
    });

    return {
      id:      chunkId,
      index:   stageNum,
      name:    `${theme.name} ${stageNum}`,
      chunkId,
      icon:    theme.icon,
      color:   "#6366f1",
      rooms,
      boss: {
        id:               `${dungeonId}-s${stageNum}-boss`,
        name:             `${boss.name} ${stageNum}`,
        enemyName:        `${boss.name} ${boss.title}`,
        emoji:            boss.emoji,
        lore:             `Guardian of words ${(i * WORDS_PER_STAGE) + 1}–${Math.min((i+1) * WORDS_PER_STAGE, totalWords)}. Answer before time expires.`,
        xp:               rewards.bossXp,
        gold:             rewards.bossGold,
        bossTimerSeconds: Math.max(6, 12 - Math.floor(i / 20)), // gets harder at depth
        wordSlice:        [0, WORDS_PER_STAGE],
      },
    };
  });
}


/* ══════════════════════════════════════════════════════════════════════════════
   §7  DUNGEON MANIFEST — fully procedural, no hardcoded stages
══════════════════════════════════════════════════════════════════════════════ */
const DUNGEON_CONFIG = [
  { id:"a1", name:"A1 Dungeon", subtitle:"700 Basic Polish Words",           cefr:"A1", color:"#10b981", bg:"rgba(16,185,129,0.09)", border:"rgba(16,185,129,0.26)", icon:"🏰", totalWords:700   },
  { id:"a2", name:"A2 Dungeon", subtitle:"2000 Grammar & Intermediate",      cefr:"A2", color:"#3b82f6", bg:"rgba(59,130,246,0.09)", border:"rgba(59,130,246,0.26)", icon:"🗼", totalWords:2000  },
  { id:"b1", name:"B1 Dungeon", subtitle:"3000 Cases & Verbs of Motion",     cefr:"B1", color:"#a855f7", bg:"rgba(168,85,247,0.09)", border:"rgba(168,85,247,0.26)", icon:"⚔️", totalWords:3000  },
  { id:"b2", name:"B2 Dungeon", subtitle:"5000 Advanced Fluency",            cefr:"B2", color:"#f97316", bg:"rgba(249,115,22,0.09)", border:"rgba(249,115,22,0.26)", icon:"🏛", totalWords:5000  },
  { id:"c1", name:"C1 Dungeon", subtitle:"10000 Near-Native Mastery",        cefr:"C1", color:"#ec4899", bg:"rgba(236,72,153,0.09)", border:"rgba(236,72,153,0.26)", icon:"👑", totalWords:10000 },
];

const DUNGEON_MANIFEST = DUNGEON_CONFIG.map((cfg, idx) => ({
  ...cfg,
  locked:     false,
  isUnlocked: true, // DEV CHEAT — remove for production gating
  stages:     generateDungeonStructure(cfg.id, cfg.totalWords, idx),
}));


/* ══════════════════════════════════════════════════════════════════════════════
   §8  VOCAB ENGINE v3 — session buffer aware
   
   Phase 11: generateQuestion now accepts a sessionBuffer (array of words) as
   the primary pool. Review words (learning/mastered) are injected at 20%.
══════════════════════════════════════════════════════════════════════════════ */
function removeDiacritics(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
          .replace(/ł/g,"l").replace(/ń/g,"n").replace(/[źż]/g,"z")
          .replace(/ć/g,"c").replace(/ś/g,"s").replace(/ó/g,"o")
          .replace(/ę/g,"e").replace(/ą/g,"a");
}

/* Build battle pool: session buffer + 20% review words from learned bucket */
function buildBattlePool(sessionBuffer, fullWordPool, ledger) {
  if (!sessionBuffer?.length) return fullWordPool;

  // Collect learned words NOT already in the session buffer
  const bufferIds = new Set(sessionBuffer.map(w => w.id));
  const learnedWords = fullWordPool.filter(w =>
    !bufferIds.has(w.id) &&
    scoreToTier(ledger[w.id], w.id in ledger) === "learning"
  );

  // 20% review cap
  const reviewCount = Math.max(1, Math.floor(sessionBuffer.length * 0.20));
  const reviewWords = learnedWords
    .sort(() => Math.random() - 0.5)
    .slice(0, reviewCount);

  return [...sessionBuffer, ...reviewWords];
}

function weightedPick(pool, ledger, excludeId) {
  const eligible = pool.length > 1 ? pool.filter(w => w.id !== excludeId) : pool;
  const weights  = eligible.map(w => {
    const tier = scoreToTier(ledger[w.id], w.id in ledger);
    return { unseen:5, training:7, learning:6, mastered:1 }[tier] ?? 5;
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
   §9  TUTOR DATABASE  (unchanged)
══════════════════════════════════════════════════════════════════════════════ */
const TUTOR_DB = {
  greetings:{ title:"Polish Greeting Registers", coreRule:"Polish distinguishes formal and informal sharply.", breakdown:[{label:"Formal",text:"Dzień dobry (day), Dobry wieczór (evening), Do widzenia (goodbye)."},{label:"Informal",text:"Cześć covers hi AND bye."},{label:"Proszę",text:"Please / here you go / you're welcome."}], mnemonic:"Dzień = day → Dzień dobry. Cześć rhymes with 'fresh' — keep it fresh with friends.", antiPattern:"Using Cześć with a teacher.", analogyEN:"Like 'Good day sir' vs 'Hey!'" },
  core:     { title:"Polish Core Words", coreRule:"Tak / Nie / Dobrze / Bardzo — highest-frequency words.", breakdown:[{label:"Tak/Nie",text:"Yes/no. 'Nie' also negates verbs."},{label:"Dobrze",text:"Good + okay."},{label:"Bardzo",text:"Very."}], mnemonic:"Nie = knee (no, bends). Tak = tock (yes, ticks).", antiPattern:"'Nie' in response to a negative question.", analogyEN:"Dobrze is Italian 'bene'." },
  food:     { title:"Polish Food & Drink", coreRule:"Food nouns have gender.", breakdown:[{label:"Drinks",text:"Woda, kawa, herbata, piwo."},{label:"Staples",text:"Chleb — 'ch' like Scottish loch."},{label:"Gender",text:"Learn gender with each word."}], mnemonic:"Chleb = kh-leb.", antiPattern:"Pronouncing chleb with English 'ch'.", analogyEN:"Like café vs caffè." },
  numbers:  { title:"Polish Numbers", coreRule:"Learn 1–10 as pure sound first.", breakdown:[{label:"1–3",text:"Jeden, dwa, trzy."},{label:"4–5",text:"Cztery, Pięć."},{label:"6–10",text:"Sześć, siedem, osiem, dziewięć, dziesięć."}], mnemonic:"Trzy = tree (3 branches).", antiPattern:"Reading 'cz' like English ch.", analogyEN:"French numbers reward ear-training." },
  grammar:  { title:"Polish Grammar", coreRule:"Polish has 7 cases — each changes the word ending.", breakdown:[{label:"Nominative",text:"Subject of the sentence."},{label:"Accusative",text:"Direct object."},{label:"Genitive",text:"Possession and negation."}], mnemonic:"Start with nominative and accusative — they cover 80% of sentences.", antiPattern:"Avoiding cases entirely — you'll plateau fast.", analogyEN:"Like Latin or German cases, but more consistent." },
  directions:{ title:"Polish Directions", coreRule:"Na lewo, na prawo, prosto — left, right, straight.", breakdown:[{label:"Left/Right",text:"Na lewo = left. Na prawo = right."},{label:"Straight",text:"Prosto = straight ahead."},{label:"Near/Far",text:"Niedaleko = nearby. Daleko = far."}], mnemonic:"Prawo sounds like 'pravo' — pravda is truth, and the right-hand truth.", antiPattern:"Confusing na lewo and na prawo under pressure.", analogyEN:"Like French gauche/droite — muscle memory is key." },
  motion:   { title:"Polish Verbs of Motion", coreRule:"Iść (on foot) vs Jechać (vehicle) — this distinction is obligatory.", breakdown:[{label:"On foot",text:"Iść, chodzić — walking or going on foot."},{label:"By vehicle",text:"Jechać, jeździć — any wheeled transport."},{label:"Flying",text:"Lecieć, latać — air travel."}], mnemonic:"Iść = feet. Jechać = vehicle. Never swap them.", antiPattern:"Using iść for driving — it sounds like you're walking to Warsaw.", analogyEN:"Like Spanish ir vs andar — mode of transport matters." },
  phrases:  { title:"Polish Common Phrases", coreRule:"Full phrases before grammar rules.", breakdown:[{label:"Understanding",text:"Rozumiem / Nie rozumiem — I understand / I don't understand."},{label:"Speaking",text:"Mówię po angielsku — I speak English."},{label:"Location",text:"Mieszkam w... — I live in..."}], mnemonic:"Rozumiem — ro-ZOO-myem. Stress the middle.", antiPattern:"Translating word-for-word from English.", analogyEN:"Like Italian capisco — chunk it whole." },
  misc:     { title:"Polish Pronunciation", coreRule:"Highly regular once you know the clusters.", breakdown:[{label:"Key clusters",text:"sz=sh, cz=ch, rz=zh, ł=w."},{label:"Stress",text:"Penultimate syllable, ~95% of the time."}], mnemonic:"Penultimate: second-to-last syllable.", antiPattern:"Stressing the first syllable.", analogyEN:"Like Italian — penultimate stress." },
  advanced: { title:"Advanced Polish", coreRule:"Aspect (perfective/imperfective) is the key to fluency.", breakdown:[{label:"Imperfective",text:"Ongoing or repeated action."},{label:"Perfective",text:"Completed action."},{label:"Pairs",text:"Most verbs come in pairs: pisać/napisać."}], mnemonic:"Na- prefix often signals perfective.", antiPattern:"Ignoring aspect — your sentences will sound 'unfinished' to natives.", analogyEN:"Like English simple vs progressive, but grammaticalised." },
  native:   { title:"Near-Native Polish", coreRule:"Idioms and colloquialisms separate B2 from C1.", breakdown:[{label:"Idioms",text:"Co się stało? = What happened? (lit: what became?)"},{label:"Register",text:"Formal written Polish differs greatly from speech."},{label:"Particles",text:"Już, jeszcze, tylko — tiny words with huge impact."}], mnemonic:"Listen to native podcasts — at C1 your ear does the work.", antiPattern:"Translating idioms literally.", analogyEN:"Like English 'it's raining cats and dogs' — no literal sense." },
  __default:{ title:"Polish Tip", coreRule:"Chunk whole phrases before analysing grammar.", breakdown:[{label:"Method",text:"Sounds before spellings. Phrases before rules."}], mnemonic:"Dziękuję works before you know it's a verb.", antiPattern:"Trying to understand every rule before speaking.", analogyEN:"Like learning 'I don't know' before auxiliary verbs." },
};


/* ══════════════════════════════════════════════════════════════════════════════
   §10  SHARED UI PRIMITIVES  (unchanged)
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
   §11  PRACTICE MODE — Phase 11: fixed training counter (initialCount)
   
   THE BUG FIXED:
     Phase 10 calculated `total` from the live filtered `unseenPool`, which
     shrinks as words get marked seen — turning "3/5" into "3/3" mid-session.
   
   THE FIX:
     `initialCount` is captured ONCE via useRef when the component mounts.
     The counter (idx+1 / initialCount) never changes denominator.
     Words are pulled from `sessionBuffer` — the pre-built unseen list
     passed in from the parent at room-entry time.
══════════════════════════════════════════════════════════════════════════════ */
function PracticeMode({ sessionBuffer, wordPool, dungeon, stage, room, onComplete, onBack, dispatchLedger, isReplay }) {
  // sessionBuffer is the pre-filtered unseen list captured at room-entry.
  // If buffer is empty (all words already seen), skip straight to combat.
  const practiceWords  = sessionBuffer?.length > 0 ? sessionBuffer : [];
  const isAllSeen      = practiceWords.length === 0;

  // Phase 11 fix: capture the initial count ONCE — never recalculate
  const initialCount = useRef(practiceWords.length);

  const [idx,      setIdx]     = useState(0);
  const [revealed, setReveal]  = useState(false);
  const [done,     setDone]    = useState(isAllSeen);

  const word = practiceWords[idx] ?? practiceWords[0];

  const markSeen = useCallback(() => {
    if (word) dispatchLedger({ type:"PRACTICE_SEEN", wordId:word.id });
  }, [word, dispatchLedger]);

  const advance = () => {
    markSeen();
    if (idx + 1 >= practiceWords.length) { setDone(true); return; }
    setIdx(i => i + 1);
    setReveal(false);
  };

  if (done || isAllSeen) {
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
              : `${initialCount.current} new words introduced · battle includes 20% review`
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
        {/* Phase 11 fix: denominator is initialCount.current — NEVER shrinks */}
        <div style={{ fontSize:9, fontFamily:"monospace", color:"#475569" }}>
          {idx+1} / {initialCount.current}
          <span style={{ color:"#1e293b",marginLeft:4 }}>new words</span>
        </div>
      </div>

      {/* Progress bar uses initialCount for consistent width */}
      <div style={{ display:"flex", gap:2 }}>
        {Array.from({length: initialCount.current}).map((_,i)=>(
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
          style={{ padding:"12px", borderRadius:10, fontFamily:"monospace", fontWeight:900, fontSize:12, cursor:"pointer", letterSpacing:"0.08em", background:idx+1>=practiceWords.length?"linear-gradient(135deg,#4f46e5,#7c3aed)":"rgba(255,255,255,0.04)", border:`1px solid ${idx+1>=practiceWords.length?"#818cf8":"rgba(255,255,255,0.09)"}`, color:idx+1>=practiceWords.length?"#e0e7ff":"#94a3b8", transition:"all 0.18s" }}>
          {idx+1 >= practiceWords.length ? "⚔ PROCEED TO BATTLE" : "NEXT WORD →"}
        </button>
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §12  QUESTION CARD  — Phase 10 500ms lock (unchanged)
══════════════════════════════════════════════════════════════════════════════ */
function QuestionCard({ question, onAnswer, isBoss, bossTimerSeconds, onTimerExpire, onOof }) {
  const [feedbackStep, setFeedbackStep] = useState("idle");
  const [selected,     setSelected]     = useState(null);
  const [typed,        setTyped]        = useState("");
  const [result,       setResult]       = useState(null);
  const [showTutor,    setShowTutor]    = useState(false);
  const inputRef  = useRef(null);
  const timerKey  = useRef(0);
  const lockTimer = useRef(null);

  useEffect(()=>{
    setFeedbackStep("idle"); setSelected(null); setTyped(""); setResult(null); setShowTutor(false);
    timerKey.current++;
    if (lockTimer.current) { clearTimeout(lockTimer.current); lockTimer.current=null; }
    if (question.type !== "reading") setTimeout(()=>inputRef.current?.focus(), 150);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[question.id]);
  useEffect(()=>()=>{ if (lockTimer.current) clearTimeout(lockTimer.current); },[]);

  const checkAndReveal = useCallback(() => {
    if (feedbackStep !== "idle") return;
    const raw = question.type === "reading" ? (selected ?? "") : typed;
    if (!raw.trim()) return;
    const ok  = checkAnswer(question, raw);
    setResult(ok); setFeedbackStep("locked"); setShowTutor(true);
    if (ok) SFX.successDing(); else SFX.incorrectBuzzer();
    lockTimer.current = setTimeout(() => { setFeedbackStep("verified"); lockTimer.current=null; }, 500);
  }, [feedbackStep, question, selected, typed]);

  const confirmAndAdvance = useCallback(() => {
    if (feedbackStep !== "verified") return;
    const raw = question.type === "reading" ? (selected ?? "") : typed;
    if (result) { SFX.bladeSlash(); } else { SFX.oofImpact(); onOof?.(); }
    setTimeout(() => onAnswer(result, raw), 120);
  }, [feedbackStep, result, selected, typed, question, onAnswer, onOof]);

  const handleTimerFire = useCallback(()=>{
    if (feedbackStep !== "idle") return;
    SFX.incorrectBuzzer();
    setResult(false); setFeedbackStep("locked"); setShowTutor(true);
    lockTimer.current = setTimeout(() => {
      setFeedbackStep("verified"); lockTimer.current=null;
      setTimeout(() => { SFX.oofImpact(); onOof?.(); onTimerExpire?.(); }, 900);
    }, 500);
  }, [feedbackStep, onTimerExpire, onOof]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key !== "Enter") return;
      if (document.activeElement === inputRef.current) return;
      if (feedbackStep === "idle" && canSubmit) { e.preventDefault(); checkAndReveal(); }
      else if (feedbackStep === "verified")      { e.preventDefault(); confirmAndAdvance(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [feedbackStep, checkAndReveal, confirmAndAdvance]);

  const canSubmit  = question.type === "reading" ? !!selected : typed.trim().length > 0;
  const isTyping   = question.type !== "reading";
  const isLocked   = feedbackStep === "locked";
  const isVerified = feedbackStep === "verified";
  const fbBtn      = result === true
    ? { label:"⚔  Strike!",     bg:"linear-gradient(135deg,#065f46,#047857)", border:"#10b981", color:"#ecfdf5", shadow:"0 4px 18px rgba(16,185,129,0.35)" }
    : { label:"Take Damage →",  bg:"linear-gradient(135deg,#7f1d1d,#991b1b)", border:"#ef4444", color:"#fecaca", shadow:"0 4px 18px rgba(239,68,68,0.3)" };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ borderRadius:13, padding:"15px", background:"rgba(255,255,255,0.022)", border:`1px solid ${(isVerified||isLocked)?(result?"rgba(16,185,129,0.45)":"rgba(239,68,68,0.45)"):"rgba(255,255,255,0.07)"}`, boxShadow:(isVerified||isLocked)?(result?"0 0 20px rgba(16,185,129,0.16)":"0 0 20px rgba(239,68,68,0.14)"):"none", transition:"border-color 0.25s, box-shadow 0.25s", animation:"slideUp 0.2s cubic-bezier(0.34,1.56,0.64,1)" }}>
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
                    color:right?"#6ee7b7":wrong?"#fca5a5":sel?"#c7d2fe":"#94a3b8" }}>
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        )}
        {isTyping && (
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <input ref={inputRef} value={typed} onChange={e=>feedbackStep==="idle"&&setTyped(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"){e.preventDefault(); if(feedbackStep==="idle"&&canSubmit)checkAndReveal(); else if(feedbackStep==="verified")confirmAndAdvance(); }}}
              disabled={isVerified||isLocked}
              placeholder={question.type==="listening"?"Type the English meaning…":"Type in Polish…"}
              style={{ padding:"11px 13px", borderRadius:9, fontFamily:"monospace", fontSize:14, background:(isVerified||isLocked)?(result?"rgba(16,185,129,0.09)":"rgba(239,68,68,0.07)"):"rgba(255,255,255,0.05)", border:`1px solid ${(isVerified||isLocked)?(result?"rgba(16,185,129,0.4)":"rgba(239,68,68,0.35)"):"rgba(255,255,255,0.09)"}`, color:"#f8fafc", outline:"none", transition:"border-color 0.2s" }}/>
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
        {feedbackStep==="idle" && (
          <button onClick={checkAndReveal} disabled={!canSubmit}
            style={{ marginTop:10, width:"100%", padding:"12px", borderRadius:10, fontFamily:"monospace", fontWeight:900, fontSize:11, letterSpacing:"0.1em", background:canSubmit?"linear-gradient(135deg,#1d4ed8,#3b82f6)":"rgba(255,255,255,0.03)", border:`1px solid ${canSubmit?"#60a5fa":"rgba(255,255,255,0.05)"}`, color:canSubmit?"#eff6ff":"#1e293b", cursor:canSubmit?"pointer":"not-allowed", transition:"all 0.17s", boxShadow:canSubmit?"0 3px 16px rgba(59,130,246,0.28)":"none" }}>
            CHECK ANSWER <span style={{ opacity:0.5, fontSize:9 }}>[Enter]</span></button>
        )}
        {isLocked && (
          <div style={{ marginTop:10, width:"100%", padding:"12px", borderRadius:10, fontFamily:"monospace", fontSize:11, letterSpacing:"0.1em", textAlign:"center", background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)", color:"#334155" }}>
            {result ? "✓ Correct…" : "✗ Wrong…"}
          </div>
        )}
      </div>
      {isVerified && (
        <div style={{ display:"flex", flexDirection:"column", gap:8, animation:"slideUp 0.22s ease" }}>
          <button onClick={()=>setShowTutor(p=>!p)}
            style={{ padding:"6px 11px", borderRadius:7, fontSize:9, fontFamily:"monospace", fontWeight:700, cursor:"pointer", alignSelf:"flex-start", background:showTutor?"rgba(99,102,241,0.16)":"rgba(99,102,241,0.07)", border:"1px solid rgba(99,102,241,0.22)", color:"#818cf8", transition:"all 0.14s" }}>
            {showTutor?"✕ Close Explanation":"🎓 Explain This"}
          </button>
          {showTutor && <TutorPanel catKey={question.cat} onClose={()=>setShowTutor(false)}/>}
          <button onClick={confirmAndAdvance}
            style={{ padding:"13px", borderRadius:10, fontFamily:"monospace", fontWeight:900, fontSize:12, letterSpacing:"0.1em", cursor:"pointer", background:fbBtn.bg, border:`1px solid ${fbBtn.border}`, color:fbBtn.color, boxShadow:fbBtn.shadow, transition:"all 0.17s" }}>
            {fbBtn.label} <span style={{ opacity:0.5, fontSize:9 }}>[Enter]</span></button>
        </div>
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §13  BATTLE SUMMARY
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
          <button onClick={onContinue} style={{ width:"100%", padding:"12px", borderRadius:10, fontFamily:"monospace", fontWeight:900, fontSize:11, cursor:"pointer", letterSpacing:"0.08em", background:`linear-gradient(135deg,${dungeon.color}88,${dungeon.color})`, border:`1px solid ${dungeon.color}`, color:"#f8fafc", boxShadow:`0 3px 18px ${dungeon.color}44` }}>
            CONTINUE →
          </button>
        </div>
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §14  REVIVAL OVERLAY  (unchanged)
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
          <button onClick={onGiveUp} style={{ padding:"11px", borderRadius:10, fontFamily:"monospace", fontWeight:700, fontSize:11, letterSpacing:"0.08em", cursor:"pointer", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", color:"#475569", transition:"all 0.18s" }}>
            ← Give Up (Return to Dashboard)
          </button>
        </div>
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §15  COMBAT SCREEN — Phase 11: uses battlePool (session buffer + 20% review)
══════════════════════════════════════════════════════════════════════════════ */
function CombatScreen({ dungeon, stage, room, isBoss, wordPool, sessionBuffer, ledger, dispatchLedger, onRoomCleared, onPlayerDamage, onBack, lives, onSpendGold, gold, onGiveUp, isReplay }) {
  // Phase 11: build battle pool once on mount — session buffer + review words
  const battlePool = useMemo(
    () => buildBattlePool(sessionBuffer, wordPool, ledger),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [] // intentionally only computed once at mount
  );

  const [enemyHp,     setEnemyHp]     = useState(10);
  const [question,    setQuestion]    = useState(null);
  const [lastId,      setLastId]      = useState(null);
  const [shakeKey,    setShakeKey]    = useState(0);
  const [oofVignette, setOofVignette] = useState(false);
  const [phase,       setPhase]       = useState("fighting");
  const [showSummary, setShowSummary] = useState(false);
  const alive    = useRef(true);
  const statsRef = useRef({ newWordsSeen:0, wordsMastered:0 });

  const effectiveGold = isReplay ? Math.max(1, Math.round(room.gold * 0.20)) : room.gold;
  const effectiveXp   = room.xp;

  useEffect(()=>{
    alive.current=true; spawn(null);
    return ()=>{ alive.current=false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const spawn = useCallback((prevId) => {
    const q = generateQuestion(battlePool, ledger, prevId);
    if (q) setQuestion(q);
  }, [battlePool, ledger]);

  const triggerOofVignette = useCallback(() => {
    setOofVignette(true);
    setTimeout(() => setOofVignette(false), 600);
  }, []);

  const handleAnswer = useCallback((ok) => {
    if (!alive.current || !question) return;
    dispatchLedger({ type: ok ? "BATTLE_CORRECT" : "BATTLE_WRONG", wordId:question.wordId });
    if (ok) {
      const prev      = ledger[question.wordId];
      const prevTier  = scoreToTier(prev, question.wordId in ledger);
      const prevScore = prev===undefined?0:prev===TRAINING_SCORE?0:prev<0?0:prev;
      if (prevScore + 1 >= MASTERY_THRESHOLD && prevTier !== "mastered") statsRef.current.wordsMastered++;
      if (prevTier === "unseen" || prevTier === "training") statsRef.current.newWordsSeen++;
      const newHp = enemyHp - 1;
      setShakeKey(k=>k+1); setEnemyHp(newHp);
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

  const summaryStats = { newWordsSeen:statsRef.current.newWordsSeen, wordsMastered:statsRef.current.wordsMastered, goldEarned:effectiveGold, xpEarned:effectiveXp };
  const showRevival  = lives <= 0 && phase === "fighting";

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
        <button onClick={onBack} style={{ background:"none",border:"none",color:"#334155",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0 }}>← {stage.name}</button>
        {isReplay && <span style={{ fontSize:7,padding:"1px 5px",borderRadius:3,background:"rgba(245,158,11,0.15)",border:"1px solid rgba(245,158,11,0.3)",color:"#f59e0b",fontFamily:"monospace",fontWeight:700 }}>REPLAY · 20% GOLD</span>}
      </div>
      <div key={shakeKey} style={{ borderRadius:13, padding:"14px 15px", background:isBoss?"rgba(239,68,68,0.08)":dungeon.bg, border:`1px solid ${isBoss?"rgba(239,68,68,0.32)":dungeon.border}`, boxShadow:isBoss?"0 0 30px rgba(239,68,68,0.1)":"none", animation:shakeKey>0?"shake 0.36s ease":"none" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <div>
            <div style={{ fontSize:8, fontFamily:"monospace", color:isBoss?"#f87171":dungeon.color, letterSpacing:"0.14em", marginBottom:2 }}>{isBoss?"⚠ STAGE BOSS":dungeon.cefr} · {stage.name.toUpperCase()}</div>
            <div style={{ fontSize:13, fontWeight:900, color:"#f8fafc", fontFamily:"monospace" }}>{room.enemyName}</div>
            {isBoss && <div style={{ fontSize:9, color:"#334155", fontStyle:"italic", marginTop:2 }}>{room.lore}</div>}
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
            <div style={{ fontSize:40, lineHeight:1, animation:"float 3s ease infinite" }}>{phase==="victory"?"💥":room.emoji}</div>
            <div style={{ display:"flex", gap:3 }}>
              {Array.from({length:3}).map((_,i)=>(
                <span key={i} style={{ fontSize:14, filter:i<lives?"none":"grayscale(1) opacity(0.25)" }}>❤</span>
              ))}
            </div>
          </div>
        </div>
        <HpBar current={enemyHp} max={10} color={isBoss?"#ef4444":dungeon.color} label={room.enemyName}/>
      </div>
      {oofVignette && <div style={{ position:"fixed",inset:0,pointerEvents:"none",zIndex:999, background:"radial-gradient(ellipse at center, transparent 30%, rgba(220,38,38,0.55) 100%)", animation:"flashOut 0.6s ease forwards" }}/>}
      {showRevival && <RevivalOverlay gold={gold} onSpendGold={onSpendGold} onGiveUp={onGiveUp}/>}
      {phase==="victory" ? (
        <>
          {showSummary && <BattleSummary stats={summaryStats} room={room} dungeon={dungeon} onContinue={()=>{ setShowSummary(false); onRoomCleared(effectiveXp, effectiveGold); }}/>}
          <div style={{ textAlign:"center", padding:"26px 16px", borderRadius:13, background:"rgba(16,185,129,0.07)", border:"1px solid rgba(16,185,129,0.2)", animation:"slideUp 0.38s cubic-bezier(0.34,1.56,0.64,1)" }}>
            <div style={{ fontSize:36, marginBottom:7 }}>🏆</div>
            <div style={{ fontSize:14, fontWeight:900, color:"#34d399", fontFamily:"monospace", marginBottom:3 }}>{room.enemyName} DEFEATED</div>
            <div style={{ fontSize:9, color:"#334155", fontFamily:"monospace", marginBottom:15 }}>+{effectiveXp} XP · +{effectiveGold} 🪙{isReplay?" (replay rate)":""}</div>
            <button onClick={()=>setShowSummary(true)} style={{ padding:"10px 26px", borderRadius:9, fontFamily:"monospace", fontWeight:900, fontSize:11, cursor:"pointer", letterSpacing:"0.08em", background:"linear-gradient(135deg,#065f46,#047857)", border:"1px solid #10b981", color:"#ecfdf5", boxShadow:"0 3px 16px rgba(16,185,129,0.28)" }}>
              VIEW PROGRESS REPORT →
            </button>
          </div>
        </>
      ) : (
        !showRevival && question && (
          <QuestionCard question={question} onAnswer={handleAnswer} isBoss={isBoss} bossTimerSeconds={room.bossTimerSeconds??10} onTimerExpire={handleTimerExpire} onOof={triggerOofVignette}/>
        )
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §16  STAGE MAP  (unchanged from Phase 10)
══════════════════════════════════════════════════════════════════════════════ */
function StageMap({ dungeon, stage, completedRooms, bossCleared, onEnterRoom, onEnterBoss, onBack }) {
  if (!stage || !stage.rooms) return null;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <button onClick={onBack} style={{ background:"none",border:"none",color:"#334155",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0,alignSelf:"flex-start" }}>← {dungeon.name}</button>
      <div style={{ padding:"15px 17px", borderRadius:14, background:dungeon.bg, border:`1px solid ${dungeon.border}` }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
          <div>
            <div style={{ fontSize:8, fontFamily:"monospace", color:dungeon.color, letterSpacing:"0.18em", marginBottom:2 }}>{dungeon.cefr} · STAGE {stage.index}</div>
            <div style={{ fontSize:17, fontWeight:900, color:"#f8fafc", fontFamily:"monospace" }}>{stage.name}</div>
          </div>
          <div style={{ fontSize:32, animation:"float 4s ease infinite" }}>{stage.icon}</div>
        </div>
        <div style={{ marginTop:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, fontFamily:"monospace", color:"#1e293b", marginBottom:3 }}>
            <span>ROOMS</span><span>{Math.min(completedRooms, stage.rooms.length)}/{stage.rooms.length} + BOSS</span>
          </div>
          <div style={{ display:"flex", gap:3 }}>
            {stage.rooms.map((_,i)=>(
              <div key={i} style={{ flex:1, height:4, borderRadius:2, background:i<completedRooms?dungeon.color:"rgba(255,255,255,0.05)" }}/>
            ))}
            <div style={{ width:16, height:4, borderRadius:2, background:bossCleared?"#ef4444":"rgba(255,255,255,0.05)" }}/>
          </div>
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
        {stage.rooms.map((room,idx)=>{
          const cleared=idx<completedRooms, current=idx===completedRooms, locked=idx>completedRooms;
          return (
            <button key={room.id} disabled={locked} onClick={()=>{ if(current)onEnterRoom(room,false); else if(cleared)onEnterRoom(room,true); }}
              style={{ width:"100%",textAlign:"left",padding:"12px 14px",borderRadius:10, background:cleared?"rgba(16,185,129,0.05)":current?dungeon.bg:"rgba(255,255,255,0.01)", border:`1px solid ${cleared?"rgba(16,185,129,0.15)":current?dungeon.border:"rgba(255,255,255,0.04)"}`, cursor:locked?"default":"pointer", transition:"all 0.17s" }}>
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
            <button disabled={!bossUnlocked} onClick={()=>bossUnlocked&&onEnterBoss(b, bossCleared)}
              style={{ width:"100%",textAlign:"left",padding:"12px 14px",borderRadius:10, background:bossCleared?"rgba(16,185,129,0.05)":bossUnlocked?"rgba(239,68,68,0.08)":"rgba(255,255,255,0.01)", border:`1px solid ${bossCleared?"rgba(16,185,129,0.15)":bossUnlocked?"rgba(239,68,68,0.3)":"rgba(255,255,255,0.04)"}`, cursor:bossUnlocked?"pointer":"default", transition:"all 0.17s", boxShadow:bossUnlocked&&!bossCleared?"0 0 18px rgba(239,68,68,0.1)":"none" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:24,animation:bossUnlocked&&!bossCleared?"float 2s ease infinite":"none",filter:!bossUnlocked?"grayscale(1) opacity(0.2)":"none" }}>{!bossUnlocked?"🔒":b.emoji}</span>
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
   §17  DUNGEON SELECT — Phase 11: paginated stage list for 200-stage dungeons
   
   Shows 10 stages per page with prev/next navigation.
   Active stage is always visible (page auto-jumps to it).
══════════════════════════════════════════════════════════════════════════════ */
const STAGES_PER_PAGE = 10;

function DungeonSelect({ dungeon, dungeonProgress, onEnterStage, onBack }) {
  if (!dungeon || !Array.isArray(dungeon.stages)) return null;
  const prog          = dungeonProgress[dungeon.id] ?? { stagesCleared:0 };
  const stagesCleared = prog.stagesCleared ?? 0;

  // Auto-start on the page that contains the active stage
  const activeIdx  = Math.min(stagesCleared, dungeon.stages.length - 1);
  const [page, setPage] = useState(Math.floor(activeIdx / STAGES_PER_PAGE));

  const totalPages  = Math.ceil(dungeon.stages.length / STAGES_PER_PAGE);
  const pageStages  = dungeon.stages.slice(page * STAGES_PER_PAGE, (page + 1) * STAGES_PER_PAGE);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <button onClick={onBack} style={{ background:"none",border:"none",color:"#334155",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0,alignSelf:"flex-start" }}>← Dashboard</button>

      {/* Dungeon header */}
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

      {/* Pagination header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:9,fontFamily:"monospace",color:"#334155" }}>
          Stages {page * STAGES_PER_PAGE + 1}–{Math.min((page+1) * STAGES_PER_PAGE, dungeon.stages.length)}
          <span style={{ color:"#1e293b",marginLeft:6 }}>of {dungeon.stages.length}</span>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
            style={{ padding:"4px 10px",borderRadius:6,fontFamily:"monospace",fontSize:10,fontWeight:700,cursor:page===0?"not-allowed":"pointer",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:page===0?"#1e293b":"#94a3b8",transition:"all 0.14s" }}>
            ← Prev
          </button>
          <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1}
            style={{ padding:"4px 10px",borderRadius:6,fontFamily:"monospace",fontSize:10,fontWeight:700,cursor:page>=totalPages-1?"not-allowed":"pointer",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:page>=totalPages-1?"#1e293b":"#94a3b8",transition:"all 0.14s" }}>
            Next →
          </button>
        </div>
      </div>

      {/* Stage list — current page only */}
      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
        {pageStages.map((stage) => {
          const idx     = stage.index - 1;
          const cleared = idx < stagesCleared;
          const current = idx === stagesCleared;
          const locked  = idx > stagesCleared;
          const stageRoomsCleared = prog[`s${stage.index}_rooms`]??0;
          const stageBossCleared  = !!(prog[`s${stage.index}_boss`]);
          return (
            <button key={stage.id} disabled={locked}
              onClick={()=>!locked&&onEnterStage(stage, cleared)}
              style={{ width:"100%",textAlign:"left",padding:"13px 15px",borderRadius:11,
                background:cleared?"rgba(16,185,129,0.05)":current?dungeon.bg:"rgba(255,255,255,0.01)",
                border:`1px solid ${cleared?"rgba(16,185,129,0.16)":current?dungeon.border:"rgba(255,255,255,0.04)"}`,
                cursor:!locked?"pointer":"default", opacity:locked?0.4:1, transition:"all 0.17s" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:22, filter:locked?"grayscale(1)":"none" }}>{locked?"🔒":stage.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:2 }}>
                    <span style={{ fontSize:8,padding:"1px 5px",borderRadius:3,background:`${dungeon.color}18`,border:`1px solid ${dungeon.color}44`,color:dungeon.color,fontFamily:"monospace",fontWeight:700 }}>S{stage.index}</span>
                    <span style={{ fontSize:12,fontWeight:700,color:locked?"#1e293b":"#f8fafc",fontFamily:"monospace" }}>{stage.name}</span>
                    {cleared&&<span style={{ fontSize:8,color:"#34d399",fontFamily:"monospace",fontWeight:700 }}>CLEARED ✓</span>}
                  </div>
                  <div style={{ fontSize:9,color:locked?"#0f172a":"#334155",fontFamily:"monospace" }}>{stage.rooms.length} rooms · 1 boss · words {(stage.index-1)*WORDS_PER_STAGE+1}–{stage.index*WORDS_PER_STAGE}</div>
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

      {/* Page dots for quick navigation */}
      {totalPages > 1 && (
        <div style={{ display:"flex", gap:4, justifyContent:"center", flexWrap:"wrap", padding:"4px 0" }}>
          {Array.from({length:totalPages},(_,i)=>(
            <button key={i} onClick={()=>setPage(i)}
              style={{ width:i===page?22:8, height:8, borderRadius:4, border:"none", cursor:"pointer", transition:"all 0.18s",
                background:i===page?dungeon.color:i*STAGES_PER_PAGE<=stagesCleared?"rgba(16,185,129,0.3)":"rgba(255,255,255,0.06)" }}/>
          ))}
        </div>
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════════
   §18  DASHBOARD COMPONENTS  (unchanged)
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
  const cefrIds  = manifest.map(d => d.id);
  const activeIdx = cefrIds.findIndex(id => {
    const d = manifest.find(x => x.id === id);
    if (!d) return false;
    return (dungeonProgress[id]?.stagesCleared ?? 0) < d.stages.length;
  });
  const safeIdx  = activeIdx < 0 ? cefrIds.length - 1 : activeIdx;
  const activeMf = manifest[safeIdx];
  const sc       = activeMf ? (dungeonProgress[activeMf.id]?.stagesCleared ?? 0) : 0;
  const ts       = activeMf ? activeMf.stages.length : 1;
  const pct      = ts > 0 ? (sc/ts)*100 : 0;
  return (
    <div style={{ display:"flex",flexDirection:"column",gap:7 }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <div style={{ fontSize:8,fontFamily:"monospace",color:"#334155",letterSpacing:"0.12em" }}>CEFR JOURNEY</div>
        <div style={{ fontSize:9,fontFamily:"monospace",color:"#10b981",fontWeight:700 }}>{manifest[safeIdx]?.cefr}</div>
      </div>
      <div style={{ display:"flex",gap:4,alignItems:"center" }}>
        {manifest.map((d,i)=>{
          const done=i<safeIdx, active=i===safeIdx;
          return (
            <div key={d.id} style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:2,flex:active?3:1 }}>
              <div style={{ fontSize:7,fontFamily:"monospace",color:done?"#10b981":active?"#f8fafc":"#1e293b",fontWeight:700 }}>{d.cefr}</div>
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

function PlayerDashboard({ ledger, dungeonProgress, xp, gold, level, onPlay, manifest, onWordBank }) {
  const allIds       = useMemo(()=>Object.keys(ledger),[ledger]);
  const counts       = useMemo(()=>tallyLedger(ledger, allIds),[ledger, allIds]);
  const activeDungeon= manifest.find(d=>!d.locked) ?? manifest[0];
  const masteryPct   = computeMasteryPct(ledger, activeDungeon?.totalWords, allIds);
  const firstDungeon = manifest.find(d=>!d.locked);
  const stagesCleared= firstDungeon?(dungeonProgress[firstDungeon.id]?.stagesCleared??0):0;
  const nextStage    = firstDungeon?.stages[stagesCleared];
  const seenCount    = (counts.training??0) + (counts.learning??0) + (counts.mastered??0);

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:16 }}>
      <div style={{ padding:"20px 18px",borderRadius:16,background:"linear-gradient(135deg,rgba(99,102,241,0.12) 0%,rgba(16,185,129,0.06) 100%)",border:"1px solid rgba(99,102,241,0.22)" }}>
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
      </div>

      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8 }}>
        {[{label:"MASTERED",val:counts.mastered??0,col:"#10b981"},{label:"LEARNING",val:counts.learning??0,col:"#f59e0b"},{label:"TRAINING",val:counts.training??0,col:"#6366f1"}].map(s=>(
          <div key={s.label} style={{ padding:"12px 10px",borderRadius:10,background:"rgba(255,255,255,0.025)",border:`1px solid ${s.col}22`,textAlign:"center" }}>
            <div style={{ fontSize:18,fontWeight:900,color:s.col,fontFamily:"monospace" }}>{s.val}</div>
            <div style={{ fontSize:7,color:"#334155",fontFamily:"monospace",letterSpacing:"0.08em",marginTop:2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {seenCount > 0 && (
        <button onClick={onWordBank} style={{ padding:"11px 16px",borderRadius:10,fontFamily:"monospace",fontWeight:700,fontSize:11,letterSpacing:"0.08em",cursor:"pointer",background:"rgba(99,102,241,0.07)",border:"1px solid rgba(99,102,241,0.22)",color:"#818cf8",display:"flex",alignItems:"center",gap:8,justifyContent:"center",transition:"all 0.18s" }}>
          📚 Word Bank <span style={{ fontSize:9,opacity:0.6 }}>({seenCount} words)</span>
        </button>
      )}

      <button onClick={()=>onPlay()} style={{ padding:"16px",borderRadius:12,fontFamily:"monospace",fontWeight:900,fontSize:14,letterSpacing:"0.1em",cursor:"pointer",background:"linear-gradient(135deg,#4f46e5 0%,#10b981 100%)",border:"none",color:"#f8fafc",boxShadow:"0 4px 24px rgba(99,102,241,0.3)" }}>
        {nextStage?`▶  ENTER ${nextStage.name.toUpperCase()}`:"▶  BEGIN YOUR JOURNEY"}
      </button>

      <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
        <div style={{ fontSize:8,fontFamily:"monospace",color:"#1e293b",letterSpacing:"0.12em" }}>DUNGEONS</div>
        {manifest.map(d=>{
          const prog=dungeonProgress[d.id]?.stagesCleared??0, tot=d.stages.length;
          return (
            <button key={d.id} onClick={()=>onPlay(d)} style={{ width:"100%",textAlign:"left",padding:"11px 14px",borderRadius:10,background:d.bg,border:`1px solid ${d.border}`,cursor:"pointer",transition:"all 0.18s" }}>
              <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                <span style={{ fontSize:22,animation:"float 4s ease infinite" }}>{d.icon}</span>
                <div style={{ flex:1 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:2 }}>
                    <span style={{ fontSize:8,padding:"1px 5px",borderRadius:3,background:`${d.color}1a`,border:`1px solid ${d.color}44`,color:d.color,fontFamily:"monospace",fontWeight:900 }}>{d.cefr}</span>
                    <span style={{ fontSize:12,fontWeight:700,color:"#f8fafc",fontFamily:"monospace" }}>{d.name}</span>
                  </div>
                  <div style={{ fontSize:9,color:"#334155",fontFamily:"monospace" }}>{prog}/{tot} stages · {d.totalWords.toLocaleString()} words</div>
                  {tot>0&&<div style={{ height:3,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden",marginTop:3 }}><div style={{ height:"100%",width:`${(prog/tot)*100}%`,background:d.color,borderRadius:2 }}/></div>}
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
   §19  WORD BANK VIEW  (unchanged from Phase 10)
══════════════════════════════════════════════════════════════════════════════ */
function WordBankView({ ledger, onBack }) {
  const [filter,     setFilter]     = useState("all");
  const [cefrFilter, setCefrFilter] = useState("all");
  const [search,     setSearch]     = useState("");

  const allVocab = useMemo(() => {
    const words = [];
    for (const [chunkId, chunk] of Object.entries(MOCK_VOCAB_CHUNKS)) {
      const cefrLevel = chunkId.split("-")[0];
      for (const w of chunk) {
        const tier = scoreToTier(ledger[w.id], w.id in ledger);
        words.push({ ...w, tier, cefrLevel });
      }
    }
    return words;
  }, [ledger]);

  const unseenByLevel = useMemo(() => {
    const m = {};
    for (const w of allVocab) {
      if (!m[w.cefrLevel]) m[w.cefrLevel] = { unseen:0, seen:0 };
      if (w.tier === "unseen") m[w.cefrLevel].unseen++; else m[w.cefrLevel].seen++;
    }
    return m;
  }, [allVocab]);

  const seenVocab = useMemo(() => allVocab.filter(w => w.tier !== "unseen"), [allVocab]);

  const filtered = useMemo(() => {
    let list = seenVocab;
    if (cefrFilter !== "all") list = list.filter(w => w.cefrLevel === cefrFilter);
    if (filter !== "all")     list = list.filter(w => w.tier === filter);
    if (search.trim()) { const q=search.trim().toLowerCase(); list=list.filter(w=>w.polish.toLowerCase().includes(q)||w.english.toLowerCase().includes(q)); }
    const order = { mastered:0, learning:1, training:2 };
    return [...list].sort((a,b)=>(order[a.tier]??3)-(order[b.tier]??3));
  }, [seenVocab, cefrFilter, filter, search]);

  const tierColors = { training:"#6366f1", learning:"#f59e0b", mastered:"#10b981" };
  const tierLabels = { training:"Training", learning:"Learning", mastered:"Mastered" };
  const cefrLevels = DUNGEON_CONFIG.map(d => d.id);
  const cefrColors = Object.fromEntries(DUNGEON_CONFIG.map(d => [d.id, d.color]));
  const cefrLabels = Object.fromEntries(DUNGEON_CONFIG.map(d => [d.id, d.cefr]));

  return (
    <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
      <button onClick={onBack} style={{ background:"none",border:"none",color:"#334155",fontSize:11,cursor:"pointer",fontFamily:"monospace",padding:0,alignSelf:"flex-start" }}>← Dashboard</button>
      <div style={{ padding:"14px 16px",borderRadius:13,background:"rgba(99,102,241,0.07)",border:"1px solid rgba(99,102,241,0.22)" }}>
        <div style={{ fontSize:8,fontFamily:"monospace",color:"#818cf8",letterSpacing:"0.18em",marginBottom:3 }}>📚 WORD BANK</div>
        <div style={{ fontSize:16,fontWeight:900,color:"#f8fafc",fontFamily:"monospace" }}>Your Vocabulary</div>
        <div style={{ fontSize:9,color:"#475569",fontFamily:"monospace",marginTop:2 }}>{seenVocab.length} words encountered · {seenVocab.filter(w=>w.tier==="mastered").length} mastered</div>
      </div>
      <div style={{ display:"flex",gap:5,flexWrap:"wrap" }}>
        {cefrLevels.map(lv=>{ const stats=unseenByLevel[lv]??{unseen:0,seen:0}; const total=stats.unseen+stats.seen; if(total===0)return null; return (<div key={lv} style={{ padding:"5px 8px",borderRadius:7,background:`${cefrColors[lv]}10`,border:`1px solid ${cefrColors[lv]}33`,fontSize:8,fontFamily:"monospace" }}><span style={{ color:cefrColors[lv],fontWeight:700 }}>{cefrLabels[lv]}</span><span style={{ color:"#475569",marginLeft:5 }}>{stats.seen} seen · {stats.unseen} unseen</span></div>); })}
      </div>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search Polish or English…" style={{ padding:"9px 13px",borderRadius:9,fontFamily:"monospace",fontSize:12,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.09)",color:"#f8fafc",outline:"none" }}/>
      <div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>
        <button onClick={()=>setCefrFilter("all")} style={{ padding:"5px 9px",borderRadius:6,fontFamily:"monospace",fontWeight:700,fontSize:8,cursor:"pointer",background:cefrFilter==="all"?"rgba(255,255,255,0.08)":"transparent",border:`1px solid ${cefrFilter==="all"?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.04)"}`,color:cefrFilter==="all"?"#f8fafc":"#334155",transition:"all 0.14s" }}>ALL</button>
        {cefrLevels.map(lv=>(<button key={lv} onClick={()=>setCefrFilter(lv)} style={{ padding:"5px 9px",borderRadius:6,fontFamily:"monospace",fontWeight:700,fontSize:8,cursor:"pointer",background:cefrFilter===lv?`${cefrColors[lv]}22`:"transparent",border:`1px solid ${cefrFilter===lv?`${cefrColors[lv]}55`:"rgba(255,255,255,0.04)"}`,color:cefrFilter===lv?cefrColors[lv]:"#334155",transition:"all 0.14s" }}>{cefrLabels[lv]}</button>))}
      </div>
      <div style={{ display:"flex",gap:5 }}>
        {[["all","All"],["mastered","Mastered"],["learning","Learning"],["training","Training"]].map(([key,label])=>(
          <button key={key} onClick={()=>setFilter(key)} style={{ flex:1,padding:"6px 4px",borderRadius:7,fontFamily:"monospace",fontWeight:700,fontSize:8,letterSpacing:"0.06em",cursor:"pointer", background:filter===key?(key==="all"?"rgba(255,255,255,0.08)":`${tierColors[key]}22`):"transparent", border:`1px solid ${filter===key?(key==="all"?"rgba(255,255,255,0.2)":`${tierColors[key]}55`):"rgba(255,255,255,0.04)"}`, color:filter===key?(key==="all"?"#f8fafc":tierColors[key]):"#334155", transition:"all 0.14s" }}>{label}</button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding:"32px 16px",textAlign:"center",color:"#334155",fontFamily:"monospace",fontSize:10 }}>{seenVocab.length===0?"No words yet — start practicing!":"No words match this filter."}</div>
      ) : (
        <div style={{ display:"flex",flexDirection:"column",gap:5 }}>
          {filtered.map(w=>(
            <div key={w.id} style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:9,background:"rgba(255,255,255,0.022)",border:"1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ flex:"0 0 auto",minWidth:88 }}>
                <div style={{ fontSize:13,fontWeight:700,color:"#f8fafc",fontFamily:"monospace" }}>{w.polish}</div>
                {w.subtext&&<div style={{ fontSize:8,color:"#475569",fontFamily:"monospace" }}>{w.subtext}</div>}
              </div>
              <div style={{ flex:1,fontSize:11,color:"#94a3b8",fontFamily:"monospace" }}>{w.english}</div>
              <span style={{ fontSize:7,padding:"1px 4px",borderRadius:3,background:`${cefrColors[w.cefrLevel]??"#334155"}18`,border:`1px solid ${cefrColors[w.cefrLevel]??"#334155"}33`,color:cefrColors[w.cefrLevel]??"#334155",fontFamily:"monospace",fontWeight:700,flexShrink:0 }}>{cefrLabels[w.cefrLevel]??w.cefrLevel?.toUpperCase()}</span>
              <span style={{ fontSize:7,padding:"2px 6px",borderRadius:4,background:`${tierColors[w.tier]}18`,border:`1px solid ${tierColors[w.tier]}44`,color:tierColors[w.tier],fontFamily:"monospace",fontWeight:700,flexShrink:0 }}>{tierLabels[w.tier]}</span>
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
        {isLastStage && <div style={{ fontSize:9,color:"#10b981",fontFamily:"monospace",marginTop:4 }}>All words in this level marked Mastered! ✓</div>}
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
   §20  ROOT APP — GAME STATE MACHINE (Phase 11)
   
   Phase 11 additions:
   • sessionBuffer — built at room-entry time from unseen words in wordPool
   • sessionBuffer passed to PracticeMode and CombatScreen
   • CombatScreen builds battlePool = sessionBuffer + 20% review on mount
══════════════════════════════════════════════════════════════════════════════ */
export default function App() {
  const [xp,    setXp]    = useState(0);
  const [gold,  setGold]  = useState(100);
  const [lives, setLives] = useState(3);

  const [ledger, dispatchLedger] = useReducer(ledgerReducer, {});
  const [dungeonProgress, setDungeonProgress] = useState({});

  const [nav, setNav] = useState({
    view:         "dashboard",
    dungeon:      null,
    stage:        null,
    room:         null,
    isBoss:       false,
    wordPool:     null,
    sessionBuffer:null,   // Phase 11: unseen words captured at room-entry
    poolReady:    false,
    isReplay:     false,
  });

  const [sessionXp,   setSessionXp]   = useState(0);
  const [sessionGold, setSessionGold] = useState(0);

  useEffect(()=>{
    document.addEventListener("pointerdown", ()=>AudioService.preWarm(), { once:true });
    AudioService.loadVoices();
  },[]);

  const goTo = useCallback((patch) => setNav(n => ({ ...n, ...patch })), []);

  /* Phase 11: loadPool also builds the sessionBuffer */
  const loadPool = useCallback(async (stage, room, currentLedger) => {
    if (!stage?.chunkId) { goTo({ wordPool:[], sessionBuffer:[], poolReady:true }); return; }
    goTo({ poolReady:false });
    try {
      const words  = await VocabService.fetchChunk(stage.chunkId);
      const slice  = room?.wordSlice ?? [0, words.length];
      const sliced = words.slice(slice[0], slice[1]);
      const pool   = sliced.length >= 4 ? sliced : words.slice(0, Math.min(10, words.length));

      // Session buffer: only unseen words from this room's pool
      const buffer = pool.filter(w => scoreToTier(currentLedger[w.id], w.id in currentLedger) === "unseen");

      goTo({ wordPool:pool, sessionBuffer:buffer, poolReady:true });
    } catch(e) {
      console.error("VocabService error:", e);
      goTo({ wordPool:[], sessionBuffer:[], poolReady:true });
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
    goTo({ view:"practice", dungeon, stage, room, isBoss:false, wordPool:null, sessionBuffer:null, poolReady:false, isReplay });
    loadPool(stage, room, ledger);
  }, [goTo, loadPool, ledger]);

  const enterBoss = useCallback((dungeon, stage, boss, isReplay=false) => {
    if (!dungeon || !stage || !boss) return;
    goTo({ view:"practice", dungeon, stage, room:boss, isBoss:true, wordPool:null, sessionBuffer:null, poolReady:false, isReplay });
    loadPool(stage, boss, ledger);
  }, [goTo, loadPool, ledger]);

  const skipToCombat = useCallback(() => goTo({ view:"combat" }), [goTo]);

  const handleDungeonClear = useCallback(async (dungeon) => {
    try {
      const allWords = await VocabService.fetchAllForLevel(dungeon.id);
      const wordIds  = allWords.map(w => w.id);
      if (wordIds.length > 0) dispatchLedger({ type:"BULK_MASTER_LEVEL", wordIds });
    } catch(e) { console.error("DungeonClear error:", e); }
  }, [dispatchLedger]);

  const handleRoomCleared = useCallback((earnedXp, earnedGold) => {
    const { dungeon, stage, isBoss } = nav;
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
        if (dp.stagesCleared >= dungeon.stages.length) dungeonCleared = true;
      }
      return { ...prev, [did]:dp };
    });
    if (dungeonCleared) handleDungeonClear(dungeon);
    if (isBoss) goTo({ view:"stage_cleared" });
    else goTo({ view:"stage_map", room:null, isBoss:false, wordPool:null, sessionBuffer:null });
  }, [nav, goTo, handleDungeonClear]);

  const handlePlayerDamage    = useCallback(() => setLives(l => Math.max(0, l-1)), []);
  const handleSpendGoldRevive = useCallback(() => { if(gold<30)return; setGold(g=>g-30); setLives(1); }, [gold]);
  const handleGiveUp          = useCallback(() => { setLives(3); goTo({ view:"dashboard",dungeon:null,stage:null,room:null,isBoss:false,wordPool:null,sessionBuffer:null,isReplay:false }); }, [goTo]);

  const level = Math.floor(xp/200)+1;
  const { view, dungeon, stage, room, isBoss, wordPool, sessionBuffer, poolReady, isReplay } = nav;
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
                <span style={{ fontSize:8,color:"#334155",marginLeft:7 }}>PHASE 12</span>
              </h1>
              <p style={{ fontSize:7,color:"#1e293b",letterSpacing:"0.1em",marginTop:1 }}>SUPABASE LIVE · PROC GEN · SESSION BUFFER · TRAINING FIX</p>
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
            <PlayerDashboard ledger={ledger} dungeonProgress={dungeonProgress} xp={xp} gold={gold} level={level}
              manifest={DUNGEON_MANIFEST}
              onPlay={(d) => { const target=(d&&typeof d==="object")?d:DUNGEON_MANIFEST.find(x=>!x.locked); if(target)enterDungeon(target); }}
              onWordBank={()=>goTo({ view:"word_bank" })}/>
          )}
          {view==="word_bank" && <WordBankView ledger={ledger} onBack={()=>goTo({ view:"dashboard" })}/>}
          {view==="dungeon_select" && dungeon && (
            <DungeonSelect dungeon={dungeon} dungeonProgress={dungeonProgress}
              onEnterStage={(s,replay=false)=>enterStage(dungeon,s,replay)}
              onBack={()=>goTo({ view:"dashboard",dungeon:null })}/>
          )}
          {view==="stage_map" && dungeon && stage && (
            <StageMap dungeon={dungeon} stage={stage} completedRooms={roomsCleared} bossCleared={bossCleared}
              onEnterRoom={(r,replay=false)=>enterRoom(dungeon,stage,r,replay)}
              onEnterBoss={(b,replay=false)=>enterBoss(dungeon,stage,b,replay)}
              onBack={()=>goTo({ view:"dungeon_select",stage:null })}/>
          )}
          {view==="practice" && dungeon && stage && room && (
            !poolReady ? (
              <div style={{ display:"flex",flexDirection:"column",alignItems:"center",gap:12,padding:"48px 20px" }}>
                <div style={{ fontSize:28,animation:"float 1.5s ease infinite" }}>📖</div>
                <div style={{ fontSize:10,color:"#334155",fontFamily:"monospace",letterSpacing:"0.1em" }}>LOADING WORDS…</div>
              </div>
            ) : (
              <PracticeMode
                sessionBuffer={sessionBuffer??[]} wordPool={wordPool??[]}
                dungeon={dungeon} stage={stage} room={room}
                onComplete={skipToCombat}
                onBack={()=>goTo({ view:"stage_map",room:null,wordPool:null,sessionBuffer:null })}
                dispatchLedger={dispatchLedger}
                isReplay={isReplay}/>
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
                isBoss={isBoss} wordPool={wordPool??[]} sessionBuffer={sessionBuffer??[]}
                ledger={ledger} dispatchLedger={dispatchLedger}
                onRoomCleared={handleRoomCleared} onPlayerDamage={handlePlayerDamage}
                onBack={()=>goTo({ view:"stage_map",room:null,wordPool:null,sessionBuffer:null,isBoss:false })}
                lives={lives} gold={gold} onSpendGold={handleSpendGoldRevive} onGiveUp={handleGiveUp}
                isReplay={isReplay}/>
            )
          )}
          {view==="stage_cleared" && dungeon && stage && (
            <StageClearedScreen stage={stage} dungeon={dungeon} xpEarned={sessionXp} goldEarned={sessionGold} isLastStage={isLastStage}
              onContinue={()=>{
                setSessionXp(0); setSessionGold(0);
                if(isLastStage){goTo({view:"dashboard",dungeon:null,stage:null,room:null});}
                else{goTo({view:"dungeon_select",stage:null,room:null,wordPool:null,sessionBuffer:null});}
              }}/>
          )}
        </div>
      </div>
    </div>
  );
}
