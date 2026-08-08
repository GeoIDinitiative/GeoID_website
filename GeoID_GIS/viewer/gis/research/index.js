import * as hub from "./hub.js?v=20260808-a4734aa";
import { registeredCount } from "./stages.js?v=20260808-a4734aa";
import * as store from "./project-store.js?v=20260808-a4734aa";
import * as bridge from "./bridge.js?v=20260808-a4734aa";

// Pages register themselves on import. This list is the only place that has to
// change when one is added.
import "./pages/dashboard.js?v=20260808-a4734aa";
import "./pages/projects.js?v=20260808-a4734aa";
import "./pages/repository.js?v=20260808-a4734aa";
import "./pages/notes.js?v=20260808-a4734aa";
import "./pages/plotter.js?v=20260808-a4734aa";
import "./pages/signal.js?v=20260808-a4734aa";
import "./pages/fem.js?v=20260808-a4734aa";
import "./pages/storyboard.js?v=20260808-a4734aa";
import "./pages/docs.js?v=20260808-a4734aa";
import "./pages/builder.js?v=20260808-a4734aa";
import "./pages/notebook.js?v=20260808-a4734aa";

// Imported last on purpose: it wraps whatever each page already does.
import { completeAllPages } from "./spec-page.js?v=20260808-a4734aa";
// Behaviour for the controls the spec brings across; must load before
// completion runs so a wired control is never drawn disabled.
import "./wiring.js?v=20260808-a4734aa";
import "./wiring-pages.js?v=20260808-a4734aa";
import "./wiring-final.js?v=20260808-a4734aa";
import "./pages/ingest.js?v=20260808-a4734aa";
import "./pages/postprocess.js?v=20260808-a4734aa";
import "./pages/prepare.js?v=20260808-a4734aa";
import "./pages/analysis.js?v=20260808-a4734aa";
import "./pages/manage.js?v=20260808-a4734aa";
import "./pages/workbench.js?v=20260808-a4734aa";

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
