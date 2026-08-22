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

const STYLE = `
/* NEVER a backtick in this block -- it is a template literal and one ends it. */
.gis-catalogue { display: flex; flex-direction: column; gap: 0.12rem; }
.gis-catalogue-group {
  font: 500 0.56rem/1.4 'Exo 2', sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.6;
  margin: 0.35rem 0 0.1rem;
}
.gis-catalogue-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.12rem 0.15rem;
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
  font: 400 0.62rem/1.35 'Exo 2', sans-serif;
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
 * Draw a catalogue into `host`.
 *
 * @param {HTMLElement} host
 * @param {Array<{id: string, label: string, group?: string, title?: string}>} entries
 * @param {object} hooks
 * @param {(id: string) => object|null} hooks.layerFor  the loaded layer, or null
 * @param {(id: string) => Promise<void>} hooks.add
 * @param {(id: string) => void} hooks.remove
 * @param {(layer: object) => void} [hooks.symbology]
 */
export function renderCatalogue(host, entries, hooks) {
  if (!host) return;
  installStyle();
  host.textContent = "";
  host.className = "gis-catalogue";
  let group = null;
  entries.forEach((entry) => {
    if (entry.group && entry.group !== group) {
      group = entry.group;
      const head = document.createElement("div");
      head.className = "gis-catalogue-group";
      head.textContent = group;
      host.appendChild(head);
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

    row.append(tick, name);

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
    host.appendChild(row);
  });
}

/**
 * Open the symbology panel on a layer, wherever it is on the page.
 *
 * The panel already exists and already handles both rasters and vectors; what
 * was missing was a way to point it at a layer from somewhere else. Falls back
 * to the geology tab's own dialog, which is a modal and needs no scrolling.
 */
export function openSymbologyFor(layer) {
  if (!layer) return false;
  if (window.GeoIDSymbology?.openFor?.(layer)) return true;
  if (window.GeoIDGeology?.openSymbology && layer.features?.length) {
    window.GeoIDGeology.openSymbology(layer);
    return true;
  }
  return false;
}
