/**
 * #/rounds -- feedback rounds (rounds.js in the Worker): review timed to a
 * real deadline. Bring a draft and a volunteer is matched to it; volunteer
 * and you are given drafts; mock interviews pair a mentee with a mentor.
 *
 * #/u/:handle/record -- a member's reviewer record, printable, so reviewing
 * is something they can show.
 */
import * as api from "../api.js?v=20261026-ce04b62";
import { store } from "../store.js?v=20261026-ce04b62";
import { h, put, clear, loading, errorBox, empty, field, input, select, textarea, toast, modal, dateText, dateToEpoch, extLink } from "../dom.js?v=20261026-ce04b62";
import { act, userChip, requireSignIn } from "../components.js?v=20261026-ce04b62";

const KINDS = [["abstract", "Abstract review"], ["cv", "CV review"], ["cover_letter", "Cover-letter review"], ["mock_interview", "Mock interviews"]];

export function renderList(root) {
  const list = h("div", { class: "s-rounds" }, loading());
  put(clear(root),
    h("h1", { class: "s-h1", text: "Feedback rounds" }),
    h("p", { class: "s-muted", text: "Feedback when it counts: abstracts before the big meetings' deadlines, CVs and cover letters in application season, mock interviews before the real one. Bring a draft and a volunteer is matched to it. Or volunteer: every review you give goes on your reviewer record." }),
    h("nav", { class: "s-tabs", "aria-label": "Reviews" }, h("a", { href: "#/reviews" }, "Review requests"), h("a", { href: "#/rounds", class: "is-active", "aria-current": "page" }, "Feedback rounds")),
    list,
    store.me?.admin ? adminForm(() => load()) : null);
  const load = () => api.get("/v1/rounds").then((d) => {
    const items = d?.items || [];
    put(clear(list), items.length ? items.map(roundCard) : empty("No rounds open right now.", "Rounds open before abstract deadlines and in application season."));
  }).catch((error) => put(clear(list), errorBox(error)));
  load();
}

function roundCard(r) {
  const interview = r.kind === "mock_interview";
  const s = r.stats || {};
  const v = r.viewer || {};
  const yours = h("div", { class: "s-round-yours" });
  const open = r.status === "open";
  const showMine = () => api.get(`/v1/rounds/${encodeURIComponent(r.id)}/mine`).then((m) => {
    clear(yours);
    const bits = [];
    if (m.drafts.length) bits.push(h("p", {}, h("strong", { text: "Your drafts: " }), m.drafts.map((d, i) => [i ? ", " : "", h("a", { href: `#/r/${encodeURIComponent(d.id)}` }, d.title)])));
    if (m.reviewing.length) bits.push(h("p", {}, h("strong", { text: "You're reviewing: " }), m.reviewing.map((d, i) => [i ? ", " : "", h("a", { href: `#/r/${encodeURIComponent(d.id)}` }, d.title)])));
    for (const p of m.pairs) {
      bits.push(p.status === "waiting" ? h("p", { class: "s-muted", text: "You're waiting for an interviewer. You'll be told when one is free." })
        : h("p", {}, p.role === "mentee" ? "Your interviewer: " : "You're interviewing: ", p.other ? userChip(p.other) : "",
          p.note ? h("span", { class: "s-muted", text: ` · “${p.note}”` }) : null,
          " ", h("a", { href: "#/settings" }, "Offer a time in office hours"), " or send a message."));
    }
    if (m.volunteer) bits.push(h("p", { class: "s-muted", text: `You're volunteering: ${m.volunteer.assigned} of ${m.volunteer.capacity} taken.` }));
    put(yours, bits);
  }).catch(() => {});
  if (store.me && (v.volunteering || v.drafts)) showMine();

  const volunteerBtn = h("button", { type: "button", class: "btn-ghost s-btn-sm" }, v.volunteering ? "Volunteering ✓" : (interview ? "Volunteer as interviewer" : "Volunteer to review"));
  volunteerBtn.addEventListener("click", () => {
    if (!requireSignIn("volunteer")) return;
    if (v.volunteering) {
      act(async () => { await api.post(`/v1/rounds/${encodeURIComponent(r.id)}/volunteer`, { withdraw: true }); v.volunteering = false; volunteerBtn.textContent = interview ? "Volunteer as interviewer" : "Volunteer to review"; toast("Withdrawn, if nothing was assigned yet."); });
      return;
    }
    modal(interview ? "Volunteer as interviewer" : "Volunteer to review", (close) => {
      const cap = select("capacity", [["1", "One"], ["2", "Two"], ["3", "Three"], ["5", "Five"]], "2");
      const form = h("form", { class: "s-form" },
        field(interview ? "How many mock interviews can you give?" : "How many drafts can you take?", cap,
          interview ? "You're paired with a member and agree a time between you." : "You're matched to drafts by shared expertise where possible. Your skills and interests on your profile are used."),
        h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Volunteer")));
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        act(async () => {
          await api.post(`/v1/rounds/${encodeURIComponent(r.id)}/volunteer`, { capacity: Number(cap.value) });
          v.volunteering = true; volunteerBtn.textContent = "Volunteering ✓"; close(true); toast("Thank you. You'll be told when something is yours."); showMine();
        });
      });
      return form;
    });
  });
  const askBtn = interview
    ? h("button", { type: "button", class: "btn-primary s-btn-sm", onClick: () => {
      if (!requireSignIn("ask for a mock interview")) return;
      modal("Ask for a mock interview", (close) => {
        const note = textarea("note", { rows: 3, maxlength: 500, placeholder: "What it's for and when, e.g. a PhD interview at Leeds on 12 November" });
        const form = h("form", { class: "s-form" }, field("For your interviewer", note), h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Ask")));
        form.addEventListener("submit", (e) => { e.preventDefault(); act(async () => { await api.post(`/v1/rounds/${encodeURIComponent(r.id)}/interview`, { note: note.value }); close(true); toast("You're in. You'll be told when you're paired."); showMine(); }); });
        return form;
      });
    } }, "Ask for a mock interview")
    : h("a", { class: "btn-primary s-btn-sm", href: `#/reviews/new?round=${encodeURIComponent(r.id)}` }, "Bring a draft");
  return h("article", { class: `s-card s-round s-round-${r.kind}` },
    h("p", { class: "s-labels" }, h("span", { class: "s-kind", text: r.kind_label }), open ? null : h("span", { class: "s-vis", text: "Closed" })),
    h("h2", { class: "s-card-title", text: r.title }),
    h("p", { class: "s-round-dates" },
      r.deadline_at ? [h("strong", { text: "Deadline " }), dateText(r.deadline_at), r.closes_at ? " · " : ""] : null,
      r.closes_at ? [h("strong", { text: interview ? "Join by " : "Bring drafts by " }), dateText(r.closes_at)] : null,
      r.link ? [" · ", extLink(r.link, "The call")] : null),
    r.description ? h("p", { class: "s-muted", text: r.description }) : null,
    h("p", { class: "s-hint", text: interview
      ? `${s.volunteers || 0} interviewer${s.volunteers === 1 ? "" : "s"} · ${s.mentees || 0} member${s.mentees === 1 ? "" : "s"} asked`
      : `${s.volunteers || 0} reviewer${s.volunteers === 1 ? "" : "s"} with room for ${s.room || 0} more · ${s.drafts || 0} draft${s.drafts === 1 ? "" : "s"}` }),
    open ? h("div", { class: "s-actions" }, askBtn, volunteerBtn) : null,
    yours);
}

function adminForm(reload) {
  const kind = select("kind", KINDS, "abstract");
  const title = input("title", { maxlength: 160, placeholder: "e.g. EGU abstracts" });
  const desc = textarea("description", { rows: 2, maxlength: 2000 });
  const link = input("link", { type: "url", placeholder: "https:// the call or the meeting" });
  const deadline = input("deadline", { type: "date" });
  const closes = input("closes", { type: "date" });
  const form = h("form", { class: "s-form s-form-inline" }, field("Kind", kind), field("Title", title), field("Link", link),
    field("Real deadline", deadline), field("Drafts by", closes), field("Description", desc),
    h("button", { type: "submit", class: "btn-primary s-btn-sm" }, "Open the round"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    act(async () => {
      await api.post("/v1/rounds", { kind: kind.value, title: title.value, description: desc.value, link: link.value,
        deadline_at: dateToEpoch(deadline.value, true), closes_at: dateToEpoch(closes.value, true) });
      toast("Round open."); title.value = ""; reload();
    });
  });
  return h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Open a round (admins)" }), form);
}

/** #/u/:handle/record -- what this member has reviewed, printable. */
export async function renderRecord(root, { params }) {
  put(clear(root), loading());
  let d;
  try { d = await api.get(`/v1/users/${encodeURIComponent(params.handle)}/review-record`); } catch (error) { put(clear(root), errorBox(error)); return; }
  document.title = `Reviewer record — ${d.name || d.handle}`;
  put(clear(root), h("article", { class: "s-record" },
    h("p", { class: "s-labels" }, h("span", { class: "s-kind", text: "Reviewer record" })),
    h("h1", { class: "s-h1" }, d.name || `@${d.handle}`),
    h("p", { class: "s-muted" }, `@${d.handle} · ${d.total} review${d.total === 1 ? "" : "s"} submitted on GeoID Network`, d.rounds ? `, ${d.rounds} in feedback rounds` : "", "."),
    d.items.length ? h("table", { class: "s-table" },
      h("thead", {}, h("tr", {}, ["Date", "What", "Round", "Draft"].map((t) => h("th", { scope: "col", text: t })))),
      h("tbody", {}, d.items.map((i) => h("tr", {}, h("td", { text: dateText(i.submitted_at) }), h("td", { text: i.what }),
        h("td", { text: i.round || "—" }), h("td", { text: i.title || "Private draft" })))))
      : empty("No reviews submitted yet."),
    h("p", { class: "s-hint", text: `Generated ${new Date().toLocaleDateString()} from geoidinitiative.com/social/#/u/${d.handle}/record. Titles of private drafts are withheld.` }),
    h("div", { class: "s-actions s-noprint" }, h("button", { type: "button", class: "btn-primary", onClick: () => window.print() }, "Print or save as PDF"),
      h("a", { class: "btn-ghost", href: `#/u/${encodeURIComponent(d.handle)}` }, "Back to the profile"))));
}
