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
  },
  /** Keeping a project, and writing files out of it. A courtesy, not a lock. */
  save: {
    id: "save",
    title: "Saving and exporting",
    blurb: "Keep a project folder on your own disk, reopen it, and export what "
      + "you make from it.",
    enforced: false,
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
  token = null; claims = null;
  announce();
  return state();
}

export function signOut() {
  claims = null;
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

/** The sentence to show where `feature` is refused. */
export function refusal(feature) {
  const f = FEATURES[feature];
  const what = f ? f.title.toLowerCase() : "this";
  return state().signedIn
    ? `${f ? f.title : "This"} is part of membership — your sign-in does not include it yet.`
    : `Sign in as a member to use ${what}.`;
}

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
