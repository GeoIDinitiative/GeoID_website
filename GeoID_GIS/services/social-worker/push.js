/**
 * Web Push, without a payload.
 *
 * A member turns notifications on in a browser (Settings); the page hands us
 * the push subscription. When something reaches their inbox (lib.js
 * notify()), each of their browsers gets an EMPTY push signed with our VAPID
 * key, and the site's service worker (/sw.js) asks for the newest unread
 * notification itself and shows it. Nothing personal travels through Google's,
 * Mozilla's or Apple's push services, and there is no payload encryption to
 * get wrong.
 *
 * Keys: VAPID_PUBLIC_KEY (base64url, the raw 65-byte P-256 point) as a var,
 * VAPID_PRIVATE_JWK (the private key as a JWK) as a secret.
 * scripts/vapid-keys.mjs makes a pair. Without them, pushing is simply off.
 */
import { now, fail, requireUser, readJson, str, url } from "./lib.js";
import { all, run } from "./collab.js";

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (s) => new TextEncoder().encode(s);
const MAX_FAILURES = 3;

export const pushConfigured = (env) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK);

let keyCache = null;
async function signingKey(env) {
  if (keyCache && keyCache.raw === env.VAPID_PRIVATE_JWK) return keyCache.key;
  const jwk = typeof env.VAPID_PRIVATE_JWK === "string" ? JSON.parse(env.VAPID_PRIVATE_JWK) : env.VAPID_PRIVATE_JWK;
  const key = await crypto.subtle.importKey("jwk", { ...jwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  keyCache = { raw: env.VAPID_PRIVATE_JWK, key };
  return key;
}

/** The VAPID JWT for a push service's origin (RFC 8292). */
export async function vapidJwt(env, endpoint, t = now()) {
  const header = b64url(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc(JSON.stringify({ aud: new URL(endpoint).origin, exp: t + 12 * 3600, sub: env.VAPID_SUBJECT || "mailto:geoid.network@geoidinitiative.com" })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(env), enc(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

/** Push every browser this member turned on. Called by notify(); never throws. */
export async function pushTo(env, userId) {
  if (!pushConfigured(env)) return 0;
  const subs = await all(env, "SELECT endpoint FROM push_subscriptions WHERE user_id = ?", userId);
  const fetcher = env.fetchImpl || fetch;
  let sent = 0;
  for (const s of subs) {
    try {
      const res = await fetcher(s.endpoint, {
        method: "POST",
        headers: { TTL: "86400", Urgency: "normal", "Content-Length": "0",
          Authorization: `vapid t=${await vapidJwt(env, s.endpoint)}, k=${env.VAPID_PUBLIC_KEY}` },
      });
      if (res.status === 404 || res.status === 410) {
        await run(env, "DELETE FROM push_subscriptions WHERE endpoint = ?", s.endpoint);   // the browser dropped it
      } else if (res.ok) {
        sent += 1;
        await run(env, "UPDATE push_subscriptions SET last_ok_at = ?, failures = 0 WHERE endpoint = ?", now(), s.endpoint);
      } else {
        await run(env, "UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?", s.endpoint);
        await run(env, "DELETE FROM push_subscriptions WHERE endpoint = ? AND failures >= ?", s.endpoint, MAX_FAILURES);
      }
    } catch (error) { /* a push is a courtesy */ }
  }
  return sent;
}

// ── Routes ─────────────────────────────────────────────────────────────────

async function key(ctx) {
  return { configured: pushConfigured(ctx.env), key: ctx.env.VAPID_PUBLIC_KEY || null };
}

/** The push services browsers use; a subscription anywhere else is refused. */
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com|web\.push\.apple\.com)$/i;

async function subscribe(ctx) {
  const user = await requireUser(ctx);
  if (!pushConfigured(ctx.env)) fail(503, "Notifications on this device aren't switched on for GeoID Network yet.");
  const b = await readJson(ctx.request);
  const endpoint = url(b.endpoint);
  if (!endpoint || !PUSH_HOSTS.test(new URL(endpoint).hostname)) fail(400, "That isn't a browser push address.");
  await run(ctx.env, `INSERT INTO push_subscriptions (endpoint, user_id, created_at) VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, failures = 0`, endpoint, user.id, now());
  return { ok: true };
}

async function unsubscribe(ctx) {
  const user = await requireUser(ctx);
  const b = await readJson(ctx.request).catch(() => ({}));
  await run(ctx.env, "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", str(b.endpoint, 1000), user.id);
  return { ok: true };
}

export const routes = [
  ["GET", "/v1/push/key", key],
  ["POST", "/v1/push/subscribe", subscribe],
  ["DELETE", "/v1/push/subscribe", unsubscribe],
];
