/** #/u/:handle — a member's profile, reputation and portfolio; edit mode for yourself. */
import * as api from "../api.js?v=20261024-bde01a9";
import { store, myHandle, refreshMe } from "../store.js?v=20261024-bde01a9";
import {
  h, clear, field, input, select, textarea, toast, busy, splitList, extLink, errorBox, loading,
  confirmDialog, dateText, put, checkbox,
} from "../dom.js?v=20261024-bde01a9";
import {
  avatar, followButton, messageDialog, reportDialog, act, pagedList, postCard, tagList, requireSignIn,
  affiliationBadge, mentoringBadge,
} from "../components.js?v=20261024-bde01a9";
import { createMap } from "../mapcore.js?v=20261024-bde01a9";
import { mentoringRequestDialog } from "./settings.js?v=20261024-bde01a9";

const AVAIL = { open: "Open to collaborate", limited: "Limited availability", closed: "Not taking on collaborations" };
// Both lists are the Worker's own values (profiles.js JOB_STATUS, ITEM_KINDS);
// anything else is refused there with a 400.
const JOB = { "": "Not saying", seeking: "Looking for a position", hiring: "Hiring", consulting: "Available for consultancy" };
const ITEM_KINDS = [["publication", "Publication"], ["dataset", "Dataset"], ["repository", "Software / repository"],
  ["award", "Award"], ["experience", "Position"], ["education", "Education"], ["credential", "Qualification"],
  ["fieldwork", "Fieldwork"], ["talk", "Talk"], ["other", "Other"]];

/** #/me — your own profile in edit mode, for links that cannot know the handle. */
export async function renderMe(root) {
  await refreshMe().catch(() => {});
  const handle = myHandle();
  if (!handle) { put(clear(root), h("h1", { class: "s-h1", text: "Your profile" })); requireSignIn("edit your profile"); return; }
  location.replace(`#/u/${encodeURIComponent(handle)}?edit=1`);
}

export async function render(root, { params, query }) {
  const handle = String(params.handle || "").toLowerCase();
  put(clear(root), loading());
  let data;
  try { data = await api.get(`/v1/users/${encodeURIComponent(handle)}`); } catch (error) {
    put(clear(root), errorBox(error, () => render(root, { params, query }))); return;
  }
  const u = data.user || {};
  const self = !!store.me && u.handle === myHandle();
  document.title = `${u.name || u.handle} — GeoID Network`;
  if (self && query.edit) return editProfile(root, u, data.items || []);

  const rel = data.relationship || {};
  const counts = data.counts || {};
  const actions = h("div", { class: "s-actions" });
  if (self) {
    put(actions, h("a", { class: "btn-primary", href: `#/u/${encodeURIComponent(u.handle)}?edit=1` }, "Edit profile"),
      h("a", { class: "btn-ghost", href: "#/settings" }, "Settings"));
  } else if (!rel.blocked) {
    put(actions, followButton("user", u.handle, rel.following),
      u.mentoring ? h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => mentoringRequestDialog(u) }, "Ask for mentoring") : null,
      h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => messageDialog([u.handle]) }, "Message"),
      h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
        if (!(await confirmDialog(`Block @${u.handle}?`, "Neither of you will see the other's posts or be able to message. Follows both ways are removed. They are not told.", "Block"))) return;
        await api.post("/v1/blocks", { handle: u.handle });
        toast(`Blocked @${u.handle}.`);
        render(root, { params, query });
      }, "block") }, "Block"),
      h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => reportDialog("user", u.handle) }, "Report"));
  } else {
    put(actions, h("p", { class: "s-muted", text: "You have blocked this member, or they have blocked you." }),
      h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
        await api.del(`/v1/blocks/${encodeURIComponent(u.handle)}`); render(root, { params, query });
      }, "unblock") }, "Unblock"));
  }

  const items = data.items || [];
  const rep = h("section", { class: "s-section", "aria-labelledby": "rep-h" }, h("h2", { class: "s-h2", id: "rep-h", text: "Contribution" }));
  const scenes = h("section", { class: "s-section", "aria-labelledby": "sc-h" }, h("h2", { class: "s-h2", id: "sc-h", text: "Featured scenes" }));
  const posts = h("section", { class: "s-section", "aria-labelledby": "po-h" }, h("h2", { class: "s-h2", id: "po-h", text: "Posts" }));
  const projects = self ? h("section", { class: "s-section", "aria-labelledby": "pr-h" }, h("h2", { class: "s-h2", id: "pr-h", text: "Your projects" })) : null;

  put(clear(root),
    h("header", { class: "s-profile-head" },
      avatar(u, 88),
      h("div", { class: "s-profile-id" },
        h("h1", { class: "s-h1", text: u.name || u.handle }),
        h("p", { class: "s-muted" }, `@${u.handle}`, u.institution ? ` · ${u.institution}` : "", u.location ? ` · ${u.location}` : ""),
        u.headline ? h("p", { class: "s-headline", text: u.headline }) : null,
        u.affiliation || u.mentoring ? h("p", { class: "s-labels" }, affiliationBadge(u.affiliation), mentoringBadge(u)) : null,
        h("p", { class: "s-muted" }, `${counts.followers || 0} followers · ${counts.following || 0} following · ${counts.posts || 0} posts`,
          rel.followed_by ? " · follows you" : ""),
        actions)),
    h("div", { class: "s-grid-main" },
      h("div", {},
        u.bio ? h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "About" }), h("div", { class: "s-prose" }, String(u.bio).split(/\n{2,}/).map((t) => h("p", {}, t)))) : null,
        portfolio(items),
        scenes, posts, projects, rep),
      h("aside", { class: "s-side" }, facts(u))));

  put(scenes, pagedList((cursor) => api.get("/v1/feed", { tab: "all", author: u.handle, kind: "scene", cursor }), postCard,
    { emptyTitle: "No public scenes yet." }));
  put(posts, pagedList((cursor) => api.get("/v1/feed", { tab: "all", author: u.handle, cursor }), postCard,
    { emptyTitle: "No posts you can see yet." }));
  if (projects) {
    put(projects, pagedList((cursor) => api.get("/v1/projects", { mine: 1, cursor }),
      (pr) => h("a", { class: "s-card s-link-card", href: `#/p/${encodeURIComponent(pr.id)}` }, h("strong", {}, pr.title), h("span", { class: "s-muted" }, ` · ${pr.stage || ""}`)),
      { emptyTitle: "No projects yet.", emptyDetail: "Create one from Projects, or share a workspace from GeoHUB." }));
  }
  reputation(rep, u.handle, data.badges || []);
}

function facts(u) {
  const box = h("div", { class: "s-facts" });
  put(box, h("h2", { class: "s-side-title", text: "Collaboration" }),
    h("p", {}, h("strong", {}, AVAIL[u.availability] || "Availability not stated")),
    u.job_status ? h("p", { class: "s-muted", text: JOB[u.job_status] || u.job_status }) : null);
  put(box, h("h2", { class: "s-side-title", text: "Identity" }),
    u.orcid_verified
      ? h("p", {}, h("span", { class: "s-verified", text: "Verified" }), " ORCID iD ", u.orcid ? extLink(`https://orcid.org/${u.orcid}`, u.orcid) : "")
      : u.orcid ? h("p", {}, h("span", { class: "s-selfdecl", text: "Self-declared" }), " ORCID iD ", extLink(`https://orcid.org/${u.orcid}`, u.orcid)) : h("p", { class: "s-muted", text: "No ORCID iD given." }),
    u.affiliation ? h("p", {}, affiliationBadge(u.affiliation)) : null,
    u.institution ? h("p", {}, h("span", { class: "s-selfdecl", text: "Self-declared" }), ` Institution: ${u.institution}`) : null,
    u.website ? h("p", {}, extLink(u.website, "Website")) : null,
    u.linkedin ? h("p", {}, extLink(u.linkedin, "LinkedIn")) : null,
    u.plan ? h("p", { class: "s-muted", text: `GeoID ${u.plan}` }) : null,
    u.joined ? h("p", { class: "s-muted", text: `Joined ${dateText(u.joined)}` }) : null);
  if (u.skills?.length) {
    put(box, h("h2", { class: "s-side-title" }, "Skills ", h("span", { class: "s-selfdecl", text: "self-declared" })),
      h("ul", { class: "s-tags" }, u.skills.map((s) => h("li", {}, h("span", { class: "s-chip" }, s)))));
  }
  if (u.interests?.length) put(box, h("h2", { class: "s-side-title", text: "Interests" }), tagList(u.interests));
  if (u.regions?.length) put(box, h("h2", { class: "s-side-title", text: "Regions" }), h("p", { text: u.regions.join(", ") }));
  put(box, studyAreasView(u.handle));
  return box;
}

function portfolio(items) {
  if (!items.length) return null;
  return h("section", { class: "s-section", "aria-labelledby": "pf-h" },
    h("h2", { class: "s-h2", id: "pf-h", text: "Publications & portfolio" }),
    h("p", { class: "s-hint", text: "“Verified” items were confirmed against an external record; everything else is as the member describes it." }),
    h("ul", { class: "s-items" }, items.map((it) => h("li", { class: "s-item" },
      h("div", {}, h("strong", {}, it.title || ""), it.year ? h("span", { class: "s-muted" }, ` (${it.year})`) : null),
      it.detail ? h("p", { class: "s-muted", text: it.detail }) : null,
      h("p", { class: "s-item-meta" },
        h("span", { class: "s-kind", text: it.kind || "item" }),
        it.verified ? h("span", { class: "s-verified", text: "Verified" }) : h("span", { class: "s-selfdecl", text: "Self-declared" }),
        it.doi ? extLink(`https://doi.org/${it.doi}`, `doi:${it.doi}`) : null,
        it.url ? extLink(it.url, "Link") : null),
      checkEvidence(it.verification)))));
}

/**
 * What a publication check compared (verify.js), so a "Verified" tick can be
 * read rather than trusted. Shown for any check that got an answer.
 */
export function checkEvidence(v) {
  if (!v || v.outcome === "error") return null;
  const outcome = {
    verified: "The DOI resolves and the member's name matches an author on the record.",
    "name-mismatch": "The DOI resolves, but no author on the record matches the member's name.",
    "not-found": "Crossref has no record of this DOI.",
  }[v.outcome] || v.outcome;
  return h("details", { class: "s-evidence" },
    h("summary", {}, "What was checked"),
    h("p", {}, outcome),
    h("dl", { class: "s-evidence-list" },
      h("dt", {}, "Source"), h("dd", {}, `Crossref, ${dateText(v.checked_at)}`),
      h("dt", {}, "DOI"), h("dd", {}, v.doi),
      v.title ? [h("dt", {}, "Record title"), h("dd", {}, v.title)] : null,
      v.journal || v.year ? [h("dt", {}, "Published"), h("dd", {}, [v.journal, v.year].filter(Boolean).join(", "))] : null,
      h("dt", {}, "Name compared"), h("dd", {}, v.name_checked || "—"),
      v.matched_author ? [h("dt", {}, "Matching author"), h("dd", {}, v.matched_author)] : null,
      !v.matched && v.authors?.length ? [h("dt", {}, "Authors on record"), h("dd", {}, v.authors.slice(0, 8).join("; "), v.authors.length > 8 ? " …" : "")] : null),
    h("p", { class: "s-hint", text: "Matched on family name and first initial, ignoring accents." }));
}

async function reputation(section, handle, badges) {
  let data; let criteria = [];
  try {
    [data, criteria] = await Promise.all([
      api.get(`/v1/users/${encodeURIComponent(handle)}/reputation`),
      api.get("/v1/badges").then((d) => (Array.isArray(d) ? d : d?.items || [])).catch(() => []),
    ]);
  } catch (error) { put(section, errorBox(error)); return; }
  put(section, h("p", { class: "s-hint", text: "Reputation counts contributions others can check — never followers or popularity." }));
  const cats = data?.categories || [];
  if (cats.length) {
    put(section, h("ul", { class: "s-rep" }, cats.map((c) => h("li", {},
      h("details", {}, h("summary", {}, h("span", {}, c.label), h("strong", {}, String(c.count || 0))),
        c.evidence?.length ? h("ul", { class: "s-plain" }, c.evidence.map((ev) => h("li", {},
          ev.type === "post" ? h("a", { href: `#/post/${encodeURIComponent(ev.id)}` }, ev.title || ev.id)
            : ev.type === "review" ? h("a", { href: `#/r/${encodeURIComponent(ev.id)}` }, ev.title || ev.id)
              : h("span", {}, ev.title || ev.id)))) : h("p", { class: "s-muted", text: "Nothing yet." }))))));
  }
  const held = data?.badges || badges || [];
  put(section, h("h3", { class: "s-h3", text: "Badges" }));
  if (!held.length) put(section, h("p", { class: "s-muted", text: "No badges yet." }));
  else {
    put(section, h("ul", { class: "s-badges" }, held.map((b) => {
      const c = criteria.find((x) => x.id === (b.id || b.badge_id)) || b;
      return h("li", {}, h("strong", {}, c.name || b.name || b.id), h("p", { class: "s-muted", text: c.criteria || c.description || "" }),
        b.awarded_at ? h("p", { class: "s-hint", text: `Earned ${dateText(b.awarded_at)}` }) : null);
    })));
  }
  if (criteria.length) {
    put(section, h("details", { class: "s-criteria" }, h("summary", {}, "How every badge is earned"),
      h("ul", { class: "s-plain" }, criteria.map((c) => h("li", {}, h("strong", {}, c.name), ` — ${c.criteria || c.description || ""}`))),
      h("p", { class: "s-hint", text: "Think a badge is wrong? Report it as an appeal from the badge owner's profile." })));
  }
  if (store.me && handle === myHandle()) {
    put(section, h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
      await api.post("/v1/badges/refresh", {});
      toast("Badges recalculated.");
      put(clear(section), h("h2", { class: "s-h2", text: "Contribution" }));
      reputation(section, handle, []);
    }, "refresh badges") }, "Recalculate my badges"));
  }
}

// ── Edit ───────────────────────────────────────────────────────────────────

function editProfile(root, u, items) {
  const f = {
    name: input("name", { value: u.name || "", maxlength: 80, required: true }),
    handle: input("handle", { value: u.handle || "", pattern: "[a-z0-9_]{3,30}", maxlength: 30 }),
    headline: input("headline", { value: u.headline || "", maxlength: 140 }),
    institution: input("institution", { value: u.institution || "", maxlength: 120 }),
    location: input("location", { value: u.location || "", maxlength: 120 }),
    website: input("website", { type: "url", value: u.website || "" }),
    linkedin: input("linkedin", { type: "url", value: u.linkedin || "", placeholder: "https://www.linkedin.com/in/…" }),
    orcid: input("orcid", { value: u.orcid || "", placeholder: "0000-0000-0000-0000" }),
    bio: textarea("bio", { rows: 6, value: u.bio || "", maxlength: 4000 }),
    skills: input("skills", { value: (u.skills || []).join(", ") }),
    interests: input("interests", { value: (u.interests || []).join(", ") }),
    regions: input("regions", { value: (u.regions || []).join(", ") }),
    availability: select("availability", Object.entries(AVAIL), u.availability || "open"),
    job_status: select("job_status", Object.entries(JOB), u.job_status || ""),
  };
  const avatarFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp" });
  const removeAvatar = u.avatar ? checkbox("remove-avatar", "Remove my picture", false) : null;
  let avatarKey = null;
  avatarFile.addEventListener("change", async () => {
    const file = avatarFile.files?.[0];
    if (!file) return;
    try { const out = await api.upload(file, { scope: "public" }); avatarKey = out.key; toast("Picture uploaded; save to use it."); } catch (error) { toast(error.message, "error"); }
  });
  const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
  const form = h("form", { class: "s-form" },
    h("fieldset", {}, h("legend", {}, "Profile"),
      field("Name", f.name), field("Handle", f.handle, "Lower-case letters, numbers and _ (3–30). Changing it breaks old links to your profile."),
      field("Headline", f.headline, "e.g. PhD researcher, volcano deformation"),
      field("Institution (optional)", f.institution),
      field("Location", f.location, "As much or as little as you like."), field("Website (optional)", f.website),
      field("LinkedIn (optional)", f.linkedin, "Your public LinkedIn profile address."),
      field("ORCID iD (optional)", f.orcid, "Shown as self-declared until it is verified through ORCID sign-in."),
      h("div", { class: "s-avatar-edit" }, avatar(u, 64),
        field("Profile picture (optional)", avatarFile, "PNG, JPEG or WebP, up to 8 MB. Anyone can see it."),
        removeAvatar),
      field("About you (optional)", f.bio)),
    h("fieldset", {}, h("legend", {}, "Expertise"),
      field("Skills", f.skills, "Comma-separated. Shown as self-declared."), field("Interests", f.interests), field("Regions you work on", f.regions)),
    h("fieldset", {}, h("legend", {}, "Availability"),
      field("Collaboration", f.availability), field("Job status", f.job_status, "Only shown if you choose something other than “Not saying”.")),
    status,
    h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Save profile"),
      h("a", { class: "btn-ghost", href: `#/u/${encodeURIComponent(u.handle)}` }, "Cancel")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const done = busy(form);
    try {
      const body = {
        name: f.name.value, headline: f.headline.value, institution: f.institution.value, location: f.location.value,
        website: f.website.value, linkedin: f.linkedin.value, orcid: f.orcid.value, bio: f.bio.value, skills: splitList(f.skills.value),
        interests: splitList(f.interests.value), regions: splitList(f.regions.value),
        availability: f.availability.value, job_status: f.job_status.value,
      };
      if (f.handle.value && f.handle.value !== u.handle) body.handle = f.handle.value.toLowerCase();
      if (avatarKey) body.avatar_key = avatarKey;
      else if (removeAvatar?.querySelector("input").checked) body.avatar_key = "";
      await api.patch("/v1/me", body);
      await refreshMe();
      toast("Profile saved.");
      location.hash = `#/u/${encodeURIComponent(body.handle || u.handle)}`;
    } catch (error) { done(); status.textContent = error.message; status.classList.add("is-error"); }
  });

  // Portfolio items
  const list = h("ul", { class: "s-items" });
  const drawItems = () => {
    clear(list);
    if (!items.length) put(list, h("li", { class: "s-muted", text: "No items yet." }));
    items.forEach((it) => put(list, h("li", { class: "s-item" },
      h("strong", {}, it.title), it.year ? ` (${it.year})` : "", " ",
      it.verified ? h("span", { class: "s-verified", text: "Verified" }) : h("span", { class: "s-selfdecl", text: "Self-declared" }),
      // Publication check (verify.js): Crossref, then the author list against your name.
      it.doi ? h("button", { type: "button", class: "s-link-btn", onClick: (e) => act(async () => {
        e.target.disabled = true;
        try {
          const out = await api.post(`/v1/me/items/${encodeURIComponent(it.id)}/verify`, {});
          Object.assign(it, out.item, { verification: out.verification });
          toast(out.message || "Checked.", out.item?.verified ? "info" : "error");
          drawItems();
        } finally { e.target.disabled = false; }
      }, "edit your profile") }, it.verified ? "Check DOI again" : "Verify DOI") : null,
      h("button", { type: "button", class: "s-link-btn s-danger", onClick: () => act(async () => {
        await api.del(`/v1/me/items/${encodeURIComponent(it.id)}`);
        items.splice(items.indexOf(it), 1); drawItems();
      }, "edit your profile") }, "Remove"),
      checkEvidence(it.verification))));
  };
  drawItems();
  const it = {
    kind: select("kind", ITEM_KINDS, "publication"), title: input("title", { required: true, maxlength: 300 }),
    detail: input("detail", { maxlength: 500 }), url: input("url", { type: "url" }), doi: input("doi"),
    year: input("year", { type: "number", min: 1900, max: 2100 }),
    visibility: select("visibility", [["public", "Public"], ["followers", "Followers"], ["private", "Only me"]], "public"),
  };
  const itemForm = h("form", { class: "s-form" },
    field("Kind", it.kind), field("Title", it.title), field("Detail", it.detail, "Journal, role, or a line of context."),
    h("div", { class: "s-row-fields" }, field("Year", it.year), field("DOI", it.doi), field("Link", it.url)),
    field("Who can see it", it.visibility),
    h("p", { class: "s-hint", text: "New items are self-declared. Verification comes from external records (ORCID, DOI metadata), not from you saying so." }),
    h("button", { type: "submit", class: "btn-ghost" }, "Add item"));
  itemForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const done = busy(itemForm);
    try {
      const saved = await api.post("/v1/me/items", {
        kind: it.kind.value, title: it.title.value, detail: it.detail.value, url: it.url.value,
        doi: it.doi.value, year: Number(it.year.value) || null, visibility: it.visibility.value,
      });
      items.push(saved); drawItems(); itemForm.reset();
    } catch (error) { toast(error.message, "error"); }
    done();
  });

  const areas = studyAreasEditor();
  put(clear(root), h("h1", { class: "s-h1", text: "Edit your profile" }), form,
    areas.section,
    h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Publications & portfolio" }), list, itemForm));
  areas.start();
  return areas.stop;
}


// ── Study areas ────────────────────────────────────────────────────────────

/**
 * Where you work, for the map's study-interest view. Rounded on the server
 * (about 11 km or about 110 km) before it is stored; "show on the map" off
 * keeps an area on your profile only.
 */
function studyAreasEditor() {
  let items = [];
  let max = 10;
  const list = h("ul", { class: "s-items" });
  const draw = () => {
    clear(list);
    if (!items.length) put(list, h("li", { class: "s-muted", text: "No study areas yet. Add the places you work on and you will appear on the map's study-interest view." }));
    items.forEach((a) => {
      const onMap = h("input", { type: "checkbox", checked: a.on_map, "aria-label": `Show ${a.name} on the map` });
      onMap.addEventListener("change", () => act(async () => {
        const saved = await api.patch(`/v1/me/study-areas/${encodeURIComponent(a.id)}`, { on_map: onMap.checked });
        Object.assign(a, saved); toast(saved.on_map ? "Shown on the map." : "Kept off the map.");
      }, "edit your profile"));
      put(list, h("li", { class: "s-item" },
        h("strong", {}, a.name),
        h("span", { class: "s-muted", text: ` · within ${a.radius_km} km · ${a.location.precision === "region" ? "about 110 km precision" : "about 11 km precision"}${a.tags.length ? ` · ${a.tags.map((t) => `#${t}`).join(" ")}` : ""}` }),
        h("label", { class: "s-check s-inline" }, onMap, h("span", {}, " On the map")),
        h("button", { type: "button", class: "s-link-btn s-danger", onClick: () => act(async () => {
          await api.del(`/v1/me/study-areas/${encodeURIComponent(a.id)}`);
          items = items.filter((x) => x !== a); draw();
        }, "edit your profile") }, "Remove")));
    });
  };

  const f = {
    name: input("sa-name", { required: true, maxlength: 120, placeholder: "e.g. Mount Etna, Lake District, Valles Marineris" }),
    lat: input("sa-lat", { type: "number", step: "any", min: -90, max: 90 }),
    lon: input("sa-lon", { type: "number", step: "any", min: -180, max: 180 }),
    radius: select("sa-radius", [[10, "10 km"], [25, "25 km"], [50, "50 km"], [100, "100 km"], [250, "250 km"], [500, "500 km"]], 50),
    precision: select("sa-precision", [["approx", "About 11 km"], ["region", "About 110 km"]], "approx"),
    tags: input("sa-tags", { placeholder: "volcanology, insar" }),
  };
  const onMap = checkbox("sa-on-map", "Show on the map", true, "Off keeps it on your profile only.");
  const canvas = h("canvas", { class: "s-pick-map", tabindex: "0", "aria-label": "Map: click to place the study area. Arrow keys pan, plus and minus zoom." });
  let picked = null;
  let picker = null;
  const form = h("form", { class: "s-form" },
    field("Name", f.name), canvas,
    h("div", { class: "s-row-fields" }, field("Latitude", f.lat), field("Longitude", f.lon), field("Covers", f.radius)),
    h("div", { class: "s-row-fields" }, field("Precision", f.precision, "Rounded on the server before it is stored."), field("Topics", f.tags, "Comma-separated.")),
    onMap,
    h("button", { type: "submit", class: "btn-ghost" }, "Add study area"));
  const syncPick = () => {
    const la = Number(f.lat.value); const lo = Number(f.lon.value);
    picked = f.lat.value !== "" && f.lon.value !== "" && Number.isFinite(la) && Number.isFinite(lo) ? { lat: la, lon: lo } : null;
    picker?.draw();
  };
  f.lat.addEventListener("input", syncPick); f.lon.addEventListener("input", syncPick);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (items.length >= max) { toast(`You can list up to ${max} study areas.`, "error"); return; }
    if (!picked) { toast("Click the map, or give a latitude and longitude.", "error"); return; }
    const done = busy(form);
    try {
      const saved = await api.post("/v1/me/study-areas", {
        name: f.name.value, location: { lat: picked.lat, lon: picked.lon, precision: f.precision.value },
        radius_km: Number(f.radius.value), tags: splitList(f.tags.value), on_map: onMap.querySelector("input").checked,
      });
      items.push(saved); draw(); form.reset(); picked = null; picker?.draw();
    } catch (error) { toast(error.message, "error"); }
    done();
  });

  const section = h("section", { class: "s-section" },
    h("h2", { class: "s-h2", text: "Study areas" }),
    h("p", { class: "s-hint", text: "The places you work on. They put you on the map's study-interest view, so people working on the same area can find you. Each is rounded before it is stored; nothing more precise exists." }),
    list, form);
  return {
    section,
    start() {
      api.get("/v1/me/study-areas").then((d) => { items = d?.items || []; max = d?.max || 10; draw(); }).catch(() => draw());
      picker = createMap(canvas, {
        onClick: ({ lon, lat }) => { f.lat.value = lat.toFixed(3); f.lon.value = lon.toFixed(3); syncPick(); },
        onDraw: (ctx, { project }) => {
          for (const a of items.filter((x) => x.on_map)) {
            const [x, y] = project(a.location.lon, a.location.lat);
            ctx.strokeStyle = "rgba(0, 212, 192, 0.8)"; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
          }
          if (picked) {
            const [x, y] = project(picked.lon, picked.lat);
            ctx.fillStyle = "rgba(240, 176, 48, 0.95)"; ctx.shadowColor = "rgba(240, 176, 48, 0.6)"; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
          }
        },
      });
    },
    stop() { picker?.destroy(); },
  };
}

/** The study areas on a profile page, if any. */
function studyAreasView(handle) {
  const box = h("div", {});
  api.get(`/v1/users/${encodeURIComponent(handle)}/study-areas`).then((d) => {
    const items = d?.items || [];
    if (!items.length) return;
    put(box, h("h2", { class: "s-side-title", text: "Study areas" }),
      h("ul", { class: "s-plain" }, items.map((a) => h("li", {}, a.name,
        h("span", { class: "s-muted", text: ` · ${a.radius_km} km${a.tags.length ? ` · ${a.tags.map((t) => `#${t}`).join(" ")}` : ""}` })))),
      h("p", {}, h("a", { href: "#/map" }, "See who else works there")));
  }).catch(() => {});
  return box;
}
