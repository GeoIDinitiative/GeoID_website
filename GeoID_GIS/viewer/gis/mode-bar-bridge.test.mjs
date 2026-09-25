/**
 * THE MODE BAR IN THE SHELL'S HEADER.
 *
 * What is pinned here is the one rule the arrangement rests on: the shell
 * draws buttons, and every one of them PRESSES THE VIEWER'S OWN CONTROL. The
 * moment the shell starts deciding anything — which mode is legal, what the
 * music button does next, whether the project dialog may open — there are two
 * implementations of one control in two documents, which is the drift this
 * tree has paid for with the clip button, the extraction dialog and the click
 * sound.
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function check(name, ok, note = "") {
  if (ok) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${note ? `  — ${note}` : ""}`); }
}

const here = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(here(p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");

const { modeBarState, pressModeBarTarget, worldAudio, rowIsOnlyModeBar } =
  await import("./mode-bar-bridge.js");

/** The smallest document the pure halves read. */
function fakeDoc({
  mode = "gis", playing = false, music = true, project = true,
  projectLocked = false, projectLabel = null,
  modes = ["gis", "model", "research"],
  own = null, ownPlaying = false, ownLabel = "Sounds of Mars - NASA InSight", ownHidden = false,
} = {}) {
  const made = new Map();
  // ATTRIBUTES, not just classes: the folder's refusal is words, and the words
  // are the app's own, already written into the button's `aria-label`. A stub
  // with only a class list answered `folder.getAttribute is not a function`
  // and took every check in this file down with it -- an element that cannot
  // be asked for an attribute is not a stand-in for one that can.
  const make = (id, cls = [], attrs = {}) => {
    const el = {
      id, disabled: false, clicks: 0, style: {}, attrs: { ...attrs },
      classList: { _s: new Set(cls), contains(c) { return this._s.has(c); } },
      getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
      setAttribute(n, v) { this.attrs[n] = String(v); },
      click() { this.clicks += 1; },
    };
    made.set(id, el);
    return el;
  };
  for (const m of modes) make(`view-mode-${m}`);
  if (project) {
    make("project-open-modal", projectLocked ? ["is-locked"] : [],
      projectLabel === null ? {} : { "aria-label": projectLabel });
  }
  if (music) make("music-btn", playing ? [] : ["is-paused"]);
  // A world's own recording: its own button, and an icon that says whether it
  // is playing by being swapped rather than by a class.
  if (own) {
    // Its box, as the page wrote it: Mercury, Venus and Pluto hide theirs.
    const box = { hidden: false, style: { display: ownHidden ? "none" : "" } };
    make("audio-play-btn").closest = (sel) => (sel === ".brand-audio" ? box : null);
    make("audio-icon-pause").style.display = ownPlaying ? "block" : "none";
  }
  return {
    made,
    body: { dataset: { viewMode: mode } },
    getElementById: (id) => made.get(id) || null,
    querySelector: (sel) => (sel === ".brand-audio p" && own ? { textContent: ownLabel } : null),
  };
}

// ── The state the shell redraws from is READ OFF THE CONTROLS ───────────────
// Not remembered on either side: the mode is changed by a key, by a link and
// by the studio standing a locked mode down, and a bar that remembered its own
// presses would report a mode the page had left.
{
  const d = fakeDoc({ mode: "model", playing: true });
  const s = modeBarState(d);
  check("the mode comes off the body, where mode-manager stamps it", s.mode === "model");
  check("the player's state comes off the button's own class", s.music.present && s.music.playing === true);
  const paused = modeBarState(fakeDoc({ playing: false }));
  check("and a paused player reports paused", paused.music.playing === false);
}
// ── The world's own recording is NOT the music player ───────────────────────
// Two sources with two credits: the playlist is the app's and rides in the bar;
// "Sounds of Mars - NASA InSight" is the page's and rides on the right of the
// banner. A planet carries both, and reporting one as the other is how two
// controls come to mean one thing.
{
  const mars = modeBarState(fakeDoc({ own: true, ownPlaying: true, playing: false }));
  check("a world with a recording reports BOTH, separately",
    mars.music.present && mars.music.playing === false
    && mars.audio.present && mars.audio.playing === true);
  check("and the page's own name for it travels with the control",
    mars.audio.label === "Sounds of Mars - NASA InSight");
  const earth = modeBarState(fakeDoc({ own: null }));
  check("a world with none reports none, rather than the music standing in for it",
    earth.audio.present === false && earth.music.present === true);
  // Mercury, Venus and Pluto: the same markup, a generic ambient file, and the
  // box hidden by the page. The header drew "SOUNDS OF SPACE" for them.
  const placeholder = modeBarState(fakeDoc({ own: true, ownHidden: true, ownLabel: "Sounds of Space" }));
  check("a world whose page hides its audio box has NO recording, not a placeholder",
    placeholder.audio.present === false && placeholder.audio.label === ""
    && worldAudio(fakeDoc({ own: true, ownHidden: true })) === null);
  check("and a recording with no credit shows no invented caption",
    worldAudio(fakeDoc({ own: true, ownLabel: "" })).label === "");
  check("the recording says it is playing by its SWAPPED ICON, not by a class",
    worldAudio(fakeDoc({ own: true, ownPlaying: false })).playing === false
    && worldAudio(fakeDoc({ own: true, ownPlaying: true })).playing === true);
}
{
  // The nine planet pages have the same row; a page that dropped a control must
  // not have it drawn in the header, greyed or otherwise.
  const s = modeBarState(fakeDoc({ music: false, project: false, modes: ["gis", "model"] }));
  check("a control the page does not have is not offered",
    s.music.present === false && s.project.present === false);
  check("and neither is a mode it does not have", s.modes.join() === "gis,model");
}

// ── THE FOLDER'S LOCK TRAVELS; IT IS NOT DECIDED ON THIS SIDE ───────────────
// Saving and exporting are membership's, so a free reader meeting the header's
// copy of the folder is owed that BEFORE the press, not after filling in a
// project name. That means the shell needs the state — but WHICH WAY THE GATE
// WENT is the app's question, asked once, in the viewer, by the module that
// owns it. This side reads the answer off the viewer's own button: the class
// it wears and the words the app already wrote into its `aria-label`. Asking
// the membership module a second time, in a second document, is the two
// implementations of one control that this whole file exists to refuse.
{
  const open = modeBarState(fakeDoc());
  check("an open folder is present, unlocked, and under its plain name",
    open.project.present === true && open.project.locked === false
    && open.project.label === "Projects");
  const shut = modeBarState(fakeDoc({
    projectLocked: true,
    projectLabel: "Projects — Sign in as a member to save and export your work.",
  }));
  check("a locked one carries BOTH the lock and the app's own words for it",
    shut.project.locked === true
    && shut.project.label === "Projects — Sign in as a member to save and export your work.");
  // Shown and refused, never hidden: the padlock IS the message, and a folder
  // that vanished for signed-out readers would teach them the site has no
  // projects rather than that projects are a member's.
  check("and a locked folder is still offered, because the refusal is the point",
    shut.project.present === true);
  // A button whose label the app never wrote still gets a name, so the header
  // never draws a control captioned `null`.
  check("a folder with no words of its own falls back to a name, not to nothing",
    modeBarState(fakeDoc({ projectLocked: true })).project.label === "Projects");

  const bridge = strip(read("./mode-bar-bridge.js"));
  check("the bridge asks the BUTTON, never the gate",
    /folder\.classList\.contains\("is-locked"\)/.test(bridge)
    && /folder\.getAttribute\("aria-label"\)/.test(bridge)
    && !/\bmay\(/.test(bridge) && !/feature-locks/.test(bridge));
  // The lock arrives AFTER this bridge installs -- both sides listen for
  // `geoid:membership` and the bridge got there first, so on an unlock it
  // reported the class the button had not changed yet. Measured: the header
  // stayed locked until the next unrelated redraw. The button's own mutation
  // is the signal, and the guard is what keeps a re-host from stacking
  // observers on the same element.
  check("and it learns of a change by watching that button MUTATE",
    /watch\.observe\(folder, \{ attributes: true, attributeFilter: \["class", "aria-label"\] \}\)/.test(bridge)
    && /folder === folderWatched/.test(bridge));
}

// ── A press is a CLICK ON THE REAL CONTROL ──────────────────────────────────
{
  const d = fakeDoc();
  check("a mode press clicks that mode's own button", pressModeBarTarget("model", d) && d.made.get("view-mode-model").clicks === 1);
  check("the folder presses the viewer's own project button", pressModeBarTarget("project", d) && d.made.get("project-open-modal").clicks === 1);
  check("and the player's button is the player's own", pressModeBarTarget("music", d) && d.made.get("music-btn").clicks === 1);
  const mars = fakeDoc({ own: true });
  check("a world's recording is pressed through ITS button, never the music's",
    pressModeBarTarget("audio", mars)
    && mars.made.get("audio-play-btn").clicks === 1
    && mars.made.get("music-btn").clicks === 0);
  check("and on a world with no recording that press does nothing",
    pressModeBarTarget("audio", fakeDoc({ own: null })) === false);
  check("a name that is not a control presses nothing", pressModeBarTarget("solve", d) === false);
  const gone = fakeDoc({ music: false });
  check("and a control the page lacks cannot be pressed", pressModeBarTarget("music", gone) === false);
  d.made.get("view-mode-gis").disabled = true;
  check("a disabled control is left alone, so a locked mode still refuses",
    pressModeBarTarget("gis", d) === false && d.made.get("view-mode-gis").clicks === 0);
}

// ── The structural half: neither side may grow a second implementation ──────
{
  const src = strip(read("./mode-bar-bridge.js"));
  check("the bridge does nothing at all when the page is not framed",
    /if \(window\.self === window\.top\) return;/.test(src));
  check("it never sets the mode itself — it clicks the control",
    !/GeoIDModeManager|setMode\(/.test(src) && /el\.click\(\);/.test(src));

  const shell = strip(readFileSync(here("../../../index.html"), "utf8"));
  const bar = shell.slice(shell.indexOf("const modeBar ="), shell.indexOf("globeFrame?.addEventListener(\"load\", claimModeBar)"));
  check("the shell's buttons only post a press",
    /toViewer\(\{ type: "geoid:modebar-press", target: btn\.dataset\.modebar \}\)/.test(bar));
  check("and the shell decides nothing about the app's state",
    !/GeoIDModeManager|localStorage|setMode|new Audio/.test(bar));
  check("the shell draws what the viewer reported, and reveals the bar only then",
    /function renderModeBar\(state\)/.test(bar) && /modeBar\.hidden = false;/.test(bar)
    && /<div class="nav-modebar" id="nav-modebar" hidden>/.test(read("../../../index.html")));
}

// ── The two pages that must KEEP their own row ──────────────────────────────
{
  // A phone's header has no room, so the stylesheet hides the bar there — and
  // an unconditional claim would then leave no mode switch anywhere at all.
  const shell = strip(readFileSync(here("../../../index.html"), "utf8"));
  // THE PLAYER IS CLAIMED ON ITS OWN WIDTH. It is one 30px button beside the
  // membership group and does not reach for the centred tab headers, so the
  // 1400px rule that stands the BAR down has nothing to say about it. Coupled
  // to that rule it stood down at 1399 while the header went on drawing it:
  // measured at 1300, the header's button showing AND the world's own player
  // back in the deck -- the duplicate this whole arrangement removes.
  check("the player follows the width at which the header actually hides it",
    /const phone = window\.matchMedia\("\(max-width: 680px\)"\);/.test(shell)
    && /audio: Boolean\(navMusic\) && !phone\.matches,/.test(shell)
    && /phone\.addEventListener\?\.\("change", claimModeBar\);/.test(shell));
  check("and either claim is reason to report, or the header is never told",
    /if \(!hosted && !audioHosted\) return;/.test(read("./mode-bar-bridge.js")));
  for (const p of ["../styles.css", "./shell.css"]) {
    const css = strip(read(p));
    check(`${p.split("/").pop()}: the deck's player answers the AUDIO claim`,
      /body\.audio-hosted \.brand-audio \{ display: none !important; \}/.test(css)
      && !/body\.modebar-hosted \.brand-audio/.test(css));
  }
  check("a narrow screen hands the bar back to the page, at the width the links need",
    /const narrow = window\.matchMedia\("\(max-width: 1399px\)"\);/.test(shell)
    && /hosted: Boolean\(modeBar\) && !narrow\.matches,/.test(shell)
    && /narrow\.addEventListener\?\.\("change", claimModeBar\);/.test(shell));
  const nav = strip(readFileSync(here("../../../styles/site-nav.css"), "utf8"));
  check("and the stylesheet is the other half of that width",
    /@media \(max-width: 1399px\) \{\s*\.site-nav \.nav-modebar \{ display: none; \}/.test(nav));

  // THE TAB HEADERS MAY NOT MOVE. The wordmark and the membership group are
  // both `flex: 1 1 0` and that pair is what centres the links -- measured with
  // no bar, dead centre; measured with one in the line, 194px off and then 69.
  // Centring them on the BAR takes them out of that balance for good, so
  // nothing added to the header can shift them again.
  check("the tab headers are centred on the bar, not on what sits either side",
    /\.site-nav:has\(\.nav-modebar:not\(\[hidden\]\)\) \.nav-links \{\s*position: absolute;\s*left: 50%;\s*transform: translateX\(-50%\);/.test(nav)
    && /\.site-nav:has\(\.nav-modebar:not\(\[hidden\]\)\) \.nav-wordmark \{ flex: 0 0 auto; \}/.test(nav));
  // Scoped, or the twenty-one content pages that share this header change too.
  check("and every rule that moves the header is scoped to a bar that is showing",
    nav.split("\n").filter((l) => /\.nav-wordmark \{ flex|\.nav-links \{$/.test(l))
      .every((l) => l.includes(":has(.nav-modebar:not([hidden]))")));

  // Hidden by a class, never the `hidden` attribute: the row is a flex item in
  // three hosts and every one of them sets `display`, which outranks it.
  //
  // AND THE MARK GOES ON THE ROW. `.brand-toprow` is not one element: the
  // workbench panels ARE the sidebar (`adoptSidebarShell`), so Geoprocessing,
  // Analysis, Export and Settings each head themselves with one too. Measured
  // on the live page, `body.modebar-hosted .brand-toprow` hid all five and took
  // the title, the collapse and the CLOSE off all four panels.
  //
  // AND THE ROW ITSELF STAYS. It is not only the mode bar -- it is the
  // sidebar's own top row, and `#nav-collapse-btn`, which folds that panel
  // into the margin, is in it. Hiding the row took the deck's collapse with
  // it, measured at 0x0. Only the three controls the header now draws go.
  for (const p of ["../styles.css", "./shell.css"]) {
    const css = strip(read(p));
    check(`${p.split("/").pop()}: the header's three controls go, the row and its collapse stay`,
      /\.brand-toprow\.is-modebar-hosted > #project-open-modal,\s*\.brand-toprow\.is-modebar-hosted > #view-mode-switch,\s*\.brand-toprow\.is-modebar-hosted #music-btn \{ display: none !important; \}/.test(css)
      && !/\.brand-toprow\.is-modebar-hosted \{ display: none/.test(css)
      && !/body\.modebar-hosted \.brand-toprow \{/.test(css)
      && !/is-modebar-hosted[^{]*#nav-collapse-btn/.test(css));
  }
  const bridge = strip(read("./mode-bar-bridge.js"));
  check("and the row is found by the switch it holds, not by the class or by order",
    /doc\.getElementById\("view-mode-switch"\)\?\.closest\("\.brand-toprow"\)/.test(bridge)
    && /const row = modeRow\(\);\s*row\?\.classList\.toggle\("is-modebar-hosted", hosted\);/.test(bridge)
    && /row\?\.classList\.toggle\("is-modebar-empty", hosted && rowIsOnlyModeBar\(row\)\)/.test(bridge));
  // The empty-row mark is COUNTED, not a list of which worlds head this row
  // with something of their own -- all nine planets used to, and now none does.
  check("and the row's own controls are counted rather than listed",
    rowIsOnlyModeBar({ querySelectorAll: () => [{ id: "view-mode-gis" }, { id: "music-btn" }] }) === true
    && rowIsOnlyModeBar({ querySelectorAll: () => [{ id: "info-btn" }] }) === false);
}

process.on("exit", () => {
  console.log(`mode-bar-bridge: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
