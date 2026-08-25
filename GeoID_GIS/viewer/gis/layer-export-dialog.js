/**
 * Asking what format, before writing a layer out.
 *
 * A prompt rather than a menu of formats on the row: the row has four controls
 * on it already, and the choice needs room to say what each format costs --
 * WKT drops the attributes, CSV keeps them but flattens the geometry into a
 * column. Picking a format blind and finding out afterwards is how you export
 * three times.
 *
 * The list is whatever the layer can actually become, and the format nearest
 * to what was imported is preselected, so the common case is one press.
 */

import { formatsFor, suggestedFormat, baseName, exportLayer, layerKind }
  from "./layer-export.js?v=20260825-9311003";

const DIALOG_ID = "geoid-export-dialog";

const STYLE = `
.geoid-export-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(2, 4, 10, 0.62);
  backdrop-filter: blur(3px);
}
.geoid-export-dialog {
  width: min(24rem, calc(100vw - 2rem));
  padding: 0.9rem 1rem 1rem;
  border: 1px solid rgb(var(--nav-accent-rgb));
  border-radius: 0.8rem;
  background: #000;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
  color: var(--text);
  font-family: "Exo 2", "Segoe UI", sans-serif;
}
.geoid-export-title {
  margin: 0 0 0.15rem;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.geoid-export-sub {
  margin: 0 0 0.7rem;
  color: var(--muted);
  font-size: 0.7rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.geoid-export-options { display: grid; gap: 0.35rem; margin-bottom: 0.8rem; }
.geoid-export-option {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.15rem 0.5rem;
  align-items: start;
  padding: 0.45rem 0.55rem;
  border: 1px solid rgba(var(--nav-accent-rgb), 0.28);
  border-radius: 0.5rem;
  cursor: pointer;
}
.geoid-export-option:hover { border-color: rgba(var(--nav-accent-rgb), 0.7); }
.geoid-export-option.is-picked {
  border-color: rgb(var(--nav-accent-rgb));
  background: rgba(var(--nav-accent-rgb), 0.12);
}
.geoid-export-option input { margin: 0.15rem 0 0; accent-color: rgb(var(--nav-accent-rgb)); }
.geoid-export-name { font-size: 0.74rem; font-weight: 600; }
.geoid-export-suggested {
  margin-left: 0.4rem;
  padding: 0.02rem 0.3rem;
  border-radius: 0.3rem;
  background: rgb(var(--nav-accent-rgb));
  color: var(--skin-chrome-ink, #2b0030);
  font-size: 0.56rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.geoid-export-note { grid-column: 2; color: var(--muted); font-size: 0.66rem; line-height: 1.35; }
/* Still listed, so its absence is never mistaken for a missing feature. */
.geoid-export-option.is-unavailable { opacity: 0.5; cursor: not-allowed; }
.geoid-export-option.is-unavailable:hover { border-color: rgba(var(--nav-accent-rgb), 0.28); }
.geoid-export-actions { display: flex; justify-content: flex-end; gap: 0.4rem; }
.geoid-export-empty { margin: 0 0 0.8rem; color: var(--muted); font-size: 0.7rem; line-height: 1.4; }
`;

function injectStyle() {
  if (document.getElementById("geoid-export-dialog-style")) return;
  const tag = document.createElement("style");
  tag.id = "geoid-export-dialog-style";
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

function close() {
  document.getElementById(DIALOG_ID)?.remove();
}

/** What we can say about the layer, so the prompt names the thing it will write. */
function describe(layer) {
  const kind = layerKind(layer);
  const bits = [];
  if (kind === "vector") {
    const n = layer.collection.features.length;
    bits.push(`${n} ${n === 1 ? "feature" : "features"}`);
  }
  if (kind === "raster") bits.push(`${layer.raster.width} x ${layer.raster.height} cells`);
  if (kind === "mesh") bits.push("mesh");
  if (layer.ext) bits.push(`imported as .${String(layer.ext).toLowerCase()}`);
  return bits.join(" · ");
}

export function openExportDialog(layer) {
  injectStyle();
  close();

  const formats = formatsFor(layer);
  // The suggestion can be the one thing unavailable -- a .shp whose collection
  // has since been mixed by a geoprocessing step -- so the preselection falls
  // to the first option that can actually be written.
  const usable = formats.filter((f) => !f.disabled);
  const suggestion = formats.find((f) => f.suggested && !f.disabled);
  const picked = { id: (suggestion || usable[0])?.id || null };
  formats.forEach((f) => { f.suggested = f.id === picked.id; });

  const backdrop = document.createElement("div");
  backdrop.id = DIALOG_ID;
  backdrop.className = "geoid-export-backdrop";
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });

  const box = document.createElement("div");
  box.className = "geoid-export-dialog";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");

  const title = document.createElement("p");
  title.className = "geoid-export-title";
  title.textContent = "Export layer";
  box.appendChild(title);

  const sub = document.createElement("p");
  sub.className = "geoid-export-sub";
  sub.textContent = `${baseName(layer)} — ${describe(layer)}`;
  box.appendChild(sub);

  if (!formats.length) {
    // Not an error message with a dead button under it: there is genuinely
    // nothing to write, and saying which is more use than "export failed".
    const empty = document.createElement("p");
    empty.className = "geoid-export-empty";
    empty.textContent = "This layer holds nothing that can be written out — "
      + "it has no features, no raster band and no geometry.";
    box.appendChild(empty);
  }

  const options = document.createElement("div");
  options.className = "geoid-export-options";
  formats.forEach((format) => {
    const option = document.createElement("label");
    option.className = `geoid-export-option${format.suggested ? " is-picked" : ""}`
      + (format.disabled ? " is-unavailable" : "");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "geoid-export-format";
    radio.value = format.id;
    radio.disabled = Boolean(format.disabled);
    radio.checked = Boolean(format.suggested) && !format.disabled;
    radio.addEventListener("change", () => {
      picked.id = format.id;
      options.querySelectorAll(".geoid-export-option")
        .forEach((node) => node.classList.remove("is-picked"));
      option.classList.add("is-picked");
    });
    option.appendChild(radio);

    const name = document.createElement("span");
    name.className = "geoid-export-name";
    name.textContent = format.label;
    if (format.suggested) {
      const tag = document.createElement("span");
      tag.className = "geoid-export-suggested";
      tag.textContent = "closest to source";
      name.appendChild(tag);
    }
    option.appendChild(name);

    const note = document.createElement("span");
    note.className = "geoid-export-note";
    // The reason it cannot be used replaces the description of what it is:
    // what you need at that moment is what to do instead.
    note.textContent = format.disabled ? format.reason : format.note;
    option.appendChild(note);

    options.appendChild(option);
  });
  box.appendChild(options);

  const actions = document.createElement("div");
  actions.className = "geoid-export-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", close);
  actions.appendChild(cancel);

  if (usable.length) {
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "button";
    confirm.textContent = "Export";
    confirm.addEventListener("click", () => {
      exportLayer(layer, picked.id);
      close();
    });
    actions.appendChild(confirm);
  }
  box.appendChild(actions);

  backdrop.appendChild(box);
  document.body.appendChild(backdrop);

  const escape = (event) => {
    if (event.key !== "Escape") return;
    close();
    document.removeEventListener("keydown", escape);
  };
  document.addEventListener("keydown", escape);
  box.querySelector("input")?.focus();
}

if (typeof window !== "undefined") {
  window.GeoIDLayerExport = { open: openExportDialog };
}
