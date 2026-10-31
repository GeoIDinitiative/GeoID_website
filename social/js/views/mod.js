/** #/mod — the report queue and the audit log, for admins and community moderators; imported-listing sources for admins. */
import * as api from "../api.js?v=20261031-7fefdf8";
import { store } from "../store.js?v=20261031-7fefdf8";
import { h, clear, field, input, select, textarea, toast, busy, empty, timeEl, put } from "../dom.js?v=20261031-7fefdf8";
import { userChip, pagedList, provenanceBadge, kindLabel, act } from "../components.js?v=20261031-7fefdf8";

export function render(root, { query }) {
  if (!store.me) {
    put(clear(root), h("h1", { class: "s-h1", text: "Moderation" }), empty("Sign in as a moderator to see reports."));
    return;
  }
  const tab = ["audit", "closed", "imports", "held"].includes(query.tab) ? query.tab : "open";
  const tabLink = (id, label) => h("a", { href: `#/mod?tab=${id}`, class: id === tab ? "is-active" : "", "aria-current": id === tab ? "page" : null }, label);
  const body = tab === "imports" ? importsPanel() : tab === "held" ? heldPanel() : tab === "audit"
    ? pagedList((cursor) => api.get("/v1/mod/audit", { cursor }), (a) => h("div", { class: "s-card s-audit" },
      h("p", {}, a.actor ? userChip(a.actor, { sub: false }) : h("span", { text: "system" }), " ", h("strong", {}, a.action), ` ${a.ref_type || ""} ${a.ref_id || ""}`),
      a.detail ? h("pre", { class: "s-pre" }, JSON.stringify(a.detail, null, 2)) : null, timeEl(a.created_at, true)),
    { emptyTitle: "The audit log is empty." })
    : pagedList((cursor) => api.get("/v1/mod/reports", { status: tab, cursor }), (r) => reportCard(r, tab === "open"),
      { emptyTitle: tab === "open" ? "No open reports." : "No closed reports.", emptyDetail: "Admins see every report; community moderators see reports on posts in their communities." });
  put(clear(root), h("h1", { class: "s-h1", text: "Moderation" }),
    h("p", { class: "s-muted", text: "Every action here is recorded in the audit log and the author is notified. Reading reported private content is logged too." }),
    h("nav", { class: "s-tabs", "aria-label": "Moderation" }, tabLink("open", "Open reports"), tabLink("closed", "Closed"), store.me.admin ? tabLink("audit", "Audit log") : null,
      store.me.admin ? tabLink("held", "Held opportunities") : null,
      store.me.admin ? tabLink("imports", "Imported listings") : null),
    body);
}

function reportCard(r, open) {
  const t = r.target || {};
  const card = h("article", { class: "s-card s-report" },
    h("header", { class: "s-card-head" },
      h("span", {}, h("strong", {}, r.kind === "appeal" ? "Appeal" : "Report"), `: ${r.reason || "no reason"} · ${r.target_type} `),
      timeEl(r.created_at),
      open && r.due_at ? h("span", { class: r.overdue ? "s-vis s-overdue" : "s-vis", title: "The response time the code of conduct promises" },
        r.overdue ? `Overdue since ${new Date(r.due_at * 1000).toLocaleString()}` : `Answer by ${new Date(r.due_at * 1000).toLocaleString()}`) : null),
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

// ── Imported jobs and events ───────────────────────────────────────────────

const HEALTH = { green: "Posting", amber: "Read, nothing relevant", red: "Failing", grey: "Not read yet" };

/**
 * Every employer careers page and society calendar the importer reads
 * (importer.js), with how it last went. Green posted something, amber read
 * fine but listed nothing that scored, red failed (the error says why), grey
 * hasn't been read. A source whose listing moved can be re-pointed here.
 */
function importsPanel() {
  const box = h("div", { class: "s-imports" }, h("p", { class: "s-muted", text: "Loading sources…" }));
  const filter = { kind: "", health: "" };
  let items = [];
  const draw = () => {
    const shown = items.filter((s) => (!filter.kind || s.kind === filter.kind) && (!filter.health || s.health === filter.health));
    const count = (hl) => items.filter((s) => s.health === hl).length;
    const kindSel = select("kind", [["", "Jobs and events"], ["jobs", "Jobs"], ["events", "Events"]], filter.kind);
    const healthSel = select("health", [["", "Any state"], ...Object.entries(HEALTH).map(([k, v]) => [k, `${v} (${count(k)})`])], filter.health);
    kindSel.addEventListener("change", () => { filter.kind = kindSel.value; draw(); });
    healthSel.addEventListener("change", () => { filter.health = healthSel.value; draw(); });
    put(clear(box),
      h("p", { class: "s-muted", text: "Jobs and events gathered from employers' careers pages and societies' calendars, posted by @geoidnetwork with the source credited on each post. Four sources are read every 15 minutes; each is read at most once every 20 hours. Imported posts stay out of Discover." }),
      h("div", { class: "s-row-fields" }, field("Show", kindSel), field("State", healthSel)),
      h("div", { class: "s-table-wrap" }, h("table", { class: "s-table s-imports-table" },
        h("thead", {}, h("tr", {}, ["", "Source", "Kind", "Last read", "Listed", "New", "Platform", ""].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, shown.map(sourceRow)))));
  };
  const sourceRow = (s) => {
    const urlIn = input("url", { value: s.url, "aria-label": `Listing address for ${s.name}` });
    const tr = h("tr", { class: s.enabled ? "" : "is-off" },
      h("td", {}, h("span", { class: `s-health s-health-${s.health}`, title: HEALTH[s.health], "aria-label": HEALTH[s.health] })),
      h("td", {}, h("strong", { text: s.name }), s.grp ? h("span", { class: "s-muted", text: ` · ${s.grp}` }) : null,
        s.last_error ? h("p", { class: "s-error s-small", text: s.last_error }) : null,
        h("details", {}, h("summary", {}, "Listing address"), urlIn,
          h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => { await api.patch(`/v1/imports/${encodeURIComponent(s.id)}`, { url: urlIn.value }); toast("Saved. It is read on the next tick."); load(); }) }, "Save"))),
      h("td", { text: s.kind }),
      h("td", {}, s.last_run_at ? timeEl(s.last_run_at, true) : "—"),
      h("td", { text: String(s.last_count || 0) }),
      h("td", { text: String(s.last_new || 0) }),
      h("td", { text: s.platform || "" }),
      h("td", { class: "s-nowrap" },
        h("button", { type: "button", class: "s-link-btn", onClick: (e) => act(async () => {
          e.target.disabled = true; e.target.textContent = "Reading…";
          const out = await api.post(`/v1/imports/${encodeURIComponent(s.id)}/run`, {});
          toast(out.error ? `${s.name}: ${out.error}` : `${s.name}: ${out.listed} listed, ${out.posted} new.`, out.error ? "error" : "info");
          load();
        }) }, "Read now"),
        h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => { await api.patch(`/v1/imports/${encodeURIComponent(s.id)}`, { enabled: !s.enabled }); load(); }) }, s.enabled ? "Switch off" : "Switch on")));
    return tr;
  };
  const load = () => api.get("/v1/imports").then((d) => { items = d.items || []; draw(); })
    .catch((error) => put(clear(box), h("p", { class: "s-error", text: error.message })));
  load();
  return box;
}

// ── Held opportunities (trust.js) ──────────────────────────────────────────

/** Opportunities that read like recruitment scams, from new accounts: publish or reject. */
function heldPanel() {
  const box = h("div", {}, h("p", { class: "s-muted", text: "Loading…" }));
  const load = () => api.get("/v1/mod/held").then((d) => {
    const items = d.items || [];
    put(clear(box), h("p", { class: "s-muted", text: "Opportunities held because they read like recruitment scams and came from a new or unverified account. They stay private to their author until you decide." }),
      items.length ? items.map((p) => {
        const note = input("note", { placeholder: "Reason, sent to the author if you reject" });
        return h("article", { class: "s-card s-report" },
          h("p", { class: "s-labels" }, h("span", { class: "s-kind", text: "Held" }), h("span", { class: "s-vis", text: p.held_reasons })),
          h("p", {}, h("strong", { text: p.title })), userChip(p.author),
          h("p", { class: "s-muted", text: String(p.body || "").slice(0, 1200) }),
          h("div", { class: "s-actions" }, note,
            h("button", { type: "button", class: "btn-primary s-btn-sm", onClick: () => act(async () => { await api.post(`/v1/mod/held/${encodeURIComponent(p.id)}`, { approve: true }); toast(`Published as ${p.wanted}.`); load(); }) }, "Publish"),
            h("button", { type: "button", class: "btn-ghost s-btn-sm s-danger", onClick: () => act(async () => { await api.post(`/v1/mod/held/${encodeURIComponent(p.id)}`, { approve: false, note: note.value }); toast("Rejected."); load(); }) }, "Reject")));
      }) : empty("Nothing held.", "Opportunities that look like scams from new accounts wait here."));
  }).catch((error) => put(clear(box), h("p", { class: "s-error", text: error.message })));
  load();
  return box;
}

