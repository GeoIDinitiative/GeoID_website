// v1.4 reach: files, link cards, share pages, weekly email, Zenodo, office
// hours, pinned review comments, and the importer (jobs and events).
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";
import { sniffText, hasMacros, sweepOrphans } from "../media.js";
import { classifyLink, parseMeta } from "../unfurl.js";
import { sharePage, weeklyLines, sendWeekly, weeklyDue } from "../reach.js";
import { depositMetadata, seal, unseal } from "../zenodo.js";
import { slotIcs, checkins } from "../officehours.js";
import { cleanPin } from "../reviews.js";
import { detectPlatform, harvestJobs, jsonLd, jobsFromJsonLd, eventsFromJsonLd, parseIcs, fetchJobs, fetchEvents, looksLikeDetail, plausibleTitle, parseJobsAcUk, dayMonthAhead } from "../ats.js";
import { scorePosting, readSource, runImports, seedSources } from "../importer.js";

const ANA = "ana@example.com", BEN = "ben@example.com", ADMIN = "admin@example.com";
const enc = (s) => new TextEncoder().encode(s);
const form = (bytes, name) => { const f = new FormData(); f.append("file", new Blob([bytes]), name); return f; };
const uid = async (env, handle) => (await env.DB.prepare("SELECT id FROM users WHERE handle = ?").bind(handle).first()).id;
async function world() {
  const env = makeEnv();
  await call(env, "PATCH", "/v1/me", { as: ANA, body: { handle: "ana", name: "Ana Reyes" } });
  await call(env, "PATCH", "/v1/me", { as: BEN, body: { handle: "ben", name: "Ben Cole" } });
  await call(env, "PATCH", "/v1/me", { as: ADMIN, body: { handle: "admin" } });
  return env;
}
/** A minimal .docx-shaped ZIP: local header magic and OOXML names. */
function docx(extra = "") {
  return enc(`PK\x03\x04${"\0".repeat(26)}[Content_Types].xml word/document.xml ${extra}`);
}

// ── Files ──────────────────────────────────────────────────────────────────

test("files: mp3, m4a, txt, csv and docx upload; HTML-in-txt and macros refused", async () => {
  const env = await world();
  const up = (bytes, name) => call(env, "POST", "/v1/media", { as: ANA, form: form(bytes, name) });
  assert.equal((await up(enc("ID3\x03\0\0\0\0\0\0rest"), "talk.mp3")).body.type, "audio/mpeg");
  const m4a = new Uint8Array(16); m4a.set(enc("\0\0\0\x18ftypM4A "));
  assert.equal((await up(m4a, "talk.m4a")).body.type, "audio/mp4");
  assert.equal((await up(enc("hello world\nline two"), "notes.txt")).body.type, "text/plain");
  assert.equal((await up(enc("lat,lon,mag\n37.7,15.0,4.1\n"), "quakes.csv")).body.type, "text/csv");
  assert.equal((await up(docx(), "draft.docx")).body.type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal((await up(enc("<!doctype html><script>x</script>"), "trick.txt")).status, 400, "markup in a .txt is refused");
  assert.equal((await up(enc("a\0b"), "bin.csv")).status, 400, "binary in a .csv is refused");
  assert.equal((await up(docx("word/vbaProject.bin"), "macro.docx")).status, 400, "macros refused");
  assert.equal((await up(enc("plain"), "thing.exe")).status, 400, "unknown types refused");
  const big = new Uint8Array(5 * 1024 * 1024 + 10).fill(65);
  assert.equal((await up(big, "huge.txt")).status, 413, "text capped at 5 MB");
  // pure helpers
  assert.equal(sniffText(enc("x,y\n1,2"), "a.CSV").type, "text/csv");
  assert.equal(sniffText(enc("<svg onload=1>"), "a.txt"), null);
  assert.ok(hasMacros(docx("vbaProject.bin")));
});

test("files: text served as utf-8 with the uploader's name; docx as a download", async () => {
  const env = await world();
  const t = await call(env, "POST", "/v1/media", { as: ANA, form: form(enc("x,y\n1,2"), "Etna quakes 2021.csv") });
  const got = await call(env, "GET", `/v1/media/${encodeURIComponent(t.body.key)}`);
  assert.equal(got.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.match(got.headers.get("content-disposition"), /attachment; filename="Etna quakes 2021\.csv"/);
  assert.equal(got.headers.get("content-security-policy"), "default-src 'none'");
});

test("files: quota refuses past the limit; storage lists usage; orphans swept, attached kept", async () => {
  const env = makeEnv({ MEDIA_QUOTA_MB: "1" });
  await call(env, "PATCH", "/v1/me", { as: ANA, body: { handle: "ana" } });
  const a = await call(env, "POST", "/v1/media", { as: ANA, form: form(new Uint8Array(700 * 1024).fill(66), "a.txt") });
  assert.equal(a.status, 200);
  const b = await call(env, "POST", "/v1/media", { as: ANA, form: form(new Uint8Array(700 * 1024).fill(66), "b.txt") });
  assert.equal(b.status, 413);
  assert.match(b.body.error, /1 MB/);
  const s = await call(env, "GET", "/v1/me/storage", { as: ANA });
  assert.equal(s.body.quota, 1024 * 1024);
  assert.equal(s.body.used, 700 * 1024);
  // attach a second small file to a post; sweep a day later
  const c = await call(env, "POST", "/v1/media", { as: ANA, form: form(enc("kept"), "kept.txt") });
  await call(env, "POST", "/v1/posts", { as: ANA, body: { kind: "text", body: "notes", media: [{ key: c.body.key }] } });
  const swept = await sweepOrphans(env, Math.floor(Date.now() / 1000) + 2 * 86400);
  assert.equal(swept.swept, 1, "only the unattached one");
  assert.ok(env.MEDIA.store.has(c.body.key));
  assert.ok(!env.MEDIA.store.has(a.body.key));
});

// ── Link cards ─────────────────────────────────────────────────────────────

test("links: providers and file kinds without a fetch; Dropbox download link", () => {
  const d = classifyLink("https://www.dropbox.com/s/abc123/Etna%20DEM.tif?dl=0");
  assert.equal(d.provider, "dropbox");
  assert.equal(d.file_kind, "GeoTIFF");
  assert.equal(d.file_name, "Etna DEM.tif");
  assert.match(d.download_url, /dl=1/);
  assert.equal(classifyLink("https://drive.google.com/file/d/xyz/view").provider, "google-drive");
  assert.equal(classifyLink("https://osf.io/abcd/").provider, "osf");
  assert.equal(classifyLink("https://zenodo.org/records/123").provider, "zenodo");
  assert.equal(classifyLink("https://example.org/report.pdf").file_kind, "PDF");
  assert.equal(classifyLink("javascript:alert(1)"), null);
  const meta = parseMeta(`<head><title>x</title><meta property="og:title" content="Survey &amp; DEM"><meta name="description" content="A DEM"></head>`);
  assert.equal(meta.title, "Survey & DEM");
  assert.equal(meta.description, "A DEM");
});

test("links: unfurl reads once, caches, and the post carries the server's card", async () => {
  const env = await world();
  let fetches = 0;
  env.fetchImpl = undefined;
  const page = `<html><head><meta property="og:title" content="Etna DEM 2021 - Dropbox"><meta property="og:description" content="1 m lidar"></head></html>`;
  const { unfurl } = await import("../unfurl.js");
  const fetcher = async () => { fetches += 1; return new Response(page, { headers: { "content-type": "text/html" } }); };
  const url = "https://www.dropbox.com/s/abc/etna.tif?dl=0";
  const card = await unfurl(env, url, { fetcher });
  assert.equal(card.title, "Etna DEM 2021");
  await unfurl(env, url, { fetcher });
  assert.equal(fetches, 1, "cached");
  const post = await call(env, "POST", "/v1/posts", { as: ANA, body: { kind: "text", body: "DEM", links: [{ url, label: "", provider: "fake", file_kind: "evil" }] } });
  const link = post.body.links?.[0] || (await call(env, "GET", `/v1/posts/${post.body.id}`)).body.links[0];
  assert.equal(link.provider, "dropbox", "from the server, not the client");
  assert.equal(link.label, "Etna DEM 2021");
  assert.equal(link.file_kind, "GeoTIFF");
});

// ── Share pages ────────────────────────────────────────────────────────────

test("share pages: public post rendered with a card; private 404; profile only when opted in", async () => {
  const env = await world();
  const pub = await call(env, "POST", "/v1/posts", { as: ANA, body: { kind: "text", title: "Etna lava 2021", body: "Mapped flows <b>here</b>" } });
  const priv = await call(env, "POST", "/v1/posts", { as: ANA, body: { kind: "text", title: "Secret", body: "x", visibility: "private" } });
  const a = await call(env, "GET", `/s/p/${pub.body.id}`);
  assert.equal(a.status, 200);
  const html = new TextDecoder().decode(a.body);
  assert.match(html, /og:title" content="Etna lava 2021"/);
  assert.match(html, /#\/post\//);
  assert.doesNotMatch(html, /<b>here<\/b>/, "escaped");
  assert.equal((await call(env, "GET", `/s/p/${priv.body.id}`)).status, 404);
  assert.equal((await call(env, "GET", "/s/u/ana")).status, 404, "not opted in");
  await call(env, "PATCH", "/v1/me", { as: ANA, body: { public_profile: true, headline: "Volcanologist" } });
  assert.equal((await call(env, "GET", "/s/u/ana")).status, 200);
  const map = new TextDecoder().decode((await call(env, "GET", "/s/sitemap.xml")).body);
  assert.match(map, new RegExp(`/s/p/${pub.body.id}`));
  assert.doesNotMatch(map, new RegExp(`/s/p/${priv.body.id}`));
  assert.match(map, /\/s\/u\/ana/);
  assert.match(sharePage(env, { title: "<x>", description: "d", appHash: "#/", path: "/s/x" }), /&lt;x&gt;/);
});

// ── Weekly email ───────────────────────────────────────────────────────────

test("weekly: due on Mondays; lines from the member's topics; sent once a week", async () => {
  const env = await world();
  assert.equal(weeklyDue(Date.UTC(2026, 9, 26, 8) / 1000), true);
  assert.equal(weeklyDue(Date.UTC(2026, 9, 27, 8) / 1000), false);
  await call(env, "PATCH", "/v1/me", { as: BEN, body: { interests: ["volcanology"] } });
  await call(env, "POST", "/v1/posts", { as: ANA, body: { kind: "opportunity", title: "PhD on Etna", body: "x", tags: ["volcanology"], meta: { type: "studentship" } } });
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(await uid(env, "ben")).first();
  const lines = await weeklyLines(env, row, Math.floor(Date.now() / 1000) + 60);
  assert.ok(lines.some((l) => /PhD on Etna/.test(l.text)));
  const sent = [];
  const mailEnv = { ...env, RESEND_API_KEY: "k", MAIL_FROM: "x@y.z", JWT_SECRET: "test-secret" };
  const fetchImpl = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); };
  const t = Math.floor(Date.now() / 1000) + 60;
  const r1 = await sendWeekly(mailEnv, t, { fetchImpl });
  assert.ok(r1.sent >= 1);
  const r2 = await sendWeekly(mailEnv, t + 3600, { fetchImpl });
  assert.equal(r2.sent, 0, "not twice in a week");
  assert.ok(sent.some((m) => /New for you/.test(m.subject)));
  // turning it off sticks
  await call(env, "PATCH", "/v1/me/mail", { as: BEN, body: { weekly: false } });
  assert.equal((await call(env, "GET", "/v1/me/mail", { as: BEN })).body.weekly, false);
});

// ── Zenodo ─────────────────────────────────────────────────────────────────

test("zenodo: metadata from a post; tokens sealed; draft by default, DOI only on publish", async () => {
  const env = await world();
  const z = { ...env, ZENODO_CLIENT_ID: "cid", ZENODO_CLIENT_SECRET: "sec", ZENODO_TOKEN_KEY: "k", ZENODO_BASE: "https://sandbox.zenodo.org" };
  const sealed = await seal(z, "tok");
  assert.notEqual(sealed, "tok");
  assert.equal(await unseal(z, sealed), "tok");
  const meta = depositMetadata(z, { id: "p1", kind: "paper", title: "T", body: "B", tags_json: '["etna"]', licence: "CC-BY-4.0" },
    { name: "Ana Maria Reyes", handle: "ana", orcid: "0000-0001", orcid_verified: 1 });
  assert.equal(meta.upload_type, "publication");
  assert.equal(meta.creators[0].name, "Reyes, Ana Maria");
  assert.equal(meta.creators[0].orcid, "0000-0001");
  assert.equal(meta.license, "cc-by-4.0");
  // not connected yet
  const up = await call(z, "POST", "/v1/media", { as: ANA, form: form(enc("%PDF-1.4 x"), "paper.pdf") });
  const post = await call(z, "POST", "/v1/posts", { as: ANA, body: { kind: "paper", title: "Etna paper", body: "B", media: [{ key: up.body.key }] } });
  assert.equal((await call(z, "POST", `/v1/posts/${post.body.id}/zenodo`, { as: ANA, body: {} })).status, 409);
  // connect, with a canned Zenodo
  await z.DB.prepare("INSERT INTO zenodo_links (user_id, token_enc, connected_at) VALUES (?, ?, ?)").bind(await uid(z, "ana"), await seal(z, "AT"), 1).run();
  const calls = [];
  z.fetchImpl = async (u, init = {}) => {
    calls.push([init.method || "GET", u]);
    if (u.endsWith("/api/deposit/depositions") && init.method === "POST") return Response.json({ id: 77, links: { bucket: "https://sandbox.zenodo.org/api/files/b1" } });
    if (u.startsWith("https://sandbox.zenodo.org/api/files/b1/")) return Response.json({});
    if (u.endsWith("/api/deposit/depositions/77") && init.method === "PUT") return Response.json({ id: 77, metadata: { prereserve_doi: { doi: "10.5072/zenodo.77" } }, links: { html: "https://sandbox.zenodo.org/deposit/77" } });
    if (u.endsWith("/actions/publish")) return Response.json({ id: 77, doi: "10.5072/zenodo.77", links: { html: "https://sandbox.zenodo.org/records/77" } });
    return new Response("no", { status: 404 });
  };
  const draft = await call(z, "POST", `/v1/posts/${post.body.id}/zenodo`, { as: ANA, body: {} });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal(draft.body.status, "draft");
  assert.ok(!calls.some(([, u]) => u.endsWith("/actions/publish")), "no publish without asking");
  assert.ok(calls.some(([m, u]) => m === "PUT" && /paper\.pdf$/.test(u)), "the file went up");
  assert.equal((await call(z, "POST", `/v1/posts/${post.body.id}/zenodo`, { as: BEN, body: {} })).status, 404, "not the author");
  const pub = await call(z, "POST", `/v1/posts/${post.body.id}/zenodo`, { as: ANA, body: { publish: true } });
  assert.equal(pub.body.doi, "10.5072/zenodo.77");
  const got = (await call(z, "GET", `/v1/posts/${post.body.id}`)).body;
  assert.ok((got.sources || []).some((s) => s.doi === "10.5072/zenodo.77"), "the DOI is the post's source now");
  assert.equal((await call(env, "GET", "/v1/zenodo", { as: ANA })).body.configured, false);
});

// ── Office hours ───────────────────────────────────────────────────────────

test("office hours: offer, book (once), private details, cancel, ics; check-in at a month", async () => {
  const env = await world();
  const at = Math.floor(Date.now() / 1000) + 2 * 86400;
  const made = await call(env, "POST", "/v1/mentoring/slots", { as: ANA, body: { starts_at: at, minutes: 30, topic: "InSAR", where: "https://meet.example/x", repeat_weeks: 2 } });
  assert.equal(made.body.created.length, 2);
  const list = await call(env, "GET", "/v1/mentoring/slots?mentor=ana", { as: BEN });
  assert.equal(list.body.items.length, 2);
  assert.equal(list.body.items[0].where, undefined, "the link is for the two of them");
  const sid = list.body.items[0].id;
  assert.equal((await call(env, "POST", `/v1/mentoring/slots/${sid}/book`, { as: ANA, body: {} })).status, 400, "not your own");
  assert.equal((await call(env, "POST", `/v1/mentoring/slots/${sid}/book`, { as: BEN, body: { note: "SBAS help" } })).status, 200);
  assert.equal((await call(env, "POST", `/v1/mentoring/slots/${sid}/book`, { as: ADMIN, body: {} })).status, 409, "taken");
  const mine = await call(env, "GET", "/v1/me/slots", { as: BEN });
  assert.equal(mine.body.booked[0].where, "https://meet.example/x");
  const ics = await call(env, "GET", `/v1/mentoring/slots/${sid}/ics`, { as: BEN });
  assert.match(new TextDecoder().decode(ics.body), /BEGIN:VEVENT[\s\S]*LOCATION:https/);
  assert.equal((await call(env, "GET", `/v1/mentoring/slots/${sid}/ics`, { as: ADMIN })).status, 404);
  assert.equal((await call(env, "POST", `/v1/mentoring/slots/${sid}/cancel`, { as: BEN })).body.status, "open");
  assert.match(slotIcs({ id: "s", starts_at: at, minutes: 30, topic: "a,b", note: "", where_text: "" }, { name: "A" }, { name: "B" }), /SUMMARY:Office hour: A and B/);
  // check-in
  const ids = await uid(env, "ana");
  const benId = await uid(env, "ben");
  const old = Math.floor(Date.now() / 1000) - 31 * 86400;
  await env.DB.prepare("INSERT INTO mentoring_requests (id, mentee_id, mentor_id, status, created_at, responded_at, updated_at) VALUES ('mr1', ?, ?, 'active', ?, ?, ?)").bind(benId, ids, old, old, old).run();
  assert.equal((await checkins(env)).asked, 1);
  assert.equal((await checkins(env)).asked, 0, "once");
});

// ── Pinned review comments ─────────────────────────────────────────────────

test("review comments pin to a page of the draft", async () => {
  assert.deepEqual(cleanPin({ page: 3, x: 1.4, y: -1, quote: "q" }), { page: 3, x: 1, y: 0, quote: "q" });
  assert.equal(cleanPin({ page: 0 }), null);
  const env = await world();
  const r = await call(env, "POST", "/v1/reviews", { as: ANA, body: { title: "Draft", abstract: "a", visibility: "public" } });
  const rid = r.body.id || r.body.review?.id;
  const c = await call(env, "POST", `/v1/reviews/${rid}/comments`, { as: ANA, body: { body: "Check this figure", pin: { page: 4, x: 0.3, y: 0.6, quote: "Fig. 2" } } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(c.body.pin, { page: 4, x: 0.3, y: 0.6, quote: "Fig. 2" });
  assert.equal(c.body.anchor, "p4");
});

// ── Importer ───────────────────────────────────────────────────────────────

test("ats: platforms, job links, JSON-LD jobs and events, iCalendar", () => {
  assert.equal(detectPlatform("https://boards.greenhouse.io/acme"), "greenhouse");
  assert.equal(detectPlatform("https://acme.wd3.myworkdayjobs.com/en-US/External"), "workday");
  assert.equal(detectPlatform("https://events.ecmwf.int/category/0/events.ics"), "ics");
  assert.ok(looksLikeDetail("/jobs/12345"));
  assert.ok(!plausibleTitle("View all jobs"));
  const html = `<a href="/jobs/4521-volcano-research-scientist"><h3>Volcano Research Scientist</h3><span>Catania</span></a>
    <a href="/jobs/">All jobs</a><a href="/about">About us</a>`;
  const jobs = harvestJobs(html, "https://ingv.example/careers");
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, "Volcano Research Scientist");
  const ld = jsonLd(`<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"InSAR Analyst","url":"/j/9","validThrough":"2027-01-31"},{"@type":"Event","name":"EGU GA","startDate":"2027-04-25","url":"/egu","location":{"name":"Vienna"}}]}</script>`);
  assert.equal(jobsFromJsonLd(ld, "https://x.example/")[0].url, "https://x.example/j/9");
  assert.equal(eventsFromJsonLd(ld, "https://x.example/")[0].location, "Vienna");
  const ics = parseIcs("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Workshop on Machine Learning for Hydrology\r\nDTSTART:20270310T090000Z\r\nURL:https://events.ecmwf.int/e/1\r\nLOCATION:Reading\r\nEND:VEVENT\r\nEND:VCALENDAR");
  assert.equal(ics[0].title, "Workshop on Machine Learning for Hydrology");
  assert.equal(ics[0].startsAt, Date.UTC(2027, 2, 10, 9) / 1000);
});

test("ats: greenhouse adapter, and a landing page hops to the real listing", async () => {
  const gh = await fetchJobs(async (u) => {
    assert.match(u, /boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs/);
    return Response.json({ jobs: [{ title: "Seismologist", absolute_url: "https://boards.greenhouse.io/acme/jobs/1", location: { name: "Remote" } }] });
  }, "https://boards.greenhouse.io/acme");
  assert.equal(gh.postings[0].title, "Seismologist");
  const pages = {
    "https://survey.example/careers": `<a href="/careers/current-vacancies">Current vacancies</a>`,
    "https://survey.example/careers/current-vacancies": `<a href="/vacancies/2201-hydrogeologist-grade-6">Hydrogeologist, grade 6</a>`,
  };
  const hop = await fetchJobs(async (u) => new Response(pages[u] || "", { status: pages[u] ? 200 : 404 }), "https://survey.example/careers");
  assert.equal(hop.platform, "html·hop");
  assert.equal(hop.postings[0].title, "Hydrogeologist, grade 6");
  const ev = await fetchEvents(async () => new Response("BEGIN:VEVENT\nSUMMARY:X\nDTSTART:20300101\nEND:VEVENT"), "https://a.example/cal.ics");
  assert.equal(ev.events.length, 1);
});

test("importer: scores like the scanner; posts relevant jobs and future events, credited; never twice", async () => {
  const [s1, hits] = scorePosting("Senior Volcano Remote Sensing Scientist (InSAR)");
  assert.ok(s1 >= 10, String(s1));
  assert.ok(hits.includes("insar"));
  assert.equal(scorePosting("Strategist")[0], 0, "gis must not match inside a word");
  assert.equal(scorePosting("Night nurse, volcano ward")[0], -1);
  assert.equal(scorePosting("HGV Drivers wanted")[0], -1);
  assert.ok(scorePosting("PhD Studentship: Drivers and Consequences of Recent Changes in Climate")[0] > 0, "drivers of change are science");

  const env = await world();
  await seedSources(env);
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM import_sources").first()).n;
  assert.ok(n >= 75, "the curated lists are seeded");
  const source = { id: "jobs:test", kind: "jobs", name: "Test Survey", url: "https://boards.greenhouse.io/test" };
  await env.DB.prepare("INSERT INTO import_sources (id, kind, name, url) VALUES (?, ?, ?, ?)").bind(source.id, source.kind, source.name, source.url).run();
  const fetcher = async () => Response.json({ jobs: [
    { title: "Landslide Hazard Modeller", absolute_url: "https://boards.greenhouse.io/test/jobs/1" },
    { title: "Office Manager", absolute_url: "https://boards.greenhouse.io/test/jobs/2" },
  ] });
  const r = await readSource(env, source, Math.floor(Date.now() / 1000), { fetcher });
  assert.equal(r.listed, 2);
  assert.equal(r.posted, 1, "only the relevant one");
  const again = await readSource(env, source, Math.floor(Date.now() / 1000) + 10, { fetcher });
  assert.equal(again.posted, 0, "never twice");
  const opp = await call(env, "GET", "/v1/feed?tab=opportunities");
  const post = opp.body.items.find((p) => /Landslide Hazard Modeller/.test(p.title));
  assert.ok(post, "on the Opportunities board");
  assert.equal(post.author.handle, "geoidnetwork");
  assert.ok((post.sources || []).some((s) => /Imported from Test Survey/.test(s.label)));
  const disc = await call(env, "GET", "/v1/feed?tab=discover");
  assert.ok(!disc.body.items.some((p) => p.id === post.id), "not in Discover");

  const evSource = { id: "events:test", kind: "events", name: "Test Society", url: "https://soc.example/cal.ics" };
  await env.DB.prepare("INSERT INTO import_sources (id, kind, name, url) VALUES (?, ?, ?, ?)").bind(evSource.id, evSource.kind, evSource.name, evSource.url).run();
  const ics = "BEGIN:VEVENT\nSUMMARY:Workshop on volcanic ash modelling\nDTSTART:20300301T090000Z\nURL:https://soc.example/e/1\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Past seismology day\nDTSTART:20200101T090000Z\nEND:VEVENT";
  const e = await readSource(env, evSource, Math.floor(Date.now() / 1000), { fetcher: async () => new Response(ics) });
  assert.equal(e.posted, 1, "the future, relevant one");
  // admin view
  assert.equal((await call(env, "GET", "/v1/imports", { as: ANA })).status, 403);
  const admin = await call(env, "GET", "/v1/imports", { as: ADMIN });
  assert.equal(admin.body.items.find((s) => s.id === "jobs:test").health, "green");
  // the rota reads at most a few per tick
  const tick = await runImports(env, Math.floor(Date.now() / 1000) + 86400 * 2, { fetcher: async () => new Response("", { status: 404 }), perTick: 3 });
  assert.equal(tick.read, 3);
});

test("jobs.ac.uk: a discipline-filtered search is read as a board, employer kept, board credited", async () => {
  // The board's result markup, with made-up adverts.
  const block = (code, title, dept, org, loc, closes) => `<div class="j-search-result__result ie-border-left" data-advert-id="1">
    <div class="j-search-result__text"><a href="/job/${code}/x">\n ${title}\n </a>
    <div class="j-search-result__department">\n ${dept}\n </div>
    <div class="j-search-result__employer">\n <b>${org}</b>\n </div>
    <div>Location:\n ${loc}\n </div>
    <div class="j-search-result__info"><strong>Salary: </strong> £38,249 to £45,413 - please see advert </div>
    <div><strong>Date Placed: </strong>23 Oct</div></div>
    <div class="j-search-result__date-logos"><div class="j-search-result__date">
      <span class="j-search-result__date-span j-search-result__date">Closes</span>
      <span class="j-search-result__date-span j-search-result__date--blue ">${closes}</span></div></div></div>`;
  const page = block("AB1", "Lecturer in Physical Geography", "School of Geography", "University of Leeds", "Leeds", "22 Dec")
    + block("AB2", "Research Associate in Volcano Geodesy", "Earth Sciences", "University of Bristol", "Bristol", "3 Jan")
    + block("AB3", "Graduation Ceremony Assistant", "Events", "Some University", "York", "1 Nov");
  const url = "https://www.jobs.ac.uk/search/?activeFacet=subDisciplineFacet&sortOrder=1&pageSize=25&startIndex=1&subDisciplineFacet%5B0%5D=geology";
  assert.equal(detectPlatform(url), "jobsacuk");
  const from = new Date(Date.UTC(2026, 9, 24));
  assert.equal(dayMonthAhead("22 Dec", from), "2026-12-22");
  assert.equal(dayMonthAhead("3 Jan", from), "2027-01-03", "a month already past is next year's");
  const list = parseJobsAcUk(page, "https://www.jobs.ac.uk/search/", from);
  assert.equal(list.length, 3);
  assert.deepEqual(
    { title: list[0].title, url: list[0].url, org: list[0].org, department: list[0].department, location: list[0].location, salary: list[0].salary, deadline: list[0].deadline },
    { title: "Lecturer in Physical Geography", url: "https://www.jobs.ac.uk/job/AB1/x", org: "University of Leeds", department: "School of Geography",
      location: "Leeds", salary: "£38,249 to £45,413", deadline: "2026-12-22" });

  const env = await world();
  const source = { id: "jobs:jacuk", kind: "jobs", name: "jobs.ac.uk", url };
  await env.DB.prepare("INSERT INTO import_sources (id, kind, name, url) VALUES (?, ?, ?, ?)").bind(source.id, source.kind, source.name, source.url).run();
  const asked = [];
  const fetcher = async (u) => { asked.push(u); return new Response(page); };
  const r = await readSource(env, source, Math.floor(Date.now() / 1000), { fetcher });
  assert.equal(asked.length, 1, "a short page is the last page");
  assert.equal(r.listed, 3);
  assert.equal(r.posted, 2, "the board's filter is trusted (a geography lectureship scores 0 but goes in); exclusions still apply");
  const opp = await call(env, "GET", "/v1/feed?tab=opportunities");
  const post = opp.body.items.find((p) => /Physical Geography/.test(p.title));
  assert.ok(post);
  assert.equal(post.meta.org, "University of Leeds", "the employer is the advert's");
  assert.equal(post.meta.source_name, "jobs.ac.uk", "the credit is the board's");
  assert.match(post.body, /Listed on jobs\.ac\.uk/);
  assert.ok(post.meta.deadline > 0);
});
