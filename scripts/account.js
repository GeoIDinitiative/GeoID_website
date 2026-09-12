/**
 * The sign-in door and the account page.
 *
 * ONE DOCUMENT HANDLES THE HANDOFF. The service sends the token back in the URL
 * fragment, and a fragment belongs to whichever document is at the top -- so a
 * return straight to /geohub/ would land the token on the SHELL while the
 * viewer that needs it is inside an iframe. Every sign-in therefore comes back
 * here, to a page that has no iframe, and this page forwards to wherever the
 * reader started. The token is in localStorage by then, which every document on
 * the origin can read.
 *
 * The fragment is cleaned off the address bar straight away: it is not secret
 * from the person holding it, and it should not be in their history or in a
 * link they paste to somebody.
 */
import * as membership from "/GeoID_GIS/viewer/gis/membership.js";

const byId = (id) => document.getElementById(id);
const show = (id, on = true) => { const n = byId(id); if (n) n.hidden = !on; };

/** Where to go once signed in. Only ever a path on this origin. */
function nextUrl() {
  const wanted = new URL(location.href).searchParams.get("next")
    || new URL(location.href).searchParams.get("return") || "";
  try {
    const url = new URL(wanted, location.origin);
    // Same origin only: a sign-in that can be pointed anywhere is a phishing
    // gift, and the service refuses one too. Both ends, because either alone
    // is a single point of failure.
    if (url.origin === location.origin) return url.toString();
  } catch (error) { /* not a url */ }
  // The account page, NOT the dashboard: the dashboard is the site's own
  // welcome deck and is open to everybody, signed in or not.
  return "/account/";
}

/** Take a token out of the fragment, if the service just sent one back. */
function handoff() {
  const hash = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  const token = hash.get("token");
  const failed = hash.get("auth-error");
  if (!token && !failed) return null;
  history.replaceState(null, "", location.pathname + location.search);
  if (failed) return { error: failed };
  membership.accept(token);
  return { ok: true };
}

function describe(state) {
  if (!state.signedIn) return "";
  const who = state.name || state.email;
  // The master account is named as itself. Shown as an ordinary member it
  // would be impossible to tell, from inside the app, whether a gate is open
  // because it is unlocked or because of who is asking — which is the one
  // thing somebody testing the gates needs to know.
  if (state.owner) return `Signed in as ${who} — the master account.`;
  if (!state.member) return `Signed in as ${who} — an explorer.`;
  const until = state.until
    ? new Date(state.until * 1000).toLocaleDateString(undefined,
        { year: "numeric", month: "long", day: "numeric" })
    : "";
  return `Signed in as ${who} — a member${until ? `, until ${until}` : ""}.`;
}

// ── The sign-in page ────────────────────────────────────────────────────────

function signInPage() {
  const handed = handoff();
  if (handed?.ok) { location.replace(nextUrl()); return; }

  const service = membership.authService();
  const state = membership.state();

  if (handed?.error) {
    const node = byId("auth-error");
    if (node) { node.textContent = handed.error; node.hidden = false; }
  }

  if (!service) { show("not-ready"); return; }
  if (state.signedIn) {
    show("already");
    const who = byId("already-who");
    if (who) who.textContent = describe(state);
    return;
  }

  show("choose");
  // The service returns HERE, carrying where the reader was going, so the
  // handoff above has exactly one document to happen in.
  const back = new URL("/sign-in/", location.origin);
  back.searchParams.set("next", nextUrl());
  for (const [id, provider] of [["go-google", "google"], ["go-github", "github"]]) {
    const link = byId(id);
    if (!link) continue;
    const go = new URL(`${service}/auth/start`);
    go.searchParams.set("provider", provider);
    go.searchParams.set("return", back.toString());
    link.href = go.toString();
  }
}

// ── The account page ────────────────────────────────────────────────────────

function accountPage() {
  handoff();   // a return that landed here rather than on the door
  const state = membership.state();
  const service = membership.authService();

  /**
   * A HELD TOKEN WINS OVER A MISSING SERVICE.
   *
   * Gating the signed-in card on the service being configured meant somebody
   * whose token outlived a configuration change was greeted by name in the nav
   * and told "there is nothing to sign in to" on this page, in the same view.
   * Whether they are signed in is a fact about them; whether a service is named
   * is a fact about the deployment, and it only decides what to offer somebody
   * who is NOT.
   */
  show("acct-in", state.signedIn);
  show("acct-not-ready", !state.signedIn && !service);
  show("acct-out", !state.signedIn && !!service);

  if (state.signedIn) {
    const who = byId("acct-who");
    if (who) who.textContent = state.name || state.email;
    const badge = byId("acct-badge");
    if (badge) {
      badge.textContent = state.owner ? "Master" : state.member ? "Member" : "Explorer";
      // `.badge` is the site's own pill; the modifier only sets its colour.
      badge.className = `badge ${state.member ? "badge-member" : "badge-explorer"}`;
    }
    const says = byId("acct-state");
    if (says) says.textContent = describe(state);
    show("acct-upgrade", !state.member);
  }

  /**
   * The last project, named but never opened from here.
   *
   * It is a path on somebody's own disk and this page cannot reach it -- the
   * folder picker needs a gesture inside the app. So it is a reminder of where
   * the work is, which is the honest thing a page with no access to it can say.
   */
  let last = null;
  try { last = window.localStorage.getItem("geoid-gis:last-project"); } catch (error) { last = null; }
  const where = byId("acct-project");
  if (where) {
    where.textContent = last
      ? `Last open: ${last} — in the folder you chose, on this machine.`
      : "No project open yet on this machine.";
  }

  const out = byId("acct-signout");
  if (out) {
    out.addEventListener("click", (event) => {
      event.preventDefault();
      membership.signOut();
      location.reload();
    });
  }
}

if (byId("choose") || byId("not-ready")) signInPage();
else if (byId("acct-in") || byId("acct-out")) accountPage();
