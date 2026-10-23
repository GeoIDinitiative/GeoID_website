import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";
import { cellDegrees, trendOf } from "../interest.js";

const A = "a@example.com", B = "b@example.com", C = "c@example.com", D = "d@example.com";

async function people(env) {
  for (const [who, handle] of [[A, "ana"], [B, "ben"], [C, "cat"], [D, "dan"]]) {
    await call(env, "PATCH", "/v1/me", { as: who, body: { handle } });
  }
}

test("study areas: rounded on write, at most 10, exact refused, off-map kept on the profile", async () => {
  const env = makeEnv(); await people(env);
  const r = await call(env, "POST", "/v1/me/study-areas", { as: A, body: {
    name: "Mount Etna", location: { lat: 37.7512, lon: 14.9934, precision: "exact" }, radius_km: 40, tags: ["volcanology"] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.location.precision, "approx");
  assert.equal(r.body.location.lat, 37.8);
  assert.equal(r.body.radius_km, 50);
  const hidden = await call(env, "POST", "/v1/me/study-areas", { as: A, body: { name: "Field camp", location: { lat: 64.1, lon: -21.9 }, on_map: false } });
  const list = await call(env, "GET", "/v1/users/ana/study-areas");
  assert.equal(list.body.items.length, 2);
  const map = await call(env, "GET", "/v1/map/interest?bbox=-180,-90,180,90&z=3");
  assert.equal(map.body.researchers, 1, "the off-map area is not counted");
  for (let i = 0; i < 8; i += 1) await call(env, "POST", "/v1/me/study-areas", { as: A, body: { name: `x${i}`, location: { lat: i, lon: i } } });
  assert.equal((await call(env, "POST", "/v1/me/study-areas", { as: A, body: { name: "too many", location: { lat: 1, lon: 1 } } })).status, 409);
  assert.equal((await call(env, "DELETE", `/v1/me/study-areas/${hidden.body.id}`, { as: B })).status, 404, "not yours");
});

test("interest counts people once per cell, not posts", async () => {
  const env = makeEnv(); await people(env);
  for (let i = 0; i < 5; i += 1) {
    await call(env, "POST", "/v1/posts", { as: A, body: { title: `Etna ${i}`, tags: ["volcanology"], location: { lat: 37.75, lon: 14.99, precision: "approx", place: "Mount Etna" } } });
  }
  await call(env, "POST", "/v1/me/study-areas", { as: B, body: { name: "Etna", location: { lat: 37.7, lon: 15.0 }, tags: ["insar"] } });
  await call(env, "POST", "/v1/me/study-areas", { as: C, body: { name: "Vesuvius", location: { lat: 40.82, lon: 14.43 } } });
  const map = await call(env, "GET", "/v1/map/interest?bbox=-180,-90,180,90&z=5");
  assert.equal(map.status, 200, JSON.stringify(map.body));
  const etna = map.body.cells.find((c) => c.place === "Mount Etna");
  assert.ok(etna, JSON.stringify(map.body.cells));
  assert.equal(etna.researchers, 2, "five posts by one person and one study area = two people");
  assert.equal(etna.posts, 5);
  assert.equal(etna.study_areas, 1);
  assert.equal(etna.trend, "new");
  assert.ok(etna.top_tags.includes("volcanology"));
  assert.equal(map.body.researchers, 3);
  assert.ok(map.body.trending.length >= 1);
  // Etna and Vesuvius share a cell at world zoom: the label says so.
  const coarse = await call(env, "GET", "/v1/map/interest?bbox=-180,-90,180,90&z=0");
  const italy = coarse.body.cells.find((c) => c.researchers === 3);
  assert.ok(italy && italy.places_more >= 1, JSON.stringify(coarse.body.cells));

  const cell = await call(env, "GET", `/v1/map/interest/cell?s=${etna.cell.s}&w=${etna.cell.w}&size=${etna.cell.size}`);
  assert.equal(cell.status, 200, JSON.stringify(cell.body));
  const handles = cell.body.people.map((p) => p.user.handle).sort();
  assert.deepEqual(handles, ["ana", "ben"]);
  assert.ok(cell.body.people.find((p) => p.user.handle === "ben").reasons[0].includes("Etna"));
  assert.ok(!JSON.stringify(cell.body).includes("@example.com"));
});

test("interest respects visibility, hidden locations, tags and blocks", async () => {
  const env = makeEnv(); await people(env);
  await call(env, "POST", "/v1/posts", { as: A, body: { title: "private", visibility: "followers", location: { lat: 10, lon: 10, precision: "approx" } } });
  await call(env, "POST", "/v1/posts", { as: A, body: { title: "hidden", location: { precision: "hidden" } } });
  let map = await call(env, "GET", "/v1/map/interest?bbox=-180,-90,180,90&z=3");
  assert.equal(map.body.researchers, 0);
  await call(env, "POST", "/v1/me/study-areas", { as: B, body: { name: "Andes", location: { lat: -15, lon: -72 }, tags: ["glaciers"] } });
  await call(env, "POST", "/v1/me/study-areas", { as: C, body: { name: "Alps", location: { lat: 46, lon: 8 }, tags: ["landslides"] } });
  map = await call(env, "GET", "/v1/map/interest?bbox=-180,-90,180,90&z=3&tag=glaciers");
  assert.equal(map.body.researchers, 1);
  await call(env, "POST", "/v1/blocks", { as: D, body: { handle: "ben" } });
  map = await call(env, "GET", "/v1/map/interest?bbox=-180,-90,180,90&z=3", { as: D });
  assert.equal(map.body.researchers, 1, "a block hides ben from dan's map");
});

test("erasing an account removes its study areas", async () => {
  const env = makeEnv(); await people(env);
  await call(env, "POST", "/v1/me/study-areas", { as: A, body: { name: "Etna", location: { lat: 37.7, lon: 15 } } });
  await call(env, "DELETE", "/v1/me", { as: A, body: { confirm: "ana" } });
  const map = await call(env, "GET", "/v1/map/interest?bbox=-180,-90,180,90&z=3");
  assert.equal(map.body.researchers, 0);
});

test("cell size and trend rules", () => {
  assert.equal(cellDegrees(0), 22.5);
  assert.equal(cellDegrees(20), 0.25);
  assert.equal(trendOf(3, 0), "new");
  assert.equal(trendOf(6, 3), "rising");
  assert.equal(trendOf(2, 3), "steady");
  assert.equal(trendOf(0, 0), "steady");
});
