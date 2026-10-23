/**
 * verify.js: publication checks against Crossref and ORCID linking. The
 * network is a mock: globalThis.fetch is swapped for a function that answers
 * as Crossref / ORCID would, and restored after each test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, call } from "./harness.mjs";
import { authorMatches, nameTokens, normalDoi } from "../verify.js";

const ME = "jose@example.com";
const OTHER = "ann@example.com";

const realFetch = globalThis.fetch;
function mockFetch(handler) {
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = String(input instanceof Request ? input.url : input);
    seen.push({ url: u, init });
    return handler(u, init);
  };
  return seen;
}
const restore = () => { globalThis.fetch = realFetch; };
const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const WORK = {
  message: {
    title: ["Ground deformation at Etna from InSAR"],
    "container-title": ["Geophysical Research Letters"],
    issued: { "date-parts": [[2021, 3]] },
    author: [{ given: "Ann", family: "Lee" }, { given: "J. A.", family: "Núñez García" }],
  },
};

async function setup() {
  const env = makeEnv();
  await call(env, "PATCH", "/v1/me", { as: ME, body: { handle: "jose", name: "José Nuñez-García" } });
  await call(env, "PATCH", "/v1/me", { as: OTHER, body: { handle: "ann" } });
  const item = await call(env, "POST", "/v1/me/items", { as: ME, body: {
    kind: "publication", title: "Etna deformation", doi: "https://doi.org/10.1029/2021GL000001" } });
  return { env, item: item.body };
}

test("name matching: family name + initial, accents and order ignored", () => {
  assert.deepEqual(nameTokens("Øyvind Ström-Łukasz"), ["oyvind", "strom", "lukasz"]);
  assert.ok(authorMatches("José Nuñez-García", { given: "J. A.", family: "Núñez García" }));
  assert.ok(authorMatches("Nuñez-García, José", { given: "Jose", family: "Nunez-Garcia" }));
  assert.ok(authorMatches("Jan van der Berg", { given: "J.", family: "van der Berg" }));
  assert.ok(authorMatches("Sean O'Brien", { given: "Seán", family: "O’Brien" }));
  assert.ok(!authorMatches("Ana Smith", { given: "B.", family: "Smith" }), "initial must agree");
  assert.ok(!authorMatches("Ana Smithson", { given: "A.", family: "Smith" }), "family must be whole words");
  assert.ok(!authorMatches("Smith", { given: "A.", family: "Smith" }), "a one-word name has no initial to check");
  assert.ok(!authorMatches("Ana Smith", { family: "Smith" }), "no given name on the record: not enough");
  assert.equal(normalDoi("doi: 10.1029/2021GL000001"), "10.1029/2021gl000001");
  assert.equal(normalDoi("not a doi"), "");
});

test("a DOI that resolves with the member as an author is verified, with its evidence shown", async () => {
  const { env, item } = await setup();
  const seen = mockFetch(() => jsonRes(WORK));
  try {
    assert.equal((await call(env, "POST", `/v1/me/items/${item.id}/verify`, { as: OTHER })).status, 404, "not yours");
    const res = await call(env, "POST", `/v1/me/items/${item.id}/verify`, { as: ME });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.item.verified, true);
    assert.equal(res.body.verification.outcome, "verified");
    assert.equal(res.body.verification.matched_author, "Núñez García, J. A.");
    assert.equal(res.body.verification.journal, "Geophysical Research Letters");
    assert.equal(res.body.verification.year, 2021);
    assert.equal(seen.length, 1);
    assert.match(seen[0].url, /^https:\/\/api\.crossref\.org\/works\/10\.1029\/2021gl000001$/);

    // The profile shows the tick AND what was checked.
    const profile = await call(env, "GET", "/v1/users/jose");
    const shown = profile.body.items[0];
    assert.equal(shown.verified, true);
    assert.equal(shown.verification.source, "crossref");
    assert.equal(shown.verification.title, "Ground deformation at Etna from InSAR");
    assert.ok(!JSON.stringify(profile.body).includes("@example.com"));

    // Checked moments ago: no second call to Crossref.
    assert.equal((await call(env, "POST", `/v1/me/items/${item.id}/verify`, { as: ME })).status, 429);
    assert.equal(seen.length, 1);

    // Changing the DOI takes the tick away: it belonged to the old one.
    const patched = await call(env, "PATCH", `/v1/me/items/${item.id}`, { as: ME, body: { doi: "10.1000/other" } });
    assert.equal(patched.body.verified, false);
    // Editing anything else keeps it.
    env.DB.raw.prepare("UPDATE profile_items SET verified = 1 WHERE id = ?").run(item.id);
    assert.equal((await call(env, "PATCH", `/v1/me/items/${item.id}`, { as: ME, body: { year: 2021 } })).body.verified, true);
  } finally { restore(); }
});

test("a DOI without the member's name, an unknown DOI, and a Crossref outage", async () => {
  const { env, item } = await setup();
  const rewind = () => env.DB.raw.prepare("UPDATE item_verifications SET checked_at = checked_at - 120").run();
  try {
    mockFetch(() => jsonRes({ message: { ...WORK.message, author: [{ given: "Ann", family: "Lee" }] } }));
    let res = await call(env, "POST", `/v1/me/items/${item.id}/verify`, { as: ME });
    assert.equal(res.body.item.verified, false);
    assert.equal(res.body.verification.outcome, "name-mismatch");
    assert.equal(res.body.verification.resolved, true);
    assert.deepEqual(res.body.verification.authors, ["Ann Lee"]);

    rewind();
    mockFetch(() => new Response("Resource not found.", { status: 404 }));
    res = await call(env, "POST", `/v1/me/items/${item.id}/verify`, { as: ME });
    assert.equal(res.body.verification.outcome, "not-found");

    // An outage changes nothing: a verified item stays verified.
    env.DB.raw.prepare("UPDATE profile_items SET verified = 1 WHERE id = ?").run(item.id);
    rewind();
    mockFetch(() => { throw new TypeError("network down"); });
    res = await call(env, "POST", `/v1/me/items/${item.id}/verify`, { as: ME });
    assert.equal(res.status, 200);
    assert.equal(res.body.verification.outcome, "error");
    assert.equal(res.body.item.verified, true);

    const history = await call(env, "GET", `/v1/me/items/${item.id}/verifications`, { as: ME });
    assert.deepEqual(history.body.items.map((v) => v.outcome), ["error", "not-found", "name-mismatch"]);

    // No DOI, nothing to check.
    const bare = await call(env, "POST", "/v1/me/items", { as: ME, body: { kind: "award", title: "Prize" } });
    assert.equal((await call(env, "POST", `/v1/me/items/${bare.body.id}/verify`, { as: ME })).status, 400);
  } finally { restore(); }
});

test("ORCID: 503 until configured; start signs a state; callback links and verifies", async () => {
  const off = makeEnv();
  assert.deepEqual((await call(off, "GET", "/v1/orcid/status")).body, { enabled: false });
  const closed = await call(off, "GET", "/v1/orcid/start", { as: ME });
  assert.equal(closed.status, 503);
  assert.equal(closed.body.error, "ORCID linking is not set up yet.");
  assert.equal((await call(off, "GET", "/v1/orcid/callback?code=x&state=y")).status, 503);

  const env = makeEnv({ ORCID_CLIENT_ID: "APP-TEST", ORCID_CLIENT_SECRET: "shh", SITE_ORIGIN: "http://localhost:8125" });
  await call(env, "PATCH", "/v1/me", { as: ME, body: { handle: "jose" } });
  await call(env, "PATCH", "/v1/me", { as: OTHER, body: { handle: "ann" } });
  assert.equal((await call(env, "GET", "/v1/orcid/start")).status, 401);
  const start = await call(env, "GET", "/v1/orcid/start", { as: ME });
  const auth = new URL(start.body.url);
  assert.equal(auth.origin + auth.pathname, "https://orcid.org/oauth/authorize");
  assert.equal(auth.searchParams.get("scope"), "/authenticate");
  assert.equal(auth.searchParams.get("redirect_uri"), "http://localhost:8790/v1/orcid/callback");
  const state = auth.searchParams.get("state");

  const seen = mockFetch(() => jsonRes({ orcid: "0000-0002-1825-0097", name: "José", access_token: "t" }));
  try {
    const bad = await call(env, "GET", `/v1/orcid/callback?code=abc&state=${encodeURIComponent(state)}x`);
    assert.equal(bad.status, 302);
    assert.match(bad.headers.get("location"), /#\/settings\?orcid=expired$/);
    assert.equal(seen.length, 0, "a forged state never reaches ORCID");

    const ok = await call(env, "GET", `/v1/orcid/callback?code=abc&state=${encodeURIComponent(state)}`);
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get("location"), "http://localhost:8125/social/#/settings?orcid=linked");
    assert.equal(seen[0].url, "https://orcid.org/oauth/token");
    assert.match(String(seen[0].init.body), /grant_type=authorization_code/);
    const me = (await call(env, "GET", "/v1/users/jose")).body.user;
    assert.equal(me.orcid, "0000-0002-1825-0097");
    assert.equal(me.orcid_verified, true);

    // The same iD cannot be verified on a second account.
    const other = new URL((await call(env, "GET", "/v1/orcid/start", { as: OTHER })).body.url).searchParams.get("state");
    const taken = await call(env, "GET", `/v1/orcid/callback?code=abc&state=${encodeURIComponent(other)}`);
    assert.match(taken.headers.get("location"), /orcid=taken$/);
    assert.equal((await call(env, "GET", "/v1/users/ann")).body.user.orcid_verified, false);

    // Saying no at ORCID comes back as "cancelled".
    const no = await call(env, "GET", "/v1/orcid/callback?error=access_denied");
    assert.match(no.headers.get("location"), /orcid=cancelled$/);
  } finally { restore(); }
});
