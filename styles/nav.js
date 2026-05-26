(function () {
  // ─────────────────────────────────────────────────────────────────────
  // Note: the hamburger toggle, dropdown toggles, document-tap-outside
  // handler, and mobile link-close handler are owned by /scripts/site.js.
  // ─────────────────────────────────────────────────────────────────────

  // ── Account button: always routes to /account/, which renders the
  //    sign-in form when signed out and the member panel when signed
  //    in. Label flips to "Account" when signed in. ──────────────────
  // ── Live auth-state reflection on the nav button ──────────────────────
  // Once the Supabase runtime loads, swap the button label + dataset
  // flag so the click router above routes correctly.
  async function reflectAuthState() {
    try {
      if (!window.GEOID_MEMBERSHIP_CONFIG_READY) return;
      // Lazy-load the membership runtime if it hasn't been pulled in yet.
      if (!window.GeoIDAuth) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = '/scripts/membership.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const apply = (signedIn) => {
        document.querySelectorAll('[data-action="sign-in"]').forEach((el) => {
          el.dataset.signedIn = signedIn ? "true" : "false";
          el.textContent = signedIn ? "Account" : "Sign In";
        });
      };
      const session = await window.GeoIDAuth.getSession();
      apply(!!session?.user);
      // Keep the label in sync with future auth changes (sign-in / sign-out
      // happening in another tab, etc).
      window.GeoIDAuth.onChange((event, sess) => apply(!!sess?.user));
    } catch (err) {
      // Silently ignore — fall back to default "Sign In" label.
      console.debug("[GeoID nav] auth reflect skipped:", err && err.message);
    }
  }

  // membership-config.js may or may not be in the page already; load it
  // if missing, then reflect.
  if (window.GEOID_MEMBERSHIP_CONFIG_READY === undefined) {
    const s = document.createElement('script');
    s.src = '/scripts/membership-config.js';
    s.onload = reflectAuthState;
    document.head.appendChild(s);
  } else {
    reflectAuthState();
  }

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
