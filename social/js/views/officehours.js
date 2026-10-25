/**
 * Office hours: a mentor offers short slots, a member books one with a line
 * about what they want to talk through. A lighter first step than a full
 * mentoring request -- fifteen minutes with someone who has done the thing.
 *
 *   slotsPanel(u)     on a mentor's profile: their open slots, each bookable
 *   myOfficeHours()   in Settings → Mentoring: offer slots, see bookings
 *
 * The API is officehours.js in the Worker. Who booked, their note and the
 * meeting link are only ever sent to the two people in the slot.
 */
import * as api from "../api.js?v=20261025-b99e566";
import { store } from "../store.js?v=20261025-b99e566";
import { h, put, clear, field, input, select, textarea, toast, modal, busy, errorBox, loading, dateText, confirmDialog, extLink } from "../dom.js?v=20261025-b99e566";
import { act, userChip, requireSignIn } from "../components.js?v=20261025-b99e566";

const when = (s) => `${dateText(s.starts_at, true)} · ${s.minutes} min`;

/** Download the slot's calendar file (the request carries the member's credentials). */
async function saveIcs(slot) {
  try {
    const url = await api.mediaBlobUrl(`${api.base()}/v1/mentoring/slots/${encodeURIComponent(slot.id)}/ics`);
    const a = h("a", { download: "office-hour.ics" });
    a.setAttribute("href", url);
    put(document.body, a); a.click(); a.remove();
  } catch (error) { toast(error.message, "error"); }
}

/** A mentor's coming slots, on their profile. */
export function slotsPanel(u) {
  const sec = h("section", { class: "s-section s-officehours", "aria-labelledby": "oh-h" },
    h("h2", { class: "s-h2", id: "oh-h", text: "Office hours" }), loading());
  const draw = async () => {
    let d;
    try { d = await api.get("/v1/mentoring/slots", { mentor: u.handle }); } catch (error) { sec.lastChild.replaceWith(errorBox(error, draw)); return; }
    const items = d?.items || [];
    // Nothing offered: the section says nothing rather than "none".
    if (!items.length) { sec.remove(); return; }
    clear(sec);
    put(sec, h("h2", { class: "s-h2", id: "oh-h", text: "Office hours" }),
      h("p", { class: "s-hint", text: `Short conversations with ${u.name || `@${u.handle}`}: book one and say what you'd like to talk through.` }),
      h("ul", { class: "s-rows" }, items.map((s) => h("li", { class: "s-row" },
        h("span", { text: when(s) }),
        s.topic ? h("span", { class: "s-muted", text: s.topic }) : null,
        s.booked_by && s.booked_by.handle === store.me?.user?.handle
          ? h("span", { class: "s-labels" }, h("span", { class: "s-vis", text: "Booked by you" }),
            s.where && /^https?:\/\//.test(s.where) ? extLink(s.where, "Join") : null,
            h("button", { type: "button", class: "s-link-btn", onClick: () => saveIcs(s) }, "Add to calendar"),
            h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => {
              await api.post(`/v1/mentoring/slots/${encodeURIComponent(s.id)}/cancel`, {}); toast("Booking cancelled."); draw();
            }) }, "Cancel"))
          : h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => (store.me ? bookDialog(s, draw) : requireSignIn("book office hours")) }, "Book")))));
  };
  draw();
  return sec;
}

function bookDialog(slot, done) {
  modal("Book an office hour", (close) => {
    const note = textarea("note", { rows: 3, maxlength: 500, placeholder: "I'm choosing between an MSc in hazards and going straight into consultancy…" });
    const form = h("form", { class: "s-form" },
      h("p", {}, when(slot), slot.topic ? ` · ${slot.topic}` : ""),
      field("What would you like to talk through?", note, "Only the mentor sees this."),
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Book it")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const unbusy = busy(form);
      try {
        await api.post(`/v1/mentoring/slots/${encodeURIComponent(slot.id)}/book`, { note: note.value });
        toast("Booked. The meeting link is on the slot, and you can add it to your calendar.");
        close(true); done();
      } catch (error) { toast(error.message, "error"); unbusy(); }
    });
    return form;
  });
}

/** Settings → Mentoring: offer slots and see who booked. */
export function myOfficeHours() {
  const box = h("div", { class: "s-officehours-mine" });
  const start = input("starts_at", { type: "datetime-local" });
  const minutes = select("minutes", [["15", "15 minutes"], ["20", "20 minutes"], ["30", "30 minutes"], ["45", "45 minutes"], ["60", "An hour"]], "30");
  const repeat = select("repeat_weeks", [["1", "Just this once"], ["4", "Weekly for 4 weeks"], ["8", "Weekly for 8 weeks"], ["12", "Weekly for 12 weeks"]], "1");
  const topic = input("topic", { maxlength: 120, placeholder: "PhD applications, InSAR, fieldwork safety…" });
  const where = input("where", { maxlength: 200, placeholder: "https://meet.example/… or “Messages”" });
  const whereField = field("Where", where, "A video-call link. Only the person who books sees it.");
  whereField.classList.add("s-span-2");
  const form = h("form", { class: "s-form s-form-inline" },
    field("Starts", start), field("Length", minutes), field("Repeat", repeat),
    field("Topic (optional)", topic), whereField,
    h("button", { type: "submit", class: "btn-primary s-btn-sm" }, "Offer this slot"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!start.value) { toast("Pick a start time.", "error"); return; }
    const unbusy = busy(form);
    try {
      const out = await api.post("/v1/mentoring/slots", {
        starts_at: Math.floor(new Date(start.value).getTime() / 1000), minutes: Number(minutes.value),
        repeat_weeks: Number(repeat.value), topic: topic.value, where: where.value,
      });
      toast(out.created?.length > 1 ? `${out.created.length} slots offered.` : "Slot offered.");
      start.value = ""; draw();
    } catch (error) { toast(error.message, "error"); }
    unbusy();
  });
  const list = h("div", {}, loading());
  const row = (s, mine) => h("li", { class: "s-row" },
    h("span", { text: when(s) }),
    mine ? (s.booked_by ? userChip(s.booked_by) : h("span", { class: "s-muted", text: "Open" })) : userChip(s.mentor),
    s.note ? h("span", { class: "s-muted s-mentoring-msg", text: s.note }) : null,
    s.where && /^https?:\/\//.test(s.where) ? extLink(s.where, "Join") : s.where ? h("span", { class: "s-muted", text: s.where }) : null,
    s.booked_by || !mine ? h("button", { type: "button", class: "s-link-btn", onClick: () => saveIcs(s) }, "Add to calendar") : null,
    h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => {
      if (mine && s.booked_by && !(await confirmDialog("Cancel this office hour?", "The member who booked it is told.", "Cancel it"))) return;
      await api.post(`/v1/mentoring/slots/${encodeURIComponent(s.id)}/cancel`, {}); draw();
    }) }, mine ? "Withdraw" : "Cancel booking"));
  const draw = async () => {
    let d;
    try { d = await api.get("/v1/me/slots"); } catch (error) { put(clear(list), errorBox(error, draw)); return; }
    clear(list);
    put(list,
      h("h4", { class: "s-h3", text: "You offer" }),
      d.offering?.length ? h("ul", { class: "s-rows" }, d.offering.map((s) => row(s, true))) : h("p", { class: "s-muted", text: "No coming slots." }),
      h("h4", { class: "s-h3", text: "You booked" }),
      d.booked?.length ? h("ul", { class: "s-rows" }, d.booked.map((s) => row(s, false))) : h("p", { class: "s-muted", text: "Nothing booked." }));
  };
  draw();
  put(box, h("h4", { class: "s-h3", text: "Office hours" }),
    h("p", { class: "s-hint", text: "Short slots anyone signed in can book from your profile. A lighter first step than a mentoring request. Members can hold two coming sessions with you at most." }),
    form, list);
  return box;
}
