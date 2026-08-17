/**
 * Tool search — the command palette over the tool registry, plus the
 * persistent search box at the top of the toolbox. One renderer serves both
 * entry points (the VS Code launcher pattern): the box only forwards focus,
 * so there is never a second results list to keep in step.
 *
 * Ranking is the atlas page-search algorithm, followed exactly (spec §3.3):
 * a name hit is worth 5, a keyword 3, a blurb or category word 1, an exact
 * label match +20 — and a result must score ≥3 to be offered at all. The
 * floor is the honesty mechanism: only a name or keyword hit clears it, so a
 * query the toolbox cannot answer yields "no match" instead of a confident
 * guess. Favourites and recents are TIEBREAKERS only; they can never lift a
 * sub-floor tool, which tool-search.test.mjs pins.
 *
 * openTool is deliberately NOT defined here: tool-dialog.js exports it and
 * hangs it on window.GeoIDToolSearch (spec §4.4). This module calls it when
 * present and logs when not, so the palette degrades cleanly on a page where
 * the dialog module has not loaded. The seam merge below is non-destructive
 * for the same reason — whichever module lands second must not erase the
 * other's keys.
 */

import { TOOLS, toolById } from "./tool-runner.js?v=20260817-d542f72";
import { tokenize } from "./search-text.js?v=20260817-d542f72";
// Namespace import, not named: the prefs verbs are read through optional
// access inside try/catch (the house localStorage pattern), so an API-shape
// difference degrades to "no prefs" instead of a module-link error taking
// the whole palette down with it.
import * as toolPrefs from "./tool-prefs.js?v=20260817-d542f72";

/* ── prefs, read defensively ──────────────────────────────────────────────
 *
 * Every access is try/catch → empty: prefs are seasoning on the ranking, and
 * a broken localStorage (private mode, quota) must never break search.
 * tool-prefs ships its verbs on an exported `prefs` instance (makePrefs over
 * localStorage); the module namespace itself is the fallback in case the
 * verbs ever move to top level.
 */

const FAV_KEY = "geoid-gis:tool-favourites";

function prefsApi() {
  return (toolPrefs && toolPrefs.prefs) || toolPrefs || {};
}

function readFavourites() {
  try { return prefsApi().getFavourites?.() || []; } catch { return []; }
}

function readRecents() {
  try { return prefsApi().getRecents?.() || []; } catch { return []; }
}

function isFavourite(id) {
  return readFavourites().some((entry) =>
    (typeof entry === "string" ? entry : entry && entry.id) === id);
}

function toggleFavourite(id) {
  try {
    const api = prefsApi();
    if (typeof api.toggleFavourite === "function") {
      api.toggleFavourite(id);
      return;
    }
    // Last resort writes the documented key and shape (spec §5 table)
    // directly, so the star still works if the verb moves or renames.
    const list = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    const next = list.includes(id) ? list.filter((x) => x !== id) : list.concat(id);
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  } catch (err) {
    console.error("[GeoID GIS] tool-search: favourite toggle failed", err);
  }
}

/* ── ranking — the pure part, testable under node ───────────────────────── */

/** Recents are `[{id, t}]` newest first (spec §5); a lower index is more
    recent. Plain-string entries are tolerated so a hand-edited store cannot
    crash the comparator. Missing = a large finite number, never Infinity —
    Infinity − Infinity is NaN and NaN poisons Array.sort. */
function recencyIndex(recents) {
  const map = new Map();
  (Array.isArray(recents) ? recents : []).forEach((entry, i) => {
    const id = typeof entry === "string" ? entry : entry && entry.id;
    if (id && !map.has(id)) map.set(id, i);
  });
  return map;
}

/**
 * Rank the registry against a query. Returns null for an empty/stopword-only
 * query (null = show the browse state, not "no match"), else `{tool, score}`
 * rows, best first, capped at 12.
 *
 * `opts` exists for the test file: `{tools, favourites, recents}` inject the
 * registry and prefs so the pure algorithm runs under node with no browser.
 * Callers in the page pass nothing and get TOOLS + stored prefs.
 */
export function rankTools(query, opts = {}) {
  const q = String(query == null ? "" : query);
  const tokens = tokenize(q);
  if (!tokens.length) return null;

  const tools = opts.tools || TOOLS;
  const favSet = new Set(
    (opts.favourites !== undefined ? opts.favourites : readFavourites())
      .map((entry) => (typeof entry === "string" ? entry : entry && entry.id))
      .filter(Boolean),
  );
  const recency = recencyIndex(opts.recents !== undefined ? opts.recents : readRecents());
  const recencyOf = (r) => (recency.has(r.tool.id) ? recency.get(r.tool.id) : 1e9);
  const exact = q.toLowerCase().trim();

  return tools
    .map((t) => {
      const label = String(t.label || "").toLowerCase();
      const cat = String(t.category || "").toLowerCase();
      const blurb = String(t.blurb || "").toLowerCase();
      const keys = (t.keywords || []).join(" ").toLowerCase();
      let score = 0;
      tokens.forEach((w) => {
        if (label.includes(w)) score += 5;        // name hit: 5x, the atlas weighting
        else if (keys.includes(w)) score += 3;    // synonym: below name, above blurb
        else if (blurb.includes(w) || cat.includes(w)) score += 1;
      });
      if (label === exact) score += 20;
      return { tool: t, score };
    })
    // THE FLOOR: only a label or keyword hit clears it; a blurb hit alone
    // cannot. This is what makes "no match" possible at all.
    .filter((r) => r.score >= 3)
    .sort((a, b) => b.score - a.score
      // Favourites, then recency — TIEBREAKERS only. The floor filter above
      // has already run, so prefs cannot resurrect a sub-floor tool.
      || ((favSet.has(b.tool.id) ? 1 : 0) - (favSet.has(a.tool.id) ? 1 : 0))
      || (recencyOf(a) - recencyOf(b))
      || String(a.tool.label).localeCompare(String(b.tool.label)))
    .slice(0, 12);
}

/* ── the palette styling, injected from the module (the side-panels
 *    template). NEVER a backtick inside this literal — it ends the string
 *    and kills the module silently (the zoom-bar lesson). ───────────────── */

const STYLE = `
/* Backdrop above the whole audited stack: #measurement-result-card tops out
   at 140, so the palette sits at 150. [hidden] must be restated because the
   display:flex below outranks the UA's hidden rule (the add-a-server lesson). */
.gis-tool-palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 150;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 11vh 16px 16px;
}
.gis-tool-palette-backdrop[hidden] { display: none; }

/* The panel borrows the sidebar shell tokens rather than inventing a ground. */
.gis-tool-palette {
  width: min(560px, 94vw);
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  background: var(--skin-bg, #120618);
  border: 1px solid rgba(var(--nav-accent-rgb), 0.34);
  border-radius: 10px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55),
    0 0 24px -8px rgba(var(--nav-accent-rgb), 0.5);
  color: var(--text, #fff);
  overflow: hidden;
}
.gis-tool-palette-head { padding: 10px 10px 8px; }
.gis-tool-palette-head .input { width: 100%; box-sizing: border-box; }
.gis-tool-palette-banner {
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.8;
  padding: 0 12px 6px;
}
.gis-tool-palette-results {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 6px 6px;
}
.gis-tool-palette-heading {
  font-family: "Exo 2", sans-serif;
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.55;
  padding: 10px 8px 4px;
}

/* One result row: star | label ... category chip, blurb underneath. */
.gis-tool-hit {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-areas: "fav label cat" "fav blurb blurb";
  gap: 0 8px;
  align-items: center;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  color: var(--text, #fff);
}
.gis-tool-hit:hover { background: rgba(var(--nav-accent-rgb), 0.12); }

/* The keyboard-selected row carries the ONE active rule: solid accent fill,
   dark ink (side-panels.js:72, the recorded house rule). A tinted wash would
   read as hover. */
.gis-tool-hit.is-active {
  background: rgb(var(--nav-accent-rgb));
  color: var(--skin-chrome-ink, #2b0030);
}
.gis-tool-hit.is-active .gis-tool-hit-label,
.gis-tool-hit.is-active .gis-tool-hit-cat,
.gis-tool-hit.is-active .gis-tool-hit-blurb,
.gis-tool-hit.is-active .gis-tool-hit-fav {
  color: var(--skin-chrome-ink, #2b0030);
  opacity: 1;
}
.gis-tool-hit.is-active .gis-tool-hit-cat {
  border-color: var(--skin-chrome-ink, #2b0030);
}

.gis-tool-hit-fav {
  grid-area: fav;
  opacity: 0.35;
  font-size: 0.85rem;
  line-height: 1;
  padding: 2px;
}
.gis-tool-hit-fav.is-fav {
  opacity: 1;
  color: rgb(var(--nav-accent-rgb));
}

/* Exo 2 white per the heading spec (side-panels.js:136). */
.gis-tool-hit-label {
  grid-area: label;
  font-family: "Exo 2", sans-serif;
  font-size: 0.76rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text, #fff);
}
.gis-tool-hit-cat {
  grid-area: cat;
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.55;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.25);
  border-radius: 999px;
  padding: 1px 7px;
  white-space: nowrap;
}
.gis-tool-hit-blurb {
  grid-area: blurb;
  font-size: 0.7rem;
  opacity: 0.7;
}

.gis-tool-palette-empty {
  padding: 12px 10px 4px;
  font-size: 0.74rem;
  opacity: 0.8;
}
.gis-tool-palette-foot {
  padding: 6px 12px 8px;
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  opacity: 0.5;
}

`;

let styleInjected = false;
function injectStyle() {
  if (styleInjected || document.querySelector("style[data-gis-tool-search]")) return;
  styleInjected = true;
  const tag = document.createElement("style");
  tag.dataset.gisToolSearch = "";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/* ── the palette ────────────────────────────────────────────────────────── */

const state = {
  backdrop: null,
  input: null,
  results: null,
  banner: null,
  rows: [],
  activeIndex: 0,
  inputType: null,   // chain pre-filter (spec §4.3): only tools whose first
                     // input takes this type are offered while set
};

function firstInputType(tool) {
  return tool.inputs && tool.inputs[0] && tool.inputs[0].type;
}

function visibleTools() {
  if (!state.inputType) return TOOLS;
  return TOOLS.filter((t) => firstInputType(t) === state.inputType);
}

function lookupTool(id) {
  // toolById reads the live registry; a stale favourite naming a removed tool
  // resolves to nothing and is simply not shown.
  try { return toolById(id) || null; } catch { return null; }
}

function activateTool(id) {
  close();
  const opener = window.GeoIDToolSearch && window.GeoIDToolSearch.openTool;
  if (typeof opener === "function") {
    opener(id);
  } else {
    // tool-dialog exports openTool (spec §4.4); without it the palette can
    // find a tool but not open it, and saying so beats doing nothing.
    console.warn("[GeoID GIS] tool-search: no openTool registered (tool-dialog not loaded); asked for", id);
  }
}

function buildRow(tool, favSet) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gis-tool-hit";
  btn.dataset.tool = tool.id;
  btn.setAttribute("role", "option");

  const fav = document.createElement("span");
  fav.className = "gis-tool-hit-fav" + (favSet.has(tool.id) ? " is-fav" : "");
  fav.dataset.fav = "";
  fav.textContent = "★";
  fav.title = "Toggle favourite";
  // The star toggles without opening — stopPropagation keeps the row's own
  // click from firing.
  fav.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavourite(tool.id);
    fav.classList.toggle("is-fav", isFavourite(tool.id));
  });

  const label = document.createElement("span");
  label.className = "gis-tool-hit-label";
  label.textContent = tool.label || tool.id;

  const cat = document.createElement("span");
  cat.className = "gis-tool-hit-cat";
  cat.textContent = tool.category || "";

  const blurb = document.createElement("span");
  blurb.className = "gis-tool-hit-blurb";
  blurb.textContent = tool.blurb || "";

  btn.append(fav, label, cat, blurb);
  btn.addEventListener("click", () => activateTool(tool.id));
  return btn;
}

function heading(text) {
  const div = document.createElement("div");
  div.className = "gis-tool-palette-heading";
  div.textContent = text;
  return div;
}

/** Browse state (empty query): Favourites, then Recents (≤8), then every
    tool grouped by category — the ArcGIS Pro geoprocessing pane's resting
    state. */
function renderBrowse(favSet) {
  const host = state.results;
  const tools = visibleTools();
  const inScope = new Set(tools.map((t) => t.id));

  const favTools = [...favSet].map(lookupTool)
    .filter((t) => t && inScope.has(t.id));
  if (favTools.length) {
    host.appendChild(heading("Favourites"));
    favTools.forEach((t) => { state.rows.push(host.appendChild(buildRow(t, favSet))); });
  }

  const recentTools = [];
  readRecents().forEach((entry) => {
    const id = typeof entry === "string" ? entry : entry && entry.id;
    const t = id && lookupTool(id);
    if (t && inScope.has(t.id) && !recentTools.some((r) => r.id === t.id)) recentTools.push(t);
  });
  if (recentTools.length) {
    host.appendChild(heading("Recent"));
    recentTools.slice(0, 8).forEach((t) => {
      state.rows.push(host.appendChild(buildRow(t, favSet)));
    });
  }

  // Grouped by category in registry order — the order is the registry's own,
  // never re-sorted (the rail's band rule, applied here).
  const byCat = new Map();
  tools.forEach((t) => {
    const c = t.category || "Other";
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(t);
  });
  byCat.forEach((list, c) => {
    host.appendChild(heading(c));
    list.forEach((t) => { state.rows.push(host.appendChild(buildRow(t, favSet))); });
  });
}

/** No-match state: say so, and offer the way out. Never a guess — the floor
    is the honesty mechanism. */
function renderNoMatch(query) {
  const host = state.results;
  const msg = document.createElement("div");
  msg.className = "gis-tool-palette-empty";
  msg.textContent = "No tool matches “" + query + "”.";
  host.appendChild(msg);

  const browse = document.createElement("button");
  browse.type = "button";
  browse.className = "gis-tool-hit gis-tool-browse-all";
  browse.setAttribute("role", "option");
  const label = document.createElement("span");
  label.className = "gis-tool-hit-label";
  label.textContent = "Browse all tools";
  browse.appendChild(label);
  browse.addEventListener("click", () => {
    state.input.value = "";
    render();
    state.input.focus();
  });
  state.rows.push(host.appendChild(browse));
}

function paintActive() {
  state.rows.forEach((row, i) => {
    row.classList.toggle("is-active", i === state.activeIndex);
    row.setAttribute("aria-selected", i === state.activeIndex ? "true" : "false");
  });
}

function moveActive(delta) {
  if (!state.rows.length) return;
  state.activeIndex = Math.min(state.rows.length - 1, Math.max(0, state.activeIndex + delta));
  paintActive();
  state.rows[state.activeIndex].scrollIntoView({ block: "nearest" });
}

function render() {
  const host = state.results;
  host.textContent = "";
  state.rows = [];
  state.activeIndex = 0;

  const favSet = new Set(readFavourites()
    .map((entry) => (typeof entry === "string" ? entry : entry && entry.id))
    .filter(Boolean));
  const query = state.input.value;
  const ranked = rankTools(query, state.inputType ? { tools: visibleTools() } : {});

  if (ranked === null) renderBrowse(favSet);
  else if (!ranked.length) renderNoMatch(query.trim());
  else ranked.forEach((r) => { state.rows.push(host.appendChild(buildRow(r.tool, favSet))); });

  paintActive();
}

function buildPalette() {
  if (state.backdrop || document.getElementById("gis-tool-palette-backdrop")) return;

  const backdrop = document.createElement("div");
  backdrop.className = "gis-tool-palette-backdrop";
  backdrop.id = "gis-tool-palette-backdrop";
  backdrop.hidden = true;

  const section = document.createElement("section");
  section.className = "gis-tool-palette";
  section.setAttribute("role", "dialog");
  section.setAttribute("aria-modal", "true");
  section.setAttribute("aria-label", "Tool search");

  const head = document.createElement("header");
  head.className = "gis-tool-palette-head";
  const input = document.createElement("input");
  input.id = "gis-tool-palette-input";
  input.className = "input";
  input.type = "search";
  input.placeholder = "Search tools…";
  input.setAttribute("aria-label", "Search tools");
  head.appendChild(input);

  const banner = document.createElement("div");
  banner.className = "gis-tool-palette-banner";
  banner.hidden = true;

  const results = document.createElement("div");
  results.id = "gis-tool-palette-results";
  results.className = "gis-tool-palette-results";
  results.setAttribute("role", "listbox");

  const foot = document.createElement("footer");
  foot.className = "gis-tool-palette-foot";
  foot.textContent = "↑↓ select · Enter open · Esc close";

  section.append(head, banner, results, foot);
  backdrop.appendChild(section);
  document.body.appendChild(backdrop);

  // Clicking the dark ground dismisses; clicking the panel does not.
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });

  input.addEventListener("input", render);

  // Escape/arrows/Enter live on the palette, where focus is while it is open
  // (house style: atlas-assistant.js:914, layer-export-dialog.js:229).
  section.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const row = state.rows[state.activeIndex];
      if (row) row.click();
    }
  });

  state.backdrop = backdrop;
  state.input = input;
  state.results = results;
  state.banner = banner;
}

/**
 * Open the palette. `opts` carries the chaining contract (spec §4.3):
 * `{inputType}` pre-filters to tools whose first input takes that type, and
 * `{banner}` shows the one-line "Chaining <name> into…" note.
 */
export function open(query = "", opts = {}) {
  if (!state.backdrop) return;
  state.inputType = opts.inputType || null;
  if (state.banner) {
    state.banner.textContent = opts.banner || "";
    state.banner.hidden = !opts.banner;
  }
  state.backdrop.hidden = false;
  state.input.value = query || "";
  render();
  state.input.focus();
}

export function close() {
  if (!state.backdrop) return;
  state.backdrop.hidden = true;
  state.inputType = null;
  if (state.banner) state.banner.hidden = true;
}

/* ── keyboard shortcut ──────────────────────────────────────────────────── */

/** The mandatory text-entry exemption for any document-level keydown (the
    space-bar lesson): typing "/" into a form field must type a slash. */
function isTextEntry(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const skip = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "file", "color"]);
    return !skip.has(el.type);
  }
  return false;
}

function onDocumentKeydown(e) {
  if (isTextEntry(e.target)) return;
  // "/" leads: reachable and web-conventional. Ctrl+Alt+T is QGIS parity,
  // best-effort — on stock Ubuntu the OS takes that chord for a terminal
  // before the browser ever sees it.
  const slash = e.key === "/" && !e.ctrlKey && !e.altKey && !e.metaKey;
  const chord = (e.key === "t" || e.key === "T") && e.ctrlKey && e.altKey && !e.metaKey;
  if (!slash && !chord) return;
  e.preventDefault();
  open("");
}

/* ── install ────────────────────────────────────────────────────────────── */

let installed = false;
function installToolSearch() {
  if (installed) return true;
  if (!document.body) return false;
  injectStyle();
  buildPalette();
  document.addEventListener("keydown", onDocumentKeydown);
  // Merged, never assigned: tool-dialog hangs openTool on this same object
  // (spec §4.4), and load order between the two modules is not promised.
  window.GeoIDToolSearch = Object.assign(window.GeoIDToolSearch || {}, {
    open,
    close,
    rank: rankTools,
  });
  installed = true;
  return true;
}

if (typeof document !== "undefined") {
  // The palette and the "/" shortcut need only <body>. There is nothing else
  // to wait for now: the search bar that used to sit in the toolbox tab bar
  // is gone, because the rail's Search button opens this same palette and a
  // second, permanently visible way in was taking a row of the sidebar to
  // duplicate a button.
  let tries = 0;
  const attempt = () => {
    if (installToolSearch() || (tries += 1) > 60) return;
    setTimeout(attempt, 500);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attempt);
  } else {
    attempt();
  }
}
