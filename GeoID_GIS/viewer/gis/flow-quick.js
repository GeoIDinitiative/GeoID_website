/**
 * The rail's Flow button: the live wind and ocean currents, one press away.
 *
 * Both layers already exist (flow-layer.js) and already have catalogue rows —
 * Earth Observation ▸ Atmosphere ▸ Live fields for the wind, ▸ Hydrology ▸
 * Ocean for the currents — but those are three levels down, and a moving map
 * of the planet's air was reported as missing from the app entirely. This is
 * a second DOOR, not a second implementation:
 *
 *   * a tick switches the layer through window.GeoIDFlow, the same add/remove
 *     the catalogue row calls, and reads its state back off `layerOf`, so the
 *     row and this card cannot disagree about whether the wind is on;
 *   * the level select PRESSES the drawer's own select (the one under the
 *     catalogue row), so a change of level fetches through the one path that
 *     knows how;
 *   * "All settings" opens the row itself, where time, shading, particles and
 *     pace live.
 *
 * Placed left of the rail beside its own button, the way a workbench is.
 */

import { isParked } from "./parked.js?v=20261017-6f23fb5";

const CARD_ID = "geoid-flow-quick";
const byId = (id) => document.getElementById(id);
const flow = () => window.GeoIDFlow;

const ALL_ROWS = [
  {
    source: "wind",
    name: "Wind",
    note: "NOAA GFS, now",
    drawer: "wind-flow-controls",
    status: "wind-flow-status",
    row: "wind-flow",
  },
  {
    source: "currents",
    name: "Ocean currents",
    note: "Météo-France SMOC, now",
    drawer: "current-flow-controls",
    status: "current-flow-status",
    row: "current-flow",
  },
];

// A parked source (parked.js) has no row here either.
const ROWS = ALL_ROWS.filter((r) => !isParked(r.row));

const LEVELS = [
  ["10m", "10 m"],
  ["850hPa", "850 hPa (1.5 km)"],
  ["500hPa", "500 hPa (5.5 km)"],
  ["250hPa", "250 hPa (jet)"],
];

const STYLE = `
#${CARD_ID} {
  position: fixed; z-index: 14; width: 17rem; box-sizing: border-box;
  padding: 0.7rem 0.75rem 0.65rem; border-radius: 0.78rem;
  background: var(--skin-card-ground, rgb(24, 13, 47));
  border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.34);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  color: var(--text, #e8eef2); font-family: "Exo 2", sans-serif; font-size: 0.78rem;
}
#${CARD_ID}[hidden] { display: none !important; }
#${CARD_ID} .fq-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
#${CARD_ID} .fq-title { font-weight: 600; font-size: 0.76rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--nav-accent, #ff2bd6); }
#${CARD_ID} .fq-close { width: 1.45rem; height: 1.45rem; border-radius: 0.4rem; cursor: pointer; line-height: 1;
  border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.4); background: transparent; color: inherit; }
#${CARD_ID} .fq-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.15rem 0.5rem; align-items: center;
  padding: 0.45rem 0; border-top: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.16); }
#${CARD_ID} .fq-name { font-weight: 600; }
#${CARD_ID} .fq-note, #${CARD_ID} .fq-status { grid-column: 2; color: var(--skin-data, #52e4e8); font-size: 0.7rem; opacity: 0.85; }
#${CARD_ID} .fq-status:empty { display: none; }
#${CARD_ID} .fq-level { grid-column: 2; display: flex; gap: 0.4rem; align-items: center; }
#${CARD_ID} .fq-level select { flex: 1 1 auto; min-width: 0; }
#${CARD_ID} .fq-more { margin-top: 0.45rem; width: 100%; }
`;

let card = null;
let anchor = null;
let poll = null;

function installStyle() {
  if (byId(`${CARD_ID}-style`)) return;
  const tag = document.createElement("style");
  tag.id = `${CARD_ID}-style`;
  tag.textContent = STYLE;
  document.head.appendChild(tag);
}

function isOn(source) {
  const layer = flow()?.layerOf?.(source);
  return Boolean(layer) && layer.object3D?.visible !== false;
}

/** The catalogue rows draw their ticks from the layers; tell them to redraw. */
function announce() {
  window.dispatchEvent(new CustomEvent("geoid-gis:catalogue-changed"));
}

async function setOn(spec, on, tick, status) {
  const F = flow();
  if (!F) return;
  tick.disabled = true;
  try {
    if (on) {
      status.textContent = "Fetching…";
      await F.add(spec.source);
    } else {
      F.remove(spec.source);
    }
  } catch (error) {
    status.textContent = String(error?.message || error);
  } finally {
    tick.disabled = false;
    announce();
    sync();
  }
}

/** Press the drawer's own level select, so the change fetches the one way it can. */
function setLevel(value) {
  const select = byId("wind-flow-controls")?.querySelector("select");
  if (!select) return;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Open the catalogue row a source lives under, with its drawer. */
function openRow(spec) {
  const tick = document.querySelector(`[id$="-${spec.row}"]`);
  const row = tick?.closest(".gis-catalogue-row") || byId(spec.drawer);
  if (!row) return;
  for (let el = row.parentElement; el; el = el.parentElement) {
    if (el.tagName === "DETAILS") el.open = true;
  }
  row.scrollIntoView({ block: "center", behavior: "smooth" });
}

function build() {
  installStyle();
  card = document.createElement("section");
  card.id = CARD_ID;
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Wind and ocean currents");

  const head = document.createElement("div");
  head.className = "fq-head";
  const title = document.createElement("span");
  title.className = "fq-title";
  title.textContent = "Wind & currents";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "fq-close";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => setOpen(false));
  head.append(title, close);
  card.appendChild(head);

  for (const spec of ROWS) {
    const row = document.createElement("div");
    row.className = "fq-row";
    row.dataset.source = spec.source;
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.id = `${CARD_ID}-${spec.source}`;
    const name = document.createElement("label");
    name.className = "fq-name";
    name.htmlFor = tick.id;
    name.textContent = spec.name;
    const note = document.createElement("span");
    note.className = "fq-note";
    note.textContent = spec.note;
    const status = document.createElement("span");
    status.className = "fq-status";
    tick.addEventListener("change", () => setOn(spec, tick.checked, tick, status));
    row.append(tick, name, note);
    if (spec.source === "wind") {
      const level = document.createElement("div");
      level.className = "fq-level";
      const select = document.createElement("select");
      select.className = "input";
      select.setAttribute("aria-label", "Wind level");
      for (const [value, label] of LEVELS) {
        const o = document.createElement("option");
        o.value = value;
        o.textContent = label;
        select.appendChild(o);
      }
      select.addEventListener("change", () => setLevel(select.value));
      level.appendChild(select);
      row.appendChild(level);
    }
    row.appendChild(status);
    card.appendChild(row);
  }

  const more = document.createElement("button");
  more.type = "button";
  more.className = "button secondary fq-more";
  more.textContent = "All settings…";
  more.title = "Time, shading, particles and pace, under each layer's own row";
  more.addEventListener("click", () => {
    const on = ROWS.find((r) => isOn(r.source)) || ROWS[0];
    openRow(on);
  });
  card.appendChild(more);

  document.body.appendChild(card);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && card && !card.hidden) setOpen(false);
  });
}

/** Ticks, the level and each layer's own status line, read off what is true. */
function sync() {
  if (!card) return;
  const F = flow();
  for (const spec of ROWS) {
    const row = card.querySelector(`[data-source="${spec.source}"]`);
    if (!row) continue;
    const tick = row.querySelector("input[type=checkbox]");
    if (tick && !tick.disabled) tick.checked = isOn(spec.source);
    const own = byId(spec.status)?.textContent?.trim() || "";
    const status = row.querySelector(".fq-status");
    if (status && (isOn(spec.source) || !own)) status.textContent = own;
  }
  const level = card.querySelector(".fq-level select");
  const current = F?.settings?.wind?.level;
  if (level && current && document.activeElement !== level) level.value = current;
}

function place() {
  if (!card || card.hidden) return;
  const rail = byId("tool-rail")?.getBoundingClientRect();
  const btn = anchor?.getBoundingClientRect();
  const right = rail ? Math.max(8, window.innerWidth - rail.left + 10) : 72;
  const top = btn ? btn.top : 120;
  card.style.right = `${right}px`;
  const h = card.offsetHeight || 220;
  card.style.top = `${Math.max(8, Math.min(top, window.innerHeight - h - 8))}px`;
}

function setOpen(on) {
  if (!card) build();
  card.hidden = !on;
  anchor = byId("tool-rail-flow");
  anchor?.classList.toggle("is-open", on);
  anchor?.setAttribute("aria-expanded", on ? "true" : "false");
  clearInterval(poll);
  if (on) {
    sync();
    place();
    poll = setInterval(() => { sync(); place(); }, 600);
  }
}

window.GeoIDFlowQuick = {
  open: () => setOpen(true),
  close: () => setOpen(false),
  toggle: () => setOpen(!card || card.hidden),
  isOpen: () => Boolean(card && !card.hidden),
};

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("resize", place);
}
