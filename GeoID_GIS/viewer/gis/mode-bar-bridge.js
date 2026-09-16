/**
 * The mode bar, hosted by the SHELL'S HEADER rather than by a page of the app.
 *
 * `.brand-toprow` used to be re-parented into whichever page was on screen --
 * the GIS sidebar, the Model ribbon, the Research shell row -- and each host
 * then decided where it landed. Two of the three could be made to agree
 * (31, 33 and 31, 20); the third could not, because the Research hub's rail
 * owns the first 96px of its own layout, so the row sat at 106 there. A bar
 * that moves is a bar whose position is three other layouts' business.
 *
 * So when this viewer is FRAMED by a shell that has a header, the header hosts
 * it: one bar, at one place, that does not move when the page under it does.
 *
 * WHAT CROSSES THE FRAME IS A PRESS AND A STATE, NEVER A BEHAVIOUR. The shell
 * cannot hold the DOM -- a node belongs to one document -- so it draws its own
 * buttons, and every one of them posts `geoid:modebar-press` and does nothing
 * else. This module answers by CLICKING THE VIEWER'S OWN CONTROL, so the mode
 * switch, the project dialog and the music player each keep exactly one
 * implementation and the shell cannot drift from them. The reverse direction
 * is the same shape: `geoid:modebar` reports what the viewer's own controls
 * say about themselves, read off those elements rather than remembered here.
 *
 * Standalone -- the viewer opened on its own, and the nine planet pages, none
 * of which loads the site header -- nothing here applies and the in-page row
 * is exactly what it always was. That is why the row is HIDDEN rather than
 * removed: the shell announcing itself is what hides it, so a page with no
 * shell keeps its own bar with no condition to get wrong.
 */

const TARGETS = {
  gis: "view-mode-gis",
  model: "view-mode-model",
  research: "view-mode-research",
  project: "project-open-modal",
  music: "music-btn",
};

/**
 * THE WORLD'S OWN RECORDING -- "Sounds of Mars - NASA InSight" -- which the
 * nine planet viewers carry and Earth does not.
 *
 * It is NOT the music player. The two are different sources with different
 * credits: the playlist is the app's, and this is the page's, published by
 * whoever recorded it. It rides on the right of the banner where the page's
 * own things go, and it is simply absent on a world that has none.
 *
 * Playing is read from the SWAPPED ICON rather than a class, because that is
 * how this button says it -- the music player says it the other way.
 */
export function worldAudio(doc = document) {
  const el = doc.getElementById("audio-play-btn");
  if (!el) return null;
  const pause = doc.getElementById("audio-icon-pause");
  const label = (doc.querySelector(".brand-audio p")?.textContent || "").trim();
  return {
    el,
    playing: Boolean(pause && pause.style && pause.style.display !== "none"),
    label: label || "Sounds of this world",
  };
}

/**
 * THE row -- the one holding the mode switch, not the first element that
 * happens to carry the class. Four workbench panels head themselves with a
 * `.brand-toprow` of their own, and `parkModeRow` moves this one between three
 * hosts, so neither the class nor document order identifies it.
 */
function modeRow(doc = document) {
  return doc.getElementById("view-mode-switch")?.closest(".brand-toprow") || null;
}

/**
 * Everything in the row the HEADER now draws, the mode buttons included.
 * Anything else in there belongs to the page.
 */
const HEADER_DRAWN = new Set([
  "project-open-modal", "view-mode-switch",
  "view-mode-gis", "view-mode-model", "view-mode-research",
  "music-btn",
]);

/**
 * IS THERE ANYTHING OF THE PAGE'S OWN LEFT IN THE ROW?
 *
 * Earth keeps its collapse beside the panel's title now, so once the header
 * draws the other three the row holds nothing -- and an empty bar with a
 * border under it is furniture for a control that has moved. The nine planet
 * viewers head the SAME row with their info button and their collapse, so
 * theirs must stay. Counted rather than guessed, or this is a list of which
 * worlds are which, kept in step by hand.
 */
export function rowIsOnlyModeBar(row) {
  if (!row) return false;
  const controls = row.querySelectorAll("button, input, select, a, [role=button]");
  return [...controls].every((el) => HEADER_DRAWN.has(el.id));
}

/** The viewer's own control for a name the shell can press. */
function controlFor(target, doc) {
  const id = TARGETS[target];
  return id ? doc.getElementById(id) : null;
}

/**
 * What the shell's copy has to draw, read off the controls THEMSELVES.
 *
 * Not from this module's own memory of what it last did: the mode is changed
 * by a key, by a link, by the studio standing a locked mode down, and a bar
 * that remembered its own presses would report a mode the page had left.
 */
export function modeBarState(doc = document) {
  const music = doc.getElementById("music-btn");
  const audio = worldAudio(doc);
  const project = Boolean(doc.getElementById("project-open-modal"));
  const modes = ["gis", "model", "research"].filter((m) => doc.getElementById(TARGETS[m]));
  return {
    mode: doc.body?.dataset?.viewMode || "gis",
    modes,
    project,
    music: music
      ? { present: true, playing: !music.classList.contains("is-paused") }
      : { present: false, playing: false },
    audio: audio
      ? { present: true, playing: audio.playing, label: audio.label }
      : { present: false, playing: false, label: "" },
  };
}

/**
 * A press is a CLICK ON THE REAL CONTROL, which is the whole point: a locked
 * mode still refuses, the project dialog still opens its own way, and the
 * music button still runs the playlist's own error handling.
 */
export function pressModeBarTarget(target, doc = document) {
  const el = target === "audio" ? worldAudio(doc)?.el : controlFor(target, doc);
  if (!el || el.disabled) return false;
  el.click();
  return true;
}

function install() {
  if (typeof window === "undefined" || !window.addEventListener) return;
  // Not framed: this viewer has no shell to host anything, and its own row is
  // already where it belongs.
  if (window.self === window.top) return;

  let hosted = false;

  const report = () => {
    if (!hosted) return;
    try {
      window.parent.postMessage({ type: "geoid:modebar", ...modeBarState() }, "*");
    } catch (error) {
      /* cross-origin parent, ignore */
    }
  };

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "geoid:modebar-host") {
      // The shell is drawing the bar, so this page stops drawing its own. A
      // class rather than `hidden`: the row is a flex item in three different
      // hosts and every one of them sets `display`, which outranks the
      // attribute -- the trap this tree has paid for five times.
      //
      // MARKED ON THE ROW, NEVER ON THE BODY. `.brand-toprow` is not one
      // element: the workbench panels ARE the sidebar (`adoptSidebarShell`),
      // so Geoprocessing, Analysis, Export and Settings each head themselves
      // with one too -- five on the page, and a `body.x .brand-toprow` rule
      // took the title, the collapse and the CLOSE off all four of them.
      // The row is the one holding the mode switch, which is true wherever
      // `parkModeRow` has moved it to.
      hosted = msg.hosted !== false;
      document.body.classList.toggle("modebar-hosted", hosted);
      const row = modeRow();
      row?.classList.toggle("is-modebar-hosted", hosted);
      row?.classList.toggle("is-modebar-empty", hosted && rowIsOnlyModeBar(row));
      report();
      return;
    }

    if (msg.type === "geoid:modebar-press") {
      if (pressModeBarTarget(msg.target)) report();
    }
  });

  // Every seam that can move the state, rather than a poll: the mode is
  // stamped onto <body> by mode-manager, and the music button rewrites its own
  // class when the audio starts or stops.
  const watch = new MutationObserver(report);
  watch.observe(document.body, { attributes: true, attributeFilter: ["data-view-mode"] });
  // Each player says it is playing in its own way: a class on the music
  // button, a swapped icon on a world's own recording.
  const music = document.getElementById("music-btn");
  if (music) watch.observe(music, { attributes: true, attributeFilter: ["class"] });
  const icon = document.getElementById("audio-icon-pause");
  if (icon) watch.observe(icon, { attributes: true, attributeFilter: ["style"] });

  // The shell may be listening before this module loads or after it; saying so
  // once on load covers the first, and the host message covers the second.
  try {
    window.parent.postMessage({ type: "geoid:modebar-ready" }, "*");
  } catch (error) {
    /* cross-origin parent, ignore */
  }
}

install();
