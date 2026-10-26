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
const textOf = (r) => (typeof r.body === "string" ? r.body : new TextDecoder().decode(r.body));

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

// ── Profile import ───────────────────────────────────────────────────────────

test("scholar: ORCID -> OpenAlex works, topics, h-index and co-authors on the Network", async () => {
  const env = await world();
  assert.equal((await call(env, "POST", "/v1/me/import-scholar", { as: ANA })).status, 400, "no ORCID iD yet");
  await call(env, "PATCH", "/v1/me", { as: ANA, body: { orcid: "0000-0002-1825-0097" } });
  await call(env, "PATCH", "/v1/me", { as: BEN, body: { orcid: "0000-0001-5109-3700" } });
  // Ana already lists one of the papers by hand.
  await call(env, "POST", "/v1/me/items", { as: ANA, body: { kind: "publication", title: "Etna flank dynamics", doi: "10.1/etna" } });
  const author = { id: "https://openalex.org/A123", works_count: 3, cited_by_count: 210, summary_stats: { h_index: 2, i10_index: 1 },
    last_known_institutions: [{ display_name: "University of Catania" }],
    topics: [{ display_name: "Volcanic processes and hazards", count: 3 }, { display_name: "Earthquakes & seismology", count: 2 }] };
  const works = [
    { id: "W1", doi: "https://doi.org/10.1/ETNA", title: "Etna flank dynamics", publication_year: 2024, authorships: [], primary_location: {} },
    { id: "W2", doi: "https://doi.org/10.1/insar", title: "InSAR time series at Etna", publication_year: 2023, cited_by_count: 40,
      primary_location: { source: { display_name: "JGR Solid Earth" } },
      authorships: [{ author: { orcid: "https://orcid.org/0000-0001-5109-3700" } }, { author: { orcid: "https://orcid.org/0000-0002-1825-0097" } }] },
    { id: "W3", doi: null, title: "A dataset of tilt records", publication_year: 2022, authorships: [], primary_location: {} },
  ];
  env.fetchImpl = async (u) => (String(u).includes("/authors/orcid:") ? json(author)
    : String(u).includes("/works?") ? json({ results: works, meta: { next_cursor: null } }) : new Response("", { status: 404 }));
  const r = await call(env, "POST", "/v1/me/import-scholar", { as: ANA });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.added, 2, "the paper she already listed is not doubled (DOI case-insensitive)");
  assert.equal(r.body.verified, false, "a self-declared ORCID iD imports unverified works");
  assert.equal(r.body.scholar.h_index, 2);
  assert.ok(r.body.interests.includes("volcanic-processes-and-hazards"));
  assert.ok(r.body.interests.includes("earthquakes-and-seismology"));
  assert.deepEqual(r.body.coauthors.map((c) => [c.user.handle, c.shared_works]), [["ben", 1]]);
  const again = await call(env, "POST", "/v1/me/import-scholar", { as: ANA });
  assert.equal(again.body.added, 0, "running it again adds nothing");
  const prof = await call(env, "GET", "/v1/users/ana");
  assert.equal(prof.body.user.institution, "University of Catania");
  const pubs = prof.body.items.filter((i) => i.kind === "publication");
  assert.equal(pubs.length, 3);
  assert.ok(pubs.some((p) => p.detail === "JGR Solid Earth" && p.year === 2023));
  const sch = await call(env, "GET", "/v1/users/ana/scholar");
  assert.equal(sch.body.cited_by, 210);
  assert.equal((await call(env, "GET", "/v1/users/ben/scholar")).body.imported_at, null);
});

// ── Job filters, saved searches, alerts, reminders ──────────────────────────

test("jobs: filters by field, stage, region, remote and closing; saved searches alert; saved adverts remind", async () => {
  const env = await world();
  const { readSource } = await import("../importer.js");
  const { runJobAlerts, runDeadlineReminders } = await import("../jobs.js");
  const t0 = Math.floor(Date.now() / 1000);
  const day = (n) => new Date((t0 + n * 86400) * 1000).toUTCString().slice(5, 11);  // "02 Nov"
  const block = (code, title, dept, org, loc, closes) => `<div class="j-search-result__result ie-border-left" data-advert-id="1">
    <div class="j-search-result__text"><a href="/job/${code}/x">${title}</a>
    <div class="j-search-result__department">${dept}</div><div class="j-search-result__employer"><b>${org}</b></div>
    <div>Location: ${loc}</div></div><div class="j-search-result__date-logos">
    <span class="j-search-result__date-span j-search-result__date--blue ">${closes}</span></div></div>`;
  const page = block("A1", "PhD Studentship: Volcanic ash dispersal", "Earth Sciences", "University of Bristol", "Bristol", day(2))
    + block("A2", "Lecturer in Hydrology", "Geography", "University of Leeds", "Leeds", day(20))
    + block("A3", "Remote Sensing Analyst", "Space", "EarthSense Ltd", "Remote", day(40));
  const src = { id: "jobs:jacuk-test", kind: "jobs", name: "jobs.ac.uk", url: "https://www.jobs.ac.uk/search/?subDisciplineFacet%5B0%5D=geology" };
  await env.DB.prepare("INSERT INTO import_sources (id, kind, name, url) VALUES (?, ?, ?, ?)").bind(src.id, src.kind, src.name, src.url).run();
  assert.equal((await readSource(env, src, t0, { fetcher: async () => new Response(page) })).posted, 3);
  const ext = async (qs) => (await call(env, "GET", `/v1/feed?tab=opportunities&origin=external&${qs}`)).body.items.map((p) => p.title);
  assert.deepEqual(await ext("field=volcanology"), ["PhD Studentship: Volcanic ash dispersal"]);
  assert.deepEqual(await ext("stage=faculty"), ["Lecturer in Hydrology"]);
  assert.deepEqual(await ext("region=leeds"), ["Lecturer in Hydrology"]);
  assert.deepEqual(await ext("remote=1"), ["Remote Sensing Analyst"]);
  assert.deepEqual(await ext("closing=7"), ["PhD Studentship: Volcanic ash dispersal"]);
  assert.deepEqual(await ext("q=hydrology"), ["Lecturer in Hydrology"]);
  assert.deepEqual(await ext("sort=closing"), ["PhD Studentship: Volcanic ash dispersal", "Lecturer in Hydrology", "Remote Sensing Analyst"]);

  // A saved search alerts on what is new since it was saved.
  const s = await call(env, "POST", "/v1/me/searches", { as: ANA, body: { name: "UK hydrology", query: { field: "hydrology", junk: "x" }, alert: "daily" } });
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.query, { field: "hydrology" });
  assert.equal((await runJobAlerts(env, t0 + 10)).sent, 0, "nothing new yet");
  await readSource(env, src, t0 + 86400, { fetcher: async () => new Response(page + block("A4", "Flood risk modeller", "Water", "JBA", "Skipton", day(30))) });
  assert.equal((await runJobAlerts(env, t0 + 86400 + 10)).sent, 1);
  const notes = (await call(env, "GET", "/v1/notifications", { as: ANA })).body.items;
  assert.ok(notes.some((n) => n.kind === "job_alert" && /1 new for “UK hydrology”: Flood risk modeller/.test(n.text)));
  assert.equal((await call(env, "GET", "/v1/me/searches", { as: ANA })).body.items.length, 1);

  // Saving an advert closing in two days brings one reminder.
  const phd = (await call(env, "GET", "/v1/feed?tab=opportunities&origin=external&field=volcanology")).body.items[0];
  await call(env, "POST", `/v1/posts/${phd.id}/bookmark`, { as: BEN, body: {} });
  assert.equal((await runDeadlineReminders(env, t0)).reminded, 1);
  assert.equal((await runDeadlineReminders(env, t0 + 3600)).reminded, 0, "once");
  assert.ok((await call(env, "GET", "/v1/notifications", { as: BEN })).body.items.some((n) => n.kind === "deadline" && /Closes in 2 days/.test(n.text)));
});

// ── Feedback rounds and reviewer credit ─────────────────────────────────────

test("rounds: volunteers are matched to drafts, mock interviews pair up, and reviewing is credited", async () => {
  const env = await world();
  const CAT = "cat@example.com";
  await call(env, "PATCH", "/v1/me", { as: CAT, body: { handle: "cat", name: "Cat Dunn", skills: ["volcanology"] } });
  assert.equal((await call(env, "POST", "/v1/rounds", { as: ANA, body: { kind: "abstract", title: "x" } })).status, 403);
  const t = Math.floor(Date.now() / 1000);
  const round = (await call(env, "POST", "/v1/rounds", { as: ADMIN, body: { kind: "abstract", title: "EGU abstracts",
    link: "https://meetingorganizer.copernicus.org/", deadline_at: t + 40 * 86400, closes_at: t + 37 * 86400 } })).body;
  assert.equal(round.kind_label, "Abstract review");
  // A draft before any volunteer waits; the volunteer who arrives takes it.
  const draft = await call(env, "POST", "/v1/reviews", { as: ANA, body: { title: "Ash plume heights at Etna", abstract: "We measure plume heights from webcams and radar.", round_id: round.id, expertise: ["volcanology"] } });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  await call(env, "POST", `/v1/rounds/${round.id}/volunteer`, { as: BEN, body: { capacity: 1 } });
  await call(env, "POST", `/v1/rounds/${round.id}/volunteer`, { as: CAT, body: { capacity: 2 } });
  const benMine = await call(env, "GET", `/v1/rounds/${round.id}/mine`, { as: BEN });
  const catMine = await call(env, "GET", `/v1/rounds/${round.id}/mine`, { as: CAT });
  assert.equal(benMine.body.reviewing.length + catMine.body.reviewing.length, 1, "one reviewer per draft");
  assert.equal(benMine.body.reviewing.length, 1, "the first volunteer with room takes the waiting draft");
  // The next draft prefers shared expertise: Cat lists volcanology.
  const d2 = await call(env, "POST", "/v1/reviews", { as: BEN, body: { title: "Tephra fall model", abstract: "A fall model.", round_id: round.id, expertise: ["volcanology"] } });
  const r2 = await call(env, "GET", `/v1/reviews/${d2.body.review.id}`, { as: BEN });
  assert.deepEqual(r2.body.reviewers.map((x) => x.user.handle), ["cat"]);
  assert.equal((await call(env, "POST", "/v1/reviews", { as: ANA, body: { title: "x", abstract: "long enough text", round_id: "fr_nope" } })).status, 400);
  // Cat submits: credited on her record; the private draft's title is not.
  await call(env, "POST", `/v1/reviews/${d2.body.review.id}/submit`, { as: CAT, body: { recommendation: "minor", summary: "Clear; add uncertainties." } });
  const rec = await call(env, "GET", "/v1/users/cat/review-record");
  assert.equal(rec.body.total, 1);
  assert.deepEqual([rec.body.items[0].what, rec.body.items[0].round, rec.body.items[0].title], ["Abstract review", "EGU abstracts", null]);
  // Mock interviews: a mentee waits until a mentor volunteers.
  const mi = (await call(env, "POST", "/v1/rounds", { as: ADMIN, body: { kind: "mock_interview", title: "Mock interviews, November" } })).body;
  const ask = await call(env, "POST", `/v1/rounds/${mi.id}/interview`, { as: ANA, body: { note: "PhD interview at Leeds next week" } });
  assert.equal(ask.body.pairs[0].status, "waiting");
  await call(env, "POST", `/v1/rounds/${mi.id}/volunteer`, { as: BEN, body: { capacity: 1 } });
  const paired = await call(env, "GET", `/v1/rounds/${mi.id}/mine`, { as: ANA });
  assert.equal(paired.body.pairs[0].status, "paired");
  assert.equal(paired.body.pairs[0].other.handle, "ben");
  const benSide = await call(env, "GET", `/v1/rounds/${mi.id}/mine`, { as: BEN });
  assert.equal(benSide.body.pairs[0].note, "PhD interview at Leeds next week", "the mentor sees the note");
  const list = await call(env, "GET", "/v1/rounds", { as: ANA });
  assert.equal(list.body.items.length, 2);
});

// ── Conferences ──────────────────────────────────────────────────────────────

test("conference: attendees declare talks and posters by session; meet-ups hang off it; posters keep coming for a month", async () => {
  const env = await world();
  const t = Math.floor(Date.now() / 1000);
  const conf = await call(env, "POST", "/v1/posts", { as: ADMIN, body: { kind: "event", title: "EGU General Assembly", visibility: "public",
    meta: { format: "conference", starts_at: t + 10 * 86400, ends_at: t + 15 * 86400, where: "Vienna" } } });
  assert.equal(conf.status, 200, JSON.stringify(conf.body));
  const eid = conf.body.id;
  const add = (who, body) => call(env, "POST", `/v1/events/${eid}/programme`, { as: who, body });
  assert.equal((await add(ANA, { kind: "talk", session: "gmpv9.2", title: "Etna's 2025 paroxysms" })).status, 403, "attendees only");
  await call(env, "POST", `/v1/events/${eid}/rsvp`, { as: ANA, body: { status: "going", show_me: true } });
  await call(env, "POST", `/v1/events/${eid}/rsvp`, { as: BEN, body: { status: "going" } });
  assert.equal((await add(ANA, { kind: "talk", session: "gmpv9.2", title: "Etna's 2025 paroxysms" })).status, 200);
  await add(BEN, { kind: "poster", session: "NH3.1", title: "Landslide inventories from InSAR" });
  const prog = await call(env, "GET", `/v1/events/${eid}/programme`);
  assert.deepEqual(prog.body.sessions, ["GMPV9.2", "NH3.1"]);
  assert.deepEqual((await call(env, "GET", `/v1/events/${eid}/programme?session=GMPV`)).body.items.map((i) => i.user.handle), ["ana"]);
  // A meet-up names the conference.
  const meet = await call(env, "POST", "/v1/posts", { as: BEN, body: { kind: "event", title: "Volcano deformation drinks", visibility: "public",
    meta: { format: "workshop", starts_at: t + 11 * 86400, parent_event: eid } } });
  assert.equal(meet.status, 200, JSON.stringify(meet.body));
  assert.deepEqual((await call(env, "GET", `/v1/events/${eid}/meetups`)).body.items.map((p) => p.title), ["Volcano deformation drinks"]);
  // After the meeting: posters still accepted for a month (the gallery outlasts it).
  await env.DB.prepare("UPDATE posts SET meta_json = json_set(meta_json, '$.starts_at', ?, '$.ends_at', ?) WHERE id = ?").bind(t - 10 * 86400, t - 5 * 86400, eid).run();
  const poster = await call(env, "POST", "/v1/posts", { as: BEN, body: { kind: "text", title: "My NH3.1 poster", body: "PDF attached.", visibility: "public" } });
  const sub = await call(env, "POST", `/v1/events/${eid}/posters`, { as: BEN, body: { post_id: poster.body.id } });
  assert.ok([200, 201].includes(sub.status), JSON.stringify(sub.body));
});

// ── Push ─────────────────────────────────────────────────────────────────────

test("push: a notification sends an empty, VAPID-signed push to each of the member's browsers; dead ones are dropped", async () => {
  const { vapidJwt } = await import("../push.js");
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const pub = Buffer.from(raw).toString("base64url");
  const env = await world();
  assert.equal((await call(env, "POST", "/v1/push/subscribe", { as: ANA, body: { endpoint: "https://fcm.googleapis.com/fcm/send/x" } })).status, 503, "off without keys");
  env.VAPID_PUBLIC_KEY = pub;
  env.VAPID_PRIVATE_JWK = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey));
  assert.equal((await call(env, "POST", "/v1/push/subscribe", { as: ANA, body: { endpoint: "https://evil.example/collect" } })).status, 400);
  await call(env, "POST", "/v1/push/subscribe", { as: ANA, body: { endpoint: "https://fcm.googleapis.com/fcm/send/abc" } });
  await call(env, "POST", "/v1/push/subscribe", { as: ANA, body: { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/gone" } });
  const sent = [];
  env.fetchImpl = async (u, init) => { sent.push({ u, init }); return new Response("", { status: String(u).includes("gone") ? 410 : 201 }); };
  await call(env, "POST", "/v1/follow", { as: BEN, body: { type: "user", id: "ana" } });   // notifies Ana
  assert.equal(sent.length, 2);
  const fcm = sent.find((s) => s.u.includes("fcm"));
  assert.equal(fcm.init.headers["Content-Length"], "0", "no payload");
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(fcm.init.headers.Authorization);
  assert.equal(m[2], pub);
  const [h64, c64, s64] = m[1].split(".");
  assert.equal(JSON.parse(Buffer.from(c64, "base64url")).aud, "https://fcm.googleapis.com");
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, Buffer.from(s64, "base64url"), new TextEncoder().encode(`${h64}.${c64}`));
  assert.ok(ok, "a valid ES256 signature");
  const left = await env.DB.prepare("SELECT endpoint FROM push_subscriptions").all();
  assert.deepEqual(left.results.map((r) => r.endpoint), ["https://fcm.googleapis.com/fcm/send/abc"], "the 410 one is dropped");
  assert.ok(typeof vapidJwt === "function");
});

// ── Reach and visibility ────────────────────────────────────────────────────

test("reach: views once per reader per day (never the author's), link visits from people not bots, shares; only the author sees them", async () => {
  const env = await world();
  const p = (await call(env, "POST", "/v1/posts", { as: ANA, body: { title: "Ash plume heights", body: "Webcam and radar.", visibility: "public" } })).body;
  await call(env, "POST", `/v1/posts/${p.id}/seen`, { as: ANA });
  await call(env, "POST", `/v1/posts/${p.id}/seen`, { as: BEN });
  await call(env, "POST", `/v1/posts/${p.id}/seen`, { as: BEN });
  await call(env, "POST", `/v1/posts/${p.id}/seen`, { as: ADMIN });
  await call(env, "POST", `/v1/posts/${p.id}/shared`, { as: BEN });
  await call(env, "GET", `/s/p/${p.id}`, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130" } });
  await call(env, "GET", `/s/p/${p.id}`, { headers: { "user-agent": "Slackbot-LinkExpanding 1.0" } });
  assert.equal((await call(env, "GET", `/v1/posts/${p.id}/reach`, { as: BEN })).status, 404, "the author's only");
  const r = await call(env, "GET", `/v1/posts/${p.id}/reach`, { as: ANA });
  assert.deepEqual([r.body.total.views, r.body.total.shares, r.body.total.link_visits], [2, 1, 1]);
  assert.equal(r.body.last_30_days.length, 30);
});

test("visibility: a badge and a directory for members who chose a public profile, and nobody else", async () => {
  const env = await world();
  await call(env, "PATCH", "/v1/me", { as: ANA, body: { headline: "Volcano geodesist", interests: ["volcanology"], public_profile: true } });
  await call(env, "PATCH", "/v1/me", { as: BEN, body: { interests: ["volcanology"] } });
  const b = await call(env, "GET", "/s/badge/ana.svg");
  assert.match(textOf(b), /Ana Reyes/);
  assert.match(textOf(b), /Volcano geodesist/);
  assert.match(textOf(b), /^<svg/);
  assert.match(textOf(await call(env, "GET", "/s/badge/ben.svg")), /isn&#39;t public/);
  const dir = await call(env, "GET", "/v1/directory?field=volcanology");
  assert.deepEqual(dir.body.items.map((u) => u.handle), ["ana"]);
  const page = await call(env, "GET", "/s/people/volcanology");
  assert.match(textOf(page), /Ana Reyes/);
  assert.doesNotMatch(textOf(page), /Ben Cole/);
});

// ── Trust ────────────────────────────────────────────────────────────────────

test("trust: a scam-shaped opportunity from a new account waits for a moderator; ordinary ones don't; reports carry a due time", async () => {
  const env = await world();
  const scam = await call(env, "POST", "/v1/posts", { as: BEN, body: { kind: "opportunity", title: "Remote geologist, earn $500 per day",
    body: "Contact us on WhatsApp. A registration fee of $50 secures your place.", visibility: "public" } });
  assert.equal(scam.status, 200);
  assert.equal(scam.body.visibility, "private");
  assert.match(scam.body.held.reasons, /chat app/);
  assert.equal((await call(env, "GET", `/v1/posts/${scam.body.id}`, { as: ANA })).status, 404, "nobody else sees it yet");
  const fine = await call(env, "POST", "/v1/posts", { as: ANA, body: { kind: "opportunity", title: "Field assistant, Etna", body: "Two weeks in June; travel paid.", visibility: "public" } });
  assert.equal(fine.body.visibility, "public");
  assert.equal(fine.body.held, null);
  assert.equal((await call(env, "GET", "/v1/mod/held", { as: ANA })).status, 403);
  const q = await call(env, "GET", "/v1/mod/held", { as: ADMIN });
  assert.equal(q.body.items[0].id, scam.body.id);
  assert.equal(q.body.items[0].wanted, "public");
  await call(env, "POST", `/v1/mod/held/${scam.body.id}`, { as: ADMIN, body: { approve: false, note: "Asks for a fee." } });
  assert.equal((await call(env, "GET", `/v1/posts/${scam.body.id}`, { as: BEN })).status, 404, "rejected is removed");
  // Reports show when they are due.
  await call(env, "POST", "/v1/reports", { as: BEN, body: { target_type: "post", target_id: fine.body.id, reason: "harassment" } });
  const reports = await call(env, "GET", "/v1/mod/reports?status=open", { as: ADMIN });
  const rep = reports.body.items[0];
  assert.equal(rep.due_at - rep.created_at, 24 * 3600);
  assert.equal(rep.overdue, false);
});

test("licence is optional: research outputs default to CC BY, questions and events to none, and anyone can clear it", async () => {
  const env = await world();
  const q = await call(env, "POST", "/v1/posts", { as: ANA, body: { kind: "question", title: "Which InSAR stack for Etna?", visibility: "public" } });
  assert.equal(q.body.licence, "");
  const d = await call(env, "POST", "/v1/posts", { as: ANA, body: { kind: "dataset", title: "Tilt records", provenance: "observed", visibility: "public" } });
  assert.equal(d.body.licence, "CC-BY-4.0");
  const t = await call(env, "POST", "/v1/posts", { as: ANA, body: { kind: "text", title: "Chapter draft", licence: "", visibility: "public" } });
  assert.equal(t.body.licence, "");
  const cleared = await call(env, "PATCH", `/v1/posts/${d.body.id}`, { as: ANA, body: { licence: "" } });
  assert.equal(cleared.body.licence, "");
});
