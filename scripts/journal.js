/**
 * The Journal at /updates/.
 *
 * TWO FILES, ONE PAGE. Posts and technical notes are data/journal.json;
 * releases are data/updates.json, the file the homepage's "What's new" grid is
 * generated from. Reading releases from that file rather than copying them
 * here means a release is announced once and appears in both places.
 *
 * AN ENTRY HAS AN ADDRESS. The reader view is `/updates/?p=<slug>`, pushed onto
 * history, so a post or a note can be linked, bookmarked and shared, and the
 * back button returns to the list with its filter and search as they were.
 *
 * TEXT IS NEVER HTML. Every string from either file goes in through
 * textContent; the body is structured blocks (heading, paragraph, list,
 * equation) rather than markup, so a file edited by hand cannot inject into
 * the page.
 */

const JOURNAL = "/data/journal.json";
const RELEASES = "/data/updates.json";

const byId = (id) => (typeof document === "undefined" ? null : document.getElementById(id));
const grid = byId("journal-grid");
const index = byId("journal-index");
const reader = byId("journal-reader");
const search = byId("journal-search");

const state = { entries: [], filter: "all", query: "" };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "style") node.setAttribute("style", value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** A date written as a reader says it. The files hold ISO dates. */
export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Minutes to read at 230 words a minute, from the blocks themselves. */
export function readingMinutes(entry) {
  const words = [entry.abstract || "", ...(entry.body || []).map((block) => {
    if (block[0] === "ul") return block[1].map((item) => `${item.lead || ""} ${item.text}`).join(" ");
    return String(block[1] || "");
  })].join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

const KIND_LABEL = { post: "Post", paper: "Technical note", release: "Release" };

/** A release from data/updates.json in the Journal's own shape. */
export function releaseEntry(update, order) {
  return {
    type: "release",
    slug: null,
    title: update.title,
    summary: update.desc,
    image: update.image,
    href: update.href,
    kicker: update.kicker,
    status: update.status,
    // updates.json carries no dates: its order IS its chronology (newest first).
    order,
  };
}

/** Newest first; releases keep their file's own order after the dated entries. */
export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

export function matches(entry, filter, query) {
  if (filter !== "all" && entry.type !== filter) return false;
  if (!query) return true;
  const hay = [entry.title, entry.summary, entry.abstract, entry.kind, ...(entry.tags || [])]
    .filter(Boolean).join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

/** The citation a reader copies, in the house style of an unreviewed note. */
export function citationText(entry, origin = "https://geoidinitiative.com") {
  const year = (entry.date || "").slice(0, 4);
  const venue = entry.peer_reviewed && entry.venue ? entry.venue : `GeoID Initiative ${entry.kind || "Technical note"}`;
  const locator = entry.doi ? `https://doi.org/${entry.doi}` : `${origin}/updates/?p=${entry.slug}`;
  return `${entry.author} (${year}). ${entry.title}. ${venue}. ${locator}`;
}

export function bibtex(entry, origin = "https://geoidinitiative.com") {
  const year = (entry.date || "").slice(0, 4);
  const surname = (entry.author || "geoid").split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, "");
  const key = `${surname}${year}${(entry.slug || "").split("-")[0]}`;
  const fields = [
    ["author", entry.author],
    ["title", `{${entry.title}}`],
    ["year", year],
    entry.peer_reviewed && entry.venue ? ["journal", entry.venue] : ["institution", "GeoID Initiative"],
    entry.peer_reviewed ? null : ["type", entry.kind || "Technical note"],
    entry.doi ? ["doi", entry.doi] : ["url", `${origin}/updates/?p=${entry.slug}`],
  ].filter(Boolean);
  const kind = entry.peer_reviewed ? "article" : "techreport";
  return `@${kind}{${key},\n${fields.map(([k, v]) => `  ${k} = {${v}}`).join(",\n")}\n}`;
}

// ── The list ──────────────────────────────────────────────────────────────

function card(entry, lead) {
  const isRelease = entry.type === "release";
  const href = isRelease ? entry.href : `/updates/?p=${encodeURIComponent(entry.slug)}`;
  const meta = el("div", { class: "journal-meta" },
    el("span", { class: `journal-kind ${entry.type}`, text: isRelease ? (entry.kicker || "Release") : (entry.kind || KIND_LABEL[entry.type]) }),
    entry.date ? el("span", { text: formatDate(entry.date) }) : null,
    isRelease ? null : el("span", { text: `${readingMinutes(entry)} min read` }),
  );
  const node = el("a", { class: `journal-card${lead ? " lead" : ""}`, href },
    el("div", { class: "thumb", role: "img", "aria-label": entry.title }),
    el("div", { class: "body" },
      meta,
      el("h3", { text: entry.title }),
      el("p", { text: entry.summary }),
      el("span", { class: "more", text: isRelease ? "Open →" : entry.type === "paper" ? "Read the note →" : "Read →" }),
    ),
  );
  // A url() built from a data string is quoted and escaped: an image path is
  // data too.
  if (entry.image) node.querySelector(".thumb").style.backgroundImage = `url("${encodeURI(entry.image)}")`;
  if (!isRelease) {
    node.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      navigate(entry.slug);
    });
  }
  return node;
}

function renderCounts() {
  for (const button of document.querySelectorAll(".journal-filter")) {
    const kind = button.dataset.filter;
    const count = kind === "all" ? state.entries.length : state.entries.filter((e) => e.type === kind).length;
    let badge = button.querySelector(".count");
    if (!badge) badge = button.appendChild(el("span", { class: "count" }));
    badge.textContent = String(count);
    button.setAttribute("aria-pressed", String(kind === state.filter));
  }
}

function renderList() {
  renderCounts();
  const shown = state.entries.filter((entry) => matches(entry, state.filter, state.query));
  grid.textContent = "";
  if (!shown.length) {
    grid.append(el("p", { class: "journal-empty", text: state.query ? `Nothing in the Journal matches “${state.query}”.` : "Nothing here yet." }));
    return;
  }
  // The lead tile only on the unfiltered, unsearched list: a search result is
  // not "what is new".
  const leadFirst = state.filter === "all" && !state.query;
  shown.forEach((entry, i) => grid.append(card(entry, leadFirst && i === 0)));
}

// ── The reader ────────────────────────────────────────────────────────────

function renderBody(blocks) {
  const body = el("div", { class: "reader-body" });
  for (const block of blocks || []) {
    const [kind, value] = block;
    if (kind === "h") body.append(el("h2", { text: value }));
    else if (kind === "p") body.append(el("p", { text: value }));
    else if (kind === "eq") body.append(el("div", { class: "eq", role: "math", "aria-label": value, text: value }));
    else if (kind === "ul") {
      body.append(el("ul", {}, value.map((item) => el("li", {},
        item.lead ? el("strong", { text: item.lead }) : null,
        item.lead ? " — " : null,
        item.text))));
    }
  }
  return body;
}

async function copy(text, status, done) {
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = done;
  } catch (error) {
    status.textContent = "Copy is blocked here — select the text and copy it by hand.";
  }
}

function renderReader(entry) {
  const readable = state.entries.filter((e) => e.type !== "release");
  const at = readable.indexOf(entry);
  const newer = readable[at - 1];
  const older = readable[at + 1];
  const isPaper = entry.type === "paper";

  reader.textContent = "";
  const back = el("a", { class: "reader-back", href: "/updates/" }, "← All entries");
  back.addEventListener("click", (event) => { event.preventDefault(); navigate(null); });
  reader.append(back);

  reader.append(el("div", { class: "journal-meta" },
    el("span", { class: `journal-kind ${entry.type}`, text: entry.kind || KIND_LABEL[entry.type] }),
    el("span", { text: formatDate(entry.date) }),
    el("span", { text: `${readingMinutes(entry)} min read` }),
    isPaper && !entry.peer_reviewed ? el("span", { text: "Not peer reviewed" }) : null,
  ));
  reader.append(el("h1", { text: entry.title }));
  reader.append(el("p", { class: "journal-meta", text: `By ${entry.author}` }));
  if (entry.image) {
    const hero = el("div", { class: "reader-hero", role: "img", "aria-label": entry.title });
    hero.style.backgroundImage = `url("${encodeURI(entry.image)}")`;
    reader.append(hero);
  }
  if (entry.abstract) reader.append(el("div", { class: "reader-abstract" }, el("strong", { text: "Abstract" }), entry.abstract));
  if (entry.edited) reader.append(el("p", { class: "reader-edited", text: entry.edited }));
  reader.append(renderBody(entry.body));

  if (entry.tags?.length) reader.append(el("div", { class: "reader-tags" }, entry.tags.map((t) => el("span", { text: `#${t}` }))));

  const status = el("span", { class: "cite-status", role: "status" });
  const shareUrl = `${location.origin}/updates/?p=${entry.slug}`;
  reader.append(el("div", { class: "reader-actions" },
    (entry.links || []).map((link, i) => el("a", { class: i === 0 ? "btn-primary" : "btn-ghost", href: link.href, text: link.label })),
    el("button", { class: "btn-ghost", type: "button", onclick: () => copy(shareUrl, status, "Link copied.") }, "Copy link"),
    status,
  ));

  if (entry.references?.length) {
    reader.append(el("section", { class: "glass-panel reader-panel" },
      el("h2", { text: "References" }),
      el("ol", {}, entry.references.map((ref) => el("li", { text: ref })))));
  }
  if (isPaper) {
    const citeStatus = el("span", { class: "cite-status", role: "status" });
    const text = citationText(entry, location.origin);
    reader.append(el("section", { class: "glass-panel reader-panel" },
      el("h2", { text: "Cite this note" }),
      el("p", { class: "cite-text", text }),
      el("div", { class: "cite-row" },
        el("button", { class: "btn-ghost", type: "button", onclick: () => copy(text, citeStatus, "Citation copied.") }, "Copy citation"),
        el("button", { class: "btn-ghost", type: "button", onclick: () => copy(bibtex(entry, location.origin), citeStatus, "BibTeX copied.") }, "Copy BibTeX"),
        citeStatus)));
  }

  const pager = el("nav", { class: "reader-pager", "aria-label": "More from the Journal" });
  const pageLink = (target, label, cls) => {
    const a = el("a", { class: cls, href: `/updates/?p=${target.slug}` }, el("small", { text: label }), target.title);
    a.addEventListener("click", (event) => { event.preventDefault(); navigate(target.slug); });
    return a;
  };
  if (newer) pager.append(pageLink(newer, "Newer", "prev"));
  if (older) pager.append(pageLink(older, "Older", "next"));
  if (newer || older) reader.append(pager);

  document.title = `${entry.title} — GeoID Journal`;
}

// ── Routing ───────────────────────────────────────────────────────────────

function show() {
  const slug = new URL(location.href).searchParams.get("p");
  const entry = slug ? state.entries.find((e) => e.slug === slug) : null;
  if (entry) {
    renderReader(entry);
    index.hidden = true;
    reader.hidden = false;
    window.scrollTo({ top: 0 });
  } else {
    if (slug) history.replaceState(null, "", "/updates/");
    reader.hidden = true;
    index.hidden = false;
    document.title = "Journal — GeoID Initiative";
    renderList();
  }
}

function navigate(slug) {
  history.pushState(null, "", slug ? `/updates/?p=${encodeURIComponent(slug)}` : "/updates/");
  show();
}

async function load() {
  const read = async (url) => {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn(`[journal] ${url}: ${error.message}`);
      return null;
    }
  };
  const [journal, releases] = await Promise.all([read(JOURNAL), read(RELEASES)]);
  const entries = [
    ...(journal?.entries || []),
    ...((releases?.updates || []).map((u, i) => releaseEntry(u, i))),
  ];
  state.entries = sortEntries(entries);
  if (!state.entries.length) {
    grid.append(el("p", { class: "journal-empty", text: "The Journal could not be loaded. Try again in a moment." }));
    return;
  }
  show();
}

if (grid && typeof document !== "undefined") {
  for (const button of document.querySelectorAll(".journal-filter")) {
    button.addEventListener("click", () => { state.filter = button.dataset.filter; renderList(); });
  }
  search?.addEventListener("input", () => { state.query = search.value.trim(); renderList(); });
  window.addEventListener("popstate", show);
  load();
}
