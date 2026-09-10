/**
 * A card goes when the layer it describes goes. The behaviour half drives the
 * real registry against fake layer lists; the wiring half pins every card that
 * claims a layer, because each lingering card was a card nobody had told.
 */
import { readFileSync } from "node:fs";
import { own, release, check, shown } from "./card-owner.js";

let pass = 0;
const failures = [];
const ok = (name, cond) => { if (cond) pass += 1; else failures.push(name); };

const layer = (id, name, visible = true) => ({ id, name, visible, object3D: { visible } });

{
  let closed = 0;
  own("event", "Live events", () => { closed += 1; });
  check([layer(1, "Live events")]);
  ok("a card stays while its layer is on the globe", closed === 0);
  check([layer(1, "Live events", false)]);
  ok("and closes when its layer is HIDDEN", closed === 1);
  check([layer(1, "Live events", false)]);
  ok("exactly once", closed === 1);
}
{
  let closed = 0;
  own("feature", layer(7, "Coastlines"), () => { closed += 1; });
  check([layer(8, "Rivers")]);
  ok("a card closes when its layer is REMOVED", closed === 1);
}
{
  // A tiled layer rebuilds as a NEW OBJECT with the same name on every settle;
  // matched by identity, a geology card would close whenever the view moved.
  let closed = 0;
  own("viewer", layer(3, "World geology (Macrostrat)"), () => { closed += 1; });
  check([layer(99, "World geology (Macrostrat)")]);
  ok("a rebuilt layer keeps its card (matched by name)", closed === 0);
}
{
  // One owner per slot: a newer card replaces the claim, so hiding an OLD
  // card's layer cannot close the card that replaced it.
  let first = 0; let second = 0;
  own("viewer", "Soils", () => { first += 1; });
  own("viewer", "Plate boundaries", () => { second += 1; });
  check([layer(1, "Plate boundaries")]);
  ok("hiding the old card's layer leaves the new card", first === 0 && second === 0);
}
{
  let closed = 0;
  own("event", "Live events", () => { closed += 1; });
  release("event");
  check([]);
  ok("a released slot closes nothing", closed === 0);
}
{
  let a = 0; let b = 0;
  own("event", "Live events", () => { throw new Error("boom"); });
  own("feature", "Rivers", () => { b += 1; });
  const closed = check([]);
  ok("a closer that throws does not keep the others open", b === 1 && closed.length === 2);
  a = a; // (a closer that throws is still counted as closed)
}
ok("shown() needs the layer's object visible too",
  !shown({ id: "1", name: "X" }, [{ id: 1, name: "X", visible: true, object3D: { visible: false } }]));

/* ── the wiring ─────────────────────────────────────────────────────────── */

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (p) => strip(readFileSync(new URL(p, import.meta.url), "utf-8"));
const viewer = read("../earth-viewer.js");
ok("every geology-style card claims its layer where they all meet (openGeoPopup)",
  /activeGeoPopupFeature = feature;\s*if \(feature\?\.source_layer\) \{\s*window\.GeoIDCardOwner\?\.own\?\.\("viewer", feature\.source_layer/.test(viewer));
ok("and the closers release it", /function closeGeoPopup\(\) \{\s*if \(activeGeoPopupFeature\) window\.GeoIDCardOwner\?\.release\?\.\("viewer"\)/.test(viewer)
  && /function closeScenePopup\(\) \{\s*if \(activePopupFeature\) window\.GeoIDCardOwner\?\.release\?\.\("viewer"\)/.test(viewer));
const fp = read("./feature-popup.js");
ok("feature-popup's own card claims its layer", /own\?\.\("feature", layerRecord \|\| layerName/.test(fp));
ok("and the scene cards it hands the viewer", /openSceneFeature\?\.\(item\)\) \{\s*hidePopup\(\{ keepOutline: false \}\);\s*window\.GeoIDCardOwner\?\.own\?\.\("viewer", top\.layer/.test(fp));
const ev = read("./events.js");
ok("the event card claims the feed's layer", /own\?\.\("event", LAYER_NAME, hidePopup\)/.test(ev));
ok("and closes when its event is no longer drawn", /!events\.some\(\(e\) => e\.id === card\.dataset\.eventId\)/.test(ev));
for (const f of ["./soil-thickness.js", "./worldpop.js", "./landslide-pipeline.js"]) {
  ok(`${f} names its layer on the card it raises`, /showFeatureCard\?\.\(\{[^}]*source_layer: LAYER_NAME,/.test(read(f)));
}
ok("the satellites' card claims the tracker's layer", /own\?\.\("viewer", LAYER_NAME/.test(read("./satellites.js")));
ok("Earth loads the registry", readFileSync(new URL("../index.html", import.meta.url), "utf-8").includes("gis/card-owner.js"));
ok("and so do the planets", read("./boot.js").includes('"./card-owner.js"'));

process.on("exit", () => {
  failures.forEach((f) => console.log(`   ✗ ${f}`));
  console.log(`\n  ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
