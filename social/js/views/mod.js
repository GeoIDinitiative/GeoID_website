/** #/mod — the report queue and the audit log, for admins and community moderators. */
import * as api from "../api.js?v=20261023-f0a10a7";
import { store } from "../store.js?v=20261023-f0a10a7";
import { h, clear, field, input, select, textarea, toast, busy, empty, timeEl, put } from "../dom.js?v=20261023-f0a10a7";
import { userChip, pagedList, provenanceBadge, kindLabel } from "../components.js?v=20261023-f0a10a7";

export function render(root, { query }) {
  if (!store.me) {
    put(clear(root), h("h1", { class: "s-h1", text: "Moderation" }), empty("Sign in as a moderator to see reports."));
    return;
  }
  const tab = query.tab === "audit" ? "audit" : query.tab === "closed" ? "closed" : "open";
  const tabLink = (id, label) => h("a", { href: `#/mod?tab=${id}`, class: id === tab ? "is-active" : "", "aria-current": id === tab ? "page" : null }, label);
  const body = tab === "audit"
    ? pagedList((cursor) => api.get("/v1/mod/audit", { cursor }), (a) => h("div", { class: "s-card s-audit" },
      h("p", {}, a.actor ? userChip(a.actor, { sub: false }) : h("span", { text: "system" }), " ", h("strong", {}, a.action), ` ${a.ref_type || ""} ${a.ref_id || ""}`),
      a.detail ? h("pre", { class: "s-pre" }, JSON.stringify(a.detail, null, 2)) : null, timeEl(a.created_at, true)),
    { emptyTitle: "The audit log is empty." })
    : pagedList((cursor) => api.get("/v1/mod/reports", { status: tab, cursor }), (r) => reportCard(r, tab === "open"),
      { emptyTitle: tab === "open" ? "No open reports." : "No closed reports.", emptyDetail: "Admins see every report; community moderators see reports on posts in their communities." });
  put(clear(root), h("h1", { class: "s-h1", text: "Moderation" }),
    h("p", { class: "s-muted", text: "Every action here is recorded in the audit log and the author is notified. Reading reported private content is logged too." }),
    h("nav", { class: "s-tabs", "aria-label": "Moderation" }, tabLink("open", "Open reports"), tabLink("closed", "Closed"), store.me.admin ? tabLink("audit", "Audit log") : null),
    body);
}

function reportCard(r, open) {
  const t = r.target || {};
  const card = h("article", { class: "s-card s-report" },
    h("header", { class: "s-card-head" },
      h("span", {}, h("strong", {}, r.kind === "appeal" ? "Appeal" : "Report"), `: ${r.reason || "no reason"} · ${r.target_type} `),
      timeEl(r.created_at)),
    r.reporter ? h("p", { class: "s-hint" }, "Reported by ", userChip(r.reporter, { sub: false })) : null,
    r.note ? h("blockquote", { class: "s-quote", text: r.note }) : null,
    h("div", { class: "s-report-target" },
      t.removed_at ? h("p", { class: "s-vis", text: "Currently removed" }) : null,
      t.author ? userChip(t.author) : t.handle ? userChip(t) : null,
      t.kind ? h("p", { class: "s-labels" }, h("span", { class: "s-kind", text: kindLabel(t.kind) }), provenanceBadge(t.provenance)) : null,
      t.title ? h("p", {}, h("strong", {}, t.title)) : null,
      t.body ? h("p", { class: "s-muted", text: String(t.body).slice(0, 1200) }) : null,
      r.target_type === "post" ? h("a", { href: `#/post/${encodeURIComponent(r.target_id)}` }, "Open the post") : null));
  if (open) {
    const action = select("action", [["dismiss", "Dismiss — no action"], ["remove", "Remove the content"], ["restore", "Restore the content"], ["warn", "Warn the author"], ["suspend", "Suspend the author"]], "dismiss");
    const days = input("days", { type: "number", min: 1, max: 365, value: 7 });
    const note = textarea("note", { rows: 2, maxlength: 1000 });
    const daysField = field("Suspension (days)", days);
    daysField.hidden = true;
    action.addEventListener("change", () => { daysField.hidden = action.value !== "suspend"; });
    const form = h("form", { class: "s-inline-form" }, field("Action", action), daysField, field("Note to the author / log", note),
      h("button", { type: "submit", class: "btn-primary s-btn-sm" }, "Apply"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      try {
        await api.post(`/v1/mod/reports/${encodeURIComponent(r.id)}`, { action: action.value, days: action.value === "suspend" ? Number(days.value) : undefined, note: note.value });
        toast("Done.");
        card.replaceWith(h("p", { class: "s-muted", text: `Report closed: ${action.value}.` }));
      } catch (error) { toast(error.message, "error"); done(); }
    });
    put(card, form);
  } else if (r.resolution) put(card, h("p", { class: "s-hint", text: `Resolved: ${r.resolution}` }));
  return card;
}

