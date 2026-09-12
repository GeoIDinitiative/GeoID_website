/**
 * Membership: who is signed in, and what that unlocks.
 *
 * The site is open. Everything a reader can LOOK at stays open to everybody --
 * the globes, the imagery, the surveys, the live feeds, the terrain. What
 * membership unlocks is the work: the risk maps this app MODELS itself, and
 * keeping a project on your own disk.
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
 * UNCONFIGURED MEANS OPEN. Until an auth service is configured (`configure()`,
 * or a `<meta name="geoid-auth">` on the page) nothing is gated at all: asking
 * somebody to sign in to a service that does not exist yet would lock the app
 * against everybody including the people who built it. Deploying the Worker and
 * naming it is what turns membership on.
 */

/** The capabilities membership unlocks. */
export const FEATURES = {
  /** The risk maps this app models itself. Enforced at the bucket. */
  models: {
    id: "models",
    title: "Modelled risk maps",
    blurb: "The hazard models GeoID computes itself — cyclone, volcanic, "
      + "seismic, landslide, flood and sea level.",
    enforced: true,
    // Written out per feature rather than templated from the title: "Modelled
    // risk maps is part of membership" is what a template gives you, and a
    // refusal is the one sentence a reader is guaranteed to read.
    signIn: "Sign in as a member to open the modelled risk maps.",
    notYours: "The modelled risk maps are part of membership — your sign-in "
      + "does not include them yet.",
  },
  /** Keeping a project, and writing files out of it. A courtesy, not a lock. */
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
};

/**
 * The datasets behind `models`, by their own ids.
 *
 * Drawn from `equations.js`'s own division: a layer marked "computed here" is
 * one we model, and a layer marked "modelled elsewhere" is somebody else's
 * published product -- Pelletier's soil thickness, WorldPop's population, the
 * MERRA-2 climate normals -- which is theirs to give away and not ours to
 * charge for. The DEM readings (elevation, slope, hillshade) are computed here
 * and are deliberately NOT in this list: looking at the shape of the ground is
 * exploring, and an explorer keeps it.
 */
export const MEMBER_MODELS = [
  "cyclone-risk",
  "volcanic-risk",
  "volcanic-risk-holocene",
  "seismic-risk",
  "landslide-forecast",
  "geoid-fos",
  "flood-inundation",
  "flood-discharge",
  "river-zones",
  "sea-level",
];

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

/** Is this dataset one of the modelled maps membership unlocks? */
export function isMemberModel(id) {
  return MEMBER_MODELS.includes(String(id || ""));
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
 * Is membership being enforced at all?
 *
 * False with no service configured, and every gate stands open. This is what
 * keeps the app usable before the Worker exists and on any deployment that
 * never wants membership.
 */
export function enforcing() {
  return !!authBase;
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
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(decodeURIComponent(escape(json)));
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
  return {
    signedIn: !!live,
    member: !!(live && claims.member),
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
  if (!FEATURES[feature]) return true;
  return state().member;
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

// Read the page's own configuration, if it states one.
try {
  const meta = document.querySelector('meta[name="geoid-auth"]');
  if (meta?.content) configure(meta.content);
} catch (error) { /* no document: a test, or node */ }
