/**
 * KEEPER: the HALO-1 logistics intelligence, and the terminal you type to it.
 *
 * "KEEPER never lies. KEEPER answers exactly the question asked, never the
 * question meant." (story/dialogue/keeper.json rules). So the matcher is
 * forgiving about SPELLING and PHRASING NOISE (case, punctuation,
 * contractions, "Keeper," and "please", number words, a typo or two) and
 * strict about MEANING: "how many sols since landing" is not "how many MARS
 * sols since landing", and gets the literal answer to the question it is.
 *
 *   match(D, text, ctx) -> { q, kind: "follow" | "accept" | "near" | "keywords" | "fuzzy", answer?, follow? } | null
 *   resolve(D, q, ctx, answer?) -> [line, ...]      // the answer for the story's present (stage keys, templates)
 *   deflection(text) -> line
 *   class Terminal: the console (a transcript, a typed question, the menu of questions the story has opened)
 *
 * ctx = { stage: anchor id (a mission id from acts.json hidden_time), act: "I".."V" | "fugitive", vars, D,
 *         sleptSols, trueSol, earthDays, missionSol, callsign(name) -> unit record }
 *
 * The terminal is reached at a base (or the lander, before there is one): J on the keyboard, or "KEEPER
 * terminal" in the pause menu. The game holds while it is open.
 */
import { getSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { loadStory, speech, evalCond, esc, ensureStoryStyles } from "./storydata.js?v=6d37c9c-9b39e129";

/* ── the forgiving normaliser ────────────────────────────────────────────── */

const CONTRACT = [["what's", "what is"], ["who's", "who is"], ["where's", "where is"], ["when's", "when is"], ["how's", "how is"], ["it's", "it is"], ["that's", "that is"],
  ["there's", "there is"], ["i'm", "i am"], ["i've", "i have"], ["i'd", "i would"], ["you're", "you are"], ["didn't", "did not"], ["don't", "do not"], ["doesn't", "does not"],
  ["isn't", "is not"], ["aren't", "are not"], ["wasn't", "was not"], ["can't", "cannot"], ["won't", "will not"], ["haven't", "have not"], ["whats", "what is"], ["whos", "who is"], ["im", "i am"]];
const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const FILLER_START = /^(?:(?:hey|ok|okay|so|right|well|and|um|uh)\s+)*(?:keeper\s+)?(?:(?:please|can you|could you|would you|will you)\s+)?(?:tell me|let me know|i want to know|i would like to know|do you know)?\s*/;
export function normalise(s) {
  let t = String(s || "").toLowerCase().replace(/[\u2019\u2018\u0060]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/\bc-(\d+)/g, "c$1").replace(/-/g, " ");
  t = t.replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
  for (const [a, b] of CONTRACT) t = t.replace(new RegExp("\\b" + a.replace("'", "'?") + "\\b", "g"), b);
  t = t.replace(/'/g, "");
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (w) => String(NUM[w]));
  t = t.replace(/^keeper\s+/, "").replace(/\s+keeper$/, "").replace(FILLER_START, "").replace(/\s+please$/, "").replace(/^please\s+/, "");
  return t.replace(/\s+/g, " ").trim();
}
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length; if (!m || !n) return m || n;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) { cur[0] = i; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [prev, cur] = [cur, prev]; }
  return prev[n];
}
const ratio = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
const has = (t, phrase) => (" " + t + " ").includes(" " + phrase + " ");
/** An accept phrase with {callsign} / {unit} slots, as a pattern over the normalised text. */
function slotPattern(p) {
  if (!/\{\w+\}/.test(p)) return null;
  const parts = p.split(/(\{\w+\})/).map((x) => (/^\{\w+\}$/.test(x) ? "(.+?)" : normalise(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return new RegExp("^" + parts.join(" ?").replace(/\s+/g, " ").replace(/ \?/g, " ?") + "$");
}

/* ── matching ────────────────────────────────────────────────────────────── */

export function stageIndex(D, id) { return id == null ? -1 : D.anchorIndex(id); }
export function available(D, q, ctx) {
  const a = q.available || {};
  if (a.from && stageIndex(D, ctx.stage) < stageIndex(D, a.from)) return false;
  if (a.requires && !evalCond(a.requires, ctx.vars || {})) return false;
  return true;
}
/** The KEEPER question the text is, or null. ctx.last: the previous question (its follow-ups are tried first). */
export function match(D, text, ctx = {}) {
  const t = normalise(text);
  if (!t) return null;
  const Q = D.keeper.questions;
  const N = (s) => normalise(s);
  // 1. a follow-up of the question just answered
  if (ctx.last) {
    const lq = Q.find((q) => q.id === ctx.last);
    for (const f of (lq && lq.follow_ups) || []) {
      if (f.available && f.available.from && stageIndex(D, ctx.stage) < stageIndex(D, f.available.from)) continue;
      if ((f.accept || []).some((a) => N(a) === t || ratio(N(a), t) >= 0.88)) return { q: lq, kind: "follow", follow: f, answer: f.answer };
    }
  }
  // 2. an accepted phrasing, exactly (after normalising), or a slot pattern ({callsign})
  for (const q of Q) for (const a of q.accept || []) {
    const pat = slotPattern(a);
    if (pat) { const m = t.match(pat); if (m) return { q, kind: "accept", slot: m[1] }; }
    else if (N(a) === t) return { q, kind: "accept" };
  }
  // 3. a near miss: the literal answer to the question that WAS asked
  for (const q of Q) for (const nm of q.near_miss || []) if ((nm.match || []).some((p) => has(t, N(p)))) return { q, kind: "near", answer: nm.answer };
  // 4. keywords (all of, and one of)
  const words = t.split(" ");
  const hasWord = (k) => (k.includes(" ") ? has(t, N(k)) : words.some((w) => w === k || (k.length >= 3 && w.startsWith(k) && w.length <= k.length + 2)));
  for (const q of Q) {
    const k = q.keywords; if (!k) continue;
    if ((k.all || []).every(hasWord) && (!k.any || !k.any.length || k.any.some(hasWord))) return { q, kind: "keywords" };
  }
  // 5. typos: very close to one accepted phrasing
  let best = null;
  for (const q of Q) for (const a of q.accept || []) { if (/\{/.test(a)) continue; const r = ratio(N(a), t); if (r >= 0.86 && (!best || r > best.r)) best = { q, r }; }
  return best ? { q: best.q, kind: "fuzzy" } : null;
}
export function deflection(D, text) {
  const t = normalise(text), Dfl = D.keeper.deflections, by = (id) => Dfl.find((d) => d.line.endsWith(id)) || Dfl[0];
  if (!t) return by("specify");
  if (/\b(joke|sing|song|feel|love|happy|sad|weather like|favourite|hobby|bored|story)\b/.test(t)) return by("not_task");
  if (t.split(" ").length <= 2) return by("rephrase");
  return by("unknown");
}

/* ── answers for the story's present ─────────────────────────────────────── */

function pickStage(D, a, ctx) {
  const si = stageIndex(D, ctx.stage), keys = Object.keys(a);
  const anchorKeys = keys.filter((k) => D.anchors[k]);
  if (anchorKeys.length) {
    let best = null;
    for (const k of anchorKeys) { const i = stageIndex(D, k); if (i <= si && (!best || i > best.i)) best = { k, i }; }
    if (best) return a[best.k];
  }
  let from = null;
  for (const k of keys) if (k.startsWith("from_")) { const i = stageIndex(D, k.slice(5)); if (si >= i && (!from || i > from.i)) from = { k, i }; }
  if (from) return a[from.k];
  if (a.act_v && (ctx.act === "V" || ctx.act === "fugitive")) return a.act_v;
  if (a.act_iv && ctx.act === "IV") return a.act_iv;
  let until = null;
  for (const k of keys) if (k.startsWith("until_")) { const i = stageIndex(D, k.slice(6) === "4.0" ? "4.1" : k.slice(6)); if (si < i && (!until || i < until.i)) until = { k, i }; }
  if (until) return a[until.k];
  const my = keys.find((k) => k === "mission_year_" + (ctx.missionYear || 1));
  if (my) return a[my];
  if (a.default) return a.default;
  return anchorKeys.length ? a[anchorKeys[0]] : null;
}
const lineObj = (D, x) => (typeof x === "string" ? Object.assign({ line: x }, D.line(x) ? { speaker: D.line(x).speaker, text: D.line(x).text } : { speaker: "ATLAS", text: x }) : x);
/** The lines of an answer, as line objects, for the story's present. */
export function resolve(D, q, ctx, answer = q.answer, slot = null) {
  if (answer == null) return [];
  if (typeof answer === "string") return [lineObj(D, answer)];
  if (Array.isArray(answer)) return answer.map((x) => lineObj(D, x));
  if (answer.line || answer.text && !answer.template) return [answer];
  if (answer.template) {
    // a unit's file: the voiced example for a founder, else the template filled from the unit's donor template
    const ex = (answer.voiced_examples || []).find((e) => slot && new RegExp("\\b" + String(slot).replace(/[^a-z0-9]/gi, "").toLowerCase() + "\\b", "i").test(e.text.replace(/[^a-z0-9 ]/gi, " ")));
    if (ex) return [ex];
    if (answer.voiced) {
      const k = Object.keys(answer.voiced).filter((x) => stageIndex(D, x) <= stageIndex(D, ctx.stage)).sort((a, b) => stageIndex(D, b) - stageIndex(D, a))[0];
      if (k && (!ctx.sleptAnchor || ctx.sleptAnchor === k)) return [answer.voiced[k]];
      return [{ speaker: "ATLAS", text: answer.template.replace("{n}", String(ctx.sleptSols || 0)) }];
    }
    const u = ctx.callsign ? ctx.callsign(slot) : null;
    if (!u) return [{ line: "KEEPER.deflect.not_held", speaker: "ATLAS", text: "That information is not held." }];
    return [{ speaker: "ATLAS", text: answer.template.replace(/\{(\w+)\}/g, (m, k) => (u[k] != null ? u[k] : m)) }];
  }
  return resolve(D, q, ctx, pickStage(D, answer, ctx), slot);
}

/* ── the terminal ────────────────────────────────────────────────────────── */

export class Terminal {
  constructor(game, story) {
    this.game = game; this.story = story; this.last = null; this.open = false; this.busy = false;
    ensureStoryStyles();
    const el = this.el = document.createElement("section");
    el.id = "screen-keeper"; el.className = "screen modal keeper"; el.hidden = true; el.setAttribute("data-pad-closable", "");
    el.innerHTML = `<div class="card wide kt-card">
      <div class="kt-head"><div><div class="eyebrow">HALO-1 · logistics</div><h2>ATLAS</h2></div><p class="kt-stat"></p></div>
      <div class="kt-log" role="log" aria-live="polite"></div>
      <form class="kt-ask" autocomplete="off"><label class="kt-prompt" for="k-input">&gt;</label><input id="k-input" type="text" maxlength="160" spellcheck="false" placeholder="Type a question for ATLAS"><button type="submit" class="btn">Ask</button></form>
      <div class="eyebrow kt-menu-h">Records you can ask for</div>
      <div class="kt-menu"></div>
      <div class="row"><button type="button" class="btn primary" data-pad-close data-k="close">Close the terminal</button></div></div>`;
    document.body.appendChild(el);
    this.log = el.querySelector(".kt-log"); this.input = el.querySelector("#k-input"); this.menu = el.querySelector(".kt-menu"); this.stat = el.querySelector(".kt-stat");
    el.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); const v = this.input.value; this.input.value = ""; this.ask(v, { typed: true }); });
    el.querySelector('[data-k="close"]').addEventListener("click", () => this.close());
    window.addEventListener("keydown", (e) => { if (this.open && e.code === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); this.close(); } }, true);
  }
  _line(who, text, cls = "") { const p = document.createElement("p"); p.className = "kt-line " + cls; p.innerHTML = (who ? `<b>${esc(who)}</b>` : "") + `<span>${esc(text)}</span>`; this.log.appendChild(p); this.log.scrollTop = this.log.scrollHeight; return p; }
  async show() {
    const g = this.game, D = await loadStory();
    if (this.open) return;
    this.open = true; g.keeperOpen = true;
    this._resume = g.live;
    if (g.live) g.pause(true);
    const menu = document.getElementById("screen-menu"); this._fromMenu = menu && !menu.hidden; if (menu) menu.hidden = true;
    this.el.hidden = false;
    this.renderMenu(D);
    const ctx = this.story.keeperCtx();
    this.stat.textContent = `Mission sol ${ctx.missionSol} · link nominal`;
    if (!this.log.childElementCount) this._line("ATLAS", "Link established. Query.", "kt-keeper");
    const P = window.GeoIDPad;
    if (P && P.connected) setTimeout(() => P.focus.first(this.el), 60); else setTimeout(() => this.input.focus(), 30);
    this.story.notify("open_panel", { panel: "keeper" });
  }
  close() {
    if (!this.open) return;
    this.open = false; this.game.keeperOpen = false; this.el.hidden = true;
    const P = window.GeoIDPad; if (P && P.focus) P.focus.clear();
    if (this._fromMenu) { const menu = document.getElementById("screen-menu"); if (menu) menu.hidden = false; }
    else if (this._resume && this.game.mode === "menu") this.game.pause(false);
  }
  renderMenu(D) {
    const ctx = this.story.keeperCtx();
    const qs = D.keeper.questions.filter((q) => available(D, q, ctx) && !/\{/.test(q.menu_label || ""));
    this.menu.innerHTML = qs.map((q) => `<button type="button" class="kt-q" data-q="${esc(q.id)}">${esc(q.menu_label)}</button>`).join("") || `<p class="fine">No records are open yet.</p>`;
    this.menu.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => { const q = D.keeper.questions.find((x) => x.id === b.dataset.q); if (q) this.ask(q.accept[0], { menu: q }); }));
  }
  /** Ask a question (typed or from the menu). Resolves { id, kind, lines } once KEEPER has answered. */
  async ask(text, o = {}) {
    const D = await loadStory(), g = this.game, sp = speech(g), ctx = this.story.keeperCtx();
    if (this.busy) await this.busy;
    let done;
    this.busy = new Promise((r) => { done = r; });
    try {
      ctx.last = this.last;
      if (o.typed !== false && text) this._line("", "> " + text, "kt-you");
      let m = o.menu ? { q: o.menu, kind: "accept" } : match(D, text, ctx);
      if (m && m.kind !== "follow" && m.kind !== "near" && !available(D, m.q, ctx)) m = null;          // not a record the story has opened: it does not match a record
      if (!m) {
        const d = deflection(D, text);
        this._line("ATLAS", d.text, "kt-keeper");
        await sp.say(d, { style: "radio" });
        this.story.notify("keeper_deflect", { text });
        return { id: null, kind: "deflect", lines: [d] };
      }
      const q = m.q;
      if (o.menu && q.p1_line) await sp.say(q.p1_line);
      // a cutscene plays instead of the plain answer (C12, C13), when the story says so
      const cs = this.story.keeperCutscene(q.id, m);
      if (cs) {
        this._line("ATLAS", "[archive playback]", "kt-keeper");
        this.close();
        this.last = q.id;
        this.story.notify("ask_keeper", { id: q.id, kind: m.kind, cutscene: cs });
        return { id: q.id, kind: m.kind, cutscene: cs, lines: [] };
      }
      const lines = resolve(D, q, ctx, m.answer !== undefined ? m.answer : q.answer, m.slot);
      for (const l of lines) {
        const filtered = /\[FILTERED\]/.test(l.text || "") && this.story.filterScrubs();
        const shown = filtered ? l.text.replace(/\[FILTERED\]/g, "▓▓▓▓") : (l.text || "").replace(/\[FILTERED\]/g, "");
        this._line(l.speaker === "P1" ? "YOU" : l.speaker || "ATLAS", shown, l.speaker === "P1" ? "kt-you" : "kt-keeper");
        await sp.say(l);
        if (filtered) {
          const A = getSystem("audio"); if (A && A.api) A.api.filterGlitch(0.8, 0.8);
          if (g.hud.ui && g.hud.ui.glitch) g.hud.ui.glitch(0.6, 0.8);
          this._line("", "DATA RECONCILED", "kt-sys");
          g.hud.toast("DATA RECONCILED", 2.5);
        }
      }
      // what asking it sets (knowledge flags, a unit's name)
      if (q.sets) for (const [k, v] of Object.entries(q.sets)) this.story.setVar(k.replace("{callsign}", String(m.slot || "").toUpperCase()), v);
      if (q.clue) this.story.clue(q.clue);
      if (m.kind !== "near") this.last = q.id;
      this.renderMenu(D);
      this.story.notify("ask_keeper", { id: q.id, kind: m.kind, slot: m.slot || null });
      return { id: q.id, kind: m.kind, lines };
    } finally { done(); this.busy = null; }
  }
}
