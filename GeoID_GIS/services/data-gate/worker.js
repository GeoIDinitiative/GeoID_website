/**
 * The gate in front of the data bucket.
 *
 * A Worker on `data.geoidinitiative.com`. Almost everything there is open and
 * is passed straight through: the basemaps, the terrain, the surveys, the
 * catalogues, the glacier and soil pyramids, somebody else's published products
 * that we redistribute. Four baked grids are ours and are membership's, and
 * those are refused without a valid pass.
 *
 * THIS IS THE ONE GATE THAT IS REALLY ENFORCED. The app's own gates are a
 * courtesy — they run in the reader's browser and anybody can flip them — and
 * the module that draws them says so. This one runs where they cannot reach.
 *
 * The pass is the SHORT token (`aud: "data"`, fifteen minutes) that
 * `/auth/data-token` issues, never the week-long session token, because this
 * one arrives in a query string: the bucket is read by three.js's texture
 * loader and by geotiff's range requests as well as by `fetch`, and only a
 * query string reaches all three. A query string is logged, so what is logged
 * has to be worth little.
 */

/**
 * The paths only a member may read.
 *
 * KEPT IN STEP WITH `viewer/gis/membership.js` BY A TEST. A gate and its
 * enforcement drifting apart is a gate that has quietly opened, and neither
 * side can import the other: one is a page's module and one is a Worker.
 */
export const MEMBER_DATA = [
  "cyclone-risk",
  "seismic-risk",
  "volcanic-risk",        // covers volcanic-risk-holocene
];

export function gatedData(path) {
  const clean = String(path || "").replace(/^\/+/, "").replace(/^data\/global\//, "");
  return MEMBER_DATA.some((p) => clean === p || clean.startsWith(`${p}.`) || clean.startsWith(`${p}/`)
    || clean.startsWith(`${p}-`));
}

const enc = new TextEncoder();
const unb64url = (s) => {
  try {
    return Uint8Array.from(
      atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch (error) {
    return null;
  }
};

/**
 * Verify a pass, or answer null.
 *
 * The same HS256 the service signs with, and the same rule: null for every
 * failure so a caller cannot tell them apart, expiry checked here, and the
 * audience checked so a week-long session token cannot stand in for a
 * fifteen-minute pass.
 */
export async function validPass(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const mac = unb64url(parts[2]);
  const body = unb64url(parts[1]);
  if (!mac || !body) return null;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, mac,
    enc.encode(`${parts[0]}.${parts[1]}`)).catch(() => false);
  if (!ok) return null;
  let payload = null;
  try { payload = JSON.parse(new TextDecoder().decode(body)); } catch (e) { return null; }
  if (!payload || payload.aud !== "data") return null;
  if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/**
 * CORS, and it has to be here rather than left to the bucket.
 *
 * A refusal with no CORS header reaches the page as a bare `TypeError: Failed
 * to fetch` with no status to read — which is exactly the fault this tree has
 * already chased twice — so the 402 carries the header and the app can say
 * what happened.
 */
function cors(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allow = String(env.ALLOWED_ORIGINS || "").split(/[,\s]+/).filter(Boolean);
  if (!origin || !allow.includes(origin)) return {};
  return { "access-control-allow-origin": origin, vary: "Origin" };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const head = cors(env, request);

    if (!gatedData(url.pathname)) return fetch(request);

    const pass = url.searchParams.get("t")
      || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const claims = await validPass(pass, env.JWT_SECRET);
    if (!claims) {
      return new Response(JSON.stringify({
        error: "member",
        message: "This is one of GeoID's own modelled risk maps. Sign in as a "
          + "member to open it.",
        where: "https://geoidinitiative.com/membership/",
      }), {
        status: 402,   // Payment Required: the one status that means this
        headers: { "content-type": "application/json; charset=utf-8", ...head },
      });
    }

    /**
     * Strip the pass before going to the bucket.
     *
     * Every object here is served `immutable, max-age=1 year` against a
     * fingerprint in the path, so a token in the cache key would give each
     * member their own copy of a file that never changes and throw the edge
     * cache away for the very layers that are largest.
     */
    const onward = new URL(url);
    onward.searchParams.delete("t");
    const res = await fetch(new Request(onward.toString(), request));
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(head)) out.headers.set(k, v);
    // Private, because this one is answered per reader rather than per URL.
    out.headers.set("cache-control", "private, max-age=900");
    return out;
  },
};
