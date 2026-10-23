/** #/messages, #/messages/:id and #/notifications. */
import * as api from "../api.js?v=20261023-5f60cff";
import { store, setUnread, myHandle } from "../store.js?v=20261023-5f60cff";
import { h, clear, errorBox, loading, empty, timeEl, toast, confirmDialog, put } from "../dom.js?v=20261023-5f60cff";
import { act, userChip, messageDialog, avatar, pagedList } from "../components.js?v=20261023-5f60cff";
import { chatPanel } from "../chat.js?v=20261023-5f60cff";

function signedOut(root, title, what) {
  put(clear(root), h("h1", { class: "s-h1", text: title }), empty(`Sign in to see your ${what}.`),
    h("a", { class: "btn-primary", href: api.signInUrl() }, "Sign in"));
}

export function renderMessages(root, { query }) {
  if (!store.me) return signedOut(root, "Messages", "messages");
  const tab = query.tab === "requests" ? "requests" : "inbox";
  const list = h("div", { class: "s-list" }, loading());
  const tabs = h("nav", { class: "s-tabs", "aria-label": "Messages" },
    h("a", { href: "#/messages", class: tab === "inbox" ? "is-active" : "", "aria-current": tab === "inbox" ? "page" : null }, "Inbox"),
    h("a", { href: "#/messages?tab=requests", class: tab === "requests" ? "is-active" : "", "aria-current": tab === "requests" ? "page" : null }, "Requests"));
  const load = () => api.get("/v1/conversations").then((data) => {
    clear(list);
    const items = (data?.items || []).filter((c) => (tab === "requests" ? c.status === "request" : c.status !== "request"));
    const reqCount = (data?.items || []).filter((c) => c.status === "request").length;
    if (reqCount) tabs.lastChild.textContent = `Requests (${reqCount})`;
    if (!items.length) put(list, empty(tab === "requests" ? "No message requests." : "No conversations yet.",
      tab === "requests" ? "Messages from people you do not follow arrive here, if your settings say so." : "Start one from someone's profile."));
    items.forEach((c) => {
      const others = (c.members || []).filter((m) => m.handle !== myHandle());
      put(list, h("a", { class: `s-card s-conv${c.unread ? " is-unread" : ""}`, href: `#/messages/${encodeURIComponent(c.id)}` },
        others[0] ? avatar(others[0], 40) : null,
        h("div", { class: "s-conv-text" },
          h("strong", {}, c.title || others.map((m) => m.name || m.handle).join(", ") || "Conversation", c.kind === "team" ? " (team)" : ""),
          c.last ? h("p", { class: "s-muted" }, `${c.last.sender?.handle === myHandle() ? "You: " : ""}${String(c.last.body || "").slice(0, 120)}`) : null),
        h("span", { class: "s-conv-meta" }, c.last ? timeEl(c.last.at) : null, c.unread ? h("span", { class: "s-badge-n", "aria-label": `${c.unread} unread` }, String(c.unread)) : null)));
    });
  }).catch((error) => put(clear(list), errorBox(error)));
  load();
  put(clear(root), h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Messages" }),
    h("button", { type: "button", class: "btn-primary", onClick: () => messageDialog([]) }, "New message")), tabs, list);
  // The member's own live room says "something new in conversation X": the
  // list and the header badge follow without waiting for a poll. With no
  // socket, the header's minute poll is what it always was.
  // The app shell holds the one socket to this room (app.js) and re-reads
  // the header counts; here only the list follows.
  let reloadTimer = null;
  const onUnread = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 400); };
  document.addEventListener("social:unread", onUnread);
  return () => { clearTimeout(reloadTimer); document.removeEventListener("social:unread", onUnread); };
}

export async function renderConversation(root, { params }) {
  if (!store.me) return signedOut(root, "Messages", "messages");
  const id = params.id;
  put(clear(root), loading());
  let conv = null;
  try {
    const data = await api.get("/v1/conversations");
    conv = (data?.items || []).find((c) => c.id === id) || null;
  } catch (error) { /* the thread itself will say */ }
  const others = (conv?.members || []).filter((m) => m.handle !== myHandle());
  const isRequest = conv?.status === "request";
  const head = h("header", { class: "s-conv-head" },
    h("a", { href: "#/messages", class: "s-link-btn" }, "← All messages"),
    h("h1", { class: "s-h1", text: conv?.title || others.map((m) => m.name || m.handle).join(", ") || "Conversation" }),
    others.length ? h("div", { class: "s-chips" }, others.map((m) => userChip(m, { sub: false }))) : null);
  const tools = h("div", { class: "s-actions" });
  if (isRequest) {
    put(tools, h("p", { class: "s-muted", text: "This is a message request. Accept it to reply; they won't know you have read it until you do." }),
      h("button", { type: "button", class: "btn-primary", onClick: () => act(async () => { await api.post(`/v1/conversations/${encodeURIComponent(id)}/accept`, {}); renderConversation(root, { params }); }) }, "Accept"));
  }
  if (conv) {
    put(tools, 
      h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => { await api.post(`/v1/conversations/${encodeURIComponent(id)}/mute`, { muted: !conv.muted }); toast(conv.muted ? "Unmuted." : "Muted — no notifications from this conversation."); conv.muted = !conv.muted; }) }, conv.muted ? "Unmute" : "Mute"),
      conv.kind !== "team" ? h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
        if (!(await confirmDialog("Leave this conversation?", "You stop receiving its messages.", "Leave"))) return;
        await api.post(`/v1/conversations/${encodeURIComponent(id)}/leave`, {}); location.hash = "#/messages";
      }) }, isRequest ? "Decline" : "Leave") : null);
  }
  const chat = chatPanel(id, { canSend: !isRequest });
  put(clear(root), head, tools, chat.el);
  return chat.stop;
}

const REF_ROUTES = {
  post: (id) => `#/post/${encodeURIComponent(id)}`, comment: (id) => `#/post/${encodeURIComponent(id)}`,
  user: (id) => `#/u/${encodeURIComponent(id)}`, project: (id) => `#/p/${encodeURIComponent(id)}`,
  review: (id) => `#/r/${encodeURIComponent(id)}`, team: (id) => `#/t/${encodeURIComponent(id)}`,
  community: (id) => `#/c/${encodeURIComponent(id)}`, conversation: (id) => `#/messages/${encodeURIComponent(id)}`,
  report: () => "#/mod", badge: () => `#/u/${encodeURIComponent(myHandle())}`,
  event: () => "#/events", request: (id) => `#/requests/${encodeURIComponent(id)}`,
  org: (slug) => `#/o/${encodeURIComponent(slug)}`, account: () => "#/settings",
};
const KIND_TEXT = {
  follow: "followed you", comment: "commented", reply: "replied", reaction: "reacted to your post", mention: "mentioned you",
  fork: "forked your work", accept: "accepted your answer", verify: "verified your observation", project_update: "updated a project you follow",
  team_invite: "invited you to a team", review_invite: "asked you to review a draft", review_submitted: "submitted a review",
  grant: "shared a project with you", message: "sent you a message", join_request: "asked to join", moderation: "moderation notice",
  invite: "sent you an invitation", review: "has news about a peer review", badge: "awarded you a badge",
  contribution: "credited your contribution", request: "sent you a collaboration request", mentoring: "sent you a mentoring request", event: "event reminder",
};

export function renderNotifications(root, { query }) {
  if (!store.me) return signedOut(root, "Notifications", "notifications");
  const unreadOnly = query.unread === "1";
  const markAll = h("button", { type: "button", class: "btn-ghost s-btn-sm", onClick: () => act(async () => {
    await api.post("/v1/notifications/read", {});
    setUnread({ notifications: 0 });
    renderNotifications(root, { query });
  }) }, "Mark all as read");
  put(clear(root),
    h("div", { class: "s-title-row" }, h("h1", { class: "s-h1", text: "Notifications" }), markAll),
    h("nav", { class: "s-tabs", "aria-label": "Notifications" },
      h("a", { href: "#/notifications", class: unreadOnly ? "" : "is-active" }, "All"),
      h("a", { href: "#/notifications?unread=1", class: unreadOnly ? "is-active" : "" }, "Unread")),
    pagedList((cursor) => api.get("/v1/notifications", { unread: unreadOnly, cursor }), (n) => {
      const to = REF_ROUTES[n.ref_type]?.(n.ref_id) || "#/notifications";
      const link = h("a", { class: `s-card s-notif${n.read ? "" : " is-unread"}`, href: to },
        n.actor ? avatar(n.actor, 32) : null,
        h("div", {}, h("p", {}, h("strong", {}, n.actor ? (n.actor.name || n.actor.handle) : "GeoID Network"), " ", KIND_TEXT[n.kind] || n.kind,
          n.text ? h("span", { class: "s-muted" }, `: ${n.text}`) : null), timeEl(n.created_at)),
        n.read ? null : h("span", { class: "s-dot", "aria-label": "unread" }));
      link.addEventListener("click", () => { if (!n.read) api.post("/v1/notifications/read", { ids: [n.id] }).catch(() => {}); });
      return link;
    }, { emptyTitle: unreadOnly ? "You're all caught up." : "No notifications yet." }));
}
