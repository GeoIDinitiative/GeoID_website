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
  modes = ["gis", "model", "research"],
  own = null, ownPlaying = false, ownLabel = "Sounds of Mars - NASA InSight",
} = {}) {
  const made = new Map();
  const make = (id, cls = []) => {
    const el = {
      id, disabled: false, clicks: 0, style: {},
      classList: { _s: new Set(cls), contains(c) { return this._s.has(c); } },
      click() { this.clicks += 1; },
    };
    made.set(id, el);
    return el;
  };
  for (const m of modes) make(`view-mode-${m}`);
  if (project) make("project-open-modal");
  if (music) make("music-btn", playing ? [] : ["is-paused"]);
  // A world's own recording: its own button, and an icon that says whether it
  // is playing by being swapped rather than by a class.
  if (own) {
    make("audio-play-btn");
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
  check("the recording says it is playing by its SWAPPED ICON, not by a class",
    worldAudio(fakeDoc({ own: true, ownPlaying: false })).playing === false
    && worldAudio(fakeDoc({ own: true, ownPlaying: true })).playing === true);
}
{
  // The nine planet pages have the same row; a page that dropped a control must
  // not have it drawn in the header, greyed or otherwise.
  const s = modeBarState(fakeDoc({ music: false, project: false, modes: ["gis", "model"] }));
  check("a control the page does not have is not offered", s.music.present === false && s.project === false);
  check("and neither is a mode it does not have", s.modes.join() === "gis,model");
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

  const shell = strip(readFileSync(here("../../../geohub/index.html"), "utf8"));
  const bar = shell.slice(shell.indexOf("const modeBar ="), shell.indexOf("globeFrame?.addEventListener(\"load\", claimModeBar)"));
  check("the shell's buttons only post a press",
    /toViewer\(\{ type: "geoid:modebar-press", target: btn\.dataset\.modebar \}\)/.test(bar));
  check("and the shell decides nothing about the app's state",
    !/GeoIDModeManager|localStorage|setMode|new Audio/.test(bar));
  check("the shell draws what the viewer reported, and reveals the bar only then",
    /function renderModeBar\(state\)/.test(bar) && /modeBar\.hidden = false;/.test(bar)
    && /<div class="nav-modebar" id="nav-modebar" hidden>/.test(read("../../../geohub/index.html")));
}

// ── The two pages that must KEEP their own row ──────────────────────────────
{
  // A phone's header has no room, so the stylesheet hides the bar there — and
  // an unconditional claim would then leave no mode switch anywhere at all.
  const shell = strip(readFileSync(here("../../../geohub/index.html"), "utf8"));
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
