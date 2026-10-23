/**
 * GeoID Network: boot, the app header and the hash router.
 *
 * Routes are #/path?query. A view's render(root, {params, query}) may return
 * (or resolve to) a cleanup function -- a poll to stop, a map to release --
 * which runs when the route changes.
 */
import * as api from "./api.js?v=20261023-d95af1d";
import { store, onMe, refreshMe, setUnread } from "./store.js?v=20261023-d95af1d";
import { h, clear, errorBox, pollWhileVisible, put } from "./dom.js?v=20261023-d95af1d";
import { avatar } from "./components.js?v=20261023-d95af1d";
import { createBackdrop } from "./backdrop.js?v=20261023-d95af1d";
import { registerAtlasHost } from "./atlas-host.js?v=20261023-d95af1d";
import { liveSocket } from "./chat.js?v=20261023-d95af1d";

import * as feed from "./views/feed.js?v=20261023-d95af1d";
import * as compose from "./views/compose.js?v=20261023-d95af1d";
import * as post from "./views/post.js?v=20261023-d95af1d";
import * as profile from "./views/profile.js?v=20261023-d95af1d";
import * as people from "./views/people.js?v=20261023-d95af1d";
import * as communities from "./views/communities.js?v=20261023-d95af1d";
import * as teams from "./views/teams.js?v=20261023-d95af1d";
import * as projects from "./views/projects.js?v=20261023-d95af1d";
import * as reviews from "./views/reviews.js?v=20261023-d95af1d";
import * as inbox from "./views/inbox.js?v=20261023-d95af1d";
import * as map from "./views/map.js?v=20261023-d95af1d";
import * as opps from "./views/opportunities.js?v=20261023-d95af1d";
import * as mod from "./views/mod.js?v=20261023-d95af1d";
import * as settings from "./views/settings.js?v=20261023-d95af1d";
import * as orgs from "./views/orgs.js?v=20261023-d95af1d";
import * as onboarding from "./views/onboarding.js?v=20261023-d95af1d";
import * as requests from "./views/requests.js?v=20261023-d95af1d";

const ROUTES = [
  ["/", feed.render, "Feed"],
  ["/search", feed.renderSearch, "Search"],
  ["/compose", compose.render, "New post"],
  ["/post/:id", post.render, "Post"],
  ["/u/:handle", profile.render, "Profile"],
  // A stable address for "my profile" -- the membership page links here,
  // and it cannot know the handle without a token of its own.
  ["/me", profile.renderMe, "Your profile"],
  ["/people", people.render, "People"],
  ["/communities", communities.renderList, "Communities"],
  ["/c/:slug", communities.renderOne, "Community"],
  ["/teams", teams.renderList, "Teams"],
  ["/t/:slug", teams.renderOne, "Team"],
  ["/projects", projects.renderList, "Projects"],
  ["/projects/new", projects.renderNew, "New project"],
  ["/p/:id", projects.renderOne, "Project"],
  ["/reviews", reviews.renderList, "Peer review"],
  ["/reviews/new", reviews.renderNew, "Request a review"],
  ["/r/:id", reviews.renderOne, "Review"],
  ["/messages", inbox.renderMessages, "Messages"],
  ["/messages/:id", inbox.renderConversation, "Messages"],
  ["/notifications", inbox.renderNotifications, "Notifications"],
  ["/map", map.render, "Map"],
  ["/opportunities", opps.renderOpportunities, "Opportunities"],
  ["/events", opps.renderEvents, "Events"],
  ["/mod", mod.render, "Moderation"],
  ["/settings", settings.render, "Settings"],
  // Identity & institutions track: orgs.js (#/orgs, #/o/:slug) and onboarding.js (#/welcome).
  ["/orgs", orgs.render, "Organisations"],
  ["/o/:slug", orgs.render, "Organisation"],
  ["/welcome", onboarding.render, "Welcome"],
  // Collaboration track: requests.js (#/requests, #/requests/:id).
  ["/requests", requests.render, "Requests"],
  ["/requests/:id", requests.render, "Request"],
].map(([pattern, view, title]) => {
  const names = [];
  const source = pattern.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return "([^/]+)"; });
  return { regex: new RegExp(`^${source}/?$`), names, view, title };
});

function parseHash() {
  const raw = String(location.hash || "#/").replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { path: path || "/", query };
}

// ── Header ─────────────────────────────────────────────────────────────────

const NAV = [
  ["#/", "Feed", "/"], ["#/map", "Map", "/map"], ["#/people", "People", "/people"], ["#/orgs", "Organisations", "/orgs"],
  ["#/communities", "Communities", "/communities"], ["#/teams", "Teams", "/teams"], ["#/projects", "Projects", "/projects"],
  ["#/reviews", "Reviews", "/reviews"], ["#/opportunities", "Opportunities", "/opportunities"], ["#/events", "Events", "/events"],
];

const header = {};
function buildHeader(host) {
  header.links = NAV.map(([href, label, base]) => {
    const a = h("a", { href }, label);
    a.dataset.base = base;
    return a;
  });
  header.msgBadge = h("span", { class: "s-badge-n", hidden: true });
  header.notBadge = h("span", { class: "s-badge-n", hidden: true });
  header.messages = h("a", { href: "#/messages", class: "s-hdr-icon" }, "Messages", header.msgBadge);
  header.notifs = h("a", { href: "#/notifications", class: "s-hdr-icon" }, "Notifications", header.notBadge);
  header.modLink = h("a", { href: "#/mod", hidden: true }, "Moderation");
  header.who = h("div", { class: "s-who" });
  const search = h("input", { type: "search", name: "q", placeholder: "Search posts, people, projects", "aria-label": "Search GeoID Network", minlength: 2 });
  const searchForm = h("form", { class: "s-search", role: "search" }, search);
  searchForm.addEventListener("submit", (e) => { e.preventDefault(); if (search.value.trim().length >= 2) location.hash = `#/search?q=${encodeURIComponent(search.value.trim())}`; });
  put(host, 
    h("div", { class: "s-hdr-top" },
      h("a", { class: "s-brand", href: "#/" }, h("span", { class: "geohub-word" }, h("span", { class: "geohub-prefix" }, "Geo"), "ID"), " Network"),
      searchForm,
      h("div", { class: "s-hdr-actions" }, h("a", { class: "btn-primary s-btn-sm", href: "#/compose" }, "New post"), header.messages, header.notifs, header.who)),
    h("nav", { class: "s-subnav", "aria-label": "GeoID Network" }, header.links, header.modLink));
}

function drawWho() {
  clear(header.who);
  const me = store.me;
  const unread = me?.unread || {};
  const set = (badge, n, label) => {
    badge.hidden = !n;
    badge.textContent = n > 99 ? "99+" : String(n || "");
    badge.setAttribute("aria-label", `${n} unread ${label}`);
  };
  set(header.msgBadge, unread.messages || 0, "messages");
  set(header.notBadge, unread.notifications || 0, "notifications");
  header.messages.hidden = !me; header.notifs.hidden = !me;
  header.modLink.hidden = !me?.admin && !(me?.communities || []).some((c) => c.role === "moderator" || c.role === "owner");
  if (me) {
    const u = me.user || {};
    put(header.who, h("a", { class: "s-me", href: `#/u/${encodeURIComponent(u.handle)}`, "aria-label": `Your profile, @${u.handle}` }, avatar(u, 30)),
      h("a", { class: "s-hdr-link", href: "#/settings" }, "Settings"));
  } else if (store.error) {
    put(header.who, h("span", { class: "s-muted", text: "Offline" }));
  } else {
    put(header.who, h("a", { class: "btn-ghost s-btn-sm", href: api.signInUrl() }, "Sign in"));
  }
}

function markActive(path) {
  for (const a of header.links) {
    const base = a.dataset.base;
    const on = base === "/" ? path === "/" : path === base || path.startsWith(`${base}/`)
      || (base === "/communities" && path.startsWith("/c/")) || (base === "/teams" && path.startsWith("/t/"))
      || (base === "/orgs" && path.startsWith("/o/"))
      || (base === "/projects" && path.startsWith("/p/")) || (base === "/reviews" && path.startsWith("/r/"));
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

// ── Router ─────────────────────────────────────────────────────────────────

let cleanup = null;
let routeSeq = 0;
async function route(main) {
  const my = ++routeSeq;
  if (typeof cleanup === "function") { try { cleanup(); } catch (e) { /* view's own */ } }
  cleanup = null;
  const { path, query } = parseHash();
  markActive(path);
  backdrop?.show(path);
  let found = null; let params = {};
  for (const r of ROUTES) {
    const m = r.regex.exec(path);
    if (m) { found = r; r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); }); break; }
  }
  document.title = `${found ? found.title : "Not found"} — GeoID Network`;
  if (!found) {
    put(clear(main), errorBox({ status: 404, message: "There is no page at this address." }));
    return;
  }
  try {
    const result = await found.view(main, { params, query });
    if (my !== routeSeq) { if (typeof result === "function") result(); return; }
    cleanup = result;
  } catch (error) {
    put(clear(main), errorBox(error));
  }
  // Move focus to the new view's heading so screen readers hear the change.
  const heading = main.querySelector("h1");
  if (heading && document.activeElement && !main.contains(document.activeElement)) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
  enterView(main);
}

/**
 * A new view arrives with a short rise and fade, so a section change reads as
 * one surface replacing another rather than a flash (preventing a jarring
 * change). 220 ms on the strong ease-out; reduced motion keeps only the fade.
 * WAAPI, so a quick second navigation simply retargets from wherever it is.
 */
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
function enterView(main) {
  if (typeof main.animate !== "function") return;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  main.animate(still
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
  { duration: still ? 150 : 220, easing: EASE_OUT });
}

/**
 * Identity track: a member whose profile is still bare (no headline,
 * interests or study areas) and who has not finished or skipped the welcome
 * is sent to #/welcome -- once per tab session, and only when they arrived at
 * the feed, so a link to a post still opens that post. Whether they skipped
 * is kept on the server, so it does not nag on another device.
 */
async function maybeWelcome() {
  const u = store.me?.user;
  if (!u || u.onboarding_done || u.headline || (u.interests || []).length) return;
  if (parseHash().path !== "/") return;
  try { if (sessionStorage.getItem("geoid:social-welcomed") === "1") return; } catch (error) { /* storage off: ask the server */ }
  try {
    const state = await api.get("/v1/me/onboarding");
    if (!state?.show) return;
    try { sessionStorage.setItem("geoid:social-welcomed", "1"); } catch (error) { /* fine */ }
    // replaceState, not location.hash: no extra hashchange, and Back does not loop.
    history.replaceState(null, "", "#/welcome");
  } catch (error) { /* an older Worker without the route: no welcome */ }
}

let backdrop = null;

async function boot() {
  const app = document.getElementById("social-app");
  if (!app) return;
  const hdr = h("header", { class: "s-header" });
  const main = h("main", { class: "s-main", id: "social-main", tabindex: "-1" });
  put(clear(app), hdr, main);
  // The photograph behind each section is credited at the foot of the page,
  // out of the way of reading (its source and licence still have to be said).
  const credit = h("p", { class: "s-backdrop-credit" });
  backdrop = createBackdrop({ onPlate: (frame) => {
    credit.textContent = frame ? `Background: ${[frame.place, frame.src].filter(Boolean).join(" · ")}` : "";
  } });
  document.body.prepend(backdrop.root);
  app.after(credit);
  buildHeader(hdr);
  onMe(drawWho);
  if (!api.base() && !api.mockOn()) {
    put(main, errorBox({ status: 0, message: "GeoID Network is not configured on this page." }));
    return;
  }
  await refreshMe();
  // A reload of the session from another tab (sign in/out) re-reads who we are.
  document.addEventListener("geoid:membership", () => { refreshMe().then(() => route(main)); });
  window.addEventListener("hashchange", () => route(main));
  await maybeWelcome();
  route(main);
  // Unread counts: every 60 s while the tab is visible -- and at once when the
  // member's own live room says something arrived. ONE socket per tab, here,
  // whatever page is open; views that care (Messages) hear it as a
  // "social:unread" event rather than opening a second socket to the same room.
  const refreshCounts = async () => {
    if (!store.me) return;
    try {
      const me = await api.get("/v1/me");
      setUnread(me?.unread || {});
    } catch (error) { /* the next tick tries again */ }
  };
  pollWhileVisible(refreshCounts, 60000);
  let personal = null;
  const openPersonal = () => {
    personal?.stop(); personal = null;
    if (!store.me) return;
    let soon = null;
    personal = liveSocket("/v1/me/live/ticket", (msg) => {
      if (msg.type !== "unread") return;
      document.dispatchEvent(new CustomEvent("social:unread", { detail: msg }));
      clearTimeout(soon); soon = setTimeout(refreshCounts, 400);
    });
  };
  openPersonal();
  document.addEventListener("geoid:membership", () => refreshMe().then(openPersonal));
}

// Atlas (GeoHUB's assistant) reads this when its script runs, which is after
// this module's: social/index.html loads atlas-assistant.js after app.js.
registerAtlasHost({
  me: () => store.me,
  section: () => { const { path } = parseHash(); return ROUTES.find((r) => r.regex.test(path))?.title || ""; },
  signInUrl: () => api.signInUrl(),
});

boot();
