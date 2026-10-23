/**
 * #/orgs and #/o/:slug — organisations: universities, surveys, companies and
 * agencies. A directory with search, an organisation's page (members,
 * admins, opportunities it posted), and the forms to propose, edit, join and
 * post as one.
 *
 * "Verified" on an organisation means a site admin checked it. "Verified
 * affiliation" on a member means their sign-in address belongs to one of a
 * verified organisation's domains -- the address itself is never shown.
 */
import * as api from "../api.js?v=20261023-8493bfa";
import { store, refreshMe } from "../store.js?v=20261023-8493bfa";
import {
  h, clear, field, input, select, textarea, toast, busy, splitList, errorBox, loading, empty, extLink, modal,
  confirmDialog, dateToEpoch, put,
} from "../dom.js?v=20261023-8493bfa";
import {
  act, pagedList, postCard, userChip, followButton, requireSignIn, OPP_TYPES, plural,
} from "../components.js?v=20261023-8493bfa";

export const ORG_KINDS = [["university", "University"], ["survey", "Geological survey"], ["agency", "Government agency"],
  ["company", "Company"], ["nonprofit", "Non-profit"], ["other", "Other"]];
const kindLabel = (k) => (ORG_KINDS.find(([v]) => v === k) || [k, k])[1];

/** The router sends both #/orgs and #/o/:slug here. */
export function render(root, ctx) {
  return ctx.params.slug ? renderOne(root, ctx) : renderList(root, ctx);
}

function orgLogo(org, size = 48) {
  if (org.logo) return h("img", { class: "s-org-logo", src: org.logo, alt: "", width: size, height: size, loading: "lazy" });
  const initials = String(org.name || "?").split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join("").slice(0, 3) || "?";
  return h("span", { class: "s-org-logo s-org-logo-txt", "aria-hidden": "true", style: `width:${size}px;height:${size}px` }, initials);
}

export function orgVerifiedBadge(org) {
  return org.verified
    ? h("span", { class: "s-verified", title: "Checked by GeoID Network's admins" }, "Verified organisation")
    : h("span", { class: "s-selfdecl", title: "Proposed by members and not yet checked by GeoID Network's admins" }, "Unverified");
}

// ── Directory ──────────────────────────────────────────────────────────────

function renderList(root, { query }) {
  const q = input("q", { type: "search", value: query.q || "", placeholder: "Name, place or domain" });
  const kind = select("kind", [["", "Any kind"], ...ORG_KINDS], query.kind || "");
  const verifiedOnly = h("input", { type: "checkbox", name: "verified", checked: query.verified === "1" });
  const form = h("form", { class: "s-filters", role: "search", "aria-label": "Find organisations" },
    field("Search", q), field("Kind", kind),
    h("label", { class: "s-check" }, verifiedOnly, h("span", {}, "Verified only")),
    h("button", { type: "submit", class: "btn-primary" }, "Find"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (q.value.trim()) p.set("q", q.value.trim());
    if (kind.value) p.set("kind", kind.value);
    if (verifiedOnly.checked) p.set("verified", "1");
    if (query.pending === "1") p.set("pending", "1");
    location.hash = `#/orgs?${p.toString()}`;
  });

  const tabs = store.me?.admin ? h("nav", { class: "s-tabs", "aria-label": "Directory" },
    h("a", { href: "#/orgs", class: query.pending === "1" ? "" : "is-active" }, "All"),
    h("a", { href: "#/orgs?pending=1", class: query.pending === "1" ? "is-active" : "" }, "Waiting for verification")) : null;

  const list = pagedList(
    (cursor) => api.get("/v1/orgs", { q: query.q, kind: query.kind, verified: query.verified === "1", pending: query.pending === "1", cursor }),
    (o) => h("a", { class: "s-card s-link-card s-org-card", href: `#/o/${encodeURIComponent(o.slug)}` },
      orgLogo(o, 44),
      h("div", { class: "s-org-card-text" },
        h("h2", { class: "s-card-title", text: o.name }),
        h("p", { class: "s-labels" }, orgVerifiedBadge(o), h("span", { class: "s-kind", text: kindLabel(o.kind) }),
          o.member ? h("span", { class: "s-vis", text: "You are a member" }) : null),
        h("p", { class: "s-hint" }, [o.location, plural(o.member_count || 0, "member")].filter(Boolean).join(" · ")))),
    { emptyTitle: query.pending === "1" ? "Nothing is waiting for verification." : "No organisations match.",
      emptyDetail: query.pending === "1" ? "" : "Propose yours: it is listed straight away and marked unverified until an admin checks it." });

  put(clear(root),
    h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Organisations" }),
      h("button", { type: "button", class: "btn-ghost", onClick: () => orgDialog(null) }, "Propose an organisation")),
    h("p", { class: "s-muted", text: "Universities, geological surveys, agencies and companies. Join yours to show your affiliation: it is marked verified when your sign-in address belongs to a verified organisation's domain, and self-declared otherwise." }),
    tabs, form, list);
}

// ── Propose / edit ─────────────────────────────────────────────────────────

function orgDialog(existing, { locked = false, onSaved } = {}) {
  if (!requireSignIn(existing ? "edit organisations" : "propose an organisation")) return;
  modal(existing ? `Edit ${existing.name}` : "Propose an organisation", (close) => {
    const f = {
      name: input("name", { required: true, maxlength: 120, value: existing?.name || "", disabled: locked }),
      slug: input("slug", { pattern: "[a-z0-9][a-z0-9-]{1,39}", maxlength: 40, placeholder: "university-of-leeds" }),
      kind: select("kind", ORG_KINDS, existing?.kind || "university"),
      domains: input("domains", { value: (existing?.domains || []).join(", "), placeholder: "leeds.ac.uk", disabled: locked }),
      website: input("website", { type: "url", value: existing?.website || "" }),
      location: input("location", { maxlength: 120, value: existing?.location || "" }),
      description: textarea("description", { rows: 4, maxlength: 2000, value: existing?.description || "" }),
    };
    const logo = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp" });
    let logoKey = null;
    logo.addEventListener("change", async () => {
      const file = logo.files?.[0];
      if (!file) return;
      try { logoKey = (await api.upload(file, { scope: "public" })).key; toast("Logo uploaded; save to use it."); } catch (error) { toast(error.message, "error"); }
    });
    const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
    const form = h("form", {},
      field("Name", f.name, locked ? "A verified organisation's name and domains are changed by the site admins." : null),
      existing ? null : field("Short address (optional)", f.slug, "Lower-case letters, numbers and dashes. Made from the name if left empty."),
      field("Kind", f.kind),
      field("Email domains", f.domains, "Comma-separated, e.g. leeds.ac.uk. Members whose sign-in address is at one of these (or a subdomain) get a verified affiliation once the organisation is verified. Free mail providers are refused."),
      field("Website", f.website), field("Location", f.location), field("About", f.description),
      field("Logo (optional)", logo, "PNG, JPEG or WebP. Anyone can see it."),
      existing ? null : h("p", { class: "s-hint", text: "It is listed straight away, marked unverified, and you become its first admin. GeoID Network's admins verify organisations." }),
      status,
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, existing ? "Save" : "Propose"),
        h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      const body = { kind: f.kind.value, website: f.website.value, location: f.location.value, description: f.description.value };
      if (!locked) { body.name = f.name.value; body.domains = splitList(f.domains.value); }
      if (!existing && f.slug.value.trim()) body.slug = f.slug.value.trim().toLowerCase();
      if (logoKey) body.logo_key = logoKey;
      try {
        const out = existing
          ? await api.patch(`/v1/orgs/${encodeURIComponent(existing.slug)}`, body)
          : await api.post("/v1/orgs", body);
        close(true);
        await refreshMe();
        toast(existing ? "Saved." : "Proposed. It is listed as unverified until an admin checks it.");
        if (onSaved) onSaved(out); else location.hash = `#/o/${encodeURIComponent(out.org.slug)}`;
      } catch (error) { done(); status.textContent = error.message; status.classList.add("is-error"); }
    });
    return form;
  }, { wide: true });
}

// ── One organisation ───────────────────────────────────────────────────────

async function renderOne(root, { params, query }) {
  const slug = String(params.slug || "").toLowerCase();
  put(clear(root), loading());
  let data;
  try { data = await api.get(`/v1/orgs/${encodeURIComponent(slug)}`); } catch (error) {
    put(clear(root), errorBox(error, () => renderOne(root, { params, query }))); return;
  }
  const o = data.org;
  const v = data.viewer || {};
  const again = () => renderOne(root, { params, query });
  document.title = `${o.name} — GeoID Network`;

  const actions = h("div", { class: "s-actions" });
  if (v.member) {
    put(actions,
      h("span", { class: v.verified ? "s-verified" : "s-selfdecl" }, v.verified ? "Your affiliation is verified" : "Your affiliation is self-declared"),
      h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
        if (!(await confirmDialog(`Leave ${o.name}?`, "Your affiliation is removed from your profile and cards.", "Leave"))) return;
        await api.post(`/v1/orgs/${encodeURIComponent(o.slug)}/leave`, {});
        await refreshMe(); toast(`You left ${o.name}.`); again();
      }, "leave organisations") }, "Leave"));
  } else {
    put(actions, h("button", { type: "button", class: "btn-primary", onClick: () => act(async () => {
      const out = await api.post(`/v1/orgs/${encodeURIComponent(o.slug)}/join`, {});
      await refreshMe();
      toast(out.verified ? `Joined. Your affiliation with ${o.name} is verified.` : "Joined. Your affiliation is shown as self-declared.");
      again();
    }, "join organisations") }, "I work or study here"));
  }
  put(actions, followButton("org", o.slug, v.following));
  if (v.can_edit) {
    put(actions, h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => orgDialog(o, { locked: v.locked, onSaved: again }) }, "Edit"));
  }
  if (v.site_admin) {
    put(actions, h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
      const on = !o.verified;
      if (!(await confirmDialog(on ? `Verify ${o.name}?` : `Withdraw verification from ${o.name}?`,
        on ? "Check the name and that every listed domain really belongs to this organisation: members at those domains become verified affiliates at once."
          : "Every verified affiliation with this organisation becomes self-declared.", on ? "Verify" : "Withdraw"))) return;
      await api.post(`/v1/orgs/${encodeURIComponent(o.slug)}/verify`, { verified: on });
      toast(on ? "Verified." : "Verification withdrawn."); again();
    }, "verify organisations") }, o.verified ? "Withdraw verification" : "Verify"));
  }
  if (v.site_admin || (v.can_edit && !o.verified)) {
    put(actions, h("button", { type: "button", class: "btn-ghost s-btn-sm s-danger", onClick: () => act(async () => {
      if (!(await confirmDialog(`Remove ${o.name}?`, "The page goes, every member's affiliation with it is removed, and its posts stop showing it.", "Remove"))) return;
      await api.del(`/v1/orgs/${encodeURIComponent(o.slug)}`);
      await refreshMe(); toast("Removed."); location.hash = "#/orgs";
    }, "remove organisations") }, "Remove"));
  }

  const posts = h("section", { class: "s-section", "aria-labelledby": "op-h" },
    h("div", { class: "s-title-row" }, h("h2", { class: "s-h2", id: "op-h", text: "Opportunities and events" }),
      v.can_post ? h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => postDialog(o, again) }, `Post as ${o.name}`) : null));
  const items = data.posts || [];
  if (!items.length) put(posts, empty("Nothing posted as this organisation yet.", v.can_post ? "As an admin you can post jobs, studentships, grants and events as the organisation." : ""));
  else put(posts, h("div", { class: "s-list" }, items.map(postCard)));

  const members = h("section", { class: "s-section", "aria-labelledby": "om-h" },
    h("h2", { class: "s-h2", id: "om-h", text: "Members" }),
    h("p", { class: "s-hint", text: "“Verified” means the member's sign-in address belongs to one of this organisation's domains. Nobody's address is shown." }),
    pagedList((cursor) => api.get(`/v1/orgs/${encodeURIComponent(o.slug)}/members`, { cursor }),
      (m) => memberRow(o, m, v, again), { emptyTitle: "No members yet.", listClass: "s-rows" }));

  put(clear(root),
    h("header", { class: "s-profile-head" },
      orgLogo(o, 88),
      h("div", { class: "s-profile-id" },
        h("h1", { class: "s-h1", text: o.name }),
        h("p", { class: "s-labels" }, orgVerifiedBadge(o), h("span", { class: "s-kind", text: kindLabel(o.kind) })),
        h("p", { class: "s-muted" }, [o.location, plural(data.counts?.members || 0, "member"), plural(data.counts?.followers || 0, "follower")].filter(Boolean).join(" · ")),
        actions)),
    h("div", { class: "s-grid-main" },
      h("div", {},
        o.description ? h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "About" }),
          h("div", { class: "s-prose" }, String(o.description).split(/\n{2,}/).map((t) => h("p", {}, t)))) : null,
        posts, members),
      h("aside", { class: "s-side" },
        h("h2", { class: "s-side-title", text: "Details" }),
        o.website ? h("p", {}, extLink(o.website, "Website")) : null,
        o.domains?.length ? h("p", {}, h("span", { class: "s-muted", text: "Email domains: " }), o.domains.join(", ")) : null,
        h("h2", { class: "s-side-title", text: "Admins" }),
        (data.admins || []).length ? h("ul", { class: "s-rows" }, data.admins.map((u) => h("li", { class: "s-row" }, userChip(u)))) : h("p", { class: "s-muted", text: "None listed." }),
        o.verified ? null : h("p", { class: "s-hint", text: "This organisation was proposed by a member and has not been checked yet. Affiliations with it are self-declared." }))));
}

function memberRow(org, m, viewer, again) {
  const li = h("div", { class: "s-row" }, userChip(m.user),
    m.verified ? h("span", { class: "s-verified", text: "Verified affiliation" }) : h("span", { class: "s-selfdecl", text: "Self-declared" }),
    m.role === "admin" ? h("span", { class: "s-kind", text: "Admin" }) : null);
  if (viewer.can_edit && m.user) {
    const handle = m.user.handle;
    put(li,
      h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => {
        await api.post(`/v1/orgs/${encodeURIComponent(org.slug)}/members/${encodeURIComponent(handle)}`, { role: m.role === "admin" ? "member" : "admin" });
        toast(m.role === "admin" ? "No longer an admin." : "Now an admin."); again();
      }, "manage members") }, m.role === "admin" ? "Remove admin" : "Make admin"),
      h("button", { type: "button", class: "s-link-btn s-danger", onClick: () => act(async () => {
        if (!(await confirmDialog(`Remove @${handle}?`, "Their affiliation with this organisation is removed.", "Remove"))) return;
        await api.del(`/v1/orgs/${encodeURIComponent(org.slug)}/members/${encodeURIComponent(handle)}`);
        li.remove();
      }, "manage members") }, "Remove"));
  }
  return li;
}

/** An admin posts an opportunity or event as the organisation. */
function postDialog(org, onDone) {
  modal(`Post as ${org.name}`, (close) => {
    const f = {
      kind: select("kind", [["opportunity", "Opportunity"], ["event", "Event"]], "opportunity"),
      title: input("title", { required: true, maxlength: 300 }),
      body: textarea("body", { rows: 5, maxlength: 20000 }),
      type: select("type", OPP_TYPES.map((t) => [t, t]), "job"),
      deadline: input("deadline", { type: "date" }),
      apply: input("apply_url", { type: "url", placeholder: "https://…" }),
      skills: input("skills", { placeholder: "insar, python" }),
    };
    const paid = h("input", { type: "checkbox", name: "paid", checked: true });
    const oppOnly = h("div", {}, field("Type", f.type), h("div", { class: "s-row-fields" }, field("Deadline", f.deadline), field("Apply at", f.apply)),
      field("Skills", f.skills, "Comma-separated."), h("label", { class: "s-check" }, paid, h("span", {}, "Paid")));
    f.kind.addEventListener("change", () => { oppOnly.hidden = f.kind.value !== "opportunity"; });
    const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
    const form = h("form", {}, field("Kind", f.kind), field("Title", f.title), field("Details", f.body), oppOnly,
      h("p", { class: "s-hint", text: `Shown as posted by ${org.name}, with you as the author. Followers of the organisation are told.` }),
      status,
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Post"),
        h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      const body = { kind: f.kind.value, title: f.title.value, body: f.body.value, visibility: "public" };
      if (f.kind.value === "opportunity") {
        body.meta = { type: f.type.value, org: org.name, deadline: dateToEpoch(f.deadline.value, true), apply_url: f.apply.value,
          skills: splitList(f.skills.value), paid: paid.checked };
      }
      try {
        const p = await api.post(`/v1/orgs/${encodeURIComponent(org.slug)}/posts`, body);
        close(true); toast("Posted.");
        if (p?.id) location.hash = `#/post/${encodeURIComponent(p.id)}`; else onDone();
      } catch (error) { done(); status.textContent = error.message; status.classList.add("is-error"); }
    });
    return form;
  }, { wide: true });
}

// ── Your affiliations (used by Settings and the welcome) ───────────────────

/**
 * The caller's memberships, which one cards show, and verified organisations
 * their sign-in address belongs to. `compact` drops the explanatory text.
 */
export function myAffiliations({ compact = false } = {}) {
  const box = h("div", { class: "s-affils" }, loading());
  const draw = async () => {
    let data;
    try { data = await api.get("/v1/me/orgs"); } catch (error) { put(clear(box), errorBox(error, draw)); return; }
    clear(box);
    const items = data.items || [];
    if (!compact) {
      put(box, h("p", { class: "s-hint", text: "Join your organisation from its page. Your affiliation is verified when your sign-in address belongs to one of a verified organisation's domains; nobody sees the address itself." }));
    }
    for (const s of data.suggested || []) {
      put(box, h("div", { class: "s-aff-hint" },
        h("p", {}, h("strong", {}, s.name), " — your sign-in address belongs to this verified organisation."),
        h("button", { type: "button", class: "btn-primary s-btn-sm", onClick: () => act(async () => {
          await api.post(`/v1/orgs/${encodeURIComponent(s.slug)}/join`, {});
          await refreshMe(); toast(`Your affiliation with ${s.name} is verified.`); draw();
        }, "join organisations") }, "Add verified affiliation")));
    }
    if (!items.length) {
      put(box, h("p", { class: "s-muted" }, "No affiliations yet. ", h("a", { href: "#/orgs" }, "Find your organisation"), "."));
      return;
    }
    const shown = select("shown", [["", "Don't show one on my cards"], ...items.map((m) => [m.org.slug, `${m.org.name}${m.verified ? " (verified)" : ""}`])],
      (items.find((m) => m.primary) || {}).org?.slug || "");
    shown.addEventListener("change", () => act(async () => {
      await api.patch("/v1/me/affiliation", { org: shown.value || null });
      await refreshMe(); toast("Saved.");
    }, "edit your profile"));
    put(box,
      h("ul", { class: "s-rows" }, items.map((m) => h("li", { class: "s-row" },
        h("a", { href: `#/o/${encodeURIComponent(m.org.slug)}` }, m.org.name),
        m.verified ? h("span", { class: "s-verified", text: "Verified affiliation" }) : h("span", { class: "s-selfdecl", text: "Self-declared" }),
        m.role === "admin" ? h("span", { class: "s-kind", text: "Admin" }) : null))),
      field("Shown on your cards", shown));
  };
  draw();
  return box;
}
