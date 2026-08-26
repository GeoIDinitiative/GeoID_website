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

import { openSymbologyDialog } from "./symbology-dialog.js?v=20260826-8b90f9b";

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
  font: 400 0.72rem/1.4 'Exo 2', sans-serif;
  cursor: pointer;
}
.gis-catalogue-row.is-busy .gis-catalogue-name { opacity: 0.6; font-style: italic; }
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
    const count = document.createElement("span");
    count.className = "gis-catalogue-count";
    const on = entries.filter((entry) => hooks.layerFor(entry.id)).length;
    count.textContent = on
      ? `${on} of ${entries.length} on the globe`
      : `${entries.length} datasets`;
    head.append(name, count);
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
