/** #/teams and #/t/:slug — members and roles, invites, a task board, team chat and projects. */
import * as api from "../api.js?v=20261023-5f60cff";
import { store, myHandle, refreshMe } from "../store.js?v=20261023-5f60cff";
import { h, clear, field, input, select, textarea, toast, busy, errorBox, loading, empty, confirmDialog, modal, put } from "../dom.js?v=20261023-5f60cff";
import { act, userChip, pagedList, requireSignIn } from "../components.js?v=20261023-5f60cff";
import { chatPanel } from "../chat.js?v=20261023-5f60cff";

const TEAM_ROLES = [["lead", "Lead"], ["editor", "Editor"], ["member", "Member"], ["viewer", "Viewer (read-only)"]];

export function renderList(root, { query }) {
  const q = input("q", { type: "search", value: query.q || "", placeholder: "Search public teams" });
  const form = h("form", { class: "s-inline-form", role: "search" }, field("Find a team", q), h("button", { type: "submit", class: "btn-ghost" }, "Search"));
  form.addEventListener("submit", (e) => { e.preventDefault(); location.hash = `#/teams?q=${encodeURIComponent(q.value)}`; });
  const card = (t) => h("a", { class: "s-card s-link-card", href: `#/t/${encodeURIComponent(t.slug)}` },
    h("h2", { class: "s-card-title", text: t.name }), t.description ? h("p", { class: "s-muted", text: t.description }) : null,
    h("p", { class: "s-hint" }, `${t.member_count || (t.members || []).length || 0} members`, t.role ? ` · you: ${t.role}` : "", t.status === "invited" ? " · you are invited" : ""));
  const mine = store.me ? h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Your teams" }),
    pagedList((cursor) => api.get("/v1/teams", { mine: 1, cursor }), card, { emptyTitle: "You are not in a team yet.", emptyDetail: "Create one, or ask to join a public team." })) : null;
  const pub = h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: query.q ? `Teams matching “${query.q}”` : "Public teams" }),
    pagedList((cursor) => api.get("/v1/teams", { q: query.q || "", cursor }), card, { emptyTitle: "No public teams found." }));
  put(clear(root), h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Teams" }),
    h("button", { type: "button", class: "btn-ghost", onClick: createDialog }, "Create a team")),
  h("p", { class: "s-muted", text: "A team works together: shared projects, a task board and a private chat." }), form, mine, pub);
}

function createDialog() {
  if (!requireSignIn("create a team")) return;
  modal("Create a team", (close) => {
    const name = input("name", { required: true, maxlength: 80 });
    const slug = input("slug", { pattern: "[a-z0-9-]{3,40}" });
    const desc = textarea("description", { rows: 3, maxlength: 1000 });
    const vis = select("visibility", [["public", "Public — listed, people can ask to join"], ["private", "Private — invitation only"]], "private");
    const form = h("form", {}, field("Name", name), field("Short address", slug, "Optional. Lower-case letters, numbers and dashes."), field("Purpose", desc), field("Visibility", vis),
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Create"), h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      try {
        const t = await api.post("/v1/teams", { name: name.value, slug: slug.value || undefined, description: desc.value, visibility: vis.value });
        close(true); await refreshMe();
        location.hash = `#/t/${encodeURIComponent(t.slug || t.team?.slug)}`;
      } catch (error) { toast(error.message, "error"); done(); }
    });
    return form;
  });
}

export async function renderOne(root, { params, query }) {
  const slug = params.slug;
  put(clear(root), loading());
  let data;
  try { data = await api.get(`/v1/teams/${encodeURIComponent(slug)}`); } catch (error) {
    put(clear(root), errorBox(error, () => renderOne(root, { params, query }))); return undefined;
  }
  const t = data.team || data;
  const membersList = data.members || [];
  const meRow = data.viewer || membersList.find((m) => (m.user || m).handle === myHandle());
  const myRole = meRow?.status === "active" ? meRow.role : null;
  const invited = meRow?.status === "invited";
  const isLead = myRole === "lead";
  const canEdit = myRole === "lead" || myRole === "editor" || myRole === "member";
  const tab = ["board", "chat", "members", "projects"].includes(query.tab) ? query.tab : (myRole ? "board" : "members");
  document.title = `${t.name} — GeoID Network`;
  const reload = () => renderOne(root, { params, query });

  const head = h("header", { class: "s-community-head" }, h("h1", { class: "s-h1", text: t.name }),
    t.description ? h("p", { class: "s-lead", text: t.description }) : null,
    h("p", { class: "s-muted" }, `${membersList.filter((m) => m.status === "active").length} members · ${t.visibility === "public" ? "public team" : "private team"}`, myRole ? ` · you: ${myRole}` : ""));
  const actions = h("div", { class: "s-actions" });
  if (invited) {
    put(actions, h("p", {}, "You have been invited to this team."),
      h("button", { type: "button", class: "btn-primary", onClick: () => act(async () => { await api.post(`/v1/teams/${encodeURIComponent(slug)}/respond`, { accept: true }); await refreshMe(); reload(); }) }, "Accept"),
      h("button", { type: "button", class: "btn-ghost", onClick: () => act(async () => { await api.post(`/v1/teams/${encodeURIComponent(slug)}/respond`, { accept: false }); location.hash = "#/teams"; }) }, "Decline"));
  } else if (!myRole && t.visibility === "public") {
    put(actions, meRow?.status === "requested" ? h("span", { class: "s-muted", text: "Request sent — a lead will decide." })
      : h("button", { type: "button", class: "btn-primary", onClick: () => act(async () => { await api.post(`/v1/teams/${encodeURIComponent(slug)}/request`, {}); toast("Request sent."); reload(); }, "join teams") }, "Ask to join"));
  }
  put(head, actions);
  const tabLink = (id, label) => h("a", { href: `#/t/${encodeURIComponent(slug)}?tab=${id}`, class: id === tab ? "is-active" : "", "aria-current": id === tab ? "page" : null }, label);
  const body = h("div");
  put(clear(root), head, h("nav", { class: "s-tabs", "aria-label": "Team" },
    myRole ? tabLink("board", "Tasks") : null, myRole ? tabLink("chat", "Chat") : null, tabLink("members", "Members"), tabLink("projects", "Projects")), body);

  if (tab === "board" && myRole) return board(body, slug, canEdit && myRole !== "viewer", membersList);
  if (tab === "chat" && myRole) {
    if (!data.conversation_id) { put(body, empty("This team has no chat yet.")); return undefined; }
    const chat = chatPanel(data.conversation_id, { canSend: myRole !== "viewer", label: "Team chat" });
    put(body, chat.el);
    return chat.stop;
  }
  if (tab === "projects") {
    const projects = data.projects || [];
    put(body, projects.length ? h("div", { class: "s-list" }, projects.map((p) => h("a", { class: "s-card s-link-card", href: `#/p/${encodeURIComponent(p.id)}` }, h("strong", {}, p.title), h("span", { class: "s-muted" }, ` · ${p.stage || ""}`))))
      : empty("No team projects yet.", "Create a project and choose this team, or grant the team a role on an existing project."),
    myRole ? h("a", { class: "btn-ghost", href: `#/projects/new?team=${encodeURIComponent(slug)}` }, "New team project") : null);
    return undefined;
  }
  // members
  const list = h("ul", { class: "s-rows" });
  membersList.forEach((m) => {
    const u = m.user || m;
    const row = h("li", { class: "s-row" }, userChip(u), h("span", { class: "s-kind", text: m.role }),
      m.status !== "active" ? h("span", { class: "s-muted", text: m.status }) : null);
    if (isLead && u.handle !== myHandle()) {
      const roleSel = select("role", TEAM_ROLES, m.role);
      roleSel.setAttribute("aria-label", `Role for ${u.handle}`);
      roleSel.addEventListener("change", () => act(async () => { await api.post(`/v1/teams/${encodeURIComponent(slug)}/members/${encodeURIComponent(u.handle)}`, { role: roleSel.value }); toast("Role changed."); }));
      put(row, roleSel,
        m.status === "requested" ? h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => { await api.post(`/v1/teams/${encodeURIComponent(slug)}/members/${encodeURIComponent(u.handle)}`, { status: "active" }); reload(); }) }, "Approve") : null,
        h("button", { type: "button", class: "s-link-btn s-danger", onClick: () => act(async () => {
          if (!(await confirmDialog(`Remove @${u.handle}?`, "They lose access to the team's chat, tasks and team-shared projects.", "Remove"))) return;
          await api.del(`/v1/teams/${encodeURIComponent(slug)}/members/${encodeURIComponent(u.handle)}`); reload();
        }) }, "Remove"));
    }
    put(list, row);
  });
  put(body, list);
  if (myRole === "lead" || myRole === "editor") {
    const handle = input("handle", { required: true, placeholder: "handle" });
    const role = select("role", TEAM_ROLES.filter(([r]) => isLead || r !== "lead"), "member");
    const form = h("form", { class: "s-inline-form" }, field("Invite by handle", handle), field("Role", role), h("button", { type: "submit", class: "btn-primary" }, "Invite"));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      act(async () => { await api.post(`/v1/teams/${encodeURIComponent(slug)}/invite`, { handle: handle.value.replace(/^@/, ""), role: role.value }); toast("Invitation sent."); reload(); });
    });
    put(body, form);
  }
  if (myRole && !isLead) {
    put(body, h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
      if (!(await confirmDialog("Leave this team?", "You lose access to its chat, tasks and team-shared projects.", "Leave"))) return;
      await api.del(`/v1/teams/${encodeURIComponent(slug)}/members/${encodeURIComponent(myHandle())}`); await refreshMe(); location.hash = "#/teams";
    }) }, "Leave team"));
  }
  return undefined;
}

function board(body, slug, canEdit, membersList) {
  const cols = { todo: "To do", doing: "Doing", done: "Done" };
  const grid = h("div", { class: "s-board" });
  const load = async () => {
    put(clear(grid), loading());
    let tasks = [];
    try { const d = await api.get(`/v1/teams/${encodeURIComponent(slug)}/tasks`); tasks = d?.items || []; } catch (error) { put(clear(grid), errorBox(error, load)); return; }
    clear(grid);
    for (const [status, label] of Object.entries(cols)) {
      const mine = tasks.filter((t) => (t.status || "todo") === status);
      put(grid, h("section", { class: "s-board-col", "aria-labelledby": `col-${status}` },
        h("h2", { class: "s-h3", id: `col-${status}` }, `${label} (${mine.length})`),
        h("ul", { class: "s-plain" }, mine.map((t) => h("li", { class: "s-task" },
          h("strong", {}, t.title), t.detail ? h("p", { class: "s-muted", text: t.detail }) : null,
          t.assignee ? h("p", { class: "s-hint" }, "Assigned to @", (t.assignee.handle || t.assignee)) : null,
          canEdit ? h("div", { class: "s-task-tools" },
            Object.entries(cols).filter(([s]) => s !== status).map(([s, l]) => h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => { await api.patch(`/v1/tasks/${encodeURIComponent(t.id)}`, { status: s }); load(); }) }, `→ ${l}`)),
            h("button", { type: "button", class: "s-link-btn s-danger", "aria-label": `Delete task ${t.title}`, onClick: () => act(async () => { await api.del(`/v1/tasks/${encodeURIComponent(t.id)}`); load(); }) }, "Delete")) : null)))));
    }
  };
  put(body, grid);
  if (canEdit) {
    const title = input("title", { required: true, maxlength: 200 });
    const detail = input("detail", { maxlength: 1000 });
    const assignee = select("assignee", [["", "Nobody"], ...membersList.filter((m) => m.status === "active").map((m) => [(m.user || m).handle, `@${(m.user || m).handle}`])], "");
    const form = h("form", { class: "s-inline-form" }, field("New task", title), field("Detail", detail), field("Assign to", assignee), h("button", { type: "submit", class: "btn-primary" }, "Add"));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      act(async () => { await api.post(`/v1/teams/${encodeURIComponent(slug)}/tasks`, { title: title.value, detail: detail.value, assignee: assignee.value || null, status: "todo" }); form.reset(); load(); });
    });
    put(body, form);
  } else put(body, h("p", { class: "s-hint", text: "Your role is read-only on the task board." }));
  load();
  return undefined;
}
