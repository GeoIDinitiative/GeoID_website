/**
 * The sea-level control: one number, three ways to set it.
 *
 * A slider for exploring (−150 to +100 m in half metres, where every
 * projection and the last glacial lowstand live), a number box for anything
 * past that or exact, and presets whose tooltips say where each figure comes
 * from. All three are one value — `seaLevel.metres` in `dem-layer.js` — and a
 * change REBUILDS the sheet rather than re-fetching anything: the heights and
 * the coastline for this view are cached, so what moves is only the sea.
 *
 * Debounced, because a slider fires on every pixel and a rebuild samples the
 * whole grid; the last position always gets drawn (`rebuildSheet` waits out a
 * build already running rather than dropping the request).
 */

import { seaLevel, rebuildSheet, sheetLayer } from "./dem-layer.js?v=20260911-eae60d5";

const byId = (id) => document.getElementById(id);
const say = (message) => { const n = byId("sea-level-status"); if (n) n.textContent = message || ""; };

let timer = null;

function setLevel(metres, { from = null } = {}) {
  const v = Math.max(-11000, Math.min(100, Math.round(Number(metres) * 10) / 10));
  if (!Number.isFinite(v)) return;
  seaLevel.metres = v;
  const box = byId("sea-level-metres");
  const range = byId("sea-level-range");
  if (box && from !== box) box.value = String(v);
  // The slider holds what it can; a level past its ends pins it to the end
  // rather than lying about the number in the box.
  if (range && from !== range) range.value = String(Math.max(Number(range.min), Math.min(Number(range.max), v)));
  byId("sea-level-presets")?.querySelectorAll("[data-level]").forEach((b) => {
    b.classList.toggle("is-active", Number(b.dataset.level) === v);
  });
  clearTimeout(timer);
  if (!sheetLayer("sealevel")) return;
  timer = setTimeout(() => { void rebuildSheet("sealevel", say); }, 350);
}

function init() {
  const box = byId("sea-level-metres");
  const range = byId("sea-level-range");
  if (!box || !range) return;
  box.addEventListener("change", () => setLevel(box.value, { from: box }));
  // The number box takes a typed value on Enter as well; the space bar and
  // digits are the viewer's own keys everywhere else, and a number field must
  // keep them.
  box.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") setLevel(box.value, { from: box });
  });
  range.addEventListener("input", () => setLevel(range.value, { from: range }));
  byId("sea-level-presets")?.addEventListener("click", (e) => {
    const button = e.target.closest("[data-level]");
    if (button) setLevel(button.dataset.level);
  });
  setLevel(seaLevel.metres);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
