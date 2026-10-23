// node social/js/atlas-host.test.mjs -- what Atlas answers on the GeoID Network.
import assert from "node:assert/strict";
import { answerFor, rankSections, nextSteps } from "./atlas-host.js";

const member = { signedIn: true, unreadMessages: 2, unreadNotifications: 0, headline: true, interests: 3, studyAreas: 1, communities: 1, section: "Feed" };

assert.equal(rankSections("where are the reviews?")[0].name, "Peer review");
assert.equal(rankSections("open the map")[0].name, "Map");
assert.equal(rankSections("any phd positions?")[0].name, "Opportunities");
assert.equal(rankSections("change my profile picture")[0].name, "Settings");
assert.deepEqual(rankSections("the airspeed of an unladen swallow"), [], "no confident wrong answer");

const next = answerFor("what should I do next?", member);
assert.match(next.text, /2 unread messages/);
assert.equal(next.go[0][1], "#/messages");
assert.equal(nextSteps({ signedIn: false })[0].go, "signin");
assert.equal(nextSteps({ signedIn: true })[0].go, "#/settings", "a bare profile comes first when nothing is unread");

const who = answerFor("who works on landslides?", member);
assert.equal(who.go[0][1], "#/people?interest=landslides");
assert.equal(answerFor("mentors in seismology", member).go[0][1], "#/people?interest=seismology&mentor=1");
assert.equal(answerFor("people near Etna", member).go[0][1], "#/people?interest=etna");

const s = answerFor("search InSAR", member);
assert.equal(s.go[0][1], "#/search?q=insar");
assert.equal(s.auto, true);
assert.equal(answerFor("open the map", member).auto, true);
assert.equal(answerFor("where are the reviews", member).auto, false);

// Hazard requests are Atlas's own, not the Network's.
assert.equal(answerFor("model a small ashfall from Etna at 4pm today", member), null);
assert.equal(answerFor("help", member).go[0][1], "ask:what should I do next?");
assert.equal(new Set(answerFor("what next", { signedIn: true }).go.map((g) => g[1])).size, answerFor("what next", { signedIn: true }).go.length, "no duplicate buttons");
console.log("atlas-host: ok");
