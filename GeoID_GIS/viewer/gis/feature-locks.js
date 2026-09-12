/**
 * What a locked part of the app looks like.
 *
 * The gates themselves live at the doors the work goes through
 * (`membership.js`, and the chokepoints that ask it). This is the other half:
 * making a locked tab LOOK locked, so nobody presses a control that is going to
 * refuse them.
 *
 * A LOCKED THING IS SHOWN, NEVER HIDDEN. Hiding it would be easier and is
 * worse: a feature nobody can see is a feature nobody knows they could have,
 * and the tab bar is how somebody finds out what GeoID does. So a locked tab
 * keeps its place, wears a padlock, and opens onto a card saying what is behind
 * it and how to get in. That is the same rule the nav's own Membership button
 * follows.
 *
 * THE MARKUP IS NEVER REMOVED. Modules all over this tree read element ids
 * unguarded at boot — `geology-structures-toggle` is the one the notes name,
 * and there are a dozen more — so a lock HIDES a tab's contents behind a class
 * and puts a card in front of them. Unlocking is removing the class. Nothing
 * downstream can tell the difference, which is what makes a sign-in mid-session
 * work without a reload.
 */
import { may, refusal, FEATURES, signInUrl } from "./membership.js?v=20260912-af72246";

/**
 * Which tab or section belongs to which feature.
 *
 * Ids, because an id is what survives the panel being rebuilt, re-nested per
 * body, or moved onto a rail — all three of which happen here.
 */
const LOCKED_SECTIONS = [
  { id: "modelled-data-section", feature: "hazards" },
  { id: "explorer-models-section", feature: "explorers" },
  /**
   * THE MODEL BUILDER IS TWO SURFACES, and locking one is locking half of it.
   *
   * `gis-group-mesh` is its tab in the sidebar -- the study area, the layers,
   * the surface, the domain, the conditions and the build -- and the MODEL
   * mode button opens the Meshing Studio the package goes to. Both, or the
   * pipeline stays usable in a tab while the studio it feeds is shut.
   */
  { id: "gis-group-mesh", feature: "builder" },
];

/** Mode buttons that need a membership to press. */
const LOCKED_MODES = [
  { id: "view-mode-model", feature: "builder" },
];

const STYLE = `
/*
 * A LOCKED TAB READS AS LOCKED AT A GLANCE.
 *
 * A padlock alone was too quiet -- reported as no change at all. What says
 * "you cannot use this" before anything is read is the CONTRAST dropping: the
 * tab goes grey where its neighbours carry the accent, and the lock is the
 * confirmation rather than the signal.
 *
 * The colours are forced with !important because a tab's own state rules --
 * the accent border, the filled header when it is open, the has-active-data
 * fill -- are written at a higher specificity by the shared panel sheets, and
 * a locked tab must not be able to light up underneath this.
 */
.gis-locked > summary {
  opacity: 0.5;
  filter: grayscale(1);
  background: rgba(255, 255, 255, 0.03) !important;
  border-color: rgba(255, 255, 255, 0.14) !important;
  color: rgba(255, 255, 255, 0.72) !important;
  box-shadow: none !important;
}
.gis-locked > summary * { color: inherit !important; }
.gis-locked > summary:hover { opacity: 0.66; }
.gis-locked {
  border-color: rgba(255, 255, 255, 0.12) !important;
  box-shadow: none !important;
}

/*
 * The lock rides at FULL strength inside the dimmed row, so it is the one thing
 * that has not been faded -- which is what makes it read as the reason.
 */
.gis-locked > summary .section-title-row::after {
  content: "";
  width: 13px; height: 13px;
  margin-left: 0.45rem;
  flex: 0 0 auto;
  background: currentColor;
  opacity: 1;
  -webkit-mask: var(--geoid-lock) center/contain no-repeat;
  mask: var(--geoid-lock) center/contain no-repeat;
}

.gis-locked > .section-body > *:not(.gis-lock-card) { display: none !important; }
.gis-lock-card {
  border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.4);
  border-radius: 0.6rem;
  padding: 0.85rem 0.9rem;
  background: rgba(var(--nav-accent-rgb, 255, 43, 214), 0.06);
}
.gis-lock-card h4 {
  margin: 0 0 0.35rem;
  display: flex; align-items: center; gap: 0.4rem;
  font: 600 0.76rem/1.2 "Exo 2", system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--nav-accent, #ff2bd6);
}
.gis-lock-card h4::before {
  content: "";
  width: 13px; height: 13px; flex: 0 0 auto;
  background: currentColor;
  -webkit-mask: var(--geoid-lock) center/contain no-repeat;
  mask: var(--geoid-lock) center/contain no-repeat;
}
.gis-lock-card p { margin: 0 0 0.6rem; font-size: 0.82rem; line-height: 1.5; opacity: 0.86; }
.gis-lock-card p:last-child { margin-bottom: 0; }
.gis-lock-card .gis-lock-go {
  display: inline-block;
  padding: 0.36rem 0.7rem;
  border-radius: 0.4rem;
  border: 1px solid rgba(var(--nav-accent-rgb, 255, 43, 214), 0.55);
  color: var(--nav-accent, #ff2bd6);
  text-decoration: none;
  font: 600 0.74rem/1 "Exo 2", system-ui, sans-serif;
}
.gis-lock-card .gis-lock-go:hover { background: rgba(var(--nav-accent-rgb, 255, 43, 214), 0.14); }

/* A locked mode button, in the same language as a locked tab. */
.view-mode-btn.is-locked {
  opacity: 0.5;
  filter: grayscale(1);
  cursor: not-allowed;
}
`;

/**
 * The padlock, as a data URI so the mask needs no file.
 *
 * A file would be one more thing to publish and one more thing to 404, and this
 * mark is twelve pixels of outline.
 */
const LOCK_SVG = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E"
  + "%3Crect x='3.2' y='7' width='9.6' height='7' rx='1.2' fill='black'/%3E"
  + "%3Cpath d='M5.4 7V5.1a2.6 2.6 0 0 1 5.2 0V7' fill='none' stroke='black' stroke-width='1.5'/%3E"
  + "%3C/svg%3E\")";

let installed = false;

function installStyle() {
  if (installed) return;
  installed = true;
  try {
    const tag = document.createElement("style");
    tag.id = "geoid-feature-locks";
    tag.textContent = STYLE;
    document.head.appendChild(tag);
    document.documentElement.style.setProperty("--geoid-lock", LOCK_SVG);
  } catch (error) { /* no document: a test */ }
}

/** The card that stands in a locked tab's body. */
function lockCard(feature) {
  const f = FEATURES[feature];
  const card = document.createElement("div");
  card.className = "gis-lock-card";
  card.dataset.lockFor = feature;

  const head = document.createElement("h4");
  head.textContent = "Members";
  const what = document.createElement("p");
  what.textContent = f ? f.blurb : "";
  const why = document.createElement("p");
  why.textContent = refusal(feature);
  const go = document.createElement("a");
  go.className = "gis-lock-go";
  go.textContent = "About membership";
  go.href = "/membership/";
  // Inside the GIS iframe, or a viewer loads inside a viewer.
  go.target = "_top";

  card.append(head, what, why, go);
  return card;
}

/** Lock or unlock one `<details>` section. */
function applySection({ id, feature }) {
  const node = document.getElementById(id);
  if (!node) return;
  const locked = !may(feature);
  node.classList.toggle("gis-locked", locked);

  const body = node.querySelector(".section-body") || node;
  const existing = body.querySelector(`:scope > .gis-lock-card[data-lock-for="${feature}"]`);
  if (locked && !existing) {
    // FIRST, so it is what a reader sees when the tab opens rather than
    // something under whatever the hidden contents left behind.
    body.insertBefore(lockCard(feature), body.firstChild);
  } else if (!locked && existing) {
    existing.remove();
  }
  if (locked) {
    /**
     * A locked tab is CLOSED, once.
     *
     * Not held closed: `open` is the reader's to set, and forcing it every pass
     * would fight somebody trying to read the card inside. Closing it the first
     * time a lock lands is the app not opening a door it has just locked.
     */
    if (node.open && !node.dataset.lockClosed) {
      node.open = false;
      node.dataset.lockClosed = "1";
    }
  } else {
    delete node.dataset.lockClosed;
  }
}

/** Lock or unlock one mode button. */
function applyMode({ id, feature }) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const locked = !may(feature);
  btn.classList.toggle("is-locked", locked);
  btn.setAttribute("aria-disabled", locked ? "true" : "false");
  btn.title = locked ? refusal(feature) : "";
}

/**
 * A press on a locked mode button, refused before mode-manager hears it.
 *
 * CAPTURE phase, because mode-manager binds its own handler to the same button
 * and whichever was registered first would otherwise win. Not `disabled`: a
 * disabled button takes no click at all, so there is nothing to explain with,
 * and the whole point of showing a locked control is that pressing it tells you
 * why.
 */
function guardModes() {
  document.addEventListener("click", (event) => {
    const btn = event.target?.closest?.(".view-mode-btn");
    if (!btn) return;
    const entry = LOCKED_MODES.find((m) => m.id === btn.id);
    if (!entry || may(entry.feature)) return;
    event.preventDefault();
    event.stopPropagation();
    const where = signInUrl(`${location.origin}/geohub/`);
    if (window.confirm(`${refusal(entry.feature)}\n\nGo to membership?`)) {
      window.top.location.href = window.GeoIDMembership?.state?.().signedIn
        ? "/membership/" : where;
    }
  }, true);
}

export function applyLocks() {
  installStyle();
  LOCKED_SECTIONS.forEach(applySection);
  LOCKED_MODES.forEach(applyMode);
}

/**
 * Re-applied on a beat as well as on the membership event.
 *
 * These panels are rebuilt constantly — the taxonomy re-nests per body, the
 * catalogues redraw on every layer change, and the mode switch is re-parked
 * whenever the mode changes — so a lock applied once is a lock that quietly
 * comes off. The same reason the icon painter polls.
 */
function start() {
  if (typeof document === "undefined" || !document.addEventListener) return;
  applyLocks();
  document.addEventListener("geoid:membership", applyLocks);
  guardModes();
  setInterval(applyLocks, 900);
}

start();
