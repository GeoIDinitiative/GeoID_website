/**
 * GeoID Network: the network for people, projects and knowledge about the
 * physical world. Deployed as its own Worker at social.geoidinitiative.com.
 *
 * The routes are listed in CONTRACT.md and implemented one module per area;
 * each module exports `routes = [[METHOD, "/v1/path/:param", handler], ...]`.
 * A handler takes `ctx` ({ env, request, url, params, head }) and returns a
 * value (sent as JSON 200), a Response (sent as is), or throws HttpError.
 */
import { HttpError, cors, json } from "./lib.js";
import { routes as profiles } from "./profiles.js";
import { routes as posts } from "./posts.js";
import { routes as media } from "./media.js";
import { routes as discovery } from "./discovery.js";
import { routes as notifications } from "./notifications.js";
import { routes as communities } from "./communities.js";
import { routes as teams } from "./teams.js";
import { routes as projects } from "./projects.js";
import { routes as reviews } from "./reviews.js";
import { routes as messages } from "./messages.js";
import { routes as moderation } from "./moderation.js";
import { routes as reputation } from "./reputation.js";
import { routes as interest } from "./interest.js";
import { routes as orgs } from "./orgs.js";
import { routes as verify } from "./verify.js";
import { routes as requests } from "./requests.js";
import { routes as events } from "./events.js";
import { routes as mail } from "./mail.js";
import { routes as reposts } from "./reposts.js";
import { routes as realtime } from "./realtime.js";
import { routes as unfurl } from "./unfurl.js";
import { routes as reach } from "./reach.js";
import { routes as zenodo } from "./zenodo.js";
import { routes as officehours } from "./officehours.js";
import { routes as importer } from "./importer.js";
import { scheduled } from "./cron.js";

// The Durable Object class behind live messages; wrangler.toml binds it as CHAT.
export { ChatRoom } from "./realtime.js";

function compile(table) {
  return table.map(([method, pattern, handler]) => {
    const names = [];
    const source = pattern.replace(/:([a-z_]+)/g, (_, name) => { names.push(name); return "([^/]+)"; });
    return { method, regex: new RegExp(`^${source}$`), names, handler, pattern };
  });
}

export const ROUTES = compile([
  ...profiles, ...posts, ...media, ...discovery, ...notifications,
  ...communities, ...teams, ...projects, ...reviews, ...messages,
  ...moderation, ...reputation, ...interest,
  ...orgs, ...verify, ...requests, ...events, ...mail, ...realtime, ...reposts,
  ...unfurl, ...reach, ...zenodo, ...officehours, ...importer,
]);

export function match(method, path) {
  let pathMatched = false;
  for (const route of ROUTES) {
    const m = route.regex.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (route.method !== method) continue;
    const params = {};
    route.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
    return { route, params };
  }
  return pathMatched ? { methodNotAllowed: true } : null;
}

export default {
  async fetch(request, env, exec) {
    const head = cors(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: head });
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/v1/health") {
      return json({ ok: true, service: "geoid-social" }, 200, head);
    }
    const found = match(request.method, url.pathname);
    if (!found) return json({ error: "Not found." }, 404, head);
    if (found.methodNotAllowed) return json({ error: "Method not allowed." }, 405, head);
    // exec is the ExecutionContext (waitUntil), for work that may finish after the answer.
    const ctx = { env, request, url, params: found.params, head, exec };
    try {
      const result = await found.route.handler(ctx);
      if (result instanceof Response) {
        // A WebSocket upgrade (realtime.js) goes back exactly as the Durable Object made it.
        if (result.status === 101 || result.webSocket) return result;
        const out = new Response(result.body, result);
        for (const [k, v] of Object.entries(head)) out.headers.set(k, v);
        return out;
      }
      return json(result ?? { ok: true }, 200, head);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status, head);
      console.error(found.route.pattern, error && error.stack || error);
      return json({ error: "Something went wrong on our side." }, 500, head);
    }
  },

  // Cron triggers (wrangler.toml [triggers]): mail, reminders, housekeeping -- see cron.js.
  scheduled,
};
