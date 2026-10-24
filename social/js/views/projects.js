/**
 * #/projects, #/projects/new and #/p/:id — the shareable scientific object.
 * Its workspace is a GeoHUB project manifest; sharing grants a member or a
 * team a role on it (viewer < commenter < forker < editor < owner).
 *
 * Workspace handoff: GeoHUB puts {title, world, manifest} in
 * sessionStorage['geoid:social-workspace'] and opens #/projects/new.
 */
import * as api from "../api.js?v=20261024-07e8f89";
import { store } from "../store.js?v=20261024-07e8f89";
import {
  h, clear, field, input, select, textarea, checkbox, toast, busy, splitList, errorBox, loading, empty,
  confirmDialog, modal, timeEl, dateToEpoch, dateText, put,
} from "../dom.js?v=20261024-07e8f89";
import {
  act, pagedList, postCard, userChip, followButton, tagList, requireSignIn, LICENCES, WORLDS, ROLES, share,
} from "../components.js?v=20261024-07e8f89";

const WS_KEY = "geoid:social-workspace";
// The Worker's four stages (CONTRACT.md): a project grows from an idea into an
// analysis, a shared workspace and a twin without moving. Any other value is
// refused by the Worker, and a select that cannot show the current stage
// defaults to its first option -- which is how "Update stage" once offered to
// turn a workspace back into an idea.
const STAGES = [["idea", "Idea"], ["analysis", "Analysis"], ["workspace", "Shared workspace"], ["twin", "Digital twin"]];
const stageLabel = (s) => STAGES.find(([v]) => v === s)?.[1] || s || "";
const ROLE_HELP = {
  viewer: "can open the workspace and read it",
  commenter: "can also comment",
  forker: "can also make their own copy",
  editor: "can also change it and save new versions",
};

function readWorkspace() {
  try { const v = JSON.parse(sessionStorage.getItem(WS_KEY) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; }
}
function dropWorkspace() { try { sessionStorage.removeItem(WS_KEY); } catch (e) { /* fine */ } }

export function renderList(root, { query }) {
  const tab = ["mine", "shared", "public"].includes(query.tab) ? query.tab : (store.me ? "mine" : "public");
  const q = input("q", { type: "search", value: query.q || "", placeholder: "Search public projects" });
  const form = h("form", { class: "s-inline-form", role: "search" }, field("Search", q), h("button", { type: "submit", class: "btn-ghost" }, "Search"));
  form.addEventListener("submit", (e) => { e.preventDefault(); location.hash = `#/projects?tab=public&q=${encodeURIComponent(q.value)}`; });
  const tabLink = (id, label) => h("a", { href: `#/projects?tab=${id}`, class: id === tab ? "is-active" : "", "aria-current": id === tab ? "page" : null }, label);
  const card = (p) => h("a", { class: "s-card s-link-card", href: `#/p/${encodeURIComponent(p.id)}` },
    h("h2", { class: "s-card-title", text: p.title }),
    p.summary ? h("p", { class: "s-muted", text: p.summary.slice(0, 240) }) : null,
    h("p", { class: "s-hint" }, `${stageLabel(p.stage)} · ${p.world || "earth"}`, p.role ? ` · your role: ${p.role}` : "",
      p.needs_skills?.length ? ` · needs ${p.needs_skills.join(", ")}` : ""));
  const query2 = tab === "mine" ? { mine: 1 } : tab === "shared" ? { shared: 1 } : { q: query.q || "", tag: query.tag || "" };
  const needSignIn = tab !== "public" && !store.me;
  const ws = readWorkspace();
  put(clear(root),
    h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Projects" }), h("a", { class: "btn-primary", href: "#/projects/new" }, "New project")),
    ws ? h("p", { class: "s-banner" }, "A GeoHUB workspace is waiting to be saved. ", h("a", { href: "#/projects/new" }, "Create a project from it")) : null,
    h("p", { class: "s-muted", text: "A project holds a GeoHUB workspace by reference. Share it with a member or a team at a role you choose, with an optional expiry." }),
    h("nav", { class: "s-tabs", "aria-label": "Projects" }, tabLink("mine", "Mine"), tabLink("shared", "Shared with me"), tabLink("public", "Public")),
    tab === "public" ? form : null,
    needSignIn ? empty("Sign in to see your projects.", "Public projects are open to everyone.")
      : pagedList((cursor) => api.get("/v1/projects", { ...query2, cursor }), card,
        { emptyTitle: tab === "mine" ? "You have no projects yet." : tab === "shared" ? "Nothing has been shared with you yet." : "No public projects found." }));
}

export function renderNew(root, { query }) {
  if (!store.me) {
    put(clear(root), h("h1", { class: "s-h1", text: "New project" }), empty("Sign in to create a project."),
      h("button", { type: "button", class: "btn-primary", onClick: () => requireSignIn("create projects") }, "Sign in"));
    return;
  }
  const ws = readWorkspace();
  const f = {
    title: input("title", { required: true, maxlength: 200, value: ws?.title || "" }),
    summary: textarea("summary", { rows: 4, maxlength: 4000 }),
    stage: select("stage", STAGES, "idea"),
    world: select("world", WORLDS.map((w) => [w, w[0].toUpperCase() + w.slice(1)]), ws?.world || "earth"),
    tags: input("tags"),
    needs: input("needs", { placeholder: "e.g. insar, field-mapping" }),
    licence: select("licence", LICENCES, "CC-BY-4.0"),
    visibility: select("visibility", [["private", "Private — only people you grant"], ["team", "Team"], ["public", "Public"]], query.team ? "team" : "private"),
    team: select("team", [["", "No team"], ...(store.me.teams || []).map((t) => [t.slug, t.name])], query.team || ""),
    lat: input("lat", { type: "number", step: "any", min: -90, max: 90 }),
    lon: input("lon", { type: "number", step: "any", min: -180, max: 180 }),
    allowFork: checkbox("allow_fork", "Anyone who can see it may fork it", false),
  };
  let size = 0;
  if (ws?.manifest) size = new Blob([JSON.stringify(ws.manifest)]).size;
  const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
  const form = h("form", { class: "s-form" },
    ws ? h("div", { class: "s-handoff" }, h("p", {}, h("strong", {}, "Workspace from GeoHUB: "), `${ws.title || "untitled"} · ${ws.world || "earth"} · ${(size / 1024).toFixed(1)} KB`),
      size > 48 * 1024 ? h("p", { class: "s-error-title", text: "This workspace is larger than 48 KB and cannot be attached. Save the project without it and keep the workspace on your disk." }) : h("p", { class: "s-hint", text: "It becomes version 1." }),
      h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => { dropWorkspace(); renderNew(root, { query }); } }, "Discard the workspace")) : null,
    field("Title", f.title), field("Summary", f.summary), field("Stage", f.stage), field("World", f.world),
    field("Tags", f.tags), field("Skills you need", f.needs, "Shown to people looking for projects to join."),
    h("div", { class: "s-row-fields" }, field("Latitude (optional)", f.lat), field("Longitude", f.lon)),
    h("p", { class: "s-hint", text: "A project's location is shown approximately (to about 11 km) on the map." }),
    field("Licence", f.licence), field("Visibility", f.visibility), field("Team", f.team), f.allowFork,
    status, h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Create project"), h("a", { class: "btn-ghost", href: "#/projects" }, "Cancel")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!f.title.value.trim()) { status.textContent = "Give the project a title."; return; }
    if (f.visibility.value === "team" && !f.team.value) { status.textContent = "Choose the team."; return; }
    const done = busy(form);
    try {
      const hasLoc = f.lat.value !== "" && f.lon.value !== "";
      const p = await api.post("/v1/projects", {
        title: f.title.value, summary: f.summary.value, stage: f.stage.value, world: f.world.value,
        location: hasLoc ? { lat: Number(f.lat.value), lon: Number(f.lon.value), precision: "approx" } : null,
        tags: splitList(f.tags.value), licence: f.licence.value, visibility: f.visibility.value,
        allow_fork: f.allowFork.querySelector("input").checked, team_slug: f.team.value || undefined,
        needs_skills: splitList(f.needs.value),
        workspace: ws?.manifest && size <= 48 * 1024 ? ws.manifest : undefined,
      });
      if (ws) dropWorkspace();
      toast("Project created.");
      location.hash = `#/p/${encodeURIComponent(p.id || p.project?.id)}`;
    } catch (error) { done(); status.textContent = error.message; status.classList.add("is-error"); }
  });
  put(clear(root), h("h1", { class: "s-h1", text: "New project" }), form);
}

export async function renderOne(root, { params }) {
  const id = params.id;
  put(clear(root), loading());
  let data;
  try { data = await api.get(`/v1/projects/${encodeURIComponent(id)}`); } catch (error) {
    put(clear(root), errorBox(error, () => renderOne(root, { params }))); return;
  }
  const p = data.project || {};
  const role = data.access?.role || "public";
  const rank = { public: 0, viewer: 1, commenter: 2, forker: 3, editor: 4, owner: 5 }[role] || 0;
  const reload = () => renderOne(root, { params });
  document.title = `${p.title} — GeoID Network`;
  const world = p.world || "earth";

  const actions = h("div", { class: "s-actions" },
    h("a", { class: "btn-primary", href: `/?world=${encodeURIComponent(world)}&project=${encodeURIComponent(p.id)}` }, "Open in GeoHUB"),
    h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => share(`${location.origin}/social/#/p/${encodeURIComponent(p.id)}`, p.title) }, "Copy link"),
    store.me && role !== "owner" ? followButton("project", p.id, false) : null,
    // Collaboration track: invite specialists to join, review, contribute or validate.
    h("a", { class: "btn-ghost s-btn-sm", href: `#/requests?new=1&project=${encodeURIComponent(p.id)}` }, "Ask for help…"),
    (rank >= 3 || p.allow_fork) && role !== "owner" ? h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
      if (!(await confirmDialog("Fork this project", "You get your own copy of the latest workspace, credited to this one. Changes you make do not affect the original.", "Fork"))) return;
      const fork = await api.post(`/v1/projects/${encodeURIComponent(p.id)}/fork`, {});
      toast("Forked."); location.hash = `#/p/${encodeURIComponent(fork.id || fork.project?.id)}`;
    }, "fork projects") }, "Fork") : null,
    role === "owner" || role === "editor" ? h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => shareDialog(p, role, data.grants || [], reload) }, "Share…") : null,
    role === "owner" ? h("button", { type: "button", class: "btn-ghost s-btn-sm s-danger", onClick: () => act(async () => {
      if (!(await confirmDialog("Delete this project?", "Every grant is revoked. Posts linked to it stay, without the link. Your local GeoHUB files are not touched.", "Delete"))) return;
      await api.del(`/v1/projects/${encodeURIComponent(p.id)}`); toast("Deleted."); location.hash = "#/projects";
    }) }, "Delete") : null);

  const versions = data.versions || [];
  put(clear(root),
    h("header", { class: "s-community-head" },
      h("p", { class: "s-labels" }, h("span", { class: "s-kind", text: "Project" }), h("span", { class: "s-vis", text: stageLabel(p.stage) }),
        h("span", { class: "s-vis", text: p.visibility || "" }), p.forked_from ? h("a", { class: "s-vis", href: `#/p/${encodeURIComponent(p.forked_from)}` }, "Forked") : null),
      h("h1", { class: "s-h1", text: p.title }),
      p.owner ? h("div", { class: "s-byline" }, userChip(p.owner)) : null,
      p.summary ? h("div", { class: "s-prose" }, String(p.summary).split(/\n{2,}/).map((t) => h("p", {}, t))) : null,
      h("p", { class: "s-muted" }, `World: ${world}`, p.licence ? ` · Licence: ${p.licence}` : "", ` · Your access: ${role === "public" ? "public reader" : role}`),
      p.needs_skills?.length ? h("p", {}, "Looking for: ", p.needs_skills.join(", ")) : null,
      tagList(p.tags), actions),
    role === "owner" || role === "editor" ? stageEditor(p, reload) : null,
    h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Workspace versions" }),
      versions.length ? h("ol", { class: "s-versions", reversed: true }, versions.slice().sort((a, b) => b.version - a.version).map((v) => h("li", {},
        h("strong", {}, `v${v.version}`), " ", timeEl(v.created_at), v.by ? h("span", { class: "s-muted" }, ` by @${v.by.handle || v.by}`) : null,
        v.note ? h("span", {}, ` — ${v.note}`) : null,
        rank >= 1 ? h("a", { class: "s-link-btn", href: `/?world=${encodeURIComponent(world)}&project=${encodeURIComponent(p.id)}&version=${encodeURIComponent(v.version)}` }, "Open this version") : null)))
        : h("p", { class: "s-muted", text: "No workspace saved yet. Open GeoHUB, build the view, and share it back as a new version." }),
      role === "owner" || role === "editor" ? newVersion(p, reload) : null),
    h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Posts from this project" }),
      (data.posts || []).length ? h("div", { class: "s-list" }, data.posts.map(postCard)) : h("p", { class: "s-muted", text: "No posts linked yet." }),
      rank >= 2 ? h("a", { class: "btn-ghost", href: `#/compose?project=${encodeURIComponent(p.id)}` }, "Post an update") : null));
}

function stageEditor(p, reload) {
  const stage = select("stage", STAGES, p.stage);
  const form = h("form", { class: "s-inline-form" }, field("Stage", stage), h("button", { type: "submit", class: "btn-ghost s-btn-sm" }, "Update stage"));
  form.addEventListener("submit", (e) => { e.preventDefault(); act(async () => { await api.patch(`/v1/projects/${encodeURIComponent(p.id)}`, { stage: stage.value }); toast("Updated."); reload(); }); });
  return form;
}

function newVersion(p, reload) {
  const ws = readWorkspace();
  if (!ws?.manifest) {
    return h("p", { class: "s-hint", text: "New versions come from GeoHUB: open the Projects page there, find this project (it shows as linked to Social) and use Push new version. People it is shared with see an Update from Social button." });
  }
  const note = input("note", { maxlength: 200, placeholder: "What changed" });
  const form = h("form", { class: "s-inline-form" }, h("p", {}, `A workspace from GeoHUB is waiting (${ws.title || "untitled"}).`), field("Version note", note),
    h("button", { type: "submit", class: "btn-primary s-btn-sm" }, "Save as a new version"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    act(async () => { await api.post(`/v1/projects/${encodeURIComponent(p.id)}/versions`, { manifest: ws.manifest, note: note.value }); dropWorkspace(); toast("Saved. Followers are told."); reload(); });
  });
  return form;
}

function shareDialog(p, myRole, grants, reload) {
  if (!requireSignIn("share projects")) return;
  modal(`Share “${p.title}”`, (close) => {
    const who = select("who", [["handle", "A member"], ["team", "A team"]], "handle");
    const handle = input("handle", { placeholder: "handle", autocomplete: "off" });
    const team = input("team", { placeholder: "team-slug", list: "s-my-teams" });
    const teamList = h("datalist", { id: "s-my-teams" }, (store.me?.teams || []).map((t) => h("option", { value: t.slug }, t.name)));
    const allowed = myRole === "owner" ? ROLES : ROLES.filter((r) => r === "viewer" || r === "commenter");
    const role = select("role", allowed.map((r) => [r, `${r[0].toUpperCase()}${r.slice(1)} — ${ROLE_HELP[r]}`]), "viewer");
    const expires = input("expires", { type: "date" });
    const handleField = field("Member's handle", handle);
    const teamField = field("Team", team, "Every active member of the team gets this role.");
    const sync = () => { handleField.hidden = who.value !== "handle"; teamField.hidden = who.value !== "team"; };
    who.addEventListener("change", sync);
    const list = h("ul", { class: "s-rows" });
    const drawGrants = () => {
      clear(list);
      if (!grants.length) put(list, h("li", { class: "s-muted", text: "Not shared with anyone yet." }));
      grants.forEach((g) => put(list, h("li", { class: "s-row" },
        h("span", {}, g.grantee?.type === "team" ? `Team ${g.grantee.name || g.grantee.slug}` : `@${g.grantee?.handle}${g.grantee?.name ? ` (${g.grantee.name})` : ""}`),
        h("span", { class: "s-kind", text: g.role }),
        g.expires_at ? h("span", { class: "s-muted", text: `until ${dateText(g.expires_at)}` }) : h("span", { class: "s-muted", text: "no expiry" }),
        myRole === "owner" ? h("button", { type: "button", class: "s-link-btn s-danger", onClick: () => act(async () => {
          await api.del(`/v1/projects/${encodeURIComponent(p.id)}/grants/${encodeURIComponent(g.id)}`);
          grants.splice(grants.indexOf(g), 1); drawGrants(); toast("Access revoked.");
        }) }, "Revoke") : null)));
    };
    drawGrants();
    const form = h("form", {}, field("Share with", who), handleField, teamField, teamList, field("Role", role),
      field("Expires (optional)", expires, "Access ends at the end of that day."),
      h("p", { class: "s-hint", text: myRole === "owner" ? "Every grant and revocation is recorded in the audit log." : "As an editor you can grant viewer or commenter access." }),
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Grant access")));
    sync();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      try {
        const body = { role: role.value, expires_at: dateToEpoch(expires.value, true) };
        if (who.value === "handle") body.handle = handle.value.replace(/^@/, "").trim(); else body.team_slug = team.value.trim();
        const g = await api.post(`/v1/projects/${encodeURIComponent(p.id)}/grants`, body);
        grants.push(g); drawGrants(); form.reset(); sync(); toast("Shared.");
      } catch (error) { toast(error.message, "error"); }
      done();
    });
    return h("div", {}, form, h("h3", { class: "s-h3", text: "Who has access" }), list,
      h("div", { class: "s-actions" }, h("button", { type: "button", class: "btn-ghost", onClick: () => { close(); reload(); } }, "Done")));
  }, { wide: true });
}
