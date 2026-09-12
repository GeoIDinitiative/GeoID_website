/**
 * Membership: who is signed in, and what that unlocks.
 *
 * The site is open. Everything a reader can LOOK at stays open to everybody --
 * the globes, the imagery, the surveys, the live feeds, the terrain, the
 * catalogues and the records. What membership unlocks is the WORK: the risk
 * maps this app models itself, the Hazards tab they live in, the Model Builder,
 * the explorer models, Earth Engine, and keeping a project on your own disk.
 *
 * NOTHING OF THEIRS REACHES US. A project is a folder the member chose, or
 * their browser's own storage, or their own machine through the sidecar; there
 * is no server of ours holding anybody's study. Membership is an entitlement,
 * not an account we file work under, and the sign-in page says so.
 *
 * TWO KINDS OF GATE, and this module is honest about which is which:
 *
 * - The modelled maps are FILES IN OUR BUCKET, so a Worker in front of
 *   `data.geoidinitiative.com` can refuse them without a valid token. That is a
 *   real gate, enforced where the member cannot reach.
 * - Saving and exporting are the browser's own filesystem in the member's own
 *   browser. No gate on that can be enforced by anybody, ever. The app asks and
 *   respects the answer; somebody determined opens devtools and does not. Most
 *   people never would, and pretending otherwise would be the dishonest part.
 *
 * So what is here is the ASKING, kept in one place so a gate reads the same
 * wherever it is drawn, and so the enforcement -- when the Worker is deployed --
 * has exactly one thing to agree with.
 *
 * THE MASTER ACCOUNT is `plan: "owner"` on a KV entry, for the people who build
 * this: it opens every feature including ones added later, so the site can be
 * worked on with every gate ON -- exactly as a visitor sees it -- rather than
 * only with membership switched off.
 *
 * LOCKED IS THE DEFAULT. In the absence of a membership a feature is locked --
 * that is what the gates are for, and a lock nobody can see is not a lock. It
 * was the other way round at first, so that a gate could not lock the app
 * before the sign-in existed; that made every gate invisible on the one machine
 * where they were being built, which is worse.
 *
 * So there are two deliberate ways out rather than an accidental one:
 * `<meta name="geoid-membership" content="off">` turns every gate off for a
 * deployment, and `localStorage["geoid:unlock"]` unlocks one browser for
 * working on the site before the Worker is up. Naming an auth service
 * (`configure()`, or `<meta name="geoid-auth">`) is what makes SIGNING IN
 * possible; it is not what makes the gates exist.
 */

/**
 * The capabilities membership unlocks.
 *
 * ONE ENTRY PER SUBTAB that holds a model GeoID computes itself, rather than
 * one per tab. Locking Hazards whole shut the wildfire feed, the exposure map
 * and the drought rows with it — other people's open data, which is not ours to
 * charge for — so the gate is on the subtabs and everything beside them in the
 * same tab stays open.
 */
export const FEATURES = {
  /** myGeoID: the Factor-of-Safety mode bar and the pipeline behind it. */
  mygeoid: {
    id: "mygeoid",
    title: "myGeoID",
    blurb: "The Factor-of-Safety hazard model — pick a place and read the "
      + "slope stability GeoID computes for it.",
    enforced: false,
    signIn: "Sign in as a member to use myGeoID.",
    notYours: "myGeoID is part of membership — your sign-in does not include it "
      + "yet.",
  },
  landslides: {
    id: "landslides",
    title: "Landslides",
    blurb: "The forecast landslide and rockfall model: rainfall, a water "
      + "balance over the real drainage, and slope stability per cell.",
    enforced: false,
    signIn: "Sign in as a member to open the landslide models.",
    notYours: "The landslide models are part of membership — your sign-in does "
      + "not include them yet.",
  },
  flood: {
    id: "flood",
    title: "Flood",
    blurb: "River flood inundation by scenario and by discharge, on the "
      + "streamed terrain and the mapped channels.",
    enforced: false,
    signIn: "Sign in as a member to open the flood models.",
    notYours: "The flood models are part of membership — your sign-in does not "
      + "include them yet.",
  },
  /** The three baked risk grids. Each one is a file in our own bucket. */
  "cyclone-risk": {
    id: "cyclone-risk",
    title: "Tropical cyclone risk",
    blurb: "How often a cyclone passes within 200 km, from every best-track "
      + "record since 1842.",
    enforced: true,
    signIn: "Sign in as a member to open the cyclone risk map.",
    notYours: "The cyclone risk map is part of membership — your sign-in does "
      + "not include it yet.",
  },
  "seismic-risk": {
    id: "seismic-risk",
    title: "Seismic risk",
    blurb: "Damaging shaking by magnitude, from the merged USGS, ISC-GEM and "
      + "GEM historical record.",
    enforced: true,
    signIn: "Sign in as a member to open the seismic risk map.",
    notYours: "The seismic risk map is part of membership — your sign-in does "
      + "not include it yet.",
  },
  "volcanic-risk": {
    id: "volcanic-risk",
    title: "Volcanic risk",
    blurb: "Ashfall of at least a millimetre, by eruption size, over the "
      + "completeness window and over the whole Holocene record.",
    enforced: true,
    signIn: "Sign in as a member to open the volcanic risk maps.",
    notYours: "The volcanic risk maps are part of membership — your sign-in "
      + "does not include them yet.",
  },
  sealevel: {
    id: "sealevel",
    title: "Sea level",
    blurb: "Where the sea stands at a chosen level, spread from the real "
      + "coastline through the streamed heights.",
    enforced: false,
    signIn: "Sign in as a member to open the sea level model.",
    notYours: "The sea level model is part of membership — your sign-in does "
      + "not include it yet.",
  },
  rockprops: {
    id: "rockprops",
    title: "Rock properties",
    blurb: "Strength, permeability and the rest of the geotechnical database, "
      + "mapped onto the world's geology.",
    enforced: false,
    signIn: "Sign in as a member to open the rock property maps.",
    notYours: "The rock property maps are part of membership — your sign-in "
      + "does not include them yet.",
  },
  /** The Model Builder and the Meshing Studio behind it. */
  builder: {
    id: "builder",
    title: "Model Builder",
    blurb: "Sample the ground into a surface, build a domain, set the mesh and "
      + "package it for a solver.",
    enforced: false,
    signIn: "Sign in as a member to open the Model Builder.",
    notYours: "The Model Builder is part of membership — your sign-in does not "
      + "include it yet.",
  },
  /**
   * Keeping a project, and writing files out of it.
   *
   * NOT a subtab, and kept from the earlier round where it was asked for by
   * name ("membership should allow them to save their work and folders
   * locally"). A courtesy gate: this is the browser's own filesystem in the
   * member's own browser and nothing can enforce it.
   */
  save: {
    id: "save",
    title: "Saving and exporting",
    blurb: "Keep a project folder on your own disk, reopen it, and export what "
      + "you make from it.",
    enforced: false,
    signIn: "Sign in as a member to save and export your work.",
    notYours: "Saving and exporting are part of membership — your sign-in does "
      + "not include them yet.",
  },
  /**
   * Earth Engine, which is the one thing here that costs money PER USE.
   *
   * Not a subtab either, and kept for the same reason as `save`: it was asked
   * for by name, and unlocking it means anybody may spend the account's money.
   * Every request goes through our own billed Cloud Function, so this is the
   * one refusal that can be made where the reader cannot reach.
   */
  gee: {
    id: "gee",
    title: "Earth Engine",
    blurb: "Fetch satellite imagery, rainfall and land-surface data over an "
      + "area you draw, from Google Earth Engine's whole published catalogue.",
    enforced: true,
    signIn: "Sign in as a member to fetch from Earth Engine.",
    notYours: "Earth Engine is part of membership — your sign-in does not "
      + "include it yet.",
  },
};

/**
 * Which feature a catalogue dataset or sheet belongs to.
 *
 * Keyed by the dataset's OWN id -- the same id `equations.js` uses for its
 * working -- so the gate on a row and the gate on the subtab holding it are one
 * decision rather than two lists to keep in step.
 *
 * WHAT IS NOT HERE IS FREE, and each absence is deliberate. River corridor
 * zones are computed here and are open. So are the DEM readings (elevation,
 * slope, hillshade): looking at the shape of the ground is exploring. So is
 * everything somebody else published -- Pelletier's soil thickness, WorldPop,
 * the MERRA-2 normals -- which is theirs to give away and not ours to charge
 * for.
 */
export const MEMBER_MODELS = {
  "cyclone-risk": "cyclone-risk",
  "seismic-risk": "seismic-risk",
  "volcanic-risk": "volcanic-risk",
  "volcanic-risk-holocene": "volcanic-risk",
  "landslide-forecast": "landslides",
  "geoid-fos": "mygeoid",
  "flood-inundation": "flood",
  "flood-discharge": "flood",
  "sea-level": "sealevel",
};

/** The feature a dataset needs, or "" where it needs none. */
export function featureForModel(id) {
  return MEMBER_MODELS[String(id || "")] || "";
}

/** Is this dataset behind a membership at all? */
export function isMemberModel(id) {
  return !!featureForModel(id);
}

/**
 * The paths in our bucket that only a member may read.
 *
 * SIX OF THE TEN MODELS ARE NOT HERE, and that is a fact about them rather
 * than an oversight: sea level, both river floods, the corridor zones and the
 * two forecast pipelines are computed IN THE BROWSER, from the streamed DEM,
 * GRWL's rivers, the coastline and HydroLAKES -- other people's open data,
 * which we redistribute and which is theirs to give away. There is no file of
 * ours to refuse, so their gate is the courtesy one and always will be.
 *
 * What is left is the four baked grids, which really are ours and really are
 * enforced. `data-gate/worker.js` carries the same list and a test holds the
 * two equal, because a gate and its enforcement drifting apart is a gate that
 * has quietly opened.
 */
export const MEMBER_DATA = [
  "cyclone-risk",
  "seismic-risk",
  "volcanic-risk",        // covers volcanic-risk-holocene
];

/**
 * Is this bucket path behind membership?
 *
 * Matched on the path's own first segment against a prefix, so
 * `volcanic-risk/3/4/5.mvt` and `volcanic-risk.geojson` are both caught while
 * a future `cyclone-risk-is-open.geojson` would be too -- which is the safe
 * direction. Leading slashes and a `data/global/` prefix are both tolerated,
 * because the site says one and the bucket says the other.
 */
export function gatedData(path) {
  const clean = String(path || "").replace(/^\/+/, "").replace(/^data\/global\//, "");
  return MEMBER_DATA.some((p) => clean === p || clean.startsWith(`${p}.`) || clean.startsWith(`${p}/`)
    || clean.startsWith(`${p}-`));
}

const TOKEN_KEY = "geoid:membership";
const listeners = [];

let authBase = null;   // the Worker's origin; null until configured
let token = null;      // the signed membership token, as issued
let claims = null;     // its payload, read for DISPLAY only

/**
 * Point the seam at an auth service.
 *
 * Also read from `<meta name="geoid-auth" content="https://...">` so a page can
 * turn membership on without a code change, and so a local build can leave it
 * off and behave exactly as the site did before any of this existed.
 */
export function configure(base) {
  const url = String(base || "").trim().replace(/\/$/, "");
  authBase = url || null;
  announce();
  return authBase;
}

export function authService() {
  return authBase;
}

/**
 * Is membership being enforced?
 *
 * ON BY DEFAULT. In the absence of a membership a feature is LOCKED — that is
 * what the gates are for, and a lock nobody can see is not a lock.
 *
 * This was the other way round at first, on the reasoning that asking somebody
 * to sign in to a service that is not deployed yet locks the app against
 * everybody. True, and it made every gate invisible on the one machine where
 * they were being built, which is worse: the locks have to be VISIBLE before
 * the sign-in exists, or nobody can see what they have built or what a visitor
 * will meet.
 *
 * Two ways out, and both are deliberate rather than accidental:
 *
 *   <meta name="geoid-membership" content="off">   a deployment with no gates
 *   localStorage["geoid:unlock"] = "owner"          this browser, for working
 *
 * The second is a development key, and it weakens nothing that was not already
 * weak: every gate in the browser is a courtesy the module's own header calls
 * one, and the gate that is actually enforced is at the bucket, which does not
 * read it. It exists so the site can be worked on before the Worker is up.
 */
export function enforcing() {
  return !disabled;
}

let disabled = false;

/** Turn every gate off for this deployment. A page says so, or a test does. */
export function disable(off = true) {
  disabled = !!off;
  announce();
  return disabled;
}

/**
 * The development unlock: this browser, until it is cleared.
 *
 * Read fresh each time rather than cached, so setting it in a console takes
 * effect on the next thing that asks rather than on the next reload.
 */
function localUnlock() {
  try {
    return window.localStorage.getItem("geoid:unlock") || "";
  } catch (error) {
    return "";
  }
}

/**
 * The payload of a signed token, WITHOUT verifying it.
 *
 * A browser cannot verify anything an attacker also controls, so this is for
 * drawing a name and an expiry and nothing else. The bucket is what checks the
 * signature, and it is the only check that means anything.
 */
export function readClaims(raw) {
  const parts = String(raw || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const binary = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    /**
     * TextDecoder, not `decodeURIComponent(escape(...))`.
     *
     * The service signs its payload with TextEncoder, so what arrives is UTF-8
     * bytes base64'd — and `atob` gives those bytes back one per code unit.
     * `escape` is deprecated and is the wrong tool besides: it throws on a name
     * that is Latin-1 rather than UTF-8, which is exactly what a hand-made test
     * token is, and a thrown decode reads as "not signed in" rather than as a
     * decode fault. This is the same pair the Worker uses at the other end.
     */
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload && typeof payload === "object" ? payload : null;
  } catch (error) {
    return null;
  }
}

/** Seconds since the epoch, as a token's `exp` is written. */
const now = () => Math.floor(Date.now() / 1000);

/** Has this payload run out? A token with no expiry is treated as expired. */
export function expired(payload, at = now()) {
  const exp = Number(payload?.exp);
  return !Number.isFinite(exp) || exp <= at;
}

/**
 * Read the stored token, once, and again whenever it may have changed.
 *
 * `token` is null when nothing has been read yet and a string once it has, so
 * a sign-out sets it back to null rather than to "": the next read then comes
 * off storage again, which is what lets another TAB's sign-in reach this one.
 */
function load() {
  if (token !== null) return;
  let raw = null;
  try { raw = window.localStorage.getItem(TOKEN_KEY); } catch (error) { raw = null; }
  token = raw || "";
  claims = raw ? readClaims(raw) : null;
  if (claims && expired(claims)) { token = ""; claims = null; forget(); }
}

function forget() {
  try { window.localStorage.removeItem(TOKEN_KEY); } catch (error) { /* fine */ }
}

/** Take a token issued by the auth service. Returns the state it produced. */
export function accept(raw) {
  const payload = readClaims(raw);
  if (!payload || expired(payload)) {
    claims = null; forget(); token = null; announce();
    return state();
  }
  token = String(raw);
  claims = payload;
  try { window.localStorage.setItem(TOKEN_KEY, token); } catch (error) { /* fine */ }
  announce();
  return state();
}

/**
 * Drop the cached token and read storage again.
 *
 * Anything that reads the state re-caches it, so a token written into storage
 * from outside this module -- another tab, the sign-in page's own handoff --
 * is invisible until something says so. This is that saying.
 */
export function refresh() {
  token = null; claims = null; forgetPass();
  announce();
  return state();
}

export function signOut() {
  claims = null;
  forgetPass();
  forget();
  token = null;   // uncached, so the next read comes off storage

  announce();
  return state();
}

/**
 * Who is signed in, and what they hold.
 *
 * `member` is the claim the token carries; `signedIn` is only that a token
 * exists, since somebody may sign in and not be a member. The two are separate
 * on purpose -- a signed-in explorer should be greeted by name and still be
 * told what membership would add.
 */
export function state() {
  load();
  const live = claims && !expired(claims);
  const unlocked = localUnlock();
  const plan = (live && claims.plan) || (unlocked ? "owner" : "");
  return {
    signedIn: !!live,
    member: !!(live && claims.member) || !!unlocked,
    /**
     * THE MASTER ACCOUNT. `plan: "owner"` in the KV entry, for the people who
     * build this — so the site can be worked on with every gate on, exactly as
     * a visitor sees it, rather than only with membership switched off.
     *
     * It opens every feature INCLUDING ONES ADDED LATER, which is the whole
     * point of it being a separate flag rather than a long list: a gate written
     * next year should not need somebody to remember to add the operators to
     * it. An owner is a member too, so nothing has to test for both.
     */
    owner: plan === "owner",
    /** True when this browser is unlocked locally rather than by a sign-in. */
    localUnlock: !!unlocked,
    plan: plan || (live && claims.member ? "member" : "explorer"),
    name: (live && (claims.name || claims.email)) || "",
    email: (live && claims.email) || "",
    until: live && Number.isFinite(Number(claims.exp)) ? Number(claims.exp) : 0,
    enforcing: enforcing(),
  };
}

/** The token, for a request that must carry it. Empty when there is none. */
export function bearer() {
  load();
  return claims && !expired(claims) ? token : "";
}

/**
 * May this reader use `feature`?
 *
 * Open when nothing is configured, so the answer is yes on a build with no
 * membership at all. An unknown feature is open too: a gate nobody declared is
 * not a gate, and failing closed there would lock a capability by typo.
 */
export function may(feature) {
  if (!enforcing()) return true;
  if (localUnlock()) return true;
  if (!FEATURES[feature]) return true;
  const live = state();
  // An owner is answered before the feature is even looked at, so a gate added
  // after this line was written opens for them without being told to.
  return live.owner || live.member;
}

/**
 * The sentence to show where `feature` is refused.
 *
 * Two of them, because signed-in-and-not-a-member is a different thing to say
 * than signed-out: one asks somebody to sign in, and the other would be telling
 * a person who HAS to do it again.
 */
export function refusal(feature) {
  const f = FEATURES[feature];
  if (!f) return "That is part of membership.";
  // With no sign-in service yet, "sign in" is an instruction nobody can follow.
  // Saying membership is not open is the honest form of the same refusal.
  if (!authBase) {
    // NOT the title templated in: "Modelled risk maps is part of membership" is
    // what that gives, which is the fault the two sentences below exist to
    // avoid. The card beside this one already names what is locked.
    return "This is part of membership, which is not open for sign-in yet.";
  }
  return state().signedIn ? f.notYours : f.signIn;
}

// ── The bucket pass ─────────────────────────────────────────────────────────

let pass = "";
let passExp = 0;
let passInFlight = null;

/**
 * A short-lived pass for the data bucket, fetched and kept until it nearly runs
 * out.
 *
 * SEPARATE FROM THE SESSION TOKEN, and the reason is where it travels: the
 * bucket is read by three.js's texture loader and by geotiff's range requests
 * as well as by `fetch`, and only a query string reaches all three. A query
 * string is logged, so the thing that goes in one is worth fifteen minutes and
 * cannot be used to ask who anybody is.
 *
 * Answers "" for everything that is not a member holding a live session --
 * including no service configured -- so a caller never has to ask twice.
 */
export async function dataPass() {
  if (!enforcing()) return "";
  const live = state();
  if (!live.member) { pass = ""; passExp = 0; return ""; }
  // A minute of slack: a pass that expires while a hundred tiles are in flight
  // is a layer that half loads.
  if (pass && passExp - 60 > now()) return pass;
  if (passInFlight) return passInFlight;
  passInFlight = (async () => {
    try {
      const res = await fetch(`${authBase}/auth/data-token`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer()}` },
      });
      if (!res.ok) { pass = ""; passExp = 0; return ""; }
      const body = await res.json();
      pass = String(body.token || "");
      passExp = Number(body.expires) || 0;
      return pass;
    } catch (error) {
      // The service being unreachable is not the same as being refused, and
      // neither is worth throwing over: the bucket answers 402 and the layer
      // says so.
      pass = ""; passExp = 0;
      return "";
    } finally {
      passInFlight = null;
    }
  })();
  return passInFlight;
}

/** Forget the pass — on a sign-out, or when a fetch says it is no longer good. */
export function forgetPass() { pass = ""; passExp = 0; }

export function onChange(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function announce() {
  const snapshot = state();
  listeners.forEach((fn) => { try { fn(snapshot); } catch (error) { /* a listener's own */ } });
  try {
    document.dispatchEvent(new CustomEvent("geoid:membership", { detail: snapshot }));
  } catch (error) { /* no document, or no CustomEvent: nothing to tell */ }
}

/** Where to send somebody to sign in, coming back to where they are now. */
export function signInUrl(returnTo) {
  const back = returnTo || (typeof location !== "undefined" ? location.href : "/");
  return `/sign-in/?return=${encodeURIComponent(back)}`;
}

/**
 * Another tab's sign-in or sign-out reaches this one.
 *
 * Guarded on the LISTENER rather than on `window`: a test stubs `window` as a
 * bare object with no `addEventListener`, and a module that throws at import
 * takes every suite importing its importer down with it. This tree has paid for
 * that twice.
 */
try {
  if (typeof window?.addEventListener === "function") {
    window.addEventListener("storage", (event) => {
      if (event && event.key && event.key !== TOKEN_KEY) return;
      refresh();
    });
  }
} catch (error) { /* no window: node, or a test */ }

/**
 * The seam for code that is not a module.
 *
 * `earth-viewer.js` and the nine planet viewers are plain scripts loaded with
 * their own stamp, so they cannot import this — and a stamped import from one of
 * them would be a SECOND instance with its own token anyway, which is the
 * module-identity trap this tree records. A global is the one thing every realm
 * on the page agrees about.
 */
try {
  if (typeof window !== "undefined") {
    window.GeoIDMembership = {
      may, refusal, state, enforcing, signInUrl, onChange, FEATURES,
    };
  }
} catch (error) { /* no window: node, or a test */ }

// Read the page's own configuration, if it states any.
try {
  const meta = document.querySelector('meta[name="geoid-auth"]');
  if (meta?.content) configure(meta.content);
  const off = document.querySelector('meta[name="geoid-membership"]');
  if (off && /^off$/i.test(off.content || "")) disable(true);
} catch (error) { /* no document: a test, or node */ }
