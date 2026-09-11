/**
 * THE RECORD'S MAGNITUDE BANDS — the classification, the pinned palette, and
 * the filter, in a module that imports nothing but the symbology.
 *
 * Three hundred thousand arrivals is mostly M 4.5–4.9: at a global view the
 * ordinary background of the planet is drawn over the earthquakes anybody
 * remembers. So a band can be switched off — and the whole difficulty is that
 * hiding one must not change what the others LOOK like.
 *
 * `buildSymbology` drops a class that falls outside the data's own range and
 * spreads the ramp across whatever survives (`t = i / (edges.length - 2)`), so
 * a set with no M 8 in it comes back with four classes and hands M 7–7.9 the
 * TOP colour. Filter the layer and repaint it through the ordinary path and
 * every remaining band silently moves along the ramp, under a key that has
 * quietly lost a row. `bandSymbology` therefore classes a fixed spread — one
 * value inside each band — so the five rows and their five colours exist
 * whatever is on screen, and only the COUNTS are read off the real values.
 *
 * That pinning is worth having on its own account: it is the same symbology
 * the animation's frames are painted from, so the still layer and a frame
 * cannot disagree about what an M 7 looks like.
 */

import { buildSymbology } from "./symbology.js?v=20260912-ac4605b";

/**
 * A CLASS PER MAGNITUDE UNIT, and a half one at the foot. The record's floor
 * is M 4.5, so an edge at 5 has to join them: without it the bottom class runs
 * 4.5 to 5.9 under a label reading "M 5–5.9", which is a key saying something
 * false about a third of the layer.
 */
export const MAG_EDGES = [5, 6, 7, 8];
export const MAG_LABELS = ["M 4.5–4.9", "M 5–5.9", "M 6–6.9", "M 7–7.9", "M 8+"];
/** Each label's own floor, so a dropped class cannot shift the rest along. */
export const MAG_FLOORS = [0, 5, 6, 7, 8];

/**
 * One value INSIDE each band, which is what pins the palette.
 *
 * They are never counted and never drawn — they exist so the classing has
 * something in every class, and the top one is past 8 so the M 8+ edge is
 * kept (`buildSymbology` drops a break that is not strictly inside the range).
 */
const SPREAD = [4.5, 5.5, 6.5, 7.5, 9];

/** ISC-GEM's homogenised Mw where it reaches, ComCat's preferred otherwise. */
export const magOf = (props) => {
  const best = Number(props?.mag_best);
  if (Number.isFinite(best)) return best;
  const raw = Number(props?.mag);
  return Number.isFinite(raw) ? raw : null;
};

/**
 * Which band an event is in, by the class's own FLOOR rather than by any
 * index — the same lookup the frame labels use, for the same reason.
 * `null` for an event carrying no magnitude at all, which is neither in a
 * band nor hidden by one.
 */
export function bandOf(props) {
  const n = magOf(props);
  if (!Number.isFinite(n)) return null;
  let i = 0;
  MAG_FLOORS.forEach((floor, k) => { if (n >= floor) i = k; });
  return i;
}

/**
 * The five classes, always, with the counts the given values really have.
 *
 * The last row is inclusive at both ends and the rest at their floor, which is
 * `buildSymbology`'s own rule — recounting by any other one would put the
 * boundary events in a different class from the one they are drawn in.
 */
export function bandSymbology(values = []) {
  const sym = buildSymbology(SPREAD, { edges: MAG_EDGES, ramp: "risk" });
  if (!sym?.ok) return sym;
  const counts = new Array(sym.rows.length).fill(0);
  values.forEach((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    let i = 0;
    MAG_FLOORS.forEach((floor, k) => { if (n >= floor) i = k; });
    if (counts[i] !== undefined) counts[i] += 1;
  });
  sym.rows.forEach((row, i) => {
    row.count = counts[i] || 0;
    if (MAG_LABELS[i]) row.label = MAG_LABELS[i];
  });
  return sym;
}

/**
 * The bands as a list a tick row can be drawn from: the label, the colour the
 * layer really wears, and how many events are in it.
 */
export function bandRows(features = []) {
  const sym = bandSymbology(features.map((f) => magOf(f?.properties)));
  if (!sym?.ok) return [];
  return sym.rows.map((row, i) => ({
    key: String(i), label: MAG_LABELS[i] || row.label, colour: row.colour, count: row.count,
  }));
}

/**
 * The kept features. PURE, and the reason this module exists separately: the
 * filter is the one part that can be checked without a page.
 *
 * An event with no magnitude is KEPT whatever is switched off — it is in no
 * band, so no band's tick is a statement about it, and dropping it would make
 * the ticks quietly delete data none of them names.
 */
export function keptFeatures(all = [], off = new Set()) {
  if (!off.size) return all;
  return all.filter((f) => {
    const band = bandOf(f?.properties);
    return band === null || !off.has(String(band));
  });
}

/** What is drawn, said in the panel — never left to be inferred from the map. */
export function describeFilter(all = [], off = new Set()) {
  const kept = keptFeatures(all, off).length;
  const total = all.length;
  if (!off.size) return `${total.toLocaleString()} earthquakes — every magnitude shown.`;
  const hidden = [...off].sort().map((k) => MAG_LABELS[Number(k)] || k).join(", ");
  if (!kept) return `Nothing drawn — every magnitude is switched off. ${hidden} hidden.`;
  return `${kept.toLocaleString()} of ${total.toLocaleString()} drawn — ${hidden} hidden.`;
}
