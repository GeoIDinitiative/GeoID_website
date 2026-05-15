(function () {
  // ─────────────────────────────────────────────────────────────────────
  // Note: the hamburger toggle, dropdown toggles, document-tap-outside
  // handler, and mobile link-close handler are owned by /scripts/site.js.
  // Don't duplicate them here — when both scripts attached click handlers
  // to the same .nav-toggle, every tap fired both, instantly toggling the
  // .is-open class on and then off in the same gesture, so the menu
  // never opened.
  // This file's only remaining job is the Sign-In data-action router.
  // ─────────────────────────────────────────────────────────────────────

  // ── Membership Sign-In handler ─────────────────────────────────────────
  // Any element with [data-action="sign-in"] (e.g. the nav Sign In button)
  // routes to /sign-in/ with the current page as the return target.
  document.addEventListener('click', (e) => {
    const trigger = e.target instanceof Element ? e.target.closest('[data-action="sign-in"]') : null;
    if (!trigger) return;
    e.preventDefault();
    const ret = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/sign-in/?return=${ret}`;
  });
})();
