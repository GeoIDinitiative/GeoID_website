/**
 * The browser half of the sidecar — the hub's link to a real interpreter.
 *
 * `sidecar/geoid_sidecar.py` runs beside a projects folder and lends the page
 * what a static site cannot have: a subprocess, a filesystem, a job that
 * outlives one click. This module is what the hub talks to it through. Three
 * jobs:
 *
 *   1. Detect it (a `/health` probe) and hold its URL + token.
 *   2. Present its filesystem as a `project-store` adapter, so when the sidecar
 *      is connected the hub reads and writes the *same folder the desktop app
 *      uses* — the flat `geoid_projects/<body>/<name>/…` tree — instead of the
 *      picker or IndexedDB.
 *   3. Start scripts, functions and training runs, and stream their output.
 *
 * The token travels in an `Authorization` header, never the URL — which is why
 * the log stream is parsed out of a `fetch` body rather than an `EventSource`
 * (EventSource cannot set headers, so it would force the token into a query
 * string). The stream format is plain Server-Sent Events either way.
 */

const CONFIG_KEY = "geoid-gis:sidecar";

let config = load();
const listeners = new Set();

function load() {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : { url: "", token: "", connected: false };
  } catch (error) {
    return { url: "", token: "", connected: false };
  }
}

function persist() {
  try { window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }
  catch (error) { /* storage unavailable */ }
}

/** Notified whenever the connection state changes, for the status pill. */
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function announce() { listeners.forEach((fn) => { try { fn(config); } catch (error) { /* */ } }); }

export function getConfig() { return { ...config }; }
export function isConnected() { return !!config.connected; }

/**
 * Store the sidecar's address.
 *
 * Accepts what the server prints — `http://127.0.0.1:8137?token=…` — and splits
 * the token out of the query so it can go in a header from here on. Pasting the
 * whole line is the intended path; the token is never left in the stored URL.
 */
export function configure(input) {
  const text = String(input || "").trim();
  if (!text) { config = { url: "", token: "", connected: false }; persist(); announce(); return config; }
  let url = text;
  let token = config.token || "";
  try {
    const parsed = new URL(text);
    token = parsed.searchParams.get("token") || token;
    parsed.search = "";
    url = parsed.origin;
  } catch (error) {
    // Not a full URL — treat it as a bare origin.
    url = text.replace(/\?.*$/, "");
  }
  config = { url, token, connected: false };
  persist();
  announce();
  return config;
}

function headers(extra = {}) {
  const out = { ...extra };
  if (config.token) out.Authorization = `Bearer ${config.token}`;
  return out;
}

async function call(path, { method = "GET", body, raw = false, signal } = {}) {
  if (!config.url) throw new Error("No sidecar configured.");
  const response = await fetch(config.url + path, {
    method,
    headers: headers(body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try { detail = (await response.json()).error || detail; } catch (error) { /* */ }
    throw new Error(detail);
  }
  return raw ? response : response.json();
}

/**
 * Probe the sidecar. Health needs no token, so a 200 here means "present"; a
 * follow-up authenticated call is what proves the token is right.
 */
export async function probe() {
  if (!config.url) { config.connected = false; announce(); return { ok: false, reason: "not-configured" }; }
  try {
    const health = await (await fetch(config.url + "/health", { headers: {} })).json();
    // Confirm the token by making one authenticated call.
    if (health.needs_token) {
      const check = await fetch(config.url + "/jobs", { headers: headers() });
      if (check.status === 401) {
        config.connected = false; announce();
        return { ok: false, reason: "bad-token", health };
      }
    }
    config.connected = true;
    config.root = health.root;
    config.version = health.version;
    announce();
    return { ok: true, health };
  } catch (error) {
    config.connected = false; announce();
    return { ok: false, reason: "unreachable", error: error.message };
  }
}

// ── The filesystem, as a project-store adapter ────────────────────────────────

/** Base64 for a Blob or ArrayBuffer, so a figure survives the JSON hop. */
async function toBase64(value) {
  const buffer = value instanceof Blob ? await value.arrayBuffer()
    : value instanceof ArrayBuffer ? value : new TextEncoder().encode(String(value)).buffer;
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * An adapter with the seven methods `project-store` expects, backed by the
 * sidecar's `/fs/*`. Selected with `store.useAdapter(sidecarAdapter())` when a
 * probe succeeds.
 */
export function sidecarAdapter() {
  return {
    kind: "sidecar",
    name: "sidecar",

    async ensureDir(path) {
      await call("/fs/mkdir", { method: "POST", body: { path } });
    },

    async writeFile(path, contents) {
      if (contents instanceof Blob || contents instanceof ArrayBuffer) {
        await call("/fs/write", { method: "POST",
          body: { path, content: await toBase64(contents), encoding: "base64" } });
      } else {
        await call("/fs/write", { method: "POST", body: { path, content: String(contents) } });
      }
    },

    async readFile(path) {
      const response = await call(`/fs/read?path=${encodeURIComponent(path)}`, { raw: true });
      return response.text();
    },

    async readFileBytes(path) {
      const response = await call(`/fs/read?path=${encodeURIComponent(path)}`, { raw: true });
      return response.blob();
    },

    async exists(path) {
      const info = await call(`/fs/exists?path=${encodeURIComponent(path)}`);
      return !!info.exists;
    },

    async list(path = "") {
      const info = await call(`/fs/list?path=${encodeURIComponent(path)}`);
      return (info.entries || []).map((e) => ({ name: e.name, kind: e.kind }));
    },

    async remove(path) {
      await call("/fs/delete", { method: "POST", body: { path } });
    },
  };
}

// ── Jobs ──────────────────────────────────────────────────────────────────

export async function runScript({ script, args, cwd, label } = {}) {
  return (await call("/jobs/script", { method: "POST", body: { script, args, cwd, label } })).job_id;
}
export async function runFunction({ script, func, kwargs, cwd } = {}) {
  return (await call("/jobs/function", { method: "POST",
    body: { script, function: func, kwargs, cwd } })).job_id;
}
export async function runTraining({ script, dataset, output, args } = {}) {
  return (await call("/jobs/training", { method: "POST",
    body: { script, dataset, output, args } })).job_id;
}
/**
 * Run a prepared GALES sim in a project run folder.
 *
 * `dir` is the run folder relative to the projects root — the store's active
 * `dir` plus `fem_runs/<run>`. The deck (a `.in` file) is auto-detected when
 * omitted. The sidecar writes `status.json` beside the deck and streams the
 * solver log as an ordinary job.
 */
export async function runGales({ dir, deck, cores, cmd, label, target } = {}) {
  return (await call("/jobs/gales", { method: "POST",
    body: { dir, deck, cores, cmd, label, target } })).job_id;
}

// ── Compute targets: this machine, or a server over SSH ──────────────────────
//
// Where a solve runs. `local` is mpirun here; an `ssh` target is a box you
// already have (a Hetzner VPS, a lab workstation, a cluster login node) — the
// sidecar pushes the deck, solves there and brings the results back.
//
// Key-based access only: the sidecar refuses a password outright, and every ssh
// call is batch-mode so it fails fast instead of waiting on a prompt.

export async function listCompute() {
  return call("/compute");
}
export async function saveCompute(target) {
  return call("/compute/save", { method: "POST", body: target });
}
export async function deleteCompute(name) {
  return call("/compute/delete", { method: "POST", body: { name } });
}
/** Check a target really works — reachable, key accepted, mpirun and gales present. */
export async function testCompute(name) {
  return (await call("/compute/test", { method: "POST", body: { name } })).job_id;
}

// ── Atlas: your own model subscription, and the watcher that outlives the tab ─
//
// The key is set *into the sidecar* and stays there: a page cannot hold a
// secret, so the call that needs one is made on that side and only a masked
// hint ever comes back. Same reason the watcher lives there — it has to keep
// running when every tab is closed.

export async function atlasKeys() {
  return call("/atlas/keys");
}
export async function saveAtlasKey(name, value) {
  return call("/atlas/keys/save", { method: "POST", body: { name, value } });
}
export async function deleteAtlasKey(name) {
  return call("/atlas/keys/delete", { method: "POST", body: { name } });
}
export async function atlasChat({ messages, context, provider, model } = {}) {
  return call("/atlas/chat", { method: "POST",
    body: { messages, context, provider, model } });
}
export async function watchStart(options = {}) {
  return call("/atlas/watch/start", { method: "POST", body: options });
}
export async function watchStop() {
  return call("/atlas/watch/stop", { method: "POST", body: {} });
}
export async function watchStatus() {
  return call("/atlas/watch");
}
/** Alerts raised since an index — how a browser that was closed catches up. */
export async function atlasAlerts(since = 0) {
  return (await call(`/atlas/alerts?since=${since}`)).alerts || [];
}
/**
 * Generate a runnable GALES deck from the run's spec.json and build it: the
 * sidecar writes setup.txt/props.txt, clones the solver boilerplate, converts
 * the mesh for N ranks and compiles. Returns the streamed job's id.
 */
export async function prepareGales({ dir, cores } = {}) {
  return (await call("/jobs/gales/prepare", { method: "POST",
    body: { dir, cores } })).job_id;
}
/**
 * Extract probe time series from a solved GALES run's binary results into
 * post_processing/extracted_dofs/<probe>.csv, which the Signal and Spectral
 * pages then read. `stations` are { name, x, y, z } in mesh coordinates.
 */
export async function postprocessGales({ dir, stations, field } = {}) {
  return (await call("/jobs/gales/postprocess", { method: "POST",
    body: { dir, stations, field } })).job_id;
}
export async function listJobs() {
  return (await call("/jobs")).jobs || [];
}
export async function stopJob(id) {
  return call(`/jobs/${id}/stop`, { method: "POST" });
}

/**
 * Stream a job's output.
 *
 * Reads the SSE body with a `fetch` reader so the token stays in a header.
 * `onLine(text, index)` fires per line — replayed from the start, then live —
 * and `onStatus(status, code)` once at the end. Returns a function that stops
 * following (the process keeps running; this only detaches the stream).
 */
export function streamJob(id, { onLine, onStatus, from = 0 } = {}) {
  const controller = new AbortController();
  (async () => {
    let response;
    try {
      response = await fetch(`${config.url}/jobs/${id}/events?from=${from}`,
        { headers: headers(), signal: controller.signal });
    } catch (error) {
      onStatus?.("failed", null);
      return;
    }
    if (!response.ok || !response.body) { onStatus?.("failed", null); return; }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let event = "message";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; a frame carries an
        // `event:` and a `data:`.
        let split;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          event = "message";
          let data = "";
          frame.split("\n").forEach((line) => {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          });
          if (!data) continue;
          const payload = JSON.parse(data);
          if (event === "line") onLine?.(payload.text, payload.i);
          else if (event === "status") { onStatus?.(payload.status, payload.exit_code); return; }
          // "ping" frames are just keep-alives; nothing to do.
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) onStatus?.("failed", null);
    }
  })();
  return () => controller.abort();
}
