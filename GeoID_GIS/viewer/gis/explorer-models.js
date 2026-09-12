/**
 * EXPLORER MODELS — the other front-ends this project serves, and a way to
 * step between them.
 *
 * The GIS globe is one of a dozen viewers on this site: nine planetary
 * explorers, the Earth Explorer, two close-range terrain viewers and a flight
 * simulator. Until now the only way from here to any of them was to leave for
 * the site's own Explorer page and find it, which is a trip rather than a
 * door. This is the door, and it is built to the Tour Mode idiom beside it:
 * pick a stop, step Previous/Next through them, and go.
 *
 * THE LINK LEAVES THE WHOLE PAGE (`target="_top"`), because the GIS viewer
 * runs inside an iframe and a bare link would load a second explorer INSIDE
 * it — a viewer in a viewer, with the shell's chrome still wrapped round it.
 * `transit/index.html` takes the same target for its Return Home link, for
 * the same reason.
 *
 * AND MOST OF THEM ARE OPENED THROUGH `/transit/`, not at their own URL. That
 * page is the site's existing door to a planetary viewer — it holds the
 * registry, the hero shots and the flight — so linking past it would be a
 * second way in that drifts from the first. The three that transit has no key
 * for are linked at their own address, which is the only thing to do.
 */

/**
 * What each entry is FOR is a fact about the viewer; how far away it is, and
 * how long the flight takes, are transit's own numbers and are deliberately
 * not copied here. `explorer-models.test.mjs` pins every `transit` key in this
 * list against the registry in `transit/index.html`, so a destination renamed
 * there cannot leave a dead row here.
 */
export const EXPLORER_MODELS = [
  { key: "mercury", name: "Mercury", kind: "Planet Explorer", transit: "mercury", shot: "/assets/hero/mercury.jpg" },
  { key: "venus", name: "Venus", kind: "Planet Explorer", transit: "venus", shot: "/assets/hero/venus.jpg" },
  { key: "earth", name: "Earth", kind: "Earth Explorer — from the ISS", transit: "earth", shot: "/assets/hero/earth.jpg" },
  { key: "moon", name: "The Moon", kind: "Planet Explorer", transit: "moon", shot: "/assets/hero/moon.jpg" },
  { key: "mars", name: "Mars", kind: "Planet Explorer", transit: "mars", shot: "/assets/hero/mars.jpg" },
  { key: "jupiter", name: "Jupiter", kind: "Planet Explorer", transit: "jupiter", shot: "/assets/hero/jupiter.jpg" },
  { key: "saturn", name: "Saturn", kind: "Planet Explorer", transit: "saturn", shot: "/assets/hero/saturn.jpg" },
  { key: "uranus", name: "Uranus", kind: "Planet Explorer", transit: "uranus", shot: "/assets/hero/uranus.jpg" },
  { key: "neptune", name: "Neptune", kind: "Planet Explorer", transit: "neptune", shot: "/assets/hero/neptune.jpg" },
  { key: "pluto", name: "Pluto", kind: "Planet Explorer", transit: "pluto", shot: "/assets/hero/pluto.jpg" },
  // No transit key for these three: they are places on Earth and a machine,
  // not destinations across the solar system, so they are linked directly.
  { key: "etna", name: "Mount Etna", kind: "Close-range terrain viewer", href: "/earth_explorer/etna/" },
  { key: "everest", name: "Everest — ASCENT", kind: "On foot, at walking scale", href: "/everest/" },
  { key: "marsflight", name: "Mars flight simulator", kind: "Flying the CTX mosaic", href: "/flight_sim/mars/viewer/" },
];

/** Where a model opens: the site's own door where there is one. */
export function hrefFor(model) {
  return model?.transit ? `/transit/?destination=${model.transit}` : (model?.href || "");
}

const STORE = "geoid-gis:explorer-model";

const STYLE = [
  "#explorer-models .explorer-model-card {",
  "  display: grid;",
  "  grid-template-columns: 4.6rem minmax(0, 1fr);",
  "  gap: 0.55rem;",
  "  align-items: center;",
  "  margin: 0.45rem 0 0.35rem;",
  "}",
  /* No shot for the three that have none: the row then gives its whole width
     to the name rather than reserving a gap for a picture that never comes. */
  "#explorer-models .explorer-model-card.is-textonly { grid-template-columns: minmax(0, 1fr); }",
  "#explorer-models .explorer-model-shot {",
  "  width: 4.6rem;",
  "  height: 3rem;",
  "  object-fit: cover;",
  "  border-radius: 0.35rem;",
  "  border: 1px solid rgba(var(--nav-accent-rgb), 0.35);",
  "  display: block;",
  "}",
  "#explorer-models .explorer-model-name {",
  "  display: block;",
  "  font-family: 'Exo 2', system-ui, sans-serif;",
  "  font-size: 0.82rem;",
  "  letter-spacing: 0.02em;",
  "}",
  "#explorer-models .explorer-model-kind {",
  "  display: block;",
  "  font-size: 0.7rem;",
  "  opacity: 0.75;",
  "}",
  /* An <a> is inline, so `width: 100%` on it does nothing and the action reads
     as a half-width pill adrift under the stepper. Block, and it is the row's
     own primary action. */
  "#explorer-models .explorer-model-open {",
  "  display: block;",
  "  width: 100%;",
  "  box-sizing: border-box;",
  "  margin-top: 0.35rem;",
  "  text-align: center;",
  "  text-decoration: none;",
  "}",
].join("\n");

function installStyle(doc) {
  if (doc.getElementById("explorer-models-style")) return;
  const tag = doc.createElement("style");
  tag.id = "explorer-models-style";
  tag.textContent = STYLE;
  doc.head.appendChild(tag);
}

/**
 * Build the picker into `host`. Pure of any globe: this section changes no
 * layer and moves no camera, it hands the reader to another page.
 */
export function mountExplorerModels(host, { models = EXPLORER_MODELS, storage = null } = {}) {
  if (!host) return null;
  const doc = host.ownerDocument;
  installStyle(doc);
  host.textContent = "";

  const row = doc.createElement("div");
  row.className = "row";
  const label = doc.createElement("label");
  label.setAttribute("for", "explorer-model");
  label.textContent = "Model";
  const select = doc.createElement("select");
  select.id = "explorer-model";
  select.className = "select";
  models.forEach((m, i) => {
    const option = doc.createElement("option");
    option.value = m.key;
    option.textContent = m.name;
    option.dataset.index = String(i);
    select.appendChild(option);
  });
  row.append(label, select);

  const card = doc.createElement("div");
  card.className = "explorer-model-card";
  const shot = doc.createElement("img");
  shot.className = "explorer-model-shot";
  shot.alt = "";
  shot.loading = "lazy";
  const text = doc.createElement("div");
  const name = doc.createElement("b");
  name.className = "explorer-model-name";
  const kind = doc.createElement("span");
  kind.className = "explorer-model-kind";
  text.append(name, kind);
  card.append(shot, text);

  const nav = doc.createElement("div");
  nav.className = "search-row moon-viewer-nav-row";
  const prev = doc.createElement("button");
  prev.type = "button"; prev.className = "button secondary"; prev.textContent = "Previous";
  const next = doc.createElement("button");
  next.type = "button"; next.className = "button secondary"; next.textContent = "Next";
  nav.append(prev, next);

  const open = doc.createElement("a");
  open.className = "button explorer-model-open";
  // The whole page, not the iframe this viewer lives in.
  open.target = "_top";
  open.rel = "noopener";

  const note = doc.createElement("p");
  note.className = "compact-copy";
  note.style.margin = "0.35rem 0 0";
  note.textContent = "Opens in place of the GeoHUB. Anything unsaved here stays in the project.";

  host.append(row, card, nav, open, note);

  let at = 0;
  const show = (index) => {
    at = ((index % models.length) + models.length) % models.length;
    const m = models[at];
    select.value = m.key;
    name.textContent = m.name;
    kind.textContent = m.kind || "";
    if (m.shot) {
      shot.src = m.shot;
      shot.hidden = false;
      card.classList.remove("is-textonly");
    } else {
      // Never a broken image: a src that is cleared still paints the alt box.
      shot.removeAttribute("src");
      shot.hidden = true;
      card.classList.add("is-textonly");
    }
    open.href = hrefFor(m);
    open.textContent = `Open ${m.name}`;
    try { (storage || host.ownerDocument.defaultView.localStorage).setItem(STORE, m.key); }
    catch (error) { /* a private window is not a reason to refuse the picker */ }
  };

  select.addEventListener("change", () => {
    const found = models.findIndex((m) => m.key === select.value);
    show(found < 0 ? 0 : found);
  });
  prev.addEventListener("click", () => show(at - 1));
  next.addEventListener("click", () => show(at + 1));

  let start = 0;
  try {
    const saved = (storage || host.ownerDocument.defaultView.localStorage).getItem(STORE);
    const found = models.findIndex((m) => m.key === saved);
    if (found >= 0) start = found;
  } catch (error) { /* as above */ }
  show(start);
  return { show, models };
}

function init() {
  const host = document.getElementById("explorer-models");
  if (host) mountExplorerModels(host);
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}
