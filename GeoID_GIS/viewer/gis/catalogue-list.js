/**
 * A catalogue as a LIST OF TOGGLES, not a dropdown.
 *
 * A `<select>` says "choose one". Both dataset catalogues — the global vectors
 * and the Earth Engine rasters — are lists of things you switch on and off,
 * often several at once: coastlines under rivers under borders, rainfall beside
 * elevation. The dropdown made that a sequence of one-at-a-time picks with no
 * way to see what was already on, and no way to take one off again except
 * through the layer box.
 *
 * So each entry gets a tick box that means "on the globe", and, once it is on,
 * a Symbology button that opens the panel already pointed at that layer. What
 * a tick actually does is the caller's business: this only draws the list, asks
 * the caller whether an entry is loaded, and reports the presses.
 *
 * Everything downstream is unchanged and stays that way — a toggled dataset is
 * an ordinary imported layer, so it appears in Layer Visibility, in the legend,
 * in extraction and in export without this file knowing anything about them.
 */

import { openSymbologyDialog } from "./symbology-dialog.js?v=20260831-e579da0";

const STYLE = `
/* NEVER a backtick in this block -- it is a template literal and one ends it. */
.gis-catalogue { display: flex; flex-direction: column; gap: 0.12rem; }
.gis-catalogue-group {
  font-size: 0.6rem;
  font: 500 0.56rem/1.4 'Exo 2', sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.6;
  margin: 0.35rem 0 0.1rem;
}
.gis-catalogue-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.25rem;
  border-radius: 0.25rem;
}
.gis-catalogue-row:hover { background: rgba(255, 255, 255, 0.05); }
.gis-catalogue-row input { flex: 0 0 auto; }
.gis-catalogue-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 400 0.78rem/1.4 'Exo 2', sans-serif;
  cursor: pointer;
}
.gis-catalogue-row.is-busy .gis-catalogue-name { opacity: 0.6; font-style: italic; }
.gis-catalogue-detail {
  flex: 0 0 3.4rem;
  width: 3.4rem;
  height: 0.9rem;
  margin: 0;
  accent-color: rgba(82, 228, 232, 0.9);
  cursor: pointer;
}
.gis-catalogue-sym {
  flex: 0 0 auto;
  font: 500 0.54rem/1 'Exo 2', sans-serif;
  padding: 0.15rem 0.3rem;
  border-radius: 0.25rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.gis-catalogue-sym:hover { border-color: rgba(255, 255, 255, 0.5); }
/* A toggle that is ON says so: the same button, filled. */
.gis-catalogue-sym.is-on {
  border-color: rgba(var(--nav-accent-rgb), 0.9);
  background: rgba(var(--nav-accent-rgb), 0.22);
}

/* Not a disclosure any more: the catalogue is ALWAYS open — a fixed header
   over a window about five rows tall that scrolls. A lid that could close
   was reported twice as underdeveloped; a list you can always see, capped
   by a scrollbar, is the developed form. */
.gis-catalogue-box {
  border: 1px solid rgba(var(--nav-accent-rgb), 0.3);
  border-radius: 0.35rem;
  background: rgba(255, 255, 255, 0.02);
}
.gis-catalogue-head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.38rem 0.55rem;
  font: 600 0.68rem/1.35 'Exo 2', sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.gis-catalogue-count {
  margin-left: auto;
  font: 400 0.6rem/1.35 'Exo 2', sans-serif;
  letter-spacing: 0;
  text-transform: none;
  opacity: 0.65;
}
/* About five rows before the scrollbar takes over. The scrollbar wears the
   panel's cyan both ways round — the standard properties for modern Chrome
   and Firefox, the pseudo-elements for Safari (Chrome 121+ ignores the
   pseudos entirely once the standard properties are set). */
.gis-catalogue-scroll {
  max-height: 8.6rem;
  overflow-y: auto;
  padding: 0.1rem 0.4rem 0.35rem;
  border-top: 1px solid rgba(var(--nav-accent-rgb), 0.18);
  scrollbar-width: thin;
  scrollbar-color: rgba(82, 228, 232, 0.38) transparent;
}
.gis-catalogue-scroll::-webkit-scrollbar { width: 6px; }
.gis-catalogue-scroll::-webkit-scrollbar-thumb {
  background: rgba(82, 228, 232, 0.38);
  border-radius: 3px;
}
.gis-catalogue-info-btn {
  flex: 0 0 auto;
  width: 1rem;
  height: 1rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(82, 228, 232, 0.4);
  border-radius: 50%;
  background: transparent;
  color: rgba(82, 228, 232, 0.85);
  font: 600 0.62rem/1 'Exo 2', sans-serif;
  cursor: pointer;
}
.gis-catalogue-info-btn:hover {
  border-color: #52e4e8;
  color: #ffffff;
  background: rgba(82, 228, 232, 0.14);
}
#gis-catalogue-info-pop {
  position: fixed;
  z-index: 70;
  width: min(19rem, calc(100vw - 2rem));
  padding: 0.6rem 0.75rem 0.65rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(82, 228, 232, 0.45);
  background: rgba(8, 13, 20, 0.98);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.5);
  color: #dcebf2;
}
#gis-catalogue-info-pop[hidden] { display: none !important; }
#gis-catalogue-info-pop h4 {
  margin: 0 0 0.3rem;
  font: 600 0.72rem/1.3 'Exo 2', sans-serif;
  letter-spacing: 0.05em;
  color: #bdf3f5;
}
#gis-catalogue-info-pop p {
  margin: 0 0 0.35rem;
  font: 400 0.68rem/1.45 'Exo 2', sans-serif;
}
#gis-catalogue-info-pop .info-citation {
  margin: 0;
  font: 400 0.62rem/1.4 'Exo 2', sans-serif;
  opacity: 0.8;
}
#gis-catalogue-info-pop .info-citation b {
  font-weight: 600;
  color: #9fe8ec;
}
`;

let styled = false;
function installStyle() {
  if (styled || typeof document === "undefined") return;
  styled = true;
  const tag = document.createElement("style");
  tag.id = "gis-catalogue-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

/**
 * Whether each catalogue's dropdown is open, by host id.
 *
 * The list is redrawn on every tick — that is how the ticks stay true when a
 * layer is removed from somewhere else — and a redraw builds a new `<details>`,
 * which would spring shut at the exact moment somebody is working down the
 * list. It is remembered here rather than on the element, which does not
 * survive being replaced.
 */
const openState = new Map();

/**
 * Every catalogue currently on the page, so one can redraw the others.
 *
 * The same catalogue is drawn in two places -- the Vectors & Shapes tab and
 * Explorer's Locations list -- and a control pressed in one has to be true in
 * both. Ticking already works, because both lists ask the catalogue on the
 * import manager's change event. A control that changes something the import
 * manager does not know about does not: pressing Names in one list left the
 * other still offering to turn them on.
 */
const drawn = new Map();

export function refreshCatalogues() {
  drawn.forEach(({ entries, hooks }, host) => {
    if (host.isConnected) renderCatalogue(host, entries, hooks);
    else drawn.delete(host);
  });
}

/**
 * Draw a catalogue into `host`.
 *
 * @param {HTMLElement} host
 * @param {Array<{id: string, label: string, group?: string, title?: string}>} entries
 * @param {object} hooks
 * @param {(id: string) => object|null} hooks.layerFor  the loaded layer, or null
 * @param {(id: string) => Promise<void>} hooks.add
 * @param {(id: string) => void} hooks.remove
 * @param {(layer: object) => void} [hooks.symbology]
 * @param {string} [hooks.title]  wrap the list in a dropdown under this name
 */
/** The one info popover, found by id rather than held in a variable. */
function infoPop() {
  let pop = document.getElementById("gis-catalogue-info-pop");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "gis-catalogue-info-pop";
    pop.hidden = true;
    document.body.appendChild(pop);
    document.addEventListener("click", (e) => {
      if (!pop.hidden && !pop.contains(e.target)
        && !e.target.closest?.(".gis-catalogue-info-btn")) pop.hidden = true;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") pop.hidden = true;
    });
  }
  return pop;
}

/**
 * The ⓘ beside a dataset's tick: what this is, and the full citation of
 * where it comes from — on a card, because a title-attribute tooltip
 * cannot be read on touch and truncates the licence it exists to show.
 */
function infoButton(entry) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gis-catalogue-info-btn";
  btn.textContent = "i";
  btn.title = `About ${entry.label}`;
  btn.setAttribute("aria-label", `About ${entry.label}`);
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const pop = infoPop();
    const again = !pop.hidden && pop.dataset.entry === entry.id;
    if (again) { pop.hidden = true; return; }
    pop.dataset.entry = entry.id;
    pop.textContent = "";
    const h = document.createElement("h4");
    h.textContent = entry.label;
    pop.appendChild(h);
    if (entry.info.summary) {
      const p = document.createElement("p");
      p.textContent = entry.info.summary;
      pop.appendChild(p);
    }
    if (entry.info.citation) {
      const cite = document.createElement("p");
      cite.className = "info-citation";
      const b = document.createElement("b");
      b.textContent = "Source: ";
      cite.append(b, entry.info.citation);
      pop.appendChild(cite);
    }
    pop.hidden = false;
    // Beside the button, clamped to the viewport, above it if there is no
    // room below.
    const r = event.currentTarget.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h2 = pop.offsetHeight;
    let x = Math.min(r.left, window.innerWidth - w - 12);
    let y = r.bottom + 6;
    if (y + h2 > window.innerHeight - 8) y = r.top - h2 - 6;
    pop.style.left = `${Math.max(8, x)}px`;
    pop.style.top = `${Math.max(8, y)}px`;
  });
  return btn;
}

export function renderCatalogue(host, entries, hooks) {
  if (!host) return;
  drawn.set(host, { entries, hooks });
  installStyle();
  // Captured before the clear: a redraw (every tick causes one) must not
  // throw the reader back to the top of a list they were halfway down.
  const priorScroll = host.querySelector(".gis-catalogue-scroll")?.scrollTop || 0;
  host.textContent = "";
  host.className = "";

  /**
   * A dropdown when the caller names one, a plain list otherwise.
   *
   * The Earth Engine catalogue already sits inside its own disclosure, so a
   * second lid over it would be two clicks to reach one list. The vector
   * catalogue does not, and at nine entries with their group headings it was
   * most of the panel — with the layers it had put on the globe pushed off the
   * bottom, which is the part you actually work with.
   */
  let list = host;
  if (hooks.title) {
    const box = document.createElement("div");
    box.className = "gis-catalogue-box";
    const head = document.createElement("div");
    head.className = "gis-catalogue-head";
    const name = document.createElement("span");
    name.textContent = hooks.title;
    head.append(name);
    const scroll = document.createElement("div");
    scroll.className = "gis-catalogue-scroll";
    box.append(head, scroll);
    host.appendChild(box);
    list = scroll;
    if (priorScroll) window.requestAnimationFrame(() => { scroll.scrollTop = priorScroll; });
  }
  list.classList.add("gis-catalogue");

  let group = null;
  entries.forEach((entry) => {
    if (entry.group && entry.group !== group) {
      group = entry.group;
      const head = document.createElement("div");
      head.className = "gis-catalogue-group";
      head.textContent = group;
      list.appendChild(head);
    }
    const layer = hooks.layerFor(entry.id);
    const row = document.createElement("div");
    row.className = "gis-catalogue-row";
    row.dataset.entry = entry.id;

    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = Boolean(layer);
    tick.id = `gis-cat-${entry.id}`;
    tick.addEventListener("change", async () => {
      if (tick.checked) {
        // Busy while it loads: a global shapefile is seconds of geometry, and
        // a tick that appears to do nothing invites a second press.
        row.classList.add("is-busy");
        tick.disabled = true;
        try {
          await hooks.add(entry.id);
        } finally {
          row.classList.remove("is-busy");
          tick.disabled = false;
          renderCatalogue(host, entries, hooks);
        }
      } else {
        hooks.remove(entry.id);
        renderCatalogue(host, entries, hooks);
      }
    });

    const name = document.createElement("label");
    name.className = "gis-catalogue-name";
    name.htmlFor = tick.id;
    name.textContent = entry.label;
    if (entry.title) name.title = entry.title;
    const info = entry.info ? infoButton(entry) : null;

    // Name first, tick LAST: the ticks line up down the row's right edge,
    // the same side every section header keeps its master toggle.
    row.append(name);

    // There is no Names button any more: a layer whose data ranks its points
    // gets names automatically the moment it is on the globe (point-labels.js
    // turns them on at the default detail), and the Label detail slider in the
    // layer's own subsection is the control that remains. A button that
    // toggled what the tick box already implies was a second switch for one
    // decision.

    // Only where there is something to symbolise: a layer that is not on the
    // globe has no attributes to colour by and no legend to write.
    if (layer && hooks.symbology) {
      const sym = document.createElement("button");
      sym.type = "button";
      sym.className = "gis-catalogue-sym";
      sym.textContent = "Symbology…";
      sym.title = `Colour ${entry.label} by one of its own columns`;
      sym.addEventListener("click", () => hooks.symbology(layer));
      row.appendChild(sym);
    }
    /**
     * How deep the names go — for ANY catalogue layer that carries them.
     *
     * The volcanoes had this as bespoke markup in their own subsection, which
     * is the only place it could be while they were the only labelled
     * catalogue. The submarine cables are labelled too and live in a list with
     * no subsection to put a slider in, so the control belongs on the row that
     * turns the layer on — one implementation, and every future labelled
     * dataset gets it without a second copy.
     *
     * Compact and unlabelled by design: it sits between the Symbology button
     * and the tick, and its `title` carries the level's own words (the same
     * `DETAIL_COPY` the volcano caption reads).
     */
    const labels = window.GeoIDPointLabels;
    if (layer && labels?.canLabel?.(layer)) {
      const detail = document.createElement("input");
      detail.type = "range";
      detail.className = "gis-catalogue-detail";
      detail.min = "1";
      detail.max = "5";
      detail.step = "1";
      detail.value = String(labels.detailLevelOf?.(layer) ?? labels.DEFAULT_DETAIL ?? 3);
      /**
       * The dataset's OWN words, never the volcanoes'.
       *
       * `label_rank` means eruption recency in one catalogue and cable length
       * in another, so `DETAIL_COPY` — which is the volcanoes' bands — cannot
       * caption both. An entry may carry `detailCopy`; anything that does not
       * gets wording that is true of any ranking.
       */
      const copy = entry.detailCopy || labels.GENERIC_DETAIL_COPY || {};
      const caption = () => {
        detail.title = `Label detail: ${copy[Number(detail.value)] || detail.value}`;
      };
      caption();
      // The tooltip tracks the drag; the rebuild waits for the release, because
      // rebuilding a label set is a texture per name.
      detail.addEventListener("input", caption);
      detail.addEventListener("change", () => {
        caption();
        labels.setDetailLevel?.(layer, Number(detail.value));
      });
      // A range inside a row that toggles the layer: the drag must not reach
      // the row's own handlers.
      detail.addEventListener("click", (event) => event.stopPropagation());
      row.appendChild(detail);
    }
    if (info) row.appendChild(info);
    row.appendChild(tick);
    list.appendChild(row);
  });
}

/**
 * Open symbology on a layer: a window over the map, whatever the layer is.
 *
 * It used to reveal the Symbology PANEL instead — select the layer in its
 * dropdown, unfold whatever it was folded inside, scroll it into view. That
 * worked in the sense that the controls were reachable, and in no other sense:
 * the panel is one accordion among a dozen down the side of the page, so
 * un-hiding it mid-stack pushed everything below it down and left a run of
 * half-styled sections open behind it. A modal has none of those problems
 * because it does not live in the page's flow at all.
 *
 * The panel is still there and still works; this is simply not the way in.
 */
export function openSymbologyFor(layer) {
  if (!layer) return false;
  return openSymbologyDialog(layer);
}
