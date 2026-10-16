/**
 * The base builder: two systems.
 *
 *   "base"    (order 40)  the settlement: owns the BaseNet simulation, the
 *                         merged picture of every base, the rover's dealings
 *                         with it (collision, the garage charger), the save,
 *                         and `getSystem("base").api` for the other systems.
 *   "builder" (order 50)  build mode: the free camera, the cursor, the ghost,
 *                         the placement rules and port snapping, the controls.
 *
 * A base module is an ENTITY (entities.js) whose `data` says where it sits in
 * its base's lattice:
 *     { id, type, x, z, yaw, data: { base, g: [lx, lz], r, level, ly, seq, progress, st, links } }
 * x / z / yaw are kept current for anything that reads entities generically,
 * but the base frame (saved by this system) and `g` / `r` are the truth: a
 * base is rebuilt from them exactly, and re-seated on the ground as one rigid,
 * level frame.
 *
 * PLACEMENT RULES are `Builder.evaluate()`; SNAPPING is `Builder.poseAt()`.
 * Both are plain functions of (type, cursor) so the test drives them without a
 * controller, and the controller drives nothing else.
 */
import * as THREE from "../vendor/three.module.js?v=b8cfe8e-efa5b7b7";
import { MARS, TIME_SCALE } from "./config.js?v=b8cfe8e-efa5b7b7";
import { registerSystem, getSystem } from "./systems.js?v=b8cfe8e-efa5b7b7";
import { registerType } from "./entities.js?v=b8cfe8e-efa5b7b7";
import { sunPosition, surfaceIrradiance } from "./sky.js?v=b8cfe8e-efa5b7b7";
import { BaseNet, MODULES, MODULE_IDS, KIT, RULES, CATEGORIES, GRID, rot, halfExtent, snapLattice, cellsOf, cellKey, cellOfPoint, portsOf, keepClearCells,
  toWorld, toLocal, compatible } from "./basenet.js?v=b8cfe8e-efa5b7b7";
import { Kit, BaseBatch, Dynamics, LightPool, Ghost, Site, Outline, GridDecal } from "./basekit.js?v=b8cfe8e-efa5b7b7";
import { obstaclesOf, resolve } from "./collide.js?v=b8cfe8e-efa5b7b7";

const _lv = new THREE.Vector3();   // construction labels (Base._siteLabels)
import { BuildUI, BUILD_HELP } from "./buildui.js?v=b8cfe8e-efa5b7b7";

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _v = new THREE.Vector3(), _fw = new THREE.Vector3();
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const isBuilt = (m) => m.progress >= 1;
const radiusOf = (type) => { const [hx, hz] = halfExtent(type, 0); return Math.hypot(hx, hz); };
const pad = () => window.GeoIDPad || null;

/* ── terrain under a footprint ──────────────────────────────────────────── */

/** Heights over a rectangle of a base frame: min, max, best-plane slope (degrees) and the relief left over. */
export function groundStats(surface, frame, lx, lz, hx, hz) {
  const nx = Math.min(12, Math.max(2, Math.round(hx * 2))), nz = Math.min(12, Math.max(2, Math.round(hz * 2))), w = {};
  let min = Infinity, max = -Infinity, sum = 0, su = 0, sv = 0, suu = 0, svv = 0, n = 0;
  const hs = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const u = (i / nx * 2 - 1) * hx, v = (j / nz * 2 - 1) * hz;
    toWorld(frame, lx + u, lz + v, w);
    const h = surface.height(w.x, w.z);
    hs.push(u, v, h);
    if (h < min) min = h; if (h > max) max = h;
    sum += h; su += u * h; sv += v * h; suu += u * u; svv += v * v; n++;
  }
  const mean = sum / n, a = su / suu, b = sv / svv;
  let rough = 0;
  for (let k = 0; k < hs.length; k += 3) rough = Math.max(rough, Math.abs(hs[k + 2] - (mean + a * hs[k] + b * hs[k + 1])));
  return { min, max, mean, slope: Math.atan(Math.hypot(a, b)) * 180 / Math.PI, rough };
}

/** How open the sky is at a site: mean horizon elevation over eight azimuths (degrees), from the measured surface. */
function horizonDeg(surface, x, z) {
  const h0 = surface.measured(x, z) + 2;
  let sum = 0;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    let best = 0;
    for (const d of [60, 180, 480]) best = Math.max(best, Math.atan2(surface.measured(x + Math.sin(a) * d, z - Math.cos(a) * d) - h0, d) * 180 / Math.PI);
    sum += best;
  }
  return sum / 8;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE SETTLEMENT
   ══════════════════════════════════════════════════════════════════════════ */

const hub = { base: null };

class BaseSystem {
  constructor() {
    this.id = "base"; this.order = 40;
    this.net = new BaseNet();
    this.batches = new Map();
    this.sites = new Map();
    this.dirty = new Set();
    this.obstacles = [];
    this.occupants = new Map();
    this.listeners = {};
    this.touching = null;
    this.docked = null;
    this.repair = { progress: 0, moduleId: null };
    this.ready = false;
    this._acc = 0; this._lightAcc = 1; this._solar = null; this._env = {}; this._doorT = 0;
    this._loading = null;
  }

  async init(game) {
    this.game = game;
    this.kit = new Kit(game.assets);
    await this.kit.init();
    this.root = new THREE.Group(); this.root.name = "bases";
    this.dyn = new Dynamics(this.kit);
    this.lights = new LightPool(4);
    this.root.add(this.dyn.group, this.lights.group);
    game.scene.add(this.root);
    game.renderer.localClippingEnabled = true;        // construction sites rise through a clipping plane
    game.entities.reseatHooks.push(() => this.reseat());
    this.api = makeApi(this);
    this.net.on("built", (m) => {
      this.dirty.add(m.base);
      this.emit("built", this.describe(m));
      if (game.mode !== "title" && !this.net.sandbox) game.hud.toast(`${MODULES[m.type].name} complete<small>${this.net.bases.get(m.base)?.name || ""} base</small>`, 3);
    });
    // Cross beside dusty arrays cleans them (the game's "interact").
    game.on("interact", () => {
      const v = game.vehicle, near = [];
      for (const m of this.net.modules.values()) if (MODULES[m.type].solar && isBuilt(m)) { const w = this.worldOf(m); if (Math.hypot(w.x - v.p.x, w.z - v.p.z) < 14) near.push(m.id); }
      if (!near.length) return;
      const r = this.net.cleanSolar(near);
      if (r.cleaned) game.hud.toast(`Solar arrays cleaned<small>${r.cleaned} array${r.cleaned > 1 ? "s" : ""}, ${Math.round(r.recovered * 100)}% of output recovered</small>`, 3.5);
    });
    hub.base = this;
    this.shelterHook();
    this.ready = true;
    if (window.__mars) window.__mars.base = this.api;
  }

  on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
  emit(name, detail) { for (const f of (this.listeners[name] || []).slice()) { try { f(detail); } catch (e) { console.error("[base] listener", name, e); } } }

  /* ── persistence ──────────────────────────────────────────────────────── */

  load(game, saved) {
    const net = this.net;
    // a new game on a page that already ran one: start clean
    for (const b of [...this.batches.values()]) b.dispose();
    for (const s of [...this.sites.values()]) s.dispose();
    this.batches.clear(); this.sites.clear(); net.modules.clear(); net.bases.clear(); net._topo.clear();
    net.materials = saved && Number.isFinite(saved.materials) ? saved.materials : RULES.startMaterials;
    net.seq = (saved && saved.seq) || 0;
    for (const id in (saved && saved.bases) || {}) net.addBase(Object.assign({ id }, saved.bases[id]));
    if (game.state.clock.scale === RULES.buildClockScale) game.state.clock.scale = TIME_SCALE;     // saved from build mode
    for (const e of game.entities.items.values()) if (e.type.kind === "base") this.adopt(e, true);
    for (const b of net.bases.values()) { b.y = this.datum(b); this.dirty.add(b.id); }
    this.reseatEntities();
    this._loading = this.kit.preload([...new Set([...net.modules.values()].map((m) => m.type))]).catch((e) => console.warn("[base] kit", e.message)).finally(() => { this._loading = null; });
  }
  save() {
    const net = this.net;
    for (const m of net.modules.values()) {
      const e = this.game.entities.get(m.id);
      if (!e) continue;
      const T = net.topology(m.base);
      e.def.data = { base: m.base, g: [m.lx, m.lz], r: m.r, level: m.level, ly: m.ly, seq: m.seq, progress: m.progress,
        st: { dust: m.st.dust, reserve: m.st.reserve, wh: m.st.wh, air: m.st.air, breached: !!m.st.breached },
        links: T.joints.filter((j) => j.a === m.id || j.b === m.id).map((j) => ({ to: j.a === m.id ? j.b : j.a, port: j.a === m.id ? j.pa : j.pb, type: j.type })) };
      this.syncDef(e, m);
    }
    const out = net.toJSON();
    for (const id in out.bases) out.bases[id].anchor = net.bases.get(id).anchor || null;
    return out;
  }

  /** Take an entity into the settlement. Without lattice data (a bare entities.add) it joins the nearest base or founds one. */
  adopt(e, quiet = false) {
    const net = this.net, d = e.def.data || (e.def.data = {});
    let base = d.base && net.bases.get(d.base);
    if (!base) {
      const near = this.baseNear(e.def.x, e.def.z);
      if (near && !d.base) {
        base = near;
        const l = toLocal(base, e.def.x, e.def.z);
        d.r = ((Math.round((-e.def.yaw - base.yaw) / (Math.PI / 2)) % 4) + 4) % 4;
        d.g = snapLattice(e.def.type, d.r, l.x, l.z);
      } else {
        d.r = 0; d.g = snapLattice(e.def.type, 0, 0, 0);
        const yaw = -(e.def.yaw || 0), c = Math.cos(yaw), s = Math.sin(yaw);
        base = net.addBase({ id: d.base || undefined, x: e.def.x - (d.g[0] * c + d.g[1] * s), z: e.def.z - (-d.g[0] * s + d.g[1] * c), yaw });
        const [hx, hz] = halfExtent(e.def.type, 0);
        base.anchor = { lx: d.g[0], lz: d.g[1], hx, hz };
        base.y = this.datum(base);
        base.site = this.siteQuality(e.def.x, e.def.z, 0);
      }
      d.base = base.id; d.level = d.level || 0; d.ly = d.ly || 0;
      if (d.progress === undefined) d.progress = 0;
    }
    const m = net.addModule({ id: e.def.id, type: e.def.type, base: base.id, lx: d.g[0], lz: d.g[1], r: d.r || 0, level: d.level || 0, ly: d.ly || 0, seq: d.seq, progress: d.progress ?? 0, st: d.st });
    if (isBuilt(m)) { m.st.on = true; m.st.pf = 1; }
    this.syncDef(e, m);
    this.dirty.add(base.id);
    if (!quiet) this.seatEntity(e);
    return m;
  }
  syncDef(e, m) {
    const w = this.worldOf(m);
    e.def.x = w.x; e.def.z = w.z; e.def.yaw = -w.yaw;
  }
  seatEntity(e) {
    const m = this.net.modules.get(e.def.id);
    if (!m) return;
    const w = this.worldOf(m);
    e.object.position.set(w.x, w.y, w.z); e.object.rotation.y = w.yaw;
  }
  reseatEntities() { for (const e of this.game.entities.items.values()) if (e.type.kind === "base") this.seatEntity(e); }

  /* ── geometry ─────────────────────────────────────────────────────────── */

  worldOf(m, out = {}) {
    const b = this.net.bases.get(m.base);
    toWorld(b, m.lx, m.lz, out);
    out.y = b.y + (m.ly || 0); out.yaw = b.yaw + m.r * Math.PI / 2;
    return out;
  }
  /**
   * A label over every module still under construction: what it is, how far
   * along, and the play time left (or that it waits for a crew), so a placed
   * module never reads as a glitch while it assembles. DOM, positioned per
   * frame like the HUD's objective marker; text refreshed four times a second.
   */
  _siteLabels(game, dt) {
    if (!this._labelRoot) {
      if (typeof document === "undefined" || game.headless === true && !document.body) return;
      this._labelRoot = document.createElement("div");
      this._labelRoot.id = "site-labels";
      document.body.appendChild(this._labelRoot);
      if (game.hud && game.hud.ui) game.hud.ui.register("site-labels", { el: this._labelRoot, group: "base", policy: "always" });
      this._labels = new Map();
      this._labelT = 0;
    }
    const root = this._labelRoot, net = this.net, cam = game.camera;
    const show = game.mode !== "title" && game.mode !== "complete";
    root.hidden = !show;
    if (!show) return;
    this._labelT -= dt;
    const refresh = this._labelT <= 0;
    if (refresh) this._labelT = 0.25;
    const pace = Math.max(game.state.clock.scale || 1, RULES.buildPace);
    const w = window.innerWidth, h = window.innerHeight, focus = game.focus || game.vehicle.p;
    const seen = new Set();
    for (const m of net.modules.values()) {
      if (m.progress >= 1) continue;
      seen.add(m.id);
      let el = this._labels.get(m.id);
      if (!el) { el = document.createElement("div"); el.className = "site-label"; root.appendChild(el); this._labels.set(m.id, el); }
      const at = this.worldOf(m);
      const dist = Math.hypot(at.x - focus.x, at.z - focus.z);
      _lv.set(at.x, at.y + ((KIT[m.type] && KIT[m.type].height) || 3) + 2, at.z).project(cam);
      const x = (_lv.x * 0.5 + 0.5) * w, y = (-_lv.y * 0.5 + 0.5) * h;
      // in build mode every site within 450 m; otherwise only the ones close by (160 m), the further ones without their timing line
      const building = game.mode === "build", off = _lv.z > 1 || x < 0 || x > w || y < 0 || y > h || dist > (building ? 450 : 160);
      el.hidden = off;
      if (off) continue;
      el.classList.toggle("far", !building && dist > 90);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      if (refresh) {
        const B = MODULES[m.type], pct = Math.floor(m.progress * 100);
        let when;
        if (net.sandbox) when = "instant (sandbox)";
        else if (m.queued) when = "waiting for a crew";
        else {
          const secs = (1 - m.progress) * B.build_h * 3600 / pace;
          when = secs >= 90 ? `${Math.ceil(secs / 60)} min left` : `${Math.max(1, Math.ceil(secs))} s left`;
        }
        el.innerHTML = `<b>${B.name}</b><span>${pct}% \u00b7 ${when}</span><i><em style="width:${pct}%"></em></i>`;
      }
    }
    for (const [id, el] of this._labels) if (!seen.has(id)) { el.remove(); this._labels.delete(id); }
  }

  /** The floor datum of a base: the highest ground under its founding footprint, so nothing is ever dug in. */
  datum(base) {
    const a = base.anchor || { lx: 0, lz: 0, hx: 2, hz: 2 };
    return groundStats(this.game.surface, base, a.lx, a.lz, a.hx, a.hz).max;
  }
  /** The base a point belongs to: the nearest one with a module within RULES.joinRange. */
  baseNear(x, z, range = RULES.joinRange) {
    let best = null, bd = Infinity;
    const l = {};
    for (const m of this.net.modules.values()) {
      const b = this.net.bases.get(m.base), [hx, hz] = halfExtent(m.type, m.r);
      toLocal(b, x, z, l);
      const d = Math.hypot(Math.max(0, Math.abs(l.x - m.lx) - hx), Math.max(0, Math.abs(l.z - m.lz) - hz));
      if (d < bd) { bd = d; best = b; }
    }
    return bd <= range ? best : null;
  }
  /** The module standing on a point (the highest storey there), or null. */
  moduleAt(x, z) {
    for (const b of this.net.bases.values()) {
      const l = toLocal(b, x, z), [cx, cz] = cellOfPoint(l.x, l.z), T = this.net.topology(b.id);
      for (let lv = RULES.maxStack; lv >= 0; lv--) { const id = T.cells.get(cellKey(cx, cz, lv)); if (id) return this.net.modules.get(id); }
    }
    return null;
  }
  /** Site quality at a point, each 0..1 with 1 good. Uses the weather system's hazard map when there is one. */
  siteQuality(x, z, slopeDeg) {
    const g = this.game, hz = horizonDeg(g.surface, x, z);
    const q = { slope: clamp(1 - slopeDeg / RULES.maxSlopeDeg, 0, 1), solar: clamp(1 - Math.max(0, hz - 3) / 20, 0, 1), shelter: clamp(hz / 12, 0, 1) };
    try {
      const s = g.env && g.env.hazardMap && g.env.hazardMap.sample ? g.env.hazardMap.sample(x, z) : null;
      if (s && s.ready !== false) { if (Number.isFinite(s.solar)) q.solar = clamp(s.solar, 0, 1); if (Number.isFinite(s.shelter)) q.shelter = clamp(s.shelter, 0, 1); if (Number.isFinite(s.suitability)) q.suitability = clamp(s.suitability, 0, 1); }
    } catch { /* the weather system is not ours to trust */ }
    return q;
  }

  /* ── changes ──────────────────────────────────────────────────────────── */

  /** Add a module to the world. spec: {type, base: id | null, frame: {x, z, yaw, y} for a new base, lx, lz, r, level, ly, site}. Returns the module record. */
  async addModule(spec) {
    const net = this.net;
    let base = spec.base && net.bases.get(spec.base);
    if (!base) {
      const [hx, hz] = halfExtent(spec.type, spec.r || 0);
      base = net.addBase({ x: spec.frame.x, z: spec.frame.z, yaw: spec.frame.yaw });
      base.anchor = { lx: spec.lx, lz: spec.lz, hx, hz };
      base.y = this.datum(base);
      base.site = spec.site || this.siteQuality(spec.frame.x, spec.frame.z, 0);
      this.emit("founded", { id: base.id, name: base.name, x: base.x, z: base.z });
    }
    const w = toWorld(base, spec.lx, spec.lz);
    const e = await this.game.entities.add({ type: spec.type, x: w.x, z: w.z, yaw: -(base.yaw + (spec.r || 0) * Math.PI / 2),
      data: { base: base.id, g: [spec.lx, spec.lz], r: spec.r || 0, level: spec.level || 0, ly: spec.ly || 0, progress: spec.progress ?? 0 } });
    const m = net.modules.get(e.def.id);
    if (this.net.sandbox || spec.instant) net.finish(m.id);
    this._refresh();
    this.emit("placed", this.describe(m));
    return m;
  }
  removeModule(id) {
    const m = this.net.modules.get(id);
    if (!m) return null;
    const info = this.describe(m);
    this.net.removeModule(id);
    this.game.entities.remove(id);
    const s = this.sites.get(id);
    if (s) { s.dispose(); this.sites.delete(id); }
    for (const [who, mid] of this.occupants) if (mid === id) this.occupants.delete(who);
    if (!this.net.bases.has(m.base)) { const b = this.batches.get(m.base); if (b) { b.dispose(); this.batches.delete(m.base); } }
    this.dirty.add(m.base);
    this.emit("salvaged", info);
    return m;
  }
  /** Can this module be taken away? Nothing may be stacked on it. */
  canRemove(m) {
    const T = this.net.topology(m.base), [c] = cellsOf(m.type, m.lx, m.lz, m.r);
    if (T.cells.has(cellKey(c[0], c[1], m.level + 1))) return { ok: false, reason: "remove what is stacked on it first" };
    return { ok: true, refund: this.net.refund(m) };
  }
  salvage(id) {
    const m = this.net.modules.get(id);
    if (!m) return { ok: false, reason: "nothing there" };
    const c = this.canRemove(m);
    if (!c.ok) return c;
    if (!this.net.sandbox) this.net.materials += c.refund;
    this.removeModule(id);
    return { ok: true, refund: c.refund, type: m.type };
  }

  /* ── the picture ──────────────────────────────────────────────────────── */

  reseat() {
    for (const b of this.net.bases.values()) { b.y = this.datum(b); this.dirty.add(b.id); }
    this.reseatEntities();
  }
  _refresh() {
    const net = this.net;
    for (const id of [...this.dirty]) {
      try { this._refreshBase(id); }
      catch (err) {                       // one bad module must not take the whole settlement's picture (or the system) down
        if (!this._refreshErr) { this._refreshErr = String(err && err.message || err); console.error("[base] could not draw base", id, err); }
        this.dirty.delete(id);
      }
    }
    for (const [id, s] of this.sites) if (!net.modules.has(id)) { s.dispose(); this.sites.delete(id); }
    this.obstacles = [];
    for (const m of net.modules.values()) obstaclesOf(m, net.bases.get(m.base), this.obstacles);
  }
  _refreshBase(id) {
    const net = this.net;
    {
      const base = net.bases.get(id);
      if (!base) { const b = this.batches.get(id); if (b) { b.dispose(); this.batches.delete(id); } this.dirty.delete(id); return; }
      const T = net.topology(id), built = T.mods.filter(isBuilt);
      const missing = [...new Set(T.mods.map((m) => m.type))].filter((t) => !this.kit.loaded(t));
      // construction sites first: they load their own geometry, so a placement shows at once even while the kit is still arriving
      let batch = this.batches.get(id);
      if (!batch) { batch = new BaseBatch(this.kit, base); this.batches.set(id, batch); this.root.add(batch.group, batch.ground); batch.place(); }
      for (const m of T.mods) {
        if (isBuilt(m)) { const s = this.sites.get(m.id); if (s) { s.dispose(); this.sites.delete(m.id); } }
        else if (!this.sites.has(m.id)) {
          const [hx, hz] = halfExtent(m.type, m.r), legs = m.level ? 0 : base.y - groundStats(this.game.surface, base, m.lx, m.lz, hx, hz).min;
          const s = new Site(this.kit, m, legs); this.sites.set(m.id, s); batch.group.add(s.group);
        }
      }
      if (missing.length) { if (!this._loading) this._loading = this.kit.preload(missing).catch((e) => console.warn("[base] kit", e.message)).finally(() => { this._loading = null; }); return; }
      batch.rebuild(built, T.joined, this.game.surface);
      this.dirty.delete(id);
      this._lightAcc = 1;
    }
  }
  /** Resolves when every base is drawn (tests, screenshots). */
  async whenReady() {
    for (let i = 0; i < 400; i++) {
      this._refresh();
      if (!this.dirty.size) return true;
      if (this._loading) await this._loading; else await new Promise((r) => setTimeout(r, 10));
    }
    return false;
  }

  frame(game, dt) {
    if (!this.ready) return;
    if (this.dirty.size) this._refresh();
    const net = this.net, night = 1 - game.sky.uniforms.uDay.value;
    for (const [id, s] of this.sites) { const m = net.modules.get(id); if (m) s.update(m.progress, net.bases.get(m.base).y, dt); }
    this._siteLabels(game, dt);
    // moving nodes: panels follow the Sun, doors follow the rover
    const v = game.vehicle, sun = game.sky.sunDir, up = game.sky.sun.sinEl > 0.03;
    this.dyn.begin();
    for (const m of net.modules.values()) {
      if (!isBuilt(m)) continue;
      const B = MODULES[m.type], K = KIT[m.type];
      if (!B.solar && !B.garage && !B.airlock) continue;
      const batch = this.batches.get(m.base);
      if (!batch || !this.kit.loaded(m.type)) continue;
      const frame = batch.group.matrixWorld, st = m.st, w = this.worldOf(m);
      if (B.solar) {
        // sun in the module's frame; one axis: tilt about X so the normal (0, cos, sin) leans toward it
        const zl = sun.x * Math.sin(w.yaw) + sun.z * Math.cos(w.yaw), want = up ? clamp(Math.atan2(zl, Math.max(sun.y, 0.05)), -0.785, 0.785) : 0;
        st.tilt = st.tilt === undefined ? want : st.tilt + clamp(want - st.tilt, -dt * 0.5, dt * 0.5);
        const rest = ((K.tilt && K.tilt.default_deg) || 0) * Math.PI / 180;
        this.dyn.add(m.type, "panel", frame, m, null, _m2.makeRotationX(st.tilt - rest));
      } else {
        const node = B.garage ? "door" : "door_outer";
        let open = 0;
        if (B.garage) open = st.on && Math.hypot(v.p.x - w.x, v.p.z - w.z) < 22 ? 1 : 0;
        else { const f = game.focus || v.p; open = this.occupantNear(m, w, f) ? 1 : 0; }
        st.door = clamp((st.door || 0) + clamp(open - (st.door || 0), -dt * 0.8, dt * 0.8), 0, 1);
        this.dyn.add(m.type, node, frame, m, B.garage ? _m2.makeTranslation(0, 3.1 * st.door, 0) : _m2.makeTranslation(1.42 * st.door, 0, 0), null);
      }
    }
    this.dyn.end();
    // lights
    this._lightAcc += dt || 0.05;
    if (this._lightAcc > 0.3) {
      this._lightAcc = 0;
      const lamps = [];
      for (const [id, batch] of this.batches) {
        const b = net.bases.get(id), powered = !!b && !!b.live && (b.live.stored > 1 || b.live.gen > b.live.t1);
        batch.light(night, powered);
        for (const l of batch.lamps) { const m = net.modules.get(l.id); lamps.push({ x: l.x, y: b.y + l.y, z: l.z, mast: l.mast, on: powered && m && m.st.on }); }
      }
      this.lights.assign(lamps, game.camera.position, night);
    }
  }
  occupantNear(m, w, f) {
    for (const [who, id] of this.occupants) if (id === m.id && this._doorT > performance.now()) return who;
    return this.game.mode === "onfoot" && f && Math.hypot(f.x - w.x, f.z - w.z) < 6;
  }

  /* ── the simulation step ──────────────────────────────────────────────── */

  /** The Sun and the dust as the settlement sees them. Uses the weather system's `game.env` when it is there. */
  env() {
    const g = this.game, sky = g.sky, tau = g.state.weather.tau, sinEl = sky.sun.sinEl, ext = g.env || null;
    const key = Math.round(g.state.clock.ls * 2) + "|" + Math.round(tau * 20);
    if (!this._solar || this._solar.key !== key) {
      // one sol of this season and this dust: mean irradiance on a tracking array, and when the Sun is up
      const N = 144, lat = g.site.manifest.grid.lat0_deg;
      let sum = 0, rise = -1, set = -1;
      for (let i = 0; i < N; i++) {
        const s = sunPosition(lat, (i + 0.5) / N * MARS.solSeconds, g.state.clock.ls), irr = surfaceIrradiance(s.sinEl, tau);
        if (s.sinEl > 0.02) { if (rise < 0) rise = i; set = i + 1; sum += MARS.solarConstant * (irr.direct / Math.max(s.sinEl, 0.05) * 0.92 + irr.diffuse); }
      }
      this._solar = { key, Gavg: sum / N, rise: rise / N, set: set / N, nightLen_h: (1 - (set - rise) / N) * MARS.solSeconds / 3600 };
    }
    const S = this._solar, irr = sky.irradiance;
    let G = sinEl > 0.02 ? MARS.solarConstant * (irr.direct / Math.max(sinEl, 0.05) * 0.92 + irr.diffuse) : 0;
    let dustRate = tau / 0.55;
    try {
      const w = ext && ext.sun && ext.sun.irradiance_Wm2;
      if (Number.isFinite(w)) { const horiz = MARS.solarConstant * irr.total; G = horiz > 1 ? G * clamp(w / horiz, 0, 3) : 0; }
      // the weather system's own deposition rate (a fraction of output per sol) replaces ours when it publishes one
      if (ext && ext.dust && Number.isFinite(ext.dust.panel_deposition_per_sol)) dustRate = ext.dust.panel_deposition_per_sol / RULES.dustPerSol;
    } catch { /* not ours */ }
    const f = g.state.clock.tod / MARS.solSeconds;
    const nightLeft = f < S.rise ? S.rise - f : f >= S.set ? 1 - f + S.rise : 0;
    const e = this._env;
    e.buildBoost = Math.max(1, RULES.buildPace / Math.max(1, g.state.clock.scale));
    e.G = G; e.Gavg = S.Gavg; e.sinEl = sinEl; e.dustRate = dustRate; e.nightLeft_h = nightLeft * MARS.solSeconds / 3600; e.nightLen_h = S.nightLen_h;
    return e;
  }

  tick(game, dt, ctx) {
    if (!this.ready) return;
    const net = this.net, v = game.vehicle;
    net.sandbox = !!game.settings.sandbox;
    // the rover at the base: in the garage, or backed up to an open port
    this.docked = this.findDock();
    const room = v.capacity - v.battery;
    net.dock = this.docked && room > 1 ? { moduleId: this.docked.moduleId, want_W: Math.min(this.docked.charge_W, room / Math.max(ctx.simDt, 1e-6)) } : null;
    net.step(ctx.simDt, this.env());
    if (net.dock && net.dockDelivered_W > 0) {
      v.battery = Math.min(v.capacity, v.battery + net.dockDelivered_W * ctx.simDt);
      if (v.flat && v.battery > 0.03 * v.capacity) v.flat = false;
    }
    if (this.docked) { this.docked.delivered_W = net.dock ? net.dockDelivered_W : 0; if (this.docked.garage) this.repair.progress = Math.min(1, this.repair.progress + ctx.simDt / 3600 * 0.25); this.repair.moduleId = this.docked.moduleId; }
    else this.repair.moduleId = null;
    // the rover cannot drive through a module
    if (game.mode === "driving" && this.obstacles.length) {
      _fw.set(0, 0, -1).applyQuaternion(v.q); _fw.y = 0; _fw.normalize();
      const half = v.def.box.length / 2 - 1.2, r = v.def.box.width / 2 - 0.1;
      const circles = [{ x: v.p.x + _fw.x * half, z: v.p.z + _fw.z * half, r }, { x: v.p.x, z: v.p.z, r }, { x: v.p.x - _fw.x * half, z: v.p.z - _fw.z * half, r }];
      const o = resolve(v.p, v.v, circles, this.obstacles);
      this.touching = o ? { id: o.id, type: o.type, until: performance.now() + 600 } : (this.touching && this.touching.until > performance.now() ? this.touching : null);
    }
    this.shelterHook();
  }

  /** {moduleId, garage, charge_W} when the rover is parked in a powered garage, or with its rear hatch against an open pressurised port. */
  findDock() {
    const v = this.game.vehicle, net = this.net;
    if (Math.abs(v.t.speed) > 0.6) return null;
    const l = {};
    for (const m of net.modules.values()) {
      if (!isBuilt(m)) continue;
      const B = MODULES[m.type], b = net.bases.get(m.base);
      if (B.garage) {
        toLocal(b, v.p.x, v.p.z, l);
        const [x, z] = rot(-m.r, l.x - m.lx, l.z - m.lz);
        if (Math.abs(x) < 3.3 && z > -3.6 && z < 3.6) return { moduleId: m.id, garage: true, charge_W: B.charge_w, base: m.base };
      }
    }
    // rear hatch to a port: 2.5 m behind the centre
    _fw.set(0, 0, -1).applyQuaternion(v.q);
    const hx = v.p.x - _fw.x * 2.6, hz = v.p.z - _fw.z * 2.6;
    for (const b of net.bases.values()) {
      if (Math.hypot(b.x - hx, b.z - hz) > 400) continue;
      toLocal(b, hx, hz, l);
      for (const p of net.openPorts(b.id)) {
        if (p.type !== "pressurized" || p.y > 2 || Math.hypot(p.x - l.x, p.z - l.z) > 2.2) continue;
        const m = net.modules.get(p.module);
        if (!isBuilt(m) || !m.st.on) continue;
        const wd = toWorld({ x: 0, z: 0, yaw: b.yaw }, p.dx, p.dz);
        if (wd.x * _fw.x + wd.z * _fw.z > 0.8) return { moduleId: m.id, garage: false, port: p.name, charge_W: 3000, base: m.base };   // port faces the way the rover does: its rear is to the port
      }
    }
    return null;
  }

  /** 0..1 shelter at a point: 1 inside a garage or a pressurised module, partial beside a berm. Offered to the weather system. */
  shelter(x, z) {
    const l = {};
    let s = 0;
    for (const m of this.net.modules.values()) {
      if (!isBuilt(m)) continue;
      const B = MODULES[m.type], b = this.net.bases.get(m.base), [hx, hz] = halfExtent(m.type, m.r);
      toLocal(b, x, z, l);
      const dx = Math.abs(l.x - m.lx) - hx, dz = Math.abs(l.z - m.lz) - hz;
      if ((B.garage || B.pressurised) && dx < -0.3 && dz < -0.3) return 1;
      if (B.shield && Math.hypot(Math.max(0, dx), Math.max(0, dz)) < 6) s = Math.max(s, 0.5);
    }
    return s;
  }
  shelterHook() {
    if (this._shelterHooked) return;
    const e = this.game.env;
    if (!e) return;
    const fn = (x, z) => this.shelter(x, z);
    try {
      if (typeof e.addShelter === "function") e.addShelter(fn);
      else if (Array.isArray(e.shelters)) e.shelters.push(fn);
      else if (Array.isArray(e.shelterSources)) e.shelterSources.push(fn);
      else return;
      this._shelterHooked = true;
    } catch { /* not ours */ }
  }

  /**
   * IS IT ACTUALLY ON SCREEN? One row per module, for exactly the failure a headless pass cannot see:
   *   drawn      its geometry is in a mesh that is in the scene (the base's merged batch, or its construction site)
   *   visible    every object from that mesh up to the scene is visible
   *   opacity    the least opaque material it is drawn with (a construction site reports its blueprint's)
   *   sizeError  largest difference between the loaded model's bounding box and the catalogue's, metres
   *   px         its bounding box projected by the current camera: {w, h, area}, 0 when behind the camera; inView says so
   *   offGround  the largest gap between a foot / leg and the ground under it, metres; buried: ground above the floor datum
   *   fromFocus  metres from the rover (a module kilometres away, or at the site origin, shows here)
   * `__mars.modules()` in the console prints it; the smoke test asserts on it.
   */
  diagnose(camera = this.game.camera) {
    const g = this.game, S = g.surface, out = [], W = window.innerWidth, H = window.innerHeight, v3 = new THREE.Vector3(), box = new THREE.Box3(), mat = new THREE.Matrix4();
    camera.updateMatrixWorld(true);
    const inScene = (o) => { let vis = true, top = o; while (top) { if (!top.visible) vis = false; if (!top.parent) break; top = top.parent; } return { attached: top === g.scene, vis }; };
    for (const m of this.net.modules.values()) {
      const b = this.net.bases.get(m.base), batch = this.batches.get(m.base), site = this.sites.get(m.id), P = this.kit.loaded(m.type), K = KIT[m.type], built = isBuilt(m), w = this.worldOf(m);
      const holder = built ? (batch && batch.drawn && batch.drawn.has(m.id) ? batch.group : null) : (site && site.blue.visible ? site.blue : null), chain = holder ? inScene(holder) : { attached: false, vis: false };
      let opacity = 0;
      if (built && batch) { opacity = 1; for (const mesh of batch.group.children) if (mesh.isMesh && mesh.material && mesh.material.name !== "glass") opacity = Math.min(opacity, mesh.material.transparent ? mesh.material.opacity : 1); }
      else if (site) opacity = site.blueMat.opacity;
      let sizeError = null;
      const a = K.aabb;
      if (P) { if (!P.silhouette.boundingBox) P.silhouette.computeBoundingBox(); const bb = P.silhouette.boundingBox; sizeError = Math.max(...[0, 1, 2].map((i) => Math.max(Math.abs(bb.min.getComponent(i) - a.min[i]), Math.abs(bb.max.getComponent(i) - a.max[i])))); }
      mat.makeRotationY(w.yaw).setPosition(w.x, w.y, w.z);
      box.makeEmpty();
      let front = 0;
      for (let k = 0; k < 8; k++) {
        v3.set(k & 1 ? a.max[0] : a.min[0], k & 2 ? a.max[1] : a.min[1], k & 4 ? a.max[2] : a.min[2]).applyMatrix4(mat).project(camera);
        if (v3.z < 1 && v3.z > -1) { front++; box.expandByPoint(v3); }
      }
      const px = front ? { w: Math.max(0, Math.min(1, box.max.x) - Math.max(-1, box.min.x)) * W / 2, h: Math.max(0, Math.min(1, box.max.y) - Math.max(-1, box.min.y)) * H / 2 } : { w: 0, h: 0 };
      px.area = px.w * px.h;
      const [hx, hz] = halfExtent(m.type, m.r), st = m.level ? null : groundStats(S, b, m.lx, m.lz, hx, hz);
      let off = 0;
      if (st) for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const p = toWorld(b, m.lx + cx * (hx - 0.45), m.lz + cz * (hz - 0.45)), drop = w.y - S.height(p.x, p.z); off = Math.max(off, built ? (drop >= 0.12 ? 0 : Math.max(0, drop)) : Math.max(0, drop - (site ? site.legs + 0.15 : 0))); }
      out.push({ id: m.id, type: m.type, built, progress: m.progress, drawn: !!holder && chain.attached, visible: chain.vis, opacity, sizeError, x: w.x, y: w.y, z: w.z, groundY: S.height(w.x, w.z),
        px, inView: front === 8 && px.area > 0 && box.min.x > -1 && box.max.x < 1 && box.min.y > -1 && box.max.y < 1, offGround: off, legs: st ? w.y - st.min : 0, buried: st ? Math.max(0, st.max - w.y) : 0,
        fromFocus: Math.hypot(w.x - g.vehicle.p.x, w.z - g.vehicle.p.z), error: this._refreshErr || null });
    }
    return out;
  }

  /** net.summary(), making sure the base has been looked at once under the real Sun (after a load nothing has stepped yet). */
  summary(baseId) {
    const b = this.net.bases.get(baseId);
    if (b && !b.live) this.net._stepBase(b, 1e-9, 1e-12, this.env());
    return this.net.summary(baseId);
  }

  /** The base the player is concerned with: the one nearest a point (default: the rover). */
  currentBase(x, z) {
    const v = this.game.vehicle, px = x ?? v.p.x, pz = z ?? v.p.z;
    let best = null, bd = Infinity;
    for (const b of this.net.bases.values()) { const d = Math.hypot(b.x - px, b.z - pz); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  describe(m) {
    const B = MODULES[m.type], b = this.net.bases.get(m.base), w = b ? this.worldOf(m) : { x: 0, y: 0, z: 0, yaw: 0 }, T = b ? this.net.topology(m.base) : null;
    const mated = T ? T.joined.get(m.id) || new Set() : new Set();
    return {
      id: m.id, type: m.type, name: B.name, base: m.base, x: w.x, y: w.y, z: w.z, yaw: w.yaw, level: m.level, built: isBuilt(m), progress: m.progress, queued: !!m.queued,
      powered: !!m.st.on, onReserve: !!m.st.onReserve, pressurised: !!B.pressurised, air: m.st.air, habitable: !!m.st.habitable, breached: !!m.st.breached, dust: m.st.dust,
      crew: B.crew || 0, cutOff: !!T && isBuilt(m) && T.networkOf.get(m.id) !== T.main, volume: T ? T.volumeOf.get(m.id) ?? null : null,
      ports: b ? portsOf(m).map((p) => { const pw = toWorld(b, p.x, p.z), d = toWorld({ x: 0, z: 0, yaw: b.yaw }, p.dx, p.dz); return { name: p.name, type: p.type, x: pw.x, y: b.y + p.y, z: pw.z, dir: p.up ? { x: 0, y: 1, z: 0 } : { x: d.x, y: 0, z: d.z }, joined: mated.has(p.name) }; }) : [],
    };
  }
}

/* ── the API the astronaut, missions and weather read ───────────────────── */

function makeApi(sys) {
  const net = sys.net;
  const airlockInfo = (m, x, z) => {
    const b = net.bases.get(m.base), B = MODULES[m.type];
    const port = portsOf(m).find((p) => p.type === "exterior") || portsOf(m).find((p) => !p.up) || { x: m.lx, z: m.lz, y: 1.5, dx: 0, dz: 1 };
    const pw = toWorld(b, port.x + port.dx * 1.6, port.z + port.dz * 1.6), d = toWorld({ x: 0, z: 0, yaw: b.yaw }, port.dx, port.dz);
    return { id: m.id, type: m.type, base: m.base, x: pw.x, y: b.y, z: pw.z, dir: { x: d.x, z: d.z }, distance: Math.hypot(pw.x - x, pw.z - z), usable: api.canEnter(m.id).ok, name: B.name };
  };
  const api = {
    /** Every module, as plain data (see BaseSystem.describe). */
    modules: () => [...net.modules.values()].map((m) => sys.describe(m)),
    module: (id) => { const m = net.modules.get(id); return m ? sys.describe(m) : null; },
    bases: () => [...net.bases.values()].map((b) => ({ id: b.id, name: b.name, x: b.x, y: b.y, z: b.z, yaw: b.yaw, modules: net.of(b.id).length })),
    /** The nearest built airlock (or habitat with its own): where to stand, which way it faces, whether it can be entered now. */
    nearestAirlock: (x, z) => {
      let best = null;
      for (const m of net.modules.values()) { const B = MODULES[m.type]; if (!isBuilt(m) || !(B.airlock || B.ownAirlock)) continue; const a = airlockInfo(m, x, z); if (!best || a.distance < best.distance) best = a; }
      return best;
    },
    /** The pressurised module (or garage) whose footprint contains the point, or null. */
    isInside: (x, z) => {
      const l = {};
      for (const m of net.modules.values()) {
        const B = MODULES[m.type];
        if (!isBuilt(m) || !(B.pressurised || B.garage)) continue;
        const b = net.bases.get(m.base), a = KIT[m.type].aabb;
        toLocal(b, x, z, l);
        const [px, pz] = rot(-m.r, l.x - m.lx, l.z - m.lz);
        if (px > a.min[0] && px < a.max[0] && pz > a.min[2] && pz < a.max[2]) return { id: m.id, type: m.type, base: m.base, pressurised: !!B.pressurised, habitable: !!m.st.habitable };
      }
      return null;
    },
    /** Stocks and flows of a base (default: the one nearest the rover), or null when nothing is built. */
    resources: (baseId) => { const b = baseId ? net.bases.get(baseId) : sys.currentBase(); return b ? sys.summary(b.id) : null; },
    materials: () => ({ stock: net.materials, cap: net.materialsCap(), perSol: net.materialsRate, sandbox: net.sandbox }),
    canEnter: (id) => {
      const m = net.modules.get(id);
      if (!m) return { ok: false, reason: "no such module" };
      const B = MODULES[m.type];
      if (!isBuilt(m)) return { ok: false, reason: "still under construction" };
      if (!(B.airlock || B.ownAirlock)) return { ok: false, reason: "not an airlock" };
      if (!m.st.on) return { ok: false, reason: "no power" };
      if (m.st.breached) return { ok: false, reason: "breached" };
      if (!(m.st.air > 0.6)) return { ok: false, reason: "not pressurised yet" };
      return { ok: true };
    },
    /** State only: records who is inside what and cycles the door. The avatar is the astronaut system's. */
    enter: (id, who = "crew") => {
      const c = api.canEnter(id);
      if (!c.ok) return c;
      sys.occupants.set(who, id); sys._doorT = performance.now() + 2500;
      sys.emit("enter", { who, moduleId: id, module: sys.describe(net.modules.get(id)) });
      const m = net.modules.get(id), w = sys.worldOf(m);
      return { ok: true, inside: { id, type: m.type, base: m.base }, x: w.x, y: w.y, z: w.z };
    },
    exit: (who = "crew") => {
      const id = sys.occupants.get(who);
      if (!id) return { ok: false, reason: "not inside" };
      const m = net.modules.get(id);
      sys.occupants.delete(who); sys._doorT = performance.now() + 2500;
      const at = m ? airlockInfo(m, 0, 0) : null;
      sys.emit("exit", { who, moduleId: id, at });
      return { ok: true, at };
    },
    occupants: () => Object.fromEntries(sys.occupants),
    /** The garage: where it is, whether the rover is docked, what it is drawing. Repair is data only (0..1 progress while docked). */
    repairBay: () => {
      const d = sys.docked;
      let g = null;
      for (const m of net.modules.values()) if (MODULES[m.type].garage && isBuilt(m)) { const w = sys.worldOf(m); if (!g || Math.hypot(w.x - sys.game.vehicle.p.x, w.z - sys.game.vehicle.p.z) < g.d) g = { m, w, d: Math.hypot(w.x - sys.game.vehicle.p.x, w.z - sys.game.vehicle.p.z) }; }
      return { available: !!g, moduleId: g ? g.m.id : null, x: g ? g.w.x : null, z: g ? g.w.z : null, y: g ? g.w.y : null, yaw: g ? g.w.yaw : null, distance: g ? g.d : null,
        powered: g ? !!g.m.st.on : false, docked: !!(d && d.garage), dockedAt: d ? d.moduleId : null, port: d && !d.garage ? d.port : null,
        charging_W: d ? d.delivered_W || 0 : 0, repair: sys.repair.progress, repairRate_per_h: 0.25 };
    },
    dock: () => sys.docked,
    /** Everything missions might score: counts, the rating and its parts. */
    stats: () => {
      const byType = {}; let built = 0, crew = 0, places = 0;
      for (const m of net.modules.values()) { byType[m.type] = (byType[m.type] || 0) + 1; if (isBuilt(m)) built++; }
      const bases = [...net.bases.values()].map((b) => { const s = sys.summary(b.id); crew += s.crew.capacity; places += s.crew.places; return { id: b.id, name: b.name, modules: s.modules, built: s.built, score: s.score.total, rating: s.score.rating, self: s.score.self, resilience: s.score.resilience, site: s.score.site, reserve_h: s.power.reserve_h, crew: s.crew.capacity }; });
      const top = bases.reduce((a, b) => (!a || b.score > a.score ? b : a), null);
      return { bases: bases.length, modules: net.modules.size, built, byType, crew_capacity: crew, crew_places: places, materials: net.materials, score: top ? top.score : 0, rating: top ? top.rating : "None", best: top, list: bases };
    },
    shelter: (x, z) => sys.shelter(x, z),
    /** Hide / show everything the base system draws (debugging: is a picture problem ours?). */
    show: (on = true) => { sys.root.visible = !!on; return sys.root.visible; },
    /** Is every module really on screen and on the ground? See BaseSystem.diagnose. */
    diagnose: (camera) => sys.diagnose(camera),
    /** Draw-call and triangle cost of what is built, per base (the frame budget is the README's). */
    renderStats: () => ({ bases: [...sys.batches].map(([id, b]) => Object.assign({ id }, b.stats)), dynamicTriangles: sys.dyn.triangles, dynamicDrawCalls: [...sys.dyn.sets.values()].reduce((a, s) => a + (s.n ? s.meshes.length : 0), 0), sites: sys.sites.size,
      lights: sys.lights.lights.map((l) => l.intensity), pools: [...sys.batches.values()].map((b) => !!(b.pools && b.pools.visible)), glow: [...sys.batches.values()].flatMap((b) => b.glow.map((m) => m.emissive.r)), lamps: [...sys.batches.values()].reduce((a, b) => a + b.lamps.length, 0) }),
    cleanSolar: (ids) => net.cleanSolar(ids),
    /** Deliver materials to the build stock (a mission reward, a supply drop). Not capped: a delivery is not thrown away. */
    addMaterials: (n) => { if (Number.isFinite(n)) net.materials = Math.max(0, net.materials + n); return net.materials; },
    breach: (id, on = true) => { const m = net.modules.get(id); if (m) m.st.breached = !!on; return !!m; },
    repair: (id) => api.breach(id, false),
    on: (name, fn) => sys.on(name, fn),          // "placed" | "built" | "salvaged" | "founded" | "enter" | "exit"
    /** Advance the settlement alone by simulated seconds (tests; a mission that wants to skip a night). */
    simulate: (seconds, env) => net.step(seconds, env || Object.assign({}, sys.env(), { buildBoost: 1 })),
    whenReady: () => sys.whenReady(),
    rules: RULES, balance: MODULES, net,
  };
  return api;
}

/* ══════════════════════════════════════════════════════════════════════════
   BUILD MODE
   ══════════════════════════════════════════════════════════════════════════ */

class Builder {
  constructor() {
    this.id = "builder"; this.order = 50;
    this.active = false;
    this.cat = 0; this.item = CATEGORIES.map(() => 0);
    this.rot = 0; this.newYaw = 0; this.portCycle = 0;
    this.cursor = { x: 0, z: 0 };
    this.cam = { x: 0, z: 0, y: 0, yaw: 0, pitch: 0.75, dist: 34 };
    this.cursorMode = "pad";
    this.mouse = { x: 0, y: 0, inside: false, orbit: false, pan: false, downAt: null };
    this.pose = null; this.result = null; this.hover = null;
    this.undo = [];
    this._focus = { x: 0, z: 0 };
    this.hold = { t: 0, id: null };
    this._crossT = 0; this._evalKey = ""; this._evalT = 0; this._promptT = 0; this._stillT = 0; this._placing = false;
    this.catalog = CATEGORIES.map((c) => ({ id: c.id, name: c.name, items: MODULE_IDS.filter((id) => MODULES[id].cat === c.id) }));
  }
  get sys() { return hub.base; }
  get type() { return this.catalog[this.cat].items[this.item[this.cat]]; }

  async init(game) {
    this.game = game;
    const sys = this.sys;
    if (!sys || !sys.ready) throw new Error("the base system is not running");
    this.ghost = new Ghost(sys.kit);
    this.outline = new Outline(sys.kit);
    this.grid = new GridDecal();
    game.scene.add(this.ghost.group, this.ghost.rings, this.outline.mesh, this.grid.lines);
    this.ui = new BuildUI(game, sys, this);
    game.helpMaps = game.helpMaps || {};
    game.helpMaps.build = { entries: BUILD_HELP, title: "Building" };
    this.api = {
      enter: () => this.enter(), exit: () => this.exit(), select: (type) => this.select(type), setCursor: (x, z) => this.setCursor(x, z),
      poseAt: (type, x, z, o) => this.poseAt(type, x, z, o), evaluate: (type, pose, o) => this.evaluate(type, pose, o),
      /** Evaluate at a world point and, if allowed, place. Returns {ok, state, reason, id, pose}. */
      placeAt: (type, x, z, o) => this.placeAt(type, x, z, o), placeLattice: (type, baseId, lx, lz, r, o) => this.placeLattice(type, baseId, lx, lz, r, o), nav: (c, i) => this.nav(c, i), confirm: () => this.confirm(), salvage: (id) => this.salvage(id), undoLast: () => this.undoLast(),
      rotate: (d) => this.rotate(d), thumbnails: () => this.ui.thumbnails().then(() => this.ui.sync()), state: () => ({ active: this.active, type: this.type, category: this.catalog[this.cat].id, rot: this.rot, cursor: { ...this.cursor }, cam: { ...this.cam },
        result: this.result, pose: this.pose ? { base: this.pose.base ? this.pose.base.id : null, lx: this.pose.lx, lz: this.pose.lz, r: this.pose.r, level: this.pose.level, snapped: this.pose.snapped ? { port: this.pose.snapped.gp.name, to: this.pose.snapped.tp.module, toPort: this.pose.snapped.tp.name, options: this.pose.snapped.n } : null, yaw: this.pose.frame.yaw } : null,
        hover: this.hover ? this.hover.id : null }),
    };
    this._wire();
    if (window.__mars) window.__mars.builder = this.api;
  }

  /* ── entering and leaving ─────────────────────────────────────────────── */

  enter() {
    const g = this.game, v = g.vehicle;
    if (this.active || !g.ready) return false;
    if (g.mode !== "driving" && g.mode !== "menu") return false;
    if (Math.abs(v.t.speed) > 1.2) { g.hud.toast("Stop first to build", 2); return false; }
    v.v.set(0, 0, 0); v.w.set(0, 0, 0);
    this.active = true;
    if (g.hud.ui) g.hud.ui.used("build.enter");
    this._saved = { yaw: g.rig.yaw, pitch: g.rig.pitch, dist: g.rig.distance, focus: g.focus || null, warp: g.warp };
    if (g.warp) g.setWarp(false);
    g.state.clock.scale = RULES.buildClockScale;
    _fw.set(0, 0, -1).applyQuaternion(v.q);
    const h = Math.atan2(_fw.x, -_fw.z);
    this.cam.yaw = Math.PI - h + 0.5; this.cam.pitch = 0.66; this.cam.dist = 27;
    this.cam.x = v.p.x + Math.sin(h) * 13; this.cam.z = v.p.z - Math.cos(h) * 13;
    this.cam.y = g.surface.height(this.cam.x, this.cam.z);
    this.cursor.x = this.cam.x; this.cursor.z = this.cam.z;
    this.cursorMode = "pad"; this.undo = []; this.hold.t = 0; this._evalKey = "";
    this._focus.x = this.cam.x; this._focus.z = this.cam.z; g.focus = this._focus;
    if (g.mode === "menu") { g._resumeMode = "build"; g.pause(false); } else g.setMode("build");
    this.ui.thumbnails();
    return true;
  }
  exit() {
    const g = this.game;
    if (!this.active) return false;
    this.active = false;
    g.state.clock.scale = TIME_SCALE; g.warp = false;
    const s = this._saved || {};
    g.rig.yaw = s.yaw ?? 0; g.rig.pitch = s.pitch ?? 0.24; g.rig.distance = s.dist ?? g.rig.distance;
    g.focus = s.focus || null;
    this.ghost.group.visible = false; this.ghost.rings.visible = false; this.outline.show(null); this.grid.hide();
    g.terrain.invalidate && g.terrain.invalidate();
    if (g.mode === "build") g.setMode("driving"); else g._resumeMode = "driving";
    g.save();
    return true;
  }
  onMode(game, mode) {
    const building = mode === "build";
    document.body.classList.toggle("is-build", building);
    if (this.ui) this.ui.show(building);
    if (!building) { if (this.ghost) { this.ghost.group.visible = false; this.ghost.rings.visible = false; this.outline.show(null); this.grid.hide(); } }
    // someone else changed the mode under us (a mission, the astronaut): let go cleanly
    if (this.active && mode !== "build" && mode !== "menu") { this.active = false; game.state.clock.scale = TIME_SCALE; game.focus = (this._saved && this._saved.focus) || null; }
  }

  /* ── the menu ─────────────────────────────────────────────────────────── */

  select(type) {
    for (let c = 0; c < this.catalog.length; c++) { const i = this.catalog[c].items.indexOf(type); if (i >= 0) { this.cat = c; this.item[c] = i; this.portCycle = 0; this._evalKey = ""; this.ui.sync(); return true; } }
    return false;
  }
  nav(dCat, dItem) {
    const n = this.catalog.length;
    if (dCat) this.cat = (this.cat + dCat + n) % n;
    if (dItem) { const k = this.catalog[this.cat].items.length; this.item[this.cat] = (this.item[this.cat] + dItem + k) % k; }
    this.portCycle = 0; this._evalKey = "";
    this.ui.sync();
  }
  rotate(d) {
    const p = this.pose;
    if (p && p.snapped && p.snapped.n > 1) this.portCycle = (this.portCycle + d + p.snapped.n * 8) % p.snapped.n;
    else if (p && !p.base) this.newYaw += d * Math.PI / 12;
    else this.rot = (this.rot + d + 4) % 4;
    this._evalKey = "";
  }
  setCursor(x, z) { this.cursor.x = x; this.cursor.z = z; this.cam.x = x; this.cam.z = z; this.cursorMode = "pad"; this._evalKey = ""; this.update(0, true); }

  /* ── where the ghost goes: the lattice, and port snapping ─────────────── */

  /**
   * The pose a module would take with the cursor at (x, z):
   *   { base | null, frame: {x, z, yaw, y}, lx, lz, r, level, ly, snapped: {tp, gp, n} | null, stackOn }
   * Inside a base's range the module is on that base's lattice; near an open
   * pressurised port it is turned and moved so one of its own pressurised
   * ports mates with it (position and yaw from the two port frames); over a
   * module whose port_up accepts it, it is stacked. Elsewhere it founds a new
   * base facing `newYaw`.
   */
  poseAt(type, x, z, o = {}) {
    const sys = this.sys, net = sys.net, K = KIT[type];
    const r0 = o.r ?? this.rot, base = o.newBase ? null : sys.baseNear(x, z);
    if (!base) {
      const yaw = o.yaw ?? this.newYaw, g = snapLattice(type, 0, 0, 0), c = Math.cos(yaw), s = Math.sin(yaw);
      return { base: null, frame: { x: x - (g[0] * c + g[1] * s), z: z - (-g[0] * s + g[1] * c), yaw, y: 0 }, lx: g[0], lz: g[1], r: 0, level: 0, ly: 0, snapped: null, stackOn: null };
    }
    const l = toLocal(base, x, z), T = net.topology(base.id);
    const pose = { base, frame: base, lx: 0, lz: 0, r: r0, level: 0, ly: 0, snapped: null, stackOn: null };
    // stacking: the cursor is on a module whose stack port takes this one
    const [ccx, ccz] = cellOfPoint(l.x, l.z);
    for (let lv = RULES.maxStack - 1; lv >= 0; lv--) {
      const under = net.modules.get(T.cells.get(cellKey(ccx, ccz, lv)));
      if (!under) continue;
      const up = KIT[under.type].ports.find((p) => p.up);
      if (up && up.accepts && up.accepts.includes(type) && !T.cells.has(cellKey(ccx, ccz, lv + 1))) { pose.lx = under.lx; pose.lz = under.lz; pose.level = lv + 1; pose.ly = (under.ly || 0) + up.y; pose.stackOn = under; return pose; }
      break;
    }
    [pose.lx, pose.lz] = snapLattice(type, r0, l.x, l.z);
    // port snapping
    const mine = K.ports.filter((p) => p.type === "pressurized");
    if (mine.length && o.snap !== false) {
      let best = null, bd = RULES.snapRange;
      for (const p of net.openPorts(base.id)) {
        if (p.type !== "pressurized" || p.up) continue;
        const d = Math.hypot(p.x - l.x, p.z - l.z), side = (l.x - p.x) * p.dx + (l.z - p.z) * p.dz;
        if (d < bd && side > -0.6) { bd = d; best = p; }
      }
      if (best) {
        const cands = [];
        for (const gp of mine) {
          for (let r = 0; r < 4; r++) {
            const [dx, dz] = rot(r, gp.dx, gp.dz);
            if (dx !== -best.dx || dz !== -best.dz) continue;
            const [px, pz] = rot(r, gp.x, gp.z), lx = best.x - px, lz = best.z - pz, ly = best.y - gp.y, level = Math.round(ly / 3.4);
            if (cellsOf(type, lx, lz, r).some(([cx, cz]) => T.cells.has(cellKey(cx, cz, level)))) continue;
            cands.push({ gp, r, lx, lz, ly, level });
          }
        }
        if (cands.length) {
          cands.sort((a, b) => (a.r === r0 ? 0 : 1) - (b.r === r0 ? 0 : 1));
          const c = cands[(o.cycle ?? this.portCycle) % cands.length];
          pose.lx = c.lx; pose.lz = c.lz; pose.r = c.r; pose.ly = c.ly; pose.level = c.level;
          pose.snapped = { tp: best, gp: c.gp, n: cands.length };
        }
      }
    }
    return pose;
  }

  /**
   * THE PLACEMENT RULES. Returns
   *   { state: "ok" | "warn" | "bad", reason, joints: [{to, port, toPort, type, x, y, z, dx, dz}], slope, leg, cut, y, cost }
   * "bad" cannot be placed and `reason` says why in one line; "warn" can, and says what to expect.
   * o.free skips the reach limit (tests, missions).
   */
  evaluate(type, pose, o = {}) {
    const g = this.game, S = g.surface, sys = this.sys, net = sys.net, B = MODULES[type], frame = pose.frame;
    const res = { state: "ok", reason: "", joints: [], slope: 0, leg: 0, cut: 0, y: pose.base ? pose.base.y : 0, cost: B.cost, type };
    const bad = (r) => { res.state = "bad"; res.reason = r; return res; };
    const [hx, hz] = halfExtent(type, pose.r), w = toWorld(frame, pose.lx, pose.lz), v = g.vehicle, l = {};
    res.x = w.x; res.z = w.z;
    const gapTo = (px, pz) => { toLocal(frame, px, pz, l); return Math.hypot(Math.max(0, Math.abs(l.x - pose.lx) - hx), Math.max(0, Math.abs(l.z - pose.lz) - hz)); };
    if (!g.site.inside(w.x, w.z, 60 + Math.hypot(hx, hz))) return bad("outside the mapped site");
    const away = Math.hypot(w.x - v.p.x, w.z - v.p.z);
    if (!o.free && away > RULES.reach) return bad(`out of reach: ${Math.round(away)} m from the rover, max ${RULES.reach}`);
    const cells = cellsOf(type, pose.lx, pose.lz, pose.r), ghost = { type, lx: pose.lx, lz: pose.lz, r: pose.r, ly: pose.ly, level: pose.level };
    const has = (c) => cells.some((k) => k[0] === c[0] && k[1] === c[1]);
    if (pose.base) {
      const T = net.topology(pose.base.id);
      for (const [cx, cz] of cells) { const id = T.cells.get(cellKey(cx, cz, pose.level)); if (id) return bad(`overlaps the ${MODULES[net.modules.get(id).type].name.toLowerCase()}`); }
      if (pose.level > 0) {
        if (pose.level > RULES.maxStack) return bad(`too high: ${RULES.maxStack} storeys above the ground at most`);
        const under = net.modules.get(T.cells.get(cellKey(cells[0][0], cells[0][1], pose.level - 1))), up = under && KIT[under.type].ports.find((p) => p.up);
        if (!up || !(up.accepts || []).includes(type) || cells.length > 1) return bad("nothing here to stack it on");
      } else {
        for (const m of T.mods) if (!m.level) for (const kc of keepClearCells(m)) if (has(kc)) return bad(`blocks the ${MODULES[m.type].garage ? "door" : "outer door"} of the ${MODULES[m.type].name.toLowerCase()}`);
        for (const kc of keepClearCells(ghost)) { const id = T.cells.get(cellKey(kc[0], kc[1], 0)); if (id) return bad(`its ${B.garage ? "door" : "outer door"} would open onto the ${MODULES[net.modules.get(id).type].name.toLowerCase()}`); }
      }
    } else if (pose.level > 0) return bad("nothing here to stack it on");
    const rad = Math.hypot(hx, hz);
    for (const m of net.modules.values()) {
      if (pose.base && m.base === pose.base.id) continue;
      const wm = sys.worldOf(m);
      if (Math.hypot(wm.x - w.x, wm.z - w.z) < rad + radiusOf(m.type) + 1) return bad(`too close to ${net.bases.get(m.base).name} base (its grid is not this one's)`);
    }
    if (!pose.level) {
      if (gapTo(v.p.x, v.p.z) < RULES.roverClear) return bad("the rover is in the way");
      for (const p of g.site.pois) if (gapTo(p.x, p.z) < RULES.poiClear) return bad(`too close to ${p.name}`);
      const st = groundStats(S, frame, pose.lx, pose.lz, hx, hz), maxSlope = B.maxSlope ?? RULES.maxSlopeDeg, maxLeg = B.maxLeg ?? RULES.maxLeg;
      res.slope = st.slope;
      if (st.slope > maxSlope) return bad(`too steep: ${Math.ceil(st.slope - 0.05)} degrees, max ${maxSlope}`);
      if (st.rough > RULES.maxRough) return bad(`too rough: ${st.rough.toFixed(1)} m of relief, max ${RULES.maxRough}`);
      if (!pose.base) res.y = st.max;
      res.leg = res.y - st.min; res.cut = st.max - res.y;
      if (res.cut > RULES.maxCut) return bad(`ground is ${res.cut.toFixed(1)} m above the base floor, max ${RULES.maxCut}`);
      if (res.leg > maxLeg) return bad(`ground falls ${res.leg.toFixed(1)} m below the base level: legs reach ${maxLeg}`);
      // generated rocks big enough to matter
      if (g.rocks && S.detailOn) {
        const R = rad + 2, c0 = Math.floor((w.x - R) / 2), c1 = Math.floor((w.x + R) / 2), d0 = Math.floor((w.z - R) / 2), d1 = Math.floor((w.z + R) / 2);
        for (let cj = d0; cj <= d1; cj++) for (let ci = c0; ci <= c1; ci++) {
          const rk = g.rocks.at(ci, cj);
          if (rk && rk.size >= RULES.rockSize && gapTo(rk.x, rk.z) < rk.size * 0.5) return bad(`a ${rk.size.toFixed(1)} m rock is in the way`);
        }
      }
    }
    if (!net.canAfford(type)) return bad(`not enough materials: ${B.cost} needed, ${Math.floor(net.materials)} in stock`);

    // what it will join
    let pressureJoint = false, anyNear = !pose.base;
    if (pose.base) {
      const T = net.topology(pose.base.id), open = net.openPorts(pose.base.id), dirW = { x: 0, z: 0, yaw: frame.yaw };
      for (const p of portsOf(ghost)) {
        if (p.up) continue;
        const q = open.find((t) => !t.up && Math.abs(t.x - p.x) < 0.01 && Math.abs(t.z - p.z) < 0.01 && Math.abs(t.y - p.y) < 0.01 && t.dx === -p.dx && t.dz === -p.dz && compatible(t.type, p.type));
        if (!q) continue;
        const pw = toWorld(frame, p.x, p.z), d = toWorld(dirW, p.dx, p.dz);
        res.joints.push({ to: q.module, port: p.name, toPort: q.name, type: p.type, x: pw.x, y: frame.y + p.y, z: pw.z, dx: d.x, dz: d.z });
        if (p.type === "pressurized") pressureJoint = true;
      }
      if (pose.stackOn) { const pw = toWorld(frame, pose.lx, pose.lz); res.joints.push({ to: pose.stackOn.id, port: "origin", toPort: "port_up", type: "stack", x: pw.x, y: frame.y + pose.ly, z: pw.z, dx: 0, dz: 1 }); if (B.pressurised) pressureJoint = true; }
      for (const m of T.mods) { const [mx, mz] = halfExtent(m.type, m.r); if (Math.hypot(Math.max(0, Math.abs(m.lx - pose.lx) - hx - mx), Math.max(0, Math.abs(m.lz - pose.lz) - hz - mz)) <= RULES.utilityRange) { anyNear = true; break; } }
      const hull = T.mods.some((m) => MODULES[m.type].pressurised);
      if (!res.joints.length && !anyNear) { res.state = "warn"; res.reason = `out of utility range (${RULES.utilityRange} m): it will have no power or fluids`; }
      else if (B.pressurised && hull && !pressureJoint && !B.ownAirlock) { res.state = "warn"; res.reason = "not joined to the pressure hull: no port meets a port"; }
    }
    if (res.state === "ok" && res.slope > RULES.warnSlopeDeg) { res.state = "warn"; res.reason = `slope of ${Math.round(res.slope)} degrees: legs extended ${res.leg.toFixed(1)} m`; }
    if (res.state === "ok") {
      const j = res.joints[0];
      res.reason = j ? (j.type === "stack" ? `stacks on the ${MODULES[net.modules.get(j.to).type].name.toLowerCase()}`
        : `joins the ${MODULES[net.modules.get(j.to).type].name.toLowerCase()}: ${j.type === "pressurized" ? "pressurised" : "utility"} port` + (res.joints.length > 1 ? ` (+${res.joints.length - 1} more)` : ""))
        : !pose.base ? "clear: founds a new base here" : "clear to build";
    }
    return res;
  }

  async placeAt(type, x, z, o = {}) {
    const pose = this.poseAt(type, x, z, o), res = this.evaluate(type, pose, Object.assign({ free: true }, o));
    if (res.state === "bad") return Object.assign({ ok: false, pose: this._poseInfo(pose) }, res);
    const m = await this._place(type, pose, res, o);
    return Object.assign({ ok: true, id: m.id, base: m.base, pose: this._poseInfo(pose) }, res);
  }
  /** Place at lattice coordinates of an existing base (missions, tests, scripted layouts). Goes through the same rules. o.force skips them. */
  async placeLattice(type, baseId, lx, lz, r = 0, o = {}) {
    const b = this.sys.net.bases.get(baseId);
    if (!b) return { ok: false, reason: "no such base" };
    const pose = { base: b, frame: b, lx, lz, r, level: o.level || 0, ly: o.ly || 0, snapped: null, stackOn: null };
    const res = this.evaluate(type, pose, Object.assign({ free: true }, o));
    if (res.state === "bad" && !o.force) return Object.assign({ ok: false }, res);
    const m = await this._place(type, pose, res, o);
    return Object.assign({ ok: true, id: m.id, forced: res.state === "bad" }, res);
  }
  _poseInfo(p) { return { base: p.base ? p.base.id : null, lx: p.lx, lz: p.lz, r: p.r, level: p.level, snapped: !!p.snapped }; }
  async _place(type, pose, res, o = {}) {
    const sys = this.sys, net = sys.net;
    if (!net.sandbox) net.materials -= MODULES[type].cost;
    const site = pose.base ? null : sys.siteQuality(res.x, res.z, res.slope);
    const m = await sys.addModule({ type, base: pose.base ? pose.base.id : null, frame: pose.frame, lx: pose.lx, lz: pose.lz, r: pose.r, level: pose.level, ly: pose.ly, site, instant: o.instant });
    this.undo.push(m.id);
    this._evalKey = "";
    if (this.game.mode === "build" || this.game.mode === "driving") {
      const B = MODULES[type], secs = B.build_h * 3600 / RULES.buildPace;
      const when = m.progress >= 1 ? "built" : m.queued || [...net.modules.values()].filter((x) => x.progress < 1).length > RULES.crews ? "queued: two crews are busy" : "assembling: about " + (secs >= 90 ? Math.round(secs / 60) + " min" : Math.round(secs) + " s");
      this.game.hud.toast(`${B.name} placed<small>${when}${pose.base ? "" : " \u00b7 a new base is founded here"}</small>`, 2.6);
    }
    return m;
  }
  /** Cross: place the ghost where it is. */
  async confirm() {
    if (!this.active || this._placing || !this.pose || !this.result) return { ok: false, reason: "not building" };
    this.update(0, true);
    const res = this.result, pose = this.pose;
    if (res.state === "bad") { this.ui.flash(res.reason); return { ok: false, reason: res.reason }; }
    this._placing = true;
    try { const m = await this._place(this.type, pose, res); this.update(0, true); return { ok: true, id: m.id }; }
    finally { this._placing = false; }
  }
  salvage(id) {
    const r = this.sys.salvage(id);
    if (r.ok) { this.game.hud.toast(`${MODULES[r.type].name} salvaged<small>${this.sys.net.sandbox ? "sandbox: nothing to refund" : "+" + r.refund + " materials"}</small>`, 2.5); this.undo = this.undo.filter((u) => u !== id); }
    else this.ui.flash(r.reason);
    this._evalKey = "";
    return r;
  }
  undoLast() {
    while (this.undo.length) {
      const id = this.undo.pop();
      if (this.sys.net.modules.has(id)) return this.salvage(id);
    }
    this.ui.flash("nothing to undo");
    return { ok: false, reason: "nothing to undo" };
  }

  /* ── controls ─────────────────────────────────────────────────────────── */

  _wire() {
    const g = this.game, P = pad(), on = () => this.active && g.mode === "build" && !g.helpOpen;
    if (P) {
      P.on("cross", () => { if (on()) this.confirm(); });
      P.on("l1", () => { if (on()) this.rotate(-1); });
      P.on("r1", () => { if (on()) this.rotate(1); });
      P.on("left", () => { if (on()) this.nav(0, -1); });
      P.on("right", () => { if (on()) this.nav(0, 1); });
      P.on("up", () => { if (on()) this.nav(-1, 0); });
      P.on("down", () => { if (on()) this.nav(1, 0); });
      P.on("l3", () => { if (on()) this.undoLast(); });
      P.on("r3", () => { if (on()) this.toggleWarp(); });
      // (the game's own Options handler runs first and may just have resumed INTO build mode: that press is spent)
      g.on("padresume", () => { this._resumed = true; });
      P.on("options", () => { if (this._resumed) { this._resumed = false; return; } if (on()) { g.pause(true); g.emit("padmenu"); } });
      // Circle: leave build mode (the module calls this only when nothing of its own is open)
      P.onBack(() => { if (on()) { this.exit(); return true; } return false; });
    }
    window.addEventListener("keydown", (e) => {
      if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!this.active || g.mode !== "build") {
        if (e.code === "KeyB" && !e.repeat && g.mode === "driving") { this.enter(); e.preventDefault(); }
        return;
      }
      if (g.helpOpen) return;
      let used = true;
      switch (e.code) {
        case "KeyQ": if (!e.repeat) this.rotate(-1); break;
        case "KeyE": case "KeyR": if (!e.repeat) this.rotate(1); break;
        case "Enter": case "Space": if (!e.repeat) this.confirm(); break;
        case "Escape": case "KeyB": if (!e.repeat) this.exit(); break;
        case "Tab": this.nav(e.shiftKey ? -1 : 1, 0); break;
        case "BracketLeft": case "Comma": this.nav(0, -1); break;
        case "BracketRight": case "Period": this.nav(0, 1); break;
        case "KeyZ": if (!e.repeat) this.undoLast(); break;
        case "KeyT": if (!e.repeat) this.toggleWarp(); break;
        default:
          if (/^Digit[1-7]$/.test(e.code)) { this.cat = +e.code.slice(5) - 1; this.nav(0, 0); } else used = false;
      }
      if (used) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    }, true);
    const c = g.canvas;
    c.addEventListener("pointermove", (e) => {
      if (!this.active || e.pointerType === "touch") return;
      const m = this.mouse, dx = e.clientX - m.x, dy = e.clientY - m.y;
      if (m.orbit) { this.cam.yaw -= dx * 0.006; this.cam.pitch = clamp(this.cam.pitch + dy * 0.005, 0.25, 1.45); }
      else if (m.pan) { const k = this.cam.dist * 0.0022; this._pan(-dx * k, dy * k); }
      else if (Math.abs(dx) + Math.abs(dy) > 0) this.cursorMode = "mouse";
      m.x = e.clientX; m.y = e.clientY; m.inside = true;
    });
    c.addEventListener("pointerdown", (e) => {
      if (!this.active || e.pointerType === "touch") return;
      const m = this.mouse; m.x = e.clientX; m.y = e.clientY;
      if (e.button === 2) m.orbit = true; else if (e.button === 1) { m.pan = true; e.preventDefault(); } else if (e.button === 0) m.downAt = { x: e.clientX, y: e.clientY };
    });
    const up = (e) => {
      const m = this.mouse;
      if (e.button === 2) m.orbit = false; else if (e.button === 1) m.pan = false;
      else if (e.button === 0 && m.downAt) {
        const moved = Math.hypot(e.clientX - m.downAt.x, e.clientY - m.downAt.y); m.downAt = null;
        if (this.active && this.game.mode === "build" && moved < 6) { this.cursorMode = "mouse"; this.update(0, true); this.confirm(); }
      }
    };
    c.addEventListener("pointerup", up); c.addEventListener("pointercancel", () => { this.mouse.orbit = false; this.mouse.pan = false; this.mouse.downAt = null; });
    c.addEventListener("wheel", (e) => { if (this.active && this.game.mode === "build") this.cam.dist = clamp(this.cam.dist * (e.deltaY > 0 ? 1.12 : 0.89), 10, 190); }, { passive: true });
  }
  toggleWarp() {
    const g = this.game;
    g.warp = !g.warp;
    g.state.clock.scale = g.warp ? 600 : RULES.buildClockScale;
    g.hud.toast(g.warp ? "Time warp ×600<small>construction and the Sun run fast</small>" : `Time warp off<small>build mode runs at ×${RULES.buildClockScale}</small>`, 2.5);
  }
  _pan(right, fwd) {
    const c = this.cam, sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), v = this.game.vehicle;
    c.x += cy * right - sy * fwd; c.z += -sy * right - cy * fwd;
    const dx = c.x - v.p.x, dz = c.z - v.p.z, d = Math.hypot(dx, dz), max = RULES.reach + 30;
    if (d > max) { c.x = v.p.x + dx / d * max; c.z = v.p.z + dz / d * max; }
    const s = this.game.site, m = 80;
    c.x = clamp(c.x, -s.halfX + m, s.halfX - m); c.z = clamp(c.z, -s.halfZ + m, s.halfZ - m);
  }

  /** Where the mouse ray meets the ground. */
  _pick(out) {
    const g = this.game, cam = g.camera, m = this.mouse;
    _v.set(m.x / window.innerWidth * 2 - 1, -(m.y / window.innerHeight) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize();
    if (_v.y > -0.02) return false;
    let t0 = 0, t = 0;
    const S = g.surface, o = cam.position;
    for (let i = 0; i < 160; i++) {
      t0 = t; t += Math.max(0.6, t * 0.035);
      if (o.y + _v.y * t <= S.height(o.x + _v.x * t, o.z + _v.z * t)) {
        for (let k = 0; k < 7; k++) { const mid = (t0 + t) / 2; if (o.y + _v.y * mid <= S.height(o.x + _v.x * mid, o.z + _v.z * mid)) t = mid; else t0 = mid; }
        out.x = o.x + _v.x * t; out.z = o.z + _v.z * t;
        return true;
      }
      if (t > 900) break;
    }
    return false;
  }

  /* ── every frame ──────────────────────────────────────────────────────── */

  tick(game, dt) {
    // enter from the drive: hold Cross (a tap is still "interact"). The prompt says so when the rover is parked on buildable ground.
    const P = pad(), hud = game.hud;
    if (game.mode !== "driving" || this.active) {
      this._crossT = 0;
      if (this._prompt) { this._prompt = null; if (hud.prompt) hud.prompt("build", null); }
      if (hud.ui) hud.ui.gate("build.enter", false);
      return;
    }
    if (P && P.connected && P.pressed("cross")) { this._crossT += dt; if (this._crossT > 0.6) { this._crossT = -1e9; this.enter(); return; } } else this._crossT = 0;
    const v = game.vehicle;
    this._stillT = Math.abs(v.t.speed) < 0.3 && !v.t.tipped ? this._stillT + dt : 0;
    this._promptT += dt;
    if (this._promptT < 0.5) return;
    this._promptT = 0;
    // a prompt, not an alert: only while build mode is actually available, and once it has been used twice only for a few seconds (uiman.js)
    let text = null;
    if (this._stillT > 1.5) {
      const near = this.sys.baseNear(v.p.x, v.p.z, 80), flat = game.surface.slopeDeg(v.p.x, v.p.z, 6) <= RULES.maxSlopeDeg - 2;
      const key = P && game.input.padConnected && game.input.lastDevice === "pad" ? "Hold " + P.glyph("cross") : "<kbd>B</kbd>";
      if (near) text = `${key} Build mode: ${near.name} base`; else if (flat) text = `${key} Level ground: build here`;
    }
    // HOOK (story): not while the campaign is still in the prologue (strapped into the lander, nothing to build with yet)
    const story = getSystem("story"), sst = story && story.api && story.api.state && story.api.state();
    if (sst && sst.campaign && sst.act === "prologue") text = null;
    if (hud.ui && !hud.ui.gate("build.enter", !!text)) text = null;
    if (text !== this._prompt) { this._prompt = text; if (hud.prompt) hud.prompt("build", text); else if (hud.setAlert) hud.setAlert("build", text, "info"); }
  }

  frame(game, dt) {
    if (this.ui) this.ui.frame(dt);
    if (!this.active || game.mode !== "build") return;
    this.update(dt, false);
  }

  update(dt, force) {
    const g = this.game, S = g.surface, cam = this.cam, P = pad(), k = g.input.keys;
    if (dt > 0 && !g.helpOpen) {
      let mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0), mz = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0), ox = 0, oy = 0, zoom = 0;
      if (P && P.connected) { const a = P.axes(); mx += a.lx; mz -= a.ly; ox = a.rx; oy = a.ry; zoom = a.l2 - a.r2; if (Math.abs(a.lx) + Math.abs(a.ly) > 0.15) this.cursorMode = "pad"; }
      if (k.KeyW || k.KeyA || k.KeyS || k.KeyD) { if (!this.mouse.inside) this.cursorMode = "pad"; }
      zoom += (k.Minus || k.PageDown ? 1 : 0) - (k.Equal || k.PageUp ? 1 : 0);
      if (mx || mz) this._pan(mx * cam.dist * 0.85 * dt, mz * cam.dist * 0.85 * dt);
      cam.yaw -= ox * 1.9 * dt;
      cam.pitch = clamp(cam.pitch + oy * 1.2 * dt * (g.settings.invertY ? -1 : 1), 0.25, 1.45);
      cam.dist = clamp(cam.dist * Math.exp(zoom * 1.3 * dt), 10, 190);
      // hold to salvage
      const holding = (P && P.connected && P.pressed("square")) || k.KeyX || k.Delete || k.Backspace;
      if (holding && this.hover && this.hold.t >= 0) {
        if (this.hold.id !== this.hover.id) { this.hold.id = this.hover.id; this.hold.t = 0; }
        this.hold.t += dt;
        if (this.hold.t >= 0.7) { this.salvage(this.hover.id); this.hold.t = -1; this.hover = null; }
      } else if (!holding) this.hold.t = 0;
    }
    // the camera
    const gy = S.height(cam.x, cam.z);
    cam.y = dt > 0 ? cam.y + (gy - cam.y) * Math.min(1, dt * 6) : gy;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), c3 = g.camera;
    c3.position.set(cam.x + Math.sin(cam.yaw) * cp * cam.dist, cam.y + sp * cam.dist, cam.z + Math.cos(cam.yaw) * cp * cam.dist);
    const floor = S.height(c3.position.x, c3.position.z) + 1.5;
    if (c3.position.y < floor) c3.position.y = floor;
    c3.up.set(0, 1, 0); c3.lookAt(cam.x, cam.y + 1, cam.z); c3.updateMatrixWorld(true);
    this._focus.x = cam.x; this._focus.z = cam.z; g.focus = this._focus;       // the streaming focus follows the build camera
    // the cursor
    if (this.cursorMode === "mouse" && this.mouse.inside) this._pick(this.cursor); else { this.cursor.x = cam.x; this.cursor.z = cam.z; }

    const type = this.type, sys = this.sys;
    if (!KIT[type]) return;
    this.hover = sys.moduleAt(this.cursor.x, this.cursor.z);
    const pose = this.poseAt(type, this.cursor.x, this.cursor.z);
    const key = [type, pose.base ? pose.base.id : this.cursor.x.toFixed(1) + "," + this.cursor.z.toFixed(1), pose.lx, pose.lz, pose.r, pose.level, pose.frame.yaw.toFixed(3), sys.net.modules.size, Math.floor(sys.net.materials / 5), sys.net.sandbox].join("|");
    this._evalT += dt;
    if (force || key !== this._evalKey || this._evalT > 0.4) {
      this._evalKey = key; this._evalT = 0;
      this.pose = pose;
      this.result = this.evaluate(type, pose);
      const r = this.result, [hx, hz] = halfExtent(type, pose.r), w = toWorld(pose.frame, pose.lx, pose.lz);
      const y = (pose.base ? pose.base.y : r.y || S.height(w.x, w.z)) + pose.ly;
      this.ghost.setType(type);
      this.ghost.setState(r.state);
      this.ghost.pose(w.x, y, w.z, pose.frame.yaw + pose.r * Math.PI / 2, pose.r & 1 ? hz : hx, pose.r & 1 ? hx : hz, KIT[type].height);
      this.ghost.joints(r.state === "bad" ? [] : r.joints);
      this.ghost.group.visible = true;
      const [ccx, ccz] = cellOfPoint(pose.lx, pose.lz);
      this.grid.update(S, pose.frame, ccx, ccz);
      this.ui.status(r, pose, this.hover);
    }
    const batch = this.hover && sys.batches.get(this.hover.base);
    this.outline.show(batch && (this.result && this.result.state === "bad" || this.hold.t > 0) ? this.hover : null, batch ? batch.group.matrixWorld : _m, this.hold.t > 0 ? 0xff5148 : 0xffb347);
    this.ui.holdProgress(this.hold.t > 0 ? this.hold.t / 0.7 : 0);
  }
}

/* ── entity types: one per module in the balance table ──────────────────── */

for (const id of MODULE_IDS) {
  registerType(id, {
    kind: "base", persist: true, footprint: 2.83, maxSlope: RULES.maxSlopeDeg,
    create: async () => { const g = new THREE.Group(); g.userData.module = id; return g; },
    seat: (e) => { if (hub.base && hub.base.ready) hub.base.seatEntity(e); },
    onAdd: (e) => { if (hub.base && hub.base.ready && !hub.base.net.modules.has(e.def.id)) hub.base.adopt(e); },
    canPlace: (type, x, z) => {
      const b = getSystem("builder");
      if (!b || !b.game) return { ok: false, reason: "the builder is not running" };
      const r = b.evaluate(type, b.poseAt(type, x, z), { free: true });
      return { ok: r.state !== "bad", slope: r.slope, flatness: r.leg, reason: r.reason, state: r.state };
    },
  });
}

const baseSystem = registerSystem(new BaseSystem());
const builderSystem = registerSystem(new Builder());
export { baseSystem, builderSystem, BUILD_HELP, GRID };
