/**
 * The arithmetic behind the post view's small plots: chart axes, the
 * stereonet, and the words for a field measurement. No DOM, so node tests it
 * (plotmath.test.mjs) -- a stereonet that draws a 35° dip as 55° looks just
 * as tidy as a right one, and only a number can say which it is.
 */

/** About `count` round tick values covering [min, max] (1, 2, 2.5 or 5 x 10^k apart). */
export function niceTicks(min, max, count = 5) {
  let lo = Number(min); let hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
  if (lo > hi) [lo, hi] = [hi, lo];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const first = Math.ceil(lo / step - 1e-9) * step;
  const out = [];
  for (let v = first; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** The [min, max] a set of ticks spans, widened to whole ticks so lines never touch the frame. */
export function niceDomain(min, max, count = 5) {
  let lo = Number(min); let hi = Number(max);
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
  const ticks = niceTicks(lo, hi, count);
  if (ticks.length < 2) return [lo, hi];
  const step = ticks[1] - ticks[0];
  return [Math.min(ticks[0], Math.floor(lo / step) * step), Math.max(ticks[ticks.length - 1], Math.ceil(hi / step) * step)];
}

const DAY = 86400;
const TIME_STEPS = [
  [3600, "hour"], [6 * 3600, "hour"], [DAY, "day"], [2 * DAY, "day"], [7 * DAY, "day"], [14 * DAY, "day"],
  [30 * DAY, "month"], [91 * DAY, "month"], [182 * DAY, "month"], [365 * DAY, "year"], [2 * 365 * DAY, "year"],
  [5 * 365 * DAY, "year"], [10 * 365 * DAY, "year"],
];

/**
 * Tick times (epoch seconds) for a time axis and the unit they should be
 * written in. Months and years land on the 1st (UTC), so ticks read as
 * calendar dates, not as "every 30 days from wherever the data began".
 */
export function timeTicks(t0, t1, count = 5) {
  const span = Math.max(1, t1 - t0);
  const [step, unit] = TIME_STEPS.find(([s]) => span / s <= count) || TIME_STEPS[TIME_STEPS.length - 1];
  const out = [];
  if (unit === "month" || unit === "year") {
    const months = unit === "year" ? Math.round(step / (365 * DAY)) * 12 : Math.max(1, Math.round(step / (30 * DAY)));
    const d = new Date(t0 * 1000);
    let y = d.getUTCFullYear(); let m = d.getUTCMonth();
    if (unit === "year") m = 0;
    for (let i = 0; i < 400; i += 1) {
      const t = Date.UTC(y, m, 1) / 1000;
      if (t > t1) break;
      if (t >= t0) out.push(t);
      m += months; y += Math.floor(m / 12); m %= 12;
    }
  } else {
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
  }
  return { ticks: out, unit };
}

/** Index of the value in a SORTED array nearest to x (binary search). */
export function nearestIndex(sorted, x) {
  if (!sorted.length) return -1;
  let lo = 0; let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid; else hi = mid;
  }
  return Math.abs(sorted[lo] - x) <= Math.abs(sorted[hi] - x) ? lo : hi;
}

/** Group monitor series by unit: one chart per unit, so no axis lies about another's scale. */
export function seriesByUnit(series) {
  const groups = new Map();
  for (const s of Array.isArray(series) ? series : []) {
    const pts = (Array.isArray(s?.points) ? s.points : [])
      .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .slice().sort((a, b) => a[0] - b[0]);
    if (!pts.length) continue;
    const unit = String(s.unit || "");
    if (!groups.has(unit)) groups.set(unit, []);
    groups.get(unit).push({ label: String(s.label || "Series"), unit, points: pts });
  }
  return [...groups.entries()].map(([unit, list]) => ({ unit, series: list }));
}

// ── Stereonet: lower hemisphere, equal area (Schmidt), north up ────────────

const RAD = Math.PI / 180;

/** A line (trend, plunge in degrees) to x, y on a net of radius R centred on 0,0; y grows downward (canvas). */
export function lineToXY(trend, plunge, R = 1) {
  const r = R * Math.SQRT2 * Math.sin(((90 - plunge) * RAD) / 2);
  return [r * Math.sin(trend * RAD), -r * Math.cos(trend * RAD)];
}

/** The pole to a plane: opposite the dip direction, plunging 90 - dip. */
export function poleOf(dipDirection, dip) {
  return { trend: (dipDirection + 180) % 360, plunge: 90 - dip };
}

/**
 * A plane's great circle as points on the net: every line in the plane, from
 * one end of the strike to the other through the dip. The vectors are
 * (north, east, down), so every one of them is in the lower hemisphere.
 */
export function planeCircle(dipDirection, dip, R = 1, n = 48) {
  const sd = (dipDirection - 90) * RAD;
  const s = [Math.cos(sd), Math.sin(sd), 0];
  const d = [Math.cos(dip * RAD) * Math.cos(dipDirection * RAD), Math.cos(dip * RAD) * Math.sin(dipDirection * RAD), Math.sin(dip * RAD)];
  const out = [];
  for (let i = 0; i <= n; i += 1) {
    const a = (Math.PI * i) / n;
    const v = [0, 1, 2].map((k) => Math.cos(a) * s[k] + Math.sin(a) * d[k]);
    const plunge = Math.asin(Math.max(-1, Math.min(1, v[2]))) / RAD;
    const trend = Math.atan2(v[1], v[0]) / RAD;
    out.push(lineToXY(trend, plunge, R));
  }
  return out;
}

const pad3 = (v) => String(Math.round(v)).padStart(3, "0");
const pad2 = (v) => String(Math.round(v)).padStart(2, "0");

export const MEASUREMENT_LABELS = {
  strike_dip: "Strike/dip", bedding: "Bedding", joint: "Joint", fault: "Fault", lineation: "Lineation", measurement: "Measurement",
};

/** A measurement in the notation a field geologist writes it in. */
export function measurementText(m) {
  const v = m?.values || {};
  if (m?.type === "lineation") return `${pad2(v.plunge)}→${pad3(v.trend)}`;
  if (m?.type === "measurement") return `${v.value}${v.unit ? ` ${v.unit}` : ""}`;
  if (!Number.isFinite(v.dip)) return "";
  return `${pad3(v.strike)}/${pad2(v.dip)} (dips ${Math.round(v.dip)}° towards ${pad3(v.dip_direction)})${Number.isFinite(v.rake) ? `, rake ${v.rake}°` : ""}`;
}

/** Words for a screen reader: what the glyph beside the row shows. */
export function measurementGlyphLabel(m) {
  const v = m?.values || {};
  if (m?.type === "lineation") return `Stereonet: a line plunging ${Math.round(v.plunge)}° towards ${pad3(v.trend)}.`;
  if (Number.isFinite(v.dip)) return `Stereonet: a plane dipping ${Math.round(v.dip)}° towards ${pad3(v.dip_direction)}, drawn as its great circle and pole.`;
  return "";
}

// ── Months for the map's time slider ───────────────────────────────────────

/** The `count` calendar months ending with the one holding `nowSec` (UTC), oldest first. */
export function monthRange(nowSec, count = 24) {
  const d = new Date(nowSec * 1000);
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const y = d.getUTCFullYear(); const m = d.getUTCMonth() - i;
    const start = Date.UTC(y, m, 1) / 1000;
    const end = Date.UTC(y, m + 1, 1) / 1000;
    out.push({ start, end, key: new Date(start * 1000).toISOString().slice(0, 7) });
  }
  return out;
}
