// node social/js/topics.test.mjs -- which field a post's outline is coloured for.
import assert from "node:assert/strict";
import { topicOf } from "./topics.js";

assert.equal(topicOf({ title: "Etna 2021 lava flow map", tags: ["etna", "volcanology"] }).id, "volcanology");
assert.equal(topicOf({ title: "Volcano deformation poster session", tags: [] }).id, "volcanology");
assert.equal(topicOf({ title: "PhD: earthquake early warning", tags: ["seismology"] }).id, "seismology");
assert.equal(topicOf({ title: "Flood risk in the Severn catchment" }).id, "hydrology");
assert.equal(topicOf({ title: "Glacier retreat in the Alps", tags: ["cryosphere"] }).id, "cryosphere");
assert.equal(topicOf({ title: "InSAR time series", body: "Sentinel-1 deformation" }).id, "geodesy");
assert.equal(topicOf({ title: "GeoID", body: "Email me to explore collaboration." }), null, "nothing matched, no colour");
assert.equal(topicOf({ title: "A veil of fog" }), null, "short stems need whole words");
// Tags outweigh the body.
assert.equal(topicOf({ title: "Field season", tags: ["landslides"], body: "rainfall triggered it" }).id, "landslides");
console.log("topics: ok");
