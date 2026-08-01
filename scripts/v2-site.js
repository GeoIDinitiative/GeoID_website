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
    ".contact-form", ".involvement-card", ".program-card", ".solution-card",

    /* Explorer landings. These pages name nothing like the rest of the site,
       which is why they had no reveals at all — not one selector above
       matched them.

       Only the inner content blocks are listed. The wrappers around them
       (.about-explorer-tile, .new-worlds-layout, .lunar-tile, .space-panel)
       are deliberately absent: with the outermost-only filter below, naming
       a wrapper swallows everything inside it and the whole page reduces to
       a handful of large fades. Revealing the blocks gives the tiles their
       own entrance as you scroll. */
    ".about-explorer-section-block", ".earth-info-block",
    ".new-worlds-tool-item", ".photo-strip"
  ];

  function init() {
    /* Collect every match, then keep only the outermost. The previous version
       skipped an element if an ALREADY-SEEN one contained it, which made the
       result depend on selector order: list a child selector before its
       parent and both got tagged, so a tile animated and then animated its
       own contents again. Filtering afterwards is order-independent. */
    var all = [];
    SELECTORS.forEach(function (sel) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
        if (all.indexOf(el) === -1) all.push(el);
      });
    });
    var els = all.filter(function (el) {
      return !all.some(function (other) { return other !== el && other.contains(el); });
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

    /* Safety sweep. The observer is the primary mechanism, but on a long
       page a fast scroll can carry an element past the viewport without a
       callback ever landing for it — measured on /explorer/, where four
       visible blocks stayed at opacity 0 after scrolling to the bottom.
       Anything at or above the fold is revealed regardless, so content can
       never be left invisible. */
    var ticking = false;
    function sweep() {
      ticking = false;
      var fold = window.innerHeight * 0.95;
      for (var i = below.length - 1; i >= 0; i--) {
        var el = below[i];
        if (el.getBoundingClientRect().top < fold) {
          el.classList.add("in");
          io.unobserve(el);
          below.splice(i, 1);
        }
      }
      if (!below.length) window.removeEventListener("scroll", onScroll);
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(sweep);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
