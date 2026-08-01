/* ═══════════════════════════════════════════════════════════════════════
   GeoID — v2 site behaviour (loaded with defer on every content page)

   Adds the rise-into-view motion to existing markup without any per-page
   edits: common card/section selectors are tagged .v2-rise, then an
   IntersectionObserver brings them in. Everything is gated on the .anim
   class + a failsafe, so content can never be stranded invisible.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!("IntersectionObserver" in window) || reduced) return;

  /* Blocks that should rise. Order matters: earlier = more specific
     containers; an element inside an already-tagged parent is skipped so
     nested cards don't double-animate. */
  var SELECTORS = [
    ".section-panel", ".glass-panel",
    ".feature-card", ".doc-card", ".solver-card", ".hazard-card",
    ".source-card", ".catalog-card", ".course-card", ".resource-card",
    ".result-card", ".stat-card", ".module-card", ".metric-card",
    ".mission-card", ".panel-card", ".launch-card", ".launch-entry",
    ".legal-header", ".legal-body",
    ".section-head", ".team-card", ".blog-card", ".update-card",
    ".contact-form", ".involvement-card", ".program-card", ".solution-card"
  ];

  function init() {
    var seen = [];
    var els = [];
    SELECTORS.forEach(function (sel) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
        var covered = seen.some(function (p) { return p.contains(el); });
        if (!covered) { seen.push(el); els.push(el); }
      });
    });
    if (!els.length) return;

    /* Only elements below the fold animate — tagging in-view content after
       first paint would make the visible page blink. */
    var fold = window.innerHeight * 0.92;
    var below = els.filter(function (el) {
      return el.getBoundingClientRect().top > fold;
    });
    if (!below.length) return;

    document.documentElement.classList.add("anim");
    below.forEach(function (el) { el.classList.add("v2-rise"); });

    /* Stagger siblings that sit in the same row. */
    var lastTop = null, k = 0;
    below.forEach(function (el) {
      var t = Math.round(el.getBoundingClientRect().top / 40);
      k = (t === lastTop) ? k + 1 : 0;
      lastTop = t;
      el.style.setProperty("--v2-d", Math.min(k, 4) * 90 + "ms");
    });

    var reported = false;
    var io = new IntersectionObserver(function (entries) {
      reported = true;
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.1 });
    below.forEach(function (el) { io.observe(el); });

    /* Failsafe: if the observer never reports (non-compositing tab,
       prerender, webview), drop the effect and show everything. */
    setTimeout(function () {
      if (reported) return;
      io.disconnect();
      document.documentElement.classList.remove("anim");
    }, 1400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
