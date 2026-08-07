(function () {
  "use strict";

  const MODE_STORAGE_KEY = "geoid-gis:view-mode";
  const VALID_MODES = ["geoid", "model", "gis"];

  const EARTH_PANEL_IDS = [
    "tour-mode-section",
    "search-section",
    "locations-section",
    "basemap-relief-section",
    "geology-section",
    "sea-level-section",
    "legend-section",
    "weather-section",
    "modelled-data-section",
    "core-view-section",
    "metadata-section",
  ];

  let currentMode = "gis";
  // GeoID is no longer a page of its own. It is a mode of the GIS page: armed,
  // a click drops a location pin and raises the Analysis Hub; disarmed, the GIS
  // page navigates normally. Kept out of the mode itself so entering and
  // leaving it does not rebuild the whole sidebar.
  let hubArmed = false;

  function setPanelsHidden(ids, hidden) {
    ids.forEach((id) => {
      const node = document.getElementById(id);
      if (node) {
        node.hidden = hidden;
      }
    });
  }

  function setImportPanelVisible(visible) {
    const node = document.getElementById("import-data-section");
    if (node) {
      node.hidden = !visible;
    }
  }

  // Extraction combines the GeoID basemap with imported layers, so it belongs
  // to GIS mode only.
  function setAnalysisPanelVisible(visible) {
    const node = document.getElementById("gis-analysis-section");
    if (node) {
      node.hidden = !visible;
    }
  }

  // GIS mode restructures the sidebar into a toolbox: the GeoID controls fold
  // into one group and the tool groups stack beneath. GeoID and Model modes get
  // the original flat layout back.
  function setToolboxLayout(enabled) {
    window.GeoIDToolbox?.applyToolboxLayout?.(enabled);
  }

  // Model mode hands the screen to the Meshing Studio, which brings its own
  // docks and toolbars, so the globe sidebar and GIS rail stand down. The mode
  // switcher lives in that sidebar, so it is moved into the studio header
  // rather than hidden with it -- otherwise Model mode is a dead end with no
  // way back to GeoID or GIS.
  let modeSwitchHome = null;

  function setModelToolboxVisible(visible) {
    const node = document.getElementById("model-studio");
    if (node) {
      node.hidden = !visible;
    }
    const switcher = document.getElementById("view-mode-switch");
    const slot = document.getElementById("studio-mode-slot");
    if (switcher && slot) {
      if (visible) {
        if (!modeSwitchHome) {
          modeSwitchHome = { parent: switcher.parentNode, next: switcher.nextSibling };
        }
        switcher.classList.add("is-in-studio");
        slot.appendChild(switcher);
      } else if (modeSwitchHome) {
        switcher.classList.remove("is-in-studio");
        modeSwitchHome.parent.insertBefore(switcher, modeSwitchHome.next);
      }
    }
    document.body.classList.toggle("studio-open", visible);
  }

  function setGisToolboxVisible(visible) {
    const toolbar = document.getElementById("toolbar");
    if (toolbar) {
      toolbar.hidden = !visible;
    }
  }

  // Imported layers are parented to the globe group so they rotate with the
  // planet, which means hiding that group would hide them too. Model mode
  // therefore hides the globe's own children and leaves the imported groups
  // alone, rather than switching off the whole group.
  const IMPORT_GROUP_NAMES = new Set([
    "GeoID-ImportedGeoLayers",
    "GeoID-ImportedLocalModels",
  ]);

  // Visibility is remembered on the way out and restored on the way back in.
  // Blanket-setting every child visible would override the viewer's own
  // decisions -- the compare globe, for one, is deliberately hidden until it
  // has a texture, and forcing it on compiles a shader that references a map
  // that is not there.
  let hiddenGlobeState = null;

  function setGlobeVisible(visible) {
    const group = window.GeoIDViewer?.earthSceneGroup;
    if (!group) {
      return;
    }
    group.visible = true;
    if (!visible) {
      if (!hiddenGlobeState) {
        hiddenGlobeState = new Map();
        group.children.forEach((child) => {
          if (!IMPORT_GROUP_NAMES.has(child.name)) {
            hiddenGlobeState.set(child, child.visible);
            child.visible = false;
          }
        });
      }
      return;
    }
    if (hiddenGlobeState) {
      hiddenGlobeState.forEach((wasVisible, child) => {
        child.visible = wasVisible;
      });
      hiddenGlobeState = null;
    }
  }

  // The hazard readout reports on a GeoSelector pin, and pinning only happens
  // in GeoID mode, so the readout is confined to that mode too.
  function setHazardReadoutVisible(visible) {
    const node = document.getElementById("hazard-readout");
    if (node) {
      node.style.display = visible ? "" : "none";
    }
  }

  /**
   * The inherited build ships an inspect/pin workflow and a Base Builder pane
   * (buffers, query, compare, saved views) that are fully implemented but
   * switched off: Base Builder carries a `hidden` attribute in the markup, and
   * earth-viewer.js force-hides the inspect section and disables "Save As Pin"
   * during init. These are legacy viewer tools, distinct from the Analysis Hub
   * that the live myGeoID shell provides. They are enabled for GIS mode only,
   * so GeoID mode keeps parity with the live public viewer.
   */
  function setAnalysisToolsEnabled(enabled) {
    const inspect = document.getElementById("gis-inspect-section");
    if (inspect) {
      inspect.hidden = !enabled;
    }
    const builder = document.getElementById("toolbox-pane-builder");
    if (builder) {
      builder.hidden = !enabled;
    }
    const pinPlace = document.getElementById("gis-pin-place");
    if (pinPlace) {
      pinPlace.hidden = !enabled;
      pinPlace.disabled = !enabled;
    }
  }

  function applyMode(mode) {
    if (mode === "model") {
      setPanelsHidden(EARTH_PANEL_IDS, true);
      setGisToolboxVisible(false);
      setImportPanelVisible(true);
      setAnalysisPanelVisible(false);
      setToolboxLayout(false);
      setModelToolboxVisible(true);
      setHazardReadoutVisible(false);
      // Inspect, pins and buffers all act on the globe surface, so they have
      // nothing to operate on while the globe is hidden.
      setAnalysisToolsEnabled(false);
      setGlobeVisible(false);
    } else if (mode === "gis") {
      setPanelsHidden(EARTH_PANEL_IDS, false);
      setGisToolboxVisible(true);
      setImportPanelVisible(true);
      setAnalysisPanelVisible(true);
      setToolboxLayout(true);
      setModelToolboxVisible(false);
      setGlobeVisible(true);
      applyHubState();
    } else {
      setPanelsHidden(EARTH_PANEL_IDS, false);
      setGisToolboxVisible(true);
      setImportPanelVisible(false);
      setAnalysisPanelVisible(false);
      setToolboxLayout(false);
      setModelToolboxVisible(false);
      setHazardReadoutVisible(true);
      // GeoID mode mirrors the live public viewer, which keeps these hidden.
      setAnalysisToolsEnabled(false);
      setGlobeVisible(true);
    }
    // Expose the active mode on <body> so stylesheets can react to it without
    // every rule needing its own toggle.
    document.body.dataset.viewMode = mode;
    document.body.dataset.hubArmed = mode === "gis" && hubArmed ? "true" : "false";

    // Let the myGeoID-style shell (when this viewer is embedded) follow the
    // active mode - the Analysis Hub only applies to the GeoID globe.
    if (window.self !== window.top) {
      try {
        const reported = mode === "gis" && hubArmed ? "geoid" : mode;
        window.parent.postMessage({ type: "geoid:mode", mode: reported }, "*");
      } catch (error) {
        /* cross-origin parent, ignore */
      }
    }
  }

  /** Applies whatever the hub's armed state implies for pins and the readout. */
  function applyHubState() {
    const armed = currentMode === "gis" && hubArmed;
    setAnalysisToolsEnabled(armed);
    setHazardReadoutVisible(armed);
    const button = document.getElementById("geoid-mode-enter");
    if (button) {
      button.textContent = armed ? "Exit" : "Enter";
      button.classList.toggle("is-active", armed);
    }
    const hint = document.getElementById("geoid-mode-hint");
    if (hint) {
      hint.textContent = armed
        ? "Click a location for hazard analysis"
        : "Off — clicks pan and orbit the globe";
    }
    const row = document.getElementById("geoid-mode-row");
    if (row) row.classList.toggle("is-armed", armed);
    const activeTab = armed ? "geoid" : currentMode;
    document.querySelectorAll(".view-mode-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === activeTab);
    });
    document.body.dataset.hubArmed = armed ? "true" : "false";
  }

  function setHubArmed(on) {
    hubArmed = Boolean(on);
    if (hubArmed && currentMode !== "gis") {
      setMode("gis");
      return;
    }
    applyHubState();
    if (window.self !== window.top) {
      try {
        window.parent.postMessage(
          { type: "geoid:mode", mode: hubArmed ? "geoid" : currentMode },
          "*",
        );
      } catch (error) {
        /* cross-origin parent, ignore */
      }
    }
    window.dispatchEvent(new CustomEvent("geoid-gis:hub-change", {
      detail: { armed: hubArmed },
    }));
  }

  function setMode(mode) {
    if (!VALID_MODES.includes(mode)) {
      return;
    }
    // The GeoID tab does not swap the layout any more -- it is the GIS page
    // with the location selector armed. Selecting GIS disarms it again. Keeping
    // one layout is what makes the two feel like a single page rather than two
    // that happen to share a globe.
    if (mode === "geoid") {
      hubArmed = true;
      currentMode = "gis";
    } else {
      if (mode === "gis") hubArmed = false;
      currentMode = mode;
    }
    const activeTab = currentMode === "gis" && hubArmed ? "geoid" : currentMode;
    document.querySelectorAll(".view-mode-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === activeTab);
    });
    // currentMode, not the tab that was clicked: "geoid" resolves to the GIS
    // layout, and passing the raw tab here fell through to the old GeoID-page
    // branch, which hid the toolbox and switched the pin tool back off.
    applyMode(currentMode);
    // Arming is applied after, because the pin button and hazard readout live
    // inside the panels applyMode has just rearranged.
    applyHubState();
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch (error) {
      /* localStorage unavailable, ignore */
    }
    window.dispatchEvent(new CustomEvent("geoid-gis:mode-change", { detail: { mode } }));
  }

  function pollForViewer() {
    if (window.GeoIDViewer) {
      applyMode(currentMode);
      return;
    }
    requestAnimationFrame(pollForViewer);
  }

  function init() {
    document.querySelectorAll(".view-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    });
    document.getElementById("geoid-mode-enter")?.addEventListener("click", () => {
      setHubArmed(!hubArmed);
    });
    let initialMode = "gis";
    try {
      const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
      if (stored === "geoid") {
        initialMode = "geoid";
      } else if (VALID_MODES.includes(stored)) {
        initialMode = stored;
      }
    } catch (error) {
      /* localStorage unavailable, ignore */
    }
    setMode(initialMode);
    pollForViewer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.GeoIDModeManager = {
    setMode,
    getMode: () => currentMode,
    setHubArmed,
    isHubArmed: () => hubArmed,
  };
})();
