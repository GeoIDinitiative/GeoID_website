/**
 * The enlarged map: GeoHUB's own Mars viewer (/planet_explorer/mars/viewer/),
 * opened from the pause menu in a full-screen layer over the paused game.
 *
 * The viewer is used exactly as GeoHUB ships it (same origin, framed, so it
 * runs as it does inside GeoHUB rather than bouncing to the shell). It has no
 * "fly to" message, so once it is ready this module types the current site's
 * name into the viewer's own feature search and presses its Go button: the
 * viewer flies there and opens the feature's card, as if the player had
 * searched for it. Nothing in GeoHUB is changed.
 *
 * The frame is created on open and removed on close, so the viewer's WebGL
 * context and tiles never sit in memory beside the game's.
 *
 *   openBigMap(game)   close with the Close button, Esc, or Circle on the pad
 */

const VIEWER = "/planet_explorer/mars/viewer/";
let layer = null, pollTimer = 0, onKey = null;

/** What GeoHUB's feature search calls the place the game is at. */
function placeName(game) {
  const s = game && game.site;
  if (!s) return "";
  return (s.featureName || s.name || "").replace(/\s+crater$/i, "").trim();
}

function focusPlace(frame, name) {
  const t0 = performance.now();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    let doc = null;
    try { doc = frame.contentDocument; } catch { /* not same-origin: leave it be */ }
    const status = doc && doc.getElementById("status"), input = doc && doc.getElementById("feature-search"), go = doc && doc.getElementById("feature-search-go");
    if (performance.now() - t0 > 30000) { clearInterval(pollTimer); return; }
    if (!input || !go) return;
    if (status && /^Focused on /.test(status.textContent || "")) { clearInterval(pollTimer); return; }
    // the viewer answers "did not match" until its feature list has loaded: keep asking until it flies
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    go.click();
  }, 900);
}

export function closeBigMap() {
  clearInterval(pollTimer);
  if (onKey) window.removeEventListener("keydown", onKey, true);
  onKey = null;
  if (layer) { layer.remove(); layer = null; }
  const btn = document.getElementById("btn-menu-map"); if (btn) btn.focus();
}

export function openBigMap(game) {
  if (layer) return;
  const name = placeName(game);
  layer = document.createElement("section");
  layer.className = "bigmap";
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-label", "Map of Mars");
  layer.setAttribute("data-pad-closable", "");
  layer.innerHTML = `
    <header class="bigmap-bar">
      <span class="eyebrow">Map</span>
      <b class="bigmap-place"></b>
      <span class="bigmap-note">GeoHUB Mars</span>
      <button type="button" class="btn primary bigmap-close" data-pad-close>Close</button>
    </header>
    <iframe class="bigmap-frame" title="GeoHUB Mars" src="${VIEWER}"></iframe>`;
  layer.querySelector(".bigmap-place").textContent = name ? `${name}, where you are` : "";
  document.body.appendChild(layer);
  layer.querySelector(".bigmap-close").addEventListener("click", closeBigMap);
  const frame = layer.querySelector(".bigmap-frame");
  if (name) frame.addEventListener("load", () => focusPlace(frame, name), { once: true });
  onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); closeBigMap(); } };
  window.addEventListener("keydown", onKey, true);
  // Circle: the controller module closes the topmost [data-pad-closable] by pressing its [data-pad-close]
  layer.querySelector(".bigmap-close").focus();
}

export const _test = { placeName };
