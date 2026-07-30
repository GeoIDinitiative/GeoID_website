(function () {
  // ─────────────────────────────────────────────────────────────────────
  // Note: the hamburger toggle, dropdown toggles, document-tap-outside
  // handler, and mobile link-close handler are owned by /scripts/site.js.
  // ─────────────────────────────────────────────────────────────────────

  // There is no account system: the viewers are open to everyone, so the nav
  // carries no sign-in button and this file no longer loads any auth runtime.

  // ── Site-wide service worker registration ─────────────────────────────────
  // Registers /sw.js at root scope so all pages benefit from cache-first
  // static asset serving (shared.css, nav.js, fonts, images) and instant
  // repeat-visit load times. HTML itself remains network-first so edits
  // always reach the user on next visit.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(e => console.debug('[GeoID] site SW registration failed:', e));
  }
})();
