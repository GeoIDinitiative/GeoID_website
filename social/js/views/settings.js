/** #/settings — privacy, contact, matcher, notifications, follows, blocks, and your data. */
import * as api from "../api.js?v=20261024-bc1cb01";
import { store, refreshMe, myHandle } from "../store.js?v=20261024-bc1cb01";
import { h, clear, field, input, select, checkbox, toast, busy, errorBox, loading, empty, modal, put, confirmDialog } from "../dom.js?v=20261024-bc1cb01";
import { act, userChip, requireSignIn, sharePageUrl } from "../components.js?v=20261024-bc1cb01";
import { sizeText } from "../files.js?v=20261024-bc1cb01";
import { myAffiliations } from "./orgs.js?v=20261024-bc1cb01";
import { myOfficeHours } from "./officehours.js?v=20261024-bc1cb01";

// The kinds the API knows (NOTIFY_KINDS in social-worker/profiles.js); a
// toggle for any other name would be silently ignored by the server.
const NOTIFY = [
  ["follow", "Someone follows you"], ["comment", "Comments and replies on your posts, and accepted answers"],
  ["reaction", "Reactions to your posts"], ["mention", "Mentions"], ["fork", "Forks of your work"],
  ["verify", "Your observation is confirmed or disputed"],
  ["project_update", "Updates to projects and monitors you follow"], ["grant", "A project is shared with you"],
  ["invite", "Team and community invitations"], ["review", "Peer review requests and replies"],
  ["message", "New messages"], ["badge", "Badges you earn"], ["mentoring", "Mentoring requests and replies"],
];

export function render(root, { query = {} } = {}) {
  if (!store.me) {
    put(clear(root), h("h1", { class: "s-h1", text: "Settings" }), empty("Sign in to change your settings."),
      h("a", { class: "btn-primary", href: api.signInUrl() }, "Sign in"));
    return;
  }
  const u = store.me.user || {};
  const prefs = store.me.user?.notify || store.me.notify || {};
  const contact = select("contact_pref", [["anyone", "Anyone signed in"], ["followers", "Only people I follow (others arrive as requests)"], ["nobody", "Nobody (all messages arrive as requests)"]], u.contact_pref || "followers");
  const availability = select("availability", [["open", "Open to collaborate"], ["limited", "Limited"], ["closed", "Not taking on collaborations"]], u.availability || "open");
  const matcher = checkbox("match_opt_in", "Let the collaboration matcher suggest me", !!u.match_opt_in,
    "Suggestions say why you were suggested — e.g. a self-declared skill or posts you made. You are never ranked, and you are not shown while availability is “Not taking on collaborations”.");
  const publicProfile = checkbox("public_profile", "Let search engines and link previews show my profile", !!u.public_profile,
    "Off by default. On, your profile has a public page that people can share and search engines can find: your name, headline, bio and public posts. Your email and anything not public stay hidden.");
  const notifyBoxes = NOTIFY.map(([k, label]) => checkbox(`n_${k}`, label, prefs[k] !== false));
  const mail = emailFieldset();
  const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
  const form = h("form", { class: "s-form" },
    h("fieldset", {}, h("legend", {}, "Privacy and contact"),
      field("Who can message you directly", contact),
      field("Collaboration availability", availability),
      matcher, publicProfile,
      h("p", { class: "s-hint", text: "Each post has its own visibility, and each location its own precision — chosen when you post. Your email address is never shown to anyone on GeoID Network." })),
    h("fieldset", {}, h("legend", {}, "Notify me when…"), h("div", { class: "s-check-grid" }, notifyBoxes)),
    mail.el,
    status,
    h("button", { type: "submit", class: "btn-primary" }, "Save settings"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const done = busy(form);
    try {
      const notify = {};
      NOTIFY.forEach(([k], i) => { notify[k] = notifyBoxes[i].querySelector("input").checked; });
      await api.patch("/v1/me", { contact_pref: contact.value, availability: availability.value, match_opt_in: matcher.querySelector("input").checked,
        public_profile: publicProfile.querySelector("input").checked, notify });
      await mail.save();
      await refreshMe();
      status.textContent = "Saved.";
    } catch (error) { status.textContent = error.message; status.classList.add("is-error"); }
    done();
  });

  const following = h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "What you follow" }), loading());
  api.get("/v1/me/following").then((d) => {
    following.lastChild.remove();
    const items = d?.items || [];
    if (!items.length) { put(following, h("p", { class: "s-muted", text: "You don't follow anything yet." })); return; }
    put(following, h("ul", { class: "s-rows" }, items.map((f) => {
      const li = h("li", { class: "s-row" }, h("span", { class: "s-kind", text: f.type }), h("span", {}, f.label || f.id),
        h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => { await api.del("/v1/follow", { type: f.type, id: f.id }); li.remove(); }) }, "Unfollow"));
      return li;
    })));
  }).catch((error) => following.lastChild.replaceWith(errorBox(error)));

  const blocked = h("section", { class: "s-section" }, h("h2", { class: "s-h2", text: "Blocked members" }), loading());
  api.get("/v1/blocks").then((d) => {
    blocked.lastChild.remove();
    const items = d?.items || [];
    if (!items.length) { put(blocked, h("p", { class: "s-muted", text: "You have not blocked anyone." })); return; }
    put(blocked, h("ul", { class: "s-rows" }, items.map((b) => {
      const user = b.user || b;
      const li = h("li", { class: "s-row" }, userChip(user),
        h("button", { type: "button", class: "s-link-btn", onClick: () => act(async () => { await api.del(`/v1/blocks/${encodeURIComponent(user.handle)}`); li.remove(); toast("Unblocked."); }) }, "Unblock"));
      return li;
    })));
  }).catch((error) => blocked.lastChild.replaceWith(errorBox(error)));

  put(clear(root), h("h1", { class: "s-h1", text: "Settings" }),
    h("p", { class: "s-muted" }, "Your public profile is edited on ", h("a", { href: `#/u/${encodeURIComponent(u.handle)}?edit=1` }, "your profile page"), "."),
    form, identitySection(query), storageSection(), zenodoSection(query), following, blocked, yourData());
}

// ── Identity & institutions track ──────────────────────────────────────────

const ORCID_RESULT = {
  linked: ["Your ORCID iD is verified.", "info"],
  taken: ["That ORCID iD is already verified on another GeoID Network account.", "error"],
  cancelled: ["ORCID sign-in was cancelled. Nothing changed.", "error"],
  expired: ["That ORCID sign-in took too long or was not for this account. Try again.", "error"],
  failed: ["ORCID did not confirm an iD. Try again.", "error"],
};

/**
 * ORCID linking, affiliations, mentoring and the welcome. ORCID linking is
 * only offered when the Worker has an ORCID client configured; otherwise the
 * section says so rather than showing a button that cannot work.
 */
function identitySection(query) {
  const u = store.me?.user || {};
  if (query.orcid && ORCID_RESULT[query.orcid]) {
    const [text, kind] = ORCID_RESULT[query.orcid];
    toast(text, kind);
    refreshMe();
    // Drop the result from the address so a reload does not repeat it.
    history.replaceState(null, "", "#/settings");
  }
  const orcid = h("div", {}, loading());
  api.get("/v1/orcid/status").then((s) => {
    clear(orcid);
    if (u.orcid_verified) {
      put(orcid, h("p", {}, h("span", { class: "s-verified", text: "Verified" }), ` ORCID iD ${u.orcid}`),
        h("p", { class: "s-hint", text: "Changing the iD on your profile removes the verification." }));
      return;
    }
    if (!s?.enabled) {
      put(orcid, h("p", { class: "s-muted", text: "ORCID linking is not set up yet. Your ORCID iD, if you add one to your profile, is shown as self-declared until it is." }));
      return;
    }
    put(orcid,
      h("p", { class: "s-muted", text: "Sign in at ORCID to prove the iD is yours. GeoID Network asks ORCID only for your iD (scope /authenticate) and is sent back here." }),
      h("button", { type: "button", class: "btn-primary s-btn-sm", onClick: () => act(async () => {
        const out = await api.get("/v1/orcid/start");
        if (out?.url) location.href = out.url;
      }, "verify your ORCID iD") }, "Verify with ORCID"));
  }).catch((error) => put(clear(orcid), errorBox(error)));

  const welcome = h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
    await api.post("/v1/me/onboarding", { done: false });
    await refreshMe();
    location.hash = "#/welcome";
  }, "set up your profile") }, "Run the welcome again");

  return h("section", { class: "s-section s-identity", "aria-labelledby": "id-h" },
    h("h2", { class: "s-h2", id: "id-h", text: "Identity" }),
    h("h3", { class: "s-h3", text: "ORCID" }), orcid,
    h("h3", { class: "s-h3", text: "Affiliations" }), myAffiliations(),
    h("h3", { class: "s-h3", text: "Mentoring" }), mentoringPanel(u),
    h("h3", { class: "s-h3", text: "Welcome" }),
    h("p", { class: "s-muted", text: "The short setup that suggests communities and people from your interests." }), welcome);
}

const MENTOR_STATUS = { requested: "Waiting for an answer", active: "Active", declined: "Declined", withdrawn: "Withdrawn", ended: "Ended" };

function mentoringPanel(u) {
  const open = checkbox("mentoring_open", "I'm open to mentoring", !!u.mentoring,
    "You appear under People → Mentors, and members can send you a request. You choose which to accept; an accepted request opens a conversation.");
  const topics = input("mentoring_topics", { value: (u.mentoring_topics || []).join(", "), placeholder: "careers, insar, fieldwork" });
  const form = h("form", { class: "s-form" }, open, field("Topics", topics, "Comma-separated."),
    h("button", { type: "submit", class: "btn-ghost s-btn-sm" }, "Save mentoring"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const done = busy(form);
    try {
      await api.patch("/v1/me/mentoring", { open: open.querySelector("input").checked, topics: topics.value.split(",").map((s) => s.trim()).filter(Boolean) });
      await refreshMe(); toast("Saved.");
    } catch (error) { toast(error.message, "error"); }
    done();
  });
  const list = h("div", {}, loading());
  const draw = async () => {
    let data;
    try { data = await api.get("/v1/mentoring/requests"); } catch (error) { put(clear(list), errorBox(error, draw)); return; }
    clear(list);
    const items = data?.items || [];
    if (!items.length) { put(list, h("p", { class: "s-muted", text: "No mentoring requests yet." })); return; }
    put(list, h("ul", { class: "s-rows" }, items.map((r) => {
      const other = r.role === "mentor" ? r.mentee : r.mentor;
      const li = h("li", { class: "s-row s-mentoring-row" }, userChip(other),
        h("span", { class: "s-kind", text: r.role === "mentor" ? "Asked you" : "You asked" }),
        h("span", { class: "s-muted", text: MENTOR_STATUS[r.status] || r.status }),
        r.topic ? h("span", { text: r.topic }) : null);
      if (r.message && r.status === "requested") put(li, h("p", { class: "s-muted s-mentoring-msg", text: r.message }));
      const btn = (label, fn, cls = "s-link-btn") => h("button", { type: "button", class: cls, onClick: () => act(async () => { await fn(); draw(); }, "manage mentoring") }, label);
      if (r.role === "mentor" && r.status === "requested") {
        put(li, btn("Accept", () => api.post(`/v1/mentoring/requests/${encodeURIComponent(r.id)}/respond`, { accept: true }).then(() => toast("Accepted. A conversation is open in Messages."))),
          btn("Decline", () => api.post(`/v1/mentoring/requests/${encodeURIComponent(r.id)}/respond`, { accept: false })));
      }
      if (r.role === "mentee" && r.status === "requested") put(li, btn("Withdraw", () => api.post(`/v1/mentoring/requests/${encodeURIComponent(r.id)}/close`, {})));
      if (r.status === "active") {
        put(li, r.conversation_id ? h("a", { href: `#/messages/${encodeURIComponent(r.conversation_id)}` }, "Conversation") : null,
          btn("End", () => api.post(`/v1/mentoring/requests/${encodeURIComponent(r.id)}/close`, {})));
      }
      return li;
    })));
  };
  draw();
  return h("div", {}, form, h("h4", { class: "s-h3", text: "Requests" }), list, u.mentoring ? myOfficeHours() : null,
    h("p", { class: "s-hint" }, "Looking for a mentor? ", h("a", { href: "#/people?mentor=1" }, "Find mentors"), "."));
}

/** Ask a member for mentoring (from their profile or the People list). */
export function mentoringRequestDialog(user) {
  if (!requireSignIn("ask for mentoring")) return;
  modal(`Ask ${user.name || `@${user.handle}`} for mentoring`, (close) => {
    const topics = user.mentoring_topics || [];
    const topic = input("topic", { maxlength: 120, placeholder: topics.length ? topics.join(", ") : "e.g. PhD applications", list: "s-mentor-topics" });
    const message = h("textarea", { name: "message", rows: 4, maxlength: 2000 });
    const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
    const form = h("form", {},
      topics.length ? h("datalist", { id: "s-mentor-topics" }, topics.map((t) => h("option", { value: t }))) : null,
      field("What would you like help with?", topic),
      field("A short note", message, "Say who you are and what you hope for. They can accept or decline; if they accept, a conversation opens."),
      status,
      h("div", { class: "s-actions" }, h("button", { type: "submit", class: "btn-primary" }, "Send request"),
        h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const done = busy(form);
      try {
        await api.post("/v1/mentoring/requests", { handle: user.handle, topic: topic.value, message: message.value });
        close(true); toast("Request sent. You'll be told when they answer.");
      } catch (error) { done(); status.textContent = error.message; status.classList.add("is-error"); }
    });
    return form;
  });
}

/**
 * Email: off, a daily digest, or a digest plus mail straight away for the
 * kinds ticked. Loaded from /v1/me/mail (mail.js); saved with the rest of the
 * form. Until it has loaded, saving leaves the email choice alone.
 */
function emailFieldset() {
  const el = h("fieldset", { class: "s-mail-prefs" }, h("legend", {}, "Email"), loading("Loading your email settings…"));
  let state = null;
  let radios = [];
  let boxes = [];
  let weekly = null;
  const sync = () => {
    const immediate = radios.find((r) => r.checked)?.value === "immediate";
    boxes.forEach(([, label]) => {
      const box = label.querySelector("input");
      box.disabled = !immediate;
      label.classList.toggle("is-disabled", !immediate);
    });
  };
  api.get("/v1/me/mail").then((data) => {
    state = data;
    const radio = (value, text, hint) => {
      const input = h("input", { type: "radio", name: "mail_mode", value, checked: data.mode === value });
      input.addEventListener("change", sync);
      radios.push(input);
      return h("label", { class: "s-check" }, input, h("span", {}, text, hint ? h("small", { class: "s-hint", text: hint }) : null));
    };
    const chosen = data.immediate?.length ? data.immediate : data.defaults?.immediate || [];
    boxes = (data.kinds || []).map((k) => [k.id, checkbox(`mail_${k.id}`, k.label, chosen.includes(k.id))]);
    el.lastChild.remove();
    put(el,
      h("div", { class: "s-mail-modes", role: "radiogroup", "aria-label": "How often GeoID Network emails you" },
        radio("off", "No email"),
        radio("digest", "A daily digest", "Unread notifications, once a day, only when there are some."),
        radio("immediate", "A daily digest, and straight away for…")),
      h("div", { class: "s-check-grid s-mail-kinds", role: "group", "aria-label": "Email straight away for" }, boxes.map(([, b]) => b)),
      weekly = checkbox("mail_weekly", "A weekly round-up on Mondays", data.weekly !== false,
        "New jobs, studentships and events in your interests, the most-saved work of the week, and people working near your study areas. Sent only when there is something."),
      h("p", { class: "s-hint", text: "Email goes to the address you sign in with, which is never shown to anyone. Message emails say who wrote, never what they wrote. Every email has a one-click unsubscribe link." }),
      data.unsubscribed ? h("p", { class: "s-hint", text: "You unsubscribed from an email link. Choose again here to turn email back on." }) : null,
      data.sending ? null : h("p", { class: "s-hint s-mail-off", text: "Email is not switched on for GeoID Network yet. Your choice is saved and used once it is." }));
    sync();
  }).catch((error) => el.lastChild.replaceWith(errorBox(error)));
  return {
    el,
    async save() {
      if (!state) return;
      const mode = radios.find((r) => r.checked)?.value || state.mode;
      const immediate = mode === "immediate" ? boxes.filter(([, b]) => b.querySelector("input").checked).map(([k]) => k) : [];
      state = await api.patch("/v1/me/mail", { digest: mode !== "off", immediate, weekly: !!weekly?.querySelector("input").checked });
    },
  };
}

// ── Files and Zenodo ───────────────────────────────────────────────────────

/**
 * What you have uploaded, against your allowance, with a delete on each: the
 * way to make room. Files nothing uses any more are swept after a day anyway.
 */
function storageSection() {
  const sec = h("section", { class: "s-section", "aria-labelledby": "files-h" },
    h("h2", { class: "s-h2", id: "files-h", text: "Your files" }), loading());
  const draw = (d) => {
    clear(sec);
    const used = Number(d.used || 0);
    const pct = d.quota ? Math.min(100, Math.round((used / d.quota) * 100)) : 0;
    const fill = h("span", { class: "s-meter-fill" });
    fill.style.width = `${pct}%`;
    put(sec, h("h2", { class: "s-h2", id: "files-h", text: "Your files" }),
      d.quota
        ? h("div", { class: "s-meter", role: "meter", "aria-valuemin": "0", "aria-valuemax": String(d.quota), "aria-valuenow": String(used), "aria-label": "Upload space used" },
          fill)
        : null,
      h("p", { class: "s-muted", text: d.quota ? `${sizeText(used) || "0 B"} of ${sizeText(d.quota)} used.` : `${sizeText(used) || "0 B"} uploaded (no limit on this account).` }),
      h("p", { class: "s-hint", text: "Large datasets, theses and recordings are better kept on Dropbox, Google Drive, OSF or Zenodo and linked from a post: they stay where they are, and the post shows a card. Uploads nothing uses any more are removed after a day." }),
      (d.files || []).length
        ? h("ul", { class: "s-rows" }, d.files.map((f) => {
          const li = h("li", { class: "s-row" },
            h("span", { class: "s-kind", text: (String(f.key).match(/\.([a-z0-9]{1,5})$/i) || [, "file"])[1] }),
            // Through the API with your credentials: review and team files are not public.
            h("button", { type: "button", class: "s-link-btn", onClick: async () => {
              try { window.open(await api.mediaBlobUrl(f.url), "_blank", "noopener"); } catch (error) { toast(error.message, "error"); }
            } }, f.name || f.key.split("/").pop()),
            h("span", { class: "s-muted", text: sizeText(f.bytes) }),
            h("button", { type: "button", class: "s-link-btn s-danger", onClick: () => act(async () => {
              if (!(await confirmDialog("Delete this file?", "Posts that show it will show nothing in its place.", "Delete"))) return;
              await api.del(`/v1/media/${encodeURIComponent(f.key)}`);
              load();
            }) }, "Delete"));
          return li;
        }))
        : h("p", { class: "s-muted", text: "You haven't uploaded anything." }));
  };
  const load = () => api.get("/v1/me/storage").then(draw).catch((error) => sec.lastChild.replaceWith(errorBox(error)));
  load();
  return sec;
}

const ZENODO_RESULT = {
  linked: ["Zenodo is connected. Publish a post's files from the post.", "info"],
  cancelled: ["Zenodo sign-in was cancelled. Nothing changed.", "error"],
  expired: ["That Zenodo sign-in took too long or was not for this account. Try again.", "error"],
  failed: ["Zenodo did not connect. Try again.", "error"],
};

/** Connect your own Zenodo account: deposits go under your name, never ours. */
function zenodoSection(query) {
  const sec = h("section", { class: "s-section", "aria-labelledby": "zen-h" },
    h("h2", { class: "s-h2", id: "zen-h", text: "Zenodo" }), loading());
  const said = ZENODO_RESULT[query.zenodo];
  if (said) toast(...said);
  api.get("/v1/zenodo").then((z) => {
    sec.lastChild.remove();
    put(sec, h("p", { class: "s-muted", text: "Zenodo, run by CERN, keeps research files for good and gives them a DOI. Connect your account and you can send a post's files there from the post — as a draft to check first, or published." }));
    if (!z.configured) { put(sec, h("p", { class: "s-hint", text: "Publishing to Zenodo isn't switched on for GeoID Network yet." })); return; }
    if (z.connected) {
      put(sec, h("p", {}, "Connected", z.sandbox ? " (the Zenodo sandbox)" : "", "."),
        h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
          if (!(await confirmDialog("Disconnect Zenodo?", "Records already on Zenodo stay there. GeoID Network forgets its access to your account.", "Disconnect"))) return;
          await api.del("/v1/zenodo"); toast("Disconnected."); sec.replaceWith(zenodoSection({}));
        }) }, "Disconnect"));
    } else {
      put(sec, h("button", { type: "button", class: "btn-primary s-btn-sm", onClick: () => act(async () => {
        const { authorize_url: go } = await api.post("/v1/zenodo/connect", {});
        location.href = go;
      }) }, "Connect Zenodo"));
    }
  }).catch((error) => sec.lastChild.replaceWith(errorBox(error)));
  return sec;
}

function yourData() {
  const exportBtn = h("button", { type: "button", class: "btn-ghost" }, "Download everything we hold about you");
  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    try {
      const data = await api.get("/v1/me/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: "geohub-social-export.json" });
      // h() only admits http(s)/routes in href; a blob: URL is set directly.
      a.setAttribute("href", url);
      put(document.body, a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast("Your export is downloading: geohub-social-export.json");
    } catch (error) { toast(error.message, "error"); }
    exportBtn.disabled = false;
  });
  const deleteBtn = h("button", { type: "button", class: "btn-ghost s-danger" }, "Delete my Social account");
  deleteBtn.addEventListener("click", () => deleteDialog());
  return h("section", { class: "s-section s-danger-zone", "aria-labelledby": "data-h" },
    h("h2", { class: "s-h2", id: "data-h", text: "Your data" }),
    h("p", { class: "s-muted", text: "A JSON file of your profile, posts, comments, messages, follows, bookmarks, projects, grants and reviews — everything GeoID Network holds about you, including the email address your account is linked to." }),
    exportBtn,
    h("p", { class: "s-muted", text: "Deleting your Social account cannot be undone." }),
    deleteBtn);
}

function deleteDialog() {
  const handle = myHandle();
  modal("Delete your GeoID Network account", (close) => {
    const confirmBox = input("confirm", { autocomplete: "off", spellcheck: "false", required: true });
    const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
    const form = h("form", {},
      h("p", {}, "This permanently erases your Social account:"),
      h("ul", {},
        h("li", { text: "Your posts, comments and messages are blanked and removed, and the files you uploaded are deleted." }),
        h("li", { text: "Every project you shared is unshared: workspace grants you gave or received are revoked." }),
        h("li", { text: "You leave every team and community, and your profile is anonymised." })),
      h("p", {}, h("strong", {}, "Not affected: "), "your GeoID membership and sign-in, and the projects saved on your own computer by GeoHUB."),
      h("p", { class: "s-hint", text: "Consider downloading your data first." }),
      field(`Type your handle (${handle}) to confirm`, confirmBox),
      status,
      h("div", { class: "s-actions" },
        h("button", { type: "submit", class: "btn-primary s-danger-btn" }, "Delete my Social account"),
        h("button", { type: "button", class: "btn-ghost", onClick: () => close() }, "Cancel")));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (confirmBox.value.trim().replace(/^@/, "") !== handle) { status.textContent = "That is not your handle."; status.classList.add("is-error"); return; }
      const done = busy(form);
      try {
        await api.del("/v1/me", { confirm: handle });
        close(true);
        await refreshMe();
        toast("Your Social account has been deleted.");
        location.hash = "#/";
      } catch (error) { done(); status.textContent = error.message; status.classList.add("is-error"); }
    });
    return form;
  });
}
