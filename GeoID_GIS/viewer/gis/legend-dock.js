/**
 * One legend, over the scene.
 *
 * The key to what is drawn used to live in three places at once: an overlay
 * legend buried in Explorer > Legend, a second key for the interior shells
 * inside Core View, and a third list of imported layers in the drop-down at the
 * top right. All three describe the same picture, and none of them is where you
 * are looking when you want to read it -- two were folded inside tabs you had
 * to go and open.
 *
 * So the drop-down becomes the only one. The tab-bar sections keep rendering
 * (their code is untouched) but are no longer shown; this module collects what
 * they produce and puts it over the scene, where the thing being described is.
 *
 * Mirrored rather than re-rendered. The overlay entries are the DOM the viewer
 * already builds, cloned -- so "formatted the same way as the main tab bar" is
 * true by construction and stays true when a viewer changes what it emits,
 * rather than being a second renderer that has to be kept in step. Nine of the
 * ten viewers never had this drop-down in their markup at all; it is created
 * here when missing, which is the same reason every other shared control in
 * this directory carries its own markup and stylesheet.
 */

const DOCK_ID = "map-legend";
const PANEL_ID = "map-legend-panel";
const TOGGLE_ID = "map-legend-toggle";

/**
 * Render order. Imported layers first because they are the user's own work and
 * the reason they opened a GIS; the viewer's overlays next; the interior
 * cutaway after them, since it describes the globe rather than anything on it;
 * and the basemap last of all, because it is the floor everything else is drawn
 * on top of -- the legend then reads down the stack exactly as the layer list
 * does.
 */
export const SOURCE_ORDER = ["layers", "overlays", "core", "basemap"];

/** Flatten the published sources into one ordered list. */
export function mergeSources(bySource, order = SOURCE_ORDER) {
  const out = [];
  const push = (id) => {
    for (const entry of bySource[id] || []) out.push({ ...entry, source: id });
  };
  order.forEach(push);
  // A source nobody declared an order for still shows, at the end, rather than
  // being silently dropped -- a legend that hides entries is worse than one in
  // an unexpected order.
  Object.keys(bySource).filter((id) => !order.includes(id)).sort().forEach(push);
  return out;
}

/**
 * What makes an entry the same entry across two renders. Titles are the usual
 * answer, but not every card has one -- some viewers emit a bare list of
 * swatches -- and keying those all as "" would make two different untitled
 * cards look like one, so what the card says stands in for a name it lacks.
 */
export function entryKey(entry) {
  return `${entry.source}::${entry.title || signatureOf(entry)}`;
}

/**
 * What makes two cards the same card even when they came from different
 * sources. Mars is the case: its viewer already lists the interior shells in
 * the overlay legend, so the cutaway this module builds from Core View's own
 * rows arrived beside an identical set and the shells were named twice. Earth
 * does not emit them there, so the built card is still needed -- the collision
 * has to be detected rather than assumed either way.
 *
 * Symbol labels are the identity where a card has them, since that is what the
 * card actually says; the title only stands in when there are none.
 */
export function signatureOf({ title, labels }) {
  const set = (labels || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean).sort();
  return set.length ? `symbols:${set.join("|")}` : `title:${String(title || "").trim().toLowerCase()}`;
}

/**
 * One card per thing described. Where two collide the titled one wins -- an
 * untitled card is a list of swatches with nothing saying what it is a list of,
 * which is exactly what Mars's overlay copy was.
 */
export function dedupe(entries) {
  const chosen = new Map();
  for (const entry of entries) {
    const sig = signatureOf(entry);
    const held = chosen.get(sig);
    // Kept at the position it was first seen, so deduping cannot reorder the
    // legend as a side effect.
    if (!held || (!held.title && entry.title)) chosen.set(sig, entry);
  }
  return [...chosen.values()];
}

/**
 * Which keys were not there last time. This is the whole auto-open rule: the
 * drop-down opens when something arrives, not merely when something is
 * present -- otherwise it would spring open again on every unrelated redraw and
 * could never be dismissed.
 */
export function arrivals(previousKeys, nextKeys) {
  const before = new Set(previousKeys);
  return nextKeys.filter((key) => !before.has(key));
}

/* ─────────────────────────────── the page ─────────────────────────────── */

const STYLE = `
/* The drop-down holds cards now, so the terse row layout that used to style
   .legend-entry here is undone. Both layouts were fighting already: the tab
   bar's cards were picking up display:flex from this drop-down's rule and
   laying their badge, copy and chips out in a single squashed line. */
#map-legend-panel .legend-entry {
  display: block;
  align-items: initial;
  gap: 0;
  padding: 0.6rem 0.65rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.7rem;
  background: rgba(255, 255, 255, 0.05);
}
#map-legend-panel .legend-entry + .legend-entry { margin-top: 0.45rem; border-top-width: 1px; }
#map-legend-panel { width: 17.5rem; max-height: min(62vh, 34rem); display: block; }
/* ...and the one rule that makes the hidden attribute mean anything here.
   NO BACKTICKS in this block -- it is a template literal and one ends it.

   The attribute is only a UA-level display:none, and the line above sets
   display from an ID selector, which outranks it -- so the panel was painted
   whatever the attribute said. Every open and close in this file set it
   faithfully and nothing moved: the drop-down stood open from boot, the toggle
   looked dead, and the auto-open rule that was tuned three times over had no
   visible effect at all. !important, because the ID rule would otherwise win
   again on specificity alone.

   Measured before: panel.hidden was true while getComputedStyle(panel).display
   was "block" and the box was a real size on screen. Assert the PAINT, never
   the property -- the property was right the whole time. */
#map-legend-panel[hidden] { display: none !important; }
#map-legend-panel .layer-type-badge { margin: 0 0 0.3rem; }
#map-legend-panel .metadata-section-copy { margin: 0 0 0.35rem; font-size: 0.72rem; line-height: 1.45; }
#map-legend-panel .legend-symbol-list { margin-top: 0.45rem; gap: 0.4rem; }
#map-legend-panel .legend-symbol-label { font-size: 0.74rem; }
#map-legend-panel .legend-symbol-detail { font-size: 0.68rem; }
#map-legend-panel .legend-entry-image { margin-top: 0.5rem; }
#map-legend-panel .legend-entry-head {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
/* The caret is the affordance -- a heading that folds has to look like one. */
#map-legend-panel .legend-entry-head::before {
  content: "▾";
  font-size: 0.6rem;
  opacity: 0.75;
  transition: transform 0.15s ease;
}
#map-legend-panel .legend-entry.is-folded .legend-entry-head::before { transform: rotate(-90deg); }
#map-legend-panel .legend-entry.is-folded { padding-bottom: 0.45rem; }
#map-legend-panel .legend-entry-body[hidden] { display: none; }


/* A classed legend is a list of swatches, and a swatch needs a SIZE.
   The class swatch is a bare span -- display: inline, so a background
   colour paints across a box 0px wide. Measured: 23 rows, every colour correct
   in the inline style and computed style, every swatch 0 x 14. The key read as
   a bulleted list of unit names with no symbology at all, which is exactly what
   it was. The other legend shapes here inherit their swatch from styles.css;
   these classes are newer and had no rule anywhere in the tree. */
#map-legend-panel .legend-classes { margin-top: 0.5rem; display: grid; gap: 0.28rem; }
#map-legend-panel .legend-class {
  display: grid;
  grid-template-columns: 0.85rem 1fr;
  gap: 0.45rem;
  align-items: start;
}
#map-legend-panel .legend-class-swatch {
  display: block;
  width: 0.85rem;
  height: 0.85rem;
  margin-top: 0.12rem;
  border-radius: 0.2rem;
  border: 1px solid rgba(255, 255, 255, 0.35);
}
#map-legend-panel .legend-class-label {
  font-size: 0.72rem;
  line-height: 1.35;
  /* A BGS unit name runs to eighty characters. Wrapping keeps the swatch beside
     the whole of it rather than beside a truncated first word. */
  overflow-wrap: anywhere;
}

/* The keyword pills go. In a tab you had opened on purpose they were a way of
   saying what kind of overlay this was; over the map the heading already says
   it, and the pills repeated it in a second visual language while pushing the
   swatches -- the part you actually read against the scene -- further down.
   Hidden rather than stripped from the clone, so this stays a mirror of what
   the viewer emits and restoring them is deleting a rule. */
#map-legend-panel .result-chip-row { display: none; }

/* The scroll bar was the browser default: a white slab against a dark
   translucent panel, brighter than anything it sat beside. Thin, accent-tinted
   and on a transparent track, which is what #ui-scroll-body already does -- the
   same shape of control should not be a different colour in two corners of the
   same GUI. */
#map-legend-panel {
  scrollbar-width: thin;
  scrollbar-color: rgba(var(--nav-accent-rgb), 0.32) transparent;
}
#map-legend-panel::-webkit-scrollbar { width: 0.7rem; }
#map-legend-panel::-webkit-scrollbar-track { background: transparent; }
#map-legend-panel::-webkit-scrollbar-thumb {
  background: rgba(var(--nav-accent-rgb), 0.28);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
#map-legend-panel::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--nav-accent-rgb), 0.45);
  background-clip: padding-box;
}

/* Transferred, not duplicated: the two tab-bar homes stop being shown. Left in
   the DOM and still rendering, because this dock mirrors what they produce --
   hiding them is what moves them, and restoring them is deleting two rules. */
#legend-section { display: none !important; }
.core-legend { display: none !important; }

/* The dock's own head reads as the tab bar's controls do rather than as the
   cyan chrome it inherited, so a legend over the map and a legend in the bar
   are recognisably the same feature. */
.map-legend-toggle {
  border-color: rgba(var(--nav-accent-rgb), 0.4);
  font-family: "Exo 2", "Segoe UI", sans-serif;
  font-weight: 600;
  letter-spacing: 0.1em;
}
.map-legend-toggle[aria-expanded="true"] {
  background: rgb(var(--nav-accent-rgb));
  border-color: rgb(var(--nav-accent-rgb));
  color: var(--skin-chrome-ink, #2b0030) !important;
}
`;

function injectStyle() {
  if (document.getElementById("geoid-legend-dock-style")) return;
  const tag = document.createElement("style");
  tag.id = "geoid-legend-dock-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

const ICON = '<svg viewBox="0 0 16 16"><path d="M3 4.2h10M3 8h10M3 11.8h6.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

/** Earth ships this markup; the nine planet pages do not, so it is built. */
function ensureDock() {
  let dock = document.getElementById(DOCK_ID);
  if (!dock) {
    dock = document.createElement("div");
    dock.id = DOCK_ID;
    dock.className = "map-legend";
    dock.hidden = true;
    dock.innerHTML = `<button type="button" id="${TOGGLE_ID}" class="map-legend-toggle" aria-expanded="false">`
      + `<span class="map-legend-icon" aria-hidden="true">${ICON}</span>`
      + `<span>Legend</span>`
      + `<span class="map-legend-caret" aria-hidden="true">&#9662;</span>`
      + `</button>`
      + `<div class="map-legend-panel" id="${PANEL_ID}" hidden></div>`;
  }
  // Fixed positioning only works from the body: parsed where it sits in the
  // markup it can end up inside a control that establishes its own containing
  // block. Earth's copy is moved for the same reason by layer-hierarchy.
  if (dock.parentElement !== document.body) document.body.appendChild(dock);
  const toggle = document.getElementById(TOGGLE_ID);
  if (toggle && !toggle.dataset.legendBound) {
    toggle.dataset.legendBound = "1";
    toggle.addEventListener("click", () => setOpen(!isOpen(), { byUser: true }));
  }
  return dock;
}

function isOpen() {
  const panel = document.getElementById(PANEL_ID);
  return Boolean(panel) && !panel.hidden;
}

/**
 * Closed BY HAND stays closed.
 *
 * The dock opens itself when a layer arrives, which is right the first time and
 * insufferable afterwards: close it, add a layer or switch one off, and it was
 * open again -- so it could not be dismissed, only postponed. A person closing
 * it is a decision about the panel rather than about any one layer, so it is
 * remembered until they open it again. `arrivals()` still decides whether
 * anything is new; this decides whether we are allowed to act on that.
 */
let dismissed = false;

function setOpen(open, { byUser = false } = {}) {
  const panel = document.getElementById(PANEL_ID);
  const toggle = document.getElementById(TOGGLE_ID);
  if (!panel) return;
  if (byUser) dismissed = !open;
  panel.hidden = !open;
  toggle?.setAttribute("aria-expanded", open ? "true" : "false");
  // The events feed sits beside this and sizes itself from it.
  window.dispatchEvent(new CustomEvent("geoid:legend-changed"));
}

/* ────────────────────────────── the sources ───────────────────────────── */

/** sourceId -> array of { title, labels, node } */
const published = new Map();
let lastKeys = [];

/** A card's own name, if it gives one. */
function titleOf(node) {
  return node.dataset?.legendKey
    || node.querySelector(".layer-type-badge")?.textContent?.trim()
    || node.querySelector(".legend-name")?.textContent?.trim()
    || "";
}

/** What the card actually says, which is how a duplicate is recognised. */
function labelsOf(node) {
  return [...node.querySelectorAll(".legend-symbol-label")].map((el) => el.textContent.trim());
}

/**
 * Hand the dock a set of ready-made .legend-entry sections for one source.
 * Passing an empty array retires that source.
 */
export function publish(sourceId, nodes) {
  published.set(sourceId, (nodes || []).map((node) => ({
    title: titleOf(node),
    labels: labelsOf(node),
    node,
  })));
  render();
}

function bySource() {
  const out = {};
  for (const [id, entries] of published) out[id] = entries;
  return out;
}

function render() {
  const dock = ensureDock();
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const merged = dedupe(mergeSources(bySource()));
  // Keyed after deduping, so a card that loses a collision does not count as an
  // arrival and spring the panel open for something that is not shown.
  /**
   * What may spring the panel open.
   *
   * The auto-open rule is "something arrived", and switching basemap makes the
   * basemap card a different card -- a new key, an arrival, the drop-down in
   * your face for something you did on purpose and can see on the globe. A card
   * can opt out of counting as an arrival; it is still rendered, still keyed,
   * still deduped, it just never argues for opening the panel.
   */
  const keys = merged.filter((entry) => entry.node?.dataset?.legendAutoOpen !== "never")
    .map(entryKey);
  const nodes = merged.map((entry) => entry.node).filter(Boolean);

  panel.replaceChildren(...nodes);
  dock.hidden = nodes.length === 0;
  // Announced on <body> so the events feed can take this corner when there is
  // no legend in it, without either knowing about the other's markup.
  document.body.dataset.legend = nodes.length ? "true" : "false";

  const fresh = arrivals(lastKeys, keys);
  lastKeys = keys;
  nodes.forEach(makeFoldable);
  if (!nodes.length) { setOpen(false); return; }
  if (fresh.length && !dismissed) setOpen(true);
  else window.dispatchEvent(new CustomEvent("geoid:legend-changed"));
}


/* ── folding one card ───────────────────────────────────────────────────── */

/**
 * Which cards are folded, by name, so a re-render does not unfold them.
 *
 * The dock is rebuilt from scratch whenever anything publishes, and the cards
 * are new nodes each time -- state kept on the element would last until the
 * next layer changed and no longer.
 */
const folded = new Set();

/** Keys whose start-folded default has already been applied. */
const seenFold = new Set();

/**
 * Make a legend card fold, from its own heading.
 *
 * Two geology sheets are 23 rows of unit names, which fills the drop-down and
 * buries whatever is under them. Folding is per card because that is the unit
 * of the question: you are reading one layer's key and want the others out of
 * the way, not the whole legend gone.
 *
 * The heading becomes the control -- there is nowhere else to put one, and it
 * is the part you are already looking at. Everything after it is wrapped once
 * and hidden as a block, so this works for any card the dock is handed
 * whatever built it: layer cards, the viewer's overlays, the interior cutaway.
 */
function makeFoldable(card) {
  if (!card || card.dataset.foldable === "1") return;
  const badge = card.querySelector(".layer-type-badge, .legend-name");
  if (!badge) return;
  card.dataset.foldable = "1";
  const key = card.dataset.legendKey || badge.textContent.trim();

  const body = document.createElement("div");
  body.className = "legend-entry-body";
  let node = badge.nextSibling;
  while (node) {
    const next = node.nextSibling;
    body.appendChild(node);
    node = next;
  }
  card.appendChild(body);

  badge.classList.add("legend-entry-head");
  badge.setAttribute("role", "button");
  badge.setAttribute("tabindex", "0");
  const apply = (isFolded) => {
    card.classList.toggle("is-folded", isFolded);
    body.hidden = isFolded;
    badge.setAttribute("aria-expanded", isFolded ? "false" : "true");
  };
  /**
   * A card may ask to start folded, once.
   *
   * "Once" is the whole of it: the default applies the first time a key is
   * seen, and after that the user's own folding is what decides -- otherwise
   * every re-render would slam it shut again while somebody was reading it.
   */
  if (!seenFold.has(key)) {
    seenFold.add(key);
    if (card.dataset.legendFold === "collapsed") folded.add(key);
  }
  apply(folded.has(key));
  const flip = () => {
    const next = !folded.has(key);
    if (next) folded.add(key); else folded.delete(key);
    apply(next);
    // The panel changed height, and the events feed measures it.
    window.dispatchEvent(new CustomEvent("geoid:legend-changed"));
  };
  badge.addEventListener("click", flip);
  badge.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); flip(); }
  });
}

/* ── overlays: whatever the viewer put in the tab bar's legend panel ────── */

function readOverlays() {
  const source = document.getElementById("legend-panel");
  if (!source) return [];
  return [...source.querySelectorAll(":scope > .legend-entry")].map((node) => node.cloneNode(true));
}

function watchOverlays() {
  const source = document.getElementById("legend-panel");
  if (!source) return;
  const sync = () => publish("overlays", readOverlays());
  new MutationObserver(sync).observe(source, { childList: true, subtree: true });
  sync();
}

/* ── core: the interior shells, listed only while the cutaway is on ─────── */

function buildCoreEntry() {
  const rows = [...document.querySelectorAll(".core-legend .core-legend-row")];
  if (!rows.length) return null;
  const card = document.createElement("section");
  card.className = "legend-entry";
  card.dataset.legendKey = "Interior cutaway";
  const badge = document.createElement("p");
  badge.className = "layer-type-badge";
  badge.textContent = "Interior cutaway";
  card.appendChild(badge);
  const list = document.createElement("div");
  list.className = "legend-symbol-list";
  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "legend-symbol-row";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    const from = row.querySelector(".core-swatch");
    if (from) swatch.style.background = from.style.background || getComputedStyle(from).backgroundColor;
    line.appendChild(swatch);
    const copyWrap = document.createElement("div");
    copyWrap.className = "legend-symbol-copy";
    const label = document.createElement("div");
    label.className = "legend-symbol-label";
    label.textContent = row.querySelector(".core-legend-label")?.textContent || "";
    copyWrap.appendChild(label);
    const detailText = row.querySelector(".core-legend-copy")?.textContent;
    if (detailText) {
      const detail = document.createElement("div");
      detail.className = "legend-symbol-detail";
      detail.textContent = detailText;
      copyWrap.appendChild(detail);
    }
    line.appendChild(copyWrap);
    list.appendChild(line);
  }
  card.appendChild(list);
  return card;
}

function syncCore() {
  const on = document.getElementById("core-toggle")?.checked;
  const card = on ? buildCoreEntry() : null;
  publish("core", card ? [card] : []);
}

function watchCore() {
  const toggle = document.getElementById("core-toggle");
  if (!toggle) return;
  toggle.addEventListener("change", syncCore);
  syncCore();
}

/* ──────────────────────────────── start ───────────────────────────────── */

function init() {
  injectStyle();
  ensureDock();
  watchOverlays();
  watchCore();
  render();
}

// Guarded so the ordering and auto-open rules above can be imported and tested
// under node, where there is no page to build a dock in.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.GeoIDLegendDock = { publish, isOpen, setOpen, SOURCE_ORDER };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
