/**
 * NAVIGATION: the corner map and the 360° compass, one marker list for both.
 *
 * The map (bottom left, always shown while playing) is north-up: shaded
 * relief sampled from the real height field, the track behind you, base
 * modules, and every marker, with markers beyond the edge pinned to it. The
 * compass (centred above the footer) is the flight sim's bearing tape: a
 * 110° window onto the full rose under a fixed centre index, ticks every 5°,
 * numbers every 30°, cardinals picked out; each marker rides the tape at its
 * bearing with the same icon and colour it has on the map, and one that is
 * outside the window waits at the nearer end, pointing the way to turn.
 *
 * Markers (markers(game)): the objective, the site's places, your bases,
 * the rover while you are on foot, flags and beacon caches. Colours are the
 * skin's tokens (--skin-chrome, --skin-data, ...), so the GeoHUB theme the
 * player picked reaches the instruments too; read once a second.
 *
 * Headings follow the vehicle and the walker: 0 = north = -z, 90 = east = +x.
 */
import { registerSystem, getSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";

const SPAN_DEG = 110;                 // the compass window
const MAP_SPAN_M = 650;               // half-width of the corner map (1.3 km across)
const RELIEF_N = 72;                  // relief samples per side
const TRACK_STEP_M = 12, TRACK_MAX = 400;
const LIVE = new Set(["driving", "onfoot", "build"]);
const CARD = { 0: "N", 90: "E", 180: "S", 270: "W" };

const norm = (d) => ((d % 360) + 360) % 360;
const rel = (b, h) => ((b - h + 540) % 360) - 180;
export const bearingTo = (from, to) => norm(Math.atan2(to.x - from.x, -(to.z - from.z)) * 180 / Math.PI);
const fmtDist = (m, units) => units === "imperial"
  ? (m >= 1609 ? (m / 1609.34).toFixed(m < 16093 ? 1 : 0) + " mi" : Math.round(m * 3.281) + " ft")
  : (m >= 1000 ? (m / 1000).toFixed(m < 10000 ? 2 : 1) + " km" : Math.round(m) + " m");

/** Every marker the map and the compass show: {id, kind, x, z, name, priority}. */
export function markers(game) {
  const out = [];
  const tg = game.target;
  if (tg) out.push({ id: "objective", kind: "objective", x: tg.x, z: tg.z, name: tg.name || "Objective", priority: 3 });
  for (const p of (game.site && game.site.pois) || []) {
    if (tg && p.id === tg.id) continue;
    out.push({ id: "poi:" + p.id, kind: "poi", x: p.x, z: p.z, name: p.name, priority: 1 });
  }
  try {
    const base = getSystem("base");
    for (const b of (base && base.net && base.net.bases && base.net.bases.values()) || []) {
      out.push({ id: "base:" + b.id, kind: "base", x: b.x, z: b.z, name: (b.name || "Base") + " base", priority: 2 });
    }
  } catch { /* no base system */ }
  if (game.focus && game.mode === "onfoot") {
    out.push({ id: "rover", kind: "rover", x: game.vehicle.p.x, z: game.vehicle.p.z, name: "Rover", priority: 2.5 });
  }
  try {
    const sys = getSystem("eva"), eva = sys && (sys.api || sys);
    const flags = eva && (typeof eva.flags === "function" ? eva.flags() : eva.flags);
    const beacons = eva && (typeof eva.beacons === "function" ? eva.beacons() : eva.beacons);
    for (const f of Array.isArray(flags) ? flags : []) out.push({ id: "flag:" + f.id, kind: "flag", x: f.x, z: f.z, name: "Flag", priority: 0 });
    for (const b of Array.isArray(beacons) ? beacons : []) out.push({ id: "beacon:" + b.id, kind: "beacon", x: b.x, z: b.z, name: "Beacon cache", priority: 0.5 });
  } catch { /* no eva system */ }
  // anything another system wants on the map and the compass for a while ({id, kind, x, z, name, priority}): progress.js's HALO-1 drop
  if (Array.isArray(game.extraMarkers)) for (const m of game.extraMarkers) if (m && Number.isFinite(m.x) && Number.isFinite(m.z)) out.push(m);
  return out;
}

/** Draw one marker icon centred at (x, y), size s (CSS px). */
function icon(c, kind, x, y, s, col, ink) {
  c.save();
  c.translate(x, y);
  c.fillStyle = col; c.strokeStyle = ink; c.lineWidth = Math.max(1, s * 0.14);
  c.beginPath();
  if (kind === "objective") { c.moveTo(0, -s); c.lineTo(s, 0); c.lineTo(0, s); c.lineTo(-s, 0); c.closePath(); }
  else if (kind === "base") { c.rect(-s * 0.8, -s * 0.8, s * 1.6, s * 1.6); }
  else if (kind === "rover") { c.arc(0, 0, s * 0.85, 0, Math.PI * 2); }
  else if (kind === "flag") { c.moveTo(-s * 0.5, s); c.lineTo(-s * 0.5, -s); c.lineTo(s * 0.8, -s * 0.5); c.lineTo(-s * 0.5, 0); }
  else if (kind === "beacon") { c.moveTo(0, -s); c.lineTo(s * 0.85, s * 0.7); c.lineTo(-s * 0.85, s * 0.7); c.closePath(); }
  else { c.moveTo(0, -s * 0.9); c.lineTo(s * 0.8, s * 0.6); c.lineTo(-s * 0.8, s * 0.6); c.closePath(); }
  c.fill(); c.stroke();
  c.restore();
}

class Nav {
  constructor() {
    this.id = "nav";
    this.order = 90;
    this.colours = null;
    this._coloursT = 0;
    this.track = [];
    this._relief = null;
    this._reliefAt = null;
    this._mapT = 0;
    this._lastHdg = null;
    this._lastSig = "";
  }

  init(game) {
    this.game = game;
    if (typeof document === "undefined") return;
    const hud = document.getElementById("hud") || document.body;
    this.mapEl = document.createElement("div");
    this.mapEl.id = "navmap";
    this.mapEl.className = "navmap";
    this.mapEl.innerHTML = `<canvas aria-label="Map, north up"></canvas><span class="navmap-n">N</span><span class="navmap-scale"></span>`;
    hud.appendChild(this.mapEl);
    this.compassEl = document.createElement("div");
    this.compassEl.id = "compass";
    this.compassEl.innerHTML = `<canvas aria-label="Compass"></canvas><b class="compass-hdg"></b>`;
    hud.appendChild(this.compassEl);
    this.mapCanvas = this.mapEl.querySelector("canvas");
    this.compassCanvas = this.compassEl.querySelector("canvas");
    // the interface manager (uiman.js): both always shown in Standard; under Minimal the map shows when you stop or near a place
    const ui = game.hud && game.hud.ui;
    if (ui) {
      ui.register("navmap", { el: this.mapEl, group: "navigation", policy: "always", lean: "contextual", hold: 3, when: (g) => this._mapWanted(g) });
      ui.register("compass", { el: this.compassEl, group: "navigation", policy: "always" });
    }
  }
  _mapWanted(g) {
    const b = this._body(g), v = g.vehicle, sp = g.mode === "onfoot" && g.focus && g.focus.t ? g.focus.t.speed : v ? Math.abs(v.t.speed) : 0;
    if (g.mode === "build" || sp < 0.3) return true;
    for (const m of markers(g)) if (m.priority >= 1 && Math.hypot(m.x - b.x, m.z - b.z) < 150) return true;
    return false;
  }

  _readColours(now) {
    if (this.colours && now - this._coloursT < 1000) return this.colours;
    this._coloursT = now;
    const s = getComputedStyle(document.documentElement), v = (n, d) => (s.getPropertyValue(n) || "").trim() || d;
    this.colours = {
      chrome: v("--skin-chrome", "#ff2bd6"), chromeRgb: v("--skin-chrome-rgb", "255, 43, 214"),
      data: v("--skin-data", "#00e5ff"), dataRgb: v("--skin-data-rgb", "0, 229, 255"),
      ink: v("--skin-ink", "#fdf7ff"), panel: v("--skin-panel", "31, 14, 69"), muted: v("--skin-muted", "226, 214, 255"),
      body: v("--skin-body", '"Exo 2", sans-serif'),
      good: v("--good", "#4dffa6"), warn: v("--warn", "#ffd319"),
    };
    this._lastSig = "";                       // a theme change repaints the compass
    return this.colours;
  }

  _kindColour(kind, C) {
    return { objective: C.chrome, poi: C.data, base: C.good, rover: C.ink, flag: C.warn, beacon: C.warn }[kind] || C.data;
  }

  /** The active body: position and heading (the walker on foot, else the rover). */
  _body(game) {
    const v = game.vehicle;
    if (game.focus && game.mode === "onfoot") {
      const h = Number.isFinite(game.focus.heading) ? game.focus.heading : v.t.heading;
      return { x: game.focus.x, z: game.focus.z, heading: h };
    }
    return { x: v.p.x, z: v.p.z, heading: v.t.heading };
  }

  frame(game, dt) {
    if (!this.mapEl) return;
    const show = game.ready && LIVE.has(game.mode);
    this.mapEl.hidden = !show;
    this.compassEl.hidden = !show;
    if (!show) return;
    const now = performance.now();
    const C = this._readColours(now);
    const me = this._body(game);
    // the track: one point every TRACK_STEP_M of travel
    const last = this.track[this.track.length - 1];
    if (!last || Math.hypot(last.x - me.x, last.z - me.z) > TRACK_STEP_M) {
      this.track.push({ x: me.x, z: me.z });
      if (this.track.length > TRACK_MAX) this.track.shift();
    }
    const list = markers(game);
    this._drawCompass(game, me, list, C);
    if (now - this._mapT > 120) { this._mapT = now; this._drawMap(game, me, list, C); }
  }

  _fit(cv) {
    const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { W: r.width, H: r.height, dpr };
  }

  _drawCompass(game, me, list, C) {
    const cv = this.compassCanvas, hdg = me.heading;
    const near = list.map((m) => ({ m, d: Math.hypot(m.x - me.x, m.z - me.z), b: bearingTo(me, m) }));
    const sig = `${hdg.toFixed(1)}|${near.map((n) => n.m.id + Math.round(n.d / 5) + n.b.toFixed(0)).join(",")}|${cv.clientWidth}`;
    if (sig === this._lastSig) return;
    this._lastSig = sig;
    const { W, H, dpr } = this._fit(cv);
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const px = W / SPAN_DEG, mid = W / 2, tickTop = H * 0.52, units = game.settings && game.settings.units;
    // a faint band behind the tape, fading at the ends, so it reads over bright sand
    const band = c.createLinearGradient(0, 0, W, 0);
    band.addColorStop(0, `rgba(${C.panel}, 0)`); band.addColorStop(0.18, `rgba(${C.panel}, 0.55)`);
    band.addColorStop(0.82, `rgba(${C.panel}, 0.55)`); band.addColorStop(1, `rgba(${C.panel}, 0)`);
    c.fillStyle = band; c.fillRect(0, H * 0.3, W, H * 0.7);
    c.textAlign = "center"; c.textBaseline = "alphabetic";
    const first = Math.ceil((hdg - SPAN_DEG / 2) / 5) * 5;
    for (let d = first; d <= hdg + SPAN_DEG / 2; d += 5) {
      const x = mid + (d - hdg) * px, deg = norm(d), major = deg % 15 === 0;
      const edge = Math.abs(x - mid) / (W / 2);
      c.globalAlpha = Math.max(0, 1 - Math.pow(edge, 2.2));
      c.strokeStyle = `rgba(${C.chromeRgb}, ${major ? 0.95 : 0.55})`;
      c.lineWidth = major ? 2 : 1.2;
      c.beginPath(); c.moveTo(x, tickTop); c.lineTo(x, major ? H * 0.92 : H * 0.76); c.stroke();
      const label = CARD[deg] || (deg % 30 === 0 ? String(deg).padStart(3, "0") : null);
      if (label) {
        c.fillStyle = CARD[deg] ? C.ink : C.chrome;
        c.font = `600 ${Math.round(H * (CARD[deg] ? 0.3 : 0.24))}px ${C.body}`;
        c.fillText(label, x, H * 0.47);
      }
    }
    c.globalAlpha = 1;
    // markers: on the tape at their bearing; outside the window, waiting at the nearer end
    near.sort((a, b) => a.m.priority - b.m.priority);
    const labelled = near.filter((n) => n.m.kind !== "flag").sort((a, b) => b.m.priority - a.m.priority || a.d - b.d).slice(0, 3).map((n) => n.m.id);
    for (const n of near) {
      const r = rel(n.b, hdg), inside = Math.abs(r) <= SPAN_DEG / 2 - 2;
      if (!inside && n.m.priority < 2) continue;               // only the important ones wait at the ends
      const x = inside ? mid + r * px : (r < 0 ? 10 : W - 10);
      const col = this._kindColour(n.m.kind, C), s = n.m.kind === "objective" ? 6.5 : 5;
      icon(c, n.m.kind, x, H * 0.2, s, col, "rgba(0,0,0,0.75)");
      if (!inside) {
        c.fillStyle = col; c.beginPath();
        if (r < 0) { c.moveTo(x - 9, H * 0.2); c.lineTo(x - 4, H * 0.2 - 4); c.lineTo(x - 4, H * 0.2 + 4); }
        else { c.moveTo(x + 9, H * 0.2); c.lineTo(x + 4, H * 0.2 - 4); c.lineTo(x + 4, H * 0.2 + 4); }
        c.fill();
      }
      if (!inside && n.m.kind === "objective") {
        c.font = `600 ${Math.max(9, Math.round(H * 0.19))}px ${C.body}`;
        c.fillStyle = col; c.textAlign = r < 0 ? "left" : "right";
        c.fillText(fmtDist(n.d, units), r < 0 ? x + 9 : x - 9, H * 0.2 - 9);
        c.textAlign = "center";
      }
      if (inside && labelled.includes(n.m.id)) {
        c.font = `600 ${Math.max(9, Math.round(H * 0.19))}px ${C.body}`;
        c.fillStyle = col;
        const text = `${n.m.name.split(/[,:(]/)[0].trim().slice(0, 22)} ${fmtDist(n.d, units)}`;
        c.textAlign = x < W * 0.2 ? "left" : x > W * 0.8 ? "right" : "center";
        c.fillText(text, x + (c.textAlign === "left" ? 9 : c.textAlign === "right" ? -9 : 0), H * 0.2 - 9);
        c.textAlign = "center";
      }
    }
    // the centre index: the heading you are on
    c.fillStyle = C.chrome;
    c.beginPath(); c.moveTo(mid, H * 0.56); c.lineTo(mid - 5, H * 0.36); c.lineTo(mid + 5, H * 0.36); c.closePath(); c.fill();
    c.fillRect(mid - 1, H * 0.56, 2, H * 0.42);
    const out = this.compassEl.querySelector(".compass-hdg");
    out.textContent = `${String(Math.round(hdg) % 360).padStart(3, "0")}°`;
  }

  _drawMap(game, me, list, C) {
    const cv = this.mapCanvas, { W, H, dpr } = this._fit(cv);
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const span = MAP_SPAN_M, m2p = W / (2 * span);
    // relief, resampled after moving an eighth of the map
    if (!this._reliefAt || Math.hypot(this._reliefAt.x - me.x, this._reliefAt.z - me.z) > span / 8) {
      this._reliefAt = { x: me.x, z: me.z };
      const N = RELIEF_N, F = game.field, cell = 2 * span / N;
      const off = this._relief || (this._relief = document.createElement("canvas"));
      off.width = off.height = N;
      const oc = off.getContext("2d"), img = oc.createImageData(N, N), gr = { dx: 0, dz: 0 };
      const p = C.panel.split(",").map((n) => parseFloat(n) || 0), d = C.dataRgb.split(",").map((n) => parseFloat(n) || 0), cr = C.chromeRgb.split(",").map((n) => parseFloat(n) || 0);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = me.x - span + (i + 0.5) * cell, z = me.z - span + (j + 0.5) * cell, o = (j * N + i) * 4;
        let shade = 0.5;
        let steep = 0;
        try {
          const g2 = F.gradient(x, z, cell, gr);
          // light from the north-west; slopes of a few degrees already read
          shade = Math.max(0, Math.min(1, 0.5 + 4.5 * (g2.dx * 0.7 + g2.dz * 0.7)));
          steep = Math.min(1, Math.hypot(g2.dx, g2.dz) / 0.3);
        } catch { /* outside the field */ }
        // the panel colour lifted toward the data colour by the light on the slope; steep ground toward the chrome
        const k = 0.12 + 0.7 * shade;
        for (let ch = 0; ch < 3; ch++) img.data[o + ch] = p[ch] + (d[ch] - p[ch]) * k * 0.6 + (cr[ch] - p[ch]) * steep * 0.35;
        img.data[o + 3] = 255;
      }
      oc.putImageData(img, 0, 0);
    }
    c.clearRect(0, 0, W, H);
    c.imageSmoothingEnabled = true;
    c.drawImage(this._relief, (this._reliefAt.x - me.x) * m2p, (this._reliefAt.z - me.z) * m2p, W, H);
    const X = (x) => W / 2 + (x - me.x) * m2p, Z = (z) => H / 2 + (z - me.z) * m2p;
    // range ring
    c.strokeStyle = `rgba(${C.chromeRgb}, 0.22)`; c.lineWidth = 1;
    c.beginPath(); c.arc(W / 2, H / 2, 500 * m2p, 0, Math.PI * 2); c.stroke();
    // the track
    if (this.track.length > 1) {
      c.strokeStyle = `rgba(${C.dataRgb}, 0.55)`; c.lineWidth = 1.5; c.beginPath();
      this.track.forEach((t, i) => (i ? c.lineTo(X(t.x), Z(t.z)) : c.moveTo(X(t.x), Z(t.z))));
      c.lineTo(W / 2, H / 2); c.stroke();
    }
    // base modules: their footprints
    try {
      const base = getSystem("base");
      if (base && base.net) {
        c.fillStyle = C.good;
        for (const m of base.net.modules.values()) {
          const w = base.worldOf(m), px = X(w.x), pz = Z(w.z);
          if (px < -4 || px > W + 4 || pz < -4 || pz > H + 4) continue;
          c.globalAlpha = m.progress >= 1 ? 0.95 : 0.45;
          c.fillRect(px - 2, pz - 2, 4, 4);
        }
        c.globalAlpha = 1;
      }
    } catch { /* no base */ }
    // markers, pinned to the edge when off the map
    for (const m of [...list].sort((a, b) => a.priority - b.priority)) {
      if (m.kind === "base") continue;                        // drawn as its modules
      let px = X(m.x), pz = Z(m.z);
      const off = px < 6 || px > W - 6 || pz < 6 || pz > H - 6;
      if (off && m.priority < 2) continue;
      px = Math.max(6, Math.min(W - 6, px)); pz = Math.max(6, Math.min(H - 6, pz));
      icon(c, m.kind, px, pz, m.kind === "objective" ? 5 : 3.6, this._kindColour(m.kind, C), "rgba(0,0,0,0.8)");
    }
    // you: an arrow along your heading
    c.save(); c.translate(W / 2, H / 2); c.rotate(me.heading * Math.PI / 180);
    c.fillStyle = C.ink; c.strokeStyle = "rgba(0,0,0,0.8)"; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(0, -8); c.lineTo(5.5, 6); c.lineTo(0, 3); c.lineTo(-5.5, 6); c.closePath(); c.fill(); c.stroke();
    c.restore();
    const sc = this.mapEl.querySelector(".navmap-scale");
    const label = `${(2 * span / 1000).toFixed(1)} km`;
    if (sc.textContent !== label) sc.textContent = label;
  }

  save() { return { track: this.track.slice(-TRACK_MAX).map((t) => [Math.round(t.x), Math.round(t.z)]) }; }
  load(game, s) { this.track = ((s && s.track) || []).map(([x, z]) => ({ x, z })); this._reliefAt = null; }
}

const nav = registerSystem(new Nav());
export default nav;
