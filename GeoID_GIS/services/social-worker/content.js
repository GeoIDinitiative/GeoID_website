/**
 * Kind-specific meta for the richer content kinds: analysis (a before/after
 * pair), monitor (time series) and observation (structured field
 * measurements). Called from cleanMeta() in posts.js; kept apart so the
 * rules a geologist will argue with -- what a dip may be, what a strike
 * means -- sit in one short file with their own tests (test/content.test.mjs).
 *
 * WHY THE SERVER CHECKS RANGES. A dip of 120° or a plunge of -10° is not a
 * typo the reader can see past: it is drawn on a stereonet as a point that
 * means something else, and a confirmed observation with a nonsense
 * orientation is worse than none. So an impossible value is refused with a
 * sentence naming the row and the field, never silently clamped.
 *
 * ONE STRIKE CONVENTION ON THE WIRE. Planar measurements are stored with
 * strike by the right-hand rule (dip direction = strike + 90°) and with both
 * numbers present. A field notebook may give either; if it gives both they
 * must agree within 5° under either hand, or it is refused -- a left-hand
 * strike is turned into its right-hand twin, which is the same plane.
 */
import { fail, str, url } from "./lib.js";

export const MEASUREMENT_TYPES = ["strike_dip", "bedding", "joint", "fault", "lineation", "measurement"];
export const PLANAR_TYPES = ["strike_dip", "bedding", "joint", "fault"];
export const MAX_MEASUREMENTS = 50;

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== null && o[k] !== "";
/** 0 <= a < 360, so 360 and 0 are one azimuth. */
const azimuth = (a) => ((a % 360) + 360) % 360;
/** Smallest angle between two azimuths, 0..180. */
const angleBetween = (a, b) => { const d = Math.abs(azimuth(a) - azimuth(b)); return Math.min(d, 360 - d); };
const round = (v, places = 2) => Number(v.toFixed(places));

/**
 * One measurement row, or a 400 naming what is wrong with it. `n` is the
 * 1-based row number a person sees in the form.
 */
export function cleanMeasurement(raw, n = 1) {
  const where = `Measurement ${n}`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(400, `${where} must be an object.`);
  const type = String(raw.type || "");
  if (!MEASUREMENT_TYPES.includes(type)) {
    fail(400, `${where}: the type must be one of ${MEASUREMENT_TYPES.join(", ")}.`);
  }
  const v = raw.values && typeof raw.values === "object" && !Array.isArray(raw.values) ? raw.values : {};
  const get = (key, label) => {
    if (!has(v, key)) return null;
    const x = num(v[key]);
    if (x == null) fail(400, `${where}: ${label} must be a number.`);
    return x;
  };
  const inRange = (x, lo, hi, label, unit = "°", hiOpen = false) => {
    if (x == null) return x;
    if (x < lo || (hiOpen ? x >= hi : x > hi)) fail(400, `${where}: ${label} must be between ${lo} and ${hi}${unit}.`);
    return x;
  };
  const out = { type, values: {}, note: str(raw.note, 500) };

  if (PLANAR_TYPES.includes(type)) {
    // 360 is accepted and stored as 0: compasses read both.
    const strike = inRange(get("strike", "strike"), 0, 360, "strike");
    const dipDir = inRange(get("dip_direction", "dip direction"), 0, 360, "dip direction");
    const dip = inRange(get("dip", "dip"), 0, 90, "dip");
    if (dip == null) fail(400, `${where}: a ${type.replace("_", "/")} needs a dip (0–90°).`);
    if (strike == null && dipDir == null) fail(400, `${where}: give a strike or a dip direction.`);
    let dd = dipDir;
    if (strike != null && dipDir != null) {
      const rhr = angleBetween(dipDir, strike + 90);
      const lhr = angleBetween(dipDir, strike - 90);
      if (Math.min(rhr, lhr) > 5) {
        fail(400, `${where}: the dip direction (${dipDir}°) is not at right angles to the strike (${strike}°).`);
      }
    } else if (dd == null) dd = strike + 90;
    dd = azimuth(dd);
    out.values = { strike: round(azimuth(dd - 90)), dip: round(dip), dip_direction: round(dd) };
    if (type === "fault" && has(v, "rake")) {
      out.values.rake = round(inRange(get("rake", "rake"), -180, 180, "rake"));
    }
  } else if (type === "lineation") {
    const trend = inRange(get("trend", "trend"), 0, 360, "trend");
    const plunge = inRange(get("plunge", "plunge"), 0, 90, "plunge");
    if (trend == null || plunge == null) fail(400, `${where}: a lineation needs a trend (0–360°) and a plunge (0–90°).`);
    out.values = { trend: round(azimuth(trend)), plunge: round(plunge) };
  } else {
    const value = get("value", "the value");
    if (value == null) fail(400, `${where}: a measurement needs a value.`);
    if (Math.abs(value) > 1e12) fail(400, `${where}: the value is too large.`);
    out.values = { value, unit: str(v.unit, 30), label: str(v.label ?? raw.label, 80) };
  }
  return out;
}

export function cleanMeasurements(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) fail(400, "meta.measurements must be a list.");
  if (list.length > MAX_MEASUREMENTS) fail(400, `At most ${MAX_MEASUREMENTS} measurements per observation.`);
  return list.map((m, i) => cleanMeasurement(m, i + 1));
}

/**
 * A before/after reference: an uploaded media key (m/<user>/<random>.<ext>),
 * an http(s) URL, or a GeoHUB layer id. Anything else -- a javascript: link,
 * a data: URI -- becomes "", because the page puts it in an <img src>.
 */
export function cleanImageRef(value) {
  const text = str(value, 500);
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return url(text);
  if (/^[a-z]+:/i.test(text)) return "";
  return /^[A-Za-z0-9_\-./:]+$/.test(text) && !text.includes("..") ? text : "";
}

const optTime = (v) => {
  const x = num(v);
  return x == null ? null : Math.trunc(x);
};

/** The three kinds this file owns; `meta` has already been through cleanValue(). */
export function cleanContentMeta(kind, meta) {
  if (kind === "analysis") {
    if ("uncertainty" in meta) meta.uncertainty = str(meta.uncertainty, 4000);
    for (const side of ["before", "after"]) {
      if (side in meta) meta[side] = cleanImageRef(meta[side]);
      if (`${side}_label` in meta) meta[`${side}_label`] = str(meta[`${side}_label`], 80);
      if (`${side}_date` in meta) meta[`${side}_date`] = optTime(meta[`${side}_date`]);
    }
  }
  if (kind === "monitor") {
    if ("updated_at" in meta) meta.updated_at = optTime(meta.updated_at);
    if ("series" in meta) {
      meta.series = (Array.isArray(meta.series) ? meta.series : []).slice(0, 20).map((s) => ({
        label: str(s?.label, 120),
        unit: str(s?.unit, 40),
        points: (Array.isArray(s?.points) ? s.points : []).slice(0, 5000)
          .filter((pt) => Array.isArray(pt) && num(pt[0]) != null && num(pt[1]) != null)
          .map((pt) => [num(pt[0]), num(pt[1])])
          // Sorted by time on write, so every reader draws a line, not a scribble.
          .sort((a, b) => a[0] - b[0]),
      }));
    }
  }
  if (kind === "observation") {
    if ("measurements" in meta) meta.measurements = cleanMeasurements(meta.measurements);
  }
  return meta;
}
