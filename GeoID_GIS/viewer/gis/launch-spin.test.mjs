/**
 * The Earth turns on launch.
 *
 * The events feed arms itself at every launch, and mode-manager's `setSpin`
 * held the globe whenever the feed was on -- so whenever the mode was applied
 * after the feed armed, the globe opened stopped (reported 2026-10-23). The
 * hold belongs to a reader who opened the feed, not to the launch.
 *
 *   node GeoID_GIS/viewer/gis/launch-spin.test.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0; let fail = 0;
const check = (msg, cond) => { if (cond) { pass += 1; console.log(`PASS  ${msg}`); } else { fail += 1; console.log(`FAIL  ${msg}`); } };
process.on("exit", () => { console.log(`${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1; });

const events = readFileSync(new URL("./events.js", import.meta.url), "utf8");
const modes = readFileSync(new URL("./mode-manager.js", import.meta.url), "utf8");
const viewer = readFileSync(new URL("../earth-viewer.js", import.meta.url), "utf8");

check("the feed armed by the launch does not hold the globe",
  /dataset\.eventsHold = active && !launch \? "true" : "false"/.test(events));
check("the launch arms the feed AS a launch", /setActive\(true, \{ remember: false, launch: true \}\)/.test(events));
const spin = modes.slice(modes.indexOf("function setSpin("), modes.indexOf("function setSpin(") + 900);
check("setSpin holds for a feed a reader opened, not for the feed being on",
  /dataset\.eventsHold !== "true"/.test(spin) && !/dataset\.events !== "true"/.test(spin));
check("the globe opens at the real rate", /setTimeRate\("real"\);\s*positionCameraOverPrimeMeridian/.test(viewer));
check("and unpaused", /let spinPaused = false;/.test(viewer));
