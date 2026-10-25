/**
 * The pieces every view draws: people, posts, the labels that say where a
 * claim came from, and the interaction bar. All of it built with h(), so all
 * user content is text.
 */
import { play } from "./sounds.js?v=20261025-158913d";
import * as api from "./api.js?v=20261025-158913d";
import { store, myHandle, refreshMe } from "./store.js?v=20261025-158913d";
import {
  h, clear, ago, timeEl, toast, modal, copyText, field, select, input, textarea,
  extLink, empty, errorBox, loading, busy, confirmDialog, put,
} from "./dom.js?v=20261025-158913d";
import { topicOf } from "./topics.js?v=20261025-158913d";
import { cardPreview } from "./embed.js?v=20261025-158913d";

// ── Vocabulary (CONTRACT.md enumerations) ──────────────────────────────────

export const KINDS = {
  text: { label: "Post", help: "A short update or note." },
  scene: { label: "3D scene", help: "A GeoHUB view others can open: world, camera, layers and annotations." },
  analysis: { label: "Analysis", help: "A result with before/after and stated uncertainty." },
  monitor: { label: "Monitor", help: "A time series you keep updating; followers are told when it changes." },
  observation: { label: "Field observation", help: "Something seen or measured in the field. Others can confirm or dispute it." },
  workflow: { label: "Workflow", help: "A reproducible method: repository, inputs, outputs, version." },
  dataset: { label: "Dataset", help: "Data you are sharing, with a licence and a DOI if it has one." },
  paper: { label: "Paper", help: "A published or preprint paper." },
  question: { label: "Question", help: "Ask for advice. You can accept the answer that solved it." },
  discussion: { label: "Discussion", help: "Open a thread for debate or ideas." },
  event: { label: "Event", help: "A webinar, seminar, workshop, field course or hackathon." },
  opportunity: { label: "Opportunity", help: "A job, grant, studentship, fellowship or other opening." },
  challenge: { label: "Challenge", help: "A problem for the community to solve. Sponsors are always shown." },
  model: { label: "Model", help: "A GeoHUB model setup — mesher, domain, solver and parameters — others can open and rerun." },
  repo: { label: "Repository", help: "A code repository: what it does, its language and licence." },
};

export const PROVENANCE = {
  observed: { label: "Observed", help: "Measured or seen directly." },
  derived: { label: "Derived", help: "Calculated from observed data." },
  modelled: { label: "Modelled", help: "The output of a model, not a measurement." },
  forecast: { label: "Forecast", help: "A prediction of what may happen." },
  ai: { label: "AI-generated", help: "Produced or substantially written by an AI system." },
  unverified: { label: "Unverified", help: "Not checked; treat with care." },
};

export const LICENCES = [
  ["CC-BY-4.0", "CC BY 4.0 — reuse with credit"],
  ["CC-BY-SA-4.0", "CC BY-SA 4.0 — reuse with credit, share alike"],
  ["CC0-1.0", "CC0 1.0 — public domain"],
  ["MIT", "MIT (code)"],
  ["Apache-2.0", "Apache 2.0 (code)"],
  ["all-rights-reserved", "All rights reserved"],
];

export const VISIBILITY = {
  public: "Public",
  unlisted: "Unlisted — anyone with the link",
  followers: "Followers only",
  team: "A team",
  community: "A community",
  project: "People on a project",
  private: "Only me",
};

export const OPP_TYPES = ["job", "grant", "fellowship", "internship", "studentship", "project",
  "consultancy", "expedition", "hackathon", "expertise", "service"];
export const EVENT_FORMATS = ["webinar", "seminar", "workshop", "hackathon", "field-course", "poster-session"];
export const REACTIONS = [
  ["like", "Like"], ["insightful", "Insightful"], ["reproduced", "Reproduced it"], ["useful", "Useful"],
];
export const WORLDS = ["earth", "moon", "mars", "mercury", "venus", "jupiter", "saturn", "uranus", "neptune", "pluto"];
export const ROLES = ["viewer", "commenter", "forker", "editor"];

export const kindLabel = (k) => KINDS[k]?.label || k || "Post";

// ── Sign-in gate ───────────────────────────────────────────────────────────

/** True if signed in; otherwise explains and offers sign-in, and returns false. */
export function requireSignIn(what = "do that") {
  if (store.me) return true;
  modal("Sign in to continue", (close) => {
    const configured = api.authConfigured();
    return h("div", {},
      h("p", { text: `You can read public posts without an account. Sign in with your GeoID to ${what}.` }),
      configured ? null : h("p", { class: "s-muted", text: "Sign-in is not available on this deployment yet." }),
      h("div", { class: "s-actions" },
        configured ? h("a", { class: "btn-primary", href: api.signInUrl() }, "Sign in") : null,
        h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Not now")));
  });
  return false;
}

/** Wrap an action: sign-in gate, then errors become toasts that say what happened. */
export async function act(fn, what) {
  if (!requireSignIn(what)) return undefined;
  try {
    return await fn();
  } catch (error) {
    if (error.status === 401) { await refreshMe(); requireSignIn(what); return undefined; }
    toast(error.message || "That did not work.", "error");
    return undefined;
  }
}

// ── People ─────────────────────────────────────────────────────────────────

export function avatar(user, size = 36) {
  const name = user?.name || user?.handle || "?";
  if (user?.avatar) {
    return h("img", { class: "s-avatar", src: user.avatar, alt: "", width: size, height: size, loading: "lazy" });
  }
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return h("span", { class: "s-avatar s-avatar-txt", "aria-hidden": "true", style: `width:${size}px;height:${size}px` }, initials);
}

export function userChip(user, { sub = true } = {}) {
  if (!user) return h("span", { class: "s-muted", text: "Deleted account" });
  return h("a", { class: "s-user", href: `#/u/${encodeURIComponent(user.handle)}` },
    avatar(user),
    h("span", { class: "s-user-text" },
      h("span", { class: "s-user-name" }, user.name || user.handle,
        user.orcid_verified ? h("span", { class: "s-tick", title: "ORCID verified", "aria-label": "ORCID verified" }, " ✓") : null),
      sub ? h("span", { class: "s-user-sub" }, `@${user.handle}`, user.headline ? ` · ${user.headline}` : "") : null,
      sub && user.affiliation ? affiliationInline(user.affiliation) : null));
}

/**
 * A member's affiliation (identity track). Verified = their sign-in address
 * belongs to a verified organisation's domain; otherwise it is self-declared
 * and drawn with the dashed self-declared style. Plain spans, because a chip
 * is already a link.
 */
export function affiliationInline(aff) {
  if (!aff) return null;
  return aff.verified
    ? h("span", { class: "s-aff-inline is-verified", title: `Verified affiliation · ${aff.name}` }, "✓ ", aff.name)
    : h("span", { class: "s-aff-inline", title: `Self-declared affiliation · ${aff.name}` }, aff.name);
}

/** The long form, for a profile header or a person card: links to the organisation. */
export function affiliationBadge(aff) {
  if (!aff) return null;
  return h("a", { class: `s-aff${aff.verified ? " is-verified" : ""}`, href: `#/o/${encodeURIComponent(aff.slug)}`,
    title: aff.verified ? "Their sign-in address belongs to this verified organisation" : "Self-declared: not checked" },
  aff.verified ? `✓ Verified affiliation · ${aff.name}` : `Affiliated · ${aff.name} (self-declared)`);
}

/** "Open to mentoring", with topics when given. */
export function mentoringBadge(user, topics) {
  if (!user?.mentoring) return null;
  const list = topics || user.mentoring_topics || [];
  return h("span", { class: "s-mentor", title: "Takes mentoring requests" }, list.length ? `Open to mentoring · ${list.slice(0, 4).join(", ")}` : "Open to mentoring");
}

export function userRow(user, extra) {
  return h("li", { class: "s-row" }, userChip(user), extra || null);
}

// ── Labels ─────────────────────────────────────────────────────────────────

/**
 * Kinds that make no claim about the world -- a job, an event, a question --
 * carry no provenance label. The Worker still stores its default, and an
 * "Observed" badge on a PhD advert reads as nonsense.
 */
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const NO_PROVENANCE_KINDS = ["text", "opportunity", "event", "question", "discussion", "challenge", "repo"];
export const hasProvenance = (kind) => !NO_PROVENANCE_KINDS.includes(kind);

export function provenanceBadge(p) {
  const info = PROVENANCE[p];
  if (!info) return h("span", { class: "s-prov s-prov-none", title: "The author has not said where this came from." }, "Provenance not stated");
  return h("span", { class: `s-prov s-prov-${p}`, title: info.help }, info.label);
}

export function kindBadge(kind) {
  return h("span", { class: "s-kind", text: kindLabel(kind) });
}

export function verificationBadge(v) {
  if (!v) return null;
  const label = v.status === "community-verified" ? "Community-verified"
    : v.status === "disputed" ? "Disputed" : "Not yet verified";
  return h("span", { class: `s-verif s-verif-${v.status || "unverified"}`,
    title: `${v.confirms || 0} confirm · ${v.disputes || 0} dispute` }, `${label} (${v.confirms || 0}/${v.disputes || 0})`);
}

export function tagList(tags) {
  if (!Array.isArray(tags) || !tags.length) return null;
  return h("ul", { class: "s-tags", "aria-label": "Tags" },
    tags.map((t) => h("li", {}, h("a", { href: `#/?tab=discover&tag=${encodeURIComponent(t)}` }, `#${t}`))));
}

function placeText(loc) {
  if (!loc) return null;
  const where = loc.place || `${Number(loc.lat).toFixed(loc.precision === "region" ? 0 : 1)}, ${Number(loc.lon).toFixed(loc.precision === "region" ? 0 : 1)}`;
  const note = loc.precision === "region" ? " (region)" : loc.precision === "approx" ? " (approximate)" : "";
  return h("span", { class: "s-place" }, `📍 ${where}${note}`);
}

// ── Posts ──────────────────────────────────────────────────────────────────

export function postCard(p) {
  const title = p.title || (p.body || "").slice(0, 90) || "(untitled)";
  const rs = p.reshared_by;
  const topic = topicOf(p);
  const card = h("article", { class: `s-card s-post-card${rs ? " is-reshare" : ""}`, "aria-labelledby": `pt-${p.id}`,
    "data-topic": topic?.id || null },
    rs ? h("p", { class: "s-reshared" },
      h("span", { "aria-hidden": "true" }, "↻ "),
      h("a", { href: `#/u/${encodeURIComponent(rs.user.handle)}` }, rs.user.name || `@${rs.user.handle}`), " reshared",
      rs.note ? h("q", { class: "s-reshare-note" }, rs.note) : null) : null,
    h("header", { class: "s-card-head" },
      userChip(p.author),
      h("span", { class: "s-card-meta" }, timeEl(p.created_at))),
    h("div", { class: "s-labels" },
      kindBadge(p.kind),
      // The field in words beside its colour: the outline is never the only cue.
      topic ? h("span", { class: "s-topic", text: topic.label }) : null,
      hasProvenance(p.kind) ? provenanceBadge(p.provenance) : null,
      p.kind === "observation" ? verificationBadge(p.verification) : null,
      p.visibility && p.visibility !== "public" ? h("span", { class: "s-vis", text: VISIBILITY[p.visibility]?.split(" —")[0] || p.visibility }) : null,
      p.sponsored_by ? h("span", { class: "s-sponsor", text: `Sponsored by ${p.sponsored_by}` }) : null,
      importedBadge(p),
      p.org ? h("a", { class: "s-org-label", href: `#/o/${encodeURIComponent(p.org.slug)}`, title: "Posted by an admin of this organisation" }, `Posted as ${p.org.name}`) : null,
      p.pinned ? h("span", { class: "s-vis", text: "Pinned" }) : null,
      p.forked_from ? h("span", { class: "s-vis", text: "Fork" }) : null),
    h("h3", { class: "s-card-title", id: `pt-${p.id}` }, h("a", { href: `#/post/${encodeURIComponent(p.id)}` }, title)),
    p.body && p.title ? h("p", { class: "s-card-body" }, p.body.slice(0, 400)) : null,
    cardPreview(p),
    kindSummary(p),
    h("footer", { class: "s-card-foot" },
      placeText(p.location),
      tagList(p.tags),
      cardStats(p)));
  if (topic) card.style.setProperty("--topic-rgb", topic.rgb);
  return card;
}

/**
 * Line icons for the card's stats: 16 px, stroked in currentColor, built with
 * createElementNS (h() makes HTML elements, and there is no innerHTML here).
 */
const ICONS = {
  react: ["M12 20.5s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1z"],
  comment: ["M4.5 5.5h15v10h-8l-4.5 3.5v-3.5h-2.5z"],
  reshare: ["M7 7.5h10.5l-2.5-2.5", "M17 16.5H6.5l2.5 2.5", "M17.5 7.5v4", "M6.5 16.5v-4"],
  send: ["M20 4 9.5 14.5", "M20 4l-6.5 16-4-5.5-5.5-4z"],
  fork: ["M7 4.5v6a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-6", "M12 13.5v6"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
};
const SVG_NS = "http://www.w3.org/2000/svg";
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor",
    "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "s-ico" })) {
    svg.setAttribute(k, v);
  }
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** One stat: icon and number, with the words for screen readers and on hover. */
function stat(name, n, words, href) {
  const label = plural(n, words);
  const kids = [icon(name), h("span", { class: "s-stat-n", text: String(n) })];
  return href
    ? h("a", { class: "s-stat", href, title: label, "aria-label": label }, ...kids)
    : h("span", { class: "s-stat", title: label, "aria-label": label, role: "img" }, ...kids);
}

/**
 * Bottom-right of every card: reactions, comments, reshares (the toggle, when
 * you may reshare), forks and "answered" when there are any, then Send.
 */
function cardStats(p) {
  const c = p.counts || {};
  const href = `#/post/${encodeURIComponent(p.id)}`;
  const answer = p.kind === "question" ? "answer" : "comment";
  const reshares = c.reposts || 0;
  const toggle = store.me ? reshareButton(p, { compact: true, count: reshares }) : null;
  const send = store.me ? h("button", { type: "button", class: "s-stat s-stat-btn", title: "Send this post to someone", "aria-label": "Send this post to someone" }, icon("send")) : null;
  send?.addEventListener("click", () => sendPostDialog(p));
  return h("span", { class: "s-stats" },
    stat("react", c.reactions || 0, "reaction", href),
    stat("comment", c.comments || 0, answer, `${href}?focus=comments`),
    toggle || stat("reshare", reshares, "reshare"),
    c.forks ? stat("fork", c.forks, "fork") : null,
    p.accepted_comment_id ? h("span", { class: "s-stat is-answered", title: "Answered", "aria-label": "Answered", role: "img" }, icon("check")) : null,
    send);
}

/**
 * Pass a post on. Reshare puts it in your followers' feeds (public posts
 * only -- the Worker refuses the rest, and the button is not offered);
 * "Quote" adds a line of your own; "Send" puts it in one person's messages.
 */
export function reshareButton(p, { compact = false, count = null } = {}) {
  if (p.visibility !== "public" || (store.me && p.author?.handle === myHandle())) return null;
  let on = !!p.viewer?.reshared;
  // On a card it is an icon stat: the count, lit when you have reshared it.
  const iconic = count != null;
  const num = iconic ? h("span", { class: "s-stat-n", text: String(count) }) : null;
  const btn = h("button", { type: "button", class: iconic ? "s-stat s-stat-btn" : compact ? "s-mini-act" : "s-act", "aria-pressed": String(on),
    title: "Show this post to the people who follow you" }, ...(iconic ? [icon("reshare"), num] : [on ? "Reshared" : "Reshare"]));
  const draw = () => {
    if (iconic) btn.setAttribute("aria-label", `${plural(count, "reshare")}${on ? ", reshared by you" : ""}. Reshare to your followers`);
    else btn.textContent = on ? "Reshared" : "Reshare";
    btn.setAttribute("aria-pressed", String(on));
  };
  draw();
  btn.addEventListener("click", () => act(async () => {
    const out = on ? await api.del(`/v1/posts/${encodeURIComponent(p.id)}/repost`, {})
      : await api.post(`/v1/posts/${encodeURIComponent(p.id)}/repost`, {});
    const was = on;
    on = !!out.reshared;
    if (iconic) { count = Math.max(0, count + (on ? 1 : 0) - (was ? 1 : 0)); num.textContent = String(count); }
    draw();
    if (on) play("tick");
    toast(on ? "Reshared to your followers." : "Reshare removed.");
  }, "reshare posts"));
  return btn;
}

export function quoteDialog(p) {
  if (!requireSignIn("reshare posts")) return;
  modal("Reshare with a comment", (close) => {
    const note = textarea("note", { rows: 3, maxlength: 500, required: true, placeholder: "Why it's worth a look" });
    const form = h("form", {},
      h("p", { class: "s-hint", text: `Your followers see “${(p.title || "this post").slice(0, 80)}” with your comment above it.` }),
      field("Your comment", note),
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Reshare"),
        h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      try {
        await api.post(`/v1/posts/${encodeURIComponent(p.id)}/repost`, { note: note.value });
        close(true); toast("Reshared with your comment.");
      } catch (error) { toast(error.message, "error"); done(); }
    });
    return form;
  });
}

export function sendPostDialog(p) {
  messageDialog([], "Send this post", {
    body: `${p.title || "A post on GeoID Network"}\n${postUrl(p.id)}`,
    stay: true,
    hint: "It arrives in their messages with a link to the post. Add a line of your own if you like.",
  });
}

/**
 * Where "Open in GeoHUB" goes, or null when GeoHUB has nothing to open.
 *
 * Only scenes and models: every post carries a world (earth by default), so
 * testing `p.world` put the button on job adverts. A model opens its own page
 * (meta.page, a site path the Worker has already checked) with ?post=.
 */
export function geohubHref(p) {
  // "/" is a real page here: Earth's model builder lives in the GeoHUB shell.
  // "//host" is not -- that would leave the site.
  if (p.kind === "model" && p.meta?.page && (p.meta.page === "/" || /^\/[^/]/.test(p.meta.page))) {
    return `${p.meta.page}${p.meta.page.includes("?") ? "&" : "?"}post=${encodeURIComponent(p.id)}`;
  }
  if (p.kind === "scene" || p.scene) {
    return `/?world=${encodeURIComponent(p.scene?.world || p.world || "earth")}&post=${encodeURIComponent(p.id)}`;
  }
  return null;
}

/** One line of the kind-specific facts, for a card. */
function kindSummary(p) {
  const m = p.meta || {};
  const bits = [];
  if (p.kind === "opportunity") {
    if (m.type) bits.push(m.type);
    if (m.org) bits.push(m.org);
    if (m.deadline) bits.push(`deadline ${new Date(m.deadline * 1000).toLocaleDateString()}`);
    if (m.paid === true) bits.push("paid"); else if (m.paid === false) bits.push("unpaid");
  } else if (p.kind === "event") {
    if (m.format) bits.push(m.format);
    if (m.starts_at) bits.push(new Date(m.starts_at * 1000).toLocaleString());
    if (m.where) bits.push(m.where);
  } else if (p.kind === "paper") {
    if (m.journal) bits.push(m.journal);
    if (m.year) bits.push(String(m.year));
  } else if (p.kind === "model") {
    bits.push(m.mesher === "blender" ? "Blender mesh" : "gmsh mesh");
    if (m.solver) bits.push(m.solver);
    if (m.domain?.world) bits.push(m.domain.world);
  } else if (p.kind === "repo") {
    if (m.host && m.host !== "other") bits.push(m.host);
    if (m.language) bits.push(m.language);
    if (m.licence) bits.push(m.licence);
  } else if (p.kind === "scene" && p.scene) {
    bits.push(`${p.scene.world || p.world || "earth"} · ${(p.scene.layers || []).length} layers`);
  }
  return bits.length ? h("p", { class: "s-card-facts", text: bits.join(" · ") }) : null;
}

/** A list of posts with "Load more", from any list endpoint that pages by cursor. */
export function pagedList(fetchPage, renderItem, { emptyTitle = "Nothing here yet.", emptyDetail = "", listClass = "s-list" } = {}) {
  const wrap = h("div", { class: "s-paged" });
  const list = h("div", { class: listClass });
  const more = h("button", { type: "button", class: "btn-ghost s-more", hidden: true }, "Load more");
  let cursor = null;
  const load = async (first) => {
    more.disabled = true;
    if (first) { clear(list); put(list, loading()); }
    try {
      const data = await fetchPage(cursor);
      if (first) clear(list);
      const items = data?.items || [];
      if (first && !items.length) put(list, empty(emptyTitle, emptyDetail));
      items.forEach((it) => put(list, renderItem(it)));
      cursor = data?.next || null;
      more.hidden = !cursor;
    } catch (error) {
      if (first) clear(list);
      put(list, errorBox(error, () => load(first)));
    }
    more.disabled = false;
  };
  more.addEventListener("click", () => load(false));
  put(wrap, list, more);
  load(true);
  return wrap;
}

// ── Follow ─────────────────────────────────────────────────────────────────

export function followButton(type, id, following, label = "") {
  let on = !!following;
  const btn = h("button", { type: "button", class: "btn-ghost s-btn-sm", "aria-pressed": String(on) });
  const draw = () => { btn.textContent = on ? `Following${label ? ` ${label}` : ""}` : `Follow${label ? ` ${label}` : ""}`; btn.setAttribute("aria-pressed", String(on)); };
  draw();
  btn.addEventListener("click", () => act(async () => {
    if (on) await api.del("/v1/follow", { type, id }); else await api.post("/v1/follow", { type, id });
    on = !on; draw();
  }, "follow"));
  return btn;
}

// ── Report ─────────────────────────────────────────────────────────────────

export function reportDialog(targetType, targetId, kind = "report") {
  if (!requireSignIn("report content")) return;
  modal(kind === "appeal" ? "Appeal" : "Report to moderators", (close) => {
    const reason = select("reason", [
      ["spam", "Spam or advertising"], ["harassment", "Harassment or abuse"],
      ["misinformation", "Misleading or false claims"], ["privacy", "Reveals private information or a sensitive location"],
      ["copyright", "Copyright or licence breach"], ["other", "Something else"],
    ]);
    const note = textarea("note", { rows: 3, maxlength: 1000 });
    const form = h("form", {},
      field("Reason", reason),
      field("What should moderators know?", note, "Optional. Moderators see the content and this note; the author is not told who reported."),
      h("div", { class: "s-actions" },
        h("button", { type: "submit", class: "btn-primary" }, "Send report"),
        h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      try {
        await api.post("/v1/reports", { target_type: targetType, target_id: targetId, reason: reason.value, note: note.value, kind });
        toast("Sent to the moderators. Thank you.");
        close(true);
      } catch (error) { toast(error.message, "error"); done(); }
    });
    return form;
  });
}

// ── Messages ───────────────────────────────────────────────────────────────

export function messageDialog(handles, title = "New message", { body: initial = "", stay = false, hint = "" } = {}) {
  if (!requireSignIn("send messages")) return;
  modal(title, (close) => {
    const to = input("to", { value: handles.join(", "), required: true, autocomplete: "off", placeholder: "handle, or several separated by commas" });
    const body = textarea("body", { rows: 4, required: true, maxlength: 5000, value: initial });
    const form = h("form", {},
      hint ? h("p", { class: "s-hint", text: hint }) : null,
      field("To (handles, comma-separated)", to),
      field("Message", body, "If they only take messages from people they follow, this arrives as a request they can accept."),
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Send"),
        h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      try {
        const list = to.value.split(",").map((s) => s.trim().replace(/^@/, "")).filter(Boolean);
        const conv = await api.post("/v1/conversations", { handles: list, body: body.value });
        close(true);
        toast("Sent.");
        if (conv?.id && !stay) location.hash = `#/messages/${encodeURIComponent(conv.id)}`;
      } catch (error) { toast(error.message, "error"); done(); }
    });
    return form;
  });
}

// ── Share / cite ───────────────────────────────────────────────────────────

export async function share(url, title) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; } catch (error) { if (error?.name === "AbortError") return; }
  }
  copyText(url, "Link copied");
}

export function postUrl(id) {
  return `${location.origin}/social/#/post/${encodeURIComponent(id)}`;
}

/**
 * The Worker's share page for a public post (p), org (o), community (c) or
 * opted-in profile (u): a real URL with a title, summary and card that link
 * unfurlers can read, which then sends a person on into the app.
 */
export function sharePageUrl(kind, id) {
  return `${api.base()}/s/${kind}/${encodeURIComponent(id)}`;
}

export async function citeDialog(id) {
  let data;
  try { data = await api.get(`/v1/posts/${encodeURIComponent(id)}/cite`); } catch (error) { toast(error.message, "error"); return; }
  modal("Cite this", () => h("div", {},
    h("p", { class: "s-label", text: "Reference" }),
    h("pre", { class: "s-pre" }, data.text || ""),
    h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => copyText(data.text || "") }, "Copy reference"),
    h("p", { class: "s-label", text: "BibTeX" }),
    h("pre", { class: "s-pre" }, data.bibtex || ""),
    h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => copyText(data.bibtex || "") }, "Copy BibTeX")), { wide: true });
}

/** Bookmark into a named collection. */
export function bookmarkDialog(id, onDone) {
  if (!requireSignIn("save posts")) return;
  modal("Save to a collection", (close) => {
    const col = input("collection", { value: "Saved", maxlength: 60, list: "s-collections" });
    const form = h("form", {},
      field("Collection", col, "Collections are private to you."),
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Save"),
        h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api.post(`/v1/posts/${encodeURIComponent(id)}/bookmark`, { collection: col.value || "Saved" });
        toast(`Saved to “${col.value || "Saved"}”.`);
        close(true); onDone?.(true);
      } catch (error) { toast(error.message, "error"); }
    });
    return form;
  });
}

/** Show loading, run load(), then render(data) -- or an error with a retry. */
export function loadingThen(container, load, render) {
  put(clear(container), loading());
  return load().then((data) => { clear(container); render(data); },
    (error) => { put(clear(container), errorBox(error, () => loadingThen(container, load, render))); });
}

export { myHandle, ago, extLink, confirmDialog };

/** "Imported from BGS careers": the source is credited on every imported post. */
export function importedBadge(p) {
  if (!p.meta?.imported) return null;
  const name = p.meta.source_name || p.meta.org || "an external listing";
  return p.meta.source_url
    ? h("a", { class: "s-vis s-imported", href: p.meta.source_url, target: "_blank", rel: "noopener noreferrer", title: "Gathered automatically. The original listing is the authority." }, `Imported from ${name}`)
    : h("span", { class: "s-vis s-imported", text: `Imported from ${name}` });
}

