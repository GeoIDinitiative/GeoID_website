/**
 * THE EARTH LEG'S PHOTOGRAPHS: coming home by way of the station.
 *
 * Every other world's transit is the drawn cruise alone. Earth's is the
 * return trip (you only take it from another world: on Earth its node in the
 * worlds bar is "you are here"), and it arrives at the International Space
 * Station, so behind the cruise run the station's own photographs -- NASA,
 * public domain, listed in /load_screen/iss/frames.json with their ids.
 * Separate from the start-up montage (/load_screen/earth/), which is the
 * first arrival of a session and stays as it is.
 *
 * Screen-blended over the chart at the manifest's opacity, so the stars and
 * the course still read through. A slow drift on each frame unless reduced
 * motion is asked for. Fades out with the cruise when the viewer takes over
 * (transit's crossover marks the viewer frame `data-crossed`).
 */
(function () {
  "use strict";
  let dest = "";
  try { dest = (new URLSearchParams(window.location.search).get("destination") || "").toLowerCase(); } catch (_e) {}
  if (dest !== "earth") return;

  const DIR = "/load_screen/iss/";
  const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const layer = document.createElement("div");
  layer.id = "tx-photos";
  layer.setAttribute("aria-hidden", "true");
  const cap = document.createElement("p");
  cap.id = "tx-photo-cap";
  document.body.appendChild(layer);
  document.body.appendChild(cap);

  let timer = null;
  function run(m) {
    const frames = (m && m.frames || []).filter((f) => f && f.file);
    if (!frames.length) return;
    const hold = Math.max(800, m.hold_ms || 2600);
    const fade = Math.max(300, m.fade_ms || 1200);
    layer.style.setProperty("--tx-photo-opacity", String(m.opacity || 0.42));
    layer.style.setProperty("--tx-photo-fade", `${fade}ms`);
    // One ahead, never all at once: the Earth viewer is loading behind this.
    const imgs = frames.map(() => { const im = new Image(); im.alt = ""; im.decoding = "async"; layer.appendChild(im); return im; });
    const want = (n) => { const im = imgs[n % imgs.length]; if (!im.getAttribute("src")) im.src = DIR + frames[n % frames.length].file; };
    want(0); want(1);
    let i = -1;
    function show(n) {
      i = n % frames.length;
      if (imgs[i].complete && imgs[i].naturalWidth === 0) { timer = setTimeout(() => show(i + 1), 0); return; }
      imgs.forEach((im, k) => im.classList.toggle("on", k === i));
      want(i + 1);
      if (!still) {
        imgs[i].animate([{ transform: "scale(1.04)" }, { transform: "scale(1.1) translate(-1%, -0.5%)" }],
          { duration: hold + fade + 600, fill: "forwards", easing: "linear" });
      }
      const f = frames[i];
      cap.textContent = [f.place, f.coord, f.src].filter(Boolean).join("  ·  ");
      timer = setTimeout(() => show(i + 1), hold + fade);
    }
    const first = imgs[0];
    if (first.complete) show(0);
    else { first.addEventListener("load", () => show(0), { once: true }); first.addEventListener("error", () => show(0), { once: true }); }
  }
  fetch(DIR + "frames.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then(run).catch(() => {});

  // The hand-over: out with the cruise.
  const viewer = document.getElementById("viewer-frame");
  const end = () => {
    clearTimeout(timer);
    layer.classList.add("is-gone");
    cap.classList.add("is-gone");
  };
  if (viewer) {
    new MutationObserver(() => { if (viewer.dataset.crossed === "1") end(); })
      .observe(viewer, { attributes: true, attributeFilter: ["data-crossed"] });
  }
})();
