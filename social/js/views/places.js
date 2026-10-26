/**
 * #/places and #/place/:slug -- place pages (places.js in the Worker): one
 * page for a location many members study, and its story, built together.
 *
 * The story is weighed: each entry says how strong it is (a peer-reviewed
 * paper above a note; a verified, established contributor above a new
 * account; what members endorse) and why. Two views: the timeline, in the
 * order things happened, and "strongest evidence first".
 */
import * as api from "../api.js?v=20261026-ef953d6";
import { store } from "../store.js?v=20261026-ef953d6";
import { h, put, clear, loading, errorBox, empty, field, input, select, textarea, toast, modal, extLink, busy } from "../dom.js?v=20261026-ef953d6";
import { postCard, pagedList, followButton, userChip, act, requireSignIn } from "../components.js?v=20261026-ef953d6";
import { createMap } from "../mapcore.js?v=20261026-ef953d6";
import { mentoringRequestDialog } from "./settings.js?v=20261026-ef953d6";

const enc = encodeURIComponent;
const KIND_LABEL = { paper: "Paper", post: "Network post", link: "Link", milestone: "Milestone" };
const KIND_GLYPH = { paper: "¶", post: "◆", link: "↗", milestone: "◷" };
const LEVEL = { strong: ["Strong evidence", "s-ev-strong"], good: ["Good evidence", "s-ev-good"], member: ["Member contribution", "s-ev-member"] };

export function renderList(root) {
  const list = h("div", { class: "s-place-list" }, loading());
  put(clear(root),
    h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Places" }),
      h("a", { class: "btn-ghost", href: "#/map" }, "See them on the map")),
    h("p", { class: "s-muted", text: "A page for each place members study: its story told through papers, posts, data and milestones, the people who work there, its questions and its openings. Open one from any of your study areas." }),
    list);
  api.get("/v1/places/pages").then((d) => {
    const items = d?.items || [];
    put(clear(list), items.length ? items.map((p) => h("a", { class: "s-card s-place-card", href: `#/place/${enc(p.slug)}` },
      h("h2", { class: "s-card-title", text: p.name }),
      p.summary ? h("p", { class: "s-muted", text: p.summary.slice(0, 180) }) : null,
      h("p", { class: "s-hint", text: `${p.entries} stor${p.entries === 1 ? "y entry" : "y entries"} · ${p.radius_km} km across` })))
      : empty("No place pages yet.", "Open one from a study area on your profile: Edit profile → Study areas → Place page."));
  }).catch((error) => put(clear(list), errorBox(error)));
}

export async function renderOne(root, { params, query }) {
  put(clear(root), loading());
  let p;
  try { p = await api.get(`/v1/places/pages/${enc(params.slug)}`); } catch (error) { put(clear(root), errorBox(error)); return undefined; }
  document.title = `${p.name} — GeoID Network`;
  const tab = ["story", "ask", "openings", "people", "photos", "posts"].includes(query.tab) ? query.tab : "story";
  const tabLink = (id, label, n) => h("a", { href: `#/place/${enc(p.slug)}?tab=${id}`, class: id === tab ? "is-active" : "", "aria-current": id === tab ? "page" : null },
    label, n ? h("span", { class: "s-chip-n", text: String(n) }) : null);
  const c = p.counts || {};
  const canvas = h("canvas", { class: "s-place-map", "aria-label": `Map of ${p.name}` });
  const summary = h("p", { class: "s-place-summary", text: p.summary || "No summary yet." });
  const editSummary = p.viewer?.can_edit ? h("button", { type: "button", class: "s-link-btn", onClick: () => summaryDialog(p, summary) }, "Edit summary") : null;
  const body = h("div", {});
  put(clear(root),
    h("header", { class: "s-place-head" },
      h("div", {},
        h("p", { class: "s-labels" }, h("span", { class: "s-kind", text: "Place" }), h("span", { class: "s-vis", text: `${p.radius_km} km around ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}` })),
        h("h1", { class: "s-h1", text: p.name }), summary, editSummary,
        h("p", { class: "s-place-stats" },
          stat(c.people, "studies here", "study here"), stat(c.mentors, "mentor", "mentors"),
          stat(c.entries, "story entry", "story entries"), stat(c.peer_reviewed, "peer-reviewed paper", "peer-reviewed papers")),
        h("div", { class: "s-actions" },
          h("button", { type: "button", class: "btn-primary", onClick: () => (requireSignIn("add to a place's story") ? addDialog(p) : null) }, "Add to the story"),
          h("a", { class: "btn-ghost", href: `#/compose?kind=question&place=${enc(p.slug)}` }, "Ask a question here"),
          store.me ? followButton("placepage", p.slug, p.viewer?.following, "place") : null,
          h("a", { class: "btn-ghost s-btn-sm", href: `/?flight=earth&lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}` }, "Fly over it in GeoHUB"))),
      canvas),
    h("nav", { class: "s-tabs", "aria-label": "Place" },
      tabLink("story", "Story", c.entries), tabLink("ask", "Questions"), tabLink("openings", "Jobs & events"),
      tabLink("people", "People & mentors", c.people), tabLink("photos", "Photos"), tabLink("posts", "Everything here")),
    body);
  if (tab === "story") put(body, storyView(p, query));
  if (tab === "ask") put(body, h("div", { class: "s-title-row" }, h("p", { class: "s-muted", text: `Questions about ${p.name}, from anyone. Answers from people who study here carry their study area beside their name.` }),
    h("a", { class: "btn-primary s-btn-sm", href: `#/compose?kind=question&place=${enc(p.slug)}` }, "Ask a question")),
    pagedList((cursor) => api.get(`/v1/places/pages/${enc(p.slug)}/posts`, { kind: "question", cursor }), postCard, { emptyTitle: "No questions yet.", emptyDetail: "Ask the first: people who study here are told." }));
  if (tab === "openings") put(body, h("h2", { class: "s-h3", text: "Jobs and studentships" }),
    pagedList((cursor) => api.get(`/v1/places/pages/${enc(p.slug)}/posts`, { kind: "opportunity", cursor }), postCard, { emptyTitle: "No openings here right now." }),
    h("h2", { class: "s-h3", text: "Events and fieldwork" }),
    pagedList((cursor) => api.get(`/v1/places/pages/${enc(p.slug)}/posts`, { kind: "event", cursor }), postCard, { emptyTitle: "No events here yet." }));
  if (tab === "people") put(body, peopleView(p));
  if (tab === "photos") put(body, photosView(p));
  if (tab === "posts") put(body, pagedList((cursor) => api.get(`/v1/places/pages/${enc(p.slug)}/posts`, { cursor }), postCard,
    { emptyTitle: "Nothing posted here yet.", emptyDetail: `Posts located within ${p.radius_km} km, or tagged #${p.slug}, appear here.` }));

  const map = createMap(canvas, {
    onDraw: (ctx, { project }) => {
      const [x, y] = project(p.lon, p.lat);
      const [x2] = project(p.lon + p.radius_km / (111 * Math.cos(p.lat * Math.PI / 180)), p.lat);
      ctx.strokeStyle = "rgba(255, 62, 200, 0.9)"; ctx.fillStyle = "rgba(255, 62, 200, 0.12)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, Math.max(6, Math.abs(x2 - x)), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    },
  });
  map.setView(p.lon, p.lat, Math.max(4, Math.min(40, 360 / (p.radius_km / 111) / 6)));
  return () => map.destroy();
}

const stat = (n, one, many) => h("span", {}, h("strong", { text: String(n || 0) }), ` ${n === 1 ? one : many}`);

// ── The story ──────────────────────────────────────────────────────────────

function storyView(p, query) {
  const order = query.order === "weight" ? "weight" : "time";
  const kind = ["paper", "post", "link", "milestone"].includes(query.kind) ? query.kind : "";
  const href = (o, k) => `#/place/${enc(p.slug)}?tab=story${o === "weight" ? "&order=weight" : ""}${k ? `&kind=${k}` : ""}`;
  const box = h("div", { class: "s-story" }, loading());
  const controls = h("div", { class: "s-story-controls" },
    h("div", { class: "s-seg", role: "group", "aria-label": "Order" },
      h("a", { href: href("time", kind), class: order === "time" ? "is-on" : "", "aria-current": order === "time" ? "true" : null }, "Timeline"),
      h("a", { href: href("weight", kind), class: order === "weight" ? "is-on" : "", "aria-current": order === "weight" ? "true" : null }, "Strongest evidence first")),
    h("nav", { class: "s-chips", "aria-label": "Kind" }, [["", "Everything"], ["paper", "Papers"], ["post", "Posts"], ["link", "Links & data"], ["milestone", "Milestones"]]
      .map(([k, label]) => h("a", { class: `s-chip${kind === k ? " is-on" : ""}`, href: href(order, k) }, label))));
  const load = () => api.get(`/v1/places/pages/${enc(p.slug)}/story`, { order, kind }).then((d) => {
    const items = d.items || [];
    clear(box);
    if (!items.length) { put(box, empty("The story hasn't started.", "Add the paper everybody cites, a milestone, or a post that belongs here.")); return; }
    if (order === "weight") { put(box, h("ol", { class: "s-story-list" }, items.map((e) => entryCard(e, load)))); return; }
    // Timeline: grouped by year, newest first.
    const years = new Map();
    for (const e of items) { const y = (e.happened_on || "").slice(0, 4) || "Undated"; if (!years.has(y)) years.set(y, []); years.get(y).push(e); }
    put(box, [...years].map(([y, list]) => h("section", { class: "s-story-year" }, h("h3", { class: "s-story-y", text: y }),
      h("ol", { class: "s-story-list" }, list.map((e) => entryCard(e, load))))));
  }).catch((error) => put(clear(box), errorBox(error)));
  load();
  return h("div", {}, controls,
    h("p", { class: "s-hint", text: "Every entry shows how strong it is and why: peer-reviewed papers above notes, contributors with a verified ORCID iD or affiliation and a record here above new accounts, and what members endorse. Nothing is hidden for being weaker." }),
    box);
}

function entryCard(e, reload) {
  const [label, cls] = LEVEL[e.weight.level];
  const title = e.post ? h("a", { href: `#/post/${enc(e.post.id)}` }, e.title) : e.url ? extLink(e.url, e.title) : h("span", { text: e.title });
  const endorse = h("button", { type: "button", class: "s-act", "aria-pressed": String(e.endorsed_by_me), disabled: e.mine,
    title: e.mine ? "Others endorse what you add" : "Endorse: this is useful, and sound" }, `Useful · ${e.endorsements}`);
  endorse.addEventListener("click", () => act(async () => {
    const out = await api.post(`/v1/places/entries/${enc(e.id)}/endorse`, { on: !e.endorsed_by_me });
    Object.assign(e, out);
    reload();
  }, "endorse"));
  return h("li", { class: `s-entry ${cls}` },
    h("div", { class: "s-entry-rail" }, h("span", { class: "s-entry-glyph", "aria-hidden": "true", text: KIND_GLYPH[e.kind] }),
      h("span", { class: "s-entry-date", text: e.happened_on || "" })),
    h("div", { class: "s-entry-main" },
      h("p", { class: "s-labels" },
        h("span", { class: `s-ev ${cls}`, text: label }),
        h("span", { class: "s-kind", text: KIND_LABEL[e.kind] }),
        e.peer_reviewed ? h("span", { class: "s-verified", text: "Peer reviewed" }) : null,
        e.post?.provenance ? h("span", { class: "s-vis", text: e.post.provenance }) : null),
      h("p", { class: "s-entry-title" }, title),
      e.authors || e.venue ? h("p", { class: "s-muted s-entry-cite", text: [e.authors, e.venue].filter(Boolean).join(" · ") }) : null,
      e.summary ? h("p", { class: "s-entry-summary", text: e.summary }) : null,
      h("div", { class: "s-entry-foot" },
        e.added_by ? h("span", { class: "s-muted" }, "Added by ", userChip(e.added_by, { sub: false })) : null,
        h("details", { class: "s-why" }, h("summary", {}, "Why this weight"), h("ul", {}, e.weight.why.map((w) => h("li", { text: w })))),
        endorse,
        e.mine || store.me?.admin ? h("button", { type: "button", class: "s-link-btn s-danger", onClick: () => act(async () => { await api.del(`/v1/places/entries/${enc(e.id)}`); reload(); }) }, "Remove") : null)));
}

function addDialog(p) {
  modal(`Add to the story of ${p.name}`, (close) => {
    const kind = select("kind", [["paper", "A paper (by its DOI)"], ["post", "A post from the Network"], ["link", "A report, dataset or page"], ["milestone", "A milestone: something that happened"]], "paper");
    const doi = input("doi", { placeholder: "10.1029/2021GL093123 or https://doi.org/…" });
    const post = select("post", [["", "Loading your posts…"]], "");
    const linkUrl = input("url", { type: "url", placeholder: "https://…" });
    const title = input("title", { maxlength: 300 });
    const date = input("happened_on", { placeholder: "2021, 2021-03 or 2021-03-16", maxlength: 10 });
    const summary = textarea("summary", { rows: 3, maxlength: 1200, placeholder: "Why it matters for this place, in a sentence or two." });
    const parts = {
      doi: field("DOI", doi, "Title, authors, journal and year come from Crossref; journal articles are marked peer reviewed."),
      post: field("Your post", post, "Your public posts. To add someone else's, open it and use its link here as a Link."),
      url: field("Address", linkUrl), title: field("Title", title), date: field("When it happened", date, "Where it sits in the story. For a paper, its year is used if you leave this empty."),
    };
    const sync = () => {
      const k = kind.value;
      parts.doi.hidden = k !== "paper"; parts.post.hidden = k !== "post"; parts.url.hidden = k !== "link";
      parts.title.hidden = k === "paper" || k === "post";
    };
    kind.addEventListener("change", sync); sync();
    api.get("/v1/feed", { tab: "all", author: store.me?.user?.handle }).then((d) => {
      clear(post);
      const mine = (d.items || []).filter((x) => x.visibility === "public");
      put(post, mine.length ? mine.map((x) => h("option", { value: x.id }, x.title || x.kind)) : h("option", { value: "" }, "You have no public posts yet."));
    }).catch(() => {});
    const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
    const form = h("form", { class: "s-form" }, field("What are you adding?", kind), parts.doi, parts.post, parts.url, parts.title, parts.date,
      field("Why it matters (optional)", summary), status,
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Add to the story")));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const done = busy(form);
      try {
        await api.post(`/v1/places/pages/${enc(p.slug)}/story`, { kind: kind.value, doi: doi.value, post_id: post.value, url: linkUrl.value,
          title: title.value, happened_on: date.value.trim(), summary: summary.value });
        close(true);
        toast("Added. Followers of this place are told.");
        location.hash = `#/place/${enc(p.slug)}?tab=story&r=${Date.now()}`;
      } catch (error) { done(); status.textContent = error.message; status.classList.add("is-error"); }
    });
    return form;
  }, { wide: true });
}

function summaryDialog(p, el) {
  modal("Edit the summary", (close) => {
    const text = textarea("summary", { rows: 5, maxlength: 2000, value: p.summary || "" });
    const form = h("form", { class: "s-form" }, field("Summary", text, "What this place is and why people study it."),
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Save")));
    form.addEventListener("submit", (ev) => { ev.preventDefault(); act(async () => { const out = await api.patch(`/v1/places/pages/${enc(p.slug)}`, { summary: text.value }); p.summary = out.summary; el.textContent = out.summary; close(true); }); });
    return form;
  });
}

// ── People, photos ─────────────────────────────────────────────────────────

function peopleView(p) {
  const people = p.people || [];
  if (!people.length) return empty("Nobody has a study area here yet.", "Add this place to your study areas on your profile.");
  const mentors = people.filter((x) => x.mentor);
  const row = (x) => h("li", { class: "s-row" }, userChip(x.user), h("span", { class: "s-muted", text: `${x.area} · ${x.km} km` }),
    x.mentor ? h("span", { class: "s-vis", text: "Mentors" }) : null,
    x.mentor && store.me && x.user.handle !== store.me.user?.handle ? h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => mentoringRequestDialog(x.user) }, "Ask for mentoring") : null);
  return h("div", {},
    mentors.length ? [h("h2", { class: "s-h3", text: "Mentors who work here" }), h("ul", { class: "s-rows" }, mentors.map(row))] : null,
    h("h2", { class: "s-h3", text: "Everyone who studies here" }), h("ul", { class: "s-rows" }, people.map(row)));
}

function photosView(p) {
  const commons = h("div", { class: "s-gallery-grid" }, loading());
  api.get(`/v1/places/pages/${enc(p.slug)}/photos`).then((d) => {
    const items = d.items || [];
    put(clear(commons), items.length ? items.map((x) => h("figure", { class: "s-photo" },
      h("a", { href: x.page, target: "_blank", rel: "noopener noreferrer" }, h("img", { src: x.thumb, alt: x.title, loading: "lazy", decoding: "async" })),
      h("figcaption", {}, x.title, h("span", { class: "s-muted", text: ` · ${[x.author, x.licence].filter(Boolean).join(", ")}` }))))
      : h("p", { class: "s-muted", text: "No openly licensed photographs found near here." }));
  }).catch(() => put(clear(commons), h("p", { class: "s-muted", text: "Photos didn't load." })));
  return h("div", {},
    h("p", { class: "s-hint", text: "Openly licensed photographs from Wikimedia Commons, taken near this place: shown from Commons with their authors and licences, not copied here. Members' own photos are in their posts." }),
    commons,
    h("h2", { class: "s-h3", text: "From members' posts" }),
    pagedList((cursor) => api.get(`/v1/places/pages/${enc(p.slug)}/posts`, { kind: "observation", cursor }), postCard, { emptyTitle: "No field observations here yet." }));
}

/** For a study area: the place page covering it, or an offer to open one. */
export async function placeForArea(area) {
  const d = await api.get("/v1/places/pages", { near: `${area.location.lat},${area.location.lon}` });
  return (d.items || [])[0] || null;
}
