/**
 * Rich post content: the before/after comparison, the monitor chart, the
 * field-measurement table with its stereonets, and the photo gallery with
 * its lightbox. Drawn with the DOM builder and plain canvas -- no libraries
 * -- and every picture has words beside it: alt text on images, an
 * aria-label on each canvas, a data table under each chart.
 *
 * The arithmetic (ticks, projection, notation) is plotmath.js, tested in
 * node; this file only draws it.
 */
import { h, put, clear, dateText, timeEl } from "./dom.js?v=20261024-36652d4";
import { videoPlayer } from "./embed.js?v=20261024-36652d4";
import {
  niceTicks, niceDomain, timeTicks, nearestIndex, seriesByUnit, lineToXY, poleOf, planeCircle,
  measurementText, measurementGlyphLabel, MEASUREMENT_LABELS,
} from "./plotmath.js?v=20261024-36652d4";

// The map's palette, so a series reads the same colour wherever it is drawn.
export const SERIES_COLOURS = ["rgb(0, 212, 192)", "rgb(240, 176, 48)", "#9aa8ff", "#8be28b", "#ff9f7a", "#d8c4ff"];

// A video is neither: it gets a player (embed.js), not a thumbnail or a link.
const isVideoItem = (m) => m && String(m.type || "").startsWith("video/");
const isImage = (m) => m && !isVideoItem(m) && m.type !== "application/pdf" && !/\.pdf($|\?)/i.test(m.key || "");

/**
 * What a before/after reference points at: one of the post's own images (by
 * key, so its alt text comes with it), an https URL, or nothing drawable (a
 * GeoHUB layer id, which is shown as text).
 */
export function resolveImageRef(ref, media = []) {
  const text = String(ref || "").trim();
  if (!text) return null;
  const own = media.find((m) => m.key === text || m.url === text);
  if (own && isImage(own)) return { url: own.url, alt: own.alt || "" };
  if (/^https?:\/\//i.test(text)) return { url: text, alt: "" };
  return null;
}

// ── Before / after ─────────────────────────────────────────────────────────

/**
 * A swipe comparison: the "after" image underneath, the "before" image on top
 * clipped to the left of the divider. The divider is a real slider
 * (role=slider) -- arrows move it 2%, Shift+arrows or Page keys 10%, Home and
 * End go to either edge -- and a pointer can drag anywhere on the picture.
 */
export function compareSlider({ before, after, beforeLabel = "Before", afterLabel = "After", beforeDate = null, afterDate = null }) {
  let pos = 50;
  const cap = (label, date) => [label, date ? ` · ${dateText(date)}` : ""].join("");
  const imgAfter = h("img", { class: "s-compare-img", src: after.url, alt: `${afterLabel}: ${after.alt || "after image"}`, loading: "lazy", decoding: "async", draggable: "false" });
  const imgBefore = h("img", { class: "s-compare-img s-compare-top", src: before.url, alt: `${beforeLabel}: ${before.alt || "before image"}`, loading: "lazy", decoding: "async", draggable: "false" });
  const handle = h("div", {
    class: "s-compare-handle", role: "slider", tabindex: "0",
    "aria-label": `Comparison divider: left shows ${beforeLabel}, right shows ${afterLabel}`,
    "aria-valuemin": "0", "aria-valuemax": "100",
  }, h("span", { class: "s-compare-grip", "aria-hidden": "true" }, "◀ ▶"));
  const stage = h("div", { class: "s-compare-stage" }, imgAfter, imgBefore, handle,
    h("span", { class: "s-compare-tag s-compare-tag-l", "aria-hidden": "true" }, cap(beforeLabel, beforeDate)),
    h("span", { class: "s-compare-tag s-compare-tag-r", "aria-hidden": "true" }, cap(afterLabel, afterDate)));
  const set = (p) => {
    pos = Math.max(0, Math.min(100, p));
    imgBefore.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
    handle.style.left = `${pos}%`;
    handle.setAttribute("aria-valuenow", String(Math.round(pos)));
    handle.setAttribute("aria-valuetext", `${Math.round(pos)}% ${beforeLabel}, ${Math.round(100 - pos)}% ${afterLabel}`);
  };
  set(50);
  // The stage takes the after image's shape, so neither image is distorted.
  imgAfter.addEventListener("load", () => {
    if (imgAfter.naturalWidth && imgAfter.naturalHeight) stage.style.aspectRatio = `${imgAfter.naturalWidth} / ${imgAfter.naturalHeight}`;
  });
  let dragging = false;
  const fromPointer = (e) => {
    const r = stage.getBoundingClientRect();
    if (r.width) set(((e.clientX - r.left) / r.width) * 100);
  };
  stage.addEventListener("pointerdown", (e) => {
    dragging = true; stage.setPointerCapture(e.pointerId); fromPointer(e); handle.focus({ preventScroll: true });
  });
  stage.addEventListener("pointermove", (e) => { if (dragging) fromPointer(e); });
  const stop = () => { dragging = false; };
  stage.addEventListener("pointerup", stop);
  stage.addEventListener("pointercancel", stop);
  handle.addEventListener("keydown", (e) => {
    const big = e.shiftKey ? 10 : 2;
    const moves = { ArrowLeft: -big, ArrowDown: -big, ArrowRight: big, ArrowUp: big, PageDown: -10, PageUp: 10 };
    if (e.key in moves) set(pos + moves[e.key]);
    else if (e.key === "Home") set(0);
    else if (e.key === "End") set(100);
    else return;
    e.preventDefault();
  });
  return h("figure", { class: "s-compare" }, stage,
    h("figcaption", { class: "s-hint" }, `Drag the divider, or focus it and use the arrow keys, to compare ${beforeLabel.toLowerCase()} (left) with ${afterLabel.toLowerCase()} (right).`));
}

// ── Monitor chart ──────────────────────────────────────────────────────────

const looksLikeTime = (xs) => xs.length && Math.min(...xs) > 1e8;

function formatTick(t, unit) {
  const d = new Date(t * 1000);
  if (unit === "year") return String(d.getUTCFullYear());
  if (unit === "month") return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
  if (unit === "day") return d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
const formatValue = (v) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : String(Number(v.toPrecision(4))));

/**
 * One chart per unit (plotmath seriesByUnit), each with its series in the
 * palette, round ticks on both axes, the unit on the value axis, and a
 * readout that follows the pointer -- or the arrow keys, with the chart
 * focused -- naming every series' value at that time.
 */
export function timeChart(series, { updatedAt = null } = {}) {
  const groups = seriesByUnit(series);
  if (!groups.length) return null;
  let colourIndex = 0;
  return h("div", { class: "s-monitor" },
    updatedAt ? h("p", { class: "s-muted" }, "Updated ", timeEl(updatedAt)) : null,
    groups.map((g) => unitChart(g, g.series.map(() => SERIES_COLOURS[colourIndex++ % SERIES_COLOURS.length]))));
}

function unitChart({ unit, series }, colours) {
  const W = 720; const H = 260;
  const M = { l: 58, r: 16, t: 14, b: 34 };
  const allX = series.flatMap((s) => s.points.map((p) => p[0]));
  const allY = series.flatMap((s) => s.points.map((p) => p[1]));
  const isTime = looksLikeTime(allX);
  let x0 = Math.min(...allX); let x1 = Math.max(...allX);
  if (x0 === x1) { x0 -= isTime ? 86400 : 1; x1 += isTime ? 86400 : 1; }
  const [y0, y1] = niceDomain(Math.min(...allY), Math.max(...allY), 5);
  const sx = (x) => M.l + ((x - x0) / (x1 - x0)) * (W - M.l - M.r);
  const sy = (y) => H - M.b - ((y - y0) / ((y1 - y0) || 1)) * (H - M.t - M.b);
  const times = [...new Set(allX)].sort((a, b) => a - b);
  const xLabel = (t) => (isTime ? dateText(t, true) : formatValue(t));
  const last = series.map((s) => `${s.label} latest ${formatValue(s.points[s.points.length - 1][1])}${unit ? ` ${unit}` : ""}`).join("; ");
  const canvas = h("canvas", {
    class: "s-chart", width: W * 2, height: H * 2, tabindex: "0", role: "img",
    "aria-label": `Chart${unit ? ` in ${unit}` : ""}: ${series.map((s) => s.label).join(", ")}. ${last}. Use the left and right arrow keys to read values.`,
  });
  const readout = h("p", { class: "s-chart-readout", "aria-live": "polite" }, "Point at the chart, or focus it and use the arrow keys, to read values.");
  let cursor = -1;

  const draw = () => {
    const ctx = canvas.getContext("2d");
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ink = getComputedStyle(canvas).color || "#9aa4b2";
    ctx.font = "11px system-ui, sans-serif";
    // Grid and value axis.
    ctx.strokeStyle = "rgba(140, 160, 200, 0.16)"; ctx.lineWidth = 1;
    ctx.fillStyle = ink; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const v of niceTicks(y0, y1, 5)) {
      const y = Math.round(sy(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(M.l, y); ctx.lineTo(W - M.r, y); ctx.stroke();
      ctx.fillText(formatValue(v), M.l - 6, y);
    }
    // Time (or x) axis.
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const xt = isTime ? timeTicks(x0, x1, 8) : { ticks: niceTicks(x0, x1, 6), unit: "" };
    for (const t of xt.ticks) {
      const x = Math.round(sx(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, H - M.b); ctx.lineTo(x, H - M.b + 4); ctx.stroke();
      ctx.fillText(isTime ? formatTick(t, xt.unit) : formatValue(t), x, H - M.b + 7);
    }
    ctx.strokeStyle = "rgba(140, 160, 200, 0.45)";
    ctx.beginPath(); ctx.moveTo(M.l, M.t); ctx.lineTo(M.l, H - M.b); ctx.lineTo(W - M.r, H - M.b); ctx.stroke();
    if (unit) {
      ctx.save(); ctx.translate(14, (M.t + H - M.b) / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(unit, 0, 0); ctx.restore();
    }
    // Series.
    series.forEach((s, i) => {
      ctx.strokeStyle = colours[i]; ctx.lineWidth = 2; ctx.lineJoin = "round";
      ctx.beginPath();
      s.points.forEach(([x, y], k) => (k ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
      ctx.stroke();
      if (s.points.length <= 60) {
        ctx.fillStyle = colours[i];
        for (const [x, y] of s.points) { ctx.beginPath(); ctx.arc(sx(x), sy(y), 2.2, 0, Math.PI * 2); ctx.fill(); }
      }
    });
    // Cursor.
    if (cursor >= 0) {
      const t = times[cursor];
      const x = sx(t);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.45)"; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, M.t); ctx.lineTo(x, H - M.b); ctx.stroke(); ctx.setLineDash([]);
      series.forEach((s, i) => {
        const k = nearestIndex(s.points.map((p) => p[0]), t);
        const [px, py] = s.points[k];
        ctx.fillStyle = colours[i]; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx(px), sy(py), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
    }
  };

  const point = (i) => {
    cursor = Math.max(0, Math.min(times.length - 1, i));
    const t = times[cursor];
    clear(readout);
    put(readout, h("strong", {}, xLabel(t)), " — ",
      series.map((s, k) => {
        const p = s.points[nearestIndex(s.points.map((q) => q[0]), t)];
        return h("span", { class: "s-chart-val" }, h("span", { class: "s-swatch", style: `background:${colours[k]}` }),
          ` ${s.label}: ${formatValue(p[1])}${unit ? ` ${unit}` : ""}${p[0] !== t ? ` (at ${xLabel(p[0])})` : ""}${k < series.length - 1 ? ";" : ""}`);
      }));
    draw();
  };
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const x = ((e.clientX - r.left) / r.width) * W;
    point(nearestIndex(times, x0 + ((x - M.l) / (W - M.l - M.r)) * (x1 - x0)));
  });
  canvas.addEventListener("pointerleave", () => { if (document.activeElement !== canvas) { cursor = -1; draw(); } });
  canvas.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -10, PageUp: 10 }[e.key];
    if (step) point((cursor < 0 ? (step > 0 ? -1 : times.length) : cursor) + step);
    else if (e.key === "Home") point(0);
    else if (e.key === "End") point(times.length - 1);
    else return;
    e.preventDefault();
  });
  requestAnimationFrame(draw);

  const legend = h("ul", { class: "s-legend" }, series.map((s, i) =>
    h("li", {}, h("span", { class: "s-swatch", style: `background:${colours[i]}` }), `${s.label}${unit ? ` (${unit})` : ""}`)));
  const rows = times.slice(-500);
  const table = h("details", { class: "s-chart-data" }, h("summary", {}, `The data as a table${times.length > 500 ? " (latest 500 times)" : ""}`),
    h("div", { class: "s-table-wrap" }, h("table", { class: "s-table" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, isTime ? "Time" : "x"), series.map((s) => h("th", { scope: "col" }, `${s.label}${unit ? ` (${unit})` : ""}`)))),
      h("tbody", {}, rows.map((t) => h("tr", {}, h("td", {}, xLabel(t)),
        series.map((s) => { const p = s.points.find((q) => q[0] === t); return h("td", {}, p ? formatValue(p[1]) : "—"); })))))));
  return h("figure", { class: "s-chart-fig" },
    h("figcaption", {}, series.map((s) => s.label).join(", "), unit ? ` (${unit})` : ""),
    canvas, readout, legend, table);
}

// ── Field measurements ─────────────────────────────────────────────────────

const ORIENTED = (m) => m?.type === "lineation" || Number.isFinite(m?.values?.dip);

function drawNet(canvas, list, size, { ticks = true, colourStart = 0 } = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = 2;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const c = size / 2; const R = size / 2 - (ticks ? 9 : 3);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "rgba(4, 8, 22, 0.9)";
  ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(0, 225, 210, 0.55)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = "rgba(140, 160, 200, 0.25)";
  ctx.beginPath(); ctx.moveTo(c - 3, c); ctx.lineTo(c + 3, c); ctx.moveTo(c, c - 3); ctx.lineTo(c, c + 3); ctx.stroke();
  if (ticks) {
    ctx.fillStyle = "rgba(200, 210, 230, 0.8)"; ctx.font = "9px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("N", c, c - R - 1);
  } else {
    ctx.strokeStyle = "rgba(200, 210, 230, 0.6)";
    ctx.beginPath(); ctx.moveTo(c, c - R); ctx.lineTo(c, c - R + 3); ctx.stroke();
  }
  list.forEach((m, i) => {
    const colour = SERIES_COLOURS[(colourStart + i) % SERIES_COLOURS.length];
    const v = m.values || {};
    ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 1.5;
    if (m.type === "lineation") {
      const [x, y] = lineToXY(v.trend, v.plunge, R);
      ctx.fillRect(c + x - 3, c + y - 3, 6, 6);
      return;
    }
    const pts = planeCircle(v.dip_direction, v.dip, R, 48);
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(c + x, c + y) : ctx.moveTo(c + x, c + y)));
    ctx.stroke();
    const pole = poleOf(v.dip_direction, v.dip);
    const [px, py] = lineToXY(pole.trend, pole.plunge, R);
    ctx.beginPath(); ctx.arc(c + px, c + py, 2.6, 0, Math.PI * 2); ctx.fill();
  });
}

function netCanvas(list, size, label, ticks, colourStart = 0) {
  const canvas = h("canvas", { class: "s-net", width: size * 2, height: size * 2, style: `width:${size}px;height:${size}px`, role: "img", "aria-label": label });
  requestAnimationFrame(() => drawNet(canvas, list, size, { ticks, colourStart }));
  return canvas;
}

/** The table of measurements, a small stereonet per orientation, and one net with all of them. */
export function measurementsBlock(list) {
  const items = (Array.isArray(list) ? list : []).filter((m) => m && MEASUREMENT_LABELS[m.type]);
  if (!items.length) return null;
  const oriented = items.filter(ORIENTED);
  const colourOf = new Map(oriented.map((m, i) => [m, i]));
  const table = h("div", { class: "s-table-wrap" }, h("table", { class: "s-table s-measure-table" },
    h("caption", { class: "s-sr" }, "Field measurements"),
    h("thead", {}, h("tr", {},
      h("th", { scope: "col" }, "#"), h("th", { scope: "col" }, "Type"), h("th", { scope: "col" }, "Reading"),
      h("th", { scope: "col" }, "Plot"), h("th", { scope: "col" }, "Note"))),
    h("tbody", {}, items.map((m, i) => {
      const v = m.values || {};
      const k = colourOf.get(m);
      // Each row's glyph is drawn alone, but in its colour on the summary net.
      const glyph = ORIENTED(m) ? netCanvas([m], 44, measurementGlyphLabel(m), false, k || 0) : null;
      return h("tr", {},
        h("td", {}, String(i + 1)),
        h("td", {}, m.type === "measurement" && v.label ? v.label : MEASUREMENT_LABELS[m.type]),
        h("td", { class: "s-mono" }, measurementText(m)),
        h("td", {}, glyph ? h("span", { class: "s-net-cell" }, glyph, k != null && oriented.length > 1 ? h("span", { class: "s-swatch", style: `background:${SERIES_COLOURS[k % SERIES_COLOURS.length]}`, "aria-hidden": "true" }) : null) : h("span", { class: "s-muted", text: "—" })),
        h("td", {}, m.note || ""));
    }))));
  const summary = oriented.length > 1
    ? h("figure", { class: "s-net-summary" },
      netCanvas(oriented, 220, `Stereonet of ${oriented.length} orientations: ${oriented.map(measurementText).join("; ")}.`, true),
      h("figcaption", { class: "s-hint", text: "Lower-hemisphere, equal-area projection, north up. Planes are great circles with their poles as dots; lineations are squares." }))
    : null;
  return h("section", { class: "s-measurements", "aria-label": "Field measurements" },
    h("h2", { class: "s-h3", text: "Measurements" }), summary, table);
}

// ── Gallery and lightbox ───────────────────────────────────────────────────

/**
 * Every image on the post, lazy-loaded, each opening a lightbox: a <dialog>
 * (so Escape and focus trapping come free) with the image, its alt text as
 * the caption, its position, and previous/next by button or arrow key.
 * Focus goes back to the thumbnail that opened it. PDFs stay links.
 */
export function gallery(media, { exclude = [] } = {}) {
  const list = Array.isArray(media) ? media : [];
  const images = list.filter((m) => isImage(m) && m.url && !exclude.includes(m.key));
  const videos = list.filter((m) => isVideoItem(m) && m.url && !exclude.includes(m.key));
  const pdfs = list.filter((m) => !isImage(m) && !isVideoItem(m) && m.url);
  if (!images.length && !pdfs.length && !videos.length) return null;
  const open = (i, opener) => lightbox(images, i, opener);
  const single = images.length === 1;
  const thumbs = images.map((m, i) => {
    const btn = h("button", { type: "button", class: "s-gallery-btn", "aria-label": `Open image ${i + 1} of ${images.length} full size${m.alt ? `: ${m.alt}` : ""}` },
      h("img", { src: m.url, alt: m.alt || "", loading: "lazy", decoding: "async" }));
    btn.addEventListener("click", () => open(i, btn));
    return single ? h("figure", { class: "s-gallery-one" }, btn, m.alt ? h("figcaption", { text: m.alt }) : null) : h("li", {}, btn);
  });
  return h("div", { class: "s-media" },
    videos.map(videoPlayer),
    images.length ? (single ? thumbs[0] : h("ul", { class: "s-gallery", "aria-label": `${images.length} images` }, thumbs)) : null,
    pdfs.map((m) => h("p", {}, h("a", { href: m.url, target: "_blank", rel: "noopener noreferrer" }, `Download the PDF${m.alt ? `: ${m.alt}` : ""}`))));
}

export function lightbox(images, start = 0, opener = null) {
  let i = start;
  const img = h("img", { class: "s-lightbox-img", alt: "" });
  const caption = h("p", { class: "s-lightbox-cap", "aria-live": "polite" });
  const prev = h("button", { type: "button", class: "s-icon-btn s-lightbox-prev", "aria-label": "Previous image" }, "‹");
  const next = h("button", { type: "button", class: "s-icon-btn s-lightbox-next", "aria-label": "Next image" }, "›");
  const close = h("button", { type: "button", class: "s-icon-btn s-lightbox-close", "aria-label": "Close" }, "×");
  const dialog = h("dialog", { class: "s-lightbox", "aria-label": "Image viewer" },
    close, h("figure", {}, img, caption), images.length > 1 ? [prev, next] : null);
  const show = (k) => {
    i = (k + images.length) % images.length;
    const m = images[i];
    img.src = m.url;
    img.alt = m.alt || "";
    clear(caption);
    put(caption, m.alt || h("span", { class: "s-muted", text: "No description was given for this image." }),
      images.length > 1 ? h("span", { class: "s-muted" }, `  ·  ${i + 1} of ${images.length}`) : null);
  };
  prev.addEventListener("click", () => show(i - 1));
  next.addEventListener("click", () => show(i + 1));
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { show(i - 1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { show(i + 1); e.preventDefault(); }
  });
  // A click on the backdrop (the dialog itself, outside the figure) closes it.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { dialog.remove(); opener?.focus?.(); });
  show(i);
  document.body.append(dialog);
  dialog.showModal();
  (images.length > 1 ? next : close).focus();
  return dialog;
}
