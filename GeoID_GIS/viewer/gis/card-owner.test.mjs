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
  let b = 0;
  own("event", "Live events", () => { throw new Error("boom"); });
  let threw = false;
  try { own("feature", "Rivers", () => { b += 1; }); } catch { threw = true; }
  const closed = check([]);
  ok("a closer that throws does not keep the next card from opening", !threw && b === 1 && closed.length === 1);
}
/* ONE CARD ON THE GLOBE: claiming a slot closes the cards in the others, so a
   card opened over another cannot leave the first one's highlight lit. */
{
  let event = 0; let viewer = 0;
  own("event", "Live events", () => { event += 1; release("event"); });
  own("viewer", "World geology (Macrostrat)", () => { viewer += 1; });
  ok("a new card closes the card held in another slot", event === 1 && viewer === 0);
  own("viewer", "Plate boundaries (Bird 2003)", () => { viewer += 1; });
  ok("and re-claiming its OWN slot closes nothing", viewer === 0);
  release("viewer");
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

/* ── leaving GIS: what no layer owns, the page switch has to put away ─────── */
{
  const mm = read("./mode-manager.js");
  ok("leaving GIS pauses a running time-lapse", /closeCards\?\.\(\);\s*window\.GeoIDFeaturePopup\?\.hidePopup\?\.\(\);\s*window\.GeoIDTimelapsePlayer\?\.pause\?\.\(\);/.test(mm));
  ok("and any page but Model closes the studio's part card", /if \(mode !== "model"\) window\.GeoIDMeshStudio\?\.closePartCard\?\.\(\);/.test(mm));
  const tl = readFileSync(new URL("./timelapse-player.js", import.meta.url), "utf-8");
  ok("the bar is hidden while a page without a globe is up",
    /body\.studio-open \.geoid-timelapse, body\.research-open \.geoid-timelapse \{ display: none !important; \}/.test(tl));
  ok("the studio publishes its part-card closer", /window\.GeoIDMeshStudio = \{[\s\S]{0,400}closePartCard,/.test(read("./model-studio.js")));
}

{
  // A dataset label's chip opens the scene card without feature-popup seeing
  // the click, so the label itself names its layer and the opener claims it.
  const viewer = read("../earth-viewer.js");
  ok("the scene card claims a dataset label's layer where it opens",
    /activePopupIsCoreLabel = Boolean\(isCoreLabel\);\s*if \(feature\?\.source_layer\) \{\s*window\.GeoIDCardOwner\?\.own\?\.\("viewer", feature\.source_layer, \(\) => closeScenePopup\(\)\)/.test(viewer));
  const pl = read("./point-labels.js");
  ok("label items name their layer", /\.map\(\(item\) => \(\{ \.\.\.item, source_layer: layer\.name \}\)\)/.test(pl));
  ok("and so do the scene items a dot click builds", /return item \? \{ \.\.\.item, source_layer: layer\.name \} : item;/.test(pl));
}

process.on("exit", () => {
  failures.forEach((f) => console.log(`   ✗ ${f}`));
  console.log(`\n  ${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
});
