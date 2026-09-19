/**
 * What the page is still putting on the globe at launch.
 *
 * The GeoHUB start-up screen used to hand over as soon as the viewer drew one
 * textured frame — and then, for five to ten seconds, the Sentinel-2 mosaic,
 * the plate boundaries, the rivers, the borders and three thousand place
 * names arrived one after another in front of the reader. Anything the page
 * loads BY DEFAULT takes a hold here while it loads; the start-up screen in
 * the shell (index.html, `ready()`) waits until none are held.
 *
 * Every hold ends by itself after `maxMs`: a service that never answers must
 * not keep the screen up (the shell has its own 16 s cap as well). Kept on
 * `window` so two copies of this module — a stamp mismatch — share one list.
 */
const REG = (typeof window !== "undefined")
  ? (window.GeoIDLaunch ||= { pending: new Map(), done: new Map(), started: performance.now() })
  : { pending: new Map(), done: new Map(), started: 0 };

export function holdLaunch(name, maxMs = 12000) {
  const key = `${name}#${REG.pending.size + REG.done.size}`;
  REG.pending.set(key, performance.now());
  let timer = null;
  const release = () => {
    if (!REG.pending.has(key)) return;
    clearTimeout(timer);
    REG.pending.delete(key);
    REG.done.set(key, Math.round(performance.now() - REG.started));
    if (!REG.pending.size && typeof document !== "undefined") {
      document.dispatchEvent(new CustomEvent("geoid:launch-settled", { detail: Object.fromEntries(REG.done) }));
    }
  };
  timer = setTimeout(release, maxMs);
  return release;
}

export function launchPending() {
  return [...REG.pending.keys()];
}
