/**
 * THE STORY LAYER of the interface: dialogue, choices, cutscenes, the
 * perception filter, and tags on things in the world. Installed on the
 * interface manager (uiman.js), so a story system calls it as game.hud.ui.*.
 *
 * "The HUD is a character. The interface is the perception filter. When the
 * story cracks, the UI cracks with it." Everything here is the GeoHUB skin
 * (tokens only) and sits outside the HUD layer, so it keeps working while
 * the HUD is hidden for a cutscene.
 *
 *   DIALOGUE (subtitles; queued; over gameplay and in cutscenes)
 *     ui.say({ speaker, text, style, seconds })  -> Promise (resolves when the line has been shown; {skipped} on a skip)
 *        style: "radio" (KEEPER from the station: thin, clinical) | "unit" (construction-unit companions)
 *               | "memory" (flashbacks: soft, warm, italic) | "live" (people on the ground; the default)
 *        seconds defaults to the reading time of the line. ui.say("text") is a "live" line with no speaker.
 *     ui.sayClear()                               drop what is queued and fade the current line
 *   CHOICES
 *     ui.choose({ options: ["…", "…"], prompt, speaker, style, timer, fallback }) -> Promise<index | -1>
 *        2 to 4 options; D-pad + Cross (the shared module's focus ring), 1 to 4 / arrows + Enter, or a click.
 *        timer (s): on expiry it resolves `fallback` (default -1). The world holds while a choice is open.
 *   CUTSCENES
 *     ui.cutscene.start({ letterbox = true, skippable = true, hold = true, onSkip }) / ui.cutscene.end()
 *        the HUD fades out (and back after), the world holds, letterbox bars slide in;
 *        skippable: hold Circle or Esc for 0.8 s (a ring shows the hold) -> onSkip(), pending steps resolve {skipped: true}
 *     ui.card({ eyebrow: "ACT II", title: "THE WATER ROAD", sub, seconds = 4 })   -> Promise   (a full-screen title / chapter card)
 *     ui.still({ src, caption, seconds = 6, pan: "left" | "right" | "in" | "out" }) -> Promise  (an illustrated panel with a slow pan)
 *     ui.fadeTo(black = true, seconds = 1)                                           -> Promise  (to black, or back from it)
 *   THE PERCEPTION FILTER
 *     ui.glitch(intensity 0..1, seconds, { label })  chromatic offset, tearing and scanline jitter on the HUD; label (an element
 *                                                    or a world tag) gets its text scrambled for the same time
 *     ui.scramble(elOrTag, seconds, { vanish })      scramble one label's text, then restore it (or remove it: vanish)
 *     ui.setFilterState("intact" | "cracking" | "burnt"), ui.filterState
 *        cracking: small glitches at random; burnt: the whole HUD collapses to raw telemetry (charge, heat, wear) and the
 *        map and the compass become crude telemetry overlays (body[data-filter]).
 *   WORLD TAGS
 *     ui.tag(id, { pos: {x, y, z} | dir: [x, y, z] | at: () => pos, text, kind: "sky" | "ground" }) -> handle
 *        handle.set(text), handle.scramble(seconds, { vanish }), handle.remove(); ui.untag(id)
 *        `dir` is a direction from the camera (sky objects: the HALO-1 station, the "second light").
 */
import * as THREE from "../vendor/three.module.js?v=6d37c9c-9b39e129";

const now = () => performance.now() / 1000;
const GLYPHS = "▓▒░█▚▞◆◇#%&@0123456789ABCDEFXZ/\\<>";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const readTime = (t) => Math.max(2.6, Math.min(9, 1.6 + String(t).split(/\s+/).length * 0.32));
const STYLES = new Set(["radio", "unit", "memory", "live"]);
const _v = new THREE.Vector3();
const scrambled = (txt, k) => [...txt].map((c) => (c === " " || Math.random() > k ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join("");

export function installStory(ui) {
  if (typeof document === "undefined") return;
  const root = document.createElement("div");
  root.id = "story";
  root.innerHTML = `<div class="st-fade"></div>
    <div class="st-still" hidden><div class="st-img"></div><p class="st-cap"></p></div>
    <div class="st-card" hidden><span class="eyebrow"></span><h2></h2><p></p></div>
    <div class="st-bars" aria-hidden="true"><i></i><i></i></div>
    <div class="st-subs" aria-live="polite"></div>
    <div class="st-choice" hidden role="dialog" aria-label="Choose"></div>
    <div class="st-skip" hidden><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="bg" cx="18" cy="18" r="15.9155"/><circle class="fg" cx="18" cy="18" r="15.9155"/></svg><span></span></div>
    <div class="st-raw" hidden></div>`;
  document.body.appendChild(root);
  const q = (s) => root.querySelector(s);
  const E = { fade: q(".st-fade"), still: q(".st-still"), img: q(".st-img"), cap: q(".st-cap"), card: q(".st-card"), subs: q(".st-subs"),
    choice: q(".st-choice"), skip: q(".st-skip"), raw: q(".st-raw") };
  const tagRoot = document.createElement("div");
  tagRoot.id = "world-tags";
  document.body.appendChild(tagRoot);

  const S = { queue: [], line: null, holds: 0, cut: null, waits: new Set(), choice: null, filter: "intact", tags: new Map(), nextCrack: 0, skipT: 0, glitchUntil: 0 };
  ui._story = S;

  /* ── the world holds (choices, cutscenes): the game is paused in place, the pad goes to "app" mode ── */
  let backOff = null, keyCap = null;
  const hold = (on) => {
    S.holds = Math.max(0, S.holds + (on ? 1 : -1));
    const g = ui.game, P = window.GeoIDPad;
    if (S.holds > 0 && !backOff) {
      // Circle and Esc belong to the story while it holds (skip, never "open the menu"): the module calls back handlers last-first
      if (P && P.onBack) backOff = P.onBack(() => S.holds > 0);
      keyCap = (e) => { if (S.holds > 0 && (e.code === "Escape" || e.code === "KeyM" || e.code === "KeyP")) { e.stopImmediatePropagation(); if (e.code === "Escape") { e.preventDefault(); S.escDown = true; } } };
      window.addEventListener("keydown", keyCap, true);
    }
    if (S.holds === 0) {
      if (backOff) { backOff(); backOff = null; }
      if (keyCap) { window.removeEventListener("keydown", keyCap, true); keyCap = null; }
      if (g && g.storyHold) { g.storyHold = false; if (g.mode === "driving" || g.mode === "onfoot" || g.mode === "build") g.paused = false; }
    }
  };
  /** A wait that a skip can end early. */
  const wait = (seconds) => new Promise((resolve) => {
    const w = { resolve, t: setTimeout(() => { S.waits.delete(w); resolve({ skipped: false }); }, seconds * 1000) };
    S.waits.add(w);
  });
  const fadeEl = (el, on) => ui.fade(el, on);

  /* ── dialogue ───────────────────────────────────────────────────────── */
  ui.say = (o) => {
    const line = typeof o === "string" ? { text: o } : Object.assign({}, o);
    line.style = STYLES.has(line.style) ? line.style : "live";
    line.seconds = line.seconds || readTime(line.text);
    return new Promise((resolve) => { line.resolve = resolve; S.queue.push(line); if (!S.line) nextLine(); });
  };
  const nextLine = () => {
    const prev = E.subs.querySelector(".st-line:not(.out)");
    if (prev) { prev.classList.add("out"); setTimeout(() => prev.remove(), 450); }
    const line = S.line = S.queue.shift() || null;
    if (!line) return;
    const el = document.createElement("div");
    el.className = "st-line st-" + line.style;
    el.innerHTML = (line.speaker ? `<b class="st-who">${esc(line.speaker)}</b>` : "") + `<span class="st-text">${esc(line.text)}</span>`;
    E.subs.appendChild(el);
    line.el = el;
    line.timer = wait(line.seconds).then((r) => { if (S.line === line) { line.resolve(r); nextLine(); } });
  };
  ui.sayClear = () => {
    for (const l of S.queue) l.resolve({ skipped: true });
    S.queue = [];
    if (S.line) { S.line.resolve({ skipped: true }); S.line = null; }
    nextLine();
  };

  /* ── choices ────────────────────────────────────────────────────────── */
  ui.choose = (o = {}) => new Promise((resolve) => {
    if (S.choice) S.choice.finish(-1);
    const opts = (o.options || []).slice(0, 4);
    if (opts.length < 1) { resolve(-1); return; }
    const style = STYLES.has(o.style) ? o.style : "live";
    E.choice.className = "st-choice st-" + style;
    E.choice.innerHTML = (o.speaker || o.prompt ? `<div class="st-ask">${o.speaker ? `<b class="st-who">${esc(o.speaker)}</b>` : ""}${o.prompt ? `<span>${esc(o.prompt)}</span>` : ""}</div>` : "")
      + `<div class="st-opts">${opts.map((t, i) => `<button type="button" class="st-opt" data-i="${i}"><kbd>${i + 1}</kbd><span>${esc(t)}</span></button>`).join("")}</div>`
      + (o.timer ? `<i class="st-timer"><b style="animation-duration:${o.timer}s"></b></i>` : "");
    hold(true);
    fadeEl(E.choice, true);
    let sel = 0, done = false, tm = 0;
    const btns = [...E.choice.querySelectorAll(".st-opt")];
    const mark = () => btns.forEach((b, i) => b.classList.toggle("on", i === sel));
    const finish = (i) => {
      if (done) return;
      done = true; clearTimeout(tm); window.removeEventListener("keydown", onKey, true);
      fadeEl(E.choice, false); hold(false); S.choice = null;
      const P = window.GeoIDPad; if (P && P.focus) P.focus.clear();
      resolve(i);
    };
    const onKey = (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= btns.length) finish(n - 1);
      else if (e.code === "ArrowDown" || e.code === "KeyS" || e.code === "ArrowRight") { sel = (sel + 1) % btns.length; mark(); }
      else if (e.code === "ArrowUp" || e.code === "KeyW" || e.code === "ArrowLeft") { sel = (sel - 1 + btns.length) % btns.length; mark(); }
      else if (e.code === "Enter" || e.code === "Space") finish(sel);
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    btns.forEach((b, i) => { b.addEventListener("click", () => finish(i)); b.addEventListener("mouseenter", () => { sel = i; mark(); }); b.addEventListener("focus", () => { sel = i; mark(); }); });
    mark();
    if (o.timer) tm = setTimeout(() => finish(o.fallback == null ? -1 : o.fallback), o.timer * 1000);
    S.choice = { finish, options: opts };
    const P = window.GeoIDPad;
    if (P && P.connected && P.focus) setTimeout(() => { if (!done) P.focus.first(E.choice); }, 60);
  });

  /* ── cutscenes ──────────────────────────────────────────────────────── */
  const skip = () => {
    const c = S.cut;
    if (!c || !c.skippable) return;
    for (const w of S.waits) { clearTimeout(w.t); w.resolve({ skipped: true }); }
    S.waits.clear();
    ui.sayClear();
    fadeEl(E.card, false); fadeEl(E.still, false);
    const cb = c.onSkip;
    ui.cutscene.end();
    if (cb) { try { cb(); } catch (e) { console.warn("[ui] onSkip", e); } }
  };
  ui.cutscene = {
    get active() { return !!S.cut; },
    start(o = {}) {
      if (S.cut) ui.cutscene.end();
      S.cut = { skippable: o.skippable !== false, onSkip: o.onSkip || null, hold: o.hold !== false };
      document.body.classList.add("ui-cutscene");
      document.body.classList.toggle("ui-letterbox", o.letterbox !== false);
      if (S.cut.hold) hold(true);
      E.skip.querySelector("span").innerHTML = "";
      return ui.cutscene;
    },
    end() {
      const c = S.cut;
      if (!c) return;
      S.cut = null;
      document.body.classList.remove("ui-cutscene", "ui-letterbox");
      E.skip.hidden = true; S.skipT = 0;
      if (c.hold) hold(false);
    },
    skip,
  };
  ui.card = (o = {}) => {
    E.card.querySelector(".eyebrow").textContent = o.eyebrow || "";
    E.card.querySelector("h2").textContent = o.title || "";
    E.card.querySelector("p").textContent = o.sub || "";
    fadeEl(E.card, true);
    return wait(o.seconds || 4).then((r) => { fadeEl(E.card, false); return r; });
  };
  ui.still = (o = {}) => {
    const sec = o.seconds || 6;
    E.img.style.backgroundImage = o.src ? `url("${String(o.src).replace(/"/g, "%22")}")` : "";
    E.img.className = "st-img pan-" + (o.pan || "right");
    E.img.style.animationDuration = sec + 1 + "s";
    E.cap.textContent = o.caption || "";
    E.cap.hidden = !o.caption;
    fadeEl(E.still, true);
    void E.img.offsetWidth; E.img.classList.add("go");
    return wait(sec).then((r) => { fadeEl(E.still, false); return r; });
  };
  ui.fadeTo = (black = true, seconds = 1) => {
    E.fade.style.transitionDuration = (ui.instant ? 0 : seconds) + "s";
    E.fade.classList.toggle("on", !!black);
    return wait(ui.instant ? 0 : seconds);
  };

  /* ── the perception filter ──────────────────────────────────────────── */
  const hud = () => document.getElementById("hud");
  ui.glitch = (intensity = 0.5, seconds = 0.6, o = {}) => {
    const k = Math.max(0, Math.min(1, intensity));
    const b = document.body;
    b.style.setProperty("--glitch", k.toFixed(2));
    b.classList.add("ui-glitch");
    S.glitchUntil = Math.max(S.glitchUntil, now() + seconds);
    clearTimeout(S.glitchT);
    S.glitchT = setTimeout(() => b.classList.remove("ui-glitch"), (S.glitchUntil - now()) * 1000);
    if (o.label) ui.scramble(o.label, seconds, { vanish: !!o.vanish });
    void hud;
  };
  ui.scramble = (target, seconds = 1, { vanish = false } = {}) => {
    const t = typeof target === "string" ? S.tags.get(target) : target;
    if (t && t.scramble && !(t instanceof Element)) return t.scramble(seconds, { vanish });
    const el = t;
    if (!el || !el.textContent) return;
    const orig = el.dataset.plain || el.textContent;
    el.dataset.plain = orig;
    el.classList.add("st-scrambling");
    const t0 = now();
    const step = () => {
      const f = (now() - t0) / seconds;
      if (f >= 1) {
        el.classList.remove("st-scrambling");
        if (vanish) { el.classList.add("st-vanish"); setTimeout(() => { el.textContent = ""; }, 400); }
        else el.textContent = orig;
        delete el.dataset.plain;
        return;
      }
      el.textContent = scrambled(orig, vanish ? 0.3 + 0.7 * f : 0.7 * Math.sin(Math.PI * f) + 0.15);
      setTimeout(step, 55);
    };
    step();
  };
  ui.setFilterState = (state) => {
    S.filter = state === "cracking" || state === "burnt" ? state : "intact";
    document.body.dataset.filter = S.filter;
    E.raw.hidden = S.filter !== "burnt";
    if (S.filter === "cracking") S.nextCrack = now() + 2;
    if (S.filter !== "intact") ui.glitch(S.filter === "burnt" ? 1 : 0.5, 0.9);
    ui._emit();
  };
  Object.defineProperty(ui, "filterState", { get: () => S.filter });

  /* ── world tags ─────────────────────────────────────────────────────── */
  ui.tag = (id, o = {}) => {
    ui.untag(id);
    const el = document.createElement("div");
    el.className = "w-tag w-" + (o.kind || "sky");
    el.innerHTML = `<i></i><span></span>`;
    tagRoot.appendChild(el);
    const span = el.querySelector("span");
    span.textContent = o.text || "";
    const t = { id, el, o, gone: false,
      set(text) { span.textContent = text; return t; },
      scramble(seconds = 1, { vanish = false } = {}) { ui.scramble(span, seconds, {}); if (vanish) setTimeout(() => t.remove(), seconds * 1000); return t; },
      remove() { if (t.gone) return; t.gone = true; S.tags.delete(id); if (ui.instant) { el.remove(); return; } el.classList.add("st-vanish"); setTimeout(() => el.remove(), 400); } };
    S.tags.set(id, t);
    return t;
  };
  ui.untag = (id) => { const t = S.tags.get(id); if (t) { t.el.remove(); S.tags.delete(id); } };
  ui.registerTagsRoot = () => tagRoot;
  window.addEventListener("keyup", (e) => { if (e.code === "Escape") S.escDown = false; });
  window.addEventListener("blur", () => { S.escDown = false; });

  /* ── every frame (from ui.update) ───────────────────────────────────── */
  S.frame = (game, dt) => {
    // keep the world held: a resume from the pause menu must not release a choice or a cutscene
    if (S.holds > 0 && (game.mode === "driving" || game.mode === "onfoot" || game.mode === "build") && !game.paused) { game.paused = true; game.storyHold = true; }
    else if (S.holds > 0) game.storyHold = true;
    // skip: hold Circle or Esc
    const c = S.cut;
    if (c && c.skippable) {
      const P = window.GeoIDPad, I = game.input;
      const held = (P && P.connected && P.pressed("circle")) || !!S.escDown;
      S.skipT = held ? S.skipT + (dt || 0.016) : Math.max(0, S.skipT - (dt || 0.016) * 2);
      E.skip.hidden = S.skipT <= 0.05;
      if (!E.skip.hidden) {
        const usePad = P && P.connected && I && I.lastDevice === "pad";
        const sp = E.skip.querySelector("span");
        const want = usePad ? `Hold ${P.glyph("circle")} to skip` : "Hold <kbd>Esc</kbd> to skip";
        if (sp.innerHTML !== want) sp.innerHTML = want;
        E.skip.querySelector(".fg").setAttribute("stroke-dasharray", Math.min(100, S.skipT / 0.8 * 100).toFixed(0) + " 100");
      }
      if (S.skipT >= 0.8) { S.skipT = 0; skip(); }
    }
    // cracking: a small glitch now and then
    if (S.filter === "cracking" && now() > S.nextCrack) { S.nextCrack = now() + 5 + Math.random() * 10; ui.glitch(0.2 + Math.random() * 0.3, 0.25 + Math.random() * 0.4); }
    // burnt: raw telemetry only
    if (S.filter === "burnt" && game.vehicle) {
      const v = game.vehicle, env = game.env || {}, r = env.rover || {}, h = r.health || {};
      const av = game.focus && game.focus.status ? game.focus.status() : null;
      const heat = av ? (av.temp + 273.15) : r.pack_K || (env.temp && env.temp.air_K) || 0;
      const wear = h.wheels != null ? Math.round((1 - h.wheels) * 100) : 0;
      const txt = `CHG ${Math.round((av ? av.power : v.batteryFraction) * 100).toString().padStart(3, " ")}%  HEAT ${Math.round(heat)} K  WEAR ${String(wear).padStart(2, " ")}%`;
      if (E.raw.textContent !== txt) E.raw.textContent = txt;
    }
    // world tags
    if (S.tags.size && game.camera) {
      const cam = game.camera, w = window.innerWidth, h2 = window.innerHeight;
      for (const t of S.tags.values()) {
        const o = t.o;
        let p = o.at ? o.at() : o.pos;
        if (o.dir) { _v.set(o.dir[0], o.dir[1], o.dir[2]).normalize().multiplyScalar(500).add(cam.position); }
        else if (p) _v.set(p.x, p.y == null ? (game.surface ? game.surface.height(p.x, p.z) + 3 : 0) : p.y, p.z);
        else continue;
        _v.project(cam);
        const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h2, off = _v.z > 1 || x < -40 || x > w + 40 || y < -40 || y > h2 + 40;
        t.el.hidden = off;
        if (!off) t.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    }
  };
}
