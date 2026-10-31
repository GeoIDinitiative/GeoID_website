/** #/post/:id — one post in full, its provenance, the interaction bar and the thread. */
import { play } from "../sounds.js?v=20261031-ae330eb";
import * as api from "../api.js?v=20261031-ae330eb";
import { store, myHandle } from "../store.js?v=20261031-ae330eb";
import {
  h, clear, timeEl, toast, modal, field, select, textarea, busy, extLink, errorBox, loading,
  confirmDialog, empty, dateText, put,
} from "../dom.js?v=20261031-ae330eb";
import {
  userChip, kindBadge, provenanceBadge, hasProvenance, verificationBadge, geohubHref, tagList, REACTIONS, LICENCES, VISIBILITY,
  PROVENANCE, act, requireSignIn, followButton, reportDialog, share, postUrl, sharePageUrl, importedBadge, citeDialog, bookmarkDialog,
  reshareButton, quoteDialog, sendPostDialog,
  postCard, kindLabel,
} from "../components.js?v=20261031-ae330eb";
import { compareSlider, resolveImageRef, timeChart, measurementsBlock, gallery } from "../rich.js?v=20261031-ae330eb";
import { parseVideoLink, videoEmbed } from "../embed.js?v=20261031-ae330eb";
import { eventPanel } from "./opportunities.js?v=20261031-ae330eb";
import { linkCard } from "../files.js?v=20261031-ae330eb";
import * as device from "../device.js?v=20261031-ae330eb";

export async function render(root, { params, query }) {
  const id = params.id;
  put(clear(root), loading());
  let p;
  try { p = await api.get(`/v1/posts/${encodeURIComponent(id)}`); } catch (error) {
    put(clear(root), errorBox(error, () => render(root, { params })));
    return;
  }
  document.title = `${p.title || kindLabel(p.kind)} — GeoID Network`;
  const mine = !!store.me && p.author?.handle === myHandle();
  const comments = h("section", { class: "s-thread", "aria-labelledby": "thread-h" });
  put(clear(root),
    h("article", { class: "s-post-full" },
      h("header", { class: "s-post-head" },
        h("div", { class: "s-labels" }, kindBadge(p.kind), hasProvenance(p.kind) ? provenanceBadge(p.provenance) : null,
          p.kind === "observation" ? verificationBadge(p.verification) : null,
          p.visibility !== "public" ? h("span", { class: "s-vis", text: VISIBILITY[p.visibility] || p.visibility }) : null,
          p.sponsored_by ? h("span", { class: "s-sponsor", text: `Sponsored by ${p.sponsored_by}` }) : null,
          p.kind === "opportunity" && p.org?.verified ? h("span", { class: "s-verified", title: "Posted by a verified organisation on GeoID Network", text: `Verified employer · ${p.org.name}` }) : null,
          importedBadge(p),
          p.forked_from ? h("a", { class: "s-vis", href: `#/post/${encodeURIComponent(p.forked_from)}` }, "Forked from another post") : null),
        h("h1", { class: "s-h1", text: p.title || kindLabel(p.kind) }),
        h("div", { class: "s-byline" }, userChip(p.author),
          h("span", { class: "s-muted" }, timeEl(p.created_at, true),
            p.updated_at && p.updated_at > p.created_at + 60 ? h("span", {}, " · edited ", timeEl(p.updated_at)) : null),
          store.me && !mine && p.author ? followButton("user", p.author.handle, p.viewer?.following_author, "author") : null)),
      p.held && mine ? h("p", { class: "s-banner s-held" }, h("strong", { text: "Waiting for a moderator. " }),
        `Only you can see this opportunity until it is checked (${p.held.reasons}). Most are checked within a day.`) : null,
      body(p),
      mediaBlock(p),
      kindBlock(p),
      sceneBlock(p), modelBlock(p), repoBlock(p),
      p.location ? h("p", { class: "s-place" }, `📍 ${p.location.place || `${p.location.lat}, ${p.location.lon}`} — shown ${p.location.precision === "exact" ? "exactly" : p.location.precision === "approx" ? "to about 11 km" : "to about 110 km"}`) : null,
      tagList(p.tags),
      provenanceBlock(p),
      p.kind === "observation" ? verifyBlock(p, mine) : null,
      actionBar(p, mine, () => comments.querySelector("textarea")?.focus())),
    comments);
  loadComments(comments, p, mine);
  // A view, once per post per tab session (the server counts each reader once a day, never the author).
  try {
    const k = `geoid:seen:${p.id}`;
    if (store.me && !mine && !sessionStorage.getItem(k)) { sessionStorage.setItem(k, "1"); api.post(`/v1/posts/${encodeURIComponent(p.id)}/seen`, {}).catch(() => {}); }
  } catch (error) { /* storage off: the count can miss a view */ }
  // The author's reach sits inside the post, under its actions, where it lines up with the post itself.
  if (mine) root.querySelector(".s-post-full")?.append(reachPanel(p));
  // A card's comment count links here with ?focus=comments: land on the thread
  // (after the router's own scroll to the top).
  if (query?.focus === "comments") setTimeout(() => comments.scrollIntoView({ block: "start" }), 0);
  // Collaboration track: RSVP, calendar and posters sit just above the thread.
  if (p.kind === "event") comments.before(eventPanel(p));
  if (p.counts?.forks) {
    const forks = h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Forks" }));
    put(root, forks);
    api.get(`/v1/posts/${encodeURIComponent(p.id)}/forks`).then((d) => {
      const items = d?.items || [];
      put(forks, items.length ? h("div", { class: "s-list" }, items.map(postCard)) : h("p", { class: "s-muted", text: "Forks are not visible to you." }));
    }).catch(() => forks.remove());
  }
}

function body(p) {
  const paras = String(p.body || "").split(/\n{2,}/).filter((s) => s.trim());
  const prose = h("div", { class: "s-prose" }, paras.map((t) => h("p", {}, t)));
  return h("div", {}, prose, translateBar(p, prose));
}

/**
 * Translate a post written in another language: on the device where the
 * browser can (nothing leaves it), else a link the reader may choose to
 * follow (public posts only).
 */
function translateBar(p, prose) {
  const text = [p.title, p.body].filter(Boolean).join("\n\n");
  const bar = h("div", { class: "s-translate", hidden: true });
  if (text.trim().length < 20) return bar;
  const to = device.readerLanguage();
  device.detectLanguage(text).then((from) => {
    // Without an on-device detector, offer it only where the text is plainly not in the reader's script.
    const foreign = from ? from !== to : (to === "en" && /[^\u0000-\u024f\s\d\p{P}]/u.test(text));
    if (!foreign) return;
    bar.hidden = false;
    const btn = h("button", { type: "button", class: "s-link-btn" }, "Translate");
    let shown = false;
    let original = null;
    btn.addEventListener("click", async () => {
      if (shown) { prose.replaceWith(original); prose = original; shown = false; btn.textContent = "Translate"; return; }
      btn.disabled = true; btn.textContent = "Translating…";
      const out = await device.translate(p.body || "", from, to);
      btn.disabled = false;
      if (out == null) {
        btn.textContent = "Translate";
        if (p.visibility === "public") window.open(device.translateOutLink(p.body || "", to), "_blank", "noopener");
        else toast("This browser can't translate on the device.", "error");
        return;
      }
      original = prose;
      const translated = h("div", { class: "s-prose s-translated" }, out.split(/\n{2,}/).filter((t) => t.trim()).map((t) => h("p", {}, t)),
        h("p", { class: "s-hint", text: `Translated on this device from ${from}. Check anything that matters against the original.` }));
      prose.replaceWith(translated);
      prose = translated;
      shown = true; btn.textContent = "Show the original";
    });
    put(bar, btn);
  });
  return bar;
}

/**
 * The post's images as a gallery with a lightbox, its other files with
 * previews, and its links as cards (files kept on Dropbox, OSF...). An
 * analysis whose before/after pair is drawn as the comparison slider leaves
 * those two out here, so the same picture is not shown twice.
 */
function mediaBlock(p) {
  const pair = analysisPair(p);
  const files = p.media?.length ? gallery(p.media, { exclude: pair ? [p.meta.before, p.meta.after] : [] }) : null;
  // Links: YouTube and Vimeo play here (click to load); the rest are listed.
  const links = (p.links || []).filter((l) => l?.url);
  const videos = links.map((l) => ({ l, v: parseVideoLink(l.url) })).filter((x) => x.v);
  const others = links.filter((l) => !parseVideoLink(l.url));
  if (!files && !videos.length && !others.length) return null;
  return h("div", {}, files, videos.map(({ v }) => videoEmbed(v, { title: p.title })),
    others.length ? h("div", { class: "s-linkcards" }, others.map(linkCard)) : null);
}

/** Both sides of an analysis's before/after, when both are images it can draw. */
function analysisPair(p) {
  if (p.kind !== "analysis") return null;
  const m = p.meta || {};
  const before = resolveImageRef(m.before, p.media || []);
  const after = resolveImageRef(m.after, p.media || []);
  return before && after ? { before, after } : null;
}

function analysisBlock(p) {
  const m = p.meta || {};
  const pair = analysisPair(p);
  const text = (ref, label) => (ref && !resolveImageRef(ref, p.media || []) ? [label, ref] : [label, null]);
  return h("div", {},
    pair ? compareSlider({
      before: pair.before, after: pair.after,
      beforeLabel: m.before_label || "Before", afterLabel: m.after_label || "After",
      beforeDate: m.before_date, afterDate: m.after_date,
    }) : null,
    // A layer id (or a pair with only one image) is still worth naming.
    dl([text(m.before, m.before_label || "Before"), text(m.after, m.after_label || "After"),
      ["Uncertainty", m.uncertainty]]));
}

function dl(rows) {
  const items = rows.filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length));
  if (!items.length) return null;
  return h("dl", { class: "s-dl" }, items.map(([k, v]) => [h("dt", { text: k }), h("dd", {}, v)]));
}

function kindBlock(p) {
  const m = p.meta || {};
  const doi = (d) => (d ? extLink(`https://doi.org/${String(d).replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}`, d) : null);
  switch (p.kind) {
    case "analysis": return analysisBlock(p);
    case "monitor": return timeChart(m.series, { updatedAt: m.updated_at });
    case "observation": return measurementsBlock(m.measurements);
    case "workflow": case "dataset":
      return dl([["Repository", m.repo ? extLink(m.repo) : null], ["Inputs", m.inputs], ["Outputs", m.outputs], ["Version", m.version], ["DOI", doi(m.doi)]]);
    case "paper":
      return dl([["Authors", Array.isArray(m.authors) ? m.authors.join(", ") : m.authors], ["Journal", m.journal], ["Year", m.year ? String(m.year) : null], ["DOI", doi(m.doi)]]);
    case "event":
      return dl([["Format", m.format], ["Starts", m.starts_at ? dateText(m.starts_at, true) : null], ["Ends", m.ends_at ? dateText(m.ends_at, true) : null], ["Where", m.where], ["Link", m.url ? extLink(m.url) : null]]);
    case "opportunity":
      return dl([["Type", m.type], ["Organisation", m.org], ["Deadline", m.deadline ? dateText(m.deadline) : null],
        ["Skills", (m.skills || []).join(", ")], ["Paid", m.paid === true ? "Yes" : m.paid === false ? "No" : null],
        ["Apply", m.apply_url ? extLink(m.apply_url, "Apply") : null]]);
    default: return null;
  }
}

function sceneBlock(p) {
  if (p.kind !== "scene" && !p.scene) return null;
  const world = p.scene?.world || p.world || "earth";
  const sc = p.scene || {};
  return h("div", { class: "s-scene" },
    h("p", {}, h("strong", {}, "3D scene"), ` on ${world}`,
      sc.layers ? ` · ${sc.layers.length} layers` : "", sc.annotations ? ` · ${sc.annotations.length} annotations` : ""),
    sc.layers?.length ? h("ul", { class: "s-plain" }, sc.layers.slice(0, 20).map((l) => h("li", {}, `${l.name || l.id}${l.source ? ` — ${l.source}` : ""}`))) : null,
    h("a", { class: "btn-primary", href: geohubHref(p) }, "Open in GeoHUB"));
}

function modelBlock(p) {
  if (p.kind !== "model") return null;
  const m = p.meta || {};
  const params = m.params && typeof m.params === "object" ? Object.entries(m.params) : [];
  const href = geohubHref(p);
  return h("div", { class: "s-scene" },
    h("p", {}, h("strong", {}, "Model"), ` · ${m.mesher === "blender" ? "Blender" : "gmsh"} mesh`,
      m.solver ? ` · ${m.solver}` : "", m.domain?.world ? ` · ${m.domain.world}` : "",
      Array.isArray(m.domain?.bbox) ? ` · area ${m.domain.bbox.map((v) => Number(v).toFixed(2)).join(", ")}` : ""),
    params.length ? h("ul", { class: "s-plain" }, params.slice(0, 30).map(([k, v]) =>
      h("li", {}, `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`))) : null,
    href ? h("a", { class: "btn-primary", href }, "Open in GeoHUB")
      : h("p", { class: "s-muted", text: "This model was not shared from a GeoHUB model page, so there is nothing to open." }));
}

function repoBlock(p) {
  if (p.kind !== "repo" || !p.meta?.url) return null;
  const m = p.meta;
  return h("div", { class: "s-scene" },
    h("p", {}, h("strong", {}, "Repository"), m.language ? ` · ${m.language}` : "", m.licence ? ` · ${m.licence}` : "",
      m.default_branch ? ` · ${m.default_branch}` : ""),
    extLink(m.url, m.url));
}

/** Always visible: where it came from, what it may be used for, how it was made and where it may be wrong. */
function provenanceBlock(p) {
  const lic = LICENCES.find(([v]) => v && v === p.licence);
  const method = p.method || {};
  const research = hasProvenance(p.kind);
  const notStated = () => h("span", { class: "s-muted", text: "Not stated" });
  // Research outputs list every row ("not stated" is worth knowing); a
  // question, job, event or plain post shows only what was given, and no
  // block at all when nothing was.
  const rows = [
    research ? ["Provenance", h("span", {}, provenanceBadge(p.provenance), " ", PROVENANCE[p.provenance]?.help || "")] : null,
    p.licence ? ["Licence", lic ? lic[1] : p.licence] : null,
    p.sources?.length ? ["Sources", h("ol", { class: "s-plain" }, p.sources.map((s) => h("li", {},
      s.url ? extLink(s.url, s.label || s.url) : s.doi ? extLink(`https://doi.org/${s.doi}`, s.label || s.doi) : (s.label || ""))))] : research ? ["Sources", notStated()] : null,
    method.summary || method.software ? ["Method", h("div", {}, method.summary ? h("p", { text: method.summary }) : null,
      method.software ? h("p", { class: "s-muted", text: `Software: ${method.software}` }) : null)] : research ? ["Method", notStated()] : null,
    p.limitations ? ["Limitations", p.limitations] : research ? ["Limitations", notStated()] : null,
  ].filter(Boolean);
  if (!rows.length) return null;
  return h("section", { class: "s-provenance", "aria-label": research ? "Provenance and reuse" : "Sources" },
    h("h2", { class: "s-h3", text: research ? "Provenance & reuse" : "Sources & reuse" }),
    dl(rows));
}

function verifyBlock(p, mine) {
  const v = p.verification || {};
  const box = h("section", { class: "s-verify" },
    h("h2", { class: "s-h3", text: "Verification" }),
    h("p", { class: "s-muted", text: "Other members who know the site can confirm or dispute this observation. The author cannot verify their own." }),
    h("p", {}, verificationBadge(v)));
  if (!mine) {
    const verdict = (kind) => () => act(async () => {
      const note = await modal(kind === "confirm" ? "Confirm this observation" : "Dispute this observation", (close) => {
        const t = textarea("note", { rows: 3, maxlength: 1000 });
        const f = h("form", {}, field("Your evidence or reasoning", t, "e.g. I visited on the same date; the scarp is visible in my photos."),
          h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Submit"),
            h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
        f.addEventListener("submit", (e) => { e.preventDefault(); close(t.value); });
        return f;
      });
      if (note === undefined) return;
      await api.post(`/v1/posts/${encodeURIComponent(p.id)}/verify`, { verdict: kind, note });
      toast("Thank you — recorded.");
      location.hash = `#/post/${encodeURIComponent(p.id)}?r=${Date.now()}`;
    }, "verify observations");
    put(box, h("div", { class: "s-actions" },
      h("button", { type: "button", class: "btn-ghost s-btn-sm", "aria-pressed": String(p.viewer?.verified === "confirm"), onClick: verdict("confirm") }, "Confirm"),
      h("button", { type: "button", class: "btn-ghost s-btn-sm", "aria-pressed": String(p.viewer?.verified === "dispute"), onClick: verdict("dispute") }, "Dispute")));
  }
  return box;
}

function actionBar(p, mine, focusComment) {
  const reacted = new Set(p.viewer?.reacted || []);
  const bar = h("div", { class: "s-actionbar", role: "toolbar", "aria-label": "Post actions" });
  for (const [kind, label] of REACTIONS) {
    const btn = h("button", { type: "button", class: "s-act", "aria-pressed": String(reacted.has(kind)) }, label);
    btn.addEventListener("click", () => act(async () => {
      const on = reacted.has(kind);
      if (on) await api.del(`/v1/posts/${encodeURIComponent(p.id)}/react`, { kind });
      else { await api.post(`/v1/posts/${encodeURIComponent(p.id)}/react`, { kind }); play("tick"); }
      if (on) reacted.delete(kind); else reacted.add(kind);
      btn.setAttribute("aria-pressed", String(!on));
    }, "react"));
    put(bar, btn);
  }
  put(bar, h("button", { type: "button", class: "s-act", onClick: focusComment }, p.kind === "question" ? "Answer" : "Comment"));
  let saved = !!p.viewer?.bookmarked;
  const bm = h("button", { type: "button", class: "s-act", "aria-pressed": String(saved) }, saved ? "Saved" : "Save");
  bm.addEventListener("click", () => {
    if (saved) {
      act(async () => { await api.del(`/v1/posts/${encodeURIComponent(p.id)}/bookmark`, {}); saved = false; bm.textContent = "Save"; bm.setAttribute("aria-pressed", "false"); }, "save posts");
    } else bookmarkDialog(p.id, () => { saved = true; bm.textContent = "Saved"; bm.setAttribute("aria-pressed", "true"); });
  });
  put(bar, bm,
    reshareButton(p),
    p.visibility === "public" && store.me && !mine ? h("button", { type: "button", class: "s-act", onClick: () => quoteDialog(p) }, "Quote") : null,
    h("button", { type: "button", class: "s-act", onClick: () => (store.me ? sendPostDialog(p) : requireSignIn("send posts")) }, "Send to…"),
    // A public post shares its preview page (title, summary and card on any site); others the app link.
    h("button", { type: "button", class: "s-act", onClick: () => {
      api.post(`/v1/posts/${encodeURIComponent(p.id)}/shared`, {}).catch(() => {});
      share(p.visibility === "public" ? sharePageUrl("p", p.id) : postUrl(p.id), p.title || "GeoID Network");
    } }, "Share link"),
    h("button", { type: "button", class: "s-act", onClick: () => citeDialog(p.id) }, "Cite"));
  // Collaboration track: ask specialists for help with (or about) this post.
  put(bar, h("a", { class: "s-act", href: `#/requests?new=1&post=${encodeURIComponent(p.id)}` }, "Ask for help…"));
  const openHref = geohubHref(p);
  if (openHref) put(bar, h("a", { class: "s-act", href: openHref }, "Open in GeoHUB"));
  if (p.project_id) put(bar, h("a", { class: "s-act", href: `#/p/${encodeURIComponent(p.project_id)}` }, "Project"), store.me ? followButton("project", p.project_id, false, "project") : null);
  if (p.allow_fork && !mine) {
    put(bar, h("button", { type: "button", class: "s-act", onClick: () => act(async () => {
      const ok = await confirmDialog("Fork this post", "A copy of the scene, method, sources and settings is made under your name, credited to the original. You can edit it before sharing.", "Fork");
      if (!ok) return;
      const fork = await api.post(`/v1/posts/${encodeURIComponent(p.id)}/fork`, { visibility: "private" });
      toast("Forked. It is private until you change it.");
      location.hash = `#/post/${encodeURIComponent(fork.id)}`;
    }, "fork posts") }, "Fork"));
  }
  if (mine && p.visibility === "public" && (p.media || []).length) {
    put(bar, h("button", { type: "button", class: "s-act", onClick: () => zenodoDialog(p) }, "Zenodo…"));
  }
  if (mine) {
    put(bar, h("a", { class: "s-act", href: `#/compose?edit=${encodeURIComponent(p.id)}` }, "Edit"),
      h("button", { type: "button", class: "s-act s-danger", onClick: () => act(async () => {
        if (!(await confirmDialog("Delete this post?", "It is removed for everyone. Comments on it are hidden too.", "Delete"))) return;
        await api.del(`/v1/posts/${encodeURIComponent(p.id)}`);
        toast("Deleted.");
        location.hash = "#/";
      }, "delete posts") }, "Delete"));
  } else {
    put(bar, h("button", { type: "button", class: "s-act", onClick: () => reportDialog("post", p.id) }, "Report"));
  }
  return bar;
}

// ── Comments / answers ─────────────────────────────────────────────────────

async function loadComments(section, p, mine) {
  const isQ = p.kind === "question";
  put(clear(section), h("h2", { class: "s-h2", id: "thread-h", text: isQ ? "Answers" : "Comments" }), loading());
  let items = [];
  try {
    const data = await api.get(`/v1/posts/${encodeURIComponent(p.id)}/comments`);
    items = data?.items || [];
  } catch (error) {
    section.lastChild.replaceWith(errorBox(error, () => loadComments(section, p, mine)));
    return;
  }
  section.lastChild.remove();
  const top = items.filter((c) => !c.parent_id);
  const replies = (id) => items.filter((c) => c.parent_id === id);
  // An accepted answer goes first, clearly marked.
  top.sort((a, b) => (b.id === p.accepted_comment_id) - (a.id === p.accepted_comment_id));
  const list = h("ol", { class: "s-comments" });
  const drawComment = (c, depth = 0) => {
    const accepted = c.id === p.accepted_comment_id || c.accepted;
    const li = h("li", { class: `s-comment${accepted ? " is-accepted" : ""}` },
      h("div", { class: "s-comment-head" }, userChip(c.author, { sub: false }), h("span", { class: "s-muted" }, timeEl(c.created_at)),
        c.kind && c.kind !== "comment" ? h("span", { class: "s-kind", text: c.kind === "correction" ? "Correction" : "Suggestion" }) : null,
        accepted ? h("span", { class: "s-accepted", text: "Accepted answer" }) : null,
        isChange(c) && c.status ? h("span", { class: c.status === "accepted" ? "s-accepted" : "s-vis", text: c.status === "accepted" ? "Change accepted" : "Declined" }) : null),
      h("div", { class: "s-prose" }, String(c.body || "").split(/\n{2,}/).map((t) => h("p", {}, t))),
      isChange(c) && c.status && c.status_note ? h("p", { class: "s-hint s-change-note" }, `${p.author?.name || "The author"}: ${c.status_note}`) : null);
    const tools = h("div", { class: "s-comment-tools" });
    if (mine && isChange(c) && c.author?.handle !== myHandle()) put(tools, changeTools(c, () => loadComments(section, p, mine)));
    if (depth === 0) put(tools, h("button", { type: "button", class: "s-link-btn", onClick: () => {
      if (!requireSignIn("reply")) return;
      if (li.querySelector("form")) return;
      put(li, commentForm(p, c.id, () => loadComments(section, p, mine)));
      li.querySelector("textarea").focus();
    } }, "Reply"));
    if (isQ && mine && depth === 0 && !accepted && c.author?.handle !== myHandle()) {
      put(tools, h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => {
        await api.post(`/v1/posts/${encodeURIComponent(p.id)}/accept`, { comment_id: c.id });
        p.accepted_comment_id = c.id;
        toast("Marked as the accepted answer.");
        loadComments(section, p, mine);
      }, "accept answers") }, "Accept this answer"));
    }
    if (store.me && (c.author?.handle === myHandle() || mine || store.me.admin)) {
      put(tools, h("button", { type: "button", class: "s-link-btn s-danger", onClick: () => act(async () => {
        if (!(await confirmDialog("Delete this comment?", "It is removed for everyone.", "Delete"))) return;
        await api.del(`/v1/comments/${encodeURIComponent(c.id)}`);
        loadComments(section, p, mine);
      }, "delete comments") }, "Delete"));
    }
    if (store.me && c.author?.handle !== myHandle()) put(tools, h("button", { type: "button", class: "s-link-btn", onClick: () => reportDialog("comment", c.id) }, "Report"));
    put(li, tools);
    const kids = replies(c.id);
    if (kids.length) put(li, h("ol", { class: "s-comments s-replies" }, kids.map((k) => drawComment(k, 1))));
    return li;
  };
  top.forEach((c) => put(list, drawComment(c)));
  put(section, changesAccepted(items));
  put(section, top.length ? list : empty(isQ ? "No answers yet." : "No comments yet.", isQ ? "If you know, say so — and how you know." : ""),
    store.me ? commentForm(p, null, () => loadComments(section, p, mine))
      : h("p", {}, h("button", { type: "button", class: "btn-ghost", onClick: () => requireSignIn("comment") }, "Sign in to comment")));
}

// ── Peer contributions (collaboration track) ───────────────────────────────
// A correction or suggestion the post's author accepts is credited to its
// writer (Accepted contributions on their profile) and listed above the thread.

const isChange = (c) => c.kind === "correction" || c.kind === "suggestion";

function changeTools(c, reload) {
  const decide = (status) => act(async () => {
    let note = "";
    if (status) {
      note = await modal(status === "accepted" ? "Accept this change" : "Decline this change", (close) => {
        const t = textarea("note", { rows: 3, maxlength: 500 });
        const f = h("form", {}, field(status === "accepted" ? "What did you change? (optional)" : "Why not? (optional)", t,
          status === "accepted" ? "They are credited on this post and on their profile, and told." : "They are told, with your note."),
        h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, status === "accepted" ? "Accept" : "Decline"),
          h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
        f.addEventListener("submit", (e) => { e.preventDefault(); close(t.value); });
        return f;
      });
      if (note === undefined) return;
    }
    await api.post(`/v1/comments/${encodeURIComponent(c.id)}/status`, { status, note });
    toast(status === "accepted" ? "Accepted and credited." : status === "declined" ? "Declined." : "Undone.");
    reload();
  }, "decide on changes");
  return h("span", { class: "s-change-tools" },
    c.status !== "accepted" ? h("button", { type: "button", class: "s-link-btn", onClick: () => decide("accepted") }, "Accept change") : null,
    c.status !== "declined" ? h("button", { type: "button", class: "s-link-btn", onClick: () => decide("declined") }, "Decline") : null,
    c.status ? h("button", { type: "button", class: "s-link-btn", onClick: () => decide("") }, "Undo") : null);
}

function changesAccepted(items) {
  const accepted = items.filter((c) => isChange(c) && c.status === "accepted" && c.author);
  if (!accepted.length) return null;
  return h("section", { class: "s-changes", "aria-labelledby": "changes-h" },
    h("h3", { class: "s-h3", id: "changes-h", text: "Changes accepted from the community" }),
    h("ul", { class: "s-rows" }, accepted.map((c) => h("li", { class: "s-row" }, userChip(c.author, { sub: false }),
      h("span", { class: "s-kind", text: c.kind === "correction" ? "Correction" : "Suggestion" }),
      h("span", { class: "s-muted", text: String(c.body || "").slice(0, 160) }),
      c.status_note ? h("span", { class: "s-hint", text: `— ${c.status_note}` }) : null))));
}

function commentForm(p, parentId, onDone) {
  const body = textarea("body", { rows: parentId ? 2 : 4, required: true, maxlength: 10000, "aria-label": parentId ? "Reply" : "Comment" });
  const kind = select("kind", [["comment", "Comment"], ["correction", "Correction"], ["suggestion", "Suggestion"]], "comment");
  const form = h("form", { class: "s-comment-form" },
    parentId ? body : field(p.kind === "question" ? "Your answer" : "Add a comment", body),
    h("div", { class: "s-actions" }, parentId ? null : field("Type", kind),
      h("button", { type: "submit", class: "btn-primary s-btn-sm" }, parentId ? "Reply" : "Post")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!body.value.trim()) return;
    const done = busy(form);
    try {
      await api.post(`/v1/posts/${encodeURIComponent(p.id)}/comments`, { body: body.value, parent_id: parentId, kind: kind.value });
      onDone();
    } catch (error) { toast(error.message, "error"); done(); }
  });
  return form;
}

/**
 * Deposit the post's files on Zenodo under the author's own account: a DOI,
 * and the bytes leave our storage for a permanent home. A draft by default
 * -- publishing on Zenodo cannot be undone, so it takes a second, explicit yes.
 */
async function zenodoDialog(p) {
  let z;
  try { z = await api.get("/v1/zenodo", { post: p.id }); } catch (error) { toast(error.message, "error"); return; }
  const dep = z.deposit;
  if (dep?.status === "published") {
    modal("On Zenodo", () => h("div", {},
      h("p", {}, "This post's files are published on Zenodo."),
      dep.doi ? h("p", {}, "DOI: ", h("code", { text: dep.doi })) : null,
      dep.url ? extLink(dep.url, "Open on Zenodo") : null));
    return;
  }
  if (!z.configured) { toast("Publishing to Zenodo isn't set up on this server yet.", "error"); return; }
  if (!z.connected) {
    if (await confirmDialog("Connect Zenodo", "Your files go to your own Zenodo account, under your name. Connect it in Settings first.", "Go to Settings")) location.hash = "#/settings";
    return;
  }
  modal("Publish to Zenodo", (close) => {
    const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
    const go = async (publish) => {
      if (publish && !(await confirmDialog("Publish now?", "A published Zenodo record is permanent: the files cannot be changed or removed, only versioned. Make a draft if you want to check it on Zenodo first.", "Publish"))) return;
      status.textContent = "Sending the files to Zenodo…";
      try {
        const out = await api.post(`/v1/posts/${encodeURIComponent(p.id)}/zenodo`, { publish });
        close?.();
        toast(out.status === "published" ? `Published. DOI ${out.doi}` : "Draft made in your Zenodo account.");
        location.reload();
      } catch (error) { status.textContent = error.message; status.classList.add("is-error"); }
    };
    return h("div", {},
      h("p", {}, `${(p.media || []).length} file${(p.media || []).length === 1 ? "" : "s"} from this post, with its title, description, licence (${p.licence || "CC-BY-4.0"}), tags and sources, go to your Zenodo account${z.sandbox ? " (the Zenodo sandbox)" : ""}.`),
      h("p", { class: "s-hint", text: "A draft can be checked and edited on Zenodo before it is published. Once it is published, the DOI goes on this post." }),
      dep?.url ? h("p", { class: "s-hint" }, "You already made a draft: ", extLink(dep.url, "open it on Zenodo"), ". Another press makes a new one.") : null,
      status,
      h("div", { class: "s-actions" },
        h("button", { type: "button", class: "btn-primary", onClick: () => go(false) }, "Make a draft"),
        h("button", { type: "button", class: "btn-ghost", onClick: () => go(true) }, "Publish with a DOI")));
  });
}

/** The author's own view of a post's reach: counts only, never who. */
function reachPanel(p) {
  const box = h("section", { class: "s-section s-reach", "aria-labelledby": "reach-h" }, h("h2", { class: "s-h3", id: "reach-h", text: "Reach (only you see this)" }));
  api.get(`/v1/posts/${encodeURIComponent(p.id)}/reach`).then((r) => {
    const t = r.total || {};
    const max = Math.max(1, ...r.last_30_days.map((d) => d.views + d.link_visits));
    const W = 300, H = 40;
    const pts = r.last_30_days.map((d, i) => `${(i / 29) * W},${H - ((d.views + d.link_visits) / max) * (H - 4) - 2}`).join(" ");
    put(box,
      h("dl", { class: "s-reach-stats" }, [["Views", t.views], ["Link visits", t.link_visits], ["Shares", t.shares], ["Saves", t.saves],
        ["Reshares", t.reshares], ["Reactions", t.reactions], ["Comments", t.comments]].map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: String(v || 0) })))),
      (() => {
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "s-spark"); svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "Views and link visits over the last 30 days");
        const line = document.createElementNS(ns, "polyline");
        line.setAttribute("points", pts); line.setAttribute("fill", "none"); line.setAttribute("stroke", "currentColor"); line.setAttribute("stroke-width", "2");
        svg.append(line);
        return svg;
      })(),
      h("p", { class: "s-hint", text: "Views count signed-in readers once a day; link visits are people opening its share link elsewhere (link previews aren't counted)." }));
  }).catch(() => box.remove());
  return box;
}

