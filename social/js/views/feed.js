/** #/ — the feed, with tabs and filter chips; #/search — search results. */
import * as api from "../api.js?v=20261025-2a63c19";
import { store } from "../store.js?v=20261025-2a63c19";
import { h, clear, field, input, select, put } from "../dom.js?v=20261025-2a63c19";
import { KINDS, postCard, pagedList, userRow, kindLabel, followButton } from "../components.js?v=20261025-2a63c19";

const TABS = [
  ["following", "Following", "Posts from people, projects, tags, places and communities you follow."],
  ["discover", "Discover", "Recent public work, weighted by comments, forks and reactions — not by follower counts."],
  ["world", "Around the world", "Posts that carry a location."],
  ["research", "Research & methods", "Analyses, workflows, datasets, papers and monitors."],
  ["opportunities", "Opportunities", "Jobs, grants, events and challenges."],
];

export function render(root, { query }) {
  const signedIn = !!store.me;
  const tab = TABS.some(([id]) => id === query.tab) ? query.tab : (signedIn ? "following" : "discover");
  const kind = KINDS[query.kind] ? query.kind : "";
  const tag = String(query.tag || "").replace(/[^a-z0-9-]/gi, "").toLowerCase();

  const link = (changes) => {
    const q = new URLSearchParams({ tab, ...(kind ? { kind } : {}), ...(tag ? { tag } : {}), ...changes });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    return `#/?${q.toString()}`;
  };

  const tabs = h("nav", { class: "s-tabs", "aria-label": "Feed" },
    TABS.map(([id, label]) => h("a", { href: link({ tab: id }), class: id === tab ? "is-active" : "",
      "aria-current": id === tab ? "page" : null }, label)));
  const blurb = h("p", { class: "s-muted s-tab-blurb", text: TABS.find(([id]) => id === tab)[2] });

  const chips = h("div", { class: "s-chips", role: "group", "aria-labelledby": "s-rail-kinds" },
    h("a", { href: link({ kind: "" }), class: `s-chip${kind ? "" : " is-on"}`, "aria-current": kind ? null : "true" }, "All kinds"),
    Object.keys(KINDS).map((k) => h("a", { href: link({ kind: k }), class: `s-chip${k === kind ? " is-on" : ""}`,
      "aria-current": k === kind ? "true" : null }, kindLabel(k))));

  const tagBar = tag ? h("div", { class: "s-filter-on" },
    h("span", {}, "Tag: ", h("strong", {}, `#${tag}`)),
    followButton("tag", tag, false, "tag"),
    h("a", { href: link({ tag: "" }), class: "btn-ghost s-btn-sm" }, "Clear tag")) : null;

  let body;
  if (tab === "following" && !signedIn) {
    body = h("div", { class: "s-empty" },
      h("p", { class: "s-empty-title", text: "Sign in to see who you follow." }),
      h("p", { class: "s-muted", text: "Public posts are open to everyone under Discover." }),
      h("a", { class: "btn-ghost", href: link({ tab: "discover" }) }, "Browse Discover"));
  } else {
    body = pagedList(
      (cursor) => api.get("/v1/feed", { tab, kind, tag, cursor }),
      postCard,
      {
        emptyTitle: tab === "following" ? "Nothing from the people and topics you follow yet." : "No posts match.",
        emptyDetail: tab === "following" ? "Follow people, tags, places or communities, or look under Discover." : "Try another kind or clear the tag filter.",
      });
  }

  // Trending tags and the kind filters live in a rail on the right, so the
  // centre is the feed and nothing else. The rail sits in the margin the
  // centred column leaves (see .s-feed-layout), so on a wide screen the posts
  // stay exactly where they were; an earlier sidebar that took its width
  // from the column pushed them off-centre.
  const trending = h("nav", { class: "s-trending", "aria-label": "Tags this fortnight", hidden: true });
  api.get("/v1/tags/trending").then((data) => {
    const list = Array.isArray(data) ? data : data?.items || [];
    if (!list.length) return;
    trending.hidden = false;
    put(trending, h("h2", { class: "s-side-title", text: "Trending" }),
      h("div", { class: "s-trending-tags" },
        list.slice(0, 12).map((t) => h("a", { href: link({ tag: t.tag }), class: `s-tag-chip${t.tag === tag ? " is-on" : ""}` },
          `#${t.tag}`, h("span", { class: "s-tag-count" }, String(t.count))))));
  }).catch(() => {});

  const rail = h("aside", { class: "s-feed-rail", "aria-label": "Trending and filters" },
    trending,
    h("h2", { class: "s-side-title", id: "s-rail-kinds", text: "Filter by kind" }), chips);

  put(clear(root),
    h("div", { class: "s-feed-layout" },
      h("section", { class: "s-feed-col", "aria-label": "Feed" },
        h("h1", { class: "s-h1", text: "Feed" }), tabs, blurb,
        h("div", { class: "s-feed-stream" }, tagBar, body)),
      rail));
}

export function renderSearch(root, { query }) {
  const q = String(query.q || "");
  const type = ["posts", "people", "communities", "projects", "tags"].includes(query.type) ? query.type : "posts";
  const box = input("q", { value: q, type: "search", minlength: 2, required: true });
  const kind = select("type", [["posts", "Posts"], ["people", "People"], ["communities", "Communities"], ["projects", "Projects"], ["tags", "Tags"]], type);
  const form = h("form", { class: "s-inline-form", role: "search" }, field("Search", box), field("In", kind),
    h("button", { type: "submit", class: "btn-primary" }, "Search"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    location.hash = `#/search?q=${encodeURIComponent(box.value)}&type=${kind.value}`;
  });
  const results = h("div");
  if (q.length >= 2) {
    const renderItem = (it) => {
      if (type === "people") return h("ul", { class: "s-rows" }, userRow(it));
      if (type === "communities") return h("a", { class: "s-card s-link-card", href: `#/c/${encodeURIComponent(it.slug)}` }, h("strong", {}, it.name), h("span", { class: "s-muted" }, ` ${it.member_count || 0} members`));
      if (type === "projects") return h("a", { class: "s-card s-link-card", href: `#/p/${encodeURIComponent(it.id)}` }, h("strong", {}, it.title), h("span", { class: "s-muted" }, ` ${it.stage || ""}`));
      if (type === "tags") return h("a", { class: "s-chip", href: `#/?tab=discover&tag=${encodeURIComponent(it.tag)}` }, `#${it.tag} (${it.count})`);
      return postCard(it);
    };
    put(results, pagedList((cursor) => api.get("/v1/search", { q, type, cursor }), renderItem,
      { emptyTitle: `Nothing found for “${q}”.`, emptyDetail: "Search matches titles, names and tags you can see." }));
  } else if (q) {
    put(results, h("p", { class: "s-muted", text: "Type at least two characters." }));
  }
  put(clear(root), h("h1", { class: "s-h1", text: "Search" }), form, results);
}
