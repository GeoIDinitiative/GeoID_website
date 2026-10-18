/**
 * The settlement: the kit's lattice, the resource networks, and the numbers.
 *
 * PURE LOGIC. Nothing here touches three.js or the DOM, so the lint imports it
 * under node and the whole simulation can be stepped without a frame
 * (`net.step(simSeconds, env)`). The picture is basekit.js, placement and the
 * build mode are builder.js, the panels are buildui.js.
 *
 * THE LATTICE. A base is a rigid, level frame {x, z, yaw, y}: its origin and
 * heading are those of its first module, so bases can face any way. Inside it
 * everything sits on the kit's 4 m grid. A module is
 *     { id, type, base, lx, lz, r, level, ly, progress, st }
 * lx / lz are base-local metres of the model's origin (multiples of 2: a 2 x 1
 * module's origin is on a cell boundary), r is quarter turns about Y, level /
 * ly are the storey and its height for stacked modules. Cell c covers
 * [4c - 2, 4c + 2], so a 1 x 1 module at (0, 0) owns cell (0, 0).
 *
 * PORTS, as catalog.json states them: B's port frame is A's rotated 180
 * degrees about the port's Y, i.e. the two port positions coincide and their
 * directions are opposite. On a shared lattice that is exact integer
 * arithmetic. A JOINT exists wherever that holds between two compatible
 * ports: pressurised with pressurised (air and crew), utility with utility
 * (power and fluids only). A pressurised port never joins a utility port.
 * `stack` ports carry the upper module's origin.
 *
 * NETWORKS (built modules only).
 *   pressure volume  modules joined through pressurised ports or stacked habitats
 *   utility network  any joint, or footprints within RULES.utilityRange metres
 * Power is balanced per utility network, batteries hold their own charge.
 * Oxygen, water and food are held by the base and reach only its main
 * network; a module outside it is "cut off".
 *
 * ALL BALANCE NUMBERS ARE IN ONE TABLE, `MODULES`, below. The catalogue's
 * `gameplay` block was the starting point; every change from it is commented
 * there.
 */

export const GRID = 4;
export const SOL_S = 88775.244;
const SOL_H = SOL_S / 3600;

export const RULES = {
  maxSlopeDeg: 10,        // ground slope under a footprint: beyond this the ghost is red
  warnSlopeDeg: 6,        // amber above this
  maxLeg: 1.6,            // metres a module's legs / skirt can reach down to the ground
  maxCut: 0.3,            // metres the ground may rise above the floor datum (the kit's feet are 0.5 m tall)
  maxRough: 0.7,          // metres of relief left after the best plane is taken out
  rockSize: 0.9,          // a generated rock this big or bigger blocks a footprint
  utilityRange: 12,       // metres between footprint edges that still carry power and fluids
  joinRange: 36,          // a module placed within this of a base belongs to it; beyond, it founds a new one
  snapRange: 4.6,         // cursor to an open pressurised port
  reach: 320,             // metres the build cursor may stray from the rover
  roverClear: 3.4,        // radius kept clear around the rover
  poiClear: 8,
  crews: 2,               // modules under construction at once (per game, not per base)
  buildPace: 60,          // construction never runs slower than this many simulated seconds per real second
                          // (60: a corridor in 9 s, a large habitat in 75 s, the HDU in 2.5 min of play)
  salvageRefund: 0.75,    // of the cost; 1.0 while still under construction
  startMaterials: 500,    // the lander's stock
  materialsCap: 500,      // held without any storage module
  lander: { o2: 60, water: 150, food: 40 },   // consumables a new base is founded with (and can always hold)
  buildClockScale: 10,    // simulated seconds per real second in build mode (driving runs at 30)
  industryAbove: 0.9,     // industrial loads wait until storage is this full
  comfortBelow: 0.15,     // comfort loads are shed below this when the Sun does not cover them
  dustPerSol: 0.015,      // fraction of array output lost per sol at tau 0.55 (game value; reality is about 0.002)
  maxStack: 2,            // storeys above the ground
};

export const CATEGORIES = [
  { id: "habitat", name: "Habitat" }, { id: "connect", name: "Connect" }, { id: "power", name: "Power" },
  { id: "life", name: "Life support" }, { id: "storage", name: "Storage" }, { id: "vehicles", name: "Vehicles" },
  { id: "utility", name: "Utility" },
];

/**
 * THE BALANCE TABLE. power_w < 0 is a load. Rates are per sol. tier: 1 life
 * support (never shed, runs on its own reserve when the bus fails), 2 comfort
 * (shed when storage is nearly empty), 3 industry (runs on surplus only).
 *
 * Changed from catalog.json `gameplay`, and why:
 *  - Loads are cut to roughly half (hab_small 1200 -> 600 W, hab_large 3000 ->
 *    1500, hub 300 -> 100, corridor 50 -> 20, airlock 400 -> 150, greenhouse
 *    2500 -> 1200) and the ISRU plant from 25 kW to 4 kW with its output scaled
 *    to match (24 -> 4 kg O2 per sol), so that a solar array, which is left at
 *    the catalogue's derived 1.1 kW peak, is a meaningful fraction of a base.
 *  - The battery bank holds 20 kWh, not 200: with 200 one bank carries a
 *    starter base for a week and the night stops mattering.
 *  - Water is net of recycling (hab_small 30 -> 6 L per sol, hab_large 90 -> 18,
 *    greenhouse 120 -> 12) and the ISRU plant gives 20 L, not 15: otherwise no
 *    base can ever be self-sufficient in water.
 *  - Food did not exist as a demand: 1 kg per crew place per sol, so the
 *    greenhouse's 3 kg feeds three.
 *  - hab_hdu had no life-support draw: given a crew of four's.
 *  - New: cost (materials), build_h, own reserve, storage capacities (habitats
 *    carry small internal stores; `storage` x 10 = materials held), ISRU
 *    materials, the garage's 10 kW charger as an industrial load.
 */
export const MODULES = {
  hab_small:         { cat: "habitat", name: "Small habitat", cost: 80, build_h: 0.5, power_w: -600, tier: 1, o2: -1.68, water: -6, food: -2, crew: 2, pressurised: true, reserve_h: 3, air_kg: 3, cap: { o2: 30, water: 200, food: 40, mat: 100 }, lit: true },
  hab_large:         { cat: "habitat", name: "Large habitat", cost: 200, build_h: 1.25, power_w: -1500, tier: 1, o2: -5.04, water: -18, food: -6, crew: 6, pressurised: true, reserve_h: 3, air_kg: 8, cap: { o2: 90, water: 600, food: 120, mat: 300 }, lit: true },
  hab_hdu:           { cat: "habitat", name: "HDU reference habitat", cost: 320, build_h: 2.5, power_w: -1500, tier: 1, o2: -3.36, water: -12, food: -4, crew: 4, pressurised: true, reserve_h: 3, air_kg: 6, cap: { o2: 60, water: 400, food: 80, mat: 400 }, lit: true, ownAirlock: true },
  node_hub:          { cat: "connect", name: "Node hub", cost: 35, build_h: 0.25, power_w: -100, tier: 1, pressurised: true, reserve_h: 2, air_kg: 1, cap: { mat: 40 }, lit: true },
  corridor_straight: { cat: "connect", name: "Corridor", cost: 15, build_h: 0.15, power_w: -20, tier: 1, pressurised: true, reserve_h: 2, air_kg: 0.5 },
  corridor_corner:   { cat: "connect", name: "Corridor corner", cost: 15, build_h: 0.15, power_w: -20, tier: 1, pressurised: true, reserve_h: 2, air_kg: 0.5 },
  airlock:           { cat: "connect", name: "Airlock", cost: 40, build_h: 0.25, power_w: -150, tier: 1, o2: -0.1, pressurised: true, reserve_h: 4, air_kg: 0.5, cap: { mat: 20 }, airlock: true, lit: true, keepClear: [[0, 4]] },
  solar_array:       { cat: "power", name: "Solar array", cost: 30, build_h: 0.15, power_w: 0, tier: 0, solar: { area_m2: 11, efficiency: 0.232 } },
  battery_bank:      { cat: "power", name: "Battery bank", cost: 60, build_h: 0.25, power_w: 0, tier: 0, battery_wh: 20000, max_w: 20000 },
  greenhouse:        { cat: "life", name: "Greenhouse", cost: 120, build_h: 1, power_w: -1200, tier: 2, o2: 2.4, water: -12, food: 3, pressurised: true, air_kg: 3, lit: true },
  isru_plant:        { cat: "life", name: "ISRU plant", cost: 110, build_h: 1.25, power_w: -4000, tier: 3, o2: 4, water: 20, materials: 40 },
  water_tank:        { cat: "storage", name: "Water tank", cost: 50, build_h: 0.4, power_w: -150, tier: 2, cap: { water: 12000 } },
  oxygen_tank:       { cat: "storage", name: "Oxygen tank", cost: 60, build_h: 0.4, power_w: -300, tier: 2, cap: { o2: 9000 } },
  storage_crate:     { cat: "storage", name: "Storage container", cost: 20, build_h: 0.1, power_w: 0, tier: 0, cap: { food: 480, mat: 1200 } },
  garage:            { cat: "vehicles", name: "Rover garage", cost: 140, build_h: 1.25, power_w: -800, tier: 2, charge_w: 10000, cap: { mat: 200 }, lit: true, maxSlope: 6, maxLeg: 0.7, keepClear: [[-2, 6], [2, 6]], garage: true },
  landing_pad:       { cat: "vehicles", name: "Landing pad", cost: 100, build_h: 1, power_w: -200, tier: 2, lit: true, maxSlope: 5, maxLeg: 0.7, solid: false },
  comms_tower:       { cat: "utility", name: "Comms tower", cost: 70, build_h: 0.5, power_w: -500, tier: 2 },
  light_mast:        { cat: "utility", name: "Light mast", cost: 12, build_h: 0.1, power_w: -150, tier: 2, nightOnly: true, lit: true, mast: true },
  regolith_berm:     { cat: "utility", name: "Regolith berm", cost: 10, build_h: 0.15, power_w: 0, tier: 0, shield: 1 },
};
export const MODULE_IDS = Object.keys(MODULES);

/* ── the campaign's supply chain: a module's `plan` ─────────────────────────
 *   "draft"      a blueprint laid out in build mode (no materials, no picture but the blueprint)
 *   "ordered"    sent to HALO-1: its components are in the package's descent (m.pkg)
 *   "delivered"  the package is down: its components (m.crates of them) sit at the pod; m.got have reached the site
 *   "site"       every component is on the site: construction runs (with a crew, through `crewGate`)
 *   absent       free roam's direct building (and anything placed before this existed): construction runs
 * Construction never advances a module whose components are not on the site. */
export const PLAN_STATES = ["draft", "ordered", "delivered", "site"];
export const waitingForParts = (m) => !!m && (m.plan === "draft" || m.plan === "ordered" || m.plan === "delivered");
/** The order caretakers build in: power first, then life support, habitats, the connections, then the rest. */
export function buildPriority(type) {
  const B = MODULES[type] || {};
  if (B.solar || B.battery_wh) return 0;
  if (B.cat === "life" || type === "water_tank" || type === "oxygen_tank") return 1;
  if (B.cat === "habitat") return 2;
  if (B.cat === "connect") return 3;
  return 4;
}
/** Component crates a module arrives as (one caretaker trip each). */
export const cratesFor = (type) => Math.max(1, Math.ceil(((MODULES[type] || {}).cost || 40) / 70));
/**
 * What a plan of these module types brings down: components (crates), supplies for the stores, and how many
 * caretakers it calls for (one per three modules, at least one; the story decides who).
 */
export function planManifest(types) {
  const n = types.length, count = {};
  let crates = 0, crew = 0, hull = 0, cost = 0;
  for (const t of types) { count[t] = (count[t] || 0) + 1; crates += cratesFor(t); const B = MODULES[t] || {}; crew += B.crew || 0; if (B.pressurised) hull++; cost += B.cost || 0; }
  return {
    modules: n, count, crates, crewPlaces: crew, footprint: Math.round(cost / 2),
    caretakers: n ? Math.max(1, Math.ceil(n / 3)) : 0,
    supplies: n ? { food: 20 + 10 * crew, water: 100 + 40 * crew, o2: 20 + 6 * hull, spares: Math.ceil(n / 2) } : { food: 0, water: 0, o2: 0, spares: 0 },
  };
}

/** Geometry of each module from catalog.json (footprint, ports, bounds). Filled by defineKit(). */
export const KIT = {};
export function defineKit(items) {
  for (const e of items || []) {
    const B = MODULES[e.id];
    if (!B) continue;
    KIT[e.id] = {
      id: e.id, name: B.name || e.name, description: e.description || "", fp: e.footprint || [1, 1], aabb: e.aabb, height: e.bounds ? e.bounds[2] : 3,
      ports: (e.ports || []).map((p) => ({
        name: p.node, type: p.type, x: p.position[0], y: p.position[1], z: p.position[2],
        dx: Math.round(p.direction[0]), dz: Math.round(p.direction[2]), up: p.direction[1] > 0.5, accepts: p.accepts || null,
      })),
      hatches: e.hatches || [], tilt: e.tilt || null, doors: e.doors || [],
    };
  }
  return KIT;
}
export const kitReady = () => Object.keys(KIT).length > 0;

/* ── lattice arithmetic ─────────────────────────────────────────────────── */

/** Rotate (x, z) by r quarter turns about +Y, the way three's rotation.y = r * 90 degrees does. */
export function rot(r, x, z) {
  switch (((r % 4) + 4) % 4) { case 0: return [x, z]; case 1: return [z, -x]; case 2: return [-x, -z]; default: return [-z, x]; }
}
export function halfExtent(type, r) {
  const fp = KIT[type] ? KIT[type].fp : [1, 1];
  return r & 1 ? [fp[1] * 2, fp[0] * 2] : [fp[0] * 2, fp[1] * 2];
}
/** The lattice position nearest (x, z) at which this module's cells line up with the grid. */
export function snapLattice(type, r, x, z) {
  const [hx, hz] = halfExtent(type, r);
  return [Math.round((x - hx + 2) / GRID) * GRID + hx - 2, Math.round((z - hz + 2) / GRID) * GRID + hz - 2];
}
export function cellsOf(type, lx, lz, r) {
  const [hx, hz] = halfExtent(type, r), out = [];
  const c0 = Math.round((lx - hx + 2) / GRID), c1 = Math.round((lz - hz + 2) / GRID);
  for (let j = 0; j < hz / 2; j++) for (let i = 0; i < hx / 2; i++) out.push([c0 + i, c1 + j]);
  return out;
}
export const cellKey = (cx, cz, level = 0) => cx + "," + cz + "," + level;
export const cellOfPoint = (x, z) => [Math.round(x / GRID), Math.round(z / GRID)];
/** Ports of a module in its base's frame. */
export function portsOf(m) {
  const K = KIT[m.type];
  if (!K) return [];
  return K.ports.map((p) => {
    const [x, z] = rot(m.r, p.x, p.z), [dx, dz] = rot(m.r, p.dx, p.dz);
    return { name: p.name, type: p.type, x: m.lx + x, y: (m.ly || 0) + p.y, z: m.lz + z, dx, dz, up: p.up, accepts: p.accepts };
  });
}
const portKey = (p) => Math.round(p.x * 100) + "," + Math.round(p.y * 100) + "," + Math.round(p.z * 100);
export const compatible = (a, b) => a === b && (a === "pressurized" || a === "utility");
/** Cells a module needs left empty in front of it (airlock porch, garage door), in the base frame. */
export function keepClearCells(m) {
  const B = MODULES[m.type];
  return (B && B.keepClear ? B.keepClear : []).map(([x, z]) => { const [rx, rz] = rot(m.r, x, z); return cellOfPoint(m.lx + rx, m.lz + rz); });
}
/** Base-local <-> world. yaw is three's rotation.y of the frame. */
export function toWorld(base, lx, lz, out = {}) {
  const c = Math.cos(base.yaw), s = Math.sin(base.yaw);
  out.x = base.x + lx * c + lz * s; out.z = base.z - lx * s + lz * c;
  return out;
}
export function toLocal(base, x, z, out = {}) {
  const c = Math.cos(base.yaw), s = Math.sin(base.yaw), dx = x - base.x, dz = z - base.z;
  out.x = dx * c - dz * s; out.z = dx * s + dz * c;
  return out;
}
/** Gap between two modules' footprints in the base frame, metres. */
export function footprintGap(a, b) {
  const [ax, az] = halfExtent(a.type, a.r), [bx, bz] = halfExtent(b.type, b.r);
  return Math.hypot(Math.max(0, Math.abs(a.lx - b.lx) - ax - bx), Math.max(0, Math.abs(a.lz - b.lz) - az - bz));
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const isBuilt = (m) => m.progress >= 1;
const newState = () => ({ dust: 0, reserve: 0, wh: 0, air: 0, on: false, pf: 0, gen: 0, breached: false });

/* ── the settlement ─────────────────────────────────────────────────────── */

export class BaseNet {
  constructor() {
    this.modules = new Map();
    this.bases = new Map();
    this.materials = RULES.startMaterials;
    this.sandbox = false;
    this.seq = 0;
    this.listeners = {};
    this._topo = new Map();
    this.dock = null;             // { moduleId, want_W } set by the rover each step; delivered_W comes back
    this.dockDelivered_W = 0;
    this.materialsRate = 0;
    this.crewGate = null;         // (module) -> rate multiplier, 0 = nobody at it: the campaign's caretakers (caretakers.js); null in free roam
    this.onHand = {};             // components on hand by module type (the lander's salvage): a blueprint of one is a site at once
  }
  on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); return () => { const l = this.listeners[name], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; }
  emit(name, detail) { for (const f of (this.listeners[name] || []).slice()) { try { f(detail); } catch (e) { console.error("[base] listener", name, e); } } }

  /* structure */
  addBase(b) {
    const base = Object.assign({ id: "base-" + (this.bases.size + 1) + "-" + Math.random().toString(36).slice(2, 6), name: "", x: 0, z: 0, yaw: 0, y: 0, o2: RULES.lander.o2, water: RULES.lander.water, food: RULES.lander.food, live: null }, b);
    base.crated = Object.assign({ o2: 0, water: 0, food: 0 }, b.crated || {});      // supplies landed but not yet in the stores (no room): they go in as room appears
    base.spares = b.spares || 0;
    if (!base.name) base.name = BASE_NAMES[this.bases.size % BASE_NAMES.length];
    this.bases.set(base.id, base);
    return base;
  }
  addModule(m) {
    const rec = Object.assign({ lx: 0, lz: 0, ly: 0, level: 0, r: 0, progress: 0 }, m);
    rec.seq = rec.seq || ++this.seq;
    this.seq = Math.max(this.seq, rec.seq);
    rec.st = Object.assign(newState(), m.st || {});
    this.modules.set(rec.id, rec);
    this._topo.delete(rec.base);
    return rec;
  }
  removeModule(id) {
    const m = this.modules.get(id);
    if (!m) return null;
    this.modules.delete(id);
    this._topo.delete(m.base);
    if (![...this.modules.values()].some((o) => o.base === m.base)) { this.bases.delete(m.base); this._topo.delete(m.base); }
    return m;
  }
  of(baseId) { const out = []; for (const m of this.modules.values()) if (m.base === baseId) out.push(m); return out; }
  occupancy(baseId) { return this.topology(baseId).cells; }
  cost(type) { return MODULES[type] ? MODULES[type].cost : 0; }
  canAfford(type) { return this.sandbox || this.materials >= this.cost(type); }
  materialsCap() {
    let cap = RULES.materialsCap;
    for (const m of this.modules.values()) if (isBuilt(m)) cap += (MODULES[m.type].cap || {}).mat || 0;
    return cap;
  }
  refund(m) { return Math.round(this.cost(m.type) * (isBuilt(m) ? RULES.salvageRefund : 1)); }

  /**
   * Joints, volumes and networks of one base. Cached until the base changes.
   *   cells     Map cellKey -> module id          (every module, built or not)
   *   joints    [{a, b, pa, pb, type}]            (every module)
   *   joined    Map module id -> Set of its port names that are mated
   *   links     [{a, b, kind}]                    kind: pressurized | utility | stack | range  (built only: what the networks are made of)
   *   volumes   [[ids]] pressure volumes ; volumeOf Map id -> index
   *   networks  [[ids]] utility networks ; networkOf Map id -> index ; main = index of the main one
   */
  topology(baseId) {
    let T = this._topo.get(baseId);
    if (T) return T;
    const mods = this.of(baseId).sort((a, b) => a.seq - b.seq);
    T = { cells: new Map(), joints: [], joined: new Map(), links: [], volumes: [], volumeOf: new Map(), networks: [], networkOf: new Map(), main: -1, mods };
    const byPort = new Map();
    for (const m of mods) {
      T.joined.set(m.id, new Set());
      for (const [cx, cz] of cellsOf(m.type, m.lx, m.lz, m.r)) T.cells.set(cellKey(cx, cz, m.level), m.id);
      for (const p of portsOf(m)) {
        if (p.up) continue;
        const k = portKey(p), other = byPort.get(k);
        if (other && other.p.dx === -p.dx && other.p.dz === -p.dz && compatible(other.p.type, p.type)) {
          T.joints.push({ a: other.m.id, b: m.id, pa: other.p.name, pb: p.name, type: p.type, x: p.x, y: p.y, z: p.z });
          T.joined.get(other.m.id).add(other.p.name); T.joined.get(m.id).add(p.name);
        } else if (!other) byPort.set(k, { m, p });
      }
    }
    // stacks: the module one storey up in the same cell
    for (const m of mods) {
      if (!m.level) continue;
      const [c] = cellsOf(m.type, m.lx, m.lz, m.r), below = this.modules.get(T.cells.get(cellKey(c[0], c[1], m.level - 1)));
      if (below) T.joints.push({ a: below.id, b: m.id, pa: "port_up", pb: "origin", type: "stack", x: m.lx, y: m.ly, z: m.lz });
    }
    const built = mods.filter(isBuilt), idx = new Map(built.map((m, i) => [m.id, i]));
    const find = (p, i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
    const vol = built.map((_, i) => i), net = built.map((_, i) => i);
    const union = (p, a, b) => { a = find(p, a); b = find(p, b); if (a === b) return false; p[b] = a; return true; };
    for (const j of T.joints) {
      const a = idx.get(j.a), b = idx.get(j.b);
      if (a === undefined || b === undefined) continue;
      const press = j.type === "pressurized" || (j.type === "stack" && MODULES[built[a].type].pressurised && MODULES[built[b].type].pressurised);
      if (press) union(vol, a, b);
      union(net, a, b);
      T.links.push({ a: j.a, b: j.b, kind: j.type });
    }
    for (let a = 0; a < built.length; a++) for (let b = a + 1; b < built.length; b++) {
      if (find(net, a) === find(net, b)) continue;
      if (footprintGap(built[a], built[b]) <= RULES.utilityRange) { union(net, a, b); T.links.push({ a: built[a].id, b: built[b].id, kind: "range" }); }
    }
    const group = (p, list, of) => {
      const g = new Map();
      built.forEach((m, i) => { if (list === T.volumes && !MODULES[m.type].pressurised) return; const r = find(p, i); if (!g.has(r)) g.set(r, []); g.get(r).push(m.id); });
      for (const ids of g.values()) { ids.forEach((id) => of.set(id, list.length)); list.push(ids); }
    };
    group(vol, T.volumes, T.volumeOf);
    group(net, T.networks, T.networkOf);
    // the main network: the one that can hold the most; ties go to the oldest module
    let best = -1;
    T.networks.forEach((ids, i) => {
      let score = ids.length;
      for (const id of ids) { const c = MODULES[this.modules.get(id).type].cap || {}; score += ((c.o2 || 0) + (c.water || 0) + (c.food || 0)) * 0.01 + (MODULES[this.modules.get(id).type].battery_wh || 0) * 1e-4; }
      if (score > best) { best = score; T.main = i; }
    });
    this._topo.set(baseId, T);
    return T;
  }
  /** Open ports of a base: every unmated pressurised or utility port, and free stack ports. */
  openPorts(baseId) {
    const T = this.topology(baseId), out = [];
    for (const m of T.mods) for (const p of portsOf(m)) {
      if (p.up) { const [c] = cellsOf(m.type, m.lx, m.lz, m.r); if (!T.cells.has(cellKey(c[0], c[1], m.level + 1))) out.push(Object.assign(p, { module: m.id })); continue; }
      if (p.type !== "pressurized" && p.type !== "utility") continue;
      if (!T.joined.get(m.id).has(p.name)) out.push(Object.assign(p, { module: m.id }));
    }
    return out;
  }

  /* ── simulation ───────────────────────────────────────────────────────── */

  /**
   * Advance by `dt` simulated seconds.
   * env.buildBoost multiplies construction only (build mode slows the clock; the crews do not slow with it).
   * env: { G: W/m2 on a tracking array now, Gavg: the same averaged over a sol, sinEl, dustRate: multiplier on RULES.dustPerSol,
   *        nightLeft_h, nightLen_h }
   */
  step(dt, env = {}) {
    if (!(dt > 0)) return;
    let left = dt;
    while (left > 1e-9) { const d = Math.min(left, 120); this._step(d, env); left -= d; }
  }
  _step(dt, env) {
    const h = dt / 3600, sol = dt / SOL_S;
    this._construct(h * Math.max(1, env.buildBoost || 1));
    this.dockDelivered_W = 0;
    let rate = 0;
    const cap = this.materialsCap();
    for (const b of this.bases.values()) rate += this._stepBase(b, h, sol, env);
    this.materialsRate = rate;
    if (!this.sandbox) this.materials = Math.min(Math.max(this.materials, cap), this.materials + rate * sol);
  }
  _construct(h) {
    const queue = [...this.modules.values()].filter((m) => !isBuilt(m)).sort((a, b) => a.seq - b.seq);
    let crews = RULES.crews;
    for (const m of queue) {
      if (waitingForParts(m)) { m.queued = false; continue; }          // a blueprint, or components not on the site yet
      if (this.crewGate) {
        // the campaign: whoever is at the site builds it (caretakers, the pioneer helping); more hands, faster
        let k = 1;
        if (!this.sandbox) { try { k = +this.crewGate(m) || 0; } catch { k = 0; } }
        m.queued = !(k > 0);
        if (m.queued) continue;
        m.progress = this.sandbox ? 1 : Math.min(1, m.progress + h * k / Math.max(0.05, MODULES[m.type].build_h));
      } else {
        m.queued = crews <= 0;
        if (crews <= 0 && !this.sandbox) continue;
        crews--;
        m.progress = this.sandbox ? 1 : Math.min(1, m.progress + h / Math.max(0.05, MODULES[m.type].build_h));
      }
      if (isBuilt(m)) this._commission(m);
    }
  }
  _commission(m) {
    const B = MODULES[m.type];
    m.queued = false;
    delete m.plan; m.pkg = null;                 // built: out of the supply chain
    m.st.reserve = (B.reserve_h || 0) * -Math.min(0, B.power_w);
    if (B.battery_wh) m.st.wh = Math.max(m.st.wh, 0.5 * B.battery_wh);      // a bank arrives half charged
    m.st.on = true; m.st.pf = 1;
    this._topo.delete(m.base);
    this.emit("built", m);
  }
  /** Build something at once (tests, sandbox). */
  finish(id) { const m = this.modules.get(id); if (m && !isBuilt(m)) { m.progress = 1; this._commission(m); } return m; }

  _stepBase(b, h, sol, env) {
    const T = this.topology(b.id);
    const G = Math.max(0, env.G || 0), night = !(env.sinEl > 0.02);
    const live = { gen: 0, load: 0, stored: 0, cap: 0, need12: 0, t1: 0, t2: 0, t3: 0, f2: 1, f3: 1, off: 0, onReserve: 0, cutOff: 0, building: 0, built: 0,
      o2: 0, water: 0, food: 0, mat: 0, crew: 0, crewCap: 0, capO2: RULES.lander.o2, capWater: RULES.lander.water, capFood: RULES.lander.food, dust: 0, arrays: 0, avgGen: 0, night };
    live.planned = 0; live.inbound = 0; live.atPod = 0;
    for (const m of T.mods) { if (isBuilt(m)) live.built++; else if (m.plan === "draft") live.planned++; else if (m.plan === "ordered") live.inbound++; else if (m.plan === "delivered") live.atPod++; else live.building++; }

    T.networks.forEach((ids, ni) => {
      const mods = ids.map((id) => this.modules.get(id));
      let gen = 0, cap = 0, stored = 0, maxP = 0, t1 = 0, t2 = 0, t3 = 0;
      for (const m of mods) {
        const B = MODULES[m.type], st = m.st;
        if (B.solar) {
          st.dust = clamp(st.dust + RULES.dustPerSol * (env.dustRate ?? 1) * sol, 0, 0.7);
          st.gen = B.solar.area_m2 * B.solar.efficiency * G * (1 - st.dust);
          gen += st.gen; live.arrays++; live.dust += st.dust;
          live.avgGen += B.solar.area_m2 * B.solar.efficiency * (env.Gavg ?? 137) * (1 - st.dust);
        }
        if (B.battery_wh) { cap += B.battery_wh; stored += clamp(st.wh, 0, B.battery_wh); maxP += B.max_w || B.battery_wh; }
        const need = this._need(m, night);
        if (B.tier === 1) t1 += need; else if (B.tier === 2) t2 += need; else if (B.tier === 3) t3 += need;
        if (this.dock && this.dock.moduleId === m.id && st.on) t3 += this.dock.want_W || 0;
      }
      const frac = cap > 0 ? stored / cap : 0;
      let avail = gen + Math.min(maxP, stored / h);
      const f1 = t1 > 0 ? Math.min(1, avail / t1) : 1;
      avail -= t1 * f1;
      // comfort loads: shed when storage is nearly gone and the Sun does not cover them
      const keep2 = gen >= t1 + t2 || frac >= RULES.comfortBelow;
      const f2 = t2 > 0 ? Math.min(1, (keep2 ? avail : Math.max(0, gen - t1)) / t2) : 1;
      avail -= t2 * f2;
      // industry: what the Sun leaves over once storage is nearly full
      const surplus = Math.max(0, gen - t1 * f1 - t2 * f2);
      const room = cap > 0 && frac < RULES.industryAbove ? Math.min(maxP, (RULES.industryAbove * cap - stored) / h) : 0;
      const extra = cap > 0 ? clamp((frac - RULES.industryAbove) / (1 - RULES.industryAbove), 0, 1) * Math.min(maxP, stored / h) : 0;
      const p3 = Math.min(t3, Math.max(0, surplus - room) + extra);
      const f3 = t3 > 0 ? p3 / t3 : 1;
      const used = t1 * f1 + t2 * f2 + p3;
      let net = gen - used;
      // per module: what it got; life support falls back on its own reserve
      for (const m of mods) {
        const B = MODULES[m.type], st = m.st, need = this._need(m, night);
        if (B.tier === 1) {
          if (f1 >= 0.999) { st.on = true; st.pf = 1; st.onReserve = false; const top = (B.reserve_h || 0) * need - st.reserve; if (top > 0 && net > 0) { const d = Math.min(top, net * h, need * 0.5 * h); st.reserve += d; net -= d / h; } }
          else {
            st.reserve -= need * (1 - f1) * h;
            st.onReserve = st.reserve > 0; st.on = st.reserve > 0; st.pf = st.on ? 1 : f1;
            if (st.reserve <= 0) st.reserve = 0;
          }
        } else if (B.tier === 2) { st.pf = f2; st.on = f2 >= 0.5; st.onReserve = false; }
        else if (B.tier === 3) { st.pf = f3; st.on = f3 > 0.02; st.onReserve = false; }
        else { st.pf = 1; st.on = true; st.onReserve = false; }
        if (this.dock && this.dock.moduleId === m.id) this.dockDelivered_W = st.on ? (this.dock.want_W || 0) * f3 : 0;
        if (!st.on && need > 0) live.off++;
        if (st.onReserve) live.onReserve++;
      }
      if (cap > 0) {
        const after = clamp(stored + net * h, 0, cap);
        for (const m of mods) { const B = MODULES[m.type]; if (B.battery_wh) m.st.wh = after * B.battery_wh / cap; }
        stored = after;
      }
      live.gen += gen; live.load += used; live.stored += stored; live.cap += cap; live.need12 += t1 + t2; live.t1 += t1; live.t2 += t2; live.t3 += t3;
      if (ni === T.main || T.networks.length === 1) { live.f2 = f2; live.f3 = f3; }
      if (ni !== T.main) live.cutOff += ids.length;
    });

    // fluids: only the main network is plumbed to the base's stocks
    const mainIds = T.main >= 0 ? T.networks[T.main] : [];
    let dO2 = 0, dW = 0, dF = 0, dM = 0;
    for (const id of mainIds) {
      const m = this.modules.get(id), B = MODULES[m.type], c = B.cap || {};
      live.capO2 += c.o2 || 0; live.capWater += c.water || 0; live.capFood += c.food || 0;
      const k = m.st.on ? (B.tier >= 2 ? m.st.pf : 1) : 0;
      // a habitat that has lost its air is not being lived in: nobody is breathing there
      const lived = B.pressurised && B.crew ? (m.st.air > 0.6 ? 1 : 0) : 1;
      dO2 += (B.o2 || 0) * k * lived; dW += (B.water || 0) * k * lived; dF += (B.food || 0) * k * lived; dM += (B.materials || 0) * k;
    }
    // producers stop when what they consume has run out
    if (b.water <= 0 && dW < 0) { for (const id of mainIds) { const m = this.modules.get(id), B = MODULES[m.type]; if ((B.water || 0) < 0 && ((B.o2 || 0) > 0 || (B.food || 0) > 0) && m.st.on) { dO2 -= B.o2 * m.st.pf; dF -= (B.food || 0) * m.st.pf; } } }
    live.o2 = dO2; live.water = dW; live.food = dF; live.mat = dM;
    b.o2 = clamp(b.o2 + dO2 * sol, 0, live.capO2); b.water = clamp(b.water + dW * sol, 0, live.capWater); b.food = clamp(b.food + dF * sol, 0, live.capFood);
    // crated supplies (a package's food, water and oxygen) go into the stores as room appears
    const cr = b.crated;
    if (cr) for (const [k, cap] of [["o2", live.capO2], ["water", live.capWater], ["food", live.capFood]]) { const room = Math.max(0, cap - b[k]), d = Math.min(room, cr[k] || 0); if (d > 0) { b[k] += d; cr[k] -= d; } }

    // air: a pressure volume leaks as one when any part of it is breached
    const breachedVol = new Set();
    T.volumes.forEach((ids, i) => { if (ids.some((id) => this.modules.get(id).st.breached)) breachedVol.add(i); });
    T.volumes.forEach((ids, i) => {
      const hasLock = ids.some((id) => MODULES[this.modules.get(id).type].airlock || MODULES[this.modules.get(id).type].ownAirlock);
      for (const id of ids) {
        const m = this.modules.get(id), B = MODULES[m.type], st = m.st;
        const fed = st.on && b.o2 > 0 && T.networkOf.get(id) === T.main && !breachedVol.has(i);
        if (fed) { const d = Math.min(1 - st.air, 0.5 * h); st.air += d; b.o2 = Math.max(0, b.o2 - d * (B.air_kg || 0)); }
        else st.air = Math.max(0, st.air - (breachedVol.has(i) ? 0.6 : 0.05) * h);
        st.habitable = st.air > 0.6 && st.on;
        st.reachable = hasLock;
        if (B.crew) { live.crewCap += B.crew; if (st.habitable && hasLock && b.water > 0 && b.food > 0) live.crew += B.crew; }
      }
    });

    const netW = live.gen - live.load;
    live.net = netW;
    live.frac = live.cap > 0 ? live.stored / live.cap : 0;
    live.reserveNight_h = live.need12 > 0 ? live.stored / live.need12 : Infinity;       // at the load the base carries with no Sun
    live.reserveNow_h = netW < -1 ? live.stored / -netW : Infinity;                      // at current draw
    live.reserve_h = Math.min(live.reserveNight_h, live.reserveNow_h);
    live.nightLeft_h = env.nightLeft_h || 0; live.nightLen_h = env.nightLen_h || 12.3;
    live.dust = live.arrays ? live.dust / live.arrays : 0;
    live.volumes = T.volumes.length; live.networks = T.networks.length;
    b.live = live;
    return dM;
  }
  _need(m, night) {
    const B = MODULES[m.type];
    if (!(B.power_w < 0)) return 0;
    return B.nightOnly && !night ? 0 : -B.power_w;
  }

  /* ── read-outs ────────────────────────────────────────────────────────── */

  /** What the HUD shows for one base. Call after at least one step. */
  summary(baseId) {
    const b = this.bases.get(baseId);
    if (!b) return null;
    if (!b.live) this._stepBase(b, 1e-6, 1e-9, {});
    const L = b.live;
    return {
      id: b.id, name: b.name, modules: L.built + L.building + (L.planned || 0) + (L.inbound || 0) + (L.atPod || 0), built: L.built, building: L.building,
      planned: L.planned || 0, inbound: L.inbound || 0, atPod: L.atPod || 0, crated: Object.assign({ o2: 0, water: 0, food: 0 }, b.crated || {}), spares: b.spares || 0,
      power: { gen_W: L.gen, load_W: L.load, net_W: L.net, stored_Wh: L.stored, capacity_Wh: L.cap, fraction: L.frac, reserve_h: L.reserve_h, reserveNight_h: L.reserveNight_h,
        nightLeft_h: L.nightLeft_h, nightLen_h: L.nightLen_h, comfort: L.f2, industry: L.f3, nightLoad_W: L.need12, off: L.off, onReserve: L.onReserve },
      o2: { kg: b.o2, cap: L.capO2, perSol: L.o2 }, water: { l: b.water, cap: L.capWater, perSol: L.water }, food: { kg: b.food, cap: L.capFood, perSol: L.food },
      crew: { capacity: L.crew, places: L.crewCap }, materials: { stock: this.materials, cap: this.materialsCap(), perSol: this.materialsRate, sandbox: this.sandbox },
      dust: L.dust, arrays: L.arrays, cutOff: L.cutOff, score: this.score(baseId), alerts: this.alerts(baseId),
    };
  }

  /**
   * The settlement rating, 0..100. Half is self-sufficiency (power, air, water,
   * food, each as production over need), three tenths resilience (storage
   * against the night, redundancy, shelter), two tenths the site.
   * `site` = {slope: 0..1, solar: 0..1, shelter: 0..1} from the builder (1 is good); absent, 0.7 each.
   */
  score(baseId) {
    const b = this.bases.get(baseId);
    if (!b || !b.live) return { total: 0, rating: "Camp", self: {}, resilience: {}, site: {} };
    const L = b.live, T = this.topology(baseId);
    let use = { o2: 0, water: 0, food: 0 }, make = { o2: 0, water: 0, food: 0 }, crewPlaces = 0;
    const count = {};
    let shield = 0, hull = 0;
    for (const m of T.mods) {
      if (!isBuilt(m)) continue;
      const B = MODULES[m.type];
      count[m.type] = (count[m.type] || 0) + 1;
      for (const k of ["o2", "water", "food"]) { const v = B[k] || 0; if (v < 0) use[k] -= v; else make[k] += v; }
      crewPlaces += B.crew || 0; shield += B.shield || 0; if (B.pressurised) hull++;
    }
    const frac = (m, u) => (u > 0 ? clamp(m / u, 0, 1) : (crewPlaces > 0 ? 1 : 0));
    const self = { power: L.need12 > 0 ? clamp(L.avgGen / L.need12, 0, 1) : 0, air: frac(make.o2, use.o2), water: frac(make.water, use.water), food: frac(make.food, use.food) };
    if (!crewPlaces) { self.air = 0; self.water = 0; self.food = 0; }
    const two = (ids) => clamp(ids.reduce((a, id) => a + (count[id] || 0), 0) / 2, 0, 1);
    const site = Object.assign({ slope: 0.7, solar: 0.7, shelter: 0.7 }, b.site || {});
    const resilience = {
      reserve: Number.isFinite(L.reserveNight_h) ? clamp(L.reserveNight_h / (1.5 * (L.nightLen_h || 12.3)), 0, 1) : 0,
      redundancy: (two(["solar_array"]) + two(["battery_bank"]) + two(["airlock"]) + two(["hab_small", "hab_large", "hab_hdu"])) / 4,
      shelter: clamp(0.5 * (hull ? shield / hull : 0) + 0.5 * site.shelter, 0, 1),
    };
    const s = (self.power + self.air + self.water + self.food) / 4, r = 0.5 * resilience.reserve + 0.25 * resilience.redundancy + 0.25 * resilience.shelter;
    const q = Number.isFinite(site.suitability) ? clamp(site.suitability, 0, 1) : (site.slope + site.solar + site.shelter) / 3;
    const total = Math.round(100 * (0.5 * s + 0.3 * r + 0.2 * q) * (crewPlaces ? 1 : 0.5));
    return { total, rating: total >= 75 ? "Settlement" : total >= 50 ? "Station" : total >= 25 ? "Outpost" : "Camp", self, resilience, site, selfSufficiency: s, resilienceScore: r, siteScore: q };
  }

  /** Alerts with lead time, worst first: [{id, level: "bad" | "warn" | "info", text}]. */
  alerts(baseId) {
    const b = this.bases.get(baseId), out = [];
    if (!b || !b.live) return out;
    const L = b.live, T = this.topology(baseId), hrs = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) + " h";
    if (L.off > 0) out.push({ id: "dark", level: "bad", text: `${L.off} module${L.off > 1 ? "s" : ""} without power` });
    if (L.onReserve > 0) out.push({ id: "reserve", level: "bad", text: `${L.onReserve} module${L.onReserve > 1 ? "s" : ""} on internal reserve` });
    if (L.need12 > 0 && L.built > 0) {
      if (L.cap <= 0) { if (L.t1 > 0) out.push({ id: "nostore", level: L.night ? "bad" : "warn", text: "No battery: the base goes dark at sunset" }); }
      else if (Number.isFinite(L.reserveNow_h) && (L.reserveNow_h < L.nightLeft_h + 0.5 || L.reserveNow_h < 6)) {
        out.push({ id: "power", level: L.reserveNow_h < 2 ? "bad" : "warn", text: `Power reserve ${hrs(L.reserveNow_h)} at current draw` + (L.nightLeft_h > 0.2 ? `, sunrise in ${hrs(L.nightLeft_h)}` : "") });
      } else if (!L.night && L.reserveNight_h < L.nightLen_h) {
        out.push({ id: "night", level: "warn", text: `Storage covers ${hrs(L.reserveNight_h)} of a ${hrs(L.nightLen_h)} night` });
      }
    }
    const runs = (id, label, stock, rate, unit) => {
      if (rate < -1e-6) { const sols = stock / -rate; if (sols < 5) out.push({ id, level: sols < 1 ? "bad" : "warn", text: stock <= 0 ? `${label} has run out` : `${label} for ${sols.toFixed(1)} sols (${Math.round(stock)} ${unit})` }); }
    };
    runs("o2", "Oxygen", b.o2, L.o2, "kg"); runs("water", "Water", b.water, L.water, "L"); runs("food", "Food", b.food, L.food, "kg");
    const leak = T.mods.find((m) => m.st.breached);
    if (leak) out.push({ id: "breach", level: "bad", text: `${MODULES[leak.type].name} is breached: the volume is losing air` });
    if (L.cutOff > 0) out.push({ id: "cut", level: "warn", text: `${L.cutOff} module${L.cutOff > 1 ? "s" : ""} cut off: more than ${RULES.utilityRange} m from the network` });
    const locked = T.mods.find((m) => isBuilt(m) && MODULES[m.type].crew && m.st.reachable === false);
    if (locked) out.push({ id: "lock", level: "warn", text: `${MODULES[locked.type].name} has no airlock: crew cannot get in` });
    if (L.arrays && L.dust > 0.2) out.push({ id: "dust", level: "info", text: `Solar arrays ${Math.round(L.dust * 100)}% dusty: clean them (interact beside them)` });
    const order = { bad: 0, warn: 1, info: 2 };
    return out.sort((a, c) => order[a.level] - order[c.level]);
  }

  cleanSolar(ids = null) {
    let n = 0, was = 0;
    for (const m of this.modules.values()) if (MODULES[m.type].solar && (!ids || ids.includes(m.id)) && m.st.dust > 0.001) { was += m.st.dust; m.st.dust = 0; n++; }
    return { cleaned: n, recovered: n ? was / n : 0 };
  }

  /* ── persistence: stocks and frames (the modules themselves are entities) ── */
  toJSON() {
    const bases = {};
    for (const b of this.bases.values()) bases[b.id] = { name: b.name, x: b.x, z: b.z, yaw: b.yaw, o2: b.o2, water: b.water, food: b.food, site: b.site || null, crated: b.crated || null, spares: b.spares || 0 };
    return { v: 1, materials: this.materials, seq: this.seq, bases, onHand: this.onHand };
  }
}

const BASE_NAMES = ["Alpha", "Bravo", "Cassini", "Delta", "Erebus", "Fram", "Gale", "Hellas"];
