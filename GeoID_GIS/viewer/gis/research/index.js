import * as hub from "./hub.js?v=20260808-81e08f4";
import { registeredCount } from "./stages.js?v=20260808-81e08f4";
import * as store from "./project-store.js?v=20260808-81e08f4";
import * as bridge from "./bridge.js?v=20260808-81e08f4";

// Pages register themselves on import. This list is the only place that has to
// change when one is added.
import "./pages/dashboard.js?v=20260808-81e08f4";
import "./pages/projects.js?v=20260808-81e08f4";
import "./pages/repository.js?v=20260808-81e08f4";
import "./pages/notes.js?v=20260808-81e08f4";
import "./pages/plotter.js?v=20260808-81e08f4";
import "./pages/signal.js?v=20260808-81e08f4";
import "./pages/fem.js?v=20260808-81e08f4";
import "./pages/storyboard.js?v=20260808-81e08f4";
import "./pages/docs.js?v=20260808-81e08f4";
import "./pages/builder.js?v=20260808-81e08f4";
import "./pages/notebook.js?v=20260808-81e08f4";

// Imported last on purpose: it wraps whatever each page already does.
import { completeAllPages } from "./spec-page.js?v=20260808-81e08f4";
// Behaviour for the controls the spec brings across; must load before
// completion runs so a wired control is never drawn disabled.
import "./wiring.js?v=20260808-81e08f4";
import "./wiring-pages.js?v=20260808-81e08f4";
import "./wiring-final.js?v=20260808-81e08f4";
import "./pages/ingest.js?v=20260808-81e08f4";
import "./pages/postprocess.js?v=20260808-81e08f4";
import "./pages/prepare.js?v=20260808-81e08f4";
import "./pages/analysis.js?v=20260808-81e08f4";
import "./pages/manage.js?v=20260808-81e08f4";
import "./pages/workbench.js?v=20260808-81e08f4";

/**
 * Entry point for the Research Hub.
 *
 * Kept separate from hub.js so page modules can be added to the import list
 * here without touching the shell. Import order is registration order, and a
 * page registers itself on import.
 */

let opened = false;

function open() {
  if (opened) return;
  opened = true;
  hub.init({ store, bridge });
  // Every page completes itself against the Qt spec: keeps what it does, and
  // shows what the desktop app has that it does not, disabled rather than
  // faked. Async because the spec is fetched; the hub repaints when it lands.
  void completeAllPages()
    .then(() => hub.refresh())
    .catch((error) => console.warn("[research] spec completion:", error.message));
  // Resume last session's folder and project. Deliberately after init, not
  // before: the hub should paint immediately, and the pages re-mount by
  // themselves when a project opens. It used to happen only on the Projects
  // page, so landing anywhere else after a reload showed an empty hub even
  // though a folder had been chosen.
  void store.restoreSession().catch(() => { /* nothing to resume; the page asks */ });
}

window.GeoIDResearch = {
  open,
  store,
  bridge,
  setPage: hub.setPage,
  getPageId: hub.getPageId,
  refresh: hub.refresh,
  setContext: hub.setContext,
  registeredCount,
};

// The hub only builds itself when the mode is first entered -- there is no
// point laying out twelve stages for a session that never leaves the globe.
// mode-manager calls open() through window.GeoIDResearch.
if (document.body?.dataset?.viewMode === "research") open();
