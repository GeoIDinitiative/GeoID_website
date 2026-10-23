/**
 * GeoID Network in the viewer: the decisions that go wrong without a sound.
 *
 *     node GeoID_GIS/viewer/gis/social-core.test.mjs
 *
 * What each block pins, and why it is pinned rather than eyeballed:
 *  - the BASE URL: a stored override honoured on the live site would be a way
 *    to send somebody's bearer token to another server;
 *  - the MAP REQUEST: a wrong bbox or zoom is an empty layer that reads as a
 *    quiet community, and a west-positive world has to flip its box;
 *  - CLUSTER/POINT MARKERS: hidden or 0,0 points must never be drawn, and the
 *    provenance label must never be upgraded;
 *  - DEEP LINKS: only the id alphabet reaches a fetch path;
 *  - the SHARE PAYLOAD: GeoID Network's `scene` shape, east-positive on the wire;
 *  - the SHELL HAND-OFF: the real inline scripts from index.html, transit and a
 *    planet viewer, run in a sandbox, so `?post=` is proved to arrive where the
 *    viewer reads it -- not a copy of the logic that could agree with itself;
 *  - v1.1 PROJECT LINKS: which button a linked project shows is a decision about
 *    roles and versions, and a wrong one either offers a push the Worker will
 *    refuse or hides an update somebody needs;
 *  - v1.1 SHARE HAND-OFF and MODELS: destinations a reader may post into, https
 *    repo links, a model's settings under 32 KB and round-tripping a west-positive
 *    world, and a model page that takes a bare `?post=` to the right world.
 */

import {
  socialBase, DEFAULT_SOCIAL_BASE, wrap180, toEastLon, toViewerLon, zoomForSpan, viewRequest,
  mapUrl, mapToFeatures, featuresKey, provenanceLabel, readDeepLink, worldUrl, cameraFromScene,
  layersToEnable, annotationsToFeatures, bannerText, buildSharePayload, buildWorkspacePayload,
  headingPitch, describePlaces, socialHref, validId,
  buildWorkspaceManifest, readSocialLink, makeSocialLink, remoteVersion, linkState, linkTag, canPush,
  publishProjectBody, pushVersionBody, sharedRows, shareDestinations, destinationKey, parseDestination,
  repoMeta, repoPrefill, buildShareHandoff, modelPagePath, postWorld, convertLons, modelConfigFromState,
  capModelConfig, buildModelMeta, modelSettingsFromConfig, boxRing, describeModel, jsonBytes, kindLabel,
  MAX_WORKSPACE_BYTES, MAX_MODEL_CONFIG_BYTES,
  interestRequest, interestUrl, interestToFeatures, discRing, discRadiusDeg, separateDiscs, arcDegrees,
  communityLayerName, INTEREST_LAYER_NAME, COMMUNITY_LAYER_NAME, TREND_COLOURS,
} from "./social-core.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

let pass = 0; let fail = 0;
function ok(cond, msg, detail = "") {
  if (cond) pass += 1; else { fail += 1; console.log(`FAIL  ${msg}${detail ? ` — ${detail}` : ""}`); }
}
process.on("exit", () => {
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
});
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ── Base URL ────────────────────────────────────────────────────────────────

ok(socialBase({}) === DEFAULT_SOCIAL_BASE, "no meta, no override: the live service");
ok(socialBase({ meta: "https://social.example.org/" }) === "https://social.example.org", "a page's meta wins, trailing slash dropped");
ok(socialBase({ meta: "http://plain.example.org" }) === DEFAULT_SOCIAL_BASE, "a meta that is not https is ignored");
ok(socialBase({ stored: "http://localhost:8787", hostname: "localhost" }) === "http://localhost:8787", "the override works on localhost");
ok(socialBase({ stored: "http://localhost:8787", hostname: "geoidinitiative.com" }) === DEFAULT_SOCIAL_BASE,
  "the override is IGNORED on the live site");
ok(socialBase({ stored: "javascript:alert(1)", hostname: "localhost" }) === DEFAULT_SOCIAL_BASE, "an override that is not http(s) is ignored");

// ── Longitude ──────────────────────────────────────────────────────────────

ok(wrap180(190) === -170 && wrap180(-190) === 170 && wrap180(-180) === 180 && wrap180(360) === 0, "wrap180");
ok(toEastLon(250, false) === -110, "east world: 0-360 to -180..180");
ok(toEastLon(30, true) === -30 && toViewerLon(-30, true) === 30, "west world: negated both ways");
ok([0, 45, -120, 179.5].every((l) => near(toEastLon(toViewerLon(l, true), true), l)), "west round trip");

// ── The map request ────────────────────────────────────────────────────────

ok(zoomForSpan(360) === 3 && zoomForSpan(10) >= 8 && zoomForSpan(0.01) === 16, "zoom grows as the view shrinks, clamped",
  `${zoomForSpan(360)} ${zoomForSpan(10)} ${zoomForSpan(0.01)}`);
ok(zoomForSpan(NaN) === 2 && zoomForSpan(0) === 2, "a degenerate span asks coarse");
// The cell the service grids at, 360/2^z, is about a twelfth of the view.
const cell = 360 / 2 ** zoomForSpan(20);
ok(cell <= 20 / 6 && cell >= 20 / 24, "about a dozen cells across the view", String(cell));

const alps = { minLon: 5, maxLon: 15, minLat: 43, maxLat: 48 };
ok(viewRequest(alps).bbox === "5,43,15,48", "w,s,e,n in east longitude", viewRequest(alps).bbox);
ok(viewRequest(null).bbox === "-180,-90,180,90" && viewRequest(null).z === 2, "no view: the world, coarse");
const westBox = { minLon: 20, maxLon: 40, minLat: -10, maxLat: 10 };
ok(viewRequest(westBox, { west: true }).bbox === "-40,-10,-20,10", "a west-positive box flips", viewRequest(westBox, { west: true }).bbox);
const whole = { minLon: -180, maxLon: 180, minLat: -85, maxLat: 85 };
ok(viewRequest(whole, { west: true }).bbox === "-180,-85,180,85", "a whole-planet box stays whole on a west world");
const url = new URL(mapUrl("https://s.example/", { world: "mars", bbox: "1,2,3,4", z: 5 }));
ok(url.pathname === "/v1/map" && url.searchParams.get("world") === "mars" && url.searchParams.get("bbox") === "1,2,3,4"
  && url.searchParams.get("z") === "5" && !url.searchParams.has("layer"), "map url", url.toString());

// ── Markers ────────────────────────────────────────────────────────────────

const answer = {
  clusters: [
    { lat: 10, lon: 20, count: 37, kinds: { observation: 30, paper: 5, scene: 2 } },
    { lat: 0, lon: 0, count: 0, kinds: {} },
  ],
  points: [
    { id: "p_abc", kind: "observation", title: "Fresh lava", lat: 37.75, lon: 15.0, precision: "approx",
      provenance: "observed", verification: { status: "community-verified" }, author: { handle: "rae" } },
    { id: "p_ai", kind: "analysis", title: "", lat: 1, lon: -170, provenance: "ai", author: "@bo" },
    { id: "p_nope", kind: "text", title: "No place", lat: null, lon: null },
    { id: "../../v1/me", kind: "text", title: "Bad id", lat: 1, lon: 1 },
    { id: "pr_1", kind: "project", title: "Etna deformation", lat: 37.7, lon: 15, provenance: null },
  ],
};
const fc = mapToFeatures(answer);
const pts = fc.features.filter((f) => f.properties.social_type === "point");
const cls = fc.features.filter((f) => f.properties.social_type === "cluster");
ok(pts.length === 3, "points with no coordinate or a bad id are dropped", String(pts.length));
ok(cls.length === 1 && cls[0].properties.count === 37, "an empty cluster is not drawn");
ok(cls[0].properties.kinds === "30 observations, 5 papers, 2 shared scenes", "a cluster names its commonest kinds", cls[0].properties.kinds);
const lava = pts.find((f) => f.properties.social_id === "p_abc");
ok(lava.properties.provenance === "Observed · community-verified" && lava.properties.author === "@rae"
  && lava.properties.social_url === "/social/#/post/p_abc" && lava.properties.kind_label === "Observation",
  "a post carries its label, author and link", JSON.stringify(lava.properties));
ok(pts.find((f) => f.properties.social_id === "p_ai").properties.provenance === "AI-generated", "AI says so");
ok(pts.find((f) => f.properties.social_id === "p_ai").properties.name === "Analysis", "an untitled post is named by its kind");
ok(pts.find((f) => f.properties.social_id === "pr_1").properties.provenance === "Unverified", "no provenance reads as unverified");
ok(pts.find((f) => f.properties.social_id === "pr_1").properties.social_url === "/social/#/p/pr_1", "a project links to its project page");
ok(provenanceLabel("made-up") === "Unverified" && provenanceLabel("observed", "disputed") === "Observed · disputed", "provenance words");
const westFc = mapToFeatures({ points: [answer.points[0]] }, { west: true });
ok(westFc.features[0].geometry.coordinates[0] === -15, "a west-positive world gets the negated longitude");
ok(mapToFeatures(null).features.length === 0 && mapToFeatures({}).features.length === 0, "no answer, no markers");
ok(featuresKey(fc) === featuresKey(mapToFeatures(answer)) && featuresKey(fc) !== featuresKey(westFc), "the redraw key is stable and discriminating");

// ── Deep links ─────────────────────────────────────────────────────────────

ok(JSON.stringify(readDeepLink("?world=mars&post=p_abc")) === JSON.stringify({ post: "p_abc", project: null }), "post read");
ok(readDeepLink("?project=pr_9").project === "pr_9", "project read");
ok(readDeepLink("?post=../../v1/me").post === null && readDeepLink("?post=").post === null
  && readDeepLink("?post=" + "a".repeat(65)).post === null, "a malformed id is as good as absent");
ok(validId("p_abc-1") && !validId("a b") && !validId(""), "the id alphabet");
ok(worldUrl("mars", { post: "p1" }) === "/?world=mars&post=p1", "a world link");
ok(worldUrl("earth", { project: "pr1" }) === "/?project=pr1", "Earth takes no world parameter");
ok(worldUrl("io", { post: "p1" }) === "/?post=p1", "a world this app lacks lands on the shell, not nowhere");
ok(socialHref("text", "bad id") === "/social/", "a bad id never reaches a link");

const scene = {
  world: "mercury",
  camera: { lat: 10, lon: -30, alt: 250000, heading: 15, pitch: -60 },
  layers: [
    { id: "ne-coast", name: "Coastlines", visible: true, opacity: 0.5 },
    { id: "session:4", name: "my-upload", visible: true },
    { id: 12, name: "Rivers", visible: true },
    { id: "x", name: "Hidden one", visible: false },
  ],
  annotations: [{ lat: 1, lon: 2, text: "here" }, { lat: 1, lon: 2, text: "" }, { lat: 99, lon: 0, text: "bad" }],
};
const cam = cameraFromScene(scene, { west: true });
ok(cam.lat === 10 && cam.lon === 30 && cam.alt === 250000 && cam.pitch === -60, "camera in the viewer's convention", JSON.stringify(cam));
ok(cameraFromScene({ camera: { lat: 100, lon: 0 } }) === null && cameraFromScene({}) === null, "no usable camera is null");
const avail = [{ id: "ne-coast", name: "Coastlines", kind: "dataset" }, { id: "ne-rivers", name: "Rivers", kind: "dataset" }];
const { found, missing } = layersToEnable(scene.layers, avail);
ok(found.map((f) => f.id).join() === "ne-coast,ne-rivers" && found[0].opacity === 0.5, "matched by catalogue id, then by name", JSON.stringify(found));
ok(missing.length === 1 && missing[0] === "my-upload", "a session-only layer is reported missing, a hidden one ignored", JSON.stringify(missing));
const ann = annotationsToFeatures(scene.annotations, { west: true });
ok(ann.features.length === 1 && ann.features[0].geometry.coordinates[0] === -2
  && ann.features[0].properties.label_rank === 5, "annotations become labelled points");
ok(bannerText({ author: { handle: "rae" } }) === "Viewing a shared scene by @rae" && bannerText({}) === "Viewing a shared scene by @someone", "banner");

// ── Share payloads ─────────────────────────────────────────────────────────

const share = buildSharePayload({
  world: "mercury", focus: { lat: 12.345678, lon: 30 }, alt: 123456.7, heading: 10, pitch: -45,
  layers: [{ id: 3, name: "Coastlines", catalogueId: "ne-coast", opacity: 0.4, source: "NE", visible: true },
    { id: 7, name: "upload.csv", visible: false }],
  annotations: [{ lat: 1, lon: 5, text: "vent" }], time: 1792000000.9, west: true,
});
ok(share.world === "mercury" && share.camera.lat === 12.34568 && share.camera.lon === -30 && share.camera.alt === 123457,
  "camera east-positive and rounded", JSON.stringify(share.camera));
ok(share.layers[0].id === "ne-coast" && share.layers[1].id === "session:7" && share.layers[1].visible === false,
  "layers carry the catalogue id where there is one");
ok(share.annotations[0].lon === -5 && share.time === 1792000000, "annotations east-positive; time whole seconds");
ok(["world", "camera", "layers", "annotations", "time"].every((k) => k in share)
  && ["lat", "lon", "alt", "heading", "pitch"].every((k) => k in share.camera), "GeoID Network's scene shape");
ok(buildSharePayload({ focus: null }).camera === null, "no ground in view, no camera");
const ws = buildWorkspacePayload({ title: "", world: "mars", manifest: { layers: [] } });
ok(ws.title === "Untitled GeoHUB project" && ws.world === "mars" && Array.isArray(ws.manifest.layers), "workspace payload");

// ── Camera attitude ────────────────────────────────────────────────────────

// Straight down over the equator at the viewer's lon 0 (−X): pitch −90.
let hp = headingPitch([-5, 0, 0], [1, 0, 0]);
ok(near(hp.pitch, -90, 1e-9), "looking straight down is pitch −90", JSON.stringify(hp));
// Looking north along the surface.
hp = headingPitch([-5, 0, 0], [0, 1, 0]);
ok(near(hp.pitch, 0, 1e-9) && near(hp.heading, 0, 1e-9), "level and north is heading 0", JSON.stringify(hp));
// East is the direction the viewer's longitude grows: lon 90 is +Z.
hp = headingPitch([-5, 0, 0], [0, 0, 1]);
ok(near(hp.heading, 90, 1e-9), "east is heading 90", JSON.stringify(hp));
hp = headingPitch([-5, 0, 0], [0, -1, -1]);
ok(near(hp.heading, 225, 1e-9) || near(hp.heading, 180 + 45, 1e-9), "south-west-ish is 225", JSON.stringify(hp));

// ── Atlas ──────────────────────────────────────────────────────────────────

const said = describePlaces({ posts: [{ id: "p1", kind: "observation", title: "Ash", provenance: "observed", author: { handle: "rae" } }],
  projects: [{ id: "pr1", title: "Etna" }] });
ok(/Ash/.test(said.text) && /@rae/.test(said.text) && /unverified unless marked/.test(said.text) && said.items.length === 2,
  "Atlas lists what is near, and says what it is", said.text);
ok(/No public community posts/.test(describePlaces({}).text), "nothing near is said plainly");

// ── The shell hand-off, with the real inline scripts ───────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const inline = (html, marker) => {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) if (m[1].includes(marker)) return m[1];
  return null;
};

function runShell(search) {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const code = inline(html, "A SHARED THING") || inline(html, 'frame.src = "/transit/?destination="');
  const frame = {
    src: "/GeoID_GIS/viewer/?v=gis-20261018-a533d54",
    getAttribute(name) { return name === "src" ? this.src : null; },
  };
  const sandbox = {
    window: { location: { search } },
    document: { getElementById: (id) => (id === "globe-iframe" ? frame : null) },
    URLSearchParams,
    encodeURIComponent,
  };
  vm.runInNewContext(code, sandbox);
  return frame.src;
}
ok(Boolean(inline(readFileSync(join(root, "index.html"), "utf8"), 'frame.src = "/transit/?destination="')), "the shell's routing script is found");
ok(runShell("?world=mars&post=p_abc") === "/transit/?destination=mars&post=p_abc", "a planet: the post rides onto the transit", runShell("?world=mars&post=p_abc"));
ok(runShell("?post=p_abc") === "/GeoID_GIS/viewer/?v=gis-20261018-a533d54&post=p_abc", "Earth: the post rides onto the viewer", runShell("?post=p_abc"));
ok(runShell("?world=earth&project=pr_1") === "/GeoID_GIS/viewer/?v=gis-20261018-a533d54&project=pr_1", "world=earth is Earth");
ok(runShell("?world=mars&post=a%20b&evil=1") === "/transit/?destination=mars", "a malformed id and other params are not carried", runShell("?world=mars&post=a%20b&evil=1"));
ok(runShell("") === "/GeoID_GIS/viewer/?v=gis-20261018-a533d54", "nothing asked, nothing changed");

// Transit: its top-level bounce, and the viewer address it builds.
const transit = readFileSync(join(root, "transit", "index.html"), "utf8");
const bounce = inline(transit, "window.self !== window.top");
function runBounce(code, search) {
  let replaced = null;
  const win = { location: { search, hash: "", replace: (to) => { replaced = to; } } };
  win.self = win; win.top = win;
  vm.runInNewContext(code, { window: win, URLSearchParams, encodeURIComponent });
  return replaced;
}
ok(runBounce(bounce, "?destination=mars&post=p_abc") === "/?world=mars&post=p_abc", "a top-level transit keeps the post", runBounce(bounce, "?destination=mars&post=p_abc"));
ok(/\+ "transit=1" \+ carried/.test(transit) && /\["post", "project"\]/.test(transit), "the transit appends the carried params to the viewer it frames");
// Evaluate the transit's own carried-params expression against a search string.
const carriedExpr = transit.match(/const carried = (\[[\s\S]*?\.join\(""\));/);
ok(Boolean(carriedExpr), "the transit's carried expression is found");
if (carriedExpr) {
  const out = vm.runInNewContext(`const params = new URLSearchParams(search); ${carriedExpr[1]}`,
    { URLSearchParams, encodeURIComponent, search: "?destination=pluto&project=pr_9&post=bad%20id" });
  ok(out === "&project=pr_9", "the transit carries only well-formed ids", out);
}

// A planet viewer opened top-level bounces into the shell with the post.
const mars = readFileSync(join(root, "planet_explorer", "mars", "viewer", "index.html"), "utf8");
const marsBounce = inline(mars, 'window.location.replace("/?world=mars"');
ok(Boolean(marsBounce), "the Mars viewer's bounce is found");
if (marsBounce) {
  ok(runBounce(marsBounce, "?post=p_abc") === "/?world=mars&post=p_abc", "Mars standalone keeps the post", runBounce(marsBounce, "?post=p_abc"));
  ok(runBounce(marsBounce, "") === "/?world=mars", "Mars standalone with nothing to carry is unchanged");
}


// ── v1.1: saved projects linked to Social ──────────────────────────────────

const link = readSocialLink({ social: { project_id: "pr_abc", version: "3", role: "Editor", linked_at: "x" } });
ok(link && link.project_id === "pr_abc" && link.version === 3 && link.role === "editor", "a stored link is read and normalised", JSON.stringify(link));
ok(readSocialLink({ social: { project_id: "../v1/me", version: 1 } }) === null, "a link whose id is not an id is no link");
ok(readSocialLink({}) === null && readSocialLink(null) === null && readSocialLink({ social: null }) === null, "no social entry, no link");
ok(readSocialLink({ social: { project_id: "pr_1", role: "admin" } }).role === "viewer", "an unknown role reads as the least, never as permission");
const made = makeSocialLink({ project_id: "pr_9", version: 1, role: "owner" }, new Date("2026-10-23T00:00:00Z"));
ok(JSON.stringify(Object.keys(made)) === JSON.stringify(["project_id", "version", "role", "linked_at"]) && made.linked_at === "2026-10-23T00:00:00.000Z",
  "the metadata shape is exactly {project_id, version, role, linked_at}", JSON.stringify(made));
let threw = false;
try { makeSocialLink({ project_id: "a b" }); } catch (_e) { threw = true; }
ok(threw, "a link is never made for a malformed id");

ok(remoteVersion({ project: { current_version: 5 }, versions: [{ version: 2 }] }) === 5, "current_version on the project wins");
ok(remoteVersion({ current_version: 4 }) === 4, "current_version beside the project");
ok(remoteVersion({ project: {}, versions: [{ version: 2 }, { version: 7 }, { version: 3 }] }) === 7, "else the highest listed version");
ok(remoteVersion({ project: {} }) === 0, "no versions is 0, not unknown");

let st = linkState(null);
ok(!st.linked && !st.canPush && !st.behind, "unlinked: nothing to push or pull");
st = linkState({ project_id: "pr_1", version: 2, role: "owner" }, { project: { current_version: 2 }, access: { role: "owner" } });
ok(st.linked && st.canPush && !st.behind && st.remote === 2, "owner, up to date: push, no update", JSON.stringify(st));
st = linkState({ project_id: "pr_1", version: 2, role: "editor" }, { project: { current_version: 5 }, access: { role: "editor" } });
ok(st.canPush && st.behind && st.remote === 5, "editor, behind: push and Update (v5)", JSON.stringify(st));
st = linkState({ project_id: "pr_1", version: 1, role: "editor" }, { project: { current_version: 3 }, access: { role: "viewer" } });
ok(!st.canPush && st.behind && st.role === "viewer" && st.roleChanged && /only the owner or an editor/.test(st.why),
  "the SERVER's role wins: a lowered grant hides Push and says why", JSON.stringify(st));
st = linkState({ project_id: "pr_1", version: 6, role: "owner" }, { project: { current_version: 5 } });
ok(!st.behind, "a local version ahead of the server is not an update to pull");
st = linkState({ project_id: "pr_1", version: 1, role: "commenter" });
ok(!st.canPush && st.remote === null && !st.behind, "not yet checked: the stored role decides, nothing claimed about versions");
ok(["owner", "editor"].every(canPush) && !["forker", "commenter", "viewer", "public", "", "admin"].some(canPush), "only owner and editor push");
ok(linkTag({ version: 3, role: "editor" }) === "Social v3 · editor" && linkTag(null) === "", "the row tag");

const v11share = buildSharePayload({ world: "mars", focus: { lat: 1, lon: 2 }, alt: 1000, layers: [{ name: "MOLA", catalogueId: "mola" }] });
const manifest = buildWorkspaceManifest({ share: v11share, name: "Jezero" });
ok(manifest.v === 1 && manifest.world === "mars" && manifest.camera.lat === 1 && manifest.layers[0].id === "mola"
  && manifest.project.name === "Jezero" && Array.isArray(manifest.annotations), "the workspace manifest, from the share payload", JSON.stringify(manifest));

let pb = publishProjectBody({ title: "  Etna  ", summary: "ULP", world: "earth", visibility: "team", team_slug: "volc-lab", manifest });
ok(pb.body && pb.body.title === "Etna" && pb.body.visibility === "team" && pb.body.team_slug === "volc-lab" && pb.body.workspace === manifest,
  "publish body carries title, visibility, team and the workspace", JSON.stringify(pb.body));
ok(publishProjectBody({ title: "x", visibility: "team" }).error, "team visibility needs a team");
ok(publishProjectBody({ title: "x", visibility: "followers" }).error, "a post-only visibility is refused for a project");
ok(publishProjectBody({ title: "" }).error, "a title is required");
ok(publishProjectBody({ title: "x", team_slug: "../evil" }).error, "a team slug is checked before it is sent");
ok(publishProjectBody({ title: "x", world: "tatooine" }).body.world === "earth", "an unknown world is sent as Earth");
const huge = { ...manifest, layers: Array.from({ length: 2000 }, (_, i) => ({ id: `l${i}`, name: `Layer number ${i} with a long name` })) };
ok(jsonBytes(huge) > MAX_WORKSPACE_BYTES && /48 KB/.test(publishProjectBody({ title: "x", manifest: huge }).error || ""), "over 48 KB is refused with the reason");
ok(/48 KB/.test(pushVersionBody({ manifest: huge }).error || ""), "a push is held to the same limit");
const pv = pushVersionBody({ manifest, note: "  added DEM " });
ok(pv.body && pv.body.note === "added DEM" && pv.body.manifest === manifest, "push body {manifest, note}");
ok(pushVersionBody({}).error, "nothing to push is said");

const rows = sharedRows({
  shared: [{ id: "pr_a", title: "A", world: "mars", role: "commenter", owner: { handle: "rae" }, current_version: 2 },
    { id: "pr_a", title: "dup" }, { id: "bad id" }],
  mine: [{ id: "pr_m1", title: "Mine saved" }, { id: "pr_m2", title: "Mine elsewhere", world: "moon" }],
  localLinks: [{ project_id: "pr_m1" }, { project_id: "pr_a" }],
});
ok(rows.length === 2 && rows[0].id === "pr_a" && rows[0].saved && rows[0].role === "commenter" && rows[0].owner === "rae"
  && rows[0].version === 2 && rows[0].world === "mars", "shared rows: one per id, saved flagged, role kept", JSON.stringify(rows));
ok(rows[1].id === "pr_m2" && rows[1].source === "mine" && rows[1].role === "owner" && !rows[1].saved,
  "my own projects not on this machine are listed; ones saved here are not", JSON.stringify(rows[1]));
ok(worldUrl("mars", { project: "pr_a" }) === "/?world=mars&project=pr_a" && worldUrl("earth", { project: "pr_a" }) === "/?project=pr_a",
  "Open in GeoHUB is /?world=<w>&project=<id>");

// ── v1.1: where a share goes ───────────────────────────────────────────────

const dests = shareDestinations(
  { teams: [{ slug: "volc-lab", name: "Volcano lab" }, { slug: "bad slug!" }], communities: [{ slug: "insar", name: "InSAR" }] },
  [{ id: "pr_1", title: "Mine", role: "owner" }, { id: "pr_2", title: "Read only", role: "viewer" }, { id: "pr_3", title: "Talk", role: "commenter" }],
);
ok(dests.map(destinationKey).join("|") === "public:|team:volc-lab|community:insar|project:pr_1|project:pr_3",
  "public first, then teams, communities, and projects at commenter or better", dests.map(destinationKey).join("|"));
ok(shareDestinations(null).length === 1, "signed out: the public feed only");
ok(JSON.stringify(parseDestination("team:volc-lab")) === '{"type":"team","id":"volc-lab"}'
  && JSON.stringify(parseDestination("public:")) === '{"type":"public","id":null}'
  && parseDestination("team:../x") === null && parseDestination("evil:1") === null, "a destination key parses back, checked");

ok(repoMeta("https://github.com/geoid/etna-ulp").meta?.host === "github", "a GitHub repo");
ok(repoMeta("https://gitlab.example.edu/g/r").meta?.host === "gitlab" && repoMeta("https://codeberg.org/a/b").meta?.host === "codeberg"
  && repoMeta("https://example.org/r.git").meta?.host === "other", "hosts are named");
ok(/https/.test(repoMeta("http://github.com/a/b").error || "") && repoMeta("not a url").error, "only https, only URLs");
ok(/credentials/.test(repoMeta("https://user:tok@github.com/a/b").error || ""), "a link with a token in it is refused");
ok(repoPrefill({ pinned_resources: ["https://example.org/x", { url: "https://github.com/a/b" }] }) === "https://github.com/a/b",
  "prefill takes a code-host link the project already has");
ok(repoPrefill({ pinned_resources: ["http://github.com/a/b"] }) === "" && repoPrefill(null) === "", "never a plain-http prefill");

let ho = buildShareHandoff({ kind: "scene", target: { type: "team", id: "volc-lab" }, scene: v11share, title: "Jezero delta" });
ok(ho.handoff && ho.handoff.kind === "scene" && ho.handoff.target.type === "team" && ho.handoff.target.id === "volc-lab"
  && ho.handoff.scene === v11share && ho.handoff.title === "Jezero delta", "scene hand-off in the v1.1 shape", JSON.stringify(ho.handoff?.target));
ok(ho.handoff.world === "mars" && ho.handoff.camera === v11share.camera && ho.handoff.layers === v11share.layers,
  "and the scene's fields at the top level, where a pre-v1.1 compose reads them");
ho = buildShareHandoff({ kind: "repo", target: { type: "project", id: "pr_1" }, meta: { url: "https://github.com/a/b" } });
ok(ho.handoff?.meta?.url === "https://github.com/a/b" && ho.handoff.target.id === "pr_1" && !ho.handoff.scene, "repo hand-off");
ok(buildShareHandoff({ kind: "repo", meta: { url: "http://x" } }).error, "repo hand-off refuses http");
ok(buildShareHandoff({ kind: "scene", target: { type: "team", id: "../x" }, scene: v11share }).error, "a malformed destination is refused");
ok(buildShareHandoff({ kind: "model", meta: null }).error, "no model, no model hand-off");
ok(buildShareHandoff({ kind: "nope" }).error, "unknown kind refused");
ok(buildShareHandoff({ kind: "scene", scene: v11share }).handoff.target.type === "public", "no destination is the public feed");

// ── v1.1: models ───────────────────────────────────────────────────────────

ok(modelPagePath("earth") === "/" && modelPagePath("mars") === "/planet_explorer/mars/viewer/" && modelPagePath("nowhere") === "/",
  "the model page by world");
ok(kindLabel("model") === "Model" && kindLabel("repo") === "Repository", "kind labels for v1.1 kinds");
ok(postWorld({ kind: "model", meta: { domain: { world: "Mars" } } }) === "mars" && postWorld({ scene: { world: "moon" } }) === "moon"
  && postWorld({}) === "", "a post's world, whatever its kind");

const pipelineState = {
  kind: "3d",
  bounds: { label: "Etna", bbox: { west: 14.8, south: 37.6, east: 15.2, north: 37.9 }, layerId: null },
  roles: new Map([["7", "surface"], ["8", "ignore"], ["9", "material"]]),
  domain: { type: "solid", depthM: 5000, materials: { solid: { E: 3e10 } } },
  resolution: { mode: "step", stepM: 100 },
  meshSizeM: 200,
  grading: { on: true, coarseM: 0, fineM: 0, slopeRefDeg: 30 },
  sampling: { mode: "variable", baseM: 200, gradeM: null, buffers: [{ id: "b1", shape: "square", lat: 37.75, lon: 15.0, sizeKm: 2 }] },
  atmosphere: { on: true, heightM: 4000 },
  layers: { soil: true, water: false, minSoilM: 0, minWaterM: 1, read: { huge: [1, 2, 3] }, readFor: {} },
  faults: { dipDeg: 60, side: "right", depthM: 2000, byKey: new Map(), custom: [], built: { planes: [1] }, builtFor: {} },
  section: { a: null, b: null, n: 200 },
  flags: { top: 2, base: 3 },
  pointFlagByName: new Map([["CRATER", 21]]),
  pointSizeByName: new Map(),
  sizeFields: [{ id: "f1", type: "ball", lat: 37.75, lon: 15.0, radiusM: 500, sizeM: 50 }],
  meshOptions: { combine: "min", sizeMaxM: undefined },
  customPoints: [{ id: "p1", name: "CRATER", lat: 37.751, lon: 14.994, depthM: 0 }],
  conditions: [{ surface: "base", type: "dirichlet", field: "", value: "0" }],
  surface: { nodes: new Array(10).fill(0) },
  outputs: { stl: "solid ..." },
};
const names = { 7: "Copernicus DEM", 9: "Geology" };
const cfg = modelConfigFromState(pipelineState, { layerNames: names });
ok(!("surface" in cfg) && !("outputs" in cfg) && cfg.layers.read === undefined && cfg.faults.built === undefined,
  "settings only: no surface, no STL, no sampled fields", Object.keys(cfg).join(","));
ok(JSON.stringify(cfg.roles) === JSON.stringify([{ layer: "Copernicus DEM", role: "surface" }, { layer: "Geology", role: "material" }]),
  "roles travel by layer NAME, never the session id; ignored layers are left out", JSON.stringify(cfg.roles));
ok(cfg.pointFlagByName.CRATER === 21 && cfg.area.west === 14.8 && cfg.area.label === "Etna", "maps and the area come across");

// A west-positive world: viewer longitudes out, east-positive on the wire, and back.
const westState = { ...pipelineState, bounds: { label: "Caloris", bbox: { west: 150, south: 20, east: 170, north: 40 } },
  customPoints: [{ name: "P", lat: 30, lon: 160 }], sizeFields: [{ type: "box", west: 155, east: 165, south: 25, north: 35 }] };
const westCfg = modelConfigFromState(westState, { west: true });
ok(westCfg.area.west === -170 && westCfg.area.east === -150 && westCfg.customPoints[0].lon === -160
  && westCfg.sizeFields[0].west === -165 && westCfg.sizeFields[0].east === -155,
  "a west-positive world goes out east-positive, its boxes' edges swapped", JSON.stringify([westCfg.area, westCfg.sizeFields[0]]));
const westBack = modelSettingsFromConfig(westCfg, { west: true });
ok(westBack.area.west === 150 && westBack.area.east === 170 && westBack.patch.customPoints[0].lon === 160
  && westBack.sizeFields[0].west === 155 && westBack.sizeFields[0].east === 165, "and comes back to the viewer's convention", JSON.stringify(westBack.area));
ok(JSON.stringify(convertLons({ a: { lat: 1, lon: 190 } }, { lon: (l) => l - 360, box: (w, e) => [w, e] })) === '{"a":{"lat":1,"lon":-170}}',
  "convertLons walks nested records");

const modelMeta = buildModelMeta({ state: pipelineState, world: "earth", layerNames: names });
ok(modelMeta.meta && modelMeta.meta.mesher === "gmsh" && modelMeta.meta.page === "/" && modelMeta.meta.solver === "gales"
  && JSON.stringify(modelMeta.meta.domain) === '{"world":"earth","bbox":[14.8,37.6,15.2,37.9]}',
  "model meta in the contract's shape", JSON.stringify(modelMeta.meta?.domain));
ok(modelMeta.meta.params.kind === "3d" && modelMeta.meta.params.depth_m === 5000 && modelMeta.meta.params.resolution_m === 100
  && modelMeta.meta.params.atmosphere_m === 4000 && modelMeta.meta.params.points === 1 && modelMeta.meta.params.size_fields === 1,
  "params summarise the settings", JSON.stringify(modelMeta.meta.params));
ok(jsonBytes(modelMeta.meta.config) <= MAX_MODEL_CONFIG_BYTES, "config within 32 KB");
ok(/study area/.test(buildModelMeta({ state: { ...pipelineState, bounds: null } }).error || ""), "no study area, no model — said");
ok(buildModelMeta({ state: pipelineState, world: "mars" }).meta.page === "/planet_explorer/mars/viewer/", "a Mars model opens on Mars");
const handed = buildShareHandoff({ kind: "model", target: { type: "community", id: "insar" }, meta: modelMeta.meta });
ok(handed.handoff?.kind === "model" && handed.handoff.meta === modelMeta.meta, "model hand-off");

const bulky = { ...pipelineState, customPoints: Array.from({ length: 3000 }, (_, i) => ({ name: `pt_${i}`, lat: 37.7, lon: 15, depthM: 0 })) };
const cappedMeta = buildModelMeta({ state: bulky, layerNames: names });
ok(cappedMeta.meta && jsonBytes(cappedMeta.meta.config) <= MAX_MODEL_CONFIG_BYTES && cappedMeta.omitted.includes("customPoints")
  && cappedMeta.meta.config.omitted.includes("customPoints") && cappedMeta.meta.config.sizeFields,
  "over 32 KB: the bulkiest part is dropped first, and the config SAYS so", JSON.stringify(cappedMeta.omitted));
ok(capModelConfig({ blob: "x".repeat(40000) }).error, "a config that cannot be brought under 32 KB is refused");

// Loading: everything checked against the builder's own shapes.
const loaded = modelSettingsFromConfig(modelMeta.meta.config);
ok(loaded.patch.kind === "3d" && loaded.patch.domain.type === "solid" && loaded.patch.domain.depthM === 5000
  && loaded.patch.resolution.mode === "step" && loaded.patch.resolution.stepM === 100 && loaded.flags.top === 2
  && loaded.pointFlagByName.CRATER === 21 && loaded.sizeFields.length === 1 && loaded.roles.length === 2,
  "a shared config loads back into the builder's shape", JSON.stringify(loaded.patch.domain));
const hostile = modelSettingsFromConfig({
  kind: "4d", domain: { type: "plasma", depthM: -5 }, resolution: { mode: "javascript:", stepM: "abc" },
  flags: { top: -1, base: "x", side: 7 }, meshSizeM: Infinity, customPoints: "lots", sizeFields: [1, "a", { type: "point" }],
  area: { west: "a" },
});
ok(hostile.patch.kind === undefined && hostile.patch.domain.type === undefined && hostile.patch.domain.depthM === undefined
  && hostile.patch.resolution.mode === undefined && hostile.patch.meshSizeM === undefined && JSON.stringify(hostile.flags) === '{"side":7}'
  && hostile.patch.customPoints === undefined && hostile.sizeFields.length === 1 && hostile.area === null,
  "anything not in the builder's own shape is left at the builder's default", JSON.stringify(hostile));
ok(modelSettingsFromConfig(null) === null, "no config, nothing to load");

const ring = boxRing({ west: 14.8, south: 37.6, east: 15.2, north: 37.9 });
ok(ring.length === 4 && ring[0].lat === 37.6 && ring[0].lon === 14.8 && ring[2].lat === 37.9 && ring[2].lon === 15.2, "a small box is its four corners");
const big = boxRing({ west: -10, south: 0, east: 10, north: 5 });
ok(big.length > 4 && big.every((p, i) => i === 0 || Math.max(Math.abs(p.lat - big[i - 1].lat), Math.abs(p.lon - big[i - 1].lon)) <= 1 + 1e-9),
  "a big box is subdivided to a degree or less per edge", String(big.length));
const across = boxRing({ west: 170, south: 0, east: -170, north: 1 });
ok(across && Math.max(...across.map((p) => p.lon)) === 190, "a box across the antimeridian is not the long way round");
ok(boxRing({ west: 1 }) === null, "no box, no ring");
ok(/3D block · solid · 5,000 m deep · 100 m sampling · 200 m elements · 4000 m of atmosphere · for GALES · meshed with gmsh/.test(describeModel(modelMeta.meta)),
  "a model described in one line", describeModel(modelMeta.meta));

// The model page takes a bare `?post=` and lands on the right world: Earth's
// is the shell, which frames the viewer that holds the Model Builder; Mars's
// is its standalone viewer, whose real bounce goes to the shell with the post.
const earthOpen = `${modelPagePath("earth")}?post=p_m1`;
ok(runShell(earthOpen.slice(1)) === "/GeoID_GIS/viewer/?v=gis-20261018-a533d54&post=p_m1", "Earth model: <page>?post= reaches the viewer frame", runShell(earthOpen.slice(1)));
if (marsBounce) {
  ok(runBounce(marsBounce, "?post=p_m1") === "/?world=mars&post=p_m1" && runShell("?world=mars&post=p_m1") === "/transit/?destination=mars&post=p_m1",
    "Mars model: <page>?post= bounces into the shell and rides onto the transit");
}

// ── v1.3 STUDY INTEREST on the globe ────────────────────────────────────────
// The discs are the map of PEOPLE: a wrong size is a crowd that is not there,
// an overlap is two places read as one, and a wrong longitude on a
// west-positive world puts Etna's researchers on the far side of the planet.

{
  const r = interestRequest({ minLon: 10, maxLon: 20, minLat: 35, maxLat: 45 });
  ok(r.bbox === "10,35,20,45" && r.z === Math.max(0, zoomForSpan(10) - 4), "interest asks for the same box, four zooms coarser (16x finer grid)", JSON.stringify(r));
  const across = interestRequest({ minLon: 170, maxLon: 190, minLat: -5, maxLat: 5 });
  ok(across.bbox === "-180,-5,180,5", "a box across the antimeridian asks for the whole band, not an empty sliver", across.bbox);
  ok(interestUrl("https://s.example/", { world: "mars", bbox: "1,2,3,4", z: 2, tag: "dunes" })
    === "https://s.example/v1/map/interest?world=mars&bbox=1%2C2%2C3%2C4&z=2&tag=dunes", "interest URL");
  ok(communityLayerName("interest") === INTEREST_LAYER_NAME && communityLayerName("posts") === COMMUNITY_LAYER_NAME
    && INTEREST_LAYER_NAME !== COMMUNITY_LAYER_NAME, "the two modes are two named layers");
}

{
  // Radius: area follows the head count; the busiest nearly fills its cell.
  const big = discRadiusDeg(16, 16, 2); const small = discRadiusDeg(4, 16, 2); const one = discRadiusDeg(1, 16, 2);
  ok(near(big, 0.9) && big > small && small > one && one > 0, "radius grows with researchers and fits the cell", `${big} ${small} ${one}`);
  ok(near((big / 0.9 - 0.3) / 0.7, 1) && near((small / 0.9 - 0.3) / 0.7, 0.5), "square-root scaling: 4x the people, 2x the radius term");

  // A ring is round on the sphere: every vertex the radius from the centre.
  const ring = discRing(60, 10, 2);
  ok(ring.length === 49 && ring[0][0] === ring[48][0] && ring[0][1] === ring[48][1], "closed ring");
  ok(ring.slice(0, -1).every(([x, y]) => near(arcDegrees(60, 10, y, x), 2, 1e-3)), "geodesic: every vertex 2° of arc from the centre at 60°N");
  // On the antimeridian the longitudes run on past 180 instead of wrapping.
  const am = discRing(0, 179.5, 1);
  ok(Math.max(...am.map((p) => p[0])) > 180 && Math.min(...am.map((p) => p[0])) > 178, "a disc on the antimeridian is not drawn the long way round");
  // West-positive: the centre flips sign and the ring is its mirror.
  const e = discRing(20, 30, 1); const w = discRing(20, 30, 1, { west: true });
  ok(w.every((p, i) => near(p[0], -e[i][0], 1e-4) && near(p[1], e[i][1], 1e-9)), "west-positive world: the disc mirrors about the centre");
  // Near a pole the radius is capped short of it.
  ok(discRing(89, 0, 5).every(([, y]) => y < 90), "a polar disc never wraps over the pole");
}

{
  // Separation: neighbours that would touch shrink in proportion, never move.
  const discs = [{ lat: 0, lon: 0, r: 1 }, { lat: 0, lon: 1.5, r: 1 }, { lat: 10, lon: 10, r: 1 }];
  const sep = separateDiscs(discs, { gapDeg: 0.1 });
  ok(arcDegrees(0, 0, 0, 1.5) >= sep[0].r + sep[1].r + 0.1 - 1e-9, "touching neighbours are separated", JSON.stringify(sep));
  ok(sep[2].r === 1 && sep[0].lat === 0 && sep[1].lon === 1.5, "a clear disc is untouched, and nothing moves");
  let seed = 5;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const many = Array.from({ length: 120 }, () => ({ lat: rand() * 40 - 20, lon: rand() * 40 - 20, r: 0.5 + rand() * 3 }));
  const out = separateDiscs(many, { gapDeg: 0.05 });
  let worst = Infinity;
  for (let i = 0; i < out.length; i += 1) {
    for (let j = i + 1; j < out.length; j += 1) worst = Math.min(worst, arcDegrees(out[i].lat, out[i].lon, out[j].lat, out[j].lon) - out[i].r - out[j].r);
  }
  ok(worst >= 0.05 - 1e-9, "120 random discs: no two overlap after one pass", String(worst));
}

{
  const answer = {
    cell_deg: 1.40625,
    cells: [
      { key: "a", lat: 37.75, lon: 14.99, researchers: 4, posts: 9, projects: 1, study_areas: 2, trend: "rising", top_tags: ["volcanology"], place: "Mount Etna", places_more: 1, cell: { s: 37.27, w: 14.06, size: 1.40625 } },
      { key: "b", lat: 40.8, lon: 14.4, researchers: 1, trend: "steady", place: "", cell: { size: 1.40625 } },
      { key: "c", lat: null, lon: 1, researchers: 3 },
      { key: "d", lat: 0, lon: 0, researchers: 0 },
    ],
  };
  const fc = interestToFeatures(answer);
  ok(fc.features.length === 2, "cells with no centre or nobody in them are not drawn", String(fc.features.length));
  const etna = fc.features.find((f) => f.properties.key === "a");
  ok(etna.geometry.type === "Polygon" && etna.properties.researchers === 4 && etna.properties.trend_label === "Rising"
    && /Mount Etna \+1 · 4 researchers/.test(etna.properties.name), "a disc says where, how many people, and its trend", etna.properties.name);
  ok(TREND_COLOURS[etna.properties.trend_label] === "#f0b030" && TREND_COLOURS.Steady === "#00d4c0", "amber rising, cyan steady, as on the Social map");
  const other = fc.features.find((f) => f.properties.key === "b");
  ok(etna.properties.radius_deg > other.properties.radius_deg, "four people make a bigger disc than one");
  ok(/40\.8°, 14\.4° · 1 researcher$/.test(other.properties.name), "an unnamed cell is named by its centre", other.properties.name);
  const west = interestToFeatures(answer, { west: true });
  const wEtna = west.features.find((f) => f.properties.key === "a");
  ok(near(wEtna.properties.center_lon, -14.99) && wEtna.geometry.coordinates[0].every(([x]) => x < 0), "west-positive world: the disc is placed by its west longitude");
  ok(featuresKey(fc) === featuresKey(interestToFeatures(answer)) && featuresKey(fc) !== featuresKey(west)
    && featuresKey(fc) !== featuresKey(interestToFeatures({ ...answer, cells: [{ ...answer.cells[0], researchers: 5 }, answer.cells[1]] })),
    "the redraw key changes when a head count does, not otherwise");
  ok(!JSON.stringify(fc).includes("@"), "no handles or emails ride on a disc");
}
