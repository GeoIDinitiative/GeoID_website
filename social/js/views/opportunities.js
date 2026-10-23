/** #/opportunities and #/events. */
import * as api from "../api.js";
import { h, clear, field, input, select, dateToEpoch, epochToDate, put } from "../dom.js";
import { OPP_TYPES, postCard, pagedList } from "../components.js";

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
  put(clear(root),
    h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Events" }), h("a", { class: "btn-primary", href: "#/compose?kind=event" }, "Post an event")),
    h("p", { class: "s-muted", text: "Webinars, seminars, workshops, hackathons, field courses and poster sessions, soonest first." }),
    form,
    pagedList((cursor) => api.get("/v1/events", { from: dateToEpoch(from.value), until: dateToEpoch(until.value, true), cursor }), postCard,
      { emptyTitle: "No events in that range." }));
}
