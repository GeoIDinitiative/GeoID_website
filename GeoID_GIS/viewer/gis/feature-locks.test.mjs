/**
 * Checks for how a locked thing SAYS it is locked.
 *
 *     node GeoID_GIS/viewer/gis/feature-locks.test.mjs
 *
 * Read off the SOURCE rather than by importing. These modules want a document,
 * a shell and a viewer between them, and what is being pinned is a set of
 * decisions about what the reader is shown -- each of which was got wrong once
 * and each of which fails QUIETLY when it goes: a door that looks live and
 * refuses after the press, a padlock nobody can see, a lock that never lifts
 * when somebody signs in.
 *
 * The fault these exist for, in one sentence: saving and exporting are
 * membership's, and a free reader used to find that out by opening the folder
 * dialog, typing a project name, pressing Create and reading an error line at
 * the foot of it.
 */
import { readFileSync } from "node:fs";

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const read = (file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
/** Comments are prose, not code: a note ABOUT a rule must not satisfy it. */
const code = (file) => read(file)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const locks = read("feature-locks.js");
const locksCode = code("feature-locks.js");
const project = code("project.js");
const addData = code("add-data.js");
const shelves = code("tool-shelves.js");

// ── 1. The card is shared, not copied ──────────────────────────────────────
//
// The folder dialog needs exactly the card a locked tab shows. A second one
// written beside it is how two refusals for one gate come to disagree -- the
// fault this tree records for the clip button, the extraction dialog and the
// click sound.
check("lockCard is exported", /export function lockCard\(/.test(locksCode));
check("lockMark is exported", /export function lockMark\(/.test(locksCode));
check("the folder dialog uses them rather than its own",
  /import \{[^}]*\blockCard\b[^}]*\blockMark\b[^}]*\} from "\.\/feature-locks\.js/.test(project)
  || /import \{[^}]*\blockMark\b[^}]*\blockCard\b[^}]*\} from "\.\/feature-locks\.js/.test(project));
check("and builds no card of its own",
  !/class\s*=\s*["']gis-lock-card/.test(project) && !/gis-lock-card/.test(project));

// ── 2. The first action is the one they can take ───────────────────────────
//
// Until the service was reachable there was one link, to the page describing
// what membership would be, because "sign in" was an instruction nobody could
// follow. Signed OUT with a service live, the sign-in is one press from the
// thing being refused, so it leads; signed IN and not a member there is
// nothing to sign into and membership leads instead.
check("the card offers a sign-in", /signInUrl\(/.test(locksCode));
check("...only when signed out", /!state\(\)\.signedIn/.test(locksCode));
check("...and only when a service is configured", /authService\(\)/.test(locksCode));
check("...returning to the TOP document, not the framed viewer",
  /signInUrl\(`\$\{location\.origin\}\/`\)/.test(locksCode));
check("every link leaves the frame", (locksCode.match(/target = "_top"/g) || []).length >= 1);

// ── 3. Shown and disabled, never hidden ────────────────────────────────────
//
// The dialog IS the saving feature: hiding its controls leaves a dialog with
// nothing in it and no way to find out what it was for.
check("the dialog leads with the card", /body\.appendChild\(lockCard\("save"\)\)/.test(project));
check("the three doors that would throw are refused, not removed",
  (project.match(/refuse\(/g) || []).length >= 4, // the definition plus three calls
  String((project.match(/refuse\(/g) || []).length));
check("a refused door is disabled AND says why",
  /button\.disabled = true;/.test(project) && /button\.title = refusal\("save"\)/.test(project));
check("...and carries the mark", /button\.appendChild\(lockMark\(\)\)/.test(project));

// ── 4. The doors that are only a glyph wear a badge ────────────────────────
for (const [what, src] of [["the folder", project], ["Export", addData]]) {
  check(`${what} takes the badge class`, /gis-lock-badge/.test(src));
  check(`${what} says the refusal in its tooltip`, /refusal\("save"\)/.test(src));
  check(`${what} puts the sentence on the accessible name too`,
    /setAttribute\("aria-label", \w+\.title\)/.test(src));
}
check("the badge is a class rather than one control's rule",
  /\.gis-lock-badge\.is-locked \{/.test(locks) && !/\.eyebrow-project\.is-locked \{/.test(locks));

// ── 5. The panel BEHIND the Export door says it too ─────────────────────
//
// Export's own icon is marked, but the button it reveals -- "Choose a layer to
// export…" in the Workspace's Export panel -- was the last live-looking door on
// this path. Pressing it reaches `openExportDialog`, which refuses with a
// `window.alert`: browser chrome, in the middle of the app's own idiom, after
// the press. That alert STAYS, because the dialog is reachable from
// `window.GeoIDLayerExport` too and a gate wants its enforcement at the gate --
// but nobody arriving by the button should ever meet it.
//
// The panel has a BODY, so it takes the card rather than a bare mark: that is
// the division this file pins everywhere else, and an Export panel that showed
// only a padlock would be the one locked surface with no reason written in it.
check("the export panel leads with the shared card",
  /lockCard\("save"\)/.test(shelves)
  && /body\.insertBefore\(card, body\.firstChild\)/.test(shelves));
check("...from the shared module, never a second card",
  /import \{[^}]*\blockCard\b[^}]*\} from "\.\/feature-locks\.js/.test(shelves)
  && !/gis-lock-card/.test(shelves));
check("...and its button is disabled, marked, and says why",
  /button\.disabled = locked;/.test(shelves)
  && /button\.classList\.toggle\("is-locked", locked\)/.test(shelves)
  && /button\.title = refusal\("save"\)/.test(shelves)
  && /button\.appendChild\(lockMark\(\)\)/.test(shelves));
check("...on the accessible name as well as the tooltip",
  /setAttribute\("aria-label",\s*\n?\s*locked \? `\$\{button\.textContent\.trim\(\)\} — \$\{refusal\("save"\)\}`/.test(shelves));
check("the alert behind it is left standing as the enforcement",
  /if \(!may\("save"\)\) \{ window\.alert\?\.\(refusal\("save"\)\); return null; \}/
    .test(code("layer-export-dialog.js")));
check("and the panel follows the membership event",
  /addEventListener\("geoid:membership", paintLock\)/.test(shelves));

// ── 6. A sign-in lifts it without a reload ─────────────────────────────────
//
// Every one of these is built once. Without the membership event a reader
// signs in and is still looking at the refusal they have just answered.
check("the folder follows the membership event",
  /addEventListener\("geoid:membership"/.test(project));
check("...and re-renders an open dialog", /if \(!byId\("project-dialog"\)\?\.hidden\) void render\(\)/.test(project));
check("Export follows it too", /addEventListener\("geoid:membership", paint\)/.test(addData));

// ── 7. The header's copy is told, and told in the right order ──────────────
//
// The shell draws its own folder button -- a node belongs to one document --
// so the lock has to cross the frame. It is READ off the app's own button
// rather than worked out on the far side, which is the rule the whole bar is
// under. And it is read from a MUTATION of that button: this module and
// project.js both listen for the membership event, this one was installed
// first, so a report fired on the event alone carried the class the button
// had not changed yet. Measured: the dialog unlocked, the header stayed
// locked.
const bridge = code("mode-bar-bridge.js");
check("the bar reports the folder's lock", /locked: folder\.classList\.contains\("is-locked"\)/.test(bridge));
check("...read off the button, not decided there", !/\bmay\(/.test(bridge));
check("...by watching that button change",
  /watch\.observe\(folder, \{ attributes: true/.test(bridge));
check("...attached again when the shell claims, for a page whose button arrives with the shell",
  (bridge.match(/^\s*watchFolder\(\);/gm) || []).length === 2,
  `${(bridge.match(/^\s*watchFolder\(\);/gm) || []).length} call sites`);
check("...and never twice on the same node, or every report is doubled",
  /folder === folderWatched/.test(bridge));

// ── 8. The trap this file has paid for seven times ─────────────────────────
//
// A backtick inside the STYLE template literal ends the string, and the module
// then throws at load with every rule it injects gone. module-css.test.mjs
// checks this across the tree; it is here as well because the last one was
// written into THIS file.
{
  const start = locks.indexOf("const STYLE = `");
  const body = locks.slice(start + "const STYLE = `".length);
  check("no backtick survives inside the STYLE literal",
    !body.slice(0, body.indexOf("`")).includes("`"));
}

process.on("exit", () => {
  console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
  if (failures) process.exitCode = 1;
});
