/**
 * The Network's backdrop: the GeoHUB loading screen's own photographs of the
 * Earth and of Etna, dimmed behind translucent panels -- a different plate
 * for each section; the feed's is the Fimmvörðuháls eruption.
 *
 * The frames, captions and credits are the loading screen's own lists
 * (/load_screen/earth/frames.json, /load_screen/etna/frames.json), so there is
 * one set of images and one source of attribution. Each photograph is
 * credited -- what it is and whose -- in a quiet line at the foot of the page
 * (app.js), out of the way of reading.
 *
 * MOTION, deliberately little. The image does not drift, zoom or loop: a
 * moving full-screen background behind text people are reading is what
 * accessibility guidance warns against. The page is made lively by live data
 * instead. The photograph changes only when the section does, as a 400 ms
 * opacity cross-fade between two layers. Reduced transparency hides it.
 */
import { h } from "./dom.js?v=20261025-260d2fe";

const EARTH = "/load_screen/earth/";
const ETNA = "/load_screen/etna/";

/** Every plate, by key. Etna's eruption and orbit shots are the Earth set's. */
const PLATES = {
  marble: EARTH + "01-blue-marble-2012.webp",
  aurora: EARTH + "02-aurora-from-orbit.webp",
  medNight: EARTH + "04-mediterranean-at-night.webp",
  etnaErupt: EARTH + "05-etna-eruption.webp",
  etnaOrbit: EARTH + "06-etna-from-orbit.webp",
  himalaya: EARTH + "07-himalaya-glaciers.webp",
  hurricane: EARTH + "08-hurricane-eye.webp",
  landslide: EARTH + "09-alpine-landslide.webp",
  dust: EARTH + "10-saharan-dust.webp",
  craters: EARTH + "11-etna-summit-craters.webp",
  marbleEast: EARTH + "12-blue-marble-east.webp",
  clouds: EARTH + "13-global-cloud-cover.webp",
  fimm: EARTH + "14-fimmvorduhals.webp",
  castelmola: ETNA + "04-etna-from-castelmola.webp",
  paroxysm: ETNA + "07-etna-paroxysm-night.webp",
  fumaroles: ETNA + "02-etna-summit-craters.webp",
  massif: ETNA + "05-etna-massif.webp",
};

/** One plate per section (first path segment); sub-pages share their section's. */
const FOR_SECTION = {
  search: "aurora",
  post: "marbleEast",
  compose: "fumaroles",
  u: "etnaErupt", me: "etnaErupt",
  people: "marble",
  orgs: "medNight", o: "medNight",
  communities: "etnaOrbit", c: "etnaOrbit",
  teams: "himalaya", t: "himalaya",
  projects: "castelmola", p: "castelmola",
  reviews: "clouds", r: "clouds",
  requests: "landslide",
  opportunities: "hurricane",
  events: "paroxysm",
  messages: "dust",
  notifications: "craters",
  settings: "massif",
  welcome: "marbleEast",
  mod: "clouds",
  map: "aurora",
};

export function plateFor(path) {
  const section = String(path || "/").replace(/^\//, "").split(/[/?]/)[0];
  // The feed is the Network's front page: Fimmvörðuháls, chosen by the owner.
  if (!section) return { key: "fimm", ofTheDay: false };
  return { key: FOR_SECTION[section] || "marbleEast", ofTheDay: false };
}

export function createBackdrop({ onPlate } = {}) {
  const layers = [h("img", { alt: "", decoding: "async" }), h("img", { alt: "", decoding: "async" })];
  const root = h("div", { class: "s-backdrop", "aria-hidden": "true" },
    layers[0], layers[1], h("div", { class: "s-backdrop-veil" }), h("div", { class: "s-backdrop-grid" }));
  let front = 0;
  let current = "";
  let ofTheDay = false;
  const meta = {};
  const load = (dir) => fetch(`${dir}frames.json`).then((r) => (r.ok ? r.json() : null)).then((d) => {
    for (const f of d?.frames || []) meta[dir + f.file] = f;
  }).catch(() => {});
  Promise.all([load(EARTH), load(ETNA)]).then(() => { if (current) onPlate?.(meta[current] || null, ofTheDay); });

  function show(path) {
    const plate = plateFor(path);
    const file = PLATES[plate.key];
    if (file === current) return;
    current = file;
    document.body.classList.add("s-has-backdrop");
    ofTheDay = plate.ofTheDay;
    const next = layers[1 - front];
    const swap = () => {
      next.classList.add("is-on");
      layers[front].classList.remove("is-on");
      front = 1 - front;
      onPlate?.(meta[file] || null, ofTheDay);
    };
    next.onload = swap;
    next.src = file;
    if (next.complete && next.naturalWidth) swap();
  }

  return { root, show };
}
