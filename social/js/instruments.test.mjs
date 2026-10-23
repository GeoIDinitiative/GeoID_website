// node social/js/instruments.test.mjs -- the pure parts of the instrument strip.
import assert from "node:assert/strict";
import { kpLevel, sinceText, latestQuake, latestKp } from "./instruments.js";

assert.equal(kpLevel(2.33).word, "quiet");
assert.equal(kpLevel(4).tone, "active");
assert.equal(kpLevel(5).word, "G1 minor storm");
assert.equal(kpLevel(9).word, "G5 extreme storm");
assert.equal(kpLevel(NaN).word, "—");

const now = 1_000_000_000_000;
assert.equal(sinceText(now - 30_000, now), "just now");
assert.equal(sinceText(now - 23 * 60_000, now), "23 min ago");
assert.equal(sinceText(now - 5 * 3600_000, now), "5 h ago");

const q = latestQuake({ features: [
  { properties: { mag: 4.6, place: "A", time: 10, url: "https://earthquake.usgs.gov/a" } },
  { properties: { mag: 5.2, place: "B", time: 20, url: "javascript:alert(1)" } },
] });
assert.equal(q.place, "B");
assert.equal(q.url, "https://earthquake.usgs.gov/earthquakes/map/", "non-USGS urls are replaced");
assert.equal(latestQuake({ features: [] }), null);

assert.deepEqual(latestKp([{ time_tag: "2026-10-23T12:00:00", Kp: 3.33 }]), { kp: 3.33, at: "2026-10-23T12:00:00" });
assert.deepEqual(latestKp([["time_tag", "Kp"], ["2026-10-23 12:00", "4.00"]]), { kp: 4, at: "2026-10-23 12:00" });
assert.equal(latestKp([]), null);
console.log("instruments: ok");
