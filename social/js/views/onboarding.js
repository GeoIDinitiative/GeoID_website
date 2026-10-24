/**
 * #/welcome — the first-run wizard for a member whose profile is still bare.
 *
 * Six short steps, each saved as it is left, any of them skippable: handle
 * and name; headline and institution (with "your sign-in address belongs to a
 * verified organisation" when it does); interests; study areas; communities
 * that match those interests; people who opted in to the matcher and share
 * them. Finishing or skipping is remembered on the server
 * (POST /v1/me/onboarding), so it does not come back on another device.
 */
import * as api from "../api.js?v=20261024-5d792bf";
import { store, refreshMe } from "../store.js?v=20261024-5d792bf";
import { h, clear, field, input, toast, busy, errorBox, loading, empty, put } from "../dom.js?v=20261024-5d792bf";
import { act, userChip, requireSignIn } from "../components.js?v=20261024-5d792bf";
import { myAffiliations } from "./orgs.js?v=20261024-5d792bf";

// Starting points, as tags() stores them; members can add their own.
const TOPICS = ["volcanology", "seismology", "landslides", "floods", "hydrology", "glaciology", "geomorphology",
  "coastal", "climate-risk", "earth-observation", "insar", "remote-sensing", "geodesy", "gis", "geoai",
  "geochemistry", "mining", "planetary", "digital-twin", "hazards"];

const STEPS = ["You", "Work", "Interests", "Study areas", "Communities", "People"];

/** Tell the Worker the welcome is finished or skipped, then leave. */
async function finish(where = "#/") {
  try { await api.post("/v1/me/onboarding", { done: true }); } catch (error) { /* the next visit can ask again */ }
  await refreshMe();
  location.hash = where;
}

export async function render(root, { query }) {
  if (!store.me) {
    put(clear(root), h("h1", { class: "s-h1", text: "Welcome to GeoID Network" }),
      empty("Sign in to set up your profile.", "Reading public posts needs no account."),
      h("a", { class: "btn-primary", href: api.signInUrl() }, "Sign in"));
    return undefined;
  }
  let step = Math.min(Math.max(Number(query.step) || 0, 0), STEPS.length - 1);
  const body = h("div", { class: "s-wizard-body" });
  const progress = h("ol", { class: "s-wizard-steps", "aria-label": "Steps" });
  const heading = h("h1", { class: "s-h1", text: "Welcome to GeoID Network" });

  const go = (n) => { step = n; draw(); };
  const next = () => (step < STEPS.length - 1 ? go(step + 1) : finish());
  const nav = (form, { saveLabel = "Next", onSave } = {}) => {
    const back = step > 0 ? h("button", { type: "button", class: "btn-ghost", onClick: () => go(step - 1) }, "Back") : null;
    const skip = h("button", { type: "button", class: "s-link-btn", onClick: () => next() }, step < STEPS.length - 1 ? "Skip this step" : "Skip");
    const save = h("button", { type: "submit", class: "btn-primary" }, step < STEPS.length - 1 ? saveLabel : "Finish");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      try { if (onSave) await onSave(); done(); next(); } catch (error) { done(); toast(error.message, "error"); }
    });
    return h("div", { class: "s-actions" }, back, save, skip);
  };

  function draw() {
    clear(progress);
    STEPS.forEach((label, i) => put(progress, h("li", { class: i === step ? "is-on" : i < step ? "is-done" : "", "aria-current": i === step ? "step" : null }, label)));
    const u = store.me?.user || {};
    clear(body);
    const builders = [stepYou, stepWork, stepInterests, stepAreas, stepCommunities, stepPeople];
    put(body, builders[step](u));
    const first = body.querySelector("input, button");
    if (first) first.focus({ preventScroll: true });
  }

  function stepYou(u) {
    const name = input("name", { value: u.name || "", required: true, maxlength: 80 });
    const handle = input("handle", { value: u.handle || "", pattern: "[a-z0-9_]{3,30}", maxlength: 30 });
    const form = h("form", { class: "s-form" },
      h("h2", { class: "s-h2", text: "What should people call you?" }),
      field("Name", name, "As it appears on your papers helps: publication checks compare it with the author list."),
      field("Handle", handle, "Your address on GeoID Network: lower-case letters, numbers and _ (3–30)."));
    put(form, nav(form, { onSave: async () => {
      const patch = { name: name.value };
      if (handle.value && handle.value !== u.handle) patch.handle = handle.value.toLowerCase();
      await api.patch("/v1/me", patch); await refreshMe();
    } }));
    return form;
  }

  function stepWork(u) {
    const headline = input("headline", { value: u.headline || "", maxlength: 140, placeholder: "e.g. PhD researcher, volcano deformation" });
    const institution = input("institution", { value: u.institution || "", maxlength: 140 });
    const form = h("form", { class: "s-form" },
      h("h2", { class: "s-h2", text: "What do you work on?" }),
      field("Headline", headline),
      field("Institution (optional, self-declared)", institution, "Free text, shown as you type it."),
      h("h3", { class: "s-h3", text: "Affiliation" }),
      myAffiliations({ compact: true }),
      h("p", { class: "s-hint" }, "A verified affiliation comes from joining your organisation when your sign-in address belongs to its domain. ",
        h("a", { href: "#/orgs" }, "Find your organisation"), " (you can come back here)."));
    put(form, nav(form, { onSave: async () => { await api.patch("/v1/me", { headline: headline.value, institution: institution.value }); await refreshMe(); } }));
    return form;
  }

  function stepInterests(u) {
    const chosen = new Set(u.interests || []);
    const chips = h("div", { class: "s-chips s-chip-pick", role: "group", "aria-label": "Interests" });
    const drawChips = () => {
      clear(chips);
      for (const t of [...new Set([...TOPICS, ...chosen])]) {
        const on = chosen.has(t);
        put(chips, h("button", { type: "button", class: `s-chip${on ? " is-on" : ""}`, "aria-pressed": String(on),
          onClick: () => { if (chosen.has(t)) chosen.delete(t); else if (chosen.size < 12) chosen.add(t); else toast("Up to 12 interests.", "error"); drawChips(); } }, `#${t}`));
      }
    };
    drawChips();
    const own = input("own", { placeholder: "Add your own, e.g. permafrost", maxlength: 40 });
    const add = h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => {
      const t = own.value.toLowerCase().trim().replace(/^#/, "").replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
      if (t && chosen.size < 12) { chosen.add(t); own.value = ""; drawChips(); }
    } }, "Add");
    own.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add.click(); } });
    const form = h("form", { class: "s-form" },
      h("h2", { class: "s-h2", text: "What are you interested in?" }),
      h("p", { class: "s-muted", text: "Pick a few. They shape the communities and people suggested next, and show on your profile." }),
      chips, h("div", { class: "s-row-fields" }, field("Another topic", own), add));
    put(form, nav(form, { onSave: async () => { await api.patch("/v1/me", { interests: [...chosen] }); await refreshMe(); } }));
    return form;
  }

  function stepAreas(u) {
    const list = h("div", {}, loading());
    api.get("/v1/me/study-areas").then((d) => {
      clear(list);
      const items = d?.items || [];
      put(list, items.length
        ? h("ul", { class: "s-plain" }, items.map((a) => h("li", { text: `${a.name} · ${a.radius_km} km` })))
        : h("p", { class: "s-muted", text: "None yet." }));
    }).catch((error) => put(clear(list), errorBox(error)));
    const form = h("form", { class: "s-form" },
      h("h2", { class: "s-h2", text: "Where do you work?" }),
      h("p", { class: "s-muted", text: "Study areas put you on the map's study-interest view, so people working on the same place can find you. Each is rounded (about 11 km or 110 km) before it is stored." }),
      list,
      h("p", {}, h("a", { class: "btn-ghost s-btn-sm", href: `#/u/${encodeURIComponent(u.handle)}?edit=1` }, "Add study areas on your profile"),
        " ", h("span", { class: "s-hint", text: "Come back to #/welcome afterwards, or carry on from here." })));
    put(form, nav(form));
    return form;
  }

  function suggestions(render_) {
    const box = h("div", {}, loading());
    api.get("/v1/me/onboarding").then((d) => { clear(box); render_(box, d); }).catch((error) => put(clear(box), errorBox(error)));
    return box;
  }

  function stepCommunities() {
    const form = h("form", { class: "s-form" },
      h("h2", { class: "s-h2", text: "Communities to join" }),
      h("p", { class: "s-muted", text: "Forums for a field, a method or a place. These match your interests where they can." }),
      suggestions((box, d) => {
        const items = d.suggestions?.communities || [];
        if (!items.length) { put(box, empty("You are in every community we would suggest.")); return; }
        put(box, h("ul", { class: "s-rows" }, items.map((c) => {
          const btn = h("button", { type: "button", class: "btn-ghost s-btn-sm" }, c.visibility === "approval" ? "Ask to join" : "Join");
          btn.addEventListener("click", () => act(async () => {
            const out = await api.post(`/v1/communities/${encodeURIComponent(c.slug)}/join`, {});
            btn.textContent = out?.status === "requested" ? "Requested" : "Joined"; btn.disabled = true;
          }, "join communities"));
          return h("li", { class: "s-row s-suggest" },
            h("div", { class: "s-suggest-text" }, h("a", { href: `#/c/${encodeURIComponent(c.slug)}` }, h("strong", {}, c.name)),
              c.description ? h("p", { class: "s-muted", text: c.description }) : null,
              (c.reasons || []).length ? h("p", { class: "s-hint", text: c.reasons.join(" · ") }) : null),
            btn);
        })));
      }));
    put(form, nav(form, { onSave: async () => { await refreshMe(); } }));
    return form;
  }

  function stepPeople() {
    const form = h("form", { class: "s-form" },
      h("h2", { class: "s-h2", text: "People to follow" }),
      h("p", { class: "s-muted", text: "Members who opted in to suggestions and share an interest with you. Each says why it was suggested; nobody is ranked." }),
      suggestions((box, d) => {
        const items = d.suggestions?.people || [];
        if (!items.length) { put(box, empty("No suggestions yet.", "Suggestions come from members who opted in and share your interests. Try People to search for anyone.")); return; }
        put(box, h("ul", { class: "s-rows" }, items.map((it) => {
          const btn = h("button", { type: "button", class: "btn-ghost s-btn-sm", "aria-pressed": "false" }, "Follow");
          btn.addEventListener("click", () => act(async () => {
            await api.post("/v1/follow", { type: "user", id: it.user.handle });
            btn.textContent = "Following"; btn.setAttribute("aria-pressed", "true"); btn.disabled = true;
          }, "follow people"));
          return h("li", { class: "s-row s-suggest" },
            h("div", { class: "s-suggest-text" }, userChip(it.user),
              h("ul", { class: "s-reasons", "aria-label": "Why suggested" }, (it.reasons || []).map((r) => h("li", { text: r })))),
            btn);
        })));
      }));
    put(form, nav(form));
    return form;
  }

  put(clear(root),
    h("div", { class: "s-wizard" },
      h("div", { class: "s-title-row" }, heading,
        h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(() => finish(), "set up your profile") }, "Skip the welcome")),
      h("p", { class: "s-muted", text: "A minute to set up your profile so the right people and communities can find you. Every step can be skipped and changed later." }),
      progress, body));
  if (!requireSignIn("set up your profile")) return undefined;
  draw();
  return undefined;
}
