(function () {
  "use strict";

  const MODE_STORAGE_KEY = "geoid-gis:view-mode";
  const VALID_MODES = ["geoid", "model", "gis", "research"];

  const EARTH_PANEL_IDS = [
    "tour-mode-section",
    "search-section",
    "locations-section",
    "basemap-relief-section",
    "geology-section",
    "sea-level-section",
    "satellites-section",
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

  /**
   * There is no import panel any more, and this must not un-hide its remains.
   *
   * `import-data-section` is now a hidden box holding the file inputs, the
   * import status line and the layer list that `toolbox.js` moves into the
   * Layers tab. Showing it would put two loose file inputs and a stray status
   * line at the bottom of the sidebar. The calls are kept -- each mode still
   * says whether importing belongs to it -- so restoring a panel here is
   * writing one, not remembering to call this again.
   */
  function setImportPanelVisible() {}

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
  /**
   * The sidebar is not shown until it has been arranged.
   *
   * `body.sidebar-arranging` is in the markup, so it is true from the first
   * byte and there is no window in which the browser could paint the panels in
   * their markup order. This is what takes it off, and it is deliberately
   * driven by the layout SUCCEEDING rather than by a moment in the load: the
   * first `setMode` runs before `toolbox.js` exists and cannot arrange
   * anything, so revealing on it would show exactly the order being avoided.
   */
  function revealPanels() {
    document.body?.classList.remove("sidebar-arranging");
  }

  function setToolboxLayout(enabled) {
    const apply = window.GeoIDToolbox?.applyToolboxLayout;
    // Nothing to do yet, and that is expected rather than an error: this is a
    // classic `defer` script and runs ahead of the module tags on Earth's page,
    // so the first pass finds no toolbox. The DOMContentLoaded re-apply in
    // init() is what comes back for it -- measured, that first pass is at
    // 173ms with no toolbox and the re-apply at 437ms with one.
    if (typeof apply !== "function") return;
    apply(enabled);
    revealPanels();
  }

  // Model mode hands the screen to the Meshing Studio, which brings its own
  // docks and toolbars, so the globe sidebar and GIS rail stand down. The mode
  // switcher lives in that sidebar, so it is moved into the studio header
  // rather than hidden with it -- otherwise Model mode is a dead end with no
  // way back to GeoID or GIS.
  let modeSwitchHome = null;

  /**
   * Parks the mode switcher in whichever full-screen page owns the screen.
   *
   * The switcher lives in the globe sidebar, which those pages hide -- so
   * without this, Model and Research are dead ends with no way back. Takes the
   * slot id rather than assuming the studio, now that two pages need it.
   */
  function parkModeSwitch(slotId) {
    const switcher = document.getElementById("view-mode-switch");
    if (!switcher) return;
    const slot = slotId ? document.getElementById(slotId) : null;
    if (slot) {
      if (!modeSwitchHome) {
        modeSwitchHome = { parent: switcher.parentNode, next: switcher.nextSibling };
      }
      switcher.classList.add("is-in-studio");
      slot.appendChild(switcher);
    } else if (modeSwitchHome) {
      switcher.classList.remove("is-in-studio");
      // Same guard as the toolbox's: the sibling recorded when the switch was
      // parked may since have moved, and insertBefore throws rather than
      // ignoring it.
      const { parent, next } = modeSwitchHome;
      parent.insertBefore(switcher, next && next.parentNode === parent ? next : null);
      modeSwitchHome = null;
    }
  }

  function setModelToolboxVisible(visible) {
    const node = document.getElementById("model-studio");
    if (node) {
      node.hidden = !visible;
    }
    document.body.classList.toggle("studio-open", visible);
  }

  function setResearchHubVisible(visible) {
    const node = document.getElementById("research-hub");
    if (node) {
      node.hidden = !visible;
    }
    document.body.classList.toggle("research-open", visible);
    if (visible) window.GeoIDResearch?.open?.();
  }

    function setGeoidGroupVisible(visible) {
    // The globe-data sections stand down with the rest of the GIS toolbox,
    // since the studio has no globe for them to describe.
    ["gis-group-geoid", "gis-group-events"].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.hidden = !visible;
    });
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
   * that the live GeoHUB shell provides. They are enabled for GIS mode only,
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

  /**
   * The globe's rotation belongs to the viewer, which drives it off simulated
   * UTC and pauses it from the toggle in the corner. This only decides when it
   * should be held: turning it here as well produced a second rotation on top
   * of the viewer's, and stopping that one left the viewer's still running.
   */
  function setSpin(enabled) {
    // Events mode holds the globe still whoever asks, since reading a feed
    // against it means finding places on it.
    const wanted = Boolean(enabled) && document.body.dataset.events !== "true";
    document.body.dataset.spin = wanted ? "true" : "false";
    const controls = window.GeoIDViewer?.controls;
    if (controls) controls.autoRotate = false;
    window.GeoIDViewer?.setSpinPaused?.(!wanted);
  }

  // Space is handled by the viewer itself, which pauses and resumes its own
  // rotation. A second handler here toggled the same state in the same
  // keypress, and the two cancelled -- which is why the shortcut appeared dead.
  function watchForInteraction() {}

  function applyMode(mode) {
    // Whichever full-screen page is up takes the switcher with it.
    parkModeSwitch(mode === "model" ? "studio-mode-slot"
      : mode === "research" ? "research-mode-slot"
      : null);
    if (mode === "research") {
      // The hub owns the whole screen: no globe, no sidebar, no rail. The
      // globe keeps rendering behind it rather than being torn down, so
      // switching back is instant and the scene keeps its state.
      setPanelsHidden(EARTH_PANEL_IDS, true);
      setGisToolboxVisible(false);
      setImportPanelVisible(false);
      setAnalysisPanelVisible(false);
      setToolboxLayout(false);
      setModelToolboxVisible(false);
      setResearchHubVisible(true);
      setGeoidGroupVisible(false);
      setSpin(false);
      setHazardReadoutVisible(false);
      setAnalysisToolsEnabled(false);
      setGlobeVisible(false);
    } else if (mode === "model") {
      setPanelsHidden(EARTH_PANEL_IDS, true);
      setGisToolboxVisible(false);
      setImportPanelVisible(true);
      setAnalysisPanelVisible(false);
      setToolboxLayout(false);
      setModelToolboxVisible(true);
      setResearchHubVisible(false);
      setGeoidGroupVisible(false);
      setSpin(false);
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
      setResearchHubVisible(false);
      setGeoidGroupVisible(true);
      setGlobeVisible(true);
      applyHubState();
      // Arming means the user is aiming at a location; a moving target is the
      // last thing they want.
      setSpin(!hubArmed);
    } else {
      setPanelsHidden(EARTH_PANEL_IDS, false);
      setGisToolboxVisible(true);
      setImportPanelVisible(false);
      setAnalysisPanelVisible(false);
      setToolboxLayout(false);
      setModelToolboxVisible(false);
      setResearchHubVisible(false);
      setHazardReadoutVisible(true);
      // GeoID mode mirrors the live public viewer, which keeps these hidden.
      setAnalysisToolsEnabled(false);
      setGlobeVisible(true);
    }
    // Expose the active mode on <body> so stylesheets can react to it without
    // every rule needing its own toggle.
    document.body.dataset.viewMode = mode;
    document.body.dataset.hubArmed = mode === "gis" && hubArmed ? "true" : "false";

    // Let the GeoHUB-style shell (when this viewer is embedded) follow the
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

  /**
   * GeoID mode is about this world at this moment, so the bottom centre
   * carries the clock rather than the way out to the other nine.
   *
   * Done in CSS off `body[data-hub-armed]`, NOT by setting `hidden` here:
   * planet-strip.js owns its dock and sets `dock.hidden` from its own mode
   * handler, so whichever ran last won and the bar came back. State on the
   * body is the one instruction neither module can overwrite by accident.
   */

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
    const row = document.getElementById("gis-group-geoid");
    if (row) row.classList.toggle("is-armed", armed);
    // Arming does not change which page is showing, so the page's own tab keeps
    // the highlight; the Explorer control is what reports the armed state.
    document.querySelectorAll(".view-mode-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === currentMode);
    });
    document.body.dataset.hubArmed = armed ? "true" : "false";
  }

  /**
   * How far the legend and events rail must step left to clear the hazard
   * readout, published as a length for the stylesheet.
   *
   * The readout is fixed to the top-right corner and its width follows its
   * content, so this is measured rather than written down. Before this the rail
   * dropped below the readout instead, which pushed two drop-downs into the
   * middle of the globe.
   */
  function trackHazardRail() {
    const readout = document.getElementById("hazard-readout");
    if (!readout) return;
    const publish = () => {
      const armed = document.body.dataset.hubArmed === "true";
      const box = readout.getBoundingClientRect();
      // Measured from the viewport edge to the readout's left edge, so the
      // gap is exactly the gap asked for whatever inset the readout itself is
      // sitting at -- it takes a different one on short viewports.
      const offset = armed && box.width
        ? (window.innerWidth - box.left) + 8
        : 0;
      document.documentElement.style.setProperty("--hazard-rail-w", `${offset}px`);
      window.GeoIDEvents?.reflow?.();
    };
    new ResizeObserver(publish).observe(readout);
    new MutationObserver(publish).observe(document.body, {
      attributes: true,
      attributeFilter: ["data-hub-armed"],
    });
    window.addEventListener("resize", publish);
    publish();
  }

  function setHubArmed(on) {
    const was = hubArmed;
    hubArmed = Boolean(on);
    // Leaving the mode takes the pin with it. A marker left behind implies a
    // selection that no longer exists, and the Analysis Hub it belongs to has
    // already been dismissed.
    if (was && !hubArmed) {
      window.GeoIDViewer?.clearGeoSelection?.();
    }
    if (hubArmed && currentMode !== "gis") {
      setMode("gis");
      return;
    }
    applyHubState();
    setSpin(currentMode === "gis" && !hubArmed);
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
    document.querySelectorAll(".view-mode-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === currentMode);
    });
    // currentMode, not the tab that was clicked: "geoid" resolves to the GIS
    // layout, and passing the raw tab here fell through to the old GeoID-page
    // branch, which hid the toolbox and switched the pin tool back off.
    applyMode(currentMode);
    // Arming is applied after, because the pin button and hazard readout live
    // inside the panels applyMode has just rearranged.
    applyHubState();
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, currentMode);
    } catch (error) {
      /* localStorage unavailable, ignore */
    }
    window.dispatchEvent(new CustomEvent("geoid-gis:mode-change", { detail: { mode } }));
  }

  function pollForViewer() {
    if (window.GeoIDViewer) {
      applyMode(currentMode);
      watchForInteraction();
      return;
    }
    requestAnimationFrame(pollForViewer);
  }

  function init() {
    trackHazardRail();
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
        // Written before GeoID became a mode of the GIS page. Arming is never
        // restored either way -- GeoID mode starts off on every load, so a
        // stray click cannot open the Analysis Hub before it is asked for.
        initialMode = "gis";
      } else if (VALID_MODES.includes(stored)) {
        initialMode = stored;
      }
    } catch (error) {
      /* localStorage unavailable, ignore */
    }
    setMode(initialMode);
    // That setMode could not lay the sidebar out, and said nothing about it.
    //
    // This is a classic `defer` script, so it runs at readyState "interactive"
    // -- ahead of the module tags that follow it on Earth's page, `toolbox.js`
    // among them. `setToolboxLayout` is `window.GeoIDToolbox?.…`, so the call
    // went into the optional chain and the sidebar kept the markup order: every
    // panel loose in the column instead of folded into Explorer and the tab bar.
    //
    // Every deferred and module script has run by DOMContentLoaded, so re-apply
    // there. The planet pages already do exactly this from `boot.js`, after
    // their import loop; Earth had no equivalent because it has no boot.js.
    // Idempotent by design, which is what makes both safe.
    //
    // NOT the `pollForViewer` below: that waits on the whole Three.js globe,
    // measured at 1054ms against toolbox.js's 227ms, and the layout is pure DOM
    // movement that never touches the viewer. It stays for what does need it --
    // the spin and the globe's visibility.
    document.addEventListener("DOMContentLoaded", () => setMode(currentMode), { once: true });
    // If nothing ever lays the sidebar out -- a module that failed to parse,
    // a mode that never reaches the toolbox -- the panels must still appear.
    // A flash of the wrong order is a blemish; a sidebar that never arrives is
    // a broken page, and `revealPanels` is the difference between them.
    setTimeout(revealPanels, 4000);
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
    setSpin,
    isSpinning: () => window.GeoIDViewer?.isSpinPaused?.() === false,
  };
})();
