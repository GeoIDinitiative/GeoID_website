/** #/post/:id — one post in full, its provenance, the interaction bar and the thread. */
import * as api from "../api.js";
import { store, myHandle } from "../store.js";
import {
  h, clear, timeEl, toast, modal, field, select, textarea, busy, extLink, errorBox, loading,
  confirmDialog, empty, dateText, put,
} from "../dom.js";
import {
  userChip, kindBadge, provenanceBadge, hasProvenance, verificationBadge, geohubHref, tagList, REACTIONS, LICENCES, VISIBILITY,
  PROVENANCE, act, requireSignIn, followButton, reportDialog, share, postUrl, citeDialog, bookmarkDialog,
  postCard, kindLabel,
} from "../components.js";

export async function render(root, { params }) {
  const id = params.id;
  put(clear(root), loading());
  let p;
  try { p = await api.get(`/v1/posts/${encodeURIComponent(id)}`); } catch (error) {
    put(clear(root), errorBox(error, () => render(root, { params })));
    return;
  }
  document.title = `${p.title || kindLabel(p.kind)} — GeoHUB Social`;
  const mine = !!store.me && p.author?.handle === myHandle();
  const comments = h("section", { class: "s-thread", "aria-labelledby": "thread-h" });
  put(clear(root),
    h("article", { class: "s-post-full" },
      h("header", { class: "s-post-head" },
        h("div", { class: "s-labels" }, kindBadge(p.kind), hasProvenance(p.kind) ? provenanceBadge(p.provenance) : null,
          p.kind === "observation" ? verificationBadge(p.verification) : null,
          p.visibility !== "public" ? h("span", { class: "s-vis", text: VISIBILITY[p.visibility] || p.visibility }) : null,
          p.sponsored_by ? h("span", { class: "s-sponsor", text: `Sponsored by ${p.sponsored_by}` }) : null,
          p.forked_from ? h("a", { class: "s-vis", href: `#/post/${encodeURIComponent(p.forked_from)}` }, "Forked from another post") : null),
        h("h1", { class: "s-h1", text: p.title || kindLabel(p.kind) }),
        h("div", { class: "s-byline" }, userChip(p.author),
          h("span", { class: "s-muted" }, timeEl(p.created_at, true),
            p.updated_at && p.updated_at > p.created_at + 60 ? h("span", {}, " · edited ", timeEl(p.updated_at)) : null),
          store.me && !mine && p.author ? followButton("user", p.author.handle, p.viewer?.following_author, "author") : null)),
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
  return h("div", { class: "s-prose" }, paras.map((t) => h("p", {}, t)));
}

function mediaBlock(p) {
  if (!p.media?.length) return null;
  return h("div", { class: "s-media" }, p.media.map((m) => {
    const isPdf = /\.pdf($|\?)/i.test(m.key || "") || m.type === "application/pdf";
    if (isPdf) return h("p", {}, extLink(m.url, `Download the PDF${m.alt ? `: ${m.alt}` : ""}`));
    return h("figure", {}, h("img", { src: m.url, alt: m.alt || "", loading: "lazy" }), m.alt ? h("figcaption", { text: m.alt }) : null);
  }));
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
    case "analysis": return dl([["Before", m.before], ["After", m.after], ["Uncertainty", m.uncertainty]]);
    case "monitor": return monitorBlock(m);
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

function monitorBlock(m) {
  const series = Array.isArray(m.series) ? m.series : [];
  if (!series.length) return null;
  return h("div", { class: "s-monitor" },
    m.updated_at ? h("p", { class: "s-muted" }, "Updated ", timeEl(m.updated_at)) : null,
    series.map((s) => {
      const pts = (s.points || []).filter((pt) => Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
      const canvas = h("canvas", { class: "s-spark", width: 600, height: 120, role: "img",
        "aria-label": `${s.label || "Series"}: ${pts.length} points${pts.length ? `, latest ${pts[pts.length - 1][1]} ${s.unit || ""}` : ""}` });
      requestAnimationFrame(() => {
        const ctx = canvas.getContext("2d");
        if (!pts.length) return;
        const xs = pts.map((q) => q[0]); const ys = pts.map((q) => q[1]);
        const x0 = Math.min(...xs); const x1 = Math.max(...xs) || x0 + 1;
        const y0 = Math.min(...ys); const y1 = Math.max(...ys);
        const sx = (x) => 10 + ((x - x0) / ((x1 - x0) || 1)) * 580;
        const sy = (y) => 110 - ((y - y0) / ((y1 - y0) || 1)) * 100;
        ctx.strokeStyle = getComputedStyle(canvas).color; ctx.lineWidth = 2; ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        ctx.stroke();
      });
      return h("figure", {}, h("figcaption", {}, `${s.label || "Series"}${s.unit ? ` (${s.unit})` : ""}`), canvas);
    }));
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
  const lic = LICENCES.find(([v]) => v === p.licence);
  const method = p.method || {};
  const notStated = () => h("span", { class: "s-muted", text: "Not stated" });
  return h("section", { class: "s-provenance", "aria-label": "Provenance and reuse" },
    h("h2", { class: "s-h3", text: "Provenance & reuse" }),
    dl([
      ...(hasProvenance(p.kind) ? [["Provenance", h("span", {}, provenanceBadge(p.provenance), " ", PROVENANCE[p.provenance]?.help || "")]] : []),
      ["Licence", lic ? lic[1] : (p.licence || notStated())],
      ["Sources", p.sources?.length ? h("ol", { class: "s-plain" }, p.sources.map((s) => h("li", {},
        s.url ? extLink(s.url, s.label || s.url) : s.doi ? extLink(`https://doi.org/${s.doi}`, s.label || s.doi) : (s.label || "")))) : notStated()],
      ["Method", method.summary || method.software ? h("div", {}, method.summary ? h("p", { text: method.summary }) : null,
        method.software ? h("p", { class: "s-muted", text: `Software: ${method.software}` }) : null) : notStated()],
      ["Limitations", p.limitations || notStated()],
    ]));
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
      else await api.post(`/v1/posts/${encodeURIComponent(p.id)}/react`, { kind });
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
    h("button", { type: "button", class: "s-act", onClick: () => share(postUrl(p.id), p.title || "GeoHUB Social") }, "Share"),
    h("button", { type: "button", class: "s-act", onClick: () => citeDialog(p.id) }, "Cite"));
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
        accepted ? h("span", { class: "s-accepted", text: "Accepted answer" }) : null),
      h("div", { class: "s-prose" }, String(c.body || "").split(/\n{2,}/).map((t) => h("p", {}, t))));
    const tools = h("div", { class: "s-comment-tools" });
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
  put(section, top.length ? list : empty(isQ ? "No answers yet." : "No comments yet.", isQ ? "If you know, say so — and how you know." : ""),
    store.me ? commentForm(p, null, () => loadComments(section, p, mine))
      : h("p", {}, h("button", { type: "button", class: "btn-ghost", onClick: () => requireSignIn("comment") }, "Sign in to comment")));
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
