/**
 * An in-page stand-in for the Social Worker, for building the page while the
 * Worker is not running. Loaded ONLY when localStorage['geoid:social-mock']
 * is '1' on a localhost page (see api.js); never imported otherwise.
 *
 * It answers the CONTRACT.md routes with the CONTRACT.md shapes from an
 * in-memory store that resets on reload. It is not a second implementation of
 * the rules -- visibility, rate limits and permissions are only sketched.
 * localStorage['geoid:social-mock-anon'] = '1' makes every request signed out.
 */
const T = () => Math.floor(Date.now() / 1000);
const DAY = 86400;
let n = 100;
const id = (p) => `${p}_${(++n).toString(16).padStart(6, "0")}`;
const anon = () => { try { return localStorage.getItem("geoid:social-mock-anon") === "1"; } catch (e) { return false; } };

const users = {
  owen: { handle: "owen", name: "Owen McCluskey", headline: "Volcano geodesy · GeoID", institution: "GeoID Initiative", plan: "owner", orcid_verified: true, avatar: "",
    bio: "Building GeoHUB. Interested in Etna, InSAR and making hazard models open.\n\nAsk me about the Model Builder.", location: "Belfast", website: "https://geoidinitiative.com", orcid: "0000-0002-1825-0097",
    skills: ["insar", "fem", "python"], interests: ["volcanology", "hazards"], regions: ["Sicily", "Iceland"], availability: "open", job_status: "", contact_pref: "followers", match_opt_in: true, joined: T() - 300 * DAY },
  amara: { handle: "amara", name: "Dr Amara Osei", headline: "Professor of Geomorphology", institution: "University of Ghana", plan: "member", orcid_verified: true, avatar: "",
    bio: "Landslides, rainfall thresholds, and teaching field methods.", location: "Accra", website: "", orcid: "0000-0001-2345-6789", skills: ["landslides", "field-mapping", "gis"], interests: ["landslides"], regions: ["West Africa"], availability: "limited", job_status: "hiring", contact_pref: "anyone", match_opt_in: true, joined: T() - 200 * DAY },
  li: { handle: "li_wei", name: "Li Wei", headline: "PhD student, InSAR time series", institution: "", plan: "", orcid_verified: false, avatar: "",
    bio: "<img src=x onerror=alert(1)> — this bio is a test that user text is drawn as text.", location: "", website: "javascript:alert(1)", orcid: "", skills: ["insar", "python"], interests: ["deformation"], regions: ["Iceland"], availability: "open", job_status: "seeking", contact_pref: "anyone", match_opt_in: true, joined: T() - 40 * DAY },
};
const ME = "owen";
const pub = (h) => { const u = users[h]; return u ? { handle: u.handle, name: u.name, headline: u.headline, avatar: u.avatar, institution: u.institution, plan: u.plan, orcid_verified: u.orcid_verified } : null; };

const posts = [];
function addPost(author, p) {
  const post = {
    id: id("p"), kind: "text", author: pub(author), title: "", body: "", tags: [], location: null, world: "earth", scene: null, media: [], links: [],
    licence: "CC-BY-4.0", provenance: "observed", sources: [], method: {}, limitations: "", meta: {}, visibility: "public", team_id: null, community_id: null,
    project_id: null, allow_fork: false, forked_from: null, sponsored_by: "", accepted_comment_id: null, pinned: false,
    counts: { reactions: 0, comments: 0, forks: 0 }, created_at: T() - Math.floor(Math.random() * 20 * DAY), updated_at: 0, _reacted: [], _bookmarked: false, ...p,
  };
  if (post.kind === "observation") post.verification = post.verification || { confirms: 1, disputes: 0, status: "unverified" };
  posts.push(post);
  return post;
}
addPost("amara", { kind: "observation", title: "Fresh scarp after overnight rain", body: "A 40 m scarp opened on the east slope. Photos to follow.\n\nRoad closed.", tags: ["landslides", "ghana"], location: { lat: 6.1, lon: -0.3, precision: "approx", place: "Akwapim ridge" }, provenance: "observed", verification: { confirms: 3, disputes: 0, status: "community-verified" } });
addPost("owen", { kind: "scene", title: "Etna 2021 lava flows over the DEM", body: "Open it and rotate round the SE crater.", tags: ["etna", "volcanology"], location: { lat: 37.7, lon: 15.0, precision: "approx", place: "Mount Etna" }, provenance: "derived", allow_fork: true, scene: { world: "earth", camera: { lat: 37.75, lon: 14.99, alt: 12000, heading: 30, pitch: -35 }, layers: [{ id: "dem", name: "Copernicus DEM", source: "ESA", opacity: 1, visible: true }, { id: "flows", name: "2021 flows", source: "INGV", opacity: 0.8, visible: true }], annotations: [{ lat: 37.75, lon: 15.0, text: "SE crater" }] }, sources: [{ title: "INGV flow outlines", url: "https://www.ingv.it" }], method: { summary: "Flow outlines draped on the 30 m DEM.", software: "GeoHUB" }, limitations: "Outlines are mapped at 1:25k." });
addPost("li", { kind: "question", title: "How do you handle unwrapping errors over snow?", body: "My Sentinel-1 interferograms over Vatnajökull are a mess in winter. <script>alert(1)</script>", tags: ["insar", "iceland"], provenance: "unverified" });
addPost("amara", { kind: "opportunity", title: "Funded PhD: rainfall-triggered landslides", body: "Three years, fieldwork in Ghana.", tags: ["landslides", "phd"], provenance: "unverified", meta: { type: "studentship", org: "University of Ghana", deadline: T() + 30 * DAY, skills: ["gis", "python"], paid: true, apply_url: "https://example.org/apply" } });
addPost("owen", { kind: "event", title: "Webinar: open hazard models", body: "How the six GeoHUB models are built.", tags: ["hazards"], provenance: "unverified", meta: { format: "webinar", starts_at: T() + 7 * DAY, ends_at: T() + 7 * DAY + 3600, where: "Online", url: "https://example.org" } });
addPost("li", { kind: "analysis", title: "Uplift at Askja, 2021–2024", body: "Cumulative LOS displacement.", tags: ["insar", "iceland"], location: { lat: 65.0, lon: -16.8, precision: "region", place: "Askja" }, provenance: "modelled", meta: { before: "2021", after: "2024", uncertainty: "±8 mm from atmosphere" }, limitations: "Ascending track only." });
addPost("owen", { kind: "dataset", title: "Etna summit GNSS, 2019–2024", body: "Daily solutions.", tags: ["gnss", "etna"], provenance: "observed", licence: "CC0-1.0", meta: { repo: "https://example.org/gnss", version: "1.2", doi: "10.5281/zenodo.0000000" } });
addPost("amara", { kind: "text", title: "", body: "AI-drafted summary of this week's landslide reports across West Africa.", tags: ["landslides"], provenance: "ai" });
for (let i = 0; i < 40; i += 1) addPost(["owen", "amara", "li_wei"][i % 3] === "li_wei" ? "li" : ["owen", "amara"][i % 2], { kind: "observation", title: `Field note ${i + 1}`, body: "Generated for the map.", location: { lat: -60 + Math.random() * 130, lon: -170 + Math.random() * 340, precision: ["exact", "approx", "region"][i % 3] }, provenance: "observed" });
posts.sort((a, b) => b.created_at - a.created_at);

const comments = [];
const q = posts.find((p) => p.kind === "question");
comments.push({ id: id("c"), post_id: q.id, author: pub("owen"), body: "Mask the glacier and unwrap with a coherence threshold; snow decorrelates in days.", kind: "comment", parent_id: null, location: null, created_at: T() - DAY, accepted: false });
comments.push({ id: id("c"), post_id: q.id, author: pub("li"), body: "Thanks — what threshold?", kind: "comment", parent_id: comments[0].id, location: null, created_at: T() - 3600, accepted: false });
q.counts.comments = 2;

const communities = [
  { id: "cm1", slug: "volcano-geodesy", name: "Volcano geodesy", description: "InSAR, GNSS and tilt at active volcanoes.", tags: ["volcanology", "insar"], visibility: "open", member_count: 214, role: "owner",
    rules: ["Cite your data.", "Label model output as modelled.", "No exact locations of private land."], faq: [{ q: "Where do I start with InSAR?", a: "The pinned threads." }], resources: [{ title: "COMET LiCSAR", url: "https://comet.nerc.ac.uk/COMET-LiCS-portal/" }] },
  { id: "cm2", slug: "landslides", name: "Landslides", description: "Mapping, monitoring and early warning.", tags: ["landslides"], visibility: "approval", member_count: 98, role: null, rules: [], faq: [], resources: [] },
  { id: "cm3", slug: "careers", name: "Careers & mentoring", description: "Ask for advice on PhDs, jobs and fieldwork.", tags: ["careers"], visibility: "open", member_count: 431, role: "member", rules: [], faq: [], resources: [] },
];
posts[2].community_id = "cm1";
const teams = [
  { id: "t1", slug: "etna-lab", name: "Etna lab", description: "Etna deformation group.", visibility: "private", conversation_id: "cv_team1",
    members: [{ user: pub("owen"), role: "lead", status: "active" }, { user: pub("li"), role: "member", status: "active" }, { user: pub("amara"), role: "viewer", status: "invited" }] },
];
const tasks = [
  { id: id("k"), team: "etna-lab", title: "Process 2024 descending track", detail: "", status: "doing", assignee: pub("li") },
  { id: id("k"), team: "etna-lab", title: "Write the methods section", detail: "", status: "todo", assignee: null },
];
const projects = [
  { id: "pr1", title: "Etna flank instability", summary: "Is the east flank accelerating?", stage: "analysis", world: "earth", location: { lat: 37.7, lon: 15.1, precision: "approx" }, tags: ["etna"], licence: "CC-BY-4.0", visibility: "team", allow_fork: false, owner: pub("owen"), needs_skills: ["fem"], forked_from: null,
    _versions: [{ version: 1, note: "First workspace", created_at: T() - 10 * DAY, by: pub("owen") }], _grants: [{ id: "g1", grantee: { type: "user", handle: "amara", name: "Dr Amara Osei" }, role: "commenter", expires_at: T() + 30 * DAY }] },
  { id: "pr2", title: "Accra landslide inventory", summary: "An open inventory from field mapping.", stage: "data-collection", world: "earth", location: { lat: 5.6, lon: -0.2, precision: "approx" }, tags: ["landslides"], licence: "CC0-1.0", visibility: "public", allow_fork: true, owner: pub("amara"), needs_skills: ["gis"], forked_from: null, _versions: [], _grants: [] },
];
const reviews = [
  { id: "r1", title: "Draft: Flank creep at Etna from 8 years of InSAR", abstract: "We show...", doc_key: "m/owen/draft.pdf", doc_url: "", expertise: ["insar", "volcanology"], visibility: "private", status: "open", due_at: T() + 14 * DAY, requester: pub("owen"), created_at: T() - 2 * DAY,
    _reviewers: [{ user: pub("amara"), status: "accepted", recommendation: "minor", summary: "Solid; check the atmospheric correction." }, { user: pub("li"), status: "invited", recommendation: null }],
    _comments: [{ id: id("rc"), author: pub("amara"), body: "Which GACOS product?", anchor: "§2.3", severity: "minor", parent_id: null, created_at: T() - DAY, resolved: false }] },
];
const conversations = [
  { id: "cv1", kind: "dm", title: "", members: [pub("owen"), pub("amara")], status: "active", unread: 1, muted: false,
    _messages: [{ id: id("m"), sender: pub("amara"), body: "Can I use your Etna scene in a lecture?", created_at: T() - 7200 }] },
  { id: "cv2", kind: "dm", title: "", members: [pub("owen"), pub("li")], status: "request", unread: 1, muted: false,
    _messages: [{ id: id("m"), sender: pub("li"), body: "Hello — could you look at my unwrapping?", created_at: T() - 3600 }] },
  { id: "cv_team1", kind: "team", title: "Etna lab", members: [pub("owen"), pub("li")], status: "active", unread: 0, muted: false,
    _messages: [{ id: id("m"), sender: pub("li"), body: "Track 124 done.", created_at: T() - 600 }] },
];
const notifications = [
  { id: id("n"), kind: "comment", actor: pub("li"), ref_type: "post", ref_id: q.id, text: "Thanks — what threshold?", read: false, created_at: T() - 3600 },
  { id: id("n"), kind: "review_invite", actor: pub("owen"), ref_type: "review", ref_id: "r1", text: "", read: false, created_at: T() - 2 * DAY },
  { id: id("n"), kind: "follow", actor: pub("amara"), ref_type: "user", ref_id: "amara", text: "", read: true, created_at: T() - 5 * DAY },
];
const reports = [{ id: "rep1", target_type: "post", target_id: posts.find((p) => p.provenance === "ai").id, reason: "misinformation", note: "Not labelled as a summary.", kind: "report", status: "open", created_at: T() - 3600, reporter: pub("li"), target: posts.find((p) => p.provenance === "ai") }];
const follows = [{ type: "tag", id: "insar", label: "#insar" }, { type: "user", id: "amara", label: "Dr Amara Osei" }];
const blocks = [];
const items = { owen: [{ id: id("i"), kind: "publication", title: "Deformation of Etna's east flank", detail: "J. Volcanol.", url: "", doi: "10.1000/xyz123", year: 2024, verified: true, visibility: "public" }, { id: id("i"), kind: "award", title: "Best poster, EGU", detail: "", url: "", doi: "", year: 2023, verified: false, visibility: "public" }] };
const BADGES = [
  { id: "open-data", name: "Open Data Contributor", description: "", criteria: "At least one public dataset post with a licence." },
  { id: "reproducible", name: "Reproducible Workflow", description: "", criteria: "A workflow forked by someone else who reacted “reproduced”." },
  { id: "mentor", name: "Community Mentor", description: "", criteria: "Five or more accepted answers." },
  { id: "reviewer", name: "Peer Reviewer", description: "", criteria: "Three or more submitted reviews." },
  { id: "observer", name: "Field Observer", description: "", criteria: "Three or more community-verified observations." },
  { id: "verified", name: "Verified Researcher", description: "", criteria: "ORCID iD verified by signing in with ORCID." },
];
const media = {};

// ── Helpers ────────────────────────────────────────────────────────────────
const ok = (data) => ({ status: 200, data });
const err = (status, error) => ({ status, data: { error } });
const page = (list, cursor, size = 10) => {
  const start = Number(cursor) || 0;
  const items = list.slice(start, start + size);
  return { items, next: start + size < list.length ? String(start + size) : null };
};
const viewPost = (p) => {
  const { _reacted, _bookmarked, ...rest } = p;
  return anon() ? rest : { ...rest, viewer: { reacted: _reacted, bookmarked: _bookmarked, verified: null, following_author: follows.some((f) => f.type === "user" && f.id === p.author?.handle) } };
};
export const mediaUrl = (key) => media[key]?.url || "";

function meShape() {
  const u = users[ME];
  return {
    user: { ...u, handle_editable: true, notify: u.notify || {} },
    counts: { followers: 12, following: follows.length, posts: posts.filter((p) => p.author?.handle === ME).length },
    unread: { notifications: notifications.filter((x) => !x.read).length, messages: conversations.filter((c) => c.unread).length },
    communities: communities.filter((c) => c.role).map((c) => ({ id: c.id, slug: c.slug, name: c.name, role: c.role })),
    teams: teams.map((t) => ({ id: t.id, slug: t.slug, name: t.name, role: "lead" })),
    admin: true,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────
const R = [];
const on = (method, pattern, fn) => {
  const names = [];
  const rx = new RegExp(`^${pattern.replace(/:([a-z_]+)/g, (_, nm) => { names.push(nm); return "([^/]+)"; })}$`);
  R.push({ method, rx, names, fn });
};
const needUser = () => (anon() ? err(401, "Sign in to do that.") : null);

on("GET", "/v1/me", () => needUser() || ok(meShape()));
on("PATCH", "/v1/me", (p, q, b) => needUser() || (Object.assign(users[ME], b), ok(meShape())));
on("GET", "/v1/me/export", () => needUser() || ok({ exported_at: T(), user: { ...users[ME], email: "you@example.com" }, posts: posts.filter((p) => p.author?.handle === ME) }));
on("DELETE", "/v1/me", (p, q, b) => (b?.confirm === ME ? (localStorage.setItem("geoid:social-mock-anon", "1"), ok({ ok: true })) : err(400, "Type your handle to confirm.")));
on("GET", "/v1/users/:handle", ({ handle }) => {
  const u = users[handle] || Object.values(users).find((x) => x.handle === handle);
  if (!u) return err(404, "No such member.");
  return ok({ user: u, items: [...(items[u.handle] || [])], badges: u.handle === "owen" ? [{ id: "verified", awarded_at: T() - 100 * DAY }, { id: "open-data", awarded_at: T() - 20 * DAY }] : [],
    counts: { followers: 12, following: 30, posts: posts.filter((x) => x.author?.handle === u.handle).length },
    relationship: { following: follows.some((f) => f.type === "user" && f.id === u.handle), followed_by: u.handle === "amara", blocked: blocks.includes(u.handle) } });
});
on("GET", "/v1/users/:handle/reputation", ({ handle }) => ok({
  categories: [
    { id: "research", label: "Research with sources", count: 2, evidence: posts.filter((x) => x.author?.handle === handle && x.kind === "analysis").map((x) => ({ type: "post", id: x.id, title: x.title })) },
    { id: "datasets_workflows", label: "Open datasets & workflows", count: 1, evidence: posts.filter((x) => x.author?.handle === handle && x.kind === "dataset").map((x) => ({ type: "post", id: x.id, title: x.title })) },
    { id: "answers", label: "Accepted answers", count: 0, evidence: [] },
    { id: "reviews", label: "Submitted reviews", count: handle === "amara" ? 1 : 0, evidence: [] },
    { id: "observations", label: "Community-verified observations", count: 1, evidence: [] },
  ],
  badges: handle === "owen" ? [{ id: "verified", name: "Verified Researcher", awarded_at: T() - 100 * DAY }] : [],
}));
on("GET", "/v1/badges", () => ok(BADGES));
on("POST", "/v1/badges/refresh", () => needUser() || ok({ ok: true }));
on("GET", "/v1/users", (p, q) => {
  let list = Object.values(users);
  if (q.q) list = list.filter((u) => `${u.name} ${u.handle} ${u.institution}`.toLowerCase().includes(q.q.toLowerCase()));
  if (q.skill) list = list.filter((u) => u.skills.includes(q.skill.toLowerCase()));
  if (q.available) list = list.filter((u) => u.availability === "open");
  return ok(page(list.map((u) => ({ ...pub(u.handle === "li_wei" ? "li" : u.handle), skills: u.skills, availability: u.availability })), q.cursor));
});
on("POST", "/v1/me/items", (p, q, b) => { const it = { id: id("i"), ...b, verified: false }; (items[ME] ||= []).push(it); return ok(it); });
on("DELETE", "/v1/me/items/:id", ({ id: iid }) => { items[ME] = (items[ME] || []).filter((x) => x.id !== iid); return ok({ ok: true }); });
on("POST", "/v1/follow", (p, q, b) => needUser() || (follows.push({ type: b.type, id: b.id, label: b.id }), ok({ ok: true })));
on("DELETE", "/v1/follow", (p, q, b) => { const i = follows.findIndex((f) => f.type === b.type && f.id === b.id); if (i >= 0) follows.splice(i, 1); return ok({ ok: true }); });
on("GET", "/v1/me/following", () => needUser() || ok({ items: follows }));
on("POST", "/v1/blocks", (p, q, b) => (blocks.push(b.handle), ok({ ok: true })));
on("DELETE", "/v1/blocks/:handle", ({ handle }) => { blocks.splice(blocks.indexOf(handle), 1); return ok({ ok: true }); });
on("GET", "/v1/blocks", () => ok({ items: blocks.map((hd) => pub(hd === "li_wei" ? "li" : hd)).filter(Boolean) }));

on("GET", "/v1/feed", (p, q) => {
  let list = posts.filter((x) => !x.removed_at && x.visibility !== "private");
  if (q.tab === "following") list = list.filter((x) => follows.some((f) => (f.type === "user" && f.id === x.author?.handle) || (f.type === "tag" && x.tags.includes(f.id))));
  if (q.tab === "world") list = list.filter((x) => x.location);
  if (q.tab === "research") list = list.filter((x) => ["analysis", "workflow", "dataset", "paper", "monitor"].includes(x.kind));
  if (q.tab === "opportunities") list = list.filter((x) => ["opportunity", "event", "challenge"].includes(x.kind));
  if (q.kind) list = list.filter((x) => x.kind === q.kind);
  if (q.tag) list = list.filter((x) => x.tags.includes(q.tag));
  if (q.author) list = list.filter((x) => x.author?.handle === q.author);
  if (q.type) list = list.filter((x) => x.meta?.type === q.type);
  if (q.community) { const c = communities.find((x) => x.slug === q.community); list = list.filter((x) => x.community_id === c?.id); }
  return ok(page(list.map(viewPost), q.cursor));
});
on("POST", "/v1/posts", (p, q, b) => {
  if (anon()) return err(401, "Sign in to do that.");
  if (!b.title && !b.body) return err(400, "A post needs a title or some text.");
  const loc = b.location && b.location.precision !== "hidden" && Number.isFinite(b.location.lat) ? { ...b.location } : null;
  if (loc && loc.precision === "approx") { loc.lat = Math.round(loc.lat * 10) / 10; loc.lon = Math.round(loc.lon * 10) / 10; }
  if (loc && loc.precision === "region") { loc.lat = Math.round(loc.lat); loc.lon = Math.round(loc.lon); }
  const post = addPost(ME, { ...b, location: loc, media: (b.media || []).map((m) => ({ ...m, url: mediaUrl(m.key) })), created_at: T() });
  posts.sort((a, c) => c.created_at - a.created_at);
  return ok(viewPost(post));
});
const findPost = (pid) => posts.find((x) => x.id === pid && !x.removed_at);
on("GET", "/v1/posts/:id", ({ id: pid }) => { const x = findPost(pid); return x ? ok(viewPost(x)) : err(404, "Not found."); });
on("PATCH", "/v1/posts/:id", ({ id: pid }, q, b) => { const x = findPost(pid); if (!x) return err(404, "Not found."); Object.assign(x, b, { updated_at: T() }); return ok(viewPost(x)); });
on("DELETE", "/v1/posts/:id", ({ id: pid }) => { const x = findPost(pid); if (x) x.removed_at = T(); return ok({ ok: true }); });
on("GET", "/v1/posts/:id/comments", ({ id: pid }) => ok({ items: comments.filter((c) => c.post_id === pid), next: null }));
on("POST", "/v1/posts/:id/comments", ({ id: pid }, q, b) => {
  if (anon()) return err(401, "Sign in to do that.");
  const c = { id: id("c"), post_id: pid, author: pub(ME), body: b.body, kind: b.kind || "comment", parent_id: b.parent_id || null, location: null, created_at: T(), accepted: false };
  comments.push(c); const x = findPost(pid); if (x) x.counts.comments += 1; return ok(c);
});
on("DELETE", "/v1/comments/:id", ({ id: cid }) => { const i = comments.findIndex((c) => c.id === cid); if (i >= 0) comments.splice(i, 1); return ok({ ok: true }); });
on("POST", "/v1/posts/:id/accept", ({ id: pid }, q, b) => { const x = findPost(pid); x.accepted_comment_id = b.comment_id; return ok({ ok: true }); });
on("POST", "/v1/posts/:id/react", ({ id: pid }, q, b) => { if (anon()) return err(401, "Sign in to do that."); const x = findPost(pid); if (!x._reacted.includes(b.kind)) { x._reacted.push(b.kind); x.counts.reactions += 1; } return ok({ ok: true }); });
on("DELETE", "/v1/posts/:id/react", ({ id: pid }, q, b) => { const x = findPost(pid); x._reacted = x._reacted.filter((k) => k !== b.kind); x.counts.reactions -= 1; return ok({ ok: true }); });
on("POST", "/v1/posts/:id/bookmark", ({ id: pid }) => { findPost(pid)._bookmarked = true; return ok({ ok: true }); });
on("DELETE", "/v1/posts/:id/bookmark", ({ id: pid }) => { findPost(pid)._bookmarked = false; return ok({ ok: true }); });
on("POST", "/v1/posts/:id/verify", ({ id: pid }, q, b) => { const x = findPost(pid); if (x.author?.handle === ME) return err(403, "You can't verify your own observation."); x.verification[b.verdict === "confirm" ? "confirms" : "disputes"] += 1; return ok({ ok: true }); });
on("POST", "/v1/posts/:id/fork", ({ id: pid }, q, b) => { const x = findPost(pid); if (!x.allow_fork) return err(403, "This post can't be forked."); x.counts.forks += 1; const f = addPost(ME, { ...x, id: undefined, author: pub(ME), forked_from: x.id, visibility: b.visibility || "public", counts: { reactions: 0, comments: 0, forks: 0 }, created_at: T(), _reacted: [] }); f.id = id("p"); return ok(viewPost(f)); });
on("GET", "/v1/posts/:id/cite", ({ id: pid }) => { const x = findPost(pid); const y = new Date(x.created_at * 1000).getFullYear(); const url = `https://geoidinitiative.com/social/#/post/${x.id}`; return ok({ text: `${x.author.name} (${y}). ${x.title || "Post"}. GeoID Network. ${url}`, bibtex: `@misc{${x.id},\n  author = {${x.author.name}},\n  title = {${x.title}},\n  year = {${y}},\n  howpublished = {GeoID Network},\n  url = {${url}}\n}`, url }); });
on("GET", "/v1/posts/:id/forks", ({ id: pid }) => ok({ items: posts.filter((x) => x.forked_from === pid).map(viewPost), next: null }));

on("POST", "/v1/media", (p, q, b) => {
  if (anon()) return err(401, "Sign in to do that.");
  const file = b.file;
  if (!file) return err(400, "No file.");
  if (file.size > 8 * 1024 * 1024) return err(413, "Files can be up to 8 MB.");
  const key = `m/${ME}/${id("f")}.${file.type === "application/pdf" ? "pdf" : "img"}`;
  media[key] = { url: URL.createObjectURL(file), type: file.type };
  return ok({ key, url: media[key].url, type: file.type, bytes: file.size });
});

on("GET", "/v1/search", (p, q) => {
  const s = String(q.q || "").toLowerCase();
  if (q.type === "people") return ok(page(Object.values(users).filter((u) => `${u.name} ${u.handle}`.toLowerCase().includes(s)).map((u) => pub(u.handle === "li_wei" ? "li" : u.handle)), q.cursor));
  if (q.type === "communities") return ok(page(communities.filter((c) => c.name.toLowerCase().includes(s)), q.cursor));
  if (q.type === "projects") return ok(page(projects.filter((c) => c.title.toLowerCase().includes(s)), q.cursor));
  if (q.type === "tags") return ok(page([...new Set(posts.flatMap((x) => x.tags))].filter((t) => t.includes(s)).map((t) => ({ tag: t, count: posts.filter((x) => x.tags.includes(t)).length })), q.cursor));
  return ok(page(posts.filter((x) => `${x.title} ${x.body} ${x.tags.join(" ")}`.toLowerCase().includes(s)).map(viewPost), q.cursor));
});
on("GET", "/v1/tags/trending", () => ok(["insar", "landslides", "etna", "iceland", "volcanology", "gnss"].map((t, i) => ({ tag: t, count: 20 - i * 3 }))));
on("GET", "/v1/map", (p, q) => {
  const [w, s, e, nn] = String(q.bbox || "-180,-90,180,90").split(",").map(Number);
  let pts = posts.filter((x) => x.location && x.location.lat >= s && x.location.lat <= nn && x.location.lon >= w && x.location.lon <= e);
  if (q.kinds) pts = pts.filter((x) => q.kinds.split(",").includes(x.kind));
  if (q.tag) pts = pts.filter((x) => x.tags.includes(q.tag));
  const out = pts.map((x) => ({ id: x.id, kind: x.kind, title: x.title, lat: x.location.lat, lon: x.location.lon, precision: x.location.precision, provenance: x.provenance, verification: x.verification, author: x.author }));
  if (!q.kinds || q.kinds === "project") projects.filter((x) => x.location).forEach((x) => out.push({ id: x.id, kind: "project", title: x.title, lat: x.location.lat, lon: x.location.lon, precision: "approx" }));
  if (Number(q.z) <= 1 && out.length > 12) {
    const grid = {};
    out.forEach((pt) => { const k = `${Math.floor(pt.lat / 45)}:${Math.floor(pt.lon / 45)}`; (grid[k] ||= []).push(pt); });
    const clusters = []; const single = [];
    Object.values(grid).forEach((g) => { if (g.length > 2) clusters.push({ lat: g.reduce((a, b) => a + b.lat, 0) / g.length, lon: g.reduce((a, b) => a + b.lon, 0) / g.length, count: g.length, kinds: {} }); else single.push(...g); });
    return ok({ clusters, points: single });
  }
  return ok({ clusters: [], points: out });
});
on("GET", "/v1/places", (p, q) => {
  const lat = Number(q.lat); const lon = Number(q.lon);
  const near = posts.filter((x) => x.location && Math.abs(x.location.lat - lat) < 1 && Math.abs(x.location.lon - lon) < 1);
  return ok({ posts: near.map(viewPost), projects: projects.filter((x) => x.location && Math.abs(x.location.lat - lat) < 1 && Math.abs(x.location.lon - lon) < 1), communities_active: near.length ? [{ slug: "volcano-geodesy", name: "Volcano geodesy", count: near.length }] : [], people: [...new Map(near.map((x) => [x.author.handle, x.author])).values()] });
});
on("GET", "/v1/events", (p, q) => ok(page(posts.filter((x) => x.kind === "event" && (!q.from || x.meta.starts_at >= Number(q.from) - DAY)).sort((a, b) => a.meta.starts_at - b.meta.starts_at).map(viewPost), q.cursor)));

on("GET", "/v1/notifications", (p, q) => needUser() || ok(page(notifications.filter((x) => !q.unread || !x.read), q.cursor)));
on("POST", "/v1/notifications/read", (p, q, b) => { notifications.forEach((x) => { if (!b.ids || b.ids.includes(x.id)) x.read = true; }); return ok({ ok: true }); });

on("GET", "/v1/communities", () => ok({ items: communities.map(({ rules, faq, resources, ...c }) => c), next: null }));
on("POST", "/v1/communities", (p, q, b) => { const c = { id: id("cm"), slug: b.slug || b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: b.name, description: b.description, tags: b.tags, visibility: b.visibility, member_count: 1, role: "owner", rules: [], faq: [], resources: [] }; communities.push(c); return ok(c); });
on("GET", "/v1/communities/:slug", ({ slug }) => { const c = communities.find((x) => x.slug === slug); if (!c) return err(404, "Not found."); return ok({ community: c, rules: c.rules, faq: c.faq, resources: c.resources, pinned: posts.filter((x) => x.pinned && x.community_id === c.id).map(viewPost), moderators: [{ user: pub("owen"), role: "owner" }], channels: [], role: anon() ? null : c.role }); });
on("PATCH", "/v1/communities/:slug", ({ slug }, q, b) => { Object.assign(communities.find((x) => x.slug === slug), b); return ok({ ok: true }); });
on("POST", "/v1/communities/:slug/join", ({ slug }) => { if (anon()) return err(401, "Sign in to do that."); const c = communities.find((x) => x.slug === slug); c.role = c.visibility === "approval" ? "requested" : "member"; return ok({ status: c.role === "requested" ? "requested" : "active" }); });
on("POST", "/v1/communities/:slug/leave", ({ slug }) => { communities.find((x) => x.slug === slug).role = null; return ok({ ok: true }); });
on("GET", "/v1/communities/:slug/members", (p, q) => ok(page(q.status === "requested" ? [{ user: pub("li"), role: "member", status: "requested", skills: ["insar"] }] : [{ user: pub("owen"), role: "owner", skills: ["insar", "fem"] }, { user: pub("amara"), role: "moderator", skills: ["landslides"] }, { user: pub("li"), role: "member", skills: ["insar"] }], q.cursor)));
on("POST", "/v1/communities/:slug/members/:handle", () => ok({ ok: true }));
on("POST", "/v1/communities/:slug/pin/:post_id", ({ post_id: pid }) => { findPost(pid).pinned = true; return ok({ ok: true }); });
on("DELETE", "/v1/communities/:slug/pin/:post_id", ({ post_id: pid }) => { findPost(pid).pinned = false; return ok({ ok: true }); });

on("GET", "/v1/teams", (p, q) => ok(page(q.mine ? teams.map((t) => ({ ...t, role: "lead", member_count: t.members.length })) : teams.filter((t) => t.visibility === "public"), q.cursor)));
on("POST", "/v1/teams", (p, q, b) => { const t = { id: id("t"), slug: b.slug || b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: b.name, description: b.description, visibility: b.visibility, conversation_id: id("cv"), members: [{ user: pub(ME), role: "lead", status: "active" }] }; teams.push(t); conversations.push({ id: t.conversation_id, kind: "team", title: t.name, members: [pub(ME)], status: "active", unread: 0, _messages: [] }); return ok(t); });
on("GET", "/v1/teams/:slug", ({ slug }) => { const t = teams.find((x) => x.slug === slug); if (!t) return err(404, "Not found."); return ok({ team: t, members: t.members, projects: projects.filter((x) => x.visibility === "team"), tasks: tasks.filter((k) => k.team === slug && k.status !== "done"), conversation_id: t.conversation_id }); });
on("POST", "/v1/teams/:slug/invite", ({ slug }, q, b) => { const t = teams.find((x) => x.slug === slug); const u = pub(b.handle === "li_wei" ? "li" : b.handle); if (!u) return err(404, "No member with that handle."); t.members.push({ user: u, role: b.role, status: "invited" }); return ok({ ok: true }); });
on("POST", "/v1/teams/:slug/members/:handle", ({ slug, handle }, q, b) => { const m = teams.find((x) => x.slug === slug).members.find((x) => x.user.handle === handle); Object.assign(m, b); return ok({ ok: true }); });
on("DELETE", "/v1/teams/:slug/members/:handle", ({ slug, handle }) => { const t = teams.find((x) => x.slug === slug); t.members = t.members.filter((x) => x.user.handle !== handle); return ok({ ok: true }); });
on("GET", "/v1/teams/:slug/tasks", ({ slug }) => ok({ items: tasks.filter((k) => k.team === slug), next: null }));
on("POST", "/v1/teams/:slug/tasks", ({ slug }, q, b) => { const k = { id: id("k"), team: slug, ...b, assignee: b.assignee ? pub(b.assignee === "li_wei" ? "li" : b.assignee) : null }; tasks.push(k); return ok(k); });
on("PATCH", "/v1/tasks/:id", ({ id: kid }, q, b) => { Object.assign(tasks.find((k) => k.id === kid), b); return ok({ ok: true }); });
on("DELETE", "/v1/tasks/:id", ({ id: kid }) => { tasks.splice(tasks.findIndex((k) => k.id === kid), 1); return ok({ ok: true }); });

const projShape = ({ _versions, _grants, ...p }) => p;
on("GET", "/v1/projects", (p, q) => {
  if (q.mine) return ok(page(projects.filter((x) => x.owner.handle === ME).map(projShape), q.cursor));
  if (q.shared) return ok(page(projects.filter((x) => x.owner.handle !== ME && x._grants.length).map((x) => ({ ...projShape(x), role: "viewer" })), q.cursor));
  return ok(page(projects.filter((x) => x.visibility === "public" && (!q.q || x.title.toLowerCase().includes(q.q.toLowerCase()))).map(projShape), q.cursor));
});
on("POST", "/v1/projects", (p, q, b) => { const pr = { id: id("pr"), ...b, owner: pub(ME), forked_from: null, _versions: b.workspace ? [{ version: 1, note: "From GeoHUB", created_at: T(), by: pub(ME) }] : [], _grants: [] }; projects.push(pr); return ok(projShape(pr)); });
on("GET", "/v1/projects/:id", ({ id: pid }) => { const pr = projects.find((x) => x.id === pid); if (!pr) return err(404, "Not found."); const role = anon() ? "public" : pr.owner.handle === ME ? "owner" : "viewer"; return ok({ project: projShape(pr), access: { role }, versions: pr._versions, grants: role === "owner" ? [...pr._grants] : undefined, posts: posts.filter((x) => x.project_id === pid).map(viewPost) }); });
on("PATCH", "/v1/projects/:id", ({ id: pid }, q, b) => { Object.assign(projects.find((x) => x.id === pid), b); return ok({ ok: true }); });
on("DELETE", "/v1/projects/:id", ({ id: pid }) => { projects.splice(projects.findIndex((x) => x.id === pid), 1); return ok({ ok: true }); });
on("POST", "/v1/projects/:id/versions", ({ id: pid }, q, b) => { const pr = projects.find((x) => x.id === pid); pr._versions.push({ version: pr._versions.length + 1, note: b.note, created_at: T(), by: pub(ME) }); return ok({ ok: true }); });
on("POST", "/v1/projects/:id/grants", ({ id: pid }, q, b) => { const pr = projects.find((x) => x.id === pid); if (b.handle && !users[b.handle] && b.handle !== "li_wei") return err(404, "No member with that handle."); const g = { id: id("g"), grantee: b.handle ? { type: "user", handle: b.handle, name: users[b.handle]?.name || "" } : { type: "team", slug: b.team_slug, name: b.team_slug }, role: b.role, expires_at: b.expires_at }; pr._grants.push(g); return ok(g); });
on("DELETE", "/v1/projects/:id/grants/:grant_id", ({ id: pid, grant_id: gid }) => { const pr = projects.find((x) => x.id === pid); pr._grants = pr._grants.filter((g) => g.id !== gid); return ok({ ok: true }); });
on("POST", "/v1/projects/:id/fork", ({ id: pid }) => { const pr = projects.find((x) => x.id === pid); const f = { ...pr, id: id("pr"), owner: pub(ME), forked_from: pid, _grants: [], _versions: pr._versions.slice(-1) }; projects.push(f); return ok(projShape(f)); });

const reviewList = (r) => { const { _reviewers, _comments, ...rest } = r; return rest; };
on("GET", "/v1/reviews", (p, q) => {
  if (q.role === "mine") return ok(page(reviews.filter((r) => r.requester.handle === ME).map(reviewList), q.cursor));
  if (q.role === "assigned") return ok(page(reviews.filter((r) => r._reviewers.some((x) => x.user.handle === ME)).map(reviewList), q.cursor));
  return ok(page(reviews.filter((r) => r.visibility === "open" && r.status === "open").map(reviewList), q.cursor));
});
on("POST", "/v1/reviews", (p, q, b) => { const r = { id: id("r"), ...b, status: "open", requester: pub(ME), created_at: T(), _reviewers: [], _comments: [] }; reviews.push(r); return ok(reviewList(r)); });
on("GET", "/v1/reviews/:id", ({ id: rid }) => { const r = reviews.find((x) => x.id === rid); if (!r) return err(404, "Not found."); const role = r.requester.handle === ME ? "requester" : r._reviewers.some((x) => x.user.handle === ME && x.status === "accepted") ? "reviewer" : "reader"; return ok({ review: { ...reviewList(r), doc_media_url: "" }, reviewers: r._reviewers, comments: r._comments, viewer_role: role }); });
on("POST", "/v1/reviews/:id/invite", ({ id: rid }, q, b) => { const u = pub(b.handle === "li_wei" ? "li" : b.handle); if (!u) return err(404, "No member with that handle."); reviews.find((x) => x.id === rid)._reviewers.push({ user: u, status: "invited", recommendation: null }); return ok({ ok: true }); });
on("POST", "/v1/reviews/:id/volunteer", ({ id: rid }) => { reviews.find((x) => x.id === rid)._reviewers.push({ user: pub(ME), status: "accepted", recommendation: null }); return ok({ ok: true }); });
on("POST", "/v1/reviews/:id/respond", () => ok({ ok: true }));
on("POST", "/v1/reviews/:id/comments", ({ id: rid }, q, b) => { reviews.find((x) => x.id === rid)._comments.push({ id: id("rc"), author: pub(ME), ...b, created_at: T(), resolved: false }); return ok({ ok: true }); });
on("POST", "/v1/review-comments/:id/resolve", ({ id: cid }) => { reviews.forEach((r) => r._comments.forEach((c) => { if (c.id === cid) c.resolved = true; })); return ok({ ok: true }); });
on("POST", "/v1/reviews/:id/submit", () => ok({ ok: true }));
on("PATCH", "/v1/reviews/:id", ({ id: rid }, q, b) => { Object.assign(reviews.find((x) => x.id === rid), b); return ok({ ok: true }); });

on("GET", "/v1/conversations", () => needUser() || ok({ items: conversations.map(({ _messages, ...c }) => ({ ...c, last: _messages.length ? { body: _messages[_messages.length - 1].body, at: _messages[_messages.length - 1].created_at, sender: _messages[_messages.length - 1].sender } : null })) }));
on("POST", "/v1/conversations", (p, q, b) => {
  const bad = (b.handles || []).find((hd) => !users[hd] && hd !== "li_wei");
  if (bad) return err(404, `No member called @${bad}.`);
  const c = { id: id("cv"), kind: b.handles.length > 1 ? "group" : "dm", title: b.title || "", members: [pub(ME), ...b.handles.map((hd) => pub(hd === "li_wei" ? "li" : hd))], status: "active", unread: 0, _messages: [{ id: id("m"), sender: pub(ME), body: b.body, created_at: T() }] };
  conversations.push(c); return ok({ id: c.id });
});
on("GET", "/v1/conversations/:id/messages", ({ id: cid }, q) => { const c = conversations.find((x) => x.id === cid); if (!c) return err(404, "Not found."); c.unread = 0; return ok({ items: c._messages.filter((m) => !q.after || m.created_at > Number(q.after)), next: null }); });
on("POST", "/v1/conversations/:id/messages", ({ id: cid }, q, b) => { const m = { id: id("m"), sender: pub(ME), body: b.body, created_at: T() }; conversations.find((x) => x.id === cid)._messages.push(m); return ok(m); });
on("POST", "/v1/conversations/:id/accept", ({ id: cid }) => { conversations.find((x) => x.id === cid).status = "active"; return ok({ ok: true }); });
on("POST", "/v1/conversations/:id/leave", ({ id: cid }) => { conversations.splice(conversations.findIndex((x) => x.id === cid), 1); return ok({ ok: true }); });
on("POST", "/v1/conversations/:id/mute", ({ id: cid }, q, b) => { conversations.find((x) => x.id === cid).muted = !!b.muted; return ok({ ok: true }); });

on("POST", "/v1/reports", () => ok({ ok: true }));
on("GET", "/v1/mod/reports", (p, q) => ok(page(reports.filter((r) => r.status === (q.status || "open")), q.cursor)));
on("POST", "/v1/mod/reports/:id", ({ id: rid }, q, b) => { const r = reports.find((x) => x.id === rid); r.status = "closed"; r.resolution = b.action; return ok({ ok: true }); });
on("GET", "/v1/mod/audit", () => ok({ items: [{ id: "a1", actor: pub("owen"), action: "grant", ref_type: "project", ref_id: "pr1", detail: { role: "commenter", to: "amara" }, created_at: T() - 10 * DAY }], next: null }));
on("POST", "/v1/match", (p, q, b) => needUser() || ok({
  items: Object.values(users).filter((u) => u.match_opt_in && u.availability !== "closed" && u.handle !== ME).map((u) => ({
    user: pub(u.handle === "li_wei" ? "li" : u.handle),
    reasons: (b.skills || []).filter((s) => u.skills.includes(s)).map((s) => `Lists ${s} as a skill (self-declared)`).concat(u.handle === "li_wei" ? ["Posted 1 analysis tagged insar"] : ["Submitted 1 review in volcanology"]),
  })).filter((x) => x.reasons.length),
  note: "Suggestions explain themselves and are not a ranking of anybody's ability.",
}));

export async function handle(method, path, query, body) {
  await new Promise((r) => setTimeout(r, 120));
  for (const r of R) {
    if (r.method !== method) continue;
    const m = r.rx.exec(path);
    if (!m) continue;
    const params = {};
    r.names.forEach((nm, i) => { params[nm] = decodeURIComponent(m[i + 1]); });
    // Writes need a user, as on the Worker.
    if (method !== "GET" && anon() && !path.startsWith("/v1/reports")) return err(401, "Sign in to do that.");
    return r.fn(params, query, body || {});
  }
  return err(404, `Mock: no route for ${method} ${path}.`);
}
