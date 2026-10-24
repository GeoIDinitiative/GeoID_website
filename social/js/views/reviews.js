/** #/reviews, #/reviews/new and #/r/:id — peer review of draft papers. */
import * as api from "../api.js?v=20261024-0be119a";
import { store, myHandle } from "../store.js?v=20261024-0be119a";
import {
  h, clear, field, input, select, textarea, toast, busy, splitList, errorBox, loading, empty, confirmDialog,
  timeEl, dateToEpoch, dateText, extLink, epochToDate, put,
} from "../dom.js?v=20261024-0be119a";
import { act, pagedList, userChip, requireSignIn } from "../components.js?v=20261024-0be119a";

const RECS = [["accept", "Accept as is"], ["minor", "Minor revisions"], ["major", "Major revisions"], ["reject", "Reject / not ready"]];
// The Worker's severities (reviews.js SEVERITIES); any other value is a 400.
const SEVERITY = [["general", "General"], ["major", "Major issue"], ["minor", "Minor issue"], ["typo", "Typo"]];
const recLabel = (r) => RECS.find(([v]) => v === r)?.[1] || r || "";

export function renderList(root, { query }) {
  const tab = ["mine", "assigned", "open"].includes(query.role) ? query.role : (store.me ? "assigned" : "open");
  const tabLink = (id, label) => h("a", { href: `#/reviews?role=${id}`, class: id === tab ? "is-active" : "", "aria-current": id === tab ? "page" : null }, label);
  const card = (r) => h("a", { class: "s-card s-link-card", href: `#/r/${encodeURIComponent(r.id)}` },
    h("h2", { class: "s-card-title", text: r.title }),
    r.abstract ? h("p", { class: "s-muted", text: String(r.abstract).slice(0, 260) }) : null,
    h("p", { class: "s-hint" }, `${r.status || "open"}`, r.expertise?.length ? ` · ${r.expertise.join(", ")}` : "",
      r.due_at ? ` · due ${dateText(r.due_at)}` : "", r.requester ? ` · from @${r.requester.handle}` : ""));
  put(clear(root),
    h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Peer review" }), h("a", { class: "btn-primary", href: "#/reviews/new" }, "Request a review")),
    h("p", { class: "s-muted", text: "Ask named reviewers, a team, a community or anyone to review a draft before you submit it. Comments are anchored to a place in the draft and graded by severity." }),
    h("nav", { class: "s-tabs", "aria-label": "Reviews" }, tabLink("assigned", "Asked of me"), tabLink("mine", "My requests"), tabLink("open", "Open for volunteers")),
    tab !== "open" && !store.me ? empty("Sign in to see your reviews.")
      : pagedList((cursor) => api.get("/v1/reviews", { role: tab, cursor }), card, {
        emptyTitle: tab === "assigned" ? "Nobody has asked you to review anything." : tab === "mine" ? "You have not requested a review." : "No open review requests right now.",
      }));
}

export function renderNew(root) {
  if (!store.me) {
    put(clear(root), h("h1", { class: "s-h1", text: "Request a review" }), empty("Sign in to request a review."),
      h("button", { type: "button", class: "btn-primary", onClick: () => requireSignIn("request reviews") }, "Sign in"));
    return;
  }
  let docKey = "";
  const f = {
    title: input("title", { required: true, maxlength: 300 }),
    abstract: textarea("abstract", { rows: 6, maxlength: 6000 }),
    file: h("input", { type: "file", accept: "application/pdf" }),
    url: input("doc_url", { type: "url", placeholder: "https:// (or upload a PDF)" }),
    expertise: input("expertise", { placeholder: "volcanology, insar" }),
    visibility: select("visibility", [["private", "Only the reviewers I invite"], ["team", "A team"], ["community", "A community"], ["open", "Anyone may volunteer"]], "private"),
    team: select("team", [["", "Choose"], ...(store.me.teams || []).map((t) => [t.slug, t.name])], ""),
    community: select("community", [["", "Choose"], ...(store.me.communities || []).map((c) => [c.slug, c.name])], ""),
    due: input("due", { type: "date" }),
    invite: input("invite", { placeholder: "handles, comma-separated" }),
  };
  const fileNote = h("p", { class: "s-hint", "aria-live": "polite" });
  f.file.addEventListener("change", async () => {
    const file = f.file.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { fileNote.textContent = "That PDF is over 8 MB. Link to it instead."; f.file.value = ""; return; }
    fileNote.textContent = "Uploading…";
    try { const out = await api.upload(file, { scope: "owner" }); docKey = out.key; fileNote.textContent = `Uploaded ${file.name}. Only you and your reviewers can open it.`; } catch (error) { fileNote.textContent = error.message; }
  });
  const teamF = field("Team", f.team); const commF = field("Community", f.community);
  const sync = () => { teamF.hidden = f.visibility.value !== "team"; commF.hidden = f.visibility.value !== "community"; };
  f.visibility.addEventListener("change", sync); sync();
  const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
  const form = h("form", { class: "s-form" }, field("Title", f.title), field("Abstract", f.abstract),
    field("Draft (PDF, up to 8 MB)", f.file), fileNote, field("…or a link to the draft", f.url),
    field("Expertise wanted", f.expertise), field("Who may review", f.visibility), teamF, commF,
    field("Due date (optional)", f.due), field("Invite reviewers", f.invite, "They are notified and can accept or decline."),
    status, h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Request review"), h("a", { class: "btn-ghost", href: "#/reviews" }, "Cancel")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!f.title.value.trim()) { status.textContent = "Give the draft a title."; return; }
    if (!docKey && !f.url.value.trim()) { status.textContent = "Upload the PDF or give a link to it."; return; }
    const done = busy(form);
    try {
      const r = await api.post("/v1/reviews", {
        title: f.title.value, abstract: f.abstract.value, doc_key: docKey || undefined, doc_url: f.url.value || undefined,
        expertise: splitList(f.expertise.value), visibility: f.visibility.value,
        team_slug: f.visibility.value === "team" ? f.team.value : undefined,
        community_slug: f.visibility.value === "community" ? f.community.value : undefined,
        due_at: dateToEpoch(f.due.value, true),
      });
      const rid = r.id || r.review?.id;
      for (const handle of splitList(f.invite.value)) {
        try { await api.post(`/v1/reviews/${encodeURIComponent(rid)}/invite`, { handle: handle.replace(/^@/, "") }); } catch (error) { toast(`Could not invite @${handle}: ${error.message}`, "error"); }
      }
      location.hash = `#/r/${encodeURIComponent(rid)}`;
    } catch (error) { done(); status.textContent = error.message; status.classList.add("is-error"); }
  });
  put(clear(root), h("h1", { class: "s-h1", text: "Request a review" }), form);
}

export async function renderOne(root, { params }) {
  const id = params.id;
  put(clear(root), loading());
  let data;
  try { data = await api.get(`/v1/reviews/${encodeURIComponent(id)}`); } catch (error) {
    put(clear(root), errorBox(error, () => renderOne(root, { params }))); return;
  }
  const r = data.review || {};
  const role = data.viewer_role || "reader";
  const reviewers = data.reviewers || [];
  const meAsReviewer = reviewers.find((x) => x.user?.handle === myHandle());
  const reload = () => renderOne(root, { params });
  const closed = r.status === "closed";
  document.title = `${r.title} — Review — GeoID Network`;

  const openDoc = async () => {
    try {
      const url = r.doc_url && !r.doc_key ? r.doc_url : await api.mediaBlobUrl(r.doc || api.mediaUrl(r.doc_key));
      window.open(url, "_blank", "noopener");
    } catch (error) { toast(error.message, "error"); }
  };

  const actions = h("div", { class: "s-actions" },
    r.doc_key || r.doc_url ? h("button", { type: "button", class: "btn-primary", onClick: openDoc }, r.doc_key ? "Open the draft (PDF)" : "Open the draft") : null);
  if (meAsReviewer?.status === "invited") {
    put(actions, h("button", { type: "button", class: "btn-ghost", onClick: () => act(async () => { await api.post(`/v1/reviews/${encodeURIComponent(id)}/respond`, { accept: true }); reload(); }) }, "Accept the invitation"),
      h("button", { type: "button", class: "btn-ghost", onClick: () => act(async () => { await api.post(`/v1/reviews/${encodeURIComponent(id)}/respond`, { accept: false }); location.hash = "#/reviews"; }) }, "Decline"));
  } else if (role === "reader" && !closed && r.visibility !== "private" && store.me) {
    put(actions, h("button", { type: "button", class: "btn-ghost", onClick: () => act(async () => { await api.post(`/v1/reviews/${encodeURIComponent(id)}/volunteer`, {}); toast("You are a reviewer now."); reload(); }) }, "Volunteer to review"));
  }

  const reviewerList = h("ul", { class: "s-rows" }, reviewers.length ? reviewers.map((x) => h("li", { class: "s-row" }, userChip(x.user),
    h("span", { class: "s-kind", text: x.status }),
    x.recommendation ? h("span", { class: "s-vis", text: recLabel(x.recommendation) }) : null,
    x.summary ? h("p", { class: "s-review-summary", text: x.summary }) : null)) : h("li", { class: "s-muted", text: "No reviewers yet." }));

  put(clear(root),
    h("header", { class: "s-community-head" },
      h("p", { class: "s-labels" }, h("span", { class: "s-kind", text: "Review request" }), h("span", { class: "s-vis", text: r.status || "open" }),
        h("span", { class: "s-vis", text: r.visibility || "" })),
      h("h1", { class: "s-h1", text: r.title }),
      r.requester ? h("div", { class: "s-byline" }, userChip(r.requester), timeEl(r.created_at)) : null,
      h("p", { class: "s-muted" }, r.expertise?.length ? `Expertise: ${r.expertise.join(", ")}` : "", r.due_at ? ` · due ${dateText(r.due_at)}` : "",
        ` · you are ${role === "requester" ? "the author" : role === "reviewer" ? "a reviewer" : "reading"}`),
      r.abstract ? h("section", { class: "s-prose" }, h("h2", { class: "s-h3", text: "Abstract" }), String(r.abstract).split(/\n{2,}/).map((t) => h("p", {}, t))) : null,
      r.doc_url && !r.doc_key ? h("p", { class: "s-hint" }, "Draft link: ", extLink(r.doc_url)) : null,
      actions),
    h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Reviewers" }), reviewerList,
      role === "requester" && !closed ? requesterTools(r, reload) : null,
      role === "reviewer" && meAsReviewer?.status === "accepted" && !closed ? submitForm(id, meAsReviewer, reload) : null,
      role !== "requester" && !closed ? h("p", { class: "s-hint", text: "Reviewers' summaries are visible to the author, and to everyone else once the review is closed." }) : null),
    commentsSection(id, data.comments || [], role, closed, reload));
}

function requesterTools(r, reload) {
  const handle = input("handle", { placeholder: "handle" });
  const due = input("due", { type: "date", value: epochToDate(r.due_at) });
  const inv = h("form", { class: "s-inline-form" }, field("Invite a reviewer", handle), h("button", { type: "submit", class: "btn-ghost" }, "Invite"));
  inv.addEventListener("submit", (e) => { e.preventDefault(); act(async () => { await api.post(`/v1/reviews/${encodeURIComponent(r.id)}/invite`, { handle: handle.value.replace(/^@/, "") }); toast("Invited."); reload(); }); });
  const dueForm = h("form", { class: "s-inline-form" }, field("Due date", due), h("button", { type: "submit", class: "btn-ghost" }, "Set"));
  dueForm.addEventListener("submit", (e) => { e.preventDefault(); act(async () => { await api.patch(`/v1/reviews/${encodeURIComponent(r.id)}`, { due_at: dateToEpoch(due.value, true) }); reload(); }); });
  return h("div", { class: "s-tools" }, inv, dueForm,
    h("button", { type: "button", class: "btn-ghost", onClick: () => act(async () => {
      if (!(await confirmDialog("Close this review?", "Reviewers can no longer comment or submit. Their summaries become visible to everyone who can see the request.", "Close review"))) return;
      await api.patch(`/v1/reviews/${encodeURIComponent(r.id)}`, { status: "closed" }); reload();
    }) }, "Close the review"));
}

function submitForm(id, mine, reload) {
  const rec = select("recommendation", RECS, mine.recommendation || "minor");
  const summary = textarea("summary", { rows: 6, maxlength: 10000, value: mine.summary || "" });
  const form = h("form", { class: "s-form" }, h("h3", { class: "s-h3", text: "Your recommendation" }),
    field("Recommendation", rec), field("Summary for the author", summary, "The main strengths, the main problems, and what would fix them."),
    h("button", { type: "submit", class: "btn-primary" }, mine.recommendation ? "Update recommendation" : "Submit recommendation"));
  form.addEventListener("submit", (e) => { e.preventDefault(); act(async () => { await api.post(`/v1/reviews/${encodeURIComponent(id)}/submit`, { recommendation: rec.value, summary: summary.value }); toast("Submitted."); reload(); }); });
  return form;
}

function commentsSection(id, comments, role, closed, reload) {
  const canComment = (role === "reviewer" || role === "requester") && !closed;
  const top = comments.filter((c) => !c.parent_id);
  const replies = (cid) => comments.filter((c) => c.parent_id === cid);
  const draw = (c, depth) => h("li", { class: `s-comment s-sev-${c.severity || "note"}${c.resolved ? " is-resolved" : ""}` },
    h("div", { class: "s-comment-head" }, userChip(c.author, { sub: false }), timeEl(c.created_at),
      c.anchor ? h("span", { class: "s-anchor", title: "Where in the draft" }, `§ ${c.anchor}`) : null,
      depth === 0 ? h("span", { class: "s-kind", text: SEVERITY.find(([v]) => v === c.severity)?.[1] || "General" }) : null,
      c.resolved ? h("span", { class: "s-accepted", text: "Resolved" }) : null),
    h("div", { class: "s-prose" }, String(c.body || "").split(/\n{2,}/).map((t) => h("p", {}, t))),
    h("div", { class: "s-comment-tools" },
      role === "requester" && !c.resolved && depth === 0 && !closed ? h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => { await api.post(`/v1/review-comments/${encodeURIComponent(c.id)}/resolve`, {}); reload(); }) }, "Mark resolved") : null,
      canComment && depth === 0 ? h("button", { type: "button", class: "s-link-btn", onClick: (e) => {
        const li = e.target.closest("li");
        if (!li.querySelector("form")) put(li, commentForm(id, c.id, reload));
      } }, "Reply") : null),
    replies(c.id).length ? h("ol", { class: "s-comments s-replies" }, replies(c.id).map((k) => draw(k, 1))) : null);
  return h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Comments on the draft" }),
    top.length ? h("ol", { class: "s-comments" }, top.map((c) => draw(c, 0))) : empty("No comments yet.", canComment ? "Anchor each comment to a page, section or line so the author can find it." : ""),
    canComment ? commentForm(id, null, reload) : null);
}

function commentForm(id, parentId, reload) {
  const anchor = input("anchor", { placeholder: "e.g. p. 4, §2.3, Fig. 2, line 112" });
  const severity = select("severity", SEVERITY, "general");
  const body = textarea("body", { rows: parentId ? 2 : 4, required: true, maxlength: 10000 });
  const form = h("form", { class: "s-comment-form" },
    parentId ? null : h("div", { class: "s-row-fields" }, field("Where in the draft", anchor), field("Severity", severity)),
    field(parentId ? "Reply" : "Comment", body),
    h("button", { type: "submit", class: "btn-primary s-btn-sm" }, parentId ? "Reply" : "Add comment"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    act(async () => {
      await api.post(`/v1/reviews/${encodeURIComponent(id)}/comments`, { body: body.value, anchor: parentId ? "" : anchor.value, severity: parentId ? "note" : severity.value, parent_id: parentId });
      reload();
    });
  });
  return form;
}
