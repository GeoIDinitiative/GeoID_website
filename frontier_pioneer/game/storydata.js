/**
 * THE STORY'S DATA AND ITS VOICE: loading story/*.json, the line index, the
 * voice files, a small condition language, and the one speech queue every
 * story module speaks through (subtitle + voice, started together).
 *
 * story/ is the source of truth (MASTER_SCRIPT.md, acts.json, cutscenes.json,
 * dialogue/*.json, population.json, collectibles.json, lines.json,
 * voices.json); nothing here rewrites it. assets/voice/index.json maps a line
 * id to its rendered file ({file, dur, speaker}); a line without a file is
 * shown as a subtitle for its reading time instead.
 *
 *   const D = await loadStory();         // cached: every caller gets the same object
 *   D.mission(id), D.cutscene(id), D.line(id), D.voice(id), D.choice(choiceId), D.anchorIndex(id)
 *   evalCond("truth_told_lead in ['builder','honest'] and count(names.used) > 0", vars)
 *   const sp = speech(game); await sp.say(lineOrId, { style, preset, bark });  sp.clear();
 *
 * No eval anywhere (the page's CSP forbids it): the condition language is a
 * tiny recursive-descent parser over identifiers, strings, numbers, `not`,
 * `and`, `or`, `in [...]`, comparisons and `count(prefix)`.
 */
import { getSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";

export const STORY_URL = new URL("../story/", import.meta.url).href;
// The build stamp (tools/stamp.py puts it on every module URL), carried onto the story's data and voice files: the
// live site's service worker serves JSON stale-while-revalidate and audio cache-first by URL, so an update must move the URL.
const BUILD = new URL(import.meta.url).searchParams.get("v") || "";
const withBuild = (url, v = BUILD) => (v ? url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(v) : url);
export const VOICE_URL = new URL("../assets/voice/", import.meta.url).href;

/** lines.json presets -> the voice bus's presets (audio.js VOICE_PRESETS). */
export const PRESET = { helmet: "helmet", grille: "grille", dry: "dry", radio: "dry", memory: "memory", broadcast: "broadcast", live: "live",
  corrupted: "corrupted", unfiltered: "live", signed: "helmet", archive: "broadcast", intercom: "grille", phone: "broadcast", glitch: "glitch" };
/** Subtitle style (uistory.js) for a line, from its speaker and preset. */
export function styleFor(speaker, preset) {
  const s = String(speaker || "");
  if (s === "KEEPER" || preset === "radio" || preset === "dry") return "radio";
  if (preset === "memory" || /^(ALICE|LUCY|DAD|MAM|DES|NIAMH|P1_MEM)$/.test(s)) return "memory";
  if (preset === "grille" || preset === "intercom" || /^UNIT:/.test(s)) return "unit";
  return "live";
}
/** What the subtitle calls a speaker. */
export function speakerName(s, o = {}) {
  if (!s) return "";
  if (s === "P1") return o.burnt ? "PIONEER-1" : "PIONEER-1";
  if (s === "CARD") return "";
  if (s === "P1_MEM") return "ROWAN";
  if (s === "PIONEER_N") return "PIONEER-?";
  if (s === "CITS_PA") return "CITIES IN THE SKY";
  if (/^UNIT:/.test(s)) return o.callsign || "UNIT";
  return s.replace(/^PIONEER_(\d+)$/, "PIONEER-$1").replace(/_/g, " ");
}
export const readTime = (t) => Math.max(2.2, Math.min(10, 1.2 + String(t || "").split(/\s+/).length * 0.36));

/* ── loading ─────────────────────────────────────────────────────────────── */

let _D = null;
const getJSON = async (url) => { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(r.status + " " + url); return r.json(); };

export function loadStory() {
  if (_D) return _D;
  _D = (async () => {
    const f = (n) => getJSON(withBuild(STORY_URL + n));
    const [acts, cut, keeper, founders, second, others, memory, population, collectibles, lines] = await Promise.all([
      f("acts.json"), f("cutscenes.json"), f("dialogue/keeper.json"), f("dialogue/founders.json"), f("dialogue/second_ring.json"),
      f("dialogue/others.json"), f("dialogue/memory_voices.json"), f("population.json"), f("collectibles.json"), f("lines.json")]);
    let vindex = {};
    try { vindex = (await getJSON(withBuild(VOICE_URL + "index.json"))).lines || {}; } catch (e) { console.warn("[story] no voice index yet: subtitles only", e.message); }
    const D = { acts, cut, keeper, founders: founders.founders || {}, second: second.units || {}, others, memory, population, collectibles };
    D.lineMap = new Map(lines.lines.map((l) => [l.id, l]));
    D.voiceMap = new Map(Object.entries(vindex));
    D.missions = acts.missions;
    D.missionMap = new Map(acts.missions.map((m) => [m.id, m]));
    D.cutMap = new Map(cut.cutscenes.map((c) => [c.id, c]));
    D.anchors = acts.hidden_timeline.anchors;
    D.anchorOrder = Object.keys(D.anchors);
    D.mainOrder = acts.missions.filter((m) => m.kind === "main" || m.kind === "optional").map((m) => m.id);
    // every story choice wherever it is defined (objectives, others.json, cutscene beats)
    D.choices = new Map();
    const walk = (o) => { if (!o || typeof o !== "object") return; if (o.choice_id && Array.isArray(o.options)) { if (!D.choices.has(o.choice_id)) D.choices.set(o.choice_id, o); } for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v); };
    walk(others); walk(acts.missions); walk(cut.cutscenes);
    D.mission = (id) => D.missionMap.get(id) || null;
    D.cutscene = (id) => D.cutMap.get(id) || null;
    D.line = (id) => D.lineMap.get(id) || null;
    D.voice = (id) => D.voiceMap.get(id) || null;
    D.choice = (id) => D.choices.get(id) || null;
    /** Story order of anything with an anchor: mission ids and cutscene ids in hidden_timeline order. */
    D.anchorIndex = (id) => { const i = D.anchorOrder.indexOf(id); if (i >= 0) return i; const m = D.missionMap.get(id); return m ? D.mainOrder.indexOf(id) : -1; };
    return D;
  })();
  _D.catch(() => { _D = null; });
  return _D;
}

/* ── the condition language ──────────────────────────────────────────────── */

function tokenize(s) {
  const out = [], re = /\s*(?:(\d+(?:\.\d+)?)|'([^']*)'|"([^"]*)"|(==|!=|>=|<=|>|<|\(|\)|\[|\]|,)|([A-Za-z_][\w.]*))/y;
  let m; re.lastIndex = 0;
  while (re.lastIndex < s.length && (m = re.exec(s))) {
    if (m[1] != null) out.push({ k: "num", v: +m[1] });
    else if (m[2] != null || m[3] != null) out.push({ k: "str", v: m[2] ?? m[3] });
    else if (m[4] != null) out.push({ k: "op", v: m[4] });
    else if (m[5] != null) out.push({ k: "id", v: m[5] });
    if (!m[0].length) break;
  }
  return out;
}
/** Read a dotted variable; `prefix.*` objects count as their truthy keys. */
export function getVar(vars, name) {
  if (name === "true") return true; if (name === "false") return false; if (name === "null") return null;
  if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
  // a prefix of set keys reads as an object
  const pre = name + ".", keys = Object.keys(vars).filter((k) => k.startsWith(pre) && vars[k]);
  return keys.length ? Object.fromEntries(keys.map((k) => [k.slice(pre.length), vars[k]])) : undefined;
}
export function evalCond(expr, vars = {}) {
  if (expr == null || expr === "") return true;
  if (typeof expr === "boolean") return expr;
  const T = tokenize(String(expr)); let i = 0;
  const peek = () => T[i], next = () => T[i++];
  const isId = (v) => peek() && peek().k === "id" && peek().v === v;
  const primary = () => {
    const t = next(); if (!t) return undefined;
    if (t.k === "num" || t.k === "str") return t.v;
    if (t.k === "op" && t.v === "(") { const v = or(); next(); return v; }
    if (t.k === "op" && t.v === "[") { const arr = []; while (peek() && !(peek().k === "op" && peek().v === "]")) { arr.push(primary()); if (peek() && peek().v === ",") next(); } next(); return arr; }
    if (t.k === "id" && t.v === "count" && peek() && peek().v === "(") { next(); const a = next(); next(); const v = a ? getVar(vars, a.v) : undefined; return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : v ? 1 : 0; }
    if (t.k === "id") return getVar(vars, t.v);
    return undefined;
  };
  const cmp = () => {
    let a = primary();
    for (;;) {
      if (isId("in")) { next(); const b = primary(); a = Array.isArray(b) ? b.includes(a) : false; continue; }
      if (isId("not") && T[i + 1] && T[i + 1].v === "in") { i += 2; const b = primary(); a = Array.isArray(b) ? !b.includes(a) : true; continue; }
      const t = peek();
      if (t && t.k === "op" && ["==", "!=", ">=", "<=", ">", "<"].includes(t.v)) {
        next(); const b = primary(), x = a ?? 0;
        a = t.v === "==" ? a == b : t.v === "!=" ? a != b : t.v === ">=" ? x >= b : t.v === "<=" ? x <= b : t.v === ">" ? x > b : x < b;      // eslint-disable-line eqeqeq
        continue;
      }
      return a;
    }
  };
  const unary = () => { if (isId("not")) { next(); return !unary(); } return cmp(); };
  const and = () => { let a = unary(); while (isId("and")) { next(); const b = unary(); a = !!a && !!b; } return a; };
  const or = () => { let a = and(); while (isId("or")) { next(); const b = and(); a = !!a || !!b; } return a; };
  try { return !!or(); } catch { return false; }
}

/* ── speech: subtitle and voice together, one line at a time ─────────────── */

/**
 * One queue for every story line (cutscenes, mission dialogue, KEEPER, unit barks).
 * A line resolves when it has been heard: the voice's end or the reading time,
 * whichever is longer (a missing file, or no Web Audio, just leaves the subtitle up).
 * Barks are dropped rather than queued behind a conversation.
 */
export function speech(game) {
  if (game._storySpeech) return game._storySpeech;
  let chain = Promise.resolve(), pending = 0, gen = 0, cur = null;
  const ui = () => game.hud && game.hud.ui;
  const audio = () => { const a = getSystem("audio"); return a && a.api ? a.api : null; };
  const one = async (D, raw, o, myGen) => {
    if (myGen !== gen) return { skipped: true };
    const L = typeof raw === "string" ? (D && D.line(raw)) || { id: raw, text: raw } : raw || {};
    const id = L.line || L.id || null, meta = (D && id && D.line(id)) || {};
    let text = o.text || L.text || meta.text || "";
    if (o.fill) text = text.replace(/\{(\w+)\}/g, (m, k) => (o.fill[k] != null ? o.fill[k] : m));
    const spk = L.speaker || meta.speaker || "";
    const filter = (game.hud && game.hud.ui && game.hud.ui.filterState) || "intact";
    let pre = L.preset || o.preset || meta.preset || (spk === "KEEPER" ? "dry" : spk === "P1" ? "helmet" : "live");
    if (filter === "burnt" && (spk === "P1" || pre === "grille")) pre = "unfiltered";
    const style = o.style || styleFor(spk, pre);
    const v = D && id ? D.voice(id) : null;
    const dur = v && v.dur ? v.dur : 0;
    const secs = Math.max(o.minSeconds || 0, dur ? dur + 0.45 : readTime(text) * (o.rate || 1));
    const name = o.who != null ? o.who : speakerName(spk, { callsign: o.callsign, burnt: filter === "burnt" });
    game.emit("story:line", { id, speaker: spk, text, voiced: !!v, seconds: secs });
    const U = ui();
    let h = null;
    const A = audio();
    if (v && A && !o.mute) {
      try { h = A.voice(withBuild(VOICE_URL + v.file, v.key || BUILD), { preset: PRESET[pre] || "helmet", speaker: name, text, duration: dur, glitch: o.glitch || 0 }); } catch (e) { console.warn("[story] voice", e); }
    } else if (A && !o.mute) {
      // no file: still tell the subtitles' listeners (and the tests) that a line was spoken, timed from the text
      try { game.emit("voice:start", { id: null, speaker: name, text, preset: PRESET[pre] || "helmet", duration: secs, silent: true }); } catch { /* listeners */ }
      setTimeout(() => { try { game.emit("voice:end", { id: null, speaker: name, text, silent: true }); } catch { /* listeners */ } }, secs * 1000);
    }
    cur = { h, gen: myGen };
    const shown = U && U.say ? U.say({ speaker: name, text: text.replace(/\[FILTERED\]/g, "▓▓▓▓"), style, seconds: secs }) : new Promise((r) => setTimeout(r, secs * 1000));
    // a voice that never starts (a suspended context before the first gesture) must not hold the story: the subtitle's time bounds it
    const r = await shown;
    if (h && h.playing && !(r && r.skipped)) await Promise.race([h.done, new Promise((ok) => setTimeout(ok, 1500))]);
    if (h && h.playing) h.stop();
    cur = null;
    return r || {};
  };
  const sp = {
    get busy() { return pending > 0; },
    /** Queue one line (a line object, a line id, or {speaker, text}); resolves {skipped} when it has been heard. */
    say(line, o = {}) {
      if (o.bark && pending > 0) return Promise.resolve({ skipped: true, dropped: true });
      pending++;
      const myGen = gen;
      const p = chain.then(() => loadStory().catch(() => null)).then((D) => one(D, line, o, myGen)).catch((e) => { console.warn("[story] say", e); return {}; })
        .finally(() => { pending--; });
      chain = p.catch(() => {});
      return p;
    },
    /** Lines in order; stops early on a skip. */
    async seq(lines, o = {}) { for (const l of lines || []) { if (o.when && !evalCond(l.if, o.when())) continue; const r = await sp.say(l, o); if (r && r.skipped && !r.dropped) return r; } return {}; },
    /** Drop everything queued and stop what is playing. */
    clear() {
      gen++;
      if (cur && cur.h) { try { cur.h.stop(); } catch { /* gone */ } }
      const U = ui(); if (U && U.sayClear) U.sayClear();
    },
  };
  game._storySpeech = sp;
  return sp;
}

/* ── small shared helpers ────────────────────────────────────────────────── */

export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** A seeded generator (mulberry32). */
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export const humanise = (id) => String(id || "").replace(/^[a-z_]+\./, "").replace(/_/g, " ").replace(/\b(\d)\b/g, "$1").replace(/^\w/, (c) => c.toUpperCase());
/** This module's stylesheet (story.css), with the same cache stamp as the module asking. */
export function ensureStoryStyles() {
  if (typeof document === "undefined" || document.getElementById("story-css")) return;
  const l = document.createElement("link"); l.id = "story-css"; l.rel = "stylesheet"; l.href = new URL("../story.css", import.meta.url).href.split("?")[0] + new URL(import.meta.url).search;
  document.head.appendChild(l);
}
