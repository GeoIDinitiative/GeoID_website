document.addEventListener("DOMContentLoaded", () => {

  /* ─────────────────────────────────────
     Navigation
  ───────────────────────────────────── */
  const nav       = document.querySelector(".site-nav");
  const toggle    = document.querySelector(".nav-toggle");
  const dropdowns = Array.from(document.querySelectorAll(".nav-dropdown"));

  /* Mark parent dropdown toggle as active when a child link is the current page */
  document.querySelectorAll(".nav-dropdown-menu a.active").forEach(child => {
    const toggle = child.closest(".nav-dropdown")?.querySelector(".nav-dropdown-toggle");
    if (toggle) toggle.classList.add("active");
  });

  if (nav && toggle) {
    const closeDropdowns = () => {
      dropdowns.forEach(d => d.classList.remove("is-open"));
    };

    const setExpanded = (expanded) => {
      nav.classList.toggle("is-open", expanded);
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.setAttribute("aria-label", expanded ? "Close navigation menu" : "Open navigation menu");
      if (!expanded) closeDropdowns();
    };

    setExpanded(false);

    toggle.addEventListener("click", () => setExpanded(!nav.classList.contains("is-open")));

    dropdowns.forEach(dropdown => {
      const trigger = dropdown.querySelector(".nav-dropdown-toggle");
      if (!trigger) return;
      trigger.addEventListener("click", (e) => {
        if (window.innerWidth > 980) return;
        const willOpen = !dropdown.classList.contains("is-open");
        closeDropdowns();
        dropdown.classList.toggle("is-open", willOpen);
      });
    });

    nav.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => {
        if (window.innerWidth <= 980) setExpanded(false);
      });
    });

    document.addEventListener("click", (e) => {
      if (!nav.contains(e.target)) closeDropdowns();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 980) setExpanded(false);
      closeDropdowns();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { setExpanded(false); closeDropdowns(); }
    });
  }

  /* ─────────────────────────────────────
     Scroll Reveal
  ───────────────────────────────────── */
  (function initReveal() {
    document.body.classList.add("js-loaded");

    const SELECTOR = [
      ".cyan-tile",
      ".section-panel",
      ".cta-tile",
    ].join(",");

    const targets = Array.from(document.querySelectorAll(SELECTOR));
    if (!targets.length) return;

    const obs = new IntersectionObserver((entries) => {
      let delay = 0;
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        setTimeout(() => el.classList.add("reveal-visible"), delay);
        delay = Math.min(delay + 90, 360);
        obs.unobserve(el);
      });
    }, { threshold: 0.07, rootMargin: "0px 0px -32px 0px" });

    const vp = window.innerHeight;

    targets.forEach(el => {
      el.classList.add("reveal");
      const rect = el.getBoundingClientRect();
      if (rect.top < vp && rect.bottom > 0) {
        // Already in viewport — show immediately, no animation
        el.classList.add("reveal-visible");
      } else {
        obs.observe(el);
      }
    });
  })();

  /* ─────────────────────────────────────
     Tracer Ring + Tile Protrusion
  ───────────────────────────────────── */
  (function initTracers() {
    const SELECTOR = [
      ".cyan-tile",
      ".section-panel",
      ".cta-tile",
      ".team-card",
      ".solution-card",
      ".program-card",
      ".involve-card",
      ".collab-card",
      ".donate-panel",
      ".questionnaire-panel",
      ".about-explorer-tile",
      ".space-panel",
    ].join(",");

    document.querySelectorAll(SELECTOR).forEach(tile => {
      const pos = getComputedStyle(tile).position;
      if (pos === "static") tile.style.position = "relative";
      tile.classList.add("has-tracer");
    });
  })();

});
