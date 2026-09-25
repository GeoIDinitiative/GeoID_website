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
import { may, refusal, FEATURES, signInUrl, state, authService } from "./membership.js?v=20260925-e61b297";

/**
 * Which tab or section belongs to which feature.
 *
 * Ids, because an id is what survives the panel being rebuilt, re-nested per
 * body, or moved onto a rail — all three of which happen here.
 */
const LOCKED_SECTIONS = [
  /**
   * TARGETED, not whole tabs. Locking Hazards shut the wildfire feed, the
   * exposure map and the drought rows with it -- none of which is ours to
   * charge for -- so the lock is on the SUBTABS that hold the models GeoID
   * computes itself, and everything beside them in the same tab stays open.
   */
  { id: "gis-group-geoid", feature: "mygeoid" },              // the myGeoID mode bar
  { id: "hazard-landslides-section", feature: "landslides" },
  { id: "hazard-flood-section", feature: "flood" },
  { id: "hazard-cyclones-section", feature: "cyclone-risk" },
  { id: "hazard-seismic-section", feature: "seismic-risk" },
  { id: "hazard-volcanic-section", feature: "volcanic-risk" },
  { id: "hydrology-sea-level", feature: "sealevel" },
  { id: "rock-properties-section", feature: "rockprops" },
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

/**
 * Mode buttons that need a membership to press.
 *
 * EMPTY, and deliberately so. The MODEL page — the Meshing Studio — is free and
 * open: somebody may build a mesh, boolean it, flag its surfaces and export a
 * package without a membership. What is gated is the Model Builder TAB in the
 * nav bar (`gis-group-mesh`), which is the pipeline that samples the REAL
 * ground into a domain, and that is a section rather than a mode.
 */
const LOCKED_MODES = [];

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
.gis-locked > summary,
.gis-locked > .section-toggle {
  opacity: 0.5;
  filter: grayscale(1);
  background: rgba(255, 255, 255, 0.03) !important;
  border-color: rgba(255, 255, 255, 0.14) !important;
  color: rgba(255, 255, 255, 0.72) !important;
  box-shadow: none !important;
}
.gis-locked > summary *,
.gis-locked > .section-toggle * { color: inherit !important; }
.gis-locked > summary:hover,
.gis-locked > .section-toggle:hover { opacity: 0.66; }
.gis-locked {
  border-color: rgba(255, 255, 255, 0.12) !important;
  box-shadow: none !important;
}

/*
 * The lock rides at FULL strength inside the dimmed row, so it is the one thing
 * that has not been faded -- which is what makes it read as the reason.
 *
 * A REAL ELEMENT rather than a pseudo. There are three header shapes here --
 * a bare summary on a tool section, a summary.section-toggle on a toolbox
 * group, and a DIV.section-toggle on the myGeoID bar, which is not a details
 * element at all -- and only the middle one has the .section-title-row the
 * first version hung the mark off. A span appended to whichever header is
 * there works for all three and cannot collide with a pseudo the panel sheets
 * are already using for a chevron.
 */
.gis-lock-mark {
  display: inline-block;
  width: 13px; height: 13px;
  margin-left: 0.45rem;
  flex: 0 0 auto;
  vertical-align: -2px;
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
.gis-lock-card .gis-lock-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; margin: 0; }
/* The second action is the same shape at a lower weight: two equal buttons is
   two decisions, and only one of them is the one to take. */
.gis-lock-card .gis-lock-go.is-quiet {
  border-color: rgba(255, 255, 255, 0.22);
  color: rgba(255, 255, 255, 0.72);
}
.gis-lock-card .gis-lock-go.is-quiet:hover { background: rgba(255, 255, 255, 0.07); }

/*
 * AN ICON BUTTON WEARS THE MARK AS A CORNER BADGE -- the folder in the header
 * row and the Export door in the Workspace box, both of which are a glyph and
 * a tooltip. There is no name to put the mark beside, and 13px of padlock
 * inside a 1.05rem folder is a smudge. Full strength and in the accent, so it
 * reads as deliberate rather than as the icon having gone wrong, and haloed
 * against the panel behind it so it is not taken for part of the drawing.
 *
 * The button is NOT dimmed, which every other locked thing here is. It still
 * opens -- the dialog is where the reason is written out, and a button that
 * refused would have nowhere to say why -- so greying it would say "this does
 * nothing", which is not true of it.
 */
.gis-lock-badge.is-locked { position: relative; overflow: visible; }
.gis-lock-badge.is-locked > .gis-lock-mark {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 11px; height: 11px;
  margin: 0;
  background: var(--nav-accent, #ff2bd6);
  filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.9)) drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.9));
}

/*
 * A door inside the dialog that is going to refuse wears it inline, where
 * there IS a name to put it beside -- and goes grey with it, which is the
 * rule a locked tab already follows: the contrast dropping is what says "you
 * cannot use this" before anything is read, and the lock is the reason. Bright
 * and merely disabled, these two read as live buttons with an ornament.
 */
.button.is-locked {
  opacity: 0.5;
  filter: grayscale(1);
  cursor: not-allowed;
}
.button.is-locked .gis-lock-mark { opacity: 0.9; }

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

/** What this section calls itself, for the label a screen reader reads. */
function nameOf(node) {
  const head = node.querySelector(":scope > summary")
    || node.querySelector(":scope > .section-toggle");
  return (head?.textContent || "").replace(/\s+/g, " ").trim() || "This";
}

/**
 * The card that stands in a locked tab's body -- and, exported, anywhere else
 * a door has to say why it will not open.
 *
 * THE FIRST ACTION IS THE ONE THEY CAN TAKE. Until the membership service was
 * reachable there was only ever one link here, to the page describing what
 * membership will be, because "sign in" was an instruction nobody could
 * follow. With the service live, somebody signed OUT is one press from the
 * thing being refused, so that press leads; somebody signed in and not a
 * member has nothing to sign into and is sent to membership instead. `may`
 * answers the same either way, so the difference is only in what to offer.
 */
export function lockCard(feature) {
  installStyle();
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

  const row = document.createElement("p");
  row.className = "gis-lock-actions";
  // The RETURN is the top document's, not this one's: a viewer is framed, so
  // `location.href` here is the iframe's own URL and coming back to it would
  // load a viewer with no shell around it.
  const signedOut = !state().signedIn;
  const canSignIn = signedOut && Boolean(authService());
  if (canSignIn) row.appendChild(link("Sign in", signInUrl(`${location.origin}/`), true));
  row.appendChild(link(canSignIn ? "About membership" : "Membership",
    "/membership/", !canSignIn));

  card.append(head, what, why, row);
  return card;
}

function link(text, href, primary) {
  const a = document.createElement("a");
  a.className = primary ? "gis-lock-go" : "gis-lock-go is-quiet";
  a.textContent = text;
  a.href = href;
  // Inside the GIS iframe, or a viewer loads inside a viewer.
  a.target = "_top";
  return a;
}

/**
 * The padlock on its own, for a control that has no body to put a card in.
 *
 * A button cannot hold an explanation, so it wears the mark and says the rest
 * in its tooltip and its accessible name -- the same division a locked tab
 * makes between the grey (the signal) and the lock (the reason).
 */
export function lockMark() {
  installStyle();
  const mark = document.createElement("span");
  mark.className = "gis-lock-mark";
  mark.setAttribute("aria-hidden", "true");
  return mark;
}

/** Lock or unlock one `<details>` section. */
function applySection({ id, feature }) {
  const node = document.getElementById(id);
  if (!node) return;
  const locked = !may(feature);
  node.classList.toggle("gis-locked", locked);

  /**
   * The header is whichever of the three shapes this section has. `:scope >`
   * matters: a section holds other sections, and without it the FIRST nested
   * summary anywhere inside would be marked instead of this one's own.
   */
  const head = node.querySelector(":scope > summary")
    || node.querySelector(":scope > .section-toggle");
  if (head) {
    const mark = head.querySelector(":scope > .gis-lock-mark");
    if (locked && !mark) {
      const span = document.createElement("span");
      span.className = "gis-lock-mark";
      span.setAttribute("aria-hidden", "true");
      head.appendChild(span);
    } else if (!locked && mark) {
      mark.remove();
    }
    // Said out loud as well as drawn, for a reader who cannot see the mark.
    if (locked) head.setAttribute("aria-label", `${nameOf(node)} — members only`);
    else head.removeAttribute("aria-label");

    /**
     * A CONTROL IN THE HEADER IS NOT IN THE BODY, and hiding the body leaves it
     * pressable.
     *
     * The myGeoID bar carries its Enter button in its header, the way Tour Mode
     * does — so with the body hidden behind the lock card, the one control that
     * actually arms the mode was still sitting there live. Disabled rather than
     * hidden, so the row still reads as the thing it is; `data-lock-disabled`
     * marks what this turned off, or unlocking would re-enable a control that
     * was disabled for some other reason of its own.
     */
    head.querySelectorAll("button, input, select").forEach((control) => {
      if (locked) {
        if (!control.disabled) {
          control.disabled = true;
          control.dataset.lockDisabled = "1";
          control.title = refusal(feature);
        }
      } else if (control.dataset.lockDisabled) {
        control.disabled = false;
        delete control.dataset.lockDisabled;
        control.title = "";
      }
    });
  }

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
    const where = signInUrl(`${location.origin}/`);
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
