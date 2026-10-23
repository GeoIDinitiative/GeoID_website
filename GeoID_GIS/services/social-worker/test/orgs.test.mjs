/**
 * Identity and institutions (orgs.js): organisations, verified affiliations,
 * org posts and follows, mentoring, the welcome, and erasure/export.
 *
 * Every response goes through api(), which fails if an email address -- or
 * the DOMAIN of a sign-in address -- appears in it, except on /v1/me/export.
 * The org's own domains (shown on its page) are the org's, so the members
 * here sign in at subdomains and other hosts the org does not list.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";
import { cleanDomains, domainMatches, domainSuffixes } from "../orgs.js";

const ANA = "ana@geo.leeds.ac.uk";      // a Leeds subdomain: verifiable
const BEN = "ben@bgs-mail.example";     // elsewhere: self-declared only
const CAT = "cat@leeds.ac.uk.evil.test"; // a lookalike that must not match
const ADMIN = "admin@example.com";

async function api(env, method, path, opts = {}) {
  const res = await call(env, method, path, opts);
  if (!path.startsWith("/v1/me/export")) {
    const text = res.body instanceof ArrayBuffer ? new TextDecoder().decode(res.body) : JSON.stringify(res.body);
    for (const leak of ["@example.com", "geo.leeds.ac.uk", "bgs-mail", "evil.test"]) {
      assert.ok(!text.includes(leak), `${method} ${path} leaked "${leak}": ${text.slice(0, 300)}`);
    }
  }
  return res;
}

async function world() {
  const env = makeEnv();
  for (const [who, handle] of [[ANA, "ana"], [BEN, "ben"], [CAT, "cat"], [ADMIN, "boss"]]) {
    assert.equal((await api(env, "PATCH", "/v1/me", { as: who, body: { handle } })).status, 200);
  }
  return env;
}

const leeds = (env, as = BEN) => api(env, "POST", "/v1/orgs", { as, body: {
  name: "University of Leeds", kind: "university", domains: ["leeds.ac.uk"], website: "https://www.leeds.ac.uk", location: "Leeds, UK",
  description: "School of Earth and Environment." } });

test("domain rules: subdomains count, lookalikes and free mail do not", () => {
  assert.ok(domainMatches("geo.leeds.ac.uk", "leeds.ac.uk"));
  assert.ok(domainMatches("leeds.ac.uk", "leeds.ac.uk"));
  assert.ok(!domainMatches("leeds.ac.uk.evil.test", "leeds.ac.uk"));
  assert.ok(!domainMatches("notleeds.ac.uk", "leeds.ac.uk"));
  assert.deepEqual(domainSuffixes("a.b.leeds.ac.uk"), ["a.b.leeds.ac.uk", "b.leeds.ac.uk", "leeds.ac.uk", "ac.uk"]);
  assert.deepEqual(cleanDomains(["https://www.BGS.ac.uk/", "@leeds.ac.uk", "leeds.ac.uk"]), ["bgs.ac.uk", "leeds.ac.uk"]);
  for (const bad of ["gmail.com", "ac.uk", "edu.au", "not a domain", "localhost"]) assert.throws(() => cleanDomains([bad]), bad);
});

test("orgs: propose, list, search, edit; unverified until a site admin verifies", async () => {
  const env = await world();
  const made = await leeds(env);
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.org.slug, "university-of-leeds");
  assert.equal(made.body.org.verified, false);
  assert.equal(made.body.viewer.role, "admin");
  assert.equal((await leeds(env, CAT)).status, 409, "the same name twice is refused");
  assert.equal((await api(env, "POST", "/v1/orgs", { as: BEN, body: { name: "Free mail Inc", domains: ["gmail.com"] } })).status, 400);
  assert.equal((await api(env, "POST", "/v1/orgs", { as: BEN, body: { name: "Bad kind", kind: "cult" } })).status, 400);
  assert.equal((await api(env, "POST", "/v1/orgs", { body: { name: "Anon" } })).status, 401);

  const list = await api(env, "GET", "/v1/orgs?q=leeds");
  assert.deepEqual(list.body.items.map((o) => o.slug), ["university-of-leeds"]);
  assert.equal((await api(env, "GET", "/v1/orgs?verified=1")).body.items.length, 0);
  assert.equal((await api(env, "GET", "/v1/orgs?pending=1", { as: BEN })).status, 403, "the queue is for site admins");
  assert.equal((await api(env, "GET", "/v1/orgs?pending=1", { as: ADMIN })).body.items.length, 1);

  // Only org admins edit; while unverified the name and domains are theirs.
  assert.equal((await api(env, "PATCH", "/v1/orgs/university-of-leeds", { as: CAT, body: { description: "x" } })).status, 403);
  const edited = await api(env, "PATCH", "/v1/orgs/university-of-leeds", { as: BEN, body: { description: "SEE", domains: ["leeds.ac.uk", "see.leeds.ac.uk"] } });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.org.domains, ["leeds.ac.uk", "see.leeds.ac.uk"]);

  // Verify: site admins only. Then name/domains lock for org admins.
  assert.equal((await api(env, "POST", "/v1/orgs/university-of-leeds/verify", { as: BEN, body: { verified: true } })).status, 403);
  const v = await api(env, "POST", "/v1/orgs/university-of-leeds/verify", { as: ADMIN, body: { verified: true } });
  assert.equal(v.body.org.verified, true);
  assert.equal((await api(env, "PATCH", "/v1/orgs/university-of-leeds", { as: BEN, body: { domains: ["gmail-ish.org"] } })).status, 403);
  assert.equal((await api(env, "PATCH", "/v1/orgs/university-of-leeds", { as: BEN, body: { name: "Oxford" } })).status, 403);
  assert.equal((await api(env, "PATCH", "/v1/orgs/university-of-leeds", { as: BEN, body: { location: "Leeds" } })).status, 200, "other fields stay editable");
  const audit = env.DB.raw.prepare("SELECT action FROM audit WHERE ref_type = 'org'").all().map((r) => r.action);
  assert.ok(audit.includes("org_verify"));
});

test("verified affiliation comes from the sign-in address, never from saying so", async () => {
  const env = await world();
  await leeds(env);
  // Before verification: everyone's affiliation is self-declared.
  let join = await api(env, "POST", "/v1/orgs/university-of-leeds/join", { as: ANA });
  assert.equal(join.body.verified, false);
  await api(env, "POST", "/v1/orgs/university-of-leeds/verify", { as: ADMIN, body: { verified: true } });

  // Verifying the org verifies the members whose address matches -- and only them.
  let ana = (await api(env, "GET", "/v1/users/ana")).body.user;
  assert.deepEqual(ana.affiliation, { slug: "university-of-leeds", name: "University of Leeds", verified: true });
  const ben = (await api(env, "GET", "/v1/users/ben")).body.user;
  assert.deepEqual(ben.affiliation, { slug: "university-of-leeds", name: "University of Leeds", verified: false }, "the proposer is self-declared");
  join = await api(env, "POST", "/v1/orgs/university-of-leeds/join", { as: CAT });
  assert.equal(join.body.verified, false, "a lookalike host is not a subdomain");

  // The badge rides on every card: people search and member lists.
  const people = await api(env, "GET", "/v1/users?q=ana");
  assert.equal(people.body.items[0].affiliation.verified, true);
  const members = await api(env, "GET", "/v1/orgs/university-of-leeds/members");
  assert.deepEqual(members.body.items.map((m) => [m.user.handle, m.verified]).sort(), [["ana", true], ["ben", false], ["cat", false]]);

  // Unverifying the org withdraws every verified affiliation at once.
  await api(env, "POST", "/v1/orgs/university-of-leeds/verify", { as: ADMIN, body: { verified: false } });
  ana = (await api(env, "GET", "/v1/users/ana")).body.user;
  assert.equal(ana.affiliation.verified, false);

  // The suggestion ("your address matches X") is for its owner only and names the org, not the address.
  await api(env, "POST", "/v1/orgs/university-of-leeds/verify", { as: ADMIN, body: { verified: true } });
  await api(env, "POST", "/v1/orgs/university-of-leeds/leave", { as: ANA });
  const mine = await api(env, "GET", "/v1/me/orgs", { as: ANA });
  assert.deepEqual(mine.body.suggested.map((o) => o.slug), ["university-of-leeds"]);
  assert.equal((await api(env, "GET", "/v1/me/orgs", { as: CAT })).body.suggested.length, 0);
  ana = (await api(env, "GET", "/v1/users/ana")).body.user;
  assert.equal(ana.affiliation, null, "leaving clears the card");
});

test("affiliation shown: verified preferred, can be switched or hidden", async () => {
  const env = await world();
  await api(env, "POST", "/v1/orgs", { as: ANA, body: { name: "Volcano Club", kind: "nonprofit" } });
  await leeds(env);
  await api(env, "POST", "/v1/orgs/university-of-leeds/verify", { as: ADMIN, body: { verified: true } });
  await api(env, "POST", "/v1/orgs/university-of-leeds/join", { as: ANA });
  let ana = (await api(env, "GET", "/v1/users/ana")).body.user;
  assert.equal(ana.affiliation.slug, "university-of-leeds", "a verified affiliation replaces a self-declared one");
  await api(env, "PATCH", "/v1/me/affiliation", { as: ANA, body: { org: "volcano-club" } });
  ana = (await api(env, "GET", "/v1/users/ana")).body.user;
  assert.deepEqual(ana.affiliation, { slug: "volcano-club", name: "Volcano Club", verified: false });
  assert.equal((await api(env, "PATCH", "/v1/me/affiliation", { as: BEN, body: { org: "volcano-club" } })).status, 400, "join first");
  await api(env, "PATCH", "/v1/me/affiliation", { as: ANA, body: { org: null } });
  assert.equal((await api(env, "GET", "/v1/users/ana")).body.user.affiliation, null);
});

test("org roles: the last admin stays; removal clears the member's card", async () => {
  const env = await world();
  await leeds(env);
  await api(env, "POST", "/v1/orgs/university-of-leeds/join", { as: ANA });
  assert.equal((await api(env, "POST", "/v1/orgs/university-of-leeds/leave", { as: BEN })).status, 409, "only admin can't walk away");
  assert.equal((await api(env, "POST", "/v1/orgs/university-of-leeds/members/ben", { as: BEN, body: { role: "member" } })).status, 409);
  assert.equal((await api(env, "POST", "/v1/orgs/university-of-leeds/members/ana", { as: ANA, body: { role: "admin" } })).status, 403);
  assert.equal((await api(env, "POST", "/v1/orgs/university-of-leeds/members/ana", { as: BEN, body: { role: "admin" } })).status, 200);
  assert.equal((await api(env, "POST", "/v1/orgs/university-of-leeds/leave", { as: BEN })).status, 200);
  assert.equal((await api(env, "DELETE", "/v1/orgs/university-of-leeds/members/ana", { as: ANA })).status, 409);
  await api(env, "POST", "/v1/orgs/university-of-leeds/join", { as: CAT });
  assert.equal((await api(env, "DELETE", "/v1/orgs/university-of-leeds/members/cat", { as: ANA })).status, 200);
  assert.equal((await api(env, "GET", "/v1/users/cat")).body.user.affiliation, null);
  assert.equal((await api(env, "GET", "/v1/orgs/university-of-leeds")).body.org.member_count, 1);
});

test("follow an org; its admins post opportunities as it; followers hear", async () => {
  const env = await world();
  await leeds(env);
  assert.equal((await api(env, "POST", "/v1/follow", { as: CAT, body: { type: "org", id: "university-of-leeds" } })).status, 200);
  assert.equal((await api(env, "POST", "/v1/follow", { as: CAT, body: { type: "org", id: "nope" } })).status, 404);
  const following = await api(env, "GET", "/v1/me/following?type=org", { as: CAT });
  assert.deepEqual(following.body.items, [{ type: "org", id: "university-of-leeds", label: "University of Leeds" }]);
  assert.equal((await api(env, "GET", "/v1/orgs/university-of-leeds", { as: CAT })).body.counts.followers, 1);

  assert.equal((await api(env, "POST", "/v1/orgs/university-of-leeds/posts", { as: CAT, body: { title: "Fake job" } })).status, 403);
  assert.equal((await api(env, "POST", "/v1/orgs/university-of-leeds/posts", { as: BEN, body: { kind: "text", title: "x" } })).status, 400);
  const job = await api(env, "POST", "/v1/orgs/university-of-leeds/posts", { as: BEN, body: {
    title: "PhD studentship: glacier hazards", body: "Funded.", meta: { type: "studentship", paid: true } } });
  assert.equal(job.status, 200, JSON.stringify(job.body));
  assert.equal(job.body.kind, "opportunity");
  assert.equal(job.body.meta.org, "University of Leeds");
  const read = await api(env, "GET", `/v1/posts/${job.body.id}`);
  assert.deepEqual(read.body.org, { slug: "university-of-leeds", name: "University of Leeds" });
  // The author cannot detach or re-point the org by editing.
  await api(env, "PATCH", `/v1/posts/${job.body.id}`, { as: BEN, body: { title: "Edited", org: { slug: "x" }, org_id: "o_x" } });
  assert.equal((await api(env, "GET", `/v1/posts/${job.body.id}`)).body.org.slug, "university-of-leeds");
  // A post made the ordinary way carries no org.
  const plain = await api(env, "POST", "/v1/posts", { as: BEN, body: { kind: "opportunity", title: "Mine" } });
  assert.equal(plain.body.org, null);

  const page = await api(env, "GET", "/v1/orgs/university-of-leeds");
  assert.deepEqual(page.body.posts.map((p) => p.id), [job.body.id]);
  const notes = await api(env, "GET", "/v1/notifications", { as: CAT });
  assert.ok(notes.body.items.some((n) => n.ref_id === job.body.id), "followers are told");

  // Removing the org (site admin) unstamps posts and drops follows.
  assert.equal((await api(env, "DELETE", "/v1/orgs/university-of-leeds", { as: CAT })).status, 403);
  await api(env, "POST", "/v1/orgs/university-of-leeds/verify", { as: ADMIN, body: { verified: true } });
  assert.equal((await api(env, "DELETE", "/v1/orgs/university-of-leeds", { as: BEN })).status, 403, "verified: site admins only");
  assert.equal((await api(env, "DELETE", "/v1/orgs/university-of-leeds", { as: ADMIN })).status, 200);
  assert.equal((await api(env, "GET", "/v1/orgs/university-of-leeds")).status, 404);
  assert.equal((await api(env, "GET", `/v1/posts/${job.body.id}`)).body.org, null);
  assert.equal((await api(env, "GET", "/v1/users/ben")).body.user.affiliation, null);
});

test("mentoring: opt in, request, accept opens a conversation, counts in reputation", async () => {
  const env = await world();
  assert.equal((await api(env, "POST", "/v1/mentoring/requests", { as: BEN, body: { handle: "ana", topic: "InSAR careers" } })).status, 409, "not open yet");
  const opened = await api(env, "PATCH", "/v1/me/mentoring", { as: ANA, body: { open: true, topics: ["InSAR", "careers"] } });
  assert.deepEqual(opened.body, { open: true, topics: ["insar", "careers"] });
  const mentors = await api(env, "GET", "/v1/users?mentor=1");
  assert.deepEqual(mentors.body.items.map((u) => u.handle), ["ana"]);
  assert.equal(mentors.body.items[0].mentoring, true);
  assert.deepEqual(mentors.body.items[0].mentoring_topics, ["insar", "careers"]);
  assert.equal((await api(env, "GET", "/v1/users?mentor=1&mentor_topic=geology")).body.items.length, 0);
  assert.deepEqual((await api(env, "GET", "/v1/users/ana")).body.user.mentoring_topics, ["insar", "careers"]);

  const req = await api(env, "POST", "/v1/mentoring/requests", { as: BEN, body: { handle: "ana", topic: "InSAR careers", message: "Hello" } });
  assert.equal(req.status, 200, JSON.stringify(req.body));
  assert.equal(req.body.status, "requested");
  assert.equal((await api(env, "POST", "/v1/mentoring/requests", { as: BEN, body: { handle: "ana" } })).status, 409, "one open request per pair");
  assert.equal((await api(env, "POST", "/v1/mentoring/requests", { as: ANA, body: { handle: "ana" } })).status, 400);
  assert.equal((await api(env, "POST", `/v1/mentoring/requests/${req.body.id}/respond`, { as: BEN, body: { accept: true } })).status, 404, "only the mentor answers");

  const incoming = await api(env, "GET", "/v1/mentoring/requests?role=mentor", { as: ANA });
  assert.equal(incoming.body.items[0].mentee.handle, "ben");
  const ok = await api(env, "POST", `/v1/mentoring/requests/${req.body.id}/respond`, { as: ANA, body: { accept: true } });
  assert.equal(ok.body.status, "active");
  assert.ok(ok.body.conversation_id);
  const msgs = await api(env, "GET", `/v1/conversations/${ok.body.conversation_id}/messages`, { as: BEN });
  assert.equal(msgs.status, 200, JSON.stringify(msgs.body));

  const rep = await api(env, "GET", "/v1/users/ana/reputation");
  const cat = rep.body.categories.find((c) => c.id === "mentoring");
  assert.equal(cat.count, 1);
  assert.equal(cat.evidence[0].id, null, "counted, not named");
  assert.ok(!JSON.stringify(cat).includes("InSAR careers"));

  assert.equal((await api(env, "POST", `/v1/mentoring/requests/${req.body.id}/close`, { as: BEN })).body.status, "ended");
  assert.equal((await api(env, "GET", "/v1/users/ana/reputation")).body.categories.find((c) => c.id === "mentoring").count, 1, "ended still counts");

  // Declining, and withdrawing a pending request.
  await api(env, "PATCH", "/v1/me/mentoring", { as: CAT, body: { open: true } });
  const r2 = await api(env, "POST", "/v1/mentoring/requests", { as: BEN, body: { handle: "cat" } });
  assert.equal((await api(env, "POST", `/v1/mentoring/requests/${r2.body.id}/respond`, { as: CAT, body: { accept: false } })).body.status, "declined");
  assert.equal((await api(env, "GET", "/v1/users/cat/reputation")).body.categories.find((c) => c.id === "mentoring").count, 0);
  const r3 = await api(env, "POST", "/v1/mentoring/requests", { as: BEN, body: { handle: "cat" } });
  assert.equal((await api(env, "POST", `/v1/mentoring/requests/${r3.body.id}/close`, { as: BEN })).body.status, "withdrawn");

  // A block stops new requests.
  await api(env, "POST", "/v1/blocks", { as: ANA, body: { handle: "cat" } });
  assert.equal((await api(env, "POST", "/v1/mentoring/requests", { as: CAT, body: { handle: "ana" } })).status, 403);
});

test("welcome: shown once for a bare profile, dismissal remembered, suggestions explain themselves", async () => {
  const env = await world();
  let me = (await api(env, "GET", "/v1/me", { as: CAT })).body;
  assert.equal(me.user.onboarding_done, false);
  let ob = await api(env, "GET", "/v1/me/onboarding", { as: CAT });
  assert.equal(ob.body.show, true);
  assert.equal(ob.body.suggestions.communities.length, 6, "with no interests: the biggest open communities");

  await api(env, "PATCH", "/v1/me", { as: ANA, body: { interests: ["volcanology", "insar"], match_opt_in: true, availability: "open" } });
  await api(env, "PATCH", "/v1/me", { as: BEN, body: { interests: ["volcanology"] } }); // not opted in
  await api(env, "PATCH", "/v1/me", { as: CAT, body: { interests: ["insar", "volcanology"] } });
  ob = await api(env, "GET", "/v1/me/onboarding", { as: CAT });
  assert.equal(ob.body.show, false, "no longer bare");
  assert.equal(ob.body.suggestions.communities[0].slug, "volcanology");
  assert.match(ob.body.suggestions.communities[0].reasons[0], /#volcanology/);
  assert.deepEqual(ob.body.suggestions.people.map((p) => p.user.handle), ["ana"], "opt-in matcher users only");
  assert.match(ob.body.suggestions.people[0].reasons[0], /#insar/);

  // Dismissed on one device is dismissed everywhere; it can be asked for again.
  await api(env, "PATCH", "/v1/me", { as: BEN, body: { interests: [] } });
  assert.equal((await api(env, "GET", "/v1/me/onboarding", { as: BEN })).body.show, true);
  await api(env, "POST", "/v1/me/onboarding", { as: BEN, body: { done: true } });
  assert.equal((await api(env, "GET", "/v1/me/onboarding", { as: BEN })).body.show, false);
  assert.equal((await api(env, "GET", "/v1/me", { as: BEN })).body.user.onboarding_done, true);
  await api(env, "POST", "/v1/me/onboarding", { as: BEN, body: { done: false } });
  assert.equal((await api(env, "GET", "/v1/me/onboarding", { as: BEN })).body.show, true);

  // A matching verified org is suggested to the address's owner.
  await leeds(env, BEN);
  await api(env, "POST", "/v1/orgs/university-of-leeds/verify", { as: ADMIN, body: { verified: true } });
  me = await api(env, "GET", "/v1/me/onboarding", { as: ANA });
  assert.deepEqual(me.body.suggestions.orgs.map((o) => o.slug), ["university-of-leeds"]);
});

test("erasure removes affiliations and mentoring; export includes them", async () => {
  const env = await world();
  await leeds(env);
  await api(env, "POST", "/v1/orgs/university-of-leeds/join", { as: ANA });
  await api(env, "PATCH", "/v1/me/mentoring", { as: ANA, body: { open: true, topics: ["gis"] } });
  await api(env, "POST", "/v1/mentoring/requests", { as: CAT, body: { handle: "ana", topic: "GIS" } });

  const exp = await call(env, "GET", "/v1/me/export", { as: ANA });
  const data = exp.body;
  assert.deepEqual(data.org_memberships.map((m) => m.slug), ["university-of-leeds"]);
  assert.equal(data.mentoring_requests[0].mentee, "cat");
  assert.ok(Array.isArray(data.publication_checks));

  assert.equal((await api(env, "DELETE", "/v1/me", { as: ANA, body: { confirm: "ana" } })).status, 200);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM org_members WHERE org_id = (SELECT id FROM orgs WHERE slug = 'university-of-leeds')").get().n, 1);
  assert.equal((await api(env, "GET", "/v1/orgs/university-of-leeds")).body.org.member_count, 1);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM mentoring_requests").get().n, 0);
  assert.equal((await api(env, "GET", "/v1/users?mentor=1")).body.items.length, 0);
  const row = env.DB.raw.prepare("SELECT aff_slug, mentoring_open FROM users WHERE email LIKE 'erased:%'").get();
  assert.deepEqual({ ...row }, { aff_slug: "", mentoring_open: 0 });
});
