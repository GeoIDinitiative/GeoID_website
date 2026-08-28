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

function bad(res, code, message) {
  res.status(code).json({ error: message });
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
exports.__testing = { configFromStac, stacRecord, configFor, DATASETS };

exports.geeImage = async (req, res) => {
  // The page is served from a different origin, so it needs CORS. Restrict to
  // the sites that should be allowed to spend this project's quota.
  const allowed = (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const origin = req.get("origin");
  res.set("Access-Control-Allow-Origin",
    allowed.includes("*") || allowed.includes(origin) ? (origin || "*") : allowed[0]);
  res.set("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.status(204).send("");
    return;
  }

  const q = req.query || {};

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
    return bad(res, 502, error.message);
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
      return bad(res, 502, `Could not read the collection's dates: ${error.message}`);
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
    bad(res, 502, `Earth Engine request failed: ${error.message}`);
  }
};
