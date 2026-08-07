/**
 * Earth Engine image service for myGeoID.
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

// Collections offered to the page. Kept here rather than accepted from the
// request so the service cannot be pointed at arbitrary assets by a caller,
// and so each one can carry the band choice and stretch that make it legible.
const DATASETS = {
  "COPERNICUS/S2_SR_HARMONIZED": {
    name: "Sentinel-2 surface reflectance",
    bands: ["B4", "B3", "B2"],
    min: 0,
    max: 3000,
    scale: 10,
    cloudProperty: "CLOUDY_PIXEL_PERCENTAGE",
    attribution: "Copernicus Sentinel-2, processed by ESA",
  },
  "LANDSAT/LC09/C02/T1_L2": {
    name: "Landsat 9 surface reflectance",
    bands: ["SR_B4", "SR_B3", "SR_B2"],
    min: 7000,
    max: 20000,
    scale: 30,
    cloudProperty: "CLOUD_COVER",
    attribution: "USGS/NASA Landsat 9",
  },
  "COPERNICUS/S1_GRD": {
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
    name: "MODIS land surface temperature",
    bands: ["LST_Day_1km"],
    min: 13000,
    max: 16500,
    scale: 1000,
    palette: ["040274", "3ac2ff", "ffd25f", "ff6f31", "911003"],
    attribution: "NASA LP DAAC MODIS MOD11A1",
  },
  "UCSB-CHG/CHIRPS/DAILY": {
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
    name: "Soil moisture (SMAP)",
    bands: ["sm_surface"],
    min: 0.05,
    max: 0.5,
    scale: 10000,
    palette: ["8c510a", "d8b365", "f6e8c3", "c7eae5", "5ab4ac", "01665e"],
    attribution: "NASA SMAP L4",
  },
  "MODIS/061/MOD11A2": {
    name: "Land surface temperature",
    bands: ["LST_Day_1km"],
    min: 13000,
    max: 16500,
    scale: 1000,
    palette: ["040274", "3ac2ff", "ffd25f", "ff6f31", "911003"],
    attribution: "NASA LP DAAC MODIS MOD11A2",
  },
  "MODIS/061/MCD64A1": {
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

let readyPromise = null;

/** Authenticates once per instance and reuses it across requests. */
function ready() {
  if (readyPromise) return readyPromise;
  // Supplied by the runtime, never by the caller. On Cloud Functions and Cloud
  // Run this is the service account attached to the deployment.
  const key = process.env.EE_SERVICE_ACCOUNT_KEY
    ? JSON.parse(process.env.EE_SERVICE_ACCOUNT_KEY)
    : null;
  readyPromise = key ? authViaKey(key) : authViaAdc();
  return readyPromise;
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
async function authViaAdc() {
  const { GoogleAuth } = require("google-auth-library");
  const auth = new GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/earthengine",
      "https://www.googleapis.com/auth/cloud-platform",
    ],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token || !token.token) {
    throw new Error("no application default credentials are available");
  }
  // Expiry is deliberately short: the client refreshes through the callback
  // below rather than holding a token past its life.
  ee.data.setAuthToken("", "Bearer", token.token, 3500, [], null, false);
  ee.data.setAuthTokenRefresher(async (authArgs, callback) => {
    const fresh = await client.getAccessToken();
    callback({ access_token: fresh.token, token_type: "Bearer", expires_in: 3500 });
  });
  await new Promise((resolve, reject) => ee.initialize(null, null, resolve, reject));
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

function buildImage(id, config, from, to, region) {
  const sourceId = config.source || id;
  let collection = ee.ImageCollection(sourceId)
    .filterBounds(region)
    .filterDate(from, to);

  if (config.cloudProperty) {
    // Least cloudy first, so a short window still yields a usable picture.
    collection = collection.sort(config.cloudProperty);
  }

  let composite = reduce(collection, config).select(config.bands);

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
      datasets: Object.entries(DATASETS).map(([id, d]) => ({
        id, name: d.name, scale: d.scale, attribution: d.attribution,
      })),
    });
    return;
  }

  const config = DATASETS[q.dataset];
  if (!config) return bad(res, 400, "Unknown or unsupported dataset.");

  const bbox = parseBbox(q.bbox);
  if (!bbox) return bad(res, 400, "bbox must be west,south,east,north.");

  const from = q.from || "2024-01-01";
  const to = q.to || new Date().toISOString().slice(0, 10);
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return bad(res, 400, "from and to must be ISO dates.");
  }

  try {
    await ready();
    const region = ee.Geometry.Rectangle(bbox, null, false);

    // Asked before compositing. An empty collection reduces to an image with no
    // bands, and the error Earth Engine then raises is about a band pattern --
    // which describes the symptom and not the cause, and sends you looking at
    // the band name rather than at the dates.
    const sourceId = config.source || q.dataset;
    const available = await evaluate(
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
    });
  } catch (error) {
    // Reported rather than swallowed: an empty picture because the request
    // failed is not the same as one because nothing was in range.
    bad(res, 502, `Earth Engine request failed: ${error.message}`);
  }
};
