/**
 * THE THEME REGISTRY, THE STYLESHEET AND THE PAGES, PINNED TO EACH OTHER.
 *
 * Three lists have to agree and none of them fails loudly when they drift: the
 * ids `scripts/theme.js` offers in the dropdown, the `[data-skin="…"]` blocks
 * `styles/viewer-themes.css` actually carries, and the pages that load the
 * pair. An id with no CSS block is a dropdown entry that changes nothing; a
 * CSS block with no id is a theme nobody can reach; a page that loads the
 * stylesheet and not the script is a page stuck on the default forever.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? `  — ${detail}` : ""}`); }
};
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const script = read("scripts/theme.js");
const css = read("styles/viewer-themes.css");

const ids = [...script.matchAll(/\{ id: "([a-z]+)"/g)].map((m) => m[1]);
ok("the registry offers the default and six skins",
  ids.join(",") === "default,crt,pixel,vector,outrun,beige,hud", ids.join(","));

// Comments quote the ids while explaining them, so the blocks are counted from
// the SELECTORS — the same reason the shelf-name check strips prose.
const blocks = new Set([...css.matchAll(/:root\[data-skin="([a-z]+)"\]\s*\{/g)]
  .map((m) => m[1]));
for (const id of ids.filter((i) => i !== "default")) {
  ok(`${id} has a palette block`, blocks.has(id));
}
ok("and no block exists that the dropdown cannot reach",
  [...blocks].every((id) => ids.includes(id)), [...blocks].join(","));
// The default is the ABSENCE of the attribute, so the base skin applies
// exactly as it did before any of this existed.
ok("the default is a no-op, not a sixth palette",
  !blocks.has("default") && /id === "default"\) root\.removeAttribute\("data-skin"\)/.test(script));

// Every theme must restate the whole palette: a block that sets the chrome and
// forgets the ground inherits half of the previous theme.
const TOKENS = ["--skin-chrome:", "--skin-chrome-rgb:", "--skin-data:", "--skin-data-rgb:",
  "--skin-bg:", "--skin-panel:", "--skin-ink:", "--skin-muted:", "--skin-vignette:",
  // The two OPAQUE grounds. A theme that forgets them keeps the previous
  // theme's ground behind every tab body — measured under the beige skin,
  // `rgb(16, 7, 36)` was still sitting on a grey panel.
  "--skin-tab-ground:", "--skin-card-ground:"];
for (const id of blocks) {
  const at = css.indexOf(`:root[data-skin="${id}"] {`);
  const block = css.slice(at, css.indexOf("}", at));
  ok(`${id} restates the whole palette`,
    TOKENS.every((t) => block.includes(t)),
    TOKENS.filter((t) => !block.includes(t)).join(" "));
}

ok("the stylesheet balances its braces",
  (css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length);

/**
 * THE BRAND ROW ENDS WHERE EVERY OTHER ROW ENDS.
 *
 * `.brand-hero` is a two-column grid and nothing has ever mounted in the
 * second column — all eleven viewers ship one child — so the wordmark's row
 * was 19.2px narrower than the tab list under it (measured: 30.6–357.8
 * against 30.6–377). Invisible while the row had no background, and the first
 * thing you see once a theme paints it.
 */
{
  const skin = read("styles/viewer-skin.css");
  ok("the brand spans its whole row when it is the only child",
    /\.brand-hero > \.brand:only-child \{ grid-column: 1 \/ -1; \}/.test(skin));
  ok("and the row's dead right padding is gone",
    /\.brand-hero \{ padding-right: 0; \}/.test(skin));
  // `:only-child`, so a second child — if one is ever added — restores the
  // two-column behaviour on its own rather than being overlapped.
  ok("scoped so a second column would still work", /:only-child/.test(skin));
}

/**
 * THE MARK IS NEVER RESTYLED — the one instruction that outranks every theme.
 * Pinned on the source because a filter added anywhere above would be silent.
 */
ok("no theme filters, tints or blends the GeoID mark",
  /\.brand-logo[\s\S]*?filter: none !important/.test(css)
  // `\s*` matches EMPTY, so a lookahead after it fires one space early and
  // reads "mix-blend-mode: normal" as a blend. The space has to be required.
  && !/brand-logo[^}]*(hue-rotate|grayscale|invert|mix-blend-mode:\s+(?!normal\b))/.test(css));

/**
 * THE FLASH. A module is deferred by definition, so a themed page would paint
 * once in the old palette and switch a frame later. The script is a plain one
 * in <head>, and the stamp happens at parse time rather than on DOMContentLoaded.
 */
ok("the applier is not a module", !/type="module"[^>]*theme\.js/.test(read("geohub/index.html")));
ok("and it stamps before the body exists",
  script.indexOf("stamp(stored());") < script.indexOf("addEventListener(\"message\""));

// Every page that loads one has to load the other, in that order.
const pages = ["geohub/index.html", "GeoID_GIS/viewer/index.html", "GeoID_Earth/viewer/index.html",
  "earth_explorer/etna/viewer/index.html", "everest/index.html",
  ...["mercury","venus","moon","mars","jupiter","saturn","uranus","neptune","pluto"]
    .map((b) => `planet_explorer/${b}/viewer/index.html`)];
for (const page of pages) {
  const html = read(page);
  const cssAt = html.indexOf("/styles/viewer-themes.css");
  const jsAt = html.indexOf("/scripts/theme.js");
  ok(`${page.split("/")[0]} loads both`, cssAt > -1 && jsAt > -1,
    `css ${cssAt} js ${jsAt}`);
  // After the base skin, or the base would win; on Etna, after its ember
  // variant too, or a chosen theme could not override the per-viewer one.
  const skinAt = html.lastIndexOf("/styles/viewer-skin");
  if (skinAt > -1) ok(`${page.split("/")[1] || page} themes after the skin`, cssAt > skinAt);
}

/**
 * THE TWO DOCUMENTS. The GIS viewer is an iframe inside the shell, and a theme
 * that stopped at the iframe edge would leave the page around it in the old
 * palette — so the shell's own accent had to stop being a literal.
 */
const shell = read("styles/geohub-shell.css");
ok("the shell resolves its accent through the skin token",
  /--hub-accent-rgb: var\(--skin-chrome-rgb\)/.test(shell));
ok("and its ground, panels and ink too",
  /background: var\(--skin-bg\)/.test(shell)
  && /--hub-panel-fill: rgba\(var\(--skin-panel\)/.test(shell)
  && /--hub-text: var\(--skin-ink\)/.test(shell));
const shellRules = shell.slice(shell.indexOf("body {"));
ok("no chrome literal survives in a shell RULE",
  !/#ff2bd6|255,\s*43,\s*214/.test(shellRules));

// The GIS panels wrote the DATA colour out as a literal in 55 places, which is
// a theme axis: the CRT's data colour is amber and the pixel theme's is blue.
for (const p of ["GeoID_GIS/viewer/styles.css", "GeoID_GIS/viewer/gis/shell.css"]) {
  ok(`${p.split("/").pop()} has no data-colour literal left`,
    !/#52e4e8|82,\s*228,\s*232/.test(read(p)));
}
// And the two opaque grounds were literals in seven MODULES, which is why a
// light theme still had a purple-black card in it.
for (const p of ["gis/legend-dock.js", "gis/side-panels.js", "gis/table-editor.js",
  "gis/panel-styles.js", "gis/tool-dialog.js", "gis/timelapse-player.js", "gis/gee.js"]) {
  const src = read(`GeoID_GIS/viewer/${p}`);
  ok(`${p.split("/").pop()} reads the grounds as tokens`,
    !/rgb\(16, ?7, ?36\)(?!\))/.test(src.replace(/var\(--skin-\w+-ground, [^)]+\)\)/g, ""))
    && !/rgb\(24, ?13, ?47\)(?!\))/.test(src.replace(/var\(--skin-\w+-ground, [^)]+\)\)/g, "")));
}

/**
 * A LINKED THEME IS NOT A CHOSEN ONE. `?skin=` wins for that load so a theme
 * can be linked and shot, and is deliberately not persisted: a link that
 * rewrote what the person who opened it had chosen would be changing their
 * settings rather than showing them a theme.
 */
ok("a URL can ask for a theme", /get\("skin"\)/.test(script));
ok("only one the CSS has a block for", /known\(value\) \? value : null/.test(script));
ok("and it is stamped without being stored",
  /stamp\(asked\(\) \|\| stored\(\)\)/.test(script)
  && !/setItem\([^)]*asked\(\)/.test(script));

/**
 * THE SHELL STAMPS ITSELF IN <head>, WHICH IS BEFORE ITS IFRAME EXISTS — so a
 * `?skin=` on the shell had nothing to tell and the viewer came up in whatever
 * it had stored. Measured exactly that way: a CRT shell around a default
 * viewer. The frame asks on the way up; storage covers every other case.
 */
ok("a framed document asks its parent what the theme is",
  /postMessage\(\{ type: "geoid:skin\?" \}/.test(script));
ok("and the parent answers with what it is SHOWING, not what it stored",
  /data\.type === "geoid:skin\?"[\s\S]*?skin: current\(\)/.test(script)
  && /getAttribute\("data-skin"\) \|\| "default"/.test(script));
// An answer must not overwrite the asker's own stored preference — a linked
// theme is shown, not adopted.
ok("an answered theme is applied without being stored",
  /persist: false \}, "\*"\)/.test(script));

ok("the message the two documents pass is one type",
  (script.match(/geoid:skin"/g) || []).length >= 2);
// Two documents each telling the other is a loop.
ok("and a received theme is applied without being re-announced",
  /apply\(data\.skin, \{ tell: false,/.test(script));

/**
 * THE DRAWN SURFACES. A canvas and a three.js material cannot read a
 * stylesheet, so the clock, the label chips and the hover highlight stayed in
 * the default palette under every theme. Each asks the theme for its own
 * token, and each token defaults to the value it drew before themes existed —
 * so the default theme is untouched and a theme opts in by restating one line.
 */
{
  const viewer = read("GeoID_GIS/viewer/earth-viewer.js");
  const popup = read("GeoID_GIS/viewer/gis/feature-popup.js");
  ok("the theme publishes a token reader for canvases",
    /function token\(name, fallback\)/.test(script) && /function hex\(name, fallback\)/.test(script));
  ok("the clock asks for its ink", /token\?\.\("--skin-clock", "#3fe0e6"\)/.test(viewer));
  ok("the label chip asks for its accent", /token\?\.\("--skin-chip", "#3aeee8"\)/.test(viewer));
  ok("the map's hover outline asks for its colour",
    /hex\?\.\("--skin-hover-map", 0x8ef6ff\)/.test(popup));
  // A theme change moves no digit, so the clock's equality guard would skip
  // the redraw and leave it in the previous colour — for ever on a paused one.
  ok("and the clock is invalidated when the theme changes",
    /geoid:skin-changed[\s\S]{0,120}clockShown = ""/.test(viewer));
  // Only the CURATED chip follows the theme: a dataset label takes its accent
  // from its own layer's legend, and overriding that is a theme overruling data.
  ok("a dataset label's own colour is not overridden",
    /label already takes its accent from its layer/.test(viewer));
  /**
   * THE ROW HOVER was a hard-coded violet in twenty places, which made it the
   * one state identical in every theme — and it is the state a reader sees
   * most often, so it was the first thing reported as "still the same".
   */
  // Comments stripped: the note explaining the hover quotes the violet it
  // used to be, and prose is not a colour — the same reason the shelf-name
  // and the ice-catalogue checks strip them.
  const styles = read("GeoID_GIS/viewer/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
  ok("the row hover is a token, not a violet literal",
    !/190, ?120, ?255|#be78ff/.test(styles) && /--skin-hover-rgb/.test(styles));
  for (const t of ["crt", "pixel", "vector", "outrun", "beige", "hud"]) {
    const at = css.indexOf(`:root[data-skin="${t}"] {`);
    const block = css.slice(at, css.indexOf("}", at));
    ok(`${t} gives the row hover its own colour`,
      ["--skin-hover:", "--skin-hover-rgb:", "--skin-hover-ink:"].every((k) => block.includes(k)));
    ok(`${t} sets all three drawn-surface colours`,
      ["--skin-clock:", "--skin-chip:", "--skin-hover-map:"].every((k) => block.includes(k)));
  }
}

/**
 * A GROUND CAN BE A GRADIENT, and `backgroundColor` will not show it.
 *
 * The geology card measured as a LIGHT card under the Workstation theme and
 * rendered dark: its ground is a `background-image` gradient painted over the
 * colour, so the colour had been tokenised and the gradient had not. When a
 * surface refuses a theme, read `backgroundImage` before believing
 * `backgroundColor`.
 */
{
  const styles = read("GeoID_GIS/viewer/styles.css");
  ok("the popup's gradient ground is a token too",
    !/rgba\(18, ?28, ?38, ?0\.95\), ?rgba\(6, ?11, ?17/.test(styles)
    && /linear-gradient\(180deg, var\(--skin-card-ground/.test(styles));
  // An open legend entry is filled with the accent, so its ink is white —
  // forcing every head black put black on navy on the one being read.
  ok("an open legend head keeps white ink on its fill",
    /:not\(\.is-folded\) \.legend-entry-head[\s\S]{0,120}color: #ffffff/.test(css));
  ok("and only a FOLDED one is forced black",
    /\.legend-entry\.is-folded \.legend-entry-head/.test(css));
}

/**
 * THEME SOUNDS, IN THE ONE SOUND SYSTEM.
 *
 * `ui-sound.js` was already here — on every viewer, enabled by default, with a
 * hover tick, rate limiting, a control selector and a mute API. A second one
 * beside it meant two clicks on one press and the reader hearing whichever
 * fired first, which is exactly what "the sound is the same in every theme"
 * turned out to be. The voices are a table in that file instead.
 */
{
  const sound = read("scripts/ui-sound.js");
  const voices = [...sound.matchAll(/^    "?(\w+)"?: \{ hover:/gm)].map((m) => m[1]);
  ok("every theme has a voice, and so does the default",
    voices.join(",") === "default,crt,pixel,vector,outrun,beige,hud", voices.join(","));
  ok("the voice is read from the theme on the root",
    /getAttribute\("data-skin"\)/.test(sound) && /VOICES\[skin\]/.test(sound));
  // The default entry is what this file always played, so a reader on the
  // GeoHUB theme hears no change at all.
  ok("the default voice is the one it always played",
    /"default": \{ hover: \[2050, 0\.032, 0\.045, "sine"\]/.test(sound)
    && /click: \[\[1350, 0\.055, 0\.13, "triangle"\], \[760, 0\.065, 0\.09, "square"\]\]/.test(sound));
  ok("a click is a PAIR, which is what reads as a select rather than a beep",
    /blip\(c\[0\]\[0\][\s\S]{0,80}blip\(c\[1\]\[0\]/.test(sound));
  // One system, one switch.
  ok("there is no second sound system", !fs.existsSync(path.join(root, "scripts/theme-sound.js")));
  ok("and no page still asks for one",
    !/theme-sound\.js/.test(read("geohub/index.html"))
    && !/theme-sound\.js/.test(read("GeoID_GIS/viewer/index.html")));
  ok("the switch drives the real one",
    /gis-skin-sound[\s\S]{0,200}GeoIDUiSound\.setEnabled/.test(script));
  ok("and reads its state back from it",
    /soundBox\.checked = window\.GeoIDUiSound\.isEnabled\(\)/.test(script));
}

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
