/**
 * Checks for membership.js -- the one place a gate is asked.
 *
 *     node GeoID_GIS/viewer/gis/membership.test.mjs
 *
 * The rules that matter here are the ones that fail SILENTLY and in the worst
 * direction: a gate that closes when nothing is configured locks the app
 * against everybody, and a gate that opens on an expired or forged token is not
 * a gate. Both are pinned, in both directions.
 */
import { readFileSync } from "node:fs";

const storage = new Map();
const events = [];
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
};
globalThis.document = {
  querySelector: () => null,
  dispatchEvent: (e) => { events.push(e); return true; },
};
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.location = { href: "https://geoidinitiative.com/geohub/" };

import * as m from "./membership.js";

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

/**
 * A token in the shape the Worker issues. Unsigned: the browser never checks.
 *
 * `Buffer.from(string)` is UTF-8, which is what the service's own TextEncoder
 * produces — so a name outside ASCII is encoded here exactly as it is there,
 * and the decode is tested rather than sidestepped.
 */
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const tokenFor = (payload) => `${b64({ alg: "HS256" })}.${b64(payload)}.signature`;
const inHours = (h) => Math.floor(Date.now() / 1000) + h * 3600;

const reset = () => { storage.clear(); m.signOut(); m.configure(null); };

// ── 1. Unconfigured is OPEN, and that is the whole safety of shipping this ──

reset();
check("nothing is enforced with no service configured", m.enforcing() === false);
check("models are open when unconfigured", m.may("models") === true);
check("saving is open when unconfigured", m.may("save") === true);
eq("...and the state says so", m.state().enforcing, false);

m.configure("https://auth.geoidinitiative.com/");
check("configuring turns enforcement on", m.enforcing() === true);
eq("a trailing slash is trimmed", m.authService(), "https://auth.geoidinitiative.com");
check("models are gated once configured", m.may("models") === false);
check("saving is gated once configured", m.may("save") === false);

// A capability nobody declared is not a gate. Failing closed on a typo would
// lock a feature for everybody with nothing on screen to say why.
check("an undeclared feature is open", m.may("nonesuch") === true);

// ── 2. A token is read for display, and expiry is the only thing enforced ──

reset();
m.configure("https://auth.geoidinitiative.com");

m.accept(tokenFor({ email: "r@example.org", name: "Rae", member: true, exp: inHours(24) }));
eq("a member's state", m.state(), {
  signedIn: true, member: true, owner: false, plan: "member",
  name: "Rae", email: "r@example.org",
  until: m.state().until, enforcing: true,
});
check("a member may use the models", m.may("models") === true);
check("a member may save", m.may("save") === true);
check("the token is available to a request that must carry it", m.bearer().length > 0);

// Signed in and NOT a member: greeted by name, still gated. The two are
// separate so an explorer can be told what membership would add.
m.accept(tokenFor({ email: "e@example.org", name: "Ex", member: false, exp: inHours(24) }));
eq("an explorer is signed in", m.state().signedIn, true);
eq("...and is not a member", m.state().member, false);
check("an explorer is refused the models", m.may("models") === false);
check("the refusal names the membership rather than the sign-in",
  /does not include them yet/.test(m.refusal("models")), m.refusal("models"));
// Each feature carries its own sentence rather than having its title
// templated into one: a template gives "Modelled risk maps IS part of
// membership", which is what this check exists to keep out.
for (const [id, f] of Object.entries(m.FEATURES)) {
  check(`${id} states both of its own refusals`,
    /^[A-Z].*\.$/.test(f.signIn) && /^[A-Z].*\.$/.test(f.notYours),
    `${f.signIn} | ${f.notYours}`);
  check(`${id} says something in both`, f.signIn !== f.notYours, f.signIn);
}

// ── 3. Expired, malformed and absent all mean signed out ───────────────────

reset();
m.configure("https://auth.geoidinitiative.com");

m.accept(tokenFor({ email: "old@example.org", member: true, exp: inHours(-1) }));
eq("an expired token does not sign anybody in", m.state().signedIn, false);
check("...and is not kept", storage.size === 0, `${storage.size} stored`);
check("an expired member may not use the models", m.may("models") === false);

// A token with no expiry is treated as expired: a bearer token that never runs
// out is one a revoked member keeps for ever.
m.accept(tokenFor({ email: "forever@example.org", member: true }));
eq("a token with no expiry is refused", m.state().signedIn, false);

eq("a malformed token is refused", m.accept("not-a-token").signedIn, false);
eq("an empty token is refused", m.accept("").signedIn, false);
check("readClaims answers null rather than throwing", m.readClaims("a.b") === null);

// ── 4. A stored token is picked up on the next load, and expiry still wins ─

reset();
m.configure("https://auth.geoidinitiative.com");
// What the sign-in page's handoff does, and what another tab's sign-in looks
// like from here: the token appears in storage without this module writing it.
storage.set("geoid:membership", tokenFor({ email: "r@example.org", member: true, exp: inHours(5) }));
eq("a token written from outside is invisible until something says so",
  m.state().member, false);
eq("refresh() reads it", m.refresh().member, true);

m.signOut();
eq("signing out forgets it", m.state().signedIn, false);
check("...from storage too", storage.size === 0, `${storage.size} stored`);

// ── 5. Every change announces, so a gate drawn anywhere can follow it ──────

reset();
m.configure("https://auth.geoidinitiative.com");
const seen = [];
const off = m.onChange((s) => seen.push(s.member));
m.accept(tokenFor({ email: "r@example.org", member: true, exp: inHours(2) }));
m.signOut();
off();
m.accept(tokenFor({ email: "r@example.org", member: true, exp: inHours(2) }));
eq("listeners hear a sign-in and a sign-out", seen, [true, false]);
check("...and unsubscribing stops them", seen.length === 2);
check("the document hears it too", events.some((e) => e.type === "geoid:membership"));

// ── 6. What membership unlocks, stated once ───────────────────────────────

check("the modelled maps are the hazard models",
  m.MEMBER_MODELS.length === 10, m.MEMBER_MODELS.join(", "));
for (const id of ["cyclone-risk", "seismic-risk", "volcanic-risk", "landslide-forecast",
                  "flood-inundation", "sea-level"]) {
  check(`${id} is behind membership`, m.isMemberModel(id) === true);
}
// Somebody else's published product is theirs to give away, and the shape of
// the ground is exploring. Both stay open.
for (const id of ["soil-thickness", "worldpop", "climate-temperature",
                  "dem-elevation", "dem-slope", "dem-hillshade"]) {
  check(`${id} is NOT behind membership`, m.isMemberModel(id) === false);
}

check("the sign-in url carries where to come back to",
  m.signInUrl("https://geoidinitiative.com/geohub/")
    === "/sign-in/?return=https%3A%2F%2Fgeoidinitiative.com%2Fgeohub%2F",
  m.signInUrl("https://geoidinitiative.com/geohub/"));

// The models gate is enforceable and the save gate is not, and the module says
// which is which rather than letting a caller assume.
eq("the models gate is enforced at the bucket", m.FEATURES.models.enforced, true);
eq("the save gate is a courtesy and says so", m.FEATURES.save.enforced, false);

// ── 7. A name outside ASCII survives the decode ────────────────────────────

// The service signs with TextEncoder, so a payload is UTF-8 bytes base64'd.
// The deprecated `decodeURIComponent(escape(...))` pair this used to use throws
// on some of them, and a thrown decode reads as "not signed in" — a member
// whose name has an accent in it silently could not sign in.
reset();
m.configure("https://auth.geoidinitiative.com");
m.accept(tokenFor({ email: "rae@example.org", name: "Rae Ó Súilleabháin", member: true, exp: inHours(24) }));
eq("a name outside ASCII signs in", m.state().member, true);
eq("...with its name intact", m.state().name, "Rae Ó Súilleabháin");
m.accept(tokenFor({ email: "李@example.org", name: "李雷", member: true, exp: inHours(24) }));
eq("a name outside Latin-1 signs in too", m.state().name, "李雷");

// The fault this replaced a check for was a TEMPLATE: `${f.title} is part of
// membership` reads "Modelled risk maps IS". Checking the sentences for it
// caught a hand-written one that happens to read the same way, so the rule is
// pinned where it belongs — on the function, which must not build a sentence
// out of a title at all.
{
  const src = readFileSync(new URL("./membership.js", import.meta.url), "utf8");
  const body = (src.match(/export function refusal\(feature\) \{([\s\S]*?)\n\}/) || [])[1] || "";
  check("refusal() reads a sentence rather than building one",
    !/\.title/.test(body) && /notYours|signIn/.test(body), body.trim());
}

// ── 8. The master account ──────────────────────────────────────────────────

// `plan: "owner"` is for the people who build this, so the site can be worked
// on with every gate ON — exactly as a visitor sees it — rather than only with
// membership switched off. It opens every feature INCLUDING ONES ADDED LATER,
// which is the whole reason it is a flag and not a list.
reset();
m.configure("https://auth.geoidinitiative.com");
m.accept(tokenFor({ email: "owner@geoidinitiative.com", name: "Owner",
                    member: true, plan: "owner", exp: inHours(24) }));
eq("an owner is an owner", m.state().owner, true);
eq("...and a member too, so nothing tests for both", m.state().member, true);
for (const id of Object.keys(m.FEATURES)) {
  check(`an owner may use ${id}`, m.may(id) === true);
}
check("an owner may use a feature invented after this line",
  m.may("something-added-next-year") === true);

// An ordinary member is not an owner, and the account page must be able to
// tell them apart to say which it is showing.
m.accept(tokenFor({ email: "r@example.org", member: true, exp: inHours(24) }));
eq("a member is not an owner", m.state().owner, false);
eq("...and its plan says member", m.state().plan, "member");
m.accept(tokenFor({ email: "e@example.org", member: false, exp: inHours(24) }));
eq("an explorer's plan says explorer", m.state().plan, "explorer");

console.log(`\n${failures ? `${failures} failed` : "all passed"}`);
process.on("exit", () => { process.exitCode = failures ? 1 : 0; });
