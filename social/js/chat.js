/** A conversation thread: messages, a send box, polled every 10 s while the tab is visible. */
import * as api from "./api.js";
import { myHandle } from "./store.js";
import { h, clear, timeEl, toast, busy, textarea, errorBox, pollWhileVisible, put } from "./dom.js";
import { userChip } from "./components.js";

export function chatPanel(conversationId, { canSend = true, label = "Messages" } = {}) {
  const list = h("ol", { class: "s-chat-list", "aria-live": "polite", "aria-label": label });
  const el = h("div", { class: "s-chat" }, list);
  const seen = new Set();
  let after = "";
  let failed = false;

  const add = (m) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    const mine = m.sender?.handle === myHandle();
    put(list, h("li", { class: `s-msg${mine ? " is-mine" : ""}` },
      h("div", { class: "s-msg-head" }, mine ? h("span", { class: "s-muted", text: "You" }) : userChip(m.sender, { sub: false }), timeEl(m.created_at)),
      h("div", { class: "s-msg-body" }, String(m.body || "").split(/\n/).map((line, i) => [i ? h("br") : null, line])),
      (m.media || []).map((x) => (x.url ? h("a", { href: x.url, target: "_blank", rel: "noopener noreferrer" }, x.alt || "Attachment") : null))));
    after = m.created_at || after;
  };

  const poll = async (first = false) => {
    try {
      const data = await api.get(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { after: first ? "" : after });
      const items = data?.items || [];
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
      if (first) clear(list);
      if (first && !items.length) put(list, h("li", { class: "s-muted s-chat-empty", text: "No messages yet." }));
      if (items.length) list.querySelector(".s-chat-empty")?.remove();
      items.forEach(add);
      if (first || atBottom) list.scrollTop = list.scrollHeight;
      failed = false;
    } catch (error) {
      if (first) put(clear(list), errorBox(error));
      else if (!failed) { failed = true; toast("Lost touch with messages; retrying.", "error"); }
    }
  };

  if (canSend) {
    const body = textarea("body", { rows: 2, maxlength: 5000, "aria-label": "Write a message", placeholder: "Write a message — Enter to send, Shift+Enter for a new line" });
    const form = h("form", { class: "s-chat-form" }, body, h("button", { type: "submit", class: "btn-primary s-btn-sm" }, "Send"));
    const send = async () => {
      if (!body.value.trim()) return;
      const done = busy(form);
      try {
        const m = await api.post(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { body: body.value });
        body.value = "";
        if (m?.id) { list.querySelector(".s-chat-empty")?.remove(); add(m); list.scrollTop = list.scrollHeight; } else poll();
      } catch (error) { toast(error.message, "error"); }
      done(); body.focus();
    };
    form.addEventListener("submit", (e) => { e.preventDefault(); send(); });
    body.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    put(el, form);
  }

  poll(true);
  const stop = pollWhileVisible(() => poll(false), 10000);
  return { el, stop };
}
