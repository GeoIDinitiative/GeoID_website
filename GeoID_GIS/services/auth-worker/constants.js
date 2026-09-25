/**
 * The Worker's constants and its provider table, OUT OF THE ENTRY MODULE.
 *
 * THIS IS NOT TIDYING. The Workers runtime reads every NAMED EXPORT of the
 * entry module as something it must bind -- a handler, a Durable Object
 * class, a WorkerEntrypoint -- so a named export that is a plain value stops
 * the service starting outright:
 *
 *   Uncaught TypeError: Incorrect type for map entry 'LINK_SECONDS':
 *   the provided value is not of type 'function or ExportedHandler'.
 *
 * Exported FUNCTIONS are tolerated, which is why worker.js can go on
 * exporting `sign`, `verify` and the rest for its tests. An object, a number
 * or a string cannot. Found by running `wrangler dev` for the first time; the
 * service had never been started, so nothing had said so.
 *
 * So anything the tests need that is not a function lives here, worker.js
 * imports it, and worker.js does NOT re-export it -- a re-export from the
 * entry module is a named export of the entry module and fails the same way.
 */
/** A shape check, not a validation: what follows is the provider's word. */
export const looksLikeEmail = (s) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ""));

export const PROVIDERS = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    idFor: (env) => env.GOOGLE_CLIENT_ID,
    secretFor: (env) => env.GOOGLE_CLIENT_SECRET,
    async identify(access) {
      const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!r.ok) throw new Error("Google would not say who that is.");
      const me = await r.json();
      // `email_verified` matters: an unverified address is a claim, not an
      // identity, and membership is looked up BY address.
      if (!me.email || me.email_verified === false) {
        throw new Error("That Google account has no verified email address.");
      }
      return { email: String(me.email).toLowerCase(), name: me.name || "" };
    },
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    idFor: (env) => env.GITHUB_CLIENT_ID,
    secretFor: (env) => env.GITHUB_CLIENT_SECRET,
    async identify(access) {
      const head = { Authorization: `Bearer ${access}`, "User-Agent": "geoid-auth", Accept: "application/vnd.github+json" };
      const [who, mails] = await Promise.all([
        fetch("https://api.github.com/user", { headers: head }).then((r) => r.json()),
        fetch("https://api.github.com/user/emails", { headers: head }).then((r) => r.json()),
      ]);
      // GitHub's profile email is whatever they chose to show, which is often
      // nothing; the primary VERIFIED address off /user/emails is the identity.
      const primary = Array.isArray(mails)
        ? mails.find((m) => m.primary && m.verified) || mails.find((m) => m.verified)
        : null;
      const email = primary?.email || who?.email;
      if (!email) throw new Error("That GitHub account has no verified email address.");
      return { email: String(email).toLowerCase(), name: who?.name || who?.login || "" };
    },
  },
  microsoft: {
    // `common` takes both a personal Microsoft account (an outlook.com, a
    // hotmail, an msn) and a work or school account in any tenant; the app
    // registration has to be made for that audience (see the README).
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "openid email profile User.Read",
    idFor: (env) => env.MS_CLIENT_ID,
    secretFor: (env) => env.MS_CLIENT_SECRET,
    async identify(access) {
      const r = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!r.ok) throw new Error("Microsoft would not say who that is.");
      const me = await r.json();
      // A personal account's address is its userPrincipalName; a work
      // account's is `mail`, and its UPN can be an alias. A GUEST in a tenant
      // carries a UPN of the shape `x_gmail.com#EXT#@tenant.onmicrosoft.com`,
      // which is nobody's mailbox, so it is refused rather than looked up.
      const email = String(me.mail || me.userPrincipalName || "").toLowerCase();
      if (!email || email.includes("#ext#") || !looksLikeEmail(email)) {
        throw new Error("That Microsoft account has no usable email address.");
      }
      return { email, name: me.displayName || "" };
    },
  },
};

export const STRIPE_GRACE_SECONDS = 7 * 24 * 3600;
export const STRIPE_TOLERANCE_SECONDS = 300;
export const LINK_SECONDS = 15 * 60;
export const LINK_THROTTLE_SECONDS = 60;
export const LINK_SENTENCE = "If that address holds a membership, a sign-in link is on its way — "
  + "check the inbox (and the junk folder) in the next few minutes. "
  + "Not a member yet? Membership is at /membership/.";
