// node --test test/world.test.mjs -- migration 0009: event rooms, profile
// import, saved searches, feedback rounds, conferences, reach, trust.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";
import { fromUsgs, fromGdacs, syncRooms, placeWords, km, USGS_FEED, GDACS_FEED } from "../rooms.js";

const ANA = "ana@example.com", BEN = "ben@example.com", ADMIN = "admin@example.com";
async function world() {
  const env = makeEnv();
  await call(env, "PATCH", "/v1/me", { as: ANA, body: { handle: "ana", name: "Ana Reyes" } });
  await call(env, "PATCH", "/v1/me", { as: BEN, body: { handle: "ben", name: "Ben Cole" } });
  await call(env, "PATCH", "/v1/me", { as: ADMIN, body: { handle: "admin" } });
  return env;
}
const json = (data) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

// ── Event rooms ──────────────────────────────────────────────────────────────

const T = Date.UTC(2026, 9, 26, 12) / 1000;
const quake = { id: "us6000abcd", geometry: { type: "Point", coordinates: [15.0, 37.75, 10] },
  properties: { mag: 6.4, place: "12 km NE of Bronte, Italy", time: (T - 3600) * 1000, updated: (T - 600) * 1000,
    title: "M 6.4 - 12 km NE of Bronte, Italy", url: "https://earthquake.usgs.gov/earthquakes/eventpage/us6000abcd",
    alert: "orange", tsunami: 0, sig: 900, felt: 1200, mmi: 7.1 } };
const gdacs = (eventtype, alertlevel, todate, extra = {}) => ({ geometry: { type: "Point", coordinates: [87.2, 15.9] },
  properties: { eventtype, eventid: 1001345, episodeid: 3, name: "Tropical Cyclone ARNAB-26", alertlevel, iscurrent: "false",
    country: "India", fromdate: "2026-10-24T00:00:00", todate, datemodified: todate,
    url: { report: "https://www.gdacs.org/report.aspx?eventid=1001345&episodeid=3&eventtype=TC" },
    severitydata: { severitytext: "Hurricane/Typhoon > 74 mph (maximum wind speed of 194 km/h)" }, ...extra } });

test("rooms: read from USGS and GDACS; finished events and orange droughts are not rooms", () => {
  const q = fromUsgs(quake);
  assert.deepEqual([q.kind, q.severity, q.alert, q.lat, q.lon, q.source_id], ["earthquake", "M 6.4", "orange", 37.75, 15, "us6000abcd"]);
  assert.equal(q.data.tsunami, false);
  const tc = fromGdacs(gdacs("TC", "Red", "2026-10-26T06:00:00"), T);
  assert.deepEqual([tc.kind, tc.alert, tc.source_id], ["cyclone", "red", "TC-1001345"]);
  assert.match(tc.severity, /194 km\/h/);
  assert.equal(fromGdacs(gdacs("TC", "Red", "2026-10-01T00:00:00"), T), null, "an episode that ended weeks ago");
  assert.equal(fromGdacs(gdacs("DR", "Orange", "2026-10-26T00:00:00"), T), null, "only red droughts");
  assert.ok(fromGdacs(gdacs("DR", "Red", "2026-10-26T00:00:00"), T));
  assert.equal(fromGdacs(gdacs("EQ", "Red", "2026-10-26T00:00:00"), T), null, "earthquakes come from USGS");
  assert.equal(placeWords({ place: "170 km NW of Port-Olry, Vanuatu" }), "Port-Olry Vanuatu");
  assert.ok(Math.abs(km(37.75, 15, 37.75, 16) - 88) < 2);
});

test("rooms: the cron opens a room once, tells people who study the area, archives it when quiet", async () => {
  const env = await world();
  // Ana studies Etna (near the quake); Ben follows the seismology tag; the admin studies Iceland.
  await call(env, "POST", "/v1/me/study-areas", { as: ANA, body: { name: "Etna", lat: 37.75, lon: 14.99, precision: "approx" } });
  await call(env, "POST", "/v1/me/study-areas", { as: ADMIN, body: { name: "Hekla", lat: 63.98, lon: -19.7, precision: "approx" } });
  await call(env, "POST", "/v1/follow", { as: BEN, body: { type: "tag", id: "seismology" } });
  const fetcher = async (u) => (u === USGS_FEED ? json({ features: [quake] })
    : u === GDACS_FEED ? json({ features: [gdacs("TC", "Red", "2026-10-26T06:00:00")] }) : new Response("", { status: 404 }));
  const r1 = await syncRooms(env, T, { fetcher });
  assert.equal(r1.opened, 2);
  assert.deepEqual(r1.errors, []);
  const r2 = await syncRooms(env, T + 900, { fetcher });
  assert.equal(r2.opened, 0, "never twice");

  const list = await call(env, "GET", "/v1/rooms");
  assert.equal(list.body.items.length, 2);
  const room = list.body.items.find((r) => r.kind === "earthquake");
  assert.equal(room.credit, "U.S. Geological Survey");
  const notesOf = async (who) => (await call(env, "GET", "/v1/notifications", { as: who })).body.items || [];
  assert.ok((await notesOf(ANA)).some((n) => /near your study area “Etna”/.test(n.text)), "the Etna volcanologist is told");
  assert.ok((await notesOf(BEN)).some((n) => /a room is open/.test(n.text)), "a follower of the field is told");
  assert.ok(!(await notesOf(ADMIN)).some((n) => /Bronte/.test(n.text)), "Iceland is too far");

  // The room page: who studies the area; a post into it; followers hear.
  const one = await call(env, "GET", `/v1/rooms/${room.id}`, { as: BEN });
  assert.equal(one.body.people_near[0].user.handle, "ana");
  assert.equal(one.body.people_near[0].area, "Etna");
  await call(env, "POST", "/v1/follow", { as: BEN, body: { type: "room", id: room.id } });
  const obs = await call(env, "POST", "/v1/posts", { as: ANA, body: { kind: "observation", title: "Felt strongly in Bronte",
    body: "Ten seconds of shaking.", room_id: room.id, provenance: "observed", visibility: "public" } });
  assert.equal(obs.status, 200, JSON.stringify(obs.body));
  assert.equal(obs.body.room_id, room.id);
  const thread = await call(env, "GET", `/v1/feed?tab=all&room=${room.id}`);
  assert.deepEqual(thread.body.items.map((p) => p.title), ["Felt strongly in Bronte"]);
  assert.ok((await notesOf(BEN)).some((n) => /posted in an event room/.test(n.text)));
  assert.equal((await call(env, "POST", "/v1/posts", { as: ANA, body: { title: "x", room_id: "rm_nope" } })).status, 400);

  // Papers come from OpenAlex once, then from the room.
  let asked = 0;
  env.fetchImpl = async () => { asked += 1; return json({ results: [{ title: "The 2002 Etna flank eruption", publication_year: 2004,
    doi: "https://doi.org/10.1029/2003GL018950", authorships: [{ author: { display_name: "A. Bonaccorso" } }],
    primary_location: { source: { display_name: "GRL" } }, cited_by_count: 120 }] }); };
  const papers = await call(env, "GET", `/v1/rooms/${room.id}/papers`);
  assert.equal(papers.body.items[0].doi, "10.1029/2003GL018950");
  await call(env, "GET", `/v1/rooms/${room.id}/papers`);
  assert.equal(asked, 1, "cached a week");

  // Quiet for a fortnight: archived. Admins can open one by hand.
  await syncRooms(env, T + 15 * 86400, { fetcher: async () => json({ features: [] }) });
  assert.equal((await call(env, "GET", "/v1/rooms")).body.items.length, 0);
  assert.equal((await call(env, "GET", "/v1/rooms?status=archived")).body.items.length, 2);
  assert.equal((await call(env, "POST", "/v1/rooms", { as: ANA, body: { kind: "flood", title: "x", lat: 1, lon: 1 } })).status, 403);
  const manual = await call(env, "POST", "/v1/rooms", { as: ADMIN, body: { kind: "flood", title: "Valencia floods", place: "Valencia, Spain", lat: 39.47, lon: -0.38 } });
  assert.equal(manual.status, 200, JSON.stringify(manual.body));
  assert.equal(manual.body.credit, "GeoID Network");
});
