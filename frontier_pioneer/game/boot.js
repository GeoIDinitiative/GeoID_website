/**
 * The shell: the MARS: FRONTIER PIONEER title (title.js), the development site picker (?dev), loading, menus. Everything here is DOM
 * wiring around one Game; nothing in the game depends on it.
 */
import { Game } from "./main.js?v=6d37c9c-9b39e129";
import { SITES } from "./site.js?v=6d37c9c-9b39e129";
import { install } from "./diag.js?v=6d37c9c-9b39e129";
import { KEYBOARD_HELP, DRIVING_HELP } from "./input.js?v=6d37c9c-9b39e129";
import { hasSave, clockText } from "./state.js?v=6d37c9c-9b39e129";
import { MARS, QUALITY } from "./config.js?v=6d37c9c-9b39e129";
import { fmtDistance } from "./hud.js?v=6d37c9c-9b39e129";
import { mountLauncher } from "./launcher.js?v=6d37c9c-9b39e129";
import { openBigMap } from "./bigmap.js?v=6d37c9c-9b39e129";
import { installPadNav } from "./padnav.js?v=6d37c9c-9b39e129";
import { mountTitle, campaign, hasCampaign, campaignEntry } from "./title.js?v=6d37c9c-9b39e129";
import { getSystem } from "./systems.js?v=6d37c9c-9b39e129";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const headless = params.has("shot");
// The game is the campaign: no site picking. The picker (launcher.js) is for development (?dev) and the headless tests.
const dev = params.has("dev") || headless;
const P = window.GeoIDPad || null;
const SCREENS = ["screen-story", "screen-title", "screen-loading", "screen-menu", "screen-settings", "screen-help", "screen-complete"];
const fatal = (msg) => { const f = $("fatal"); f.textContent = msg; f.hidden = false; };
window.addEventListener("error", (e) => fatal("Error: " + (e.message || e.error)));
window.addEventListener("unhandledrejection", (e) => fatal("Error: " + (e.reason && e.reason.message || e.reason)));

let game;
try { game = new Game($("scene"), { headless }); }
catch (e) { fatal("WebGL 2 is needed and could not be started: " + e.message); throw e; }
if (params.get("q") && QUALITY[params.get("q")]) game.setQuality(params.get("q"));
// the interface switches (uiman.js): a section in Settings, the three presets in the pause menu
game.hud.ui.mountSettings($("settings-slot"));
game.hud.ui.mountMenu(document.querySelector("#screen-menu .col"), $("btn-menu-settings"));

let chosen = null, stack = [];

function show(id, focus = true) {
  for (const s of SCREENS) $(s).hidden = s !== id;
  if (id && focus && P && P.connected) setTimeout(() => { if (!$(id).hidden) P.focus.first($(id)); }, 60);
  else if (P) P.focus.clear();
}
function open(id) { stack.push(SCREENS.find((s) => !$(s).hidden) || null); show(id); }
function back() { const prev = stack.pop(); show(prev || null); if (!prev && game.mode === "menu") game.pause(false); }

/* ── title: the site list ───────────────────────────────────────────────*/
async function buildSiteList() {
  const list = $("site-list");
  for (const entry of SITES) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "site"; b.setAttribute("aria-pressed", "false");
    b.innerHTML = `<h3>${entry.name}</h3><span class="where">&nbsp;</span><p>Reading the site manifest&hellip;</p>`;
    list.appendChild(b);
    try {
      const r = await fetch(entry.path + (params.has("lite") ? "site.lite.json" : "site.json"), { cache: "no-cache" });
      if (!r.ok) throw new Error("no tiles");
      const m = await r.json();
      const g = m.grid, km = (v) => (v / 1000).toFixed(1);
      b.innerHTML = `<h3>${m.name}</h3><span class="where">${g.lat0_deg.toFixed(2)}&deg; N ${g.lon0_deg.toFixed(2)}&deg; E</span>
        <p>${m.blurb} ${km(g.size_true_m[0])} &times; ${km(g.size_true_m[1])} km.</p>
        <span class="q"><b>Data</b>${m.quality}. Finer than that is generated, and labelled.</span>
        <span class="q"><b>Objective</b>Drive Perseverance's route: ${m.pois.map((p) => p.name).join(" &rarr; ")}.</span>`;
      b.addEventListener("click", () => select(entry, b));
      if (!chosen) select(entry, b);
    } catch (e) {
      b.disabled = true;
      b.querySelector("p").textContent = "Terrain tiles for this site are not installed (run tools/build_site.py).";
    }
  }
}
function select(entry, button, off = null) {
  if (!entry) {             // the launcher: a pin that cannot be played (locked, or its data is not prepared)
    chosen = null; $("btn-drive").disabled = true; $("btn-new").hidden = true;
    $("btn-drive").textContent = off && off.status === "locked" ? "Locked" : "Not prepared";
    return;
  }
  chosen = entry;
  document.querySelectorAll(".site").forEach((s) => s.setAttribute("aria-pressed", String(s === button)));
  const saved = hasSave(entry.id);
  $("btn-drive").disabled = false;
  $("btn-drive").textContent = saved ? "Continue" : "Start driving";
  $("btn-new").hidden = !saved;
}

async function begin(fresh) {
  if (!chosen || game.mode === "loading") return;
  stack = [];
  show("screen-loading", false);
  const c = campaign();
  $("load-act").textContent = dev ? "Development" : (fresh ? "Prologue" : c.act || "");
  $("load-chapter").textContent = dev ? chosen.name : (fresh ? "Landfall" : c.chapter || chosen.name);
  $("load-site").textContent = chosen.name;
  try {
    if (game.ready) { if (fresh) game.restart(); }
    else {
      await game.boot(chosen, { fresh, onProgress: (f, step, detail) => {
        $("load-bar").style.width = Math.round(f * 100) + "%"; $("load-step").textContent = step; $("load-detail").textContent = detail || " ";
      } });
    }
  } catch (e) { fatal("Could not load the site: " + e.message); show(dev ? "screen-title" : "screen-story"); game.mode = "title"; throw e; }
  show(null);
  syncMenu();
  game.start();
  game.announceObjective();
  updateTouch();
  // the story takes it from here (story.js, when installed): a new campaign opens on the prologue
  const story = !dev && getSystem("story"), api = story && story.api;
  if (api && fresh && typeof api.newCampaign === "function") api.newCampaign();
}

/* ── menus ──────────────────────────────────────────────────────────────*/
function syncMenu() {}
function syncSettings() {
  const s = game.settings;
  $("set-quality").value = s.quality; $("set-invert").checked = s.invertY; $("set-shadows").checked = s.shadows;
  $("set-dof").checked = s.dof !== false; $("set-grain").checked = s.grain !== false;
  $("set-units").value = s.units; $("set-touch").value = s.touch;
}
function updateTouch() {
  const s = game.settings.touch;
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  $("touch").hidden = !(game.mode === "driving" && (s === "on" || (s === "auto" && coarse)));
}
function openMenu() { if (game.mode === "driving") game.pause(true); syncMenu(); stack = []; show("screen-menu"); }

game.on("mode", () => updateTouch());
game.on("padmenu", () => { syncMenu(); stack = []; show("screen-menu"); });
game.on("padresume", () => { stack = []; show(null); game.pause(false); });
game.on("menukey", () => {
  const openNow = SCREENS.find((s) => !$(s).hidden);
  if (game.mode === "driving") openMenu();
  else if (openNow === "screen-menu") { show(null); game.pause(false); }
  else if (openNow && openNow !== "screen-title" && openNow !== "screen-story" && openNow !== "screen-loading" && openNow !== "screen-complete") back();
});
game.on("helpkey", () => { if ($("screen-help").hidden) { if (game.mode === "driving") game.pause(true); open("screen-help"); } else back(); });
game.on("complete", (sum) => {
  $("done-dist").textContent = fmtDistance(sum.distance_m, game.settings.units);
  $("done-energy").textContent = sum.energy_kWh.toFixed(1) + " kWh";
  $("done-sols").textContent = sum.sols.toFixed(2);
  stack = []; show("screen-complete");
});

$("btn-drive").addEventListener("click", () => begin(false));
$("btn-new").addEventListener("click", () => begin(true));
$("btn-controls").addEventListener("click", () => open("screen-help"));
$("btn-settings").addEventListener("click", () => { syncSettings(); open("screen-settings"); });
$("btn-resume").addEventListener("click", () => { stack = []; show(null); game.pause(false); });
$("btn-save").addEventListener("click", () => { $("btn-save").textContent = game.save() ? "Saved" : "Could not save"; setTimeout(() => { $("btn-save").textContent = "Save now"; }, 1500); });
$("btn-menu-settings").addEventListener("click", () => { syncSettings(); open("screen-settings"); });
$("btn-menu-controls").addEventListener("click", () => open("screen-help"));
$("btn-menu-map").addEventListener("click", () => openBigMap(game));
$("btn-restart").addEventListener("click", () => { game.restart(); stack = []; show(null); game.pause(false); game.announceObjective(); });
$("btn-quit").addEventListener("click", () => { game.save(); location.href = home(); });
$("btn-settings-close").addEventListener("click", back);
$("btn-help-close").addEventListener("click", back);
$("btn-continue").addEventListener("click", () => { stack = []; show(null); game.setMode("driving"); });
$("btn-done-quit").addEventListener("click", () => { game.save(); location.href = home(); });
$("set-quality").addEventListener("change", (e) => { game.setQuality(e.target.value); game.applySettings(); if (game.ready) game.tick(0); });
$("set-invert").addEventListener("change", (e) => { game.settings.invertY = e.target.checked; game.applySettings(); });
$("set-shadows").addEventListener("change", (e) => { game.settings.shadows = e.target.checked; game.applySettings(); if (game.ready) game.tick(0); });
$("set-dof").addEventListener("change", (e) => { game.settings.dof = e.target.checked; game.applySettings(); if (game.ready) game.tick(0); });
$("set-grain").addEventListener("change", (e) => { game.settings.grain = e.target.checked; game.applySettings(); if (game.ready) game.tick(0); });
$("set-units").addEventListener("change", (e) => { game.settings.units = e.target.value; game.applySettings(); });
$("set-touch").addEventListener("change", (e) => { game.settings.touch = e.target.value; game.applySettings(); updateTouch(); });

$("help-keys").innerHTML = KEYBOARD_HELP.map(([k, t]) => `<dt>${k}</dt><dd>${t}</dd>`).join("");
$("help-pad").innerHTML = DRIVING_HELP.filter((e) => e.control && !e.unused).map((e) => {
  const g = P ? e.control.split(/\s+/).map((c) => P.glyph(c)).join(" ") : e.control;
  return `<dt>${g}</dt><dd>${e.text}</dd>`;
}).join("");

// Never lose progress to a closed tab; never keep the sticks when the page is not the one being played.
window.addEventListener("pagehide", () => game.save());
document.addEventListener("visibilitychange", () => { if (document.hidden && game.mode === "driving") { game.save(); if (!headless) openMenu(); } });

install(game, { begin });
installPadNav(game);          // the left stick moves the selection in the menus (the pad is the game's while it is in front: padhost.js)
const home = () => { const q = new URLSearchParams(location.search); q.delete("continue"); const t = q.toString(); return location.pathname + (t ? "?" + t : ""); };
if (!dev) {
  // MARS: FRONTIER PIONEER: the campaign's title (title.js); the site comes from the campaign
  const title = mountTitle($("screen-story"), {
    begin: (entry, fresh) => { chosen = entry; begin(fresh); },
    settings: () => { syncSettings(); open("screen-settings"); },
    controls: () => open("screen-help"),
    save: () => game.ready && game.save(),
  });
  show("screen-story", false);
  if (P && P.connected) P.focus.first($("screen-story"));
  if (params.has("continue") && hasCampaign()) { chosen = campaignEntry(); begin(false); }
  void title;
} else show("screen-title", false);
// The site launcher (launcher.js: a globe, pins, a site card, from sites/index.json); the plain list is the fallback. Development only.
if (dev) mountLauncher({ list: $("site-list"), screen: $("screen-title"), lite: params.has("lite"), select })
  .catch((e) => { console.warn("[launcher] falling back to the site list:", e.message); $("site-list").innerHTML = ""; return buildSiteList(); })
  .then(() => { if (P && P.connected) P.focus.first($("screen-title")); });
