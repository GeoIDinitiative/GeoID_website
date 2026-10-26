/**
 * #/requests and #/requests/:id — asking for help.
 *
 * A member invites specialists to join a project, review a method,
 * contribute a dataset or validate a model: named people, a community, or
 * anyone with the skills listed. Named people accept or decline; anybody else
 * offers and the requester chooses. Acceptance opens a conversation; when the
 * work is done the requester acknowledges it, and that credit counts on the
 * helper's profile (Accepted contributions).
 *
 * Entry points: "Ask for help…" on a post and on a project open
 * #/requests?new=1&post=<id> or &project=<id>.
 */
import * as api from "../api.js?v=20261026-0d92fc8";
import { store } from "../store.js?v=20261026-0d92fc8";
import {
  h, clear, field, input, select, textarea, toast, busy, splitList, errorBox, loading, empty, modal,
  timeEl, dateToEpoch, dateText, put,
} from "../dom.js?v=20261026-0d92fc8";
import { act, pagedList, userChip, requireSignIn, confirmDialog } from "../components.js?v=20261026-0d92fc8";

export const REQUEST_KINDS = [
  ["join_project", "Join a project"], ["review_method", "Review a method"], ["contribute_dataset", "Contribute a dataset"],
  ["validate_model", "Validate a model"], ["other", "Other help"],
];
const STATUS = {
  open: "Open", accepted: "Accepted", declined: "Declined", in_progress: "In progress", completed: "Completed", withdrawn: "Withdrawn",
};
const AUDIENCE = { member: "People named", community: "A community", everyone: "Anyone" };
const PART = { invited: "Asked", offered: "Offered", accepted: "Helping", declined: "Declined" };
const kindLabel = (k) => REQUEST_KINDS.find(([v]) => v === k)?.[1] || k || "Help";
const enc = encodeURIComponent;

export function render(root, { params, query }) {
  if (params.id) return renderOne(root, params.id);
  if (query.new) return renderNew(root, query);
  return renderList(root, query);
}

// ── List ───────────────────────────────────────────────────────────────────

function requestCard(r) {
  return h("a", { class: "s-card s-link-card s-request-card", href: `#/requests/${enc(r.id)}` },
    h("p", { class: "s-labels" }, h("span", { class: "s-kind", text: kindLabel(r.kind) }),
      h("span", { class: `s-vis s-req-${r.status}`, text: STATUS[r.status] || r.status }),
      r.my_status ? h("span", { class: "s-vis", text: `You: ${PART[r.my_status] || r.my_status}` }) : null),
    h("h2", { class: "s-card-title", text: r.title || "Untitled request" }),
    r.detail ? h("p", { class: "s-muted", text: String(r.detail).slice(0, 240) }) : null,
    r.skills?.length ? h("ul", { class: "s-chips", "aria-label": "Skills wanted" }, r.skills.map((s) => h("li", { class: "s-chip", text: s }))) : null,
    h("p", { class: "s-hint" },
      r.requester ? `from @${r.requester.handle}` : "",
      r.team ? ` for ${r.team.name}` : "",
      r.community ? ` · in ${r.community.name}` : "",
      r.due_at ? ` · due ${dateText(r.due_at)}` : "",
      r.counts?.helpers ? ` · ${r.counts.helpers} helping` : ""));
}

function renderList(root, query) {
  const tab = ["open", "asked", "helping", "mine"].includes(query.role) ? query.role : "open";
  const tabLink = (id, label) => h("a", { href: `#/requests?role=${id}`, class: id === tab ? "is-active" : "", "aria-current": id === tab ? "page" : null }, label);
  const skill = input("skill", { value: query.skill || "", placeholder: "e.g. insar" });
  const kind = select("kind", [["", "Any kind"], ...REQUEST_KINDS], query.kind || "");
  const filters = h("form", { class: "s-filters", "aria-label": "Filter requests" }, field("Skill", skill), field("Kind", kind),
    h("button", { type: "submit", class: "btn-primary" }, "Filter"));
  filters.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new URLSearchParams({ role: tab });
    if (skill.value.trim()) q.set("skill", skill.value.trim());
    if (kind.value) q.set("kind", kind.value);
    location.hash = `#/requests?${q.toString()}`;
  });
  const needSignIn = tab !== "open" && !store.me;
  put(clear(root),
    h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Requests for help" }),
      h("a", { class: "btn-primary", href: "#/requests?new=1" }, "Ask for help")),
    h("p", { class: "s-muted", text: "Invite specialists to join a project, review a method, contribute a dataset or validate a model. Help that is finished and acknowledged counts on the helper's profile." }),
    h("nav", { class: "s-tabs", "aria-label": "Requests" }, tabLink("open", "Open"), tabLink("asked", "Asked of me"),
      tabLink("helping", "Helping"), tabLink("mine", "Mine")),
    filters,
    needSignIn ? empty("Sign in to see your requests.", "Open requests are listed for everyone.")
      : pagedList((cursor) => api.get("/v1/requests", { role: tab, skill: query.skill || "", kind: query.kind || "", cursor }), requestCard, {
        emptyTitle: tab === "open" ? "No open requests match." : tab === "asked" ? "Nobody has asked you for help yet."
          : tab === "helping" ? "You are not helping with anything yet." : "You have not asked for help yet.",
        emptyDetail: tab === "open" ? "Clear a filter, or ask for help yourself." : "",
      }));
}

// ── New ────────────────────────────────────────────────────────────────────

async function renderNew(root, query) {
  if (!store.me) {
    put(clear(root), h("h1", { class: "s-h1", text: "Ask for help" }), empty("Sign in to ask for help."),
      h("button", { type: "button", class: "btn-primary", onClick: () => requireSignIn("ask for help") }, "Sign in"));
    return;
  }
  // What the request is about, when it came from a post or a project.
  let about = null;
  try {
    if (query.post) {
      const p = await api.get(`/v1/posts/${enc(query.post)}`);
      about = { post_id: p.id, label: p.title || "a post", href: `#/post/${enc(p.id)}`, skills: p.tags || [] };
    } else if (query.project) {
      const d = await api.get(`/v1/projects/${enc(query.project)}`);
      const pr = d.project || {};
      about = { project_id: pr.id, label: pr.title || "a project", href: `#/p/${enc(pr.id)}`, skills: pr.needs_skills || [], role: d.access?.role };
    }
  } catch (error) { toast(`Could not load what this is about: ${error.message}`, "error"); }
  const canInviteToProject = about?.project_id && ["owner", "editor"].includes(about.role);
  const f = {
    kind: select("kind", REQUEST_KINDS.filter(([v]) => v !== "join_project" || canInviteToProject),
      canInviteToProject ? "join_project" : "other"),
    title: input("title", { required: true, maxlength: 200, placeholder: "e.g. Check the unwrapping in my Etna InSAR workflow" }),
    detail: textarea("detail", { rows: 5, maxlength: 5000 }),
    skills: input("skills", { value: (about?.skills || []).join(", "), placeholder: "insar, python" }),
    audience: select("audience", [["member", "Only the people I name"], ["community", "Members of a community"], ["everyone", "Anyone on GeoID Network"]], "member"),
    handles: input("handles", { placeholder: "handles, comma-separated", autocomplete: "off" }),
    community: select("community", [["", "Choose"], ...(store.me.communities || []).map((c) => [c.slug, c.name])], ""),
    team: select("team", [["", "Just me"], ...(store.me.teams || []).map((t) => [t.slug, t.name])], ""),
    due: input("due", { type: "date" }),
  };
  const handlesF = field("Ask these people", f.handles, "They are notified and can accept or decline. You can also open the request to a community or to everyone.");
  const commF = field("Community", f.community);
  const sync = () => { commF.hidden = f.audience.value !== "community"; };
  f.audience.addEventListener("change", sync); sync();
  const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
  const form = h("form", { class: "s-form" },
    about ? h("p", { class: "s-banner" }, "About ", h("a", { href: about.href }, about.label)) : null,
    field("What kind of help", f.kind), field("Title", f.title), field("Details", f.detail, "What is the work, what do you have already, and what would done look like?"),
    field("Skills wanted", f.skills), field("Who may answer", f.audience), handlesF, commF,
    store.me.teams?.length ? field("Asking on behalf of", f.team) : null,
    field("Due date (optional)", f.due),
    status,
    h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Send request"),
      h("a", { class: "btn-ghost", href: about ? about.href : "#/requests" }, "Cancel")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    status.classList.remove("is-error");
    if (!f.title.value.trim()) { status.textContent = "Give the request a title."; return; }
    const handles = splitList(f.handles.value).map((s) => s.replace(/^@/, ""));
    if (f.audience.value === "member" && !handles.length) { status.textContent = "Name at least one person, or open it to a community or to everyone."; return; }
    if (f.audience.value === "community" && !f.community.value) { status.textContent = "Choose the community."; return; }
    const done = busy(form);
    try {
      const out = await api.post("/v1/requests", {
        kind: f.kind.value, title: f.title.value, detail: f.detail.value, skills: splitList(f.skills.value),
        audience: f.audience.value, handles,
        community_slug: f.audience.value === "community" ? f.community.value : undefined,
        team_slug: f.team.value || undefined, due_at: dateToEpoch(f.due.value, true),
        post_id: about?.post_id, project_id: about?.project_id,
      });
      location.hash = `#/requests/${enc(out.request.id)}`;
    } catch (error) { done(); status.textContent = error.message; status.classList.add("is-error"); }
  });
  put(clear(root), h("h1", { class: "s-h1", text: "Ask for help" }), form);
}

// ── One request ────────────────────────────────────────────────────────────

/** A short message, asked for in a dialog; resolves with the text ("" allowed) or undefined if cancelled. */
function askMessage(title, label, hint, okLabel) {
  return modal(title, (close) => {
    const t = textarea("message", { rows: 4, maxlength: 5000 });
    const f = h("form", {}, field(label, t, hint),
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, okLabel),
        h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
    f.addEventListener("submit", (e) => { e.preventDefault(); close(t.value); });
    return f;
  });
}

async function renderOne(root, rid) {
  put(clear(root), loading());
  let data;
  try { data = await api.get(`/v1/requests/${enc(rid)}`); } catch (error) {
    put(clear(root), errorBox(error, () => renderOne(root, rid))); return;
  }
  const r = data.request || {};
  const role = data.viewer_role || "reader";
  const reload = () => renderOne(root, rid);
  const path = `/v1/requests/${enc(rid)}`;
  document.title = `${r.title || "Request"} — GeoID Network`;

  const setStatus = (to, confirmText) => act(async () => {
    if (confirmText && !(await confirmDialog(STATUS[to], confirmText, STATUS[to]))) return;
    await api.patch(path, { status: to });
    toast(`Marked ${String(STATUS[to] || to).toLowerCase()}.`);
    reload();
  }, "update requests");

  const actions = h("div", { class: "s-actions" });
  if (role === "requester") {
    if (["accepted", "in_progress"].includes(r.status)) {
      if (r.status === "accepted") put(actions, h("button", { type: "button", class: "btn-ghost", onClick: () => setStatus("in_progress") }, "Mark in progress"));
      put(actions, h("button", { type: "button", class: "btn-primary", onClick: () => setStatus("completed", "Mark the work as completed? You can then acknowledge each helper's contribution.") }, "Mark completed"));
    }
    if (["declined", "withdrawn"].includes(r.status)) put(actions, h("button", { type: "button", class: "btn-ghost", onClick: () => setStatus("open") }, "Reopen"));
    if (!["completed", "withdrawn"].includes(r.status)) {
      put(actions, h("button", { type: "button", class: "btn-ghost s-danger", onClick: () => setStatus("withdrawn", "Withdraw this request? The people on it are told.") }, "Withdraw"));
    }
  } else if (role === "helper") {
    if (r.status === "accepted") put(actions, h("button", { type: "button", class: "btn-ghost", onClick: () => setStatus("in_progress") }, "Mark in progress"));
    if (["accepted", "in_progress"].includes(r.status)) put(actions, h("button", { type: "button", class: "btn-primary", onClick: () => setStatus("completed", "Mark the work as completed? The person who asked is told.") }, "Mark completed"));
  } else if (data.my_status === "invited" && ["open", "accepted", "in_progress"].includes(r.status)) {
    put(actions,
      h("button", { type: "button", class: "btn-primary", onClick: () => act(async () => {
        const message = await askMessage("Accept this request", "A note to the person who asked (optional)", "A conversation with them opens when you accept.", "Accept");
        if (message === undefined) return;
        const out = await api.post(`${path}/respond`, { accept: true, message });
        toast("Accepted. A conversation is open.");
        if (out.conversation_id) location.hash = `#/messages/${enc(out.conversation_id)}`; else reload();
      }, "answer requests") }, "Accept"),
      h("button", { type: "button", class: "btn-ghost", onClick: () => act(async () => {
        const message = await askMessage("Decline this request", "A note to the person who asked (optional)", "", "Decline");
        if (message === undefined) return;
        await api.post(`${path}/respond`, { accept: false, message });
        toast("Declined.");
        reload();
      }, "answer requests") }, "Decline"));
  } else if (data.my_status === "offered") {
    put(actions, h("p", { class: "s-hint", text: "You offered to help. The person who asked will choose." }),
      h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
        await api.post(`${path}/respond`, { accept: false }); toast("Offer withdrawn."); reload();
      }, "answer requests") }, "Withdraw my offer"));
  } else if (r.status === "open" && r.audience !== "member" && data.my_status !== "declined") {
    put(actions, h("button", { type: "button", class: "btn-primary", onClick: () => act(async () => {
      const message = await askMessage("Offer to help", "What can you bring?", "Say what you have done that fits. The person who asked chooses whom to work with.", "Send offer");
      if (message === undefined) return;
      await api.post(`${path}/respond`, { accept: true, message });
      toast("Offer sent.");
      reload();
    }, "offer help") }, "Offer to help"));
  }
  if (data.conversation_id) put(actions, h("a", { class: "btn-ghost", href: `#/messages/${enc(data.conversation_id)}` }, "Open the conversation"));

  put(clear(root),
    h("header", { class: "s-community-head" },
      h("p", { class: "s-labels" }, h("span", { class: "s-kind", text: kindLabel(r.kind) }),
        h("span", { class: `s-vis s-req-${r.status}`, text: STATUS[r.status] || r.status }),
        h("span", { class: "s-vis", text: AUDIENCE[r.audience] || r.audience })),
      h("h1", { class: "s-h1", text: r.title || "Request" }),
      h("div", { class: "s-byline" }, userChip(r.requester), timeEl(r.created_at),
        r.team ? h("span", { class: "s-muted" }, " on behalf of ", h("a", { href: `#/t/${enc(r.team.slug)}` }, r.team.name)) : null),
      r.detail ? h("div", { class: "s-prose" }, String(r.detail).split(/\n{2,}/).map((t) => h("p", {}, t))) : null,
      r.skills?.length ? h("div", { class: "s-skills-wanted" }, "Skills wanted: ", h("ul", { class: "s-chips" }, r.skills.map((s) => h("li", { class: "s-chip" },
        h("a", { href: `#/requests?skill=${enc(s)}` }, s))))) : null,
      h("p", { class: "s-muted" },
        r.community ? h("span", {}, "In ", h("a", { href: `#/c/${enc(r.community.slug)}` }, r.community.name), " · ") : null,
        r.post ? h("span", {}, "About ", h("a", { href: `#/post/${enc(r.post.id)}` }, r.post.title || "a post"), " · ") : null,
        r.project ? h("span", {}, "Project ", h("a", { href: `#/p/${enc(r.project.id)}` }, r.project.title), " · ") : null,
        r.due_at ? `Due ${dateText(r.due_at)}` : "No due date"),
      actions),
    peopleSection(r, data, role, path, reload),
    role === "requester" && !["completed", "withdrawn"].includes(r.status) ? requesterTools(r, path, reload) : null,
    threadSection(data, role, path, reload));
}

function peopleSection(r, data, role, path, reload) {
  const parts = data.participants || [];
  const list = h("ul", { class: "s-rows" });
  for (const p of parts) {
    const tools = h("span", { class: "s-row-tools" });
    if (role === "requester" && p.status === "offered" && ["open", "accepted", "in_progress"].includes(r.status)) {
      put(tools,
        h("button", { type: "button", class: "btn-primary s-btn-sm", onClick: () => act(async () => {
          await api.post(`${path}/choose`, { handle: p.user.handle, accept: true });
          toast(`@${p.user.handle} is helping. A conversation is open.`); reload();
        }) }, "Accept offer"),
        h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
          await api.post(`${path}/choose`, { handle: p.user.handle, accept: false }); reload();
        }) }, "Decline"));
    }
    if (role === "requester" && p.status === "accepted" && r.status === "completed" && !p.acknowledged) {
      put(tools, h("button", { type: "button", class: "btn-primary s-btn-sm", onClick: () => act(async () => {
        const note = await askMessage(`Acknowledge @${p.user.handle}`, "What did they contribute? (optional)",
          "This is recorded as a contribution on their profile, and they are told.", "Acknowledge");
        if (note === undefined) return;
        await api.post(`${path}/acknowledge`, { handle: p.user.handle, note });
        toast("Acknowledged. Thank you for crediting them."); reload();
      }) }, "Acknowledge contribution"));
    }
    put(list, h("li", { class: "s-row" }, userChip(p.user),
      h("span", { class: "s-kind", text: PART[p.status] || p.status }),
      p.acknowledged ? h("span", { class: "s-accepted", text: "Contribution acknowledged" }) : null,
      tools));
  }
  return h("section", { class: "s-section", "aria-labelledby": "rq-people" },
    h("h2", { class: "s-h2", id: "rq-people", text: "People" }),
    parts.length ? list : h("p", { class: "s-muted", text: r.audience === "member" ? "Nobody yet." : "Nobody has offered yet." }),
    role === "requester" ? h("p", { class: "s-hint", text: "Offers and invitations are visible only to you and the person concerned; the people helping are named to everyone who can see this request." }) : null);
}

function requesterTools(r, path, reload) {
  const handle = input("handle", { placeholder: "handle", autocomplete: "off" });
  const inv = h("form", { class: "s-inline-form" }, field("Ask someone else", handle), h("button", { type: "submit", class: "btn-ghost" }, "Ask"));
  inv.addEventListener("submit", (e) => {
    e.preventDefault();
    act(async () => { await api.post(`${path}/invite`, { handle: handle.value.replace(/^@/, "") }); toast("Asked."); reload(); });
  });
  const results = h("div", { class: "s-match-results", "aria-live": "polite" });
  const suggest = h("button", { type: "button", class: "btn-ghost", onClick: () => act(async () => {
    put(clear(results), loading("Looking for people…"));
    const out = await api.post("/v1/match", { skills: r.skills || [], project_id: r.project?.id });
    const items = out?.items || [];
    clear(results);
    if (!items.length) { put(results, empty("No suggestions.", "The matcher only suggests people who opted in and are open to collaboration.")); return; }
    put(results, h("ul", { class: "s-match-list" }, items.map((m) => h("li", {},
      h("div", { class: "s-row" }, userChip(m.user),
        h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: (ev) => act(async () => {
          await api.post(`${path}/invite`, { handle: m.user.handle });
          ev.target.disabled = true; ev.target.textContent = "Asked";
        }) }, "Ask")),
      h("ul", { class: "s-reasons" }, (m.reasons || []).map((t) => h("li", { text: t })))))),
    out.note ? h("p", { class: "s-hint", text: out.note }) : null);
  }, "use the collaboration matcher") }, "Suggest people");
  return h("section", { class: "s-section", "aria-labelledby": "rq-find" },
    h("h2", { class: "s-h2", id: "rq-find", text: "Find people" }),
    inv,
    r.skills?.length || r.project ? h("div", {}, suggest, h("p", { class: "s-hint", text: "Suggestions come from the collaboration matcher, using the skills wanted" + (r.project ? " and the project's needs." : ".") }), results) : null);
}

function threadSection(data, role, path, reload) {
  if (role === "reader") return null;
  const items = data.responses || [];
  const KIND = { offer: "Offer", accept: "Accepted", decline: "Declined", status: "Update", message: "" };
  const list = h("ol", { class: "s-comments" }, items.map((x) => h("li", { class: "s-comment" },
    h("div", { class: "s-comment-head" }, userChip(x.author, { sub: false }), timeEl(x.created_at),
      KIND[x.kind] ? h("span", { class: "s-kind", text: KIND[x.kind] }) : null),
    x.body ? h("div", { class: "s-prose" }, String(x.body).split(/\n{2,}/).map((t) => h("p", {}, t))) : null)));
  const body = textarea("body", { rows: 3, maxlength: 5000, required: true });
  const form = h("form", { class: "s-comment-form" }, field(role === "requester" ? "Write to the people on this request" : "Write to the person who asked", body),
    h("button", { type: "submit", class: "btn-primary s-btn-sm" }, "Send"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!body.value.trim()) return;
    const done = busy(form);
    try { await api.post(`${path}/messages`, { body: body.value }); reload(); } catch (error) { toast(error.message, "error"); done(); }
  });
  return h("section", { class: "s-section", "aria-labelledby": "rq-thread" },
    h("h2", { class: "s-h2", id: "rq-thread", text: "On this request" }),
    items.length ? list : h("p", { class: "s-muted", text: "Nothing said yet." }),
    form,
    h("p", { class: "s-hint", text: "Longer work belongs in the conversation that opens when somebody is accepted." }));
}

