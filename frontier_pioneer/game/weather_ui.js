/**
 * The weather's panels: a compact read-out in the driving HUD, the hazard
 * map's legend, and a "Weather and hazards" screen reached from the pause
 * menu (forecast, rover health, event log, the hazard-map and difficulty
 * switches).
 *
 * Everything is built here and attached through small hooks, so no other
 * module has to know it exists: the HUD's generic addPanel(), one button
 * added to the pause menu's column, one field added to Settings. The screen
 * is an ordinary ".screen.modal" with data-pad-closable / data-pad-close, so
 * the shared controller module walks it with the D-pad and closes it with
 * Circle exactly like the others.
 */
import { getSystem } from "./systems.js?v=6d37c9c-9b39e129";
import { fmtSpeed, fmtDistance } from "./hud.js?v=6d37c9c-9b39e129";
// (weather.js is loaded by plugins.js under its own URL: importing it again from here would make a second copy of the system)
const HOUR = 88775.244 / 24;
const COMPASS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (deg) => COMPASS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, html = "") => { const e = document.createElement(tag); for (const k in attrs) e.setAttribute(k, attrs[k]); e.innerHTML = html; return e; };
const DIFF = { off: "Off (weather is scenery)", standard: "Standard", harsh: "Harsh" };
const STORM = { local: "Local storm", regional: "Regional storm", global: "Global storm" };

function fmtTemp(k, units) {
  const c = k - 273.15, v = units === "imperial" ? c * 9 / 5 + 32 : c;
  return (v < 0 ? "−" : "") + Math.abs(Math.round(v)) + (units === "imperial" ? " °F" : " °C");
}
function fmtEta(s) { const m = Math.max(0, Math.round(s / HOUR * 60)); return m >= 60 ? Math.floor(m / 60) + " h " + String(m % 60).padStart(2, "0") : m + " min"; }
function fmtWind(ms, units) { const [v, u] = fmtSpeed(ms, units); return Math.round(parseFloat(v)) + " " + u; }

export class WeatherUi {
  constructor(game) {
    this.game = game;
    this.acc = 1; this.open = false;
    const hud = game.hud;

    // ── HUD read-out (under the clock): contextual. It shows when the weather changes or turns hazardous (uiman.js) ──
    const p = this.panel = el("div", { class: "wx", id: "wx" }, `
      <div class="mini"><span>Wind <b id="wx-wind">&nbsp;</b></span><span>Air <b id="wx-air">&nbsp;</b></span><span>Vis <b id="wx-vis">&nbsp;</b></span></div>
      <div class="wx-storm" id="wx-storm" hidden></div>`);
    if (hud.addPanel) hud.addPanel("weather", p, "right");
    this._last = null;
    if (hud.ui) hud.ui.register("weather", { el: p, group: "environment", policy: "contextual", hold: 3, when: (g) => this.hazardous(g.env) });

    // ── hazard-map legend (under the objective) ──
    this.legendEl = el("div", { class: "wx-legend", id: "wx-legend" }, `
      <div class="eyebrow" id="wx-legend-title">Hazard map</div>
      <div class="wx-ramp"><span id="wx-legend-bad">&nbsp;</span><i></i><span id="wx-legend-good">&nbsp;</span></div>
      <div class="wx-note">A heuristic from the terrain data, not a survey</div>`);
    this.legendEl.hidden = true;
    if (hud.addPanel) hud.addPanel("hazard-legend", this.legendEl, "left");
    if (hud.ui) hud.ui.register("hazard-legend", { el: this.legendEl, group: "environment", policy: "always" });
    game.on("mode", (mode) => { if ((mode === "driving" || mode === "onfoot") && hud.ui) hud.ui.poke("weather", 6); });

    // ── the screen ──
    const s = this.screen = el("section", { id: "screen-weather", class: "screen modal", "data-pad-closable": "" }, `
      <div class="card wide wx-card">
        <h2>Weather and hazards</h2>
        <div class="stats wx-now" id="wx-now"></div>
        <div class="eyebrow">Forecast</div>
        <div class="wx-fc" id="wx-fc"></div>
        <p class="wx-outlook" id="wx-outlook">&nbsp;</p>
        <div class="eyebrow">Rover</div>
        <div class="mini wx-health" id="wx-health"></div>
        <div class="eyebrow">Event log</div>
        <ul class="wx-log" id="wx-log"></ul>
        <div class="row">
          <button type="button" id="btn-hazmap" class="btn">Hazard map: off</button>
          <button type="button" id="btn-hazards" class="btn">Hazards: Standard</button>
          <button type="button" id="btn-weather-close" class="btn primary" data-pad-close>Back</button>
        </div>
        <p class="fine">The forecast is the game's own weather director, blurred with lead time. Climate ranges follow Perseverance's MEDA record at Jezero; how often storms come is compressed for play. Hazard-map layers are heuristics computed from the elevation data and the regolith guess. Hazard map on the keyboard: K.</p>
      </div>`);
    s.hidden = true;
    document.body.insertBefore(s, $("fatal") || null);

    // ── one button in the pause menu, one field in Settings ──
    const col = document.querySelector("#screen-menu .col"), save = $("btn-save");
    this.menuBtn = el("button", { type: "button", id: "btn-menu-weather", class: "btn" }, "Weather and hazards");
    if (col) col.insertBefore(this.menuBtn, save && save.parentNode === col ? save : null);
    const scol = document.querySelector("#screen-settings .col"), done = $("btn-settings-close");
    this.field = el("label", { class: "field" }, `Hazards
      <select id="set-hazards"><option value="off">Off: weather is scenery, nothing is harmed</option><option value="standard">Standard</option><option value="harsh">Harsh: everything costs 1.8 times as much</option></select>`);
    if (scol) scol.insertBefore(this.field, done && done.parentNode === scol ? done : null);
    this.select = this.field.querySelector("select");
    this.select.value = this._diff();

    this.menuBtn.addEventListener("click", () => this.show(true));
    $("btn-weather-close").addEventListener("click", () => this.show(false));
    $("btn-hazmap").addEventListener("click", () => { const hz = getSystem("hazards"); if (hz) hz.cycleOverlay(game); this.render(); game.tick(0); });
    $("btn-hazards").addEventListener("click", () => { const order = ["off", "standard", "harsh"]; this.setDifficulty(order[(order.indexOf(this._diff()) + 1) % 3]); });
    this.select.addEventListener("change", (e) => this.setDifficulty(e.target.value));
    this._onMenuKey = () => { if (this.open) this.show(false); };
    this._onHelpKey = () => { if (this.open) { this.open = false; this.screen.hidden = true; } };
    game.on("menukey", this._onMenuKey);
    game.on("helpkey", this._onHelpKey);
  }

  _diff() { const d = this.game.settings.hazards; return d === "off" || d === "harsh" ? d : "standard"; }
  setDifficulty(d) {
    const game = this.game;
    game.settings.hazards = d;
    game.applySettings();
    this.select.value = d;
    const hz = getSystem("hazards");
    if (hz && hz.log && game.ready) hz.log(game, "difficulty", "info", "Hazards set to " + DIFF[d]);
    this.render();
  }

  /** Open from the pause menu / go back to it. */
  show(on) {
    const menu = $("screen-menu"), P = window.GeoIDPad;
    this.open = on;
    this.screen.hidden = !on;
    if (menu && this.game.mode === "menu") menu.hidden = on;
    if (on) this.render();
    const target = on ? this.screen : menu;
    if (P && P.connected && target && !target.hidden) setTimeout(() => { if (!target.hidden) P.focus.first(target); }, 60);
  }
  onMode(game, mode) { if (mode !== "menu" && this.open) { this.open = false; this.screen.hidden = true; } }

  legend(game, L) {
    this.legendEl.hidden = !L;
    if (!L) return;
    $("wx-legend-title").textContent = "Hazard map: " + L.label.toLowerCase();
    $("wx-legend-bad").textContent = L.bad; $("wx-legend-good").textContent = L.good;
  }

  /** Weather worth keeping on screen: a storm on its way or here, poor visibility, a gale, deep cold. */
  hazardous(env) {
    if (!env || !env.wind) return false;
    return !!env.dust.storm || env.visibility_m < 5000 || env.wind.speed_ms > 14 || env.temp.air_K < 180;
  }
  /** ...and weather that just changed: dust, wind or temperature moved noticeably since it was last shown. */
  _noticeChange(env) {
    const now = { tau: env.tau, wind: env.wind.speed_ms, air: env.temp.air_K };
    const L = this._last;
    if (!L) { this._last = now; return; }
    if (Math.abs(now.tau - L.tau) > 0.15 || Math.abs(now.wind - L.wind) > 3 || Math.abs(now.air - L.air) > 12) {
      this._last = now;
      const hud = this.game.hud; if (hud.ui) hud.ui.poke("weather", 6);
    }
  }

  update(game, dt, env) {
    this.acc += dt || 0.05;
    if (this.acc < 0.25) return;
    this.acc = 0;
    this._noticeChange(env);
    const units = game.settings.units, w = env.wind, storm = env.dust.storm;
    $("wx-wind").textContent = fmtWind(w.speed_ms, units) + " " + compass(w.dir_deg);
    $("wx-air").textContent = fmtTemp(env.temp.air_K, units);
    $("wx-vis").textContent = env.visibility_m > 30000 ? "clear" : fmtDistance(env.visibility_m, units);
    const chip = $("wx-storm");
    if (storm) {
      chip.hidden = false;
      chip.className = "wx-storm " + (storm.phase === "peak" ? "bad" : storm.phase === "approaching" ? "warn" : "ok");
      chip.textContent = storm.phase === "approaching" ? `${STORM[storm.kind]} in ${fmtEta(storm.eta_s)}` : storm.phase === "peak" ? `${STORM[storm.kind]}: ${fmtEta(storm.ends_s)} left` : `${STORM[storm.kind]} clearing`;
    } else chip.hidden = true;
    const hz = getSystem("hazards");
    if (hz && hz.map && this.legendEl.hidden === hz.map.overlay.on) this.legend(game, hz.map.overlay.on ? hz.map.layers.find((l) => l.id === hz.map.overlay.layer) : null);
    if (this.select.value !== this._diff()) this.select.value = this._diff();
    if (this.open) this.render();
  }

  render() {
    const game = this.game, env = game.env, units = game.settings.units;
    if (!env || !env.wind || !game.state) return;
    const stat = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
    $("wx-now").innerHTML =
      stat(env.tau.toFixed(2), "dust optical depth") +
      stat(fmtWind(env.wind.speed_ms, units) + " " + compass(env.wind.dir_deg), "wind, gusts " + fmtWind(env.wind.gust_ms, units)) +
      stat(fmtTemp(env.temp.air_K, units), "air, ground " + fmtTemp(env.temp.ground_K, units)) +
      stat(Math.round(env.pressure_Pa) + " Pa", "pressure") +
      stat(env.visibility_m > 30000 ? "clear" : fmtDistance(env.visibility_m, units), "visibility") +
      stat(env.radiation.dose_mSv_per_sol.toFixed(2), "mSv per sol" + (env.radiation.spe ? ", particle event" : ""));
    const rows = [env.today, ...env.forecast].filter(Boolean).map((f, i) => {
      const pc = Math.round(f.storm_chance * 100), cls = pc > 60 ? "bad" : pc > 30 ? "warn" : "ok";
      return `<div class="wx-row"><b>${i === 0 ? "Today" : "Sol " + f.sol}</b><span>&tau; ${f.tau_min.toFixed(1)}&ndash;${f.tau_max.toFixed(1)}</span>
        <span class="wx-bar"><i class="${cls}" style="width:${pc}%"></i></span><span class="wx-pc">${pc}% storm</span><span class="wx-what">${f.kind ? STORM[f.kind] + (f.when ? ", " + f.when : "") : "settled"}</span></div>`;
    });
    $("wx-fc").innerHTML = rows.join("");
    $("wx-outlook").textContent = env.outlook + " Season: " + env.season.name + ", Ls " + env.season.ls_deg.toFixed(0) + "°" + (env.season.dust_season ? " (dust season)." : ".");
    const r = env.rover || {}, h = r.health, pct = (x) => Math.round(x * 100) + "%";
    const cell = (l, v, bad) => `<span${bad ? ' class="bad"' : ""}>${l} <b>${v}</b></span>`;
    $("wx-health").innerHTML = (h ? cell("Battery", pct(h.battery), h.battery < 0.7) + cell("Heaters", pct(h.heaters), h.heaters < 0.7) + cell("Wheels", pct(h.wheels), h.wheels < 0.7) + cell("Array", pct(h.panels), h.panels < 0.7) : "")
      + cell("Dust on array", pct(game.state.weather.panelDust || 0), (game.state.weather.panelDust || 0) > 0.3)
      + (r.pack_K ? cell("Pack", fmtTemp(r.pack_K, units), r.capacity_factor < 0.9) + cell("Heater load", Math.round(r.heater_W) + " W") : "")
      + cell("Dose", (env.radiation.cumulative_mSv || 0).toFixed(1) + " mSv");
    const hz = getSystem("hazards"), log = hz && hz.S ? hz.S.log.slice(-6).reverse() : [];
    $("wx-log").innerHTML = log.length ? log.map((e) => `<li class="${e.level}"><b>Sol ${e.sol} ${String(Math.floor(e.tod / HOUR)).padStart(2, "0")}:${String(Math.floor(e.tod / HOUR * 60) % 60).padStart(2, "0")}</b> ${e.text}</li>`).join("") : "<li>Nothing yet.</li>";
    const ov = hz && hz.map ? hz.map.overlay : null, L = ov && hz.map.layers.find((l) => l.id === ov.layer);
    $("btn-hazmap").textContent = "Hazard map: " + (ov && ov.on && L ? L.label.toLowerCase() : "off");
    $("btn-hazmap").disabled = !(hz && hz.map && hz.map.ready);
    $("btn-hazards").textContent = "Hazards: " + DIFF[this._diff()].split(" (")[0];
  }

  dispose() {
    const hud = this.game.hud;
    if (hud.removePanel) { hud.removePanel("weather"); hud.removePanel("hazard-legend"); }
    this.screen.remove(); this.menuBtn.remove(); this.field.remove();
  }
}
