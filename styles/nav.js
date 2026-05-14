(function () {
  const nav    = document.querySelector('.site-nav');
  const toggle = document.querySelector('.nav-toggle');
  if (!nav || !toggle) return;

  function open()  { nav.classList.add('is-open');    toggle.setAttribute('aria-expanded', 'true'); }
  function close() { nav.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); }

  toggle.addEventListener('click', () => nav.classList.contains('is-open') ? close() : open());

  // Tap outside to close
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) close(); });

  // Dropdown toggles on mobile
  nav.querySelectorAll('.nav-dropdown-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (window.innerWidth > 980) return;
      e.preventDefault();
      const dd = btn.closest('.nav-dropdown');
      const wasOpen = dd.classList.contains('is-open');
      nav.querySelectorAll('.nav-dropdown').forEach((d) => d.classList.remove('is-open'));
      if (!wasOpen) dd.classList.add('is-open');
    });
  });

  // Close on link click (mobile only)
  nav.querySelectorAll('.nav-links a:not(.nav-dropdown-toggle)').forEach((a) => {
    a.addEventListener('click', () => { if (window.innerWidth <= 980) close(); });
  });

  // ── Membership Sign-In handler ─────────────────────────────────────────────
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
