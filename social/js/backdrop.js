/**
 * The Network's backdrop: the GeoHUB loading screen's own photographs of the
 * Earth, dimmed behind translucent panels, one per section.
 *
 * WHY. A flat dark page read as one-dimensional; real imagery under frosted
 * panels gives the interface depth and says what the site is about. The
 * frames, captions and credits are /load_screen/earth/frames.json -- the same
 * list the GeoHUB start-up montage plays -- so there is one set of images and
 * one source of attribution.
 *
 * MOTION, deliberately little. The image does not drift, zoom or loop: a
 * slow-moving full-screen background behind text people are reading is what
 * accessibility guidance warns against. It changes only when the section
 * changes, as a 400 ms opacity cross-fade between two layers (state
 * indication; it is the page, not a control, so it may take longer than a
 * control would). Reduced transparency hides it; CSS handles that.
 */
import { h } from "./dom.js?v=20261023-c5add11";

const DIR = "/load_screen/earth/";

/** Which photograph sits behind which section (first path segment). */
const FOR_SECTION = {
  "": "02-aurora-from-orbit.webp",
  search: "02-aurora-from-orbit.webp",
  post: "01-blue-marble-2012.webp",
  compose: "11-etna-summit-craters.webp",
  u: "14-fimmvorduhals.webp",
  me: "14-fimmvorduhals.webp",
  people: "12-blue-marble-east.webp",
  orgs: "12-blue-marble-east.webp",
  o: "12-blue-marble-east.webp",
  communities: "06-etna-from-orbit.webp",
  c: "06-etna-from-orbit.webp",
  teams: "07-himalaya-glaciers.webp",
  t: "07-himalaya-glaciers.webp",
  projects: "07-himalaya-glaciers.webp",
  p: "07-himalaya-glaciers.webp",
  reviews: "13-global-cloud-cover.webp",
  r: "13-global-cloud-cover.webp",
  requests: "09-alpine-landslide.webp",
  opportunities: "04-mediterranean-at-night.webp",
  events: "04-mediterranean-at-night.webp",
  messages: "10-saharan-dust.webp",
  notifications: "10-saharan-dust.webp",
  settings: "10-saharan-dust.webp",
  welcome: "02-aurora-from-orbit.webp",
  mod: "13-global-cloud-cover.webp",
  map: null, // the map is its own picture
};

export function createBackdrop() {
  const layers = [h("img", { alt: "", decoding: "async" }), h("img", { alt: "", decoding: "async" })];
  const credit = h("p", { class: "s-backdrop-credit" });
  const root = h("div", { class: "s-backdrop", "aria-hidden": "true" }, layers[0], layers[1], h("div", { class: "s-backdrop-veil" }));
  let front = 0;
  let current = "";
  let credits = {};
  fetch(`${DIR}frames.json`).then((r) => (r.ok ? r.json() : null)).then((d) => {
    for (const f of d?.frames || []) credits[f.file] = f;
    if (current) caption(current);
  }).catch(() => {});

  const caption = (file) => {
    const f = credits[file];
    credit.textContent = f ? `${f.place} · ${f.src}` : "";
  };

  function show(path) {
    const section = String(path || "/").replace(/^\//, "").split("/")[0];
    const file = section in FOR_SECTION ? FOR_SECTION[section] : FOR_SECTION[""];
    if (file === current) return;
    current = file;
    document.body.classList.toggle("s-has-backdrop", !!file);
    if (!file) { layers.forEach((l) => l.classList.remove("is-on")); credit.textContent = ""; return; }
    const next = layers[1 - front];
    const swap = () => {
      next.classList.add("is-on");
      layers[front].classList.remove("is-on");
      front = 1 - front;
      caption(file);
    };
    next.onload = swap;
    next.src = DIR + file;
    if (next.complete && next.naturalWidth) swap();
  }

  return { root, credit, show };
}
