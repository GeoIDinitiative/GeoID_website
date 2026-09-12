/**
 * EXPLORER MODELS — Tour Mode, over the places that have a viewer of their own.
 *
 * Two places on this globe are also whole front-ends on this site: Mount Etna
 * has a close-range terrain viewer and Everest has ASCENT, a first-person
 * climb. Until now the only way into either from here was to leave for the
 * site's Explorer page and find it, and Everest had no way in at all — the
 * card's link was a hard-coded `feature.name === "Mount Etna"`.
 *
 * So this is Tour Mode with a different stop list, and it is Tour Mode's own
 * machinery rather than an imitation of it: `GeoIDViewer.tourToFeature(name)`
 * calls the viewer's `presentTourFeature`, which OPENS THE CARD FIRST and
 * flies the camera 700 ms later. That ordering is why the link spawns with the
 * jump — the card is already up when the flight starts, and the card is where
 * the link lives, because a link in this panel would be a second door to the
 * place the card is already describing.
 *
 * The stops come off the viewer's seam (`explorerSites()`), which is the same
 * list the card reads to decide whether to draw a link at all. A stop with no
 * viewer behind it would be a jump to nothing.
 *
 * Armed by the hidden checkbox `scripts/tour-enter.js` drives for every
 * section with an Enter button, so this module never touches that button.
 */

const HOST = "explorer-models";
const TOGGLE = "explorer-models-toggle";

let stops = [];
let at = -1;

/** The viewer, once it is up: this module loads before it on a cold page. */
const viewer = () => window.GeoIDViewer;

function el(doc, tag, className) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

function build(host) {
  const doc = host.ownerDocument;
  host.textContent = "";
  const wrap = el(doc, "div");
  wrap.id = "explorer-models-controls";
  wrap.style.display = "none";

  const row = el(doc, "div", "row");
  const label = el(doc, "label");
  label.setAttribute("for", "explorer-models-target");
  label.textContent = "Current stop";
  const select = el(doc, "select", "select");
  select.id = "explorer-models-target";
  row.append(label, select);

  const copy = el(doc, "p", "compact-copy");
  copy.id = "explorer-models-copy";

  const nav = el(doc, "div", "search-row moon-viewer-nav-row");
  const prev = el(doc, "button", "button secondary");
  prev.type = "button"; prev.id = "explorer-models-prev"; prev.textContent = "Previous";
  const next = el(doc, "button", "button secondary");
  next.type = "button"; next.id = "explorer-models-next"; next.textContent = "Next";
  nav.append(prev, next);

  wrap.append(row, copy, nav);
  host.appendChild(wrap);
  return { wrap, select, copy, prev, next };
}

/** Fly to a stop and open its card — the card carries the way in. */
function goTo(index, parts) {
  if (!stops.length) return;
  at = ((index % stops.length) + stops.length) % stops.length;
  const stop = stops[at];
  parts.select.value = stop.name;
  viewer()?.tourToFeature?.(stop.name, { statusPrefix: "Explorer model" });
  parts.copy.textContent = `${stop.name} — its card carries the way in.`;
}

function refresh(parts) {
  stops = (viewer()?.explorerSites?.() || []).filter((s) => s && s.name);
  parts.select.innerHTML = "";
  const doc = parts.select.ownerDocument;
  for (const stop of stops) {
    const option = doc.createElement("option");
    option.value = stop.name;
    option.textContent = stop.name;
    parts.select.appendChild(option);
  }
  const many = stops.length > 1;
  parts.prev.disabled = !many;
  parts.next.disabled = !many;
  return stops.length;
}

export function mountExplorerModels(host, toggle) {
  if (!host || !toggle) return null;
  const parts = build(host);

  parts.select.addEventListener("change", () => {
    const found = stops.findIndex((s) => s.name === parts.select.value);
    if (found >= 0) goTo(found, parts);
  });
  parts.prev.addEventListener("click", () => goTo(at - 1, parts));
  parts.next.addEventListener("click", () => goTo(at + 1, parts));

  const sync = () => {
    const on = toggle.checked;
    parts.wrap.style.display = on ? "" : "none";
    if (!on) { at = -1; return; }
    /**
     * ONE MODE AT A TIME. Tour Mode and this one both fly the camera and both
     * claim the card, so two armed at once is two pickers disagreeing about
     * where you are. Stood down through its own checkbox, which is the seam
     * everything else uses to arm and disarm it.
     */
    const tour = (toggle.ownerDocument || document).getElementById("tour-mode-toggle");
    if (tour && tour.checked) {
      tour.checked = false;
      tour.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (!refresh(parts)) {
      // Said rather than left blank: an armed mode with no stops reads as a
      // mode that failed, and the reason is the viewer not being up yet.
      parts.copy.textContent = "The globe is still loading its places — try again in a moment.";
      return;
    }
    goTo(at < 0 ? 0 : at, parts);
  };
  toggle.addEventListener("change", sync);
  /**
   * THE STOPS ARE LISTED BEFORE THE MODE IS ENTERED, not on entering it.
   *
   * Filled only on Enter, the select sits there empty — which `tests/ui.py`
   * catches as "a control left empty for its handler", and a reader opening
   * the section meets a picker with nothing in it and no way to know whether
   * that is the list or a fault. This module loads before the viewer does, so
   * it is a bounded retry rather than one read: twelve seconds at 250 ms, the
   * same shape the draw bar uses for a seam that is usually just late.
   */
  if (!refresh(parts) && typeof setInterval === "function") {
    let tries = 0;
    const waiting = setInterval(() => {
      tries += 1;
      if (refresh(parts) || tries > 48) clearInterval(waiting);
    }, 250);
  }
  sync();
  return { parts, sync, stops: () => stops.slice() };
}

function init() {
  const host = document.getElementById(HOST);
  const toggle = document.getElementById(TOGGLE);
  if (host && toggle) mountExplorerModels(host, toggle);
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
