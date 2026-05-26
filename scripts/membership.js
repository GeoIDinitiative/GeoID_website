// GeoID membership runtime.
//
// Loads the Supabase JS SDK from CDN, exposes a small auth/membership API:
//
//   window.GeoIDAuth.ready()             → Promise that resolves when init is done
//   window.GeoIDAuth.getSession()        → current Supabase session or null
//   window.GeoIDAuth.getUser()           → current user or null
//   window.GeoIDAuth.isMember()          → bool (cached after first check)
//   window.GeoIDAuth.requireMember(ret)  → if not member, redirect to /account/?need=…&return=<ret>
//   window.GeoIDAuth.signInWithPassword({email, password})
//   window.GeoIDAuth.signUp({email, password})
//   window.GeoIDAuth.signInWithMagicLink({email, redirectTo})
//   window.GeoIDAuth.signOut()
//   window.GeoIDAuth.onChange(cb)        → subscribe to auth events
//
//   window.GeoIDMembership.subscribe()   → go to Stripe Checkout (Payment Link)
//   window.GeoIDMembership.portal()      → go to Stripe Customer Portal
//   window.GeoIDMembership.isFreeDestination(key)
//
// If membership-config.js still has REPLACE_ME placeholders, every auth call
// becomes a no-op that alerts the user rather than throwing.
//
// Subscription state is stored in the `memberships` table (see
// tools/supabase/schema.sql). A row exists per user; `active` is true while
// the Stripe subscription is in a paying state. The Stripe webhook updates it.
(function () {
  const CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
  const cfg = window.GEOID_MEMBERSHIP_CONFIG || {};
  const READY = !!window.GEOID_MEMBERSHIP_CONFIG_READY;

  // ── Stripe-link helpers (work without Supabase too) ─────────────────────
  window.GeoIDMembership = {
    subscribe() {
      const url = cfg.CHECKOUT_URL;
      if (!url || url.includes("REPLACE_ME")) {
        alert("Membership checkout isn't configured yet. Add your Stripe subscription Payment Link to /scripts/membership-config.js.");
        return;
      }
      window.location.href = url;
    },
    portal() {
      const url = cfg.PORTAL_URL;
      if (!url || url.includes("REPLACE_ME")) {
        alert("The Stripe Customer Portal isn't configured yet. Add the portal login link to /scripts/membership-config.js.");
        return;
      }
      window.location.href = url;
    },
    isFreeDestination(key) {
      if (!key) return false;
      const free = cfg.FREE_DESTINATIONS || [];
      return free.includes(String(key).toLowerCase());
    },
  };

  // ── Supabase-backed auth ────────────────────────────────────────────────
  let supabase = null;
  let initPromise = null;
  let memberCache = null;       // null = unknown, true/false once checked
  let memberCacheUser = null;   // user id the cache belongs to
  const listeners = new Set();

  function notify(event, session) {
    for (const fn of listeners) {
      try { fn(event, session); } catch (e) { console.error(e); }
    }
  }

  async function init() {
    if (!READY) return null;
    if (supabase) return supabase;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const mod = await import(CDN);
      supabase = mod.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      supabase.auth.onAuthStateChange((event, session) => {
        // Invalidate the membership cache on any auth change.
        memberCache = null;
        memberCacheUser = null;
        notify(event, session);
      });
      return supabase;
    })();
    return initPromise;
  }

  async function getSession() {
    const sb = await init();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data?.session || null;
  }

  async function getUser() {
    const session = await getSession();
    return session?.user || null;
  }

  async function fetchMembership(user) {
    if (!user) return false;
    if (memberCache !== null && memberCacheUser === user.id) return memberCache;
    const sb = await init();
    const { data, error } = await sb
      .from("memberships")
      .select("active, current_period_end")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) { console.warn("[GeoIDAuth] membership lookup failed:", error.message); return false; }
    const now = Date.now();
    const active = !!data?.active && (!data.current_period_end || new Date(data.current_period_end).getTime() > now);
    memberCache = active;
    memberCacheUser = user.id;
    return active;
  }

  async function isMember() {
    const user = await getUser();
    if (!user) return false;
    return fetchMembership(user);
  }

  async function requireMember(returnTo) {
    if (!READY) {
      // Config not wired up — fail open so dev environments still work.
      console.warn("[GeoIDAuth] membership-config.js placeholders detected; paywall disabled.");
      return true;
    }
    const user = await getUser();
    const ret = encodeURIComponent(returnTo || (window.location.pathname + window.location.search));
    // Always redirect the outermost frame so that this works correctly whether
    // called from a top-level page or from inside a same-origin iframe.
    const nav = (window.top || window).location;
    if (!user) {
      // Not signed in at all → bounce to /account/ in signed-out mode.
      nav.href = `/account/?need=signin&return=${ret}`;
      return false;
    }
    const active = await fetchMembership(user);
    if (active) return true;
    // Signed in but no active subscription → /account/ shows the
    // subscribe state. Returning to the locked page happens automatically
    // once the webhook flips active=true.
    nav.href = `/account/?need=subscription&return=${ret}`;
    return false;
  }

  window.GeoIDAuth = {
    ready: init,
    getSession,
    getUser,
    isMember,
    requireMember,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    async signInWithPassword({ email, password }) {
      const sb = await init();
      if (!sb) throw new Error("Auth not configured");
      return sb.auth.signInWithPassword({ email, password });
    },

    async signUp({ email, password, redirectTo }) {
      const sb = await init();
      if (!sb) throw new Error("Auth not configured");
      const opts = redirectTo ? { emailRedirectTo: redirectTo } : undefined;
      return sb.auth.signUp({ email, password, options: opts });
    },

    async signInWithMagicLink({ email, redirectTo }) {
      const sb = await init();
      if (!sb) throw new Error("Auth not configured");
      return sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo || (window.location.origin + "/account/") },
      });
    },

    async signOut() {
      const sb = await init();
      if (!sb) return;
      await sb.auth.signOut();
      memberCache = null;
      memberCacheUser = null;
    },

    // Public read-only access to the Supabase client for advanced use.
    async client() { return init(); },
  };
})();
