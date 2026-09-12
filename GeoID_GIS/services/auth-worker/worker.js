/**
 * The membership service: who is signed in, and what they hold.
 *
 * A Cloudflare Worker, on the account that already serves the bucket and the
 * custom domain, so membership adds no vendor and no new bill. It does three
 * things and deliberately no more:
 *
 *   GET  /auth/start?provider=google|github&return=<url>   send them to sign in
 *   GET  /auth/callback/<provider>                          take them back
 *   GET  /auth/me            (Bearer)                       who is this
 *   POST /auth/data-token    (Bearer)                       a short pass for the bucket
 *
 * IT HOLDS NO WORK. A project is a folder on the member's own disk, their own
 * browser storage, or their own machine through the sidecar. What is stored
 * here is an entitlement -- an email, and until when -- and nothing else, which
 * is the whole of what a privacy notice for this has to say.
 *
 * NO PASSWORDS EVER. Sign-in is Google's or GitHub's, so there is no password
 * of ours to hold, to leak or to reset. The provider secrets live in the
 * Worker's own environment and never reach a page: a browser cannot hold a
 * secret, which is the rule `google-credentials.js` already throws over.
 *
 * THE TOKEN COMES BACK IN THE URL FRAGMENT. A fragment is not sent to any
 * server, does not reach an access log and does not travel in a Referer, which
 * a query string does all three of.
 */

const WEEK = 7 * 24 * 3600;
const DATA_TOKEN_SECONDS = 15 * 60;

const PROVIDERS = {
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
};

// ── JWT, HS256, hand-rolled because a Worker has WebCrypto and needs no dep ──

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/**
 * Decode, or null.
 *
 * NEVER throws: `atob` does on anything that is not base64, and the one caller
 * is handed whatever a stranger sent. Thrown, a malformed token is a 500 where
 * it should be "not signed in" -- which is what this cost before the test
 * caught it.
 */
const unb64url = (s) => {
  try {
    return Uint8Array.from(
      atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch (error) {
    return null;
  }
};

async function key(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(payload, secret) {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(mac)}`;
}

/**
 * Verify and return the payload, or null.
 *
 * Null for every failure -- bad shape, wrong signature, expired -- because a
 * caller must not be able to tell them apart and act differently. Expiry is
 * checked HERE rather than left to the caller: a token that never runs out is
 * one a revoked member keeps for ever.
 */
export async function verify(token, secret, { audience = null } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const mac = unb64url(parts[2]);
  const body = unb64url(parts[1]);
  if (!mac || !body) return null;
  const ok = await crypto.subtle.verify("HMAC", await key(secret),
    mac, enc.encode(`${parts[0]}.${parts[1]}`)).catch(() => false);
  if (!ok) return null;
  let payload = null;
  try { payload = JSON.parse(new TextDecoder().decode(body)); } catch (e) { return null; }
  const now = Math.floor(Date.now() / 1000);
  if (!payload || !Number.isFinite(payload.exp) || payload.exp <= now) return null;
  if (audience && payload.aud !== audience) return null;
  return payload;
}

// ── Membership ──────────────────────────────────────────────────────────────

/**
 * Is this address a member, and until when?
 *
 * One KV entry per member, keyed by the verified address, holding
 * `{"until": <epoch seconds>}` and optionally a plan. Absent means an
 * explorer -- which is a real, welcome state, not a failure: they sign in,
 * they are greeted by name, and they are told what membership adds.
 */
async function membership(env, email) {
  if (!env.MEMBERS) return null;
  const raw = await env.MEMBERS.get(`member:${email}`);
  if (!raw) return null;
  let rec = null;
  try { rec = JSON.parse(raw); } catch (e) { return null; }
  const until = Number(rec?.until);
  if (!Number.isFinite(until) || until <= Math.floor(Date.now() / 1000)) return null;
  return { until, plan: rec.plan || "member" };
}

/** Only ever back to somewhere we own. An open redirect is a phishing gift. */
function allowedReturn(env, wanted) {
  const allow = String(env.RETURN_ORIGINS || "").split(/[,\s]+/).filter(Boolean);
  try {
    const url = new URL(wanted);
    if (allow.includes(url.origin)) return url.toString();
  } catch (e) { /* not a url */ }
  return env.SITE_ORIGIN ? `${env.SITE_ORIGIN}/` : "/";
}

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...extra },
});

/** CORS for the site's own origins, never `*`. */
function cors(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allow = String(env.RETURN_ORIGINS || "").split(/[,\s]+/).filter(Boolean);
  if (!allow.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const head = cors(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: head });

    // ── start ──────────────────────────────────────────────────────────────
    if (url.pathname === "/auth/start") {
      const name = url.searchParams.get("provider") || "google";
      const provider = PROVIDERS[name];
      if (!provider) return json({ error: "No such sign-in." }, 400, head);
      // The state IS a signed token carrying where to come back to, so there
      // is nothing to store and nothing to expire in KV; five minutes is
      // longer than any sign-in and shorter than any useful replay.
      const state = await sign({
        p: name,
        r: allowedReturn(env, url.searchParams.get("return") || ""),
        exp: Math.floor(Date.now() / 1000) + 300,
      }, env.JWT_SECRET);
      const go = new URL(provider.authorize);
      go.searchParams.set("client_id", provider.idFor(env));
      go.searchParams.set("redirect_uri", `${env.SELF_ORIGIN}/auth/callback/${name}`);
      go.searchParams.set("response_type", "code");
      go.searchParams.set("scope", provider.scope);
      go.searchParams.set("state", state);
      return Response.redirect(go.toString(), 302);
    }

    // ── callback ───────────────────────────────────────────────────────────
    const back = url.pathname.match(/^\/auth\/callback\/([a-z]+)$/);
    if (back) {
      const provider = PROVIDERS[back[1]];
      const state = await verify(url.searchParams.get("state"), env.JWT_SECRET);
      if (!provider || !state || state.p !== back[1]) {
        return json({ error: "That sign-in has expired — start again." }, 400, head);
      }
      const code = url.searchParams.get("code");
      if (!code) return Response.redirect(state.r, 302);

      try {
        const body = new URLSearchParams({
          client_id: provider.idFor(env),
          client_secret: provider.secretFor(env),
          code,
          grant_type: "authorization_code",
          redirect_uri: `${env.SELF_ORIGIN}/auth/callback/${back[1]}`,
        });
        const res = await fetch(provider.token, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body,
        });
        const grant = await res.json();
        if (!grant.access_token) throw new Error("The sign-in was not completed.");

        const who = await provider.identify(grant.access_token);
        const holds = await membership(env, who.email);
        const now = Math.floor(Date.now() / 1000);
        // A session never outlives the membership behind it, and never runs
        // more than a week, so a lapsed member's own copy stops working
        // without anybody having to reach into their browser.
        const exp = Math.min(now + WEEK, holds ? holds.until : now + WEEK);
        const token = await sign({
          sub: who.email, email: who.email, name: who.name,
          member: !!holds, plan: holds?.plan || "explorer",
          iss: env.SELF_ORIGIN, aud: "site", iat: now, exp,
        }, env.JWT_SECRET);

        // In the FRAGMENT: not sent to any server, not logged, not in a Referer.
        const home = new URL(state.r);
        home.hash = `token=${encodeURIComponent(token)}`;
        return Response.redirect(home.toString(), 302);
      } catch (error) {
        const home = new URL(state.r);
        home.hash = `auth-error=${encodeURIComponent(error.message || "Sign-in failed.")}`;
        return Response.redirect(home.toString(), 302);
      }
    }

    // ── who is this ────────────────────────────────────────────────────────
    if (url.pathname === "/auth/me") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const claims = await verify(token, env.JWT_SECRET, { audience: "site" });
      if (!claims) return json({ signedIn: false }, 200, head);
      // Re-read the entitlement rather than trusting the token's own copy: a
      // membership that lapsed or was granted since was decided here, not in
      // whatever the browser is still holding.
      const holds = await membership(env, claims.email);
      return json({
        signedIn: true, email: claims.email, name: claims.name,
        member: !!holds, plan: holds?.plan || "explorer",
        until: holds?.until || 0,
      }, 200, head);
    }

    // ── a short pass for the bucket ────────────────────────────────────────
    if (url.pathname === "/auth/data-token") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const claims = await verify(token, env.JWT_SECRET, { audience: "site" });
      const holds = claims && await membership(env, claims.email);
      if (!holds) return json({ error: "Not a member." }, 403, head);
      const now = Math.floor(Date.now() / 1000);
      /**
       * A SEPARATE, SHORT token, because this one travels in a URL.
       *
       * The bucket is read by three.js's texture loader and by geotiff's range
       * requests as well as by fetch, and only a query string reaches all
       * three. A query string is logged, so what is logged has to be worth
       * little: fifteen minutes, audience `data`, and it cannot be used to ask
       * who anybody is.
       */
      return json({
        token: await sign({ aud: "data", iat: now, exp: now + DATA_TOKEN_SECONDS },
          env.JWT_SECRET),
        expires: now + DATA_TOKEN_SECONDS,
      }, 200, head);
    }

    return json({ error: "No such endpoint." }, 404, head);
  },
};
