/**
 * Atlas — the assistant that knows this application.
 *
 * A fixed launcher in the bottom-right of every page (globe, Meshing Studio,
 * Research Hub) opening a chat panel that guides someone through the workflow:
 * where a tool is, what the project currently holds, what to do next, and what
 * is happening near the study area.
 *
 * The design decision that matters: **it is grounded, not mocked.** Every answer
 * comes from the app's own registry and the open project — the real page list,
 * the real data registry, the real FEM runs — so it is useful with no model, no
 * network and no key, and it can never invent a page that does not exist. That
 * is also why it can *act*: an answer carries the button that performs it.
 *
 * A model is optional and additive, and there are two ways to give it one, tried
 * in this order:
 *
 *   1. **Your own subscription, through the sidecar** — Claude, ChatGPT or
 *      Gemini. The key is set *into the sidecar* and never touches this page,
 *      because a browser cannot keep a secret; only a masked hint comes back.
 *   2. **An Atlas hub**, via its `/api/chat/simple` with the app's state as
 *      `context` — the shape that endpoint documents for exactly this.
 *
 * With neither, Atlas says plainly what it can and cannot do rather than
 * guessing. Named after the wider Atlas AI it will eventually be, and speaking
 * that hub's contract already, so pointing it at the real thing is a URL rather
 * than a rewrite.
 *
 * The watcher has two homes for the same reason: `atlas-watch.js` runs in the
 * page when there is no sidecar, and the sidecar's own watcher takes over when
 * there is — because that one keeps running with every tab closed, and tells you
 * what it saw when you come back (`drainAlerts`).
 */

const STAMP = new URL(import.meta.url).search || "";
const ENDPOINT_KEY = "geoid-gis:atlas-endpoint";
const byId = (id) => document.getElementById(id);

let panel = null;
let logNode = null;
let inputNode = null;
let open = false;
const history = [];          // {role, content} for the model, when there is one

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// ── The model backend, when one is configured ────────────────────────────────

function endpoint() {
  try { return window.localStorage.getItem(ENDPOINT_KEY) || ""; }
  catch (error) { return ""; }
}
function setEndpoint(url) {
  try {
    if (url) window.localStorage.setItem(ENDPOINT_KEY, url.replace(/\/+$/, ""));
    else window.localStorage.removeItem(ENDPOINT_KEY);
  } catch (error) { /* storage unavailable */ }
}

/** What the app is doing right now, for the model's `context`. */
async function appContext() {
  const bits = [`mode: ${document.body?.dataset?.viewMode || "gis"}`];
  const world = document.body?.dataset?.body;
  if (world) bits.push(`world: ${world}`);
  try {
    const page = window.GeoIDResearch?.getPageId?.();
    if (page) bits.push(`page: ${page}`);
    const store = window.GeoIDResearch?.store;
    const active = store?.getActive?.();
    if (active) {
      bits.push(`project: ${active.name} (${active.dir})`);
      const area = active.meta?.study_area;
      if (area && Number(area.max_lat) - Number(area.min_lat) !== 0) {
        bits.push(`study area: ${area.min_lat},${area.min_lon} to ${area.max_lat},${area.max_lon}`);
      }
      const data = await store.listData().catch(() => []);
      bits.push(`datasets: ${data.length}`);
    } else {
      bits.push("project: none open");
    }
  } catch (error) { /* context is best-effort */ }
  return bits.join("\n");
}

/** The sidecar, when it is up and has a subscription wired in. */
async function sidecarBrain() {
  try {
    const sc = await import(`./research/sidecar.js${STAMP}`);
    if (!sc.isConnected()) return null;
    const keys = await sc.atlasKeys();
    return keys.providers?.length ? { sc, providers: keys.providers } : null;
  } catch (error) {
    return null;
  }
}

async function askModel(question) {
  // Prefer the sidecar: the key lives there, so the page never holds a secret
  // and the user's own Claude/ChatGPT/Gemini subscription is what answers.
  const brain = await sidecarBrain();
  if (brain) {
    history.push({ role: "user", content: question });
    const reply = await brain.sc.atlasChat({
      messages: history.slice(-10), context: await appContext(),
    });
    const text = String(reply.text || "").trim();
    if (text) history.push({ role: "assistant", content: text });
    return { text, provider: reply.provider, sources: [] };
  }
  const base = endpoint();
  if (!base) return null;
  history.push({ role: "user", content: question });
  const response = await fetch(`${base}/api/chat/simple`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: history.slice(-10),
      context: await appContext(),
    }),
  });
  if (!response.ok) throw new Error(`the Atlas hub answered HTTP ${response.status}`);
  const data = await response.json();
  const text = String(data.text || "").trim();
  if (text) history.push({ role: "assistant", content: text });
  return { text, sources: data.sources || [] };
}

// ── Grounded answers: the app's own registry and the open project ────────────

/** Every registered page, with the blurb the hub shows for it. */
async function pageIndex() {
  try {
    const stages = await import(`./research/stages.js${STAMP}`);
    let blurbs = {};
    try { blurbs = (await import(`./research/page-blurbs.js${STAMP}`)).PAGE_BLURBS || {}; }
    catch (error) { /* blurbs are a nicety */ }
    return stages.allPageIds().map((id) => ({ id, blurb: blurbs[id] || "" }));
  } catch (error) {
    return [];
  }
}

/**
 * Words that carry no intent. Without stripping these, "**where** do I do
 * meshing?" matched the *blurb* "**Where** every file came from" and confidently
 * recommended Metadata & Lineage — the question's grammar outvoted its subject.
 * Deliberately only interrogatives and auxiliaries: "run", "data", "mesh" and
 * friends are real page words and must survive.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "you", "your", "this", "that", "with", "from",
  "where", "what", "how", "why", "when", "which", "who", "does", "did", "can",
  "could", "should", "would", "will", "shall", "there", "they", "them", "then",
  "have", "has", "had", "been", "was", "were", "into", "onto", "out", "about",
  "get", "got", "put", "see", "look", "find", "want", "need", "please", "help",
  "any", "all", "some", "more", "most", "just", "now", "here",
]);

/** Light stemming, so "meshing"/"meshes" both reach "Mesh". */
function stem(word) {
  return word.replace(/(ings?|ed|es|s)$/, "") || word;
}

/**
 * Score a page against the question. A hit in the page's **name** is worth far
 * more than one in its description, and a page must clear that bar to be
 * offered at all — otherwise a question the app cannot answer ("the airspeed
 * velocity of an unladen swallow") matched a blurb somewhere and got a
 * confident, wrong answer instead of an honest one.
 */
function rankPages(pages, question) {
  const asked = (question.toLowerCase().match(/[a-z]{3,}/g) || [])
    .filter((w) => !STOPWORDS.has(w))
    .map(stem);
  if (!asked.length) return [];
  return pages
    .map((page) => {
      const title = page.id.toLowerCase();
      const blurb = (page.blurb || "").toLowerCase();
      let score = 0;
      asked.forEach((w) => {
        if (title.includes(w)) score += 5;
        else if (blurb.includes(w)) score += 1;
      });
      if (title === question.toLowerCase().trim()) score += 20;
      return { ...page, score };
    })
    // 3 is the floor a name match clears and a blurb match alone cannot: it is
    // what makes "I don't know" possible.
    .filter((p) => p.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function goToPage(id) {
  window.GeoIDModeManager?.setMode?.("research");
  setTimeout(() => window.GeoIDResearch?.setPage?.(id), 120);
}

/**
 * The ecosystem, described once.
 *
 * Atlas reasons over this rather than over a pile of hand-written answers: each
 * link says what it produces, what it needs first, and where it is done. From
 * that one table it can derive the next step, explain why something is blocked,
 * say what any stage needs, and route across all three modes — and adding a
 * capability is a row here, not a new branch.
 *
 * `has` is evaluated against the live state probe below, so every answer is
 * about this project at this moment, never a script.
 */
const ECOSYSTEM = [
  {
    id: "project", name: "a project", mode: "any",
    produces: "the folder every other stage reads and writes",
    needs: [], has: (s) => s.open,
    act: ["Open or create a project", () => window.GeoIDProject?.open?.(true)],
  },
  {
    id: "area", name: "a study area", mode: "gis",
    produces: "the extent that scopes data pulls, clipping and hazard checks",
    needs: ["project"], has: (s) => s.hasArea,
    act: ["Go to the globe", () => window.GeoIDModeManager?.setMode?.("gis")],
    also: [["Set one from the Workspace", () => goToPage("Dashboard")]],
  },
  {
    id: "data", name: "data in the project", mode: "research",
    produces: "the datasets analysis and models read",
    needs: ["project"], has: (s) => s.datasets > 0,
    act: ["Fetch live data", () => goToPage("Ingest Seismic Geophysics")],
    also: [["Import a file", () => goToPage("Data Repository")]],
  },
  {
    id: "mesh", name: "a mesh", mode: "model",
    produces: "the geometry a FEM run solves on",
    needs: ["project"], has: (s) => s.meshes > 0, optional: true,
    act: ["Open the Meshing Studio", () => window.GeoIDModeManager?.setMode?.("model")],
  },
  {
    id: "run", name: "a FEM run", mode: "research",
    produces: "fem_runs/<run>/spec.json — the physics, materials and time stepping",
    needs: ["project"], has: (s) => s.runs > 0,
    act: ["Set up a run", () => goToPage("Setup")],
  },
  {
    id: "deck", name: "a built GALES deck", mode: "research",
    produces: "setup.txt, props.txt and a compiled executable",
    needs: ["run", "mesh"], has: (s) => s.built > 0,
    act: ["Generate & build a deck", () => goToPage("Run Existing")],
    requiresSidecar: true,
  },
  {
    id: "results", name: "solver results", mode: "research",
    produces: "the displacement fields the solve writes back",
    needs: ["deck"], has: (s) => s.results > 0,
    act: ["Run the solver", () => goToPage("Run Existing")],
    requiresSidecar: true,
  },
  {
    id: "series", name: "extracted probe series", mode: "research",
    produces: "CSV time series the analysis pages read",
    needs: ["results"], has: (s) => s.series > 0,
    act: ["Extract from results", () => goToPage("Post Processing")],
    requiresSidecar: true,
  },
  {
    id: "analysis", name: "analysis", mode: "research",
    produces: "spectra, statistics, correlations",
    needs: ["data"], has: (s) => s.analysis > 0,
    act: ["Signal Processing", () => goToPage("Signal Processing")],
  },
  {
    id: "figures", name: "published figures", mode: "research",
    produces: "the figures and exports you hand over",
    needs: ["analysis"], has: (s) => s.figures > 0,
    act: ["Figure Composer", () => goToPage("Figure Composer")],
  },
];

/** Everything Atlas knows about right now, across all three modes. */
async function probe() {
  const store = window.GeoIDResearch?.store;
  const active = store?.getActive?.();
  const state = {
    open: !!active,
    mode: document.body?.dataset?.viewMode || "gis",
    world: document.body?.dataset?.body || "earth",
    page: window.GeoIDResearch?.getPageId?.() || null,
    layers: (window.GeoIDImportManager?.getLayers?.() || []).length,
    sidecar: false, targets: 0,
    datasets: 0, meshes: 0, runs: 0, built: 0, results: 0, series: 0,
    analysis: 0, figures: 0, hasArea: false,
  };
  try {
    const sc = await import(`./research/sidecar.js${STAMP}`);
    state.sidecar = sc.isConnected();
    if (state.sidecar) {
      state.targets = Object.keys((await sc.listCompute()).targets || {}).length;
    }
  } catch (error) { /* no sidecar module or not connected */ }
  if (!active) return state;

  state.name = active.name;
  state.dir = active.dir;
  const area = active.meta?.study_area;
  state.area = area;
  state.hasArea = !!(area && Number(area.max_lat) - Number(area.min_lat) !== 0);
  const count = async (dir, filter) => {
    try {
      return (await store.listProjectDir(dir)).filter(filter || (() => true)).length;
    } catch (error) { return 0; }
  };
  state.datasets = (await store.listData().catch(() => [])).length;
  state.meshes = await count("meshes");
  state.analysis = await count("analysis");
  state.figures = await count("figures");
  state.series = await count("post_processing/extracted_dofs");
  // A run's own folder says how far it got: a deck built, results written.
  const runs = await store.listProjectDir("fem_runs").catch(() => []);
  const dirs = runs.filter((e) => e.kind === "directory");
  state.runs = dirs.length;
  for (const run of dirs) {
    const inner = await store.listProjectDir(`fem_runs/${run.name}`).catch(() => []);
    if (inner.some((e) => e.name === "executable")) state.built += 1;
    if (inner.some((e) => e.name === "results")) state.results += 1;
  }
  return state;
}

/** The first link that is not satisfied but whose prerequisites are. */
function nextStep(state) {
  const done = new Set(ECOSYSTEM.filter((l) => l.has(state)).map((l) => l.id));
  return ECOSYSTEM.find((link) =>
    !done.has(link.id) && !link.optional
    && link.needs.every((n) => done.has(n) || ECOSYSTEM.find((l) => l.id === n)?.optional));
}

/** Why a named stage cannot happen yet, walking its prerequisites. */
function blockers(link, state) {
  const out = [];
  const walk = (node) => {
    node.needs.forEach((id) => {
      const dep = ECOSYSTEM.find((l) => l.id === id);
      if (dep && !dep.has(state)) { out.push(dep); walk(dep); }
    });
  };
  walk(link);
  return out;
}

/** Hazards actually happening near the study area, from the live connectors. */
async function hazardsNearby(state) {
  if (!state.open) throw new Error("Open a project first — I scope this to its study area.");
  const { runConnector, studyBbox } = await import(`./research/connectors.js${STAMP}`);
  const bbox = studyBbox(state.area);
  const wanted = ["usgs-earthquakes", "eonet-volcanoes", "eonet-wildfires", "nws-alerts"];
  const found = [];
  for (const name of wanted) {
    try {
      const result = await runConnector(name, { bbox });
      if (result.geojson.features.length) {
        found.push({ name: result.provider, n: result.geojson.features.length });
      }
    } catch (error) { /* one source being unreachable must not sink the rest */ }
  }
  return { bbox, found };
}

// ── The reflex layer: match an intent, answer it, offer the action ───────────

async function grounded(question) {
  const q = question.toLowerCase().trim();

  if (/^(help|what can you do|who are you|hi|hello)\b/.test(q)) {
    return {
      text: "I'm Atlas. I hold a model of this whole workspace — globe, Meshing "
        + "Studio, Research Hub, the sidecar and the live feeds — and I read your "
        + "project as it actually is, so I can:\n"
        + "• find a tool — “where do I import data?”, “open signal processing”\n"
        + "• tell you where the project stands — “status”\n"
        + "• suggest the next step — “what should I do next?”\n"
        + "• explain what a stage needs — “what does a deck need?”, “why can't I run?”\n"
        + "• check live hazards near your study area — “anything happening nearby?”\n"
        + "• keep watching them for you — “watch this area”, “watch status”\n"
        + (endpoint()
          ? "A model is connected, so you can also just ask me things in plain English."
          : "For open-ended questions I need a model: connect an Atlas hub and I'll use it."),
      actions: [["What should I do next?", () => submit("what should I do next?")]],
    };
  }

  // Status: the whole ecosystem's state, read live rather than remembered.
  // "watch status" is about the watcher, not the project, and this generic
  // branch would otherwise swallow it — the narrower intent has to win.
  if (!/\b(watch|monitor)/.test(q)
    && /\b(status|where am i|what.*(project|open)|current project|overview)\b/.test(q)) {
    const s = await probe();
    if (!s.open) {
      return {
        text: "No project is open. Everything else reads and writes one, so that is the place to start.",
        actions: [["Open or create a project", () => window.GeoIDProject?.open?.(true)]],
      };
    }
    const done = ECOSYSTEM.filter((l) => l.has(s));
    const line = (l) => `${l.has(s) ? "✓" : "·"} ${l.name}`;
    const next = nextStep(s);
    return {
      text: `**${s.name}** on ${s.world} — ${done.length}/${ECOSYSTEM.length} of the workflow in place.\n`
        + ECOSYSTEM.map(line).join("\n")
        + `\n\n${s.layers} layer(s) on the globe · `
        + `${s.sidecar ? `sidecar connected${s.targets ? `, ${s.targets} compute target(s)` : ""}` : "no sidecar"}`
        + (next ? `\n\nNext: ${next.name}.` : "\n\nEverything is in place."),
      actions: next ? [next.act, ["Why?", () => submit(`what does ${next.id} need`)]] : [],
    };
  }

  // Next step, derived from the graph: the first unmet link whose own
  // prerequisites are met.
  if (/\b(next|what should i|stuck|start|begin|now what)\b/.test(q)) {
    const s = await probe();
    const next = nextStep(s);
    if (!next) {
      return {
        text: "Everything in the workflow is in place — data, model, results, analysis and figures. "
          + "From here it is iteration: refine the run, or publish.",
        actions: [["Figure Composer", () => goToPage("Figure Composer")]],
      };
    }
    const gated = next.requiresSidecar && !s.sidecar;
    return {
      text: `Next: **${next.name}** — ${next.produces}.`
        + (gated ? "\n\nThis one runs work outside the browser, so it needs the sidecar connected "
          + "(Settings ▸ Sidecar)." : ""),
      actions: [next.act, ...(next.also || [])],
    };
  }

  // "what does X need" / "why can't I X" — walked from the same graph.
  const named = ECOSYSTEM.find((l) =>
    q.includes(l.id) || q.includes(l.name.replace(/^(a|the) /, "")));
  if (named && /\b(need|require|why|can'?t|before|first|blocked)\b/.test(q)) {
    const s = await probe();
    if (named.has(s)) {
      return { text: `**${named.name}** is already in place — ${named.produces}.`,
        actions: [named.act] };
    }
    const missing = blockers(named, s);
    return {
      text: `**${named.name}** — ${named.produces}.\n`
        + (missing.length
          ? `First you need: ${[...new Set(missing.map((m) => m.name))].join(", ")}.`
          : "Nothing is blocking it; it is the next thing you can do.")
        + (named.requiresSidecar && !s.sidecar
          ? "\nIt also needs the sidecar connected." : ""),
      actions: [(missing[missing.length - 1] || named).act],
    };
  }

  // Standing surveillance of the live feeds. Kept distinct from the one-off
  // "anything happening nearby?" below, which this defers to for the first look.
  // Wiring in your own model subscription. The key goes to the sidecar and
  // stays there — never into this page — so it is only offered when one is up.
  if (/\b(key|api key|claude|chatgpt|openai|gemini|anthropic|subscription|model)\b/.test(q)
    && /\b(add|set|connect|wire|use|configure|remove|delete|which|what|status)\b/.test(q)) {
    const sc = await import(`./research/sidecar.js${STAMP}`);
    if (!sc.isConnected()) {
      return {
        text: "Your own Claude, ChatGPT or Gemini subscription plugs in through "
          + "the sidecar — the key is held by that local service, never by this "
          + "page, because a browser cannot keep a secret. Connect the sidecar "
          + "first (Settings ▸ Sidecar).",
      };
    }
    const keys = await sc.atlasKeys();
    const rows = Object.entries(keys.keys || {})
      .map(([name, k]) => `• ${name.replace("_API_KEY", "")}: `
        + (k.configured ? `set (${k.hint})` : "not set"));
    return {
      text: `Model subscriptions, held by the sidecar:\n${rows.join("\n")}\n\n`
        + (keys.providers?.length
          ? `I'll use ${keys.providers.join(" / ")} for anything I can't answer from the app itself.`
          : "Add one and I can answer open-ended questions, not just app ones."),
      actions: [
        ["Add Claude key", () => addKey(sc, "ANTHROPIC_API_KEY", "Anthropic (Claude)")],
        ["Add ChatGPT key", () => addKey(sc, "OPENAI_API_KEY", "OpenAI (ChatGPT)")],
        ["Add Gemini key", () => addKey(sc, "GEMINI_API_KEY", "Google (Gemini)")],
      ],
    };
  }

  if (/\b(watch|monitor|keep an eye|notify me|surveill)/.test(q)) {
    // The sidecar's watcher is the real one: it keeps running with every tab
    // closed. The in-page watcher is the fallback when there is no sidecar.
    const sc = await import(`./research/sidecar.js${STAMP}`);
    if (sc.isConnected()) return watchViaSidecar(q, sc);
    const watch = await import(`./atlas-watch.js${STAMP}`);
    if (/\b(stop|off|cancel|disable|quit)\b/.test(q)) {
      watch.stop();
      return { text: "Stopped watching. Ask me to watch again whenever you like." };
    }
    if (/\b(status|state|what.*watching|are you)\b/.test(q)) {
      const st = watch.status();
      return {
        text: st.running
          ? `Watching ${st.sources.join(", ")} every ${st.intervalMin} min.\n`
            + `• earthquakes at or above M${st.minMagnitude}\n`
            + `• weather alerts rated ${st.severities.join(" or ")}\n`
            + `• ${st.known} event(s) already known, so only new ones will reach you\n`
            + (st.lastRun ? `• last checked ${new Date(st.lastRun).toLocaleTimeString()}` : "")
            + (st.lastError ? `\n• last problem: ${st.lastError}` : "")
          : "I'm not watching anything at the moment.",
        actions: st.running
          ? [["Stop watching", () => submit("stop watching")]]
          : [["Start watching", () => submit("watch this area")]],
      };
    }
    const s = await probe();
    if (!s.open) {
      return {
        text: "Open a project first — I watch its study area, so that is what scopes the alerts.",
        actions: [["Open or create a project", () => window.GeoIDProject?.open?.(true)]],
      };
    }
    const minutes = Number((q.match(/(\d+)\s*(?:min|minute)/) || [])[1]) || undefined;
    const st = await watch.start(minutes ? { intervalMin: minutes } : {});
    return {
      text: `Watching ${st.sources.join(", ")} around `
        + `${s.hasArea ? "your study area" : "the whole globe (no study area set)"}, `
        + `every ${st.intervalMin} minutes.\n\n`
        + "This first pass just recorded what is already out there — I'll only "
        + `interrupt you for something **new** at or above M${st.minMagnitude}, `
        + `or a ${st.severities.join("/")} weather alert.\n\n`
        + "One caveat, plainly: this runs in the page, so I can only watch while "
        + "a tab is open.",
      actions: [["Watch status", () => submit("watch status")],
        ["Stop watching", () => submit("stop watching")]],
    };
  }

  if (/\b(hazard|happening|nearby|near me|alerts?|earthquakes?|eruption|wildfire|storm)\b/.test(q)) {
    const s = await probe();
    const { bbox, found } = await hazardsNearby(s);
    const where = bbox ? "your study area" : "the whole globe (no study area set)";
    if (!found.length) {
      return { text: `Nothing live reported in ${where} right now, from the sources I can reach.` };
    }
    return {
      text: `Live near ${where}:\n`
        + found.map((f) => `• ${f.n} × ${f.name}`).join("\n")
        + "\n\nPull any of them into the project from the Data Puller and I can put them on the globe.",
      actions: [["Fetch earthquakes", () => goToPage("Ingest Seismic Geophysics")],
        ["Fetch weather alerts", () => goToPage("Ingest Weather Climate")]],
    };
  }

  // "where do I …", "how do I …", or simply a tool's name.
  const pages = await pageIndex();
  const hits = rankPages(pages, q);
  if (hits.length) {
    return {
      text: hits.length === 1
        ? `That is on the **${hits[0].id}** page.${hits[0].blurb ? ` ${hits[0].blurb}` : ""}`
        : `A few places do that:\n${hits.map((h) => `• **${h.id}**${h.blurb ? ` — ${h.blurb}` : ""}`).join("\n")}`,
      actions: hits.map((h) => [`Open ${h.id}`, () => goToPage(h.id)]),
    };
  }
  return null;   // nothing grounded matched; the model gets a turn
}

/**
 * Take a key and hand it straight to the sidecar.
 *
 * Deliberately never stored, echoed or logged on this side: the prompt's value
 * goes over loopback to the local service and the only thing that comes back is
 * a mask. The same reason the chat call is made there.
 */
async function addKey(sc, name, label) {
  const value = window.prompt(
    `${label} API key.\n\n`
    + "It is sent to your local sidecar and kept there at file mode 0600 — "
    + "never stored in this page, never sent anywhere else. Leave blank to remove.");
  if (value === null) return;
  try {
    const after = await sc.saveAtlasKey(name, value.trim());
    const entry = after.keys?.[name] || {};
    bubble("atlas", entry.configured
      ? `${label} is wired in (${entry.hint}). I'll use it for open questions.`
      : `${label} removed.`);
  } catch (error) {
    bubble("atlas", `That key was not accepted: ${error.message}`);
  }
}

/** The persistent watcher: it runs in the sidecar, so it survives the tab. */
async function watchViaSidecar(q, sc) {
  if (/\b(stop|off|cancel|disable|quit)\b/.test(q)) {
    await sc.watchStop();
    return { text: "Stopped watching." };
  }
  if (/\b(status|state|what.*watching|are you)\b/.test(q)) {
    const st = await sc.watchStatus();
    return {
      text: st.running
        ? `Watching ${st.sources.join(", ")} every ${st.config.intervalMin} min, `
          + "**in the sidecar** — so it keeps going with every tab closed.\n"
          + `• earthquakes at or above M${st.config.minMagnitude}\n`
          + `• weather alerts rated ${st.config.severities.join(" or ")}\n`
          + `• ${st.known} event(s) known${st.bbox ? " inside your study area" : " worldwide"}\n`
          + `• ${st.alerts} alert(s) raised so far`
          + (st.last_error ? `\n• last problem: ${st.last_error}` : "")
        : "The sidecar is not watching anything at the moment.",
      actions: st.running
        ? [["Stop watching", () => submit("stop watching")]]
        : [["Start watching", () => submit("watch this area")]],
    };
  }
  const state = await probe();
  const area = state.area;
  const bbox = state.hasArea ? {
    minLat: Number(area.min_lat), maxLat: Number(area.max_lat),
    minLon: Number(area.min_lon), maxLon: Number(area.max_lon),
  } : null;
  const minutes = Number((q.match(/(\d+)\s*(?:min|minute)/) || [])[1]) || undefined;
  const st = await sc.watchStart({
    ...(minutes ? { intervalMin: minutes } : {}), ...(bbox ? { bbox } : {}),
  });
  return {
    text: `Watching ${st.sources.join(", ")} every ${st.config.intervalMin} minutes, `
      + `${bbox ? "inside your study area" : "worldwide (no study area set)"}.\n\n`
      + "This runs **in the sidecar**, so it keeps watching with every tab closed — "
      + "and tells you what it found when you come back.\n\n"
      + "The first pass only records what is already out there; I'll interrupt you "
      + `for something new at or above M${st.config.minMagnitude}, or a `
      + `${st.config.severities.join("/")} weather alert.`,
    actions: [["Watch status", () => submit("watch status")],
      ["Stop watching", () => submit("stop watching")]],
  };
}

/**
 * Catch up on what the sidecar saw while this tab was closed, then keep an eye
 * on it. This is the point of moving the loop out of the page: you come back and
 * Atlas already knows.
 */
const ALERT_CURSOR = "geoid-gis:atlas-alert-cursor";
async function drainAlerts() {
  try {
    const sc = await import(`./research/sidecar.js${STAMP}`);
    if (!sc.isConnected()) return;
    const st = await sc.watchStatus();
    if (!st.running && !st.alerts) return;
    let since = 0;
    try { since = Number(window.localStorage.getItem(ALERT_CURSOR)) || 0; }
    catch (error) { /* storage unavailable */ }
    const alerts = await sc.atlasAlerts(since);
    if (!alerts.length) return;
    try { window.localStorage.setItem(ALERT_CURSOR, String(since + alerts.length)); }
    catch (error) { /* storage unavailable */ }
    window.GeoIDAtlas?.notify?.(
      `While you were away I saw **${alerts.length} new `
      + `${alerts.length === 1 ? "event" : "events"}**:\n`
      + alerts.slice(-8).map((a) => `• ${a.text}`).join("\n")
      + (alerts.length > 8 ? `\n…and ${alerts.length - 8} more.` : ""),
      [["Watch status", () => submit("watch status")]]);
  } catch (error) { /* the watcher is a bonus, never a blocker */ }
}

// ── Panel ────────────────────────────────────────────────────────────────────

function bubble(role, text) {
  const wrap = el("div", `atlas-msg atlas-${role}`);
  // Only **bold** is honoured, so a model cannot inject markup into the page.
  const html = String(text)
    .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
  wrap.innerHTML = html;
  logNode.appendChild(wrap);
  logNode.scrollTop = logNode.scrollHeight;
  return wrap;
}

function actionRow(actions) {
  const row = el("div", "atlas-actions");
  actions.forEach(([label, fn]) => {
    const b = el("button", "atlas-action", label);
    b.type = "button";
    b.addEventListener("click", () => { fn(); });
    row.appendChild(b);
  });
  logNode.appendChild(row);
  logNode.scrollTop = logNode.scrollHeight;
}

async function submit(text) {
  const question = String(text || "").trim();
  if (!question) return;
  bubble("user", question);
  inputNode.value = "";
  const thinking = bubble("atlas", "…");
  try {
    const answer = await grounded(question);
    if (answer) {
      thinking.remove();
      bubble("atlas", answer.text);
      if (answer.actions?.length) actionRow(answer.actions);
      return;
    }
    // Nothing grounded matched. A model answers if one is connected; otherwise
    // say so plainly rather than improvise.
    if (!endpoint()) {
      thinking.remove();
      bubble("atlas",
        "I can't answer that one from what I know about the app. I'm grounded in "
        + "this application and your project — try “what should I do next?”, "
        + "“status”, or the name of a tool. For open questions, connect an Atlas "
        + "hub and I'll use its model.");
      actionRow([["Connect a hub…", connectPrompt]]);
      return;
    }
    const reply = await askModel(question);
    thinking.remove();
    bubble("atlas", reply.text || "The hub returned nothing.");
  } catch (error) {
    thinking.remove();
    bubble("atlas", `That did not work: ${error.message}`);
  }
}

function connectPrompt() {
  const url = window.prompt(
    "Atlas hub URL (it serves /api/chat/simple):", endpoint() || "http://127.0.0.1:8000");
  if (url === null) return;
  setEndpoint(url.trim());
  bubble("atlas", url.trim()
    ? `Connected to ${url.trim()}. Ask me anything now.`
    : "Disconnected. I'll stick to what I know about the app.");
}

/**
 * The mark sits in the top-right corner, left of the GIS tool rail.
 *
 * Measured from what is actually in that corner rather than written as an
 * offset: the rail's width changes with the breakpoint (3.7rem, 2.3rem, 1.85rem
 * embedded) and `.map-legend` shares the corner when a layer has a legend, so a
 * fixed `right:` would either overlap one of them or leave a gap at every other
 * size. Whichever is furthest left decides.
 *
 * On a page with neither — the Research Hub, a planet viewer with no rail — the
 * stylesheet's own top-right values stand.
 */
function placeLauncher(launcher, panelNode) {
  const GAP = 12;
  const boxes = [document.getElementById("tool-rail"), document.querySelector(".map-legend")]
    .filter((n) => n && getComputedStyle(n).display !== "none")
    .map((n) => n.getBoundingClientRect())
    // A rail parked at mid-height (the narrow embedded layout centres it) is no
    // guide for a top-corner control.
    .filter((b) => b.width && b.top < window.innerHeight * 0.5);
  if (!boxes.length) return;

  const top = Math.round(Math.min(
    Math.max(8, Math.min(...boxes.map((b) => b.top))), window.innerHeight * 0.25,
  ));
  const right = Math.max(8, Math.round(
    window.innerWidth - Math.min(...boxes.map((b) => b.left)) + GAP,
  ));
  launcher.style.top = `${top}px`;
  launcher.style.right = `${right}px`;
  launcher.style.bottom = "auto";

  // The panel drops from the mark instead of rising to it, and takes the height
  // that leaves rather than the stylesheet's bottom-anchored guess — with the
  // hub armed the rail moves down, and so does everything measured from it.
  const below = top + (launcher.offsetHeight || 52) + 10;
  panelNode.style.top = `${below}px`;
  panelNode.style.bottom = "auto";
  panelNode.style.maxHeight = `${Math.max(220, window.innerHeight - below - 18)}px`;
}

function build() {
  if (byId("atlas-launcher")) return;

  const launcher = el("button", "atlas-launcher");
  launcher.id = "atlas-launcher";
  launcher.type = "button";
  launcher.title = "Ask Atlas";
  launcher.setAttribute("aria-label", "Ask Atlas");
  launcher.innerHTML = '<span class="atlas-launcher-mark">◆</span>';
  launcher.addEventListener("click", () => toggle());

  panel = el("section", "atlas-panel");
  panel.id = "atlas-panel";
  panel.hidden = true;

  const head = el("header", "atlas-head");
  head.append(el("span", "atlas-title", "Atlas"),
    el("span", "atlas-sub", "guide to this workspace"));
  const close = el("button", "atlas-close", "✕");
  close.type = "button";
  close.title = "Close";
  close.addEventListener("click", () => toggle(false));
  head.appendChild(close);

  logNode = el("div", "atlas-log");
  const form = el("form", "atlas-form");
  inputNode = document.createElement("input");
  inputNode.className = "atlas-input";
  inputNode.type = "text";
  inputNode.placeholder = "Ask where something is, or what to do next…";
  const send = el("button", "atlas-send", "→");
  send.type = "submit";
  form.append(inputNode, send);
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(inputNode.value); });

  panel.append(head, logNode, form);
  document.body.append(launcher, panel);
  const replace = () => placeLauncher(launcher, panel);
  replace();
  window.addEventListener("resize", replace);
  // The rail moves without a resize — arming the hub pushes it below the hazard
  // readout, and switching mode hides it — so this is polled rather than
  // hooked to any one of those events.
  setInterval(replace, 500);

  bubble("atlas",
    "I'm **Atlas**. I know this workspace and your open project — ask where a tool "
    + "is, what the project holds, or what to do next.");
  actionRow([
    ["What should I do next?", () => submit("what should I do next?")],
    ["Status", () => submit("status")],
    ["Anything happening nearby?", () => submit("hazards nearby")],
  ]);
}

function toggle(force) {
  open = force === undefined ? !open : force;
  if (panel) panel.hidden = !open;
  byId("atlas-launcher")?.classList.toggle("is-open", open);
  if (open) setTimeout(() => inputNode?.focus(), 60);
}

/** Its own stylesheet, so adding Atlas to a page is one script tag. */
function loadStyles() {
  if (document.querySelector("link[data-atlas-assistant]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  // Anchored to this module, not the document: the planet pages sit a
  // directory deeper than the Earth viewer.
  link.href = new URL(`./atlas-assistant.css${STAMP}`, import.meta.url).href;
  link.dataset.atlasAssistant = "1";
  document.head.appendChild(link);
}

function init() {
  loadStyles();
  build();
  // Escape closes it, like every other panel here.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) toggle(false);
  });
  // What the sidecar's watcher saw while this tab was closed, then a light
  // poll so a long-open tab still hears about it.
  setTimeout(() => { void drainAlerts(); }, 4000);
  setInterval(() => { void drainAlerts(); }, 3 * 60 * 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/**
 * The seam the rest of the app talks to Atlas through.
 *
 * `notify` is what a future monitor will push through: a hazard crossing a
 * threshold, a solve finishing, a feed going stale. It opens the panel and
 * speaks, so an alert arrives where the user is already looking.
 */
window.GeoIDAtlas = {
  open: (v) => toggle(v === undefined ? true : v),
  ask: submit,
  connect: setEndpoint,
  endpoint,
  notify: (message, actions) => {
    toggle(true);
    bubble("atlas", message);
    if (actions?.length) actionRow(actions);
  },
};
