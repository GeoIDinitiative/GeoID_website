/**
 * THE SITE LAUNCHER: choose where on Mars to play, the way the flight sim's
 * pre-flight lets you choose where to launch. A globe you can drag, a reticle
 * that reads out what it is over, pins for the sites, and a card for the pin
 * that is selected.
 *
 * Sites are DATA: sites/index.json lists them.
 *   status "ready"       built with tools/build_site.py; its manifest (site.json) is read for the card
 *   status "unprepared"  a real site whose data has been identified but not built
 *   status "locked"      a place the game could go, with one line on what real data exists
 * A "ready" entry whose manifest cannot be fetched is shown as not installed.
 *
 * Not a game system: it runs on the title screen, before a site is booted.
 * boot.js mounts it and is told which site was chosen.
 *
 * The globe is drawn on a 2D canvas (an orthographic projection of the site's
 * own global Mars mosaic, sampled per pixel), so the title screen needs no
 * second WebGL context. If the mosaic cannot be fetched it falls back to a
 * plain graticule.
 */
import { campaignSummary } from "./missions.js?v=b8cfe8e-efa5b7b7";
import { hasSave } from "./state.js?v=b8cfe8e-efa5b7b7";
import { ensureStyles } from "./avatar.js?v=b8cfe8e-efa5b7b7";

// equirectangular, longitude -180..180: the site's global Mars mosaic (the live viewer's
// mars_color.jpg from data.geoidinitiative.com), kept beside the game so the 2D canvas can
// read its pixels (the CDN sends no CORS header).
const GLOBE_URL = new URL("../assets/globe/mars_color.jpg", import.meta.url).href;
const LAST_KEY = "geoid.mars_surface.lastSite";
const D2R = Math.PI / 180, SIZE = 420;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ll = (lat, lon) => `${Math.abs(lat).toFixed(2)}&deg; ${lat >= 0 ? "N" : "S"} ${(((lon % 360) + 360) % 360).toFixed(2)}&deg; E`;
const km = (m) => (m / 1000).toFixed(1);
const mb = (b) => (b / 1e6).toFixed(1) + " MB";

/** Coverage of a pyramid level, in true kilometres, from its tile range. */
function coverage(level, grid) {
  const r = level.tile_range, span = level.tile * level.mpp;
  const w = Math.min((r[2] - r[0] + 1) * span, grid.size_projected_m[0]) * grid.cos_lat0, h = Math.min((r[3] - r[1] + 1) * span, grid.size_projected_m[1]);
  return `${km(w)} &times; ${km(h)} km`;
}
function dataLines(m) {
  const hs = m.levels.filter((l) => l.kind === "height").sort((a, b) => a.mpp - b.mpp), is = m.levels.filter((l) => l.kind === "imagery").sort((a, b) => a.mpp - b.mpp);
  const line = (ls) => ls.map((l) => `<i>${l.mpp} m</i> over ${coverage(l, m.grid)}`).join(", ");
  return `Terrain ${line(hs)}. Imagery ${line(is)}. ${mb(m.bytes || m.levels.reduce((a, l) => a + (l.bytes || 0), 0))} of tiles.`;
}

/** A regional site (tools/build_regional.py) names every product it was built from, with its producer. */
function sourceLine(m) {
  if (m.kind !== "regional" || !m.sources) return "";
  const used = new Set(m.levels.flatMap((l) => l.sources || []));
  if (m.imagery && m.imagery.colour_tex) used.add(m.imagery.colour_tex.source);
  const names = Object.entries(m.sources).filter(([k]) => used.has(k)).map(([, s]) => (s.title || "").split(" (")[0] + (s.licence && /ESA/.test(s.licence) ? " (ESA/DLR/FU Berlin)" : ""));
  return `<span class="q"><b>Sources</b>${esc(names.join("; "))}.</span>`;
}

class Globe {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext("2d");
    canvas.width = canvas.height = SIZE;
    this.lat = 15; this.lon = 77; this.tex = null;
    // per pixel of the disc: the unit vector toward the viewer (x right, y up, z out)
    const R = SIZE / 2 - 2, n = SIZE * SIZE;
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
      const x = (i + 0.5 - SIZE / 2) / R, y = -(j + 0.5 - SIZE / 2) / R, d = x * x + y * y, k = j * SIZE + i;
      if (d <= 1) { this.vx[k] = x; this.vy[k] = y; this.vz[k] = Math.sqrt(1 - d); } else this.vz[k] = -1;
    }
    this.R = R; this.img = this.ctx.createImageData(SIZE, SIZE);
  }
  load(url) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        try {
          const c = document.createElement("canvas"); c.width = 1440; c.height = 720;
          const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0, 1440, 720);
          this.tex = g.getImageData(0, 0, 1440, 720).data; this.tw = 1440; this.th = 720;
        } catch { this.tex = null; }
        resolve(!!this.tex);
      };
      im.onerror = () => resolve(false);
      im.src = url;
    });
  }
  /** Site (lat, lon) -> canvas pixels and whether it is on the near side. */
  project(lat, lon) {
    const p = lat * D2R, l = (lon - this.lon) * D2R, p0 = this.lat * D2R;
    const x = Math.cos(p) * Math.sin(l), y0 = Math.sin(p), z0 = Math.cos(p) * Math.cos(l);
    const y = y0 * Math.cos(p0) - z0 * Math.sin(p0), z = y0 * Math.sin(p0) + z0 * Math.cos(p0);
    return { x: SIZE / 2 + x * this.R, y: SIZE / 2 - y * this.R, z };
  }
  draw() {
    const d = this.img.data, T = this.tex, tw = this.tw, th = this.th, p0 = this.lat * D2R, c0 = Math.cos(p0), s0 = Math.sin(p0), lon0 = this.lon * D2R;
    const vx = this.vx, vy = this.vy, vz = this.vz;
    for (let k = 0, n = SIZE * SIZE; k < n; k++) {
      const z = vz[k], o = k * 4;
      if (z < 0) { d[o + 3] = 0; continue; }
      const x = vx[k], y = vy[k];
      const yy = y * c0 + z * s0, zz = -y * s0 + z * c0;
      const lat = Math.asin(yy < -1 ? -1 : yy > 1 ? 1 : yy), lon = lon0 + Math.atan2(x, zz);
      let r, g, b;
      if (T) {
        let u = (lon / (2 * Math.PI) + 0.5) % 1; if (u < 0) u += 1;
        const ti = Math.min(tw - 1, (u * tw) | 0), tj = Math.min(th - 1, ((0.5 - lat / Math.PI) * th) | 0), q = (tj * tw + ti) * 4;
        r = T[q]; g = T[q + 1]; b = T[q + 2];
      } else { r = 168; g = 96; b = 60; }
      // graticule every 30 degrees
      const la = Math.abs(lat / D2R) % 30, lo = Math.abs(lon / D2R) % 30, cl = Math.cos(lat) + 0.05;
      const line = la < 0.35 || la > 29.65 || lo * cl < 0.35 || (30 - lo) * cl < 0.35;
      const light = (0.3 + 0.7 * Math.max(0, -0.42 * x + 0.3 * y + 0.86 * z)) * (0.55 + 0.45 * Math.pow(z, 0.5));
      const f = light * (line ? 1.25 : 1), a = line ? 26 : 0;
      d[o] = Math.min(255, r * f + a); d[o + 1] = Math.min(255, g * f + a * 0.7); d[o + 2] = Math.min(255, b * f + a * 0.5);
      d[o + 3] = z < 0.06 ? 255 * z / 0.06 : 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}

/**
 * @param o { list: element to fill, screen: the title section, lite: bool, select(entry | null, cardEl), onChange() }
 * @returns {Promise<{sites, select(id), current, globe}>}
 */
export async function mountLauncher(o) {
  ensureStyles();
  const r = await fetch("sites/index.json", { cache: "no-cache" });
  if (!r.ok) throw new Error("sites/index.json not found");
  const index = await r.json();
  const sites = index.sites.map((s) => Object.assign({}, s));
  // read the manifest of every site that claims to be built
  await Promise.all(sites.filter((s) => s.status === "ready").map(async (s) => {
    try {
      const m = await fetch(s.path + (o.lite ? "site.lite.json" : "site.json"), { cache: "no-cache" });
      if (!m.ok) throw new Error("no manifest");
      s.manifest = await m.json();
      s.name = s.manifest.name; s.lat = s.manifest.grid.lat0_deg; s.lon = s.manifest.grid.lon0_deg;
    } catch { s.status = "missing"; }
  }));

  const list = o.list; list.classList.add("launcher"); list.innerHTML = "";
  const globeBox = document.createElement("div"); globeBox.className = "launch-globe";
  globeBox.innerHTML = `<div class="launch-disc"><canvas aria-label="Mars: drag to turn, choose a pin"></canvas><div class="launch-pins"></div><i class="launch-reticle"></i></div>
    <div class="launch-read"><span class="eyebrow">Under the reticle</span><b></b></div>`;
  const chips = document.createElement("div"); chips.className = "launch-chips";
  const card = document.createElement("div"); card.className = "site launch-card"; card.setAttribute("aria-pressed", "false");
  list.append(chips, card);
  o.screen.appendChild(globeBox);
  const globe = new Globe(globeBox.querySelector("canvas")), pins = globeBox.querySelector(".launch-pins"), read = globeBox.querySelector(".launch-read b");
  const hasTex = await globe.load(index.globe || GLOBE_URL);
  globeBox.classList.toggle("plain", !hasTex);

  const state = { current: null, anim: 0 };
  const label = { ready: "ready", unprepared: "data not yet prepared", missing: "not installed", locked: "locked" };
  for (const s of sites) {
    const pin = document.createElement("button"); pin.type = "button"; pin.className = "launch-pin " + s.status; pin.dataset.site = s.id;
    pin.innerHTML = `<i></i><span>${esc(s.name)}</span>`; pin.setAttribute("aria-label", `${s.name}: ${label[s.status]}`);
    const chip = document.createElement("button"); chip.type = "button"; chip.className = "launch-chip " + s.status; chip.dataset.site = s.id;
    chip.innerHTML = `<i></i>${esc(s.name)}`; chip.setAttribute("aria-pressed", "false");
    pins.appendChild(pin); chips.appendChild(chip); s.pin = pin; s.chip = chip;
    pin.addEventListener("click", () => select(s.id)); chip.addEventListener("click", () => select(s.id, true));
    chip.addEventListener("mouseenter", () => pin.classList.add("hover")); chip.addEventListener("mouseleave", () => pin.classList.remove("hover"));
  }

  function place() {
    for (const s of sites) {
      const p = globe.project(s.lat, s.lon), vis = p.z > 0.08;
      s.pin.hidden = !vis;
      if (vis) s.pin.style.transform = `translate(${(p.x / SIZE * 100).toFixed(2)}cqw, ${(p.y / SIZE * 100).toFixed(2)}cqw)`;
    }
    read.innerHTML = ll(globe.lat, globe.lon);
  }
  function render() { globe.draw(); place(); }

  function turnTo(lat, lon, instant) {
    const id = ++state.anim, a0 = globe.lat, o0 = globe.lon, a1 = Math.max(-70, Math.min(70, lat));
    let dl = ((lon - o0 + 540) % 360) - 180;
    if (instant) { globe.lat = a1; globe.lon = o0 + dl; render(); return; }
    const t0 = performance.now(), dur = 520;
    const step = () => {
      if (id !== state.anim) return;
      const k = Math.min(1, (performance.now() - t0) / dur), e = k * k * (3 - 2 * k);
      globe.lat = a0 + (a1 - a0) * e; globe.lon = o0 + dl * e; render();
      if (k < 1) setTimeout(step, 16);
    };
    step();
  }

  function cardFor(s) {
    const m = s.manifest;
    if (s.status === "ready" && m) {
      const g = m.grid, camp = campaignSummary(m), saved = hasSave(s.id);
      card.innerHTML = `<h3>${esc(m.name)}</h3><span class="where">${ll(g.lat0_deg, g.lon0_deg)}</span>
        <p>${esc(m.blurb)} ${km(g.size_true_m[0])} &times; ${km(g.size_true_m[1])} km.</p>
        <span class="q"><b>Data</b>${esc(m.quality)}. Finer than that is generated, and labelled.</span>
        <span class="q"><b>Coverage</b>${dataLines(m)}</span>${sourceLine(m)}
        <span class="q"><b>Missions</b>${camp.map((c) => esc(c.title)).join(" &rarr; ")}.</span>
        <span class="q"><b>Places</b>${m.pois.map((p) => esc(p.name)).join(" &middot; ")}.${saved ? " <em>Saved game here.</em>" : ""}</span>`;
    } else {
      const why = s.status === "locked" ? "Locked: no site has been prepared here yet." : s.status === "missing" ? "The tiles for this site are not installed." : "Data not yet prepared.";
      card.innerHTML = `<h3>${esc(s.name)}</h3><span class="where">${ll(s.lat, s.lon)}</span>
        <p>${esc(s.blurb || "")}</p>
        <span class="q"><b>Real data</b>${esc(s.data || "")}</span>
        <span class="q"><b>Status</b>${why} ${esc(s.todo || "A site is prepared offline with tools/fetch_window.py and tools/build_site.py from a tools/sites/<id>.site.json definition.")}</span>`;
    }
    card.classList.toggle("off", s.status !== "ready");
    const fine = o.screen.querySelector(".title-inner > .fine");
    if (fine) { state.credit = state.credit || fine.textContent; fine.textContent = s.credit || state.credit; }
  }

  function select(id, fromChip = false, instant = false) {
    const s = sites.find((x) => x.id === id);
    if (!s) return null;
    state.current = s;
    for (const x of sites) { x.pin.classList.toggle("on", x === s); x.chip.setAttribute("aria-pressed", String(x === s)); }
    cardFor(s);
    turnTo(s.lat, s.lon, instant);
    if (s.status === "ready") { o.select({ id: s.id, name: s.name, path: s.path }, card); try { localStorage.setItem(LAST_KEY, s.id); } catch { /* private window */ } }
    else { o.select(null, card, s); card.setAttribute("aria-pressed", "false"); }
    if (o.onChange) o.onChange(s);
    void fromChip;
    return s;
  }

  // drag the globe; when it stops, the pin nearest the reticle is selected
  const cv = globe.cv; let drag = null;
  cv.addEventListener("pointerdown", (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }; cv.setPointerCapture?.(e.pointerId); state.anim++; });
  cv.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = 120 / cv.getBoundingClientRect().width, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    globe.lon -= dx * k; globe.lat = Math.max(-80, Math.min(80, globe.lat + dy * k)); render();
  });
  const up = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved; drag = null;
    if (moved < 4) return;
    let best = null;
    for (const s of sites) { const p = globe.project(s.lat, s.lon); if (p.z > 0) { const d = Math.hypot(p.x - SIZE / 2, p.y - SIZE / 2); if (d < SIZE * 0.2 && (!best || d < best.d)) best = { s, d }; } }
    if (best) select(best.s.id);
  };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);

  // the controller: the module's D-pad moves the ring between the chips and pins; the globe follows the ring
  const P = window.GeoIDPad;
  if (P) {
    P.on("focus", (el) => { const b = el && el.closest && el.closest("[data-site]"); if (b && !o.screen.hidden && (!state.current || state.current.id !== b.dataset.site)) { const s = sites.find((x) => x.id === b.dataset.site); if (s) { turnTo(s.lat, s.lon); cardFor(s); } } });
    // Circle with nothing to close: back to the last site that can be played
    P.onBack(() => { if (o.screen.hidden || !state.current || state.current.status === "ready") return false; const s = sites.find((x) => x.status === "ready"); if (!s) return false; select(s.id); return true; });
  }
  list.addEventListener("focusout", () => { if (state.current) setTimeout(() => { if (!list.contains(document.activeElement)) cardFor(state.current); }, 0); });

  let first = null;
  try { first = sites.find((s) => s.status === "ready" && s.id === localStorage.getItem(LAST_KEY)); } catch { first = null; }
  first = first || sites.find((s) => s.status === "ready") || sites[0];
  if (first) select(first.id, false, true);
  return { sites, select, globe, get current() { return state.current; }, dispose() { state.anim++; globeBox.remove(); } };
}
