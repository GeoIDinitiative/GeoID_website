import * as hub from "./hub.js?v=20260808-258856f";
import { registeredCount } from "./stages.js?v=20260808-258856f";
import * as store from "./project-store.js?v=20260808-258856f";
import * as bridge from "./bridge.js?v=20260808-258856f";

// Pages register themselves on import. This list is the only place that has to
// change when one is added.
import "./pages/dashboard.js?v=20260808-258856f";
import "./pages/projects.js?v=20260808-258856f";
import "./pages/repository.js?v=20260808-258856f";
import "./pages/notes.js?v=20260808-258856f";
import "./pages/plotter.js?v=20260808-258856f";
import "./pages/signal.js?v=20260808-258856f";
import "./pages/fem.js?v=20260808-258856f";
import "./pages/storyboard.js?v=20260808-258856f";
import "./pages/docs.js?v=20260808-258856f";
import "./pages/ingest.js?v=20260808-258856f";
import "./pages/postprocess.js?v=20260808-258856f";
import "./pages/prepare.js?v=20260808-258856f";
import "./pages/analysis.js?v=20260808-258856f";
import "./pages/manage.js?v=20260808-258856f";
import "./pages/workbench.js?v=20260808-258856f";

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
