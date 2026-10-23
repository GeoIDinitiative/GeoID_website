/**
 * GeoID Network, the arithmetic half: no DOM, no three.js, no fetch.
 *
 * `social-bridge.js` is what meets the page -- the Community layer, the shared
 * scene, the Share buttons -- and every decision it makes that could be wrong
 * QUIETLY is made here instead, where a node test can hold it still: which
 * box and zoom the map is asked for, how a cluster becomes a marker, which
 * deep link was given, what a shared view says about itself. A wrong bbox is
 * an empty layer that looks like a quiet community, and a wrong longitude on
 * a west-positive world is every post on the far side of the planet; neither
 * announces itself in a browser.
 *
 * ONE LONGITUDE CONVENTION ON THE WIRE. GeoID Network stores and serves
 * planetocentric EAST-positive longitude in -180..180 for every world, the way
 * a GeoJSON file does. Three of this app's viewers (Mercury, Jupiter, Saturn)
 * place a coordinate by its WEST longitude -- see `bodies.js`, and
 * `nomenclature-outlines.js` for the measured cost of forgetting -- so a
 * longitude is negated on the way into such a viewer and on the way out of
 * it, here and nowhere else.
 */

export const DEFAULT_SOCIAL_BASE = "https://social.geoidinitiative.com";

/** Where the person is sent to read, discuss or compose. Same origin as the viewer. */
export const SOCIAL_APP = "/social/";

export const SHARE_KEY = "geoid:social-share";
export const WORKSPACE_KEY = "geoid:social-workspace";
export const BASE_OVERRIDE_KEY = "geoid:social-base";

/** What the Community layer says it is, in the layer box and on its card. */
export const COMMUNITY_LAYER_NAME = "Community — GeoID Network";
export const COMMUNITY_SOURCE = "GeoID Network (community content — unverified unless marked)";
export const ANNOTATION_LAYER_NAME = "Shared scene — annotations";

/**
 * An id as GeoID Network mints them (`lib.js` id(): a prefix and random
 * base-36). Checked before it goes into a URL or a fetch path, so a crafted
 * `?post=../../v1/me` is not a request.
 */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const validId = (value) => ID_RE.test(String(value || ""));

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The service to talk to.
 *
 * A page names it with `<meta name="geoid-social">`, the same shape the auth
 * service and the membership switch already take. The localStorage override is
 * honoured ONLY on a local host: it exists so `wrangler dev` on :8790 can be
 * driven from `serve.py`, and on the live site a stored value would be a way
 * to point somebody's viewer -- and their bearer token -- at another server.
 */
export function socialBase({ meta = "", stored = "", hostname = "" } = {}) {
  const clean = (u) => String(u || "").trim().replace(/\/+$/, "");
  if (stored && LOCAL_HOSTS.has(String(hostname).toLowerCase())) {
    const s = clean(stored);
    if (/^https?:\/\//i.test(s)) return s;
  }
  const m = clean(meta);
  if (/^https:\/\//i.test(m)) return m;
  return DEFAULT_SOCIAL_BASE;
}

/* ── Longitude ─────────────────────────────────────────────────────────── */

export const wrap180 = (d) => {
  const n = Number(d);
  // Already in range: returned untouched, because the modular arithmetic below
  // turns 14.8 into 14.799999999999955 and a shared box would drift by it.
  if (n > -180 && n <= 180) return n;
  const w = ((((n + 180) % 360) + 360) % 360) - 180;
  // -180 and 180 are one meridian; the wire says 180.
  return w === -180 ? 180 : w;
};

/** A viewer's own longitude, on the wire's east-positive convention. */
export function toEastLon(viewerLon, west = false) {
  return wrap180(west ? -Number(viewerLon) : Number(viewerLon));
}

/** A wire longitude, in the convention the viewer places coordinates by. */
export function toViewerLon(eastLon, west = false) {
  return wrap180(west ? -Number(eastLon) : Number(eastLon));
}

/* ── The map request ───────────────────────────────────────────────────── */

const round = (v, places) => {
  const k = 10 ** places;
  return Math.round(v * k) / k;
};

/**
 * The zoom the map endpoint clusters at, from how much ground is in shot.
 *
 * The service grids clusters at `360 / 2^z` degrees. About a dozen cells
 * across the view is the aim: fewer and a whole continent is one blob, more
 * and the clusters are the points with extra steps. Clamped, because a box
 * that collapses to nothing on a grazing view must not ask for z = 40.
 */
export function zoomForSpan(spanDeg) {
  const span = Number(spanDeg);
  if (!Number.isFinite(span) || span <= 0) return 2;
  const z = Math.floor(Math.log2((360 * 12) / Math.min(360, span)));
  return Math.max(1, Math.min(16, z));
}

/**
 * `visibleBounds()` (view-extent.js) in the VIEWER's convention, to the wire's
 * `w,s,e,n` in east longitude.
 *
 * On a west-positive world the box flips: the viewer's minimum is the wire's
 * maximum. A box that crosses the antimeridian is sent as w > e, which is the
 * ordinary bbox convention for that, rather than widened to the whole world.
 * No box at all (the camera is looking past the planet) asks for the world at
 * a coarse zoom, which is the honest answer to "what is in view".
 */
export function viewRequest(bounds, { west = false } = {}) {
  if (!bounds || ![bounds.minLon, bounds.maxLon, bounds.minLat, bounds.maxLat].every(Number.isFinite)) {
    return { bbox: "-180,-90,180,90", z: 2 };
  }
  const span = Math.max(bounds.maxLon - bounds.minLon, bounds.maxLat - bounds.minLat);
  const s = Math.max(-90, bounds.minLat);
  const n = Math.min(90, bounds.maxLat);
  let w;
  let e;
  if (bounds.maxLon - bounds.minLon >= 359) {
    w = -180; e = 180;
  } else if (west) {
    w = toEastLon(bounds.maxLon, true);
    e = toEastLon(bounds.minLon, true);
  } else {
    w = wrap180(bounds.minLon);
    e = wrap180(bounds.maxLon);
  }
  // A whole-planet box after wrapping must not read as an empty one.
  if (w === e) { w = -180; e = 180; }
  const bbox = [round(w, 3), round(s, 3), round(e, 3), round(n, 3)].join(",");
  return { bbox, z: zoomForSpan(span) };
}

export function mapUrl(base, { world = "earth", bbox, z, layer = "public" } = {}) {
  const q = new URLSearchParams({ world: String(world || "earth"), bbox: String(bbox), z: String(z) });
  if (layer && layer !== "public") q.set("layer", layer);
  return `${String(base).replace(/\/+$/, "")}/v1/map?${q.toString()}`;
}

/* ── Markers ───────────────────────────────────────────────────────────── */

const PROVENANCE = {
  observed: "Observed",
  derived: "Derived",
  modelled: "Modelled",
  forecast: "Forecast",
  ai: "AI-generated",
  unverified: "Unverified",
};

/**
 * What a post says about where it came from, in words a card can carry.
 *
 * An observation's community verdict outranks nothing and replaces nothing: it
 * is added beside the author's own label, because "observed, disputed" is a
 * different statement from either alone. Anything unrecognised is said to be
 * unverified -- the safe direction for a label nobody checked.
 */
export function provenanceLabel(provenance, verification = null) {
  const base = PROVENANCE[String(provenance || "").toLowerCase()] || PROVENANCE.unverified;
  const status = verification && typeof verification === "object" ? verification.status : verification;
  if (status === "community-verified") return `${base} · community-verified`;
  if (status === "disputed") return `${base} · disputed`;
  return base;
}

const KIND_WORDS = {
  text: "Post", scene: "Shared scene", analysis: "Analysis", monitor: "Monitor",
  observation: "Observation", workflow: "Workflow", dataset: "Dataset", paper: "Paper",
  question: "Question", discussion: "Discussion", event: "Event", opportunity: "Opportunity",
  challenge: "Challenge", project: "Project", model: "Model", repo: "Repository",
};
export const kindLabel = (kind) => KIND_WORDS[String(kind || "")] || "Post";

const authorHandle = (author) => {
  if (!author) return "";
  if (typeof author === "string") return author.replace(/^@/, "");
  return String(author.handle || "").replace(/^@/, "");
};

/** Where a post or project is read in the Social app. */
export function socialHref(kind, id) {
  if (!validId(id)) return SOCIAL_APP;
  return kind === "project" ? `${SOCIAL_APP}#/p/${id}` : `${SOCIAL_APP}#/post/${id}`;
}

/**
 * The map's answer as one GeoJSON collection the importer draws.
 *
 * `/v1/map` returns EITHER points (≤ 300 in the box) or clusters; both become
 * point features, told apart by `social_type`, so one layer with one row in
 * the Workspace carries whichever came back. A cluster's title is its count
 * and its commonest kinds, because "37" on its own is a number and not a map.
 *
 * Coordinates go out in the VIEWER's longitude (see the header), and a point
 * with no usable coordinate is dropped rather than drawn at 0,0 -- the
 * service never sends a hidden location, and Null Island is not a fallback.
 */
export function mapToFeatures(answer, { west = false } = {}) {
  const features = [];
  // `Number(null)` is 0, so absent is tested first: a missing coordinate is
  // Null Island otherwise, which is exactly the dot this must never draw.
  const given = (v) => v !== null && v !== undefined && v !== "";
  const ok = (lat, lon) => given(lat) && given(lon)
    && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))
    && Math.abs(Number(lat)) <= 90;
  for (const p of Array.isArray(answer?.points) ? answer.points : []) {
    if (!ok(p?.lat, p?.lon) || !validId(p.id)) continue;
    const kind = String(p.kind || "text");
    const handle = authorHandle(p.author);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [toViewerLon(p.lon, west), Number(p.lat)] },
      properties: {
        name: String(p.title || kindLabel(kind)).slice(0, 200),
        social_type: "point",
        social_id: String(p.id),
        kind,
        kind_label: kindLabel(kind),
        provenance: provenanceLabel(p.provenance, p.verification),
        author: handle ? `@${handle}` : "",
        precision: String(p.precision || ""),
        social_url: socialHref(kind, p.id),
      },
    });
  }
  for (const c of Array.isArray(answer?.clusters) ? answer.clusters : []) {
    const count = Math.max(0, Math.floor(Number(c?.count) || 0));
    if (!count || !ok(c?.lat, c?.lon)) continue;
    const kinds = Object.entries(c.kinds || {})
      .filter(([, n]) => Number(n) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 3)
      .map(([k, n]) => `${n} ${kindLabel(k).toLowerCase()}${Number(n) === 1 ? "" : "s"}`);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [toViewerLon(c.lon, west), Number(c.lat)] },
      properties: {
        name: `${count} community item${count === 1 ? "" : "s"}`,
        social_type: "cluster",
        count,
        kinds: kinds.join(", "),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Same answer, same picture: a cheap key so a settle that changes nothing redraws nothing. */
export function featuresKey(fc) {
  return (fc?.features || []).map((f) => {
    const p = f.properties || {};
    // A study-interest disc is a polygon: its centre and size are in its
    // properties, and the radius is part of the picture too.
    if (p.social_type === "interest") {
      return `interest:${p.key}:${p.researchers}:${p.trend}:${Number(p.center_lon).toFixed(3)},${Number(p.center_lat).toFixed(3)}:${Number(p.radius_deg).toFixed(4)}`;
    }
    const [x, y] = f.geometry?.coordinates || [];
    return `${p.social_type}:${p.social_id || p.count}:${Number(x).toFixed(3)},${Number(y).toFixed(3)}`;
  }).sort().join("|");
}

/* ── Study interest: the map of where people work, as discs ────────────── */

/** What the interest layer says it is. A different row from the posts layer, so neither is mistaken for the other. */
export const INTEREST_LAYER_NAME = "Community study interest — GeoID Network";
export const INTEREST_SOURCE = "GeoID Network (community study areas and public posts — sized by researchers, not by posts)";
export const COMMUNITY_MODES = ["posts", "interest"];
export const communityLayerName = (mode) => (mode === "interest" ? INTEREST_LAYER_NAME : COMMUNITY_LAYER_NAME);

/** The words and colours the discs are painted with: amber where rising or new, cyan where steady (as on /social/#/map). */
export const TREND_LABELS = { new: "New activity", rising: "Rising", steady: "Steady" };
export const TREND_COLOURS = { "New activity": "#f0b030", Rising: "#f0b030", Steady: "#00d4c0" };

/**
 * The box and zoom for /v1/map/interest.
 *
 * The interest grid is 16x finer than the post clusters at the same z
 * (`cellDegrees(z) = 360 / 2^(z+4)` in interest.js), so the posts zoom less
 * four asks for about the same dozen cells across the view. interest.js
 * reads a box as plain min/max, so one that crosses the antimeridian (w > e)
 * is sent as the whole world rather than as an empty sliver.
 */
export function interestRequest(bounds, { west = false } = {}) {
  const r = viewRequest(bounds, { west });
  const [w, s, e, n] = r.bbox.split(",").map(Number);
  const bbox = w > e ? `-180,${s},180,${n}` : r.bbox;
  return { bbox, z: Math.max(0, r.z - 4) };
}

export function interestUrl(base, { world = "earth", bbox, z, tag = "" } = {}) {
  const q = new URLSearchParams({ world: String(world || "earth"), bbox: String(bbox), z: String(z) });
  if (tag) q.set("tag", String(tag));
  return `${String(base).replace(/\/+$/, "")}/v1/map/interest?${q.toString()}`;
}

const RAD = Math.PI / 180;

/** Central angle between two points, in degrees of arc: the same on every world. */
export function arcDegrees(lat1, lon1, lat2, lon2) {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2
    + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / RAD;
}

/**
 * A disc's angular radius from its head count: the square root, so AREA
 * follows the number of people, scaled so the busiest cell in view nearly
 * fills its own cell and a single person is still a visible disc. Degrees of
 * arc, not kilometres, because the same rule has to hold on Mars.
 */
export function discRadiusDeg(researchers, maxResearchers, cellDeg) {
  const n = Math.max(1, Number(researchers) || 1);
  const top = Math.max(n, Number(maxResearchers) || 1);
  const full = 0.45 * Math.max(0.05, Number(cellDeg) || 1);
  return full * (0.3 + 0.7 * Math.sqrt(n / top));
}

/**
 * Shrink discs until none overlaps another (and `gapDeg` clears between).
 *
 * Cells are disjoint but a disc sits on the cell's centre of activity, which
 * can be near its edge, so two neighbours can touch. Each overlapping pair
 * is scaled down together, in proportion; shrinking never creates a new
 * overlap, so one pass over the pairs, biggest overlap first, is enough.
 * Positions are never moved: a disc is where its people are.
 */
export function separateDiscs(discs, { gapDeg = 0 } = {}) {
  const out = discs.map((d) => ({ ...d }));
  const pairs = [];
  for (let i = 0; i < out.length; i += 1) {
    for (let j = i + 1; j < out.length; j += 1) {
      const d = arcDegrees(out[i].lat, out[i].lon, out[j].lat, out[j].lon);
      pairs.push([i, j, d]);
    }
  }
  pairs.sort((a, b) => (out[b[0]].r + out[b[1]].r - b[2]) - (out[a[0]].r + out[a[1]].r - a[2]));
  for (const [i, j, d] of pairs) {
    const sum = out[i].r + out[j].r;
    if (sum + gapDeg <= d) continue;
    const k = Math.max(0, (d - gapDeg) / sum) * 0.999;
    out[i].r *= k; out[j].r *= k;
  }
  return out;
}

/**
 * A geodesic circle as a closed GeoJSON ring in the VIEWER's longitude.
 *
 * Built round the centre with the forward-azimuth formula, so it is round on
 * the sphere at any latitude, and its longitudes run continuously from the
 * centre's (they may pass 180) instead of wrapping, so a disc on the
 * antimeridian is not drawn the long way round the planet. On a
 * west-positive world each offset is negated about the centre. The radius
 * is kept short of the pole, which a ring cannot enclose.
 */
export function discRing(lat, lon, radiusDeg, { west = false, steps = 48 } = {}) {
  const phi = Math.max(-89, Math.min(89, Number(lat))) * RAD;
  const delta = Math.min(Number(radiusDeg), 0.95 * (90 - Math.abs(phi / RAD))) * RAD;
  const centre = toViewerLon(lon, west);
  const ring = [];
  for (let i = 0; i < steps; i += 1) {
    const theta = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(phi) * Math.cos(delta) + Math.cos(phi) * Math.sin(delta) * Math.cos(theta));
    const dLon = Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi), Math.cos(delta) - Math.sin(phi) * Math.sin(lat2)) / RAD;
    ring.push([round(centre + (west ? -dLon : dLon), 5), round(lat2 / RAD, 5)]);
  }
  ring.push([...ring[0]]);
  return ring;
}

/**
 * /v1/map/interest as polygons the importer draws: one disc per cell, sized
 * by DISTINCT researchers (never by posts), separated so none overlaps, in
 * the viewer's longitude. Cells without a usable centre are dropped, as the
 * posts layer drops points without one.
 */
export function interestToFeatures(answer, { west = false } = {}) {
  const cellDeg = Number(answer?.cell_deg) || 1;
  const cells = (Array.isArray(answer?.cells) ? answer.cells : []).filter((c) => {
    const ok = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
    return ok(c?.lat) && ok(c?.lon) && Math.abs(Number(c.lat)) <= 90 && Number(c.researchers) > 0;
  });
  const top = Math.max(1, ...cells.map((c) => Number(c.researchers) || 0));
  const discs = separateDiscs(cells.map((c) => ({
    lat: Number(c.lat), lon: Number(c.lon), r: discRadiusDeg(c.researchers, top, Number(c.cell?.size) || cellDeg), cell: c,
  })), { gapDeg: cellDeg * 0.02 });
  const features = discs.map(({ lat, lon, r, cell: c }) => {
    const n = Number(c.researchers);
    const trend = TREND_LABELS[c.trend] ? c.trend : "steady";
    const place = String(c.place || "").slice(0, 120);
    const more = Math.max(0, Math.floor(Number(c.places_more) || 0));
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [discRing(lat, lon, r, { west })] },
      properties: {
        name: `${place || `${lat.toFixed(1)}°, ${lon.toFixed(1)}°`}${more ? ` +${more}` : ""} · ${n} researcher${n === 1 ? "" : "s"}`,
        social_type: "interest",
        key: String(c.key || ""),
        researchers: n,
        trend,
        trend_label: TREND_LABELS[trend],
        posts: Number(c.posts) || 0,
        projects: Number(c.projects) || 0,
        study_areas: Number(c.study_areas) || 0,
        top_tags: (Array.isArray(c.top_tags) ? c.top_tags : []).slice(0, 3).map(String).join(", "),
        place,
        center_lat: lat,
        center_lon: toViewerLon(lon, west),
        radius_deg: Number(r.toFixed(5)),
      },
    };
  });
  return { type: "FeatureCollection", features };
}

/* ── Deep links ────────────────────────────────────────────────────────── */

/** `?post=` and `?project=`, checked; anything malformed is as good as absent. */
export function readDeepLink(search) {
  let q;
  try { q = new URLSearchParams(String(search || "")); } catch (_e) { return { post: null, project: null }; }
  const pick = (k) => {
    const v = q.get(k);
    return validId(v) ? v : null;
  };
  return { post: pick("post"), project: pick("project") };
}

/**
 * The GeoHUB address that opens a world with a shared thing in it -- the one
 * the shell maps `?world=` from. Earth is the shell's default and takes no
 * world parameter; a world this app does not have gets none either, so the
 * reader lands on Earth with the banner rather than on nothing.
 */
const SHELL_WORLDS = ["mercury", "venus", "moon", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"];
export function worldUrl(world, { post = null, project = null } = {}) {
  const q = new URLSearchParams();
  const w = String(world || "").toLowerCase();
  if (SHELL_WORLDS.includes(w)) q.set("world", w);
  if (validId(post)) q.set("post", post);
  if (validId(project)) q.set("project", project);
  const s = q.toString();
  return s ? `/?${s}` : "/";
}

/**
 * Where a shared scene asks the camera to be, in this viewer's terms.
 * Null when the scene has no usable camera -- the banner still shows.
 */
export function cameraFromScene(scene, { west = false } = {}) {
  const cam = scene?.camera;
  if (!cam) return null;
  if (cam.lat == null || cam.lon == null) return null;
  const lat = Number(cam.lat);
  const lon = Number(cam.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return null;
  const alt = Number(cam.alt);
  return {
    lat,
    lon: toViewerLon(lon, west),
    alt: Number.isFinite(alt) && alt > 0 ? alt : null,
    heading: Number.isFinite(Number(cam.heading)) ? Number(cam.heading) : 0,
    pitch: Number.isFinite(Number(cam.pitch)) ? Number(cam.pitch) : -90,
  };
}

/**
 * The scene's layers this viewer can actually switch on.
 *
 * Matched by the catalogue id first and the display name second -- a shared
 * scene from another session carries the session's own numeric layer ids,
 * which mean nothing here, so those are never matched. What is not found is
 * returned too, so the banner can say "2 layers aren't available here"
 * rather than leaving the reader to wonder why the map looks different.
 */
export function layersToEnable(sceneLayers, available) {
  const byId = new Map();
  const byName = new Map();
  for (const a of available || []) {
    if (a?.id) byId.set(String(a.id), a);
    if (a?.name) byName.set(String(a.name).toLowerCase(), a);
  }
  const found = [];
  const missing = [];
  const seen = new Set();
  for (const l of Array.isArray(sceneLayers) ? sceneLayers : []) {
    if (!l || l.visible === false) continue;
    const hit = (l.id != null && byId.get(String(l.id)))
      || (l.name && byName.get(String(l.name).toLowerCase()))
      || null;
    if (hit) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      found.push({ ...hit, opacity: Number.isFinite(Number(l.opacity)) ? Number(l.opacity) : null });
    } else {
      missing.push(String(l.name || l.id || "a layer"));
    }
  }
  return { found, missing };
}

/** A scene's annotations as labelled points, in the viewer's longitude. */
export function annotationsToFeatures(annotations, { west = false } = {}) {
  const features = [];
  for (const a of Array.isArray(annotations) ? annotations : []) {
    if (a?.lat == null || a?.lon == null) continue;
    const lat = Number(a.lat);
    const lon = Number(a.lon);
    const text = String(a?.text || "").trim().slice(0, 140);
    if (!text || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [toViewerLon(lon, west), lat] },
      // `label_rank` is the column point-labels.js reads as "name these".
      properties: { name: text, kind: "Annotation", label_rank: 5 },
    });
  }
  return { type: "FeatureCollection", features };
}

export function bannerText(post) {
  const handle = authorHandle(post?.author) || "someone";
  return `Viewing a shared scene by @${handle}`;
}

/* ── Sharing ───────────────────────────────────────────────────────────── */

const num = (v, places) => (Number.isFinite(Number(v)) ? round(Number(v), places) : null);

/**
 * The view as GeoID Network's `scene` shape.
 *
 * `focus` is the point at the centre of the screen (view-extent's
 * `viewFocus`), in the viewer's own longitude; it goes out east-positive.
 * Layers are the project manifest's rows, carrying the catalogue id where the
 * layer came from one, so another reader's viewer can switch on the same
 * thing by name rather than by a number that only meant something here.
 */
export function buildSharePayload({
  world = "earth", focus = null, alt = null, heading = 0, pitch = -90,
  layers = [], annotations = [], time = null, west = false, title = "",
} = {}) {
  const camera = focus && Number.isFinite(Number(focus.lat)) && Number.isFinite(Number(focus.lon))
    ? {
      lat: num(focus.lat, 5),
      lon: num(toEastLon(focus.lon, west), 5),
      alt: num(alt, 0),
      heading: num(heading, 1) ?? 0,
      pitch: num(pitch, 1) ?? -90,
    }
    : null;
  return {
    v: 1,
    from: "geohub",
    title: String(title || ""),
    world: String(world || "earth"),
    camera,
    layers: (Array.isArray(layers) ? layers : []).map((l) => ({
      id: l.catalogueId || (l.id != null ? `session:${l.id}` : null),
      name: String(l.name || ""),
      source: l.source || null,
      opacity: Number.isFinite(Number(l.opacity)) ? Number(l.opacity) : 1,
      visible: l.visible !== false,
    })),
    annotations: (Array.isArray(annotations) ? annotations : [])
      .filter((a) => a && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lon)) && a.text)
      .map((a) => ({ lat: num(a.lat, 5), lon: num(toEastLon(a.lon, west), 5), text: String(a.text) })),
    time: Number.isFinite(Number(time)) ? Math.floor(Number(time)) : null,
  };
}

/**
 * The workspace manifest a GeoHUB project is published and versioned as.
 *
 * One builder for every door -- the old hand-off to /social/#/projects, the
 * direct publish, and every pushed version -- so a version pushed from the
 * Projects page and one published from the dialog cannot disagree about what a
 * workspace is. `share` is `buildSharePayload`'s answer: the camera and the
 * catalogue-matched layers, east-positive.
 */
export function buildWorkspaceManifest({ share = {}, name = "" } = {}) {
  return {
    v: 1,
    world: String(share.world || "earth"),
    camera: share.camera || null,
    layers: Array.isArray(share.layers) ? share.layers : [],
    annotations: Array.isArray(share.annotations) ? share.annotations : [],
    project: { name: String(name || "") },
  };
}

/** What "Publish workspace to Social" leaves for /social/#/projects?new=1. */
export function buildWorkspacePayload({ title = "", world = "earth", manifest = {} } = {}) {
  return {
    v: 1,
    from: "geohub",
    title: String(title || "Untitled GeoHUB project").slice(0, 200),
    world: String(world || "earth"),
    manifest: manifest && typeof manifest === "object" ? manifest : {},
  };
}

/* ── Camera attitude ───────────────────────────────────────────────────── */

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/**
 * Heading and pitch of a camera over a globe, in degrees.
 *
 * Plain arrays in WORLD space: the camera's position, the direction it looks,
 * and the planet's north axis as the globe's own group carries it (tilt and
 * all). Pitch is -90 looking straight down and 0 at the horizon; heading is
 * clockwise from north. "East" is the direction this app's `latLonToVector3`
 * increases longitude in, so on a west-positive world the caller flips the
 * sign -- the same one negation as every longitude.
 */
export function headingPitch(position, forward, pole = [0, 1, 0]) {
  const up = norm(position);
  const f = norm(forward);
  const pitch = Math.asin(Math.max(-1, Math.min(1, dot(f, up)))) * (180 / Math.PI);
  const north = sub(norm(pole), scale(up, dot(norm(pole), up)));
  const flat = sub(f, scale(up, dot(f, up)));
  if (Math.hypot(...north) < 1e-9 || Math.hypot(...flat) < 1e-9) return { heading: 0, pitch };
  const n = norm(north);
  const east = norm(cross(n, up));
  let heading = Math.atan2(dot(flat, east), dot(flat, n)) * (180 / Math.PI);
  if (heading < 0) heading += 360;
  return { heading, pitch };
}

/* ── Atlas ─────────────────────────────────────────────────────────────── */

/** `/v1/places` as a few lines Atlas can say. */
export function describePlaces(answer, { limit = 6 } = {}) {
  const posts = Array.isArray(answer?.posts) ? answer.posts : [];
  const projects = Array.isArray(answer?.projects) ? answer.projects : [];
  if (!posts.length && !projects.length) {
    return { text: "No public community posts near the centre of the view yet.", items: [] };
  }
  const items = [
    ...posts.map((p) => ({ kind: p.kind || "text", id: p.id, title: p.title || kindLabel(p.kind),
      provenance: provenanceLabel(p.provenance, p.verification), author: authorHandle(p.author) })),
    ...projects.map((p) => ({ kind: "project", id: p.id, title: p.title || "Project",
      provenance: "", author: authorHandle(p.owner || p.author) })),
  ].filter((i) => validId(i.id)).slice(0, limit);
  const lines = items.map((i) => `- **${i.title}** (${kindLabel(i.kind)}${i.provenance ? `, ${i.provenance}` : ""})`
    + `${i.author ? ` by @${i.author}` : ""}`);
  const total = posts.length + projects.length;
  return {
    text: `Community content near the centre of the view (${total}; community content is unverified unless marked):\n${lines.join("\n")}`,
    items,
  };
}

/* ── Saved projects, linked to Social (contract v1.1) ──────────────────── */

/**
 * Role order, lowest first. `public` is what GET /v1/projects/:id says to a
 * reader with no grant at all; it ranks under viewer because it is less than a
 * grant, not because it reads less.
 */
export const PROJECT_ROLES = ["public", "viewer", "commenter", "forker", "editor", "owner"];
export const roleRank = (role) => PROJECT_ROLES.indexOf(String(role || "").toLowerCase());
const normRole = (role, fallback = "viewer") => (roleRank(role) >= 0 ? String(role).toLowerCase() : fallback);

/** Only an owner or an editor may push a version; the Worker refuses anyone else, so the button does first. */
export const canPush = (role) => roleRank(role) >= roleRank("editor");

/** Posting INTO a project needs commenter or better (v1.1 `project` visibility). */
export const canPostInto = (role) => roleRank(role) >= roleRank("commenter");

/** What a project may be published as from GeoHUB. The rest of Social's list is for posts. */
export const PUBLISH_VISIBILITY = ["private", "team", "unlisted", "public"];

export const MAX_WORKSPACE_BYTES = 48 * 1024;
export const MAX_MODEL_CONFIG_BYTES = 32 * 1024;

/** Bytes as the Worker will count them: UTF-8 of the JSON, not string length. */
export const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value ?? null)).length;

const KNOWN_WORLDS = ["earth", ...SHELL_WORLDS];
const normWorld = (world) => {
  const w = String(world || "").toLowerCase();
  return KNOWN_WORLDS.includes(w) ? w : "earth";
};
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const validSlug = (slug) => SLUG_RE.test(String(slug || ""));
const wholeVersion = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The `social` entry of a project's metadata, or null.
 *
 * Read defensively because metadata/project.json is a file a person (or the
 * desktop app) can edit: a link whose id would not survive a fetch path is no
 * link, and a role nobody recognises is read as the least it could be rather
 * than as permission.
 */
export function readSocialLink(meta) {
  const s = meta?.social;
  if (!s || typeof s !== "object" || !validId(s.project_id)) return null;
  return {
    project_id: String(s.project_id),
    version: wholeVersion(s.version),
    role: normRole(s.role),
    linked_at: String(s.linked_at || ""),
  };
}

/** A fresh link, as written into metadata/project.json. Each user's is their own. */
export function makeSocialLink({ project_id, version = 0, role = "viewer" } = {}, now = new Date()) {
  if (!validId(project_id)) throw new Error("That is not a GeoID Network project id.");
  return {
    project_id: String(project_id),
    version: wholeVersion(version),
    role: normRole(role),
    linked_at: now.toISOString(),
  };
}

/**
 * The newest version GET /v1/projects/:id knows about.
 *
 * `current_version` where the answer carries it (on the project or beside
 * it); otherwise the highest of `versions[]`, which every answer carries. 0
 * means "no workspace has ever been pushed", which is not the same as unknown.
 */
export function remoteVersion(answer) {
  const project = answer?.project && typeof answer.project === "object" ? answer.project : answer;
  const direct = wholeVersion(project?.current_version ?? answer?.current_version);
  if (direct) return direct;
  const listed = (Array.isArray(answer?.versions) ? answer.versions : [])
    .map((v) => wholeVersion(v?.version)).filter(Boolean);
  return listed.length ? Math.max(...listed) : 0;
}

/**
 * Everything the Projects page decides about one link, in one place.
 *
 * The role comes from the SERVER when it has answered (a grant can be raised,
 * lowered or expire after the link was written) and from the stored link only
 * when it has not. "Behind" is strictly newer -- a local version ahead of the
 * server (a push whose answer was lost) is not an update to pull.
 */
export function linkState(link, answer = null) {
  if (!link) {
    return { linked: false, role: null, canPush: false, behind: false, local: 0, remote: null, roleChanged: false, why: "" };
  }
  const role = answer?.access?.role ? normRole(answer.access.role, link.role) : link.role;
  const remote = answer ? remoteVersion(answer) : null;
  const push = canPush(role);
  return {
    linked: true,
    role,
    canPush: push,
    behind: remote != null && remote > link.version,
    local: link.version,
    remote,
    roleChanged: role !== link.role,
    why: push ? "" : `You have ${role} access — only the owner or an editor can push a new version.`,
  };
}

/** The short tag a project row carries. Empty for a project that is not on Social. */
export function linkTag(link) {
  if (!link) return "";
  return `Social v${link.version || 0} · ${link.role}`;
}

/**
 * The body of POST /v1/projects, or the sentence saying why not.
 *
 * Checked here because a 400 from the Worker arrives after the person has
 * already pressed Publish; the size check in particular is the Worker's 48 KB
 * limit counted the Worker's way, so a big layer list is refused with a reason
 * rather than half-published.
 */
export function publishProjectBody({
  title = "", summary = "", world = "earth", visibility = "private", team_slug = "", manifest = null,
} = {}) {
  const t = String(title || "").trim().slice(0, 200);
  if (!t) return { error: "Give the project a title." };
  const vis = String(visibility || "").toLowerCase();
  if (!PUBLISH_VISIBILITY.includes(vis)) return { error: `Visibility must be one of ${PUBLISH_VISIBILITY.join(", ")}.` };
  const slug = String(team_slug || "").trim();
  if (slug && !validSlug(slug)) return { error: "That team is not one GeoID Network knows." };
  if (vis === "team" && !slug) return { error: "Choose which of your teams can see it." };
  const body = { title: t, summary: String(summary || "").trim().slice(0, 2000), world: normWorld(world), visibility: vis };
  if (slug) body.team_slug = slug;
  if (manifest) {
    if (jsonBytes(manifest) > MAX_WORKSPACE_BYTES) {
      return { error: "This workspace's manifest is over GeoID Network's 48 KB limit — hide or remove some layers and try again." };
    }
    body.workspace = manifest;
  }
  return { body };
}

/** The body of POST /v1/projects/:id/versions, size-checked the same way. */
export function pushVersionBody({ manifest = null, note = "" } = {}) {
  if (!manifest || typeof manifest !== "object") return { error: "There is no workspace to push." };
  if (jsonBytes(manifest) > MAX_WORKSPACE_BYTES) {
    return { error: "This workspace's manifest is over GeoID Network's 48 KB limit — hide or remove some layers and try again." };
  }
  return { body: { manifest, note: String(note || "").trim().slice(0, 500) } };
}

/**
 * "Shared with me", as rows.
 *
 * Everything shared with the reader, then their OWN projects that this
 * machine has no copy of -- published from another browser, say -- because
 * those are just as missing from the local list. One row per project id; a
 * row already saved here says so instead of offering to save a second copy.
 */
export function sharedRows({ shared = [], mine = [], localLinks = [] } = {}) {
  const local = new Set((localLinks || []).map((l) => l?.project_id).filter(Boolean));
  const seen = new Set();
  const out = [];
  const add = (p, fallbackRole, source) => {
    const id = p?.id;
    if (!validId(id) || seen.has(id)) return;
    seen.add(id);
    out.push({
      id: String(id),
      title: String(p.title || "Untitled project").slice(0, 200),
      world: normWorld(p.world),
      role: normRole(p.role || p.access?.role, fallbackRole),
      owner: authorHandle(p.owner || p.author),
      version: remoteVersion(p),
      saved: local.has(id),
      source,
    });
  };
  (Array.isArray(shared) ? shared : []).forEach((p) => add(p, "viewer", "shared"));
  (Array.isArray(mine) ? mine : []).forEach((p) => { if (!local.has(p?.id)) add(p, "owner", "mine"); });
  return out;
}

/* ── Where a share goes ────────────────────────────────────────────────── */

export const SHARE_KINDS = ["scene", "model", "repo"];
export const SHARE_KIND_LABELS = { scene: "Globe view", model: "Model", repo: "Repository" };
const TARGET_TYPES = ["public", "team", "community", "project"];

/**
 * Every place the reader may post into, from GET /v1/me and their projects.
 *
 * A project is offered only at commenter or better: v1.1 lets anyone with
 * viewer access READ a project's posts but only commenter+ write one, and a
 * destination the Worker will refuse is a form that fails at the end.
 */
export function shareDestinations(me = null, projects = []) {
  const out = [{ type: "public", id: null, label: "Public feed" }];
  const seen = new Set(["public:"]);
  const push = (d) => {
    const key = `${d.type}:${d.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(d);
  };
  (Array.isArray(me?.teams) ? me.teams : []).forEach((t) => {
    if (validSlug(t?.slug)) push({ type: "team", id: String(t.slug), label: `Team · ${t.name || t.slug}` });
  });
  (Array.isArray(me?.communities) ? me.communities : []).forEach((c) => {
    if (validSlug(c?.slug)) push({ type: "community", id: String(c.slug), label: `Community · ${c.name || c.slug}` });
  });
  (Array.isArray(projects) ? projects : []).forEach((p) => {
    if (validId(p?.id) && canPostInto(p.role)) push({ type: "project", id: String(p.id), label: `Project · ${p.title || p.id}` });
  });
  return out;
}

export const destinationKey = (d) => `${d?.type || "public"}:${d?.id ?? ""}`;

export function parseDestination(key) {
  const [type, ...rest] = String(key || "").split(":");
  const id = rest.join(":");
  if (!TARGET_TYPES.includes(type)) return null;
  if (type === "public") return { type, id: null };
  if (type === "project" ? !validId(id) : !validSlug(id)) return null;
  return { type, id };
}

/**
 * A repository link, checked, with the host Social files it under.
 *
 * https only (the contract's rule, and a plain-http repo link is a downgrade
 * waiting to happen), and never a URL with credentials in it -- a token pasted
 * into a link would otherwise be published to the feed.
 */
export function repoMeta(url, { language = "", licence = "", default_branch = "" } = {}) {
  let u;
  try { u = new URL(String(url || "").trim()); } catch (_e) { return { error: "That is not a web address." }; }
  if (u.protocol !== "https:") return { error: "Repository links must start with https://." };
  if (u.username || u.password) return { error: "Leave credentials out of the link." };
  const h = u.hostname.toLowerCase();
  const host = h === "github.com" || h.endsWith(".github.com") ? "github"
    : (h === "gitlab.com" || h.startsWith("gitlab.")) ? "gitlab"
      : h === "codeberg.org" ? "codeberg" : "other";
  const meta = { url: u.href, host };
  if (language) meta.language = String(language).slice(0, 60);
  if (licence) meta.licence = String(licence).slice(0, 60);
  if (default_branch) meta.default_branch = String(default_branch).slice(0, 120);
  return { meta };
}

/**
 * A repository URL the open project already mentions, to save retyping it.
 *
 * There is no GitHub connector in the Research Hub (connectors.js has none),
 * so this is the only prefill there is: a link to a known code host among the
 * project's own fields. Never anything that is not https.
 */
export function repoPrefill(meta) {
  const candidates = [];
  const take = (v) => {
    if (!v) return;
    if (typeof v === "string") candidates.push(v);
    else if (typeof v === "object") candidates.push(v.url, v.href, v.repo);
  };
  take(meta?.repo_url);
  take(meta?.repository);
  (Array.isArray(meta?.pinned_resources) ? meta.pinned_resources : []).forEach(take);
  (Array.isArray(meta?.remote_profiles) ? meta.remote_profiles : []).forEach(take);
  for (const c of candidates) {
    const r = repoMeta(c);
    if (r.meta && r.meta.host !== "other") return r.meta.url;
  }
  return "";
}

/**
 * The v1.1 hand-off to /social/#/compose, or why it cannot be made.
 *
 * A scene ALSO carries its fields at the top level, where the compose page
 * read them before v1.1: the hand-off is one sessionStorage write and a page
 * load, and a compose page one deploy behind must still find the view rather
 * than an empty form.
 */
export function buildShareHandoff({ kind = "scene", target = null, scene = null, meta = null, title = "" } = {}) {
  if (!SHARE_KINDS.includes(kind)) return { error: "Choose what to share." };
  const t = target && TARGET_TYPES.includes(target.type) ? target : { type: "public", id: null };
  if (t.type !== "public" && !(t.type === "project" ? validId(t.id) : validSlug(t.id))) {
    return { error: "That destination is not one of yours." };
  }
  const head = { v: 1, from: "geohub", kind, target: { type: t.type, id: t.type === "public" ? null : String(t.id) } };
  const named = String(title || "").trim().slice(0, 200);
  if (kind === "scene") {
    if (!scene || typeof scene !== "object") return { error: "There is no view to share yet — the globe is still starting." };
    return { handoff: { ...scene, ...head, title: named || String(scene.title || ""), scene } };
  }
  if (kind === "repo") {
    const r = repoMeta(meta?.url, meta || {});
    if (r.error) return r;
    return { handoff: { ...head, title: named, meta: r.meta } };
  }
  if (!meta || !["gmsh", "blender"].includes(meta.mesher) || typeof meta.page !== "string" || !meta.page.startsWith("/")) {
    return { error: "There is no model to share yet — set up the Model Builder's study area first." };
  }
  if (jsonBytes(meta.config || {}) > MAX_MODEL_CONFIG_BYTES) {
    return { error: "This model's settings are over GeoID Network's 32 KB limit." };
  }
  return { handoff: { ...head, title: named, meta } };
}

/* ── Models ────────────────────────────────────────────────────────────── */

/**
 * The GeoHUB page a model is opened on, by world.
 *
 * Open in GeoHUB is `<meta.page>?post=<id>` (contract v1.1), so the page must
 * take a bare `?post=` and still land on the right world. Earth's door is the
 * shell, which carries `?post=` into its viewer frame; every other world's is
 * its standalone viewer, which bounces into the shell as `/?world=<w>&post=`.
 * The Model Builder and the Meshing Studio are part of every one of those
 * viewers, so there is no separate model page to name.
 */
export function modelPagePath(world) {
  const w = normWorld(world);
  return w === "earth" ? "/" : `/planet_explorer/${w}/viewer/`;
}

/** Where a post's world is, whatever kind it is. */
export function postWorld(post) {
  return String(post?.scene?.world || post?.meta?.domain?.world || post?.world || "").toLowerCase();
}

const finite = (v) => (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Longitudes, between the viewer's convention and the wire's, through a
 * settings tree.
 *
 * The Model Builder keeps points as `{lat, lon}` and boxes as
 * `{west, east, south, north}` in the VIEWER's longitude; the wire is
 * east-positive. On a west-positive world a box's two edges also swap: the
 * viewer's west edge is the wire's east. Depth-limited, because this walks
 * whatever a stored file says.
 */
export function convertLons(value, convert, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => convertLons(v, convert, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = convertLons(v, convert, depth + 1);
  if (finite(value.lat) !== null && finite(value.lon) !== null) out.lon = convert.lon(Number(value.lon));
  if (finite(value.west) !== null && finite(value.east) !== null) {
    const [w, e] = convert.box(Number(value.west), Number(value.east));
    out.west = w; out.east = e;
  }
  return out;
}

const toWire = (west) => ({
  lon: (l) => toEastLon(l, west),
  box: (w, e) => (west ? [toEastLon(e, true), toEastLon(w, true)] : [wrap180(w), wrap180(e)]),
});
const toViewer = (west) => ({
  lon: (l) => toViewerLon(l, west),
  box: (w, e) => (west ? [toViewerLon(e, true), toViewerLon(w, true)] : [w, e]),
});

const asObject = (m) => (m instanceof Map ? Object.fromEntries(m) : (m && typeof m === "object" ? { ...m } : {}));
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

/**
 * The Model Builder's settings, BY REFERENCE: what was chosen, never what was
 * computed. No surface, no STL, no mesh, no sampled field -- those are
 * rebuilt from these by whoever opens it, which is what keeps a model under
 * 32 KB and keeps a post from carrying files it does not own.
 *
 * Layer roles travel by layer NAME: a role keyed by this session's numeric
 * layer id means nothing in anybody else's.
 */
export function modelConfigFromState(state = {}, { west = false, layerNames = {} } = {}) {
  const roles = [];
  for (const [id, role] of Object.entries(asObject(state.roles))) {
    const layer = layerNames[id];
    if (layer && role && role !== "ignore") roles.push({ layer: String(layer), role: String(role) });
  }
  const bbox = state.bounds?.bbox || null;
  const config = {
    v: 1,
    kind: state.kind || "3d",
    area: state.bounds ? { label: String(state.bounds.label || ""), ...(bbox ? { west: bbox.west, south: bbox.south, east: bbox.east, north: bbox.north } : {}) } : null,
    domain: { type: state.domain?.type || "solid", depthM: finite(state.domain?.depthM), materials: plain(state.domain?.materials || {}) },
    resolution: plain(state.resolution || {}),
    meshSizeM: finite(state.meshSizeM),
    grading: plain(state.grading || {}),
    sampling: plain(state.sampling || {}),
    atmosphere: plain(state.atmosphere || {}),
    layers: {
      soil: Boolean(state.layers?.soil), water: Boolean(state.layers?.water),
      minSoilM: finite(state.layers?.minSoilM), minWaterM: finite(state.layers?.minWaterM),
    },
    faults: {
      dipDeg: finite(state.faults?.dipDeg), side: state.faults?.side || "right", depthM: finite(state.faults?.depthM),
      custom: plain(state.faults?.custom || []),
    },
    section: plain(state.section || {}),
    flags: plain(state.flags || {}),
    pointFlagByName: plain(asObject(state.pointFlagByName)),
    pointSizeByName: plain(asObject(state.pointSizeByName)),
    sizeFields: plain(state.sizeFields || []),
    meshOptions: plain(state.meshOptions || {}),
    customPoints: plain(state.customPoints || []),
    conditions: plain(state.conditions || []),
    roles,
  };
  return convertLons(config, toWire(west));
}

/**
 * Down to the 32 KB the contract allows, dropping the bulkiest optional parts
 * first and SAYING which were dropped: a model that arrives without its size
 * fields must not read as a model that never had any.
 */
const DROP_ORDER = [
  ["customPoints"], ["sizeFields"], ["faults", "custom"], ["sampling", "buffers"], ["conditions"], ["domain", "materials"], ["roles"],
];
export function capModelConfig(config, limit = MAX_MODEL_CONFIG_BYTES) {
  const out = plain(config);
  const omitted = [];
  for (const path of DROP_ORDER) {
    if (jsonBytes(out) <= limit) break;
    const parent = path.length === 1 ? out : out[path[0]];
    const key = path[path.length - 1];
    if (parent && parent[key] !== undefined) {
      delete parent[key];
      omitted.push(path.join("."));
    }
  }
  if (omitted.length) out.omitted = omitted;
  if (jsonBytes(out) > limit) return { error: "This model's settings are over GeoID Network's 32 KB limit even without its points and fields." };
  return { config: out, omitted };
}

/** The handful of numbers a reader scans before opening a model. */
export function modelParams(config = {}) {
  const res = config.resolution || {};
  const out = {
    kind: config.kind || "3d",
    domain: config.domain?.type || "solid",
    depth_m: config.kind === "surface" ? 0 : finite(config.domain?.depthM),
    resolution_m: res.mode === "native" ? "native" : finite(res.stepM),
    mesh_size_m: finite(config.meshSizeM),
    atmosphere_m: config.atmosphere?.on ? finite(config.atmosphere?.heightM) : null,
    soil: Boolean(config.layers?.soil) || null,
    water: Boolean(config.layers?.water) || null,
    faults: Array.isArray(config.faults?.custom) && config.faults.custom.length ? config.faults.custom.length : null,
    points: Array.isArray(config.customPoints) && config.customPoints.length ? config.customPoints.length : null,
    size_fields: Array.isArray(config.sizeFields) && config.sizeFields.length ? config.sizeFields.length : null,
    conditions: Array.isArray(config.conditions) && config.conditions.length ? config.conditions.length : null,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null && v !== undefined));
}

/**
 * A model post's `meta` (contract v1.1), or why there is none yet.
 *
 * The domain is required: a model is a place before it is anything else, and
 * the Model Builder has no model until its study area is chosen.
 */
export function buildModelMeta({ state = null, world = "earth", west = false, layerNames = {}, solver = "gales", mesher = "gmsh" } = {}) {
  if (!state?.bounds?.bbox) return { error: "Choose the Model Builder's study area first — a model needs a domain." };
  const raw = modelConfigFromState(state, { west, layerNames });
  const capped = capModelConfig(raw);
  if (capped.error) return capped;
  const a = capped.config.area || {};
  const bbox = [a.west, a.south, a.east, a.north].map((v) => (finite(v) === null ? null : round(Number(v), 5)));
  if (bbox.some((v) => v === null)) return { error: "The study area has no usable bounds." };
  return {
    meta: {
      // The Meshing Studio's choice; the Network accepts the same two names.
      mesher: mesher === "blender" ? "blender" : "gmsh",
      page: modelPagePath(world),
      domain: { world: normWorld(world), bbox },
      solver: String(solver || "gales"),
      params: modelParams(capped.config),
      config: capped.config,
    },
    omitted: capped.omitted,
  };
}

const ENUMS = {
  kind: ["3d", "surface", "section"],
  domainType: ["solid", "fluid", "gas", "thermal"],
  side: ["left", "right"],
};
const positive = (v) => (finite(v) !== null && Number(v) > 0 ? Number(v) : undefined);
const nonNeg = (v) => (finite(v) !== null && Number(v) >= 0 ? Number(v) : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
/** Arrays of plain records from a stored post: capped, and only data -- nothing that is not JSON survives `plain`. */
const records = (v, max = 200) => (Array.isArray(v) ? plain(v.filter((x) => x && typeof x === "object" && !Array.isArray(x)).slice(0, max)) : undefined);
const numberMap = (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out = {};
  for (const [k, n] of Object.entries(v).slice(0, 200)) if (positive(n) !== undefined) out[String(k).slice(0, 80)] = Number(n);
  return out;
};

/**
 * A shared model's settings, as what the Model Builder can take.
 *
 * Every field is checked against the shape the builder keeps -- an enum is
 * one of its values, a size is a positive number -- and anything else is left
 * at the builder's own default rather than passed through: these arrive from
 * somebody else's post. Longitudes come back to the viewer's convention.
 */
export function modelSettingsFromConfig(config, { west = false } = {}) {
  if (!config || typeof config !== "object") return null;
  const c = convertLons(plain(config), toViewer(west));
  const d = c.domain || {};
  const r = c.resolution || {};
  const g = c.grading || {};
  const s = c.sampling || {};
  const a = c.atmosphere || {};
  const L = c.layers || {};
  const f = c.faults || {};
  const area = c.area || {};
  const box = ["west", "south", "east", "north"].every((k) => finite(area[k]) !== null)
    ? { west: Number(area.west), south: Number(area.south), east: Number(area.east), north: Number(area.north) }
    : null;
  return {
    area: box,
    areaLabel: String(area.label || "").slice(0, 120),
    patch: clean({
      kind: ENUMS.kind.includes(c.kind) ? c.kind : undefined,
      meshSizeM: positive(c.meshSizeM),
      domain: clean({
        type: ENUMS.domainType.includes(d.type) ? d.type : undefined,
        depthM: positive(d.depthM),
        materials: d.materials && typeof d.materials === "object" && !Array.isArray(d.materials) ? d.materials : undefined,
      }),
      resolution: clean({ mode: r.mode === "native" || r.mode === "step" ? r.mode : undefined, stepM: positive(r.stepM) }),
      grading: clean({ on: typeof g.on === "boolean" ? g.on : undefined, coarseM: nonNeg(g.coarseM), fineM: nonNeg(g.fineM), slopeRefDeg: positive(g.slopeRefDeg) }),
      sampling: clean({
        mode: s.mode === "variable" || s.mode === "uniform" ? s.mode : undefined,
        baseM: nonNeg(s.baseM), gradeM: positive(s.gradeM), buffers: records(s.buffers, 50),
      }),
      atmosphere: clean({ on: typeof a.on === "boolean" ? a.on : undefined, heightM: positive(a.heightM) }),
      layers: clean({
        soil: typeof L.soil === "boolean" ? L.soil : undefined, water: typeof L.water === "boolean" ? L.water : undefined,
        minSoilM: nonNeg(L.minSoilM), minWaterM: nonNeg(L.minWaterM),
      }),
      faults: clean({
        dipDeg: positive(f.dipDeg), side: ENUMS.side.includes(f.side) ? f.side : undefined,
        depthM: positive(f.depthM), custom: records(f.custom, 50),
      }),
      section: c.section && typeof c.section === "object" && !Array.isArray(c.section) ? c.section : undefined,
      customPoints: records(c.customPoints),
      conditions: records(c.conditions),
    }),
    flags: numberMap(c.flags) || {},
    pointFlagByName: numberMap(c.pointFlagByName) || {},
    pointSizeByName: numberMap(c.pointSizeByName) || {},
    sizeFields: records(c.sizeFields, 100) || [],
    meshOptions: c.meshOptions && typeof c.meshOptions === "object" && !Array.isArray(c.meshOptions) ? c.meshOptions : {},
    roles: (Array.isArray(c.roles) ? c.roles : []).filter((x) => x && x.layer && x.role).slice(0, 100)
      .map((x) => ({ layer: String(x.layer).slice(0, 200), role: String(x.role).slice(0, 40) })),
    omitted: Array.isArray(c.omitted) ? c.omitted.map(String) : [],
  };
}

/**
 * A box as a closed ring of `{lat, lon}` in the VIEWER's longitude, for
 * `setStudyAreaPolygon` -- the one door every study area comes through, so a
 * shared model's domain is the same object a drawn one is. Each edge is
 * subdivided to a degree or less, as the Draw tool's presets are, so a large
 * box follows the ground. `box` is in the viewer's convention already.
 */
export function boxRing(box, maxStepDeg = 1) {
  if (!box || !["west", "south", "east", "north"].every((k) => finite(box[k]) !== null)) return null;
  const s = Math.max(-89.99, Math.min(box.south, box.north));
  const n = Math.min(89.99, Math.max(box.south, box.north));
  const w = Number(box.west);
  let e = Number(box.east);
  if (e <= w) e += 360;   // crosses the antimeridian
  if (!(n > s) || !(e > w)) return null;
  const corners = [{ lat: s, lon: w }, { lat: s, lon: e }, { lat: n, lon: e }, { lat: n, lon: w }];
  const ring = [];
  for (let i = 0; i < corners.length; i += 1) {
    const p = corners[i];
    const q = corners[(i + 1) % corners.length];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(q.lat - p.lat), Math.abs(q.lon - p.lon)) / maxStepDeg));
    for (let k = 0; k < steps; k += 1) {
      ring.push({ lat: p.lat + ((q.lat - p.lat) * k) / steps, lon: p.lon + ((q.lon - p.lon) * k) / steps });
    }
  }
  return ring;
}

/** One line a reader can take in: what the shared model is, in the post's own numbers. */
export function describeModel(meta) {
  const p = meta?.params || {};
  const kinds = { "3d": "3D block", surface: "surface only", section: "2D cross-section" };
  const bits = [
    kinds[p.kind] || "model",
    p.domain,
    p.depth_m ? `${Math.round(p.depth_m).toLocaleString("en")} m deep` : "",
    p.resolution_m === "native" ? "native DEM resolution" : (p.resolution_m ? `${p.resolution_m} m sampling` : ""),
    p.mesh_size_m ? `${p.mesh_size_m} m elements` : "",
    p.atmosphere_m ? `${p.atmosphere_m} m of atmosphere` : "",
    meta?.solver ? `for ${String(meta.solver).toUpperCase()}` : "",
    `meshed with ${meta?.mesher || "gmsh"}`,
  ].filter(Boolean);
  return bits.join(" · ");
}
