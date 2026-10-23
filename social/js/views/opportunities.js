/**
 * #/opportunities and #/events.
 *
 * Events also carry attendance (RSVP going / interested / not going, with a
 * waitlist when meta.capacity is full), an .ics download, and for poster
 * sessions a gallery of posters. eventPanel() is the block the post page
 * draws under an event post.
 */
import * as api from "../api.js?v=20261023-9fdcfa0";
import { store } from "../store.js?v=20261023-9fdcfa0";
import { h, clear, field, input, select, dateToEpoch, epochToDate, put, toast, loading, errorBox, textarea, busy, empty } from "../dom.js?v=20261023-9fdcfa0";
import { OPP_TYPES, postCard, pagedList, act, userChip, requireSignIn } from "../components.js?v=20261023-9fdcfa0";

export function renderOpportunities(root, { query }) {
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
  put(clear(root),
    h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Opportunities" }), h("a", { class: "btn-primary", href: "#/compose?kind=opportunity" }, "Post an opportunity")),
    h("p", { class: "s-muted", text: "Jobs, grants, studentships, fellowships, fieldwork, expertise wanted and offered. Sponsored challenges are always labelled." }),
    form,
    pagedList((cursor) => api.get("/v1/feed", { tab: "opportunities", kind: kind.value, type: query.type || "", skill: query.skill || "", cursor }), postCard,
      { emptyTitle: "No opportunities match.", emptyDetail: "Clear a filter, or post one yourself." }));
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
    if (s.format === "poster-session") put(section, postersBlock(p, s));
  };
  const load = async () => {
    put(clear(section), heading(), loading());
    try { draw(await api.get(`/v1/events/${enc(p.id)}/rsvp`)); } catch (error) { put(clear(section), heading(), errorBox(error, load)); }
  };
  load();
  return section;
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

