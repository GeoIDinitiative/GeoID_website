/** #/settings — privacy, contact, matcher, notifications, follows, blocks, and your data. */
import * as api from "../api.js";
import { store, refreshMe, myHandle } from "../store.js";
import { h, clear, field, input, select, checkbox, toast, busy, errorBox, loading, empty, modal, put } from "../dom.js";
import { act, userChip } from "../components.js";

const NOTIFY = [
  ["follow", "Someone follows you"], ["comment", "Comments on your posts"], ["reply", "Replies to your comments"],
  ["reaction", "Reactions to your posts"], ["mention", "Mentions"], ["fork", "Forks of your work"],
  ["accept", "Your answer is accepted"], ["verify", "Your observation is confirmed or disputed"],
  ["project_update", "Updates to projects and monitors you follow"], ["grant", "A project is shared with you"],
  ["team_invite", "Team invitations"], ["review_invite", "Review requests"], ["message", "New messages"],
];

export function render(root) {
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
  const notifyBoxes = NOTIFY.map(([k, label]) => checkbox(`n_${k}`, label, prefs[k] !== false));
  const status = h("p", { class: "s-form-status", role: "status", "aria-live": "polite" });
  const form = h("form", { class: "s-form" },
    h("fieldset", {}, h("legend", {}, "Privacy and contact"),
      field("Who can message you directly", contact),
      field("Collaboration availability", availability),
      matcher,
      h("p", { class: "s-hint", text: "Each post has its own visibility, and each location its own precision — chosen when you post. Your email address is never shown to anyone on GeoHUB Social." })),
    h("fieldset", {}, h("legend", {}, "Notify me when…"), h("div", { class: "s-check-grid" }, notifyBoxes)),
    status,
    h("button", { type: "submit", class: "btn-primary" }, "Save settings"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const done = busy(form);
    try {
      const notify = {};
      NOTIFY.forEach(([k], i) => { notify[k] = notifyBoxes[i].querySelector("input").checked; });
      await api.patch("/v1/me", { contact_pref: contact.value, availability: availability.value, match_opt_in: matcher.querySelector("input").checked, notify });
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
    form, following, blocked, yourData());
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
    h("p", { class: "s-muted", text: "A JSON file of your profile, posts, comments, messages, follows, bookmarks, projects, grants and reviews — everything GeoHUB Social holds about you, including the email address your account is linked to." }),
    exportBtn,
    h("p", { class: "s-muted", text: "Deleting your Social account cannot be undone." }),
    deleteBtn);
}

function deleteDialog() {
  const handle = myHandle();
  modal("Delete your GeoHUB Social account", (close) => {
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
