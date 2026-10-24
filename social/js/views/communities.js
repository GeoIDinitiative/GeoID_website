/** #/communities and #/c/:slug — forums with rules, FAQ, resources, members and events. */
import * as api from "../api.js?v=20261024-9257ceb";
import { store, refreshMe } from "../store.js?v=20261024-9257ceb";
import {
  h, clear, field, input, select, textarea, toast, busy, splitList, errorBox, loading, empty, confirmDialog, extLink, modal, put,
} from "../dom.js?v=20261024-9257ceb";
import { act, pagedList, postCard, userChip, followButton, tagList, requireSignIn } from "../components.js?v=20261024-9257ceb";

export function renderList(root) {
  const list = h("div", { class: "s-list" }, loading());
  api.get("/v1/communities").then((data) => {
    clear(list);
    const items = data?.items || [];
    if (!items.length) put(list, empty("No communities yet.", "Start one for your field, region or method."));
    items.forEach((c) => put(list, h("a", { class: "s-card s-link-card", href: `#/c/${encodeURIComponent(c.slug)}` },
      h("h2", { class: "s-card-title", text: c.name }),
      c.description ? h("p", { class: "s-muted", text: c.description }) : null,
      h("p", { class: "s-hint" }, `${c.member_count || 0} members · ${c.visibility === "approval" ? "join on approval" : c.visibility === "private" ? "private" : "open"}`,
        c.role ? ` · you are ${c.role === "member" ? "a member" : `a ${c.role}`}` : ""))));
  }).catch((error) => put(clear(list), errorBox(error)));

  const createBtn = h("button", { type: "button", class: "btn-ghost", onClick: () => createDialog() }, "Start a community");
  put(clear(root), h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Communities" }), createBtn),
    h("p", { class: "s-muted", text: "Forums for a field, a method or a place: questions with accepted answers, discussions, resources and events." }),
    list);
}

function createDialog() {
  if (!requireSignIn("start a community")) return;
  modal("Start a community", (close) => {
    const name = input("name", { required: true, maxlength: 80 });
    const slug = input("slug", { pattern: "[a-z0-9-]{3,40}", placeholder: "volcano-geodesy" });
    const desc = textarea("description", { rows: 3, maxlength: 1000 });
    const tags = input("tags");
    const vis = select("visibility", [["open", "Open — anyone can join"], ["approval", "Approval — moderators approve members"], ["private", "Private — invitation only, hidden from others"]], "open");
    const form = h("form", {}, field("Name", name), field("Short address", slug, "Lower-case letters, numbers and dashes."),
      field("What is it for?", desc), field("Tags", tags), field("Who can join", vis),
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Create"),
        h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      try {
        const c = await api.post("/v1/communities", { name: name.value, slug: slug.value || undefined, description: desc.value, tags: splitList(tags.value), visibility: vis.value });
        close(true); await refreshMe();
        location.hash = `#/c/${encodeURIComponent(c.slug || c.community?.slug)}`;
      } catch (error) { toast(error.message, "error"); done(); }
    });
    return form;
  });
}

export async function renderOne(root, { params, query }) {
  const slug = params.slug;
  put(clear(root), loading());
  let data;
  try { data = await api.get(`/v1/communities/${encodeURIComponent(slug)}`); } catch (error) {
    put(clear(root), errorBox(error, () => renderOne(root, { params, query }))); return;
  }
  const c = data.community || data;
  // The API answers viewer:{role,status}; an approval-pending member is "requested".
  const v = data.viewer || null;
  const role = v ? (v.status === "active" ? v.role : v.status === "requested" ? "requested" : null) : (data.role ?? c.role ?? null);
  const isMod = role === "owner" || role === "moderator";
  const isMember = !!role && role !== "requested";
  const tab = ["threads", "about", "members", "events"].includes(query.tab) ? query.tab : "threads";
  const kind = ["question", "discussion"].includes(query.kind) ? query.kind : "";
  document.title = `${c.name} — GeoID Network`;

  const join = h("div", { class: "s-actions" });
  if (!role) {
    put(join, h("button", { type: "button", class: "btn-primary", onClick: () => act(async () => {
      const out = await api.post(`/v1/communities/${encodeURIComponent(slug)}/join`, {});
      toast(out?.status === "requested" ? "Requested — a moderator will review it." : "Joined.");
      await refreshMe(); renderOne(root, { params, query });
    }, "join communities") }, c.visibility === "approval" ? "Ask to join" : "Join"));
  } else if (role === "requested") {
    put(join, h("span", { class: "s-muted", text: "Your request to join is waiting for a moderator." }));
  } else {
    put(join, h("a", { class: "btn-primary", href: `#/compose?kind=discussion&community=${encodeURIComponent(slug)}` }, "New thread"),
      h("a", { class: "btn-ghost", href: `#/compose?kind=question&community=${encodeURIComponent(slug)}` }, "Ask a question"),
      role !== "owner" ? h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
        if (!(await confirmDialog(`Leave ${c.name}?`, "You can rejoin later if it is open.", "Leave"))) return;
        await api.post(`/v1/communities/${encodeURIComponent(slug)}/leave`, {});
        await refreshMe(); renderOne(root, { params, query });
      }, "leave") }, "Leave") : null);
  }
  put(join, store.me ? followButton("community", slug, false) : null);

  const tabLink = (t, label) => h("a", { href: `#/c/${encodeURIComponent(slug)}?tab=${t}`, class: t === tab ? "is-active" : "", "aria-current": t === tab ? "page" : null }, label);
  const body = h("div");

  put(clear(root),
    h("header", { class: "s-community-head" },
      h("h1", { class: "s-h1", text: c.name }),
      c.description ? h("p", { class: "s-lead", text: c.description }) : null,
      h("p", { class: "s-muted" }, `${c.member_count || 0} members`, role ? ` · you are ${role === "member" ? "a member" : role === "requested" ? "waiting for approval" : `the ${role}`}` : ""),
      tagList(c.tags), join),
    h("nav", { class: "s-tabs", "aria-label": "Community" }, tabLink("threads", "Threads"), tabLink("about", "Rules & resources"), tabLink("members", "Members"), tabLink("events", "Events")),
    body);

  if (tab === "threads") {
    const pinned = data.pinned || [];
    if (pinned.length) put(body, h("section", { class: "s-section" }, h("h2", { class: "s-h3", text: "Pinned" }),
      h("div", { class: "s-list" }, pinned.map((p) => withModTools(postCard(p), p, slug, isMod, true)))));
    const chip = (k, label) => h("a", { class: `s-chip${k === kind ? " is-on" : ""}`, href: `#/c/${encodeURIComponent(slug)}?tab=threads${k ? `&kind=${k}` : ""}` }, label);
    put(body, h("div", { class: "s-chips" }, chip("", "All"), chip("question", "Questions"), chip("discussion", "Discussions")),
      pagedList((cursor) => api.get("/v1/feed", { tab: "all", community: slug, kind, cursor }), (p) => withModTools(postCard(p), p, slug, isMod, false),
        { emptyTitle: "No threads yet.", emptyDetail: isMember ? "Start the first one." : "Join to start a thread." }));
    if (data.channels?.length) put(body, h("section", { class: "s-section" }, h("h2", { class: "s-h3", text: "Channels" }),
      h("ul", { class: "s-plain" }, data.channels.map((ch) => h("li", {}, h("a", { href: `#/c/${encodeURIComponent(ch.slug)}` }, ch.name))))));
  } else if (tab === "about") {
    put(body, about(data, c, isMod, slug, () => renderOne(root, { params, query })));
  } else if (tab === "members") {
    put(body, members(slug, isMod));
  } else {
    put(body, pagedList((cursor) => api.get("/v1/events", { community: slug, from: Math.floor(Date.now() / 1000), cursor }), postCard,
      { emptyTitle: "No upcoming events.", emptyDetail: isMember ? "Post an event to the community from New post." : "" }),
    isMember ? h("a", { class: "btn-ghost", href: `#/compose?kind=event&community=${encodeURIComponent(slug)}` }, "Post an event") : null);
  }
}

function withModTools(card, p, slug, isMod, pinned) {
  if (!isMod) return card;
  put(card, h("div", { class: "s-mod-tools" },
    h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => {
      if (pinned) await api.del(`/v1/communities/${encodeURIComponent(slug)}/pin/${encodeURIComponent(p.id)}`);
      else await api.post(`/v1/communities/${encodeURIComponent(slug)}/pin/${encodeURIComponent(p.id)}`, {});
      toast(pinned ? "Unpinned." : "Pinned."); location.hash = `#/c/${encodeURIComponent(slug)}?tab=threads&r=${Date.now()}`;
    }) }, pinned ? "Unpin" : "Pin"),
    h("a", { class: "s-link-btn", href: "#/mod" }, "Reports")));
  return card;
}

function listOf(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) return v.split(/\n+/).filter(Boolean);
  return [];
}

function about(data, c, isMod, slug, reload) {
  const rules = listOf(data.rules ?? c.rules);
  const faq = listOf(data.faq ?? c.faq);
  const resources = listOf(data.resources ?? c.resources);
  const box = h("div", { class: "s-about" },
    h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Rules" }),
      rules.length ? h("ol", {}, rules.map((r) => h("li", { text: typeof r === "string" ? r : r.text || "" }))) : h("p", { class: "s-muted", text: "No rules written yet. The site-wide terms apply." })),
    h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "FAQ" }),
      faq.length ? h("dl", { class: "s-dl" }, faq.map((q) => typeof q === "string" ? [h("dt", { text: q }), h("dd", {})] : [h("dt", { text: q.q || "" }), h("dd", { text: q.a || "" })])) : h("p", { class: "s-muted", text: "Nothing here yet." })),
    h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Resources" }),
      resources.length ? h("ul", {}, resources.map((r) => h("li", {}, typeof r === "string" ? r : extLink(r.url, r.label || r.title || r.url)))) : h("p", { class: "s-muted", text: "Nothing here yet." })),
    h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Moderators" }),
      (data.moderators || []).length ? h("ul", { class: "s-rows" }, data.moderators.map((m) => h("li", { class: "s-row" }, userChip(m.user || m)))) : h("p", { class: "s-muted", text: "—" })));
  if (isMod) {
    const r = textarea("rules", { rows: 5, value: rules.map((x) => (typeof x === "string" ? x : x.text)).join("\n") });
    const fq = textarea("faq", { rows: 5, value: faq.map((x) => (typeof x === "string" ? x : `${x.q} | ${x.a}`)).join("\n") });
    const rs = textarea("resources", { rows: 4, value: resources.map((x) => (typeof x === "string" ? x : `${x.label || x.title || ""} | ${x.url}`)).join("\n") });
    const d = textarea("description", { rows: 3, value: c.description || "" });
    const form = h("form", { class: "s-form" }, h("h2", { class: "s-h2", text: "Moderator: edit" }),
      field("Description", d), field("Rules (one per line)", r), field("FAQ (one per line: question | answer)", fq),
      field("Resources (one per line: title | https://link)", rs),
      h("button", { type: "submit", class: "btn-primary" }, "Save"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      try {
        await api.patch(`/v1/communities/${encodeURIComponent(slug)}`, {
          description: d.value,
          rules: r.value.split("\n").map((s) => s.trim()).filter(Boolean).join("\n"),
          faq: fq.value.split("\n").filter((s) => s.trim()).map((line) => { const [q, ...a] = line.split("|"); return { q: q.trim(), a: a.join("|").trim() }; }),
          resources: rs.value.split("\n").filter((s) => s.trim()).map((line) => { const [t, ...u] = line.split("|"); return { label: t.trim(), url: u.join("|").trim() }; }),
        });
        toast("Saved."); reload();
      } catch (error) { toast(error.message, "error"); done(); }
    });
    put(box, form);
  }
  return box;
}

function members(slug, isMod) {
  const box = h("div");
  const q = input("q", { type: "search", placeholder: "Name or handle" });
  const skill = input("skill", { placeholder: "Skill" });
  const out = h("div");
  const load = (status = "") => {
    put(clear(out), pagedList((cursor) => api.get(`/v1/communities/${encodeURIComponent(slug)}/members`, { q: q.value, skill: skill.value, status, cursor }),
      (m) => {
        const u = m.user || m;
        const row = h("div", { class: "s-card s-person" }, userChip(u),
          m.role && m.role !== "member" ? h("span", { class: "s-kind", text: m.role }) : null,
          m.skills?.length || u.skills?.length ? h("p", { class: "s-muted", text: `Skills: ${(m.skills || u.skills).join(", ")}` }) : null);
        if (isMod) {
          const setM = (body, msg) => act(async () => { await api.post(`/v1/communities/${encodeURIComponent(slug)}/members/${encodeURIComponent(u.handle)}`, body); toast(msg); load(status); });
          put(row, h("div", { class: "s-mod-tools" },
            status === "requested" ? h("button", { type: "button", class: "s-link-btn", onClick: () => setM({ status: "active" }, "Approved.") }, "Approve") : null,
            m.role !== "moderator" && m.role !== "owner" ? h("button", { type: "button", class: "s-link-btn", onClick: () => setM({ role: "moderator" }, "Promoted.") }, "Make moderator") : null,
            m.role === "moderator" ? h("button", { type: "button", class: "s-link-btn", onClick: () => setM({ role: "member" }, "Now a member.") }, "Remove moderator") : null,
            m.role !== "owner" ? h("button", { type: "button", class: "s-link-btn s-danger", onClick: async () => {
              if (await confirmDialog(`Ban @${u.handle}?`, "They are removed and cannot rejoin.", "Ban")) setM({ status: "banned" }, "Banned.");
            } }, "Ban") : null));
        }
        return row;
      }, { emptyTitle: status === "requested" ? "No requests waiting." : "No members match." }));
  };
  const form = h("form", { class: "s-inline-form", role: "search" }, field("Search members", q), field("Skill", skill),
    h("button", { type: "submit", class: "btn-ghost" }, "Filter"));
  form.addEventListener("submit", (e) => { e.preventDefault(); load(); });
  put(box, form);
  if (isMod) {
    const inv = input("handle", { placeholder: "handle" });
    const invForm = h("form", { class: "s-inline-form" }, field("Invite by handle", inv), h("button", { type: "submit", class: "btn-ghost" }, "Invite"),
      h("button", { type: "button", class: "btn-ghost", onClick: () => load("requested") }, "Show join requests"));
    invForm.addEventListener("submit", (e) => {
      e.preventDefault();
      act(async () => { await api.post(`/v1/communities/${encodeURIComponent(slug)}/members/${encodeURIComponent(inv.value.replace(/^@/, ""))}`, { status: "invited" }); toast("Invited."); inv.value = ""; });
    });
    put(box, invForm);
  }
  put(box, out);
  load();
  return box;
}

