/**
 * THE TIME STEP A RAINFALL SERIES IS READ AT — the finest each source has,
 * unless a coarser step is asked for.
 *
 * Every source has a native step: GFS (through Open-Meteo) is hourly, CHIRPS
 * daily, IMERG half-hourly, GSMaP hourly, the service's ERA5-Land entry daily.
 * "Finest" reads each stretch of days at its own source's step, so a week of
 * CHIRPS history followed by a week of GFS forecast is seven daily maps and
 * then 168 hourly ones — as much as there is, never an hourly map invented
 * out of a daily total. A step chosen by the reader (a week, a month, a year)
 * is honoured wherever the source is at least that fine, and a source can
 * never be read finer than it is.
 *
 * The series is built from UNITS: back-to-back intervals, one per step, each
 * split into PARTS where the source changes inside it (a month in which CHIRPS
 * runs out and GFS takes over). A map sums the whole units covering its
 * window, so a 24 h window read hourly is 24 units and a monthly map is one.
 * An Earth Engine part is one composite render (summed by the service); a GFS
 * part is a run of hours summed here. Pure: no network, no DOM.
 */

export const MIN = 60000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** The finest step each source serves, in ms. */
export const NATIVE_STEP = { gfs: HOUR, chirps: DAY, imerg: 30 * MIN, gsmap: HOUR, era5land: DAY };

/** The steps a reader can ask for. `months` steps are calendar steps. */
export const STEP_CHOICES = [
  { key: "native", label: "Finest each source has — GFS hourly, CHIRPS daily, IMERG half-hourly" },
  { key: "30m", label: "30 minutes", ms: 30 * MIN },
  { key: "1h", label: "1 hour", ms: HOUR },
  { key: "3h", label: "3 hours", ms: 3 * HOUR },
  { key: "6h", label: "6 hours", ms: 6 * HOUR },
  { key: "12h", label: "12 hours", ms: 12 * HOUR },
  { key: "1d", label: "1 day", ms: DAY },
  { key: "1w", label: "1 week", ms: 7 * DAY },
  { key: "1mo", label: "1 month", months: 1 },
  { key: "1y", label: "1 year", months: 12 },
];

const iso = (t) => new Date(t).toISOString().slice(0, 16);
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

/** The step a source is read at: the choice, never finer than the source has. */
export function stepFor(source, choice = "native") {
  const native = NATIVE_STEP[source] ?? HOUR;
  const c = STEP_CHOICES.find((x) => x.key === choice) || STEP_CHOICES[0];
  if (c.months) return { months: c.months };
  if (!c.ms) return { ms: native };
  return { ms: Math.max(c.ms, native) };
}

/** The step boundary at or before t (UTC). */
export function alignDown(t, step) {
  if (step.months) {
    const d = new Date(t);
    const m = d.getUTCMonth();
    return Date.UTC(d.getUTCFullYear(), step.months === 12 ? 0 : m - (m % step.months), 1);
  }
  return Math.floor(t / step.ms) * step.ms;
}

/** The boundary after an aligned t. */
export function addStep(t, step) {
  if (step.months) {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step.months, 1);
  }
  return t + step.ms;
}

/** How long a step is, for a reader: "1 h", "30 min", "1 day", "1 month". */
export function stepText(step) {
  if (step.months) return step.months === 12 ? "1 year" : `${step.months} month${step.months > 1 ? "s" : ""}`;
  if (step.ms % DAY === 0) return `${step.ms / DAY} day${step.ms > DAY ? "s" : ""}`;
  if (step.ms % HOUR === 0) return `${step.ms / HOUR} h`;
  return `${step.ms / MIN} min`;
}

/**
 * PLAN A SERIES.
 *
 *   start, end   YYYY-MM-DD, the days the maps are for (inclusive)
 *   choice       a STEP_CHOICES key
 *   windowH      hours of rain each map sums, or null for "the step"; a map
 *                always sums at least its own step, or the record has gaps
 *   sourceOf     day → "gfs" | an Earth Engine key, for every day asked of it
 *   maxFrames    beyond this the maps are strided, and the stride reported
 *
 * Returns `{ ok, frames, units, geeParts, gfsSpan, stride, steps }`: a frame
 * is `{ time, from, units: [i…], sources }`; a unit `{ start, end, parts }`; a
 * part `{ src, from, to, key? }`.
 */
export function planSeries({ start, end, choice = "native", windowH = 24, sourceOf, maxFrames = 480 }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(end || "")) return { ok: false, message: "Give a start and an end date." };
  if (start > end) return { ok: false, message: "The start is after the end." };
  const T0 = Date.parse(`${start}T00:00:00Z`);
  const T1 = Date.parse(`${end}T00:00:00Z`) + DAY;
  const wantMs = Number.isFinite(windowH) && windowH > 0 ? windowH * HOUR : 0;
  // Units start early enough for the first map's window to be whole. A coarse
  // calendar step needs its own lead: the unit before the first map.
  const probe = stepFor(sourceOf(start), choice);
  const leadMs = Math.max(wantMs, probe.months ? 0 : probe.ms);
  let t = alignDown(T0 - leadMs, probe.months ? probe : { ms: DAY });
  const units = [];
  const steps = new Map();
  let guard = 0;
  while (t < T1 && guard < 100000) {
    guard += 1;
    const src = sourceOf(dayOf(t));
    const step = stepFor(src, choice);
    steps.set(src, step);
    let e = addStep(alignDown(t, step), step);
    if (e <= t) e = addStep(t, step);
    if (e > T1) e = T1;
    units.push({ start: t, end: e, parts: partsOf(t, e, sourceOf) });
    t = e;
  }
  if (guard >= 100000) return { ok: false, message: "That span at that step is more maps than any run could hold — choose a coarser step." };
  // A map at every unit that ends inside the asked days.
  const frames = [];
  units.forEach((u, k) => {
    if (u.end <= T0) return;
    const need = Math.max(wantMs, u.end - u.start);
    const idx = [k];
    let j = k;
    while (u.end - units[j].start < need - 1 && j > 0) { j -= 1; idx.unshift(j); }
    if (u.end - units[j].start < need - 1) return;   // not enough record before it
    const sources = [...new Set(idx.flatMap((i) => units[i].parts.map((p) => p.src)))];
    frames.push({ time: iso(u.end), from: iso(units[idx[0]].start), units: idx, sources });
  });
  const stride = Math.max(1, Math.ceil(frames.length / maxFrames));
  const kept = frames.filter((_, k) => k % stride === 0 || k === frames.length - 1);
  // Only the units some kept map reads.
  const used = new Set(kept.flatMap((f) => f.units));
  const geeParts = new Map();
  let gfsFrom = Infinity; let gfsTo = -Infinity;
  units.forEach((u, i) => {
    if (!used.has(i)) return;
    for (const p of u.parts) {
      if (p.src === "gfs") { gfsFrom = Math.min(gfsFrom, p.from); gfsTo = Math.max(gfsTo, p.to); continue; }
      p.key = `${p.src}|${iso(p.from)}|${iso(p.to)}`;
      geeParts.set(p.key, p);
    }
  });
  return {
    ok: true, frames: kept, units, stride,
    geeParts: [...geeParts.values()],
    gfsSpan: Number.isFinite(gfsFrom) ? { from: gfsFrom, to: gfsTo } : null,
    steps: Object.fromEntries(steps),
  };
}

/** A unit split where the source changes — at day boundaries, the finest a source assignment is made at. */
function partsOf(s, e, sourceOf) {
  const parts = [];
  let a = s;
  while (a < e) {
    const src = sourceOf(dayOf(a));
    let b = Math.min(e, Date.parse(`${dayOf(a)}T00:00:00Z`) + DAY);
    while (b < e && sourceOf(dayOf(b)) === src) b = Math.min(e, b + DAY);
    parts.push({ src, from: a, to: b });
    a = b;
  }
  return parts;
}

/** How many Earth Engine renders (each one billed) a plan spends. */
export const rendersOf = (plan) => plan.geeParts.length;

/** A sensible top of the service's colour ramp for a composite this long. */
export function rampMaxFor(ms) {
  const days = ms / DAY;
  if (days <= 1.01) return 300;
  if (days <= 8) return 800;
  if (days <= 32) return 2000;
  if (days <= 100) return 4000;
  return 10000;
}
