/**
 * #/opportunities and #/events.
 *
 * Events also carry attendance (RSVP going / interested / not going, with a
 * waitlist when meta.capacity is full), an .ics download, and for poster
 * sessions a gallery of posters. eventPanel() is the block the post page
 * draws under an event post.
 */
import * as api from "../api.js?v=20261026-c07cde6";
import { store } from "../store.js?v=20261026-c07cde6";
import { h, clear, field, input, select, dateToEpoch, epochToDate, put, toast, loading, errorBox, textarea, busy, empty, modal } from "../dom.js?v=20261026-c07cde6";
import { OPP_TYPES, postCard, pagedList, act, userChip, requireSignIn } from "../components.js?v=20261026-c07cde6";
import { topicOf } from "../topics.js?v=20261026-c07cde6";

export function renderOpportunities(root, { query }) {
  const external = query.tab === "external";
  const tabLink = (on, href, label) => h("a", { href, class: on ? "is-active" : "", "aria-current": on ? "page" : null }, label);
  put(clear(root),
    h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Opportunities" }), h("a", { class: "btn-primary", href: "#/compose?kind=opportunity" }, "Post an opportunity")),
    h("nav", { class: "s-tabs", "aria-label": "Where the opportunities come from" },
      tabLink(!external, "#/opportunities", "Posted here"),
      tabLink(external, "#/opportunities?tab=external", "External")),
    external ? externalBoard(query) : postedHere(query));
}

/** Members' own posts: jobs, grants, fieldwork, expertise wanted and offered, challenges. */
function postedHere(query) {
  const type = select("type", [["", "Any type"], ...OPP_TYPES.map((t) => [t, t[0].toUpperCase() + t.slice(1)])], query.type || "");
  const skill = input("skill", { value: query.skill || "", placeholder: "e.g. python" });
  const kind = select("kind", [["", "Opportunities, events and challenges"], ["opportunity", "Opportunities only"], ["event", "Events only"], ["challenge", "Challenges only"]], query.kind || "");
  const form = h("form", { class: "s-filters", "aria-label": "Filter opportunities" }, field("Show", kind), field("Type", type), field("Skill", skill),
    h("button", { type: "submit", class: "btn-primary" }, "Filter"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new URLSearchParams();
    if (kind.value) q.set("kind", kind.value);
    if (type.value) q.set("type", type.value);
    if (skill.value.trim()) q.set("skill", skill.value.trim());
    location.hash = `#/opportunities?${q.toString()}`;
  });
  return h("div", {},
    h("p", { class: "s-muted", text: "Posted by members: jobs, grants, studentships, fellowships, fieldwork, expertise wanted and offered. Sponsored challenges are always labelled." }),
    form,
    pagedList((cursor) => api.get("/v1/feed", { tab: "opportunities", origin: "here", kind: kind.value, type: query.type || "", skill: query.skill || "", cursor }), postCard,
      { emptyTitle: "No opportunities match.", emptyDetail: "Clear a filter, or post one yourself." }));
}

const shortDate = (s) => (s ? new Date(s * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(s * 1000).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : "");

/**
 * Adverts gathered from elsewhere (importer.js), deliberately unexplained:
 * no list of sources, counts or scan times, only the listings -- the newest
 * under their own heading -- each crediting where it came from. The summary
 * is read only for when the latest batch arrived. ?source=<id> still filters.
 */
function externalBoard(query) {
  const source = query.source || "";
  const box = h("div", {}, loading());
  (async () => {
    // A saved search opened from its alert: its filters become the page's.
    let saved = null;
    if (query.search && store.me) {
      try { saved = (await api.get("/v1/me/searches")).items.find((x) => x.id === query.search) || null; } catch (error) { saved = null; }
    }
    const f = { ...(saved?.query || {}), ...Object.fromEntries(["q", "field", "stage", "region", "remote", "closing", "sort"].filter((k) => query[k]).map((k) => [k, query[k]])) };
    let sum = { last_scan_at: 0 };
    try { sum = await api.get("/v1/imports/summary"); } catch (error) {
      if (error?.status === 404) { put(clear(box), empty("Nothing here yet.", "Check back soon.")); return; }
      throw error;
    }
    put(clear(box), jobFilters(f, saved), listings(f, source, sum));
  })().catch((error) => put(clear(box), errorBox(error)));
  return box;
}

const FIELD_OPTIONS = [["", "Any field"], ["volcanology", "Volcanology"], ["seismology", "Seismology"], ["geophysics", "Geophysics & geodesy"],
  ["geology", "Geology & geochemistry"], ["hydrology", "Hydrology & water"], ["cryosphere", "Glaciers & polar"], ["climate", "Climate & atmosphere"],
  ["oceans", "Oceans & coasts"], ["remote-sensing", "Remote sensing & EO"], ["gis", "GIS & mapping"], ["hazards", "Hazards & risk"],
  ["soils", "Soils"], ["geography", "Geography"]];
const STAGE_OPTIONS = [["", "Any stage"], ["phd", "PhD / studentship"], ["postdoc", "Postdoc / research staff"], ["faculty", "Lecturer / faculty"],
  ["internship", "Internship"], ["industry", "Industry / consultancy"]];

/** The member's own filters; "Save this search" keeps them, with an alert. */
function jobFilters(f, saved) {
  const q = input("q", { type: "search", value: f.q || "", placeholder: "Title, employer or keyword" });
  const fieldSel = select("field", FIELD_OPTIONS, f.field || "");
  const stage = select("stage", STAGE_OPTIONS, f.stage || "");
  const region = input("region", { value: f.region || "", placeholder: "e.g. UK, Norway, California" });
  const closing = select("closing", [["", "Any deadline"], ["7", "Closing within a week"], ["14", "Within two weeks"], ["30", "Within a month"]], String(f.closing || ""));
  const sort = select("sort", [["", "Newest first"], ["closing", "Closing soonest"]], f.sort || "");
  const remote = h("label", { class: "s-check s-check-inline" }, h("input", { type: "checkbox", name: "remote", checked: !!f.remote }), h("span", {}, "Remote or hybrid"));
  const values = () => ({ q: q.value.trim(), field: fieldSel.value, stage: stage.value, region: region.value.trim(),
    remote: remote.querySelector("input").checked ? "1" : "", closing: closing.value, sort: sort.value });
  const go = (extra = {}) => {
    const v = { ...values(), ...extra };
    const p = new URLSearchParams({ tab: "external" });
    for (const [k, val] of Object.entries(v)) if (val) p.set(k, val);
    location.hash = `#/opportunities?${p.toString()}`;
  };
  const form = h("form", { class: "s-filters s-job-filters", role: "search", "aria-label": "Filter external adverts" },
    field("Search", q), field("Field", fieldSel), field("Stage", stage), field("Region", region), field("Deadline", closing), field("Order", sort),
    remote,
    h("div", { class: "s-job-filter-acts" },
      h("button", { type: "submit", class: "btn-primary" }, "Show"),
      h("button", { type: "button", class: "btn-ghost", onClick: () => saveSearchDialog(values()) }, "Save this search…")));
  form.addEventListener("submit", (e) => { e.preventDefault(); go(); });
  return h("div", {}, saved ? h("p", { class: "s-banner" }, "Your saved search ", h("strong", { text: saved.name }), ". ",
    h("a", { href: "#/settings#searches" }, "Manage saved searches")) : null, form);
}

function saveSearchDialog(v) {
  if (!requireSignIn("save searches")) return;
  const { sort, ...query } = v;
  modal("Save this search", (close) => {
    const name = input("name", { maxlength: 80, placeholder: "e.g. Volcanology PhDs in the UK", required: true });
    const alert = select("alert", [["daily", "Tell me every day there is something new"], ["weekly", "Once a week, on Mondays"], ["off", "No alerts, just keep it"]], "daily");
    const form = h("form", { class: "s-form" }, field("Name", name), field("Alerts", alert, "Alerts arrive as notifications, and by email if you have chosen email."),
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Save")));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      act(async () => {
        await api.post("/v1/me/searches", { name: name.value.trim(), query, alert: alert.value });
        toast("Saved. New matches will reach you.");
        close(true);
      }, "save searches");
    });
    return form;
  });
}

function listings(f, source, sum) {
  let section = "";
  const row = (p) => {
    const out = [];
    // Newest first: the latest batch under its own heading. By deadline, no groups.
    if (!f.sort) {
      const fresh = sum.last_scan_at && p.created_at >= sum.last_scan_at;
      const want = fresh ? "new" : "open";
      if (want !== section) { section = want; out.push(h("h2", { class: "s-h3 s-scan-group", text: fresh ? "New" : "Still open" })); }
    }
    out.push(listingCard(p));
    return out;
  };
  return pagedList((cursor) => api.get("/v1/feed", { tab: "opportunities", origin: "external", source, ...f, cursor }), row,
    { emptyTitle: "No adverts match.", emptyDetail: "Widen a filter, or save the search and hear when one arrives.", listClass: "s-list s-listings" });
}

/** Save an advert: it is kept under Saved, and a reminder comes before it closes. */
function saveToggle(p) {
  let on = !!p.viewer?.bookmarked;
  const btn = h("button", { type: "button", class: "s-act", "aria-pressed": String(on), title: "Saved adverts get a reminder three days before they close" });
  const draw = () => { btn.textContent = on ? "Saved" : "Save"; btn.setAttribute("aria-pressed", String(on)); };
  draw();
  btn.addEventListener("click", () => act(async () => {
    if (on) await api.del(`/v1/posts/${encodeURIComponent(p.id)}/bookmark`, {}); else await api.post(`/v1/posts/${encodeURIComponent(p.id)}/bookmark`, { collection: "Jobs" });
    on = !on; draw();
    if (on && p.meta?.deadline) toast("Saved. You'll get a reminder before it closes.");
  }, "save adverts"));
  return btn;
}

/** One gathered advert: what, who, where, when it closes, where it came from, and the way to apply. */
function listingCard(p) {
  const m = p.meta || {};
  const advert = m.apply_url || p.links?.[0]?.url || "";
  const via = m.source_name || "an external listing";
  const topic = topicOf(p);
  const closes = m.deadline ? `Closes ${shortDate(m.deadline)}` : "";
  const pay = (/^Salary: (.+)\.$/m.exec(p.body || "") || [])[1] || "";
  const salary = pay.length > 70 ? `${pay.slice(0, 68).replace(/\s+\S*$/, "")}…` : pay;
  return h("article", { class: "s-card s-listing", "data-topic": topic?.id || null, "aria-labelledby": `lt-${p.id}` },
    h("div", { class: "s-listing-main" },
      h("h3", { class: "s-listing-title", id: `lt-${p.id}` }, h("a", { href: `#/post/${encodeURIComponent(p.id)}` }, p.title)),
      h("p", { class: "s-listing-org" }, m.org ? h("strong", { text: m.org }) : null, p.place_name ? h("span", { class: "s-muted", text: ` · ${p.place_name}` }) : null),
      h("p", { class: "s-listing-meta" },
        m.type ? h("span", { class: "s-kind", text: m.type }) : null,
        topic ? h("span", { class: "s-topic", text: topic.label }) : null,
        salary ? h("span", { class: "s-muted", text: salary }) : null,
        h("span", { class: "s-vis s-imported", text: `via ${via}` }))),
    h("div", { class: "s-listing-side" },
      closes ? h("span", { class: "s-listing-closes", text: closes }) : h("span", { class: "s-muted", text: `Added ${shortDate(p.created_at)}` }),
      h("div", { class: "s-listing-acts" },
        saveToggle(p),
        h("a", { class: "s-act", href: `#/post/${encodeURIComponent(p.id)}` }, "Details"),
        advert ? h("a", { class: "btn-primary s-btn-sm", href: advert, target: "_blank", rel: "noopener noreferrer" }, `Apply on ${via.replace(/ (Jobs|Career Center)$/, "")} ↗`) : null)));
}

export function renderEvents(root, { query }) {
  const from = input("from", { type: "date", value: query.from || epochToDate(Math.floor(Date.now() / 1000)) });
  const until = input("until", { type: "date", value: query.until || "" });
  const form = h("form", { class: "s-filters", "aria-label": "Filter events" }, field("From", from), field("Until", until),
    h("button", { type: "submit", class: "btn-primary" }, "Show"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    location.hash = `#/events?from=${from.value}${until.value ? `&until=${until.value}` : ""}`;
  });
  const yours = query.mine === "1";
  const tabLink = (on, href, label) => h("a", { href, class: on ? "is-active" : "", "aria-current": on ? "page" : null }, label);
  // RSVP counts for a page come in one request after the page itself.
  const rsvps = new Map();
  const withRsvps = (fetchPage) => async (cursor) => {
    const data = await fetchPage(cursor);
    const ids = (data?.items || []).map((p) => p.id);
    if (ids.length) {
      try {
        const out = await api.get("/v1/event-rsvps", { ids: ids.join(",") });
        for (const it of out?.items || []) rsvps.set(it.event_id, it);
      } catch (error) { /* the cards still draw, without counts */ }
    }
    return data;
  };
  const item = (p) => h("div", { class: "s-event-item" }, postCard(p), rsvpStrip(p, rsvps.get(p.id)));
  put(clear(root),
    h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Events" }), h("a", { class: "btn-primary", href: "#/compose?kind=event" }, "Post an event")),
    h("p", { class: "s-muted", text: "Webinars, seminars, workshops, hackathons, field courses and poster sessions, soonest first." }),
    h("nav", { class: "s-tabs", "aria-label": "Events" }, tabLink(!yours, "#/events", "All events"), tabLink(yours, "#/events?mine=1", "Yours")),
    yours ? null : form,
    yours
      ? (store.me ? pagedList(withRsvps(() => api.get("/v1/me/rsvps")), item,
        { emptyTitle: "You have not said you're coming to anything yet.", emptyDetail: "Answer Going or Interested on an event and it shows here." })
        : empty("Sign in to see your events."))
      : pagedList(withRsvps((cursor) => api.get("/v1/events", { from: dateToEpoch(from.value), until: dateToEpoch(until.value, true), cursor })), item,
        { emptyTitle: "No events in that range." }));
}

// ── Attendance ─────────────────────────────────────────────────────────────

const enc = encodeURIComponent;
const RSVP_LABEL = { going: "Going", interested: "Interested", not_going: "Not going", waitlist: "On the waitlist" };

function countsText(s) {
  const c = s?.counts || {};
  return [`${c.going || 0} going`, `${c.interested || 0} interested`,
    c.waitlist ? `${c.waitlist} waiting` : "",
    s?.capacity ? `${s.spots_left} ${s.spots_left === 1 ? "place" : "places"} left of ${s.capacity}` : ""].filter(Boolean).join(" · ");
}

/** Going / Interested / Not going. Pressing your current answer again takes it back. */
function rsvpButtons(p, s, onChange) {
  const current = s?.mine?.status === "waitlist" ? "going" : s?.mine?.status;
  const group = h("div", { class: "s-rsvp", role: "group", "aria-label": "Will you come?" });
  for (const status of ["going", "interested", "not_going"]) {
    const on = current === status;
    put(group, h("button", { type: "button", class: `s-act${on ? " is-on" : ""}`, "aria-pressed": String(on), onClick: () => act(async () => {
      const path = `/v1/events/${enc(p.id)}/rsvp`;
      const out = on ? await api.del(path) : await api.post(path, { status, show_me: s?.mine?.show_me || false });
      if (out?.mine?.status === "waitlist") toast("The event is full: you are on the waitlist, and will be told if a place opens.");
      onChange(out);
    }, "RSVP to events") }, status === "going" && s?.mine?.status === "waitlist" ? RSVP_LABEL.waitlist : RSVP_LABEL[status]));
  }
  return group;
}

/** Fetch the .ics with the Bearer (private events need it) and hand it to the browser as a download. */
async function downloadIcs(p) {
  try {
    const res = await api.request("GET", `/v1/events/${enc(p.id)}/ics`, { raw: true });
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    // A blob URL we just made, not user content: set directly, since h() only admits http(s) links.
    const a = document.createElement("a");
    a.href = href;
    a.download = `${String(p.title || "event").replace(/[^\w.-]+/g, "-").slice(0, 60) || "event"}.ics`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10000);
  } catch (error) {
    toast(error.message || "Could not make the calendar file.", "error");
  }
}

function calendarButton(p, cls = "s-act") {
  if (!p.meta?.starts_at) return null;
  return h("button", { type: "button", class: cls, onClick: () => downloadIcs(p), title: "Download an .ics file for Outlook, Apple or Google Calendar" }, "Add to calendar");
}

function rsvpStrip(p, info) {
  const strip = h("div", { class: "s-rsvp-strip" });
  const draw = (s) => {
    clear(strip);
    put(strip, h("span", { class: "s-muted", text: countsText(s) }),
      s?.over ? h("span", { class: "s-vis", text: "Over" }) : rsvpButtons(p, s, draw),
      calendarButton(p));
  };
  draw(info);
  return strip;
}

/** The attendance block under an event post: RSVP, calendar, attendees, capacity, posters. */
export function eventPanel(p) {
  const section = h("div", { class: "s-event-panel", role: "region", "aria-labelledby": "ev-att" });
  const heading = () => h("h2", { class: "s-h2", id: "ev-att", text: "Attendance" });
  const draw = (s) => {
    clear(section);
    const mine = s.mine;
    const showMe = h("input", { type: "checkbox", checked: !!mine?.show_me });
    showMe.addEventListener("change", () => act(async () => {
      const status = mine.status === "waitlist" ? "going" : mine.status;
      draw(await api.post(`/v1/events/${enc(p.id)}/rsvp`, { status, show_me: showMe.checked }));
    }, "RSVP to events"));
    put(section, heading(),
      h("p", { class: "s-rsvp-counts", text: countsText(s) }),
      s.over ? h("p", { class: "s-muted", text: "This event is over." }) : h("div", { class: "s-actions" }, rsvpButtons(p, s, draw)),
      mine && mine.status !== "not_going" && !s.over
        ? h("label", { class: "s-check s-inline" }, showMe, h("span", {}, "Show others that I'm coming")) : null,
      mine?.status === "waitlist" ? h("p", { class: "s-hint", text: "The event is full. You are on the waitlist and will be told if a place opens." }) : null,
      h("div", { class: "s-actions" }, calendarButton(p, "btn-ghost s-btn-sm")),
      attendees(s),
      s.organiser ? capacityForm(p, s, draw) : null);
    if (s.format === "poster-session" || s.format === "conference") put(section, postersBlock(p, s));
    if (s.format === "conference") put(section, conferenceBlock(p, s));
  };
  const load = async () => {
    put(clear(section), heading(), loading());
    try { draw(await api.get(`/v1/events/${enc(p.id)}/rsvp`)); } catch (error) { put(clear(section), heading(), errorBox(error, load)); }
  };
  load();
  return section;
}

// ── Conferences: the programme members declare, and meet-ups ───────────────

const ITEM_KINDS = [["talk", "Talk"], ["poster", "Poster"], ["pico", "PICO"], ["convening", "Convening a session"]];

/** What members present, by session; meet-ups at the meeting (conference.js). */
function conferenceBlock(p, s) {
  const box = h("div", { class: "s-conference" });
  const prog = h("div", {}, loading());
  const meets = h("div", {}, loading());
  const filter = input("session", { placeholder: "Session, e.g. GMPV9", "aria-label": "Filter by session" });
  const loadProg = () => api.get(`/v1/events/${enc(p.id)}/programme`, { session: filter.value.trim() }).then((d) => {
    const groups = new Map();
    for (const it of d.items || []) {
      const k = it.session || "No session given";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    put(clear(prog), groups.size ? [...groups].map(([session, items]) => h("div", { class: "s-session" },
      h("h4", { class: "s-session-code", text: session }),
      h("ul", { class: "s-rows" }, items.map((it) => h("li", { class: "s-row" },
        h("span", { class: "s-kind", text: it.kind_label }),
        it.post_id ? h("a", { href: `#/post/${enc(it.post_id)}` }, it.title) : h("span", { text: it.title }),
        userChip(it.user, { sub: false }),
        it.starts_at ? h("span", { class: "s-muted", text: new Date(it.starts_at * 1000).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) }) : null,
        it.mine ? h("button", { type: "button", class: "s-link-btn s-danger", onClick: () => act(async () => { await api.del(`/v1/events/${enc(p.id)}/programme/${enc(it.id)}`); loadProg(); }) }, "Remove") : null)))))
      : h("p", { class: "s-muted", text: filter.value ? "Nobody in that session yet." : "Nobody has added a talk or poster yet." }));
  }).catch((error) => put(clear(prog), errorBox(error)));
  filter.addEventListener("input", () => { clearTimeout(filter._t); filter._t = setTimeout(loadProg, 300); });

  const kind = select("kind", ITEM_KINDS, "talk");
  const session = input("session-code", { maxlength: 40, placeholder: "GMPV9.2" });
  const title = input("title", { maxlength: 300, placeholder: "Title of your talk or poster" });
  const when = input("when", { type: "datetime-local" });
  const addForm = h("form", { class: "s-form s-form-inline" }, field("What", kind), field("Session", session), field("When (optional)", when),
    h("div", { class: "s-span-2" }, field("Title", title)), h("button", { type: "submit", class: "btn-primary s-btn-sm" }, "Add to the programme"));
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    act(async () => {
      await api.post(`/v1/events/${enc(p.id)}/programme`, { kind: kind.value, session: session.value, title: title.value,
        starts_at: when.value ? Math.floor(new Date(when.value).getTime() / 1000) : null });
      title.value = ""; toast("Added."); loadProg();
    }, "add to the programme");
  });
  api.get(`/v1/events/${enc(p.id)}/meetups`).then((d) => {
    const items = d?.items || [];
    put(clear(meets), items.length ? h("div", { class: "s-list" }, items.map(postCard)) : h("p", { class: "s-muted", text: "No meet-ups yet." }));
  }).catch(() => clear(meets));
  loadProg();
  const canAdd = store.me && (s.mine?.status && s.mine.status !== "not_going" || s.over || s.organiser);
  return put(box,
    h("h3", { class: "s-h3", text: "Talks, posters and sessions" }),
    h("p", { class: "s-hint", text: "What members are presenting or convening, so you can find each other by topic before you arrive." }),
    filter, prog,
    canAdd ? h("details", { class: "s-add" }, h("summary", {}, "Add what you're presenting"), addForm)
      : h("p", { class: "s-hint", text: "Say you're going to add your talk or poster." }),
    h("div", { class: "s-title-row" }, h("h3", { class: "s-h3", text: "Meet-ups" }),
      store.me ? h("a", { class: "btn-ghost s-btn-sm", href: `#/compose?kind=event&parent=${enc(p.id)}` }, "Organise a meet-up") : null),
    meets);
}

function attendees(s) {
  const list = s.attendees || [];
  const note = s.organiser
    ? "You see everyone who answered. Others see the counts, and the names of people who chose to show they're coming."
    : "Only people who chose to show they're coming are named.";
  return h("div", { class: "s-attendees" },
    h("h3", { class: "s-h3", text: s.organiser ? "Who's coming" : "Coming" }),
    list.length ? h("ul", { class: "s-rows" }, list.map((a) => h("li", { class: "s-row" }, userChip(a.user, { sub: false }),
      h("span", { class: "s-kind", text: RSVP_LABEL[a.status] || a.status }),
      s.organiser && a.shown === false ? h("span", { class: "s-vis", text: "Not shown to others" }) : null)))
      : h("p", { class: "s-muted", text: "Nobody named yet." }),
    h("p", { class: "s-hint", text: note }));
}

function capacityForm(p, s, draw) {
  const cap = input("capacity", { type: "number", min: 1, step: 1, value: s.capacity || "", placeholder: "No limit" });
  const form = h("form", { class: "s-inline-form" }, field("Capacity", cap, "When it is full, people join a waitlist and move up as places free."),
    h("button", { type: "submit", class: "btn-ghost s-btn-sm" }, "Set"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    act(async () => { draw(await api.patch(`/v1/events/${enc(p.id)}`, { capacity: cap.value ? Number(cap.value) : null })); toast("Saved."); }, "change events");
  });
  return form;
}

// ── Poster sessions ────────────────────────────────────────────────────────

function postersBlock(p, s) {
  const box = h("div", { class: "s-posters", role: "region", "aria-labelledby": "ev-posters" });
  const path = `/v1/events/${enc(p.id)}/posters`;
  const canSubmit = !!store.me && !s.over && (s.organiser || (s.mine && s.mine.status !== "not_going"));
  const load = async () => {
    put(clear(box), h("h2", { class: "s-h2", id: "ev-posters", text: "Posters" }), loading());
    let data;
    try { data = await api.get(path); } catch (error) { box.lastChild.replaceWith(errorBox(error, load)); return; }
    box.lastChild.remove();
    const items = data?.items || [];
    const STATUS = { pending: "Waiting for the organiser", rejected: "Not taken" };
    put(box,
      h("p", { class: "s-muted", text: "Each poster is a post; discuss it in its own comments." }),
      items.length ? h("div", { class: "s-poster-grid" }, items.map((it) => h("div", { class: "s-poster" },
        postCard(it.post),
        h("div", { class: "s-poster-foot" },
          it.status !== "approved" ? h("span", { class: "s-vis", text: STATUS[it.status] || it.status }) : null,
          h("a", { class: "s-act", href: `#/post/${enc(it.post.id)}` }, `Discuss (${it.post.counts?.comments || 0})`),
          data.organiser && it.status !== "approved" ? h("button", { type: "button", class: "s-act", onClick: () => act(async () => {
            await api.post(`${path}/${enc(it.post.id)}`, { status: "approved" }); load();
          }) }, "Approve") : null,
          data.organiser && it.status === "pending" ? h("button", { type: "button", class: "s-act", onClick: () => act(async () => {
            await api.post(`${path}/${enc(it.post.id)}`, { status: "rejected" }); load();
          }) }, "Decline") : null,
          data.organiser || it.submitted_by?.handle === store.me?.user?.handle ? h("button", { type: "button", class: "s-act s-danger", onClick: () => act(async () => {
            await api.del(`${path}/${enc(it.post.id)}`); load();
          }) }, "Take down") : null))))
        : empty("No posters yet.", canSubmit ? "Submit one of your posts below." : "Attendees submit their posts; the organiser approves them."),
      canSubmit ? submitPosterForm(p, s, path, load) : null);
  };
  load();
  return box;
}

function submitPosterForm(p, s, path, onDone) {
  const choice = select("post_id", [["", "Loading your posts…"]], "");
  const note = textarea("note", { rows: 2, maxlength: 500 });
  const form = h("form", { class: "s-form s-poster-form" }, h("h3", { class: "s-h3", text: "Present a poster" }),
    field("Your post", choice, "A public or unlisted post, so everyone at the session can read it."),
    field("Note for the organiser (optional)", note),
    h("button", { type: "submit", class: "btn-primary s-btn-sm" }, s.organiser ? "Add poster" : "Submit for approval"));
  api.get("/v1/feed", { author: store.me?.user?.handle }).then((d) => {
    const mine = (d?.items || []).filter((x) => x.kind !== "event" && ["public", "unlisted"].includes(x.visibility));
    clear(choice);
    put(choice, h("option", { value: "" }, mine.length ? "Choose a post" : "You have no public posts yet"),
      mine.map((x) => h("option", { value: x.id }, x.title || String(x.body || "").slice(0, 60) || "Untitled")));
  }).catch(() => { clear(choice); put(choice, h("option", { value: "" }, "Could not load your posts")); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireSignIn("present posters")) return;
    if (!choice.value) { toast("Choose a post.", "error"); return; }
    const done = busy(form);
    try {
      const out = await api.post(path, { post_id: choice.value, note: note.value });
      toast(out.status === "approved" ? "Added to the gallery." : "Submitted. The organiser will review it.");
      onDone();
    } catch (error) { toast(error.message, "error"); done(); }
  });
  return form;
}

