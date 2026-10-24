/** #/people — find people, and the collaboration matcher. */
import * as api from "../api.js?v=20261024-73c6325";
import { store } from "../store.js?v=20261024-73c6325";
import { h, clear, field, input, checkbox, splitList, busy, errorBox, loading, empty, put } from "../dom.js?v=20261024-73c6325";
import { userChip, pagedList, requireSignIn, affiliationBadge, mentoringBadge } from "../components.js?v=20261024-73c6325";
import { mentoringRequestDialog } from "./settings.js?v=20261024-73c6325";

export function render(root, { query }) {
  const f = {
    q: input("q", { type: "search", value: query.q || "", placeholder: "Name, handle or institution" }),
    skill: input("skill", { value: query.skill || "", placeholder: "e.g. insar" }),
    interest: input("interest", { value: query.interest || "" }),
    region: input("region", { value: query.region || "" }),
    available: checkbox("available", "Open to collaborate", query.available === "1"),
    mentor: checkbox("mentor", "Open to mentoring", query.mentor === "1"),
  };
  const form = h("form", { class: "s-filters", role: "search", "aria-label": "Find people" },
    field("Search", f.q), field("Skill", f.skill), field("Interest", f.interest), field("Region", f.region), f.available, f.mentor,
    h("button", { type: "submit", class: "btn-primary" }, "Find"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = new URLSearchParams();
    for (const k of ["q", "skill", "interest", "region"]) if (f[k].value.trim()) q.set(k, f[k].value.trim());
    if (f.available.querySelector("input").checked) q.set("available", "1");
    if (f.mentor.querySelector("input").checked) q.set("mentor", "1");
    location.hash = `#/people?${q.toString()}`;
  });

  const results = pagedList(
    (cursor) => api.get("/v1/users", { q: query.q, skill: query.skill, interest: query.interest, region: query.region, available: query.available === "1", mentor: query.mentor === "1", cursor }),
    (u) => h("div", { class: "s-card s-person" }, userChip(u),
      u.affiliation || u.mentoring ? h("p", { class: "s-labels" }, affiliationBadge(u.affiliation), mentoringBadge(u, u.mentoring_topics),
        u.mentoring && store.me && u.handle !== store.me.user?.handle
          ? h("button", { type: "button", class: "s-link-btn", onClick: () => mentoringRequestDialog(u) }, "Ask for mentoring") : null) : null,
      u.skills?.length ? h("p", { class: "s-muted" }, "Skills (self-declared): ", u.skills.slice(0, 8).join(", ")) : null,
      u.availability ? h("p", { class: "s-hint", text: u.availability === "open" ? "Open to collaborate" : u.availability === "limited" ? "Limited availability" : "Not taking on collaborations" }) : null),
    { emptyTitle: "Nobody matches those filters.", emptyDetail: "Try fewer filters or a broader skill." });

  put(clear(root),
    h("h1", { class: "s-h1", text: "People" }),
    form,
    h("div", { class: "s-grid-main" }, h("section", { "aria-label": "People" }, results), matcher()));
}

function matcher() {
  const box = h("aside", { class: "s-side s-matcher", "aria-labelledby": "match-h" },
    h("h2", { class: "s-side-title", id: "match-h", text: "Find collaborators" }),
    h("p", { class: "s-muted", text: "Describe what you need. Suggestions come only from members who opted in, and each one says why it was suggested." }));
  const skills = input("skills", { required: true, placeholder: "insar, gnss, python" });
  const topic = input("topic", { placeholder: "e.g. volcano deformation" });
  const region = input("region", { placeholder: "e.g. Iceland" });
  const out = h("div", { "aria-live": "polite" });
  const form = h("form", {}, field("Skills needed", skills, "Comma-separated."), field("Topic", topic), field("Region", region),
    h("button", { type: "submit", class: "btn-primary" }, "Suggest people"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireSignIn("use the collaboration matcher")) return;
    const done = busy(form);
    put(clear(out), loading());
    try {
      const data = await api.post("/v1/match", { skills: splitList(skills.value), topic: topic.value, region: region.value });
      clear(out);
      const items = data?.items || [];
      put(out, h("p", { class: "s-note", text: data?.note || "Suggestions explain themselves and are not a ranking of anybody's ability." }));
      if (!items.length) put(out, empty("No suggestions.", "Only members who opted in to the matcher and are open to collaborate can be suggested."));
      else put(out, h("ul", { class: "s-match-list" }, items.map((it) => h("li", {}, userChip(it.user),
        h("ul", { class: "s-reasons", "aria-label": "Why suggested" }, (it.reasons || []).map((r) => h("li", { text: r })))))));
    } catch (error) { put(clear(out), errorBox(error)); }
    done();
  });
  put(box, form, out,
    store.me && !store.me.user?.match_opt_in
      ? h("p", { class: "s-hint" }, "You are not in the matcher yourself. ", h("a", { href: "#/settings" }, "Opt in under Settings"), ".")
      : null);
  return box;
}
