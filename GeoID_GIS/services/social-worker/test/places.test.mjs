// node --test test/places.test.mjs -- place pages: one story per place, weighed.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";
import { slugOf, weigh } from "../places.js";

const ANA = "ana@example.com", BEN = "ben@example.com", CAT = "cat@example.com", ADMIN = "admin@example.com";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
async function world() {
  const env = makeEnv();
  for (const [who, handle, name] of [[ANA, "ana", "Ana Reyes"], [BEN, "ben", "Ben Cole"], [CAT, "cat", "Cat Dunn"], [ADMIN, "admin", "Admin"]]) {
    await call(env, "PATCH", "/v1/me", { as: who, body: { handle, name } });
  }
  return env;
}

test("slugs and weights", () => {
  assert.equal(slugOf("Bárðarbunga–Holuhraun"), "bardarbunga-holuhraun");
  const paper = weigh({ kind: "paper", peer_reviewed: 1, doi: "10.1/x" }, { score: 2, reasons: ["verified ORCID iD", "verified affiliation"] }, [{ verified: true }, { verified: false }]);
  const note = weigh({ kind: "milestone", doi: "" }, { score: 0, reasons: [] }, []);
  assert.ok(paper.score > note.score);
  assert.equal(paper.level, "strong");
  assert.equal(note.level, "member");
  assert.ok(paper.why.includes("peer-reviewed paper"));
  assert.ok(paper.why.some((w) => /verified ORCID iD/.test(w)));
});

test("place pages: one per place, a weighed story, the Network's posts, people and mentors gathered", async () => {
  const env = await world();
  await call(env, "POST", "/v1/me/study-areas", { as: ANA, body: { name: "Etna summit", lat: 37.75, lon: 15.0, precision: "approx" } });
  await call(env, "POST", "/v1/me/study-areas", { as: BEN, body: { name: "Valle del Bove", lat: 37.7, lon: 15.05, precision: "approx" } });
  await call(env, "PATCH", "/v1/me/mentoring", { as: BEN, body: { open: true, topics: ["volcanology"] } });
  const made = await call(env, "POST", "/v1/places/pages", { as: ANA, body: { name: "Etna", lat: 37.75, lon: 14.99, radius_km: 30, summary: "Europe's most active volcano." } });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.place.slug, "etna");
  // Opening it again nearby lands on the same page.
  const again = await call(env, "POST", "/v1/places/pages", { as: CAT, body: { name: "Mount Etna", lat: 37.73, lon: 15.02, radius_km: 25 } });
  assert.equal(again.body.exists, true);
  assert.equal(again.body.place.slug, "etna");
  const notes = (await call(env, "GET", "/v1/notifications", { as: BEN })).body.items;
  assert.ok(notes.some((n) => n.kind === "place" && /A place page for Etna/.test(n.text)), "people who study the spot are told");

  const page = await call(env, "GET", "/v1/places/pages/etna", { as: CAT });
  assert.deepEqual(page.body.people.map((p) => p.user.handle).sort(), ["ana", "ben"]);
  assert.equal(page.body.counts.mentors, 1);
  assert.equal(page.body.viewer.can_edit, false);

  // The story: a peer-reviewed paper by DOI (through Crossref), a milestone, a post.
  env.fetchImpl = async (u) => (String(u).includes("crossref") ? json({ message: { type: "journal-article", title: ["The 2021 paroxysms of Etna"],
    "container-title": ["Journal of Volcanology"], issued: { "date-parts": [[2022]] }, author: [{ given: "A.", family: "Bonaccorso" }] } }) : json({}, 404));
  const paper = await call(env, "POST", "/v1/places/pages/etna/story", { as: BEN, body: { kind: "paper", doi: "https://doi.org/10.1016/J.JVOLGEORES.2022.1" } });
  assert.equal(paper.status, 200, JSON.stringify(paper.body));
  assert.deepEqual([paper.body.peer_reviewed, paper.body.happened_on, paper.body.venue], [true, "2022", "Journal of Volcanology"]);
  assert.equal((await call(env, "POST", "/v1/places/pages/etna/story", { as: CAT, body: { kind: "paper", doi: "10.1016/j.jvolgeores.2022.1" } })).status, 409, "once per place");
  const ms = await call(env, "POST", "/v1/places/pages/etna/story", { as: CAT, body: { kind: "milestone", title: "66 lava fountains in 2021", happened_on: "2021" } });
  assert.equal(ms.body.weight.level, "member");
  assert.equal((await call(env, "POST", "/v1/places/pages/etna/story", { as: CAT, body: { kind: "milestone", title: "No date" } })).status, 400);
  const post = await call(env, "POST", "/v1/posts", { as: ANA, body: { kind: "question", title: "Who has 2021 tilt data?", tags: ["etna"], visibility: "public" } });
  await call(env, "POST", "/v1/places/pages/etna/story", { as: ANA, body: { kind: "post", post_id: post.body.id } });
  // Endorsing: never your own; a verified member counts double.
  assert.equal((await call(env, "POST", `/v1/places/entries/${paper.body.id}/endorse`, { as: BEN })).status, 400);
  await env.DB.prepare("UPDATE users SET orcid_verified = 1 WHERE handle = 'ana'").run();
  const e = await call(env, "POST", `/v1/places/entries/${ms.body.id}/endorse`, { as: ANA });
  assert.equal(e.body.endorsements, 1);
  assert.ok(e.body.weight.score > ms.body.weight.score);

  const byTime = await call(env, "GET", "/v1/places/pages/etna/story");
  assert.deepEqual(byTime.body.items.map((i) => i.kind), ["post", "paper", "milestone"], "newest happening first");
  const byWeight = await call(env, "GET", "/v1/places/pages/etna/story?order=weight");
  assert.equal(byWeight.body.items[0].kind, "paper", "peer-reviewed evidence first");

  // The forum and the rest: posts inside the place, or tagged with its slug.
  await call(env, "POST", "/v1/posts", { as: BEN, body: { kind: "opportunity", title: "Field assistant on Etna", location: { lat: 37.74, lon: 15.0, precision: "approx" }, visibility: "public" } });
  await call(env, "POST", "/v1/posts", { as: BEN, body: { kind: "opportunity", title: "Lab job in Leeds", location: { lat: 53.8, lon: -1.55, precision: "approx" }, visibility: "public" } });
  assert.deepEqual((await call(env, "GET", "/v1/places/pages/etna/posts?kind=question")).body.items.map((p) => p.title), ["Who has 2021 tilt data?"]);
  assert.deepEqual((await call(env, "GET", "/v1/places/pages/etna/posts?kind=opportunity")).body.items.map((p) => p.title), ["Field assistant on Etna"]);

  // Following the page: new entries reach you. Only the opener (or an admin) edits the summary.
  await call(env, "POST", "/v1/follow", { as: CAT, body: { type: "placepage", id: "etna" } });
  await call(env, "POST", "/v1/places/pages/etna/story", { as: BEN, body: { kind: "link", title: "INGV bulletin", url: "https://www.ct.ingv.it/" } });
  assert.ok((await call(env, "GET", "/v1/notifications", { as: CAT })).body.items.some((n) => /Etna: INGV bulletin/.test(n.text)));
  assert.equal((await call(env, "PATCH", "/v1/places/pages/etna", { as: BEN, body: { summary: "x" } })).status, 403);
  assert.equal((await call(env, "PATCH", "/v1/places/pages/etna", { as: ANA, body: { summary: "Stratovolcano, eastern Sicily." } })).body.summary, "Stratovolcano, eastern Sicily.");

  // Photos: linked from Wikimedia Commons, never stored.
  env.fetchImpl = async () => json({ query: { pages: { 1: { title: "File:Etna eruption 2021.jpg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/x/480px-Etna.jpg",
    descriptionurl: "https://commons.wikimedia.org/wiki/File:Etna.jpg", extmetadata: { Artist: { value: "<a>Gio</a>" }, LicenseShortName: { value: "CC BY-SA 4.0" } } }] } } } });
  const ph = await call(env, "GET", "/v1/places/pages/etna/photos");
  assert.deepEqual([ph.body.items[0].author, ph.body.items[0].licence], ["Gio", "CC BY-SA 4.0"]);
});
