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
ok("the registry offers the default and seven skins",
  ids.join(",") === "default,cabinet,crt,pixel,vector,outrun,beige,hud", ids.join(","));

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
  "--skin-bg:", "--skin-panel:", "--skin-ink:", "--skin-muted:", "--skin-vignette:"];
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

console.log(`${pass} passed`);
if (fail) console.log(`${fail} FAILED`);
process.exit(fail ? 1 : 0);
