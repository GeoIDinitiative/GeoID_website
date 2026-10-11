/**
 * The guide's "Earth Engine and your own project" section, made to DO what it
 * describes: each button opens the real control the text names, and the
 * connection check asks the endpoint this page is actually using — so the
 * guide can never describe a door that is not there.
 *
 * The words are in the page's markup (the ⓘ modal beside the world's name);
 * this module only wires them, and stands down where a control is absent.
 */

const byId = (id) => document.getElementById(id);

const STYLE = `
.viewer-help-code{margin:.4rem 0;padding:.5rem .6rem;border-radius:.45rem;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.08);font:500 .72rem/1.45 "Courier New",monospace;white-space:pre-wrap;word-break:break-all;color:#dff8fb}
.viewer-help-card code{font:500 .78rem "Courier New",monospace;color:#dff8fb}
.viewer-help-actions{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:.65rem}
.viewer-help-action{appearance:none;border:1px solid rgba(var(--nav-accent-rgb),.5);background:rgba(var(--nav-accent-rgb),.1);color:var(--nav-accent);border-radius:.45rem;padding:.38rem .7rem;font:600 .74rem/1.2 'Exo 2',system-ui,sans-serif;letter-spacing:.04em;cursor:pointer}
.viewer-help-action:hover{background:rgba(var(--nav-accent-rgb),.22)}
.viewer-help-action[disabled]{opacity:.45;cursor:default}
.viewer-help-status{margin:.5rem 0 0;font-size:.82rem;color:#c8eef2;min-height:1.2em}
.viewer-help-status.is-ok{color:#7fe3a1}
.viewer-help-status.is-bad{color:#ff9b8a}
`;

function closeGuide() {
  byId("viewer-help-close")?.click();
}

const ACTIONS = {
  async "gee-check"(button) {
    const out = byId("viewer-help-gee-status");
    const seam = window.GeoIDGeeCatalogue;
    if (!seam?.check) { if (out) out.textContent = "Earth Engine is not loaded on this page."; return; }
    if (out) { out.textContent = "Asking the endpoint…"; out.className = "viewer-help-status"; }
    button.disabled = true;
    try {
      const got = await seam.check();
      if (out) {
        out.textContent = `${got.text}${got.endpoint ? ` (${got.endpoint})` : ""}`;
        out.className = `viewer-help-status ${got.ok ? "is-ok" : "is-bad"}`;
      }
    } finally {
      button.disabled = false;
    }
  },
  settings() {
    closeGuide();
    window.GeoIDSidePanels?.open?.("settings");
    // Bring the Earth Engine field into view inside the Settings bench.
    setTimeout(() => {
      const field = byId("gee-endpoint");
      field?.closest("details")?.setAttribute("open", "");
      field?.scrollIntoView({ block: "center", behavior: "smooth" });
      field?.focus({ preventScroll: true });
    }, 120);
  },
  catalogue() {
    closeGuide();
    window.GeoIDGeeCatalogue?.open?.("");
  },
  project() {
    closeGuide();
    byId("project-open-modal")?.click();
  },
};

function wire() {
  const section = byId("viewer-help-gee");
  if (!section || section.dataset.wired) return Boolean(section);
  section.dataset.wired = "1";
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
  section.querySelectorAll("[data-help-action]").forEach((button) => {
    const run = ACTIONS[button.dataset.helpAction];
    if (!run) { button.disabled = true; return; }
    button.addEventListener("click", () => { void run(button); });
  });
  // A door that is not on this page is not offered.
  const refresh = () => {
    section.querySelector('[data-help-action="catalogue"]')?.toggleAttribute("disabled", !window.GeoIDGeeCatalogue?.open);
    section.querySelector('[data-help-action="project"]')?.toggleAttribute("disabled", !byId("project-open-modal"));
    section.querySelector('[data-help-action="settings"]')?.toggleAttribute("disabled", !window.GeoIDSidePanels?.open);
  };
  refresh();
  byId("viewer-help-overlay")?.addEventListener("transitionstart", refresh);
  new MutationObserver(refresh).observe(byId("viewer-help-overlay") || section, { attributes: true, attributeFilter: ["hidden"] });
  return true;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  let tries = 0;
  const attempt = () => { if (!wire() && (tries += 1) < 40) setTimeout(attempt, 500); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attempt); else attempt();
}
