// GeoID membership configuration.
//
// This file is intentionally public — only the *anon* Supabase key and the
// Stripe Payment Link / Customer Portal URLs go here. The Supabase
// service-role key and the Stripe secret key MUST NEVER appear in any file
// in this repo. They live only in the Supabase Edge Function environment.
//
// Fill in the four REPLACE_ME values below, then everything else works.
//
// Setup steps in tools/supabase/README.md.
window.GEOID_MEMBERSHIP_CONFIG = Object.freeze({
  // 1) Stripe — subscription Payment Link (recurring £19.99/year).
  //    Configure the post-payment redirect to /membership/welcome/ in Stripe.
  CHECKOUT_URL: "https://buy.stripe.com/28EeVd2St0WOedPadgbV601",

  // 2) Stripe — Customer Portal login link (Dashboard → Settings → Billing
  //    → Customer portal → "Login link"). Members enter their email and
  //    Stripe emails them a one-time portal link.
  PORTAL_URL: "https://billing.stripe.com/p/login/REPLACE_ME_WITH_PORTAL_ID",

  // 3) Supabase project URL (Dashboard → Project Settings → API).
  SUPABASE_URL: "https://REPLACE_ME.supabase.co",

  // 4) Supabase anon (publishable) key — safe to expose. NEVER paste the
  //    service-role key here.
  SUPABASE_ANON_KEY: "REPLACE_ME_WITH_ANON_KEY",

  // Display copy.
  PRICE_DISPLAY: "£19.99",
  PERIOD_DISPLAY: "per year",
  PLAN_NAME: "GeoID Explorer Annual",

  // Destinations that bypass the paywall entirely. Anything not listed here
  // requires an active subscription to load via the transit page.
  FREE_DESTINATIONS: Object.freeze(["earth", "moon"]),
});

// Helper used by feature gates to detect whether the backend has been wired up.
window.GEOID_MEMBERSHIP_CONFIG_READY = (function () {
  const c = window.GEOID_MEMBERSHIP_CONFIG;
  return !!(c
    && c.SUPABASE_URL && !c.SUPABASE_URL.includes("REPLACE_ME")
    && c.SUPABASE_ANON_KEY && !c.SUPABASE_ANON_KEY.includes("REPLACE_ME"));
})();
