/**
 * The instrument strip: a slim live readout under the Network's header.
 *
 *   UTC 17:42:09 · Latest M4.5+ M5.1 · 98 km SSE of … · 23 min ago · Kp 3.3 quiet · Plate: …
 *
 * WHY. A network of Earth scientists should feel connected to the Earth it
 * studies. Real, current measurements -- not decoration -- are what make the
 * interface feel alive: the clock scientists log in, the most recent
 * significant earthquake (USGS, M4.5+, past day), and the planetary K-index
 * (NOAA SWPC, the 3-hourly geomagnetic activity behind the aurora). The plate
 * label names the photograph behind the page, as a specimen is labelled.
 *
 * Both feeds are public, CORS-open and official; each value links to its
 * source and says whose it is. They refresh every five minutes and only
 * while the tab is visible, so a background tab costs nothing. If a feed is
 * unreachable its slot says so quietly rather than disappearing.
 */
import { h, put, clear, pollWhileVisible } from "./dom.js?v=20261023-5845e91";

const QUAKES = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";
const KP = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";

/** NOAA's G-scale for a Kp value: the words a space-weather bulletin uses. */
export function kpLevel(kp) {
  if (!Number.isFinite(kp)) return { word: "—", tone: "quiet" };
  if (kp >= 9) return { word: "G5 extreme storm", tone: "storm" };
  if (kp >= 8) return { word: "G4 severe storm", tone: "storm" };
  if (kp >= 7) return { word: "G3 strong storm", tone: "storm" };
  if (kp >= 6) return { word: "G2 moderate storm", tone: "storm" };
  if (kp >= 5) return { word: "G1 minor storm", tone: "storm" };
  if (kp >= 4) return { word: "active", tone: "active" };
  return { word: "quiet", tone: "quiet" };
}

/** "23 min ago" from epoch milliseconds. */
export function sinceText(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  return `${hrs} h ago`;
}

/** The latest event from a USGS GeoJSON summary, or null. */
export function latestQuake(geojson) {
  const fs = Array.isArray(geojson?.features) ? geojson.features : [];
  const best = fs.reduce((a, f) => (!a || (f.properties?.time || 0) > (a.properties?.time || 0) ? f : a), null);
  if (!best) return null;
  const p = best.properties || {};
  return {
    mag: Number(p.mag), place: String(p.place || "unknown location"), time: Number(p.time),
    url: /^https:\/\/earthquake\.usgs\.gov\//.test(p.url || "") ? p.url : "https://earthquake.usgs.gov/earthquakes/map/",
  };
}

/** The most recent Kp from SWPC's product (array of objects, or the older array-of-arrays shape). */
export function latestKp(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const last = rows[rows.length - 1];
  if (Array.isArray(last)) return { kp: Number(last[1]), at: String(last[0]) };
  return { kp: Number(last.Kp ?? last.kp), at: String(last.time_tag || "") };
}

export function createInstruments() {
  const clock = h("span", { class: "s-inst-val s-inst-clock" });
  const quake = h("span", { class: "s-inst-val" }, "…");
  const kp = h("span", { class: "s-inst-val" }, "…");
  const plate = h("span", { class: "s-inst-plate" });
  const root = h("div", { class: "s-instruments", role: "group", "aria-label": "Live Earth readings" },
    h("span", { class: "s-inst" }, h("span", { class: "s-inst-key", text: "UTC" }), clock),
    h("span", { class: "s-inst" }, h("span", { class: "s-inst-key", text: "Latest M4.5+" }), quake),
    h("span", { class: "s-inst" }, h("span", { class: "s-inst-key", text: "Kp" }), kp),
    plate);

  const tick = () => { clock.textContent = new Date().toISOString().slice(11, 19); };
  tick();
  const clockTimer = setInterval(tick, 1000);

  const refresh = async () => {
    try {
      const q = latestQuake(await (await fetch(QUAKES, { cache: "no-cache" })).json());
      clear(quake);
      if (q) {
        put(quake, h("a", { href: q.url, target: "_blank", rel: "noopener noreferrer", title: "USGS event page" },
          `M${q.mag.toFixed(1)}`), ` · ${q.place} · ${sinceText(q.time)}`);
        quake.dataset.tone = q.mag >= 6 ? "storm" : q.mag >= 5 ? "active" : "quiet";
      } else put(quake, "none in the past day");
    } catch (error) { quake.textContent = "USGS unreachable"; }
    try {
      const k = latestKp(await (await fetch(KP, { cache: "no-cache" })).json());
      const level = kpLevel(k?.kp);
      clear(kp);
      put(kp, h("a", { href: "https://www.swpc.noaa.gov/products/planetary-k-index", target: "_blank", rel: "noopener noreferrer",
        title: `NOAA SWPC planetary K-index${k?.at ? `, ${k.at} UTC` : ""}` }, Number.isFinite(k?.kp) ? k.kp.toFixed(1) : "—"), ` ${level.word}`);
      kp.dataset.tone = level.tone;
    } catch (error) { kp.textContent = "NOAA unreachable"; }
  };
  const stopPoll = pollWhileVisible(refresh, 5 * 60 * 1000);
  refresh();

  /** The photograph behind the page, labelled like a plate. */
  function setPlate(frame, ofTheDay) {
    clear(plate);
    if (!frame) return;
    plate.classList.remove("is-new");
    void plate.offsetWidth; // restart the label's short fade
    plate.classList.add("is-new");
    put(plate, h("span", { class: "s-inst-key", text: ofTheDay ? "Image of the day" : "Plate" }),
      h("span", { class: "s-inst-val", text: [frame.place, frame.coord].filter(Boolean).join(" · ") }),
      frame.src ? h("span", { class: "s-inst-src", text: frame.src }) : null);
  }

  return { root, setPlate, stop() { clearInterval(clockTimer); if (typeof stopPoll === "function") stopPoll(); } };
}
