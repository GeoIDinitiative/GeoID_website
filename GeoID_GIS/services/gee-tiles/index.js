/**
 * Earth Engine image service for GeoHUB.
 *
 * The viewer is a static site, so it cannot hold Earth Engine credentials: a
 * service account key shipped to the browser would be readable by anyone. This
 * runs the Earth Engine calls instead and hands back a plain PNG and its
 * bounds, which the page can drape on the globe without knowing anything about
 * Earth Engine or holding any credential.
 *
 * Deploy as a Cloud Function or Cloud Run service in the same project the
 * service account belongs to. See README.md.
 */

const ee = require("@google/earthengine");

// Collections offered to the page, CURATED: each carries a band choice, a
// stretch and a legend chosen for legibility, and the two anomaly products
// exist only here. Anything not in this list is resolved from Earth Engine's
// own public STAC catalogue instead (see `stacConfig`), so the service serves
// the whole catalogue without a caller being able to name an arbitrary asset:
// an id has to appear in Google's published catalogue to be requestable, and
// a private or user asset does not.
const DATASETS = {
  "COPERNICUS/S2_SR_HARMONIZED": {
    startDate: "2017-03-28",
    name: "Sentinel-2 surface reflectance",
    bands: ["B4", "B3", "B2"],
    min: 0,
    max: 3000,
    scale: 10,
    cloudProperty: "CLOUDY_PIXEL_PERCENTAGE",
    attribution: "Copernicus Sentinel-2, processed by ESA",
  },
  "LANDSAT/LC09/C02/T1_L2": {
    startDate: "2021-10-31",
    name: "Landsat 9 surface reflectance",
    bands: ["SR_B4", "SR_B3", "SR_B2"],
    min: 7000,
    max: 20000,
    scale: 30,
    cloudProperty: "CLOUD_COVER",
    attribution: "USGS/NASA Landsat 9",
  },
  "COPERNICUS/S1_GRD": {
    startDate: "2014-10-03",
    name: "Sentinel-1 SAR (GRD)",
    bands: ["VV"],
    min: -25,
    max: 0,
    scale: 10,
    attribution: "Copernicus Sentinel-1, processed by ESA",
  },
  "NASA/NASADEM_HGT/001": {
    name: "NASADEM elevation",
    bands: ["elevation"],
    min: 0,
    max: 3000,
    scale: 30,
    single: true,
    attribution: "NASA JPL NASADEM",
  },
  "COPERNICUS/DEM/GLO30": {
    name: "Copernicus GLO-30 DEM",
    bands: ["DEM"],
    min: 0,
    max: 3000,
    scale: 30,
    mosaic: true,
    attribution: "Copernicus DEM GLO-30, ESA",
  },
  "MODIS/061/MOD11A1": {
    legend: { label: "Day LST", min: -13, max: 57, unit: "°C" },
    name: "MODIS land surface temperature",
    bands: ["LST_Day_1km"],
    min: 13000,
    max: 16500,
    scale: 1000,
    palette: ["040274", "3ac2ff", "ffd25f", "ff6f31", "911003"],
    attribution: "NASA LP DAAC MODIS MOD11A1",
  },
  "UCSB-CHG/CHIRPS/DAILY": {
    legend: { label: "Rainfall", min: 0, max: 300, unit: "mm" },
    name: "Rainfall (CHIRPS)",
    bands: ["precipitation"],
    min: 0,
    max: 300,
    scale: 5000,
    palette: ["ffffff", "bfe9ff", "2f6bff", "0b2f8a"],
    reducer: "sum",
    attribution: "UCSB/CHG CHIRPS",
  },

  // The two other high-resolution rainfall archives, for the landslide
  // forecast's historical maps. Rendered on CHIRPS's own 0-300 mm ramp so the
  // page can invert the picture back to millimetres the same way. `multiply`
  // turns each band into mm: IMERG is mm/h every half hour, ERA5-Land metres.
  "NASA/GPM_L3/IMERG_V07": {
    legend: { label: "Rainfall", min: 0, max: 300, unit: "mm" },
    name: "Rainfall (GPM IMERG V07)",
    bands: ["precipitation"],
    min: 0,
    max: 300,
    scale: 11132,
    palette: ["ffffff", "bfe9ff", "2f6bff", "0b2f8a"],
    reducer: "sum",
    multiply: 0.5,
    attribution: "NASA GPM IMERG V07",
  },
  "JAXA/GPM_L3/GSMaP/v8/operational": {
    legend: { label: "Rainfall", min: 0, max: 300, unit: "mm" },
    name: "Rainfall (GSMaP operational)",
    bands: ["hourlyPrecipRate"],
    min: 0,
    max: 300,
    scale: 11132,
    palette: ["ffffff", "bfe9ff", "2f6bff", "0b2f8a"],
    reducer: "sum",
    attribution: "JAXA GSMaP v8 operational",
  },
  "ECMWF/ERA5_LAND/DAILY_AGGR": {
    legend: { label: "Rainfall", min: 0, max: 300, unit: "mm" },
    name: "Rainfall (ERA5-Land)",
    bands: ["total_precipitation_sum"],
    min: 0,
    max: 300,
    scale: 11132,
    palette: ["ffffff", "bfe9ff", "2f6bff", "0b2f8a"],
    reducer: "sum",
    multiply: 1000,
    attribution: "Copernicus Climate Change Service ERA5-Land",
  },

  // ── Climate layers ───────────────────────────────────────────────────────
  // Processed here rather than stored: the point of this service is that the
  // site keeps no archive and asks for a finished picture instead.
  "MODIS/061/MOD13A2": {
    legend: { label: "NDVI", min: 0, max: 0.8, unit: "" },
    name: "Vegetation health (NDVI)",
    bands: ["NDVI"],
    min: 0,
    max: 8000,
    scale: 1000,
    // Bare through stressed to healthy, so the reading is immediate.
    palette: ["a6611a", "dfc27d", "f5f5f5", "80cdc1", "018571"],
    attribution: "NASA LP DAAC MODIS MOD13A2",
  },
  "NASA/SMAP/SPL4SMGP/007": {
    legend: { label: "Soil moisture", min: 0.05, max: 0.5, unit: "m³/m³" },
    name: "Soil moisture (SMAP)",
    bands: ["sm_surface"],
    min: 0.05,
    max: 0.5,
    scale: 10000,
    palette: ["8c510a", "d8b365", "f6e8c3", "c7eae5", "5ab4ac", "01665e"],
    attribution: "NASA SMAP L4",
  },
  "MODIS/061/MOD11A2": {
    legend: { label: "Day LST", min: -13, max: 57, unit: "°C" },
    name: "Land surface temperature",
    bands: ["LST_Day_1km"],
    min: 13000,
    max: 16500,
    scale: 1000,
    palette: ["040274", "3ac2ff", "ffd25f", "ff6f31", "911003"],
    attribution: "NASA LP DAAC MODIS MOD11A2",
  },
  "MODIS/061/MCD64A1": {
    legend: { label: "Burn day of year", min: 1, max: 366, unit: "" },
    name: "Burned area",
    bands: ["BurnDate"],
    min: 1,
    max: 366,
    scale: 500,
    palette: ["ffffb2", "fecc5c", "fd8d3c", "f03b20", "bd0026"],
    attribution: "NASA LP DAAC MODIS MCD64A1",
  },

  // Anomalies: the request window against a long-term baseline for the same
  // days of the year. This is the part that turns a dataset into a product --
  // "wetter or drier than normal" is read at a glance where a rainfall total is
  // not.
  "anomaly/CHIRPS": {
    legend: { label: "Rainfall anomaly", min: -150, max: 150, unit: "mm" },
    name: "Rainfall anomaly",
    source: "UCSB-CHG/CHIRPS/DAILY",
    bands: ["precipitation"],
    reducer: "sum",
    anomaly: { baselineFrom: "1991-01-01", baselineTo: "2020-12-31" },
    min: -150,
    max: 150,
    scale: 5000,
    palette: ["8c510a", "d8b365", "f6e8c3", "ffffff", "c7eae5", "5ab4ac", "01665e"],
    attribution: "UCSB/CHG CHIRPS, anomaly against 1991-2020",
  },
  "anomaly/LST": {
    legend: { label: "LST anomaly", min: -16, max: 16, unit: "°C" },
    name: "Land surface temperature anomaly",
    source: "MODIS/061/MOD11A2",
    bands: ["LST_Day_1km"],
    anomaly: { baselineFrom: "2003-01-01", baselineTo: "2022-12-31" },
    min: -800,
    max: 800,
    scale: 1000,
    palette: ["040274", "3ac2ff", "ffffff", "ff6f31", "911003"],
    attribution: "NASA MODIS MOD11A2, anomaly against 2003-2022",
  },
};

const MAX_PIXELS = 1024;

/* ── The rest of the catalogue, from Earth Engine's own STAC ─────────────── */

const STAC_ROOT = "https://storage.googleapis.com/earthengine-stac/catalog/catalog.json";
const stacCache = new Map();     // id -> config | null (a miss is worth caching)
let stacIndexPromise = null;     // id -> record URL, for the ids that need it

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

/**
 * Every dataset's record URL, built once per warm instance.
 *
 * Only reached when the derived URL misses: 109 of the 1,139 datasets are
 * named `projects/<owner>/assets/…` and filed under a provider folder that
 * is nothing like their first path segment, so the id alone cannot locate
 * them. 131 small requests, about two seconds, and then never again.
 */
function stacIndex() {
  if (stacIndexPromise) return stacIndexPromise;
  stacIndexPromise = (async () => {
    const root = await getJson(STAC_ROOT);
    const providers = root.links.filter((l) => l.rel === "child").map((l) => l.href);
    const catalogs = await Promise.all(providers.map((u) => getJson(u).catch(() => null)));
    const index = new Map();
    catalogs.filter(Boolean).forEach((catalog) => {
      (catalog.links || []).filter((l) => l.rel === "child").forEach((link) => {
        // The child's title is the id with its separators flattened, which is
        // enough to key on once the same flattening is applied to a query.
        index.set(String(link.title || ""), link.href);
      });
    });
    return index;
  })().catch((error) => {
    stacIndexPromise = null;                 // a failed build must not be cached
    throw error;
  });
  return stacIndexPromise;
}

async function stacRecord(id) {
  const flat = id.replace(/\//g, "_");
  const provider = id.split("/")[0];
  const derived =
    `https://storage.googleapis.com/earthengine-stac/catalog/${provider}/${flat}.json`;
  try {
    return await getJson(derived);
  } catch {
    const index = await stacIndex();
    const href = index.get(flat);
    if (!href) return null;
    return getJson(href);
  }
}

/**
 * A STAC record as this service's own config shape.
 *
 * The visualisation is GOOGLE'S OWN — `summaries["gee:visualizations"]` is
 * how the dataset is drawn in Earth Engine's catalogue — so an arbitrary
 * dataset arrives looking the way its publisher meant it to, rather than
 * under a band choice and a stretch this service guessed at.
 */
function configFromStac(record) {
  const kind = record["gee:type"];
  if (kind !== "image" && kind !== "image_collection") {
    return { unsupported: `"${record.id}" is a ${kind || "non-image"} dataset. `
      + "This service drapes rasters; tables are not images." };
  }
  const vis = (record.summaries?.["gee:visualizations"] || [])
    .map((v) => v.image_visualization?.band_vis)
    .find(Boolean);
  if (!vis?.bands?.length) {
    return { unsupported: `"${record.id}" publishes no default visualisation, `
      + "so there is no band choice to render it with." };
  }
  /**
   * A CLASSIFICATION carries its own colour table instead of a stretch.
   *
   * Land cover — ESA WorldCover, Copernicus, Dynamic World — publishes no
   * min/max at all: the band's `gee:classes` names each value's colour, and
   * that is what Earth Engine's own catalogue draws it from. The values are
   * arbitrary (10, 20, 30, 95…), so the render remaps them onto 0..n-1 and
   * hands `visualize` a palette in that order; stretching the raw values
   * instead paints a land cover map as a grey ramp.
   */
  const classes = classTable(record, vis.bands);
  if (classes) {
    return {
      ...baseFrom(record, vis),
      classes,
      bands: vis.bands,
      min: 0,
      max: classes.length - 1,
      palette: classes.map((c) => c.color),
      legend: null,        // a class list is not a ramp; the page lists them
      classLegend: classes.map((c) => ({ value: c.value, colour: c.color, label: c.label })),
    };
  }
  if (vis.min === undefined || vis.max === undefined) {
    return { unsupported: `"${record.id}" publishes neither a stretch nor a `
      + "class table, so there is nothing to render its bands with." };
  }
  return { ...baseFrom(record, vis), bands: vis.bands,
    min: vis.min, max: vis.max, gamma: vis.gamma,
    palette: vis.palette || null, legend: legendFrom(record, vis) };
}

/** Everything a config needs that is not about how the pixels are coloured. */
function baseFrom(record, vis) {
  const gsd = record.summaries?.gsd;
  const scale = Array.isArray(gsd)
    ? Math.min(...gsd.filter((n) => Number.isFinite(n))) : gsd;
  const kind = record["gee:type"];
  return {
    name: record.title || record.id,
    scale: Number.isFinite(scale) ? scale : undefined,
    single: kind === "image",
    startDate: (record.extent?.temporal?.interval?.[0]?.[0] || "").slice(0, 10) || undefined,
    endDate: (record.extent?.temporal?.interval?.[0]?.[1] || "").slice(0, 10) || undefined,
    attribution: [record.providers?.[0]?.name, record.license]
      .filter(Boolean).join(" · ") || "Google Earth Engine",
    fromCatalogue: true,
  };
}

/** The class table of a single classification band, or null. */
function classTable(record, bands) {
  if (bands.length !== 1) return null;
  const band = (record.summaries?.["eo:bands"] || []).find((b) => b.name === bands[0]);
  const classes = band?.["gee:classes"] || [];
  // Past a couple of hundred this is a lookup table rather than a legend, and
  // LANDFIRE publishes 24,201 of them — a palette no thumbnail can carry.
  if (!classes.length || classes.length > 200) return null;
  return classes
    .filter((c) => c.value !== undefined && c.color)
    .map((c) => ({ value: c.value, color: c.color, label: c.description || String(c.value) }));
}

/** A one-band ramp IS a legend; a three-band composite is not. */
function legendFrom(record, vis) {
  // Its unit, where the record states one, is what lets the page label the
  // ramp — and `gee-sample.js` invert it, so an arbitrary drape can be
  // extracted to numbers like the curated ones.
  if (vis.bands.length !== 1 || !vis.palette) return null;
  const units = (record.summaries?.["eo:bands"] || [])
    .find((b) => b.name === vis.bands[0])?.["gee:units"];
  const min = first(vis.min);
  const max = first(vis.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { label: record.title || record.id, min, max, unit: units || "" };
}

function first(value) {
  return Number(Array.isArray(value) ? value[0] : value);
}

/** The config for any id: the curated one, else the published catalogue's. */
async function configFor(id) {
  if (DATASETS[id]) return DATASETS[id];
  if (stacCache.has(id)) return stacCache.get(id);
  let config = null;
  try {
    const record = await stacRecord(id);
    config = record ? configFromStac(record) : null;
  } catch (error) {
    // Not cached: a transient failure reading a static JSON file must not
    // make a real dataset permanently unknown to a warm instance.
    throw new Error(`Could not read the Earth Engine catalogue: ${error.message}`);
  }
  stacCache.set(id, config);
  return config;
}

let readyPromise = null;
const dateCache = new Map();

/** Authenticates once per instance and reuses it across requests. */
function ready() {
  if (readyPromise) return readyPromise;
  // Supplied by the runtime, never by the caller. On Cloud Functions and Cloud
  // Run this is the service account attached to the deployment.
  const key = process.env.EE_SERVICE_ACCOUNT_KEY
    ? JSON.parse(process.env.EE_SERVICE_ACCOUNT_KEY)
    : null;
  if (key) {
    readyPromise = authViaKey(key);
    return readyPromise;
  }
  // Deliberately not cached: each call re-checks the token, which is what
  // keeps a warm instance working past the first token's hour.
  return authViaAdc();
}

function authViaKey(key) {
  return new Promise((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      key,
      () => ee.initialize(null, null, resolve, reject),
      reject,
    );
  });
}

/**
 * Application default credentials -- the service account attached to the
 * deployment, with no key file anywhere.
 *
 * The Earth Engine client has no entry point for this: it offers OAuth, a popup
 * and a private key, and nothing that reads ADC. A token is fetched separately
 * and handed to the client instead.
 */
let adcClient = null;
let eeInitialized = false;

/**
 * Application default credentials, refreshed per request.
 *
 * The first version set a token once at boot and registered a refresher with
 * the Earth Engine client. Its callback contract was evidently not what the
 * client expects: instances worked for the hour the first token lived and then
 * failed every request with an invalid-credentials error until they were
 * recycled. google-auth-library already caches a token and renews it as it
 * nears expiry, so the reliable arrangement is to ask it every time and hand
 * whatever it returns to the client -- a cheap call when the cached token is
 * still good, a renewal exactly when needed otherwise.
 */
async function authViaAdc() {
  if (!adcClient) {
    const { GoogleAuth } = require("google-auth-library");
    adcClient = await new GoogleAuth({
      scopes: [
        "https://www.googleapis.com/auth/earthengine",
        "https://www.googleapis.com/auth/cloud-platform",
      ],
    }).getClient();
  }
  const token = await adcClient.getAccessToken();
  if (!token || !token.token) {
    throw new Error("no application default credentials are available");
  }
  ee.data.setAuthToken("", "Bearer", token.token, 3500, [], null, false);
  if (!eeInitialized) {
    await new Promise((resolve, reject) => ee.initialize(null, null, resolve, reject));
    eeInitialized = true;
  }
}

// ── The membership gate, and the rate limit behind it ───────────────────────
//
// EARTH ENGINE IS THE ONE THING HERE BILLED PER USE, and the app's own
// `membership.js` has always declared it `enforced: true` -- "every request
// goes through our own billed Cloud Function, so this is the one refusal that
// can be made where the reader cannot reach". It never was. This function
// took no credential at all, so `curl` spent the project's quota as readily
// as a member did, and the browser-side gate the module itself calls a
// courtesy was the whole of it.
//
// ALLOWED_ORIGINS IS NOT A DEFENCE. An `Origin` header is a browser's own
// courtesy to a server; a script sends whatever it likes, or nothing. It
// stops a page on somebody else's site from spending this quota and it stops
// nothing else, which is what it was written for.
//
// The pass is the SHORT token the membership service issues at
// `/auth/data-token`: `aud: "data"`, fifteen minutes, HS256 over the same
// JWT_SECRET the data bucket's gate verifies. Deliberately not the week-long
// session token -- a service should ask for the narrowest credential that
// answers its question, and the question here is only "is this a member".
// The pass carries no identity at all, which is also why the rate limit
// below counts passes and addresses rather than people.
//
// FAILS CLOSED. With REQUIRE_MEMBERSHIP unset the gate is ON; a deployment
// that means to run it open has to say so, because a gate that defaults off
// is one somebody forgets to switch on. Without JWT_SECRET it cannot verify
// anything, so it refuses with 503 rather than waving everything through.

const crypto = require("crypto");

const requireMembership = () => process.env.REQUIRE_MEMBERSHIP !== "0";

/**
 * Verify a pass, or answer null.
 *
 * Null for every failure -- bad shape, wrong signature, wrong audience,
 * expired -- so a caller cannot tell them apart and act differently. The
 * signature is compared in constant time; `timingSafeEqual` throws on a
 * length mismatch, so that is checked first.
 */
function validPass(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac("sha256", secret)
    .update(`${parts[0]}.${parts[1]}`).digest();
  let given;
  try {
    given = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch (error) {
    return null;
  }
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;
  let payload = null;
  try {
    payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch (error) {
    return null;
  }
  if (!payload || payload.aud !== "data") return null;
  if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/**
 * A token bucket per key, in this instance's memory.
 *
 * STATED HONESTLY: Cloud Functions scale out, so this bounds what ONE warm
 * instance will serve and not what the deployment as a whole will. It is a
 * cost cap against a runaway loop rather than a defence against somebody
 * deliberately spreading requests, and the real ceiling on the bill is
 * `--max-instances` on the deployment, which is in the runbook beside this.
 */
const BUCKET_TTL_MS = 10 * 60 * 1000;
const buckets = new Map();

function overRate(key, perMinute, burst) {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (now - b.seen > BUCKET_TTL_MS) buckets.delete(k);
  }
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: burst, seen: now };
    buckets.set(key, bucket);
  }
  bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.seen) / 60000 * perMinute);
  bucket.seen = now;
  if (bucket.tokens < 1) return true;
  bucket.tokens -= 1;
  return false;
}

/** The caller's address, as the front end reports it. */
function callerIp(req) {
  const forwarded = String(req.get("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || req.ip || "unknown";
}

/**
 * May this request be served? Answers null to allow, or {code, message}.
 *
 * `?list` is deliberately open: it is a catalogue of dataset names, it costs
 * nothing to serve, and the page builds its list from it before anybody has
 * signed in. Everything that RENDERS is gated.
 */
function refuseRequest(req, { billed }) {
  const secret = process.env.JWT_SECRET;
  const ip = callerIp(req);

  // The address limit applies to everything, gate or no gate: it is what
  // stops one loop from emptying an instance's budget.
  if (overRate(`ip:${ip}`, Number(process.env.RATE_PER_MIN_IP || 30), 60)) {
    return { code: 429, message: "Too many requests from this address -- wait a minute." };
  }
  if (!billed || !requireMembership()) return null;

  if (!secret) {
    return {
      code: 503,
      message: "This Earth Engine service is not configured to verify membership "
        + "(no JWT_SECRET). It refuses rather than serving unverified requests.",
    };
  }
  const bearer = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const pass = bearer || String((req.query || {}).t || "");
  const claims = validPass(pass, secret);
  if (!claims) {
    return {
      code: 402,
      message: "Earth Engine is part of GeoID membership. Sign in as a member "
        + "at https://geoidinitiative.com/membership/ to fetch from it.",
    };
  }
  // Per PASS as well as per address: one member on a flaky connection must
  // not be able to spend an instance's whole budget by retrying.
  const handle = crypto.createHash("sha256").update(pass).digest("hex").slice(0, 32);
  if (overRate(`pass:${handle}`, Number(process.env.RATE_PER_MIN_PASS || 20), 40)) {
    return { code: 429, message: "Too many renders on this pass -- wait a minute." };
  }
  return null;
}

function bad(res, code, message) {
  res.status(code).json({ error: message });
}

/**
 * An UPSTREAM failure, reported without repeating what it said.
 *
 * Earth Engine's own errors name assets, project paths and sometimes the
 * service account, and this reply goes to anybody who asks. The detail is
 * logged where the operator can read it and the caller gets the fact plus
 * the id they sent, which is what they need to try something else. The
 * 4xx messages above are this service's own sentences and stay verbatim:
 * they are the ones that tell a reader what to fix.
 */
function upstreamFailed(res, where, error, code = 502) {
  console.error(`${where}:`, error && error.stack ? error.stack : error);
  bad(res, code, `${where}. The service logged why; try again, or choose `
    + "another dataset or a smaller area.");
}

/** Bounding box as [west, south, east, north], validated and clamped. */
function parseBbox(value) {
  const parts = String(value || "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts;
  if (w >= e || s >= n) return null;
  return [
    Math.max(-180, w), Math.max(-90, s),
    Math.min(180, e), Math.min(90, n),
  ];
}

/** Pulls a value back from Earth Engine as a promise. */
function evaluate(object) {
  return new Promise((resolve, reject) => {
    object.evaluate((value, error) => (error ? reject(new Error(error)) : resolve(value)));
  });
}

function reduce(collection, config) {
  return config.reducer === "sum" ? collection.sum() : collection.median();
}

/**
 * Arbitrary class VALUES onto 0..n-1, so a palette can be handed to
 * `visualize` in class order. Land cover values are 10, 20, … 95; a palette
 * indexed against those would give 95 entries of which 11 mean anything.
 */
function remapClasses(image, config) {
  if (!config.classes) return image;
  return image.remap(
    config.classes.map((c) => c.value),
    config.classes.map((_, i) => i),
  );
}

function buildImage(id, config, from, to, region) {
  const sourceId = config.source || id;
  // Static datasets have no time dimension. NASADEM is a single Image, and
  // filtering it as a collection by date returned nothing ever; GLO-30 is a
  // static mosaic the date filter wrongly emptied.
  if (config.single) {
    return remapClasses(ee.Image(sourceId).select(config.bands), config).clip(region);
  }
  if (config.mosaic) {
    return remapClasses(
      ee.ImageCollection(sourceId).select(config.bands).mosaic(), config,
    ).clip(region);
  }
  let collection = ee.ImageCollection(sourceId)
    .filterBounds(region)
    .filterDate(from, to);

  if (config.cloudProperty) {
    // Least cloudy first, so a short window still yields a usable picture.
    collection = collection.sort(config.cloudProperty);
  }

  let composite = reduce(collection, config).select(config.bands);
  // Into the unit the legend states: IMERG's half-hourly mm/h summed is twice
  // the millimetres, ERA5-Land's metres a thousandth of them.
  if (Number.isFinite(config.multiply)) composite = composite.multiply(config.multiply);
  // A classification must be remapped BEFORE any arithmetic below; there is
  // none for a class dataset, and mixing the two would be meaningless anyway.
  if (config.classes) composite = remapClasses(composite, config);

  if (config.anomaly) {
    // Compared against the same days of the year across the baseline, so a
    // summer window is not judged against an annual mean.
    const start = new Date(from);
    const end = new Date(to);
    const doyFrom = Math.floor((start - new Date(start.getFullYear(), 0, 0)) / 86400000);
    const doyTo = Math.floor((end - new Date(end.getFullYear(), 0, 0)) / 86400000);
    const baseline = ee.ImageCollection(sourceId)
      .filterBounds(region)
      .filterDate(config.anomaly.baselineFrom, config.anomaly.baselineTo)
      .filter(ee.Filter.calendarRange(doyFrom, doyTo, "day_of_year"));
    // Per-year totals first for accumulating variables, so the baseline is a
    // mean season rather than a mean day.
    const years = ee.List.sequence(
      new Date(config.anomaly.baselineFrom).getFullYear(),
      new Date(config.anomaly.baselineTo).getFullYear(),
    );
    const perYear = ee.ImageCollection.fromImages(years.map((y) => {
      const yearly = baseline.filter(ee.Filter.calendarRange(y, y, "year"));
      return reduce(yearly, config).select(config.bands).set("year", y);
    }));
    composite = composite.subtract(perYear.mean().select(config.bands));
  }

  return composite.clip(region);
}

// The catalogue resolution is pure and testable without Earth Engine, a
// credential or a deployment: `stac.test.mjs` runs it over real records.
exports.__testing = {
  configFromStac, stacRecord, configFor, DATASETS,
  // The gate, so a test can prove it refuses rather than only that it exists.
  validPass, refuseRequest, overRate, buckets,
};

exports.geeImage = async (req, res) => {
  // The page is served from a different origin, so it needs CORS. An allowed
  // origin is echoed and anything else gets NO header at all -- the browser
  // then refuses the reply, which is the answer. The old default was `*`,
  // which is every page on the internet; a deployment that has not been told
  // its own origins now answers for none rather than for all.
  const allowed = String(process.env.ALLOWED_ORIGINS || "")
    .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const origin = req.get("origin") || "";
  if (origin && allowed.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    // The membership pass travels in this header, so the preflight has to
    // allow it or the browser never sends the real request.
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "600");
    res.status(204).send("");
    return;
  }

  const q = req.query || {};

  // Gated here, at the one door every request comes through, and BEFORE
  // anything is resolved or rendered: a render is billed, and refusing after
  // paying for one is the wrong order. `?list` is a catalogue of names and
  // costs nothing, so it is not billed; everything else is.
  const refusal = refuseRequest(req, { billed: q.list === undefined });
  if (refusal) return bad(res, refusal.code, refusal.message);

  if (q.list !== undefined) {
    // Lets the page build its catalogue from the service rather than keeping a
    // second copy of this list that can drift out of step.
    res.json({
      // The curated list only. The other eleven hundred are Google's own
      // published catalogue and the page reads that directly rather than
      // having this service copy it out.
      catalogue: "https://storage.googleapis.com/earthengine-stac/catalog/catalog.json",
      datasets: Object.entries(DATASETS).map(([id, d]) => ({
        id, name: d.name, scale: d.scale, attribution: d.attribution,
      })),
    });
    return;
  }

  let config;
  try {
    config = await configFor(q.dataset);
  } catch (error) {
    return upstreamFailed(res, "That dataset could not be resolved", error);
  }
  if (!config) {
    return bad(res, 404, `"${q.dataset}" is not in the Earth Engine data `
      + "catalogue. Check the id against the catalogue listing.");
  }
  if (config.unsupported) return bad(res, 400, config.unsupported);

  if (q.dates !== undefined && (config.single || config.mosaic)) {
    // No time dimension: say so, rather than inventing a range.
    return res.json({ dataset: q.dataset, static: true });
  }
  /**
   * A catalogue dataset states its own extent, so it is READ rather than
   * queried: the Earth Engine walk below costs a round trip per probe and
   * exists because the curated scene archives are too large to sort. The
   * published interval is the same answer for free.
   */
  if (q.dates !== undefined && config.fromCatalogue) {
    return res.json({
      dataset: q.dataset,
      first: config.startDate || "1970-01-01",
      last: config.endDate || new Date().toISOString().slice(0, 10),
    });
  }
  if (q.dates !== undefined) {
    // What the collection actually holds, so the page can offer real dates
    // rather than leaving the user to guess and be told no afterwards.
    try {
      await ready();
      const id = config.source || q.dataset;
      const cached = dateCache.get(id);
      if (cached && Date.now() - cached.at < 6 * 3600 * 1000) {
        res.set("Cache-Control", "public, max-age=3600");
        return res.json(cached.body);
      }
      const col = ee.ImageCollection(id);
      // Sorting a scene-level archive globally is tens of millions of images and
      // outruns the request. Where a start date is known, the newest is found by
      // stepping back through recent windows and the oldest is simply stated.
      const known = config.startDate;
      let first;
      let last;
      if (known) {
        first = Date.parse(known);
        const now = Date.now();
        for (const days of [14, 60, 180, 730]) {
          const since = new Date(now - days * 86400000).toISOString().slice(0, 10);
          const found = await evaluate(
            col.filterDate(since, new Date(now + 86400000).toISOString().slice(0, 10))
              .limit(1, "system:time_start", false).first().get("system:time_start"),
          );
          if (found) { last = found; break; }
        }
      } else {
        first = await evaluate(
          col.limit(1, "system:time_start", true).first().get("system:time_start"),
        );
        last = await evaluate(
          col.limit(1, "system:time_start", false).first().get("system:time_start"),
        );
      }
      if (!first || !last) throw new Error("the collection reported no dates");
      const body = {
        dataset: q.dataset,
        first: new Date(first).toISOString().slice(0, 10),
        last: new Date(last).toISOString().slice(0, 10),
      };
      dateCache.set(id, { at: Date.now(), body });
      res.set("Cache-Control", "public, max-age=3600");
      return res.json(body);
    } catch (error) {
      return upstreamFailed(res, "The collection's dates could not be read", error);
    }
  }

  const bbox = parseBbox(q.bbox);
  if (!bbox) return bad(res, 400, "bbox must be west,south,east,north.");

  // A default window rather than a fixed start date: paired with a caller that
  // sends only one of the two, a fixed start could produce a range ending
  // before it begins, or one of zero length.
  const to = q.to || new Date().toISOString().slice(0, 10);
  const from = q.from
    || new Date(Date.parse(to) - 60 * 86400000).toISOString().slice(0, 10);
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return bad(res, 400, "from and to must be ISO dates.");
  }
  if (Date.parse(from) >= Date.parse(to)) {
    // Earth Engine answers this with a reduceColumns complaint about empty date
    // ranges, which does not mention dates the caller recognises.
    return bad(res, 400,
      `The end date must be after the start date. Got ${from} to ${to}.`);
  }

  try {
    await ready();
    const region = ee.Geometry.Rectangle(bbox, null, false);

    // Asked before compositing. An empty collection reduces to an image with no
    // bands, and the error Earth Engine then raises is about a band pattern --
    // which describes the symptom and not the cause, and sends you looking at
    // the band name rather than at the dates.
    const sourceId = config.source || q.dataset;
    const available = (config.single || config.mosaic) ? 1 : await evaluate(
      ee.ImageCollection(sourceId).filterBounds(region).filterDate(from, to).size(),
    );
    if (!available) {
      return bad(res, 404,
        `No ${config.name} imagery between ${from} and ${to} over that area. `
        + "The collection may not reach that recent, or the window may be too "
        + "short -- try widening it.");
    }

    // A SUMMED RAINFALL composite over a long window runs off the top of a
    // ramp set for a day: a year of CHIRPS at 300 mm would come back as one
    // flat top colour, which the page reads back as 300 mm. The caller may
    // raise the ramp's top for an accumulation (mm, summed) and the legend it
    // is handed says so, so the inversion reads the picture on the right scale.
    const rampMax = Number(q.max);
    if (Number.isFinite(rampMax) && rampMax > 0 && rampMax <= 50000
      && config.reducer === "sum" && config.legend?.unit === "mm") {
      config = { ...config, max: rampMax, legend: { ...config.legend, max: rampMax } };
    }

    const image = buildImage(q.dataset, config, from, to, region);

    const vis = { min: config.min, max: config.max };
    if (config.palette) vis.palette = config.palette;
    // An RGB composite is usually published with a gamma rather than a
    // palette; dropping it renders the picture flat and dark.
    if (config.gamma !== undefined) vis.gamma = config.gamma;

    const url = await new Promise((resolve, reject) => {
      image.visualize(vis).getThumbURL({
        region,
        dimensions: MAX_PIXELS,
        format: "png",
      }, (result, error) => (error ? reject(new Error(error)) : resolve(result)));
    });

    res.set("Cache-Control", "public, max-age=900");
    res.json({
      imageUrl: url,
      dataset: q.dataset,
      name: config.name,
      bounds: { minX: bbox[0], minY: bbox[1], maxX: bbox[2], maxY: bbox[3] },
      bands: config.bands,
      scale: config.scale,
      from,
      to,
      crs: "EPSG:4326",
      attribution: config.attribution,
      // Which list this came from: the page says "tuned for this app" against
      // a curated one and "the catalogue's own default rendering" otherwise,
      // rather than presenting a published default as a considered choice.
      curated: !config.fromCatalogue,
      // The symbology, so the page's legend can show the ramp and what its
      // ends mean rather than just naming the dataset.
      palette: config.palette || null,
      legend: config.legend || null,
      // A classification's legend is a LIST, not a ramp: the page draws one
      // swatch per class with the publisher's own name for it.
      classes: config.classLegend || null,
    });
  } catch (error) {
    // Reported rather than swallowed: an empty picture because the request
    // failed is not the same as one because nothing was in range.
    upstreamFailed(res, "The Earth Engine request failed", error);
  }
};
