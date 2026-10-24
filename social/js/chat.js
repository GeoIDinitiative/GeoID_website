/**
 * A conversation thread: messages, a send box, and new messages pushed over a
 * WebSocket while the thread is on screen.
 *
 * LIVE FIRST, POLL WHEN NOT. The page asks the API for a one-minute ticket
 * (a browser cannot put a Bearer on a WebSocket) and opens the socket. While
 * it is up, messages and "typing…" arrive as they happen and the 10-second
 * poll stands down; when it is down -- no Durable Object deployed, a proxy
 * that drops sockets, the mock -- the poll is exactly what it always was. A
 * hidden tab closes its socket and reopens it when it is shown again.
 */
import * as api from "./api.js?v=20261024-86fa94c";
import { myHandle, setUnread } from "./store.js?v=20261024-86fa94c";
import { h, clear, timeEl, toast, busy, textarea, errorBox, pollWhileVisible, put } from "./dom.js?v=20261024-86fa94c";
import { userChip } from "./components.js?v=20261024-86fa94c";

const PING_MS = 30000;
const MAX_RETRIES = 6;

/**
 * Keep a live socket to `ticketPath`'s room while the tab is visible.
 * onEvent(msg) gets each pushed event; onState("up"|"down") reports the link.
 * Returns { send(obj), stop() }. Never throws: failing to connect is "down".
 */
export function liveSocket(ticketPath, onEvent, onState = () => {}) {
  let ws = null;
  let stopped = false;
  let tries = 0;
  let retryTimer = null;
  let pingTimer = null;
  let state = "down";
  const report = (s) => { if (s !== state) { state = s; onState(s); } };
  const supported = typeof WebSocket === "function" && !api.mockOn() && !!api.base();

  const close = () => {
    clearInterval(pingTimer); pingTimer = null;
    if (ws) { const old = ws; ws = null; try { old.close(1000, "done"); } catch (error) { /* closed */ } }
  };
  const retry = () => {
    report("down");
    if (stopped || document.hidden || tries >= MAX_RETRIES) return;
    tries += 1;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** tries));
  };
  async function connect() {
    if (stopped || ws || document.hidden || !supported) return;
    let ticket = null;
    try { ticket = await api.post(ticketPath, {}); } catch (error) { retry(); return; }
    // live:false = the service has no live rooms deployed; the poll carries on.
    if (ticket?.live === false) { report("down"); return; }
    if (stopped || ws || !ticket?.ticket) { if (!stopped && !ws) retry(); return; }
    const url = `${api.base().replace(/^http/, "ws")}${ticket.path}?ticket=${encodeURIComponent(ticket.ticket)}`;
    let sock;
    try { sock = new WebSocket(url); } catch (error) { retry(); return; }
    ws = sock;
    sock.addEventListener("open", () => {
      tries = 0;
      report("up");
      pingTimer = setInterval(() => { try { sock.send('{"type":"ping"}'); } catch (error) { /* closing */ } }, PING_MS);
    });
    sock.addEventListener("message", (e) => {
      let msg = null;
      try { msg = JSON.parse(e.data); } catch (error) { return; }
      if (!msg || msg.type === "pong" || msg.type === "hello") return;
      try { onEvent(msg); } catch (error) { /* the view's own */ }
    });
    sock.addEventListener("close", (e) => {
      if (ws !== sock) return;
      ws = null;
      clearInterval(pingTimer); pingTimer = null;
      // 4403: no longer a member. The poll will say so; do not keep knocking.
      if (e.code === 4403) { stopped = true; report("down"); return; }
      retry();
    });
  }
  const onVis = () => {
    if (document.hidden) { close(); report("down"); } else { tries = 0; connect(); }
  };
  document.addEventListener("visibilitychange", onVis);
  connect();
  return {
    send(obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (error) { /* closing */ } } },
    stop() { stopped = true; clearTimeout(retryTimer); close(); document.removeEventListener("visibilitychange", onVis); },
  };
}

/** Re-read the header's unread counts, debounced (after messages were read here). */
let unreadTimer = null;
export function refreshUnread(delay = 1500) {
  clearTimeout(unreadTimer);
  unreadTimer = setTimeout(async () => {
    try { const me = await api.get("/v1/me"); setUnread(me?.unread || {}); } catch (error) { /* the next poll */ }
  }, delay);
}

export function chatPanel(conversationId, { canSend = true, label = "Messages" } = {}) {
  const list = h("ol", { class: "s-chat-list", "aria-live": "polite", "aria-label": label });
  // Not a live region: "typing" every few seconds would talk over the messages.
  const typing = h("p", { class: "s-chat-typing s-muted", hidden: true });
  const status = h("p", { class: "s-chat-live", hidden: true }, h("span", { class: "s-live-dot", "aria-hidden": "true" }), "Live");
  const el = h("div", { class: "s-chat" }, list, typing, status);
  const seen = new Set();
  const path = `/v1/conversations/${encodeURIComponent(conversationId)}`;
  let after = "";
  let failed = false;
  let live = false;

  const add = (m) => {
    if (!m || seen.has(m.id)) return;
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
      const data = await api.get(`${path}/messages`, { after: first ? "" : after });
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

  // A pushed message is shown at once; a moment later one GET marks it read
  // on the server (and catches anything the socket missed), then the header
  // badge is brought up to date.
  let readTimer = null;
  const markRead = () => {
    clearTimeout(readTimer);
    readTimer = setTimeout(() => { poll(false).then(() => refreshUnread(0)); }, 1200);
  };
  let typingTimer = null;
  const socket = liveSocket(`${path}/ticket`, (msg) => {
    if (msg.type === "message" && msg.message) {
      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
      list.querySelector(".s-chat-empty")?.remove();
      add(msg.message);
      if (atBottom || msg.message.sender?.handle === myHandle()) list.scrollTop = list.scrollHeight;
      typing.hidden = true;
      if (msg.message.sender?.handle !== myHandle()) markRead();
    } else if (msg.type === "typing" && msg.handle && msg.handle !== myHandle()) {
      typing.textContent = `@${msg.handle} is typing…`;
      typing.hidden = false;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { typing.hidden = true; }, 4000);
    }
  }, (state) => {
    const wasLive = live;
    live = state === "up";
    status.hidden = !live;
    // Back from a gap: fetch whatever arrived while the socket was down.
    if (live && !wasLive) poll(false);
  });

  if (canSend) {
    const body = textarea("body", { rows: 2, maxlength: 5000, "aria-label": "Write a message", placeholder: "Write a message — Enter to send, Shift+Enter for a new line" });
    const form = h("form", { class: "s-chat-form" }, body, h("button", { type: "submit", class: "btn-primary s-btn-sm" }, "Send"));
    const send = async () => {
      if (!body.value.trim()) return;
      const done = busy(form);
      try {
        const m = await api.post(`${path}/messages`, { body: body.value });
        body.value = "";
        if (m?.id) { list.querySelector(".s-chat-empty")?.remove(); add(m); list.scrollTop = list.scrollHeight; } else poll();
      } catch (error) { toast(error.message, "error"); }
      done(); body.focus();
    };
    form.addEventListener("submit", (e) => { e.preventDefault(); send(); });
    body.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    // The room throttles too; this only saves sending a frame per keystroke.
    let typedAt = 0;
    body.addEventListener("input", () => {
      const t = Date.now();
      if (live && body.value.trim() && t - typedAt > 2500) { typedAt = t; socket.send({ type: "typing" }); }
    });
    put(el, form);
  }

  poll(true);
  // The 10-second poll runs only while the socket is down.
  const stopPoll = pollWhileVisible(() => { if (!live) poll(false); }, 10000);
  const stop = () => { stopPoll(); socket.stop(); clearTimeout(readTimer); clearTimeout(typingTimer); };
  return { el, stop };
}
