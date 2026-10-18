/**
 * The title screen of MARS: FRONTIER PIONEER, and the campaign pointer.
 *
 * The game is the campaign: the player never chooses a site. The story decides
 * where the pioneer is (the prologue opens at Jezero), so the title offers
 * only Continue, New campaign, Settings and Controls. The site picker
 * (launcher.js) survives behind ?dev for development and for the headless
 * tests, which drive it.
 *
 * THE CAMPAIGN POINTER (localStorage "geoid.mars_surface.campaign"):
 *   { site, act, chapter, at }   where the campaign is, and what to call it on
 *                                the Continue button and the loading screen.
 * Written by travel() and by the story system (story.api), read here. The
 * per-site save (state.js) still holds the game itself.
 *
 *   window.__marsTravel(siteId, {act, chapter, reason})
 *       the story moves the pioneer to another site: save, point the campaign
 *       there, reload into the loading screen for it (?continue).
 *
 * The backdrop is CSS and one 2D canvas (stars): no second WebGL context
 * beside the game's.
 */
import { SITES } from "./site.js?v=6d37c9c-9b39e129";
import { hasSave } from "./state.js?v=6d37c9c-9b39e129";

const KEY = "geoid.mars_surface.campaign";
export const FIRST_SITE = "jezero";
const store = () => { try { return window.localStorage; } catch { return null; } };

export function campaign() {
  try { const c = JSON.parse((store() && store().getItem(KEY)) || "null"); if (c && c.site) return c; } catch { /* unreadable: start over */ }
  return { site: FIRST_SITE, act: "Prologue", chapter: "Landfall" };
}
export function setCampaign(patch) {
  const c = Object.assign(campaign(), patch, { at: Date.now() });
  try { store() && store().setItem(KEY, JSON.stringify(c)); } catch { /* private mode: the campaign lives for this page only */ }
  return c;
}
export function resetCampaign() {
  try { store() && store().removeItem(KEY); } catch { /* nothing to clear */ }
  return campaign();
}
export function campaignEntry(c = campaign()) {
  return SITES.find((s) => s.id === c.site) || SITES.find((s) => s.id === FIRST_SITE) || SITES[0];
}
export function hasCampaign() { const c = campaign(); return hasSave(c.site); }

/** The stars behind the planet: drawn once per size, deterministic. */
function drawStars(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const g = canvas.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const n = Math.round(w * h / 2600);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h * 0.85, m = rnd();
    const r = m > 0.985 ? 1.4 : m > 0.9 ? 0.9 : 0.55;
    g.globalAlpha = 0.25 + 0.6 * rnd();
    g.fillStyle = m > 0.97 ? "#ffd9c4" : m > 0.94 ? "#cfe3ff" : "#ffffff";
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}

/**
 * Wire the title. handlers: { begin(entry, fresh), settings(), controls() }.
 * Returns { refresh() } (call after a save changes).
 */
export function mountTitle(root, handlers) {
  const $ = (sel) => root.querySelector(sel);
  const canvas = $(".st-stars");
  const redraw = () => drawStars(canvas);
  new ResizeObserver(redraw).observe(canvas);
  redraw();

  const cont = $("#st-continue"), fresh = $("#st-new"), confirm = $("#st-confirm");
  function refresh() {
    const c = campaign(), saved = hasCampaign();
    cont.hidden = !saved;
    $("#st-continue-where").textContent = saved ? [c.act, c.chapter].filter(Boolean).join(" · ") : "";
    fresh.classList.toggle("primary", !saved);
    fresh.textContent = saved ? "New campaign" : "Begin";
    confirm.hidden = true;
  }
  cont.addEventListener("click", () => handlers.begin(campaignEntry(), false));
  fresh.addEventListener("click", () => {
    if (!hasCampaign()) { handlers.begin(campaignEntry(resetCampaign()), true); return; }
    confirm.hidden = false; $("#st-new-no").focus();
  });
  $("#st-new-yes").addEventListener("click", () => handlers.begin(campaignEntry(resetCampaign()), true));
  $("#st-new-no").addEventListener("click", () => { confirm.hidden = true; fresh.focus(); });
  $("#st-settings").addEventListener("click", () => handlers.settings());
  $("#st-controls").addEventListener("click", () => handlers.controls());

  window.__marsTravel = (siteId, info = {}) => {
    if (!SITES.some((s) => s.id === siteId)) { console.warn("[title] no such site:", siteId); return false; }
    try { handlers.save && handlers.save(); } catch { /* a failed save must not strand the story */ }
    setCampaign({ site: siteId, act: info.act || campaign().act, chapter: info.chapter || info.reason || "" });
    const q = new URLSearchParams(location.search); q.set("continue", "1");
    location.href = location.pathname + "?" + q.toString();
    return true;
  };
  refresh();
  return { refresh };
}
