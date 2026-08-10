import * as THREE from "/GeoID_GIS/viewer/vendor/three.module.js";
    import { OrbitControls } from "/GeoID_GIS/viewer/vendor/OrbitControls.js";
import { moonLatLonToVector3, makeLabelTexture, isVolcanicMoonFeature, isCraterMoonFeature, getMoonFeatureConnectorStart, buildLabelLayer, buildMoonLayer, buildMoonFeatureLabelLayer, getEntryConnectorStart, updateLabelAnchors, rebuildLabelTextures, updateMoonFeatureLabelVisibility, updateMoonVisibility, updateLabelVisibility } from "./label-layer.js?v=20260802";

    if (!window.__ctxPatchDebug) {
      window.__ctxPatchDebug = { verbose: true };
    } else {
      window.__ctxPatchDebug.verbose = true;
    }
    console.log("[ctxPatchDebug] venus-viewer.js loaded", { manifest: window.__venusViewerManifest, verbose: window.__ctxPatchDebug.verbose });

    const manifest = window.__venusViewerManifest;
    const app = document.getElementById("app");
    const measurementResultCard = document.getElementById("measurement-result-card");
    const measurementResultTitle = document.getElementById("measurement-result-title");
    const measurementResultBody = document.getElementById("measurement-result-body");
    const brandLogo = document.getElementById("brand-logo");
    const brandResetButton = document.getElementById("brand-reset-button");
    const statusNode = document.getElementById("status");
    const baseLayerSelect = document.getElementById("base-layer-select");
    // The streamed high-detail basemap for THIS body. Forked from the Mars
    // viewer, this file inherited Mars's "ctx-mosaic"/"ctx-mosaic-color"
    // literals in ~74 comparisons — none of which can ever match venus's own
    // layer id, so the entire mosaic code path was dead: the close-zoom label
    // sizing, the declutter that lets low-significance names through, the spin
    // lock and the tile staging. In flight that showed up as features arriving
    // as bare dots with no names, because updateLabelVisibility was never told
    // it was on the streamed basemap.
    const STREAMED_BASE_LAYER = "venus-surface";
    // Live since the stale-camera-matrix fix: the mosaic close-zoom path was
    // only ever "broken" on the forks because the flight label pass projected
    // through a frozen orbit matrix. With the recompose in the render loop it
    // behaves exactly as on Mars.
    const isStreamedBaseLayer = (v) => v === STREAMED_BASE_LAYER;
    // Rotation is only locked to protect the TILE STREAMER — a spinning globe
    // re-keys every tile request. This world serves one global texture and
    // never streams (BODY_STREAMS_TILES below), so there is nothing to
    // protect and the globe stays free to turn. On Mars, where the pyramid is
    // real, the lock still applies.
    const spinIsLocked = () => BODY_STREAMS_TILES && isStreamedBaseLayer(baseLayerSelect?.value);
    // This world's basemap is ONE global texture, not a tile pyramid. The
    // streaming machinery inherited from the Mars fork is hardwired to
    // Mars's CTX tile service (astro.arcgis.com/OnMars/...), so letting it
    // run here fetched MARS imagery over this planet. The predicate above
    // stays true — labels and relief key off it — but the tile pipeline
    // itself stands down.
    const BODY_STREAMS_TILES = false;
    const contourIntervalSelect = document.getElementById("contour-interval-select");
    const contourOpacity = document.getElementById("contour-opacity");
    const contourColorSelect = document.getElementById("contour-color-select");
    const hillshadeControls = document.getElementById("hillshade-controls");
    const hillshadeAzimuth = document.getElementById("hillshade-azimuth");
    const hillshadeAltitude = document.getElementById("hillshade-altitude");
    const geologyToggle = document.getElementById("geology-toggle");
    const geologyOpacity = document.getElementById("geology-opacity");
    const geologyContactsToggle = document.getElementById("geology-contacts-toggle");
    const geologyStructuresToggle = document.getElementById("geology-structures-toggle");
    const geologyTectonicToggle = document.getElementById("geology-tectonic-toggle");
    const geologyGrabenToggle = document.getElementById("geology-graben-toggle");
    const geologyFluvialToggle = document.getElementById("geology-fluvial-toggle");
    const geologyImpactToggle = document.getElementById("geology-impact-toggle");
    const geologyVolcanicToggle = document.getElementById("geology-volcanic-toggle");
    const geologyErosionalToggle = document.getElementById("geology-erosional-toggle");
    const geologyEolianToggle = document.getElementById("geology-eolian-toggle");
    const geologySection = document.getElementById("geology-section");
    const geologyMasterToggle = document.getElementById("geology-master-toggle");
    const terrainScale = document.getElementById("terrain-scale");
    const seaToggle = document.getElementById("sea-toggle");
    const seaLevelSlider = document.getElementById("sea-level-slider");
    const seaLevelValue = document.getElementById("sea-level-value");
    const seaLevelMin = document.getElementById("sea-level-min");
    const seaLevelCopy = document.getElementById("sea-level-copy");
    const labelsToggle = document.getElementById("labels-toggle");
    const volcanicLabelsToggle = document.getElementById("volcanic-labels-toggle");
    const landingLabelsToggle = document.getElementById("landing-labels-toggle");
    const habitationLabelsToggle = document.getElementById("habitation-labels-toggle");
    const craterLabelsToggle = document.getElementById("crater-labels-toggle");
    const fluvialLabelsToggle = document.getElementById("fluvial-labels-toggle");
    const tectonicLabelsToggle = document.getElementById("tectonic-labels-toggle");
    const lodSlider = document.getElementById("lod-slider");
    let currentLodLevel = 3;
    const moonToggle = document.getElementById("moon-toggle");
    const baseLabelsToggle = document.getElementById("base-labels-toggle");

    const locationsSection = document.getElementById("locations-section");
    const locationsMasterToggle = document.getElementById("locations-master-toggle");
    const moonViewerToggle = document.getElementById("moon-viewer-toggle");
    const coreToggle = document.getElementById("core-toggle");
    const regionMaskSelect = document.getElementById("region-mask-select");
    const regionMaskOpacity = document.getElementById("region-mask-opacity");
    const mineralSelect = document.getElementById("mineral-select");
    const mineralOpacity = document.getElementById("mineral-opacity");
    const featureSearch = document.getElementById("feature-search");
    const featureSearchGo = document.getElementById("feature-search-go");
    const featureSearchResults = document.getElementById("feature-search-results");
    const exploreReset = document.getElementById("explore-reset");
    const tourModeSection = document.getElementById("tour-mode-section");
    const tourModeToggle = document.getElementById("tour-mode-toggle");
    const tourModeControls = document.getElementById("tour-mode-controls");
    const tourModeFacet = document.getElementById("tour-mode-facet");
    const tourModeTarget = document.getElementById("tour-mode-target");
    const tourModePrev = document.getElementById("tour-mode-prev");
    const tourModeNext = document.getElementById("tour-mode-next");
    const moonViewerSection = document.getElementById("moon-viewer-section");
    const legendSection = document.getElementById("legend-section");
    function openLegendSection() { if (legendSection) legendSection.open = true; }
    const DEFAULT_NAVIGATE_BASE_LAYER_ID = "venus-surface";
    const moonViewerControls = document.getElementById("moon-viewer-controls");
    const moonViewerSelect = document.getElementById("moon-viewer-select");
    const moonFeatureSearchInput = document.getElementById("moon-feature-search");
    const moonFeatureSearchGo = document.getElementById("moon-feature-search-go");
    const moonFeatureSearchResults = document.getElementById("moon-feature-search-results");
    const moonViewerPrev = document.getElementById("moon-viewer-prev");
    const moonViewerNext = document.getElementById("moon-viewer-next");
    const moonFeatureTypeSelect = document.getElementById("moon-feature-type");
    const moonFeatureTourTarget = document.getElementById("moon-feature-tour-target");
    const moonFeatureTourPrev = document.getElementById("moon-feature-tour-prev");
    const moonFeatureTourNext = document.getElementById("moon-feature-tour-next");
    let moonNavContext = "moon";
    const GEOLOGY_STRUCTURE_FACETS = [
      {
        id: "tectonic",
        toggle: geologyTectonicToggle,
        label: "Faults and wrinkle ridges",
        legendTitle: "Faults and wrinkle ridges",
        detail: "Tectonic wrinkle ridges, faulted ridges, and other non-graben deformation traces.",
        tags: ["geology", "tectonic", "faults"],
        symbolColor: "#000000",
        matches: (entry) => {
          const origin = String(entry.origin || "").toLowerCase();
          const interpretation = String(entry.interpretation || "").toLowerCase();
          return origin === "tectonic" && !interpretation.includes("graben");
        },
      },
      {
        id: "graben",
        toggle: geologyGrabenToggle,
        label: "Graben and fossae",
        legendTitle: "Graben and fossae",
        detail: "Mapped tectonic graben axes, troughs, and fossae-related extensional traces.",
        tags: ["geology", "tectonic", "graben"],
        symbolColor: "#f08b2f",
        matches: (entry) => String(entry.interpretation || "").toLowerCase().includes("graben"),
      },
      {
        id: "fluvial",
        toggle: geologyFluvialToggle,
        label: "Fluvial channels",
        legendTitle: "Fluvial structures",
        detail: "Fluvial and outflow-channel axes mapped from valley and channel systems.",
        tags: ["geology", "fluvial", "channels"],
        symbolColor: "#5aa7ff",
        matches: (entry) => String(entry.origin || "").toLowerCase() === "fluvial",
      },
      {
        id: "impact",
        toggle: geologyImpactToggle,
        label: "Impact structures",
        legendTitle: "Impact structures",
        detail: "Impact-related mapped rims and other crater or basin structural traces.",
        tags: ["geology", "impact"],
        symbolColor: "#f2c14e",
        matches: (entry) => String(entry.origin || "").toLowerCase() === "impact",
      },
      {
        id: "volcanic",
        toggle: geologyVolcanicToggle,
        label: "Volcanic structures",
        legendTitle: "Volcanic structures",
        detail: "Volcanic lobate flows, caldera rims, rilles, and related volcanic structural traces.",
        tags: ["geology", "volcanic"],
        symbolColor: "#f06a57",
        matches: (entry) => String(entry.origin || "").toLowerCase() === "volcanic",
      },
      {
        id: "erosional",
        toggle: geologyErosionalToggle,
        label: "Erosional scarps",
        legendTitle: "Erosional scarps",
        detail: "Erosional scarps and related degradational landform boundaries.",
        tags: ["geology", "erosional"],
        symbolColor: "#d9d2c3",
        matches: (entry) => String(entry.origin || "").toLowerCase() === "erosional",
      },
      {
        id: "eolian",
        toggle: geologyEolianToggle,
        label: "Eolian yardangs",
        legendTitle: "Eolian structures",
        detail: "Wind-shaped yardangs and other eolian structural traces.",
        tags: ["geology", "eolian"],
        symbolColor: "#c98b4a",
        matches: (entry) => String(entry.origin || "").toLowerCase() === "eolian",
      },
    ];
    // Venus sidereal rotation period: 243.018 Earth days (retrograde).
    const _VENUS_DISPLAY_PERIOD_MS = 600000; // 10 min visual rotation
    const _VENUS_ROT_REAL_MS = 243.018 * 24 * 3600000; // rotation period in ms
    const _VENUS_MOON_SPEED_FACTOR = _VENUS_ROT_REAL_MS / _VENUS_DISPLAY_PERIOD_MS; // scaled

    const labelData = await fetch(new URL('./label-data.json', import.meta.url)).then(r => r.json());
    const ringLabelData = [];
    const moonData = [];
    const MOON_ORBIT_ECCENTRICITY = Object.freeze({});
    const moonFeatureData = [];
    const allFeatureData = [...labelData, ...ringLabelData, ...moonData, ...moonFeatureData];
    const TOUR_MODE_FACETS = [
      {
        id: "highlights",
        label: "Highlights",
        description: "A curated tour of Venus's most dramatic features, from Maxwell Montes and Ishtar Terra to vast volcanic coronae and deep canyon systems.",
        matches: (item) => [
          "Maxwell Montes",
          "Aphrodite Terra",
          "Ishtar Terra",
          "Maat Mons",
          "Sapas Mons",
          "Artemis Corona",
          "Diana Chasma",
          "Cleopatra",
          "Lakshmi Planum",
          "Eistla Regio",
          "Beta Regio",
          "Ovda Regio",
        ].includes(item.name),
      },
      {
        id: "volcanoes",
        label: "Volcanoes and coronae",
        description: "Shield volcanoes, calderas, paterae, and the coronae unique to Venus.",
        matches: (item) => item.theme === "volcanic",
      },
      {
        id: "craters",
        label: "Impact craters",
        description: "Named impact craters across the Venusian surface.",
        matches: (item) => item.theme === "crater",
      },
      {
        id: "tectonic",
        label: "Ridges, chasms and tesserae",
        description: "Chasmata, ridge belts, tessera terrain, and tectonic landforms.",
        matches: (item) => item.theme === "tectonic",
      },
      {
        id: "surface",
        label: "Highlands and lowlands",
        description: "Terrae, planitiae, plana, and broad surface regions of Venus.",
        matches: (item) => item.theme === "surface",
      },
      {
        id: "polar",
        label: "Polar regions",
        description: "High-latitude terrain features of Venus.",
        matches: (item) => {
          const lat = Number(item.lat);
          return Number.isFinite(lat) && Math.abs(lat) >= 65;
        },
      },
    ];
    const BASE_BUILDER_CATALOG = [
      { id: "hab_primary", name: "Primary Habitat", category: "Habitation", size: [4, 4], rotatable: true, color: "#4fc3f7", description: "Pressurised crew habitat and communal living module." },
      { id: "hab_extended", name: "Extended Habitat", category: "Habitation", size: [4, 2], rotatable: true, color: "#64b5f6", description: "Additional living or family habitation wing." },
      { id: "hq", name: "HQ / Ops Centre", category: "Operations", size: [4, 4], rotatable: true, color: "#81c784", description: "Mission control, operations, and command space." },
      { id: "medical", name: "Medical Clinic", category: "Operations", size: [3, 2], rotatable: true, color: "#ef9a9a", description: "Medical treatment, imaging, and emergency care." },
      { id: "airlock", name: "Airlock / EVA", category: "Habitation", size: [2, 2], rotatable: true, color: "#ce93d8", description: "Suit access and dust-decontamination airlock." },
      { id: "rad_shelter", name: "Radiation Shelter", category: "Safety", size: [3, 2], rotatable: false, color: "#b0bec5", description: "Storm shelter with heavy shielding." },
      { id: "greenhouse", name: "Greenhouse", category: "Food", size: [5, 5], rotatable: false, color: "#66bb6a", description: "Pressurised crop-production dome." },
      { id: "farm_module", name: "Farm Module", category: "Food", size: [4, 2], rotatable: true, color: "#9ccc65", description: "Supplementary food-production module." },
      { id: "bioreactor", name: "Algae Bioreactor", category: "Food", size: [2, 2], rotatable: false, color: "#26a69a", description: "Compact protein and oxygen bioreactor." },
      { id: "food_processing", name: "Food Processing", category: "Food", size: [3, 2], rotatable: true, color: "#ffcc80", description: "Galley, preservation, and food-processing facility." },
      { id: "atmo_plant", name: "Atmo Processing", category: "Life Support", size: [3, 3], rotatable: true, color: "#90caf9", description: "Oxygen generation and CO2 scrubbing plant." },
      { id: "water_plant", name: "Water Facility", category: "Life Support", size: [3, 3], rotatable: true, color: "#80deea", description: "Ice extraction, purification, and recycling." },
      { id: "thermal_plant", name: "Thermal Plant", category: "Life Support", size: [2, 2], rotatable: true, color: "#ffab91", description: "Heating, cooling, and thermal regulation plant." },
      { id: "solar_array", name: "Solar Array", category: "Energy", size: [6, 2], rotatable: true, color: "#ffd54f", description: "Photovoltaic field for supplemental power." },
      { id: "battery_bank", name: "Battery Bank", category: "Energy", size: [2, 2], rotatable: false, color: "#ffe082", description: "Energy storage and power buffering vault." },
      { id: "nuclear_reactor", name: "Fission Reactor", category: "Energy", size: [3, 3], rotatable: false, color: "#ff7043", description: "Continuous baseload nuclear power unit." },
      { id: "rover_garage", name: "Rover Garage", category: "Logistics", size: [4, 3], rotatable: true, color: "#a1887f", description: "Pressurised rover storage and maintenance bay." },
      { id: "landing_pad", name: "Landing Pad", category: "Logistics", size: [8, 8], rotatable: false, color: "#cfd8dc", description: "Hardened landing and cargo-offload pad." },
      { id: "quarry", name: "Regolith Quarry", category: "Industry", size: [6, 6], rotatable: false, color: "#8d6e63", description: "Excavation and stockpiling yard." },
      { id: "propellant_plant", name: "Propellant Plant", category: "Industry", size: [4, 3], rotatable: true, color: "#ff8a65", description: "Methane and LOX production facility." },
      { id: "smelter", name: "Metal Smelter", category: "Industry", size: [4, 3], rotatable: true, color: "#bcaaa4", description: "Refining and metal production module." },
      { id: "fab_3d", name: "3D Printing Hub", category: "Industry", size: [3, 3], rotatable: true, color: "#9575cd", description: "Additive manufacturing and rapid prototyping hub." },
      { id: "construction", name: "Construction Yard", category: "Industry", size: [4, 4], rotatable: false, color: "#ffb74d", description: "Block, brick, and construction-material yard." },
      { id: "science_lab", name: "Science Lab", category: "Science", size: [3, 3], rotatable: true, color: "#4db6ac", description: "General surface-science and chemistry laboratory." },
      { id: "biosafety_lab", name: "Biosafety Lab", category: "Science", size: [3, 2], rotatable: true, color: "#f48fb1", description: "Contained astrobiology and biosafety facility." },
      { id: "comms_array", name: "Comms Array", category: "Communications", size: [3, 3], rotatable: false, color: "#90a4ae", description: "Deep-space communications and relay array." },
      { id: "data_centre", name: "Data Centre", category: "Communications", size: [2, 2], rotatable: true, color: "#7986cb", description: "Local compute, storage, and operations servers." },
    ];
    if (moonViewerSelect && moonViewerSelect.options.length <= 1) {
      for (const item of moonData) {
        const option = document.createElement("option");
        option.value = item.name;
        option.textContent = item.name;
        moonViewerSelect.appendChild(option);
      }
    }
    if (tourModeFacet && tourModeFacet.options.length === 0) {
      for (const facet of TOUR_MODE_FACETS) {
        const option = document.createElement("option");
        option.value = facet.id;
        option.textContent = facet.label;
        tourModeFacet.appendChild(option);
      }
    }
    const metadataButton = document.getElementById("metadata-button");
    const metadataModal = document.getElementById("metadata-modal");
    const metadataTitle = document.getElementById("metadata-title");
    const metadataSubtitle = document.getElementById("metadata-subtitle");
    const metadataSections = document.getElementById("metadata-sections");
    const metadataClose = document.getElementById("metadata-close");
    const profileModal = document.getElementById("profile-modal");
    const profileModalTitle = document.getElementById("profile-modal-title");
    const profileModalSummary = document.getElementById("profile-modal-summary");
    const profileModalCanvas = document.getElementById("profile-modal-canvas");
    const profileModalExportPng = document.getElementById("profile-modal-export-png");
    const profileModalClose = document.getElementById("profile-modal-close");
    const csvPlotterModal = document.getElementById("csv-plotter-modal");
    const csvPlotterClose = document.getElementById("csv-plotter-close");
    const csvPlotterImport = document.getElementById("csv-plotter-import");
    const csvPlotterExportPng = document.getElementById("csv-plotter-export-png");
    const csvPlotterFile = document.getElementById("csv-plotter-file");
    const csvPlotterX = document.getElementById("csv-plotter-x");
    const csvPlotterY = document.getElementById("csv-plotter-y");
    const csvPlotterType = document.getElementById("csv-plotter-type");
    const csvPlotterRender = document.getElementById("csv-plotter-render");
    const csvPlotterMeta = document.getElementById("csv-plotter-meta");
    const csvPlotterCanvas = document.getElementById("csv-plotter-canvas");
    const gisExtractModal = document.getElementById("gis-extract-modal");
    const gisExtractClose = document.getElementById("gis-extract-close");
    const gisExtractSource = document.getElementById("gis-extract-source");
    const gisExtractStep = document.getElementById("gis-extract-step");
    const gisExtractColumns = document.getElementById("gis-extract-columns");
    const gisExtractRun = document.getElementById("gis-extract-run");
    const gisExtractMeta = document.getElementById("gis-extract-meta");
    const legendPanel = document.getElementById("legend-panel");

    if (brandLogo) {
      brandLogo.src = "../../../assets/venus_icon.png";
    }
    const legendSummaryCopy = document.getElementById("legend-summary-copy");
    const scenePopup = document.getElementById("scene-popup");
    const scenePopupState = document.getElementById("scene-popup-state");
    const scenePopupKicker = document.getElementById("scene-popup-kicker");
    const scenePopupTitle = document.getElementById("scene-popup-title");
    const scenePopupMeta = document.getElementById("scene-popup-meta");
    const scenePopupCopy = document.getElementById("scene-popup-copy");
    const scenePopupDetail = document.getElementById("scene-popup-detail");
    const scenePopupImg = document.getElementById("scene-popup-img");
    const scenePopupClose = document.getElementById("scene-popup-close");
    const scenePopupAnchor = document.getElementById("scene-popup-anchor");
    const measureDistanceButton = document.getElementById("measure-distance");
    const measureAreaButton = document.getElementById("measure-area");
    const measureProfileButton = document.getElementById("measure-profile");
    const measureRouteButton = document.getElementById("measure-route");
    const measureRailActionGroups = [...document.querySelectorAll("[data-measure-actions]")];
    const measureRailExportButtons = [...document.querySelectorAll("[data-measure-export]")];
    const measureRailClearButtons = [...document.querySelectorAll("[data-measure-clear]")];
    const measureCopy = document.getElementById("measure-copy");
    const measurePanel = document.getElementById("measure-panel");
    const measureMetric = document.getElementById("measure-metric");
    const measureUndoButton = document.getElementById("measure-undo");
    const measureRedoButton = document.getElementById("measure-redo");
    const measureExport = document.getElementById("measure-export");
    const measureExportRouteButton = document.getElementById("measure-export-route");
    const profileCanvas = document.getElementById("profile-canvas");
    const routeMetric = document.getElementById("route-metric");
    const routeProfileCanvas = document.getElementById("route-profile-canvas");
    const toolboxPaneMeasure = document.getElementById("toolbox-pane-measure");
    const toolboxPaneFeatures = document.getElementById("toolbox-pane-features");
    const toolboxPaneBuilder = document.getElementById("toolbox-pane-builder");
    const toolboxPaneRoute = document.getElementById("toolbox-pane-route");
    const toolboxPanes = [...document.querySelectorAll("[data-toolbox-pane]")];
    const measureRailButtons = [...document.querySelectorAll("[data-measure-mode]")];
    const gisToolboxToggle = document.getElementById("gis-toolbox-toggle");
    const gisPanel = document.getElementById("gis-panel");
    const gisRouteSection = document.getElementById("gis-route-section");
    const gisInspectSection = document.getElementById("gis-inspect-section");
    const gisStudySection = document.getElementById("gis-study-section");
    const gisBufferSection = document.getElementById("gis-buffer-section");
    const gisQuerySection = document.getElementById("gis-query-section");
    const gisCompareSection = document.getElementById("gis-compare-section");
    const gisSavedSection = document.getElementById("gis-saved-section");
    const gisInspectButton = document.getElementById("gis-inspect");
    const gisSaveViewButton = document.getElementById("gis-save-view");
    const gisOpenCsvPlotterButton = document.getElementById("gis-open-csv-plotter");
    const gisBaseSection = document.getElementById("gis-base-section");
    const gisBaseStructuresSection = document.getElementById("gis-base-structures-section");
    const gisBaseName = document.getElementById("gis-base-name");
    const gisBaseColor = document.getElementById("gis-base-color");
    const gisBaseGridSize = document.getElementById("gis-base-grid-size");
    const gisBaseShape = document.getElementById("gis-base-shape");
    const gisBaseSize = document.getElementById("gis-base-size");
    const gisBaseCreateStudy = document.getElementById("gis-base-create-study");
    const gisBaseCreatePreset = document.getElementById("gis-base-create-preset");
    const gisBaseExportJson = document.getElementById("gis-base-export-json");
    const gisBaseExportGeoJson = document.getElementById("gis-base-export-geojson");
    const gisBaseImportJson = document.getElementById("gis-base-import-json");
    const gisBaseFileJson = document.getElementById("gis-base-file-json");
    const gisBaseMetric = document.getElementById("gis-base-metric");
    const gisBaseList = document.getElementById("gis-base-list");
    const gisBaseGo = document.getElementById("gis-base-go");
    const gisBaseDelete = document.getElementById("gis-base-delete");
    const gisBaseBuildingCategory = document.getElementById("gis-base-building-category");
    const gisBaseBuildingSelect = document.getElementById("gis-base-building-select");
    const gisBaseBuildingRotation = document.getElementById("gis-base-building-rotation");
    const gisBasePlaceBuilding = document.getElementById("gis-base-place-building");
    const gisBaseRemoveBuilding = document.getElementById("gis-base-remove-building");
    const gisBaseClearBuildings = document.getElementById("gis-base-clear-buildings");
    const gisBaseBuildingMetric = document.getElementById("gis-base-building-metric");
    const gisBaseBuildingList = document.getElementById("gis-base-building-list");
    const gisBaseBuildingGo = document.getElementById("gis-base-building-go");
    const gisCopy = document.getElementById("gis-copy");
    const gisMetric = document.getElementById("gis-metric");
    const gisStudyActivateButton = document.getElementById("gis-study-activate");
    const gisStudySaveButton = document.getElementById("gis-study-save");
    const gisStudyExportCsvButton = document.getElementById("gis-study-export-csv");
    const gisStudyExportGeoJsonButton = document.getElementById("gis-study-export-geojson");
    const gisStudyClearButton = document.getElementById("gis-study-clear");
    const gisStudyExtractButton = document.getElementById("gis-study-extract");
    const gisStudyMetric = document.getElementById("gis-study-metric");
    const gisStudyHistogram = document.getElementById("gis-study-histogram");
    const gisStudyList = document.getElementById("gis-study-list");
    const gisStudyGo = document.getElementById("gis-study-go");
    const gisStudyDelete = document.getElementById("gis-study-delete");
    const gisBufferSource = document.getElementById("gis-buffer-source");
    const gisBufferRadius = document.getElementById("gis-buffer-radius");
    const gisBufferGenerate = document.getElementById("gis-buffer-generate");
    const gisBufferSave = document.getElementById("gis-buffer-save");
    const gisBufferExport = document.getElementById("gis-buffer-export");
    const gisBufferClear = document.getElementById("gis-buffer-clear");
    const gisBufferExtractButton = document.getElementById("gis-buffer-extract");
    const gisBufferMetric = document.getElementById("gis-buffer-metric");
    const gisBufferList = document.getElementById("gis-buffer-list");
    const gisBufferGo = document.getElementById("gis-buffer-go");
    const gisBufferDelete = document.getElementById("gis-buffer-delete");
    const gisQueryDataset = document.getElementById("gis-query-dataset");
    const gisQueryClass = document.getElementById("gis-query-class");
    const gisQueryElevMin = document.getElementById("gis-query-elev-min");
    const gisQueryElevMax = document.getElementById("gis-query-elev-max");
    const gisQuerySlopeMin = document.getElementById("gis-query-slope-min");
    const gisQuerySlopeMax = document.getElementById("gis-query-slope-max");
    const gisQueryMineralMin = document.getElementById("gis-query-mineral-min");
    const gisQueryNearbyKm = document.getElementById("gis-query-nearby-km");
    const gisQueryUseBuffer = document.getElementById("gis-query-use-buffer");
    const gisQueryRun = document.getElementById("gis-query-run");
    const gisQueryClear = document.getElementById("gis-query-clear");
    const gisQueryMetric = document.getElementById("gis-query-metric");
    const gisQueryResults = document.getElementById("gis-query-results");
    const gisQueryGo = document.getElementById("gis-query-go");
    const toolRailDistanceButton = document.getElementById("tool-rail-distance");
    const toolRailAreaButton = document.getElementById("tool-rail-area");
    const gisCompareLayerSelect = document.getElementById("gis-compare-layer");
    const gisCompareModeSelect = document.getElementById("gis-compare-mode");
    const gisCompareOpacity = document.getElementById("gis-compare-opacity");
    const gisCompareSwipeRow = document.getElementById("gis-compare-swipe-row");
    const gisCompareSwipe = document.getElementById("gis-compare-swipe");
    const gisBookmarkList = document.getElementById("gis-bookmark-list");
    const gisBookmarkGo = document.getElementById("gis-bookmark-go");
    const gisBookmarkDelete = document.getElementById("gis-bookmark-delete");
    const gisExportPointButton = document.getElementById("gis-export-point");
    const gisExportStudyButton = document.getElementById("gis-export-study");
    const cursorReadout = document.getElementById("cursor-readout");
    const scaleReadout = document.getElementById("scale-readout");
    const renderingIndicator = document.getElementById("rendering-indicator");
    const scaleBarTrack = scaleReadout?.querySelector(".scale-bar-track") ?? null;
    const scaleLabel0 = document.getElementById("scale-label-0");
    const scaleLabel1 = document.getElementById("scale-label-1");
    const scaleLabel2 = document.getElementById("scale-label-2");
    const scaleLabel3 = document.getElementById("scale-label-3");
    const scaleLabel4 = document.getElementById("scale-label-4");
    const scaleLabel5 = document.getElementById("scale-label-5");
    const scTemp = document.getElementById("sc-temp");
    const scPressure = document.getElementById("sc-pressure");
    const scContext = document.getElementById("sc-context");
    const surfaceConditionsEl = document.getElementById("surface-conditions");
    const hemisphereLocatorEl = document.getElementById("hemisphere-locator");
    const hemisphereLocatorCanvas = document.getElementById("hemisphere-locator-canvas");
    const hemisphereLocatorReadout = document.getElementById("hemisphere-locator-readout");
    const interiorConditionsEl = document.getElementById("interior-conditions");
    const icDepth = document.getElementById("ic-depth");
    const icLayer = document.getElementById("ic-layer");
    const icTemp = document.getElementById("ic-temp");
    const icPressure = document.getElementById("ic-pressure");
    const hoverTooltip = document.getElementById("hover-tooltip");
    const mosaicFocusLabelLayer = document.getElementById("mosaic-focus-label-layer");
    const mosaicFocusConnector = document.getElementById("mosaic-focus-connector");
    const mosaicFocusLabel = document.getElementById("mosaic-focus-label");



    function estimateVenusTemperature(latDeg, elevMeters) {
      return Math.round(465 - 8.0 * (elevMeters / 1000));
    }

    function estimateVenusPressure(elevMeters) {
      return Math.round(9200 * Math.exp(-elevMeters / 15900));
    }

    const locatorCtx = hemisphereLocatorCanvas?.getContext("2d") ?? null;
    const locatorCameraLocal = new THREE.Vector3();
    let locatorLatLon = { lat: 0, lon: 0 };
    let locatorDrawnLatLon = { lat: NaN, lon: NaN };
    const locatorViewState = { camera: null, venusGroup: null, globe: null };

    function drawHemisphereLocator(latDeg, lonDeg) {
      if (!locatorCtx || !hemisphereLocatorCanvas) {
        return;
      }
      const ctx = locatorCtx;
      const width = hemisphereLocatorCanvas.width;
      const height = hemisphereLocatorCanvas.height;
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      const radius = Math.min(width, height) * 0.39;
      const latRad = THREE.MathUtils.degToRad(latDeg || 0);
      const lonRad = THREE.MathUtils.degToRad(lonDeg || 0);
      const sinTilt = Math.sin(THREE.MathUtils.degToRad(22));
      const cosTilt = Math.cos(THREE.MathUtils.degToRad(22));
      const project = (lat, lon) => {
        const phi = THREE.MathUtils.degToRad(lat);
        const lambda = THREE.MathUtils.degToRad(lon) - lonRad;
        const x = Math.cos(phi) * Math.sin(lambda);
        const y0 = Math.sin(phi);
        const z0 = Math.cos(phi) * Math.cos(lambda);
        const y = y0 * cosTilt - z0 * sinTilt;
        const z = y0 * sinTilt + z0 * cosTilt;
        return { x: centerX + x * radius, y: centerY - y * radius, visible: z >= 0 };
      };

      ctx.clearRect(0, 0, width, height);

      const globeFill = ctx.createRadialGradient(centerX - radius * 0.28, centerY - radius * 0.32, radius * 0.18, centerX, centerY, radius);
      globeFill.addColorStop(0, "rgba(255, 255, 255, 0.03)");
      globeFill.addColorStop(0.55, "rgba(255, 255, 255, 0.012)");
      globeFill.addColorStop(1, "rgba(255, 255, 255, 0.005)");
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = globeFill;
      ctx.fill();

      const drawPolyline = (points, strokeStyle, lineWidth = 1, alpha = 1) => {
        let drawing = false;
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (const point of points) {
          if (!point.visible) {
            drawing = false;
            continue;
          }
          if (!drawing) {
            ctx.moveTo(point.x, point.y);
            drawing = true;
          } else {
            ctx.lineTo(point.x, point.y);
          }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };

      for (let lat = -60; lat <= 60; lat += 30) {
        const points = [];
        for (let lon = -180; lon <= 180; lon += 4) {
          points.push(project(lat, lon));
        }
        drawPolyline(points, "rgba(255, 255, 255, 0.26)");
      }

      for (let lon = -150; lon <= 180; lon += 30) {
        const points = [];
        for (let lat = -90; lat <= 90; lat += 4) {
          points.push(project(lat, lon));
        }
        drawPolyline(points, "rgba(255, 255, 255, 0.18)");
      }

      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const eqStart = project(0, -180);
      const eqEnd = project(0, 180);
      drawPolyline([eqStart, eqEnd], "rgba(255, 255, 255, 0.42)", 1);

      const marker = project(latDeg, lonDeg);
      if (marker.visible) {
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
        ctx.shadowColor = "rgba(255, 255, 255, 0.42)";
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(111, 217, 232, 0.78)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    function sampleLocatorLatLon() {
      if (!locatorViewState.globe || !locatorViewState.camera || !locatorViewState.venusGroup || activeMoonViewerFeature) {
        return null;
      }
      locatorCameraLocal.copy(locatorViewState.camera.position);
      locatorViewState.venusGroup.worldToLocal(locatorCameraLocal);
      if (locatorCameraLocal.lengthSq() < 1e-8) {
        return null;
      }
      locatorCameraLocal.normalize().multiplyScalar(3.2);
      locatorCameraLocal.applyEuler(new THREE.Euler(0, -(locatorViewState.globe.rotation.y - Math.PI), 0));
      return vectorToLatLon(locatorCameraLocal);
    }

    function updateHemisphereLocator() {
      if (!hemisphereLocatorEl) {
        return;
      }
      if (activeMoonViewerFeature || coreToggle.checked) {
        hemisphereLocatorEl.hidden = true;
        return;
      }
      const latLon = sampleLocatorLatLon();
      hemisphereLocatorEl.hidden = false;
      if (latLon) {
        locatorLatLon = latLon;
      }
      if (
        !Number.isFinite(locatorDrawnLatLon.lat) ||
        Math.abs(locatorDrawnLatLon.lat - locatorLatLon.lat) > 0.15 ||
        Math.abs(locatorDrawnLatLon.lon - locatorLatLon.lon) > 0.15
      ) {
        drawHemisphereLocator(locatorLatLon.lat, locatorLatLon.lon);
        locatorDrawnLatLon = { ...locatorLatLon };
      }
      if (hemisphereLocatorReadout) {
        hemisphereLocatorReadout.textContent = `Center ${locatorLatLon.lat.toFixed(1)}°, ${locatorLatLon.lon.toFixed(1)}°E`;
      }
    }

    function hideMosaicFocusLabel() {
      if (mosaicFocusLabelLayer) {
        mosaicFocusLabelLayer.hidden = true;
      }
    }

    // ── Mars interior model (depth-based) ────────────────────────────────────
    // Layer boundaries as fraction of planetary radius (from InSight + geophysical models)
    // rFrac = 0 → centre, rFrac = 1 → surface
    const VENUS_INTERIOR_LAYERS = [
      { name: "Inner Core",        rMin: 0.000, rMax: 0.200 },
      { name: "Liquid Outer Core", rMin: 0.200, rMax: 0.480 },
      { name: "Mantle",            rMin: 0.480, rMax: 0.985 },
      { name: "Crust",             rMin: 0.985, rMax: 1.000 },
    ];
    // Piecewise-linear T (°C) and P (GPa) profiles keyed on rFrac (sorted low→high)
    const VENUS_INTERIOR_T_PTS = [[0.000, 5000], [0.200, 4500], [0.480, 3000], [0.985, 1000], [1.000, 465]];
    const VENUS_INTERIOR_P_PTS = [[0.000, 290.0], [0.200, 260.0], [0.480, 120.0], [0.985, 10.0], [1.000, 0.009]];

    function _interiorInterp(pts, rFrac) {
      const r = Math.max(0, Math.min(1, rFrac));
      for (let i = 0; i < pts.length - 1; i++) {
        const [r0, v0] = pts[i], [r1, v1] = pts[i + 1];
        if (r >= r0 && r <= r1) {
          const f = (r - r0) / (r1 - r0);
          return v0 + f * (v1 - v0);
        }
      }
      return pts[pts.length - 1][1];
    }

    function estimateVenusInteriorTemperature(rFrac) {
      return Math.round(_interiorInterp(VENUS_INTERIOR_T_PTS, rFrac));
    }

    function estimateVenusInteriorPressure(rFrac) {
      return Math.round(_interiorInterp(VENUS_INTERIOR_P_PTS, rFrac) * 10) / 10;
    }

    function venusInteriorLayerName(rFrac) {
      for (const layer of VENUS_INTERIOR_LAYERS) {
        if (rFrac >= layer.rMin && rFrac <= layer.rMax) return layer.name;
      }
      return "Unknown";
    }

    const VENUS_INTERIOR_LAYER_COLORS = {
      "Crust":             "#d4b896",
      "Mantle":            "#c07848",
      "Liquid Outer Core": "#ff6633",
      "Inner Core":        "#f5e0a8",
    };

    function venusInteriorLayerColor(layerName) {
      return VENUS_INTERIOR_LAYER_COLORS[layerName] ?? "#f6dcc8";
    }

    function venusInteriorTempColor(tempC) {
      // Interpolate blue → cyan → yellow → red across -50°C to 2100°C
      const t = Math.max(0, Math.min(1, (tempC + 0) / 5000));
      let r, g, b;
      if (t < 0.33) {
        const f = t / 0.33;
        r = Math.round(f * 60); g = Math.round(f * 200); b = Math.round(255 - f * 55);
      } else if (t < 0.66) {
        const f = (t - 0.33) / 0.33;
        r = Math.round(60 + f * 195); g = Math.round(200 - f * 60); b = Math.round(200 - f * 200);
      } else {
        const f = (t - 0.66) / 0.34;
        r = 255; g = Math.round(140 - f * 140); b = 0;
      }
      return `rgb(${r},${g},${b})`;
    }

    function venusInteriorPressureColor(gpa) {
      // Interpolate green → yellow → red across 0–40 GPa
      const t = Math.max(0, Math.min(1, gpa / 290));
      const r = Math.round(t < 0.5 ? t * 2 * 220 : 220);
      const g = Math.round(t < 0.5 ? 200 : (1 - (t - 0.5) * 2) * 200);
      return `rgb(${r},${g},60)`;
    }

    function estimateVenusWindSpeed(latDeg, elevMeters) {
      const latRad = latDeg * Math.PI / 180;
      const jetStream = 6 * Math.sin(2 * latRad) ** 2;
      const elevBoost = Math.max(0, elevMeters / 4000);
      return Math.round((3 + jetStream + elevBoost) * 10) / 10;
    }

    function estimateMarsIrradiance(latDeg, elevMeters) {
      const latRad = latDeg * Math.PI / 180;
      const latFactor = Math.max(0, Math.cos(latRad));
      const elevFactor = 1 + Math.max(0, elevMeters) / 300000;
      return Math.round(590 * latFactor * elevFactor);
    }

    function estimateMarsRadiation(elevMeters) {
      return Math.round((0.5 * Math.exp(elevMeters / 14000) + 0.2) * 100) / 100;
    }

    function estimateMarsDiurnalRange(latDeg, elevMeters) {
      const latRad = latDeg * Math.PI / 180;
      const base = 80 * Math.cos(latRad) ** 2 + 20;
      return Math.round(base + elevMeters / 3000);
    }

    // Sun direction in scene space (approximated from key light at 8,4,6 and ambient star field)
    const _SUN_DIR = new THREE.Vector3(8, 4, 6).normalize();

    function estimateMoonSurfaceTemperature(moonName, surfaceNormalWorld) {
      // Airless body: temperature depends on angle from sub-solar point.
      // Phobos/Deimos dayside peak ~+27°C, nightside ~-170°C (Phobos measured values)
      const cosTheta = Math.max(0, surfaceNormalWorld.dot(_SUN_DIR));
      const T_night = -170;
      const T_day = moonName === "Deimos" ? 24 : 27; // Deimos slightly cooler due to albedo
      return Math.round(T_night + (T_day - T_night) * cosTheta);
    }

    function estimateMoonSurfacePressure() {
      // Exosphere only — effectively zero. Phobos exosphere ~10⁻¹⁰ Pa.
      return null; // displayed as special string
    }

    function estimateSpaceTemperature(cameraDistanceFromMars) {
      // Near Mars: ~−63 °C effective equilibrium. Far from Mars: bias to deep space ~−247 °C.
      // Interpolate across camera distance to avoid sudden jumps.
      const t = Math.max(0, Math.min(1, (cameraDistanceFromMars - 3.5) / 30));
      return Math.round(-63 - 184 * t);
    }

    const SC_PARAMS = {
      temperature: {
        label: "Mean Surface Temperature", unit: "°C", min: -130, max: 30,
        stops: [[20,0,70],[0,50,200],[0,140,220],[20,220,200],[60,200,80],[240,200,30],[220,50,20]],
        compute: (lat, elev) => estimateVenusTemperature(lat, elev),
        legendA: "#1400c8", legendB: "#dc3214",
        description: "Estimated mean surface temperature derived from latitude and terrain elevation.",
      },
      pressure: {
        label: "Atmospheric Pressure", unit: "Pa", min: 50, max: 1400,
        stops: [[200,180,230],[80,120,220],[40,180,180],[100,200,60],[240,170,30],[210,60,20]],
        compute: (_lat, elev) => estimateVenusPressure(elev),
        legendA: "#c8b4e6", legendB: "#d23c14",
        description: "Estimated surface atmospheric pressure. Lowest at Olympus Mons (~96 Pa), highest in Hellas Basin (~1300 Pa).",
      },
      wind: {
        label: "Surface Wind Speed", unit: "m/s", min: 1, max: 20,
        stops: [[30,120,200],[30,200,150],[200,220,40],[240,140,20],[220,50,20],[160,10,10]],
        compute: (lat, elev) => estimateVenusWindSpeed(lat, elev),
        legendA: "#1e78c8", legendB: "#a01414",
        description: "Estimated mean surface wind speed. Stronger near mid-latitude jet streams and at higher elevations.",
      },
      irradiance: {
        label: "Solar Irradiance", unit: "W/m²", min: 0, max: 590,
        stops: [[5,5,30],[30,10,100],[100,30,180],[220,120,30],[255,200,50],[255,250,200]],
        compute: (lat, elev) => estimateMarsIrradiance(lat, elev),
        legendA: "#05051e", legendB: "#fffac8",
        description: "Mean annual solar irradiance at the surface. Peaks near the equator (~590 W/m²), minimal at poles.",
      },
      radiation: {
        label: "Surface Radiation Dose", unit: "mSv/day", min: 0.5, max: 2.0,
        stops: [[20,180,80],[120,210,40],[240,200,20],[240,100,20],[200,20,20]],
        compute: (_lat, elev) => estimateMarsRadiation(elev),
        legendA: "#14b450", legendB: "#c81414",
        description: "Estimated daily cosmic radiation dose. Increases with altitude as atmospheric shielding thins.",
      },
      diurnal: {
        label: "Diurnal Temp Range", unit: "°C", min: 20, max: 100,
        stops: [[40,80,200],[20,180,200],[40,200,80],[220,200,30],[240,100,20],[200,20,20]],
        compute: (lat, elev) => estimateMarsDiurnalRange(lat, elev),
        legendA: "#2850c8", legendB: "#c81414",
        description: "Estimated daily temperature swing between surface day and night. Largest near the equator and at high elevation.",
      },
      atm_density: {
        label: "Atmospheric Density", unit: "kg/m³", min: 0.003, max: 0.034,
        stops: [[220,210,245],[100,130,220],[40,185,185],[100,200,65],[240,175,35],[215,65,20]],
        compute: (_lat, elev) => {
          const T_K = (-20 - 2.5 * (elev / 1000)) + 273.15;
          const P = 636 * Math.exp(-elev / 11100);
          return Math.round((P / (188.9 * T_K)) * 10000) / 10000;
        },
        legendA: "#dcd2f5", legendB: "#d73c14",
        description: "Atmospheric density ρ = P / (R·T). Densest in Hellas Basin (~0.033 kg/m³), thinnest at Olympus Mons (~0.003 kg/m³).",
      },
      sound_speed: {
        label: "Speed of Sound", unit: "m/s", min: 196, max: 252,
        stops: [[10,20,130],[20,60,210],[40,145,205],[80,200,150],[200,220,50],[240,200,10]],
        compute: (_lat, elev) => {
          const T_K = (-20 - 2.5 * (elev / 1000)) + 273.15;
          return Math.round(Math.sqrt(1.289 * 188.9 * T_K));
        },
        legendA: "#140a82", legendB: "#f0c800",
        description: "Speed of sound c = √(γRT) in the CO₂ atmosphere. Varies with temperature; relevant to InSight seismic wave propagation.",
      },
      co2_frost: {
        label: "CO₂ Frost Probability", unit: "", min: 0, max: 1,
        stops: [[5,5,15],[15,20,80],[30,60,175],[80,155,225],[180,225,250],[245,250,255]],
        compute: (lat, _elev) => {
          const latRad = lat * Math.PI / 180;
          const T_mean = -20 - 80 * Math.sin(latRad) ** 2 - 2.5 * (_elev / 1000);
          const amp = 30 * Math.sin(latRad) ** 2 + 10;
          const T_winter = T_mean - amp;
          return Math.round(Math.max(0, Math.min(1, (-120 - T_winter) / 25)) * 100) / 100;
        },
        legendA: "#05050f", legendB: "#f5faff",
        description: "Probability of seasonal CO₂ frost formation. Frost occurs where the winter minimum temperature drops below −120 °C; confined to high latitudes.",
      },
      slope: {
        label: "Slope Gradient", unit: "°", min: 0, max: 25,
        stops: [[30,180,50],[120,215,40],[220,215,30],[240,140,20],[200,50,20],[120,10,10]],
        compute: null,
        legendA: "#1eb432", legendB: "#780a0a",
        description: "Terrain slope magnitude derived from the elevation model. Steepest at Olympus Mons escarpment, Valles Marineris walls, and large crater rims.",
      },
      roughness: {
        label: "Terrain Roughness", unit: "m", min: 0, max: 400,
        stops: [[20,30,120],[30,100,210],[40,190,160],[200,220,60],[240,130,20],[180,20,20]],
        compute: null,
        legendA: "#141e78", legendB: "#b41414",
        description: "Local elevation standard deviation over ~90 km windows. Smooth plains (Amazonis, Hellas floor) are blue; heavily cratered and fractured terrain is red.",
      },
      ice_depth: {
        label: "Permafrost Thickness", unit: "m", min: 0, max: 500,
        stops: [[200,140,60],[160,95,40],[80,70,130],[40,40,190],[20,20,150],[10,10,75]],
        compute: (_lat, elev) => {
          const latRad = _lat * Math.PI / 180;
          const T_C = -20 - 80 * Math.sin(latRad) ** 2 - 2.5 * (elev / 1000);
          return Math.round(Math.max(0, -T_C / 0.25));
        },
        legendA: "#c88c3c", legendB: "#0a0a4b",
        description: "Depth to the 0 °C isotherm, using a geothermal gradient of 0.25 K/m (Q=25 mW/m², k=0.1 W/m/K). Deepest at the cold poles, shallowest in the warm equatorial belt.",
      },
      dust_devil: {
        label: "Dust Devil Susceptibility", unit: "", min: 10, max: 220,
        stops: [[10,60,185],[30,160,155],[180,215,40],[240,155,20],[205,35,20],[120,10,10]],
        compute: (lat, elev) => {
          const latRad = lat * Math.PI / 180;
          const DR = 80 * Math.cos(latRad) ** 2 + 20 + elev / 3000;
          const P = 636 * Math.exp(-elev / 11100);
          return Math.round(DR * Math.sqrt(636 / P));
        },
        legendA: "#0a3cb9", legendB: "#780a0a",
        description: "Convective instability index proportional to diurnal range / √pressure. Peaks at equatorial highlands where heating is intense and the atmosphere is thin.",
      },
      landing_score: {
        label: "Landing Zone Score", unit: "/100", min: 0, max: 80,
        stops: [[150,20,20],[200,80,20],[225,185,20],[90,200,50],[40,200,85],[20,160,120]],
        compute: null,
        legendA: "#960a0a", legendB: "#14c850",
        description: "Composite landing suitability: low slope, adequate pressure (≥400 Pa for parachute assist), and low wind. High scores indicate safer candidate sites.",
      },
      solar_output: {
        label: "Solar Panel Output", unit: "W/m²", min: 0, max: 155,
        stops: [[10,5,30],[30,10,105],[100,30,185],[220,125,30],[255,200,50],[255,252,200]],
        compute: (lat, elev) => {
          const latRad = lat * Math.PI / 180;
          const cosLat = Math.max(Math.cos(latRad), 0.03);
          const P = 636 * Math.exp(-elev / 11100);
          const tau = 0.5 * P / 636;
          return Math.round(590 * cosLat * Math.exp(-tau / cosLat) * 0.28);
        },
        legendA: "#0a0520", legendB: "#fffcc8",
        description: "Estimated electrical output for a horizontal solar panel (28% efficiency). Attenuated by atmospheric dust column depth; best at equatorial highlands.",
      },
      brine_stability: {
        label: "Brine Stability Fraction", unit: "", min: 0, max: 0.9,
        stops: [[10,5,20],[25,15,80],[20,80,185],[30,160,220],[100,220,235],[225,248,255]],
        compute: (lat, elev) => {
          const latRad = lat * Math.PI / 180;
          const T_mean = -20 - 80 * Math.sin(latRad) ** 2 - 2.5 * (elev / 1000);
          const A = Math.max((80 * Math.cos(latRad) ** 2 + 20 + elev / 3000) / 2, 0.01);
          const T_FREEZE = -60, T_BOIL = 10;
          const sFreeze = Math.max(-1, Math.min(1, (T_FREEZE - T_mean) / A));
          const fAboveFreeze = Math.max(0, 0.5 - Math.asin(sFreeze) / Math.PI);
          const T_max = T_mean + A;
          let fAboveBoil = 0;
          if (T_max > T_BOIL) {
            const sBoil = Math.max(-1, Math.min(1, (T_BOIL - T_mean) / A));
            fAboveBoil = Math.max(0, 0.5 - Math.asin(sBoil) / Math.PI);
          }
          return Math.round(Math.max(0, fAboveFreeze - fAboveBoil) * 100) / 100;
        },
        legendA: "#0a0514", legendB: "#e1f8ff",
        description: "Fraction of the Martian day when near-surface temperatures permit liquid calcium-perchlorate brines (−60 °C to +10 °C). Highest at mid-latitudes where the daily swing is centred within the stability window.",
      },
      magnetic_shielding: {
        label: "Magnetic Shielding", unit: "", min: 0, max: 1,
        stops: [[200,30,20],[220,110,20],[200,200,30],[50,185,130],[20,90,210],[10,20,120]],
        compute: null,
        legendA: "#c81e14", legendB: "#0a1478",
        description: "Crustal magnetic anomaly shielding proxy derived from the NASA/JPL global magnetic field map. Strong anomalies in the Southern Highlands deflect some cosmic rays, providing up to ~25% reduction in radiation dose.",
      },
      habitability: {
        label: "Human Habitability Score", unit: "/100", min: 0, max: 86,
        stops: [[10,5,10],[110,20,15],[195,75,15],[215,190,20],[80,205,50],[30,220,145]],
        compute: null,
        legendA: "#0a050a", legendB: "#1edc91",
        description: "Composite human habitability index: geometric mean of pressure, radiation (magnetically corrected), temperature, solar power, terrain flatness, and permafrost water access. A geometric mean ensures no single poor factor can be offset by others.",
      },
    };

    function scMapColor(param, value) {
      const t = Math.max(0, Math.min(1, (value - param.min) / (param.max - param.min)));
      const stops = param.stops;
      const pos = t * (stops.length - 1);
      const i = Math.min(Math.floor(pos), stops.length - 2);
      const f = pos - i;
      const a = stops[i], b = stops[i + 1];
      return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
    }

    let activePopupFeature = null;
    let activePopupIsCoreLabel = false;
    const coreViewSection = document.getElementById("core-view-section");
    let selectedGeologyOutline = null;
    let selectedLabelEntry = null;
    let selectedLabelEntryIsSurface = false;
    let selectedLabelEntryIsCore = false;
    let syncSelectionHalo = null;
    // Geology floating popup
    const geoPopup = document.getElementById("geo-popup");
    const geoPopupClose = document.getElementById("geo-popup-close");
    const geoPopupKicker = document.getElementById("geo-popup-kicker");
    const geoPopupTitle = document.getElementById("geo-popup-title");
    const geoPopupMeta = document.getElementById("geo-popup-meta");
    const geoPopupCopy = document.getElementById("geo-popup-copy");
    const geoPopupDetail = document.getElementById("geo-popup-detail");
    const geoPopupAnchor = document.getElementById("geo-popup-anchor");
    let activeGeoPopupFeature = null;
    let activeGeoPopupLocalPos = null;   // THREE.Vector3 in Mars body-local space (unspun)
    let selectedGeologyBoundaryGroup = null;
    let lastTimestamp = 0;
    let activeSearchResults = [];
    let activeSearchIndex = -1;
    let viewerCamera = null;
    let viewerControls = null;
    let _resetMeasurementOnContextSwitch = null; // set by init(); bridged so deactivate/activateMoonViewer can clear measurements
    let activeMoonViewerFeature = null;
    let moonFeatureTypeFilter = "all";
    let activeMoonFeatureTour = null;
    let activeMoonFeatureSearchResults = [];
    let activeMoonFeatureSearchIndex = -1;
    let venusSceneGroup = null;
    let venusGlobeRef = null;   // set by init(); bridged so module-level openGeoPopup can access globe rotation
    let moonLayer = null;

    function getMoonOccluders() {
      if (!venusSceneGroup || !Array.isArray(moonData) || moonData.length === 0) return [];
      const scale = venusSceneGroup.scale;
      const radiusScale = Math.max(Math.abs(scale.x || 1), Math.abs(scale.y || 1), Math.abs(scale.z || 1));
      const OCCLUDER_BUFFER = 1.55;
      if (moonLayer && Array.isArray(moonLayer.entries) && moonLayer.entries.length > 0) {
        return moonLayer.entries.map((entry) => {
          const center = new THREE.Vector3();
          entry.moonMesh.getWorldPosition(center);
          return { name: entry.item.name, center, radius: entry.moonRadius * radiusScale * OCCLUDER_BUFFER };
        });
      }
      return moonData.filter((item) => Array.isArray(item.moon_anchor)).map((item) => ({
        name: item.name,
        center: venusSceneGroup.localToWorld(new THREE.Vector3(item.moon_anchor[0], item.moon_anchor[1], item.moon_anchor[2])),
        radius: Number(item.moon_radius || 0.1) * radiusScale * OCCLUDER_BUFFER,
      }));
    }

    function _isPointOccludedByMoonOccluder(pointWorld, camera, occluder) {
      const segment = pointWorld.clone().sub(camera.position);
      const segmentLength = segment.length();
      if (segmentLength <= 1e-5) return false;
      const direction = segment.clone().divideScalar(segmentLength);
      const offset = camera.position.clone().sub(occluder.center);
      const b = 2 * offset.dot(direction);
      const c = offset.lengthSq() - (occluder.radius * occluder.radius);
      const discriminant = (b * b) - (4 * c);
      if (discriminant <= 0) return false;
      const root = Math.sqrt(discriminant);
      const near = (-b - root) * 0.5;
      const far = (-b + root) * 0.5;
      const epsilon = 1e-4;
      return (near > epsilon && near < segmentLength - epsilon)
        || (far > epsilon && far < segmentLength - epsilon);
    }

    function isPointOccludedByAnyMoon(pointWorld, camera, ignoredMoonName = null) {
      for (const occluder of getMoonOccluders()) {
        if (ignoredMoonName && occluder.name === ignoredMoonName) continue;
        if (_isPointOccludedByMoonOccluder(pointWorld, camera, occluder)) return true;
      }
      return false;
    }

    let gisBases = [];
    const saturnViewModeSelect = null; // Mars has no tilted/untilted toggle
    let spinPaused = false;
    let spinPauseStart = 0;
    let spinOffset = 0;
    const spinToggleBtn = document.getElementById("spin-toggle");
    const spinToggleGlyph = document.getElementById("spin-toggle-glyph");
    const freezeViewToggleBtn = document.getElementById("freeze-view-toggle");
    let freezeViewActive = false;
    let freezeViewWasPaused = false;
    function applyFreezeViewState() {
      if (!viewerControls) return;
      viewerControls.enabled = !freezeViewActive;
      viewerControls.enableRotate = !freezeViewActive;
      viewerControls.enableZoom = !freezeViewActive;
      viewerControls.enablePan = !freezeViewActive;
      if (freezeViewToggleBtn) {
        freezeViewToggleBtn.classList.toggle("is-active", freezeViewActive);
        freezeViewToggleBtn.title = freezeViewActive ? "Unfreeze view" : "Freeze view";
      }
      if (freezeViewActive) {
        freezeViewWasPaused = spinPaused;
        pauseSpin();
      } else if (!freezeViewWasPaused && !spinIsLocked()) {
        resumeSpin();
      }
    }
    function syncSpinToggleBtn() {
      if (!spinToggleBtn) return;
      const spinLocked = spinIsLocked();
      spinToggleBtn.classList.toggle("is-locked", spinLocked);
      if (spinPaused) {
        spinToggleBtn.title = "Resume rotation";
        spinToggleBtn.setAttribute("aria-label", "Resume rotation");
        spinToggleBtn.classList.add("is-paused");
      } else {
        spinToggleBtn.title = "Pause rotation";
        spinToggleBtn.setAttribute("aria-label", "Pause rotation");
        spinToggleBtn.classList.remove("is-paused");
      }
    }
    function getSpinTime() {
      return spinPaused ? (spinPauseStart - spinOffset) : (performance.now() - spinOffset);
    }
    function pauseSpin() {
      if (!spinPaused) {
        spinPaused = true;
        spinPauseStart = performance.now();
        syncSpinToggleBtn();
      }
    }
    function resumeSpin() {
      if (spinPaused) {
        spinOffset += performance.now() - spinPauseStart;
        spinPaused = false;
        syncSpinToggleBtn();
      }
    }
    if (spinToggleBtn) {
      spinToggleBtn.addEventListener("click", () => {
        if (spinIsLocked()) {
          return;
        }
        if (spinPaused) { resumeSpin(); } else { pauseSpin(); }
      });
    }
    if (freezeViewToggleBtn) {
      freezeViewToggleBtn.addEventListener("click", () => {
        freezeViewActive = !freezeViewActive;
        applyFreezeViewState();
      });
    }
    document.addEventListener("keydown", (event) => {
      if (event.code !== "Space") { return; }
      // ...unless someone is typing. This handler swallows the space and blurs
      // the focused element, so a space typed into any text field vanished and
      // the field lost focus -- a project description could only ever be one
      // word long. Checkboxes, buttons and sliders keep the old behaviour:
      // there the point is that space pauses the globe rather than re-firing
      // whatever was last clicked.
      const focused = document.activeElement;
      if (focused) {
        const tag = focused.tagName;
        const typing = focused.isContentEditable
          || tag === "TEXTAREA"
          || (tag === "INPUT" && !/^(checkbox|radio|button|submit|reset|range|file|color)$/i
            .test(focused.type || "text"));
        if (typing) { return; }
      }
      // Always intercept space so it never activates whatever UI element last had focus.
      event.preventDefault();
      // Blur the active element so repeated space presses don't accumulate on a control.
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      if (spinIsLocked()) {
        return;
      }
      if (spinPaused) { resumeSpin(); } else { pauseSpin(); }
    });
    const DEFAULT_CONTROL_MIN_DISTANCE = 3.7;
    const DEFAULT_CONTROL_MAX_DISTANCE = 80;
    // Predefined camera distances for CTX mosaic stepped zoom (far → near).
    // Each step cleanly maps to one ESRI tile level so tiles load once and stay stable.
    const CTX_ZOOM_STEPS = [60, 26, 14, 8.5, 5.8, 4.4, 3.7, 3.42, 3.30, 3.24, 3.215, 3.205, 3.202, 3.2008, 3.2005, 3.2002, 3.2001, 3.20005, 3.20002];
    let _ctxZoomStepIdx = 0;
    let _ctxZoomAnimTarget = null;
    let _ctxZoomAnimFrom = null;
    let _ctxZoomAnimStart = null;
    const CTX_ZOOM_ANIM_MS = 450;
    const DEFAULT_CAMERA_POSITION = Object.freeze({ x: 0, y: 1.4, z: 11.5 });
    const MOON_VIEWER_TEXTURES = {
      "Phobos": "assets/phobos_color_map.jpg",
      "Deimos": "assets/deimos_color_map.jpg",
    };
    let currentMetadataState = null;
    const VENUS_MEAN_RADIUS_KM = 6051.8;
    let activeCutClipPlane = null;
    const REGION_MASK_DEFS = {
      "volcanic-provinces": [
        { lat: 7, lon: 247, radiusDeg: 28, color: "rgba(255,96,76,0.78)" },
        { lat: 24, lon: 147, radiusDeg: 16, color: "rgba(255,112,82,0.78)" },
        { lat: 9, lon: 67, radiusDeg: 13, color: "rgba(255,126,88,0.78)" },
      ],
      basins: [
        { lat: -42.4, lon: 70.5, radiusDeg: 18, color: "rgba(84,166,255,0.76)" },
        { lat: 13.9, lon: 88.4, radiusDeg: 12, color: "rgba(104,186,255,0.76)" },
        { lat: 46.7, lon: 117.5, radiusDeg: 18, color: "rgba(84,166,255,0.76)" },
        { lat: -49.8, lon: 316.7, radiusDeg: 14, color: "rgba(104,186,255,0.76)" },
      ],
    };

    const CORE_LAYER_DATA = [
      {
        id: "crust",
        name: "Crust",
        type: "Lithospheric shell",
        description: "Thin basaltic outer shell, thinnest under the great volcanic plains and thickest under the ancient southern highlands.",
        depth: "0 – 50 km (avg); up to ~80 km in highlands",
        composition: "Iron-rich basaltic silicates: pyroxene, olivine, plagioclase. More volatile-rich than Earth's crust.",
        temperature: "~200°C at surface → ~1,000°C at base",
        labelX: -1.6, labelY: 3.17,
        anchorY: 3.17,
      },
      {
        id: "mantle",
        name: "Mantle",
        type: "Silicate shell",
        description: "A thick shell of iron-rich silicate rock. Venus lacks active plate tectonics, so heat escapes slowly through a thick, immobile lithosphere rather than at spreading centres. Much of the easily melted mantle source appears to be depleted relative to early Venus, helping explain why large-scale magma production is now limited and volcanism is far less vigorous than in the past.",
        depth: "50 – ~1,700 km depth",
        composition: "Iron-rich peridotite and pyroxenite. More Fe-rich than Earth's mantle, but many shallow-to-mid mantle source regions are thought to be melt-depleted after long-term volcanic extraction; only localized deeper domains may still retain enough heat and volatiles for partial melting.",
        temperature: "~1,000°C near crust → ~1,500°C near core",
        labelX: -2.2, labelY: 2.2,
        anchorY: 2.2,
      },
      {
        id: "outer-core",
        name: "Liquid Outer Core",
        type: "Iron-sulfur fluid",
        description: "InSight seismic data (2021) confirmed a single large liquid iron core of ~1,830 km radius — larger than expected and kept liquid by its high sulfur and lighter-element content.",
        depth: "~1,700 km depth to centre (~1,830 km radius)",
        composition: "Liquid iron-sulfur alloy with O, H, and C. High sulfur content depresses the melting point.",
        temperature: "~1,400 – 2,200°C",
        labelX: -1.6, labelY: 1.25,
        anchorY: 1.25,
      },
      {
        id: "inner-core",
        name: "Inner Core",
        type: "Deep interior (uncertain)",
        description: "Whether Mars has a solid inner core is unconfirmed. InSight seismic data is ambiguous; low seismic activity limits deep-interior resolution.",
        depth: "0 – ~300 km from centre (estimated)",
        composition: "Possibly denser iron-nickel alloy, or fully molten. State and exact composition remain unknown.",
        temperature: "~2,000 – 2,400°C (estimated)",
        labelX: -1.0, labelY: 0,
        anchorY: 0,
      },
    ];

    const DEFAULT_STATUS_TEXT = "\u00a9 2026 GeoID: Explorer. The GeoID Initiative, led by Owen McCluskey. All rights reserved.";

    function setStatus(message, isError = false) {
      statusNode.textContent = message;
      statusNode.classList.toggle("is-error", isError);
    }

    function resetStatus() {
      setStatus(DEFAULT_STATUS_TEXT);
    }

    async function withTimeout(task, timeoutMs, timeoutMessage) {
      let timeoutId = null;
      try {
        return await Promise.race([
          task(),
          new Promise((_, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
          }),
        ]);
      } finally {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
      }
    }

    function fetchWithTimeout(resource, options = {}, timeoutMs = 4000) {
      return withTimeout(
        () => fetch(resource, options),
        timeoutMs,
        `Timed out loading ${resource}`,
      );
    }

    function loadTextureSafe(textureLoader, path) {
      return textureLoader.loadAsync(path).catch((error) => {
        console.warn(`Texture load failed for ${path}`, error);
        return null;
      });
    }

    async function loadJsonSafe(path) {
      if (!path) {
        return null;
      }
      try {
        const response = await fetchWithTimeout(path, { cache: "no-store" }, 4000);
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return await response.json();
      } catch (error) {
        console.warn(`JSON load failed for ${path}`, error);
        return null;
      }
    }

    const CTX_SERVICE_CANDIDATES = [
      {
        name: "CTX",
        serviceUrl: "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer",
      },
      {
        name: "CTX1",
        serviceUrl: "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer",
      },
    ];

    function isLocalCtxProxyHost(hostname) {
      return hostname === "localhost"
        || hostname === "127.0.0.1"
        || hostname === "0.0.0.0"
        || hostname === "[::1]";
    }

    function buildCtxCandidateConfigs() {
      const candidates = [];
      // Normalise 0.0.0.0 → localhost for outgoing proxy requests;
      // some browsers refuse TCP connections to 0.0.0.0 even when the page loaded from it.
      const origin = window.location.origin;
      const localProxyAllowed = isLocalCtxProxyHost(window.location.hostname);
      for (const candidate of CTX_SERVICE_CANDIDATES) {
        if (localProxyAllowed) {
          // Service-worker proxy route: intercepts /ctx-proxy/tile/ and translates
          // to direct ESRI requests without needing a server-side proxy handler.
          candidates.push({
            ...candidate,
            serviceUrl: `${origin}/ctx-proxy/service?name=${candidate.name}`,
            tileBase: `${origin}/ctx-proxy/tile/${candidate.name}`,
            sourceServiceUrl: candidate.serviceUrl,
            viaProxy: true,
          });
          // Direct ESRI URL as fallback for the first page load before the
          // service worker has activated, or if SW registration fails.
        }
        candidates.push({
          ...candidate,
          serviceUrl: `${candidate.serviceUrl}?f=json`,
          tileBase: `${candidate.serviceUrl}/tile`,
          sourceServiceUrl: candidate.serviceUrl,
          viaProxy: false,
        });
      }
      return candidates;
    }

    async function probeCtxTileStatus(tileBase, probeLevel = 0, probeRow = 0, probeCol = 0) {
      try {
        const response = await fetchWithTimeout(`${tileBase}/${probeLevel}/${probeRow}/${probeCol}`, {
          cache: "no-store",
          mode: "cors",
        }, 3000);
        const contentType = String(response.headers.get("Content-Type") || "").toLowerCase();
        const upstreamStatus = Number(response.headers.get("X-CTX-Upstream-Status") || response.status || 0);
        return {
          ok: response.ok && (contentType.startsWith("image/") || !contentType.includes("json")),
          httpStatus: response.status || 0,
          upstreamStatus,
          contentType,
        };
      } catch (_) {
        return {
          ok: false,
          httpStatus: 0,
          upstreamStatus: 0,
          contentType: "",
        };
      }
    }

    async function discoverCtxWorkingMaxLevel(tileBase, advertisedMaxLevel) {
      let highestWorkingLevel = Math.max(0, Math.min(12, advertisedMaxLevel));
      for (let level = Math.max(13, highestWorkingLevel + 1); level <= advertisedMaxLevel; level += 1) {
        const probe = await probeCtxTileStatus(tileBase, level, 0, 0);
        if ((probe.upstreamStatus || probe.httpStatus) >= 400 || (!probe.ok && probe.httpStatus === 0)) {
          break;
        }
        if (probe.ok) {
          highestWorkingLevel = level;
        }
      }
      return highestWorkingLevel;
    }

    function getFallbackCtxServiceConfig() {
      const fallbackCandidate = buildCtxCandidateConfigs()[0];
      window.__ctxDebug = {
        ...(window.__ctxDebug || {}),
        source: fallbackCandidate?.viaProxy ? "proxy" : "direct",
        serviceName: fallbackCandidate?.name || "CTX",
        serviceUrl: fallbackCandidate?.serviceUrl || "",
        tileBase: fallbackCandidate?.tileBase || "",
        sourceServiceUrl: fallbackCandidate?.sourceServiceUrl || "",
        viaProxy: Boolean(fallbackCandidate?.viaProxy),
      };
      return {
        name: fallbackCandidate.name,
        serviceUrl: fallbackCandidate.serviceUrl,
        tileBase: fallbackCandidate.tileBase,
        sourceServiceUrl: fallbackCandidate.sourceServiceUrl,
        viaProxy: fallbackCandidate.viaProxy,
        metadata: null,
        minAvailableLevel: 0,
        maxAvailableLevel: 12,
        minLevel: 3,
        backgroundMaxLevel: 8,
        focusMaxLevel: 12,
      };
    }

    async function doProbeCtxServiceConfig() {
      const candidates = buildCtxCandidateConfigs();
      for (const candidate of candidates) {
        try {
          const response = await fetchWithTimeout(candidate.serviceUrl, { cache: "no-store" }, 3000);
          if (!response.ok) {
            continue;
          }
          const metadata = await response.json();
          const lods = Array.isArray(metadata?.tileInfo?.lods) ? metadata.tileInfo.lods : [];
          const levels = lods
            .map((lod) => Number(lod?.level))
            .filter((level) => Number.isFinite(level))
            .sort((a, b) => a - b);
          if (!levels.length) {
            continue;
          }
          const minAvailableLevel = levels[0];
          const maxAvailableLevel = levels[levels.length - 1];
          if (candidate.viaProxy) {
            const proxyProbe = await probeCtxTileStatus(candidate.tileBase, minAvailableLevel, 0, 0);
            if (!proxyProbe.ok && (proxyProbe.upstreamStatus || proxyProbe.httpStatus) >= 500) {
              continue;
            }
          }
          // Only probe tile levels for proxy candidates — direct ArcGIS URLs are
          // CORS-blocked for tiles on most origins and would just generate console errors.
          const discoveredMaxLevel = candidate.viaProxy
            ? await discoverCtxWorkingMaxLevel(candidate.tileBase, maxAvailableLevel)
            : maxAvailableLevel;
          const workingMaxLevel = Math.max(minAvailableLevel, Math.min(maxAvailableLevel, discoveredMaxLevel));
          const preferredMinLevel = Math.max(minAvailableLevel, Math.min(3, maxAvailableLevel));
          window.__ctxDebug = {
            ...(window.__ctxDebug || {}),
            source: candidate.viaProxy ? "proxy" : "direct",
            serviceName: candidate.name,
            serviceUrl: candidate.serviceUrl,
            tileBase: candidate.tileBase,
            sourceServiceUrl: candidate.sourceServiceUrl,
            viaProxy: candidate.viaProxy,
            advertisedMaxLevel: maxAvailableLevel,
            workingMaxLevel,
            discoveredMaxLevel,
          };
          return {
            name: candidate.name,
            serviceUrl: candidate.serviceUrl,
            tileBase: candidate.tileBase,
            sourceServiceUrl: candidate.sourceServiceUrl,
            viaProxy: candidate.viaProxy,
            metadata,
            minAvailableLevel,
            maxAvailableLevel: workingMaxLevel,
            minLevel: preferredMinLevel,
            // Let the global canvas refine further so visible high-resolution imagery
            // still appears even if the draped detail-tile path is not yet complete.
            backgroundMaxLevel: Math.max(preferredMinLevel, Math.min(10, workingMaxLevel)),
            focusMaxLevel: workingMaxLevel,
          };
        } catch (_) {
          // Try the next candidate endpoint.
        }
      }

      return getFallbackCtxServiceConfig();
    }

    async function loadCtxServiceConfig() {
      const CACHE_KEY = `geoid-ctx-cfg:${window.location.pathname}`;
      const TTL = 24 * 60 * 60 * 1000; // 24 h
      try {
        const stored = localStorage.getItem(CACHE_KEY);
        if (stored) {
          const { ts, config } = JSON.parse(stored);
          if (Date.now() - ts < TTL) {
            // Serve cached config instantly; silently refresh in the background.
            setTimeout(async () => {
              try {
                const fresh = await doProbeCtxServiceConfig();
                localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), config: fresh }));
              } catch (_) {}
            }, 8000);
            return config;
          }
        }
      } catch (_) {}
      // First visit or stale cache — probe live, then save result.
      const config = await doProbeCtxServiceConfig();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), config })); } catch (_) {}
      return config;
    }

    async function loadImageDataSafe(path) {
      if (!path) {
        return null;
      }
      try {
        const image = new Image();
        image.decoding = "async";
        image.src = path;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      } catch (error) {
        console.warn(`Image-data load failed for ${path}`, error);
        return null;
      }
    }

    function describeLayer(layer) {
      if (!layer) {
        return "No active layer metadata available.";
      }
      const parts = [layer.description];
      if (layer.source_page_url) {
        parts.push(`Source page: ${layer.source_page_url}`);
      }
      return parts.join(" ");
    }

    function decodeFeatureId(pixelState, x, y) {
      if (!pixelState || !pixelState.pixels) {
        return 0;
      }
      const clampedX = Math.max(0, Math.min(pixelState.width - 1, x));
      const clampedY = Math.max(0, Math.min(pixelState.height - 1, y));
      const index = ((clampedY * pixelState.width) + clampedX) * 4;
      return (
        pixelState.pixels[index]
        + (pixelState.pixels[index + 1] << 8)
        + (pixelState.pixels[index + 2] << 16)
      );
    }

    function normalizeLongitudeDegrees(lonDegrees) {
      return (((lonDegrees % 360) + 540) % 360) - 180;
    }

    function wrapLongitudeAround(referenceLon, lonDegrees) {
      return referenceLon + normalizeLongitudeDegrees(lonDegrees - referenceLon);
    }

    function pointInRing(lonDegrees, latDegrees, ring) {
      let inside = false;
      if (!Array.isArray(ring) || ring.length < 3) {
        return false;
      }
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const xi = wrapLongitudeAround(lonDegrees, Number(ring[i][0]));
        const yi = Number(ring[i][1]);
        const xj = wrapLongitudeAround(lonDegrees, Number(ring[j][0]));
        const yj = Number(ring[j][1]);
        const intersects = ((yi > latDegrees) !== (yj > latDegrees))
          && (lonDegrees < (((xj - xi) * (latDegrees - yi)) / ((yj - yi) || 1e-9)) + xi);
        if (intersects) {
          inside = !inside;
        }
      }
      return inside;
    }

    function pointInPolygonFeature(lonDegrees, latDegrees, feature) {
      if (!feature || !Array.isArray(feature.polygons)) {
        return false;
      }
      for (const polygon of feature.polygons) {
        if (!polygon || !Array.isArray(polygon.outer) || !pointInRing(lonDegrees, latDegrees, polygon.outer)) {
          continue;
        }
        const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
        let inHole = false;
        for (const hole of holes) {
          if (pointInRing(lonDegrees, latDegrees, hole)) {
            inHole = true;
            break;
          }
        }
        if (!inHole) {
          return true;
        }
      }
      return false;
    }

    function pointWithinFeatureBounds(lonDegrees, latDegrees, feature) {
      const bounds = feature?.selection_bounds;
      if (!bounds) {
        return true;
      }
      if (latDegrees < Number(bounds.lat_min) || latDegrees > Number(bounds.lat_max)) {
        return false;
      }
      const lonOffset = normalizeLongitudeDegrees(lonDegrees - Number(bounds.lon_center));
      return lonOffset >= Number(bounds.lon_min_offset) && lonOffset <= Number(bounds.lon_max_offset);
    }

    function sampleGeologyRasterAtLatLon(latDegrees, lonDegrees, geologyInteractiveState) {
      const { samplerCtx, samplerWidth, samplerHeight, unit_legend, rock_legend } = geologyInteractiveState;
      if (!samplerCtx) return null;
      const px = Math.max(0, Math.min(samplerWidth - 1, Math.floor((lonDegrees / 360) * samplerWidth)));
      const py = Math.max(0, Math.min(samplerHeight - 1, Math.floor(((90 - latDegrees) / 180) * samplerHeight)));
      const d = samplerCtx.getImageData(px, py, 1, 1).data;
      const sr = d[0], sg = d[1], sb = d[2];
      // Transparent/black pixel = unmapped area
      if (d[3] < 10 || (sr < 5 && sg < 5 && sb < 5)) return null;
      let bestEntry = null, bestDist = Infinity;
      for (const entry of (unit_legend || [])) {
        const c = entry.color;
        const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
        const dist = Math.sqrt((sr - r) ** 2 + (sg - g) ** 2 + (sb - b) ** 2);
        if (dist < bestDist) { bestDist = dist; bestEntry = entry; }
      }
      if (!bestEntry || bestDist > 45) return null;
      const rockEntry = (rock_legend || []).find((r) => r.rock_type === bestEntry.rock_type);
      return {
        type: "Geologic unit",
        name: bestEntry.unit,
        unit: bestEntry.unit,
        description: bestEntry.description,
        rock_type: bestEntry.rock_type,
        rock_type_detail: rockEntry?.description || null,
        mapped_area_km2: rockEntry?.mapped_area_km2 || bestEntry.mapped_area_km2 || null,
        lat: latDegrees,
        lon: lonDegrees,
        _fromRaster: true,
      };
    }

    function getGeologyFeatureAtLatLon(latDegrees, lonDegrees, geologyInteractiveState) {
      if (!geologyInteractiveState) {
        return null;
      }
      const featureList = geologyInteractiveState.featureList || [];
      const feature = featureList.find((candidate) => (
        pointWithinFeatureBounds(lonDegrees, latDegrees, candidate)
        && pointInPolygonFeature(lonDegrees, latDegrees, candidate)
      ));
      if (feature) {
        return { ...feature, lat: latDegrees, lon: lonDegrees };
      }
      return sampleGeologyRasterAtLatLon(latDegrees, lonDegrees, geologyInteractiveState);
    }

    function getGeologyFeatureAtPoint(point, geologyInteractiveState) {
      if (!geologyInteractiveState || !geologyToggle.checked) {
        return null;
      }
      const latLon = vectorToLatLon(point);
      return getGeologyFeatureAtLatLon(latLon.lat, latLon.lon, geologyInteractiveState);
    }

    function createGeologyOutlineState(THREERef, geometryState) {
      if (!geometryState || !geometryState.width || !geometryState.height) {
        return null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = geometryState.width;
      canvas.height = geometryState.height;
      const context = canvas.getContext("2d");
      const texture = new THREERef.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      return {
        width: geometryState.width,
        height: geometryState.height,
        canvas,
        context,
        texture,
        featureId: "",
      };
    }

    function traceGeologyRing(context, ring, referenceLon, shiftX, width, height) {
      if (!Array.isArray(ring) || ring.length < 2) {
        return;
      }
      const baseX = (((referenceLon - 180) / 360) * width) + shiftX;
      ring.forEach((pair, index) => {
        const lon = wrapLongitudeAround(referenceLon, Number(pair[0]));
        const lat = Number(pair[1]);
        const x = baseX + (((lon - referenceLon) / 360) * width);
        const y = latToTextureV(lat) * height;
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.closePath();
    }

    function paintSelectedGeologyOutline(outlineState, feature) {
      if (!outlineState) {
        return false;
      }
      const context = outlineState.context;
      context.clearRect(0, 0, outlineState.width, outlineState.height);
      if (!feature || !Array.isArray(feature.polygons) || !feature.polygons.length) {
        outlineState.texture.needsUpdate = true;
        outlineState.featureId = "";
        return false;
      }
      if (outlineState.featureId === String(feature.id || "")) {
        return true;
      }
      const referenceLon = Number(feature.anchor_lon ?? feature.lon ?? 180);
      const shifts = [-outlineState.width, 0, outlineState.width];
      context.lineJoin = "round";
      context.lineCap = "round";
      for (const polygon of feature.polygons) {
        for (const shift of shifts) {
          context.beginPath();
          traceGeologyRing(context, polygon.outer, referenceLon, shift, outlineState.width, outlineState.height);
          for (const hole of polygon.holes || []) {
            traceGeologyRing(context, hole, referenceLon, shift, outlineState.width, outlineState.height);
          }
          context.fillStyle = "rgba(255, 196, 64, 0.22)";
          context.fill("evenodd");
          context.strokeStyle = "rgba(255, 232, 162, 0.96)";
          context.lineWidth = 5;
          context.stroke();
          context.strokeStyle = "rgba(255, 149, 62, 0.94)";
          context.lineWidth = 2.4;
          context.stroke();
        }
      }
      outlineState.texture.needsUpdate = true;
      outlineState.featureId = String(feature.id || "");
      return true;
    }

    function buildGeologyVectorLayer(THREERef, entries, radius, elevationSampler, elevationCache, getTerrainRelief, lift, defaultOpacity, renderOrder = 108) {
      const group = new THREE.Group();
      const interactiveObjects = [];
      const materialCache = new Map();

      const interpolateWrappedLon = (startLon, endLon, t) => {
        let delta = endLon - startLon;
        if (delta > 180) {
          delta -= 360;
        } else if (delta < -180) {
          delta += 360;
        }
        return ((startLon + (delta * t)) % 360 + 360) % 360;
      };

      const densifySegment = (segment, maxStepDegrees = 0.3) => {
        if (!Array.isArray(segment) || segment.length < 2) {
          return [];
        }
        const densified = [];
        for (let index = 0; index < segment.length - 1; index += 1) {
          const [startLonRaw, startLatRaw] = segment[index];
          const [endLonRaw, endLatRaw] = segment[index + 1];
          const startLon = Number(startLonRaw);
          const startLat = Number(startLatRaw);
          const endLon = Number(endLonRaw);
          const endLat = Number(endLatRaw);
          const lonDeltaWrapped = Math.abs((((endLon - startLon) + 540) % 360) - 180);
          const latDelta = Math.abs(endLat - startLat);
          const steps = Math.max(1, Math.ceil(Math.max(lonDeltaWrapped, latDelta) / maxStepDegrees));
          if (index === 0) {
            densified.push([startLon, startLat]);
          }
          for (let step = 1; step <= steps; step += 1) {
            const t = step / steps;
            densified.push([
              interpolateWrappedLon(startLon, endLon, t),
              startLat + ((endLat - startLat) * t),
            ]);
          }
        }
        return densified;
      };

      const segmentToReliefPoints = (segment) => densifySegment(segment).map(([lon, lat]) => (
        getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, Number(lat), Number(lon), lift)
      ));

      const getMaterial = (color, opacity) => {
        const key = `${color}|${opacity}`;
        if (!materialCache.has(key)) {
          materialCache.set(
            key,
            new THREERef.LineBasicMaterial({
              color,
              transparent: true,
              opacity,
              depthWrite: false,
              depthTest: true,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
            }),
          );
        }
        return materialCache.get(key);
      };

      for (const entry of Array.isArray(entries) ? entries : []) {
        const segments = Array.isArray(entry.segments) ? entry.segments : [];
        for (const segment of segments) {
          if (!Array.isArray(segment) || segment.length < 2) {
            continue;
          }
          const points = segmentToReliefPoints(segment);
          const line = new THREERef.Line(
            new THREERef.BufferGeometry().setFromPoints(points),
            getMaterial(entry.color || "#ffffff", entry.opacity || defaultOpacity),
          );
          line.renderOrder = renderOrder;
          line.userData.feature = entry;
          line.userData.segment = segment;
          group.add(line);
          interactiveObjects.push(line);
        }
      }

      function rebuild() {
        for (const line of interactiveObjects) {
          const segment = line.userData.segment;
          if (!Array.isArray(segment) || segment.length < 2) {
            continue;
          }
          const points = segmentToReliefPoints(segment);
          line.geometry.dispose();
          line.geometry = new THREERef.BufferGeometry().setFromPoints(points);
        }
      }

      function setClippingPlanes(planes) {
        for (const material of materialCache.values()) {
          material.clippingPlanes = planes;
          material.needsUpdate = true;
        }
      }

      return { group, interactiveObjects, available: interactiveObjects.length > 0, rebuild, setClippingPlanes };
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function normalizeSeaLevelMeters(levelMeters) {
      const minMeters = Number(manifest.elevation?.min_m ?? -2886);
      const reliefMeters = Math.max(Number(manifest.elevation?.relief_m ?? 1), 1);
      return clamp((levelMeters - minMeters) / reliefMeters, 0, 1);
    }

    function createSeaOverlayTextureState(elevationTexture, samplerState = null) {
      let sourcePixels, overlayW, overlayH;
      if (samplerState) {
        sourcePixels = samplerState.pixels;
        overlayW = samplerState.width;
        overlayH = samplerState.height;
      } else {
        if (!elevationTexture || !elevationTexture.image) return null;
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = elevationTexture.image.width;
        sourceCanvas.height = elevationTexture.image.height;
        const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
        sourceContext.drawImage(elevationTexture.image, 0, 0);
        sourcePixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;
        overlayW = sourceCanvas.width;
        overlayH = sourceCanvas.height;
      }
      if (!sourcePixels) return null;

      // Overlay rendered at 1/4 source resolution — visually identical at globe scale,
      // saves ~62 MB vs full-res (overlayCanvas + overlayImage each ~2 MB instead of ~33 MB).
      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.width = Math.max(1, overlayW >> 2);
      overlayCanvas.height = Math.max(1, overlayH >> 2);
      const overlayContext = overlayCanvas.getContext("2d");
      const overlayImage = overlayContext.createImageData(overlayCanvas.width, overlayCanvas.height);
      const texture = new THREE.CanvasTexture(overlayCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;

      return {
        sourcePixels,
        sourceWidth: overlayW,
        sourceHeight: overlayH,
        overlayCanvas,
        overlayContext,
        overlayImage,
        texture,
        minMeters: Number(manifest.elevation?.min_m ?? -2886),
        reliefMeters: Math.max(Number(manifest.elevation?.relief_m ?? 1), 1),
      };
    }

    function updateSeaOverlayTexture(state, seaLevelMeters) {
      if (!state) {
        return;
      }
      const threshold = normalizeSeaLevelMeters(seaLevelMeters);
      const output = state.overlayImage.data;
      const source = state.sourcePixels;
      const srcW = state.sourceWidth;
      const outW = state.overlayCanvas.width;
      const outH = state.overlayCanvas.height;
      const scaleX = srcW / outW;
      const scaleY = state.sourceHeight / outH;
      const coastalBand = 0.012;
      const shallowBandMeters = 400;
      const deepBandMeters = 3200;
      for (let oy = 0; oy < outH; oy++) {
        const sy = Math.floor(oy * scaleY);
        for (let ox = 0; ox < outW; ox++) {
          const index = (oy * outW + ox) * 4;
          const elevationNorm = source[((sy * srcW) + Math.floor(ox * scaleX)) * 4] / 255;
          if (elevationNorm > threshold) {
            output[index] = 0;
            output[index + 1] = 0;
            output[index + 2] = 0;
            output[index + 3] = 0;
            continue;
          }
          const elevationMeters = state.minMeters + (elevationNorm * state.reliefMeters);
          const depthMeters = Math.max(0, seaLevelMeters - elevationMeters);
          const depthRatio = clamp(depthMeters / deepBandMeters, 0, 1);
          const shallowRatio = clamp(depthMeters / shallowBandMeters, 0, 1);
          const shorelineMix = clamp((coastalBand - (threshold - elevationNorm)) / coastalBand, 0, 1);
          const shelfMix = 1 - shallowRatio;
          const red = Math.round(
            (18 * depthRatio) +
            (42 * shelfMix) +
            (86 * shorelineMix)
          );
          const green = Math.round(
            62 +
            (72 * shelfMix) +
            (54 * shorelineMix) -
            (28 * depthRatio)
          );
          const blue = Math.round(
            128 +
            (80 * shelfMix) +
            (82 * depthRatio) +
            (36 * shorelineMix)
          );
          const alpha = Math.round(
            82 +
            (62 * depthRatio) +
            (36 * shallowRatio) +
            (48 * shorelineMix)
          );
          output[index] = red;
          output[index + 1] = green;
          output[index + 2] = blue;
          output[index + 3] = alpha;
        }
      }
      state.overlayContext.putImageData(state.overlayImage, 0, 0);
      state.texture.needsUpdate = true;
    }

    function createElevationSamplerState(elevationTexture) {
      if (!elevationTexture || !elevationTexture.image) {
        return null;
      }
      // Downsample to ½ linear resolution (¼ total pixels) — saves ~25 MB vs full-res.
      // Bilinear interpolation in sampleElevationNormalized keeps accuracy acceptable
      // for label positioning and terrain relief at globe scale.
      const srcW = elevationTexture.image.width;
      const srcH = elevationTexture.image.height;
      const width = Math.max(1, srcW >> 1);
      const height = Math.max(1, srcH >> 1);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(elevationTexture.image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      // canvas not returned — allows the backing store to be garbage collected.
      return { pixels, width, height };
    }

    function lonToTextureU(lonDegrees) {
      return (((((lonDegrees - 180) % 360) + 360) % 360) / 360);
    }

    function latToTextureV(latDegrees) {
      return clamp((90 - latDegrees) / 180, 0, 1);
    }

    function sampleElevationNormalized(state, latDegrees, lonDegrees) {
      if (!state) {
        return 0;
      }
      const u = lonToTextureU(lonDegrees);
      const v = latToTextureV(latDegrees);
      const x = u * (state.width - 1);
      const y = v * (state.height - 1);
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(state.width - 1, x0 + 1);
      const y1 = Math.min(state.height - 1, y0 + 1);
      const tx = x - x0;
      const ty = y - y0;
      const sampleAt = (sx, sy) => state.pixels[((sy * state.width) + sx) * 4] / 255;
      const n00 = sampleAt(x0, y0);
      const n10 = sampleAt(x1, y0);
      const n01 = sampleAt(x0, y1);
      const n11 = sampleAt(x1, y1);
      return (
        n00 * (1 - tx) * (1 - ty) +
        n10 * tx * (1 - ty) +
        n01 * (1 - tx) * ty +
        n11 * tx * ty
      );
    }

    function sampleElevationMeters(state, latDegrees, lonDegrees) {
      if (!state) {
        return null;
      }
      const normalized = sampleElevationNormalized(state, latDegrees, lonDegrees);
      const minMeters = Number(manifest.elevation?.min_m ?? -2886);
      const reliefMeters = Number(manifest.elevation?.relief_m ?? 0);
      return minMeters + (normalized * reliefMeters);
    }

    function formatElevationWithColor(elevationMeters, textColor = "#f6dcc8") {
      if (elevationMeters === null || !Number.isFinite(elevationMeters)) {
        return `<span style="color:${textColor}">n/a</span>`;
      }
      const minMeters = Number(manifest.elevation?.min_m ?? -2886);
      const maxMeters = Number(manifest.elevation?.max_m ?? 21000);
      const t = clamp((elevationMeters - minMeters) / Math.max(1, maxMeters - minMeters), 0, 1);
      const stops = [
        [0.0, [64, 120, 255]],
        [0.35, [64, 200, 140]],
        [0.6, [240, 220, 90]],
        [0.8, [240, 140, 60]],
        [1.0, [230, 70, 60]],
      ];
      let color = stops[stops.length - 1][1];
      for (let i = 0; i < stops.length - 1; i += 1) {
        const [aPos, aCol] = stops[i];
        const [bPos, bCol] = stops[i + 1];
        if (t >= aPos && t <= bPos) {
          const f = (t - aPos) / Math.max(1e-6, bPos - aPos);
          color = [
            Math.round(aCol[0] + (bCol[0] - aCol[0]) * f),
            Math.round(aCol[1] + (bCol[1] - aCol[1]) * f),
            Math.round(aCol[2] + (bCol[2] - aCol[2]) * f),
          ];
          break;
        }
      }
      return `<span style="color:rgb(${color[0]},${color[1]},${color[2]})">${elevationMeters.toFixed(0)} m</span>`;
    }

    function createRasterSamplerState(texture) {
      if (!texture || !texture.image) {
        return null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = texture.image.width;
      canvas.height = texture.image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(texture.image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return { canvas, context, pixels, width: canvas.width, height: canvas.height };
    }

    function sampleRasterNormalized(state, latDegrees, lonDegrees) {
      if (!state) {
        return null;
      }
      const u = lonToTextureU(lonDegrees);
      const v = latToTextureV(latDegrees);
      const x = clamp(Math.round(u * (state.width - 1)), 0, state.width - 1);
      const y = clamp(Math.round(v * (state.height - 1)), 0, state.height - 1);
      const offset = ((y * state.width) + x) * 4;
      const alpha = state.pixels[offset + 3] / 255;
      if (alpha <= 0.01) {
        return 0;
      }
      return ((state.pixels[offset] + state.pixels[offset + 1] + state.pixels[offset + 2]) / 3) / 255;
    }

    function createColorizedTopographyTexture(elevationSampler) {
      if (!elevationSampler) {
        return null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = elevationSampler.width;
      canvas.height = elevationSampler.height;
      const context = canvas.getContext("2d");
      const imageData = context.createImageData(canvas.width, canvas.height);
      const source = elevationSampler.pixels;
      const output = imageData.data;
      const ramp = [
        { t: 0.0, c: [21, 44, 130] },
        { t: 0.18, c: [41, 118, 198] },
        { t: 0.36, c: [52, 170, 184] },
        { t: 0.5, c: [88, 190, 104] },
        { t: 0.68, c: [188, 188, 92] },
        { t: 0.82, c: [188, 128, 82] },
        { t: 1.0, c: [244, 238, 226] },
      ];
      const lerpChannel = (a, b, t) => Math.round(a + ((b - a) * t));
      for (let i = 0; i < source.length; i += 4) {
        const t = source[i] / 255;
        let lower = ramp[0];
        let upper = ramp[ramp.length - 1];
        for (let j = 1; j < ramp.length; j += 1) {
          if (t <= ramp[j].t) {
            lower = ramp[j - 1];
            upper = ramp[j];
            break;
          }
        }
        const localT = upper.t === lower.t ? 0 : (t - lower.t) / (upper.t - lower.t);
        output[i] = lerpChannel(lower.c[0], upper.c[0], localT);
        output[i + 1] = lerpChannel(lower.c[1], upper.c[1], localT);
        output[i + 2] = lerpChannel(lower.c[2], upper.c[2], localT);
        output[i + 3] = 255;
      }
      context.putImageData(imageData, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      return texture;
    }

    function createHillshadeTexture(elevationSampler, azimuthDegrees = 315, altitudeDegrees = 45, step = 1) {
      if (!elevationSampler) {
        return null;
      }
      const width = elevationSampler.width;
      const height = elevationSampler.height;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      const imageData = context.createImageData(width, height);
      const out = imageData.data;
      const minMeters = Number(manifest.elevation?.min_m ?? -2886);
      const reliefMeters = Number(manifest.elevation?.relief_m ?? 0);
      const zFactor = reliefMeters / 255;
      const zenith = THREE.MathUtils.degToRad(90 - altitudeDegrees);
      const azimuth = THREE.MathUtils.degToRad(360 - azimuthDegrees + 90);
      const cosZenith = Math.cos(zenith);
      const sinZenith = Math.sin(zenith);
      const getNorm = (x, y) => elevationSampler.pixels[((y * width) + x) * 4];
      for (let y = 1; y < height - 1; y += step) {
        const lat = 90 - (y / height) * 180;
        const xScale = Math.max(Math.cos(THREE.MathUtils.degToRad(lat)), 0.18);
        for (let x = 1; x < width - 1; x += step) {
          const z1 = minMeters + getNorm(x - 1, y - 1) * zFactor;
          const z2 = minMeters + getNorm(x, y - 1) * zFactor;
          const z3 = minMeters + getNorm(x + 1, y - 1) * zFactor;
          const z4 = minMeters + getNorm(x - 1, y) * zFactor;
          const z6 = minMeters + getNorm(x + 1, y) * zFactor;
          const z7 = minMeters + getNorm(x - 1, y + 1) * zFactor;
          const z8 = minMeters + getNorm(x, y + 1) * zFactor;
          const z9 = minMeters + getNorm(x + 1, y + 1) * zFactor;
          const dzdx = ((z3 + 2 * z6 + z9) - (z1 + 2 * z4 + z7)) / (8 * xScale);
          const dzdy = ((z7 + 2 * z8 + z9) - (z1 + 2 * z2 + z3)) / 8;
          const slope = Math.atan(Math.hypot(dzdx, dzdy) / 900);
          const aspect = Math.atan2(dzdy, -dzdx);
          const intensity = clamp(
            255 * ((cosZenith * Math.cos(slope)) + (sinZenith * Math.sin(slope) * Math.cos(azimuth - aspect))),
            0,
            255,
          );
          const idx = ((y * width) + x) * 4;
          out[idx] = intensity;
          out[idx + 1] = intensity;
          out[idx + 2] = intensity;
          out[idx + 3] = 255;
        }
      }
      context.putImageData(imageData, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      return texture;
    }

    function createContourTexture(elevationSampler, intervalMeters = 500) {
      if (!elevationSampler || !intervalMeters) {
        return null;
      }
      const width = elevationSampler.width;
      const height = elevationSampler.height;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      const imageData = context.createImageData(width, height);
      const out = imageData.data;
      const minMeters = Number(manifest.elevation?.min_m ?? -2886);
      const reliefMeters = Number(manifest.elevation?.relief_m ?? 0);
      const levels = new Float32Array(width * height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = ((y * width) + x) * 4;
          const elevation = minMeters + (elevationSampler.pixels[idx] / 255) * reliefMeters;
          levels[y * width + x] = Math.floor(elevation / intervalMeters);
        }
      }
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const idx1 = y * width + x;
          const level = levels[idx1];
          const isEdge = (
            levels[idx1 - 1] !== level ||
            levels[idx1 + 1] !== level ||
            levels[idx1 - width] !== level ||
            levels[idx1 + width] !== level
          );
          if (!isEdge) {
            continue;
          }
          const idx = idx1 * 4;
          out[idx] = 236;
          out[idx + 1] = 244;
          out[idx + 2] = 246;
          out[idx + 3] = 212;
        }
      }
      context.putImageData(imageData, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.userData.sourceCanvas = canvas;
      texture.needsUpdate = true;
      return texture;
    }

    function getContourThicknessScale(scaleBarMeters = null) {
      if (!Number.isFinite(scaleBarMeters) || scaleBarMeters <= 0) {
        return 1.15;
      }
      if (scaleBarMeters <= 1000) return 0.55;
      if (scaleBarMeters <= 2500) return 0.72;
      if (scaleBarMeters <= 10000) return 0.92;
      if (scaleBarMeters <= 50000) return 1.15;
      if (scaleBarMeters <= 250000) return 1.45;
      return 1.85;
    }

    function textureUToLon(u) {
      return ((((u * 360) + 180) % 360) + 360) % 360;
    }

    function textureVToLat(v) {
      return 90 - (clamp(v, 0, 1) * 180);
    }

    function buildContourLatLonPolylines(elevationSampler, intervalMeters = 500) {
      if (!elevationSampler || !intervalMeters) {
        return null;
      }
      const width = elevationSampler.width;
      const height = elevationSampler.height;
      const minMeters = Number(manifest.elevation?.min_m ?? -2886);
      const reliefMeters = Math.max(Number(manifest.elevation?.relief_m ?? 1), 1);
      const sampleStep = intervalMeters <= 500 ? 2 : intervalMeters <= 1000 ? 3 : 4;
      const nodes = new Map();
      const adjacency = new Map();
      const segmentKeys = new Set();
      const epsilon = Math.max(1e-6, intervalMeters * 1e-5);
      const sampleMeters = (sx, sy) => {
        const x = Math.max(0, Math.min(width - 1, sx));
        const y = Math.max(0, Math.min(height - 1, sy));
        const idx = ((y * width) + x) * 4;
        return minMeters + ((elevationSampler.pixels[idx] / 255) * reliefMeters);
      };
      const adjustedSample = (value, level) => (
        Math.abs(value - level) < epsilon ? value + epsilon : value
      );
      const registerNode = (point) => {
        if (!point || !Number.isFinite(point.u) || !Number.isFinite(point.v) || !point.key) {
          return null;
        }
        if (!nodes.has(point.key)) {
          nodes.set(point.key, point);
        }
        if (!adjacency.has(point.key)) {
          adjacency.set(point.key, new Set());
        }
        return point.key;
      };
      const addSegment = (p0, p1) => {
        const key0 = registerNode(p0);
        const key1 = registerNode(p1);
        if (!key0 || !key1 || key0 === key1) {
          return;
        }
        const edgeKey = key0 < key1 ? `${key0}|${key1}` : `${key1}|${key0}`;
        if (segmentKeys.has(edgeKey)) {
          return;
        }
        segmentKeys.add(edgeKey);
        adjacency.get(key0).add(key1);
        adjacency.get(key1).add(key0);
      };
      const crossingPoint = (edge, level, v1Raw, v2Raw, u1, vv1, u2, vv2, x0, y0) => {
        const v1 = adjustedSample(v1Raw, level);
        const v2 = adjustedSample(v2Raw, level);
        const delta = v2 - v1;
        if (Math.abs(delta) < 1e-6) {
          return null;
        }
        const t = (level - v1) / delta;
        if (t < 0 || t > 1) {
          return null;
        }
        return {
          edge,
          key: `${edge}:${x0}:${y0}:${Math.round(t * 1000000)}`,
          u: u1 + ((u2 - u1) * t),
          v: vv1 + ((vv2 - vv1) * t),
        };
      };
      for (let y = 0; y < height - sampleStep; y += sampleStep) {
        const vTop = y / (height - 1);
        const vBottom = (y + sampleStep) / (height - 1);
        for (let x = 0; x < width - sampleStep; x += sampleStep) {
          const uLeft = x / (width - 1);
          const uRight = (x + sampleStep) / (width - 1);
          const a = sampleMeters(x, y);
          const b = sampleMeters(x + sampleStep, y);
          const c = sampleMeters(x + sampleStep, y + sampleStep);
          const d = sampleMeters(x, y + sampleStep);
          const cellMin = Math.min(a, b, c, d);
          const cellMax = Math.max(a, b, c, d);
          const cellCenter = (a + b + c + d) * 0.25;
          let level = Math.ceil(cellMin / intervalMeters) * intervalMeters;
          for (; level <= cellMax; level += intervalMeters) {
            const top = crossingPoint("h", level, a, b, uLeft, vTop, uRight, vTop, x, y);
            const right = crossingPoint("v", level, b, c, uRight, vTop, uRight, vBottom, x + sampleStep, y);
            const bottom = crossingPoint("h", level, d, c, uLeft, vBottom, uRight, vBottom, x, y + sampleStep);
            const left = crossingPoint("v", level, a, d, uLeft, vTop, uLeft, vBottom, x, y);
            const caseCode = (
              (adjustedSample(a, level) > level ? 8 : 0) |
              (adjustedSample(b, level) > level ? 4 : 0) |
              (adjustedSample(c, level) > level ? 2 : 0) |
              (adjustedSample(d, level) > level ? 1 : 0)
            );
            switch (caseCode) {
              case 0:
              case 15:
                break;
              case 1:
              case 14:
                addSegment(left, bottom);
                break;
              case 2:
              case 13:
                addSegment(bottom, right);
                break;
              case 3:
              case 12:
                addSegment(left, right);
                break;
              case 4:
              case 11:
                addSegment(top, right);
                break;
              case 5:
                if (cellCenter > level) {
                  addSegment(top, right);
                  addSegment(left, bottom);
                } else {
                  addSegment(top, left);
                  addSegment(right, bottom);
                }
                break;
              case 10:
                if (cellCenter > level) {
                  addSegment(top, left);
                  addSegment(right, bottom);
                } else {
                  addSegment(top, right);
                  addSegment(left, bottom);
                }
                break;
              case 6:
              case 9:
                addSegment(top, bottom);
                break;
              case 7:
              case 8:
                addSegment(top, left);
                break;
              default:
                break;
            }
          }
        }
      }
      if (!nodes.size || !segmentKeys.size) {
        return null;
      }
      const visitedEdges = new Set();
      const edgeVisitKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
      const polylines = [];
      const buildPolylineFrom = (startKey) => {
        const polyline = [];
        let currentKey = startKey;
        let previousKey = null;
        while (currentKey) {
          polyline.push(nodes.get(currentKey));
          const neighbors = [...(adjacency.get(currentKey) || [])]
            .filter((neighborKey) => !visitedEdges.has(edgeVisitKey(currentKey, neighborKey)) && neighborKey !== previousKey);
          if (!neighbors.length) {
            break;
          }
          const nextKey = neighbors[0];
          visitedEdges.add(edgeVisitKey(currentKey, nextKey));
          previousKey = currentKey;
          currentKey = nextKey;
          if (currentKey === startKey) {
            polyline.push(nodes.get(currentKey));
            break;
          }
        }
        return polyline;
      };
      const endpointKeys = [...adjacency.entries()]
        .filter(([, neighbors]) => neighbors.size === 1)
        .map(([key]) => key);
      for (const endpointKey of endpointKeys) {
        const polyline = buildPolylineFrom(endpointKey);
        if (polyline.length >= 2) {
          polylines.push(polyline);
        }
      }
      for (const key of nodes.keys()) {
        const neighbors = adjacency.get(key);
        if (!neighbors || !neighbors.size) {
          continue;
        }
        const hasUnvisited = [...neighbors].some((neighborKey) => !visitedEdges.has(edgeVisitKey(key, neighborKey)));
        if (!hasUnvisited) {
          continue;
        }
        const polyline = buildPolylineFrom(key);
        if (polyline.length >= 2) {
          polylines.push(polyline);
        }
      }
      return polylines.length ? polylines.map((polyline) => polyline.map((point) => ({
        lat: textureVToLat(point.v),
        lon: textureUToLon(point.u),
      }))) : null;
    }

    function createContourLineLayer(THREERef, venusGroup, elevationSampler, getTerrainRelief, radius = 3.2) {
      const group = new THREERef.Group();
      group.visible = false;
      venusGroup.add(group);
      const material = new THREERef.LineBasicMaterial({
        color: new THREERef.Color(contourColorSelect?.value || "#e8eef3"),
        transparent: true,
        opacity: Number(contourOpacity?.value || 0.62),
        depthTest: true,
        depthWrite: false,
      });
      const contourLines = [];
      let activeInterval = 0;
      let latLonPolylines = null;
      const surfaceLift = () => 0.0016 + (Math.max(0, getTerrainRelief()) * 0.012);
      const clearLines = () => {
        while (contourLines.length) {
          const line = contourLines.pop();
          group.remove(line);
          line.geometry?.dispose?.();
        }
      };
      const buildPositions = () => {
        if (!Array.isArray(latLonPolylines) || !latLonPolylines.length) {
          clearLines();
          group.visible = false;
          return;
        }
        clearLines();
        for (const polyline of latLonPolylines) {
          if (!Array.isArray(polyline) || polyline.length < 2) {
            continue;
          }
          const segments = [];
          let current = [];
          let previousLon = null;
          for (const pointDef of polyline) {
            const lat = pointDef.lat;
            const lon = ((Number(pointDef.lon) % 360) + 360) % 360;
            if (previousLon !== null && Math.abs(lon - previousLon) > 180) {
              if (current.length >= 2) {
                segments.push(current);
              }
              current = [];
            }
            current.push(getReliefPoint(
              radius,
              elevationSampler,
              new Map(),
              getTerrainRelief,
              lat,
              lon,
              surfaceLift(),
            ));
            previousLon = lon;
          }
          if (current.length >= 2) {
            segments.push(current);
          }
          for (const segment of segments) {
            const geometry = new THREERef.BufferGeometry().setFromPoints(segment);
            const line = new THREERef.Line(geometry, material);
            line.renderOrder = 46;
            line.frustumCulled = false;
            contourLines.push(line);
            group.add(line);
          }
        }
        group.visible = true;
      };
      return {
        group,
        setOpacity(value) {
          material.opacity = Number.isFinite(value) ? value : material.opacity;
          material.needsUpdate = true;
        },
        setColor(value) {
          if (!value) return;
          material.color.set(value);
          material.needsUpdate = true;
        },
        clear() {
          activeInterval = 0;
          latLonPolylines = null;
          buildPositions();
        },
        rebuild(intervalMeters) {
          activeInterval = Number(intervalMeters || 0);
          latLonPolylines = activeInterval ? buildContourLatLonPolylines(elevationSampler, activeInterval) : null;
          buildPositions();
        },
        updateRelief() {
          if (activeInterval && latLonPolylines) {
            buildPositions();
          }
        },
      };
    }

    function createRegionMaskTexture(maskId, elevationSampler) {
      const width = elevationSampler ? elevationSampler.width : 2048;
      const height = elevationSampler ? elevationSampler.height : 1024;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, width, height);

      if (maskId === "lowlands" || maskId === "highlands") {
        const source = elevationSampler ? elevationSampler.pixels : null;
        const imageData = context.createImageData(width, height);
        const output = imageData.data;
        const thresholdMeters = -2500;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = ((y * width) + x) * 4;
            const normalized = source ? source[index] / 255 : 0;
            const elevationMeters = Number(manifest.elevation?.min_m ?? -2886) + normalized * Number(manifest.elevation?.relief_m ?? 0);
            const matches = maskId === "lowlands" ? elevationMeters <= thresholdMeters : elevationMeters > thresholdMeters;
            if (!matches) {
              continue;
            }
            if (maskId === "lowlands") {
              output[index] = 64; output[index + 1] = 160; output[index + 2] = 255; output[index + 3] = 132;
            } else {
              output[index] = 255; output[index + 1] = 170; output[index + 2] = 82; output[index + 3] = 118;
            }
          }
        }
        context.putImageData(imageData, 0, 0);
      } else if (REGION_MASK_DEFS[maskId]) {
        for (const region of REGION_MASK_DEFS[maskId]) {
          const x = lonToTextureU(region.lon) * width;
          const y = latToTextureV(region.lat) * height;
          const radiusX = (region.radiusDeg / 360) * width;
          const radiusY = (region.radiusDeg / 180) * height;
          const gradient = context.createRadialGradient(x, y, radiusX * 0.2, x, y, radiusX);
          gradient.addColorStop(0, region.color);
          gradient.addColorStop(1, "rgba(0,0,0,0)");
          context.fillStyle = gradient;
          context.beginPath();
          context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
          context.fill();
        }
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      return texture;
    }

    function vectorToLatLon(point) {
      const p = point.clone().normalize();
      const lat = THREE.MathUtils.radToDeg(Math.asin(p.y));
      const lonScene = THREE.MathUtils.radToDeg(Math.atan2(p.z, -p.x));
      const lon = ((lonScene % 360) + 360) % 360;
      return { lat, lon };
    }

    function greatCircleDistanceKm(a, b) {
      const radiusKm = a.radiusKm || b.radiusKm || VENUS_MEAN_RADIUS_KM;
      const aLat = THREE.MathUtils.degToRad(a.lat);
      const bLat = THREE.MathUtils.degToRad(b.lat);
      const dLat = bLat - aLat;
      const dLon = THREE.MathUtils.degToRad(b.lon - a.lon);
      const hav = Math.sin(dLat / 2) ** 2 + Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;
      return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(hav)));
    }

    function initialBearingDegrees(a, b) {
      const lat1 = THREE.MathUtils.degToRad(a.lat);
      const lat2 = THREE.MathUtils.degToRad(b.lat);
      const dLon = THREE.MathUtils.degToRad(b.lon - a.lon);
      const y = Math.sin(dLon) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2)
        - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
      return (((THREE.MathUtils.radToDeg(Math.atan2(y, x)) % 360) + 360) % 360);
    }

    /**
     * The area of a polygon on this body, in km^2.
     *
     * The line-integral form: for each edge, the change in longitude times the
     * mean of the endpoint sines. Exact for great-circle edges and, crucially,
     * **stable under subdivision** -- adding vertices along an edge cannot
     * change the answer.
     *
     * What was here summed the interior angle at every vertex and subtracted
     * (n-2)pi, which is right on paper and unusable in practice: subdividing
     * drives every angle toward pi and the result becomes the difference of two
     * large, nearly equal numbers. Measured on Earth's identical copy, one
     * 300 km box gave 89,806 km^2 at four vertices and then 58,939 / 96,124 /
     * 113,026 at twelve, twenty-four and forty-four -- diverging with vertex
     * count. Every hand-drawn area with more than a handful of points was
     * quoted wrongly, silently, on every world.
     *
     * The tested copy is `GeoID_GIS/viewer/gis/geo-utils.js`. It is written out
     * again here rather than imported because these files carry epoch-second
     * cache stamps that `stamp.py` does not sweep, and a cross-tree import at a
     * stale stamp would be a second instance of that module. If the formula
     * changes, change it in both -- `geo-utils.test.mjs` is what proves it.
     */
    function sphericalPolygonAreaKm2(points) {
      if (!Array.isArray(points) || points.length < 3) {
        return 0;
      }
      const radiusKm = points[0]?.radiusKm || VENUS_MEAN_RADIUS_KM;
      const rad = (degrees) => (degrees * Math.PI) / 180;
      let sum = 0;
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        let dLon = rad(b.lon - a.lon);
        // The short way round, so a polygon over the antimeridian does not
        // sweep the long way and report most of the body.
        if (dLon > Math.PI) dLon -= 2 * Math.PI;
        if (dLon < -Math.PI) dLon += 2 * Math.PI;
        sum += dLon * (2 + Math.sin(rad(a.lat)) + Math.sin(rad(b.lat)));
      }
      return Math.abs((sum * radiusKm * radiusKm) / 2);
    }

    function sampleGreatCircleProfile(start, end, elevationSampler, sampleCount = 72) {
      const startVec = latLonToVector3(start.lat, start.lon, 1).normalize();
      const endVec = latLonToVector3(end.lat, end.lon, 1).normalize();
      const angle = Math.acos(clamp(startVec.dot(endVec), -1, 1));
      const samples = [];
      for (let index = 0; index < sampleCount; index += 1) {
        const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
        let point;
        if (angle < 1e-5) {
          point = startVec.clone();
        } else {
          const sinTotal = Math.sin(angle);
          point = startVec.clone().multiplyScalar(Math.sin((1 - t) * angle) / sinTotal)
            .add(endVec.clone().multiplyScalar(Math.sin(t * angle) / sinTotal))
            .normalize();
        }
        const latLon = vectorToLatLon(point);
        samples.push({
          ...latLon,
          elevation: sampleElevationMeters(elevationSampler, latLon.lat, latLon.lon) || 0,
        });
      }
      return samples;
    }

    function sampleRouteProfile(points, elevationSampler) {
      if (!Array.isArray(points) || points.length < 2) {
        return [];
      }
      const samples = [];
      let cumulativeDistanceKm = 0;
      let gain = 0;
      let loss = 0;
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const segmentDistanceKm = greatCircleDistanceKm(start, end);
        const segmentSamples = sampleGreatCircleProfile(start, end, elevationSampler, Math.max(24, Math.ceil(segmentDistanceKm * 1.6)));
        if (index > 0) {
          segmentSamples.shift();
        }
        segmentSamples.forEach((sample, sampleIndex) => {
          const t = segmentSamples.length <= 1 ? 0 : sampleIndex / (segmentSamples.length - 1);
          const distanceAlongKm = cumulativeDistanceKm + (segmentDistanceKm * t);
          const previous = samples[samples.length - 1];
          if (previous) {
            const delta = sample.elevation - previous.elevation;
            if (delta > 0) gain += delta;
            if (delta < 0) loss += Math.abs(delta);
          }
          samples.push({
            ...sample,
            distanceAlongKm,
            segmentIndex: index + 1,
          });
        });
        cumulativeDistanceKm += segmentDistanceKm;
      }
      return {
        samples,
        totalDistanceKm: cumulativeDistanceKm,
        elevationGainM: gain,
        elevationLossM: loss,
      };
    }

    function sampleGreatCircleArc(startVec, endVec, radius, minSegments = 32) {
      const start = startVec.clone().normalize();
      const end = endVec.clone().normalize();
      const angle = Math.acos(clamp(start.dot(end), -1, 1));
      const segmentCount = Math.max(minSegments, Math.ceil((angle / Math.PI) * 96));
      const points = [];
      for (let index = 0; index <= segmentCount; index += 1) {
        const t = segmentCount === 0 ? 0 : index / segmentCount;
        let point;
        if (angle < 1e-5) {
          point = start.clone();
        } else {
          const sinTotal = Math.sin(angle);
          point = start.clone().multiplyScalar(Math.sin((1 - t) * angle) / sinTotal)
            .add(end.clone().multiplyScalar(Math.sin(t * angle) / sinTotal))
            .normalize();
        }
        points.push(point.multiplyScalar(radius));
      }
      return points;
    }

    function estimateSurfaceSlopeDegrees(elevationSampler, latDegrees, lonDegrees, radiusKm = VENUS_MEAN_RADIUS_KM) {
      if (!elevationSampler) {
        return null;
      }
      const latStep = 0.08;
      const lonStep = Math.max(0.08, 0.08 / Math.max(Math.cos(THREE.MathUtils.degToRad(latDegrees)), 0.2));
      const north = sampleElevationMeters(elevationSampler, Math.min(89.9, latDegrees + latStep), lonDegrees);
      const south = sampleElevationMeters(elevationSampler, Math.max(-89.9, latDegrees - latStep), lonDegrees);
      const east = sampleElevationMeters(elevationSampler, latDegrees, lonDegrees + lonStep);
      const west = sampleElevationMeters(elevationSampler, latDegrees, lonDegrees - lonStep);
      if ([north, south, east, west].some((value) => value === null)) {
        return null;
      }
      const metersPerDegreeLat = (2 * Math.PI * radiusKm * 1000) / 360;
      const metersPerDegreeLon = metersPerDegreeLat * Math.max(Math.cos(THREE.MathUtils.degToRad(latDegrees)), 0.2);
      const dzdy = (north - south) / Math.max(2 * latStep * metersPerDegreeLat, 1);
      const dzdx = (east - west) / Math.max(2 * lonStep * metersPerDegreeLon, 1);
      return THREE.MathUtils.radToDeg(Math.atan(Math.hypot(dzdx, dzdy)));
    }

    function polygonPerimeterKm(points) {
      if (!Array.isArray(points) || points.length < 2) {
        return 0;
      }
      let perimeter = 0;
      for (let index = 0; index < points.length; index += 1) {
        perimeter += greatCircleDistanceKm(points[index], points[(index + 1) % points.length]);
      }
      return perimeter;
    }

    function normalizePolygonPoints(points) {
      if (!Array.isArray(points) || !points.length) {
        return [];
      }
      const referenceLon = points[0].lon;
      return points.map((point) => ({
        lat: point.lat,
        lon: wrapLongitudeAround(referenceLon, point.lon),
      }));
    }

    function pointInLonLatPolygon(lonDegrees, latDegrees, polygon) {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
        const xi = polygon[i].lon;
        const yi = polygon[i].lat;
        const xj = polygon[j].lon;
        const yj = polygon[j].lat;
        const intersects = ((yi > latDegrees) !== (yj > latDegrees))
          && (lonDegrees < ((xj - xi) * (latDegrees - yi) / ((yj - yi) || 1e-9)) + xi);
        if (intersects) {
          inside = !inside;
        }
      }
      return inside;
    }

    function polygonCentroidLatLon(points) {
      if (!Array.isArray(points) || !points.length) {
        return null;
      }
      const normal = points.reduce((acc, point) => (
        acc.add(latLonToVector3(point.lat, point.lon, 1))
      ), new THREE.Vector3());
      if (normal.lengthSq() < 1e-9) {
        return { lat: points[0].lat, lon: points[0].lon };
      }
      return vectorToLatLon(normal.normalize());
    }

    // Venus's mean radius. Was 3396190 — Mars's — left behind when this
    // viewer was forked, while VENUS_MEAN_RADIUS_KM above stayed correct.
    // It feeds the scale bar and the tile-scale gates, so the bar was reading
    // 44% short.
    const VENUS_RADIUS_METERS = 6051800;
    // FLIGHT-SIM: the shared label-layer.js reads MARS_RADIUS_METERS as a
    // bare global in its mosaic close-zoom branch (scale bar <= 2 km — exactly
    // low flight altitude). The name is a leftover from the Mars fork; what it
    // wants is THIS body's radius. Without it updateLabelVisibility throws a
    // ReferenceError inside render(), which aborts before labels resolve — so
    // features arrived as bare markers with no names. Orbit never reaches that
    // branch; flight does.
    window.MARS_RADIUS_METERS = VENUS_RADIUS_METERS;
    const HUD_BBOX_RAYCASTER = new THREE.Raycaster();
    const HUD_BBOX_SPHERE = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3.2);
    const HUD_BBOX_HIT = new THREE.Vector3();
    const HUD_BBOX_CENTER = new THREE.Vector3();
    const HUD_BBOX_SAMPLES = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(-1, -1),
      new THREE.Vector2(0, -1),
      new THREE.Vector2(1, -1),
      new THREE.Vector2(-1, 0),
      new THREE.Vector2(1, 0),
      new THREE.Vector2(-1, 1),
      new THREE.Vector2(0, 1),
      new THREE.Vector2(1, 1),
      new THREE.Vector2(-0.55, -0.55),
      new THREE.Vector2(0.55, -0.55),
      new THREE.Vector2(-0.55, 0.55),
      new THREE.Vector2(0.55, 0.55),
    ];

    function computeVisibleBodyBbox(camera, bodyMesh, bodyRadiusScene = 3.2) {
      if (!camera || !bodyMesh) {
        return null;
      }
      camera.updateMatrixWorld(true);
      bodyMesh.updateMatrixWorld(true);
      bodyMesh.getWorldPosition(HUD_BBOX_CENTER);
      HUD_BBOX_SPHERE.center.copy(HUD_BBOX_CENTER);
      HUD_BBOX_SPHERE.radius = bodyRadiusScene;
      let latMin = 90;
      let latMax = -90;
      let lonMin = Infinity;
      let lonMax = -Infinity;
      let referenceLon = null;
      const wrapNearReference = (lon, refLon) => {
        let delta = lon - refLon;
        while (delta < -180) delta += 360;
        while (delta > 180) delta -= 360;
        return refLon + delta;
      };
      for (const sample of HUD_BBOX_SAMPLES) {
        HUD_BBOX_RAYCASTER.setFromCamera(sample, camera);
        if (!HUD_BBOX_RAYCASTER.ray.intersectSphere(HUD_BBOX_SPHERE, HUD_BBOX_HIT)) {
          continue;
        }
        const localHit = bodyMesh.worldToLocal(HUD_BBOX_HIT.clone());
        const latLon = vectorToLatLon(localHit);
        const lat = latLon.lat;
        const rawLon = latLon.lon;
        if (referenceLon === null) {
          referenceLon = rawLon;
        }
        const lon = wrapNearReference(rawLon, referenceLon);
        latMin = Math.min(latMin, lat);
        latMax = Math.max(latMax, lat);
        lonMin = Math.min(lonMin, lon);
        lonMax = Math.max(lonMax, lon);
      }
      if (!Number.isFinite(lonMin) || !Number.isFinite(lonMax)) {
        return null;
      }
      return {
        latMin,
        latMax,
        lonMin,
        lonMax,
      };
    }

    function estimateBodyMapScale(camera, bodyMesh, bodyRadiusMeters, bodyRadiusScene = 3.2) {
      if (!camera || !bodyMesh || !Number.isFinite(bodyRadiusMeters) || bodyRadiusMeters <= 0) {
        return null;
      }
      bodyMesh.updateMatrixWorld(true);
      bodyMesh.getWorldPosition(HUD_BBOX_CENTER);
      const cameraToCenter = camera.position.distanceTo(HUD_BBOX_CENTER);
      const cameraToSurface = Math.max(0.0001, cameraToCenter - bodyRadiusScene);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewportHeightPx = Math.max(window.innerHeight * dpr, 1);
      const viewportWidthPx = Math.max(window.innerWidth * dpr, 1);
      const fovRad = THREE.MathUtils.degToRad(camera.fov || 45);
      const viewHeightScene = 2 * cameraToSurface * Math.tan(fovRad * 0.5);
      const viewWidthScene = viewHeightScene * (viewportWidthPx / viewportHeightPx);
      const metersPerSceneUnit = bodyRadiusMeters / Math.max(bodyRadiusScene, 1e-6);
      const metersPerPixel = Math.max(
        (viewWidthScene * metersPerSceneUnit) / viewportWidthPx,
        (viewHeightScene * metersPerSceneUnit) / viewportHeightPx,
      );
      const scaleDenominator = metersPerPixel * (96 / 0.0254);
      return {
        cameraToSurfaceScene: cameraToSurface,
        metersPerPixel,
        scaleDenominator,
      };
    }

    function formatScaleDenominator(value) {
      if (!Number.isFinite(value) || value <= 0) {
        return "—";
      }
      return `1:${Math.max(1, Math.round(value)).toLocaleString()}`;
    }

    function formatMetersPerPixel(value) {
      if (!Number.isFinite(value) || value <= 0) {
        return "—";
      }
      if (value < 1) {
        return `${value.toFixed(2)} m/px`;
      }
      if (value < 1000) {
        return `${value.toFixed(1)} m/px`;
      }
      return `${(value / 1000).toFixed(2)} km/px`;
    }

    function chooseNiceScaleDistance(metersPerPixel, targetPx = 96) {
      if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
        return null;
      }
      const targetMeters = metersPerPixel * targetPx;
      const exponent = Math.floor(Math.log10(targetMeters));
      const base = 10 ** exponent;
      const steps = [1, 2, 5, 10];
      let chosen = base;
      for (const step of steps) {
        const candidate = step * base;
        if (candidate >= targetMeters) {
          chosen = candidate;
          break;
        }
        chosen = candidate;
      }
      return chosen;
    }

    function formatScaleDistanceMeters(distanceMeters) {
      if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
        return "—";
      }
      if (distanceMeters >= 1000) {
        const km = distanceMeters / 1000;
        if (km >= 100) return `${Math.round(km)} km`;
        if (km >= 10) return `${km.toFixed(0)} km`;
        return `${km.toFixed(1)} km`;
      }
      if (distanceMeters >= 10) {
        return `${Math.round(distanceMeters)} m`;
      }
      return `${distanceMeters.toFixed(1)} m`;
    }

    function formatScaleDistanceValue(distanceMeters, totalDistanceMeters) {
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0 || !Number.isFinite(totalDistanceMeters) || totalDistanceMeters <= 0) {
        return "—";
      }
      const useKilometers = totalDistanceMeters >= 1000;
      if (useKilometers) {
        const valueKm = distanceMeters / 1000;
        if (Math.abs(valueKm - Math.round(valueKm)) < 1e-9) {
          return `${Math.round(valueKm)}`;
        }
        return valueKm.toFixed(1).replace(/\.0$/, "");
      }
      if (distanceMeters >= 10) {
        return `${Math.round(distanceMeters)}`;
      }
      return distanceMeters.toFixed(1).replace(/\.0$/, "");
    }

    function formatScaleDistanceTerminal(distanceMeters) {
      if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
        return "—";
      }
      if (distanceMeters >= 1000) {
        const km = distanceMeters / 1000;
        const formatted = Math.abs(km - Math.round(km)) < 1e-9
          ? `${Math.round(km)}`
          : km.toFixed(1).replace(/\.0$/, "");
        return `${formatted} km`;
      }
      const formatted = distanceMeters >= 10
        ? `${Math.round(distanceMeters)}`
        : distanceMeters.toFixed(1).replace(/\.0$/, "");
      return `${formatted} m`;
    }

    function chooseScaleLabelScheme(totalDistanceMeters) {
      if (!Number.isFinite(totalDistanceMeters) || totalDistanceMeters <= 0) {
        return [
          { position: 0, label: "0" },
          { position: 1, label: "—" },
        ];
      }
      const quarter = totalDistanceMeters / 4;
      const half = totalDistanceMeters / 2;
      if (totalDistanceMeters >= 1000) {
        return [
          { position: 0, label: "0" },
          { position: 0.25, label: formatScaleDistanceValue(quarter, totalDistanceMeters) },
          { position: 0.5, label: formatScaleDistanceValue(half, totalDistanceMeters) },
          { position: 1, label: formatScaleDistanceTerminal(totalDistanceMeters) },
        ];
      }
      return [
        { position: 0, label: "0" },
        { position: 0.25, label: formatScaleDistanceValue(quarter, totalDistanceMeters) },
        { position: 0.5, label: formatScaleDistanceValue(half, totalDistanceMeters) },
        { position: 0.75, label: formatScaleDistanceValue((totalDistanceMeters * 3) / 4, totalDistanceMeters) },
        { position: 1, label: formatScaleDistanceTerminal(totalDistanceMeters) },
      ];
    }

    function estimateScaleLabelLayoutWidth(scheme) {
      if (!Array.isArray(scheme) || scheme.length === 0) {
        return 96;
      }
      const labelWidthAt = (spec) => {
        const text = String(spec?.label ?? "");
        if (!text) return 0;
        return Math.max(18, (text.length * 8.2) + 8);
      };
      let required = 96;
      for (let i = 0; i < scheme.length; i += 1) {
        const current = scheme[i];
        const currentWidth = labelWidthAt(current);
        if (i === 0 && current.position <= 0) {
          required = Math.max(required, currentWidth);
        }
        if (current.position >= 1) {
          required = Math.max(required, currentWidth);
        }
        for (let j = i + 1; j < scheme.length; j += 1) {
          const next = scheme[j];
          const delta = Math.max(0.05, next.position - current.position);
          const pairWidth = (currentWidth * 0.5) + (labelWidthAt(next) * 0.5) + 10;
          required = Math.max(required, pairWidth / delta);
        }
      }
      return required;
    }

    function resolveScaleBarWidthPx() {
      if (scaleBarTrack) {
        const measuredWidth = scaleBarTrack.getBoundingClientRect().width;
        if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
          return measuredWidth;
        }
      }
      return 168;
    }

    function chooseFittedScaleLabelScheme(totalDistanceMeters, maxWidthPx) {
      const primaryScheme = chooseScaleLabelScheme(totalDistanceMeters);
      if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) {
        return primaryScheme;
      }
      if (estimateScaleLabelLayoutWidth(primaryScheme) <= maxWidthPx) {
        return primaryScheme;
      }
      const simplifiedScheme = primaryScheme.filter((spec) => {
        if (!spec) return false;
        return spec.position <= 0 || spec.position >= 1 || Math.abs(spec.position - 0.5) < 1e-6;
      });
      if (estimateScaleLabelLayoutWidth(simplifiedScheme) <= maxWidthPx) {
        return simplifiedScheme;
      }
      return [
        { position: 0, label: "0" },
        { position: 1, label: formatScaleDistanceTerminal(totalDistanceMeters) },
      ];
    }

    function updateScaleHud(camera, bodyMesh, bodyRadiusMeters, bodyRadiusScene = 3.2, latitudeDeg = null, visible = true) {
      if (!visible || !camera || !bodyMesh || !Number.isFinite(bodyRadiusMeters) || bodyRadiusMeters <= 0) {
        scaleReadout.hidden = true;
        scaleLabel1.textContent = "—";
        scaleLabel2.textContent = "—";
        scaleLabel3.textContent = "—";
        scaleLabel4.textContent = "—";
        scaleLabel5.textContent = "—";
        return;
      }
      const scaleEstimate = estimateBodyMapScale(camera, bodyMesh, bodyRadiusMeters, bodyRadiusScene);
      if (!scaleEstimate) {
        scaleReadout.hidden = true;
        scaleLabel1.textContent = "—";
        scaleLabel2.textContent = "—";
        scaleLabel3.textContent = "—";
        scaleLabel4.textContent = "—";
        scaleLabel5.textContent = "—";
        return;
      }
      const fixedScaleBarWidthPx = resolveScaleBarWidthPx();
      const niceScaleDistance = scaleEstimate
        ? chooseNiceScaleDistance(scaleEstimate.metersPerPixel, fixedScaleBarWidthPx)
        : null;
      if (Number.isFinite(niceScaleDistance)) {
        window.__lastScaleBarMeters = niceScaleDistance;
      }
      scaleReadout.hidden = false;
      if (!niceScaleDistance) {
        scaleLabel0.textContent = "0";
        scaleLabel1.textContent = "—";
        scaleLabel2.textContent = "";
        scaleLabel3.textContent = "";
        scaleLabel4.textContent = "";
        scaleLabel5.textContent = "";
        return;
      }
      const scheme = chooseFittedScaleLabelScheme(niceScaleDistance, fixedScaleBarWidthPx);
      const labelNodes = [scaleLabel0, scaleLabel1, scaleLabel2, scaleLabel3, scaleLabel4, scaleLabel5];
      for (let i = 0; i < labelNodes.length; i += 1) {
        const node = labelNodes[i];
        const spec = scheme[i];
        if (!spec) {
          node.textContent = "";
          node.style.left = "0%";
          node.style.transform = "translateX(-50%)";
          continue;
        }
        node.textContent = spec.label;
        node.style.left = `${spec.position * 100}%`;
        node.style.transform = spec.position <= 0
          ? "none"
          : spec.position >= 1
            ? "translateX(-100%)"
            : "translateX(-50%)";
      }
    }

    function computeStudyAreaStats(points, elevationSampler, geologyInteractiveState = null) {
      if (!Array.isArray(points) || points.length < 3) {
        return null;
      }
      const areaKm2 = sphericalPolygonAreaKm2(points);
      const perimeterKm = polygonPerimeterKm(points);
      const centroid = polygonCentroidLatLon(points);
      const bodyKind = points[0]?.bodyKind || points[0]?.context?.kind || "planet";
      if (bodyKind !== "planet") {
        return {
          areaKm2,
          perimeterKm,
          centroid,
          sampleCount: 0,
          elevations: [],
          minElevation: null,
          maxElevation: null,
          meanElevation: null,
          stdElevation: null,
          meanSlope: null,
          geologyFeature: null,
        };
      }
      const normalizedPolygon = normalizePolygonPoints(points);
      const lonValues = normalizedPolygon.map((point) => point.lon);
      const latValues = normalizedPolygon.map((point) => point.lat);
      const lonMin = Math.min(...lonValues);
      const lonMax = Math.max(...lonValues);
      const latMin = Math.max(-89.5, Math.min(...latValues));
      const latMax = Math.min(89.5, Math.max(...latValues));
      const latSpan = Math.max(0.02, latMax - latMin);
      const lonSpan = Math.max(0.02, lonMax - lonMin);
      const latSteps = Math.min(26, Math.max(8, Math.round(latSpan / 0.25)));
      const lonSteps = Math.min(26, Math.max(8, Math.round(lonSpan / 0.25)));
      const elevations = [];
      const slopes = [];
      const samples = [];
      for (let y = 0; y <= latSteps; y += 1) {
        const lat = latMin + (latSpan * (y / latSteps));
        for (let x = 0; x <= lonSteps; x += 1) {
          const lon = lonMin + (lonSpan * (x / lonSteps));
          if (!pointInLonLatPolygon(lon, lat, normalizedPolygon)) {
            continue;
          }
          const wrappedLon = ((lon % 360) + 360) % 360;
          const elevation = sampleElevationMeters(elevationSampler, lat, wrappedLon);
          if (elevation !== null) {
            elevations.push(elevation);
          }
          const slope = estimateSurfaceSlopeDegrees(elevationSampler, lat, wrappedLon);
          if (slope !== null) {
            slopes.push(slope);
          }
          samples.push({ lat, lon: wrappedLon, elevation, slope });
        }
      }
      if (!samples.length) {
        for (const point of points) {
          const elevation = sampleElevationMeters(elevationSampler, point.lat, point.lon);
          if (elevation !== null) {
            elevations.push(elevation);
          }
          const slope = estimateSurfaceSlopeDegrees(elevationSampler, point.lat, point.lon);
          if (slope !== null) {
            slopes.push(slope);
          }
        }
      }
      const geologyFeature = centroid
        ? getGeologyFeatureAtLatLon(centroid.lat, centroid.lon, geologyInteractiveState)
        : null;
      return {
        areaKm2,
        perimeterKm,
        centroid,
        sampleCount: samples.length,
        elevations,
        minElevation: elevations.length ? Math.min(...elevations) : null,
        maxElevation: elevations.length ? Math.max(...elevations) : null,
        meanElevation: elevations.length ? elevations.reduce((sum, value) => sum + value, 0) / elevations.length : null,
        stdElevation: elevations.length
          ? Math.sqrt(
              elevations.reduce((sum, value) => {
                const mean = elevations.reduce((acc, item) => acc + item, 0) / elevations.length;
                return sum + ((value - mean) ** 2);
              }, 0) / elevations.length,
            )
          : null,
        meanSlope: slopes.length ? slopes.reduce((sum, value) => sum + value, 0) / slopes.length : null,
        geologyFeature,
      };
    }

    function destinationPoint(latDegrees, lonDegrees, bearingDegrees, distanceKm, radiusKm = VENUS_MEAN_RADIUS_KM) {
      const angularDistance = distanceKm / radiusKm;
      const bearing = THREE.MathUtils.degToRad(bearingDegrees);
      const lat1 = THREE.MathUtils.degToRad(latDegrees);
      const lon1 = THREE.MathUtils.degToRad(lonDegrees);
      const sinLat1 = Math.sin(lat1);
      const cosLat1 = Math.cos(lat1);
      const sinAd = Math.sin(angularDistance);
      const cosAd = Math.cos(angularDistance);
      const lat2 = Math.asin((sinLat1 * cosAd) + (cosLat1 * sinAd * Math.cos(bearing)));
      const lon2 = lon1 + Math.atan2(
        Math.sin(bearing) * sinAd * cosLat1,
        cosAd - (sinLat1 * Math.sin(lat2)),
      );
      return {
        lat: THREE.MathUtils.radToDeg(lat2),
        lon: normalizeLongitudeDegrees(THREE.MathUtils.radToDeg(lon2)),
      };
    }

    function projectLatLonToLocalKm(point, origin, radiusKm = VENUS_MEAN_RADIUS_KM) {
      const dLat = THREE.MathUtils.degToRad(point.lat - origin.lat);
      const dLon = THREE.MathUtils.degToRad(normalizeLongitudeDegrees(point.lon - origin.lon));
      const x = dLon * Math.cos(THREE.MathUtils.degToRad(origin.lat)) * radiusKm;
      const y = dLat * radiusKm;
      return { x, y };
    }

    function pointInProjectedPolygon(point, polygon, origin) {
      if (!Array.isArray(polygon) || polygon.length < 3) {
        return false;
      }
      const test = projectLatLonToLocalKm(point, origin);
      const projected = polygon.map((vertex) => projectLatLonToLocalKm(vertex, origin));
      let inside = false;
      for (let i = 0, j = projected.length - 1; i < projected.length; j = i, i += 1) {
        const xi = projected[i].x;
        const yi = projected[i].y;
        const xj = projected[j].x;
        const yj = projected[j].y;
        const intersects = ((yi > test.y) !== (yj > test.y))
          && (test.x < ((xj - xi) * (test.y - yi)) / ((yj - yi) || 1e-9) + xi);
        if (intersects) inside = !inside;
      }
      return inside;
    }

    function sampleRoutePointsForBuffer(points, stepKm = 20) {
      const samples = [];
      if (!Array.isArray(points) || points.length < 2) {
        return samples;
      }
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const segmentDistanceKm = greatCircleDistanceKm(start, end);
        const sampleCount = Math.max(8, Math.ceil(segmentDistanceKm / Math.max(stepKm, 1)));
        const segmentSamples = sampleGreatCircleProfile(start, end, elevationSampler, sampleCount);
        if (index > 0) {
          segmentSamples.shift();
        }
        samples.push(...segmentSamples.map((sample) => ({ lat: sample.lat, lon: sample.lon })));
      }
      return samples;
    }

    function buildBufferSourceState() {
      const sourceType = gisBufferSource?.value || "inspect";
      if (sourceType === "inspect") {
        if (!(gisInspectPoint && gisInspectPoint.bodyName === "Venus")) {
          return null;
        }
        return {
          type: "inspect",
          center: { lat: gisInspectPoint.lat, lon: gisInspectPoint.lon },
          inside(point, radiusKm) {
            return greatCircleDistanceKm(point, gisInspectPoint) <= radiusKm;
          },
          extentKm: 0,
        };
      }
      if (sourceType === "route") {
        if (!(measureMode === "route" && measurePoints.length >= 2)) {
          return null;
        }
        const routeSamples = sampleRoutePointsForBuffer(measurePoints, 16);
        const center = routeSamples[Math.floor(routeSamples.length * 0.5)] || measurePoints[0];
        const extentKm = routeSamples.reduce((max, point) => Math.max(max, greatCircleDistanceKm(point, center)), 0);
        return {
          type: "route",
          center,
          routeSamples,
          inside(point, radiusKm) {
            return routeSamples.some((sample) => greatCircleDistanceKm(point, sample) <= radiusKm);
          },
          extentKm,
        };
      }
      if (!(measureMode === "area" && measurePoints.length >= 3)) {
        return null;
      }
      const polygon = measurePoints.map((point) => ({ lat: point.lat, lon: point.lon }));
      const stats = computeStudyAreaStats(measurePoints, elevationSampler, geologyInteractiveState);
      const center = stats?.centroid || polygon[0];
      const boundarySamples = sampleRoutePointsForBuffer([...measurePoints, measurePoints[0]], 14);
      const extentKm = polygon.reduce((max, point) => Math.max(max, greatCircleDistanceKm(point, center)), 0);
      return {
        type: "area",
        center,
        polygon,
        boundarySamples,
        inside(point, radiusKm) {
          if (pointInProjectedPolygon(point, polygon, center)) {
            return true;
          }
          return boundarySamples.some((sample) => greatCircleDistanceKm(point, sample) <= radiusKm);
        },
        extentKm,
      };
    }

    function generateBufferPolygonVertices(sourceState, radiusKm, stepDegrees = 5) {
      if (!sourceState || !sourceState.center || !radiusKm) {
        return [];
      }
      const vertices = [];
      const maxRangeKm = Math.max(radiusKm * 1.1, sourceState.extentKm + radiusKm * 1.35, 10);
      for (let bearing = 0; bearing < 360; bearing += stepDegrees) {
        let low = 0;
        let high = maxRangeKm;
        for (let iter = 0; iter < 18; iter += 1) {
          const mid = (low + high) * 0.5;
          const point = destinationPoint(sourceState.center.lat, sourceState.center.lon, bearing, mid);
          if (sourceState.inside(point, radiusKm)) {
            low = mid;
          } else {
            high = mid;
          }
        }
        vertices.push(destinationPoint(sourceState.center.lat, sourceState.center.lon, bearing, low));
      }
      return vertices;
    }

    function buildMarsSurfacePolyline(vertices, closed = false, lift = 0.014) {
      if (!Array.isArray(vertices) || vertices.length < 2) {
        return [];
      }
      const points = [];
      for (let index = 0; index < vertices.length - 1; index += 1) {
        const start = vertices[index];
        const end = vertices[index + 1];
        const distanceKm = greatCircleDistanceKm(start, end);
        const samples = sampleGreatCircleProfile(start, end, elevationSampler, Math.max(8, Math.ceil(distanceKm / 12)));
        const renderPoints = samples.map((sample) => sampleMeasureSurfacePoint(sample.lat, sample.lon, lift));
        if (index > 0) {
          renderPoints.shift();
        }
        points.push(...renderPoints);
      }
      if (closed) {
        const closingSamples = sampleGreatCircleProfile(vertices[vertices.length - 1], vertices[0], elevationSampler, Math.max(8, Math.ceil(greatCircleDistanceKm(vertices[vertices.length - 1], vertices[0]) / 12)));
        closingSamples.shift();
        points.push(...closingSamples.map((sample) => sampleMeasureSurfacePoint(sample.lat, sample.lon, lift)));
      }
      return points;
    }

    function buildMarsPolygonFillMesh(vertices) {
      if (!Array.isArray(vertices) || vertices.length < 3) {
        return null;
      }
      const boundary = buildMarsSurfacePolyline(vertices, true, 0.012);
      if (boundary.length < 3) {
        return null;
      }
      const origin = boundary[0];
      const positions = [];
      for (let index = 1; index < boundary.length - 1; index += 1) {
        const a = origin;
        const b = boundary[index];
        const c = boundary[index + 1];
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: 0x9cf6d8,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        }),
      );
      mesh.renderOrder = 87;
      mesh.frustumCulled = false;
      return mesh;
    }

    function buildNiceTicks(minValue, maxValue, targetTickCount = 4) {
      const span = Math.max(1e-9, maxValue - minValue);
      const roughStep = span / Math.max(1, targetTickCount);
      const stepPower = 10 ** Math.floor(Math.log10(roughStep));
      const stepChoices = [1, 2, 5, 10];
      let step = stepPower;
      for (const choice of stepChoices) {
        const candidate = stepPower * choice;
        if (roughStep <= candidate) {
          step = candidate;
          break;
        }
      }
      const firstTick = Math.ceil(minValue / step) * step;
      const ticks = [];
      for (let value = firstTick; value <= maxValue + step * 0.5; value += step) {
        ticks.push(Number(value.toFixed(10)));
      }
      if (!ticks.length) {
        ticks.push(Number(minValue.toFixed(10)), Number(maxValue.toFixed(10)));
      }
      return { step, ticks };
    }

    function formatDistanceTick(distanceKm) {
      if (distanceKm < 1) {
        return distanceKm === 0 ? "0" : distanceKm.toFixed(distanceKm < 0.1 ? 2 : 1);
      }
      if (distanceKm < 10) {
        return distanceKm.toFixed(1);
      }
      return `${Math.round(distanceKm)}`;
    }

    function formatElevationTick(elevationM) {
      const absElevation = Math.abs(elevationM);
      if (absElevation >= 10000) {
        return `${(elevationM / 1000).toFixed(0)}k`;
      }
      if (absElevation >= 1000) {
        return `${(elevationM / 1000).toFixed(1)}k`;
      }
      return `${Math.round(elevationM)}`;
    }

    function getProfileDistanceSamples(samples) {
      if (!Array.isArray(samples) || !samples.length) {
        return [];
      }
      if (samples.every((sample) => Number.isFinite(sample.distanceAlongKm))) {
        return samples.map((sample) => sample.distanceAlongKm);
      }
      const distances = [0];
      for (let index = 1; index < samples.length; index += 1) {
        distances.push(
          distances[index - 1] + greatCircleDistanceKm(samples[index - 1], samples[index]),
        );
      }
      return distances;
    }

    let currentProfilePlotState = null;

    function drawProfile(canvas, samples, title = null) {
      const context = canvas.getContext("2d");
      const width = canvas.width;
      const height = canvas.height;
      const isLarge = height >= 200;
      context.clearRect(0, 0, width, height);
      const background = context.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, "rgba(6, 11, 19, 0.98)");
      background.addColorStop(1, "rgba(10, 16, 28, 0.98)");
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      if (!samples.length) {
        return;
      }
      const distancesKm = getProfileDistanceSamples(samples);
      const elevations = samples.map((sample) => sample.elevation);
      const minElevation = Math.min(...elevations);
      const maxElevation = Math.max(...elevations);
      const totalDistanceKm = Math.max(...distancesKm, 0.001);

      // Compute nice ticks; clamp yMin/yMax so all data is guaranteed within bounds
      // (buildNiceTicks uses Math.ceil which can round the first tick above minElevation)
      const yTickTarget = isLarge ? 7 : 4;
      const xTickTarget = isLarge ? 6 : (width < 200 ? 3 : 4);
      const elevationSpan = Math.max(1, maxElevation - minElevation);
      const elevationPad = Math.max(40, elevationSpan * 0.08);
      const { ticks: yTicks } = buildNiceTicks(minElevation - elevationPad, maxElevation + elevationPad, yTickTarget);
      const yMin = Math.min(yTicks[0], minElevation - elevationPad * 0.25);
      const yMax = Math.max(yTicks[yTicks.length - 1], maxElevation + elevationPad * 0.25);
      const { ticks: xTicks } = buildNiceTicks(0, totalDistanceKm, xTickTarget);

      // Layout margins
      // Large canvas: the modal header already shows the title and min/max/relief stats,
      // so the canvas just needs clean chart margins.
      const chartTop = isLarge ? 14 : 16;
      // Bottom: 7px gap + ~12px tick labels + 8px gap + 13px axis label + 6px pad = 46px
      const chartBottom = height - (isLarge ? 46 : 28);
      const chartLeft = isLarge ? 68 : 54;
      const chartRight = width - (isLarge ? 18 : 16);
      const chartWidth = Math.max(1, chartRight - chartLeft);
      const chartHeight = Math.max(1, chartBottom - chartTop);

      const xForDistance = (d) => chartLeft + (d / totalDistanceKm) * chartWidth;
      const yForElevation = (e) => chartBottom - ((e - yMin) / Math.max(yMax - yMin, 1e-6)) * chartHeight;

      const tickFont = isLarge ? "500 11.5px 'Exo 2', sans-serif" : "500 10px 'Exo 2', sans-serif";
      const axisLabelFont = isLarge ? "600 13px 'Exo 2', sans-serif" : "600 11px 'Exo 2', sans-serif";

      // Horizontal grid lines + Y-axis tick labels
      context.font = tickFont;
      context.fillStyle = "rgba(222, 233, 241, 0.84)";
      context.strokeStyle = "rgba(160, 190, 214, 0.15)";
      context.lineWidth = 1;
      context.textBaseline = "middle";
      for (const tick of yTicks) {
        const y = yForElevation(tick);
        if (y < chartTop - 1 || y > chartBottom + 1) continue;
        context.beginPath();
        context.moveTo(chartLeft, y);
        context.lineTo(chartRight, y);
        context.stroke();
        context.textAlign = "right";
        context.fillText(formatElevationTick(tick), chartLeft - 7, y);
      }

      // Vertical grid lines + X-axis tick labels
      context.textBaseline = "top";
      const xTickLabelY = chartBottom + 7;
      for (const tick of xTicks) {
        const x = xForDistance(Math.min(tick, totalDistanceKm));
        context.beginPath();
        context.moveTo(x, chartTop);
        context.lineTo(x, chartBottom);
        context.stroke();
        context.textAlign = "center";
        context.fillText(formatDistanceTick(tick), x, xTickLabelY);
      }

      // Axis frame (left spine + bottom)
      context.strokeStyle = "rgba(192, 214, 230, 0.38)";
      context.lineWidth = 1.4;
      context.beginPath();
      context.moveTo(chartLeft, chartTop);
      context.lineTo(chartLeft, chartBottom);
      context.lineTo(chartRight, chartBottom);
      context.stroke();

      // Axis labels with units
      context.font = axisLabelFont;
      context.fillStyle = "rgba(222, 233, 241, 0.92)";
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.fillText("Distance (km)", (chartLeft + chartRight) * 0.5, height - 4);

      context.save();
      context.translate(isLarge ? 14 : 11, (chartTop + chartBottom) * 0.5);
      context.rotate(-Math.PI / 2);
      context.textBaseline = "top";
      context.fillText("Elevation (m)", 0, 0);
      context.restore();

      // Clip all data drawing to the chart area so nothing bleeds past the axes
      context.save();
      context.beginPath();
      context.rect(chartLeft, chartTop, chartWidth, chartHeight);
      context.clip();

      // Area fill under the profile curve
      const areaGradient = context.createLinearGradient(0, chartTop, 0, chartBottom);
      areaGradient.addColorStop(0, "rgba(87, 218, 244, 0.22)");
      areaGradient.addColorStop(1, "rgba(87, 218, 244, 0.03)");
      context.beginPath();
      samples.forEach((sample, index) => {
        const x = xForDistance(distancesKm[index]);
        const y = yForElevation(sample.elevation);
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.lineTo(xForDistance(distancesKm[distancesKm.length - 1]), chartBottom);
      context.lineTo(chartLeft, chartBottom);
      context.closePath();
      context.fillStyle = areaGradient;
      context.fill();

      // Profile line
      context.strokeStyle = "rgba(87, 218, 244, 0.98)";
      context.lineWidth = isLarge ? 2.2 : 2.0;
      context.beginPath();
      samples.forEach((sample, index) => {
        const x = xForDistance(distancesKm[index]);
        const y = yForElevation(sample.elevation);
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.stroke();

      // Start / end point markers
      context.fillStyle = "rgba(87, 218, 244, 0.98)";
      context.beginPath();
      context.arc(xForDistance(distancesKm[0]), yForElevation(samples[0].elevation), 3.4, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(xForDistance(distancesKm[distancesKm.length - 1]), yForElevation(samples[samples.length - 1].elevation), 3.4, 0, Math.PI * 2);
      context.fill();

      context.restore(); // end clip

      // Compact stats for small canvases (no HTML header there)
      if (!isLarge) {
        const relief = maxElevation - minElevation;
        context.font = "500 10px 'Exo 2', sans-serif";
        context.fillStyle = "rgba(190, 240, 247, 0.9)";
        context.textBaseline = "top";
        context.textAlign = "left";
        context.fillText(`Min ${Math.round(minElevation)} m`, chartLeft, 2);
        context.textAlign = "center";
        context.fillText(`Relief ${Math.round(relief)} m`, (chartLeft + chartRight) * 0.5, 2);
        context.textAlign = "right";
        context.fillText(`Max ${Math.round(maxElevation)} m`, chartRight, 2);
      }
    }

    function exportCurrentProfilePng() {
      if (!profileModalCanvas || !currentProfilePlotState?.samples?.length) {
        return;
      }
      const baseName = String(currentProfilePlotState.title || "mars_elevation_profile")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "mars_elevation_profile";
      const link = document.createElement("a");
      link.href = profileModalCanvas.toDataURL("image/png");
      link.download = `${baseName}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    function hideProfileModal() {
      if (profileModal) {
        profileModal.hidden = true;
      }
    }

    let activeMeasurementResultAnchor = null;

    function positionMeasurementResultCard(anchorEl = null) {
      if (!measurementResultCard || measurementResultCard.hidden) {
        return;
      }
      if (!anchorEl) {
        measurementResultCard.style.left = "";
        measurementResultCard.style.top = "";
        measurementResultCard.style.right = "1.1rem";
        return;
      }
      const rect = anchorEl.getBoundingClientRect();
      const cardRect = measurementResultCard.getBoundingClientRect();
      const gap = 12;
      const left = Math.max(12, rect.left - cardRect.width - gap);
      const top = Math.max(12, Math.min(
        window.innerHeight - cardRect.height - 12,
        rect.top + (rect.height * 0.5) - (cardRect.height * 0.5),
      ));
      measurementResultCard.style.right = "auto";
      measurementResultCard.style.left = `${left}px`;
      measurementResultCard.style.top = `${top}px`;
    }

    function hideMeasurementResultCard() {
      activeMeasurementResultAnchor = null;
      if (measurementResultCard) {
        measurementResultCard.hidden = true;
        measurementResultCard.style.left = "";
        measurementResultCard.style.top = "";
        measurementResultCard.style.right = "";
      }
      if (measurementResultTitle) {
        measurementResultTitle.textContent = "Measurement";
      }
      if (measurementResultBody) {
        measurementResultBody.innerHTML = "";
      }
    }

    function showMeasurementResultCard(title, bodyHtml, anchorEl = null) {
      if (!measurementResultCard || !measurementResultBody) {
        return;
      }
      activeMeasurementResultAnchor = anchorEl || null;
      if (measurementResultTitle) {
        measurementResultTitle.textContent = title || "Measurement";
      }
      measurementResultBody.innerHTML = bodyHtml || "";
      measurementResultCard.hidden = false;
      requestAnimationFrame(() => positionMeasurementResultCard(activeMeasurementResultAnchor));
    }

    function showProfileModal(title, summary, samples) {
      if (!profileModal || !profileModalCanvas) {
        return;
      }
      if (profileModalTitle) {
        profileModalTitle.textContent = title || "Elevation Profile";
      }
      if (profileModalSummary) {
        profileModalSummary.textContent = summary || "Distance and elevation profile.";
      }
      currentProfilePlotState = {
        title: title || "Elevation Profile",
        summary: summary || "Distance and elevation profile.",
        samples: Array.isArray(samples) ? samples.map((sample) => ({ ...sample })) : [],
      };
      drawProfile(profileModalCanvas, samples);
      profileModal.hidden = false;
    }

    function hideCsvPlotterModal() {
      if (csvPlotterModal) {
        csvPlotterModal.hidden = true;
      }
    }

    function hideGisExtractModal() {
      if (gisExtractModal) {
        gisExtractModal.hidden = true;
      }
    }

    function parseCsvTable(text) {
      const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) {
        return null;
      }
      const headers = parseCSVRow(lines[0]);
      const rows = lines.slice(1).map((line) => {
        const cells = parseCSVRow(line);
        const row = {};
        headers.forEach((header, index) => {
          row[header] = cells[index] ?? "";
        });
        return row;
      });
      return { headers, rows };
    }

    function populateCsvPlotterSelectors(headers) {
      for (const select of [csvPlotterX, csvPlotterY]) {
        if (!select) continue;
        select.innerHTML = '<option value="">Select column</option>';
        headers.forEach((header) => {
          const option = document.createElement("option");
          option.value = header;
          option.textContent = header;
          select.appendChild(option);
        });
      }
      if (csvPlotterX && headers.length) csvPlotterX.value = headers[0];
      if (csvPlotterY && headers.length > 1) csvPlotterY.value = headers[1];
    }

    function drawGenericPlot(canvas, points, xLabel, yLabel, type = "line") {
      const context = canvas.getContext("2d");
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(8, 14, 24, 0.95)";
      context.fillRect(0, 0, width, height);
      if (!points.length) {
        return;
      }
      const xValues = points.map((point) => point.x);
      const yValues = points.map((point) => point.y);
      const xMin = Math.min(...xValues);
      const xMax = Math.max(...xValues);
      const yMin = Math.min(...yValues);
      const yMax = Math.max(...yValues);
      const chartLeft = 58;
      const chartRight = width - 18;
      const chartTop = 18;
      const chartBottom = height - 36;
      const chartWidth = chartRight - chartLeft;
      const chartHeight = chartBottom - chartTop;
      const xTicks = buildNiceTicks(xMin, xMax || xMin + 1, 4).ticks;
      const yTicks = buildNiceTicks(yMin, yMax || yMin + 1, 4).ticks;
      const xAt = (value) => chartLeft + ((value - xMin) / Math.max(xMax - xMin, 1e-6)) * chartWidth;
      const yAt = (value) => chartBottom - ((value - yMin) / Math.max(yMax - yMin, 1e-6)) * chartHeight;

      context.strokeStyle = "rgba(255,255,255,0.12)";
      context.fillStyle = "rgba(240,227,214,0.86)";
      context.font = "11px sans-serif";
      context.lineWidth = 1;
      context.textBaseline = "middle";
      for (const tick of yTicks) {
        const y = yAt(tick);
        context.beginPath();
        context.moveTo(chartLeft, y);
        context.lineTo(chartRight, y);
        context.stroke();
        context.textAlign = "right";
        context.fillText(formatElevationTick(tick), chartLeft - 6, y);
      }
      context.textBaseline = "top";
      for (const tick of xTicks) {
        const x = xAt(tick);
        context.beginPath();
        context.moveTo(x, chartTop);
        context.lineTo(x, chartBottom);
        context.stroke();
        context.textAlign = "center";
        context.fillText(Number.isFinite(tick) ? String(Number(tick.toFixed(2))) : String(tick), x, chartBottom + 6);
      }
      context.strokeStyle = "rgba(255,255,255,0.28)";
      context.beginPath();
      context.moveTo(chartLeft, chartTop);
      context.lineTo(chartLeft, chartBottom);
      context.lineTo(chartRight, chartBottom);
      context.stroke();
      context.textAlign = "center";
      context.fillText(xLabel, (chartLeft + chartRight) * 0.5, height - 16);
      context.save();
      context.translate(16, (chartTop + chartBottom) * 0.5);
      context.rotate(-Math.PI / 2);
      context.fillText(yLabel, 0, 0);
      context.restore();

      if (type === "scatter") {
        context.fillStyle = "rgba(86, 210, 232, 0.95)";
        for (const point of points) {
          context.beginPath();
          context.arc(xAt(point.x), yAt(point.y), 3, 0, Math.PI * 2);
          context.fill();
        }
        return;
      }
      if (type === "bar") {
        const barWidth = Math.max(chartWidth / Math.max(points.length, 1) - 2, 2);
        context.fillStyle = "rgba(86, 210, 232, 0.85)";
        points.forEach((point) => {
          const x = xAt(point.x) - barWidth * 0.5;
          const y = yAt(point.y);
          context.fillRect(x, y, barWidth, chartBottom - y);
        });
        return;
      }
      context.strokeStyle = "rgba(86, 210, 232, 0.95)";
      context.lineWidth = 2;
      context.beginPath();
      points.forEach((point, index) => {
        const x = xAt(point.x);
        const y = yAt(point.y);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }

    function exportCanvasPng(canvas, filename) {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }, "image/png");
    }

    function drawHistogram(canvas, values, options = {}) {
      const context = canvas.getContext("2d");
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(8, 14, 24, 0.95)";
      context.fillRect(0, 0, width, height);
      if (!Array.isArray(values) || !values.length) {
        return;
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      const bins = Math.max(8, Math.min(20, options.bins || 12));
      const range = Math.max(1e-6, max - min);
      const counts = new Array(bins).fill(0);
      for (const value of values) {
        const idx = Math.min(bins - 1, Math.floor(((value - min) / range) * bins));
        counts[idx] += 1;
      }
      const peak = Math.max(...counts, 1);
      const padX = 14;
      const padY = 18;
      const chartW = width - padX * 2;
      const chartH = height - padY * 2 - 12;
      const barW = chartW / bins;
      context.fillStyle = "rgba(86, 210, 232, 0.85)";
      for (let i = 0; i < bins; i += 1) {
        const barH = (counts[i] / peak) * chartH;
        context.fillRect(padX + i * barW + 1, height - padY - barH - 10, Math.max(2, barW - 2), barH);
      }
      context.strokeStyle = "rgba(255,255,255,0.18)";
      context.strokeRect(padX, padY + 8, chartW, chartH);
      context.fillStyle = "rgba(240, 227, 214, 0.88)";
      context.font = "11px sans-serif";
      context.fillText(`${options.label || "Value"} histogram`, padX, 12);
      context.fillText(`${Math.round(min)}`, padX, height - 2);
      const maxText = `${Math.round(max)}`;
      const maxWidth = context.measureText(maxText).width;
      context.fillText(maxText, width - padX - maxWidth, height - 2);
    }

    function setTagRow(node, tags) {
      node.innerHTML = "";
      for (const tag of tags.filter(Boolean)) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = tag;
        node.appendChild(chip);
      }
    }

    function inferLayerMeta(layer, context = "base") {
      if (context === "core") {
        return {
          badge: "Schematic",
          help: "Interior cutaway layers are teaching models inferred from geophysics and seismic constraints.",
          tags: ["interior", "schematic", "inferred"],
        };
      }
      if (context === "sea") {
        return {
          badge: "Modeled",
          help: "The paleo-sea overlay is a threshold model applied to the global elevation raster. It is exploratory rather than a confirmed shoreline reconstruction.",
          tags: ["paleo-ocean", "modeled", "elevation-threshold"],
        };
      }
      if (context === "modeled") {
        return {
          badge: "Modeled",
          help: "These masks are derived from elevation thresholds or curated regional envelopes meant for exploration rather than formal cartographic boundaries.",
          tags: ["regional", "modeled", "exploratory"],
        };
      }
      if (context === "seismic") {
        return {
          badge: "Derived",
          help: "Seismic events from the NASA InSight lander's catalog, filtered by magnitude and time.",
          tags: ["placeholder", "disabled"],
        };
      }
      if (!layer) {
        return {
          badge: "Measured",
          help: "No specific layer metadata available.",
          tags: [],
        };
      }
      if (layer.tileServiceUrl) {
        return {
          badge: "Live",
          help: "Tiles stream on demand from ESRI ArcGIS Online — only the tiles you're viewing are fetched. No bulk download.",
          tags: ["tiled", "live", "high-resolution"],
        };
      }
      if (layer.id === "tes-albedo" || layer.id === "tes-thermal-inertia") {
        return {
          badge: "Derived",
          help: "TES basemaps are science products derived from spacecraft observations rather than direct color imagery.",
          tags: ["orbital", "processed", "science-product"],
        };
      }
      if (layer.id === "colorized-topography") {
        return {
          badge: "Derived",
          help: "Colorized topography is generated from the global elevation model to emphasize relief rather than natural surface color.",
          tags: ["topography", "derived", "elevation"],
        };
      }
      if (layer.id === "derived-hillshade") {
        return {
          badge: "Derived",
          help: "Hillshade is generated from the elevation model to emphasize landform illumination and relief texture.",
          tags: ["hillshade", "derived", "elevation"],
        };
      }
      if (layer.id === "derived-slope") {
        return {
          badge: "Derived",
          help: "Slope is generated from the elevation model to emphasize steeper terrain with a warm color ramp.",
          tags: ["slope", "derived", "elevation"],
        };
      }
      if (layer.id && layer.id.startsWith("mineral-")) {
        return {
          badge: "Derived",
          help: "Mineral maps are spectral abundance estimates derived from TES observations and processing assumptions.",
          tags: ["spectral", "TES", "derived"],
        };
      }
      if (layer.id === "sim3292-units") {
        return {
          badge: "Interpretive",
          help: "Geology overlays are interpretive geologic maps based on mapped surface units and structures, not raw measured imagery.",
          tags: ["geology", "interpretive", "mapped-units"],
        };
      }
      return {
        badge: "Measured",
        help: "This basemap is a global observed surface product intended as the main visual context layer.",
        tags: ["basemap", "observed", "surface"],
      };
    }

    function getLayerMeta(context, layer) {
      return inferLayerMeta(layer, context);
    }

    function getActiveGeologyStructureFacets(geologyStructureLayers) {
      return (Array.isArray(geologyStructureLayers) ? geologyStructureLayers : [])
        .filter((facet) => Boolean(facet?.toggle?.checked) && Boolean(facet?.layer?.available));
    }

    function syncGeologyStructureMasterToggle(geologyStructureLayers) {
      if (!geologyStructuresToggle) {
        return;
      }
      const availableLayers = (Array.isArray(geologyStructureLayers) ? geologyStructureLayers : [])
        .filter((facet) => Boolean(facet?.layer?.available) && facet?.toggle);
      if (!availableLayers.length) {
        geologyStructuresToggle.checked = false;
        geologyStructuresToggle.indeterminate = false;
        return;
      }
      const enabledCount = availableLayers.filter((facet) => facet.toggle.checked).length;
      geologyStructuresToggle.checked = enabledCount === availableLayers.length;
      geologyStructuresToggle.indeterminate = enabledCount > 0 && enabledCount < availableLayers.length;
    }

    function makeMetadataLink(label, href) {
      return href ? { label, href } : null;
    }

    function buildLegendEntries(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState = null, geologyStructureLayers = []) {
      const selectedGeologyLayer = getSelectedGeologyLayer(geologyLayers);
      const selectedMineralLayer = getSelectedMineralLayer(mineralLayers);
      const seaActive = seaToggle.checked;
      const regionMaskActive = Boolean(regionMaskSelect.value);
      const entries = [];

      if (geologyToggle.checked && selectedGeologyLayer) {
        const rockLegend = geologyInteractiveState?.rock_legend || [];
        entries.push({
          title: "Solid Geology",
          copy: "USGS, Geologic Map of Venus simplified into rock-type classes for the active solid geology overlay.",
          tags: ["geology", "units"],
          symbols: rockLegend.map((unit) => ({
            type: "swatch",
            label: unit.label || unit.rock_type || "Rock type",
            detail: unit.description || "Mapped geologic unit.",
            color: unit.color || "#888888",
          })),
        });
      }
      const activeStructureFacets = getActiveGeologyStructureFacets(geologyStructureLayers);
      if (
        (geologyContactsToggle?.checked && (geologyInteractiveState?.contacts || []).length) ||
        activeStructureFacets.length
      ) {
        if (geologyContactsToggle?.checked) {
          entries.push({
            title: "Contacts",
            copy: "",
            tags: ["geology", "contacts"],
            symbols: [
              { type: "line", label: "Certain / border contact", detail: "Mapped polygon contacts and borders.", color: "#f3f1d8" },
              { type: "line", label: "Approximate contact", detail: "Approximate or inferred contact trace.", color: "#aab8c6" },
            ],
          });
        }
        if (activeStructureFacets.length) {
          entries.push({
            title: "Mapped structure facets",
            copy: "USGS, Geologic Map of Venus structural traces split into individually toggleable structure families.",
            tags: ["geology", "structures", ...activeStructureFacets.flatMap((facet) => facet.tags || [])],
            symbols: activeStructureFacets.map((facet) => ({
              type: "line",
              label: facet.legendTitle || facet.label,
              detail: facet.detail,
              color: facet.symbolColor || facet.sampleColor || "#f06a57",
            })),
          });
        }
      }
      if (selectedMineralLayer) {
        entries.push({
          title: `${selectedMineralLayer.label} mineral scale`,
          copy: "ASU TES mineral abundance legend for the currently selected mineral overlay.",
          image: selectedMineralLayer.legend_path || "",
          tags: ["mineral", "TES"],
        });
      }

      if (seaActive) {
        const seaLevelMeters = Number(seaLevelSlider?.value ?? 0);
        const seaMinMeters = Number(seaLevelSlider?.min ?? -2886);
        const seaColorCapMeters = 3200;
        const seaShallowBandMeters = 400;
        const maxDepthMeters = Math.max(0, seaLevelMeters - seaMinMeters);
        const colorBarDepth = Math.min(seaColorCapMeters, maxDepthMeters);
        const depthLabelMax = `${formatScaleDistanceMeters(colorBarDepth)}${maxDepthMeters > seaColorCapMeters ? "+" : ""} depth`;
        const depthLabelMin = "0 m depth";
        entries.push({
          title: "Paleo-sea symbology",
          copy: `Sea-level threshold model. Current level: ${seaLevelMeters} m. Max modeled depth: ${formatScaleDistanceMeters(maxDepthMeters)}.`,
          tags: ["paleo-sea", "modeled"],
          symbols: [
            {
              type: "gradient",
              labelMin: depthLabelMin,
              labelMax: depthLabelMax,
              colorA: "#73d8ef",
              colorB: "#2f86b8",
            },
            {
              type: "swatch",
              label: "Shoreline highlight",
              detail: `Brighter edge band marks terrain within ${formatScaleDistanceMeters(seaShallowBandMeters)} of the sea level.`,
              color: "#b0f0ff",
            },
          ],
        });
      }

      if (regionMaskActive) {
        if (regionMaskSelect.value === "lowlands") {
          entries.push({
            title: "Lowlands mask",
            copy: "Threshold mask for elevations at or below -2500 m.",
            tags: ["region-mask", "lowlands"],
            symbols: [
              {
                type: "swatch",
                label: "Northern lowlands",
                detail: "Blue translucent fill marks terrain at or below the lowland threshold.",
                color: "rgba(64,160,255,0.72)",
              },
            ],
          });
        } else if (regionMaskSelect.value === "highlands") {
          entries.push({
            title: "Highlands mask",
            copy: "Threshold mask for elevations above -2500 m.",
            tags: ["region-mask", "highlands"],
            symbols: [
              {
                type: "swatch",
                label: "Southern highlands",
                detail: "Amber translucent fill marks terrain above the lowland-highland break.",
                color: "rgba(255,170,82,0.72)",
              },
            ],
          });
        } else if (regionMaskSelect.value === "volcanic-provinces") {
          entries.push({
            title: "Volcanic province mask",
            copy: "Curated translucent halos centered on the main volcanic provinces.",
            tags: ["region-mask", "volcanic-provinces"],
            symbols: [
              {
                type: "swatch",
                label: "Province halo",
                detail: "Warm red-orange halos mark the Tharsis, Elysium, and Syrtis Major volcanic regions.",
                color: "rgba(255,112,82,0.78)",
              },
            ],
          });
        } else if (regionMaskSelect.value === "basins") {
          entries.push({
            title: "Impact basin mask",
            copy: "Curated translucent halos centered on major impact basins.",
            tags: ["region-mask", "basins"],
            symbols: [
              {
                type: "swatch",
                label: "Basin halo",
                detail: "Blue halos mark the major Hellas, Isidis, Utopia, and Argyre basin regions.",
                color: "rgba(84,166,255,0.76)",
              },
            ],
          });
        }
      }

      const _scActiveLayer = baseLayers.find((l) => l.id === baseLayerSelect.value && l.scParamKey);
      if (_scActiveLayer) {
        const p = SC_PARAMS[_scActiveLayer.scParamKey];
        if (p) {
          entries.push({
            title: p.label,
            copy: p.description,
            tags: ["surface-conditions", "modelled"],
            symbols: [
              {
                type: "gradient",
                labelMin: `${p.min} ${p.unit}`,
                labelMax: `${p.max} ${p.unit}`,
                colorA: p.legendA,
                colorB: p.legendB,
                stops: p.stops || null,
              },
            ],
          });
        }
      }

      if (coreToggle.checked) {
        entries.push({
          title: "",
          copy: "",
          tags: [],
          symbols: [
            {
              type: "swatch",
              label: "Crust",
              detail: "Thin basaltic outer shell, thinnest under the great volcanic plains and thickest under the ancient southern highlands.",
              color: VENUS_INTERIOR_LAYER_COLORS["Crust"],
            },
            {
              type: "swatch",
              label: "Mantle",
              detail: "A thick shell of iron-rich silicate rock. Heat escapes slowly through an immobile lithosphere — Venus lacks active plate tectonics.",
              color: VENUS_INTERIOR_LAYER_COLORS["Mantle"],
            },
            {
              type: "swatch",
              label: "Liquid Outer Core",
              detail: "InSight seismic data confirmed a single large liquid iron core of ~1,830 km radius, kept liquid by its high sulfur content.",
              color: VENUS_INTERIOR_LAYER_COLORS["Liquid Outer Core"],
            },
            {
              type: "swatch",
              label: "Inner Core",
              detail: "Whether Mars has a solid inner core is unconfirmed — InSight seismic data is ambiguous and deep-interior resolution remains limited.",
              color: VENUS_INTERIOR_LAYER_COLORS["Inner Core"],
            },
          ],
        });
      }

      return entries;
    }

    function buildMetadataState(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState = null, geologyStructureLayers = []) {
      const coreEnabled = coreToggle.checked;
      const selectedBaseLayer = getSelectedBaseLayer(baseLayers);
      const selectedGeologyLayer = getSelectedGeologyLayer(geologyLayers);
      const selectedMineralLayer = getSelectedMineralLayer(mineralLayers);
      const seaActive = seaToggle.checked;
      const regionMaskActive = Boolean(regionMaskSelect.value);
      const sections = [];
      const activeLayers = [];

      const pushActiveLayer = (title, context, layer, detail = null) => {
        const meta = getLayerMeta(context, layer);
        activeLayers.push({
          title,
          copy: detail || describeLayer(layer),
          citation: `${meta.badge}. ${meta.help}`,
          tags: meta.tags,
        });
      };

      pushActiveLayer("Basemap", "base", selectedBaseLayer);
      if (geologyToggle.checked && selectedGeologyLayer) {
        pushActiveLayer("Atmospheric context layer", "geology", selectedGeologyLayer);
      }
      if (geologyContactsToggle.checked && (geologyInteractiveState?.contacts || []).length) {
        pushActiveLayer(
          "Geology contacts",
          "geology",
          selectedGeologyLayer || selectedBaseLayer,
          "USGS, Geologic Map of Venus geologic contacts draped from the vector shapefiles.",
        );
      }
      const activeStructureFacets = getActiveGeologyStructureFacets(geologyStructureLayers);
      if (activeStructureFacets.length) {
        pushActiveLayer(
          "Geology structures",
          "geology",
          selectedGeologyLayer || selectedBaseLayer,
          `USGS, Geologic Map of Venus structural traces. Active facets: ${activeStructureFacets.map((facet) => facet.label).join(", ")}.`,
        );
      }
      if (selectedMineralLayer) {
        pushActiveLayer("Mineral map", "mineral", selectedMineralLayer);
      }
      if (seaActive) {
        pushActiveLayer(
          "Paleo-sea overlay",
          "sea",
          selectedBaseLayer,
          `Sea-level threshold model over global relief. Current level: ${Number(seaLevelSlider.value)} m.`,
        );
      }
      if (regionMaskActive) {
        pushActiveLayer(
          "Region mask",
          "modeled",
          selectedBaseLayer,
          `${regionMaskSelect.options[regionMaskSelect.selectedIndex].text} mask derived from elevation thresholds or curated regional envelopes.`,
        );
      }
      if (coreEnabled) {
        pushActiveLayer(
          "Interior cutaway",
          "core",
          selectedBaseLayer,
          "Interior layers are a schematic Mars model inferred from InSight seismic data, gravity measurements, and geochemical analysis.",
        );
      }

      sections.push({ title: "Active Layers", entries: activeLayers });

      const legendEntries = buildLegendEntries(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      if (legendEntries.length) {
        sections.push({ title: "Legend", entries: legendEntries });
      }

      sections.push({
        title: "Disclaimers",
        entries: [
          {
            title: "Educational use",
            copy: "This viewer is provided for educational, exploratory, and entertainment purposes only. It should not be used for navigation, mission planning, engineering decisions, or scientific analysis without independent verification.",
          },
          {
            title: "Mapping accuracy",
            copy: "Feature placement, layer alignment, labels, modeled overlays, and visual interpretations may be incomplete, generalized, outdated, or incorrect in places.",
          },
          {
            title: "External data sources",
            copy: "This experience uses external open-source and publicly available datasets from third-party scientific and mapping providers. GeoID: Explorer does not guarantee the accuracy, completeness, currency, or fitness of those source materials.",
          },
        ],
      });

      const sourceEntries = [];
      sourceEntries.push({
        title: selectedBaseLayer?.label || "Basemap source",
        copy: describeLayer(selectedBaseLayer),
        links: [makeMetadataLink("Source page", selectedBaseLayer?.source_page_url)].filter(Boolean),
      });
      if (selectedMineralLayer) {
        sourceEntries.push({
          title: `${selectedMineralLayer.label} mineral product`,
          copy: "ASU TES mineral abundance product.",
          links: [makeMetadataLink("TES mineral products", selectedMineralLayer.source_page_url)].filter(Boolean),
        });
      }
      if (
        (geologyToggle.checked && selectedGeologyLayer) ||
        geologyContactsToggle.checked ||
        activeStructureFacets.length
      ) {
        sourceEntries.push({
          title: "Geology references",
          copy: "Use the source pages below for the USGS, Geologic Map of Venus layer and related Venus geology references.",
          citation: manifest.sources.geology_original_units_citation || "",
          links: [
            makeMetadataLink("Geology notes", manifest.sources.geology_notes_url),
            makeMetadataLink("DMU document", manifest.sources.geology_dmu_url),
            makeMetadataLink("Geology map", manifest.sources.geology_map_url),
            makeMetadataLink("Geology database", manifest.sources.geology_database_url),
          ].filter(Boolean),
        });
      }
      sourceEntries.push({
        title: "Moon nomenclature",
        copy: "Phobos and Deimos feature names, locations, and classifications are derived from the IAU Working Group for Planetary System Nomenclature gazetteer, as maintained by the USGS Astrogeology Science Center.",
        links: [makeMetadataLink("USGS Planetary Nomenclature", "https://planetarynames.wr.usgs.gov/")],
      });
      sourceEntries.push({
        title: "Background music",
        copy: "Ambient space music licensed via Pixabay. Music by Nikita Kondrashev and Sigma Music Art.",
        links: [
          makeMetadataLink("Nikita Kondrashev — Space", "https://pixabay.com/music/space-space-440026/"),
          makeMetadataLink("Sigma Music Art — Space Ambient Background Music", "https://pixabay.com/music/space-space-ambient-background-music-462074/"),
        ],
      });
            sections.push({ title: "Sources", entries: sourceEntries });

      return {
        title: "Layer Metadata",
        subtitle: "Citations, provenance, and legend context for the current map state.",
        sections,
      };
    }

    function renderMetadataModal(state) {
      currentMetadataState = state;
      metadataTitle.textContent = state?.title || "Layer Metadata";
      metadataSubtitle.textContent = state?.subtitle || "Citations and provenance for the current map state.";
      metadataSections.innerHTML = "";
      for (const section of state?.sections || []) {
        if (!section.entries || !section.entries.length) {
          continue;
        }
        const sectionNode = document.createElement("section");
        sectionNode.className = "metadata-section";
        const title = document.createElement("h3");
        title.className = "metadata-section-title";
        title.textContent = section.title;
        sectionNode.appendChild(title);
        for (const entry of section.entries) {
          const entryTitle = document.createElement("p");
          entryTitle.className = "layer-type-badge";
          entryTitle.textContent = entry.title;
          sectionNode.appendChild(entryTitle);
          if (entry.copy) {
            const copy = document.createElement("p");
            copy.className = "metadata-section-copy";
            copy.textContent = entry.copy;
            sectionNode.appendChild(copy);
          }
          if (entry.citation) {
            const citation = document.createElement("p");
            citation.className = "metadata-citation";
            citation.textContent = entry.citation;
            sectionNode.appendChild(citation);
          }
          if (entry.tags && entry.tags.length) {
            const tags = document.createElement("div");
            tags.className = "result-chip-row";
            setTagRow(tags, entry.tags);
            sectionNode.appendChild(tags);
          }
          if (entry.symbols && entry.symbols.length) {
            const symbolList = document.createElement("div");
            symbolList.className = "legend-symbol-list";
            for (const symbolDef of entry.symbols) {
              if (symbolDef.type === "gradient") {
                symbolList.appendChild(buildGradientBlock(symbolDef));
                continue;
              }
              const row = document.createElement("div");
              row.className = "legend-symbol-row";
              const visual = document.createElement("span");
              if (symbolDef.type === "line") {
                visual.className = "legend-line";
                if (symbolDef.color) visual.style.borderTopColor = symbolDef.color;
              } else {
                visual.className = symbolDef.type === "dot" ? "legend-dot" : "legend-swatch";
                if (symbolDef.color) visual.style.background = symbolDef.color;
                if (symbolDef.borderColor) visual.style.borderColor = symbolDef.borderColor;
              }
              row.appendChild(visual);
              const copyWrap = document.createElement("div");
              copyWrap.className = "legend-symbol-copy";
              const label = document.createElement("div");
              label.className = "legend-symbol-label";
              label.textContent = symbolDef.label;
              copyWrap.appendChild(label);
              if (symbolDef.detail) {
                const detail = document.createElement("div");
                detail.className = "legend-symbol-detail";
                detail.textContent = symbolDef.detail;
                copyWrap.appendChild(detail);
              }
              row.appendChild(copyWrap);
              symbolList.appendChild(row);
            }
            sectionNode.appendChild(symbolList);
          }
          if (entry.image) {
            const image = document.createElement("img");
            image.className = "metadata-image";
            image.src = entry.image;
            image.alt = entry.title;
            sectionNode.appendChild(image);
          }
          if (entry.links && entry.links.length) {
            const links = document.createElement("div");
            links.className = "metadata-links";
            for (const linkDef of entry.links) {
              const link = document.createElement("a");
              link.className = "reference-link";
              link.href = linkDef.href;
              link.target = "_blank";
              link.rel = "noreferrer";
              link.textContent = linkDef.label;
              links.appendChild(link);
            }
            sectionNode.appendChild(links);
          }
        }
        metadataSections.appendChild(sectionNode);
      }
    }

    function buildGradientCSS(symbolDef) {
      if (symbolDef.stops && symbolDef.stops.length >= 2) {
        const parts = symbolDef.stops.map(([r, g, b]) => `rgb(${r},${g},${b})`).join(", ");
        return `linear-gradient(to right, ${parts})`;
      }
      return `linear-gradient(to right, ${symbolDef.colorA}, ${symbolDef.colorB})`;
    }

    function buildGradientBlock(symbolDef) {
      const block = document.createElement("div");
      block.className = "legend-gradient-block";
      const bar = document.createElement("div");
      bar.className = "legend-gradient-bar";
      bar.style.background = buildGradientCSS(symbolDef);
      block.appendChild(bar);
      const labels = document.createElement("div");
      labels.className = "legend-gradient-labels";
      const left = document.createElement("span");
      left.textContent = symbolDef.labelMin ?? symbolDef.label ?? "";
      labels.appendChild(left);
      if (symbolDef.labelMax) {
        const right = document.createElement("span");
        right.textContent = symbolDef.labelMax;
        labels.appendChild(right);
      }
      block.appendChild(labels);
      return block;
    }

    function renderLegendPanel(entries) {
      legendPanel.innerHTML = "";
      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "legend-empty";
        empty.textContent = "Enable geology, mineral, paleo-sea, or region mask overlays to populate the legend.";
        legendPanel.appendChild(empty);
        legendSummaryCopy.textContent = "Active overlay symbologies and legend images.";
        return;
      }

      legendSummaryCopy.textContent = `${entries.length} active legend ${entries.length === 1 ? "entry" : "entries"} for the current overlays.`;
      for (const entry of entries) {
        const card = document.createElement("section");
        card.className = "legend-entry";
        if (entry.title) {
          const title = document.createElement("p");
          title.className = "layer-type-badge";
          title.textContent = entry.title;
          card.appendChild(title);
        }
        if (entry.copy) {
          const copy = document.createElement("p");
          copy.className = "metadata-section-copy";
          copy.textContent = entry.copy;
          card.appendChild(copy);
        }
        if (entry.tags && entry.tags.length) {
          const tags = document.createElement("div");
          tags.className = "result-chip-row";
          setTagRow(tags, entry.tags);
          card.appendChild(tags);
        }
        if (entry.symbols && entry.symbols.length) {
          const symbolList = document.createElement("div");
          symbolList.className = "legend-symbol-list";
          for (const symbolDef of entry.symbols) {
            if (symbolDef.type === "gradient") {
              symbolList.appendChild(buildGradientBlock(symbolDef));
              continue;
            }
            const row = document.createElement("div");
            row.className = "legend-symbol-row";
            const visual = document.createElement("span");
            if (symbolDef.type === "line") {
              visual.className = "legend-line";
              if (symbolDef.color) visual.style.borderTopColor = symbolDef.color;
            } else {
              visual.className = symbolDef.type === "dot" ? "legend-dot" : "legend-swatch";
              if (symbolDef.color) visual.style.background = symbolDef.color;
              if (symbolDef.borderColor) visual.style.borderColor = symbolDef.borderColor;
            }
            row.appendChild(visual);
            const copyWrap = document.createElement("div");
            copyWrap.className = "legend-symbol-copy";
            const label = document.createElement("div");
            label.className = "legend-symbol-label";
            label.textContent = symbolDef.label;
            copyWrap.appendChild(label);
            if (symbolDef.detail) {
              const detail = document.createElement("div");
              detail.className = "legend-symbol-detail";
              detail.textContent = symbolDef.detail;
              copyWrap.appendChild(detail);
            }
            row.appendChild(copyWrap);
            symbolList.appendChild(row);
          }
          card.appendChild(symbolList);
        }
        if (entry.image) {
          const image = document.createElement("img");
          image.className = "legend-entry-image";
          image.src = entry.image;
          image.alt = entry.title;
          card.appendChild(image);
        }
        legendPanel.appendChild(card);
      }
    }

    function makeCacheKey(latDegrees, lonDegrees) {
      return `${Number(latDegrees).toFixed(4)}:${Number(lonDegrees).toFixed(4)}`;
    }

    function getCachedElevationNormalized(cache, sampler, latDegrees, lonDegrees) {
      if (!sampler) {
        return 0;
      }
      const key = makeCacheKey(latDegrees, lonDegrees);
      if (!cache.has(key)) {
        cache.set(key, sampleElevationNormalized(sampler, latDegrees, lonDegrees));
      }
      return cache.get(key);
    }

    function getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, latDegrees, lonDegrees, lift = 0) {
      const displacement = getCachedElevationNormalized(elevationCache, elevationSampler, latDegrees, lonDegrees) * getTerrainRelief();
      return latLonToVector3(latDegrees, lonDegrees, radius + displacement + lift);
    }

    function isGeologyFeature(feature) {
      return Boolean(
        feature && typeof feature.type === "string" && feature.type.toLowerCase().startsWith("geologic")
      );
    }

    function syncScenePopupSelectionStyle(feature, isCoreLabel = false) {
      const geologySelected = isGeologyFeature(feature) && !isCoreLabel;
      scenePopup.classList.toggle("is-geology-selected", geologySelected);
      scenePopupAnchor.classList.toggle("is-geology-selected", geologySelected);
      if (!scenePopupState) {
        return;
      }
      if (!feature) {
        scenePopupState.hidden = true;
        scenePopupState.classList.remove("is-geology-selected");
        scenePopupState.textContent = "";
        return;
      }
      const moonViewerSelected = Boolean(
        activeMoonViewerFeature
        && feature
        && Array.isArray(feature.moon_anchor)
        && feature.name === activeMoonViewerFeature.name
      );
      scenePopup.classList.toggle("is-moon-viewer-selected", moonViewerSelected && !isCoreLabel);
      scenePopupAnchor.classList.toggle("is-moon-viewer-selected", moonViewerSelected && !isCoreLabel);
      scenePopupState.hidden = false;
      scenePopupState.classList.toggle("is-geology-selected", geologySelected);
      scenePopupState.textContent = geologySelected
        ? "Active geology selection"
        : moonViewerSelected
          ? "Moon viewer"
          : "Current focus";
    }

    function isMoonViewerSelectedFeature(feature) {
      const parentMoon = getMoonFeatureParent(feature);
      return Boolean(
        activeMoonViewerFeature
        && (
          (isMoonFeature(feature) && feature.name === activeMoonViewerFeature.name)
          || (parentMoon && parentMoon.name === activeMoonViewerFeature.name)
        )
      );
    }

    function isMoonFeature(feature) {
      return Boolean(feature && Array.isArray(feature.moon_anchor));
    }

    function getMoonFeatureIndex(feature) {
      if (!feature) {
        return -1;
      }
      return moonData.findIndex((item) => item.name === feature.name);
    }

    function getMoonFeatureByIndex(index) {
      if (!moonData.length) {
        return null;
      }
      const wrapped = ((index % moonData.length) + moonData.length) % moonData.length;
      return moonData[wrapped] || null;
    }

    function getMoonFeatureParent(feature) {
      if (!feature?.moon_name) {
        return null;
      }
      return moonData.find((item) => item.name === feature.moon_name) || null;
    }

    function getMoonSurfaceFeaturePoint(feature, lift = 0.01) {
      const parentMoon = getMoonFeatureParent(feature);
      if (!parentMoon) {
        return null;
      }
      const lat = feature.lat !== undefined ? feature.lat : feature.anchor_lat;
      const lon = feature.lon !== undefined ? feature.lon : feature.anchor_lon;
      if (lat === undefined || lon === undefined || !Array.isArray(parentMoon.moon_anchor)) {
        return null;
      }
      const moonAnchor = new THREE.Vector3(parentMoon.moon_anchor[0], parentMoon.moon_anchor[1], parentMoon.moon_anchor[2]);
      return moonLatLonToVector3(lat, lon, Number(parentMoon.moon_radius || 0.1) + lift).add(moonAnchor);
    }

    function getMoonViewerDistance(feature) {
      const radius = Number(feature?.moon_radius || 0.1);
      return THREE.MathUtils.clamp(radius * 4.5, 0.04, 1.2);
    }

    function getMoonViewerMinDistance(feature) {
      const radius = Number(feature?.moon_radius || 0.1);
      return Math.max(radius * 1.08, 0.025);
    }

    function getMoonViewerMaxDistance(feature) {
      // Bubble limit: cap zoom-out at 4× the default entry distance so the moon
      // stays the clear focus. The global 3.6 fallback would allow 100+ moon-radii
      // of zoom-out for small bodies like Phobos/Deimos, making them invisible specks.
      return getMoonViewerDistance(feature) * 4;
    }

    function normalizeNomenclatureText(text) {
      let normalized = String(text || "")
        .trim()
        .replace(/\s+/g, " ")
        .replace(/^Name of\s+/i, "")
        .replace(/^Mythological\s+/i, "")
        .replace(/\.$/, "");
      normalized = normalized
        .replace(/^Lake in\b/i, "a lake in")
        .replace(/^Mountain\b/i, "a mountain")
        .replace(/^Island\b/i, "an island")
        .replace(/^mother\b/i, "the mother")
        .replace(/^father\b/i, "the father");
      return normalized;
    }

    function moonFeatureKind(feature) {
      const type = String(feature?.type || "").toLowerCase();
      const name = String(feature?.name || "").toLowerCase();
      const content = `${type} ${name}`;
      if (/crater|large ringed feature/.test(content)) return "impact crater";
      if (/catena/.test(content)) return "crater chain";
      if (/chasma|chasmata|fossa|fossae|linea|lineae|labyrinthus/.test(content)) return "tectonic fracture system";
      if (/dorsum|dorsa/.test(content)) return "ridge system";
      if (/mons|montes/.test(content)) return "mountainous terrain";
      if (/planitia|planitiae/.test(content)) return "plain";
      if (/regio|regiones|macula|maculae|facula|faculae|arcus|insula/.test(content)) return "albedo or regional terrain unit";
      return String(feature?.type || "surface feature").toLowerCase();
    }

    function moonFeatureScienceDescription(feature) {
      if (!feature?.moon_name) return feature?.description || feature?.type || "";
      const kind = moonFeatureKind(feature);
      const moon = feature.moon_name;
      const coordinate = Number.isFinite(feature.lat) && Number.isFinite(feature.lon)
        ? ` near ${feature.lat.toFixed(1)}°, ${feature.lon.toFixed(1)}°E`
        : "";
      const dimension = feature.dimension ? ` ${feature.dimension}.` : "";
      const interpretation = feature.interpretation ? ` Interpreted as ${String(feature.interpretation).toLowerCase()}.` : "";
      let base;
      if (/impact crater/.test(kind)) {
        base = `An impact crater on ${moon}${coordinate}, useful for reading crater density, surface age, and local degradation.`;
      } else if (/tectonic fracture|ridge/.test(kind)) {
        base = `A mapped ${kind} on ${moon}${coordinate}, recording brittle deformation of the icy crust.`;
      } else {
        base = `A mapped ${kind} on ${moon}${coordinate}.`;
      }
      return `${base}${dimension}${interpretation}`.trim();
    }

    function isLikelyNomenclatureDescription(feature) {
      const text = String(feature?.description || "").trim();
      if (!feature?.moon_name || !text) return false;
      if (/\b(on|of)\s+(Phobos|Deimos)\b/i.test(text)) return false;
      if (/\b(impact|tectonic|fracture|cratered|terrain|basin|ridge|scarps|fossa|chasma|catena|crust)\b/i.test(text)) return false;
      return /\b(god|goddess|myth|mythological|fictional|dune|queen|king|wife|husband|father|mother|son|daughter|ancestor|hero|deity|nymph|prophet|river of paradise|lake in|mountain|island|named|name of|worshipped|creator|created|people|tribe|author|astronomer|mathematician|writer)\b/i.test(text);
    }

    function formatMoonFeatureDescription(feature, { includeNomenclature = true } = {}) {
      if (!feature?.moon_name) {
        return feature?.description || feature?.type || feature?.name || "";
      }
      const science = moonFeatureScienceDescription(feature);
      if (!includeNomenclature || !isLikelyNomenclatureDescription(feature)) {
        return science || feature.description || feature.type || feature.name || "";
      }
      const nomenclature = normalizeNomenclatureText(feature.description);
      return nomenclature
        ? `${science} Named after ${nomenclature}.`
        : science;
    }

    function populateMoonFeatureTypes(moonName) {
      if (!moonFeatureTypeSelect) return;
      const types = new Map();
      if (moonName) {
        moonFeatureData.forEach((f) => {
          if (f.moon_name === moonName && f.type) {
            types.set(f.type, (types.get(f.type) || 0) + 1);
          }
        });
      }
      moonFeatureTypeSelect.innerHTML = "";
      const allOpt = document.createElement("option");
      allOpt.value = "all";
      allOpt.textContent = `All features (${moonFeatureData.filter((f) => f.moon_name === moonName).length})`;
      moonFeatureTypeSelect.appendChild(allOpt);
      [...types.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([type, count]) => {
        const opt = document.createElement("option");
        opt.value = type;
        opt.textContent = `${type} (${count})`;
        moonFeatureTypeSelect.appendChild(opt);
      });
      moonFeatureTypeSelect.value = "all";
      moonFeatureTypeFilter = "all";
      populateMoonFeatureTourTargets();
    }

    function getMoonFeatureTourFeatures() {
      if (!activeMoonViewerFeature) return [];
      return moonFeatureData.filter((f) =>
        f.moon_name === activeMoonViewerFeature.name &&
        (moonFeatureTypeFilter === "all" || f.type === moonFeatureTypeFilter)
      );
    }

    function populateMoonFeatureTourTargets(selectedName = activeMoonFeatureTour?.name || "") {
      if (!moonFeatureTourTarget) return;
      const features = getMoonFeatureTourFeatures();
      moonFeatureTourTarget.innerHTML = "";
      for (const feature of features) {
        const option = document.createElement("option");
        option.value = feature.name;
        option.textContent = feature.name;
        moonFeatureTourTarget.appendChild(option);
      }
      if (features.some((f) => f.name === selectedName)) {
        moonFeatureTourTarget.value = selectedName;
      } else if (features[0]) {
        moonFeatureTourTarget.value = features[0].name;
      }
      const hasMultiple = features.length > 1;
      if (moonFeatureTourPrev) moonFeatureTourPrev.disabled = !hasMultiple;
      if (moonFeatureTourNext) moonFeatureTourNext.disabled = !hasMultiple;
    }

    function focusMoonFeatureTour(feature) {
      if (!feature) return;
      activeMoonFeatureTour = feature;
      if (moonFeatureTourTarget) moonFeatureTourTarget.value = feature.name;
      if (viewerCamera && viewerControls) {
        const parentMoon = getMoonFeatureParent(feature);
        const closeUpDist = parentMoon ? getMoonViewerMinDistance(parentMoon) : undefined;
        moveCameraToFeature(feature, viewerCamera, viewerControls, { animate: true, isTour: true, distance: closeUpDist });
        openFeature(feature, false);
      }
    }

    function cycleMoonFeatureTour(direction) {
      const features = getMoonFeatureTourFeatures();
      if (!features.length) return;
      const currentName = activeMoonFeatureTour?.name || moonFeatureTourTarget?.value || features[0].name;
      const currentIndex = Math.max(0, features.findIndex((f) => f.name === currentName));
      const next = features[((currentIndex + direction) % features.length + features.length) % features.length];
      focusMoonFeatureTour(next);
    }

    function renderMoonFeatureSearchResults(results, preserveIndex = false) {
      activeMoonFeatureSearchResults = results;
      if (!results.length) {
        activeMoonFeatureSearchIndex = -1;
      } else if (!preserveIndex || activeMoonFeatureSearchIndex < 0) {
        activeMoonFeatureSearchIndex = 0;
      } else {
        activeMoonFeatureSearchIndex = Math.min(activeMoonFeatureSearchIndex, results.length - 1);
      }
      if (!moonFeatureSearchResults) return;
      moonFeatureSearchResults.innerHTML = "";
      if (!results.length) {
        moonFeatureSearchResults.hidden = true;
        return;
      }
      for (const [index, item] of results.entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-suggestion" + (index === activeMoonFeatureSearchIndex ? " is-active" : "");
        button.textContent = item.name;
        const meta = document.createElement("span");
        meta.className = "search-suggestion-meta";
        meta.textContent = item.type || "Feature";
        button.appendChild(meta);
        button.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          moveCameraToFeature(item, viewerCamera, viewerControls, { animate: true });
          openFeature(item, false);
          clearMoonFeatureSearchResults(true);
        });
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          moveCameraToFeature(item, viewerCamera, viewerControls, { animate: true });
          openFeature(item, false);
          clearMoonFeatureSearchResults(true);
        });
        moonFeatureSearchResults.appendChild(button);
      }
      moonFeatureSearchResults.hidden = false;
    }

    function clearMoonFeatureSearchResults(resetInput = false) {
      if (resetInput && moonFeatureSearchInput) moonFeatureSearchInput.value = "";
      if (moonFeatureSearchResults) {
        moonFeatureSearchResults.hidden = true;
        moonFeatureSearchResults.innerHTML = "";
      }
      activeMoonFeatureSearchResults = [];
      activeMoonFeatureSearchIndex = -1;
    }

    function refreshMoonFeatureSearch() {
      if (!moonFeatureSearchInput || !moonFeatureSearchResults || !activeMoonViewerFeature) return;
      const query = String(moonFeatureSearchInput.value || "").trim().toLowerCase();
      const results = moonFeatureData
        .filter((f) => f.moon_name === activeMoonViewerFeature.name && (!query || f.name.toLowerCase().includes(query)))
        .slice(0, 12);
      renderMoonFeatureSearchResults(results);
    }

    function syncMoonViewerControls(feature = activeMoonViewerFeature) {
      if (moonViewerSelect && feature) {
        moonViewerSelect.value = feature.name;
      }
      if (moonViewerToggle) {
        moonViewerToggle.checked = Boolean(feature);
      }
      if (moonViewerSection) {
        moonViewerSection.open = Boolean(feature);
      }
      if (moonViewerControls) {
        moonViewerControls.style.display = Boolean(feature) ? "" : "none";
      }
      const hasMoon = moonData.length > 0;
      const isActive = Boolean(feature);
      if (moonViewerPrev) {
        moonViewerPrev.disabled = !hasMoon || !isActive;
      }
      if (moonViewerNext) {
        moonViewerNext.disabled = !hasMoon || !isActive;
      }
      populateMoonFeatureTypes(feature ? feature.name : "");
      if (!feature) activeMoonFeatureTour = null;
    }

    function syncMoonViewerPopup(feature = activePopupFeature, isCoreLabel = activePopupIsCoreLabel) {
      // Always dock to bottom-right for all features including core labels (rocky planet — no floating popup tracking).
      const shouldDock = Boolean(feature);
      scenePopup.classList.toggle("is-moon-viewer-selected", shouldDock);
      scenePopupAnchor.classList.toggle("is-moon-viewer-selected", shouldDock);
      if (shouldDock) {
        scenePopup.hidden = false;
        scenePopupAnchor.hidden = true;
        scenePopup.style.left = "";
        scenePopup.style.top = "";
        scenePopupAnchor.style.left = "";
        scenePopupAnchor.style.top = "";
      }
    }

    function deactivateMoonViewer(camera, controls) {
      activeMoonViewerFeature = null;
      moonNavContext = "moon";
      document.documentElement.removeAttribute("data-mode");
      controls.minDistance = DEFAULT_CONTROL_MIN_DISTANCE;
      controls.maxDistance = DEFAULT_CONTROL_MAX_DISTANCE;
      controls.target.set(0, 0, 0);
      if (typeof applyPlanetDisplayState === "function") {
        applyPlanetDisplayState();
      }
      syncMoonViewerControls(null);
      syncScenePopupSelectionStyle(activePopupFeature);
      syncMoonViewerPopup(activePopupFeature);
      _resetMeasurementOnContextSwitch?.(true);
      if (camera) {
        camera.near = 0.1;
        camera.updateProjectionMatrix();
      }
      if (camera && controls) {
        controls.object.position.copy(camera.position);
        controls.update();
      }
      resetStatus();
    }

    function activateMoonViewer(feature, camera, controls) {
      if (!isMoonFeature(feature) || !venusSceneGroup) {
        return;
      }
      document.documentElement.setAttribute("data-mode", "moon");
      if (moonViewerSection) {
        setTimeout(() => {
          moonViewerSection.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 50);
      }
      cancelCameraFlight();
      deactivateTourMode();
      activeMoonViewerFeature = feature;
      // Reset _globalVisible so the first frame in moon viewer uses a clean layout
      // pass rather than inheriting full-size label state from any prior global view.
      if (typeof labelLayer !== "undefined" && labelLayer && Array.isArray(labelLayer.entries)) {
        for (const e of labelLayer.entries) {
          e._globalVisible = false;
        }
      }
      if (typeof applyPlanetDisplayState === "function") {
        applyPlanetDisplayState();
      }
      if (camera) {
        camera.near = 0.02;
        camera.updateProjectionMatrix();
      }
      controls.minDistance = getMoonViewerMinDistance(feature);
      controls.maxDistance = getMoonViewerMaxDistance(feature);
      const localTarget = new THREE.Vector3(feature.moon_anchor[0], feature.moon_anchor[1], feature.moon_anchor[2]);
      const target = venusSceneGroup.localToWorld(localTarget.clone());
      const direction = target.clone().normalize();
      if (direction.lengthSq() < 0.0001) {
        direction.set(0.55, 0.18, 1).normalize();
      }
      // Offset the entry angle so Mars isn't dead-centre behind the moon.
      const _up = new THREE.Vector3(0, 1, 0);
      const _side = new THREE.Vector3().crossVectors(direction, _up).normalize();
      if (_side.lengthSq() > 0.0001) {
        direction.addScaledVector(_side, 0.4).addScaledVector(_up, 0.15).normalize();
      }
      camera.position.copy(target.clone().addScaledVector(direction, getMoonViewerDistance(feature)));
      camera.up.set(0, 1, 0);
      controls.target.copy(target);
      controls.object.position.copy(camera.position);
      controls.update();
      syncMoonViewerControls(feature);
      openFeature(feature, false);
      _resetMeasurementOnContextSwitch?.(false);
      // Re-assert moon foreground state on the next frame so it wins even if the
      // activating click also triggers late overlay/section handlers.
      requestAnimationFrame(() => {
        if (activeMoonViewerFeature?.name === feature.name && typeof applyPlanetDisplayState === "function") {
          applyPlanetDisplayState();
        }
      });
    }

    function cycleMoonViewer(direction, camera, controls) {
      if (!activeMoonViewerFeature) {
        return;
      }
      const startIndex = activeMoonViewerFeature
        ? getMoonFeatureIndex(activeMoonViewerFeature)
        : (direction >= 0 ? -1 : 0);
      const nextFeature = getMoonFeatureByIndex(startIndex + direction);
      if (!nextFeature) {
        return;
      }
      activateMoonViewer(nextFeature, camera, controls);
      setStatus(`Moon viewer locked on ${nextFeature.name}.`);
    }

    function showViewerErrorState(message) {
      app.innerHTML = `
        <div class="webgl-fallback">
          <div class="webgl-fallback-card">
            <p class="eyebrow">Viewer Error</p>
            <h2 style="margin:0 0 0.6rem;">Venus viewer could not start.</h2>
            <p class="copy" style="margin:0 0 0.7rem;">${message}</p>
            <p class="compact-copy">Check WebGL support, local asset availability, or the browser console for more detail.</p>
          </div>
        </div>
      `;
      cursorReadout.hidden = true;
      scaleReadout.hidden = true;
      scaleReadout.style.removeProperty("--scale-bar-width");
      hoverTooltip.hidden = true;
    }

    function findFeatureByName(name) {
      const needle = String(name || "").trim().toLowerCase();
      if (!needle) {
        return null;
      }
      const pool = allFeatureData;
      return pool.find((item) => item.name.toLowerCase() === needle)
        || pool.find((item) => item.name.toLowerCase().startsWith(needle));
    }

    function normalizeSearchText(value) {
      return String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
    }

    function getPredictiveNameMatches(query, maxResults = 25) {
      const needle = normalizeSearchText(query);
      if (!needle) {
        return [];
      }
      return allFeatureData
        .filter((item) => normalizeSearchText(item.name).startsWith(needle))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, maxResults);
    }

    function rankFeatureMatches(query, maxResults = 25) {
      const needle = String(query || "").trim().toLowerCase();
      if (!needle) {
        return [];
      }
      const pool = allFeatureData;
      return pool
        .map((item) => {
          const name = String(item.name || "").toLowerCase();
          if (!name.startsWith(needle)) {
            return { item, score: 0 };
          }
          let score = 0;
          if (name === needle) {
            score = 1000;
          } else if (name.startsWith(needle)) {
            score = 700 - name.length;
          }
          if (item.theme === "landing") {
            score += 12;
          }
          return { item, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
        .slice(0, maxResults)
        .map((entry) => entry.item);
    }

    function getFeatureBodyLabel(feature) {
      if (!feature) {
        return "";
      }
      if (feature.moon_name) {
        return feature.moon_name;
      }
      if (Array.isArray(feature.moon_anchor)) {
        return feature.name || "Moon";
      }
      if (feature.ring_region || /ring/i.test(feature.name || "")) {
        return "Venus";
      }
      return "Venus";
    }

    function renderFeatureSearchResults(results, preserveIndex = false) {
      activeSearchResults = results;
      if (!results.length) {
        activeSearchIndex = -1;
      } else if (!preserveIndex || activeSearchIndex < 0) {
        activeSearchIndex = 0;
      } else {
        activeSearchIndex = Math.min(activeSearchIndex, results.length - 1);
      }
      featureSearchResults.innerHTML = "";
      if (!results.length) {
        featureSearchResults.hidden = true;
        return;
      }
      for (const [index, item] of results.entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-suggestion" + (index === activeSearchIndex ? " is-active" : "");
        button.innerHTML = `${item.name}<span class="search-suggestion-meta">${item.type || "Mapped feature"} | ${getFeatureBodyLabel(item)}</span>`;
        button.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          focusSearchedFeature(item, viewerCamera, viewerControls);
        });
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          focusSearchedFeature(item, viewerCamera, viewerControls);
        });
        featureSearchResults.appendChild(button);
      }
      featureSearchResults.hidden = false;
    }

    function clearFeatureSearchResults(resetInput = false) {
      if (resetInput) {
        featureSearch.value = "";
      }
      featureSearchResults.hidden = true;
      featureSearchResults.innerHTML = "";
      activeSearchResults = [];
      activeSearchIndex = -1;
    }

    function resolveFeatureSearchSelection() {
      const typedValue = String(featureSearch.value || "").trim();
      if (!typedValue) {
        return null;
      }
      if (activeSearchResults.length) {
        if (activeSearchIndex >= 0 && activeSearchIndex < activeSearchResults.length) {
          return activeSearchResults[activeSearchIndex];
        }
        return activeSearchResults[0];
      }
      return findFeatureByName(typedValue) || rankFeatureMatches(typedValue, 1)[0] || null;
    }

    let activeCameraFlight = null;
    let activeTourModeFeature = null;
    let activeTourModeFacetId = TOUR_MODE_FACETS[0]?.id || "highlights";
    let activeTourFlightTimeout = null;

    function clearPendingTourFlight() {
      if (activeTourFlightTimeout) {
        window.clearTimeout(activeTourFlightTimeout);
        activeTourFlightTimeout = null;
      }
    }

    function getTourFacetById(facetId = activeTourModeFacetId) {
      return TOUR_MODE_FACETS.find((facet) => facet.id === facetId) || TOUR_MODE_FACETS[0] || null;
    }

    function getTourFeaturesByFacet(facetId = activeTourModeFacetId) {
      const facet = getTourFacetById(facetId);
      if (!facet) {
        return [];
      }
      return labelData.filter((item) => facet.matches(item));
    }

    function populateTourTargetOptions(facetId = activeTourModeFacetId, selectedName = activeTourModeFeature?.name || "") {
      if (!tourModeTarget) {
        return;
      }
      const features = getTourFeaturesByFacet(facetId);
      tourModeTarget.innerHTML = "";
      for (const feature of features) {
        const option = document.createElement("option");
        option.value = feature.name;
        option.textContent = feature.name;
        tourModeTarget.appendChild(option);
      }
      if (features.some((feature) => feature.name === selectedName)) {
        tourModeTarget.value = selectedName;
      } else if (features.length) {
        tourModeTarget.value = features[0].name;
      }
    }

    function getTourFeatureIndex(feature, facetId = activeTourModeFacetId) {
      if (!feature) {
        return -1;
      }
      return getTourFeaturesByFacet(facetId).findIndex((item) => item.name === feature.name);
    }

    function getTourFeatureByIndex(index, facetId = activeTourModeFacetId) {
      const features = getTourFeaturesByFacet(facetId);
      if (!features.length) {
        return null;
      }
      const wrapped = ((index % features.length) + features.length) % features.length;
      return features[wrapped];
    }

    function syncTourModeControls(feature = activeTourModeFeature) {
      const facet = getTourFacetById(activeTourModeFacetId);
      const features = getTourFeaturesByFacet(activeTourModeFacetId);
      if (tourModeFacet) {
        tourModeFacet.value = facet?.id || "";
      }
      populateTourTargetOptions(activeTourModeFacetId, feature?.name || "");
      if (tourModeToggle) {
        tourModeToggle.checked = Boolean(feature);
      }
      if (tourModeSection) {
        tourModeSection.open = Boolean(feature);
      }
      if (tourModeControls) {
        tourModeControls.style.display = Boolean(feature) ? "" : "none";
      }
      if (tourModePrev) {
        tourModePrev.disabled = !feature || features.length <= 1;
      }
      if (tourModeNext) {
        tourModeNext.disabled = !feature || features.length <= 1;
      }
    }

    function deactivateTourMode() {
      clearPendingTourFlight();
      activeTourModeFeature = null;
      syncTourModeControls(null);
      resetStatus();
    }

    function ensureNavigateBasemap() {
      if (!baseLayerSelect || baseLayerSelect.value === DEFAULT_NAVIGATE_BASE_LAYER_ID) {
        return;
      }
      const targetOption = baseLayerSelect.querySelector(`option[value="${DEFAULT_NAVIGATE_BASE_LAYER_ID}"]`);
      if (!targetOption) {
        return;
      }
      baseLayerSelect.value = DEFAULT_NAVIGATE_BASE_LAYER_ID;
      baseLayerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function presentTourFeature(feature, camera, controls, statusPrefix = "Touring") {
      if (!feature) {
        return;
      }
      activeTourModeFeature = feature;
      clearPendingTourFlight();
      openFeature(feature, false);
      syncTourModeControls(feature);
      activeTourFlightTimeout = window.setTimeout(() => {
        activeTourFlightTimeout = null;
        moveCameraToFeature(feature, camera, controls, { animate: true, isTour: true });
      }, 700);
      setStatus(`${statusPrefix} ${feature.name}.`);
    }

    function cycleTourMode(direction, camera, controls) {
      const currentIndex = activeTourModeFeature
        ? getTourFeatureIndex(activeTourModeFeature, activeTourModeFacetId)
        : (direction >= 0 ? -1 : 0);
      const nextFeature = getTourFeatureByIndex(currentIndex + direction, activeTourModeFacetId);
      if (!nextFeature) {
        return;
      }
      presentTourFeature(nextFeature, camera, controls, "Tour stop");
    }

    function cancelCameraFlight() {
      if (activeCameraFlight) {
        activeCameraFlight.cancelled = true;
        activeCameraFlight = null;
      }
    }

    function animateCameraFlight(camera, controls, nextPosition, nextTarget, durationMs = 1400, onComplete = null) {
      if (!camera || !controls || !nextPosition || !nextTarget) {
        onComplete?.();
        return;
      }
      cancelCameraFlight();
      const flight = {
        cancelled: false,
        startAt: performance.now(),
        startPosition: camera.position.clone(),
        startTarget: controls.target.clone(),
        endPosition: nextPosition.clone(),
        endTarget: nextTarget.clone(),
        durationMs,
        onComplete,
      };
      activeCameraFlight = flight;

      const step = (now) => {
        if (flight.cancelled) {
          return;
        }
        const t = Math.min(1, (now - flight.startAt) / Math.max(flight.durationMs, 1));
        const eased = 1 - ((1 - t) ** 3);
        camera.position.lerpVectors(flight.startPosition, flight.endPosition, eased);
        controls.target.lerpVectors(flight.startTarget, flight.endTarget, eased);
        controls.object.position.copy(camera.position);
        controls.update();
        if (t < 1) {
          requestAnimationFrame(step);
          return;
        }
        activeCameraFlight = null;
        flight.onComplete?.();
      };

      requestAnimationFrame(step);
    }

    // Tour-mode arc flight: pulls camera up to a cruise altitude at mid-flight,
    // slews across the planet surface via a spherical arc, then descends to the
    // destination view height. Produces a clear "lift off → glide → land" feel.
    function animateTourFlight(camera, controls, nextPosition, nextTarget, durationMs = 2800, onComplete = null) {
      if (!camera || !controls || !nextPosition || !nextTarget) {
        onComplete?.();
        return;
      }
      cancelCameraFlight();

      const startPosition = camera.position.clone();
      const startTarget = controls.target.clone();
      const startDist = startPosition.length();
      const endDist = nextPosition.length();
      const startDir = startDist > 0.0001 ? startPosition.clone().normalize() : new THREE.Vector3(0, 1, 0);
      const endDir = endDist > 0.0001 ? nextPosition.clone().normalize() : startDir.clone();

      // Cruise altitude: always pull back to at least this distance from the planet centre
      const TOUR_GLOBE_R = 3.2;
      const CRUISE_DIST = Math.max(startDist, endDist, TOUR_GLOBE_R * 2.1);

      // Dot product for slerp; clamp to avoid acos NaN
      const dot = Math.max(-1, Math.min(1, startDir.dot(endDir)));
      const angle = Math.acos(dot);
      const sinAngle = Math.sin(angle);

      const flight = {
        cancelled: false,
        startAt: performance.now(),
        durationMs,
        onComplete,
      };
      activeCameraFlight = flight;

      const step = (now) => {
        if (flight.cancelled) return;

        const t = Math.min(1, (now - flight.startAt) / Math.max(flight.durationMs, 1));
        // Smooth ease-in/out (cubic) for direction and target progress
        const easedT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        // Spherical interpolation of camera direction (great-circle arc over the planet)
        let currentDir;
        if (sinAngle < 0.0001) {
          currentDir = startDir.clone();
        } else {
          const w1 = Math.sin((1 - easedT) * angle) / sinAngle;
          const w2 = Math.sin(easedT * angle) / sinAngle;
          currentDir = new THREE.Vector3(
            w1 * startDir.x + w2 * endDir.x,
            w1 * startDir.y + w2 * endDir.y,
            w1 * startDir.z + w2 * endDir.z,
          ).normalize();
        }

        // Distance: linear base between start/end radii + sine-arc bump to cruise altitude.
        // Raw t (not eased) keeps the altitude peak at the geometric midpoint.
        const baseDist = startDist + (endDist - startDist) * easedT;
        const bump = Math.sin(t * Math.PI) * Math.max(CRUISE_DIST - baseDist, 0);
        const currentDist = baseDist + bump;

        camera.position.copy(currentDir).multiplyScalar(currentDist);
        controls.target.lerpVectors(startTarget, nextTarget, easedT);
        controls.object.position.copy(camera.position);
        controls.update();

        if (t < 1) {
          requestAnimationFrame(step);
          return;
        }
        activeCameraFlight = null;
        flight.onComplete?.();
      };

      requestAnimationFrame(step);
    }

    function focusSearchedFeature(feature, camera, controls) {
      if (!feature) {
        setStatus("Feature search did not match a mapped feature.", true);
        return false;
      }
      ensureNavigateBasemap();
      featureSearch.value = feature.name;
      const _searchParentMoon = getMoonFeatureParent(feature);
      moveCameraToFeature(feature, camera, controls, {
        animate: true,
        onComplete: () => openFeature(feature, false),
        ...(_searchParentMoon ? { distance: getMoonViewerMinDistance(_searchParentMoon) * 1.5 } : {}),
      });
      clearFeatureSearchResults();
      setStatus(`Focused on ${feature.name}.`);
      return true;
    }

    function moveCameraToFeature(feature, camera, controls, options = {}) {
      const animate = Boolean(options.animate);
      const onComplete = typeof options.onComplete === "function" ? options.onComplete : null;
      if (!feature) {
        return;
      }
      const parentMoon = getMoonFeatureParent(feature);
      const isMoonScopedTarget = isMoonFeature(feature) || Boolean(parentMoon);
      if (!isMoonScopedTarget) {
        pauseSpin();
        if (activeTourModeFeature && activeTourModeFeature.name !== feature.name) {
          activeTourModeFeature = feature;
          syncTourModeControls(feature);
        }
      }
      if (!isMoonScopedTarget && activeMoonViewerFeature) {
        deactivateMoonViewer(camera, controls);
      }
      if (isMoonFeature(feature)) {
        if (!options.isTour) {
          activateMoonViewer(feature, camera, controls);
          onComplete?.();
        } else {
          // Tour mode: orbit the moon without switching to moon viewer
          resumeSpin();
          if (venusSceneGroup) {
            const _tourTarget = venusSceneGroup.localToWorld(
              new THREE.Vector3(feature.moon_anchor[0], feature.moon_anchor[1], feature.moon_anchor[2])
            );
            const _dir = _tourTarget.clone().normalize();
            if (_dir.lengthSq() < 0.0001) _dir.set(0.55, 0.18, 1);
            _dir.normalize();
            const _side = new THREE.Vector3().crossVectors(_dir, new THREE.Vector3(0, 1, 0)).normalize();
            if (_side.lengthSq() > 0.0001) _dir.addScaledVector(_side, 0.4).addScaledVector(new THREE.Vector3(0, 1, 0), 0.15).normalize();
            const _pos = _tourTarget.clone().addScaledVector(_dir, getMoonViewerDistance(feature));
            if (animate) {
              animateCameraFlight(camera, controls, _pos, _tourTarget, 1800, onComplete || null);
            } else {
              camera.position.copy(_pos);
              camera.up.set(0, 1, 0);
              controls.target.copy(_tourTarget);
              controls.object.position.copy(camera.position);
              controls.update();
              onComplete?.();
            }
          }
        }
        return;
      }
      if (parentMoon) {
        const lat = feature.lat !== undefined ? feature.lat : feature.anchor_lat;
        const lon = feature.lon !== undefined ? feature.lon : feature.anchor_lon;
        if (!parentMoon || !venusSceneGroup || !Array.isArray(parentMoon.moon_anchor) || lat === undefined || lon === undefined) {
          return;
        }
        activeMoonViewerFeature = parentMoon;
        _resetMeasurementOnContextSwitch?.(false);
        if (typeof applyPlanetDisplayState === "function") {
          applyPlanetDisplayState();
        }
        controls.minDistance = getMoonViewerMinDistance(parentMoon);
        controls.maxDistance = getMoonViewerMaxDistance(parentMoon);
        const moonAnchor = new THREE.Vector3(parentMoon.moon_anchor[0], parentMoon.moon_anchor[1], parentMoon.moon_anchor[2]);
        const _relToCenter = moonLatLonToVector3(lat, lon, Number(parentMoon.moon_radius || 0.1) + 0.002);
        // Apply the moon's current self-rotation so the camera flies to where the
        // feature actually sits on the spinning texture (same transform as the
        // animation loop applies to feature marker positions).
        const _moonAngle = parentMoon._currentAngle || 0;
        if (_moonAngle !== 0) {
          const _cosA = Math.cos(_moonAngle);
          const _sinA = Math.sin(_moonAngle);
          _relToCenter.set(
            _relToCenter.x * _cosA - _relToCenter.z * _sinA,
            _relToCenter.y,
            _relToCenter.x * _sinA + _relToCenter.z * _cosA,
          );
        }
        const targetLocal = _relToCenter.add(moonAnchor);
        const target = venusSceneGroup.localToWorld(targetLocal.clone());
        const moonCenter = venusSceneGroup.localToWorld(moonAnchor.clone());
        const direction = target.clone().sub(moonCenter).normalize();
        if (direction.lengthSq() < 0.0001) {
          direction.set(0.55, 0.18, 1).normalize();
        }
        const flyDist = options.distance !== undefined ? options.distance : getMoonViewerDistance(parentMoon);
        const nextPosition = target.clone().addScaledVector(direction, flyDist);
        camera.up.set(0, 1, 0);
        if (animate) {
          animateCameraFlight(camera, controls, nextPosition, moonCenter, 1400, () => {
            syncMoonViewerControls(parentMoon);
            onComplete?.();
          });
        } else {
          cancelCameraFlight();
          camera.position.copy(nextPosition);
          controls.target.copy(moonCenter);
          controls.object.position.copy(camera.position);
          controls.update();
          syncMoonViewerControls(parentMoon);
          onComplete?.();
        }
        return;
      }
      let target = null;
      if (Array.isArray(feature.ring_anchor)) {
        target = new THREE.Vector3(feature.ring_anchor[0], feature.ring_anchor[1], feature.ring_anchor[2]);
        if (venusSceneGroup) {
          target = venusSceneGroup.localToWorld(target.clone());
        }
      } else if (Array.isArray(feature.moon_anchor)) {
        target = new THREE.Vector3(feature.moon_anchor[0], feature.moon_anchor[1], feature.moon_anchor[2]);
        if (venusSceneGroup) {
          target = venusSceneGroup.localToWorld(target.clone());
        }
      } else {
        const lat = feature.lat !== undefined ? feature.lat : feature.anchor_lat;
        const lon = feature.lon !== undefined ? feature.lon : feature.anchor_lon;
        if (lat === undefined || lon === undefined) {
          return;
        }
        target = latLonToVector3(lat, lon, 3.2);
        const _spinDelta = getSpinTime() * (2 * Math.PI / _VENUS_DISPLAY_PERIOD_MS);
        target.applyAxisAngle(new THREE.Vector3(0, 1, 0), -_spinDelta);
        if (venusSceneGroup) {
          target = venusSceneGroup.localToWorld(target.clone());
        }
      }
      const direction = target.clone().normalize();
      const cameraDistance = Array.isArray(feature.ring_anchor)
        ? 4.8
        : 1.0;
      activeMoonViewerFeature = null;
      _resetMeasurementOnContextSwitch?.(false);
      // Allow close surface zoom; render loop clamps camera outside the planet body.
      controls.minDistance = Array.isArray(feature.ring_anchor)
        ? DEFAULT_CONTROL_MIN_DISTANCE
        : 3.25;
      controls.maxDistance = DEFAULT_CONTROL_MAX_DISTANCE;
      syncMoonViewerControls(null);
      const cameraPosition = Array.isArray(feature.ring_anchor)
        ? target.clone().add(new THREE.Vector3(0, 1.8, 4.6))
        : target.clone().addScaledVector(direction, cameraDistance);
      camera.up.set(0, 1, 0);
      // Orbit around the planet centre so minDistance from origin enforces the
      // planet-body boundary cleanly in all directions (no arc-through-planet).
      if (animate) {
        const isTourHop = Boolean(activeTourModeFeature) && !Array.isArray(feature.ring_anchor);
        if (isTourHop) {
          animateTourFlight(camera, controls, cameraPosition, new THREE.Vector3(0, 0, 0), 2800, onComplete);
        } else {
          animateCameraFlight(camera, controls, cameraPosition, new THREE.Vector3(0, 0, 0), 1400, onComplete);
        }
      } else {
        cancelCameraFlight();
        camera.position.copy(cameraPosition);
        controls.object.position.copy(camera.position);
        controls.target.set(0, 0, 0);
        controls.update();
        onComplete?.();
      }
    }

    function resetExploreView(camera, controls) {
      cancelCameraFlight();
      deactivateTourMode();
      deactivateMoonViewer(camera, controls);
      camera.position.set(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z);
      camera.up.set(0, 1, 0);
      controls.object.position.copy(camera.position);
      controls.target.set(0, 0, 0);
      controls.minDistance = DEFAULT_CONTROL_MIN_DISTANCE;
      controls.maxDistance = DEFAULT_CONTROL_MAX_DISTANCE;
      controls.update();
      clearFeatureSearchResults(true);
      scenePopup.hidden = true;
      scenePopupAnchor.hidden = true;
      activePopupFeature = null;
      hoverTooltip.hidden = true;
      syncScenePopupSelectionStyle(null);
      syncMoonViewerPopup(null, false);
      activePopupIsCoreLabel = false;
      if (typeof syncSelectionHalo === "function") syncSelectionHalo();
      if (featureSearch) featureSearch.value = "";
      clearFeatureSearchResults(true);
      resetStatus();
    }

    let applyPlanetViewMode = () => {};

    function reloadToDefaultGlobalView(camera, controls) {
      if (baseLayerSelect && baseLayerSelect.value !== "venus-surface") {
        baseLayerSelect.value = "venus-surface";
        baseLayerSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      resumeSpin();
      resetExploreView(camera, controls);
      applyPlanetViewMode(saturnViewModeSelect ? saturnViewModeSelect.value : "tilted");
      controls.saveState();
    }

    function closeScenePopup() {
      scenePopup.hidden = true;
      scenePopupAnchor.hidden = true;
      activePopupFeature = null;
      hoverTooltip.hidden = true;
      syncScenePopupSelectionStyle(null);
      syncMoonViewerPopup(null, false);
      if (typeof syncSelectionHalo === "function") {
        syncSelectionHalo();
      }
    }

    function downloadCsv(filename, rows) {
      const csv = rows
        .map((row) => row.map((value) => {
          const cell = String(value ?? "");
          return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
        }).join(","))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    function downloadJson(filename, value) {
      const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/geo+json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    function getSelectedBaseLayer(baseLayers) {
      return baseLayers.find((layer) => layer.id === baseLayerSelect.value) || null;
    }

    function getSelectedGeologyLayer(geologyLayers) {
      return Array.isArray(geologyLayers) && geologyLayers.length ? geologyLayers[0] : null;
    }

    function getSelectedMineralLayer(mineralLayers) {
      return mineralLayers.find((layer) => layer.id === mineralSelect.value) || null;
    }

    let _prevLegendEntryCount = 0;
    function syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState = null, geologyStructureLayers = []) {
      if (coreViewSection) coreViewSection.open = coreToggle.checked;
      // Toggle HUD between surface conditions and interior model readout
      const coreActive = coreToggle.checked;
      if (surfaceConditionsEl) surfaceConditionsEl.hidden = coreActive;
      if (interiorConditionsEl) {
        interiorConditionsEl.hidden = !coreActive;
        if (!coreActive) {
          icDepth.textContent = "—";
          icLayer.textContent = "—";
          icTemp.textContent = "—";
          icPressure.textContent = "—";
        }
      }
      const legendEntries = buildLegendEntries(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      if (legendSection) {
        if (coreActive) {
          legendSection.open = false;
        } else if (legendEntries.length > 0 && _prevLegendEntryCount === 0) {
          legendSection.open = true;
        } else if (legendEntries.length === 0 && _prevLegendEntryCount > 0) {
          legendSection.open = false;
        }
      }
      _prevLegendEntryCount = legendEntries.length;
      renderLegendPanel(legendEntries);
      currentMetadataState = buildMetadataState(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      metadataButton.textContent = currentMetadataState?.sections?.some((section) => section.title === "Legend")
        ? "Open Metadata And Legend"
        : "Open Metadata";
      if (!metadataModal.hidden) {
        renderMetadataModal(currentMetadataState);
      }
    }

    function normalizeFeatureType(type) {
      if (!type) return null;
      const t = type.trim();
      const IAU_PLAIN = {
        "chasma":         "Canyon",
        "chasmata":       "Canyon system",
        "fossa":          "Fracture trench",
        "fossae":         "Fracture trench system",
        "mons":           "Mountain",
        "montes":         "Mountain range",
        "tholus":         "Dome-shaped hill",
        "tholi":          "Dome-shaped hills",
        "sulcus":         "Fracture groove system",
        "sulci":          "Fracture groove systems",
        "linea":          "Linear ridge",
        "lineae":         "Linear ridge system",
        "dorsum":         "Ridge",
        "dorsa":          "Ridge system",
        "rupes":          "Cliff / scarp",
        "scopulus":       "Irregular escarpment",
        "scopuli":        "Irregular escarpments",
        "labyrinthus":    "Valley complex",
        "vallis":         "Valley",
        "valles":         "Valley system",
        "lacus":          "Lake",
        "palus":          "Marsh",
        "paludes":        "Marshes",
        "mare":           "Sea",
        "maria":          "Seas",
        "sinus":          "Bay",
        "fretum":         "Strait",
        "flumen":         "River channel",
        "flumina":        "River channel system",
        "planitia":       "Plain",
        "planitiae":      "Plains",
        "planum":         "Plateau",
        "terra":          "Highland region",
        "terrae":         "Highland regions",
        "regio":          "Region",
        "regiones":       "Regions",
        "mensa":          "Mesa",
        "mensae":         "Mesas",
        "collis":         "Hill",
        "colles":         "Hills",
        "cavus":          "Hollow / pit",
        "cavi":           "Hollows / pits",
        "catena":         "Crater chain",
        "catenae":        "Crater chains",
        "patera":         "Volcanic depression",
        "paterae":        "Volcanic depressions",
        "fluctus":        "Lava flow",
        "crater":         "Impact crater",
        "impact crater":  "Impact crater",
        "albedo feature": "Albedo region",
        "facula":         "Bright spot",
        "faculae":        "Bright spots",
        "macula":         "Dark spot",
        "maculae":        "Dark spots",
        "corona":         "Ovoid terrain",
        "coronae":        "Ovoid terrain features",
        "plume":          "Eruptive plume",
        "plumes":         "Eruptive plumes",
      };
      const key = t.toLowerCase();
      if (IAU_PLAIN[key]) return IAU_PLAIN[key];
      return t;
    }

    function openFeature(feature, isCoreLabel) {
      // Dismiss the geology floating popup when a regular feature popup opens
      closeGeoPopup();
      syncScenePopupSelectionStyle(feature, Boolean(isCoreLabel));
      if (isCoreLabel) {
        scenePopupKicker.textContent = normalizeFeatureType(feature.type) || "Selected Feature";
      } else {
        scenePopupKicker.textContent = normalizeFeatureType(feature.type) || (
          feature.theme === "volcanic"
            ? "Volcanic Feature"
            : feature.theme === "landing" || feature.theme === "mission"
              ? "Mission Location"
              : "Surface Feature"
        );
      }
      scenePopupTitle.textContent = (
        feature.type === "Geologic unit polygon" && feature.rock_type
          ? feature.rock_type
          : (feature.name || "").replace(/\s*\([^)]*\)\s*/g, " ").trim()
      );
      if (feature.moon_name && feature.lat !== undefined) {
        const elevStr = (feature.elevation_m !== undefined)
          ? ` | ${feature.elevation_m >= 0 ? "+" : ""}${feature.elevation_m.toLocaleString()} m`
          : "";
        scenePopupMeta.textContent = `${feature.moon_name} | ${feature.lat.toFixed(2)}°, ${feature.lon.toFixed(2)}°W${elevStr}`;
      } else if (feature.lat !== undefined) {
        const elevStr = (feature.elevation_m !== undefined)
          ? ` | ${feature.elevation_m >= 0 ? "+" : ""}${feature.elevation_m.toLocaleString()} m`
          : "";
        scenePopupMeta.textContent = `${feature.lat.toFixed(2)}°, ${feature.lon.toFixed(2)}°E${elevStr}`;
      } else if (feature.moon_name && feature.anchor_lat !== undefined && feature.anchor_lon !== undefined) {
        scenePopupMeta.textContent = `${feature.moon_name} | ${feature.anchor_lat.toFixed(2)}°, ${feature.anchor_lon.toFixed(2)}°W`;
      } else if (feature.anchor_lat !== undefined && feature.anchor_lon !== undefined) {
        scenePopupMeta.textContent = `${feature.anchor_lat.toFixed(2)}°, ${feature.anchor_lon.toFixed(2)}°E`;
      } else if (feature.ring_region) {
        scenePopupMeta.textContent = feature.ring_region;
      } else if (feature.orbit_distance_km) {
        scenePopupMeta.textContent = `orbit ${feature.orbit_distance_km}`;
      } else {
        scenePopupMeta.textContent = "";
      }
      scenePopupCopy.textContent = (
        feature.type === "Geologic unit polygon"
          ? (feature.unit_description || feature.description || "")
          : (feature.description || "")
      );
      // Extra detail rows (depth, composition, temperature)
      scenePopupDetail.innerHTML = "";
      const extraFields = [
        feature.rock_type ? ["Rock type", feature.rock_type] : null,
        feature.rock_type_detail ? ["Rock detail", feature.rock_type_detail] : null,
        feature.unit        ? ["Unit",        feature.unit]        : null,
        feature.unit_description ? ["Unit name", feature.unit_description] : null,
        feature.contact_type ? ["Contact type", feature.contact_type] : null,
        feature.origin      ? ["Origin",      feature.origin]      : null,
        feature.interpretation ? ["Interpretation", feature.interpretation] : null,
        feature.preservation ? ["Preservation", feature.preservation] : null,
        feature.dimension   ? ["Dimension",   feature.dimension]   : null,
        feature.region      ? ["Region",      feature.region]      : null,
        feature.ring_region ? ["Ring region", feature.ring_region] : null,
        feature.ring_radius_km ? ["Ring span", feature.ring_radius_km] : null,
        feature.mean_radius_km ? ["Moon radius", feature.mean_radius_km] : null,
        feature.orbit_distance_km ? ["Orbital distance", feature.orbit_distance_km] : null,
        feature.magnitude_label ? ["Magnitude", feature.magnitude_label] : null,
        feature.catalog_status ? ["Catalog status", feature.catalog_status] : null,
        feature.event_time  ? ["Event time",  feature.event_time]  : null,
        feature.length_km   ? ["Mapped length", `${feature.length_km.toLocaleString()} km`] : null,
        feature.mapped_area_km2 ? ["Mapped area", `${feature.mapped_area_km2.toLocaleString()} km²`] : null,
        feature.depth       ? ["Depth",       feature.depth]       : null,
        feature.composition ? ["Composition", feature.composition] : null,
        feature.temperature ? ["Temperature", feature.temperature] : null,
      ].filter(Boolean);
      if (extraFields.length > 0) {
        for (const [key, val] of extraFields) {
          const row = document.createElement("div");
          row.className = "scene-popup-detail-row";
          row.innerHTML = `<span class="scene-popup-detail-key">${key}</span>`
                        + `<span class="scene-popup-detail-val">${val}</span>`;
          scenePopupDetail.appendChild(row);
        }
      }
      scenePopupDetail.hidden = scenePopupDetail.children.length === 0;
      if (scenePopupImg) {
        if (feature.image) {
          scenePopupImg.src = feature.image;
          scenePopupImg.alt = feature.name || "";
          scenePopupImg.hidden = false;
        } else {
          scenePopupImg.hidden = true;
        }
      }
      activePopupFeature = feature;
      activePopupIsCoreLabel = Boolean(isCoreLabel);
      scenePopup.hidden = false;
      scenePopupAnchor.hidden = true;
      syncMoonViewerPopup(feature, Boolean(isCoreLabel));
      if (typeof syncSelectionHalo === "function") {
        syncSelectionHalo();
      }
    }

    function openGeoPopup(feature, worldPos, clickSpinDelta) {
      if (!geoPopup) return;
      // Dismiss main bottom-right popup so only one popup shows at a time
      closeScenePopup();
      activeGeoPopupFeature = feature;
      if (worldPos) {
        const localPoint = venusSceneGroup.worldToLocal(worldPos.clone());
        const spinDelta = (clickSpinDelta !== undefined) ? clickSpinDelta : (venusGlobeRef ? venusGlobeRef.rotation.y - Math.PI : 0);
        localPoint.applyEuler(new THREE.Euler(0, -spinDelta, 0));
        activeGeoPopupLocalPos = localPoint;
      } else {
        activeGeoPopupLocalPos = null;
      }
      const interpretation = String(feature.interpretation || "").trim();
      const origin = String(feature.origin || "").trim();
      const geometryName = String(feature.name || "").trim();
      const popupTitle = feature.rock_type || interpretation || geometryName || "";
      const popupCopy = feature.rock_type_detail
        || (
          feature.type === "Geologic structure"
            ? [
                interpretation ? `${interpretation}.` : "",
                origin ? `${origin} mapped structure from the SIM 3292 geology dataset.` : "Mapped structural trace from the SIM 3292 geology dataset.",
                feature.preservation ? `Preservation: ${feature.preservation}.` : "",
                feature.dimension ? `Scale: ${feature.dimension}.` : "",
              ].filter(Boolean).join(" ")
            : ""
        );
      // Populate content
      if (geoPopupKicker) geoPopupKicker.textContent = feature.type || "Geologic unit";
      if (geoPopupTitle) geoPopupTitle.textContent = popupTitle;
      const metaParts = [];
      if (feature.type === "Geologic structure") {
        if (geometryName && interpretation && geometryName.toLowerCase() !== interpretation.toLowerCase()) {
          metaParts.push(geometryName);
        }
      } else {
        if (feature.description || feature.unit_description) metaParts.push(feature.description || feature.unit_description);
        if (feature.name || feature.unit) metaParts.push(feature.name || feature.unit);
      }
      if (geoPopupMeta) geoPopupMeta.textContent = metaParts.join("  \u00b7  ");
      if (geoPopupCopy) geoPopupCopy.textContent = popupCopy;
      // Detail rows
      if (geoPopupDetail) {
        geoPopupDetail.innerHTML = "";
        let hasDetail = false;
        const detailRows = [
          interpretation ? ["Interpretation", interpretation] : null,
          origin ? ["Origin", origin] : null,
          feature.preservation ? ["Preservation", feature.preservation] : null,
          feature.dimension ? ["Scale", feature.dimension] : null,
          feature.length_km ? ["Mapped length", `${Number(feature.length_km).toLocaleString()} km`] : null,
        ].filter(Boolean);
        for (const [key, value] of detailRows) {
          const row = document.createElement("div");
          row.className = "scene-popup-detail-row";
          row.innerHTML = `<span class="scene-popup-detail-key">${key}</span>`
                        + `<span class="scene-popup-detail-val">${value}</span>`;
          geoPopupDetail.appendChild(row);
          hasDetail = true;
        }
        if (feature.mapped_area_km2) {
          const row = document.createElement("div");
          row.className = "scene-popup-detail-row";
          row.innerHTML = `<span class="scene-popup-detail-key">Area</span>`
                        + `<span class="scene-popup-detail-val">${Number(feature.mapped_area_km2).toLocaleString()} km²</span>`;
          geoPopupDetail.appendChild(row);
          hasDetail = true;
        }
        geoPopupDetail.hidden = !hasDetail;
      }
      geoPopup.hidden = false;
      if (geoPopupAnchor) geoPopupAnchor.hidden = false;
    }

    function closeGeoPopup() {
      activeGeoPopupFeature = null;
      activeGeoPopupLocalPos = null;
      if (geoPopup) geoPopup.hidden = true;
      if (geoPopupAnchor) geoPopupAnchor.hidden = true;
    }

    function disableSceneInteractivity(object3d) {
      if (!object3d) return object3d;
      object3d.traverse((child) => {
        child.raycast = () => [];
      });
      return object3d;
    }

    function buildStarfield(THREERef) {
      const starCount = 5000;
      const positions = new Float32Array(starCount * 3);
      for (let i = 0; i < starCount; i += 1) {
        const radius = 140 + Math.random() * 180;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        positions[(i * 3)] = radius * Math.sin(phi) * Math.cos(theta);
        positions[(i * 3) + 1] = radius * Math.cos(phi);
        positions[(i * 3) + 2] = radius * Math.sin(phi) * Math.sin(theta);
      }

      const geometry = new THREERef.BufferGeometry();
      geometry.setAttribute("position", new THREERef.BufferAttribute(positions, 3));
      const material = new THREERef.PointsMaterial({
        color: 0xf3f7ff,
        size: 0.55,
        sizeAttenuation: true,
      });
      return new THREERef.Points(geometry, material);
    }

    function buildSunObject() {
      const SUN_DIST = 180;
      const sunPos = _SUN_DIR.clone().multiplyScalar(SUN_DIST);
      const sunVisual = new THREE.Mesh(
        new THREE.SphereGeometry(1.8, 20, 20),
        new THREE.MeshBasicMaterial({ color: 0xfffdf7, transparent: true, opacity: 0.95 }),
      );
      sunVisual.position.copy(sunPos);
      sunVisual.userData.nonInteractive = true;
      sunVisual.raycast = () => {};
      return sunVisual;
    }

    function createRenderer(THREERef) {
      const attempts = [
        { antialias: true, powerPreference: "high-performance" },
        { antialias: false, powerPreference: "high-performance" },
        { antialias: false, powerPreference: "low-power" },
      ];
      let lastError = null;
      for (const options of attempts) {
        try {
          return new THREERef.WebGLRenderer(options);
        } catch (error) {
          lastError = error;
        }
      }
      const contextNames = ["webgl2", "webgl", "experimental-webgl"];
      for (const options of attempts) {
        for (const contextName of contextNames) {
          const canvas = document.createElement("canvas");
          try {
            const context = canvas.getContext(contextName, {
              alpha: true,
              antialias: Boolean(options.antialias),
              depth: true,
              failIfMajorPerformanceCaveat: false,
              powerPreference: options.powerPreference,
              premultipliedAlpha: true,
              preserveDrawingBuffer: false,
              stencil: false,
            });
            if (!context) {
              continue;
            }
            return new THREERef.WebGLRenderer({
              ...options,
              canvas,
              context,
            });
          } catch (error) {
            lastError = error;
          }
        }
      }
      throw lastError || new Error("Error creating WebGL context.");
    }

    // ── Shared GLSL utilities injected into every fragment shader ────────────
    const GLSL_NOISE = `
      float h21(vec2 p){p=fract(p*vec2(127.1,311.7));p+=dot(p,p+45.32);return fract(p.x*p.y);}
      float vnoise(vec2 p){
        vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),
                   mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);
      }
      float fbm(vec2 p){float v=0.;float a=0.5;
        for(int i=0;i<6;i++){v+=a*vnoise(p);p*=2.15;a*=0.5;}return v;}
      float ridged(vec2 p){
        float v=0.; float a=0.5;
        for(int i=0;i<5;i++){
          float n=1.0-abs(vnoise(p)*2.0-1.0);
          v+=n*a; p*=2.05; a*=0.5;
        }
        return v;
      }
      vec2 swirl(vec2 p, float amount){
        float a = amount * (fbm(p*0.6) - 0.5) * 6.28318;
        float s = sin(a), c = cos(a);
        return mat2(c,-s,s,c) * p;
      }
    `;

    // Shared vertex shader for all four layer shaders
    const LAYER_VERT = `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main(){
        vUv=uv;
        vNormal=normalize(normalMatrix*normal);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }
    `;

    // ── CRUST: basaltic shell with fracture provinces and buried dikes ─────
    // ── CRUST: basaltic shell with fracture provinces and buried dikes ─────
    const CRUST_FRAG = `
      varying vec2 vUv;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      float voronoi(vec2 p){
        vec2 g=floor(p); vec2 f=fract(p); float md=8.;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
          vec2 c=vec2(x,y);
          vec2 o=vec2(h21(g+c),h21(g+c+vec2(17.9,53.4)));
          md=min(md,length(f-c-o));
        } return md;
      }
      void main(){
        vec3 nn=normalize(vNormal);
        vec3 w=abs(nn); w=pow(w,vec3(4.0)); w/=w.x+w.y+w.z;
        vec2 px=swirl(nn.yz*6.5 + vec2(2.1,7.4), 0.18);
        vec2 py=swirl(nn.xz*6.5 + vec2(8.2,1.8), 0.18);
        vec2 pz=swirl(nn.xy*6.5 + vec2(4.7,5.3), 0.18);
        float province = fbm(px)*w.x + fbm(py)*w.y + fbm(pz)*w.z;

        float gx=ridged(nn.yz*18.0+vec2(6.2,3.9));
        float gy=ridged(nn.xz*18.0+vec2(4.1,8.7));
        float gz=ridged(nn.xy*18.0+vec2(2.8,5.3));
        float grain=gx*w.x+gy*w.y+gz*w.z;

        float vx=voronoi(nn.yz*11.0+vec2(0.5,2.2));
        float vy=voronoi(nn.xz*11.0+vec2(3.4,7.9));
        float vz=voronoi(nn.xy*11.0+vec2(5.3,1.7));
        float fractures=smoothstep(0.030,0.110,(vx*w.x+vy*w.y+vz*w.z));

        float dx = abs(sin((nn.y*12.0 + nn.z*8.0) + fbm(nn.yz*10.0)*3.5));
        float dy = abs(sin((nn.x*11.0 - nn.z*7.0) + fbm(nn.xz*10.0)*3.5));
        float dz = abs(sin((nn.x*10.0 + nn.y*9.0) + fbm(nn.xy*10.0)*3.5));
        float dikes = pow(dx*w.x + dy*w.y + dz*w.z, 7.5);

        vec3 deepBasalt = vec3(0.18,0.08,0.05);
        vec3 basalt     = vec3(0.38,0.19,0.11);
        vec3 oxidized   = vec3(0.56,0.30,0.18);
        vec3 dusted     = vec3(0.72,0.51,0.33);
        vec3 dikeColor  = vec3(0.30,0.12,0.07);
        vec3 crackColor = vec3(0.08,0.03,0.01);

        vec3 col = mix(deepBasalt, basalt, province);
        col = mix(col, oxidized, grain*0.45);
        col = mix(col, dusted, smoothstep(0.58, 0.92, province)*0.28);
        col = mix(col, dikeColor, dikes*0.55);
        col = mix(crackColor, col, fractures);
        col *= 0.84 + grain*0.22;
        gl_FragColor=vec4(col,1.0);
      }
    `;

    // ── MANTLE: coherent plume heads, sinking slabs, and shear bands ───────
    const MANTLE_FRAG = `
      varying vec2 vUv;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main(){
        vec3 nn=normalize(vNormal);
        vec3 w=abs(nn); w=pow(w,vec3(4.0)); w/=w.x+w.y+w.z;
        vec2 px = swirl(nn.yz*3.8 + vec2(2.2,6.1), 0.35);
        vec2 py = swirl(nn.xz*3.8 + vec2(6.4,1.7), 0.35);
        vec2 pz = swirl(nn.xy*3.8 + vec2(3.1,8.5), 0.35);

        float bulk = fbm(px)*w.x + fbm(py)*w.y + fbm(pz)*w.z;
        float plumes = pow(max((ridged(px*1.8)*w.x + ridged(py*1.8)*w.y + ridged(pz*1.8)*w.z) - 0.55, 0.0)*2.6, 2.2);

        float sx = abs(sin(nn.y*9.0 + nn.z*6.0 + fbm(nn.yz*8.0)*4.0));
        float sy = abs(sin(nn.x*8.0 - nn.z*5.0 + fbm(nn.xz*8.0)*4.0));
        float sz = abs(sin(nn.x*7.0 + nn.y*6.0 + fbm(nn.xy*8.0)*4.0));
        float shear = pow(sx*w.x + sy*w.y + sz*w.z, 5.8);

        float coolX = fbm(nn.yz*6.0 + vec2(7.5,2.1));
        float coolY = fbm(nn.xz*6.0 + vec2(4.7,9.2));
        float coolZ = fbm(nn.xy*6.0 + vec2(1.9,5.6));
        float downwell = smoothstep(0.58, 0.78, coolX*w.x + coolY*w.y + coolZ*w.z);

        vec3 deepRock    = vec3(0.07,0.02,0.02);
        vec3 warmRock    = vec3(0.18,0.06,0.04);
        vec3 hotRock     = vec3(0.33,0.10,0.05);
        vec3 plumeRock   = vec3(0.48,0.17,0.07);
        vec3 brightPlume = vec3(0.66,0.28,0.10);
        vec3 coolBand    = vec3(0.11,0.04,0.04);

        vec3 col = mix(deepRock, warmRock, bulk);
        col = mix(col, hotRock, plumes*0.38);
        col = mix(col, plumeRock, plumes*0.52);
        col = mix(col, brightPlume, pow(plumes, 2.4)*0.24);
        col = mix(col, coolBand, downwell*0.44);
        col += shear * vec3(0.04,0.015,0.01);
        col *= 0.82 + 0.10*bulk;
        gl_FragColor=vec4(col,1.0);
      }
    `;

    // ── OUTER CORE: static convection cells and iron-sulfur circulation ────
    const CORE_FRAG = `
      varying vec2 vUv;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      float cellField(vec2 p){
        vec2 g=floor(p), f=fract(p);
        float md=8.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
          vec2 c=vec2(x,y);
          vec2 o=vec2(h21(g+c),h21(g+c+vec2(13.7,5.9)));
          vec2 d=c+o-f;
          md=min(md,length(d));
        }
        return md;
      }
      void main(){
        vec3 nn=normalize(vNormal);
        vec3 w=abs(nn); w=pow(w,vec3(4.0)); w/=w.x+w.y+w.z;
        vec2 px = swirl(nn.yz*4.6 + vec2(2.1,5.4), 0.42);
        vec2 py = swirl(nn.xz*4.6 + vec2(7.3,1.2), 0.42);
        vec2 pz = swirl(nn.xy*4.6 + vec2(4.4,8.8), 0.42);

        float heat = fbm(px)*w.x + fbm(py)*w.y + fbm(pz)*w.z;
        float cells = cellField(px*2.0)*w.x + cellField(py*2.0)*w.y + cellField(pz*2.0)*w.z;
        float cellWalls = 1.0 - smoothstep(0.08, 0.18, cells);
        float cellCenters = smoothstep(0.26, 0.12, cells);

        float sx = abs(sin(nn.y*10.0 + nn.z*7.0 + fbm(nn.yz*9.0)*5.0));
        float sy = abs(sin(nn.x*9.0 - nn.z*6.0 + fbm(nn.xz*9.0)*5.0));
        float sz = abs(sin(nn.x*8.0 + nn.y*7.0 + fbm(nn.xy*9.0)*5.0));
        float shear = pow(sx*w.x + sy*w.y + sz*w.z, 6.2);

        vec3 deepIron  = vec3(0.30,0.03,0.01);
        vec3 warmIron  = vec3(0.63,0.13,0.02);
        vec3 hotIron   = vec3(0.92,0.38,0.05);
        vec3 sulfurHot = vec3(1.00,0.74,0.16);
        vec3 wallGlow  = vec3(1.00,0.88,0.30);

        vec3 col = mix(deepIron, warmIron, heat);
        col = mix(col, hotIron, pow(heat, 1.8));
        col = mix(col, sulfurHot, cellCenters*0.75);
        col = mix(col, wallGlow, cellWalls*0.55);
        col += shear * vec3(0.14,0.04,0.01);
        col *= 0.90 + 0.10*fbm(px*2.5);
        gl_FragColor=vec4(col,1.0);
      }
    `;

    // ── INNER CORE: dense crystalline metallic interior ──────────────────────
    const INNER_CORE_FRAG = `
      varying vec2 vUv;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main(){
        vec2 p=vUv;
        float n1=fbm(p*12.0);
        float n2=fbm(p*6.0+vec2(4.1,9.3));
        float n3=fbm(p*24.0+vec2(7.7,3.2));
        // crystalline bands: sharp sinusoidal grid gives metallic facets
        float cx=abs(sin(p.x*18.0+n1*9.0));
        float cy=abs(sin(p.y*14.0+n2*7.0));
        float crystal=pow(cx*cy,0.45);
        // radial heat glow from centre
        float r=length(vUv-0.5)*1.9;
        float glow=pow(clamp(1.-r,0.,1.),1.8);
        vec3 vDark  =vec3(0.36,0.17,0.05);
        vec3 vMid   =vec3(0.70,0.44,0.14);
        vec3 vBright=vec3(0.95,0.79,0.38);
        vec3 vHot   =vec3(1.00,0.90,0.55);
        vec3 col=mix(vDark,vMid,n1*0.65+crystal*0.35);
        col=mix(col,vBright,crystal*0.65);
        col=mix(col,vHot,glow*0.75);
        col*=0.85+0.15*n3;
        float rim=pow(1.-abs(dot(normalize(vNormal),vec3(0.,0.,1.))),3.0);
        col+=vec3(0.48,0.18,0.0)*rim*0.38;
        gl_FragColor=vec4(col,1.0);
      }
    `;

    const SECTION_FACE_VERT = `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const CRUST_SECTION_FRAG = `
      varying vec2 vUv;
      ${GLSL_NOISE}
      float ringLine(vec2 uv, float scale){
        vec2 p = uv - 0.5;
        float ang = atan(p.y, p.x);
        return abs(sin(ang * scale + fbm(p * 8.0) * 3.5));
      }
      void main(){
        vec2 p = vUv - 0.5;
        float r = length(p) * 2.0;
        float base = fbm(p * 10.0 + vec2(2.1, 7.4));
        float grain = ridged(p * 22.0 + vec2(6.2, 3.9));
        float fractures = pow(ringLine(vUv, 11.0), 8.0);
        float microFractures = pow(ringLine(vUv + vec2(0.13, -0.08), 21.0), 12.0);
        vec3 dark  = vec3(0.23,0.09,0.05);
        vec3 mid   = vec3(0.47,0.21,0.12);
        vec3 dust  = vec3(0.71,0.50,0.32);
        vec3 crack = vec3(0.08,0.03,0.01);
        vec3 col = mix(dark, mid, base);
        col = mix(col, dust, grain * 0.28);
        col = mix(col, crack, fractures * 0.75 + microFractures * 0.35);
        col *= 1.0 - smoothstep(0.86, 1.0, r) * 0.18;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const MANTLE_SECTION_FRAG = `
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float ang = atan(p.y, p.x);
        vec2 flow = swirl(p * 1.7 + vec2(0.0, 0.15), 0.55);
        float bulk = fbm(flow * 2.8 + vec2(2.2, 6.1));
        float plumeBands = pow(abs(sin(ang * 4.0 + fbm(flow * 3.2) * 5.0)), 4.0);
        float plumeHeads = pow(max(ridged(flow * 4.2) - 0.42, 0.0) * 2.2, 2.1);
        float coolDown = smoothstep(0.52, 0.78, fbm(p * 3.5 + vec2(7.3, 1.9)));
        vec3 deep   = vec3(0.09,0.02,0.03);
        vec3 warm   = vec3(0.20,0.06,0.05);
        vec3 hot    = vec3(0.34,0.10,0.06);
        vec3 plume  = vec3(0.50,0.16,0.08);
        vec3 bright = vec3(0.68,0.27,0.12);
        vec3 cool   = vec3(0.12,0.04,0.05);
        vec3 col = mix(deep, warm, bulk);
        col = mix(col, hot, plumeBands * 0.24 + plumeHeads * 0.12);
        col = mix(col, plume, plumeHeads * 0.44);
        col = mix(col, bright, pow(plumeHeads, 2.0) * 0.18);
        col = mix(col, cool, coolDown * 0.36);
        col *= 0.88 - smoothstep(0.9, 1.05, r) * 0.10;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const CORE_SECTION_FRAG = `
      varying vec2 vUv;
      ${GLSL_NOISE}
      float cell(vec2 p){
        vec2 g=floor(p), f=fract(p);
        float md=9.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
          vec2 c=vec2(x,y);
          vec2 o=vec2(h21(g+c),h21(g+c+vec2(13.7,5.9)));
          md=min(md, length(c + o - f));
        }
        return md;
      }
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        vec2 flow = swirl(p * 2.0, 0.75);
        float heat = fbm(flow * 2.6 + vec2(2.1, 5.4));
        float cells = cell(flow * 4.0);
        float walls = 1.0 - smoothstep(0.06, 0.16, cells);
        float centers = smoothstep(0.28, 0.10, cells);
        float gyres = pow(abs(sin(atan(flow.y, flow.x) * 5.0 + fbm(flow * 4.0) * 6.0)), 5.5);
        vec3 deep  = vec3(0.34,0.04,0.01);
        vec3 warm  = vec3(0.65,0.14,0.02);
        vec3 hot   = vec3(0.93,0.33,0.04);
        vec3 core  = vec3(1.00,0.73,0.14);
        vec3 wallsC= vec3(1.00,0.88,0.28);
        vec3 col = mix(deep, warm, heat);
        col = mix(col, hot, pow(heat, 1.8));
        col = mix(col, core, centers * 0.72 + gyres * 0.18);
        col = mix(col, wallsC, walls * 0.60);
        col *= 1.0 - smoothstep(0.88, 1.02, r) * 0.10;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    function buildCutawayInterior(radius, layerData, elevationMap, terrainRelief) {
      const group = new THREE.Group();
      const labelsGroup = new THREE.Group();
      group.add(labelsGroup);
      const interactiveObjects = [];
      const labelEntries = [];

      const phiStart = -Math.PI / 2;
      const phiLength = Math.PI;
      const VENUS_INNER_CORE_RADIUS = 0.20;    // possible solid iron inner core (~1,200 km)
      const VENUS_OUTER_CORE_RADIUS = 0.48;    // liquid iron outer core (~1,700 km)
      const VENUS_MANTLE_RADIUS = 0.985;       // silicate mantle
      
      // ── Inner core: dense crystalline metallic interior ───────────────────
      const innerCoreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * VENUS_INNER_CORE_RADIUS, 96, 96, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: INNER_CORE_FRAG,
          side: THREE.BackSide,
        }),
      );
      innerCoreMesh.rotation.y = Math.PI;
      group.add(innerCoreMesh);

      // ── Outer liquid core: animated Bénard convective cells ───────────────
      const outerCoreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * VENUS_OUTER_CORE_RADIUS, 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: CORE_FRAG,
          side: THREE.BackSide,
        }),
      );
      outerCoreMesh.rotation.y = Math.PI;
      group.add(outerCoreMesh);

      // ── Mantle outer boundary shell ───────────────────────────────────────
      const mantleMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * VENUS_MANTLE_RADIUS, 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: MANTLE_FRAG,
          side: THREE.BackSide,
        }),
      );
      mantleMesh.rotation.y = Math.PI;
      group.add(mantleMesh);

      // ── Mantle inner boundary shell: explicit inner wall around the core ──
      const mantleInnerBoundaryMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * (VENUS_OUTER_CORE_RADIUS + 0.002), 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: MANTLE_FRAG,
          side: THREE.FrontSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      mantleInnerBoundaryMesh.rotation.y = Math.PI;
      group.add(mantleInnerBoundaryMesh);

      // ── Crust shell: fills gap between mantle and globe surface ──────────────
      // BackSide only → inner face visible from cut; outer face suppressed (no rim).
      const crustMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: CRUST_FRAG,
          side: THREE.BackSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
      crustMesh.rotation.y = Math.PI;
      group.add(crustMesh);

      // ── Crust inner boundary shell: explicit wall against the mantle ──────
      const crustInnerBoundaryMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * VENUS_MANTLE_RADIUS, 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: CRUST_FRAG,
          side: THREE.FrontSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      crustInnerBoundaryMesh.rotation.y = Math.PI;
      group.add(crustInnerBoundaryMesh);

      // ── Cross-section face (ring caps at x=0 plane) ───────────────────────
      const CAP_X = -0.012;
      const crustInnerRadius = radius * VENUS_MANTLE_RADIUS;
      const crustOuterRadius = radius + (elevationMap ? terrainRelief : 0);
      const capDefs = [
        { outer: crustOuterRadius, inner: crustInnerRadius, fragmentShader: CRUST_SECTION_FRAG },  // crust ring
        { outer: crustInnerRadius, inner: radius * VENUS_OUTER_CORE_RADIUS,  fragmentShader: MANTLE_SECTION_FRAG },  // molecular envelope ring
        { outer: radius * VENUS_OUTER_CORE_RADIUS,  inner: radius * VENUS_INNER_CORE_RADIUS,  fragmentShader: CORE_SECTION_FRAG },  // metallic hydrogen ring
      ];
      let crustRing = null;
      let molecularEnvelopeRing = null;
      let metallicHydrogenRing = null;
      for (const cap of capDefs) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(cap.inner, cap.outer, 128),
          new THREE.ShaderMaterial({
            uniforms: {},
            vertexShader: SECTION_FACE_VERT,
            fragmentShader: cap.fragmentShader,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        );
        ring.rotation.y = Math.PI / 2;
        ring.position.x = CAP_X;
        if (cap.inner === crustInnerRadius) {
          crustRing = ring;
          ring.position.x = 0;
          ring.renderOrder = 4;
        } else if (cap.outer === crustInnerRadius) {
          molecularEnvelopeRing = ring;
        } else {
          metallicHydrogenRing = ring;
        }
        group.add(ring);
      }

      // Outer-core cross-section cap disc — same convective cells shader
      const fluidCapMat = new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: SECTION_FACE_VERT,
        fragmentShader: CORE_SECTION_FRAG,
        side: THREE.DoubleSide,
      });
      const fluidCapDisk = new THREE.Mesh(
        new THREE.CircleGeometry(radius * VENUS_OUTER_CORE_RADIUS, 128),
        fluidCapMat,
      );
      fluidCapDisk.rotation.y = Math.PI / 2;
      fluidCapDisk.position.x = CAP_X - 0.001;
      group.add(fluidCapDisk);

      // Inner-core centre cap disc — crystalline shader matches the shell
      const innerCapMat = new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: LAYER_VERT,
        fragmentShader: INNER_CORE_FRAG,
        side: THREE.DoubleSide,
      });
      const innerCapDisk = new THREE.Mesh(
        new THREE.CircleGeometry(radius * VENUS_INNER_CORE_RADIUS, 96),
        innerCapMat,
      );
      innerCapDisk.rotation.y = Math.PI / 2;
      innerCapDisk.position.x = CAP_X - 0.002;
      group.add(innerCapDisk);

      // ── Layer labels ───────────────────────────────────────────────────────
      if (layerData && layerData.length > 0) {
        const markerGeo = new THREE.SphereGeometry(0.03, 10, 10);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xffcf9d });
        const hitGeo = new THREE.SphereGeometry(0.28, 10, 10);
        const hitMat = new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0, depthTest: false, depthWrite: false,
        });

        for (const layer of layerData) {
          const lx = layer.labelX;
          const ly = layer.labelY;
          const anchorPoint = new THREE.Vector3(CAP_X, layer.anchorY, 0);
          const labelPoint = new THREE.Vector3(lx, ly, 0);

          // Dot marker on the cut-face layer anchor
          const dot = new THREE.Mesh(markerGeo, markerMat.clone());
          dot.position.copy(anchorPoint);
          dot.userData.feature = layer;
          labelsGroup.add(dot);

          // Invisible hit sphere anchored to the layer face
          const hit = new THREE.Mesh(hitGeo, hitMat.clone());
          hit.position.copy(anchorPoint);
          hit.userData.feature = layer;
          labelsGroup.add(hit);
          interactiveObjects.push(hit, dot);

          // Connector line: from the layer face marker out to the label.
          const lineGeo = new THREE.BufferGeometry().setFromPoints([anchorPoint, labelPoint]);
          const lineMat = new THREE.LineBasicMaterial({
            color: 0xffcf9d, transparent: true, opacity: 0.45,
          });
          const line = new THREE.Line(lineGeo, lineMat);
          labelsGroup.add(line);

          // Text sprite label
          const labelTex = makeLabelTexture(layer.name);
          const spriteMat = new THREE.SpriteMaterial({
            map: labelTex.texture, transparent: true, opacity: 0.88,
            depthTest: true, depthWrite: false,
          });
          const sprite = new THREE.Sprite(spriteMat);
          sprite.scale.set((labelTex.width / 200) * 0.85, (labelTex.height / 200) * 0.85, 1);
          sprite.position.set(lx - (labelTex.width / 200) * 0.85 * 0.5 - 0.05, ly, 0);
          sprite.userData.feature = layer;
          labelsGroup.add(sprite);
          interactiveObjects.push(sprite);
          labelEntries.push({ dot, hit, line, sprite, layerId: layer.id });
        }
      }

      group.visible = false;
      return {
        group,
        labelsGroup,
        interactiveObjects,
        labelEntries,
        crustRing,
        crustInnerRadius,
        crustRadius: radius,
        atmosphereMesh: crustMesh,
        atmosphereBoundaryMesh: crustInnerBoundaryMesh,
        molecularEnvelopeMesh: mantleMesh,
        molecularBoundaryMesh: mantleInnerBoundaryMesh,
        molecularEnvelopeRing: molecularEnvelopeRing,
        metallicHydrogenMesh: outerCoreMesh,
        metallicHydrogenCapMesh: fluidCapDisk,
        metallicHydrogenRing: metallicHydrogenRing,
        heavyElementCoreMesh: innerCoreMesh,
        heavyElementCoreCapMesh: innerCapDisk,
      };
    }

    function buildMarsSolidInterior(radius) {
      // Unused for rocky planet — Mars interior shown via cutaway only.
      // Kept for API compatibility with applyPlanetDisplayState references.
      const group = new THREE.Group();
      const CAP_X = -0.0006;
      // Outer core: liquid iron-sulfide (InSight data: ~0.54 of radius)
      const metallicHydrogenMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x7a5540,
        emissive: new THREE.Color(0x1e0e08),
        emissiveIntensity: 0.18,
        roughness: 0.42,
        metalness: 0.65,
        clearcoat: 0.20,
        clearcoatRoughness: 0.30,
      });
      const metallicHydrogenCapMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x8a6048,
        emissive: new THREE.Color(0x220e08),
        emissiveIntensity: 0.22,
        roughness: 0.38,
        metalness: 0.60,
        clearcoat: 0.25,
        clearcoatRoughness: 0.25,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const metallicHydrogenMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.54, 128, 128),
        metallicHydrogenMaterial,
      );
      metallicHydrogenMesh.rotation.y = Math.PI;
      group.add(metallicHydrogenMesh);
      const metallicHydrogenCapMesh = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.30, radius * 0.54, 128),
        metallicHydrogenCapMaterial,
      );
      metallicHydrogenCapMesh.rotation.y = Math.PI / 2;
      metallicHydrogenCapMesh.position.x = CAP_X;
      metallicHydrogenCapMesh.renderOrder = 6;
      metallicHydrogenCapMesh.visible = false;
      group.add(metallicHydrogenCapMesh);

      // Inner core: dense iron-rich centre (hypothetical ~0.30 of radius)
      const heavyElementCoreMaterial = new THREE.MeshStandardMaterial({
        color: 0x5a3828,
        emissive: new THREE.Color(0x150a06),
        emissiveIntensity: 0.12,
        roughness: 0.75,
        metalness: 0.30,
      });
      const heavyElementCoreCapMaterial = new THREE.MeshStandardMaterial({
        color: 0x6a4434,
        emissive: new THREE.Color(0x180c08),
        emissiveIntensity: 0.14,
        roughness: 0.70,
        metalness: 0.28,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const heavyElementCoreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.30, 96, 96),
        heavyElementCoreMaterial,
      );
      heavyElementCoreMesh.rotation.y = Math.PI;
      group.add(heavyElementCoreMesh);
      const heavyElementCoreCapMesh = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.30, 96),
        heavyElementCoreCapMaterial,
      );
      heavyElementCoreCapMesh.rotation.y = Math.PI / 2;
      heavyElementCoreCapMesh.position.x = CAP_X;
      heavyElementCoreCapMesh.renderOrder = 7;
      heavyElementCoreCapMesh.visible = false;
      group.add(heavyElementCoreCapMesh);

      group.visible = false;
      return {
        group,
        metallicHydrogenMesh,
        metallicHydrogenMaterial,
        metallicHydrogenCapMesh,
        metallicHydrogenCapMaterial,
        heavyElementCoreMesh,
        heavyElementCoreMaterial,
        heavyElementCoreCapMesh,
        heavyElementCoreCapMaterial,
      };
    }

    function syncCutawaySurfaceInterface(cutawayResult, elevationMap, terrainRelief) {
      if (!cutawayResult) {
        return;
      }
      if (cutawayResult.crustRing) {
        const outerRadius = cutawayResult.crustRadius + (elevationMap ? terrainRelief : 0);
        cutawayResult.crustRing.geometry.dispose();
        cutawayResult.crustRing.geometry = new THREE.RingGeometry(
          cutawayResult.crustInnerRadius,
          outerRadius,
          128,
        );
      }
    }

    function applyTerrainRelief(nextTerrainRelief, elevationMap, baseMaterial, geologyMaterial, mineralMaterial, seaMaterial, regionMaskMaterial, cutawayResult, ctxFocusMaterial = null) {
      baseMaterial.displacementScale = nextTerrainRelief;
      if (ctxFocusMaterial) {
        ctxFocusMaterial.displacementScale = nextTerrainRelief;
      }
      if (geologyMaterial) {
        geologyMaterial.displacementScale = nextTerrainRelief;
      }
      if (mineralMaterial) {
        mineralMaterial.displacementScale = nextTerrainRelief;
      }
      if (seaMaterial) {
        seaMaterial.displacementScale = nextTerrainRelief;
      }
      if (regionMaskMaterial) {
        regionMaskMaterial.displacementScale = nextTerrainRelief;
      }
      if (typeof contourMaterial !== "undefined" && contourMaterial) {
        contourMaterial.displacementScale = nextTerrainRelief;
      }
      syncCutawaySurfaceInterface(cutawayResult, elevationMap, nextTerrainRelief);
    }

    function updateGeologyVectorLayer(layer) {
      if (layer && typeof layer.rebuild === "function") {
        layer.rebuild();
      }
    }

    function updateCoreLabelVisibility(cutawayResult, camera, labelsEnabled) {
      if (!cutawayResult || !cutawayResult.labelEntries) {
        return;
      }
      for (const entry of cutawayResult.labelEntries) {
        const visible = labelsEnabled;
        entry.dot.visible = visible;
        entry.hit.visible = visible;
        entry.line.visible = visible;
        entry.sprite.visible = visible;
      }
    }

    function venusLonToSceneLon(lonDegrees) {
      return ((((lonDegrees + 180) % 360) + 360) % 360) - 180;
    }

    function latLonToVector3(latDegrees, lonDegrees, radius) {
      const lat = THREE.MathUtils.degToRad(latDegrees);
      const lon = THREE.MathUtils.degToRad(venusLonToSceneLon(lonDegrees));
      const x = -radius * Math.cos(lat) * Math.cos(lon);
      const y = radius * Math.sin(lat);
      const z = radius * Math.cos(lat) * Math.sin(lon);
      return new THREE.Vector3(x, y, z);
    }

    function normalizeDegrees360(value) {
      return ((value % 360) + 360) % 360;
    }

    function moonDataLonToSceneLon(lonDegrees) {
      // Phobos/Deimos feature catalogs use the IAU small-body convention, where
      // longitudes are authored in the opposite handedness from the positive-east
      // simple-cylindrical moon textures used by the renderer.
      return normalizeDegrees360(360 - Number(lonDegrees || 0));
    }

    function sceneLonToMoonDataLon(lonDegrees) {
      return normalizeDegrees360(360 - Number(lonDegrees || 0));
    }


    function vectorToMoonLatLon(point) {
      const latLon = vectorToLatLon(point);
      return {
        lat: latLon.lat,
        lon: sceneLonToMoonDataLon(latLon.lon),
      };
    }


    function processMineralTexture(texture) {
      if (!texture || !texture.image) { return texture; }
      const img = texture.image;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) {
          d[i + 3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      const processed = new THREE.CanvasTexture(canvas);
      processed.colorSpace = THREE.SRGBColorSpace;
      texture.dispose();
      return processed;
    }

    function applyTextureTransforms(texture, layer) {
      if (!texture || !layer) {
        return texture;
      }
      const offsetX = Number(layer.texture_offset_x || 0);
      const offsetY = Number(layer.texture_offset_y || 0);
      const repeatX = Number(layer.texture_repeat_x || 1);
      const repeatY = Number(layer.texture_repeat_y || 1);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.repeat.set(repeatX, repeatY);
      texture.offset.set(offsetX, offsetY);
      texture.needsUpdate = true;
      return texture;
    }

    // Persistent IndexedDB cache for CTX tiles.
    // Tiles download once per device; every subsequent load hits IndexedDB (~5ms) instead
    // of the ESRI server (200-500ms), making revisited areas appear almost instantly.
    class CTXTileDB {
      constructor() {
        this._db = null;
        this._ready = new Promise((resolve) => {
          try {
            const req = indexedDB.open('ctx-mosaic-tiles-v1', 1);
            req.onupgradeneeded = (e) => { e.target.result.createObjectStore('tiles'); };
            req.onsuccess = (e) => { this._db = e.target.result; resolve(); };
            req.onerror = () => resolve();
          } catch (_) { resolve(); }
        });
      }
      async getBlob(key) {
        try {
          await this._ready;
          if (!this._db) return null;
          return new Promise((resolve) => {
            const tx = this._db.transaction('tiles', 'readonly');
            const req = tx.objectStore('tiles').get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror  = () => resolve(null);
          });
        } catch (_) { return null; }
      }
      putBlob(key, blob) {
        this._ready.then(() => {
          if (!this._db) return;
          try {
            const tx = this._db.transaction('tiles', 'readwrite');
            tx.objectStore('tiles').put(blob, key);
          } catch (_) {}
        }).catch(() => {});
      }
    }

    class CTXCanvasLayer {
      // Streams ESRI CTX tiles into a single equirectangular canvas texture that
      // lives on the displaced globe mesh, so terrain relief and overlays share
      // the same material path.
      constructor(baseTexture, serviceConfig = {}, canvasWidth = 8192, canvasHeight = 4096) {
        this.serviceConfig = serviceConfig;
        this.TILE_BASE = serviceConfig.tileBase || "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile";
        this.SERVICE_URL = serviceConfig.serviceUrl || this.TILE_BASE.replace(/\/tile$/, "");
        this.GLOBE_R = 3.2;
        this.MAX_INFLIGHT = 64; // HTTP/2 multiplexes many streams over one connection
        this.MIN_LEVEL = Number.isFinite(serviceConfig.minLevel) ? serviceConfig.minLevel : 3;
        this.BACKGROUND_MAX_LEVEL = Number.isFinite(serviceConfig.backgroundMaxLevel) ? serviceConfig.backgroundMaxLevel : 8;
        this.FOCUS_MAX_LEVEL = Number.isFinite(serviceConfig.focusMaxLevel) ? serviceConfig.focusMaxLevel : 15;
        this.MAX_TILE_CACHE = 1024;
        this.MAX_FOCUS_TILES = 512;
        this.MAX_FOCUS_INFLIGHT = 48;
        this.FOCUS_TEXTURE_MAX_SIZE = 2048;
        this.FOCUS_UPDATE_INTERVAL_MS = 40;
        this.FOCUS_FULL_VIEW = false;
        this.BACKGROUND_STREAMING = false;
        this.FORCE_MAX_LEVEL = 14;
        this.ALLOWED_CTX_LEVELS = [5, 7, 9, 10, 11, 12, 14];
        this._focusLevelSmoothed = null;
        this._lastFocusLevelAt = 0;
        this.SCALE_STEPS = [
          { maxScale: 12000000, level: 5 },  // States / Provinces
          { maxScale: 3000000, level: 7 },   // Counties
          { maxScale: 750000, level: 9 },    // County
          { maxScale: 320000, level: 10 },   // Metro
          { maxScale: 160000, level: 10 },   // Cities
          { maxScale: 80000, level: 11 },    // City
          { maxScale: 40000, level: 11 },    // Town
          { maxScale: 20000, level: 12 },    // Neighborhood
          { maxScale: 2500, level: 15 },     // Buildings
          { maxScale: 1250, level: 15 },     // Building
          { maxScale: 800, level: 15 },      // Small building
          { maxScale: 400, level: 15 },      // Rooms
        ];
        this._esriLods = Array.isArray(serviceConfig?.metadata?.tileInfo?.lods)
          ? serviceConfig.metadata.tileInfo.lods
              .map((lod) => ({
                level: Number(lod?.level),
                scale: Number(lod?.scale),
              }))
              .filter((lod) => Number.isFinite(lod.level) && Number.isFinite(lod.scale))
              .sort((a, b) => a.scale - b.scale)
          : [];
        // The rectangular focus UV overlay is a useful fallback, but it creates
        // visible box artifacts because it refines a lon/lat rectangle rather than
        // the exact curved screen footprint. Prefer draped tile meshes instead.
        this.focusOverlayEnabled = true;
        this._lastViewKey = "";

        this.loaded = new Set();
        this.inflight = new Set();
        this.queued = new Set();
        this.queue = [];
        this.active = false;
        this.texture = this._createTexture(baseTexture, canvasWidth, canvasHeight);
        this.focusTexture = this._createFocusTexture(2048, 2048);
        this.focusBounds = new THREE.Vector4(0, 0, 0, 0);

        this._globe = null;
        this._baseTexture = baseTexture || null;
        this._baseStarted = false;
        this._lastKey = "";
        this._lastFocusKey = "";
        this._focusVersion = 0;
        this._focusState = null;
        this._focusDisplayState = { active: false, level: 0, tileCount: 0 };
        this._focusImageCache = new Map();
        this._focusControllers = new Map();
        this._focusQueue = [];
        this._focusQueuedKeys = new Set();
        this._focusInflight = 0;
        this._focusRoundSuccesses = 0;
        this._focusEnqueuePausedUntil = 0;
        this._focusResolvedLevels = new Map();
        this._focusResolvedAnchor = null;
        // Tracks the highest level painted per cell at the micro-level resolution.
        // Prevents late-arriving coarser tiles from overwriting finer data.
        this._tilePaintLevel = null;
        this._tilePaintTrackLevel = null;
        this._onFocusTextureChanged = null;
        this._tileImageCache = new Map();
        this._blankProbeCanvas = document.createElement("canvas");
        this._blankProbeCanvas.width = 32;
        this._blankProbeCanvas.height = 32;
        this._blankProbeCtx = this._blankProbeCanvas.getContext("2d", { willReadFrequently: true });
        this._failedUntil = new Map();
        this._failedStatus = new Map();
        this._cappedAncestorUntil = new Map();
        this._resolvedFallbackCaps = new Map();
        this._lastFocusUpdateAt = 0;
        // Draw the pre-built full-planet base image immediately so the globe shows
        // level-3 CTX coverage the instant the layer is activated, with zero network wait.
        // Higher-res tiles stream on top progressively as the user navigates.
        this._loadGlobalBase();
        this._prevCx = 0; this._prevCy = 0; this._prevCz = 1;
        this._lastCamPos = new THREE.Vector3(NaN, NaN, NaN);
        this._lastCamMoveAt = 0;
        this._raycaster = new THREE.Raycaster();
        this._sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), this.GLOBE_R);
        this._hitTarget = new THREE.Vector3();
        this._ndcSamples = [];
        // Inner grid at ±0.9 step 0.3 (covers 87% of screen) plus screen-edge samples
        for (let y = -0.9; y <= 0.9; y += 0.3) {
          for (let x = -0.9; x <= 0.9; x += 0.3) {
            this._ndcSamples.push(new THREE.Vector2(Number(x.toFixed(2)), Number(y.toFixed(2))));
          }
        }
        // Screen-edge samples to capture full viewport extent at close zoom
        for (const e of [-1, -0.5, 0, 0.5, 1]) {
          this._ndcSamples.push(new THREE.Vector2(e, -1));
          this._ndcSamples.push(new THREE.Vector2(e,  1));
          this._ndcSamples.push(new THREE.Vector2(-1, e));
          this._ndcSamples.push(new THREE.Vector2( 1, e));
        }
      }

      _createTexture(baseTexture, width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = true;
        context.fillStyle = "#606060";
        context.fillRect(0, 0, width, height);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        this.canvas = canvas;
        this.context = context;
        return texture;
      }

      _createFocusTexture(width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = false;
        context.clearRect(0, 0, width, height);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        this.focusCanvas = canvas;
        this.focusContext = context;
        return texture;
      }

      _recreateFocusTexture() {
        const previous = this.focusTexture || null;
        const texture = new THREE.CanvasTexture(this.focusCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.repeat.copy(previous?.repeat || new THREE.Vector2(1, 1));
        texture.offset.copy(previous?.offset || new THREE.Vector2(0, 0));
        texture.anisotropy = previous?.anisotropy || 1;
        texture.needsUpdate = true;
        this.focusTexture = texture;
        if (typeof this._onFocusTextureChanged === "function") {
          this._onFocusTextureChanged(texture);
        }
        if (previous) {
          previous.dispose();
        }
      }

      _resizeFocusCanvasForTileRange(tileRange, preserve = false) {
        if (preserve) {
          return;
        }
        const cols = Math.max(1, (tileRange.cMax - tileRange.cMin + 1));
        const rows = Math.max(1, (tileRange.rMax - tileRange.rMin + 1));
        const idealWidth = cols * 512;
        const idealHeight = rows * 512;
        const scale = Math.min(
          1,
          this.FOCUS_TEXTURE_MAX_SIZE / Math.max(idealWidth, 1),
          this.FOCUS_TEXTURE_MAX_SIZE / Math.max(idealHeight, 1),
        );
        const width = Math.max(512, Math.round(idealWidth * scale));
        const height = Math.max(512, Math.round(idealHeight * scale));
        if (this.focusCanvas.width === width && this.focusCanvas.height === height) {
          this.focusContext.imageSmoothingEnabled = false;
          return;
        }
        this.focusCanvas.width = width;
        this.focusCanvas.height = height;
        this.focusContext.imageSmoothingEnabled = false;
        this._recreateFocusTexture();
      }

      activate() {
        this.active = true;
        if (this.BACKGROUND_STREAMING) {
          if (!this._overviewStarted) {
            this._overviewStarted = true;
            for (const level of [0, 1, 2]) {
              const nc = 1 << (level + 1);
              const nr = 1 << level;
              for (let row = 0; row < nr; row += 1) {
                for (let col = 0; col < nc; col += 1) {
                  this._enq(level, row, col, 0, 0, 1, -1000 + level);
                }
              }
            }
          }
          if (!this._baseStarted) {
            this._baseStarted = true;
            const nc = 1 << (this.MIN_LEVEL + 1);
            const nr = 1 << this.MIN_LEVEL;
            for (let row = 0; row < nr; row += 1) {
              for (let col = 0; col < nc; col += 1) {
                this._enq(this.MIN_LEVEL, row, col, 0, 0, 1, -100);
              }
            }
          }
          this._drain();
        }
      }

      deactivate() {
        this.active = false;
        this.queue = [];
        this.queued.clear();
        this._lastKey = "";
        this._lastFocusKey = "";
        this._lastViewKey = "";
        this._focusVersion += 1;
        this._abortFocusFetches();
        this._clearFocusResolvedLevels();
        this._focusState = null;
        this._focusDisplayState = { active: false, level: 0, tileCount: 0 };
        this.focusContext.clearRect(0, 0, this.focusCanvas.width, this.focusCanvas.height);
        this.focusTexture.needsUpdate = true;
        this.focusBounds.set(0, 0, 0, 0);
      }

      hasVisibleFocus() {
        return Boolean(
          this.active &&
          this._focusDisplayState.active &&
          this.focusBounds.y > this.focusBounds.x &&
          this.focusBounds.w > this.focusBounds.z
        );
      }

      _abortFocusFetches() {
        for (const controller of this._focusControllers.values()) {
          controller.abort();
        }
        this._focusControllers.clear();
        this._focusQueue = [];
        this._focusQueuedKeys.clear();
        this._focusInflight = 0;
      }

      _clearFocusResolvedLevels() {
        this._focusResolvedLevels.clear();
        this._focusResolvedAnchor = null;
      }

      _focusAnchorForBbox(bbox) {
        if (!bbox) {
          return null;
        }
        return {
          lon: (bbox.lonMin + bbox.lonMax) * 0.5,
          lat: (bbox.latMin + bbox.latMax) * 0.5,
          lonSpan: Math.max(bbox.lonMax - bbox.lonMin, 1e-6),
          latSpan: Math.max(bbox.latMax - bbox.latMin, 1e-6),
        };
      }

      _focusAnchorShiftDeg(bbox) {
        const next = this._focusAnchorForBbox(bbox);
        if (!next || !this._focusResolvedAnchor) {
          return Infinity;
        }
        const lon = this._wrapLonNear(this._focusResolvedAnchor.lon, next.lon);
        const lonDelta = lon - this._focusResolvedAnchor.lon;
        const latDelta = next.lat - this._focusResolvedAnchor.lat;
        return Math.hypot(lonDelta, latDelta);
      }

      _estimateLocalFocusLevel(targetLevel, bbox) {
        const resolved = [];
        for (const [key, resolvedLevel] of this._focusResolvedLevels.entries()) {
          const parts = key.split("/");
          if (parts.length !== 3) continue;
          const level = Number(parts[0]);
          const row = Number(parts[1]);
          const col = Number(parts[2]);
          if (!Number.isFinite(level) || !Number.isFinite(row) || !Number.isFinite(col)) continue;
          if (level !== targetLevel) continue;
          const bounds = this._getTileBounds(level, row, col);
          const intersects = !(
            bounds.lonMax <= bbox.lonMin
            || bounds.lonMin >= bbox.lonMax
            || bounds.latMax <= bbox.latMin
            || bounds.latMin >= bbox.latMax
          );
          if (intersects) {
            resolved.push(resolvedLevel);
          }
        }
        if (!resolved.length) {
          return targetLevel;
        }
        const maxResolved = Math.max(...resolved);
        const minResolved = Math.min(...resolved);
        if (maxResolved < targetLevel) {
          return maxResolved;
        }
        return Math.max(minResolved, targetLevel);
      }

      _drainFocusQueue() {
        while (this._focusInflight < this.MAX_FOCUS_INFLIGHT && this._focusQueue.length > 0) {
          const item = this._focusQueue.shift();
          this._focusQueuedKeys.delete(item.requestKey);
          this._focusInflight += 1;
          const floorLevel = this._focusState?.meta?.fetchMinLevel
            ?? this._focusState?.meta?.minLevel
            ?? this.MIN_LEVEL;
          this._fetchTilePayloadWithFallback(item.level, item.row, item.col, floorLevel, item.controller.signal).then((payload) => {
            if (!payload || !payload.image) {
              return;
            }
            if (!this._focusState || this._focusState.version !== item.version) {
              return;
            }
            this._focusRoundSuccesses += 1;
            this._focusResolvedLevels.set(`${item.level}/${item.row}/${item.col}`, payload.level);
            if (payload.level < item.level) {
              this._noteResolvedFallbackCap(item.level, item.row, item.col, payload.level);
            }
            if (payload.level >= item.level) {
              this._drawFocusTile(payload.level, payload.row, payload.col, payload.image, this._focusState);
            }
            window.__ctxPatchDebug = {
              ...(window.__ctxPatchDebug || {}),
              baseLayer: "ctx-mosaic",
              mode: "focus-overlay",
              active: true,
              level: this._focusDisplayState.level,
              refinementBbox: this._focusState?.bbox ? { ...this._focusState.bbox } : null,
              viewTileCount: this._focusDisplayState.tileCount,
              resolvedTileCount: this._focusResolvedLevels.size,
              lastResolvedKey: `${payload.level}/${payload.row}/${payload.col}`,
              lastResolvedUrl: `${this.TILE_BASE}/${payload.level}/${payload.row}/${payload.col}`,
              resolvedFromLevel: payload.level,
              requestedLevel: item.level,
              inflightCount: this._focusInflight,
              queueLength: this._focusQueue.length,
              visible: this.hasVisibleFocus(),
            };
          }).catch(() => {
            /* focus requests are opportunistic and are aborted aggressively */
          }).finally(() => {
            this._focusControllers.delete(item.requestKey);
            this._focusInflight = Math.max(0, this._focusInflight - 1);
            if (this._focusInflight === 0 && this._focusQueue.length === 0 && this._focusState) {
              if (this._focusRoundSuccesses === 0) {
                // All tiles failed (e.g. CORS). Back off 30 s to stop the tight retry loop.
                this._focusEnqueuePausedUntil = performance.now() + 30000;
              }
              const effectiveLevel = this._estimateLocalFocusLevel(this._focusState.level, this._focusState.bbox);
              if (effectiveLevel < this._focusState.level) {
                this._refreshFocus(
                  this._focusState.bbox,
                  effectiveLevel,
                  this._focusState.meta || {},
                );
                return;
              }
            }
            window.__ctxPatchDebug = {
              ...(window.__ctxPatchDebug || {}),
              baseLayer: "ctx-mosaic",
              mode: "focus-overlay",
              active: this._focusDisplayState.active,
              inflightCount: this._focusInflight,
              queueLength: this._focusQueue.length,
              resolvedTileCount: this._focusResolvedLevels.size,
              visible: this.hasVisibleFocus(),
            };
            this._drainFocusQueue();
          });
        }
      }

      _drawTile(level, row, col, image) {
        this._drawTileToCanvas(this.context, this.canvas.width, this.canvas.height, level, row, col, image);
        this.texture.needsUpdate = true;
      }

      _drawTileToCanvas(context, width, height, level, row, col, image) {
        const nc = 1 << (level + 1);
        const nr = 1 << level;
        const tileWidth = width / nc;
        const tileHeight = height / nr;
        const x = col * tileWidth;
        const y = row * tileHeight;
        context.drawImage(image, x, y, tileWidth, tileHeight);
      }

      _getTileBounds(level, row, col) {
        const nc = 1 << (level + 1);
        const nr = 1 << level;
        return {
          lonMin: (col / nc) * 360 - 180,
          lonMax: ((col + 1) / nc) * 360 - 180,
          latMax: 90 - (row / nr) * 180,
          latMin: 90 - ((row + 1) / nr) * 180,
        };
      }

      _getAllowedCtxLevels(minLevel = this.MIN_LEVEL, maxLevel = this.FOCUS_MAX_LEVEL) {
        const levels = this.ALLOWED_CTX_LEVELS.filter((level) => level >= minLevel && level <= maxLevel);
        return levels.length ? levels : [clamp(maxLevel, minLevel, maxLevel)];
      }

      _snapCtxLevel(targetLevel, {
        minLevel = this.MIN_LEVEL,
        maxLevel = this.FOCUS_MAX_LEVEL,
        preferLower = true,
      } = {}) {
        const clampedTarget = clamp(targetLevel, minLevel, maxLevel);
        const allowed = this._getAllowedCtxLevels(minLevel, maxLevel);
        if (preferLower) {
          for (let index = allowed.length - 1; index >= 0; index -= 1) {
            if (allowed[index] <= clampedTarget) {
              return allowed[index];
            }
          }
          return allowed[0];
        }
        for (const level of allowed) {
          if (level >= clampedTarget) {
            return level;
          }
        }
        return allowed[allowed.length - 1];
      }

      _stepCtxLevelTowards(currentLevel, targetLevel, minLevel = this.MIN_LEVEL, maxLevel = this.FOCUS_MAX_LEVEL) {
        const allowed = this._getAllowedCtxLevels(minLevel, maxLevel);
        const current = this._snapCtxLevel(currentLevel, { minLevel, maxLevel, preferLower: true });
        const target = this._snapCtxLevel(targetLevel, { minLevel, maxLevel, preferLower: true });
        const currentIndex = allowed.indexOf(current);
        const targetIndex = allowed.indexOf(target);
        if (currentIndex === -1 || targetIndex === -1 || currentIndex === targetIndex) {
          return target;
        }
        return allowed[currentIndex + Math.sign(targetIndex - currentIndex)];
      }

      _getNextLowerCtxLevel(level, minLevel = this.MIN_LEVEL) {
        const allowed = this._getAllowedCtxLevels(minLevel, this.FOCUS_MAX_LEVEL);
        for (let index = allowed.length - 1; index >= 0; index -= 1) {
          if (allowed[index] < level) {
            return allowed[index];
          }
        }
        return this._snapCtxLevel(minLevel, { minLevel, maxLevel: this.FOCUS_MAX_LEVEL, preferLower: false });
      }

      _getNextHigherCtxLevel(level, maxLevel = this.FOCUS_MAX_LEVEL) {
        const allowed = this._getAllowedCtxLevels(this.MIN_LEVEL, maxLevel);
        for (const allowedLevel of allowed) {
          if (allowedLevel > level) {
            return allowedLevel;
          }
        }
        return this._snapCtxLevel(maxLevel, { minLevel: this.MIN_LEVEL, maxLevel, preferLower: true });
      }

      _chooseFocusLevel(lonSpan, latSpan) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const screenWidth = Math.max(window.innerWidth * dpr, 1);
        const screenHeight = Math.max(window.innerHeight * dpr, 1);
        const pxPerDegX = screenWidth / Math.max(lonSpan, 1e-4);
        const pxPerDegY = screenHeight / Math.max(latSpan, 1e-4);
        const requiredTexelsPerDeg = Math.max(pxPerDegX, pxPerDegY) * 2;
        const targetDeg = clamp(512 / Math.max(requiredTexelsPerDeg, 1), 0.0005, 45);
        const rawLevel = Math.max(this.MIN_LEVEL, Math.min(this.FOCUS_MAX_LEVEL, Math.ceil(Math.log2(360 / targetDeg) - 1)));
        return this._snapCtxLevel(rawLevel, { minLevel: this.MIN_LEVEL, maxLevel: this.FOCUS_MAX_LEVEL, preferLower: true });
      }

      _getFocusStage(camera, visibleBbox, focusTarget = null) {
        const altitude = Math.max(0, camera.position.length() - this.GLOBE_R);
        // At true global view (altitude > 8.2) the background canvas provides context;
        // focus canvas activates from medium-close zoom onward.
        if (altitude > 8.2) {
          return null;
        }
        const focusBbox = focusTarget
          ? this._buildRefinementBbox(visibleBbox, focusTarget, altitude)
          : visibleBbox;
        const lonSpan = Math.max((focusBbox?.lonMax ?? visibleBbox.lonMax) - (focusBbox?.lonMin ?? visibleBbox.lonMin), 0.02);
        const latSpan = Math.max((focusBbox?.latMax ?? visibleBbox.latMax) - (focusBbox?.latMin ?? visibleBbox.latMin), 0.02);
        // Minimum tile level increases as altitude decreases (more detail when zoomed in).
        // MAX_FOCUS_TILES caps the total tiles loaded; _refreshFocus auto-reduces level if needed.
        let minLevel = 5;
        if (altitude <= 3.2) minLevel = 7;
        if (altitude <= 1.8) minLevel = 9;
        if (altitude <= 1.0) minLevel = 10;
        if (altitude <= 0.55) minLevel = 12;
        if (altitude <= 0.18) minLevel = Math.max(minLevel, Math.min(this.FOCUS_MAX_LEVEL, 12));
        if (altitude <= 0.08) minLevel = Math.max(minLevel, Math.min(this.FOCUS_MAX_LEVEL, 12));
        if (lonSpan <= 0.45 && latSpan <= 0.45) {
          minLevel = Math.max(minLevel, Math.min(this.FOCUS_MAX_LEVEL, 12));
        }
        minLevel = this._snapCtxLevel(minLevel, { minLevel: this.MIN_LEVEL, maxLevel: this.FOCUS_MAX_LEVEL, preferLower: false });
        // Choose the level from the tight focus bbox, not the whole viewport.
        const chosenLevel = this._chooseFocusLevel(lonSpan, latSpan);
        const level = this._snapCtxLevel(Math.max(chosenLevel, minLevel), {
          minLevel,
          maxLevel: this.FOCUS_MAX_LEVEL,
          preferLower: true,
        });
        return { altitude, targetLonSpan: lonSpan, targetLatSpan: latSpan, level, focusBbox };
      }

      _getAltitudeTierLevel(altitude) {
        if (altitude <= 0.06) return Math.min(this.FOCUS_MAX_LEVEL, 15);
        if (altitude <= 0.22) return Math.min(this.FOCUS_MAX_LEVEL, 12);
        if (altitude <= 0.45) return Math.min(this.FOCUS_MAX_LEVEL, 11);
        if (altitude <= 0.9) return Math.min(this.FOCUS_MAX_LEVEL, 10);
        if (altitude <= 1.6) return Math.min(this.FOCUS_MAX_LEVEL, 9);
        return Math.min(this.FOCUS_MAX_LEVEL, 7);
      }

      _getScaleTierLevel(scaleDenominator) {
        const scaleBarMeters = Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null;
        if (Number.isFinite(scaleBarMeters)) {
          if (scaleBarMeters <= 2500) {
            return Math.min(this.FOCUS_MAX_LEVEL, 15);
          }
          if (scaleBarMeters < 5000) {
            return Math.min(this.FOCUS_MAX_LEVEL, 12);
          }
        }
        if (!Number.isFinite(scaleDenominator) || scaleDenominator <= 0) {
          return null;
        }
        let best = null;
        for (const step of this.SCALE_STEPS) {
          if (scaleDenominator <= step.maxScale) {
            if (!best || step.maxScale < best.maxScale) {
              best = step;
            }
          }
        }
        if (best) {
          return Math.min(this.FOCUS_MAX_LEVEL, best.level);
        }
        return Math.min(this.FOCUS_MAX_LEVEL, 7);
      }

      _chooseEsriLodLevel(scaleDenominator) {
        if (!Number.isFinite(scaleDenominator) || scaleDenominator <= 0 || !this._esriLods.length) {
          return null;
        }
        let best = null;
        let bestScore = Infinity;
        for (const lod of this._esriLods) {
          const score = Math.abs(Math.log(scaleDenominator / lod.scale));
          if (score < bestScore) {
            bestScore = score;
            best = lod;
          }
        }
        if (!best) return null;
        return this._snapCtxLevel(best.level, {
          minLevel: this.MIN_LEVEL,
          maxLevel: this.FOCUS_MAX_LEVEL,
          preferLower: true,
        });
      }

      _smoothFocusLevel(targetLevel) {
        if (!Number.isFinite(targetLevel)) {
          return null;
        }
        targetLevel = this._snapCtxLevel(targetLevel, {
          minLevel: this.MIN_LEVEL,
          maxLevel: this.FOCUS_MAX_LEVEL,
          preferLower: true,
        });
        if (this._focusLevelSmoothed === null) {
          this._focusLevelSmoothed = targetLevel;
          this._lastFocusLevelAt = performance.now();
          return targetLevel;
        }
        if (this._focusLevelSmoothed === targetLevel) {
          return targetLevel;
        }
        const now = performance.now();
        if (now - this._lastFocusLevelAt < 120) {
          return this._focusLevelSmoothed;
        }
        this._lastFocusLevelAt = now;
        this._focusLevelSmoothed = this._stepCtxLevelTowards(
          this._focusLevelSmoothed,
          targetLevel,
          this.MIN_LEVEL,
          this.FOCUS_MAX_LEVEL,
        );
        return this._focusLevelSmoothed;
      }

      _buildFocusBboxAroundTarget(target, lonSpan, latSpan) {
        if (!target) {
          return null;
        }
        const lonHalf = lonSpan * 0.5;
        const latHalf = latSpan * 0.5;
        return {
          lonMin: target.lon - lonHalf,
          lonMax: target.lon + lonHalf,
          latMin: Math.max(-90, target.lat - latHalf),
          latMax: Math.min(90, target.lat + latHalf),
        };
      }

      _computeBudgetBbox(level, visibleBbox, focusTarget, budget) {
        if (!visibleBbox) return null;
        const tileLonSpan = 360 / (1 << (level + 1));
        const tileLatSpan = 180 / (1 << level);
        const visibleRange = this._getFocusTileRange(level, visibleBbox);
        if (visibleRange.tileCount <= budget) {
          return { ...visibleBbox };
        }
        const lonSpanView = Math.max(visibleBbox.lonMax - visibleBbox.lonMin, tileLonSpan);
        const latSpanView = Math.max(visibleBbox.latMax - visibleBbox.latMin, tileLatSpan);
        const aspect = clamp(lonSpanView / Math.max(latSpanView, 1e-6), 0.2, 5);
        const tilesLat = Math.max(1, Math.floor(Math.sqrt(budget / aspect)));
        const tilesLon = Math.max(1, Math.floor(tilesLat * aspect));
        const target = focusTarget || {
          lon: (visibleBbox.lonMin + visibleBbox.lonMax) * 0.5,
          lat: (visibleBbox.latMin + visibleBbox.latMax) * 0.5,
        };
        return this._buildFocusBboxAroundTarget(
          target,
          tileLonSpan * tilesLon,
          tileLatSpan * tilesLat,
        );
      }

      _ensureMinSpanBbox(bbox, minLonSpan, minLatSpan) {
        if (!bbox) {
          return null;
        }
        const lonCenter = (bbox.lonMin + bbox.lonMax) * 0.5;
        const latCenter = (bbox.latMin + bbox.latMax) * 0.5;
        const lonSpan = Math.max(bbox.lonMax - bbox.lonMin, minLonSpan);
        const latSpan = Math.max(bbox.latMax - bbox.latMin, minLatSpan);
        return {
          lonMin: lonCenter - lonSpan * 0.5,
          lonMax: lonCenter + lonSpan * 0.5,
          latMin: Math.max(-90, latCenter - latSpan * 0.5),
          latMax: Math.min(90, latCenter + latSpan * 0.5),
        };
      }

      _wrapLonNear(referenceLon, lon) {
        let delta = lon - referenceLon;
        while (delta < -180) delta += 360;
        while (delta > 180) delta -= 360;
        return referenceLon + delta;
      }

      _buildRefinementBbox(viewBbox, focusTarget, altitude) {
        if (!viewBbox) {
          return null;
        }
        if (!focusTarget) {
          return viewBbox;
        }
        const rawLonSpan = Math.max(viewBbox.lonMax - viewBbox.lonMin, 0.1);
        const rawLatSpan = Math.max(viewBbox.latMax - viewBbox.latMin, 0.1);
        const altitudeT = clamp(altitude / 8.0, 0, 1);
        const spanFactor = THREE.MathUtils.lerp(0.025, 0.22, altitudeT);
        const lonSpan = clamp(rawLonSpan * spanFactor, 0.005, 45);
        const latSpan = clamp(rawLatSpan * spanFactor, 0.005, 30);
        const referenceLon = (viewBbox.lonMin + viewBbox.lonMax) * 0.5;
        const centerLon = this._wrapLonNear(referenceLon, focusTarget.lon);
        const centerLat = clamp(focusTarget.lat, -90, 90);
        return {
          lonMin: centerLon - lonSpan * 0.5,
          lonMax: centerLon + lonSpan * 0.5,
          latMin: clamp(centerLat - latSpan * 0.5, -90, 90),
          latMax: clamp(centerLat + latSpan * 0.5, -90, 90),
        };
      }

      _updateFocusBounds(bbox) {
        const centerLon = this._wrapLonNear(0, (bbox.lonMin + bbox.lonMax) * 0.5);
        const lonMinWrapped = this._wrapLonNear(centerLon, bbox.lonMin);
        const lonMaxWrapped = this._wrapLonNear(centerLon, bbox.lonMax);
        const lonSpan = lonMaxWrapped - lonMinWrapped;
        let uMin = clamp((lonMinWrapped + 180) / 360, 0, 1);
        let uMax = clamp((lonMaxWrapped + 180) / 360, 0, 1);
        if (lonSpan >= 350 || uMax < uMin) {
          uMin = 0;
          uMax = 1;
        }
        // Sphere UV V convention: V=0 at south pole, V=1 at north pole.
        // latToTextureV() is canvas-space (V=0=north) — the opposite. Use sphere UV
        // convention directly so the shader mask and texture repeat/offset are consistent.
        const vSouth = clamp((bbox.latMin + 90) / 180, 0, 1);
        const vNorth = clamp((bbox.latMax + 90) / 180, 0, 1);
        const spanU = Math.max(uMax - uMin, 1e-4);
        const spanV = Math.max(vNorth - vSouth, 1e-4);
        // z=vSouth, w=vNorth — shader mask compares against sphere UV.y (0=south, 1=north)
        this.focusBounds.set(uMin, uMax, vSouth, vNorth);
        this.focusTexture.repeat.set(1 / spanU, 1 / spanV);
        this.focusTexture.offset.set(-uMin / spanU, -vSouth / spanV);
        this.focusTexture.needsUpdate = true;
      }

      _drawFocusTile(level, row, col, image, focusState) {
        if (!focusState || focusState.version !== this._focusVersion) {
          return;
        }
        // Sequential multi-resolution guard: prevent a coarser tile that arrives late
        // from overwriting finer data already painted onto the canvas.
        // _tilePaintLevel records the highest level drawn per cell at the micro-level
        // resolution (_tilePaintTrackLevel). Coarser tiles skip cells already covered
        // by finer tiles, keeping the canvas in a strictly coarse→fine painted state.
        const trackLevel = this._tilePaintTrackLevel;
        if (Number.isFinite(trackLevel) && level < trackLevel && this._tilePaintLevel?.size > 0) {
          const delta = trackLevel - level;
          const refNc = 1 << (trackLevel + 1);
          const refNr = 1 << trackLevel;
          const rStart = row << delta;
          const rEnd = Math.min(((row + 1) << delta) - 1, refNr - 1);
          const cStart = col << delta;
          const cEnd = ((col + 1) << delta) - 1;
          for (let r = rStart; r <= rEnd; r++) {
            for (let c = cStart; c <= cEnd; c++) {
              const wc = ((c % refNc) + refNc) % refNc;
              if ((this._tilePaintLevel.get(`${r}/${wc}`) || 0) > level) {
                return; // finer tile already covers this region — skip coarser overwrite
              }
            }
          }
        }
        const tile = this._getTileBounds(level, row, col);
        const bbox = focusState.bbox;
        const lonSpan = Math.max(bbox.lonMax - bbox.lonMin, 1e-4);
        const latSpan = Math.max(bbox.latMax - bbox.latMin, 1e-4);
        const drawX = ((tile.lonMin - bbox.lonMin) / lonSpan) * this.focusCanvas.width;
        const drawY = ((bbox.latMax - tile.latMax) / latSpan) * this.focusCanvas.height;
        const drawW = ((tile.lonMax - tile.lonMin) / lonSpan) * this.focusCanvas.width;
        const drawH = ((tile.latMax - tile.latMin) / latSpan) * this.focusCanvas.height;
        this.focusContext.drawImage(image, drawX, drawY, drawW, drawH);
        // Register fine tiles so subsequent coarser-tile arrivals can detect the overlap.
        if (Number.isFinite(trackLevel) && level >= trackLevel) {
          if (!this._tilePaintLevel) this._tilePaintLevel = new Map();
          const nc = 1 << (level + 1);
          const wc = ((col % nc) + nc) % nc;
          const key = `${row}/${wc}`;
          if ((this._tilePaintLevel.get(key) || 0) < level) {
            this._tilePaintLevel.set(key, level);
          }
        }
        this.focusTexture.needsUpdate = true;
      }

      _pruneImageCache() {
        if (this._tileImageCache.size <= this.MAX_TILE_CACHE) {
          return;
        }
        const deleteCount = this._tileImageCache.size - this.MAX_TILE_CACHE;
        const keys = this._tileImageCache.keys();
        for (let i = 0; i < deleteCount; i += 1) {
          const next = keys.next();
          if (next.done) {
            break;
          }
          this._tileImageCache.delete(next.value);
        }
      }

      // Draw the pre-built 8192×4096 level-3 mosaic to the canvas immediately,
      // giving instant global coverage before any per-tile streaming begins.
      _loadGlobalBase() {
        // This is the STREAMER's global fallback mosaic (ctx_base.jpg), which
        // only Mars ships — on this world the request just 404s at boot.
        if (!BODY_STREAMS_TILES) return;
        const img = new Image();
        img.onload = () => {
          this.context.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
          this.texture.needsUpdate = true;
        };
        img.src = './assets/ctx_base.jpg';
      }

      _getTileFailureCooldownMs(status) {
        if (status >= 500) {
          return 120000;
        }
        if (status === 404) {
          return 60000;
        }
        return 15000;
      }

      _isProxyTileBase() {
        try {
          return new URL(this.TILE_BASE, window.location.href).pathname.includes("/ctx-proxy/tile/");
        } catch (_) {
          return String(this.TILE_BASE || "").includes("/ctx-proxy/tile/");
        }
      }

      _noteServerFailureCap(level, row, col, status) {
        if (status < 500 || level <= this.MIN_LEVEL) {
          return;
        }
        const until = performance.now() + this._getTileFailureCooldownMs(status);
        const parentLevel = level - 1;
        const parentRow = Math.floor(row / 2);
        const parentCol = Math.floor(col / 2);
        const key = `${parentLevel}/${parentRow}/${parentCol}`;
        this._cappedAncestorUntil.set(key, until);
      }

      _getTileLevelCap(level, row, col) {
        let scanLevel = level;
        let scanRow = row;
        let scanCol = col;
        while (scanLevel > this.MIN_LEVEL) {
          const fallbackKey = `${scanLevel}/${scanRow}/${scanCol}`;
          const fallbackCap = this._resolvedFallbackCaps.get(fallbackKey);
          if (fallbackCap) {
            if (fallbackCap.until > performance.now()) {
              return Math.max(this.MIN_LEVEL, Math.min(level, fallbackCap.capLevel));
            }
            this._resolvedFallbackCaps.delete(fallbackKey);
          }
          scanLevel -= 1;
          scanRow = Math.floor(scanRow / 2);
          scanCol = Math.floor(scanCol / 2);
        }
        if (level <= this.MIN_LEVEL) {
          return level;
        }
        const parentLevel = level - 1;
        const parentRow = Math.floor(row / 2);
        const parentCol = Math.floor(col / 2);
        const key = `${parentLevel}/${parentRow}/${parentCol}`;
        const until = this._cappedAncestorUntil.get(key) || 0;
        if (until > performance.now()) {
          return parentLevel;
        }
        if (until > 0) {
          this._cappedAncestorUntil.delete(key);
        }
        return level;
      }

      _noteResolvedFallbackCap(requestedLevel, requestedRow, requestedCol, resolvedLevel) {
        if (!Number.isFinite(requestedLevel) || !Number.isFinite(resolvedLevel) || resolvedLevel >= requestedLevel) {
          return;
        }
        const until = performance.now() + (6 * 60 * 60 * 1000);
        let level = requestedLevel;
        let row = requestedRow;
        let col = requestedCol;
        while (level > resolvedLevel) {
          this._resolvedFallbackCaps.set(`${level}/${row}/${col}`, { capLevel: resolvedLevel, until });
          level -= 1;
          row = Math.floor(row / 2);
          col = Math.floor(col / 2);
        }
      }

      async _decodeTileBlob(blob) {
        return await new Promise((resolve, reject) => {
          const objectUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
          };
          img.onerror = (error) => {
            URL.revokeObjectURL(objectUrl);
            reject(error);
          };
          img.src = objectUrl;
        });
      }

      _isLikelyBlankImage(image) {
        if (!this._blankProbeCtx || !image || !image.width || !image.height) {
          return false;
        }
        const ctx = this._blankProbeCtx;
        const w = this._blankProbeCanvas.width;
        const h = this._blankProbeCanvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(image, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let transparent = 0;
        let sum = 0;
        let sumSq = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 8) {
            transparent += 1;
            continue;
          }
          const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
          sum += v;
          sumSq += v * v;
        }
        const total = data.length / 4;
        if (transparent / total > 0.98) {
          return true;
        }
        const count = total - transparent;
        if (count <= 8) {
          return true;
        }
        const mean = sum / count;
        const variance = Math.max(0, sumSq / count - mean * mean);
        if (variance < 2 && mean < 8) {
          return true;
        }
        return false;
      }

      // Fetch a tile image. The Service Worker (sw-ctx-tiles.js) intercepts these
      // requests and serves cached responses from the Cache API on revisit —
      // making previously-seen tiles effectively instant without any JS overhead.
      async _fetchImage(level, row, col, signal = undefined) {
        const key = `${level}/${row}/${col}`;
        if (this._tileImageCache.has(key)) return this._tileImageCache.get(key);
        const failedUntil = this._failedUntil.get(key) || 0;
        if (failedUntil > performance.now()) return null;
        const url = this._isProxyTileBase()
          ? `${this.TILE_BASE}/${level}/${row}/${col}?blankTile=true`
          : `${this.TILE_BASE}/${level}/${row}/${col}`;
        try {
          const response = await fetch(url, {
            cache: "default",
            mode: "cors",
            signal,
          });
          const contentType = String(response.headers.get("Content-Type") || "").toLowerCase();
          const upstreamStatus = Number(response.headers.get("X-CTX-Upstream-Status") || response.status || 0);
          const blankTile = response.headers.get("X-CTX-Blank-Tile") === "1";
          if (blankTile) {
            this._failedStatus.set(key, upstreamStatus || response.status || 0);
            this._failedUntil.set(
              key,
              performance.now() + this._getTileFailureCooldownMs(upstreamStatus || response.status || 0),
            );
            this._noteServerFailureCap(level, row, col, upstreamStatus || response.status || 0);
            return null;
          }
          if (this._isProxyTileBase() && !contentType.startsWith("image/")) {
            this._failedStatus.set(key, upstreamStatus || response.status || 0);
            this._failedUntil.set(
              key,
              performance.now() + this._getTileFailureCooldownMs(upstreamStatus || response.status || 0),
            );
            this._noteServerFailureCap(level, row, col, upstreamStatus || response.status || 0);
            return null;
          }
          if (!response.ok) {
            this._failedStatus.set(key, response.status);
            this._failedUntil.set(key, performance.now() + this._getTileFailureCooldownMs(response.status));
            this._noteServerFailureCap(level, row, col, response.status);
            return null;
          }
          const blob = await response.blob();
          const image = await this._decodeTileBlob(blob);
          if (this._isLikelyBlankImage(image)) {
            this._failedStatus.set(key, 204);
            this._failedUntil.set(key, performance.now() + this._getTileFailureCooldownMs(204));
            return null;
          }
          this._failedUntil.delete(key);
          this._failedStatus.delete(key);
          this._tileImageCache.set(key, image);
          this._pruneImageCache();
          return image;
        } catch (err) {
          // AbortError is a deliberate cancel — not a server failure.
          // Do NOT set _failedUntil so the tile can be re-fetched immediately
          // when the camera settles again in the same area.
          if (err?.name === 'AbortError') {
            return null;
          }
          const status = this._failedStatus.get(key) || 0;
          const cooldownMs = this._getTileFailureCooldownMs(status || 0);
          this._failedUntil.set(key, performance.now() + cooldownMs);
          return null;
        }
      }

      async _fetchTilePayloadWithFallback(level, row, col, minLevel = this.MIN_LEVEL, signal = undefined) {
        let currentLevel = level;
        let currentRow = row;
        let currentCol = col;
        let lastFailureStatus = 0;
        while (currentLevel >= minLevel) {
          if (signal?.aborted) {
            return null;
          }
          const image = await this._fetchImage(currentLevel, currentRow, currentCol, signal);
          if (image) {
            return {
              image,
              level: currentLevel,
              row: currentRow,
              col: currentCol,
              requestedLevel: level,
              failedStatus: lastFailureStatus,
            };
          }
          lastFailureStatus = this._failedStatus.get(`${currentLevel}/${currentRow}/${currentCol}`) || lastFailureStatus;
          if (currentLevel === minLevel) {
            break;
          }
          const nextLevel = this._getNextLowerCtxLevel(currentLevel, minLevel);
          if (nextLevel === currentLevel) {
            break;
          }
          const delta = currentLevel - nextLevel;
          currentLevel = nextLevel;
          currentRow = Math.floor(currentRow / (1 << delta));
          currentCol = Math.floor(currentCol / (1 << delta));
        }
        return null;
      }

      _getMaxFocusTiles(level, meta = {}) {
        const altitude = Number.isFinite(meta.altitude) ? meta.altitude : Infinity;
        const caps = {
          7: 1024,
          9: 900,
          11: 512,
          12: 512,
          13: 256,
          14: 256,
          15: 900,
          16: 256,
          17: 196,
        };
        let maxTiles = this.MAX_FOCUS_TILES;
        if (level === 15) {
          maxTiles = Math.max(maxTiles, 900);
        }
        if (Number.isFinite(meta.maxFocusTiles)) {
          maxTiles = Math.min(maxTiles, meta.maxFocusTiles);
        }
        const levelCap = caps[level];
        if (Number.isFinite(levelCap)) {
          maxTiles = Math.min(maxTiles, levelCap);
        }
        return maxTiles;
      }

      _getFocusTileRange(level, bbox) {
        const nc = 1 << (level + 1);
        const nr = 1 << level;
        const pad = level >= 11 ? 0 : 1;
        const rMin = Math.max(0, Math.floor((90 - bbox.latMax) / 180 * nr) - pad);
        const rMax = Math.min(nr - 1, Math.ceil((90 - bbox.latMin) / 180 * nr) + pad);
        const cMin = Math.floor((bbox.lonMin + 180) / 360 * nc) - pad;
        const cMax = Math.ceil((bbox.lonMax + 180) / 360 * nc) + pad;
        return {
          nc,
          nr,
          rMin,
          rMax,
          cMin,
          cMax,
          tileCount: Math.max(0, (rMax - rMin + 1) * (cMax - cMin + 1)),
        };
      }

      _refreshFocus(bbox, focusLevel, meta = {}) {
        if (!bbox || bbox.lonMax - bbox.lonMin > 300) {
          this._focusVersion += 1;
          this._tilePaintLevel = null;
          this._tilePaintTrackLevel = null;
          this._abortFocusFetches();
          this._clearFocusResolvedLevels();
          this._focusState = null;
          this._focusDisplayState = { active: false, level: 0, tileCount: 0 };
          this.focusContext.clearRect(0, 0, this.focusCanvas.width, this.focusCanvas.height);
          this.focusBounds.set(0, 0, 0, 0);
          this.focusTexture.needsUpdate = true;
          return;
        }
        this._focusVersion += 1;
        this._tilePaintLevel = null;
        this._tilePaintTrackLevel = Number.isFinite(meta.microLevel) ? meta.microLevel : null;
        const version = this._focusVersion;
        const focusShiftDeg = this._focusAnchorShiftDeg(bbox);
        const hadActiveFocus = this._focusDisplayState.active;
        const prevLevel = this._focusDisplayState.level;
        this._abortFocusFetches();
        this._focusRoundSuccesses = 0;
        if (performance.now() < this._focusEnqueuePausedUntil) {
          return;
        }
        if (focusShiftDeg > Math.max(0.35, Math.min(
          this._focusResolvedAnchor?.lonSpan || Infinity,
          this._focusResolvedAnchor?.latSpan || Infinity,
        ))) {
          this._clearFocusResolvedLevels();
        }
        const minLevel = Number.isFinite(meta.minLevel) ? meta.minLevel : this.MIN_LEVEL;
        let boundedLevel = this._estimateLocalFocusLevel(focusLevel, bbox);
        let tileRange = this._getFocusTileRange(boundedLevel, bbox);
        const maxFocusTiles = this._getMaxFocusTiles(boundedLevel, meta);
        while (tileRange.tileCount > maxFocusTiles && boundedLevel > minLevel) {
          const nextLevel = this._getNextLowerCtxLevel(boundedLevel, minLevel);
          if (nextLevel === boundedLevel) {
            break;
          }
          boundedLevel = nextLevel;
          tileRange = this._getFocusTileRange(boundedLevel, bbox);
        }
        if (tileRange.tileCount > maxFocusTiles) {
          const cappedBbox = this._computeBudgetBbox(boundedLevel, bbox, meta.focusTarget, maxFocusTiles);
          if (cappedBbox) {
            bbox = cappedBbox;
            tileRange = this._getFocusTileRange(boundedLevel, bbox);
          }
        }
        if (tileRange.tileCount > maxFocusTiles * 1.25) {
          this._focusDisplayState = { active: false, level: 0, tileCount: 0 };
          return;
        }
        this._focusResolvedAnchor = this._focusAnchorForBbox(bbox);
        this._focusState = { bbox: { ...bbox }, level: boundedLevel, version, meta: { ...meta } };
        const cappedTileCount = Math.min(tileRange.tileCount, maxFocusTiles);
        this._focusDisplayState = { active: true, level: boundedLevel, tileCount: cappedTileCount };
        window.__ctxDebug = {
          ...(window.__ctxDebug || {}),
          focusActive: true,
          focusLevel: boundedLevel,
          focusTileCount: tileRange.tileCount,
          focusBbox: { ...bbox },
        };
        window.__ctxPatchDebug = {
          ...(window.__ctxPatchDebug || {}),
          baseLayer: "ctx-mosaic",
          mode: "focus-overlay",
          active: true,
          altitude: Number.isFinite(meta.altitude) ? meta.altitude : null,
          focusTarget: meta.focusTarget ? { ...meta.focusTarget } : null,
          level: boundedLevel,
          refinementBbox: { ...bbox },
          visibleBbox: meta.visibleBbox ? { ...meta.visibleBbox } : null,
          viewTileCount: tileRange.tileCount,
          maxFocusTiles,
          resolvedTileCount: this._focusResolvedLevels.size,
          inflightCount: this._focusInflight,
          queueLength: this._focusQueue.length,
          visible: this.hasVisibleFocus(),
          focusLayerInflight: this._focusInflight,
          focusLayerQueue: this._focusQueue.length,
        };
        const keepPrevious = Boolean(meta.keepPreviousOnUpgrade);
        this._resizeFocusCanvasForTileRange(tileRange, keepPrevious);
        const shouldClear = !hadActiveFocus
          || (!keepPrevious && boundedLevel !== prevLevel)
          || (keepPrevious && focusShiftDeg > 0.8)
          || (!keepPrevious && focusShiftDeg > 0.6);
        if (shouldClear) {
          this.focusContext.clearRect(0, 0, this.focusCanvas.width, this.focusCanvas.height);
        }
        this._updateFocusBounds(bbox);

        let enqueued = 0;
        for (let row = tileRange.rMin; row <= tileRange.rMax; row += 1) {
          for (let col = tileRange.cMin; col <= tileRange.cMax; col += 1) {
            if (enqueued >= maxFocusTiles) {
              break;
            }
            const wrappedCol = ((col % tileRange.nc) + tileRange.nc) % tileRange.nc;
            const key = `${boundedLevel}/${row}/${wrappedCol}`;
            if (this._focusImageCache.get(key) === version) {
              continue;
            }
            this._focusImageCache.set(key, version);
            const requestKey = `${version}:${key}`;
            if (this._focusQueuedKeys.has(requestKey)) {
              continue;
            }
            const controller = new AbortController();
            this._focusControllers.set(requestKey, controller);
            this._focusQueue.push({
              level: boundedLevel,
              row,
              col: wrappedCol,
              requestKey,
              version,
              controller,
            });
            this._focusQueuedKeys.add(requestKey);
            enqueued += 1;
          }
          if (enqueued >= maxFocusTiles) {
            break;
          }
        }
        if (this._focusQueue.length >= maxFocusTiles) {
          this._focusEnqueuePausedUntil = performance.now() + 500;
        }
        if (Number.isFinite(meta.microLevel) && meta.microBbox) {
          const microLevel = Math.min(this.FOCUS_MAX_LEVEL, Math.max(this.MIN_LEVEL, meta.microLevel));
          const microRange = this._getFocusTileRange(microLevel, meta.microBbox);
          const microMaxTiles = Number.isFinite(meta.microMaxTiles) ? meta.microMaxTiles : 144;
          let rMin = microRange.rMin;
          let rMax = microRange.rMax;
          let cMin = microRange.cMin;
          let cMax = microRange.cMax;
          if (microRange.tileCount > microMaxTiles) {
            const microCols = microRange.cMax - microRange.cMin + 1;
            const microRowRadius = Math.max(1, Math.floor(Math.sqrt(microMaxTiles / Math.max(microCols, 1))));
            const microColRadius = Math.max(1, Math.floor(microMaxTiles / Math.max(microRowRadius, 1)));
            const centerRow = Math.floor((microRange.rMin + microRange.rMax) / 2);
            const centerCol = Math.floor((microRange.cMin + microRange.cMax) / 2);
            rMin = Math.max(0, centerRow - microRowRadius);
            rMax = Math.min(microRange.nr - 1, centerRow + microRowRadius);
            cMin = centerCol - microColRadius;
            cMax = centerCol + microColRadius;
          }
          for (let row = rMin; row <= rMax; row += 1) {
            for (let col = cMin; col <= cMax; col += 1) {
              const wrappedCol = ((col % microRange.nc) + microRange.nc) % microRange.nc;
              const key = `${microLevel}/${row}/${wrappedCol}`;
              if (this._focusImageCache.get(key) === version) {
                continue;
              }
              this._focusImageCache.set(key, version);
              const requestKey = `${version}:${key}`;
              if (this._focusQueuedKeys.has(requestKey)) {
                continue;
              }
              const controller = new AbortController();
              this._focusControllers.set(requestKey, controller);
              this._focusQueue.push({
                level: microLevel,
                row,
                col: wrappedCol,
                requestKey,
                version,
                controller,
              });
              this._focusQueuedKeys.add(requestKey);
            }
          }
        }
        this._drainFocusQueue();
      }

      _computeViewBbox(camera) {
        camera.updateMatrixWorld(true);
        let latMin = 90, latMax = -90, lonMin = Infinity, lonMax = -Infinity, hits = 0;
        const R = this.GLOBE_R;
        const theta = this._globe ? this._globe.rotation.y : Math.PI;
        const tiltRad = this._globe?.parent?.rotation?.z ?? 0;
        const cosT = Math.cos(theta), sinT = Math.sin(theta);
        const cosZ = Math.cos(tiltRad), sinZ = Math.sin(tiltRad);
        let referenceLon = null;
        const hitToLatLon = (hx, hy, hz) => {
          const lx = hx * cosZ + hy * sinZ;
          const ly = -hx * sinZ + hy * cosZ;
          const lz = hz;
          const xl = lx * cosT - lz * sinT;
          const zl = lx * sinT + lz * cosT;
          let lon = Math.atan2(-zl, xl) * 180 / Math.PI;
          if (lon < -180) lon += 360;
          if (lon > 180) lon -= 360;
          const lat = Math.asin(Math.max(-1, Math.min(1, ly / R))) * 180 / Math.PI;
          return { lat, lon };
        };
        const wrapAroundReference = (lon, refLon) => {
          let delta = lon - refLon;
          while (delta < -180) delta += 360;
          while (delta > 180) delta -= 360;
          return refLon + delta;
        };
        this._raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        if (this._raycaster.ray.intersectSphere(this._sphere, this._hitTarget)) {
          referenceLon = hitToLatLon(this._hitTarget.x, this._hitTarget.y, this._hitTarget.z).lon;
        }
        for (const ndc of this._ndcSamples) {
          this._raycaster.setFromCamera(ndc, camera);
          if (!this._raycaster.ray.intersectSphere(this._sphere, this._hitTarget)) continue;
          hits++;
          const { x: hx, y: hy, z: hz } = this._hitTarget;
          const { lat, lon: rawLon } = hitToLatLon(hx, hy, hz);
          if (referenceLon === null) {
            referenceLon = rawLon;
          }
          const lon = wrapAroundReference(rawLon, referenceLon);
          latMin = Math.min(latMin, lat);  latMax = Math.max(latMax, lat);
          lonMin = Math.min(lonMin, lon);  lonMax = Math.max(lonMax, lon);
        }
        if (!hits) return { bbox: null, hits: 0 };
        const m = 4;
        return { hits, bbox: {
          latMin: Math.max(-90, latMin - m),  latMax: Math.min(90, latMax + m),
          lonMin: lonMin - m,                  lonMax: lonMax + m,
        }};
      }

      _clearFocusOverlay() {
        this._lastFocusKey = "";
        this._refreshFocus(null, this.MIN_LEVEL);
        this._focusQueue = [];
        this._focusQueuedKeys.clear();
        this._focusInflight = 0;
        this._focusDisplayState = { active: false, level: 0, tileCount: 0 };
      }

      _computeFocusTarget(camera) {
        camera.updateMatrixWorld(true);
        const R = this.GLOBE_R;
        const theta = this._globe ? this._globe.rotation.y : Math.PI;
        const tiltRad = this._globe?.parent?.rotation?.z ?? 0;
        const cosT = Math.cos(theta), sinT = Math.sin(theta);
        const cosZ = Math.cos(tiltRad), sinZ = Math.sin(tiltRad);
        this._raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        if (!this._raycaster.ray.intersectSphere(this._sphere, this._hitTarget)) {
          return null;
        }
        const { x: hx, y: hy, z: hz } = this._hitTarget;
        const lx = hx * cosZ + hy * sinZ;
        const ly = -hx * sinZ + hy * cosZ;
        const lz = hz;
        const xl = lx * cosT - lz * sinT;
        const zl = lx * sinT + lz * cosT;
        const lat = Math.asin(Math.max(-1, Math.min(1, ly / R))) * 180 / Math.PI;
        let lon = Math.atan2(-zl, xl) * 180 / Math.PI;
        if (lon < -180) lon += 360;
        if (lon > 180) lon -= 360;
        return { lat, lon };
      }

      _chooseLevel(lonSpan) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const screenWidth = Math.max(window.innerWidth * dpr, 1);
        const targetTexelsPerPixel = 1.25;
        const requiredTexelsPerDeg = (screenWidth / Math.max(lonSpan, 1e-4)) * targetTexelsPerPixel;
        const targetDeg = clamp(512 / Math.max(requiredTexelsPerDeg, 1), 0.0005, 90);
        const rawLevel = Math.max(
          this.MIN_LEVEL,
          Math.min(this.BACKGROUND_MAX_LEVEL, Math.ceil(Math.log2(360 / targetDeg) - 1)),
        );
        return this._snapCtxLevel(rawLevel, {
          minLevel: this.MIN_LEVEL,
          maxLevel: this.BACKGROUND_MAX_LEVEL,
          preferLower: true,
        });
      }

      _enqueueBbox(level, bbox, cx, cy, cz, priorityBias = 0) {
        const nc = 1 << (level + 1);
        const nr = 1 << level;
        const rMin = Math.max(0, Math.floor((90 - bbox.latMax) / 180 * nr) - 1);
        const rMax = Math.min(nr - 1, Math.ceil((90 - bbox.latMin) / 180 * nr) + 1);
        const cMin = Math.floor((bbox.lonMin + 180) / 360 * nc) - 1;
        const cMax = Math.ceil((bbox.lonMax + 180) / 360 * nc) + 1;
        for (let row = rMin; row <= rMax; row += 1) {
          for (let col = cMin; col <= cMax; col += 1) {
            this._enq(level, row, col, cx, cy, cz, priorityBias);
          }
        }
      }

      _enq(level, row, col, cx, cy, cz, priorityBias = 0) {
        const nc = 1 << (level + 1), nr = 1 << level;
        col = ((col % nc) + nc) % nc;
        if (row < 0 || row >= nr) return;
        const key = `${level}/${row}/${col}`;
        if (this.loaded.has(key) || this.inflight.has(key) || this.queued.has(key)) return;
        const _fu = this._failedUntil?.get(key) || 0;
        if (_fu > performance.now()) return;
        // Globe world-space normal at (lat, lon): (−cosLat·cos(lon), sinLat, cosLat·sin(lon))
        const lonRad = ((col + 0.5) / nc * 360 - 180) * Math.PI / 180;
        const latRad = (90 - (row + 0.5) / nr * 180) * Math.PI / 180;
        const cosLat = Math.cos(latRad);
        const dot = (-cosLat * Math.cos(lonRad)) * cx + Math.sin(latRad) * cy + (cosLat * Math.sin(lonRad)) * cz;
        this.queue.push({ level, row, col, key, priority: priorityBias - dot });
        this.queued.add(key);
      }

      _drain(sort = false) {
        if (sort) {
          this.queue.sort((a, b) => a.priority - b.priority);
        }
        while (this.inflight.size < this.MAX_INFLIGHT && this.queue.length > 0) {
          const item = this.queue.shift();
          this.queued.delete(item.key);
          if (this.loaded.has(item.key)) continue;
          this.inflight.add(item.key);
          this._fetch(item);
        }
      }

      async _fetch({ level, row, col, key }) {
        try {
          const img = await this._fetchImage(level, row, col);
          if (img) {
            this._drawTile(level, row, col, img);
            this.loaded.add(key);
          }
        } catch (_) { /* network / CORS — skip */ }
        finally { this.inflight.delete(key);  this._drain(); }
      }

      update(camera) {
        if (!this.active) return;

        const { x: px, y: py, z: pz } = camera.position;
        const d  = Math.sqrt(px*px + py*py + pz*pz);
        const altitude = Math.max(0, d - this.GLOBE_R);
        const cx = px/d, cy = py/d, cz = pz/d;

        const { bbox, hits } = this._computeViewBbox(camera);
        if (!bbox) return;

        const { latMin, latMax, lonMin, lonMax } = bbox;
        this._prevCx = cx;  this._prevCy = cy;  this._prevCz = cz;
        const nowTick = performance.now();
        if (!Number.isFinite(this._lastCamPos.x)) {
          this._lastCamPos.copy(camera.position);
          this._lastCamMoveAt = nowTick;
        } else {
          const movedSq = camera.position.distanceToSquared(this._lastCamPos);
          if (movedSq > 5e-6) {
            this._lastCamMoveAt = nowTick;
            this._lastCamPos.copy(camera.position);
          }
        }

        // View-adaptive background streaming: skip when focus overlay is driving
        // the full visible extent (prevents global-tile churn while zooming).
        if (this.BACKGROUND_STREAMING) {
          const lonSpan = lonMax - lonMin;
          const viewLevel = this._chooseLevel(lonSpan);
          const viewKey = `${viewLevel},${Math.round(latMin)},${Math.round(latMax)},${Math.round(lonMin)},${Math.round(lonMax)}`;
          if (viewKey !== this._lastViewKey) {
            this._lastViewKey = viewKey;
            this._enqueueBbox(viewLevel, { latMin, latMax, lonMin, lonMax }, cx, cy, cz, 0);
          }
        }

        if (this.focusOverlayEnabled) {
          const visibleBbox = { latMin, latMax, lonMin, lonMax };
          const focusTarget = this._computeFocusTarget(camera);
          let focusStage = focusTarget ? this._getFocusStage(camera, visibleBbox, focusTarget) : null;
          const focusBbox = (focusStage && focusTarget)
            ? (focusStage.focusBbox || this._buildRefinementBbox(visibleBbox, focusTarget, focusStage.altitude))
            : null;
          const scaleEstimate = estimateBodyMapScale(camera, this._globe, VENUS_RADIUS_METERS, this.GLOBE_R);
          let esriLodLevel = this._chooseEsriLodLevel(scaleEstimate?.scaleDenominator);
          if ((isStreamedBaseLayer(baseLayerSelect.value)) && focusStage && Number.isFinite(focusStage.altitude)) {
            if (focusStage.altitude <= 0.6) {
              esriLodLevel = Math.max(esriLodLevel || 0, 11);
            }
          }
          window.__ctxPatchDebug = {
            ...(window.__ctxPatchDebug || {}),
            esriLodLevel,
            esriLodCount: this._esriLods?.length || 0,
            scaleDenominator: scaleEstimate?.scaleDenominator ?? null,
          };
          if (isStreamedBaseLayer(baseLayerSelect.value)) {
            const settleMs = 350;
            const scaleGate = estimateBodyMapScale(camera, this._globe, VENUS_RADIUS_METERS, this.GLOBE_R);
            const scaleDen = scaleGate?.scaleDenominator ?? null;
            const rawScaleBarMeters = scaleGate
              ? (scaleGate.metersPerPixel * 132)
              : null;
            const scaleBarMeters = scaleGate
              ? chooseNiceScaleDistance(scaleGate.metersPerPixel, 132)
              : null;
            const lod7 = this._esriLods?.find((lod) => lod.level === 7) || null;
            const lod7ScaleBarMeters = lod7
              ? (lod7.scale * 0.0254 / 96) * 132
              : null;
            let approxViewBbox = null;
            if (scaleGate && focusTarget) {
              const dpr = Math.min(window.devicePixelRatio || 1, 2);
              const screenWidth = Math.max(window.innerWidth * dpr, 1);
              const screenHeight = Math.max(window.innerHeight * dpr, 1);
              const metersPerDeg = (2 * Math.PI * VENUS_RADIUS_METERS) / 360;
              const lonSpanDeg = Math.max(0.02, (scaleGate.metersPerPixel * screenWidth) / metersPerDeg);
              const latSpanDeg = Math.max(0.02, (scaleGate.metersPerPixel * screenHeight) / metersPerDeg);
              approxViewBbox = this._buildFocusBboxAroundTarget(focusTarget, lonSpanDeg, latSpanDeg);
            }
            const prevScaleBar = this._lastScaleBarMeters || null;
            if (Number.isFinite(rawScaleBarMeters)) {
              this._lastScaleBarMeters = rawScaleBarMeters;
              if (Number.isFinite(prevScaleBar) && rawScaleBarMeters > prevScaleBar * 1.35) {
                this._clearFocusOverlay();
                window.__ctxPatchDebug = {
                  ...(window.__ctxPatchDebug || {}),
                  baseLayer: "ctx-mosaic",
                  mode: "adaptive-scale",
                  active: false,
                  scaleBarMeters,
                  rawScaleBarMeters,
                  zoomOutReset: true,
                };
                return;
              }
            }
            if ((nowTick - this._lastCamMoveAt) >= settleMs) {
              let targetLevel = null;
                if (Number.isFinite(rawScaleBarMeters)) {
                  if (rawScaleBarMeters >= 100000) {
                    targetLevel = 5;
                  } else if (Number.isFinite(lod7ScaleBarMeters) && rawScaleBarMeters >= lod7ScaleBarMeters) {
                    targetLevel = 7;
                  } else if (rawScaleBarMeters >= 15000) {
                    targetLevel = 8;
                  } else if (rawScaleBarMeters >= 10000) {
                    targetLevel = 9;
                  } else if (rawScaleBarMeters >= 7000) {
                    targetLevel = 10;
                  } else if (rawScaleBarMeters >= 5000) {
                    targetLevel = 11;
                  } else if (rawScaleBarMeters >= 2500) {
                    targetLevel = 12;
                  } else if (rawScaleBarMeters >= 1200) {
                    targetLevel = 13;
                  } else {
                    targetLevel = 14;
                  }
                } else if (Number.isFinite(esriLodLevel)) {
                  if (esriLodLevel >= 14) {
                    targetLevel = 14;
                  } else if (esriLodLevel >= 13) {
                    targetLevel = 13;
                  } else if (esriLodLevel >= 12) {
                    targetLevel = 12;
                  } else if (esriLodLevel >= 11) {
                    targetLevel = 11;
                  } else if (esriLodLevel >= 9) {
                    targetLevel = 9;
                  } else if (esriLodLevel >= 7) {
                    targetLevel = 7;
                  } else if (esriLodLevel >= 5) {
                    targetLevel = 5;
                  }
                } else {
                  targetLevel = 11;
                }
              if (!Number.isFinite(targetLevel)) {
                if (this._focusDisplayState.active) {
                  this._lastFocusKey = "";
                  this._refreshFocus(null, this.MIN_LEVEL);
                }
                window.__ctxPatchDebug = {
                  ...(window.__ctxPatchDebug || {}),
                  baseLayer: "ctx-mosaic",
                  mode: "adaptive-esri",
                  active: false,
                  scaleBarMeters,
                  esriLodLevel,
                };
                return;
              }
              if (Number.isFinite(targetLevel)) {
                const budget = targetLevel >= 15 ? 240 : 1024;
                const baseBbox = approxViewBbox || visibleBbox;
                // At the 10 km scale-bar floor (level 9) approxViewBbox is derived
                // from the central pixel's metersPerPixel and underestimates the
                // viewport by ~72% due to perspective. Pad only at level 9 so the
                // focus canvas covers the full screen without bloating the bbox at
                // coarser levels (5/7/8) where the extra tiles overlap dark/blank
                // Mars areas and trigger the 30-second all-failed backoff.
                const _bboxPad = targetLevel === 9 ? 0.75 : 0;
                const targetBbox = targetLevel >= 15
                  ? this._computeBudgetBbox(targetLevel, baseBbox, focusTarget, budget)
                  : _bboxPad > 0 ? {
                      latMin: baseBbox.latMin - (baseBbox.latMax - baseBbox.latMin) * _bboxPad,
                      latMax: baseBbox.latMax + (baseBbox.latMax - baseBbox.latMin) * _bboxPad,
                      lonMin: baseBbox.lonMin - (baseBbox.lonMax - baseBbox.lonMin) * _bboxPad,
                      lonMax: baseBbox.lonMax + (baseBbox.lonMax - baseBbox.lonMin) * _bboxPad,
                    }
                  : { ...baseBbox };
                const tileRangeEstimate = this._getFocusTileRange(targetLevel, targetBbox);
                const levelCap = targetLevel === 5 ? 512
                  : targetLevel === 7 ? 1024
                  : targetLevel === 9 ? 900
                  : targetLevel === 11 ? 512
                  : targetLevel === 12 ? 512
                  : 400;
                const desiredMaxTiles = Math.min(tileRangeEstimate.tileCount, levelCap);
                const focusKey = `${targetLevel},${Math.round(targetBbox.latMin * 5)},${Math.round(targetBbox.latMax * 5)},${Math.round(targetBbox.lonMin * 5)},${Math.round(targetBbox.lonMax * 5)}`;
                if (focusKey !== this._lastFocusKey && (nowTick - this._lastFocusUpdateAt) >= this.FOCUS_UPDATE_INTERVAL_MS) {
                  this._lastFocusKey = focusKey;
                  this._lastFocusUpdateAt = nowTick;
                  const minLevel = targetLevel >= 15 ? 12 : Math.max(this.MIN_LEVEL, targetLevel);
                  const fetchMinLevel = targetLevel >= 15 ? 12 : targetLevel;
                  this._refreshFocus(targetBbox, targetLevel, {
                    altitude,
                    focusTarget,
                    visibleBbox: { ...targetBbox },
                    minLevel,
                    fetchMinLevel,
                    keepPreviousOnUpgrade: true,
                    maxFocusTiles: desiredMaxTiles,
                  });
                }
                window.__ctxPatchDebug = {
                  ...(window.__ctxPatchDebug || {}),
                  baseLayer: "ctx-mosaic",
                  mode: "adaptive-threshold",
                  active: true,
                  altitude,
                  focusTarget: focusTarget ? { ...focusTarget } : null,
                  level: targetLevel,
                  refinementBbox: { ...targetBbox },
                  visibleBbox: { ...targetBbox },
                  scaleDenominator: scaleEstimate?.scaleDenominator ?? null,
                  rawScaleBarMeters,
                  scaleBarMeters,
                  esriLodLevel,
                  lod7ScaleBarMeters,
                  bboxMode: targetLevel >= 15 ? "budget" : "visible",
                  bboxSource: approxViewBbox ? "scale" : "raycast",
                };
                this._drain(true);
                return;
              }
            }
            return;
          }
          const ctxEsriTriggerAlt = 0.22;
          const esriSettleMs = 220;
          if (
            Number.isFinite(esriLodLevel)
            && esriLodLevel >= 11
            && altitude <= ctxEsriTriggerAlt
            && (nowTick - this._lastCamMoveAt) >= esriSettleMs
          ) {
            const esriMaxTiles = 200;
            const tileLonSpan = 360 / (1 << (esriLodLevel + 1));
            const tileLatSpan = 180 / (1 << esriLodLevel);
            const visibleRange = this._getFocusTileRange(esriLodLevel, visibleBbox);
            const lonSpanView = Math.max(visibleBbox.lonMax - visibleBbox.lonMin, tileLonSpan);
            const latSpanView = Math.max(visibleBbox.latMax - visibleBbox.latMin, tileLatSpan);
            const aspect = clamp(lonSpanView / Math.max(latSpanView, 1e-6), 0.2, 5);
            const tilesLat = Math.max(1, Math.floor(Math.sqrt(esriMaxTiles / aspect)));
            const tilesLon = Math.max(1, Math.floor(tilesLat * aspect));
            const esriBbox = (visibleRange.tileCount <= esriMaxTiles)
              ? visibleBbox
              : this._buildFocusBboxAroundTarget(
                focusTarget || {
                  lon: (visibleBbox.lonMin + visibleBbox.lonMax) * 0.5,
                  lat: (visibleBbox.latMin + visibleBbox.latMax) * 0.5,
                },
                tileLonSpan * tilesLon,
                tileLatSpan * tilesLat,
              );
            const focusKey = `${esriLodLevel},${Math.round(esriBbox.latMin * 5)},${Math.round(esriBbox.latMax * 5)},${Math.round(esriBbox.lonMin * 5)},${Math.round(esriBbox.lonMax * 5)}`;
            if (focusKey !== this._lastFocusKey && (nowTick - this._lastFocusUpdateAt) >= this.FOCUS_UPDATE_INTERVAL_MS) {
              this._lastFocusKey = focusKey;
              this._lastFocusUpdateAt = nowTick;
              this._refreshFocus(esriBbox, esriLodLevel, {
                altitude,
                focusTarget,
                visibleBbox: { ...esriBbox },
                minLevel: 11,
                fetchMinLevel: 11,
                keepPreviousOnUpgrade: true,
              });
            }
            window.__ctxPatchDebug = {
              ...(window.__ctxPatchDebug || {}),
              baseLayer: "ctx-mosaic",
              mode: "esri-lod",
              active: true,
              altitude,
              focusTarget: focusTarget ? { ...focusTarget } : null,
              level: esriLodLevel,
              refinementBbox: { ...esriBbox },
              visibleBbox: { ...esriBbox },
              scaleDenominator: scaleEstimate?.scaleDenominator ?? null,
              scaleTierLevel: this._getScaleTierLevel(scaleEstimate?.scaleDenominator),
              workingMaxLevel: Number.isFinite(this.FORCE_MAX_LEVEL)
                ? this.FORCE_MAX_LEVEL
                : (Number.isFinite(window.__ctxDebug?.workingMaxLevel)
                    ? window.__ctxDebug.workingMaxLevel
                    : this.FOCUS_MAX_LEVEL),
            };
            this._drain(true);
            return;
          }
          const scaleTier = this._getScaleTierLevel(scaleEstimate?.scaleDenominator);
          const stageLevel = focusStage ? focusStage.level : null;
          const altitudeTier = focusStage ? this._getAltitudeTierLevel(focusStage.altitude) : null;
          let tierLevel = focusStage
            ? Math.max(altitudeTier ?? 0, scaleTier ?? 0, stageLevel ?? 0)
            : null;
          if (focusStage) {
            const alt = focusStage.altitude;
            if (alt <= 0.04) tierLevel = Math.max(tierLevel || 0, 15);
          }
          if (focusStage && tierLevel !== null && tierLevel > focusStage.level) {
            focusStage = { ...focusStage, level: tierLevel };
          }
          const smoothedLevel = tierLevel !== null ? this._smoothFocusLevel(tierLevel) : null;
          const workingMaxLevel = Number.isFinite(this.FORCE_MAX_LEVEL)
            ? this.FORCE_MAX_LEVEL
            : (Number.isFinite(window.__ctxDebug?.workingMaxLevel)
                ? window.__ctxDebug.workingMaxLevel
                : this.FOCUS_MAX_LEVEL);
          const activationLevel = tierLevel !== null && tierLevel >= 11
            ? Math.min(workingMaxLevel, Math.max(11, Math.floor(tierLevel)))
            : null;
          const meetsLevel = activationLevel !== null;
          let localEffectiveLevel = (focusBbox && meetsLevel)
            ? this._estimateLocalFocusLevel(activationLevel, focusBbox)
            : activationLevel;
          if (tierLevel !== null && tierLevel >= 15) {
            localEffectiveLevel = activationLevel;
          }
          const activeStage = (focusStage && focusBbox && meetsLevel)
            ? { ...focusStage, level: Math.min(workingMaxLevel, localEffectiveLevel) }
            : null;
          const useFocusBbox = Boolean(activeStage && focusBbox && tierLevel !== null && tierLevel >= 15);
          let activeBbox = activeStage
            ? (useFocusBbox ? focusBbox : visibleBbox)
            : null;
          if (activeStage && tierLevel !== null && tierLevel >= 15) {
            const baseLevel = 12;
            const baseRange = this._getFocusTileRange(baseLevel, visibleBbox);
            const baseMaxTiles = this._getMaxFocusTiles(baseLevel, { altitude: activeStage.altitude });
            if (baseRange.tileCount <= baseMaxTiles) {
              activeBbox = visibleBbox;
            } else if (focusTarget) {
              const tileLonSpan = 360 / (1 << (baseLevel + 1));
              const tileLatSpan = 180 / (1 << baseLevel);
              const lonSpanView = Math.max(visibleBbox.lonMax - visibleBbox.lonMin, tileLonSpan);
              const latSpanView = Math.max(visibleBbox.latMax - visibleBbox.latMin, tileLatSpan);
              const aspect = clamp(lonSpanView / Math.max(latSpanView, 1e-6), 0.2, 5);
              const tilesLat = Math.max(1, Math.floor(Math.sqrt(baseMaxTiles / aspect)));
              const tilesLon = Math.max(1, Math.floor(tilesLat * aspect));
              activeBbox = this._buildFocusBboxAroundTarget(
                focusTarget,
                tileLonSpan * tilesLon,
                tileLatSpan * tilesLat,
              );
            }
          }
          if (useFocusBbox && activeStage) {
            const tileLonSpan = 360 / (1 << (activeStage.level + 1));
            const tileLatSpan = 180 / (1 << activeStage.level);
            if (tierLevel !== null && tierLevel >= 15 && focusTarget) {
              activeBbox = this._ensureMinSpanBbox(
                activeBbox || visibleBbox,
                tileLonSpan * 20,
                tileLatSpan * 20,
              );
            } else {
              activeBbox = this._ensureMinSpanBbox(
                activeBbox,
                tileLonSpan * 20,
                tileLatSpan * 20,
              );
            }
          }
          if (focusStage && focusBbox) {
            window.__ctxPatchDebug = {
              ...(window.__ctxPatchDebug || {}),
              baseLayer: "ctx-mosaic",
              mode: "focus-overlay",
              active: true,
              altitude: focusStage.altitude,
              focusTarget: { ...focusTarget },
              level: focusStage.level,
              refinementBbox: { ...focusBbox },
              visibleBbox: { ...visibleBbox },
              focusLayerLevel: focusStage.level,
              scaleDenominator: scaleEstimate?.scaleDenominator ?? null,
              scaleTierLevel: scaleTier,
              altitudeTierLevel: altitudeTier,
              stageLevel,
              focusTargetLevel: tierLevel,
              focusLevelSmoothed: smoothedLevel,
              workingMaxLevel,
              forcedMaxLevel: this.FORCE_MAX_LEVEL,
              highestOnly: true,
              localEffectiveLevel,
            };
            window.__ctxDebug = {
              ...(window.__ctxDebug || {}),
              workingMaxLevel,
            };
          }
          const focusKey = activeStage && activeBbox
            ? (() => {
              const keyScale = activeStage.level >= 13 ? 2 : 10;
              return `${activeStage.level},${Math.round(activeBbox.latMin * keyScale)},${Math.round(activeBbox.latMax * keyScale)},${Math.round(activeBbox.lonMin * keyScale)},${Math.round(activeBbox.lonMax * keyScale)}`;
            })()
            : "";
          const nowMs = performance.now();
          if (focusKey !== this._lastFocusKey && (nowMs - this._lastFocusUpdateAt) >= this.FOCUS_UPDATE_INTERVAL_MS) {
            this._lastFocusKey = focusKey;
            this._lastFocusUpdateAt = nowMs;
            if (activeStage && activeBbox) {
              const highDetail = Boolean(tierLevel !== null && tierLevel >= 15);
              const requestedLevel = activeStage.level;
              const minFocusLevel = highDetail
                ? Math.max(this.MIN_LEVEL, requestedLevel - 2)
                : this.MIN_LEVEL;
              const fetchMinLevel = highDetail
                ? Math.max(this.MIN_LEVEL, requestedLevel - 2)
                : this.MIN_LEVEL;
              const keepPreviousOnUpgrade = highDetail;
              const microLevel = highDetail && requestedLevel < workingMaxLevel
                ? Math.min(workingMaxLevel, requestedLevel + 1)
                : null;
              let microBbox = null;
              if (microLevel !== null && focusTarget) {
                const tileLonSpan = 360 / (1 << (microLevel + 1));
                const tileLatSpan = 180 / (1 << microLevel);
                const lonSpanView = Math.max(visibleBbox.lonMax - visibleBbox.lonMin, tileLonSpan);
                const latSpanView = Math.max(visibleBbox.latMax - visibleBbox.latMin, tileLatSpan);
                const aspect = clamp(lonSpanView / Math.max(latSpanView, 1e-6), 0.2, 5);
                const microBudget = microLevel >= 17 ? 144 : microLevel >= 16 ? 196 : 256;
                const tilesLat = Math.max(1, Math.floor(Math.sqrt(microBudget / aspect)));
                const tilesLon = Math.max(1, Math.floor(tilesLat * aspect));
                microBbox = this._buildFocusBboxAroundTarget(
                  focusTarget,
                  tileLonSpan * tilesLon,
                  tileLatSpan * tilesLat,
                );
              }
              this._refreshFocus(activeBbox, requestedLevel, {
                altitude: activeStage.altitude,
                focusTarget,
                visibleBbox,
                minLevel: minFocusLevel,
                fetchMinLevel,
                keepPreviousOnUpgrade,
                microLevel,
                microBbox,
                microMaxTiles: microLevel >= 17 ? 144 : microLevel >= 16 ? 196 : 256,
              });
            } else {
              this._refreshFocus(null, this.MIN_LEVEL);
            }
          }
        } else if (this._focusDisplayState.active) {
          this._lastFocusKey = "";
          this._refreshFocus(null, this.MIN_LEVEL);
        }
        this._drain(true);
      }
    }

    class CTXDetailPatchStreamer {
      constructor(venusGroup, tileBase, getTilePayload, getTileLevelCap, getViewBbox, getFocusTarget, elevationSampler, getTerrainRelief, anisotropy = 1) {
        this.group = new THREE.Group();
        this.group.visible = false;
        venusGroup.add(this.group);
        this.tileBase = tileBase;
        this.getTilePayload = getTilePayload;
        this.getTileLevelCap = getTileLevelCap;
        this.getViewBbox = getViewBbox;
        this.getFocusTarget = getFocusTarget;
        this.elevationSampler = elevationSampler;
        this.getTerrainRelief = getTerrainRelief;
        this.textureAnisotropy = anisotropy;
        this.baseRadius = 3.2;
        this.surfaceLiftBase = 0.0008;
        this.surfaceLiftReliefFactor = 0.01;
        this.minLevel = 3;
        this.maxLevel = 17;
        this.maxInflight = 48;
        this.maxMeshes = 700;
        this.activationMinLevel = 9;
        this.activationMaxLonSpan = 90;
        this.activationMaxLatSpan = 65;
        this.currentKeys = new Set();
        this.active = false;
        this.meshes = new Map();
        this.queue = [];
        this.queued = new Set();
        this.inflight = new Set();
        this.controllers = new Map();
        this._lastStateKey = "";
        this._lastMotionAt = 0;
        this._cameraSettled = false;
        this._lastCameraPos = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
        this._motionThreshold = 0.018;   // scene units — ignore sub-pixel camera jitter
        this._settleDelayMs = 80;         // ms — low latency settle so tiles kick off quickly after drag stops
        this.purgeAltitude = 1.0; // above this → purge high-res tiles
        this._purged = false;
        this._disposalQueue = []; // meshes hidden immediately, GL resources freed in small per-frame batches
        this._stagingQueue = []; // payloads ready; meshes created at capped rate in update() to avoid GPU stalls
        this._staged = new Set(); // keys currently in _stagingQueue, prevents re-fetch of staged tiles
        this._geomCache = new Map(); // UV+index typed arrays keyed by segLon_segLat — built once, reused per tile
        this._visibilityDirty = false; // set by _fetch; evict+syncVisibility runs once per frame in update()
        this._knownBlank = new Set(); // tile keys confirmed to have no CTX data — never re-fetched
        this._currentLevel = -1;
        this._requestEpoch = 0;
        this._lastFocusTarget = null;
        this.splitThresholdPx = 250;
        this.holdThresholdPx = 160;
        this._smoothedStageLevel = null;
        this._lastStageLevelChangeAt = 0;
        this.stageLevelStepIntervalMs = 20;
        this.scaleSteps = [
          { maxLonSpan: 180, level: 7 },
          { maxLonSpan: 125, level: 8 },
          { maxLonSpan: 82,  level: 9 },
          { maxLonSpan: 56,  level: 10 },
          { maxLonSpan: 36,  level: 11 },
          { maxLonSpan: 24,  level: 12 },
          { maxLonSpan: 15,  level: 13 },
          { maxLonSpan: 9.5, level: 14 },
          { maxLonSpan: 6.2, level: 15 },
          { maxLonSpan: 4.0, level: 16 },
          { maxLonSpan: 2.5, level: 17 },
          { maxLonSpan: 1.4, level: 17 },
          { maxLonSpan: 0.8, level: 17 },
          { maxLonSpan: 0.4, level: 17 },
        ];
        this.contourTexture = null;
        this.contourOpacity = 0.62;
        this.contourEnabled = false;
        this.contourThickness = 1.15;
        this.contourTexel = new THREE.Vector2(1 / 4096, 1 / 2048);
        this.contourInterval = 0;
        this.contourMinMeters = Number(manifest.elevation?.min_m ?? -2886);
        this.contourReliefMeters = Math.max(Number(manifest.elevation?.relief_m ?? 1), 1);
      }

      _getContourUvBounds(bounds) {
        let uMin = lonToTextureU(bounds.lonMin);
        let uMax = lonToTextureU(bounds.lonMax);
        const lonSpan = bounds.lonMax - bounds.lonMin;
        if (lonSpan >= 350) {
          uMin = 0;
          uMax = 1;
        } else if (uMax < uMin) {
          uMax += 1;
        }
        const vSouth = clamp((bounds.latMin + 90) / 180, 0, 1);
        const vNorth = clamp((bounds.latMax + 90) / 180, 0, 1);
        return new THREE.Vector4(uMin, uMax, vSouth, vNorth);
      }

      setContourOverlay(texture, opacity = 0.62, enabled = false, thickness = 1.15, intervalMeters = 0) {
        this.contourTexture = texture || null;
        this.contourOpacity = Number.isFinite(opacity) ? opacity : 0.62;
        this.contourEnabled = Boolean(enabled && texture);
        this.contourThickness = Number.isFinite(thickness) ? thickness : 1.15;
        this.contourInterval = Number.isFinite(intervalMeters) ? intervalMeters : 0;
        const texWidth = Number(texture?.image?.width || texture?.source?.data?.width || 4096);
        const texHeight = Number(texture?.image?.height || texture?.source?.data?.height || 2048);
        this.contourTexel.set(1 / Math.max(texWidth, 1), 1 / Math.max(texHeight, 1));
        for (const mesh of this.meshes.values()) {
          const shader = mesh.material?.userData?.ctxContourShader;
          if (shader?.uniforms) {
            shader.uniforms.uContourMap.value = this.contourTexture;
            shader.uniforms.uContourOpacity.value = this.contourOpacity;
            shader.uniforms.uContourEnabled.value = this.contourEnabled ? 1 : 0;
            shader.uniforms.uContourThickness.value = this.contourThickness;
            shader.uniforms.uContourTexel.value.copy(this.contourTexel);
            shader.uniforms.uContourInterval.value = this.contourInterval;
          }
          if (mesh.material) {
            mesh.material.needsUpdate = true;
          }
        }
      }

      activate() {
        this.active = true;
        this.group.visible = true;
      }

      deactivate() {
        this.active = false;
        this.group.visible = false;
        this.queue = [];
        this.queued.clear();
        this._stagingQueue = [];
        this._staged.clear();
        this._abortInflight();
        this.inflight.clear();
        this._lastStateKey = "";
        this._currentLevel = -1;
        this._requestEpoch += 1;
        this._lastFocusTarget = null;
        this._smoothedStageLevel = NaN; // force fresh coarse→fine progression on next activate
        this._clearMeshes();
      }

      _focusShiftDegrees(nextFocusTarget) {
        const previous = this._lastFocusTarget;
        if (!previous || !nextFocusTarget) {
          return Infinity;
        }
        const lat1 = THREE.MathUtils.degToRad(previous.lat);
        const lat2 = THREE.MathUtils.degToRad(nextFocusTarget.lat);
        const dLat = lat2 - lat1;
        const dLon = THREE.MathUtils.degToRad(this._wrapLonNear(previous.lon, nextFocusTarget.lon) - previous.lon);
        const sinDLat = Math.sin(dLat * 0.5);
        const sinDLon = Math.sin(dLon * 0.5);
        const a = (sinDLat * sinDLat) + (Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon);
        return THREE.MathUtils.radToDeg(2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))));
      }

      _abortInflight(retainKeys = null) {
        for (const [key, controller] of this.controllers.entries()) {
          if (retainKeys && retainKeys.has(key)) {
            continue;
          }
          controller.abort();
          this.controllers.delete(key);
        }
      }

      _tileBounds(level, row, col) {
        const nc = 1 << (level + 1);
        const nr = 1 << level;
        return {
          lonMin: (col / nc) * 360 - 180,
          lonMax: ((col + 1) / nc) * 360 - 180,
          latMax: 90 - (row / nr) * 180,
          latMin: 90 - ((row + 1) / nr) * 180,
        };
      }

      _normalizeTileRequest(level, row, col) {
        const requestedNc = 1 << (level + 1);
        const requestedNr = 1 << level;
        if (row < 0 || row >= requestedNr) return null;
        const requestedWrappedCol = ((col % requestedNc) + requestedNc) % requestedNc;
        const effectiveLevel = Math.max(
          this.minLevel,
          Math.min(level, this.getTileLevelCap ? this.getTileLevelCap(level, row, requestedWrappedCol) : level),
        );
        const levelDelta = Math.max(0, level - effectiveLevel);
        const effectiveRow = Math.floor(row / (1 << levelDelta));
        const effectiveNc = 1 << (effectiveLevel + 1);
        const effectiveColRaw = Math.floor(requestedWrappedCol / (1 << levelDelta));
        const effectiveCol = ((effectiveColRaw % effectiveNc) + effectiveNc) % effectiveNc;
        return {
          level: effectiveLevel,
          row: effectiveRow,
          col: effectiveCol,
          key: `${effectiveLevel}/${effectiveRow}/${effectiveCol}`,
        };
      }

      _boundsNearReference(bounds, referenceLon) {
        const lonSpan = bounds.lonMax - bounds.lonMin;
        const centerLon = this._wrapLonNear(referenceLon, (bounds.lonMin + bounds.lonMax) * 0.5);
        return {
          lonMin: centerLon - lonSpan * 0.5,
          lonMax: centerLon + lonSpan * 0.5,
          latMin: bounds.latMin,
          latMax: bounds.latMax,
        };
      }

      _tileIntersectsBbox(bounds, bbox) {
        return !(
          bounds.lonMax <= bbox.lonMin
          || bounds.lonMin >= bbox.lonMax
          || bounds.latMax <= bbox.latMin
          || bounds.latMin >= bbox.latMax
        );
      }

      _getEffectiveSpanMetrics(bbox, focusTarget = null) {
        const rawLonSpan = Math.max(bbox.lonMax - bbox.lonMin, 0.02);
        const rawLatSpan = Math.max(bbox.latMax - bbox.latMin, 0.02);
        const centerLat = clamp(
          focusTarget ? focusTarget.lat : ((bbox.latMin + bbox.latMax) * 0.5),
          -89.5,
          89.5,
        );
        const lonScale = Math.max(0.1, Math.cos(THREE.MathUtils.degToRad(Math.abs(centerLat))));
        return {
          rawLonSpan,
          rawLatSpan,
          centerLat,
          effectiveLonSpan: Math.max(0.02, rawLonSpan * lonScale),
          effectiveLatSpan: rawLatSpan,
        };
      }

      _estimateTilePriority(bounds, bbox, focusTarget) {
        const spanMetrics = this._getEffectiveSpanMetrics(bbox, focusTarget);
        const bboxLonSpan = Math.max(spanMetrics.effectiveLonSpan, 1e-4);
        const bboxLatSpan = Math.max(spanMetrics.effectiveLatSpan, 1e-4);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const screenWidth = Math.max(window.innerWidth * dpr, 1);
        const screenHeight = Math.max(window.innerHeight * dpr, 1);
        const tileCenterLat = (bounds.latMin + bounds.latMax) * 0.5;
        const tileLonScale = Math.max(0.1, Math.cos(THREE.MathUtils.degToRad(Math.abs(tileCenterLat))));
        const tileLonSpan = Math.max((bounds.lonMax - bounds.lonMin) * tileLonScale, 1e-6);
        const tileLatSpan = Math.max(bounds.latMax - bounds.latMin, 1e-6);
        const projectedPx = Math.max(
          (tileLonSpan / bboxLonSpan) * screenWidth,
          (tileLatSpan / bboxLatSpan) * screenHeight,
        );
        const tileCenterLon = (bounds.lonMin + bounds.lonMax) * 0.5;
        const focusLon = focusTarget ? this._wrapLonNear(tileCenterLon, focusTarget.lon) : (bbox.lonMin + bbox.lonMax) * 0.5;
        const focusLat = focusTarget ? focusTarget.lat : (bbox.latMin + bbox.latMax) * 0.5;
        const dx = (tileCenterLon - focusLon) / Math.max(bboxLonSpan * 0.5, 1e-4);
        const dy = (tileCenterLat - focusLat) / Math.max(bboxLatSpan * 0.5, 1e-4);
        const dist2 = (dx * dx) + (dy * dy);
        const broadView = bboxLonSpan > 45 || bboxLatSpan > 30;
        const centerWeight = broadView
          ? Math.max(0.92, 1.02 - (Math.sqrt(dist2) * 0.05))
          : Math.max(0.78, 1.06 - (Math.sqrt(dist2) * 0.12));
        return {
          projectedPx: projectedPx * centerWeight,
          dist2,
        };
      }

      _buildDesiredTiles(bbox, focusTarget, targetLevel, priorityBbox = bbox) {
        // Center-first DFS from minLevel to targetLevel.  Each area is represented
        // by either fine-level children (when the budget allows) or a coarser parent
        // tile as a fallback — matching the ArcGIS mixed-LOD viewport pattern.
        //
        // Key addition vs the original: when a node successfully splits to children
        // it is ALSO retained in desired marked isAnchor=true.  This means the parent
        // tile is fetched as an immediate placeholder visible while its children load;
        // _syncMeshVisibility hides it automatically once all four children arrive.
        const referenceLon = (bbox.lonMin + bbox.lonMax) * 0.5;
        const focusLon = focusTarget ? focusTarget.lon : referenceLon;
        const focusLat = focusTarget ? focusTarget.lat : (bbox.latMin + bbox.latMax) * 0.5;
        const budget = this.maxMeshes * 2;
        const desired = new Map();

        const visit = (requestedLevel, requestedRow, requestedCol) => {
          if (desired.size >= budget) return;
          const normalized = this._normalizeTileRequest(requestedLevel, requestedRow, requestedCol);
          if (!normalized) return;
          const bounds = this._boundsNearReference(
            this._tileBounds(normalized.level, normalized.row, normalized.col), referenceLon,
          );
          if (!this._tileIntersectsBbox(bounds, bbox)) return;
          const priority = this._estimateTilePriority(bounds, priorityBbox, focusTarget);
          const nextChild = this._normalizeTileRequest(requestedLevel + 1, requestedRow * 2, requestedCol * 2);
          const canSplit = (
            normalized.level < targetLevel
            && requestedLevel < this.maxLevel
            && nextChild
            && (nextChild.level > normalized.level || nextChild.key !== normalized.key)
          );
          if (canSplit && priority.projectedPx > 2 && desired.size < budget) {
            const childLevel = requestedLevel + 1;
            const childRow = requestedRow * 2;
            const childCol = requestedCol * 2;
            const centerLon = (bounds.lonMin + bounds.lonMax) * 0.5;
            const centerLat = (bounds.latMin + bounds.latMax) * 0.5;
            const dr = (focusLat <= centerLat) ? 1 : 0;
            const dc = (focusLon >= centerLon) ? 1 : 0;
            const before = desired.size;
            visit(childLevel, childRow + dr,       childCol + dc);
            visit(childLevel, childRow + dr,       childCol + (1 - dc));
            visit(childLevel, childRow + (1 - dr), childCol + dc);
            visit(childLevel, childRow + (1 - dr), childCol + (1 - dc));
            if (desired.size > before) {
              // Children queued: also add THIS tile as an anchor placeholder so
              // there is something rendered immediately while the children load.
              if (!desired.has(normalized.key)) {
                desired.set(normalized.key, { ...normalized, requestedLevel, priority, isAnchor: true });
              }
              return;
            }
          }
          if (!desired.has(normalized.key)) {
            desired.set(normalized.key, { ...normalized, requestedLevel, priority });
          }
        };

        const rootNc = 1 << (this.minLevel + 1);
        const rootNr = 1 << this.minLevel;
        const rMin = Math.max(0, Math.floor((90 - bbox.latMax) / 180 * rootNr) - 1);
        const rMax = Math.min(rootNr - 1, Math.ceil((90 - bbox.latMin) / 180 * rootNr) + 1);
        const cMin = Math.floor((bbox.lonMin + 180) / 360 * rootNc) - 1;
        const cMax = Math.ceil((bbox.lonMax + 180) / 360 * rootNc) + 1;
        for (let row = rMin; row <= rMax; row += 1) {
          for (let col = cMin; col <= cMax; col += 1) {
            visit(this.minLevel, row, col);
          }
        }
        return [...desired.values()].sort((a, b) => a.priority.dist2 - b.priority.dist2);
      }

      // Flat enumeration of every tile at exactly `level` covering `bbox`.
      // Unlike _buildDesiredTiles (center-first DFS), this gives uniform coverage
      // across the full bbox — used for background tiles so the whole viewport
      // has a coarse base rather than only the DFS-budget-exhausted center.
      // Returns at most `maxTiles` tiles sorted center-outward; returns [] if the
      // grid is larger than maxTiles (caller should step down level and retry).
      _buildBgTileGrid(bbox, level, maxTiles, focusTarget = null) {
        const range = this._getFocusTileRange(level, bbox);
        if (range.tileCount > maxTiles) return [];
        const referenceLon = (bbox.lonMin + bbox.lonMax) * 0.5;
        const tiles = [];
        for (let r = range.rMin; r <= range.rMax; r++) {
          for (let c = range.cMin; c <= range.cMax; c++) {
            const wc = ((c % range.nc) + range.nc) % range.nc;
            const normalized = this._normalizeTileRequest(level, r, wc);
            if (!normalized) continue;
            const bounds = this._boundsNearReference(
              this._tileBounds(normalized.level, normalized.row, normalized.col),
              referenceLon,
            );
            if (!this._tileIntersectsBbox(bounds, bbox)) continue;
            tiles.push({
              ...normalized,
              requestedLevel: level,
              priority: this._estimateTilePriority(bounds, bbox, focusTarget),
            });
          }
        }
        return tiles.sort((a, b) => a.priority.dist2 - b.priority.dist2);
      }

      _mergeDesiredTiles(primaryTiles, secondaryTiles = []) {
        const merged = new Map();
        for (const tile of primaryTiles) {
          if (!merged.has(tile.key)) {
            merged.set(tile.key, tile);
          }
        }
        for (const tile of secondaryTiles) {
          const existing = merged.get(tile.key);
          if (!existing) {
            merged.set(tile.key, tile);
            continue;
          }
          if (
            tile.level > existing.level
            || (tile.level === existing.level && tile.priority.dist2 < existing.priority.dist2)
          ) {
            merged.set(tile.key, tile);
          }
        }
        return [...merged.values()].sort((a, b) => {
          if (a.level !== b.level) return b.level - a.level;
          return a.priority.dist2 - b.priority.dist2;
        });
      }

      _prioritizeCloseRangeTiles(broadTiles, microTiles, desiredLevel) {
        if (!Array.isArray(microTiles) || microTiles.length === 0 || desiredLevel < 14) {
          return this._capDesiredTiles(this._mergeDesiredTiles(broadTiles, microTiles), desiredLevel);
        }
        const microKeys = new Set(microTiles.map((tile) => tile.key));
        const broadBudget = desiredLevel >= 16 ? 260 : desiredLevel >= 15 ? 340 : 420;
        const trimmedBroadTiles = broadTiles
          .filter((tile) => !microKeys.has(tile.key))
          .sort((a, b) => {
            if (a.level !== b.level) return b.level - a.level;
            return a.priority.dist2 - b.priority.dist2;
          })
          .slice(0, broadBudget);
        return this._capDesiredTiles(this._mergeDesiredTiles(trimmedBroadTiles, microTiles), desiredLevel);
      }

      _capDesiredTiles(tiles, desiredLevel) {
        const cap = desiredLevel >= 16 ? 420 : desiredLevel >= 14 ? 380 : desiredLevel >= 11 ? 280 : 180;
        if (!Array.isArray(tiles) || tiles.length <= cap) {
          return tiles;
        }
        return tiles.slice(0, cap);
      }

      _chooseLevel(lonSpan, latSpan, altitude = Infinity) {
        const dominantSpan = Math.max(lonSpan, latSpan * 1.35);
        let steppedLevel = this.maxLevel;
        for (const step of this.scaleSteps) {
          if (dominantSpan >= step.maxLonSpan) {
            steppedLevel = step.level;
            break;
          }
        }
        let closeLevel = this.minLevel;
        if (altitude <= 0.35) closeLevel = Math.max(closeLevel, 14);
        if (altitude <= 0.12) closeLevel = Math.max(closeLevel, 15);
        if (altitude <= 0.05) closeLevel = Math.max(closeLevel, 16);
        if (altitude <= 0.018) closeLevel = Math.max(closeLevel, 17);
        steppedLevel = Math.max(steppedLevel, closeLevel);
        return Math.max(this.minLevel, Math.min(this.maxLevel, steppedLevel));
      }

      _smoothStageLevel(targetLevel, now) {
        if (!Number.isFinite(this._smoothedStageLevel)) {
          this._smoothedStageLevel = targetLevel;
          this._lastStageLevelChangeAt = now;
          return targetLevel;
        }
        if (targetLevel === this._smoothedStageLevel) {
          return this._smoothedStageLevel;
        }
        if ((now - this._lastStageLevelChangeAt) < this.stageLevelStepIntervalMs) {
          return this._smoothedStageLevel;
        }
        const gap = Math.abs(targetLevel - this._smoothedStageLevel);
        const step = gap > 3 ? 2 : 1;
        this._smoothedStageLevel += targetLevel > this._smoothedStageLevel ? step : -step;
        this._smoothedStageLevel = Math.max(this.minLevel, Math.min(this.maxLevel, this._smoothedStageLevel));
        this._lastStageLevelChangeAt = now;
        return this._smoothedStageLevel;
      }

      _getStage(camera, bbox, viewBbox = bbox) {
        const now = performance.now();
        if (!Number.isFinite(this._lastCameraPos.x) || this._lastCameraPos.distanceToSquared(camera.position) > this._motionThreshold * this._motionThreshold) {
          this._lastMotionAt = now;
          this._lastCameraPos.copy(camera.position);
        }
        const isSettled = (now - this._lastMotionAt) >= this._settleDelayMs;
        this._cameraSettled = isSettled;
        if (!isSettled) {
          return null;
        }
        // Use viewBbox (actual screen extent) for level selection, not refinementBbox.
        // The refinement bbox is padded beyond the viewport; using it makes _chooseLevel
        // return a level that's 1-2 too low.
        const spanMetrics = this._getEffectiveSpanMetrics(viewBbox);
        const altitude = Math.max(0, camera.position.length() - this.baseRadius);
        const desiredLevel = this._chooseLevel(spanMetrics.effectiveLonSpan, spanMetrics.effectiveLatSpan, altitude);

        // ESRI-style progressive LOD stepping: coarse → fine, one level at a time.
        //
        // Zoom-out: jump immediately to lower level (no point stepping through coarser
        //   levels the user is moving away from; stale fine tiles are already cleared
        //   by the purgeAltitude gate and largeAreaChange logic).
        //
        // Zoom-in / first activation: start 3 levels below the target so the user
        //   sees medium-res coverage immediately, then progressively refine.
        //   Advance one level when:
        //     (a) at least 2 tiles are visible at the current stage level, AND
        //         at least 180 ms have elapsed since the last step  (minimum dwell),  OR
        //     (b) 650 ms have elapsed since the last step (timeout — handles sparse
        //         CTX coverage areas where few tiles actually load).
        if (!Number.isFinite(this._smoothedStageLevel) || this._smoothedStageLevel > desiredLevel) {
          // First activation or zoom-out: seed from 3 levels below target (or activationMinLevel)
          this._smoothedStageLevel = !Number.isFinite(this._smoothedStageLevel)
            ? Math.max(this.activationMinLevel, desiredLevel - 3)
            : desiredLevel;
          this._lastStageLevelChangeAt = now;
        } else if (this._smoothedStageLevel < desiredLevel) {
          const timeSinceStep = now - this._lastStageLevelChangeAt;
          const currentLevelLoaded = [...this.meshes.keys()]
            .filter((k) => Number(k.split('/')[0]) === this._smoothedStageLevel).length;
          const minDwellMet = timeSinceStep >= 40;
          const hasCoverage = currentLevelLoaded >= 1 && minDwellMet;
          const timedOut = timeSinceStep >= 150;
          if (hasCoverage || timedOut) {
            this._smoothedStageLevel = Math.min(desiredLevel, this._smoothedStageLevel + 1);
            this._lastStageLevelChangeAt = now;
          }
        }
        return { level: this._smoothedStageLevel, altitude, desiredLevel };
      }

      _wrapLonNear(referenceLon, lon) {
        let delta = lon - referenceLon;
        while (delta < -180) delta += 360;
        while (delta > 180) delta -= 360;
        return referenceLon + delta;
      }

      _buildRefinementBbox(viewBbox, focusTarget, altitude) {
        if (!viewBbox) {
          return null;
        }
        const rawLonSpan = Math.max(viewBbox.lonMax - viewBbox.lonMin, 0.1);
        const rawLatSpan = Math.max(viewBbox.latMax - viewBbox.latMin, 0.1);
        const altitudeT = clamp(altitude / 8.0, 0, 1);
        const marginFactor = THREE.MathUtils.lerp(0.18, 0.06, altitudeT);
        // Use view-proportional minimums so close-zoom views stay tight.
        // The old absolute minimums (0.75° / 0.6°) inflated the bbox to 2°×1.5°
        // even when the view span was 0.1°, making all tile projectedPx tiny and
        // forcing the quadtree to stop at level 10–11 instead of 15–17.
        const lonMargin = clamp(rawLonSpan * marginFactor, rawLonSpan * 0.3, 8);
        const latMargin = clamp(rawLatSpan * marginFactor, rawLatSpan * 0.3, 6);
        const referenceLon = (viewBbox.lonMin + viewBbox.lonMax) * 0.5;
        const centerLon = focusTarget
          ? this._wrapLonNear(referenceLon, focusTarget.lon)
          : referenceLon;
        const centerLat = clamp(
          focusTarget ? focusTarget.lat : ((viewBbox.latMin + viewBbox.latMax) * 0.5),
          -90,
          90,
        );
        const lonHalf = (rawLonSpan * 0.5) + lonMargin;
        const latHalf = (rawLatSpan * 0.5) + latMargin;
        return {
          lonMin: centerLon - lonHalf,
          lonMax: centerLon + lonHalf,
          latMin: clamp(centerLat - latHalf, -90, 90),
          latMax: clamp(centerLat + latHalf, -90, 90),
        };
      }

      _buildMicroRefinementBbox(viewBbox, focusTarget, altitude) {
        if (!viewBbox || !focusTarget) {
          return null;
        }
        const rawLonSpan = Math.max(viewBbox.lonMax - viewBbox.lonMin, 0.05);
        const rawLatSpan = Math.max(viewBbox.latMax - viewBbox.latMin, 0.05);
        const altitudeT = clamp(altitude / 0.35, 0, 1);
        const spanFactor = THREE.MathUtils.lerp(0.12, 0.28, altitudeT);
        const lonHalf = clamp(rawLonSpan * spanFactor * 0.5, 0.12, 3.5);
        const latHalf = clamp(rawLatSpan * spanFactor * 0.5, 0.10, 2.8);
        const referenceLon = (viewBbox.lonMin + viewBbox.lonMax) * 0.5;
        const centerLon = this._wrapLonNear(referenceLon, focusTarget.lon);
        const centerLat = clamp(focusTarget.lat, -90, 90);
        return {
          lonMin: centerLon - lonHalf,
          lonMax: centerLon + lonHalf,
          latMin: clamp(centerLat - latHalf, -90, 90),
          latMax: clamp(centerLat + latHalf, -90, 90),
        };
      }

      // On zoom-level change: remove old detail meshes and fall back to the uniform
      // canvas/focus layers underneath. Keeping stale levels visible caused obvious
      // blocky mixed-resolution patches across the viewport.
      _evictOldLevels(keepLevel) {
        for (const [key, mesh] of this.meshes.entries()) {
          const keyLevel = parseInt(key.split('/')[0], 10);
          const keepFallbackLevel = Number.isFinite(mesh.userData?.fallbackLevel)
            ? mesh.userData.fallbackLevel
            : keepLevel;
          if (keyLevel > keepLevel || keyLevel < keepFallbackLevel) {
            this.group.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.map.dispose();
            mesh.material.dispose();
            this.meshes.delete(key);
          }
        }
        // Stop fetching tiles for stale levels
        this.queue = this.queue.filter((item) => item.level === keepLevel);
        this.queued.clear();
        for (const item of this.queue) {
          this.queued.add(item.key);
        }
      }

      _syncMeshRenderOrders() {
        for (const [key, mesh] of this.meshes.entries()) {
          const keyLevel = parseInt(key.split('/')[0], 10);
          mesh.renderOrder = (keyLevel === this._currentLevel) ? 40 : 39;
        }
      }

      _syncMeshVisibility(camera = null, simplify = false) {
        const meshKeys = new Set(this.meshes.keys());
        const coverageMemo = new Map();
        const cameraDir = camera ? camera.position.clone().normalize() : null;
        const worldCenter = new THREE.Vector3();
        const frontFacingMap = new Map();
        for (const [key, mesh] of this.meshes.entries()) {
          let frontFacing = true;
          if (cameraDir) {
            mesh.getWorldPosition(worldCenter);
            const surfaceNormal = worldCenter.clone().normalize();
            frontFacing = surfaceNormal.dot(cameraDir) > -0.04;
          }
          frontFacingMap.set(key, frontFacing);
        }
        const isFullyCovered = (level, row, col) => {
          const memoKey = `${level}/${row}/${col}`;
          if (coverageMemo.has(memoKey)) {
            return coverageMemo.get(memoKey);
          }
          const directKey = memoKey;
          if (meshKeys.has(directKey) && frontFacingMap.get(directKey) !== false) {
            coverageMemo.set(memoKey, true);
            return true;
          }
          if (level >= this._currentLevel) {
            coverageMemo.set(memoKey, false);
            return false;
          }
          const childLevel = level + 1;
          const childRow = row * 2;
          const childCol = col * 2;
          const covered = (
            isFullyCovered(childLevel, childRow, childCol)
            && isFullyCovered(childLevel, childRow, childCol + 1)
            && isFullyCovered(childLevel, childRow + 1, childCol)
            && isFullyCovered(childLevel, childRow + 1, childCol + 1)
          );
          coverageMemo.set(memoKey, covered);
          return covered;
        };
        for (const [key, mesh] of this.meshes.entries()) {
          const [levelText, rowText, colText] = key.split('/');
          const level = Number(levelText);
          const row = Number(rowText);
          const col = Number(colText);
          if (!Number.isFinite(level) || !Number.isFinite(row) || !Number.isFinite(col)) {
            mesh.visible = true;
            continue;
          }
          const frontFacing = frontFacingMap.get(key) !== false;
          if (simplify) {
            mesh.visible = frontFacing;
            continue;
          }
          if (level >= this._currentLevel) {
            mesh.visible = frontFacing;
            continue;
          }
          const childLevel = level + 1;
          const childRow = row * 2;
          const childCol = col * 2;
          const fullyReplaced = (
            isFullyCovered(childLevel, childRow, childCol)
            && isFullyCovered(childLevel, childRow, childCol + 1)
            && isFullyCovered(childLevel, childRow + 1, childCol)
            && isFullyCovered(childLevel, childRow + 1, childCol + 1)
          );
          mesh.visible = frontFacing && !fullyReplaced;
        }
      }

      _createGeometry(bounds, overlap = 0) {
        // Expand geometry slightly beyond tile bounds so neighbouring tiles
        // overlap by a few pixels — closes hairline seams between patches.
        const gLonMin = bounds.lonMin - overlap;
        const gLonMax = bounds.lonMax + overlap;
        const gLatMin = bounds.latMin - overlap;
        const gLatMax = bounds.latMax + overlap;
        const lonSpan = Math.abs(gLonMax - gLonMin);
        const latSpan = Math.abs(gLatMax - gLatMin);
        const relief = this.getTerrainRelief();
        const flatMode = Math.max(0, relief) <= 0.0015;
        const segLon = flatMode
          ? Math.max(2, Math.min(10, Math.ceil(lonSpan / 0.35)))
          : Math.max(10, Math.min(36, Math.ceil(lonSpan / 0.1)));
        const segLat = flatMode
          ? Math.max(2, Math.min(10, Math.ceil(latSpan / 0.35)))
          : Math.max(10, Math.min(36, Math.ceil(latSpan / 0.1)));
        const numVerts = (segLon + 1) * (segLat + 1);
        const surfaceLift = this.surfaceLiftBase + (Math.max(0, relief) * this.surfaceLiftReliefFactor);

        // UV + index arrays are identical for all tiles sharing the same segLon/segLat.
        // Cache them so only the position array (unique per tile) is computed fresh.
        const geomKey = `${segLon}_${segLat}`;
        let geomTemplate = this._geomCache.get(geomKey);
        if (!geomTemplate) {
          const uvArr = new Float32Array(numVerts * 2);
          let ui = 0;
          for (let y = 0; y <= segLat; y += 1) {
            const v = y / segLat;
            for (let x = 0; x <= segLon; x += 1) {
              uvArr[ui++] = x / segLon;
              uvArr[ui++] = 1 - v;
            }
          }
          const idxArr = new Uint32Array(segLon * segLat * 6);
          let ii = 0;
          for (let y = 0; y < segLat; y += 1) {
            for (let x = 0; x < segLon; x += 1) {
              const a = y * (segLon + 1) + x;
              const b = a + 1;
              const c = a + segLon + 1;
              const d = c + 1;
              idxArr[ii++] = a; idxArr[ii++] = b; idxArr[ii++] = c;
              idxArr[ii++] = b; idxArr[ii++] = d; idxArr[ii++] = c;
            }
          }
          geomTemplate = { uvArr, idxArr };
          this._geomCache.set(geomKey, geomTemplate);
        }

        // Positions are unique per tile — always computed fresh.
        const posArr = new Float32Array(numVerts * 3);
        let pi = 0;
        for (let y = 0; y <= segLat; y += 1) {
          const v = y / segLat;
          const lat = gLatMax + ((gLatMin - gLatMax) * v);
          for (let x = 0; x <= segLon; x += 1) {
            const lonRaw = gLonMin + ((gLonMax - gLonMin) * (x / segLon));
            const lon = ((lonRaw % 360) + 360) % 360;
            const displacement = this.elevationSampler
              ? sampleElevationNormalized(this.elevationSampler, lat, lon) * relief
              : 0;
            const pt = latLonToVector3(lat, lon, this.baseRadius + displacement + surfaceLift);
            posArr[pi++] = pt.x;
            posArr[pi++] = pt.y;
            posArr[pi++] = pt.z;
          }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(posArr, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(geomTemplate.uvArr.slice(), 2));
        geometry.setIndex(new THREE.BufferAttribute(geomTemplate.idxArr.slice(), 1));
        // MeshBasicMaterial ignores normals — computeVertexNormals() is skipped intentionally.
        return geometry;
      }

      _createMesh(level, row, col, image) {
        const bounds = this._tileBounds(level, row, col);
        const geometry = this._createGeometry(bounds, 0);
        const texture = new THREE.Texture(image);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = this.textureAnisotropy;
        texture.premultiplyAlpha = true;
        texture.needsUpdate = true;
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          alphaTest: 0.02,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -8,
          polygonOffsetUnits: -8,
          toneMapped: false,
        });
        const contourUvBounds = this._getContourUvBounds(bounds);
        // All CTX tile materials share identical GLSL — only uniform values differ.
        // customProgramCacheKey tells Three.js to reuse the one compiled GPU program
        // instead of recompiling per-material, which was causing multi-second freezes.
        material.customProgramCacheKey = () => 'ctx-detail-tile';
        material.onBeforeCompile = (shader) => {
          material.userData.ctxContourShader = shader;
          shader.uniforms.uContourMap = { value: this.contourTexture };
          shader.uniforms.uContourOpacity = { value: this.contourOpacity };
          shader.uniforms.uContourEnabled = { value: this.contourEnabled ? 1 : 0 };
          shader.uniforms.uContourTexel = { value: this.contourTexel.clone() };
          shader.uniforms.uContourThickness = { value: this.contourThickness };
          shader.uniforms.uContourInterval = { value: this.contourInterval };
          shader.uniforms.uContourMinMeters = { value: this.contourMinMeters };
          shader.uniforms.uContourReliefMeters = { value: this.contourReliefMeters };
          shader.uniforms.uContourUvBounds = { value: contourUvBounds };
          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              "#include <common>\nuniform vec4 uContourUvBounds;\nvarying vec2 vContourUv;",
            )
            .replace(
              "#include <uv_vertex>",
              `#include <uv_vertex>
              vContourUv = vec2(
                mix(uContourUvBounds.x, uContourUvBounds.y, uv.x),
                mix(uContourUvBounds.z, uContourUvBounds.w, uv.y)
              );`,
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              "#include <common>\nuniform sampler2D uContourMap;\nuniform float uContourOpacity;\nuniform float uContourEnabled;\nuniform vec2 uContourTexel;\nuniform float uContourThickness;\nuniform float uContourInterval;\nuniform float uContourMinMeters;\nuniform float uContourReliefMeters;\nvarying vec2 vContourUv;",
            )
            .replace(
              "#include <map_fragment>",
              `#include <map_fragment>
              if (uContourEnabled > 0.5) {
                vec2 contourOffset = uContourTexel * uContourThickness;
                vec2 contourUv = vec2(fract(vContourUv.x), 1.0 - clamp(vContourUv.y, 0.0, 1.0));
                float contourMask = 0.0;
                vec2 contourSamples[5];
                contourSamples[0] = contourUv;
                contourSamples[1] = vec2(fract(contourUv.x - contourOffset.x), contourUv.y);
                contourSamples[2] = vec2(fract(contourUv.x + contourOffset.x), contourUv.y);
                contourSamples[3] = vec2(fract(contourUv.x), clamp(contourUv.y - contourOffset.y, 0.0, 1.0));
                contourSamples[4] = vec2(fract(contourUv.x), clamp(contourUv.y + contourOffset.y, 0.0, 1.0));
                for (int i = 0; i < 5; i++) {
                  float elev01 = texture2D(uContourMap, contourSamples[i]).r;
                  float elevMeters = uContourMinMeters + elev01 * uContourReliefMeters;
                  float contourFrac = fract((elevMeters - uContourMinMeters) / max(uContourInterval, 1.0));
                  float contourDist = min(contourFrac, 1.0 - contourFrac);
                  contourMask = max(contourMask, 1.0 - smoothstep(0.0, 0.06, contourDist));
                }
                float contourAlpha = contourMask * uContourOpacity;
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 0.98), contourAlpha);
              }`,
            );
        };
        const mesh = new THREE.Mesh(geometry, material);
        // Force draped CTX detail to render above the globe basemap.
        mesh.renderOrder = (level === this._currentLevel) ? 40 : 39;
        mesh.frustumCulled = false;
        mesh.userData.bounds = bounds;
        mesh.userData.lastUsed = performance.now();
        mesh.userData.key = `${level}/${row}/${col}`;
        mesh.userData.fallbackLevel = level;
        return mesh;
      }

      _enqueue(level, row, col, priority = null) {
        const normalized = this._normalizeTileRequest(level, row, col);
        if (!normalized) return;
        const { level: effectiveLevel, row: effectiveRow, col: effectiveCol, key } = normalized;
        if (this.meshes.has(key) || this.inflight.has(key) || this.queued.has(key) || this._staged.has(key) || this._knownBlank.has(key)) return;
        this.queue.push({
          level: effectiveLevel,
          row: effectiveRow,
          col: effectiveCol,
          key,
          epoch: this._requestEpoch,
          priority: Number.isFinite(priority) ? priority : 0,
        });
        this.queued.add(key);
      }

      _isDescendantOf(level, row, col, ancestorLevel, ancestorRow, ancestorCol) {
        if (level < ancestorLevel) {
          return false;
        }
        const delta = level - ancestorLevel;
        return Math.floor(row / (1 << delta)) === ancestorRow
          && Math.floor(col / (1 << delta)) === ancestorCol;
      }

      _collapseQueuedBranch(requestedLevel, requestedRow, requestedCol, resolvedLevel, resolvedRow, resolvedCol, priority = 0) {
        if (resolvedLevel >= requestedLevel) {
          return;
        }
        this.queue = this.queue.filter((item) => !(
          item.level > resolvedLevel
          && this._isDescendantOf(item.level, item.row, item.col, resolvedLevel, resolvedRow, resolvedCol)
        ));
        this.queued.clear();
        for (const item of this.queue) {
          this.queued.add(item.key);
        }
        this._enqueue(resolvedLevel, resolvedRow, resolvedCol, priority);
      }

      _drain(sort = false) {
        // Sort only when explicitly requested (once per update() cycle after all
        // enqueues). Sorting on every _fetch completion — potentially 28 times
        // per batch — is O(n log n) wasted work since priorities don't change
        // between the final update() sort and the subsequent drain calls.
        if (sort) {
          this.queue.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            // Coarser levels load before finer levels when priority ties.
            if (a.level !== b.level) return a.level - b.level;
            return 0;
          });
        }
        while (this.inflight.size < this.maxInflight && this.queue.length > 0) {
          const item = this.queue.shift();
          this.queued.delete(item.key);
          this.inflight.add(item.key);
          this._fetch(item);
        }
      }

      async _fetch({ level, row, col, key, epoch, priority = 0 }) {
        const tileUrl = `${this.tileBase}/${level}/${row}/${col}`;
        const controller = new AbortController();
        this.controllers.set(key, controller);
        window.__ctxPatchDebug = {
          ...(window.__ctxPatchDebug || {}),
          lastAttemptedKey: key,
          lastAttemptedUrl: tileUrl,
          attemptedFetches: Number(window.__ctxPatchDebug?.attemptedFetches || 0) + 1,
        };
        try {
          // Allow up to 3 levels of fallback so coarser-but-real CTX tiles fill
          // the view while higher-res tiles are still loading or confirmed blank.
          // The requested key is marked _knownBlank below if the fallback resolves
          // at a lower level, preventing infinite re-fetch cycles.
          const fallbackMinLevel = Math.max(this.activationMinLevel, level - 3);
          const payload = await this.getTilePayload(level, row, col, fallbackMinLevel, controller.signal);
          if (controller.signal.aborted) {
            return;
          }
          if (!payload) {
            // Mark this tile permanently blank so _enqueue never re-queues it.
            // CTX is a fixed dataset — if a tile has no imagery it never will.
            this._knownBlank.add(key);
            window.__ctxPatchDebug = {
              ...(window.__ctxPatchDebug || {}),
              lastFailedKey: key,
              lastFailedUrl: tileUrl,
              knownBlankCount: this._knownBlank.size,
              failedFetches: Number(window.__ctxPatchDebug?.failedFetches || 0) + 1,
            };
            return;
          }
          const resolvedKey = `${payload.level}/${payload.row}/${payload.col}`;
          if ((payload.failedStatus || 0) >= 500 && payload.level < level) {
            this._collapseQueuedBranch(level, row, col, payload.level, payload.row, payload.col, priority);
          }
          // If the fallback resolved at a lower level, the requested level is
          // permanently blank for this static dataset — blacklist it so _enqueue
          // never wastes a fetch slot on it again.
          if (payload.level < level) {
            this._knownBlank.add(key);
          }
          if (this.meshes.has(resolvedKey)) {
            const existing = this.meshes.get(resolvedKey);
            if (existing) existing.userData.lastUsed = performance.now();
            return;
          }
          // Push to staging queue. Geometry build + texture upload happen in
          // _flushStagingQueue() at a capped rate (3/frame) from update() so
          // simultaneous bulk arrivals never cause a GPU stall or JS burst.
          this._staged.add(resolvedKey);
          this._stagingQueue.push({
            payload,
            key: resolvedKey,
            epoch,
            tileUrl,
            priority,
          });
        } finally {
          this.controllers.delete(key);
          this.inflight.delete(key);
          this._drain();
        }
      }

      _evict(focusTarget = null) {
        if (this.meshes.size <= this.maxMeshes) return;
        // Protect current desired tiles and all their ancestors (coarse placeholders).
        const protectedKeys = new Set(this.currentKeys || []);
        for (const key of [...protectedKeys]) {
          let [lv, rw, cl] = key.split('/').map(Number);
          while (Number.isFinite(lv) && lv > this.minLevel) {
            lv--; rw = Math.floor(rw / 2); cl = Math.floor(cl / 2);
            protectedKeys.add(`${lv}/${rw}/${cl}`);
          }
        }
        // ArcGIS-style eviction: sort by combined distance-from-camera + age.
        // Tiles far from the focus point and least-recently-used are evicted first.
        const now = performance.now();
        const cx = focusTarget?.lon ?? 0;
        const cy = focusTarget?.lat ?? 0;
        const entries = [...this.meshes.entries()].map(([key, mesh]) => {
          const b = mesh.userData.bounds;
          let dist2 = 0;
          if (b && focusTarget) {
            const dx = ((b.lonMin + b.lonMax) * 0.5) - cx;
            const dy = ((b.latMin + b.latMax) * 0.5) - cy;
            dist2 = dx * dx + dy * dy;
          }
          const age = now - (mesh.userData.lastUsed || 0);
          // Combined score: distance dominates, age breaks ties.
          return [key, mesh, dist2 + age * 0.00005];
        }).sort((a, b) => b[2] - a[2]); // descending — evict highest score first
        for (const [key, mesh] of entries) {
          if (protectedKeys.has(key)) continue;
          this._disposeMeshByKey(key, mesh);
          if (this.meshes.size <= this.maxMeshes) break;
        }
      }

      _flushStagingQueue() {
        // Flush rate adapts to camera state:
        //   settled → 3/frame: GPU program is shared via customProgramCacheKey so
        //             compile cost is paid only once, but geometry upload still
        //             blocks the driver; 3/frame keeps frames under ~8ms.
        //   moving  → 1/frame: don't burn GPU building meshes that will be pruned in <50ms
        const maxPerFrame = this._cameraSettled ? 8 : 2;
        // Sort staging queue by priority so tiles appear center-outward regardless
        // of which network responses happened to arrive first.
        if (this._stagingQueue.length > 1) {
          this._stagingQueue.sort((a, b) => (a.priority || 0) - (b.priority || 0));
        }
        let count = 0;
        while (count < maxPerFrame && this._stagingQueue.length > 0) {
          const { payload, key, epoch } = this._stagingQueue.shift();
          this._staged.delete(key); // always release the slot, whether we use it or not
          if (epoch !== this._requestEpoch) continue; // stale — skip
          if (this.meshes.has(key)) continue;         // already present
          const mesh = this._createMesh(payload.level, payload.row, payload.col, payload.image);
          mesh.userData.fallbackLevel = payload.level;
          if (epoch !== this._requestEpoch) {
            // Became stale while building geometry — dispose and skip.
            mesh.geometry.dispose();
            if (mesh.material.map) mesh.material.map.dispose();
            mesh.material.dispose();
            continue;
          }
          this.group.add(mesh);
          this.meshes.set(key, mesh);
          this._visibilityDirty = true;
          count++;
        }
        if (count > 0) {
          window.__ctxPatchDebug = {
            ...(window.__ctxPatchDebug || {}),
            resolvedFetches: Number(window.__ctxPatchDebug?.resolvedFetches || 0) + count,
            visibleMeshCount: this.meshes.size,
          };
        }
      }

      _processDisposalQueue() {
        // Release GL resources for at most 8 meshes per frame to avoid a
        // synchronous WebGL flush that would freeze the main thread.
        const batch = 8;
        for (let i = 0; i < batch && this._disposalQueue.length > 0; i++) {
          const mesh = this._disposalQueue.shift();
          mesh.geometry.dispose();
          if (mesh.material.map) mesh.material.map.dispose();
          mesh.material.dispose();
        }
      }

      _disposeMeshByKey(key, mesh) {
        // Remove from scene graph and hide immediately (stops rendering this frame).
        this.group.remove(mesh);
        mesh.visible = false;
        // Defer expensive WebGL buffer/texture deletion to the disposal queue.
        this._disposalQueue.push(mesh);
        this.meshes.delete(key);
      }

      _clearMeshes() {
        for (const [key, mesh] of [...this.meshes.entries()]) {
          this._disposeMeshByKey(key, mesh);
        }
        this.currentKeys.clear();
      }

      _pruneMeshesToCurrentCoverage() {
        if (!this.currentKeys || this.currentKeys.size === 0) {
          this._clearMeshes();
          return;
        }
        const protectedKeys = new Set(this.currentKeys);
        for (const key of [...protectedKeys]) {
          const [levelText, rowText, colText] = key.split('/');
          let level = Number(levelText);
          let row = Number(rowText);
          let col = Number(colText);
          while (Number.isFinite(level) && level > this.minLevel) {
            level -= 1;
            row = Math.floor(row / 2);
            col = Math.floor(col / 2);
            protectedKeys.add(`${level}/${row}/${col}`);
          }
        }
        for (const [key, mesh] of [...this.meshes.entries()]) {
          if (!protectedKeys.has(key)) {
            this._disposeMeshByKey(key, mesh);
          }
        }
      }

      rebuild() {
        for (const mesh of this.meshes.values()) {
          const bounds = mesh.userData.bounds;
          mesh.geometry.dispose();
          mesh.geometry = this._createGeometry(bounds, 0);
        }
      }

      update(camera) {
        // Stage 1: create at most 3 new meshes from completed fetches.
        // Geometry build + GPU texture upload are capped per frame.
        this._flushStagingQueue();
        // Stage 2: drain GL disposal queue — spreads buffer deletions across frames.
        this._processDisposalQueue();
        // Stage 3: flush visibility/eviction once per frame (not once per completed fetch).
        // _fetch() only sets _visibilityDirty; all the expensive mesh-iteration
        // work happens here so bursts of simultaneous tile arrivals don't cascade
        // into a synchronous main-thread freeze.
        if (this._visibilityDirty) {
          this._visibilityDirty = false;
          this._evict(this._lastFocusTarget);
          this._syncMeshVisibility(null, this.meshes.size > 180);
        }
        if (!this.active) return;
        const view = this.getViewBbox(camera);
        if (!view || !view.bbox) {
          window.__ctxPatchDebug = {
            ...(window.__ctxPatchDebug || {}),
            active: false,
            gate: { reason: 'no_sphere_hit', hits: view?.hits ?? 0 },
            altitude: Math.max(0, camera.position.length() - this.baseRadius),
            meshCount: this.meshes.size,
          };
          return;
        }

        const initialAltitude = Math.max(0, camera.position.length() - this.baseRadius);

        // ── Altitude gate ──────────────────────────────────────────────────────────
        // Above purgeAltitude: immediately destroy all high-res tiles and return.
        // The canvas layer is the global fallback. This gives a clean slate every
        // time the user zooms out, so the next zoom-in area starts with no stale
        // tiles and full GPU/network headroom.
        if (initialAltitude > this.purgeAltitude) {
          window.__ctxPatchDebug = {
            ...(window.__ctxPatchDebug || {}),
            active: false,
            gate: { reason: 'purge_altitude', altitude: initialAltitude, purgeAltitude: this.purgeAltitude },
            altitude: initialAltitude,
            meshCount: this.meshes.size,
          };
          if (!this._purged) {
            this._purged = true;
            this.group.visible = false;
            this.queue = [];
            this.queued.clear();
            this._stagingQueue = [];
            this._staged.clear();
            this._abortInflight();
            this.inflight.clear();
            this._lastStateKey = "";
            this._requestEpoch += 1;
            this._smoothedStageLevel = NaN; // next zoom-in restarts coarse→fine
            this._clearMeshes();
          }
          return;
        }
        this._purged = false;
        // ──────────────────────────────────────────────────────────────────────────

        const focusTarget = this.getFocusTarget(camera);
        const refinementBbox = this._buildRefinementBbox(view.bbox, focusTarget, initialAltitude);
        if (!refinementBbox) return;

        const spanMetrics = this._getEffectiveSpanMetrics(view.bbox, focusTarget);

        const stage = this._getStage(camera, refinementBbox, view.bbox);
        if (!stage) {
          // Camera is moving — pre-cache background tiles at the same adaptive level
          // the settled path will need, so they're ready (or in-flight) when the
          // camera stops.  This closes the coverage gap that appears when panning
          // to a new location at fine zoom.
          const motionTightR = Math.max(0.2, Math.min(15, initialAltitude * 8));
          const motionTightBbox = focusTarget ? {
            lonMin: focusTarget.lon - motionTightR,
            lonMax: focusTarget.lon + motionTightR,
            latMin: Math.max(-90, focusTarget.lat - motionTightR),
            latMax: Math.min(90, focusTarget.lat + motionTightR),
          } : view.bbox;
          const motionTightLon = motionTightBbox.lonMax - motionTightBbox.lonMin;
          const motionTightLat = Math.max(motionTightBbox.latMax - motionTightBbox.latMin, 0.01);
          const motionBgAdaptive = Math.floor(
            (Math.log2(Math.max(400 * 64800 / (motionTightLon * motionTightLat), 1)) - 1) / 2,
          );
          // Clamp: never go coarser than activationMinLevel+2 (avoid pre-loading
          // too many tiles when the view is still wide) or finer than 13 (keeps
          // the motion-path budget small).
          const coverageLevel = Math.max(
            this.activationMinLevel,
            Math.min(motionBgAdaptive, 13),
          );
          // Use motionTightBbox (altitude-scaled, like the settled path) so the
          // tile count is bounded even at very close zoom where view.bbox spans
          // 9°+ due to raycaster hitting the globe limb.  view.bbox at alt=0.04
          // produced ~42 000 tiles → failed the guard → nothing pre-cached.
          const coverageTiles = this._buildDesiredTiles(motionTightBbox, focusTarget, coverageLevel, view.bbox);
          if (coverageTiles.length <= 600) {
            this.group.visible = true;
            for (const tile of coverageTiles) {
              this._enqueue(tile.level, tile.row, tile.col, tile.priority?.dist2 || 0);
            }
            if (focusTarget && initialAltitude <= 0.22) {
              const motionMicroBbox = this._buildMicroRefinementBbox(view.bbox, focusTarget, initialAltitude);
              if (motionMicroBbox) {
                const motionMicroLevel = Math.min(
                  this.maxLevel,
                  Math.max(14, this._chooseLevel(
                    Math.max(motionMicroBbox.lonMax - motionMicroBbox.lonMin, 0.05),
                    Math.max(motionMicroBbox.latMax - motionMicroBbox.latMin, 0.05),
                    initialAltitude,
                  )),
                );
                const motionMicroTiles = this._buildDesiredTiles(
                  motionMicroBbox,
                  focusTarget,
                  motionMicroLevel,
                  view.bbox,
                ).slice(0, 16);
                for (const tile of motionMicroTiles) {
                  this._enqueue(tile.level, tile.row, tile.col, (tile.priority?.dist2 || 0) - (tile.level * 0.5));
                }
              }
            }
            this._drain(true);
          }
          if (this.meshes.size > 0) {
            this.group.visible = true;
            this._syncMeshVisibility(camera, true);
          }
          return;
        }
        const overviewTooBroad = (
          spanMetrics.effectiveLonSpan > this.activationMaxLonSpan
          || (view.bbox.latMax - view.bbox.latMin) > this.activationMaxLatSpan
          || stage.level < this.activationMinLevel
        );
        if (overviewTooBroad) {
          this.group.visible = false;
          this.queue = [];
          this.queued.clear();
          this._stagingQueue = [];
          this._staged.clear();
          this._abortInflight();
          this.inflight.clear();
          this._lastStateKey = "";
          this._requestEpoch += 1;
          this._clearMeshes();
          window.__ctxPatchDebug = {
            ...(window.__ctxPatchDebug || {}),
            active: false,
            altitude: stage.altitude,
            focusTarget,
            level: stage.level,
            desiredLevel: stage.desiredLevel,
            refinementBbox: { ...refinementBbox },
            visibleBbox: { ...view.bbox },
            viewTileCount: 0,
            meshCount: 0,
            inflightCount: 0,
            queueLength: 0,
            minMeshLevel: null,
            maxMeshLevel: null,
            gate: {
              reason: "overview",
              activationMinLevel: this.activationMinLevel,
              activationMaxLonSpan: this.activationMaxLonSpan,
              activationMaxLatSpan: this.activationMaxLatSpan,
              effectiveLonSpan: spanMetrics.effectiveLonSpan,
              viewLatSpan: view.bbox.latMax - view.bbox.latMin,
              stageLevel: stage.level,
            },
          };
          return;
        }
        this.group.visible = true;
        // Use the full visible viewport as the tiling bbox so CTX patches cover the
        // entire camera extent, not just the tight refinement area around the focus
        // point. The DFS budget cap (maxMeshes*2) bounds the tile count naturally.
        const level = stage.level;
        const viewLonSpan = view.bbox.lonMax - view.bbox.lonMin;
        const focusShiftDeg = this._focusShiftDegrees(focusTarget);

        // ── Two-layer LOD (matches ArcGIS progressive refinement) ─────────────────
        // Layer 1 — Background: uniform flat-grid tiles covering the full view.bbox.
        //
        //   bgLevel is chosen so ~300 tiles cover view.bbox (adaptive to view area).
        //   A flat grid (_buildBgTileGrid) is used instead of DFS so coverage is
        //   even across the entire viewport — DFS exhausts its budget on center
        //   tiles and leaves the periphery blank.
        //   Step bgLevel down until the grid fits within 480 tiles.
        const viewLatSpan = Math.max(view.bbox.latMax - view.bbox.latMin, 0.01);
        const bgLevelAdaptive = Math.floor(
          (Math.log2(Math.max(300 * 64800 / (Math.max(viewLonSpan, 0.01) * viewLatSpan), 1)) - 1) / 2,
        );
        let bgLevel = Math.max(3, Math.min(level - 1, bgLevelAdaptive));
        let backgroundTiles = [];
        if (bgLevel < level) {
          backgroundTiles = this._buildBgTileGrid(view.bbox, bgLevel, 480, focusTarget);
          while (backgroundTiles.length === 0 && bgLevel > 3) {
            bgLevel -= 1;
            backgroundTiles = this._buildBgTileGrid(view.bbox, bgLevel, 480, focusTarget);
          }
        }
        // Layer 2 — Detail: prefer flat-grid tiles at `level` across the full visible
        // viewport so high zoom levels cover the entire frame, not just the focus
        // center. If the full-frame tile count is too high, fall back to a cropped
        // center-biased bbox to stay within budget.
        const tileDegLon = 360 / (1 << (level + 1));
        const tileDegLat = 180 / (1 << level);
        const detailTileBudget = 480;
        let broadTiles = this._buildBgTileGrid(view.bbox, level, detailTileBudget, focusTarget);
        const broadSide = Math.floor(Math.sqrt(480)); // 21 tiles per side → ≤ 441 tiles
        const broadRadLon = (broadSide * tileDegLon) / 2;
        const broadRadLat = (broadSide * tileDegLat) / 2;
        const broadCLon = focusTarget ? focusTarget.lon : (view.bbox.lonMin + view.bbox.lonMax) / 2;
        const broadCLat = focusTarget ? focusTarget.lat : (view.bbox.latMin + view.bbox.latMax) / 2;
        const broadBbox = {
          lonMin: Math.max(view.bbox.lonMin, broadCLon - broadRadLon),
          lonMax: Math.min(view.bbox.lonMax, broadCLon + broadRadLon),
          latMin: Math.max(Math.max(-90, view.bbox.latMin), broadCLat - broadRadLat),
          latMax: Math.min(Math.min(90, view.bbox.latMax), broadCLat + broadRadLat),
        };
        if (!broadTiles.length) {
          broadTiles = this._buildBgTileGrid(broadBbox, level, detailTileBudget, focusTarget);
        }
        let microTiles = [];
        let microRefinementBbox = null;
        let microLevel = null;
        if (focusTarget && stage.desiredLevel >= 14) {
          microRefinementBbox = this._buildMicroRefinementBbox(view.bbox, focusTarget, stage.altitude);
          if (microRefinementBbox) {
            microLevel = Math.min(
              this.maxLevel,
              Math.max(level + 1, stage.desiredLevel + (stage.altitude <= 0.05 ? 2 : 1)),
            );
            microTiles = this._buildDesiredTiles(microRefinementBbox, focusTarget, microLevel, view.bbox);
          }
        }
        const desiredTiles = this._prioritizeCloseRangeTiles(broadTiles, microTiles, stage.desiredLevel);

        const previousLevel = this._currentLevel;
        const deepestLevel = desiredTiles.reduce((maxLevel, tile) => Math.max(maxLevel, tile.level), this.minLevel);
        if (deepestLevel !== this._currentLevel) {
          this._currentLevel = deepestLevel;
          this._lastStateKey = "";
          this._syncMeshRenderOrders();
        }

        const desiredKeys = new Set(desiredTiles.map((tile) => tile.key));
        // Include background tiles so they are protected from LRU eviction.
        const bgKeys = new Set(backgroundTiles.map((t) => t.key));
        // Keep desired tiles + background tiles + all ancestor levels as placeholders.
        // Includes level N-1 (transition buffer) so zooming in doesn't blank the
        // view while finer tiles load; _syncMeshVisibility hides ancestors once
        // children fully cover them.  Spatial LRU eviction removes the rest.
        const allKeys = new Set([...desiredKeys, ...bgKeys]);
        for (const key of this.meshes.keys()) {
          const keyLevel = Number(key.split('/')[0]);
          if (keyLevel < level) allKeys.add(key); // keep all coarser tiles as placeholders
        }
        // Quantise bbox to 0.25° grid so floating-point raycaster jitter doesn't
        // change the stateKey every frame and trigger constant abort+requeue cycles.
        const q = 4; // 1/q degrees per quantum
        const stateKey = [
          level,
          Math.round(refinementBbox.lonMin * q),
          Math.round(refinementBbox.latMin * q),
          Math.round(refinementBbox.lonMax * q),
          Math.round(refinementBbox.latMax * q),
        ].join('|');
        // Zoom-relative large-area threshold: a 5.5° pan at level 9 (90° view) is
        // nothing; the same shift at level 14 (1° view) is the whole screen.
        // Scale threshold to 60% of the current view lon span, min 3.5°.
        const largeAreaChange = focusShiftDeg >= Math.max(3.5, viewLonSpan * 0.6);
        if (stateKey === this._lastStateKey) return; // nothing changed — skip all work
        this._lastStateKey = stateKey;
        // Do NOT increment _requestEpoch here. Epoch only flips on a full reset
        // (deactivate / zoom-out clear). Flipping it on every minor state change
        // caused tiles that took >50ms to download to have their epoch invalidated
        // mid-flight, so they destroyed their own mesh the moment it resolved —
        // making the second and subsequent zooms appear to load nothing.
        // _abortInflight(allKeys) already cancels fetches that are no longer
        // needed; the epoch check at the end of _fetch handles full-reset races.

        if (largeAreaChange) {
          this.queue = [];
          this.queued.clear();
          this._stagingQueue = [];
          this._staged.clear();
          this._abortInflight();
          this.inflight.clear();
          this._requestEpoch += 1;
          this._smoothedStageLevel = NaN; // new area: restart coarse→fine progression
          // Do NOT clear meshes here — existing tiles remain visible as the user
          // pans, giving seamless transitions. LRU eviction (_evict) handles
          // removing out-of-view tiles as the mesh budget fills up.
        }

        this.currentKeys = allKeys;
        this.queue = this.queue.filter((item) => allKeys.has(item.key));
        this.queued.clear();
        for (const item of this.queue) {
          this.queued.add(item.key);
        }
        this._abortInflight(allKeys);
        // ArcGIS-style memory management: spatial LRU eviction instead of
        // hard-pruning every non-current tile on each state change.
        // Tiles from recently visited areas stay alive until memory pressure
        // (meshes > maxMeshes) forces distance+age based eviction.
        this._evict(focusTarget);
        // Enqueue background tiles first — they appear immediately across the full
        // viewport while fine detail tiles load in the center.  Skip keys already
        // in desiredTiles so we don't double-enqueue (desiredTiles has higher-priority
        // entries for the same keys in the overlap zone).
        const nowMs = performance.now();
        for (const tile of backgroundTiles) {
          if (!desiredKeys.has(tile.key)) {
            this._enqueue(tile.level, tile.row, tile.col, (tile.priority?.dist2 || 0) * 0.01 - 150);
          }
          // Touch loaded background meshes so they are not evicted during the
          // loading gap when finer tiles are still in-flight.
          const bgMesh = this.meshes.get(tile.key);
          if (bgMesh) bgMesh.userData.lastUsed = nowMs;
        }
        // Enqueue fine detail tiles with priority that ensures coarse placeholder anchors
        // always load before their fine-level children (ArcGIS progressive refinement).
        // isAnchor tiles come from DFS nodes that split AND are retained as placeholders.
        for (const tile of desiredTiles) {
          const tilePriority = tile.isAnchor
            ? (tile.priority?.dist2 || 0) * 0.01 - 200  // placeholder: highest priority, spatial order preserved
            : (tile.priority?.dist2 || 0) + (tile.level - this.activationMinLevel) * 0.5; // fine tile: center-first, coarser before finer
          this._enqueue(tile.level, tile.row, tile.col, tilePriority);
          const key = tile.key;
          const mesh = this.meshes.get(key);
          if (mesh) mesh.userData.lastUsed = nowMs;
        }
        const simplifyVisibility = this.meshes.size > 120 && (performance.now() - this._lastMotionAt) < 200;
        this._syncMeshVisibility(camera, simplifyVisibility);
        const meshLevels = [...this.meshes.keys()].map((key) => Number(key.split('/')[0])).filter(Number.isFinite);
        // Diagnostic: sample the first desired tile — shows which tile the system wants
        // to load and whether it intersects the visible viewport.
        const _sampleTile = desiredTiles.length > 0 ? (() => {
          const t = desiredTiles[0];
          const tb = this._tileBounds(t.level, t.row, t.col);
          return {
            key: t.key,
            bounds: tb,
            intersectsView: this._tileIntersectsBbox(tb, view.bbox),
            isAnchor: Boolean(t.isAnchor),
          };
        })() : null;
        // Diagnostic: level distribution of already-loaded meshes
        const meshLevelDist = {};
        for (const key of this.meshes.keys()) {
          const lv = Number(key.split('/')[0]);
          meshLevelDist[lv] = (meshLevelDist[lv] || 0) + 1;
        }
        window.__ctxPatchDebug = {
          ...(window.__ctxPatchDebug || {}),
          active: true,
          gate: null,
          altitude: stage.altitude,
          focusTarget,
          level,
          desiredLevel: stage.desiredLevel,
          stageLevel: this._smoothedStageLevel,
          refinementBbox: { ...refinementBbox },
          microRefinementBbox: microRefinementBbox ? { ...microRefinementBbox } : null,
          microLevel,
          visibleBbox: { ...view.bbox },
          viewBboxHits: view.hits,
          viewTileCount: desiredTiles.length,
          bgTileCount: backgroundTiles.length,
          bgLevel,
          sampleTile: _sampleTile,
          meshCount: this.meshes.size,
          meshLevelDist,
          inflightCount: this.inflight.size,
          queueLength: this.queue.length,
          minMeshLevel: meshLevels.length ? Math.min(...meshLevels) : null,
          maxMeshLevel: meshLevels.length ? Math.max(...meshLevels) : null,
          focusShiftDeg: Number.isFinite(focusShiftDeg) ? focusShiftDeg : null,
          knownBlankCount: this._knownBlank.size,
          stagedCount: this._stagingQueue.length,
          requestEpoch: this._requestEpoch,
          epochInflight: [...this.inflight].slice(0, 6),
        };
        this._lastFocusTarget = focusTarget ? { lat: focusTarget.lat, lon: focusTarget.lon } : null;
        this._drain(true); // sort=true: priorities just updated, sort once here
      }
    }

    async function init() {
      const startup = window.__venusViewerStartup;
      if (startup && startup.checked && startup.criticalMissing.length > 0) {
        throw new Error(`Required files missing: ${startup.criticalMissing.join(", ")}`);
      }

      setStatus("Initializing viewer...");

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x02050b);

      const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
      camera.position.set(0, 1.4, 11.5);
      viewerCamera = camera;

      const renderer = createRenderer(THREE);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.localClippingEnabled = true;
      app.appendChild(renderer.domElement);

      const cutawayClipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
      activeCutClipPlane = cutawayClipPlane;

      const controls = new OrbitControls(camera, renderer.domElement);
      viewerControls = controls;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = DEFAULT_CONTROL_MIN_DISTANCE;
      controls.maxDistance = DEFAULT_CONTROL_MAX_DISTANCE;
      controls.enablePan = false;
      controls.rotateSpeed = 0.75;
      controls.zoomSpeed = 0.8;
      controls.enableZoom = false;
      if ("zoomToCursor" in controls) {
        controls.zoomToCursor = false;
      }
      applyFreezeViewState();

      const wheelZoomBodyCenter = new THREE.Vector3();
      const wheelZoomDirection = new THREE.Vector3();
      let lastSafeMosaicCameraPosition = camera.position.clone();
      // Minimum scale-bar value (metres) allowed while in CTX mosaic mode.
      // Below this the wheel-zoom guard blocks further zoom-in and the render-loop
      // guard snaps the camera back to lastSafeMosaicCameraPosition.
      // 10 km matches the old behaviour: CTX tiles only go up to level ~12 in
      // most areas so zooming past 10 km just floods the network with 404s.
      const CTX_MOSAIC_MIN_SCALEBAR_METERS = 10000;
      function getActiveZoomContext() {
        if (coreToggle.checked) return null;
        if (activeMoonViewerFeature) {
          const moonContext = getMoonMeasureContext(activeMoonViewerFeature);
          if (!moonContext) return null;
          const centerWorld = venusGroup.localToWorld(moonContext.centerLocal.clone());
          return {
            centerWorld,
            radiusWorld: moonContext.radiusWorld,
            minSurfaceDistance: 0.0005,
            maxSurfaceDistance: Math.max(0.05, controls.maxDistance - moonContext.radiusWorld),
          };
        }
        venusGroup.getWorldPosition(wheelZoomBodyCenter);
        const maxTerrainDisp = Math.max(0, getTerrainRelief());
        const ctxSurfaceMargin = (isStreamedBaseLayer(baseLayerSelect.value)) ? 0.0005 : 0.092;
        const terrainFloor = 3.2 + maxTerrainDisp + ctxSurfaceMargin;
        const baseMin = (isStreamedBaseLayer(baseLayerSelect.value)) ? 3.20002 : DEFAULT_CONTROL_MIN_DISTANCE;
        const safeMin = Math.max(baseMin, terrainFloor);
        return {
          centerWorld: wheelZoomBodyCenter.clone(),
          radiusWorld: 3.2,
          minSurfaceDistance: Math.max(0.00002, safeMin - 3.2),
          maxSurfaceDistance: Math.max(0.5, controls.maxDistance - 3.2),
        };
      }

      function enforceActiveZoomFloor(zoomContext = getActiveZoomContext()) {
        if (!zoomContext) {
          return;
        }
        wheelZoomDirection.copy(camera.position).sub(zoomContext.centerWorld);
        const centerDistance = wheelZoomDirection.length();
        if (!(centerDistance > 0)) {
          return;
        }
        const minCenterDistance = zoomContext.radiusWorld + zoomContext.minSurfaceDistance;
        if (centerDistance < minCenterDistance) {
          wheelZoomDirection.normalize().multiplyScalar(minCenterDistance);
          camera.position.copy(zoomContext.centerWorld).add(wheelZoomDirection);
          controls.object.position.copy(camera.position);
        }
      }

      function estimateScaleBarMetersForCameraPosition(position, bodyMesh = globe, bodyRadiusMeters = VENUS_RADIUS_METERS, bodyRadiusScene = 3.2) {
        if (!position || !bodyMesh) {
          return null;
        }
        const originalPosition = camera.position.clone();
        camera.position.copy(position);
        const scaleEstimate = estimateBodyMapScale(camera, bodyMesh, bodyRadiusMeters, bodyRadiusScene);
        camera.position.copy(originalPosition);
        if (!scaleEstimate) {
          return null;
        }
        return chooseNiceScaleDistance(scaleEstimate.metersPerPixel, 132);
      }

      function handleSurfaceWheelZoom(event) {
        if (freezeViewActive) {
          return;
        }
        const zoomContext = getActiveZoomContext();
        if (!zoomContext) return;
        const ctxMode = isStreamedBaseLayer(baseLayerSelect.value);
        const moonViewerMode = Boolean(activeMoonViewerFeature);
        const delta = Number(event.deltaY || 0);
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) return;
        event.preventDefault();

        wheelZoomDirection.copy(camera.position).sub(zoomContext.centerWorld);
        const centerDistance = wheelZoomDirection.length();
        if (!(centerDistance > 0)) return;
        const surfaceDistance = Math.max(0.00001, centerDistance - zoomContext.radiusWorld);
        const normalizedDelta = clamp(Math.abs(delta) / 120, moonViewerMode ? 0.65 : 0.4, 6);
        const distanceT = clamp(surfaceDistance / (moonViewerMode ? 0.55 : 1.5), 0, 1);
        const stepStrength = THREE.MathUtils.lerp(
          moonViewerMode ? 0.085 : 0.035,
          moonViewerMode ? 0.3 : 0.20,
          distanceT,
        ) * normalizedDelta;
        const zoomFactor = Math.exp(Math.sign(delta) * stepStrength);
        let nextSurfaceDistance = clamp(
          surfaceDistance * zoomFactor,
          zoomContext.minSurfaceDistance,
          zoomContext.maxSurfaceDistance,
        );
        if (ctxMode && delta < 0) {
          const maxStepInFraction = THREE.MathUtils.lerp(0.18, 0.32, distanceT);
          const minStepSurfaceDistance = Math.max(
            zoomContext.minSurfaceDistance,
            surfaceDistance * (1 - maxStepInFraction),
          );
          nextSurfaceDistance = Math.max(nextSurfaceDistance, minStepSurfaceDistance);
        }
        const nextCenterDistance = zoomContext.radiusWorld + nextSurfaceDistance;
        wheelZoomDirection.normalize().multiplyScalar(nextCenterDistance);
        const nextPosition = zoomContext.centerWorld.clone().add(wheelZoomDirection);
        const nextScaleBarMeters = ctxMode
          ? estimateScaleBarMetersForCameraPosition(nextPosition)
          : null;
        if (ctxMode && Number.isFinite(nextScaleBarMeters) && nextScaleBarMeters < CTX_MOSAIC_MIN_SCALEBAR_METERS) {
          return;
        }
        camera.position.copy(nextPosition);
        if (ctxMode && (!Number.isFinite(nextScaleBarMeters) || nextScaleBarMeters >= CTX_MOSAIC_MIN_SCALEBAR_METERS)) {
          lastSafeMosaicCameraPosition.copy(camera.position);
        }
        controls.update();
        enforceActiveZoomFloor(zoomContext);
      }
      renderer.domElement.addEventListener("wheel", handleSurfaceWheelZoom, { passive: false });

      // Touch pinch-to-zoom — feeds into the same zoom logic as the mouse wheel
      {
        let _pinchDist = null;
        // Pinch zoom must run non-passively so we can preventDefault on the
        // 2-finger touchmove. Without it the browser also performs a native
        // pinch-zoom on the page, producing the "two zooms fighting" bug on
        // mobile. CSS adds `touch-action: none` on the canvas as a backstop.
        renderer.domElement.addEventListener("touchstart", (e) => {
          if (e.touches.length === 2) {
            _pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            e.preventDefault();
          } else {
            _pinchDist = null;
          }
        }, { passive: false });
        renderer.domElement.addEventListener("touchmove", (e) => {
          if (e.touches.length !== 2) return;
          e.preventDefault();
          if (_pinchDist === null) {
            _pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            return;
          }
          const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
          const delta = (_pinchDist - dist) * 2.2;
          if (Math.abs(delta) > 0.5) {
            handleSurfaceWheelZoom({ deltaY: delta, preventDefault: () => {} });
            _pinchDist = dist;
          }
        }, { passive: false });
        renderer.domElement.addEventListener("touchend", () => { _pinchDist = null; }, { passive: true });
      }

      scene.add(new THREE.AmbientLight(0xbfd0ff, 0.85));

      const keyLight = new THREE.DirectionalLight(0xffdfbf, 1.9);
      keyLight.position.set(8, 4, 6);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x7aa6ff, 0.55);
      rimLight.position.set(-8, -2, -6);
      scene.add(rimLight);

      const venusGroup = new THREE.Group();
      venusSceneGroup = venusGroup;
      scene.add(venusGroup);
      // Bridge measurement reset to module scope so deactivate/activateMoonViewer can call it.
      _resetMeasurementOnContextSwitch = (preserveMode) => {
        if (typeof resetActiveMeasurement === "function") resetActiveMeasurement(preserveMode);
      };
      scene.add(buildStarfield(THREE));
      scene.add(buildSunObject());

      setStatus("Loading Venus textures...");
      const textureLoader = new THREE.TextureLoader();
      const geologyFeaturePromise = loadJsonSafe(manifest.geology_interactive ? manifest.geology_interactive.feature_path : "");
      let geologyInteractiveState = null;
      const layerTextures = new Map();
      const baseLayers = manifest.layers || [{
        id: "venus-surface",
        label: "Venus basemap",
        path: manifest.texture.path,
        description: "Venus global basemap.",
      }];
      // Phase 1: load only the default base layer — non-default layers load in background.
      const baseTextureResults = await Promise.all(
        baseLayers.map((layer) => layer.default ? loadTextureSafe(textureLoader, layer.path) : Promise.resolve(null)),
      );
      const moonTextures = new Map(); // populated in background after first render
      for (let index = 0; index < baseLayers.length; index += 1) {
        const texture = baseTextureResults[index]
          ? applyTextureTransforms(baseTextureResults[index], baseLayers[index])
          : null;
        if (texture) {
          texture.colorSpace = THREE.SRGBColorSpace;
        }
        layerTextures.set(baseLayers[index].id, texture);
      }

      const geologyLayers = manifest.geology_layers || [{
        id: "sim3292-units",
        label: "USGS, Geologic Map of Venus",
        path: manifest.geology.path,
        description: "USGS, Geologic Map of Venus geology overlay sourced from Scientific Investigations Map 3292.",
        default: true,
      }];
      const mineralLayers = manifest.mineral_layers || [];
      const geologyTextures = new Map();
      const mineralTextures = new Map();
      const mineralSamplerStates = new Map();
      const SC_LAYERS = [];
      baseLayers.push(...SC_LAYERS);
      // SC layers are not shown on first render — initialise as null, load in background.
      for (const layer of SC_LAYERS) {
        layerTextures.set(layer.id, null);
      }

      setStatus("Loading map services...");
      const ctxServiceConfig = await loadCtxServiceConfig();

      // ---- CTX Mosaic tile service ----
      // CTX lives on the displaced globe through a shared canvas texture, so terrain
      // deformation, geology overlays, and selection outlines all stay in one render path.
      const ctxStreamer = new CTXCanvasLayer(layerTextures.get("venus-surface") || null, ctxServiceConfig);
      const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
      ctxStreamer.texture.anisotropy = maxAnisotropy;
      ctxStreamer.focusTexture.anisotropy = maxAnisotropy;
      ctxStreamer.texture.needsUpdate = true;
      ctxStreamer.focusTexture.needsUpdate = true;
      const ctxMapName = ctxServiceConfig.metadata?.mapName || "CTX";
      const ctxDescription = ctxServiceConfig.metadata?.description
        ? `${ctxMapName} mosaic streamed from the live Esri ArcGIS tile service.`
        : "Murray Lab CTX global mosaic streamed from the live Esri ArcGIS tile service.";
      const CTX_LAYER = {
        id: "ctx-mosaic",
        label: "CTX Mosaic",
        tileServiceUrl: ctxServiceConfig.tileBase,
        description: ctxDescription,
        source_page_url: ctxServiceConfig.sourceServiceUrl || ctxServiceConfig.serviceUrl,
      };
      const CTX_COLOR_LAYER = {
        id: "ctx-mosaic-color",
        label: "CTX Mosaic (Color) ★",
        tileServiceUrl: ctxServiceConfig.tileBase,
        description: `${ctxDescription} Colorized with Viking global mosaic.`,
        source_page_url: ctxServiceConfig.sourceServiceUrl || ctxServiceConfig.serviceUrl,
      };
      // CTX tile service not available for this planet
      // baseLayers.unshift(CTX_LAYER);
      // baseLayers.unshift(CTX_COLOR_LAYER);
      layerTextures.set("ctx-mosaic", ctxStreamer.texture);
      layerTextures.set("ctx-mosaic-color", layerTextures.get("venus-surface") || null);

      setStatus("Preparing terrain layers...");
      // Phase 1: elevation + default geology only. Minerals and non-default geology load in background.
      const [elevationMap, ...overlayMaps] = await Promise.all([
        loadTextureSafe(textureLoader, manifest.elevation.path),
        ...geologyLayers.map((layer) => layer.default ? loadTextureSafe(textureLoader, layer.path) : Promise.resolve(null)),
        ...mineralLayers.map(() => Promise.resolve(null)),
      ]);
      for (let index = 0; index < geologyLayers.length; index += 1) {
        const texture = applyTextureTransforms(overlayMaps[index], geologyLayers[index]);
        if (texture) {
          texture.colorSpace = THREE.SRGBColorSpace;
        }
        geologyTextures.set(geologyLayers[index].id, texture);
      }
      for (let index = 0; index < mineralLayers.length; index += 1) {
        const raw = overlayMaps[geologyLayers.length + index];
        if (raw) {
          raw.colorSpace = THREE.SRGBColorSpace;
        }
        const texture = raw ? processMineralTexture(raw) : null;
        mineralTextures.set(mineralLayers[index].id, texture);
        mineralSamplerStates.set(mineralLayers[index].id, createRasterSamplerState(texture));
      }

      if (elevationMap) {
        elevationMap.colorSpace = THREE.NoColorSpace;
        const ELEVATION_DEM_LAYER = {
          id: "elevation-dem",
          label: "Elevation DEM",
          description: "Venus global elevation raster (DEM) shown directly as the basemap.",
        };
        baseLayers.push(ELEVATION_DEM_LAYER);
        layerTextures.set(ELEVATION_DEM_LAYER.id, elevationMap);
      }
      const elevationSampler = createElevationSamplerState(elevationMap);
      // createSeaOverlayTextureState reads elevationMap.image pixel data — must be called before
      // we null the image below. Pass elevationSampler so it shares the already-decoded pixel
      // array rather than allocating a second identical ~33 MB Uint8ClampedArray.
      const _earlySeaOverlayState = createSeaOverlayTextureState(elevationMap, elevationSampler);
      // Upload to GPU first, then free the decoded bitmap (~32 MB renderer memory).
      // version=0 permanently exits the re-upload condition `version > 0 && __version !== version`
      // so Three.js never attempts to re-upload a null-image texture.
      if (elevationMap) {
        renderer.initTexture(elevationMap);
        if (elevationMap.image) elevationMap.image = null;
        elevationMap.version = 0;
      }
      const getRequestedTerrainRelief = () => elevationMap ? Number(terrainScale.value) : 0;
      // On the streamed basemap the globe's own displacement is normally
      // zeroed (relief comes from the tile pipeline) — but NOT in flight,
      // where the sim drives the relief slider and vertical exaggeration.
      // Mars's version has carried this exemption since the flight sim
      // shipped; the forks predate it, so un-gating the streamed layer
      // silently killed fs-vex (fs.forceRelief covers the engage transition
      // before active flips).
      const getEffectiveTerrainRelief = () => {
        if (!elevationMap) return 0;
        if (isStreamedBaseLayer(baseLayerSelect?.value)
            && !(window.__flightSim?.active || window.__flightSim?.forceRelief)) return 0;
        return getRequestedTerrainRelief();
      };
      const getTerrainRelief = () => getEffectiveTerrainRelief();
      const labelElevationCache = new Map();
      const popupElevationCache = new Map();
      const HIDDEN_BASE_LAYER_IDS = new Set(["sc-magnetic", "derived-slope"]);
      const TERRAIN_PICKER_SLOPE_LAYER_ID = "sc-slope";
      const selectableBaseLayers = baseLayers.filter((l) => !HIDDEN_BASE_LAYER_IDS.has(l.id));
      const standardLayers = selectableBaseLayers.filter((l) => !l.scGroup);
      // Group standard layers into labelled optgroups
      const BASE_LAYER_GROUPS = [
        { label: "Imagery",          ids: ["venus-surface"] },
        { label: "Thermal & Albedo", ids: ["tes-albedo", "tes-thermal-inertia"] },
        { label: "Terrain",          ids: ["elevation-dem", "derived-hillshade", TERRAIN_PICKER_SLOPE_LAYER_ID] },
      ];
      const assignedIds = new Set(BASE_LAYER_GROUPS.flatMap((g) => g.ids));
      // Any layers not in a group go in first as ungrouped options
      for (const layer of standardLayers.filter((l) => !assignedIds.has(l.id))) {
        const option = document.createElement("option");
        option.value = layer.id;
        option.textContent = layer.label;
        baseLayerSelect.appendChild(option);
      }
      for (const group of BASE_LAYER_GROUPS) {
        const groupLayers = group.ids.map((id) => selectableBaseLayers.find((l) => l.id === id)).filter(Boolean);
        if (!groupLayers.length) continue;
        const optgroup = document.createElement("optgroup");
        optgroup.label = group.label;
        for (const layer of groupLayers) {
          const option = document.createElement("option");
          option.value = layer.id;
          option.textContent = layer.label;
          optgroup.appendChild(option);
        }
        baseLayerSelect.appendChild(optgroup);
      }
      const scSelectableLayers = SC_LAYERS.filter((layer) => (
        !HIDDEN_BASE_LAYER_IDS.has(layer.id)
        && layer.id !== TERRAIN_PICKER_SLOPE_LAYER_ID
      ));
      const scGroupNames = [...new Set(scSelectableLayers.map((l) => l.scGroup))];
      for (const groupName of scGroupNames) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = groupName;
        for (const layer of scSelectableLayers.filter((l) => l.scGroup === groupName)) {
          const option = document.createElement("option");
          option.value = layer.id;
          option.textContent = layer.label;
          optgroup.appendChild(option);
        }
        baseLayerSelect.appendChild(optgroup);
      }
      function getLayerTextureById(layerId) {
        if (!layerId) {
          return null;
        }
        if (layerId === "derived-hillshade") {
          return dynamicHillshadeTexture ||= createHillshadeTexture(
            elevationSampler,
            Number(hillshadeAzimuth?.value || 315),
            Number(hillshadeAltitude?.value || 45),
          );
        }
        return layerTextures.get(layerId) || null;
      }

      function populateCompareLayerOptions() {
        if (!gisCompareLayerSelect) {
          return;
        }
        const previousValue = gisCompareLayerSelect.value;
        gisCompareLayerSelect.innerHTML = "";
        const none = document.createElement("option");
        none.value = "";
        none.textContent = "None";
        gisCompareLayerSelect.appendChild(none);
        for (const layer of baseLayers.filter((entry) => !HIDDEN_BASE_LAYER_IDS.has(entry.id))) {
          const option = document.createElement("option");
          option.value = layer.id;
          option.textContent = layer.label;
          gisCompareLayerSelect.appendChild(option);
        }
        gisCompareLayerSelect.value = baseLayers.some((layer) => layer.id === previousValue) ? previousValue : "";
      }

      function syncCompareOverlay() {
        if (!compareGlobe || !compareMaterial || !gisCompareLayerSelect || !gisCompareModeSelect) {
          return;
        }
        const compareLayerId = gisCompareLayerSelect.value;
        const compareTexture = getLayerTextureById(compareLayerId);
        const baseTexture = getLayerTextureById(baseLayerSelect.value);
        const hasCompare = Boolean(compareLayerId && compareTexture);
        compareMaterial.map = compareTexture || null;
        compareMaterial.needsUpdate = true;
        if (compareShader) {
          compareShader.uniforms.uBaseMap.value = baseTexture || compareTexture || null;
          compareShader.uniforms.uCompareMode.value = GIS_COMPARE_MODES[gisCompareModeSelect.value] ?? GIS_COMPARE_MODES.overlay;
          compareShader.uniforms.uCompareStrength.value = Number(gisCompareOpacity?.value || 0.72);
          compareShader.uniforms.uCompareSwipe.value = Number(gisCompareSwipe?.value || 0.5);
          compareShader.uniforms.uViewportWidth.value = renderer.domElement.clientWidth || window.innerWidth || 1;
        }
        if (gisCompareSwipeRow) {
          gisCompareSwipeRow.hidden = gisCompareModeSelect.value !== "swipe";
        }
        compareGlobe.visible = hasCompare && !coreToggle.checked;
      }

      populateCompareLayerOptions();
      const noneOption = document.createElement("option");
      noneOption.value = "";
      noneOption.textContent = "None";
      mineralSelect.appendChild(noneOption);
      for (const layer of mineralLayers) {
        const option = document.createElement("option");
        option.value = layer.id;
        option.textContent = layer.label;
        mineralSelect.appendChild(option);
      }
      const initialLayer = baseLayers.find((layer) => layer.id === "venus-surface")
        || baseLayers.find((layer) => layer.default)
        || baseLayers[0];
      baseLayerSelect.value = initialLayer.id;
      const initialGeologyLayer = geologyLayers.find((layer) => layer.default) || geologyLayers[0];
      mineralSelect.value = "";
      const seaLevelMaxMeters = 0;
      const rawElevMinMeters = Number(manifest.elevation?.min_m ?? -2886);
      const elevationMinMeters = Math.floor(rawElevMinMeters / 25) * 25;
      seaLevelSlider.min = String(elevationMinMeters);
      seaLevelSlider.max = String(seaLevelMaxMeters);
      seaLevelSlider.value = String(clamp(Number(seaLevelSlider.value), elevationMinMeters, seaLevelMaxMeters));
      if (seaLevelMin) seaLevelMin.textContent = `−${Math.abs(rawElevMinMeters).toLocaleString()} m`;
      syncSeaLevelAxisValue();

      const planetConfig = manifest.planet || {};
      const sphereGeometry = new THREE.SphereGeometry(3.2, 128, 128);
      const initialBaseTexture = layerTextures.get(initialLayer.id) || null;

      const baseMaterial = new THREE.MeshStandardMaterial({
        color: initialBaseTexture ? 0xffffff : 0xd0b18a,
        map: initialBaseTexture,
        displacementMap: elevationMap || null,
        displacementScale: elevationMap ? Number(terrainScale.value) : 0,
        bumpMap: elevationMap || null,
        bumpScale: elevationMap ? 0.08 : 0,
        roughness: 1,
        metalness: 0,
      });
      baseMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uContourMap = { value: null };
        shader.uniforms.uContourOpacity = { value: Number(contourOpacity?.value || 0.62) };
        shader.uniforms.uContourEnabled = { value: 0 };
        shader.uniforms.uContourTexel = { value: new THREE.Vector2(1 / 4096, 1 / 2048) };
        shader.uniforms.uContourThickness = { value: 1.15 };
        shader.uniforms.uContourInterval = { value: 0 };
        shader.uniforms.uContourMinMeters = { value: Number(manifest.elevation?.min_m ?? -2886) };
        shader.uniforms.uContourReliefMeters = { value: Math.max(Number(manifest.elevation?.relief_m ?? 1), 1) };
        baseMaterial.userData.contourShader = shader;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nuniform sampler2D uContourMap;\nuniform float uContourOpacity;\nuniform float uContourEnabled;\nuniform vec2 uContourTexel;\nuniform float uContourThickness;\nuniform float uContourInterval;\nuniform float uContourMinMeters;\nuniform float uContourReliefMeters;",
          )
          .replace(
            "#include <map_fragment>",
            `#include <map_fragment>
            if (uContourEnabled > 0.5) {
              vec2 contourOffset = uContourTexel * uContourThickness;
              vec2 contourUv = vec2(fract(vMapUv.x), 1.0 - clamp(vMapUv.y, 0.0, 1.0));
              float contourMask = 0.0;
              vec2 contourSamples[5];
              contourSamples[0] = contourUv;
              contourSamples[1] = vec2(fract(contourUv.x - contourOffset.x), contourUv.y);
              contourSamples[2] = vec2(fract(contourUv.x + contourOffset.x), contourUv.y);
              contourSamples[3] = vec2(fract(contourUv.x), clamp(contourUv.y - contourOffset.y, 0.0, 1.0));
              contourSamples[4] = vec2(fract(contourUv.x), clamp(contourUv.y + contourOffset.y, 0.0, 1.0));
              for (int i = 0; i < 5; i++) {
                float elev01 = texture2D(uContourMap, contourSamples[i]).r;
                float elevMeters = uContourMinMeters + elev01 * uContourReliefMeters;
                float contourFrac = fract((elevMeters - uContourMinMeters) / max(uContourInterval, 1.0));
                float contourDist = min(contourFrac, 1.0 - contourFrac);
                contourMask = max(contourMask, 1.0 - smoothstep(0.0, 0.06, contourDist));
              }
              float contourAlpha = contourMask * uContourOpacity;
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 0.98), contourAlpha);
            }`,
          );
      };
      baseMaterial.needsUpdate = true;

      const globe = new THREE.Mesh(sphereGeometry, baseMaterial);

      // -- GeoID GIS seam ------------------------------------------------
      // The same contract earth-viewer.js exposes, so the shared gis/ modules
      // work here without knowing which world they are on. Kept to references
      // the viewer already has rather than new machinery: this file is not the
      // place to grow behaviour.
      window.GeoIDViewer = Object.assign(window.GeoIDViewer || {}, {
        bodyId: "venus",
        scene, camera, renderer, controls, globe,
        // The object carrying this planet's tilt and spin. Named per lineage;
        // gis/bodies.js records which name belongs to which world.
        earthSceneGroup: venusGroup,
        elevationSampler,
        manifest,
        GLOBE_RADIUS: 3.2,
        latLonToVector3,
        // Simulated-UTC spin is an Earth idea. These worlds turn on their own
        // clocks, and the shared modules only need the angle to be truthful,
        // so the planet group's own rotation is the answer.
        getSpinDeltaRadians: () => (venusGroup ? venusGroup.rotation.y : 0),
        // One-shot "click a point on the globe", so a Research form can be
        // filled by pointing. Raycasts a sphere at the globe radius and maps the
        // hit into the body-fixed frame (undo the group tilt/spin, then the
        // globe's half-turn) with the viewer's own vectorToLatLon -- the same
        // inverse the cursor readout uses. Resolves { lat, lon } in this world's
        // own longitude convention; Escape rejects.
        pickOnGlobe: () => new Promise((resolve, reject) => {
          const canvas = renderer.domElement;
          const previousCursor = canvas.style.cursor;
          canvas.style.cursor = "crosshair";
          const raycaster = new THREE.Raycaster();
          const pickSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 3.2);
          const hitWorld = new THREE.Vector3();
          const finish = () => {
            canvas.removeEventListener("pointerdown", onDown, true);
            document.removeEventListener("keydown", onKey, true);
            canvas.style.cursor = previousCursor;
          };
          const onDown = (event) => {
            const rect = canvas.getBoundingClientRect();
            const ndc = new THREE.Vector2(
              ((event.clientX - rect.left) / rect.width) * 2 - 1,
              -((event.clientY - rect.top) / rect.height) * 2 + 1);
            raycaster.setFromCamera(ndc, camera);
            if (!raycaster.ray.intersectSphere(pickSphere, hitWorld)) return;
            const localPoint = venusGroup.worldToLocal(hitWorld.clone());
            localPoint.applyEuler(new THREE.Euler(0, -(globe.rotation.y - Math.PI), 0));
            const latLon = vectorToLatLon(localPoint);
            event.preventDefault();
            event.stopPropagation();
            finish();
            resolve({ lat: latLon.lat, lon: latLon.lon });
          };
          const onKey = (event) => {
            if (event.key === "Escape") { finish(); reject(new Error("Pick cancelled.")); }
          };
          canvas.addEventListener("pointerdown", onDown, true);
          document.addEventListener("keydown", onKey, true);
        }),
      });
      document.body.dataset.body = "venus";
      globe.rotation.y = Math.PI;
      venusGroup.add(globe);
      venusGlobeRef = globe;
      locatorViewState.camera = camera;
      locatorViewState.venusGroup = venusGroup;
      locatorViewState.globe = globe;
      let dynamicHillshadeTexture = null;
      const contourTextureCache = new Map();
      const contourMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: null,
        displacementMap: elevationMap || null,
        displacementScale: elevationMap ? Number(terrainScale.value) : 0,
        alphaMap: null,
        alphaTest: 0.18,
        transparent: true,
        opacity: Number(contourOpacity?.value || 0.62),
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        roughness: 1,
        metalness: 0,
      });
      // Use the same sphere geometry as the base globe so contour UVs and
      // displacement stay locked to the exact relief surface.
      const contourGlobe = new THREE.Mesh(
        sphereGeometry.clone(),
        contourMaterial,
      );
      contourGlobe.rotation.y = Math.PI;
      contourGlobe.visible = false;
      contourGlobe.renderOrder = 6;
      venusGroup.add(contourGlobe);
      const contourLineLayer = createContourLineLayer(
        THREE,
        venusGroup,
        elevationSampler,
        getEffectiveTerrainRelief,
        3.2,
      );
      contourLineLayer.group.rotation.y = 0;
      const compareMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: null,
        displacementMap: elevationMap || null,
        displacementScale: elevationMap ? Number(terrainScale.value) : 0,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
        roughness: 1,
        metalness: 0,
      });
      let compareShader = null;
      compareMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uBaseMap = { value: initialBaseTexture };
        shader.uniforms.uCompareMode = { value: GIS_COMPARE_MODES.overlay };
        shader.uniforms.uCompareStrength = { value: Number(gisCompareOpacity?.value || 0.72) };
        shader.uniforms.uCompareSwipe = { value: Number(gisCompareSwipe?.value || 0.5) };
        shader.uniforms.uViewportWidth = { value: renderer.domElement.clientWidth || window.innerWidth || 1 };
        compareShader = shader;
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
uniform sampler2D uBaseMap;
uniform float uCompareMode;
uniform float uCompareStrength;
uniform float uCompareSwipe;
uniform float uViewportWidth;`,
          )
          .replace(
            "#include <map_fragment>",
            `#include <map_fragment>
            vec4 compareSample = diffuseColor;
            vec3 baseRgb = texture2D(uBaseMap, vMapUv).rgb;
            float isDifference = step(0.5, uCompareMode) * (1.0 - step(1.5, uCompareMode));
            float isSwipe = step(1.5, uCompareMode);
            float swipeMask = 1.0 - step(uCompareSwipe, gl_FragCoord.x / max(uViewportWidth, 1.0));
            vec3 overlayRgb = compareSample.rgb;
            vec3 differenceRgb = abs(compareSample.rgb - baseRgb);
            diffuseColor.rgb = mix(overlayRgb, differenceRgb, isDifference);
            diffuseColor.a *= mix(uCompareStrength, uCompareStrength * swipeMask, isSwipe);`,
          );
      };
      compareMaterial.needsUpdate = true;
      const compareGlobe = new THREE.Mesh(
        new THREE.SphereGeometry(3.207, 128, 128),
        compareMaterial,
      );
      compareGlobe.rotation.y = Math.PI;
      compareGlobe.visible = false;
      compareGlobe.renderOrder = 5;
      venusGroup.add(compareGlobe);
      ctxStreamer._globe = globe; // used in _computeViewBbox to correctly invert globe rotation

      const ctxFocusMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: ctxStreamer.focusTexture,
        displacementMap: elevationMap || null,
        displacementScale: elevationMap ? Number(terrainScale.value) : 0,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        roughness: 1,
        metalness: 0,
      });
      ctxFocusMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uCtxBounds = { value: ctxStreamer.focusBounds };
        shader.uniforms.uCtxColorMap = { value: null };
        shader.uniforms.uCtxColorMix = { value: 0 };
        shader.uniforms.uCtxColorLift = { value: 1.0 };
        shader.uniforms.uContourMap = { value: null };
        shader.uniforms.uContourOpacity = { value: Number(contourOpacity?.value || 0.62) };
        shader.uniforms.uContourEnabled = { value: 0 };
        shader.uniforms.uContourTexel = { value: new THREE.Vector2(1 / 4096, 1 / 2048) };
        shader.uniforms.uContourThickness = { value: 1.15 };
        shader.uniforms.uContourInterval = { value: 0 };
        shader.uniforms.uContourMinMeters = { value: Number(manifest.elevation?.min_m ?? -2886) };
        shader.uniforms.uContourReliefMeters = { value: Math.max(Number(manifest.elevation?.relief_m ?? 1), 1) };
        ctxFocusMaterial.userData.ctxShader = shader;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec2 vCtxUvRaw;")
          .replace("#include <uv_vertex>", "#include <uv_vertex>\nvCtxUvRaw = uv;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nuniform vec4 uCtxBounds;\nuniform sampler2D uCtxColorMap;\nuniform float uCtxColorMix;\nuniform float uCtxColorLift;\nuniform sampler2D uContourMap;\nuniform float uContourOpacity;\nuniform float uContourEnabled;\nuniform vec2 uContourTexel;\nuniform float uContourThickness;\nuniform float uContourInterval;\nuniform float uContourMinMeters;\nuniform float uContourReliefMeters;\nvarying vec2 vCtxUvRaw;")
          .replace("#include <map_fragment>", `#include <map_fragment>
            float maskX = step(uCtxBounds.x, vCtxUvRaw.x) * (1.0 - step(uCtxBounds.y, vCtxUvRaw.x));
            float maskY = step(uCtxBounds.z, vCtxUvRaw.y) * (1.0 - step(uCtxBounds.w, vCtxUvRaw.y));
            diffuseColor.a *= (maskX * maskY);
            if (uCtxColorMix > 0.0) {
              vec3 baseColor = texture2D(uCtxColorMap, vCtxUvRaw).rgb;
              float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
              float detail = pow(clamp(luma, 0.0, 1.0), 0.6);
              float d = clamp(detail * 1.2 - 0.1, 0.0, 1.0);
              vec3 overlay = mix(
                2.0 * baseColor * d,
                1.0 - 2.0 * (1.0 - baseColor) * (1.0 - d),
                step(0.5, baseColor)
              );
              vec3 combined = mix(baseColor, overlay, 0.75);
              diffuseColor.rgb = mix(diffuseColor.rgb, combined, uCtxColorMix);
            }
            if (uContourEnabled > 0.5) {
              vec2 contourOffset = uContourTexel * uContourThickness;
              vec2 contourUv = vec2(fract(vCtxUvRaw.x), 1.0 - clamp(vCtxUvRaw.y, 0.0, 1.0));
              float contourMask = 0.0;
              vec2 contourSamples[5];
              contourSamples[0] = contourUv;
              contourSamples[1] = vec2(fract(contourUv.x - contourOffset.x), contourUv.y);
              contourSamples[2] = vec2(fract(contourUv.x + contourOffset.x), contourUv.y);
              contourSamples[3] = vec2(fract(contourUv.x), clamp(contourUv.y - contourOffset.y, 0.0, 1.0));
              contourSamples[4] = vec2(fract(contourUv.x), clamp(contourUv.y + contourOffset.y, 0.0, 1.0));
              for (int i = 0; i < 5; i++) {
                float elev01 = texture2D(uContourMap, contourSamples[i]).r;
                float elevMeters = uContourMinMeters + elev01 * uContourReliefMeters;
                float contourFrac = fract((elevMeters - uContourMinMeters) / max(uContourInterval, 1.0));
                float contourDist = min(contourFrac, 1.0 - contourFrac);
                contourMask = max(contourMask, 1.0 - smoothstep(0.0, 0.06, contourDist));
              }
              float contourAlpha = contourMask * uContourOpacity;
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 0.98), contourAlpha);
            }
            diffuseColor.rgb *= uCtxColorLift;
          `);
      };
      ctxFocusMaterial.needsUpdate = true;
      ctxStreamer._onFocusTextureChanged = (texture) => {
        texture.anisotropy = maxAnisotropy;
        ctxFocusMaterial.map = texture;
        ctxFocusMaterial.needsUpdate = true;
      };
      const ctxFocusGlobe = new THREE.Mesh(
        new THREE.SphereGeometry(3.201, 128, 128),
        ctxFocusMaterial,
      );
      ctxFocusGlobe.rotation.y = Math.PI;
      ctxFocusGlobe.visible = false;
      ctxFocusGlobe.renderOrder = 2;
      venusGroup.add(ctxFocusGlobe);
      const ctxDetailStreamer = new CTXDetailPatchStreamer(
        venusGroup,
        ctxStreamer.TILE_BASE,
        (level, row, col, minLevel, signal) => ctxStreamer._fetchTilePayloadWithFallback(level, row, col, minLevel, signal),
        (level, row, col) => ctxStreamer._getTileLevelCap(level, row, col),
        (cam) => ctxStreamer._computeViewBbox(cam),
        (cam) => ctxStreamer._computeFocusTarget(cam),
        elevationSampler,
        getTerrainRelief,
        maxAnisotropy,
      );
      // Hard-cap the detail streamer at level 14. Tiles at level 15+ no longer exist
      // in the CTX service; requesting them floods the network with 404 fallback chains
      // (15→14→13→12, 48 inflight) and freezes the UI at close zoom.
      ctxDetailStreamer.maxLevel = Math.min(ctxStreamer.FOCUS_MAX_LEVEL, 14);
      ctxDetailStreamer.activationMinLevel = Math.min(ctxDetailStreamer.activationMinLevel, ctxDetailStreamer.maxLevel);

      // ── CTX detail diagnostics helpers ───────────────────────────────────────
      // console.table(window.ctxDiag())  — snapshot of the streamer state
      // window.ctxForceUpdate()          — force a state refresh next frame
      window.ctxDiag = () => {
        const d = window.__ctxPatchDebug || {};
        const s = ctxDetailStreamer;
        return {
          '01 active':       d.active,
          '02 gate':         JSON.stringify(d.gate),
          '03 altitude':     d.altitude?.toFixed(4),
          '04 stageLevel':   d.stageLevel,
          '05 desiredLevel': d.desiredLevel,
          '06 meshCount':    d.meshCount,     // updated only on stateKey change
          '06b visibleMeshCount': d.visibleMeshCount, // updated every time a mesh is created
          '07 meshLevelDist': JSON.stringify(d.meshLevelDist),
          '08 inflightCount': d.inflightCount,
          '09 queueLength':  d.queueLength,
          '10 viewTileCount': d.viewTileCount,
          '10b bgTileCount':  d.bgTileCount,
          '10c bgLevel':      d.bgLevel,
          '11 sampleTile':   JSON.stringify(d.sampleTile),
          '12 visibleBbox':  JSON.stringify(d.visibleBbox),
          '13 focusTarget':  JSON.stringify(d.focusTarget),
          '14 refinementBbox': JSON.stringify(d.refinementBbox),
          '15 knownBlankCount': d.knownBlankCount,
          '15b stagedCount':   d.stagedCount,
          '15c requestEpoch':  d.requestEpoch,
          '16 epochInflight':  JSON.stringify(d.epochInflight),
          '_raw': d,
        };
      };
      window.ctxForceUpdate = () => { ctxDetailStreamer._lastStateKey = ''; };
      // ─────────────────────────────────────────────────────────────────────────

      const cutawayResult = buildCutawayInterior(
        3.2,
        CORE_LAYER_DATA,
        elevationMap,
        0,
      );
      const cutawayGroup = cutawayResult.group;
      venusGroup.add(cutawayGroup);
      const coreSelectionRing = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
      );
      coreSelectionRing.renderOrder = 203;
      coreSelectionRing.visible = false;
      cutawayResult.labelsGroup.add(coreSelectionRing);
      // Replace all inner-layer shader materials with solid opaque MeshStandardMaterial.
      // BackSide on curved half-spheres = concave inner surface only (no donut).
      // molecularBoundaryMesh is the outer convex fill — override it too so it's fully opaque.
      const VENUS_UPPER_FACE_MAT = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: layerTextures.get(baseLayerSelect.value) || null },
        },
        vertexShader: SECTION_FACE_VERT,
        fragmentShader: `
          varying vec2 vUv;
          uniform sampler2D uMap;
          void main(){
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            float x = sqrt(max(1.0 - min(r * r, 1.0), 0.0));
            vec3 spherePoint = normalize(vec3(x, -p.y, p.x));
            float lon = atan(spherePoint.z, spherePoint.x);
            float lat = asin(clamp(spherePoint.y, -1.0, 1.0));
            vec2 sampleUv = vec2(0.5 + lon / (6.28318530718), 0.5 - lat / 3.14159265359);
            vec3 texCol = texture2D(uMap, sampleUv).rgb;
            vec3 rockDark = vec3(0.55, 0.50, 0.44);
            vec3 rockLight = vec3(0.72, 0.67, 0.60);
            vec3 rimFade = vec3(0.30, 0.28, 0.25);
            float brightMask = smoothstep(0.20, 0.70, texCol.r * 0.85 + texCol.g * 0.65 - texCol.b * 0.10);
            vec3 toned = mix(texCol, rockDark, 0.45);
            toned = pow(max(toned, vec3(0.0)), vec3(0.90));
            toned = mix(toned, rockLight, brightMask * 0.18);
            float rim = smoothstep(0.72, 0.99, r);
            vec3 col = mix(toned, rimFade, rim * 0.30);
            col *= vec3(1.00, 0.97, 0.92);
            col *= 1.0 - smoothstep(0.94, 1.02, r) * 0.04;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      if (cutawayResult.crustRing) cutawayResult.crustRing.material = VENUS_UPPER_FACE_MAT;
      const venusSolidInterior = buildMarsSolidInterior(3.2);
      const venusSolidInteriorGroup = venusSolidInterior.group;
      venusGroup.add(venusSolidInteriorGroup);
      const venusInteriorSphereMaterials = [
        venusSolidInterior.metallicHydrogenMaterial,
        venusSolidInterior.heavyElementCoreMaterial,
      ].filter(Boolean);
      const venusInteriorCapMaterials = [
        venusSolidInterior.metallicHydrogenCapMaterial,
        venusSolidInterior.heavyElementCoreCapMaterial,
      ].filter(Boolean);
      const planetBodyScaleY = Number(planetConfig.body_scale_y ?? 1.0);
      const planetAxialTiltDeg = Number(planetConfig.axial_tilt_deg ?? 0.0);
      venusGroup.scale.set(1, planetBodyScaleY, 1);
      applyPlanetViewMode = function applyPlanetViewModeImpl(mode = "tilted", resetCamera = false) {
        const tiltRad = mode === "untilted"
          ? 0
          : THREE.MathUtils.degToRad(planetAxialTiltDeg);
        venusGroup.rotation.z = tiltRad;
        cutawayClipPlane.normal.set(Math.cos(tiltRad), Math.sin(tiltRad), 0).normalize();
        cutawayClipPlane.constant = 0;
        if (resetCamera) {
          camera.position.set(0, 1.4, 11.5);
          controls.target.set(0, 0, 0);
          controls.update();
        }
      };
      applyPlanetViewMode(saturnViewModeSelect ? saturnViewModeSelect.value : "tilted");

      const GIS_BOOKMARK_STORAGE_KEY = "mars-gis-bookmarks-v1";
      const GIS_STUDY_AREA_STORAGE_KEY = "mars-gis-study-areas-v1";
      const GIS_BUFFER_STORAGE_KEY = "mars-gis-buffers-v1";
      const GIS_BASE_STORAGE_KEY = "mars-gis-bases-v1";
      const GIS_STORAGE_KEYS = [
        GIS_BOOKMARK_STORAGE_KEY,
        GIS_STUDY_AREA_STORAGE_KEY,
        GIS_BUFFER_STORAGE_KEY,
        GIS_BASE_STORAGE_KEY,
      ];
      const gisSessionState = new Map();
      try {
        for (const storageKey of GIS_STORAGE_KEYS) {
          window.localStorage.removeItem(storageKey);
        }
      } catch (_) {}

      const initialGisBases = loadGisBases();
      await Promise.race([
        document.fonts.ready.catch(() => undefined),
        new Promise((resolve) => window.setTimeout(resolve, 1500)),
      ]);
      const labelLayer = buildLabelLayer(3.2, elevationSampler, labelElevationCache, getTerrainRelief, getReliefPoint, labelData);
      labelLayer.group.visible = true;
      venusGroup.add(labelLayer.group);
      let baseSiteLayer = buildBaseSiteLayer(initialGisBases, 3.2, elevationSampler, labelElevationCache, getTerrainRelief);
      baseSiteLayer.group.visible = true;
      venusGroup.add(baseSiteLayer.group);
      const selectionRing = new THREE.Mesh(
        new THREE.SphereGeometry(0.036, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
      );
      selectionRing.renderOrder = 203;
      selectionRing.visible = false;
      labelLayer.group.add(selectionRing);
      moonLayer = buildMoonLayer(moonTextures, moonData, MOON_ORBIT_ECCENTRICITY);
      moonLayer.group.visible = true;
      venusGroup.add(moonLayer.group);
      const moonFeatureLabelLayer = buildMoonFeatureLabelLayer(moonData, moonFeatureData);
      moonFeatureLabelLayer.group.visible = true;
      venusGroup.add(moonFeatureLabelLayer.group);
      const moonSelectionRing = new THREE.Mesh(
        new THREE.SphereGeometry(0.0008, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
      );
      moonSelectionRing.renderOrder = 203;
      moonSelectionRing.visible = false;
      moonFeatureLabelLayer.group.add(moonSelectionRing);
      const moonSelectionCenterDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.00045, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
      );
      moonSelectionCenterDot.renderOrder = 204;
      moonSelectionCenterDot.visible = false;
      moonFeatureLabelLayer.group.add(moonSelectionCenterDot);
      // Await the geology JSON before building vector layers so contacts/structures
      // are populated and layer.available is true when toggle disabled-states are set.
      // The fetch started early (line ~11719) and has been loading in parallel with
      // textures, so this await is usually instant by the time we reach this point.
      {
        const _geologyCatalog = await geologyFeaturePromise.catch(() => null);
        if (_geologyCatalog && !geologyInteractiveState) {
          geologyInteractiveState = {
            width: _geologyCatalog.width || 4096,
            height: _geologyCatalog.height || 2048,
            features: _geologyCatalog.features || {},
            featureList: Object.values(_geologyCatalog.features || {}),
            unit_legend: _geologyCatalog.unit_legend || [],
            rock_legend: _geologyCatalog.rock_legend || [],
            contacts: _geologyCatalog.contacts || [],
            structures: _geologyCatalog.structures || [],
            landing_sites: _geologyCatalog.landing_sites || [],
          };
          // Build a raster-sampling canvas from the geology PNG so areas with no
          // interactive polygon can still return a unit description via color lookup.
          const _geoTex = geologyTextures.get(geologyLayers[0]?.id || "sim3292-units");
          if (_geoTex && _geoTex.image) {
            try {
              const _img = _geoTex.image;
              const _w = _img.naturalWidth || _img.width || 4096;
              const _h = _img.naturalHeight || _img.height || 2048;
              const _sc = document.createElement("canvas");
              _sc.width = _w;
              _sc.height = _h;
              const _sctx = _sc.getContext("2d", { willReadFrequently: true });
              _sctx.drawImage(_img, 0, 0, _w, _h);
              geologyInteractiveState.samplerCtx = _sctx;
              geologyInteractiveState.samplerWidth = _w;
              geologyInteractiveState.samplerHeight = _h;
            } catch (_e) { /* cross-origin guard — sampler unavailable */ }
          }
        }
      }
      const geologyContactLayer = buildGeologyVectorLayer(
        THREE,
        geologyInteractiveState?.contacts || [],
        3.202,
        elevationSampler,
        popupElevationCache,
        getTerrainRelief,
        0.00025,
        0.28,
        108,
      );
      geologyContactLayer.group.visible = geologyContactsToggle.checked && geologyContactLayer.available;
      venusGroup.add(geologyContactLayer.group);
      const geologyStructureLayers = GEOLOGY_STRUCTURE_FACETS.map((facet) => {
        const entries = (geologyInteractiveState?.structures || [])
          .filter((entry) => facet.matches(entry))
          .map((entry) => ({
            ...entry,
            color: facet.symbolColor || entry.color || "#f06a57",
          }));
        const layer = buildGeologyVectorLayer(
          THREE,
          entries,
          3.204,
          elevationSampler,
          popupElevationCache,
          getTerrainRelief,
          0.00045,
          0.48,
          109,
        );
        const sampleEntry = entries.find((entry) => entry.color) || null;
        return {
          ...facet,
          entries,
          layer,
          count: entries.length,
          sampleColor: sampleEntry?.color || "#f06a57",
        };
      });
      const geologyStructureLayer = {
        group: new THREE.Group(),
        get interactiveObjects() {
          return geologyStructureLayers.flatMap((facet) => facet.layer.interactiveObjects);
        },
        get available() {
          return geologyStructureLayers.some((facet) => facet.layer.available);
        },
        rebuild() {
          geologyStructureLayers.forEach((facet) => facet.layer.rebuild());
        },
        setClippingPlanes(planes) {
          geologyStructureLayers.forEach((facet) => facet.layer.setClippingPlanes(planes));
        },
        syncVisibility() {
          geologyStructureLayers.forEach((facet) => {
            facet.layer.group.visible = Boolean(facet.toggle?.checked) && facet.layer.available;
          });
          this.group.visible = geologyStructureLayers.some((facet) => facet.layer.group.visible);
        },
      };
      geologyStructureLayers.forEach((facet) => geologyStructureLayer.group.add(facet.layer.group));
      geologyStructureLayer.syncVisibility();
      venusGroup.add(geologyStructureLayer.group);
      const raycaster = new THREE.Raycaster();
      raycaster.params.Line.threshold = 0.12;
      const pointer = new THREE.Vector2();
      let pointerDown = null;
      let hoveredFeature = null;
      let lastScaleSampleLat = null;
      let lastScaleSampleAt = 0;
      let measureMode = "";
      let measureDrawActive = false;
      let measurePoints = [];
      let measureProfileSamples = [];
      let measureHistory = [];
      let measureFuture = [];
      let gisMode = "";
      let gisPanelOpen = false;
      let activeToolboxTab = "measure";
      let gisInspectPoint = null;
      let gisBookmarks = [];
      let gisStudyAreas = [];
      let gisBuffers = [];
      gisBases = initialGisBases;
      let gisActiveBaseId = "";
      let gisBasePlacementMode = false;
      let gisBufferState = null;
      let gisQueryResultsState = [];
      let csvPlotterState = null;
      const GIS_COMPARE_MODES = Object.freeze({
        overlay: 0,
        difference: 1,
        swipe: 2,
      });
      const measureGroup = new THREE.Group();
      venusGroup.add(measureGroup);
      // Separate group for moon measurements — positioned at the moon center and rotated
      // with the moon's self-rotation each frame so geometry stays surface-locked.
      const moonMeasureGroup = new THREE.Group();
      venusGroup.add(moonMeasureGroup);
      const measureVisuals = [];
      const gisBufferGroup = new THREE.Group();
      venusGroup.add(gisBufferGroup);
      const gisBaseGroup = new THREE.Group();
      venusGroup.add(gisBaseGroup);
      const geologyBoundaryGroup = new THREE.Group();
      geologyBoundaryGroup.visible = false;
      geologyBoundaryGroup.renderOrder = 111;
      venusGroup.add(geologyBoundaryGroup);
      selectedGeologyBoundaryGroup = geologyBoundaryGroup;

      const geologyOutlineState = createGeologyOutlineState(THREE, geologyInteractiveState);
      if (geologyOutlineState) {
        const geologyOutlineMesh = new THREE.Mesh(
          new THREE.SphereGeometry(3.209, 128, 128),
          new THREE.MeshBasicMaterial({
            map: geologyOutlineState.texture,
            transparent: true,
            opacity: 0.92,
            depthWrite: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -6,
            polygonOffsetUnits: -6,
          }),
        );
        geologyOutlineMesh.rotation.y = Math.PI;
        geologyOutlineMesh.visible = false;
        geologyOutlineMesh.renderOrder = 109;
        venusGroup.add(geologyOutlineMesh);
        selectedGeologyOutline = {
          ...geologyOutlineState,
          mesh: geologyOutlineMesh,
        };
      }

      function getFeatureSurfacePoint(feature, lift = 0.01) {
        if (Array.isArray(feature.ring_anchor)) {
          const anchor = feature.ring_anchor;
          return new THREE.Vector3(anchor[0], anchor[1] + lift, anchor[2]);
        }
        if (Array.isArray(feature.moon_anchor)) {
          const anchor = feature.moon_anchor;
          return new THREE.Vector3(anchor[0], anchor[1] + lift, anchor[2]);
        }
        const lat = feature.lat !== undefined ? feature.lat : feature.anchor_lat;
        const lon = feature.lon !== undefined ? feature.lon : feature.anchor_lon;
        return getReliefPoint(3.2, elevationSampler, popupElevationCache, getTerrainRelief, lat, lon, lift);
      }

      function syncGeologyFeatureOutline() {
        if (!selectedGeologyOutline || !selectedGeologyOutline.mesh) {
          return;
        }
        const geologyFeature = !activePopupIsCoreLabel && activePopupFeature && Array.isArray(activePopupFeature.polygons)
          ? activePopupFeature
          : null;
        const shouldShow = Boolean(geologyFeature) && geologyToggle.checked;
        if (!shouldShow) {
          paintSelectedGeologyOutline(selectedGeologyOutline, null);
          selectedGeologyOutline.mesh.visible = false;
          return;
        }
        paintSelectedGeologyOutline(selectedGeologyOutline, geologyFeature);
        selectedGeologyOutline.mesh.visible = true;
      }

      function rebuildSelectedGeologyBoundary() {
        if (!selectedGeologyBoundaryGroup) {
          return;
        }
        while (selectedGeologyBoundaryGroup.children.length) {
          const child = selectedGeologyBoundaryGroup.children.pop();
          child.geometry?.dispose?.();
          child.material?.dispose?.();
        }
        if (
          activePopupIsCoreLabel ||
          !activePopupFeature ||
          !Array.isArray(activePopupFeature.polygons) ||
          !activePopupFeature.polygons.length ||
          !geologyToggle.checked ||
          coreToggle.checked
        ) {
          selectedGeologyBoundaryGroup.visible = false;
          return;
        }

        const buildSegments = (ring) => {
          const segments = [];
          let current = [];
          let previousLon = null;
          for (const pair of ring) {
            const [rawLon, lat] = pair;
            const lon = ((Number(rawLon) % 360) + 360) % 360;
            if (previousLon !== null && Math.abs(lon - previousLon) > 180) {
              if (current.length >= 2) {
                segments.push(current);
              }
              current = [];
            }
            current.push(getReliefPoint(3.2, elevationSampler, popupElevationCache, getTerrainRelief, lat, lon, 0.0032));
            previousLon = lon;
          }
          if (current.length >= 2) {
            segments.push(current);
          }
          return segments;
        };

        const rings = activePopupFeature.polygons.flatMap((polygon) => [polygon.outer, ...(polygon.holes || [])]);
        for (const ring of rings) {
          for (const segment of buildSegments(ring)) {
            const line = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(segment),
              new THREE.LineBasicMaterial({
                color: 0xffbf6f,
                transparent: true,
                opacity: 0.92,
                depthTest: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
              }),
            );
            line.renderOrder = 110;
            line.userData.selectionAccent = true;
            selectedGeologyBoundaryGroup.add(line);

            const markerGeometry = new THREE.SphereGeometry(0.006, 10, 10);
            const markerMaterial = new THREE.MeshBasicMaterial({
              color: 0xffdeac,
              transparent: true,
              opacity: 0.86,
              depthTest: true,
              depthWrite: false,
              polygonOffset: true,
              polygonOffsetFactor: -3,
              polygonOffsetUnits: -3,
            });
            for (let index = 0; index < segment.length; index += 4) {
              const marker = new THREE.Mesh(markerGeometry, markerMaterial);
              marker.position.copy(segment[index]);
              marker.renderOrder = 111;
              marker.userData.selectionAccent = true;
              selectedGeologyBoundaryGroup.add(marker);
            }
          }
        }
        selectedGeologyBoundaryGroup.visible = selectedGeologyBoundaryGroup.children.length > 0;
      }

      function resetLabelEntryPulse(entry) {
        if (!entry || !entry._pulseBase) return;
        if (entry.sprite?.material) {
          entry.sprite.material.color.copy(entry._pulseBase.spriteColor);
          entry.sprite.material.opacity = entry._pulseBase.spriteOpacity;
        }
        if (entry.dot?.material) {
          entry.dot.material.color.copy(entry._pulseBase.dotColor);
        }
        if (entry.line?.material) {
          entry.line.material.opacity = entry._pulseBase.lineOpacity;
        }
        delete entry._pulseBase;
      }

      syncSelectionHalo = function syncSelectionHalo() {
        const surfaceEntry = (activePopupFeature && !activePopupIsCoreLabel && activePopupFeature.lat !== undefined)
          ? labelLayer.entries.find((e) => e.item === activePopupFeature) || null
          : null;
        const moonFeatureEntry = (!surfaceEntry && activePopupFeature && !activePopupIsCoreLabel && activePopupFeature.lat !== undefined)
          ? moonFeatureLabelLayer.entries.find((e) => e.item === activePopupFeature) || null
          : null;
        const coreEntry = (activePopupFeature && activePopupIsCoreLabel)
          ? (cutawayResult?.labelEntries || []).find((e) => e.dot?.userData?.feature === activePopupFeature || (activePopupFeature.id !== undefined && e.layerId === activePopupFeature.id)) || null
          : null;
        const nextEntry = surfaceEntry || moonFeatureEntry || coreEntry;
        if (selectedLabelEntry && selectedLabelEntry !== nextEntry) {
          resetLabelEntryPulse(selectedLabelEntry);
        }
        selectedLabelEntry = nextEntry;
        selectedLabelEntryIsSurface = Boolean(surfaceEntry);
        selectedLabelEntryIsCore = Boolean(coreEntry);
        if (!activePopupFeature || activePopupIsCoreLabel || activePopupFeature.lat === undefined) {
          syncGeologyFeatureOutline();
          rebuildSelectedGeologyBoundary();
          return;
        }
        syncGeologyFeatureOutline();
        rebuildSelectedGeologyBoundary();
      };

    function buildDefaultSearchSuggestions() {
      return allFeatureData
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    function refreshSearchSuggestions() {
      const query = String(featureSearch.value || "").trim();
      featureSearchResults.hidden = true;
      featureSearchResults.innerHTML = "";
      activeSearchResults = [];
      activeSearchIndex = -1;
      if (!query) {
        renderFeatureSearchResults(buildDefaultSearchSuggestions());
        return;
      }
      renderFeatureSearchResults(getPredictiveNameMatches(query));
    }

    function refreshSearchSuggestionsAfterTextEdit() {
      refreshSearchSuggestions();
    }

    function isObjectActuallyVisible(object) {
      let current = object;
      while (current) {
        if (current.visible === false) {
          return false;
        }
        current = current.parent;
      }
      return true;
    }

      // ── Generic GIS storage helpers ───────────────────────────────────────────
      // All four collections (pins, study areas, buffers, bookmarks) share the same
      // load/save/render pattern. Public web builds keep them session-only.

      function loadGisCollection(storageKey) {
        try {
          const raw = gisSessionState.get(storageKey);
          const parsed = raw ? JSON.parse(raw) : [];
          return Array.isArray(parsed) ? parsed : [];
        } catch (_) { return []; }
      }

      function saveGisCollection(storageKey, collection) {
        try { gisSessionState.set(storageKey, JSON.stringify(collection)); } catch (_) {}
      }

      // Populates a <select> element from a collection.
      // emptyText shown when empty; goBtn/deleteBtn are disabled accordingly.
      // preserveSelection: re-select the previously selected id if it still exists.
      function renderGisSelectList(selectEl, collection, { emptyText, goBtn, deleteBtn, preserveSelection = true } = {}) {
        if (!selectEl) return;
        const previousValue = preserveSelection ? selectEl.value : null;
        selectEl.innerHTML = '';
        if (!collection.length) {
          const opt = document.createElement('option');
          opt.value = ''; opt.textContent = emptyText || 'No items';
          selectEl.appendChild(opt);
          if (goBtn) goBtn.disabled = true;
          if (deleteBtn) deleteBtn.disabled = true;
          return;
        }
        for (const item of collection) {
          const opt = document.createElement('option');
          opt.value = item.id; opt.textContent = item.name;
          selectEl.appendChild(opt);
        }
        if (preserveSelection && collection.some((item) => item.id === previousValue)) {
          selectEl.value = previousValue;
        } else {
          selectEl.value = collection[0].id;
        }
        if (goBtn) goBtn.disabled = false;
        if (deleteBtn) deleteBtn.disabled = false;
      }

      // Named wrappers — declared as function statements so they are hoisted and
      // available before the generic helpers are defined in source order.
      function loadGisBookmarks()  { return loadGisCollection(GIS_BOOKMARK_STORAGE_KEY); }
      function loadGisStudyAreas() { return loadGisCollection(GIS_STUDY_AREA_STORAGE_KEY); }
      function loadGisBuffers()    { return loadGisCollection(GIS_BUFFER_STORAGE_KEY); }
      function loadGisBases()      { return loadGisCollection(GIS_BASE_STORAGE_KEY); }

      function saveGisBookmarks()  { saveGisCollection(GIS_BOOKMARK_STORAGE_KEY, gisBookmarks); }
      function saveGisStudyAreas() { saveGisCollection(GIS_STUDY_AREA_STORAGE_KEY, gisStudyAreas); }
      function saveGisBuffers()    { saveGisCollection(GIS_BUFFER_STORAGE_KEY, gisBuffers); }
      function saveGisBases()      { saveGisCollection(GIS_BASE_STORAGE_KEY, gisBases); }

      function renderGisBookmarks()  { renderGisSelectList(gisBookmarkList, gisBookmarks,  { emptyText: 'No saved views',        goBtn: gisBookmarkGo,    deleteBtn: gisBookmarkDelete }); }
      function renderGisStudyAreas() { renderGisSelectList(gisStudyList,    gisStudyAreas, { emptyText: 'No saved study areas',  goBtn: gisStudyGo,       deleteBtn: gisStudyDelete }); }
      function renderGisBuffers()    { renderGisSelectList(gisBufferList,   gisBuffers,    { emptyText: 'No saved buffers',      goBtn: gisBufferGo,      deleteBtn: gisBufferDelete }); }
      function renderGisBases()      { renderGisSelectList(gisBaseList,     gisBases,      { emptyText: 'No saved bases',        goBtn: gisBaseGo,        deleteBtn: gisBaseDelete }); }

      function hexToRgb(hex) {
        const clean = String(hex || "").replace("#", "");
        if (clean.length !== 6) {
          return { r: 255, g: 120, b: 70 };
        }
        return {
          r: parseInt(clean.slice(0, 2), 16),
          g: parseInt(clean.slice(2, 4), 16),
          b: parseInt(clean.slice(4, 6), 16),
        };
      }

      function rgbaFromHex(hex, alpha = 1) {
        const { r, g, b } = hexToRgb(hex);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      }

      function projectBaseLocal(point, origin) {
        const lat = Number(point.lat);
        const lon = normalizeLongitudeDegrees(Number(point.lon));
        const lat0 = Number(origin.lat);
        const lon0 = normalizeLongitudeDegrees(Number(origin.lon));
        const x = THREE.MathUtils.degToRad(normalizeLongitudeDegrees(lon - lon0)) * VENUS_MEAN_RADIUS_KM * 1000 * Math.cos(THREE.MathUtils.degToRad(lat0));
        const y = THREE.MathUtils.degToRad(lat - lat0) * VENUS_MEAN_RADIUS_KM * 1000;
        return { x, y };
      }

      function unprojectBaseLocal(x, y, origin) {
        const lat0 = Number(origin.lat);
        const lon0 = normalizeLongitudeDegrees(Number(origin.lon));
        const lat = lat0 + THREE.MathUtils.radToDeg(y / (VENUS_MEAN_RADIUS_KM * 1000));
        const lon = lon0 + THREE.MathUtils.radToDeg(x / ((VENUS_MEAN_RADIUS_KM * 1000) * Math.max(Math.cos(THREE.MathUtils.degToRad(lat0)), 0.0001)));
        return { lat, lon: ((lon % 360) + 360) % 360 };
      }

      function basePolygonCentroid(vertices) {
        return polygonCentroidLatLon(vertices);
      }

      function buildBaseGridState(base) {
        const vertices = Array.isArray(base?.vertices) ? base.vertices : [];
        if (vertices.length < 3) {
          return null;
        }
        const origin = base.center || basePolygonCentroid(vertices);
        const cellSizeM = Math.max(5, Number(base.gridSizeM || 10));
        const localVertices = vertices.map((vertex) => projectBaseLocal(vertex, origin));
        const xMin = Math.min(...localVertices.map((point) => point.x));
        const xMax = Math.max(...localVertices.map((point) => point.x));
        const yMin = Math.min(...localVertices.map((point) => point.y));
        const yMax = Math.max(...localVertices.map((point) => point.y));
        const cols = Math.max(1, Math.ceil((xMax - xMin) / cellSizeM));
        const rows = Math.max(1, Math.ceil((yMax - yMin) / cellSizeM));
        const validCells = new Set();
        const cellCenters = new Map();
        for (let row = 0; row < rows; row += 1) {
          for (let col = 0; col < cols; col += 1) {
            const centerLocal = {
              x: xMin + ((col + 0.5) * cellSizeM),
              y: yMin + ((row + 0.5) * cellSizeM),
            };
            const centerLatLon = unprojectBaseLocal(centerLocal.x, centerLocal.y, origin);
            if (pointInProjectedPolygon(centerLatLon, vertices, origin)) {
              const key = `${row}:${col}`;
              validCells.add(key);
              cellCenters.set(key, centerLatLon);
            }
          }
        }
        return {
          origin,
          cellSizeM,
          xMin,
          xMax,
          yMin,
          yMax,
          cols,
          rows,
          validCells,
          cellCenters,
        };
      }

      function getBuildingFootprintCells(buildingDef, row, col, rotation) {
        const turns = Math.round(Number(rotation || 0) / 90) % 4;
        const swap = Math.abs(turns) % 2 === 1;
        const width = swap ? buildingDef.size[1] : buildingDef.size[0];
        const height = swap ? buildingDef.size[0] : buildingDef.size[1];
        const startCol = col - Math.floor(width / 2);
        const startRow = row - Math.floor(height / 2);
        const cells = [];
        for (let r = 0; r < height; r += 1) {
          for (let c = 0; c < width; c += 1) {
            cells.push({ row: startRow + r, col: startCol + c });
          }
        }
        return { width, height, startCol, startRow, cells };
      }

      function getBaseById(baseId = gisActiveBaseId) {
        return gisBases.find((entry) => entry.id === baseId) || null;
      }

      function computeBaseOccupiedCells(base) {
        const occupied = new Map();
        const buildings = Array.isArray(base?.buildings) ? base.buildings : [];
        for (const building of buildings) {
          const def = BASE_BUILDER_CATALOG.find((entry) => entry.id === building.catalogId);
          if (!def) continue;
          const footprint = getBuildingFootprintCells(def, building.row, building.col, building.rotation);
          footprint.cells.forEach((cell) => occupied.set(`${cell.row}:${cell.col}`, building.id));
        }
        return occupied;
      }

      function buildBaseFootprintVertices(base, building) {
        const grid = buildBaseGridState(base);
        const def = BASE_BUILDER_CATALOG.find((entry) => entry.id === building.catalogId);
        if (!grid || !def) {
          return null;
        }
        const footprint = getBuildingFootprintCells(def, building.row, building.col, building.rotation);
        const x0 = grid.xMin + (footprint.startCol * grid.cellSizeM);
        const x1 = x0 + (footprint.width * grid.cellSizeM);
        const y0 = grid.yMin + (footprint.startRow * grid.cellSizeM);
        const y1 = y0 + (footprint.height * grid.cellSizeM);
        return [
          unprojectBaseLocal(x0, y0, grid.origin),
          unprojectBaseLocal(x1, y0, grid.origin),
          unprojectBaseLocal(x1, y1, grid.origin),
          unprojectBaseLocal(x0, y1, grid.origin),
        ];
      }

      function baseLabelItem(base) {
        return {
          id: base.id,
          name: base.name,
          type: "Base site",
          description: `Venus base boundary covering ${Number(base.areaKm2 || 0).toFixed(1)} km².`,
          lat: Number(base.center?.lat || 0),
          lon: Number(base.center?.lon || 0),
          label_distance: 0.34,
          label_push_up: 0.04,
          theme: "mission",
          labelPalette: {
            bg: rgbaFromHex(base.color || "#ff7846", 0.14),
            stroke: rgbaFromHex(base.color || "#ff7846", 0.68),
            accent: rgbaFromHex(base.color || "#ff7846", 0.94),
            title: "rgba(255,245,238,0.98)",
          },
          markerHex: base.color || "#ff7846",
        };
      }

      function buildBaseSiteLayer(baseItems, radius, elevationSampler, elevationCache, getTerrainRelief) {
        const group = new THREE.Group();
        const entries = [];
        const interactiveObjects = [];
        const hitGeometry = new THREE.SphereGeometry(0.15, 12, 12);
        const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false });
        for (const base of baseItems || []) {
          if (!base?.center) continue;
          const item = baseLabelItem(base);
          const anchor = getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, item.lat, item.lon, 0.008);
          const normal = anchor.clone().normalize();
          const markerMaterial = new THREE.MeshBasicMaterial({ color: item.markerHex || "#ff7846", transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
          const marker = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), markerMaterial);
          marker.position.copy(anchor);
          marker.renderOrder = 220;
          marker.userData.feature = item;
          group.add(marker);
          const hitTarget = new THREE.Mesh(hitGeometry, hitMaterial);
          hitTarget.position.copy(anchor.clone().addScaledVector(normal, 0.03));
          hitTarget.renderOrder = 221;
          hitTarget.userData.feature = item;
          group.add(hitTarget);
          const label = makeLabelTexture(item, { customPalette: item.labelPalette });
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: label.texture, transparent: true, opacity: 0.96, depthTest: false, depthWrite: false }));
          sprite.scale.set((label.width / 200) * 0.52, (label.height / 200) * 0.52, 1);
          sprite.renderOrder = 222;
          const east = new THREE.Vector3(-normal.z, 0, normal.x);
          if (east.lengthSq() < 0.0001) east.set(1, 0, 0);
          east.normalize();
          const up = normal.clone().cross(east).normalize();
          const direction = (item.lat >= 0 ? east.clone() : east.clone().multiplyScalar(-1)).addScaledVector(up, 0.08).normalize();
          const labelPos = anchor.clone().addScaledVector(normal, 0.18).addScaledVector(direction, item.label_distance || 0.34).addScaledVector(up, item.label_push_up || 0);
          sprite.position.copy(labelPos);
          sprite.userData.feature = item;
          group.add(sprite);
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([anchor.clone(), labelPos.clone()]),
            new THREE.LineBasicMaterial({ color: item.markerHex || "#ff7846", transparent: true, opacity: 0.65, depthTest: false, depthWrite: false }),
          );
          line.renderOrder = 219;
          group.add(line);
          interactiveObjects.push(hitTarget, marker, sprite);
          entries.push({
            marker,
            hitTarget,
            sprite,
            line,
            surfacePoint: anchor.clone(),
            item,
            priority: 5,
            category: "surface",
            baseScale: sprite.scale.clone(),
            labelDistance: item.label_distance || 0.34,
            labelPushUp: item.label_push_up || 0,
            labelPushEast: 0,
            labelOffsetFactor: 1,
            labelAnchor: anchor.clone(),
            labelNormal: normal.clone(),
            labelDirection: direction.clone(),
            labelUp: up.clone(),
            labelEast: east.clone(),
            markerBaseScale: marker.scale.clone(),
            hitBaseScale: hitTarget.scale.clone(),
            sortIndex: entries.length,
            _globalVisible: false,
          });
        }
        return { group, entries, interactiveObjects };
      }

      function rebuildBaseSiteLayerInstance() {
        if (!baseSiteLayer || !venusGroup) {
          return;
        }
        venusGroup.remove(baseSiteLayer.group);
        for (const entry of baseSiteLayer.entries || []) {
          entry.sprite?.material?.map?.dispose?.();
          entry.sprite?.material?.dispose?.();
          entry.line?.geometry?.dispose?.();
          entry.line?.material?.dispose?.();
          entry.marker?.geometry?.dispose?.();
          entry.marker?.material?.dispose?.();
          entry.hitTarget?.geometry?.dispose?.();
        }
        baseSiteLayer = buildBaseSiteLayer(gisBases, 3.2, elevationSampler, labelElevationCache, getTerrainRelief);
        baseSiteLayer.group.visible = true;
        venusGroup.add(baseSiteLayer.group);
      }

      function clearGisBaseOverlay() {
        while (gisBaseGroup.children.length) {
          const child = gisBaseGroup.children.pop();
          child?.geometry?.dispose?.();
          if (Array.isArray(child?.material)) {
            child.material.forEach((material) => material?.dispose?.());
          } else {
            child?.material?.dispose?.();
          }
        }
      }

      function renderPlacedBuildingList(base) {
        if (!gisBaseBuildingList) {
          return;
        }
        const buildings = Array.isArray(base?.buildings) ? base.buildings : [];
        gisBaseBuildingList.innerHTML = "";
        if (!buildings.length) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "No placed structures";
          gisBaseBuildingList.appendChild(option);
          if (gisBaseBuildingGo) gisBaseBuildingGo.disabled = true;
          if (gisBaseRemoveBuilding) gisBaseRemoveBuilding.disabled = true;
          return;
        }
        for (const building of buildings) {
          const def = BASE_BUILDER_CATALOG.find((entry) => entry.id === building.catalogId);
          const option = document.createElement("option");
          option.value = building.id;
          option.textContent = `${def?.name || building.catalogId} (${building.rotation || 0}°)`;
          gisBaseBuildingList.appendChild(option);
        }
        if (gisBaseBuildingGo) gisBaseBuildingGo.disabled = false;
        if (gisBaseRemoveBuilding) gisBaseRemoveBuilding.disabled = false;
      }

      function buildBaseGridLineSegments(base, grid) {
        const points = [];
        const step = grid.cellSizeM;
        for (let col = 0; col <= grid.cols; col += 1) {
          const x = grid.xMin + (col * step);
          points.push(sampleMeasureSurfacePoint(unprojectBaseLocal(x, grid.yMin, grid.origin).lat, unprojectBaseLocal(x, grid.yMin, grid.origin).lon, 0.013));
          points.push(sampleMeasureSurfacePoint(unprojectBaseLocal(x, grid.yMax, grid.origin).lat, unprojectBaseLocal(x, grid.yMax, grid.origin).lon, 0.013));
        }
        for (let row = 0; row <= grid.rows; row += 1) {
          const y = grid.yMin + (row * step);
          points.push(sampleMeasureSurfacePoint(unprojectBaseLocal(grid.xMin, y, grid.origin).lat, unprojectBaseLocal(grid.xMin, y, grid.origin).lon, 0.013));
          points.push(sampleMeasureSurfacePoint(unprojectBaseLocal(grid.xMax, y, grid.origin).lat, unprojectBaseLocal(grid.xMax, y, grid.origin).lon, 0.013));
        }
        return points;
      }

      function renderActiveBaseOverlay() {
        clearGisBaseOverlay();
        const activeBase = getBaseById();
        if (!activeBase) {
          return;
        }
        const vertices = Array.isArray(activeBase.vertices) ? activeBase.vertices : [];
        if (vertices.length >= 3) {
          const fillMesh = buildMarsPolygonFillMesh(vertices);
          if (fillMesh) {
            const { r, g, b } = hexToRgb(activeBase.color || "#ff7846");
            fillMesh.material.color.setRGB(r / 255, g / 255, b / 255);
            fillMesh.material.opacity = 0.16;
            gisBaseGroup.add(fillMesh);
          }
          const boundaryPoints = buildMarsSurfacePolyline(vertices, true, 0.02);
          if (boundaryPoints.length >= 2) {
            const boundaryLine = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(boundaryPoints),
              new THREE.LineBasicMaterial({
                color: activeBase.color || "#ff7846",
                transparent: true,
                opacity: 0.98,
                depthTest: false,
                depthWrite: false,
              }),
            );
            boundaryLine.renderOrder = 89;
            gisBaseGroup.add(boundaryLine);
          }
        }
        const grid = buildBaseGridState(activeBase);
        if (grid) {
          const gridPoints = buildBaseGridLineSegments(activeBase, grid);
          if (gridPoints.length >= 2) {
            const gridGeometry = new THREE.BufferGeometry().setFromPoints(gridPoints);
            const gridMaterial = new THREE.LineBasicMaterial({
              color: activeBase.color || "#ff7846",
              transparent: true,
              opacity: 0.18,
              depthTest: false,
              depthWrite: false,
            });
            const gridLines = new THREE.LineSegments(gridGeometry, gridMaterial);
            gridLines.renderOrder = 87;
            gisBaseGroup.add(gridLines);
          }
        }
        for (const building of activeBase.buildings || []) {
          const def = BASE_BUILDER_CATALOG.find((entry) => entry.id === building.catalogId);
          const footprintVertices = buildBaseFootprintVertices(activeBase, building);
          if (!def || !footprintVertices) continue;
          const mesh = buildMarsPolygonFillMesh(footprintVertices);
          if (mesh) {
            const { r, g, b } = hexToRgb(def.color);
            mesh.material.color.setRGB(r / 255, g / 255, b / 255);
            mesh.material.opacity = 0.46;
            gisBaseGroup.add(mesh);
          }
          const linePoints = buildMarsSurfacePolyline(footprintVertices, true, 0.024);
          if (linePoints.length >= 2) {
            const line = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(linePoints),
              new THREE.LineBasicMaterial({
                color: def.color,
                transparent: true,
                opacity: 0.95,
                depthTest: false,
                depthWrite: false,
              }),
            );
            line.renderOrder = 90;
            gisBaseGroup.add(line);
          }
        }
      }


      function geologyFeatureRepresentativePoint(feature) {
        const bounds = feature?.selection_bounds;
        if (!bounds) {
          return null;
        }
        const lat = (Number(bounds.lat_min) + Number(bounds.lat_max)) * 0.5;
        const lon = normalizeLongitudeDegrees(Number(bounds.lon_center));
        return { lat, lon };
      }

      function getCurrentMineralQueryContext() {
        const layer = getSelectedMineralLayer(mineralLayers);
        if (!layer) {
          return { layer: null, sampler: null };
        }
        return {
          layer,
          sampler: mineralSamplerStates.get(layer.id) || null,
        };
      }

      function buildQueryCandidates() {
        const dataset = gisQueryDataset?.value || "features";
        if (dataset === "landing") {
          return labelData
            .filter((item) => item.theme === "landing" && item.lat !== undefined && item.lon !== undefined)
            .map((item) => ({ ...item, queryDataset: "landing" }));
        }
        if (dataset === "geology") {
          return (geologyInteractiveState?.featureList || [])
            .map((feature) => {
              const point = geologyFeatureRepresentativePoint(feature);
              return point ? {
                ...feature,
                name: feature.rock_type || feature.name || feature.unit_description || "Geology unit",
                type: feature.type || "Geologic unit polygon",
                lat: point.lat,
                lon: point.lon,
                queryDataset: "geology",
              } : null;
            })
            .filter(Boolean);
        }
        return labelData
          .filter((item) => item.lat !== undefined && item.lon !== undefined)
          .map((item) => ({ ...item, queryDataset: "features" }));
      }

      function passesQueryFilters(candidate, mineralContext) {
        const classNeedle = String(gisQueryClass?.value || "").trim().toLowerCase();
        const elevMin = gisQueryElevMin?.value === "" ? null : Number(gisQueryElevMin.value);
        const elevMax = gisQueryElevMax?.value === "" ? null : Number(gisQueryElevMax.value);
        const slopeMin = gisQuerySlopeMin?.value === "" ? null : Number(gisQuerySlopeMin.value);
        const slopeMax = gisQuerySlopeMax?.value === "" ? null : Number(gisQuerySlopeMax.value);
        const mineralMin = Number(gisQueryMineralMin?.value || 0);
        const nearbyKm = gisQueryNearbyKm?.value === "" ? null : Number(gisQueryNearbyKm.value);
        const useActiveBuffer = Boolean(gisQueryUseBuffer?.checked && gisBufferState?.vertices?.length);

        if (classNeedle) {
          const haystack = [
            candidate.name,
            candidate.type,
            candidate.theme,
            candidate.rock_type,
            candidate.unit,
            candidate.unit_description,
            candidate.description,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(classNeedle)) {
            return null;
          }
        }

        const elevation = sampleElevationMeters(elevationSampler, candidate.lat, candidate.lon);
        if (elevMin !== null && (elevation === null || elevation < elevMin)) {
          return null;
        }
        if (elevMax !== null && (elevation === null || elevation > elevMax)) {
          return null;
        }

        const slope = estimateSurfaceSlopeDegrees(elevationSampler, candidate.lat, candidate.lon);
        if (slopeMin !== null && (slope === null || slope < slopeMin)) {
          return null;
        }
        if (slopeMax !== null && (slope === null || slope > slopeMax)) {
          return null;
        }

        let mineralValue = null;
        if (mineralContext.layer && mineralMin > 0) {
          mineralValue = sampleRasterNormalized(mineralContext.sampler, candidate.lat, candidate.lon);
          if (mineralValue === null || mineralValue < mineralMin) {
            return null;
          }
        }

        let distanceKm = null;
        if (nearbyKm !== null && gisInspectPoint?.bodyName === "Venus") {
          distanceKm = greatCircleDistanceKm(candidate, gisInspectPoint);
          if (distanceKm > nearbyKm) {
            return null;
          }
        }
        if (useActiveBuffer && !pointInGisBuffer(candidate.lat, candidate.lon)) {
          return null;
        }

        return {
          ...candidate,
          sampledElevationM: elevation,
          sampledSlopeDeg: slope,
          sampledMineral: mineralValue,
          distanceFromInspectKm: distanceKm,
          insideBuffer: useActiveBuffer,
        };
      }

      function renderQueryResults() {
        if (!gisQueryResults) {
          return;
        }
        gisQueryResults.innerHTML = "";
        if (!gisQueryResultsState.length) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "No results";
          gisQueryResults.appendChild(option);
          if (gisQueryGo) gisQueryGo.disabled = true;
          return;
        }
        for (const result of gisQueryResultsState.slice(0, 100)) {
          const option = document.createElement("option");
          option.value = result.name;
          option.textContent = result.distanceFromInspectKm !== null && result.distanceFromInspectKm !== undefined
            ? `${result.name} (${result.distanceFromInspectKm.toFixed(0)} km)`
            : result.name;
          gisQueryResults.appendChild(option);
        }
        if (gisQueryGo) gisQueryGo.disabled = false;
      }

      function runGisQuery() {
        setToolboxTab("builder");
        const mineralContext = getCurrentMineralQueryContext();
        const candidates = buildQueryCandidates();
        const results = candidates
          .map((candidate) => passesQueryFilters(candidate, mineralContext))
          .filter(Boolean)
          .sort((a, b) => {
            if (a.distanceFromInspectKm !== null && b.distanceFromInspectKm !== null) {
              return a.distanceFromInspectKm - b.distanceFromInspectKm;
            }
            return (a.name || "").localeCompare(b.name || "");
          });
        gisQueryResultsState = results;
        renderQueryResults();
        if (gisQueryMetric) {
          const mineralLabel = mineralContext.layer ? mineralContext.layer.label : "None";
          gisQueryMetric.innerHTML = results.length
            ? [
                `<strong>${results.length} result${results.length === 1 ? "" : "s"}</strong>`,
                `Dataset ${gisQueryDataset?.selectedOptions?.[0]?.textContent || "Named features"}`,
                `Mineral layer ${mineralLabel}`,
                gisQueryUseBuffer?.checked && gisBufferState ? `Buffer ${gisBufferState.sourceType}, ${gisBufferState.radiusKm.toFixed(0)} km` : "",
                gisInspectPoint && gisQueryNearbyKm?.value !== "" ? `Anchor ${gisInspectPoint.lat.toFixed(2)}°, ${gisInspectPoint.lon.toFixed(2)}°E` : "",
              ].filter(Boolean).join("<br>")
            : "No matches for the current filters.";
        }
        if (gisQuerySection) {
          gisQuerySection.open = true;
        }
        syncGisPanel();
      }

      function clearGisQuery() {
        if (gisQueryClass) gisQueryClass.value = "";
        if (gisQueryElevMin) gisQueryElevMin.value = "";
        if (gisQueryElevMax) gisQueryElevMax.value = "";
        if (gisQuerySlopeMin) gisQuerySlopeMin.value = "";
        if (gisQuerySlopeMax) gisQuerySlopeMax.value = "";
        if (gisQueryMineralMin) gisQueryMineralMin.value = "0";
        if (gisQueryNearbyKm) gisQueryNearbyKm.value = "";
        if (gisQueryUseBuffer) gisQueryUseBuffer.checked = false;
        gisQueryResultsState = [];
        renderQueryResults();
        if (gisQueryMetric) {
          gisQueryMetric.innerHTML = "No active query.";
        }
      }

      function focusSelectedQueryResult() {
        const selectedName = gisQueryResults?.value;
        if (!selectedName) {
          return;
        }
        const result = gisQueryResultsState.find((entry) => entry.name === selectedName) || null;
        if (!result) {
          return;
        }
        moveCameraToFeature(result, camera, controls);
        openFeature(result, false);
      }

      function currentMeasurementGeoJSON() {
        if (!measurePoints.length) {
          return null;
        }
        if ((measureMode === "distance" || measureMode === "profile" || measureMode === "route") && measurePoints.length >= 2) {
          const routeDistance = measureMode === "route"
            ? measurePoints.slice(0, -1).reduce((sum, point, index) => sum + greatCircleDistanceKm(point, measurePoints[index + 1]), 0)
            : greatCircleDistanceKm(measurePoints[0], measurePoints[1]);
          return {
            type: "Feature",
            properties: {
              tool: measureMode,
              body: measurePoints[0].bodyName || "Venus",
              distance_km: routeDistance,
            },
            geometry: {
              type: "LineString",
              coordinates: measurePoints.map((point) => [point.lon, point.lat]),
            },
          };
        }
        if (measureMode === "area" && measurePoints.length >= 3) {
          const stats = computeStudyAreaStats(measurePoints, elevationSampler, geologyInteractiveState);
          return {
            type: "Feature",
            properties: {
              tool: "study-area",
              body: measurePoints[0].bodyName || "Venus",
              area_km2: stats?.areaKm2 ?? sphericalPolygonAreaKm2(measurePoints),
              perimeter_km: stats?.perimeterKm ?? polygonPerimeterKm(measurePoints),
              mean_elevation_m: stats?.meanElevation,
              mean_slope_deg: stats?.meanSlope,
              geology_unit: stats?.geologyFeature?.rock_type || stats?.geologyFeature?.name || "",
            },
            geometry: {
              type: "Polygon",
              coordinates: [[
                ...measurePoints.map((point) => [point.lon, point.lat]),
                [measurePoints[0].lon, measurePoints[0].lat],
              ]],
            },
          };
        }
        return null;
      }

      function currentBufferGeoJSON() {
        if (!gisBufferState?.vertices?.length) {
          return null;
        }
        return {
          type: "Feature",
          properties: {
            tool: "buffer",
            source_type: gisBufferState.sourceType,
            radius_km: gisBufferState.radiusKm,
            area_km2: gisBufferState.stats?.areaKm2 ?? null,
            perimeter_km: gisBufferState.stats?.perimeterKm ?? null,
            landing_sites: gisBufferState.landingSiteCount ?? 0,
            named_features: gisBufferState.namedFeatureCount ?? 0,
          },
          geometry: {
            type: "Polygon",
            coordinates: [[
              ...gisBufferState.vertices.map((point) => [point.lon, point.lat]),
              [gisBufferState.vertices[0].lon, gisBufferState.vertices[0].lat],
            ]],
          },
        };
      }

      function getExtractionGeometry(sourceType) {
        if (sourceType === "buffer" && gisBufferState?.vertices?.length) {
          return {
            name: "buffer",
            vertices: gisBufferState.vertices,
            center: gisBufferState.center,
          };
        }
        if (measureMode === "area" && measurePoints.length >= 3) {
          return {
            name: "study-area",
            vertices: measurePoints.map((point) => ({ lat: point.lat, lon: point.lon })),
            center: measurePoints[0],
          };
        }
        return null;
      }

      function sampleExtractionRecord(lat, lon, columnSet) {
        const elevation = sampleElevationMeters(elevationSampler, lat, lon);
        const record = {};
        if (columnSet.has("lat")) record.lat_deg = lat.toFixed(6);
        if (columnSet.has("lon")) record.lon_deg_e = lon.toFixed(6);
        if (columnSet.has("elevation")) record.elevation_m = elevation !== null ? elevation.toFixed(3) : "";
        if (columnSet.has("slope")) {
          const slope = estimateSurfaceSlopeDegrees(elevationSampler, lat, lon);
          record.slope_deg = slope !== null ? slope.toFixed(3) : "";
        }
        if (columnSet.has("temperature")) record.temperature_c = estimateVenusTemperature(lat, elevation || 0);
        if (columnSet.has("pressure")) record.pressure_pa = estimateVenusPressure(elevation || 0);
        if (columnSet.has("wind")) record.wind_m_s = estimateVenusWindSpeed(lat, elevation || 0);
        if (columnSet.has("irradiance")) record.irradiance_w_m2 = estimateMarsIrradiance(lat, elevation || 0);
        if (columnSet.has("radiation")) record.radiation_msv_day = estimateMarsRadiation(elevation || 0);
        if (columnSet.has("geology")) {
          const geology = getGeologyFeatureAtLatLon(lat, lon, geologyInteractiveState);
          record.geology = geology?.rock_type || geology?.name || "";
        }
        return record;
      }

      function exportPolygonSampleCsv(sourceType, stepKm, selectedColumns) {
        const geometry = getExtractionGeometry(sourceType);
        if (!geometry) {
          return { ok: false, message: "No valid geometry is available for extraction." };
        }
        const vertices = geometry.vertices;
        const center = geometry.center;
        const stepLat = Math.max(1, stepKm) / 59.15;
        const latMin = Math.min(...vertices.map((vertex) => vertex.lat));
        const latMax = Math.max(...vertices.map((vertex) => vertex.lat));
        const lonMin = Math.min(...vertices.map((vertex) => vertex.lon));
        const lonMax = Math.max(...vertices.map((vertex) => vertex.lon));
        const rows = [];
        const columnSet = new Set(selectedColumns);
        for (let lat = latMin; lat <= latMax + stepLat * 0.25; lat += stepLat) {
          const lonStep = stepLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
          for (let lon = lonMin; lon <= lonMax + lonStep * 0.25; lon += lonStep) {
            if (!pointInProjectedPolygon({ lat, lon }, vertices, center)) {
              continue;
            }
            rows.push(sampleExtractionRecord(lat, lon, columnSet));
          }
        }
        if (!rows.length) {
          return { ok: false, message: "No samples fell inside the selected geometry." };
        }
        const headers = Object.keys(rows[0]);
        downloadCsv(`venus_${geometry.name}_extract.csv`, [
          headers,
          ...rows.map((row) => headers.map((header) => row[header] ?? "")),
        ]);
        return { ok: true, message: `Exported ${rows.length} samples from the ${geometry.name}.` };
      }

      function clearGisBufferOverlay() {
        while (gisBufferGroup.children.length) {
          const child = gisBufferGroup.children.pop();
          if (!child) break;
          child.geometry?.dispose?.();
          if (Array.isArray(child.material)) {
            child.material.forEach((material) => material?.dispose?.());
          } else {
            child.material?.dispose?.();
          }
        }
      }

      function pointInGisBuffer(lat, lon) {
        if (!gisBufferState?.vertices?.length) {
          return false;
        }
        return pointInProjectedPolygon({ lat, lon }, gisBufferState.vertices, gisBufferState.center);
      }

      function renderGisBufferOverlay() {
        clearGisBufferOverlay();
        if (!gisBufferState?.vertices?.length) {
          return;
        }
        const fillMesh = buildMarsPolygonFillMesh(gisBufferState.vertices);
        if (fillMesh) {
          gisBufferGroup.add(fillMesh);
        }
        const boundaryPoints = buildMarsSurfacePolyline(gisBufferState.vertices, true, 0.018);
        if (boundaryPoints.length >= 2) {
          const boundaryLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(boundaryPoints),
            new THREE.LineBasicMaterial({
              color: 0x9cf6d8,
              transparent: true,
              opacity: 0.96,
              depthTest: false,
              depthWrite: false,
            }),
          );
          boundaryLine.renderOrder = 88;
          boundaryLine.frustumCulled = false;
          gisBufferGroup.add(boundaryLine);
        }
      }

      function generateGisBuffer() {
        setToolboxTab("builder");
        const sourceState = buildBufferSourceState();
        const radiusKm = Math.max(1, Number(gisBufferRadius?.value || 0));
        if (!sourceState || !radiusKm) {
          gisBufferState = null;
          renderGisBufferOverlay();
          syncGisPanel();
          return;
        }
        const vertices = generateBufferPolygonVertices(sourceState, radiusKm);
        const bufferPoints = vertices.map((point) => ({
          lat: point.lat,
          lon: point.lon,
          radiusKm: VENUS_MEAN_RADIUS_KM,
        }));
        const stats = computeStudyAreaStats(bufferPoints, elevationSampler, geologyInteractiveState);
        const landingSiteCount = labelData.filter((item) => item.theme === "landing" && pointInProjectedPolygon(item, vertices, sourceState.center)).length;
        const namedFeatureCount = labelData.filter((item) => item.lat !== undefined && item.lon !== undefined && pointInProjectedPolygon(item, vertices, sourceState.center)).length;
        gisBufferState = {
          sourceType: sourceState.type,
          radiusKm,
          center: sourceState.center,
          vertices,
          stats,
          landingSiteCount,
          namedFeatureCount,
        };
        renderGisBufferOverlay();
        if (gisBufferSection) {
          gisBufferSection.open = true;
        }
        syncGisPanel();
      }

      function clearGisBuffer() {
        gisBufferState = null;
        clearGisBufferOverlay();
        syncGisPanel();
      }

      function saveCurrentGisBuffer() {
        if (!gisBufferState?.vertices?.length) {
          return;
        }
        setToolboxTab("builder");
        const defaultName = `Buffer ${gisBuffers.length + 1}`;
        const name = String(window.prompt("Buffer name", defaultName) || "").trim();
        if (!name) {
          return;
        }
        gisBuffers.unshift({
          id: `gis-buffer-${Date.now()}`,
          name,
          sourceType: gisBufferState.sourceType,
          radiusKm: gisBufferState.radiusKm,
          center: gisBufferState.center,
          vertices: gisBufferState.vertices,
          stats: gisBufferState.stats,
          landingSiteCount: gisBufferState.landingSiteCount,
          namedFeatureCount: gisBufferState.namedFeatureCount,
          createdAt: new Date().toISOString(),
        });
        gisBuffers = gisBuffers.slice(0, 32);
        saveGisBuffers();
        renderGisBuffers();
      }

      function restoreSelectedGisBuffer() {
        const buffer = gisBuffers.find((entry) => entry.id === gisBufferList?.value);
        if (!buffer) {
          return;
        }
        setToolboxTab("builder");
        gisBufferState = {
          sourceType: buffer.sourceType,
          radiusKm: Number(buffer.radiusKm),
          center: buffer.center,
          vertices: Array.isArray(buffer.vertices) ? buffer.vertices : [],
          stats: buffer.stats || null,
          landingSiteCount: Number(buffer.landingSiteCount || 0),
          namedFeatureCount: Number(buffer.namedFeatureCount || 0),
        };
        renderGisBufferOverlay();
        if (gisBufferSection) {
          gisBufferSection.open = true;
        }
        syncGisPanel();
      }

      function deleteSelectedGisBuffer() {
        if (!gisBufferList?.value) {
          return;
        }
        gisBuffers = gisBuffers.filter((entry) => entry.id !== gisBufferList.value);
        saveGisBuffers();
        renderGisBuffers();
        syncGisPanel();
      }

      function populateBaseBuildingControls() {
        if (gisBaseBuildingCategory && gisBaseBuildingCategory.options.length === 0) {
          const categories = [...new Set(BASE_BUILDER_CATALOG.map((entry) => entry.category))];
          categories.forEach((category) => {
            const option = document.createElement("option");
            option.value = category;
            option.textContent = category;
            gisBaseBuildingCategory.appendChild(option);
          });
        }
        if (!gisBaseBuildingSelect) {
          return;
        }
        const currentCategory = gisBaseBuildingCategory?.value || BASE_BUILDER_CATALOG[0]?.category;
        const items = BASE_BUILDER_CATALOG.filter((entry) => entry.category === currentCategory);
        const previousValue = gisBaseBuildingSelect.value;
        gisBaseBuildingSelect.innerHTML = "";
        items.forEach((entry) => {
          const option = document.createElement("option");
          option.value = entry.id;
          option.textContent = `${entry.name} (${entry.size[0]}×${entry.size[1]})`;
          gisBaseBuildingSelect.appendChild(option);
        });
        gisBaseBuildingSelect.value = items.some((entry) => entry.id === previousValue) ? previousValue : (items[0]?.id || "");
      }

      function activateBase(baseId) {
        const base = gisBases.find((entry) => entry.id === baseId) || null;
        gisActiveBaseId = base?.id || "";
        gisBasePlacementMode = false;
        if (gisBasePlaceBuilding) {
          gisBasePlaceBuilding.classList.toggle("is-active", false);
        }
        if (base) {
          if (gisBaseName) gisBaseName.value = base.name || "";
          if (gisBaseColor) gisBaseColor.value = base.color || "#ff7846";
          if (gisBaseGridSize) gisBaseGridSize.value = String(base.gridSizeM || 10);
        }
        renderActiveBaseOverlay();
        renderPlacedBuildingList(base);
        syncGisPanel();
      }

      function createBaseRecord(vertices, options = {}) {
        if (!Array.isArray(vertices) || vertices.length < 3) {
          return null;
        }
        const name = String(options.name || gisBaseName?.value || `Base ${gisBases.length + 1}`).trim();
        if (!name) {
          return null;
        }
        const color = options.color || gisBaseColor?.value || "#ff7846";
        const gridSizeM = Math.max(5, Number(options.gridSizeM || gisBaseGridSize?.value || 10));
        const center = basePolygonCentroid(vertices);
        const areaKm2 = sphericalPolygonAreaKm2(vertices);
        return {
          id: options.id || `gis-base-${Date.now()}`,
          name,
          color,
          gridSizeM,
          vertices: vertices.map((vertex) => ({ lat: Number(vertex.lat), lon: Number(vertex.lon) })),
          center,
          areaKm2,
          createdAt: options.createdAt || new Date().toISOString(),
          buildings: Array.isArray(options.buildings) ? options.buildings : [],
        };
      }

      function createPresetBaseVertices(center, shape, sizeKm) {
        const radiusM = Math.max(100, Number(sizeKm || 1) * 500);
        const project = (x, y) => unprojectBaseLocal(x, y, center);
        if (shape === "rectangle") {
          return [
            project(-radiusM, -radiusM),
            project(radiusM, -radiusM),
            project(radiusM, radiusM),
            project(-radiusM, radiusM),
          ];
        }
        if (shape === "hexagon") {
          return Array.from({ length: 6 }, (_, index) => {
            const angle = (Math.PI / 3) * index + (Math.PI / 6);
            return project(Math.cos(angle) * radiusM, Math.sin(angle) * radiusM);
          });
        }
        return Array.from({ length: 20 }, (_, index) => {
          const angle = (Math.PI * 2 * index) / 20;
          return project(Math.cos(angle) * radiusM, Math.sin(angle) * radiusM);
        });
      }

      function saveOrUpdateBase(base) {
        const existingIndex = gisBases.findIndex((entry) => entry.id === base.id);
        if (existingIndex >= 0) {
          gisBases.splice(existingIndex, 1, base);
        } else {
          gisBases.unshift(base);
        }
        gisBases = gisBases.slice(0, 48);
        saveGisBases();
        renderGisBases();
        rebuildBaseSiteLayerInstance();
        activateBase(base.id);
      }

      function createBaseFromStudyArea() {
        if (!(measureMode === "area" && measurePoints.length >= 3)) {
          return;
        }
        const base = createBaseRecord(measurePoints.map((point) => ({ lat: point.lat, lon: point.lon })));
        if (base) {
          saveOrUpdateBase(base);
          if (gisBaseSection) gisBaseSection.open = true;
        }
      }

      function createPresetBaseFromInspectPoint() {
        if (!gisInspectPoint || gisInspectPoint.bodyName !== "Venus") {
          return;
        }
        const vertices = createPresetBaseVertices(
          { lat: gisInspectPoint.lat, lon: gisInspectPoint.lon },
          gisBaseShape?.value || "rectangle",
          Number(gisBaseSize?.value || 1),
        );
        const base = createBaseRecord(vertices);
        if (base) {
          saveOrUpdateBase(base);
          if (gisBaseSection) gisBaseSection.open = true;
        }
      }

      function exportActiveBaseJson() {
        const base = getBaseById();
        if (!base) {
          return;
        }
        downloadJson(`${base.name.replace(/\s+/g, "_").toLowerCase()}_base.json`, base);
      }

      function exportActiveBaseGeoJSON() {
        const base = getBaseById();
        if (!base) {
          return;
        }
        const features = [{
          type: "Feature",
          properties: {
            id: base.id,
            name: base.name,
            color: base.color,
            grid_size_m: base.gridSizeM,
            area_km2: base.areaKm2,
          },
          geometry: {
            type: "Polygon",
            coordinates: [[...base.vertices.map((vertex) => [vertex.lon, vertex.lat]), [base.vertices[0].lon, base.vertices[0].lat]]],
          },
        }];
        for (const building of base.buildings || []) {
          const def = BASE_BUILDER_CATALOG.find((entry) => entry.id === building.catalogId);
          const vertices = buildBaseFootprintVertices(base, building);
          if (!def || !vertices) continue;
          features.push({
            type: "Feature",
            properties: {
              base_id: base.id,
              building_id: building.id,
              catalog_id: building.catalogId,
              name: def.name,
              rotation_deg: building.rotation || 0,
            },
            geometry: {
              type: "Polygon",
              coordinates: [[...vertices.map((vertex) => [vertex.lon, vertex.lat]), [vertices[0].lon, vertices[0].lat]]],
            },
          });
        }
        downloadJson(`${base.name.replace(/\s+/g, "_").toLowerCase()}_base.geojson`, { type: "FeatureCollection", features });
      }

      function importBaseJsonPayload(payload) {
        const incoming = Array.isArray(payload) ? payload : Array.isArray(payload?.bases) ? payload.bases : [payload];
        const normalized = incoming
          .map((entry) => createBaseRecord(entry.vertices || entry.polygon?.vertices || [], entry))
          .filter(Boolean);
        if (!normalized.length) {
          return false;
        }
        normalized.forEach((base) => saveOrUpdateBase(base));
        return true;
      }

      function focusActiveBase() {
        const base = getBaseById();
        if (!base?.center) {
          return;
        }
        moveCameraToFeature({
          name: base.name,
          type: "Base site",
          lat: base.center.lat,
          lon: base.center.lon,
          description: `Venus base boundary covering ${base.areaKm2.toFixed(1)} km².`,
          theme: "mission",
        }, camera, controls, { animate: true });
      }

      function deleteActiveBase() {
        if (!gisBaseList?.value) {
          return;
        }
        gisBases = gisBases.filter((entry) => entry.id !== gisBaseList.value);
        saveGisBases();
        renderGisBases();
        rebuildBaseSiteLayerInstance();
        activateBase(gisBases[0]?.id || "");
      }

      function validateBuildingPlacement(base, buildingDef, row, col, rotation) {
        const grid = buildBaseGridState(base);
        if (!grid) {
          return { ok: false, reason: "No active grid." };
        }
        const footprint = getBuildingFootprintCells(buildingDef, row, col, rotation);
        const occupied = computeBaseOccupiedCells(base);
        for (const cell of footprint.cells) {
          const key = `${cell.row}:${cell.col}`;
          if (!grid.validCells.has(key)) {
            return { ok: false, reason: "Footprint extends outside the base boundary." };
          }
          if (occupied.has(key)) {
            return { ok: false, reason: "Footprint overlaps an existing structure." };
          }
        }
        return { ok: true, grid, footprint };
      }

      function placeBuildingAtLatLon(lat, lon) {
        const base = getBaseById();
        const buildingDef = BASE_BUILDER_CATALOG.find((entry) => entry.id === gisBaseBuildingSelect?.value);
        if (!base || !buildingDef) {
          return false;
        }
        const grid = buildBaseGridState(base);
        if (!grid) {
          return false;
        }
        const local = projectBaseLocal({ lat, lon }, grid.origin);
        const col = Math.floor((local.x - grid.xMin) / grid.cellSizeM);
        const row = Math.floor((local.y - grid.yMin) / grid.cellSizeM);
        const rotation = Number(gisBaseBuildingRotation?.value || 0);
        const validation = validateBuildingPlacement(base, buildingDef, row, col, rotation);
        if (!validation.ok) {
          setStatus(validation.reason, true);
          return true;
        }
        base.buildings.push({
          id: `base-building-${Date.now()}`,
          catalogId: buildingDef.id,
          row,
          col,
          rotation,
          createdAt: new Date().toISOString(),
        });
        saveOrUpdateBase(base);
        setStatus(`Placed ${buildingDef.name} in ${base.name}.`);
        return true;
      }

      function removeSelectedBaseBuilding() {
        const base = getBaseById();
        if (!base || !gisBaseBuildingList?.value) {
          return;
        }
        base.buildings = (base.buildings || []).filter((entry) => entry.id !== gisBaseBuildingList.value);
        saveOrUpdateBase(base);
      }

      function clearActiveBaseBuildings() {
        const base = getBaseById();
        if (!base) {
          return;
        }
        base.buildings = [];
        saveOrUpdateBase(base);
      }

      // ── Per-tool sync functions ───────────────────────────────────────────────
      // Each handles one GIS panel section: metrics, button states, auto-open.
      // syncGisPanel() calls them all; individual tools can call their own section
      // when they know only one part of the UI changed.

      function syncGisPanelShell() {
        gisPanel.hidden = false;
        if (gisToolboxToggle) gisToolboxToggle.classList.toggle("is-active", false);
      }

      function setToolboxTab(nextTab) {
        const requestedTab = nextTab || "measure";
        activeToolboxTab = requestedTab === "builder" ? "features" : requestedTab;
        const paneMap = {
          measure: toolboxPaneMeasure,
          features: toolboxPaneFeatures,
          builder: toolboxPaneBuilder,
          route: toolboxPaneRoute,
        };
        toolboxPanes.forEach((pane) => {
          if (!pane) return;
          pane.open = pane.dataset.toolboxPane === activeToolboxTab;
        });
        paneMap[activeToolboxTab]?.scrollIntoView?.({ block: "nearest" });
      }

      function syncGisSectionAutoOpen() {
        if (gisRouteSection) gisRouteSection.open = measureMode === "route" || gisRouteSection.open;
        if (gisInspectSection) gisInspectSection.open = gisMode === "inspect" || Boolean(gisInspectPoint) || gisInspectSection.open;
        if (gisStudySection) gisStudySection.open = (measureMode === "area" && measurePoints.length >= 1) || gisStudySection.open;
        if (gisBufferSection) gisBufferSection.open = Boolean(gisBufferState) || gisBufferSection.open;
        if (gisQuerySection) gisQuerySection.open = Boolean(gisQueryResultsState.length) || gisQuerySection.open;
        if (gisCompareSection) gisCompareSection.open = Boolean(gisCompareLayerSelect?.value) || gisCompareSection.open;
        if (gisBaseSection) gisBaseSection.open = Boolean(gisActiveBaseId) || gisBaseSection.open;
        if (gisBaseStructuresSection) gisBaseStructuresSection.open = Boolean(gisActiveBaseId) || Boolean(gisBasePlacementMode) || gisBaseStructuresSection.open;
      }

      function syncGisInspectSection() {
        const inspectModeActive = gisMode === "inspect";
        const selectedBaseLayer = getSelectedBaseLayer(baseLayers);
        const selectedMineralLayer = getSelectedMineralLayer(mineralLayers);
        if (gisInspectButton) gisInspectButton.classList.toggle("is-active", inspectModeActive);
        if (gisCopy) gisCopy.textContent = inspectModeActive
          ? "Inspect mode active. Click a surface point to capture terrain, geology, and layer details."
          : "Inspect terrain and geology details for the current surface location, then save the result as a pin.";
        if (gisExportPointButton) gisExportPointButton.disabled = !gisInspectPoint;

        if (!gisMetric) return;
        if (gisInspectPoint) {
          const geologyName = gisInspectPoint.geologyFeature?.rock_type || gisInspectPoint.geologyFeature?.name || "No mapped geology";
          gisMetric.innerHTML = [
            `<strong>${gisInspectPoint.bodyName || "Venus"} Inspect</strong>`,
            `${gisInspectPoint.lat.toFixed(4)}°, ${gisInspectPoint.lon.toFixed(4)}°E`,
            `Elevation ${gisInspectPoint.elevationMeters !== null ? gisInspectPoint.elevationMeters.toFixed(0) : "n/a"} m`,
            `Slope ${gisInspectPoint.slopeDegrees !== null ? gisInspectPoint.slopeDegrees.toFixed(1) : "n/a"}°`,
            `Base layer ${selectedBaseLayer?.label || "n/a"}`,
            `Mineral layer ${selectedMineralLayer?.label || "None"}`,
            `Geology ${geologyName}`,
          ].join("<br>");
        } else if (measureMode === "area" && measurePoints.length >= 3) {
          const stats = computeStudyAreaStats(measurePoints, elevationSampler, geologyInteractiveState);
          gisMetric.innerHTML = [
            "<strong>Study Area Ready</strong>",
            `Area ${stats.areaKm2.toFixed(0)} km²`,
            `Perimeter ${stats.perimeterKm.toFixed(1)} km`,
            `Mean elevation ${stats.meanElevation !== null ? stats.meanElevation.toFixed(0) : "n/a"} m`,
            `Mean slope ${stats.meanSlope !== null ? stats.meanSlope.toFixed(1) : "n/a"}°`,
          ].join("<br>");
        } else {
          gisMetric.innerHTML = "No pinned GIS result yet.";
        }

      }

      function syncGisRouteSection() {
        if (measureExportRouteButton) measureExportRouteButton.disabled = !(measureMode === "route" && measurePoints.length >= 2);
      }

      function syncGisStudySection() {
        const hasArea = measureMode === "area" && measurePoints.length >= 3;
        const hasPoints = measureMode === "area" && measurePoints.length > 0;
        if (gisExportStudyButton) gisExportStudyButton.disabled = !currentMeasurementGeoJSON();
        if (gisStudySaveButton) gisStudySaveButton.disabled = !hasArea;
        if (gisStudyExportCsvButton) gisStudyExportCsvButton.disabled = !hasArea;
        if (gisStudyExportGeoJsonButton) gisStudyExportGeoJsonButton.disabled = !hasArea;
        if (gisStudyClearButton) gisStudyClearButton.disabled = !hasPoints;

        if (!gisStudyMetric) return;
        if (hasArea) {
          const stats = computeStudyAreaStats(measurePoints, elevationSampler, geologyInteractiveState);
          const geologyName = stats?.geologyFeature?.rock_type || stats?.geologyFeature?.name || "No mapped geology";
          gisStudyMetric.innerHTML = [
            "<strong>Study Area</strong>",
            `Area ${stats.areaKm2.toFixed(0)} km²`,
            `Perimeter ${stats.perimeterKm.toFixed(1)} km`,
            `Elevation min/max ${stats.minElevation !== null ? stats.minElevation.toFixed(0) : "n/a"} / ${stats.maxElevation !== null ? stats.maxElevation.toFixed(0) : "n/a"} m`,
            `Mean elevation ${stats.meanElevation !== null ? stats.meanElevation.toFixed(0) : "n/a"} m`,
            `Std dev ${stats.stdElevation !== null ? stats.stdElevation.toFixed(0) : "n/a"} m`,
            `Mean slope ${stats.meanSlope !== null ? stats.meanSlope.toFixed(1) : "n/a"}°`,
            `Geology ${geologyName}`,
          ].join("<br>");
          if (gisStudyHistogram) {
            drawHistogram(gisStudyHistogram, stats.elevations || [], { label: "Elevation" });
            gisStudyHistogram.hidden = !(stats.elevations && stats.elevations.length);
          }
        } else {
          gisStudyMetric.innerHTML = "No active study area.";
          if (gisStudyHistogram) gisStudyHistogram.hidden = true;
        }
      }

      function syncGisBufferSection() {
        const canInspect = Boolean(gisInspectPoint && gisInspectPoint.bodyName === "Venus");
        const canRoute = Boolean(measureMode === "route" && measurePoints.length >= 2);
        const canArea = Boolean(measureMode === "area" && measurePoints.length >= 3);
        if (gisBufferGenerate) {
          if (gisBufferSource) {
            for (const opt of gisBufferSource.options) {
              if (opt.value === "inspect") opt.disabled = !canInspect;
              if (opt.value === "route") opt.disabled = !canRoute;
              if (opt.value === "area") opt.disabled = !canArea;
            }
            if (![...gisBufferSource.options].find((o) => o.value === gisBufferSource.value && !o.disabled)) {
              const fallback = [...gisBufferSource.options].find((o) => !o.disabled);
              gisBufferSource.value = fallback ? fallback.value : "inspect";
            }
          }
          gisBufferGenerate.disabled = !(canInspect || canRoute || canArea);
        }
        if (gisBufferExport) gisBufferExport.disabled = !currentBufferGeoJSON();
        if (gisBufferSave) gisBufferSave.disabled = !currentBufferGeoJSON();
        if (gisBufferClear) gisBufferClear.disabled = !gisBufferState;

        if (!gisBufferMetric) return;
        if (gisBufferState?.stats) {
          const geologyName = gisBufferState.stats.geologyFeature?.rock_type || gisBufferState.stats.geologyFeature?.name || "No mapped geology";
          gisBufferMetric.innerHTML = [
            `<strong>${gisBufferState.sourceType} buffer</strong>`,
            `Radius ${gisBufferState.radiusKm.toFixed(0)} km`,
            `Area ${gisBufferState.stats.areaKm2.toFixed(0)} km²`,
            `Perimeter ${gisBufferState.stats.perimeterKm.toFixed(1)} km`,
            `Mean elevation ${gisBufferState.stats.meanElevation !== null ? gisBufferState.stats.meanElevation.toFixed(0) : "n/a"} m`,
            `Landing sites ${gisBufferState.landingSiteCount}`,
            `Named features ${gisBufferState.namedFeatureCount}`,
            `Geology ${geologyName}`,
          ].join("<br>");
        } else {
          gisBufferMetric.innerHTML = "No active buffer.";
        }
      }

      function syncGisQuerySection() {
        if (gisQueryNearbyKm) gisQueryNearbyKm.disabled = !(gisInspectPoint && gisInspectPoint.bodyName === "Venus");
        if (gisQueryUseBuffer) {
          gisQueryUseBuffer.disabled = !gisBufferState?.vertices?.length;
          if (gisQueryUseBuffer.disabled) gisQueryUseBuffer.checked = false;
        }
        if (gisQueryRun) gisQueryRun.disabled = false;
        if (gisQueryGo) gisQueryGo.disabled = !gisQueryResultsState.length;
      }

      function syncGisCompareSection() {
        if (!gisCompareLayerSelect) return;
        const activeBaseId = baseLayerSelect?.value || "";
        for (const opt of gisCompareLayerSelect.options) {
          opt.disabled = Boolean(opt.value) && opt.value === activeBaseId;
        }
        if (gisCompareLayerSelect.value === activeBaseId) {
          gisCompareLayerSelect.value = "";
          syncCompareOverlay();
        }
      }

      function syncGisBaseSection() {
        const activeBase = getBaseById();
        if (gisBaseCreateStudy) gisBaseCreateStudy.disabled = !(measureMode === "area" && measurePoints.length >= 3);
        if (gisBaseCreatePreset) gisBaseCreatePreset.disabled = !(gisInspectPoint && gisInspectPoint.bodyName === "Venus");
        if (gisBaseExportJson) gisBaseExportJson.disabled = !activeBase;
        if (gisBaseExportGeoJson) gisBaseExportGeoJson.disabled = !activeBase;
        if (gisBaseDelete) gisBaseDelete.disabled = !activeBase;
        if (gisBaseGo) gisBaseGo.disabled = !activeBase;
        if (gisBaseMetric) {
          if (activeBase) {
            const grid = buildBaseGridState(activeBase);
            gisBaseMetric.innerHTML = [
              `<strong>${activeBase.name}</strong>`,
              `${activeBase.center.lat.toFixed(4)}°, ${activeBase.center.lon.toFixed(4)}°E`,
              `Area ${Number(activeBase.areaKm2 || 0).toFixed(1)} km²`,
              `Grid ${activeBase.gridSizeM} m`,
              `Cells ${grid?.validCells?.size || 0}`,
              `Structures ${(activeBase.buildings || []).length}`,
            ].join("<br>");
          } else {
            gisBaseMetric.innerHTML = "No active base.";
          }
        }
      }

      function syncGisBaseStructuresSection() {
        populateBaseBuildingControls();
        const activeBase = getBaseById();
        const buildingDef = BASE_BUILDER_CATALOG.find((entry) => entry.id === gisBaseBuildingSelect?.value);
        if (gisBasePlaceBuilding) {
          gisBasePlaceBuilding.disabled = !activeBase || !buildingDef;
          gisBasePlaceBuilding.classList.toggle("is-active", gisBasePlacementMode);
        }
        if (gisBaseClearBuildings) gisBaseClearBuildings.disabled = !activeBase || !(activeBase.buildings || []).length;
        renderPlacedBuildingList(activeBase);
        if (gisBaseBuildingMetric) {
          if (activeBase && buildingDef) {
            gisBaseBuildingMetric.innerHTML = [
              `<strong>${buildingDef.name}</strong>`,
              `${buildingDef.description}`,
              `Footprint ${buildingDef.size[0]}×${buildingDef.size[1]} cells`,
              `Rotation ${Number(gisBaseBuildingRotation?.value || 0)}°`,
              gisBasePlacementMode ? "Placement mode active. Click inside the active base to place." : "Select a structure, then enable placement mode.",
            ].join("<br>");
          } else {
            gisBaseBuildingMetric.innerHTML = "No active building plan.";
          }
        }
      }

      function syncGisPanel() {
        if (!gisMetric || !gisPanel) return;
        syncGisPanelShell();
        syncGisSectionAutoOpen();
        syncGisInspectSection();
        syncGisRouteSection();
        syncGisStudySection();
        syncGisBufferSection();
        syncGisQuerySection();
        syncGisCompareSection();
        syncGisBaseSection();
        syncGisBaseStructuresSection();
      }

      function setGisMode(nextMode) {
        gisMode = gisMode === nextMode ? "" : nextMode;
        gisPanelOpen = true;
        if (gisMode === "inspect") {
          setToolboxTab("features");
        }
        if (gisMode === "inspect" && gisInspectSection) {
          gisInspectSection.open = true;
        }
        syncGisPanel();
      }

      function toggleGisPanel(forceOpen = null) {
        gisPanelOpen = forceOpen === null ? !gisPanelOpen : Boolean(forceOpen);
        syncGisPanel();
      }

      function captureGisInspect(surfaceHit) {
        if (!surfaceHit) {
          return;
        }
        let lat;
        let lon;
        let bodyName = "Venus";
        let bodyKind = "planet";
        if (surfaceHit.context?.kind === "moon") {
          bodyKind = "moon";
          bodyName = surfaceHit.context.bodyName || bodyName;
          lat = surfaceHit.lat;
          lon = surfaceHit.lon;
        } else if (surfaceHit.context?.kind === "planet") {
          lat = surfaceHit.lat;
          lon = surfaceHit.lon;
          bodyName = surfaceHit.context.bodyName || bodyName;
        } else if (surfaceHit.point) {
          const localPoint = venusGroup.worldToLocal(surfaceHit.point.clone());
          localPoint.applyEuler(new THREE.Euler(0, -(globe.rotation.y - Math.PI), 0));
          const latLon = vectorToLatLon(localPoint);
          lat = latLon.lat;
          lon = latLon.lon;
        } else {
          return;
        }
        if (bodyKind !== "planet") {
          gisInspectPoint = {
            lat,
            lon,
            bodyName,
            elevationMeters: null,
            slopeDegrees: null,
            geologyFeature: null,
          };
          syncGisPanel();
          return;
        }
        const geologyFeature = getGeologyFeatureAtLatLon(lat, lon, geologyInteractiveState);
        gisInspectPoint = {
          lat,
          lon,
          bodyName,
          elevationMeters: sampleElevationMeters(elevationSampler, lat, lon),
          slopeDegrees: estimateSurfaceSlopeDegrees(elevationSampler, lat, lon),
          geologyFeature,
        };
        syncGisPanel();
      }

      function saveCurrentGisBookmark() {
        const now = new Date();
        const id = `gis-view-${now.getTime()}`;
        const name = `View ${gisBookmarks.length + 1} · ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        gisBookmarks.unshift({
          id,
          name,
          camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
          baseLayerId: baseLayerSelect.value,
          createdAt: now.toISOString(),
        });
        gisBookmarks = gisBookmarks.slice(0, 12);
        saveGisBookmarks();
        renderGisBookmarks();
      }

      function restoreSelectedGisBookmark() {
        const bookmark = gisBookmarks.find((entry) => entry.id === gisBookmarkList.value);
        if (!bookmark) {
          return;
        }
        if (baseLayers.some((layer) => layer.id === bookmark.baseLayerId)) {
          baseLayerSelect.value = bookmark.baseLayerId;
          syncBasemapVisibility();
          syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
        }
        camera.position.set(bookmark.camera.x, bookmark.camera.y, bookmark.camera.z);
        controls.target.set(bookmark.target.x, bookmark.target.y, bookmark.target.z);
        controls.update();
      }

      function deleteSelectedGisBookmark() {
        if (!gisBookmarkList.value) {
          return;
        }
        gisBookmarks = gisBookmarks.filter((entry) => entry.id !== gisBookmarkList.value);
        saveGisBookmarks();
        renderGisBookmarks();
      }

      function activateStudyArea(vertices) {
        if (!Array.isArray(vertices) || vertices.length < 3) {
          return;
        }
        setToolboxTab("features");
        const context = {
          kind: "planet",
          bodyName: "Venus",
          radiusKm: VENUS_MEAN_RADIUS_KM,
          radiusWorld: 3.2,
          centerLocal: new THREE.Vector3(0, 0, 0),
          mesh: globe,
        };
        measureMode = "area";
        measureDrawActive = false;
        [measureDistanceButton, measureAreaButton, measureProfileButton, measureRouteButton].forEach((button) => {
          button.classList.toggle("is-active", button.dataset.mode === measureMode);
        });
        measureCopy.textContent = "Loaded study area. Use Draw Polygon to start a new area.";
        measurePoints = vertices.map((vertex) => {
          const localPoint = sampleMeasureSurfacePoint(vertex.lat, vertex.lon, 0.012, context);
          return {
            lat: vertex.lat,
            lon: vertex.lon,
            point: localPoint.clone(),
            localPoint: localPoint.clone(),
            bodyKind: "planet",
            bodyName: "Venus",
            radiusKm: VENUS_MEAN_RADIUS_KM,
            radiusWorld: 3.2,
            context: cloneMeasureContext(context),
          };
        });
        measureHistory = [];
        measureFuture = [];
        pushMeasureHistory();
        updateMeasureVisualization();
      }

      function saveCurrentStudyArea() {
        if (!(measureMode === "area" && measurePoints.length >= 3)) {
          return;
        }
        const defaultName = `Study Area ${gisStudyAreas.length + 1}`;
        const name = window.prompt("Study area name", defaultName);
        if (!name) {
          return;
        }
        const stats = computeStudyAreaStats(measurePoints, elevationSampler, geologyInteractiveState);
        gisStudyAreas.unshift({
          id: `study-area-${Date.now()}`,
          name: String(name).trim(),
          vertices: measurePoints.map((point) => ({ lat: point.lat, lon: point.lon })),
          areaKm2: stats?.areaKm2 ?? sphericalPolygonAreaKm2(measurePoints),
          createdAt: new Date().toISOString(),
        });
        gisStudyAreas = gisStudyAreas.slice(0, 24);
        saveGisStudyAreas();
        renderGisStudyAreas();
      }

      function restoreSelectedStudyArea() {
        const area = gisStudyAreas.find((entry) => entry.id === gisStudyList?.value);
        if (!area) {
          return;
        }
        gisPanelOpen = true;
        if (gisStudySection) gisStudySection.open = true;
        activateStudyArea(area.vertices);
        syncGisPanel();
      }

      function deleteSelectedStudyArea() {
        if (!gisStudyList?.value) {
          return;
        }
        gisStudyAreas = gisStudyAreas.filter((entry) => entry.id !== gisStudyList.value);
        saveGisStudyAreas();
        renderGisStudyAreas();
        syncGisPanel();
      }

      function clearMeasureGroup() {
        measureVisuals.length = 0;
        for (const group of [measureGroup, moonMeasureGroup]) {
          while (group.children.length > 0) {
            const child = group.children.pop();
            if (child.geometry) { child.geometry.dispose?.(); }
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach((material) => material.dispose?.());
              } else {
                child.material.dispose?.();
              }
            }
          }
        }
      }

      function cloneMeasurePointEntry(point) {
        return {
          ...point,
          point: point.point?.clone?.() || point.point,
          localPoint: point.localPoint?.clone?.() || point.localPoint,
          context: point.context ? cloneMeasureContext(point.context) : point.context,
        };
      }

      function pushMeasureHistory() {
        measureHistory.push(measurePoints.map(cloneMeasurePointEntry));
        if (measureHistory.length > 40) {
          measureHistory.shift();
        }
        measureFuture = [];
        if (measureUndoButton) measureUndoButton.disabled = measureHistory.length <= 1;
        if (measureRedoButton) measureRedoButton.disabled = measureFuture.length === 0;
      }

      function restoreMeasureState(snapshot) {
        measurePoints = snapshot.map(cloneMeasurePointEntry);
        updateMeasureVisualization();
        if (measureUndoButton) measureUndoButton.disabled = measureHistory.length <= 1;
        if (measureRedoButton) measureRedoButton.disabled = measureFuture.length === 0;
      }

      function syncRailButtonStates() {
        measureRailButtons.forEach((button) => {
          const mode = button.dataset.measureMode || "";
          const isActive = measureMode === mode;
          button.classList.toggle("is-active", isActive);
        });
      }

      function setMeasureMode(nextMode) {
        const nextMeasureMode = measureMode === nextMode ? "" : nextMode;
        if (!nextMeasureMode) {
          hideMeasurementResultCard();
        }
        measureMode = nextMeasureMode;
        measureDrawActive = Boolean(measureMode);
        setToolboxTab(measureMode === "route" ? "route" : "measure");
        resetActiveMeasurement(true);
      }

      function resetActiveMeasurement(preserveMode = false) {
        if (!preserveMode) {
          measureMode = "";
          measureDrawActive = false;
        }
        if (!measureMode) {
          hideMeasurementResultCard();
        }
        measurePoints = [];
        measureProfileSamples = [];
        measureHistory = [];
        measureFuture = [];
        clearMeasureGroup();
        measurePanel.hidden = !measureMode || measureMode === "route";
        measureMetric.innerHTML = "";
        profileCanvas.hidden = true;
        if (routeMetric) {
          routeMetric.innerHTML = "No active route.";
        }
        if (routeProfileCanvas) {
          routeProfileCanvas.hidden = true;
        }
        measureExport.disabled = !measureMode;
        [measureDistanceButton, measureAreaButton, measureProfileButton, measureRouteButton].forEach((button) => {
          button.classList.toggle("is-active", button.dataset.mode === measureMode);
        });
        syncRailButtonStates();
        syncMeasureRailActions();
        if (measureUndoButton) measureUndoButton.disabled = true;
        if (measureRedoButton) measureRedoButton.disabled = true;
        const context = getActiveMeasureContext();
        measureCopy.textContent = measureMode
          ? (measureDrawActive
            ? `Active tool: ${measureMode}. Click on ${context.bodyName}'s surface to add measurement points.`
            : `Loaded ${measureMode} result. Select the tool again to draw a new one.`)
          : "Choose a tool, then click on the globe to start measuring.";
        if (measureMode) {
          pushMeasureHistory();
        }
        syncGisPanel();
      }

      measureDistanceButton.dataset.mode = "distance";
      measureAreaButton.dataset.mode = "area";
      measureProfileButton.dataset.mode = "profile";
      measureRouteButton.dataset.mode = "route";
      measureDistanceButton.addEventListener("click", () => setMeasureMode("distance"));
      measureAreaButton.addEventListener("click", () => setMeasureMode("area"));
      measureProfileButton.addEventListener("click", () => setMeasureMode("profile"));
      measureRouteButton.addEventListener("click", () => {
        gisPanelOpen = true;
        if (gisRouteSection) {
          gisRouteSection.open = true;
        }
        setMeasureMode("route");
      });
      if (measureUndoButton) {
        measureUndoButton.addEventListener("click", () => {
          if (measureHistory.length <= 1) return;
          const current = measureHistory.pop();
          measureFuture.push(current);
          restoreMeasureState(measureHistory[measureHistory.length - 1] || []);
        });
      }
      if (measureRedoButton) {
        measureRedoButton.addEventListener("click", () => {
          if (!measureFuture.length) return;
          const next = measureFuture.pop();
          measureHistory.push(next.map(cloneMeasurePointEntry));
          restoreMeasureState(next);
        });
      }
      measureRailExportButtons.forEach((button) => {
        button.addEventListener("click", () => {
          exportCurrentMeasurementCsv();
        });
      });

      function exportCurrentMeasurementCsv() {
        if (!measureMode || !measurePoints.length) {
          return;
        }
        if (measureMode === "distance" && measurePoints.length >= 2) {
          const distanceKm = greatCircleDistanceKm(measurePoints[0], measurePoints[1]);
          downloadCsv("venus_distance_measurement.csv", [
            ["type", "start_lat_deg", "start_lon_deg_e", "end_lat_deg", "end_lon_deg_e", "distance_km"],
            [
              "distance",
              measurePoints[0].lat.toFixed(6),
              measurePoints[0].lon.toFixed(6),
              measurePoints[1].lat.toFixed(6),
              measurePoints[1].lon.toFixed(6),
              distanceKm.toFixed(3),
            ],
          ]);
          return;
        }
        if (measureMode === "area" && measurePoints.length >= 3) {
          const areaKm2 = sphericalPolygonAreaKm2(measurePoints);
          const rows = [["type", "vertex_index", "lat_deg", "lon_deg_e", "total_area_km2"]];
          measurePoints.forEach((point, index) => {
            rows.push([
              "area",
              index + 1,
              point.lat.toFixed(6),
              point.lon.toFixed(6),
              index === 0 ? areaKm2.toFixed(3) : "",
            ]);
          });
          downloadCsv("venus_area_measurement.csv", rows);
          return;
        }
        if (measureMode === "profile" && measureProfileSamples.length >= 2) {
          const totalDistanceKm = greatCircleDistanceKm(measurePoints[0], measurePoints[1]);
          const rows = [["sample_index", "distance_along_km", "lat_deg", "lon_deg_e", "elevation_m"]];
          measureProfileSamples.forEach((sample, index) => {
            rows.push([
              index + 1,
              ((index / (measureProfileSamples.length - 1)) * totalDistanceKm).toFixed(3),
              sample.lat.toFixed(6),
              sample.lon.toFixed(6),
              sample.elevation.toFixed(3),
            ]);
          });
          downloadCsv("venus_profile_measurement.csv", rows);
          return;
        }
        if (measureMode === "route" && measurePoints.length >= 2) {
          const routeProfile = sampleRouteProfile(measurePoints, activeMoonViewerFeature ? null : elevationSampler);
          const rows = [["type", "index", "distance_along_km", "lat_deg", "lon_deg_e", "elevation_m", "bearing_deg"]];
          measurePoints.forEach((point, index) => {
            rows.push([
              "vertex",
              index + 1,
              "",
              point.lat.toFixed(6),
              point.lon.toFixed(6),
              sampleElevationMeters(elevationSampler, point.lat, point.lon)?.toFixed?.(3) ?? "",
              index < measurePoints.length - 1 ? initialBearingDegrees(point, measurePoints[index + 1]).toFixed(3) : "",
            ]);
          });
          routeProfile.samples.forEach((sample, index) => {
            rows.push([
              "profile",
              index + 1,
              sample.distanceAlongKm.toFixed(3),
              sample.lat.toFixed(6),
              sample.lon.toFixed(6),
              sample.elevation.toFixed(3),
              "",
            ]);
          });
          downloadCsv("venus_route_measurement.csv", rows);
        }
      }
      if (gisInspectButton) {
        gisInspectButton.addEventListener("click", () => setGisMode("inspect"));
      }
      if (gisStudyActivateButton) {
        gisStudyActivateButton.addEventListener("click", () => {
          gisPanelOpen = true;
          if (gisStudySection) gisStudySection.open = true;
          setMeasureMode("area");
        });
      }
      if (gisStudySaveButton) {
        gisStudySaveButton.addEventListener("click", () => saveCurrentStudyArea());
      }
      if (gisStudyExportCsvButton) {
        gisStudyExportCsvButton.addEventListener("click", () => exportCurrentMeasurementCsv());
      }
      if (gisStudyExportGeoJsonButton) {
        gisStudyExportGeoJsonButton.addEventListener("click", () => {
          const feature = currentMeasurementGeoJSON();
          if (!feature || feature.geometry?.type !== "Polygon") {
            return;
          }
          downloadJson("mars_study_area.geojson", { type: "FeatureCollection", features: [feature] });
        });
      }
      if (gisStudyClearButton) {
        gisStudyClearButton.addEventListener("click", () => {
          if (measureMode === "area") {
            resetActiveMeasurement(true);
          }
        });
      }
      if (gisStudyGo) {
        gisStudyGo.addEventListener("click", () => restoreSelectedStudyArea());
      }
      if (gisStudyDelete) {
        gisStudyDelete.addEventListener("click", () => deleteSelectedStudyArea());
      }
      if (gisBufferGenerate) {
        gisBufferGenerate.addEventListener("click", () => generateGisBuffer());
      }
      if (gisBufferSave) {
        gisBufferSave.addEventListener("click", () => saveCurrentGisBuffer());
      }
      if (gisBufferExport) {
        gisBufferExport.addEventListener("click", () => {
          const feature = currentBufferGeoJSON();
          if (!feature) {
            return;
          }
          downloadJson("mars_buffer_zone.geojson", { type: "FeatureCollection", features: [feature] });
        });
      }
      if (gisBufferClear) {
        gisBufferClear.addEventListener("click", () => clearGisBuffer());
      }
      if (gisBufferGo) {
        gisBufferGo.addEventListener("click", () => restoreSelectedGisBuffer());
      }
      if (gisBufferDelete) {
        gisBufferDelete.addEventListener("click", () => deleteSelectedGisBuffer());
      }
      if (gisBaseCreateStudy) {
        gisBaseCreateStudy.addEventListener("click", () => {
          setToolboxTab("builder");
          createBaseFromStudyArea();
        });
      }
      if (gisBaseCreatePreset) {
        gisBaseCreatePreset.addEventListener("click", () => {
          setToolboxTab("builder");
          createPresetBaseFromInspectPoint();
        });
      }
      if (gisBaseExportJson) {
        gisBaseExportJson.addEventListener("click", () => exportActiveBaseJson());
      }
      if (gisBaseExportGeoJson) {
        gisBaseExportGeoJson.addEventListener("click", () => exportActiveBaseGeoJSON());
      }
      if (gisBaseImportJson) {
        gisBaseImportJson.addEventListener("click", () => gisBaseFileJson?.click());
      }
      if (gisBaseFileJson) {
        gisBaseFileJson.addEventListener("change", (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const payload = JSON.parse(ev.target.result);
              if (!importBaseJsonPayload(payload)) {
                alert("No valid base records were found in the JSON file.");
              }
            } catch (_) {
              alert("Base import failed. Expected a JSON object or array with base vertices.");
            }
          };
          reader.readAsText(file);
          event.target.value = "";
        });
      }
      if (gisBaseGo) {
        gisBaseGo.addEventListener("click", () => {
          activateBase(gisBaseList?.value || "");
          focusActiveBase();
        });
      }
      if (gisBaseList) {
        gisBaseList.addEventListener("change", () => activateBase(gisBaseList.value || ""));
      }
      if (gisBaseDelete) {
        gisBaseDelete.addEventListener("click", () => deleteActiveBase());
      }
      [gisBaseName, gisBaseColor, gisBaseGridSize].filter(Boolean).forEach((node) => {
        const eventName = node === gisBaseName ? "change" : "change";
        node.addEventListener(eventName, () => {
          const base = getBaseById();
          if (!base) return;
          base.name = String(gisBaseName?.value || base.name).trim() || base.name;
          base.color = gisBaseColor?.value || base.color;
          base.gridSizeM = Math.max(5, Number(gisBaseGridSize?.value || base.gridSizeM || 10));
          base.center = basePolygonCentroid(base.vertices);
          base.areaKm2 = sphericalPolygonAreaKm2(base.vertices);
          saveOrUpdateBase(base);
        });
      });
      if (gisBaseBuildingCategory) {
        gisBaseBuildingCategory.addEventListener("change", () => {
          populateBaseBuildingControls();
          syncGisPanel();
        });
      }
      if (gisBaseBuildingSelect || gisBaseBuildingRotation) {
        [gisBaseBuildingSelect, gisBaseBuildingRotation].filter(Boolean).forEach((node) => {
          node.addEventListener("change", () => syncGisPanel());
        });
      }
      if (gisBasePlaceBuilding) {
        gisBasePlaceBuilding.addEventListener("click", () => {
          if (!getBaseById()) {
            return;
          }
          gisBasePlacementMode = !gisBasePlacementMode;
          syncGisPanel();
        });
      }
      if (gisBaseRemoveBuilding) {
        gisBaseRemoveBuilding.addEventListener("click", () => removeSelectedBaseBuilding());
      }
      if (gisBaseClearBuildings) {
        gisBaseClearBuildings.addEventListener("click", () => clearActiveBaseBuildings());
      }
      if (gisBaseBuildingGo) {
        gisBaseBuildingGo.addEventListener("click", () => {
          const base = getBaseById();
          const building = (base?.buildings || []).find((entry) => entry.id === gisBaseBuildingList?.value);
          const vertices = building ? buildBaseFootprintVertices(base, building) : null;
          if (!vertices?.length) return;
          const centroid = basePolygonCentroid(vertices);
          moveCameraToFeature({
            name: `${BASE_BUILDER_CATALOG.find((entry) => entry.id === building.catalogId)?.name || "Base structure"} · ${base.name}`,
            type: "Base structure",
            lat: centroid.lat,
            lon: centroid.lon,
            description: "Placed structure footprint within the active base layout.",
            theme: "mission",
          }, camera, controls, { animate: true });
        });
      }
      if (gisQueryRun) {
        gisQueryRun.addEventListener("click", () => runGisQuery());
      }
      if (gisQueryClear) {
        gisQueryClear.addEventListener("click", () => clearGisQuery());
      }
      if (gisQueryGo) {
        gisQueryGo.addEventListener("click", () => focusSelectedQueryResult());
      }
      if (gisInspectSection) {
        gisInspectSection.hidden = true;
        gisInspectSection.open = false;
      }
      if (gisToolboxToggle) {
        gisToolboxToggle.addEventListener("click", () => toggleGisPanel());
      }
      [
        [toolboxPaneMeasure, "measure"],
        [toolboxPaneFeatures, "features"],
        [toolboxPaneBuilder, "builder"],
        [toolboxPaneRoute, "route"],
      ].forEach(([pane, tab]) => {
        if (!pane) return;
        pane.addEventListener("toggle", () => {
          if (pane.open) {
            activeToolboxTab = tab;
            toolboxPanes.forEach((otherPane) => {
              if (otherPane !== pane) {
                otherPane.open = false;
              }
            });
          } else if (activeToolboxTab === tab) {
            activeToolboxTab = "";
          }
        });
      });
      measureRailButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const mode = button.dataset.measureMode || "";
          setMeasureMode(mode);
        });
      });
      if (gisSaveViewButton) {
        gisSaveViewButton.addEventListener("click", () => {
          setToolboxTab("builder");
          gisPanelOpen = true;
          saveCurrentGisBookmark();
          syncGisPanel();
        });
      }
      if (gisBookmarkGo) {
        gisBookmarkGo.addEventListener("click", () => restoreSelectedGisBookmark());
      }
      if (gisBookmarkDelete) {
        gisBookmarkDelete.addEventListener("click", () => deleteSelectedGisBookmark());
      }
      if (gisExportPointButton) {
        gisExportPointButton.addEventListener("click", () => {
          if (!gisInspectPoint) {
            return;
          }
          downloadCsv("venus_inspect_point.csv", [
            ["lat_deg", "lon_deg_e", "elevation_m", "slope_deg", "geology"],
            [
              gisInspectPoint.lat.toFixed(6),
              gisInspectPoint.lon.toFixed(6),
              gisInspectPoint.elevationMeters !== null ? gisInspectPoint.elevationMeters.toFixed(3) : "",
              gisInspectPoint.slopeDegrees !== null ? gisInspectPoint.slopeDegrees.toFixed(3) : "",
              gisInspectPoint.geologyFeature?.rock_type || gisInspectPoint.geologyFeature?.name || "",
            ],
          ]);
        });
      }
      if (gisExportStudyButton) {
        gisExportStudyButton.addEventListener("click", () => {
          const feature = currentMeasurementGeoJSON();
          if (!feature) {
            return;
          }
          downloadJson("mars_study_geometry.geojson", {
            type: "FeatureCollection",
            features: [feature],
          });
        });
      }
      if (measureExportRouteButton) {
        measureExportRouteButton.addEventListener("click", () => exportCurrentMeasurementCsv());
      }
      gisBookmarks = loadGisBookmarks();
      gisStudyAreas = loadGisStudyAreas();
      gisBuffers = loadGisBuffers();
      gisBases = loadGisBases();
      renderGisBookmarks();
      renderGisStudyAreas();
      renderGisBuffers();
      renderGisBases();
      populateBaseBuildingControls();
      activateBase(gisBases[0]?.id || "");
      setToolboxTab(activeToolboxTab);
      syncCompareOverlay();
      syncGisPanel();

      function parseMoonRadiusKm(feature) {
        const value = Number(String(feature?.mean_radius_km || "").replace(/[^0-9.]/g, ""));
        return Number.isFinite(value) && value > 0 ? value : VENUS_MEAN_RADIUS_KM;
      }

      function cloneMeasureContext(context) {
        return {
          kind: context.kind,
          bodyName: context.bodyName,
          radiusKm: context.radiusKm,
          radiusWorld: context.radiusWorld,
          centerLocal: context.centerLocal.clone(),
        };
      }

      function getMoonMeasureContext(feature = activeMoonViewerFeature) {
        if (!feature || !moonLayer || !Array.isArray(moonLayer.entries)) {
          return null;
        }
        const entry = moonLayer.entries.find((item) => item.item?.name === feature.name);
        if (!entry) {
          return null;
        }
        return {
          kind: "moon",
          bodyName: feature.name,
          radiusKm: parseMoonRadiusKm(feature),
          radiusWorld: Number(feature.moon_radius || 0.1),
          centerLocal: entry.anchor.clone(),
          mesh: entry.moonMesh,
        };
      }

      function getActiveMeasureContext() {
        return {
          kind: "planet",
          bodyName: "Venus",
          radiusKm: VENUS_MEAN_RADIUS_KM,
          radiusWorld: 3.2,
          centerLocal: new THREE.Vector3(0, 0, 0),
          mesh: globe,
        };
      }

      function vectorToLatLonInMeasureContext(localPoint, context) {
        const relPoint = localPoint.clone().sub(context.centerLocal);
        return context.kind === "moon" ? vectorToMoonLatLon(relPoint) : vectorToLatLon(relPoint);
      }

      function normalizeMeasureHitLocalPoint(localPoint, context) {
        if (context.kind === "moon") {
          // Store in moon body frame (un-rotate by current moon self-rotation) so that
          // markers stay surface-locked as the moon spins.
          const moonAngle = getMoonBodyAngle(context.bodyName);
          const relVec = localPoint.clone().sub(context.centerLocal);
          relVec.applyEuler(new THREE.Euler(0, moonAngle, 0)); // +angle undoes rotation.y = -angle
          return context.centerLocal.clone().add(relVec);
        }
        // Store planetary measurements in the unspun body frame, then let the
        // measurement overlay rotate with Mars so markers stay surface-locked.
        return localPoint.clone().applyEuler(new THREE.Euler(0, -(globe.rotation.y - Math.PI), 0));
      }

      function isMeasureCtxMosaicBasemap() {
        return isStreamedBaseLayer(baseLayerSelect.value);
      }

      function refineMeasureHitLocalPoint(localPoint, context) {
        if (context.kind === "moon") {
          // Convert venusGroup-local hit to moon body frame so markers stay surface-locked
          // as the moon self-rotates. Without this, moonMeasureGroup.rotation.y = -moonAngle
          // would double-rotate the marker, placing it at the wrong position on click.
          const bodyPoint = normalizeMeasureHitLocalPoint(localPoint, context);
          return {
            localPoint: bodyPoint,
            latLon: vectorToLatLonInMeasureContext(bodyPoint, context),
          };
        }
        if (context.kind !== "planet") {
          return {
            localPoint,
            latLon: vectorToLatLonInMeasureContext(localPoint, context),
          };
        }
        const bodyPoint = normalizeMeasureHitLocalPoint(localPoint, context);
        const latLon = vectorToLatLonInMeasureContext(bodyPoint, context);
        if (isMeasureCtxMosaicBasemap()) {
          return {
            localPoint: bodyPoint,
            latLon,
          };
        }
        // Reproject onto the DEM-sampled surface so close-zoom measurements land on
        // the rendered terrain rather than the coarse raycast sphere approximation.
        const refinedPoint = sampleMeasureSurfacePoint(latLon.lat, latLon.lon, 0, context);
        return {
          localPoint: refinedPoint,
          latLon,
        };
      }

      function intersectAnySurface(clientX, clientY) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        const candidates = [];
        // Mars globe
        const globeHit = raycaster.intersectObject(globe, false).find((e) => e.object.visible);
        if (globeHit) candidates.push(globeHit);
        // All moon meshes (visible or not — visibility check inside)
        for (const entry of moonLayer.entries) {
          if (!entry.moonMesh.visible) continue;
          const moonHit = raycaster.intersectObject(entry.moonMesh, false).find((e) => e.object.visible);
          if (moonHit) {
            const ctx = getMoonMeasureContext(entry.item);
            if (ctx) {
              const localPoint = venusGroup.worldToLocal(moonHit.point.clone());
              const latLon = vectorToLatLonInMeasureContext(localPoint, ctx);
              candidates.push({ ...moonHit, localPoint, lat: latLon.lat, lon: latLon.lon, context: ctx });
            }
          }
        }
        if (!candidates.length) return null;
        candidates.sort((a, b) => a.distance - b.distance);
        return candidates[0];
      }

      function intersectMarsSurface(clientX, clientY) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        const intersections = raycaster.intersectObject(globe, false);
        return intersections.find((entry) => entry.object.visible) || null;
      }

      function intersectMeasurementSurface(clientX, clientY) {
        const hit = intersectAnySurface(clientX, clientY);
        if (!hit) {
          return null;
        }
        // In moon-viewer mode only accept hits on the active moon — reject clicks that
        // land on the Mars globe visible in the background.
        if (activeMoonViewerFeature && hit.context?.kind !== "moon") {
          return null;
        }
        const context = hit.context || getActiveMeasureContext();
        const hitLocalPoint = hit.localPoint ? hit.localPoint.clone() : venusGroup.worldToLocal(hit.point.clone());
        const refinedHit = refineMeasureHitLocalPoint(hitLocalPoint, context);
        const localPoint = refinedHit.localPoint;
        const latLon = refinedHit.latLon;
        return { ...hit, localPoint, lat: latLon.lat, lon: latLon.lon, context };
      }

      function getMeasurePointContext(pointLike) {
        if (pointLike?.context) {
          return pointLike.context;
        }
        return getActiveMeasureContext();
      }

      function getMeasurePointLocal(pointLike) {
        if (pointLike?.localPoint) {
          return pointLike.localPoint.clone();
        }
        if (pointLike?.point) {
          return pointLike.point.clone();
        }
        return pointLike.clone();
      }

      // Returns the current self-rotation angle for a moon (the angle used in moonMesh.rotation.y = -angle).
      function getMoonBodyAngle(bodyName) {
        if (!moonLayer) return 0;
        const entry = moonLayer.entries.find((e) => e.item?.name === bodyName);
        return entry?.item?._currentAngle ?? 0;
      }

      function getMeasurePointNormal(pointLike, context = getMeasurePointContext(pointLike)) {
        // Moon points are stored in body frame relative to moon center; normals are correct as-is.
        // moonMeasureGroup.rotation handles re-applying the moon's spin at draw time.
        return getMeasurePointLocal(pointLike).sub(context.centerLocal).normalize();
      }

      function getMeasurePointRadius(pointLike, context = getMeasurePointContext(pointLike)) {
        return getMeasurePointLocal(pointLike).sub(context.centerLocal).length();
      }

      function addMeasureMarker(pointLike, index) {
        const context = getMeasurePointContext(pointLike);
        const isMoon = context.kind === "moon";
        const inMoonViewer = Boolean(activeMoonViewerFeature);
        const isCtxMosaicBasemap = !isMoon && (isStreamedBaseLayer(baseLayerSelect.value));
        const isAreaMosaic = isCtxMosaicBasemap && measureMode === "area";
        const baseMarkerRadius = (isMoon
          ? context.radiusWorld * 0.022
          : inMoonViewer ? 0.0012 : (isCtxMosaicBasemap ? 0.028 : 0.05)) * 0.5;
        // In CTX mosaic mode lift the marker to the CTX tile surface level (surfaceLiftBase above the
        // globe sphere) so the sphere centre projects exactly to the click pixel at any viewing angle.
        // Previously lift=0 + markerEmbedFactor=1 pushed the centre below the surface; at oblique
        // angles this made the visible cap appear offset from the click position by up to ~12 px.
        const markerLift = isMoon ? context.radiusWorld * 0.02 : getMeasureDisplayLift(context);
        const surfaceAnchor = projectMeasurePoint(pointLike, markerLift);
        const surfaceNormal = (isMoon
          ? surfaceAnchor.clone().sub(context.centerLocal).normalize()
          : surfaceAnchor.clone().normalize());
        const markerEmbedFactor = 0;
        const markerPos = surfaceAnchor.clone().addScaledVector(surfaceNormal, -baseMarkerRadius * markerEmbedFactor);
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(baseMarkerRadius, 10, 10),
          new THREE.MeshBasicMaterial({
            color: 0xffd0b0,
            depthTest: false,
            depthWrite: false,
          }),
        );
        const targetGroup = isMoon ? moonMeasureGroup : measureGroup;
        marker.position.copy(markerPos);
        marker.renderOrder = 90;
        marker.frustumCulled = false;
        targetGroup.add(marker);

        // Point label ("A", "B", "C"…)
        const letter = String.fromCharCode(65 + (index || 0));
        const labelCanvas = document.createElement("canvas");
        const fontSize = isMoon ? 14 : inMoonViewer ? 10 : 26;
        labelCanvas.width = fontSize * 2;
        labelCanvas.height = fontSize * 2;
        const lctx = labelCanvas.getContext("2d");
        lctx.font = `bold ${fontSize}px sans-serif`;
        lctx.textAlign = "center";
        lctx.textBaseline = "middle";
        lctx.strokeStyle = "rgba(10,10,18,0.9)";
        lctx.lineWidth = fontSize * 0.28;
        lctx.lineJoin = "round";
        lctx.strokeText(letter, labelCanvas.width / 2, labelCanvas.height / 2);
        lctx.fillStyle = "#ffd0b0";
        lctx.fillText(letter, labelCanvas.width / 2, labelCanvas.height / 2);
        const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(labelCanvas),
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }));
        const baseSpriteScale = isMoon ? context.radiusWorld * 0.12 : inMoonViewer ? 0.0028 : 0.18;
        labelSprite.scale.set(baseSpriteScale, baseSpriteScale, 1);
        // Offset outward from globe centre so label sits just above the dot
        const outDir = markerPos.clone().normalize();
        const baseLabelOffset = isMoon ? context.radiusWorld * 0.04 : inMoonViewer ? 0.002 : (isCtxMosaicBasemap ? 0 : 0.14);
        labelSprite.position.copy(markerPos).addScaledVector(outDir, baseLabelOffset);
        labelSprite.renderOrder = 91;
        labelSprite.frustumCulled = false;
        targetGroup.add(labelSprite);

        measureVisuals.push({
          contextKind: context.kind,
          marker,
          labelSprite,
          markerAnchor: surfaceAnchor.clone(),
          surfaceNormal: surfaceNormal.clone(),
          markerEmbedFactor,
          labelDirection: outDir.clone(),
          baseMarkerRadius,
          baseSpriteScale: baseSpriteScale * (isMoon ? 0.9 : inMoonViewer ? 0.82 : 0.52),
          baseLabelOffset,
          targetMarkerPx: isMoon ? 11 : inMoonViewer ? 10 : (isCtxMosaicBasemap ? 6 : 8),
          targetLabelPx: isMoon ? 16 : inMoonViewer ? 18 : (isCtxMosaicBasemap ? 16 : 18),
          // World-space radius cap: prevents dots dominating the view at far zoom-out.
          // Once the constant-pixel-size formula would exceed this, dots shrink with distance.
          maxMarkerWorldRadius: isMoon
            ? context.radiusWorld * 0.06
            : inMoonViewer ? 0.0008 : 0.04,
        });
      }

      function updateMeasureVisualScale() {
        if (!measureVisuals.length) {
          return;
        }
        const viewportHeight = renderer.domElement.clientHeight || window.innerHeight || 1;
        const fovScale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
        const markerWorldPosition = new THREE.Vector3();
        for (const visual of measureVisuals) {
          if (!visual.marker || !visual.labelSprite) {
            continue;
          }
          visual.marker.getWorldPosition(markerWorldPosition);
          const distance = Math.max(camera.position.distanceTo(markerWorldPosition), 0.001);
          const worldUnitsPerPixel = distance / Math.max(fovScale, 0.001);
          const baseMarkerRadius = Math.max(visual.baseMarkerRadius, 1e-6);
          // Constant-pixel-size scale, then clamp by max world radius so dots don't
          // inflate relative to the body at far zoom-out.
          const rawMarkerScale = (worldUnitsPerPixel * visual.targetMarkerPx) / baseMarkerRadius;
          const maxMarkerScale = visual.maxMarkerWorldRadius / baseMarkerRadius;
          const markerScale = Math.min(rawMarkerScale, maxMarkerScale);
          const rawSpriteScale = worldUnitsPerPixel * visual.targetLabelPx;
          const maxSpriteScale = visual.maxMarkerWorldRadius
            * (visual.targetLabelPx / Math.max(visual.targetMarkerPx, 1));
          const spriteScale = Math.min(rawSpriteScale, maxSpriteScale);
          // FLIGHT-SIM: attenuate constant-pixel labels with distance in
          // flight so far-horizon labels recede naturally (~48 km full size,
          // floor 16%).
          let mScale = markerScale, sScale = spriteScale;
          if (window.__flightSim?.active) {
            const f = Math.min(1, Math.max(0.16, 0.045 / distance));
            mScale *= f; sScale *= f;
          }
          visual.marker.scale.setScalar(mScale);
          visual.marker.position.copy(visual.markerAnchor).addScaledVector(
            visual.surfaceNormal,
            -(baseMarkerRadius * mScale * (visual.markerEmbedFactor || 0)),
          );
          visual.labelSprite.scale.set(sScale, sScale, 1);
          visual.labelSprite.position.copy(visual.markerAnchor).addScaledVector(
            visual.labelDirection,
            visual.baseLabelOffset * ((mScale + sScale) * 0.5),
          );
        }
      }

      /**
       * A measure marker's lift, scaled to the viewing distance.
       *
       * A lift is an altitude and an altitude parallaxes. The flat 0.012 this
       * replaces is 23.9 km above the ground: looking straight down it costs
       * nothing, which is why it survived, but measured on Earth's identical
       * copy at 4 km altitude it put markers 235, 248 and 334 px from the click.
       * A fixed fraction of the distance to the surface holds the parallax to a
       * constant small angle at every scale; the ceiling keeps the far view
       * exactly as it was.
       */
      function measureDisplayLiftForView() {
        const surfaceDistance = Math.max(1e-6, camera.position.length() - 3.2);
        return Math.max(5e-7, Math.min(surfaceDistance * 0.0015, 0.012));
      }

      function measureSurfaceRadius(latDegrees, lonDegrees, lift = measureDisplayLiftForView(), context = getActiveMeasureContext()) {
        if (context.kind === "moon") {
          return context.radiusWorld + lift;
        }
        // The relief the body is DRAWN with, not the slider's raw value --
        // getEffectiveTerrainRelief zeroes it for the CTX mosaic, and reading
        // the slider instead put measure points on terrain no longer there.
        const relief = elevationMap ? getEffectiveTerrainRelief() : 0;
        const displacement = elevationMap ? sampleElevationNormalized(elevationSampler, latDegrees, lonDegrees) * relief : 0;
        return 3.2 + displacement + lift;
      }

      function sampleMeasureSurfacePoint(latDegrees, lonDegrees, lift = measureDisplayLiftForView(), context = getActiveMeasureContext()) {
        const point = context.kind === "moon"
          ? moonLatLonToVector3(latDegrees, lonDegrees, measureSurfaceRadius(latDegrees, lonDegrees, lift, context))
          : latLonToVector3(latDegrees, lonDegrees, measureSurfaceRadius(latDegrees, lonDegrees, lift, context));
        return context.kind === "moon" ? point.add(context.centerLocal) : point;
      }

      function getMeasureDisplayLift(context = getActiveMeasureContext()) {
        if (context.kind === "moon") {
          return context.radiusWorld * 0.02;
        }
        if (isMeasureCtxMosaicBasemap()) {
          return Math.max(0.00012, ctxDetailStreamer.surfaceLiftBase);
        }
        return measureDisplayLiftForView();
      }

      function projectMeasurePoint(pointLike, lift = measureDisplayLiftForView()) {
        const context = getMeasurePointContext(pointLike);
        const localPoint = getMeasurePointLocal(pointLike);
        if (context.kind === "moon") {
          // Position relative to moon center (body frame) — moonMeasureGroup applies the rotation.
          return localPoint.clone().sub(context.centerLocal).normalize().multiplyScalar(context.radiusWorld + lift);
        }
        // Use the exact refined local hit point that was stored on click rather than
        // converting through lat/lon again, which loses XYZ precision on the surface.
        const surfaceNormal = localPoint.clone().normalize();
        return localPoint.clone().addScaledVector(surfaceNormal, lift);
      }

      function buildMeasureArcPoints(startPoint, endPoint) {
        const context = getMeasurePointContext(startPoint);
        const startVec = getMeasurePointNormal(startPoint, context);
        const endVec = getMeasurePointNormal(endPoint, context);
        const angle = Math.acos(clamp(startVec.dot(endVec), -1, 1));
        const segmentCount = Math.max(40, Math.ceil((angle / Math.PI) * 96));
        const lineLift = context.kind === "planet" ? getMeasureDisplayLift(context) : context.radiusWorld * 0.02;
        const useExactRadiusBlend = context.kind === "planet" && isMeasureCtxMosaicBasemap();
        const startRadius = useExactRadiusBlend ? getMeasurePointRadius(startPoint, context) : 0;
        const endRadius = useExactRadiusBlend ? getMeasurePointRadius(endPoint, context) : 0;
        const points = [];
        for (let index = 0; index <= segmentCount; index += 1) {
          const t = segmentCount === 0 ? 0 : index / segmentCount;
          let point;
          if (angle < 1e-5) {
            point = startVec.clone();
          } else {
            const sinTotal = Math.sin(angle);
            point = startVec.clone().multiplyScalar(Math.sin((1 - t) * angle) / sinTotal)
              .add(endVec.clone().multiplyScalar(Math.sin(t * angle) / sinTotal))
              .normalize();
          }
          if (context.kind === "moon") {
            // Relative to moon center (body frame) — moonMeasureGroup applies the offset + rotation.
            points.push(point.clone().multiplyScalar(context.radiusWorld + context.radiusWorld * 0.02));
          } else {
            if (useExactRadiusBlend) {
              const radius = THREE.MathUtils.lerp(startRadius, endRadius, t) + lineLift;
              points.push(point.clone().multiplyScalar(radius));
            } else {
              const latLon = vectorToLatLon(point);
              points.push(sampleMeasureSurfacePoint(latLon.lat, latLon.lon, lineLift, context));
            }
          }
        }
        if (points.length >= 2 && context.kind === "planet") {
          points[0] = projectMeasurePoint(startPoint, lineLift);
          points[points.length - 1] = projectMeasurePoint(endPoint, lineLift);
        }
        return points;
      }

      function buildMeasureBoundaryPoints(points) {
        if (points.length < 2) {
          return [];
        }
        const boundaryPoints = [];
        for (let index = 0; index < points.length; index += 1) {
          const current = points[index];
          const next = points[(index + 1) % points.length];
          const arcPoints = buildMeasureArcPoints(current, next);
          if (index > 0) {
            arcPoints.shift();
          }
          boundaryPoints.push(...arcPoints);
        }
        return boundaryPoints;
      }

      function sampleMeasureSlerpPoint(startPoint, endPoint, t, lift = 0.01, context = getMeasurePointContext(startPoint)) {
        const startVec = getMeasurePointNormal(startPoint, context);
        const endVec = getMeasurePointNormal(endPoint, context);
        const angle = Math.acos(clamp(startVec.dot(endVec), -1, 1));
        let point;
        if (angle < 1e-5) {
          point = startVec.clone();
        } else {
          const sinTotal = Math.sin(angle);
          point = startVec.clone().multiplyScalar(Math.sin((1 - t) * angle) / sinTotal)
            .add(endVec.clone().multiplyScalar(Math.sin(t * angle) / sinTotal))
            .normalize();
        }
        if (context.kind === "moon") {
          // Relative to moon center (body frame) — moonMeasureGroup applies offset + rotation.
          return point.clone().multiplyScalar(context.radiusWorld + lift);
        }
        const latLon = vectorToLatLon(point);
        return sampleMeasureSurfacePoint(latLon.lat, latLon.lon, lift, context);
      }

      function buildAreaFillMesh(points) {
        if (points.length < 3) {
          return null;
        }
        const context = getMeasurePointContext(points[0]);
        const positions = [];
        const boundary = buildMeasureBoundaryPoints(points);
        if (boundary.length < 3) {
          return null;
        }
        if (context.kind === "moon") {
          // For moons, fan-triangulate directly from the boundary arc points (which are
          // already proven to land on the moon surface) rather than computing a separate
          // centroid-based fill that can diverge due to coordinate frame differences.
          const origin = boundary[0];
          for (let i = 1; i < boundary.length - 1; i += 1) {
            const a = origin;
            const b = boundary[i];
            const c = boundary[i + 1];
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
          }
        } else {
          const fillLift = getMeasureDisplayLift(context);
          const centerNormal = boundary.reduce((acc, point) => (
            acc.add(point.clone().normalize())
          ), new THREE.Vector3()).normalize();
          if (centerNormal.lengthSq() < 1e-10) {
            return null;
          }
          let center;
          if (context.kind === "moon") {
            center = centerNormal.multiplyScalar(context.radiusWorld + fillLift);
          } else {
            const centerLatLon = vectorToLatLon(centerNormal);
            center = sampleMeasureSurfacePoint(centerLatLon.lat, centerLatLon.lon, fillLift, context);
          }
          for (let index = 0; index < boundary.length; index += 1) {
            const currentPoint = boundary[index];
            const nextPoint = boundary[(index + 1) % boundary.length];
            positions.push(
              center.x, center.y, center.z,
              currentPoint.x, currentPoint.y, currentPoint.z,
              nextPoint.x, nextPoint.y, nextPoint.z,
            );
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: 0x58d0f6,
            transparent: true,
            opacity: 0.24,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
          }),
        );
        mesh.renderOrder = 80;
        mesh.frustumCulled = false;
        return mesh;
      }

      function updateMeasureVisualization() {
        clearMeasureGroup();
        syncMeasureRailActions();
        if (!measurePoints.length) {
          measurePanel.hidden = !measureMode || measureMode === "route";
          measureMetric.innerHTML = "";
          hideMeasurementResultCard();
          profileCanvas.hidden = true;
          if (routeMetric) {
            routeMetric.innerHTML = measureMode === "route" ? "No active route." : routeMetric.innerHTML;
          }
          if (routeProfileCanvas) {
            routeProfileCanvas.hidden = true;
          }
          hideProfileModal();
          measureProfileSamples = [];
          syncGisPanel();
          return;
        }
        measurePanel.hidden = measureMode === "route";
        // Route moon measurement geometry to moonMeasureGroup (which rotates with the moon).
        const _measureIsMoon = measurePoints[0]?.context?.kind === "moon";
        const _measureTargetGroup = _measureIsMoon ? moonMeasureGroup : measureGroup;
        measurePoints.forEach((item, idx) => addMeasureMarker(item, idx));
        if (measurePoints.length >= 2 && measureMode !== "area") {
          let linePoints = [];
          if (measureMode === "route") {
            for (let index = 0; index < measurePoints.length - 1; index += 1) {
              const arcPoints = buildMeasureArcPoints(measurePoints[index], measurePoints[index + 1]);
              if (index > 0) {
                arcPoints.shift();
              }
              linePoints.push(...arcPoints);
            }
          } else {
            linePoints = buildMeasureArcPoints(measurePoints[0], measurePoints[1]);
          }
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(linePoints),
            new THREE.LineBasicMaterial({
              color: 0xffcf9d,
              transparent: true,
              opacity: 0.98,
              depthTest: false,
              depthWrite: false,
            }),
          );
          line.renderOrder = 95;
          line.frustumCulled = false;
          _measureTargetGroup.add(line);
        }
        if (measureMode === "distance" && measurePoints.length >= 2) {
          setToolboxTab("measure");
          const distanceKm = greatCircleDistanceKm(measurePoints[0], measurePoints[1]);
          const startSlope = measurePoints[0].bodyKind === "planet"
            ? estimateSurfaceSlopeDegrees(elevationSampler, measurePoints[0].lat, measurePoints[0].lon)
            : null;
          const endSlope = measurePoints[1].bodyKind === "planet"
            ? estimateSurfaceSlopeDegrees(elevationSampler, measurePoints[1].lat, measurePoints[1].lon)
            : null;
          measureMetric.innerHTML = [
            `Start slope ${startSlope !== null ? startSlope.toFixed(1) : "n/a"}°`,
            `End slope ${endSlope !== null ? endSlope.toFixed(1) : "n/a"}°`,
            `Bearing ${initialBearingDegrees(measurePoints[0], measurePoints[1]).toFixed(1)}°`,
          ].join("<br>");
          showMeasurementResultCard(`Distance: ${distanceKm.toFixed(1)} km`, measureMetric.innerHTML, toolRailDistanceButton);
          measureProfileSamples = [];
          profileCanvas.hidden = true;
          hideProfileModal();
        } else if (measureMode === "area" && measurePoints.length >= 3) {
          setToolboxTab("features");
          if (gisStudySection) gisStudySection.open = true;
          const boundaryPoints = buildMeasureBoundaryPoints(measurePoints);
          const fillMesh = buildAreaFillMesh(measurePoints);
          if (fillMesh) {
            _measureTargetGroup.add(fillMesh);
          }
          const closingPoints = [...boundaryPoints, boundaryPoints[0]];
          const polygonLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(closingPoints),
            new THREE.LineBasicMaterial({
              color: 0x58d0f6,
              transparent: true,
              opacity: 0.98,
              depthTest: false,
              depthWrite: false,
            }),
          );
          polygonLine.renderOrder = 96;
          polygonLine.frustumCulled = false;
          _measureTargetGroup.add(polygonLine);
          const areaKm2 = sphericalPolygonAreaKm2(measurePoints);
          const stats = computeStudyAreaStats(measurePoints, elevationSampler, geologyInteractiveState);
          const geologyName = stats?.geologyFeature?.rock_type || stats?.geologyFeature?.name || "No mapped geology";
          measureMetric.innerHTML = [
            `Perimeter ${stats?.perimeterKm?.toFixed(1) ?? "n/a"} km`,
            `Mean elevation ${stats?.meanElevation !== null && stats?.meanElevation !== undefined ? stats.meanElevation.toFixed(0) : "n/a"} m`,
            `Mean slope ${stats?.meanSlope !== null && stats?.meanSlope !== undefined ? stats.meanSlope.toFixed(1) : "n/a"}°`,
            `Geology ${geologyName}`,
          ].join("<br>");
          showMeasurementResultCard(`Study Area: ${areaKm2.toFixed(0)} km²`, measureMetric.innerHTML, toolRailAreaButton);
          measureProfileSamples = [];
          profileCanvas.hidden = true;
          hideProfileModal();
        } else if (measureMode === "route" && measurePoints.length >= 2) {
          const routeProfile = sampleRouteProfile(measurePoints, activeMoonViewerFeature ? null : elevationSampler);
          measureProfileSamples = routeProfile.samples;
          const elevations = routeProfile.samples.map((sample) => sample.elevation);
          const min = elevations.length ? Math.min(...elevations) : 0;
          const max = elevations.length ? Math.max(...elevations) : 0;
          const startBearing = initialBearingDegrees(measurePoints[0], measurePoints[1]);
          const endBearing = initialBearingDegrees(measurePoints[measurePoints.length - 2], measurePoints[measurePoints.length - 1]);
          if (routeMetric) {
            routeMetric.innerHTML = [
              `<strong>${measurePoints[0].bodyName || "Venus"} route</strong>: ${routeProfile.totalDistanceKm.toFixed(1)} km`,
              `Segments ${Math.max(0, measurePoints.length - 1)}`,
              `Elevation gain ${routeProfile.elevationGainM.toFixed(0)} m`,
              `Elevation loss ${routeProfile.elevationLossM.toFixed(0)} m`,
              `Profile min/max ${min.toFixed(0)} / ${max.toFixed(0)} m`,
              `Bearing ${startBearing.toFixed(1)}° → ${endBearing.toFixed(1)}°`,
            ].join("<br>");
          }
          if (routeProfileCanvas) {
            routeProfileCanvas.hidden = true;
          }
          measureMetric.innerHTML = [
            `<strong>${measurePoints[0].bodyName || "Venus"} route</strong>: ${routeProfile.totalDistanceKm.toFixed(1)} km`,
            `Segments ${Math.max(0, measurePoints.length - 1)}`,
            `Elevation gain ${routeProfile.elevationGainM.toFixed(0)} m`,
            `Elevation loss ${routeProfile.elevationLossM.toFixed(0)} m`,
            `Profile min/max ${min.toFixed(0)} / ${max.toFixed(0)} m`,
            `Bearing ${startBearing.toFixed(1)}° → ${endBearing.toFixed(1)}°`,
          ].join("<br>");
          showMeasurementResultCard("Route", measureMetric.innerHTML);
          profileCanvas.hidden = true;
          showProfileModal(
            `${measurePoints[0].bodyName || "Venus"} Route Profile`,
            `Distance ${routeProfile.totalDistanceKm.toFixed(1)} km · Gain ${routeProfile.elevationGainM.toFixed(0)} m · Loss ${routeProfile.elevationLossM.toFixed(0)} m · Elevation ${min.toFixed(0)} to ${max.toFixed(0)} m`,
            routeProfile.samples.map((sample) => ({ ...sample, distanceAlongKm: sample.distanceAlongKm })),
          );
        } else if (measureMode === "profile" && measurePoints.length >= 2) {
          setToolboxTab("measure");
          const profileSampler = activeMoonViewerFeature ? null : elevationSampler;
          const samples = sampleGreatCircleProfile(measurePoints[0], measurePoints[1], profileSampler);
          measureProfileSamples = samples;
          const elevations = samples.map((sample) => sample.elevation);
          const min = Math.min(...elevations);
          const max = Math.max(...elevations);
          measureMetric.innerHTML = `Profile: min ${min.toFixed(0)} m, max ${max.toFixed(0)} m, relief ${(max - min).toFixed(0)} m`;
          hideMeasurementResultCard();
          profileCanvas.hidden = true;
          showProfileModal(
            `${measurePoints[0].bodyName || "Venus"} Elevation Profile`,
            `Min ${min.toFixed(0)} m · Max ${max.toFixed(0)} m · Relief ${(max - min).toFixed(0)} m`,
            samples,
          );
          measureRailExportButtons.forEach((button) => {
            if (button.dataset.measureExport === "profile") {
              button.disabled = measureProfileSamples.length < 2;
            }
          });
        } else {
          measureMetric.innerHTML = "Add more points to complete this measurement.";
          hideMeasurementResultCard();
          measureProfileSamples = [];
          profileCanvas.hidden = true;
          hideProfileModal();
          measureRailExportButtons.forEach((button) => {
            if (button.dataset.measureExport === "profile") {
              button.disabled = true;
            }
          });
        }
        syncGisPanel();
      }

      function syncMeasureRailActions() {
        const activeModes = ["distance", "area", "profile"];
        const canExport = {
          distance: measurePoints.length >= 2,
          area: measurePoints.length >= 3,
          profile: measureProfileSamples.length >= 2,
        };
        measureRailActionGroups.forEach((group) => {
          const mode = group.dataset.measureActions;
          const isActive = measureMode === mode;
          group.hidden = !(activeModes.includes(mode) && isActive);
        });
        measureRailExportButtons.forEach((button) => {
          const mode = button.dataset.measureExport;
          const exportLabel = mode === "area"
            ? "Export Area CSV"
            : mode === "distance"
              ? "Export Distance CSV"
              : "Export Profile CSV";
          button.disabled = !canExport[mode];
          button.textContent = "Export CSV";
          button.title = exportLabel;
          button.setAttribute("aria-label", exportLabel);
        });
      }

      const coreLabelsToggle = document.getElementById("core-labels-toggle");
      if (coreLabelsToggle) {
        coreLabelsToggle.addEventListener("change", () => {
          updateCoreLabelVisibility(cutawayResult, camera, coreLabelsToggle.checked);
        });
      }

      let geologyGlobe = null;
      let geologyMaterial = null;
      let mineralGlobe = null;
      let mineralMaterial = null;
      let seaGlobe = null;
      let seaMaterial = null;
      let regionMaskGlobe = null;
      let regionMaskMaterial = null;
      const initialGeologyTexture = geologyTextures.get(initialGeologyLayer.id) || null;
      if (initialGeologyTexture) {
        geologyMaterial = new THREE.MeshStandardMaterial({
          map: initialGeologyTexture,
          displacementMap: elevationMap || null,
          displacementScale: elevationMap ? Number(terrainScale.value) : 0,
          transparent: true,
          opacity: Number(geologyOpacity.value),
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -10,
          polygonOffsetUnits: -10,
          roughness: 1,
          metalness: 0,
        });

        geologyGlobe = new THREE.Mesh(
          new THREE.SphereGeometry(3.202, 128, 128),
          geologyMaterial,
        );
        geologyGlobe.renderOrder = 45;
        geologyGlobe.rotation.y = Math.PI;
        venusGroup.add(geologyGlobe);
      } else {
        geologyOpacity.disabled = true;
      }

      mineralMaterial = new THREE.MeshStandardMaterial({
        map: null,
        displacementMap: elevationMap || null,
        displacementScale: elevationMap ? Number(terrainScale.value) : 0,
        transparent: true,
        opacity: Number(mineralOpacity.value),
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        roughness: 1,
        metalness: 0,
      });
      mineralGlobe = new THREE.Mesh(
        new THREE.SphereGeometry(3.204, 128, 128),
        mineralMaterial,
      );
      mineralGlobe.renderOrder = 6;
      mineralGlobe.rotation.y = Math.PI;
      mineralGlobe.visible = false;
      venusGroup.add(mineralGlobe);

      const seaOverlayState = _earlySeaOverlayState;
      if (seaOverlayState) {
        updateSeaOverlayTexture(seaOverlayState, Number(seaLevelSlider.value));
        seaMaterial = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: seaOverlayState.texture,
          displacementMap: elevationMap || null,
          displacementScale: elevationMap ? Number(terrainScale.value) : 0,
          transparent: true,
          opacity: 0.76,
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -6,
          polygonOffsetUnits: -6,
          roughness: 0.24,
          metalness: 0.02,
          emissive: new THREE.Color(0x123d54),
          emissiveIntensity: 0.2,
        });
        seaGlobe = new THREE.Mesh(
          new THREE.SphereGeometry(3.206, 128, 128),
          seaMaterial,
        );
        seaGlobe.renderOrder = 46;
        seaGlobe.rotation.y = Math.PI;
        seaGlobe.visible = seaToggle.checked;
        venusGroup.add(seaGlobe);
      } else {
        seaToggle.checked = false;
        seaToggle.disabled = true;
        seaLevelSlider.disabled = true;
        seaLevelCopy.hidden = false;
        seaLevelCopy.textContent = "Paleo-sea overlay unavailable because the elevation raster could not be loaded.";
      }

      if (elevationSampler) {
        const initialRegionTexture = createRegionMaskTexture(regionMaskSelect.value, elevationSampler);
        regionMaskMaterial = new THREE.MeshStandardMaterial({
          map: initialRegionTexture,
          displacementMap: elevationMap || null,
          displacementScale: elevationMap ? Number(terrainScale.value) : 0,
          transparent: true,
          opacity: Number(regionMaskOpacity.value),
          depthTest: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
          roughness: 1,
          metalness: 0,
        });
        regionMaskGlobe = new THREE.Mesh(
          new THREE.SphereGeometry(3.208, 128, 128),
          regionMaskMaterial,
        );
        regionMaskGlobe.renderOrder = 7;
        regionMaskGlobe.rotation.y = Math.PI;
        regionMaskGlobe.visible = Boolean(regionMaskSelect.value);
        venusGroup.add(regionMaskGlobe);
      } else {
        regionMaskSelect.disabled = true;
        regionMaskOpacity.disabled = true;
      }

      function syncMoonViewerForegroundState() {
        if (!moonLayer || !Array.isArray(moonLayer.entries)) {
          return;
        }
        const activeMoonName = activeMoonViewerFeature?.name || null;
        for (const entry of moonLayer.entries) {
          const isActiveMoon = Boolean(activeMoonName) && entry.item?.name === activeMoonName;
          entry.moonMesh.renderOrder = isActiveMoon ? 140 : 0;
          if (entry.moonMesh.material) {
            entry.moonMesh.material.depthTest = true;
            entry.moonMesh.material.depthWrite = !isActiveMoon;
            entry.moonMesh.material.depthFunc = isActiveMoon ? THREE.AlwaysDepth : THREE.LessEqualDepth;
            entry.moonMesh.material.transparent = isActiveMoon;
            entry.moonMesh.material.opacity = 1;
            entry.moonMesh.material.needsUpdate = true;
          }
        }
      }


      function applyPlanetDisplayState() {
        // Rocky planet — globe is always visible; no "remove atmosphere" concept.
        const removeAtmosphere = false;
        const coreEnabled = Boolean(coreToggle && coreToggle.checked);
        const venusLabelsEnabled = labelsToggle.checked && !activeMoonViewerFeature;
        globe.visible = true;
        // Solid interior helper (gas-planet holdover) is never shown for rocky planets.
        // to avoid triggering expensive MeshPhysicalMaterial shader compilations.
        venusSolidInteriorGroup.visible = false; // never shown for rocky planets
        if (venusSolidInterior.metallicHydrogenCapMesh) {
          venusSolidInterior.metallicHydrogenCapMesh.visible = false;
        }
        if (venusSolidInterior.heavyElementCoreCapMesh) {
          venusSolidInterior.heavyElementCoreCapMesh.visible = false;
        }
        for (const material of venusInteriorSphereMaterials) {
          material.clippingPlanes = [];
          material.needsUpdate = true;
        }
        for (const material of venusInteriorCapMaterials) {
          material.clippingPlanes = [];
          material.needsUpdate = true;
        }
        if (baseMaterial) {
          const _bTex = !removeAtmosphere ? (getLayerTextureById(baseLayerSelect.value) || layerTextures.get("venus-surface") || null) : null;
          baseMaterial.map = _bTex;
          baseMaterial.color.set(!removeAtmosphere ? (_bTex ? 0xffffff : 0xd0b18a) : 0x6f675f);
          baseMaterial.needsUpdate = true;
        }
        if (compareGlobe) {
          compareGlobe.visible = !removeAtmosphere && !coreEnabled && Boolean(compareMaterial.map);
        }
        if (ctxFocusGlobe) {
          ctxFocusGlobe.visible = false;
        }
        if (geologyGlobe) {
          geologyGlobe.visible = geologyToggle.checked;
        }
        geologyContactLayer.group.visible = geologyContactsToggle.checked && geologyContactLayer.available;
        geologyStructureLayer.group.visible = geologyStructureLayers.some((facet) => facet.layer.group.visible);
        if (mineralGlobe) {
          mineralGlobe.visible = Boolean(mineralSelect.value);
        }
        if (seaGlobe) {
          seaGlobe.visible = !removeAtmosphere && seaToggle.checked;
        }
        if (regionMaskGlobe) {
          regionMaskGlobe.visible = !removeAtmosphere && Boolean(regionMaskSelect.value);
        }
        if (selectedGeologyOutline && selectedGeologyOutline.mesh) {
          selectedGeologyOutline.mesh.visible = false;
        }
        if (selectedGeologyBoundaryGroup) {
          selectedGeologyBoundaryGroup.visible = false;
        }
        syncMoonViewerForegroundState();
        // Keep the outer globe as the visible exterior skin, but preserve the upper-atmosphere
        // cut boundary and cut face in normal core view so the outer layer actually exists.
        const showUpperAtmosphereCut = coreEnabled && !removeAtmosphere;
        if (cutawayResult.atmosphereMesh) cutawayResult.atmosphereMesh.visible = false;
        if (cutawayResult.atmosphereBoundaryMesh) cutawayResult.atmosphereBoundaryMesh.visible = showUpperAtmosphereCut;
        if (cutawayResult.crustRing) cutawayResult.crustRing.visible = showUpperAtmosphereCut;
        // Molecular envelope: only when core active AND atmosphere NOT removed.
        const showMolecular = coreEnabled && !removeAtmosphere;
        if (cutawayResult.molecularEnvelopeMesh) cutawayResult.molecularEnvelopeMesh.visible = showMolecular;
        if (cutawayResult.molecularEnvelopeRing) cutawayResult.molecularEnvelopeRing.visible = showMolecular;
        // molecularBoundaryMesh = outer convex fill for metallic H layer: visible whenever core active.
        if (cutawayResult.molecularBoundaryMesh) cutawayResult.molecularBoundaryMesh.visible = coreEnabled;
        // Inner layers: always visible when core view is active (cutawayGroup visibility handles the rest).
        if (cutawayResult.metallicHydrogenMesh) cutawayResult.metallicHydrogenMesh.visible = coreEnabled;
        if (cutawayResult.heavyElementCoreMesh) cutawayResult.heavyElementCoreMesh.visible = coreEnabled;
        if (cutawayResult.metallicHydrogenRing) cutawayResult.metallicHydrogenRing.visible = coreEnabled;
        if (cutawayResult.metallicHydrogenCapMesh) cutawayResult.metallicHydrogenCapMesh.visible = coreEnabled;
        if (cutawayResult.heavyElementCoreCapMesh) cutawayResult.heavyElementCoreCapMesh.visible = coreEnabled;
        updateLabelVisibility(
          labelLayer.entries,
          venusGroup,
          globe,
          camera,
          renderer,
          venusLabelsEnabled,
          !removeAtmosphere && volcanicLabelsToggle.checked,
          !removeAtmosphere && landingLabelsToggle.checked,
          !removeAtmosphere && habitationLabelsToggle.checked,
          coreEnabled,
          isStreamedBaseLayer(baseLayerSelect.value),
          Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
          !removeAtmosphere && (craterLabelsToggle?.checked ?? true),
          !removeAtmosphere && (fluvialLabelsToggle?.checked ?? true),
          !removeAtmosphere && (tectonicLabelsToggle?.checked ?? true),
        
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
          // FLIGHT-SIM: snapshot each label's declutter verdict so the horizon
          // pass in render() has a stable source of truth to restore from.
          if (window.__flightSim?.active) {
            for (const e of labelLayer.entries) e._fsBaseVisible = e.sprite ? e.sprite.visible : false;
          }
        updateLabelVisibility(
          baseSiteLayer.entries,
          venusGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked && !activeMoonViewerFeature,
          true,
          true,
          true,
          coreEnabled,
          isStreamedBaseLayer(baseLayerSelect.value),
          Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
          craterLabelsToggle?.checked ?? true,
          fluvialLabelsToggle?.checked ?? true,
          tectonicLabelsToggle?.checked ?? true,
        
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
        baseSiteLayer.group.visible = Boolean(baseLabelsToggle?.checked) && !activeMoonViewerFeature;
        updateCoreLabelVisibility(cutawayResult, camera, Boolean(coreLabelsToggle && coreLabelsToggle.checked));
        moonFeatureLabelLayer.group.visible = labelsToggle.checked;
      }

      function syncTerrainReliefState() {
        const nextTerrainRelief = getEffectiveTerrainRelief();
        applyTerrainRelief(
          nextTerrainRelief,
          elevationMap,
          baseMaterial,
          geologyMaterial,
          mineralMaterial,
          seaMaterial,
          regionMaskMaterial,
          cutawayResult,
          ctxFocusMaterial,
        );
        if (compareMaterial) {
          compareMaterial.displacementScale = nextTerrainRelief;
          compareMaterial.needsUpdate = true;
        }
        ctxDetailStreamer.rebuild();
        contourLineLayer.updateRelief();
        if (selectedGeologyOutline && selectedGeologyOutline.mesh && selectedGeologyOutline.mesh.material) {
          selectedGeologyOutline.mesh.material.displacementScale = nextTerrainRelief;
          selectedGeologyOutline.mesh.material.needsUpdate = true;
        }
        updateGeologyVectorLayer(geologyContactLayer);
        updateGeologyVectorLayer(geologyStructureLayer);
        updateLabelAnchors(labelLayer, elevationSampler, labelElevationCache, getTerrainRelief, 3.2, getReliefPoint);
        updateLabelAnchors(baseSiteLayer, elevationSampler, labelElevationCache, getTerrainRelief, 3.2, getReliefPoint);
        renderActiveBaseOverlay();
        if (typeof updateSeismicAnchors === "function" && typeof seismicLayer !== "undefined" && typeof seismicElevationCache !== "undefined") {
          updateSeismicAnchors(seismicLayer, elevationSampler, seismicElevationCache, getTerrainRelief, 3.2);
        }
        if (terrainScale) {
          terrainScale.disabled = Boolean(coreToggle?.checked) || !elevationMap || isStreamedBaseLayer(baseLayerSelect.value);
        }
      }

      function updateGeologyVisibility() {
        if (geologyGlobe) {
          geologyGlobe.visible = geologyToggle.checked;
        }
        geologyContactLayer.group.visible = geologyContactsToggle.checked && geologyContactLayer.available;
        geologyStructureLayer.syncVisibility();
        if (mineralGlobe) {
          mineralGlobe.visible = Boolean(mineralSelect.value);
        }
        applyPlanetDisplayState();
      }

      function syncBasemapVisibility() {
        const nextLayer = baseLayers.find((layer) => layer.id === baseLayerSelect.value);
        if (dynamicHillshadeTexture && baseLayerSelect.value !== "derived-hillshade") {
          dynamicHillshadeTexture.dispose();
          dynamicHillshadeTexture = null;
        }
        const nextTexture = nextLayer ? getLayerTextureById(nextLayer.id) : null;
        if (!nextTexture && nextLayer?.path && layerTextures.get(nextLayer.id) === null) {
          _loadBaseLayerOnDemand(nextLayer.id);
        }
        const _fallbackTex = nextTexture || layerTextures.get("venus-surface") || null;
        baseMaterial.map = _fallbackTex;
        baseMaterial.color.set(_fallbackTex ? 0xffffff : 0xd0b18a);
        baseMaterial.needsUpdate = true;
        if (hillshadeControls) {
          hillshadeControls.hidden = baseLayerSelect.value !== "derived-hillshade";
        }
        if (cutawayResult.crustRing && cutawayResult.crustRing.material && cutawayResult.crustRing.material.uniforms && cutawayResult.crustRing.material.uniforms.uMap) {
          cutawayResult.crustRing.material.uniforms.uMap.value = nextTexture || null;
        }
        if (isStreamedBaseLayer(baseLayerSelect.value)) {
          ctxStreamer.activate();
          ctxFocusGlobe.visible = false;
        } else {
          applyPlanetViewMode("tilted");
          ctxStreamer.deactivate();
          ctxDetailStreamer.deactivate();
          ctxFocusGlobe.visible = false;
        }
        if (ctxFocusMaterial?.userData?.ctxShader) {
          const shader = ctxFocusMaterial.userData.ctxShader;
          if (isStreamedBaseLayer(baseLayerSelect.value)) {
            shader.uniforms.uCtxColorMap.value = layerTextures.get("venus-surface") || null;
            shader.uniforms.uCtxColorMix.value = 1.0;
            shader.uniforms.uCtxColorLift.value = 1.15;
          } else {
            shader.uniforms.uCtxColorMap.value = null;
            shader.uniforms.uCtxColorMix.value = 0.0;
            shader.uniforms.uCtxColorLift.value = 1.0;
          }
        }
        syncTerrainReliefState();
        syncCompareOverlay();
        applyPlanetDisplayState();
      }

      function syncContourOverlay() {
        if (!contourIntervalSelect) {
          return;
        }
        const interval = Number(contourIntervalSelect.value || 0);
        if (!interval || !elevationSampler) {
          contourGlobe.visible = false;
          contourMaterial.map = null;
          contourMaterial.alphaMap = null;
          contourMaterial.needsUpdate = true;
          contourLineLayer.clear();
          if (baseMaterial?.userData?.contourShader) {
            const shader = baseMaterial.userData.contourShader;
            shader.uniforms.uContourMap.value = null;
            shader.uniforms.uContourEnabled.value = 0;
          }
          if (ctxFocusMaterial?.userData?.ctxShader) {
            const shader = ctxFocusMaterial.userData.ctxShader;
            shader.uniforms.uContourMap.value = null;
            shader.uniforms.uContourEnabled.value = 0;
          }
          ctxDetailStreamer.setContourOverlay(null, Number(contourOpacity?.value || 0.62), false);
          return;
        }
        contourMaterial.map = null;
        contourMaterial.alphaMap = null;
        contourMaterial.opacity = 0;
        contourMaterial.needsUpdate = true;
        contourGlobe.visible = false;
        contourLineLayer.setColor(contourColorSelect?.value || "#e8eef3");
        contourLineLayer.setOpacity(Number(contourOpacity?.value || 0.62));
        contourLineLayer.rebuild(interval);
        if (baseMaterial?.userData?.contourShader) {
          const shader = baseMaterial.userData.contourShader;
          shader.uniforms.uContourEnabled.value = 0;
          shader.uniforms.uContourMap.value = null;
        }
        if (ctxFocusMaterial?.userData?.ctxShader) {
          const shader = ctxFocusMaterial.userData.ctxShader;
          shader.uniforms.uContourMap.value = null;
          shader.uniforms.uContourEnabled.value = 0;
        }
        ctxDetailStreamer.setContourOverlay(null, Number(contourOpacity?.value || 0.62), false);
      }

      function applyDefaultGeologyState() {
        geologyToggle.checked = true;
        geologyOpacity.value = "0.92";
        geologyContactsToggle.checked = true;
        geologyStructuresToggle.checked = true;
        geologyStructureLayers.forEach((facet) => {
          if (facet.toggle && !facet.toggle.disabled) {
            facet.toggle.checked = true;
          }
        });
        mineralSelect.value = "";
        if (geologyMaterial) {
          geologyMaterial.opacity = Number(geologyOpacity.value);
          geologyMaterial.needsUpdate = true;
        }
        if (mineralMaterial) {
          mineralMaterial.map = null;
          mineralMaterial.needsUpdate = true;
        }
        if (mineralGlobe) {
          mineralGlobe.visible = false;
        }
        updateGeologyVisibility();
        syncGeologyStructureMasterToggle(geologyStructureLayers);
        syncSelectionHalo();
      }

      function syncGeologyMasterToggle() {
        geologyMasterToggle.checked = Boolean(
          geologyToggle.checked ||
          geologyContactsToggle.checked ||
          getActiveGeologyStructureFacets(geologyStructureLayers).length ||
          mineralSelect.value
        );
        if (geologySection) geologySection.open = geologyMasterToggle.checked;
      }

      function applyDefaultLocationsState() {
        labelsToggle.checked = true;
        volcanicLabelsToggle.checked = true;
        landingLabelsToggle.checked = true;
        habitationLabelsToggle.checked = true;
        if (craterLabelsToggle) craterLabelsToggle.checked = true;
        if (fluvialLabelsToggle) fluvialLabelsToggle.checked = true;
        if (tectonicLabelsToggle) tectonicLabelsToggle.checked = true;
        if (baseLabelsToggle) baseLabelsToggle.checked = true;
        if (lodSlider) { lodSlider.value = 5; currentLodLevel = 5; syncLodLabel(); }
        updateLabelVisibility(
          labelLayer.entries,
          venusGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          coreToggle.checked,
          isStreamedBaseLayer(baseLayerSelect.value),
          Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
          craterLabelsToggle?.checked ?? true,
          fluvialLabelsToggle?.checked ?? true,
          tectonicLabelsToggle?.checked ?? true,
        
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
        baseSiteLayer.group.visible = Boolean(baseLabelsToggle?.checked);
      }

      function syncLocationsMasterToggle() {
        locationsMasterToggle.checked = Boolean(
          labelsToggle.checked ||
          volcanicLabelsToggle.checked ||
          landingLabelsToggle.checked ||
          habitationLabelsToggle.checked ||
          (craterLabelsToggle && craterLabelsToggle.checked) ||
          (fluvialLabelsToggle && fluvialLabelsToggle.checked) ||
          (tectonicLabelsToggle && tectonicLabelsToggle.checked) ||
          (baseLabelsToggle && baseLabelsToggle.checked) ||
          (moonToggle && moonToggle.checked)
        );
      }

      [geologyMasterToggle, locationsMasterToggle, moonViewerToggle, tourModeToggle, coreToggle].filter(Boolean).forEach((node) => {
        ["click", "pointerdown"].forEach((eventName) => {
          node.addEventListener(eventName, (event) => {
            event.stopPropagation();
          });
        });
      });

      geologyToggle.addEventListener("change", () => {
        updateGeologyVisibility();
        syncSelectionHalo();
        syncGeologyMasterToggle();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
        syncGisPanel();
      });

      geologyContactsToggle.addEventListener("change", () => {
        updateGeologyVisibility();
        syncGeologyMasterToggle();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      });

      geologyStructuresToggle.addEventListener("change", () => {
        geologyStructureLayers.forEach((facet) => {
          if (facet.toggle && !facet.toggle.disabled) {
            facet.toggle.checked = geologyStructuresToggle.checked;
          }
        });
        syncGeologyStructureMasterToggle(geologyStructureLayers);
        updateGeologyVisibility();
        syncGeologyMasterToggle();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      });

      geologyStructureLayers.forEach((facet) => {
        if (!facet.toggle) {
          return;
        }
        facet.toggle.addEventListener("change", () => {
          syncGeologyStructureMasterToggle(geologyStructureLayers);
          updateGeologyVisibility();
          syncGeologyMasterToggle();
          syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
        });
      });


      baseLayerSelect.addEventListener("change", () => {
        syncBasemapVisibility();
        syncContourOverlay();
        syncSpinToggleBtn();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
        syncGisPanel();
      });
      if (gisCompareLayerSelect) {
        gisCompareLayerSelect.addEventListener("change", () => {
          syncCompareOverlay();
          syncGisPanel();
        });
      }
      if (gisCompareModeSelect) {
        gisCompareModeSelect.addEventListener("change", () => {
          syncCompareOverlay();
        });
      }
      if (gisCompareOpacity) {
        gisCompareOpacity.addEventListener("input", () => {
          syncCompareOverlay();
        });
      }
      if (gisCompareSwipe) {
        gisCompareSwipe.addEventListener("input", () => {
          syncCompareOverlay();
        });
      }
      if (contourIntervalSelect) {
        contourIntervalSelect.addEventListener("change", () => {
          syncContourOverlay();
        });
      }
      if (contourOpacity) {
        contourOpacity.addEventListener("input", () => {
          syncContourOverlay();
        });
      }
      if (contourColorSelect) {
        contourColorSelect.addEventListener("change", () => {
          syncContourOverlay();
        });
      }
      if (hillshadeAzimuth) {
        hillshadeAzimuth.addEventListener("input", () => {
          if (baseLayerSelect.value !== "derived-hillshade") return;
          if (dynamicHillshadeTexture) dynamicHillshadeTexture.dispose();
          dynamicHillshadeTexture = createHillshadeTexture(elevationSampler, Number(hillshadeAzimuth.value), Number(hillshadeAltitude?.value || 45));
          syncBasemapVisibility();
          syncCompareOverlay();
        });
      }
      if (hillshadeAltitude) {
        hillshadeAltitude.addEventListener("input", () => {
          if (baseLayerSelect.value !== "derived-hillshade") return;
          if (dynamicHillshadeTexture) dynamicHillshadeTexture.dispose();
          dynamicHillshadeTexture = createHillshadeTexture(elevationSampler, Number(hillshadeAzimuth?.value || 315), Number(hillshadeAltitude.value));
          syncBasemapVisibility();
          syncCompareOverlay();
        });
      }

      geologyMasterToggle.addEventListener("change", () => {
        if (geologySection) geologySection.open = geologyMasterToggle.checked;
        if (geologyMasterToggle.checked) {
          setTimeout(() => geologySection?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
          applyDefaultGeologyState();
        } else {
          geologyToggle.checked = false;
          geologyContactsToggle.checked = false;
          geologyStructuresToggle.checked = false;
          geologyStructureLayers.forEach((facet) => {
            if (facet.toggle) {
              facet.toggle.checked = false;
            }
          });
          mineralSelect.value = "";
          if (mineralMaterial) {
            mineralMaterial.map = null;
            mineralMaterial.needsUpdate = true;
          }
          if (mineralGlobe) {
            mineralGlobe.visible = false;
          }
          updateGeologyVisibility();
          syncGeologyStructureMasterToggle(geologyStructureLayers);
          syncSelectionHalo();
        }
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      });

      mineralSelect.addEventListener("change", () => {
        const nextMineralLayer = mineralLayers.find((layer) => layer.id === mineralSelect.value);
        const nextMineralTexture = nextMineralLayer ? mineralTextures.get(nextMineralLayer.id) : null;
        if (!nextMineralTexture && nextMineralLayer?.path) {
          _loadMineralLayerOnDemand(nextMineralLayer.id);
        }
        if (mineralMaterial) {
          mineralMaterial.map = nextMineralTexture || null;
          mineralMaterial.needsUpdate = true;
        }
        if (mineralGlobe) {
          mineralGlobe.visible = Boolean(nextMineralTexture);
        }
        syncGeologyMasterToggle();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
        syncGisPanel();
      });

      const _syncMoonFeatureLabels = () => {
        moonFeatureLabelLayer.group.visible = labelsToggle.checked || volcanicLabelsToggle.checked || landingLabelsToggle.checked || habitationLabelsToggle.checked || (craterLabelsToggle?.checked ?? true) || (fluvialLabelsToggle?.checked ?? true) || (tectonicLabelsToggle?.checked ?? true);
        updateMoonFeatureLabelVisibility(
          moonFeatureLabelLayer.entries,
          venusGroup,
          camera,
          renderer,
          activeMoonViewerFeature,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
        
          craterLabelsToggle?.checked ?? true,
          activePopupFeature,
          isPointOccludedByAnyMoon,
        );
      };

      labelsToggle.addEventListener("change", () => {
        updateLabelVisibility(
          labelLayer.entries,
          venusGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          coreToggle.checked,
          isStreamedBaseLayer(baseLayerSelect.value),
          Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
          craterLabelsToggle?.checked ?? true,
          fluvialLabelsToggle?.checked ?? true,
          tectonicLabelsToggle?.checked ?? true,
        
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
        updateMoonVisibility(moonLayer.entries, venusGroup, camera, renderer, moonToggle ? moonToggle.checked : true, labelsToggle.checked && !activeMoonViewerFeature, activeMoonViewerFeature, isPointOccludedByAnyMoon);
        _syncMoonFeatureLabels();
        syncLocationsMasterToggle();
      });

      volcanicLabelsToggle.addEventListener("change", () => {
        updateLabelVisibility(
          labelLayer.entries,
          venusGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          coreToggle.checked,
          isStreamedBaseLayer(baseLayerSelect.value),
          Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
          craterLabelsToggle?.checked ?? true,
          fluvialLabelsToggle?.checked ?? true,
          tectonicLabelsToggle?.checked ?? true,
        
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
        _syncMoonFeatureLabels();
        syncLocationsMasterToggle();
      });

      landingLabelsToggle.addEventListener("change", () => {
        updateLabelVisibility(
          labelLayer.entries,
          venusGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          coreToggle.checked,
          isStreamedBaseLayer(baseLayerSelect.value),
          Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
          craterLabelsToggle?.checked ?? true,
          fluvialLabelsToggle?.checked ?? true,
          tectonicLabelsToggle?.checked ?? true,
        
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
        _syncMoonFeatureLabels();
        syncLocationsMasterToggle();
      });

      habitationLabelsToggle.addEventListener("change", () => {
        updateLabelVisibility(
          labelLayer.entries,
          venusGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          coreToggle.checked,
          isStreamedBaseLayer(baseLayerSelect.value),
          Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
          craterLabelsToggle?.checked ?? true,
          fluvialLabelsToggle?.checked ?? true,
          tectonicLabelsToggle?.checked ?? true,
        
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
        _syncMoonFeatureLabels();
        syncLocationsMasterToggle();
      });

      if (craterLabelsToggle) {
        craterLabelsToggle.addEventListener("change", () => {
          updateLabelVisibility(
            labelLayer.entries,
            venusGroup,
            globe,
            camera,
            renderer,
            labelsToggle.checked,
            volcanicLabelsToggle.checked,
            landingLabelsToggle.checked,
            habitationLabelsToggle.checked,
            coreToggle.checked,
            isStreamedBaseLayer(baseLayerSelect.value),
            Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
            craterLabelsToggle.checked,
            fluvialLabelsToggle?.checked ?? true,
            tectonicLabelsToggle?.checked ?? true,
          
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
          _syncMoonFeatureLabels();
          syncLocationsMasterToggle();
        });
      }

      if (fluvialLabelsToggle) {
        fluvialLabelsToggle.addEventListener("change", () => {
          updateLabelVisibility(
            labelLayer.entries,
            venusGroup,
            globe,
            camera,
            renderer,
            labelsToggle.checked,
            volcanicLabelsToggle.checked,
            landingLabelsToggle.checked,
            habitationLabelsToggle.checked,
            coreToggle.checked,
            isStreamedBaseLayer(baseLayerSelect.value),
            Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
            craterLabelsToggle?.checked ?? true,
            fluvialLabelsToggle.checked,
            tectonicLabelsToggle?.checked ?? true,

          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
          syncLocationsMasterToggle();
        });
      }

      if (tectonicLabelsToggle) {
        tectonicLabelsToggle.addEventListener("change", () => {
          updateLabelVisibility(
            labelLayer.entries,
            venusGroup,
            globe,
            camera,
            renderer,
            labelsToggle.checked,
            volcanicLabelsToggle.checked,
            landingLabelsToggle.checked,
            habitationLabelsToggle.checked,
            coreToggle.checked,
            isStreamedBaseLayer(baseLayerSelect.value),
            Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
            craterLabelsToggle?.checked ?? true,
            fluvialLabelsToggle?.checked ?? true,
            tectonicLabelsToggle.checked,

          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
          syncLocationsMasterToggle();
        });
      }

      const lodValueLabel = document.getElementById("lod-value-label");
      const LOD_LABELS = ["", "Landmarks only", "Major features", "Standard", "Detailed", "All features"];
      function syncLodLabel() {
        if (lodValueLabel) lodValueLabel.textContent = LOD_LABELS[currentLodLevel] || "All features";
      }
      syncLodLabel();

      if (lodSlider) {
        lodSlider.addEventListener("input", () => {
          currentLodLevel = parseInt(lodSlider.value, 10);
          syncLodLabel();
          updateLabelVisibility(
            labelLayer.entries,
            venusGroup,
            globe,
            camera,
            renderer,
            labelsToggle.checked,
            volcanicLabelsToggle.checked,
            landingLabelsToggle.checked,
            habitationLabelsToggle.checked,
            coreToggle.checked,
            isStreamedBaseLayer(baseLayerSelect.value),
            Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
            craterLabelsToggle?.checked ?? true,
            fluvialLabelsToggle?.checked ?? true,
            tectonicLabelsToggle?.checked ?? true,
          
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
          _syncMoonFeatureLabels();
        });
      }

      if (baseLabelsToggle) {
        baseLabelsToggle.addEventListener("change", () => {
          baseSiteLayer.group.visible = Boolean(baseLabelsToggle.checked);
          updateLabelVisibility(
            baseSiteLayer.entries,
            venusGroup,
            globe,
            camera,
            renderer,
            labelsToggle.checked,
            true,
            true,
            true,
            coreToggle.checked,
            isStreamedBaseLayer(baseLayerSelect.value),
            Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
            true,
            true,
            true,
          
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
          syncLocationsMasterToggle();
        });
      }

      if (moonToggle) {
        moonToggle.addEventListener("change", () => {
          updateMoonVisibility(
            moonLayer.entries,
            venusGroup,
            camera,
            renderer,
            moonToggle.checked,
            labelsToggle.checked,
            activeMoonViewerFeature,
            isPointOccludedByAnyMoon,
          );
          syncLocationsMasterToggle();
        });
      }



      locationsMasterToggle.addEventListener("change", () => {
        const on = locationsMasterToggle.checked;
        if (locationsSection) locationsSection.open = on;
        labelsToggle.checked = on;
        volcanicLabelsToggle.checked = on;
        landingLabelsToggle.checked = on;
        habitationLabelsToggle.checked = on;
        if (craterLabelsToggle) craterLabelsToggle.checked = on;
        if (fluvialLabelsToggle) fluvialLabelsToggle.checked = on;
        if (tectonicLabelsToggle) tectonicLabelsToggle.checked = on;
        if (baseLabelsToggle) baseLabelsToggle.checked = on;
        if (moonToggle) moonToggle.checked = on;
        updateLabelVisibility(
          labelLayer.entries,
          venusGroup,
          globe,
          camera,
          renderer,
          on,
          on,
          on,
          on,
          coreToggle.checked,
          isStreamedBaseLayer(baseLayerSelect.value),
          Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
          on,
          on,
          on,
        
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
        baseSiteLayer.group.visible = Boolean(baseLabelsToggle?.checked);
        updateMoonVisibility(moonLayer.entries, venusGroup, camera, renderer, moonToggle ? moonToggle.checked : true, labelsToggle.checked && !activeMoonViewerFeature, activeMoonViewerFeature, isPointOccludedByAnyMoon);
        _syncMoonFeatureLabels();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      });

      coreToggle.addEventListener("change", () => {
        const enabled = coreToggle.checked;
        if (enabled) {
          setTimeout(() => coreViewSection?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
          resetActiveMeasurement();
          cursorReadout.hidden = true;
          lastScaleSampleLat = null;
          updateScaleHud(camera, globe, null, false);
        } else if (!moonViewerToggle || !moonViewerToggle.checked) {
          resetExploreView(camera, controls);
        }
        if (enabled && elevationMap) {
          terrainScale.value = "0";
        }
        const planes = enabled ? [cutawayClipPlane] : [];
        baseMaterial.clippingPlanes = planes;
        baseMaterial.needsUpdate = true;
        if (geologyMaterial) {
          geologyMaterial.clippingPlanes = planes;
          geologyMaterial.needsUpdate = true;
        }
        if (selectedGeologyOutline && selectedGeologyOutline.mesh && selectedGeologyOutline.mesh.material) {
          selectedGeologyOutline.mesh.material.clippingPlanes = planes;
          selectedGeologyOutline.mesh.material.needsUpdate = true;
        }
        geologyContactLayer.setClippingPlanes(planes);
        geologyStructureLayer.setClippingPlanes(planes);
        if (selectedGeologyBoundaryGroup) {
          for (const child of selectedGeologyBoundaryGroup.children) {
            if (child.material) {
              child.material.clippingPlanes = planes;
              child.material.needsUpdate = true;
            }
          }
        }
        updateGeologyVisibility();
        if (mineralMaterial) {
          mineralMaterial.clippingPlanes = planes;
          mineralMaterial.needsUpdate = true;
        }
        if (seaMaterial) {
          seaMaterial.clippingPlanes = planes;
          seaMaterial.needsUpdate = true;
        }
        if (regionMaskMaterial) {
          regionMaskMaterial.clippingPlanes = planes;
          regionMaskMaterial.needsUpdate = true;
        }
        cutawayGroup.visible = enabled;
        labelLayer.group.visible = true;
        scenePopup.hidden = true;
        scenePopupAnchor.hidden = true;
        activePopupFeature = null;
        syncSelectionHalo();
        baseLayerSelect.disabled = false;
        geologyToggle.disabled = false;
        geologyOpacity.disabled = !geologyMaterial;
        geologyContactsToggle.disabled = !geologyContactLayer.available;
        geologyStructuresToggle.disabled = !geologyStructureLayer.available;
        geologyStructureLayers.forEach((facet) => {
          if (facet.toggle) {
            facet.toggle.disabled = !facet.layer.available;
          }
        });
        labelsToggle.disabled = false;
        volcanicLabelsToggle.disabled = false;
        landingLabelsToggle.disabled = false;
        habitationLabelsToggle.disabled = false;
        mineralSelect.disabled = false;
        mineralOpacity.disabled = false;
        syncTerrainReliefState();
        syncCompareOverlay();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      });

      geologyOpacity.addEventListener("input", () => {
        if (geologyMaterial) {
          geologyMaterial.opacity = Number(geologyOpacity.value);
        }
      });

      mineralOpacity.addEventListener("input", () => {
        if (mineralMaterial) {
          mineralMaterial.opacity = Number(mineralOpacity.value);
        }
      });

      terrainScale.addEventListener("input", () => {
        syncTerrainReliefState();
        if (gisBufferState) {
          renderGisBufferOverlay();
        }
        syncSelectionHalo();
        if (measureMode && measurePoints.length) {
          updateMeasureVisualization();
        }
      });

      function syncSeaLevelAxisValue() {
        if (!seaLevelSlider || !seaLevelValue) return;
        const min = Number(seaLevelSlider.min);
        const max = Number(seaLevelSlider.max);
        const value = Number(seaLevelSlider.value);
        const pct = (max === min) ? 0 : (value - min) / (max - min);
        // Correct for thumb not travelling the full track width (~16px thumb)
        const thumbW = 16;
        seaLevelValue.textContent = `${value.toLocaleString()} m`;
        seaLevelValue.style.left = `calc(${pct * 100}% + ${(thumbW * (0.5 - pct)).toFixed(1)}px)`;
      }

      seaToggle.addEventListener("change", () => {
        if (seaGlobe) {
          seaGlobe.visible = seaToggle.checked;
        }
        applyPlanetDisplayState();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      });

      seaLevelSlider.addEventListener("input", () => {
        syncSeaLevelAxisValue();
        if (seaOverlayState) {
          updateSeaOverlayTexture(seaOverlayState, Number(seaLevelSlider.value));
        }
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      });

      regionMaskSelect.addEventListener("change", () => {
        if (!regionMaskMaterial || !elevationSampler) {
          return;
        }
        regionMaskMaterial.map?.dispose?.();
        regionMaskMaterial.map = regionMaskSelect.value
          ? createRegionMaskTexture(regionMaskSelect.value, elevationSampler)
          : null;
        regionMaskMaterial.needsUpdate = true;
        regionMaskGlobe.visible = Boolean(regionMaskSelect.value);
        applyPlanetDisplayState();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      });

      regionMaskOpacity.addEventListener("input", () => {
        if (regionMaskMaterial) {
          regionMaskMaterial.opacity = Number(regionMaskOpacity.value);
        }
      });

      metadataButton.addEventListener("click", () => {
        renderMetadataModal(currentMetadataState || buildMetadataState(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState));
        metadataModal.hidden = false;
      });

      metadataClose.addEventListener("click", () => {
        metadataModal.hidden = true;
      });

      if (profileModalClose) {
        profileModalClose.addEventListener("click", () => {
          hideProfileModal();
        });
      }
      if (profileModalExportPng) {
        profileModalExportPng.addEventListener("click", () => {
          exportCurrentProfilePng();
        });
      }

      metadataModal.addEventListener("click", (event) => {
        if (event.target === metadataModal) {
          metadataModal.hidden = true;
        }
      });

      if (profileModal) {
        profileModal.addEventListener("click", (event) => {
          if (event.target === profileModal) {
            hideProfileModal();
          }
        });
      }
      if (csvPlotterModal) {
        csvPlotterModal.addEventListener("click", (event) => {
          if (event.target === csvPlotterModal) {
            hideCsvPlotterModal();
          }
        });
      }
      if (gisExtractModal) {
        gisExtractModal.addEventListener("click", (event) => {
          if (event.target === gisExtractModal) {
            hideGisExtractModal();
          }
        });
      }

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !metadataModal.hidden) {
          metadataModal.hidden = true;
          return;
        }
        if (event.key === "Escape" && profileModal && !profileModal.hidden) {
          hideProfileModal();
        }
        if (event.key === "Escape" && csvPlotterModal && !csvPlotterModal.hidden) {
          hideCsvPlotterModal();
        }
        if (event.key === "Escape" && gisExtractModal && !gisExtractModal.hidden) {
          hideGisExtractModal();
        }
      });

      if (gisOpenCsvPlotterButton) {
        gisOpenCsvPlotterButton.addEventListener("click", () => {
          if (csvPlotterModal) csvPlotterModal.hidden = false;
        });
      }
      if (csvPlotterClose) {
        csvPlotterClose.addEventListener("click", () => hideCsvPlotterModal());
      }
      if (csvPlotterImport) {
        csvPlotterImport.addEventListener("click", () => csvPlotterFile?.click());
      }
      if (csvPlotterFile) {
        csvPlotterFile.addEventListener("change", (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            const parsed = parseCsvTable(ev.target.result);
            csvPlotterState = parsed;
            if (!parsed) {
              if (csvPlotterMeta) csvPlotterMeta.textContent = "CSV could not be parsed.";
              return;
            }
            populateCsvPlotterSelectors(parsed.headers);
            if (csvPlotterMeta) {
              csvPlotterMeta.textContent = `${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"} loaded.`;
            }
          };
          reader.readAsText(file);
          event.target.value = "";
        });
      }
      if (csvPlotterRender) {
        csvPlotterRender.addEventListener("click", () => {
          if (!csvPlotterState || !csvPlotterCanvas || !csvPlotterX?.value || !csvPlotterY?.value) {
            if (csvPlotterMeta) csvPlotterMeta.textContent = "Load a CSV and choose both X and Y columns.";
            return;
          }
          const points = csvPlotterState.rows
            .map((row, index) => ({
              x: Number(row[csvPlotterX.value]),
              y: Number(row[csvPlotterY.value]),
              index,
            }))
            .filter((row) => Number.isFinite(row.x) && Number.isFinite(row.y));
          if (!points.length) {
            if (csvPlotterMeta) csvPlotterMeta.textContent = "Selected columns did not contain numeric values.";
            return;
          }
          drawGenericPlot(csvPlotterCanvas, points, csvPlotterX.value, csvPlotterY.value, csvPlotterType?.value || "line");
          if (csvPlotterMeta) {
            csvPlotterMeta.textContent = `Rendered ${points.length} points as a ${csvPlotterType?.value || "line"} plot.`;
          }
        });
      }
      if (csvPlotterExportPng) {
        csvPlotterExportPng.addEventListener("click", () => {
          if (csvPlotterCanvas) exportCanvasPng(csvPlotterCanvas, "mars_csv_plot.png");
        });
      }
      if (gisStudyExtractButton) {
        gisStudyExtractButton.addEventListener("click", () => {
          if (gisExtractSource) gisExtractSource.value = "study";
          if (gisExtractModal) gisExtractModal.hidden = false;
        });
      }
      if (gisBufferExtractButton) {
        gisBufferExtractButton.addEventListener("click", () => {
          if (gisExtractSource) gisExtractSource.value = "buffer";
          if (gisExtractModal) gisExtractModal.hidden = false;
        });
      }
      if (gisExtractClose) {
        gisExtractClose.addEventListener("click", () => hideGisExtractModal());
      }
      if (gisExtractRun) {
        gisExtractRun.addEventListener("click", () => {
          const selectedColumns = [...(gisExtractColumns?.querySelectorAll('input[type="checkbox"]:checked') || [])]
            .map((node) => node.value);
          const result = exportPolygonSampleCsv(
            gisExtractSource?.value || "study",
            Number(gisExtractStep?.value || 25),
            selectedColumns,
          );
          if (gisExtractMeta) {
            gisExtractMeta.textContent = result.message;
          }
        });
      }

      featureSearchGo.addEventListener("click", () => {
        focusSearchedFeature(resolveFeatureSearchSelection(), camera, controls);
      });

      if (tourModeToggle) {
        tourModeToggle.addEventListener("change", () => {
          if (tourModeToggle.checked) {
            const firstFeature = getTourFeatureByIndex(0, activeTourModeFacetId);
            if (tourModeSection) {
              tourModeSection.open = true;
              setTimeout(() => tourModeSection.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
            }
            if (firstFeature) {
              ensureNavigateBasemap();
              presentTourFeature(firstFeature, camera, controls, "Touring");
            } else {
              syncTourModeControls(null);
            }
          } else {
            deactivateTourMode();
          }
        });
      }

      if (tourModeFacet) {
        tourModeFacet.addEventListener("change", () => {
          activeTourModeFacetId = tourModeFacet.value || TOUR_MODE_FACETS[0]?.id || "highlights";
          const nextFeature = getTourFeatureByIndex(0, activeTourModeFacetId);
          if (activeTourModeFeature) {
            presentTourFeature(nextFeature, camera, controls, "Touring");
          } else {
            syncTourModeControls(null);
          }
        });
      }
      if (tourModeTarget) {
        tourModeTarget.addEventListener("change", () => {
          const feature = getTourFeaturesByFacet(activeTourModeFacetId)
            .find((item) => item.name === tourModeTarget.value) || null;
          if (feature) {
            presentTourFeature(feature, camera, controls, "Touring");
          }
        });
      }
      if (tourModePrev) {
        tourModePrev.addEventListener("click", () => {
          cycleTourMode(-1, camera, controls);
        });
      }
      if (tourModeNext) {
        tourModeNext.addEventListener("click", () => {
          cycleTourMode(1, camera, controls);
        });
      }

      featureSearch.addEventListener("input", refreshSearchSuggestionsAfterTextEdit);
      featureSearch.addEventListener("keyup", (e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Enter" || e.key === "Escape") return;
        refreshSearchSuggestionsAfterTextEdit();
      });
      featureSearch.addEventListener("change", refreshSearchSuggestionsAfterTextEdit);
      featureSearch.addEventListener("focus", refreshSearchSuggestions);
      featureSearchResults.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      featureSearchResults.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      featureSearch.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" && activeSearchResults.length) {
          activeSearchIndex = (activeSearchIndex + 1) % activeSearchResults.length;
          renderFeatureSearchResults(activeSearchResults, true);
          event.preventDefault();
          return;
        }
        if (event.key === "ArrowUp" && activeSearchResults.length) {
          activeSearchIndex = (activeSearchIndex - 1 + activeSearchResults.length) % activeSearchResults.length;
          renderFeatureSearchResults(activeSearchResults, true);
          event.preventDefault();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const activeBtn = featureSearchResults.querySelector(".search-suggestion.is-active");
          const firstBtn  = featureSearchResults.querySelector(".search-suggestion");
          if (activeBtn) {
            activeBtn.click();
          } else if (firstBtn) {
            firstBtn.click();
          } else {
            focusSearchedFeature(resolveFeatureSearchSelection(), camera, controls);
          }
        }
      });
      document.addEventListener("pointerdown", (event) => {
        if (
          event.target !== featureSearch
          && event.target !== featureSearchGo
          && !featureSearchResults.contains(event.target)
        ) {
          clearFeatureSearchResults(false);
        }
      });

      exploreReset.addEventListener("click", () => {
        reloadToDefaultGlobalView(camera, controls);
      });
      if (brandResetButton) {
        brandResetButton.addEventListener("click", () => {
          reloadToDefaultGlobalView(camera, controls);
        });
      }

      if (moonViewerToggle) {
        moonViewerToggle.addEventListener("change", () => {
          if (moonViewerToggle.checked) {
            if (moonViewerSection) moonViewerSection.open = true;
            const first = moonData[0] || null;
            if (first) {
              moveCameraToFeature(first, camera, controls);
              openFeature(first, false);
              setStatus(`Moon viewer locked on ${first.name}.`);
            }
          } else {
            if (moonViewerSection) moonViewerSection.open = false;
            reloadToDefaultGlobalView(camera, controls);
          }
        });
      }

      if (moonViewerSelect) {
        moonViewerSelect.addEventListener("change", () => {
          const feature = moonData.find((item) => item.name === moonViewerSelect.value) || null;
          if (!feature) { return; }
          moonNavContext = "moon";
          resetActiveMeasurement(true);
          moveCameraToFeature(feature, camera, controls);
          openFeature(feature, false);
          setStatus(`Moon viewer locked on ${feature.name}.`);
        });
      }

      if (moonViewerPrev) {
        moonViewerPrev.addEventListener("click", () => {
          moonNavContext = "moon";
          resetActiveMeasurement(true);
          cycleMoonViewer(-1, camera, controls);
        });
      }

      if (moonViewerNext) {
        moonViewerNext.addEventListener("click", () => {
          moonNavContext = "moon";
          resetActiveMeasurement(true);
          cycleMoonViewer(1, camera, controls);
        });
      }

      if (moonFeatureSearchInput) {
        moonFeatureSearchInput.addEventListener("input", refreshMoonFeatureSearch);
        moonFeatureSearchInput.addEventListener("focus", refreshMoonFeatureSearch);
        if (moonFeatureSearchResults) {
          moonFeatureSearchResults.addEventListener("pointerdown", (e) => e.stopPropagation());
          moonFeatureSearchResults.addEventListener("click", (e) => e.stopPropagation());
        }
        moonFeatureSearchInput.addEventListener("keydown", (event) => {
          if (event.key === "ArrowDown" && activeMoonFeatureSearchResults.length) {
            activeMoonFeatureSearchIndex = (activeMoonFeatureSearchIndex + 1) % activeMoonFeatureSearchResults.length;
            renderMoonFeatureSearchResults(activeMoonFeatureSearchResults, true);
            event.preventDefault();
            return;
          }
          if (event.key === "ArrowUp" && activeMoonFeatureSearchResults.length) {
            activeMoonFeatureSearchIndex = (activeMoonFeatureSearchIndex - 1 + activeMoonFeatureSearchResults.length) % activeMoonFeatureSearchResults.length;
            renderMoonFeatureSearchResults(activeMoonFeatureSearchResults, true);
            event.preventDefault();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const activeBtn = moonFeatureSearchResults && moonFeatureSearchResults.querySelector(".search-suggestion.is-active");
            const firstBtn  = moonFeatureSearchResults && moonFeatureSearchResults.querySelector(".search-suggestion");
            if (activeBtn) { activeBtn.click(); }
            else if (firstBtn) { firstBtn.click(); }
          }
        });
        document.addEventListener("pointerdown", (event) => {
          if (
            event.target !== moonFeatureSearchInput &&
            event.target !== moonFeatureSearchGo &&
            !(moonFeatureSearchResults && moonFeatureSearchResults.contains(event.target))
          ) {
            clearMoonFeatureSearchResults();
          }
        });
      }
      if (moonFeatureSearchGo) {
        moonFeatureSearchGo.addEventListener("click", () => {
          const selected = activeMoonFeatureSearchIndex >= 0
            ? activeMoonFeatureSearchResults[activeMoonFeatureSearchIndex]
            : activeMoonFeatureSearchResults[0];
          if (selected) {
            moveCameraToFeature(selected, camera, controls, { animate: true });
            openFeature(selected, false);
            clearMoonFeatureSearchResults(true);
          }
        });
      }

      if (moonFeatureTypeSelect) {
        moonFeatureTypeSelect.addEventListener("change", () => {
          moonNavContext = "feature";
          moonFeatureTypeFilter = moonFeatureTypeSelect.value;
          activeMoonFeatureTour = null;
          populateMoonFeatureTourTargets();
        });
      }

      if (moonFeatureTourTarget) {
        moonFeatureTourTarget.addEventListener("change", () => {
          moonNavContext = "feature";
          const features = getMoonFeatureTourFeatures();
          focusMoonFeatureTour(features.find((f) => f.name === moonFeatureTourTarget.value));
        });
      }

      if (moonFeatureTourPrev) {
        moonFeatureTourPrev.addEventListener("click", () => {
          moonNavContext = "feature";
          cycleMoonFeatureTour(-1);
        });
      }

      if (moonFeatureTourNext) {
        moonFeatureTourNext.addEventListener("click", () => {
          moonNavContext = "feature";
          cycleMoonFeatureTour(1);
        });
      }

      if (saturnViewModeSelect) {
        saturnViewModeSelect.addEventListener("change", () => {
          resetExploreView(camera, controls);
          applyPlanetViewMode(saturnViewModeSelect.value);
        });
      }

      measureExport.addEventListener("click", () => {
        exportCurrentMeasurementCsv();
      });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          if (activeGeoPopupFeature) {
            closeGeoPopup();
            return;
          }
          if (!scenePopup.hidden || activePopupFeature) {
            closeScenePopup();
            return;
          }
          if (measureMode || measurePoints.length) {
            setMeasureMode("");
          }
          if (gisMode) {
            setGisMode("");
          }
          if (gisPanelOpen) {
            toggleGisPanel(false);
          }
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          const tag = document.activeElement && document.activeElement.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
          const dir = event.key === "ArrowLeft" ? -1 : 1;
          if (activeMoonViewerFeature) {
            event.preventDefault();
            if (moonNavContext === "feature") {
              cycleMoonFeatureTour(dir);
            } else {
              cycleMoonViewer(dir, camera, controls);
            }
          } else if (tourModeToggle?.checked) {
            event.preventDefault();
            cycleTourMode(dir, camera, controls);
          }
        }
      });

      document.addEventListener("pointerdown", (event) => {
        if (!activeGeoPopupFeature) return;
        if (geoPopup && geoPopup.contains(event.target)) return;
        closeGeoPopup();
      });

      if (!elevationMap) {
        terrainScale.value = "0";
        terrainScale.disabled = true;
        seaToggle.checked = false;
        seaToggle.disabled = true;
        seaLevelSlider.disabled = true;
      }
      geologyContactsToggle.disabled = !geologyContactLayer.available;
      geologyStructuresToggle.disabled = !geologyStructureLayer.available;
      geologyStructureLayers.forEach((facet) => {
        if (facet.toggle) {
          facet.toggle.disabled = !facet.layer.available;
        }
      });
      syncTourModeControls(null);
      updateGeologyVisibility();
      syncGeologyStructureMasterToggle(geologyStructureLayers);
      refreshSearchSuggestions();
      syncMoonViewerControls(null);
      syncBasemapVisibility();
      syncContourOverlay();
      syncGeologyMasterToggle();
      syncLocationsMasterToggle();

      scenePopupClose.addEventListener("click", () => {
        closeScenePopup();
      });

      if (geoPopupClose) {
        geoPopupClose.addEventListener("click", () => {
          closeGeoPopup();
        });
      }

      syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      syncTerrainReliefState();

      renderer.domElement.addEventListener("pointerdown", (event) => {
        pointerDown = { x: event.clientX, y: event.clientY };
      });

      renderer.domElement.addEventListener("pointermove", (event) => {
        const _rawSurfaceHit = measureMode
          ? intersectMeasurementSurface(event.clientX, event.clientY)
          : (() => {
              const hit = intersectAnySurface(event.clientX, event.clientY);
              // In moon-viewer mode ignore background Mars globe hits for cursor readout
              if (activeMoonViewerFeature && hit?.context?.kind !== "moon") return null;
              return hit;
            })();
        // In core view, only accept hits on the visible (unclipped) side of the cut plane
        const surfaceHit = _rawSurfaceHit && (
          !coreToggle.checked ||
          !activeCutClipPlane ||
          activeCutClipPlane.distanceToPoint(_rawSurfaceHit.point) >= -0.02
        ) ? _rawSurfaceHit : null;
        if (surfaceHit) {
          let latLon;
          if (surfaceHit.context?.kind === "moon") {
            // localPoint is already in moon body frame (normalized by refineMeasureHitLocalPoint)
            const relPoint = surfaceHit.localPoint.clone().sub(surfaceHit.context.centerLocal);
            latLon = vectorToMoonLatLon(relPoint);
          } else if (surfaceHit.context) {
            latLon = { lat: surfaceHit.lat, lon: surfaceHit.lon };
          } else {
            const localPoint = venusGroup.worldToLocal(surfaceHit.point.clone());
            localPoint.applyEuler(new THREE.Euler(0, -(globe.rotation.y - Math.PI), 0));
            latLon = vectorToLatLon(localPoint);
          }
          const elevationMeters = surfaceHit.context?.kind === "moon"
            ? null
            : sampleElevationMeters(elevationSampler, latLon.lat, latLon.lon);
          cursorReadout.hidden = false;
          const lonSuffix = surfaceHit.context?.kind === "moon" ? "W" : "E";
          cursorReadout.innerHTML = `${latLon.lat.toFixed(2)}°, ${latLon.lon.toFixed(2)}°${lonSuffix} | ${formatElevationWithColor(elevationMeters)}`;
          lastScaleSampleLat = latLon.lat;
          lastScaleSampleAt = performance.now();
          if (surfaceHit.context?.kind === "moon") {
            // Moon surface: airless body, temperature driven by solar exposure angle
            const moonName = surfaceHit.context.bodyName || "Moon";
            const moonCenter = new THREE.Vector3();
            surfaceHit.context.mesh.getWorldPosition(moonCenter);
            const surfaceNormal = surfaceHit.point.clone().sub(moonCenter).normalize();
            const tempC = estimateMoonSurfaceTemperature(moonName, surfaceNormal);
            scTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC} °C`;
            scTemp.style.color = tempC < -100 ? "#6ec6ff"
              : tempC < -50 ? "#90d8e8"
              : tempC < 0 ? "#e8c97a"
              : "#ff7a5a";
            scPressure.textContent = "< 10⁻⁶ Pa";
            scPressure.style.color = "#aaaacc";
            if (scContext) scContext.textContent = moonName.toUpperCase() + " SURFACE";
          } else if (elevationMeters !== null) {
            const tempC = estimateVenusTemperature(latLon.lat, elevationMeters);
            const pressurePa = estimateVenusPressure(elevationMeters);
            scTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC} °C`;
            scTemp.style.color = tempC < -80 ? "#6ec6ff"
              : tempC < -50 ? "#90d8e8"
              : tempC < -25 ? "#e8c97a"
              : "#ff7a5a";
            scPressure.textContent = `${pressurePa} Pa`;
            scPressure.style.color = pressurePa < 200 ? "#aaaacc"
              : pressurePa < 500 ? "#c8a8e0"
              : pressurePa < 800 ? "#e8b878"
              : "#ff9966";
            if (scContext) scContext.textContent = "VENUS SURFACE";
          }
        } else {
          // No surface hit — cursor is in space
          const camDist = camera.position.length();
          const tempC = estimateSpaceTemperature(camDist);
          scTemp.textContent = `${tempC} °C`;
          scTemp.style.color = "#6ec6ff";
          scPressure.textContent = "< 10⁻¹⁰ Pa";
          scPressure.style.color = "#aaaacc";
          if (scContext) scContext.textContent = "INTERPLANETARY SPACE";
          cursorReadout.hidden = true;
          cursorReadout.textContent = "";
          lastScaleSampleLat = null;
          lastScaleSampleAt = 0;
        }
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        if (coreToggle.checked) {
          updateLabelVisibility(
            labelLayer.entries,
            venusGroup,
            globe,
            camera,
            renderer,
            labelsToggle.checked && !activeMoonViewerFeature,
            volcanicLabelsToggle.checked,
            landingLabelsToggle.checked,
            habitationLabelsToggle.checked,
            true,
            isStreamedBaseLayer(baseLayerSelect.value),
            Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null,
            craterLabelsToggle?.checked ?? true,
            fluvialLabelsToggle?.checked ?? true,
            tectonicLabelsToggle?.checked ?? true,
          
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
          updateCoreLabelVisibility(
            cutawayResult,
            camera,
            Boolean(coreLabelsToggle && coreLabelsToggle.checked),
          );
          const hits = [
            ...(coreLabelsToggle && coreLabelsToggle.checked
              ? raycaster.intersectObjects(cutawayResult.interactiveObjects, false)
              : []),
            ...raycaster.intersectObjects(labelLayer.interactiveObjects, false),
            ...raycaster.intersectObjects(baseSiteLayer.interactiveObjects, false),
          ];
          const hit = hits.find((e) => e.object.visible && e.object.userData.feature);
          hoveredFeature = hit ? hit.object.userData.feature : null;
          hoverTooltip.hidden = true;
          renderer.domElement.style.cursor = hoveredFeature ? "pointer" : "";

          // When cursor is over the visible (unclipped) surface, show surface HUD not interior.
          if (surfaceHit) {
            if (surfaceConditionsEl) surfaceConditionsEl.hidden = false;
            if (interiorConditionsEl) interiorConditionsEl.hidden = true;
            return;
          }

          // Interior HUD — intersect the clip plane to get the cross-section point
          if (surfaceConditionsEl) surfaceConditionsEl.hidden = true;
          if (interiorConditionsEl) interiorConditionsEl.hidden = false;
          if (activeCutClipPlane && icDepth) {
            const coreHit = new THREE.Vector3();
            const clipIntersected = raycaster.ray.intersectPlane(activeCutClipPlane, coreHit);
            if (clipIntersected) {
              const localHit = venusGroup.worldToLocal(coreHit.clone());
              const rScene = localHit.length();
              const GLOBE_RADIUS_SCENE = 3.2;
              const VENUS_RADIUS_KM = 3389.5;
              if (rScene <= GLOBE_RADIUS_SCENE) {
                const rFrac = rScene / GLOBE_RADIUS_SCENE;
                const depthKm = Math.round((1.0 - rFrac) * VENUS_RADIUS_KM);
                const layerName = venusInteriorLayerName(rFrac);
                const tempC = estimateVenusInteriorTemperature(rFrac);
                const pressureGPa = estimateVenusInteriorPressure(rFrac);
                icDepth.textContent = `${depthKm.toLocaleString()} km`;
                icDepth.style.color = "";
                icLayer.textContent = layerName;
                icLayer.style.color = venusInteriorLayerColor(layerName);
                icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC} °C`;
                icTemp.style.color = venusInteriorTempColor(tempC);
                icPressure.textContent = `${pressureGPa} GPa`;
                icPressure.style.color = venusInteriorPressureColor(pressureGPa);
              } else {
                icDepth.textContent = "—";   icDepth.style.color = "";
                icLayer.textContent = "—";   icLayer.style.color = "";
                icTemp.textContent = "—";    icTemp.style.color = "";
                icPressure.textContent = "—"; icPressure.style.color = "";
              }
            } else {
              icDepth.textContent = "—";   icDepth.style.color = "";
              icLayer.textContent = "—";   icLayer.style.color = "";
              icTemp.textContent = "—";    icTemp.style.color = "";
              icPressure.textContent = "—"; icPressure.style.color = "";
            }
          }
          return;
        }
        if (
          !labelsToggle.checked &&
          !volcanicLabelsToggle.checked &&
          !landingLabelsToggle.checked &&
          !habitationLabelsToggle.checked &&
          !moonToggle.checked &&
          !geologyToggle.checked &&
          !geologyContactsToggle.checked &&
          !getActiveGeologyStructureFacets(geologyStructureLayers).length
        ) {
          renderer.domElement.style.cursor = "";
          hoveredFeature = null;
          hoverTooltip.hidden = true;
          return;
        }
        // In moon viewer mode, feature labels always take priority over the moon mesh
        if (activeMoonViewerFeature) {
          const moonFeatureHit = raycaster.intersectObjects(moonFeatureLabelLayer.interactiveObjects, false)
            .find((e) => isObjectActuallyVisible(e.object) && e.object.userData.feature);
          if (moonFeatureHit) {
            hoveredFeature = moonFeatureHit.object.userData.feature;
            hoverTooltip.hidden = true;
            renderer.domElement.style.cursor = "pointer";
            return;
          }
        }
        const priorityIntersections = [
          ...raycaster.intersectObjects(labelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(baseSiteLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(moonLayer.interactiveObjects, false),
        ].sort((a, b) => a.distance - b.distance);
        const priorityHit = priorityIntersections.find((entry) => isObjectActuallyVisible(entry.object) && entry.object.userData.feature);
        if (priorityHit) {
          hoveredFeature = priorityHit.object.userData.feature;
        } else {
          const geologySurfaceHit = geologyToggle.checked ? intersectMarsSurface(event.clientX, event.clientY) : null;
          if (geologySurfaceHit) {
            // worldToLocal undoes venusGroup.rotation.z (axial tilt); then un-spin globe.rotation.y
            const hoverLocalHit = venusGroup.worldToLocal(geologySurfaceHit.point.clone());
            const hoverSpinDelta = globe.rotation.y - Math.PI;
            const cosH = Math.cos(hoverSpinDelta), sinH = Math.sin(hoverSpinDelta);
            const hoverBasePoint = new THREE.Vector3(
              hoverLocalHit.x * cosH - hoverLocalHit.z * sinH,
              hoverLocalHit.y,
              hoverLocalHit.x * sinH + hoverLocalHit.z * cosH,
            );
            const geologyFeature = getGeologyFeatureAtPoint(hoverBasePoint, geologyInteractiveState);
            hoveredFeature = geologyFeature || null;
          }
          if (!hoveredFeature) {
            // Contacts/structures are visual-only overlays — too dense for reliable line
            // picking (thousands of segments cover the entire globe). Only check the sparse
            // moon-feature label layer as a clickable line object.
            const geologyLineIntersections = raycaster
              .intersectObjects(moonFeatureLabelLayer.interactiveObjects, false)
              .sort((a, b) => a.distance - b.distance);
            const geologyLineHit = geologyLineIntersections.find((entry) => isObjectActuallyVisible(entry.object) && entry.object.userData.feature);
            hoveredFeature = geologyLineHit ? geologyLineHit.object.userData.feature : null;
          }
        }
        const hit = priorityHit;
        if (hit && hit.object.userData.feature && hit.object.userData.feature.event_time) {
          const feature = hit.object.userData.feature;
          hoverTooltip.innerHTML = `<div class="hover-tooltip-title">Seismic Event</div>${feature.name || feature.magnitude_label || "Atmospheric feature"}<br>${feature.magnitude_label || "Magnitude not reported"}${feature.event_time ? `<br>${feature.event_time}` : ""}`;
          hoverTooltip.style.left = `${event.clientX + 16}px`;
          hoverTooltip.style.top = `${event.clientY + 16}px`;
          hoverTooltip.hidden = false;
        } else {
          hoverTooltip.hidden = true;
        }
        renderer.domElement.style.cursor = hoveredFeature ? "pointer" : "";
      });

      renderer.domElement.addEventListener("pointerup", (event) => {
        if (!pointerDown) { return; }
        const dx = event.clientX - pointerDown.x;
        const dy = event.clientY - pointerDown.y;
        pointerDown = null;
        if (Math.hypot(dx, dy) > 10) { return; }

        if (measureMode && measureDrawActive) {
          const _rawHit = intersectMeasurementSurface(event.clientX, event.clientY);
          const surfaceHit = _rawHit && (
            !coreToggle.checked ||
            !activeCutClipPlane ||
            activeCutClipPlane.distanceToPoint(_rawHit.point) >= -0.02
          ) ? _rawHit : null;
          if (surfaceHit) {
            const context = cloneMeasureContext(surfaceHit.context);
            measurePoints.push({
              lat: surfaceHit.lat,
              lon: surfaceHit.lon,
              point: surfaceHit.localPoint.clone(),
              localPoint: surfaceHit.localPoint.clone(),
              bodyKind: context.kind,
              bodyName: context.bodyName,
              radiusKm: context.radiusKm,
              radiusWorld: context.radiusWorld,
              context,
            });
            if ((measureMode === "distance" || measureMode === "profile") && measurePoints.length > 2) {
              // Third click: reset cleanly — new point becomes fresh point A
              const freshPoint = measurePoints[measurePoints.length - 1];
              measurePoints = [freshPoint];
            }
            pushMeasureHistory();
            updateMeasureVisualization();
            return;
          }
        }

        if (gisMode === "inspect") {
          const inspectHit = intersectAnySurface(event.clientX, event.clientY);
          if (inspectHit) {
            captureGisInspect(inspectHit);
            return;
          }
        }


        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);

        if (coreToggle.checked) {
          const hits = [
            ...(coreLabelsToggle && coreLabelsToggle.checked
              ? raycaster.intersectObjects(cutawayResult.interactiveObjects, false)
              : []),
            ...raycaster.intersectObjects(labelLayer.interactiveObjects, false),
            ...raycaster.intersectObjects(baseSiteLayer.interactiveObjects, false),
          ];
          const hit = hits.find((e) => e.object.visible && e.object.userData.feature);
          if (hit) { openFeature(hit.object.userData.feature, hit.object.parent === cutawayResult.labelsGroup || hit.object.parent === cutawayResult.group); }
          return;
        }

        // In moon viewer mode, feature labels always take priority over the moon mesh
        if (activeMoonViewerFeature) {
          const moonFeatureHit = raycaster.intersectObjects(moonFeatureLabelLayer.interactiveObjects, false)
            .find((e) => isObjectActuallyVisible(e.object) && e.object.userData.feature);
          if (moonFeatureHit) {
            openFeature(moonFeatureHit.object.userData.feature, false);
            return;
          }
        }
        // Priority 1: labels, moons
        const priorityIntersections = [
          ...raycaster.intersectObjects(labelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(baseSiteLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(moonLayer.interactiveObjects, false),
        ].sort((a, b) => a.distance - b.distance);
        const priorityHit = priorityIntersections.find((entry) => isObjectActuallyVisible(entry.object) && entry.object.userData.feature);
        if (priorityHit) {
          openFeature(priorityHit.object.userData.feature, false);
          return;
        }
        if (gisBasePlacementMode) {
          const baseSurfaceHit = intersectMarsSurface(event.clientX, event.clientY);
          if (baseSurfaceHit) {
            const localPoint = venusGroup.worldToLocal(baseSurfaceHit.point.clone());
            const bodyPoint = localPoint.clone().applyEuler(new THREE.Euler(0, -(globe.rotation.y - Math.PI), 0));
            const latLon = vectorToLatLon(bodyPoint);
            if (placeBuildingAtLatLon(latLon.lat, latLon.lon)) {
              return;
            }
          }
        }
        // Priority 2: geology fill surface — use floating geo popup, not main scenePopup
        const clickSpinDelta = globe.rotation.y - Math.PI;
        const surfaceHit = geologyToggle.checked ? intersectMarsSurface(event.clientX, event.clientY) : null;
        if (surfaceHit) {
          // worldToLocal undoes venusGroup.rotation.z (axial tilt); then un-spin globe.rotation.y
          const clickLocalHit = venusGroup.worldToLocal(surfaceHit.point.clone());
          const cosD = Math.cos(clickSpinDelta), sinD = Math.sin(clickSpinDelta);
          const basePoint = new THREE.Vector3(
            clickLocalHit.x * cosD - clickLocalHit.z * sinD,
            clickLocalHit.y,
            clickLocalHit.x * sinD + clickLocalHit.z * cosD,
          );
          const geologyFeature = getGeologyFeatureAtPoint(basePoint, geologyInteractiveState);
          if (geologyFeature) {
            openGeoPopup(geologyFeature, surfaceHit.point, clickSpinDelta);
            return;
          }
        }
        // Priority 3: moon feature labels only — contacts/structures are visual overlays, not clickable
        const geologyLineIntersections = [
          ...raycaster.intersectObjects(moonFeatureLabelLayer.interactiveObjects, false),
        ].sort((a, b) => a.distance - b.distance);
        const geologyLineHit = geologyLineIntersections.find((entry) => isObjectActuallyVisible(entry.object) && entry.object.userData.feature);
        if (geologyLineHit) {
          openGeoPopup(geologyLineHit.object.userData.feature, geologyLineHit.point || null, clickSpinDelta);
        }
      });

      function onResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (activeMeasurementResultAnchor && measurementResultCard && !measurementResultCard.hidden) {
          positionMeasurementResultCard(activeMeasurementResultAnchor);
        }
      }

      window.addEventListener("resize", onResize);

      function viewportToClient(nx, ny) {
        const rect = renderer.domElement.getBoundingClientRect();
        return {
          clientX: rect.left + rect.width * nx,
          clientY: rect.top + rect.height * ny,
        };
      }

      function sampleFeatureAtViewport(nx, ny) {
        const { clientX, clientY } = viewportToClient(nx, ny);
        const surfaceHit = intersectMarsSurface(clientX, clientY);
        let geologyFeature = null;
        if (surfaceHit) {
          const sampleLocalHit = venusGroup.worldToLocal(surfaceHit.point.clone());
          const sampleSpinDelta = globe.rotation.y - Math.PI;
          const cosS = Math.cos(sampleSpinDelta), sinS = Math.sin(sampleSpinDelta);
          const sampleBasePoint = new THREE.Vector3(
            sampleLocalHit.x * cosS - sampleLocalHit.z * sinS,
            sampleLocalHit.y,
            sampleLocalHit.x * sinS + sampleLocalHit.z * cosS,
          );
          geologyFeature = getGeologyFeatureAtPoint(sampleBasePoint, geologyInteractiveState);
        }
        if (geologyFeature) {
          return geologyFeature;
        }
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        const intersections = [
          ...raycaster.intersectObjects(labelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(baseSiteLayer.interactiveObjects, false),
        ];
        const hit = intersections.find((entry) => isObjectActuallyVisible(entry.object) && entry.object.userData.feature);
        return hit ? hit.object.userData.feature : null;
      }

      // FLIGHT-SIM: expose the viewer internals the shared flight simulator
      // needs (/scripts/flightsim.js). Read-only. Mirrors the Mars viewer's
      // block; only bodyId, bodyGroup and bodyRadiusMeters differ per world.
      window.__flightSimHooks = {
        THREE,
        scene,
        camera,
        renderer,
        controls,
        streamedLayer: STREAMED_BASE_LAYER,
        bodyId: "venus",
        bodyGroup: venusGroup,
        bodyRadiusMeters: VENUS_RADIUS_METERS,
        globe,
        // Screen point -> surface lat/lon. Reuses intersectAnySurface (the same
        // pick that drives the cursor readout and the measure tools) and the
        // identical un-rotation the readout applies, so a picked launch site
        // lands exactly where the coordinate box says it is. Returns null for
        // sky or any other body so the picker cannot set a site off-world.
        pickSurfaceLatLon: (clientX, clientY) => {
          const hit = intersectAnySurface(clientX, clientY);
          if (!hit || hit.context) return null;
          const localPoint = venusGroup.worldToLocal(hit.point.clone());
          localPoint.applyEuler(new THREE.Euler(0, -(globe.rotation.y - Math.PI), 0));
          const ll = vectorToLatLon(localPoint);
          if (!ll || !Number.isFinite(ll.lat) || !Number.isFinite(ll.lon)) return null;
          return { lat: ll.lat, lon: ((ll.lon % 360) + 360) % 360 };
        },
        elevationSampler,
        sampleElevationNormalized,
        latLonToVector3,
        getRequestedTerrainRelief,
        getEffectiveTerrainRelief,
        syncTerrainReliefState,
        baseLayerSelect,
        terrainScale,
        pauseSpin,
        resumeSpin,
        isSpinPaused: () => spinPaused,
        getSpinTime,
        setStatus,
        manifest,
        layerTextures,
        ctxDetailStreamer,
        getSpinDelta: () => globe.rotation.y - Math.PI,
        isMoonViewerActive: () => Boolean(activeMoonViewerFeature),
        renderFrame: () => render(),
        get labelLayer() { return labelLayer; },
        get baseSiteLayer() { return baseSiteLayer; },
      };
      window.dispatchEvent(new CustomEvent("flightsim:hooks-ready"));

      window.__venusViewerDebug = {
        isReady: () => true,
        getState: () => ({
          solidGeology: Boolean(geologyGlobe && geologyGlobe.visible),
          contacts: Boolean(geologyContactLayer.group.visible),
          structures: Boolean(geologyStructureLayer.group.visible),
          coreEnabled: Boolean(coreToggle.checked),
          selectedFeatureType: activePopupFeature?.type || null,
          selectedFeatureName: activePopupFeature?.name || null,
          selectedOutlineVisible: Boolean(selectedGeologyOutline?.mesh?.visible),
        }),
        setToggle: (id, checked) => {
          const node = document.getElementById(id);
          if (!node) {
            return false;
          }
          node.checked = Boolean(checked);
          node.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        },
        setTerrainRelief: (value) => {
          terrainScale.value = String(value);
          terrainScale.dispatchEvent(new Event("input", { bubbles: true }));
          return Number(terrainScale.value);
        },
        sampleFeatureAtViewport: (nx = 0.5, ny = 0.5) => sampleFeatureAtViewport(nx, ny),
        openFeatureAtViewport: (nx = 0.5, ny = 0.5) => {
          const feature = sampleFeatureAtViewport(nx, ny);
          if (feature) {
            openFeature(feature, false);
          }
          return feature;
        },
        getFirstLineRadius: (kind) => {
          const layer = kind === "contacts" ? geologyContactLayer : geologyStructureLayer;
          const line = layer?.interactiveObjects?.find((entry) => isObjectActuallyVisible(entry));
          if (!line) {
            return null;
          }
          const positions = line.geometry?.attributes?.position?.array;
          if (!positions || positions.length < 3) {
            return null;
          }
          return Math.sqrt(
            positions[0] * positions[0] +
            positions[1] * positions[1] +
            positions[2] * positions[2]
          );
        },
      };

      async function runEmbeddedSmokeTest() {
        const params = new URLSearchParams(window.location.search);
        if (params.get("smoketest") !== "1") {
          return;
        }
        const resultNode = document.createElement("pre");
        resultNode.id = "smoke-test-result";
        resultNode.textContent = "RUNNING";
        resultNode.style.position = "fixed";
        resultNode.style.left = "1rem";
        resultNode.style.bottom = "1rem";
        resultNode.style.zIndex = "999";
        resultNode.style.padding = "0.65rem 0.8rem";
        resultNode.style.borderRadius = "0.7rem";
        resultNode.style.background = "rgba(7, 10, 18, 0.92)";
        resultNode.style.color = "#f2f5ff";
        document.body.appendChild(resultNode);

        const assert = (condition, message) => {
          if (!condition) {
            throw new Error(message);
          }
        };

        try {
          let state = window.__venusViewerDebug.getState();
          assert(state.solidGeology === true, "Solid geology should load enabled by default.");

          const feature = window.__venusViewerDebug.openFeatureAtViewport(0.5, 0.5);
          assert(feature, "Expected a geology feature at the viewport center.");
          assert(feature.type === "Geologic unit polygon", `Expected geology polygon, got ${feature.type}`);

          state = window.__venusViewerDebug.getState();
          assert(state.selectedOutlineVisible === true, "Selected geology outline should be visible.");

          window.__venusViewerDebug.setToggle("geology-toggle", false);
          window.__venusViewerDebug.setToggle("geology-contacts-toggle", true);
          window.__venusViewerDebug.setToggle("geology-structures-toggle", true);
          state = window.__venusViewerDebug.getState();
          assert(state.solidGeology === false, "Solid geology should be independently disabled.");
          assert(state.contacts === true, "Contacts should remain visible independently.");
          assert(state.structures === true, "Structures should remain visible independently.");

          const radiusBefore = window.__venusViewerDebug.getFirstLineRadius("contacts");
          assert(radiusBefore !== null, "Expected a visible contact line sample radius.");
          window.__venusViewerDebug.setTerrainRelief(0.2);
          await new Promise((resolve) => setTimeout(resolve, 250));
          const radiusAfter = window.__venusViewerDebug.getFirstLineRadius("contacts");
          assert(radiusAfter !== null && Math.abs(radiusAfter - radiusBefore) > 1e-4, "Contact linework should move with terrain relief.");

          window.__venusViewerDebug.setToggle("core-toggle", true);
          state = window.__venusViewerDebug.getState();
          assert(state.coreEnabled === true, "Core view should enable.");
          assert(state.solidGeology === true, "Solid geology should remain visible in core view when enabled.");
          assert(state.contacts === true, "Contacts should remain available in core view.");
          assert(state.structures === true, "Structures should remain available in core view.");

          resultNode.dataset.status = "pass";
          resultNode.textContent = "PASS";
        } catch (error) {
          resultNode.dataset.status = "fail";
          resultNode.textContent = `FAIL
${error && error.message ? error.message : error}`;
        }
      }

      function updateMoonOrbits(moonEntries, featureEntries, t) {
        const BASE_ORBIT_RADIUS = 8.4;
        const BASE_PERIOD_MS = 240000;
        const BASE_OMEGA = (2 * Math.PI) / BASE_PERIOD_MS;
        for (const entry of moonEntries) {
          const { item, anchor, moonMesh, sprite, line, orbitRadius, orbitSemiMinorAxis, initialAngle, moonRadius, lift } = entry;
          // Use real orbit_period_days from moon data, scaled by the display speed factor.
          // Both Phobos and Deimos are prograde and tidally locked (rotation.y = −angle).
          const _periodDays = Number(item.orbit_period_days || 0);
          const omega = _periodDays
            ? (2 * Math.PI * _VENUS_MOON_SPEED_FACTOR) / (_periodDays * 86400000)
            : BASE_OMEGA * Math.pow(BASE_ORBIT_RADIUS / orbitRadius, 1.5);
          const angle = initialAngle + t * omega;
          if (activeMoonViewerFeature) {
            // In moon viewer mode: only update self-rotation of the focused moon; skip orbital movement.
            if (item.name === activeMoonViewerFeature.name) {
              item._currentAngle = angle;
              moonMesh.rotation.y = Math.PI - angle;
            }
            continue;
          }
          const x = Math.cos(angle) * orbitRadius;
          const z = Math.sin(angle) * orbitSemiMinorAxis;
          const y = anchor.y;
          item.moon_anchor[0] = x;
          item.moon_anchor[2] = z;
          item._currentAngle = angle;
          anchor.set(x, y, z);
          moonMesh.position.set(x, y, z);
          moonMesh.rotation.y = Math.PI - angle;
          sprite.position.set(x, y + lift, z);
          const lp = line.geometry.attributes.position.array;
          lp[0] = x;  lp[1] = y + moonRadius * 0.4;  lp[2] = z;
          lp[3] = x;  lp[4] = y + lift - 0.06;        lp[5] = z;
          line.geometry.attributes.position.needsUpdate = true;
        }
        for (const entry of featureEntries) {
          const { parentMoon, moonAnchor, marker, hitTarget, sprite, line, surfacePoint, relMarkerPos, relHitPos, relSurfacePoint, relLabelPos, rel0MarkerPos, rel0HitPos, rel0SurfacePoint, rel0LabelPos } = entry;
          const mx = parentMoon.moon_anchor[0];
          const my = parentMoon.moon_anchor[1];
          const mz = parentMoon.moon_anchor[2];
          moonAnchor.set(mx, my, mz);
          const angle = parentMoon._currentAngle || 0;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          relMarkerPos.set(rel0MarkerPos.x * cosA - rel0MarkerPos.z * sinA, rel0MarkerPos.y, rel0MarkerPos.x * sinA + rel0MarkerPos.z * cosA);
          relHitPos.set(rel0HitPos.x * cosA - rel0HitPos.z * sinA, rel0HitPos.y, rel0HitPos.x * sinA + rel0HitPos.z * cosA);
          relSurfacePoint.set(rel0SurfacePoint.x * cosA - rel0SurfacePoint.z * sinA, rel0SurfacePoint.y, rel0SurfacePoint.x * sinA + rel0SurfacePoint.z * cosA);
          relLabelPos.set(rel0LabelPos.x * cosA - rel0LabelPos.z * sinA, rel0LabelPos.y, rel0LabelPos.x * sinA + rel0LabelPos.z * cosA);
          surfacePoint.copy(relSurfacePoint).add(moonAnchor);
          marker.position.copy(relMarkerPos).add(moonAnchor);
          hitTarget.position.copy(relHitPos).add(moonAnchor);
          sprite.position.copy(relLabelPos).add(moonAnchor);
          const connectorStart = getMoonFeatureConnectorStart(marker.position, sprite.position, parentMoon.moon_radius);
          const fp = line.geometry.attributes.position.array;
          fp[0] = connectorStart.x;  fp[1] = connectorStart.y;  fp[2] = connectorStart.z;
          fp[3] = sprite.position.x; fp[4] = sprite.position.y; fp[5] = sprite.position.z;
          line.geometry.attributes.position.needsUpdate = true;
          line.geometry.computeBoundingSphere();
        }
      }

      // Persistent state for per-frame motion throttling.
      const _rs = {
        frame: 0,
        camPos: new THREE.Vector3(Infinity, Infinity, Infinity),
        camQuat: new THREE.Quaternion(),
        moving: false,
      };

      // Force-upload a texture to GPU then release its CPU image backing store.
      // Only used for textures that are actively rendered (moon textures, the
      // default base/geology layers). Inactive layers are never pre-uploaded so
      // they don't consume GPU memory until the user selects them.
      function _freeTexImage(tex) {
        if (!tex || !tex.image) return;
        renderer.initTexture(tex);
        tex.image = null;
        tex.version = 0;
      }

      const _onDemandLoading = new Set();

      async function _loadBaseLayerOnDemand(layerId) {
        if (_onDemandLoading.has(layerId)) return;
        const layer = baseLayers.find(l => l.id === layerId);
        if (!layer?.path || layerTextures.get(layerId) !== null) return;
        _onDemandLoading.add(layerId);
        try {
          const raw = await loadTextureSafe(textureLoader, layer.path);
          let tex;
          if (layer.scGroup) {
            tex = raw;
            if (tex) {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.wrapS = THREE.RepeatWrapping;
              tex.wrapT = THREE.ClampToEdgeWrapping;
              tex.repeat.set(1, 1);
              tex.offset.set(0, 0);
              tex.needsUpdate = true;
            }
          } else {
            tex = applyTextureTransforms(raw, layer);
            if (tex) tex.colorSpace = THREE.SRGBColorSpace;
          }
          if (tex) tex.onUpdate = () => { tex.image = null; tex.onUpdate = null; };
          layerTextures.set(layerId, tex || null);
          if (baseLayerSelect.value === layerId) syncBasemapVisibility();
        } finally {
          _onDemandLoading.delete(layerId);
        }
      }

      async function _loadMineralLayerOnDemand(layerId) {
        if (_onDemandLoading.has('m:' + layerId)) return;
        const layer = mineralLayers.find(l => l.id === layerId);
        if (!layer?.path || mineralTextures.get(layerId) != null) return;
        _onDemandLoading.add('m:' + layerId);
        try {
          const raw = await loadTextureSafe(textureLoader, layer.path);
          if (raw) raw.colorSpace = THREE.SRGBColorSpace;
          const tex = raw ? processMineralTexture(raw) : null;
          mineralTextures.set(layerId, tex);
          mineralSamplerStates.set(layerId, createRasterSamplerState(tex));
          _freeTexImage(raw);
          _freeTexImage(tex);
          if (mineralSelect.value === layerId) {
            if (mineralMaterial) { mineralMaterial.map = tex || null; mineralMaterial.needsUpdate = true; }
            if (mineralGlobe) mineralGlobe.visible = Boolean(tex);
          }
        } finally {
          _onDemandLoading.delete('m:' + layerId);
        }
      }

      // After the first rendered frame, free CPU images for textures already on GPU.
      // Only the default base layer and default geology layer are GPU-uploaded at
      // this point — on-demand layers are loaded later and freed at load time.
      // IDs whose textures are streaming canvases — must never have their image nulled.
      const _streamingLayerIds = new Set(["ctx-mosaic", "ctx-mosaic-color"]);

      let _textureCleanupDone = false;
      function _freeTextureImages() {
        if (_textureCleanupDone) return;
        _textureCleanupDone = true;
        for (const [id, tex] of layerTextures) {
          if (!_streamingLayerIds.has(id)) _freeTexImage(tex);
        }
        for (const tex of geologyTextures.values()) {
          _freeTexImage(tex);
        }
        // Pre-warm the CTX canvas texture now (while the GL context is idle after
        // the first frame) so the first CTX selection doesn't stall the render thread
        // uploading 128 MB + mipmaps. The original background loader used to do this
        // implicitly by iterating all layerTextures; the moon-only loader no longer does.
        if (ctxStreamer?.texture) renderer.initTexture(ctxStreamer.texture);
      }

      function render() {
        // ── Motion throttle ───────────────────────────────────────────────────
        // Track camera movement. When the camera is rotating/panning quickly,
        // skip label visibility passes and tile-stream bbox work on 2 out of 3
        // frames — they use heavy raycasting and world-space projection that
        // don't need to run at 60 fps.  The tile settle gate already prevents
        // new fetches until the camera stops, so nothing is lost.
        _rs.frame++;
        const _camMovedSq  = camera.position.distanceToSquared(_rs.camPos);
        const _camRotated  = _rs.camQuat.angleTo(camera.quaternion);
        _rs.moving = _camMovedSq > 5e-6 || _camRotated > 5e-4;
        _rs.camPos.copy(camera.position);
        _rs.camQuat.copy(camera.quaternion);
        // Heavy passes run every frame when still; every 3rd frame when moving.
        const _heavyFrame = !_rs.moving || (_rs.frame % 3 === 0);
        // ─────────────────────────────────────────────────────────────────────
        if (viewerControls) {
          viewerControls.enableRotate = true;
        }
        const spinLocked = spinIsLocked();
        if (spinLocked) {
          pauseSpin();
          if (spinToggleBtn) {
            spinToggleBtn.disabled = true;
            spinToggleBtn.classList.add("is-paused");
          }
        } else if (spinToggleBtn) {
          spinToggleBtn.disabled = false;
        }

        // Surface barrier: prevent camera from entering the planet or slipping between globe and
        // CTX tile meshes. Uses a tighter CTX-specific floor so close zoom can
        // reach the higher LOD bands without clipping through the surface.
        let _safeMin = 0;
        let _distToMaxSurface = Infinity;
        let _controlSurfaceDistance = Infinity;
        if (!activeMoonViewerFeature) {
          const _maxTerrainDisp = Math.max(0, getTerrainRelief());
          const _ctxMode = isStreamedBaseLayer(baseLayerSelect.value);
          const _surfaceMargin = _ctxMode ? 0.0005 : 0.092;
          const _terrainFloor = 3.2 + _maxTerrainDisp + _surfaceMargin;
          const _baseMin = _ctxMode ? 3.20002 : DEFAULT_CONTROL_MIN_DISTANCE;
          _safeMin = Math.max(_baseMin, _terrainFloor);
          // Pre-clamp: push camera out before OrbitControls processes this frame's zoom input
          if (camera.position.length() < _safeMin) camera.position.setLength(_safeMin);
          controls.minDistance = _safeMin;
          // Shrink near clip plane as camera approaches surface so sphere/tile geometry is never
          // inside the near frustum. Factor 0.4 guarantees nearest displaced tile renders correctly.
          _distToMaxSurface = Math.max(0.005, camera.position.length() - (3.2 + _maxTerrainDisp + _surfaceMargin));
          _controlSurfaceDistance = _distToMaxSurface;
          camera.near = Math.min(0.1, _distToMaxSurface * 0.4);
          camera.updateProjectionMatrix();
        } else {
          const moonControlContext = getMoonMeasureContext(activeMoonViewerFeature);
          if (moonControlContext) {
            const moonCenterWorld = venusGroup.localToWorld(moonControlContext.centerLocal.clone());
            _controlSurfaceDistance = Math.max(
              0.0005,
              camera.position.distanceTo(moonCenterWorld) - moonControlContext.radiusWorld,
            );
            // Shrink near clip plane as camera approaches moon surface so measurement
            // geometry (which sits just above the surface) is never inside the near frustum.
            camera.near = Math.min(0.02, _controlSurfaceDistance * 0.4);
            camera.updateProjectionMatrix();
          }
        }
        {
          const _distanceT = clamp(_controlSurfaceDistance / 1.8, 0, 1);
          const _distanceEase = _distanceT * _distanceT;
          if (activeMoonViewerFeature) {
            controls.rotateSpeed = 0.75;
            controls.zoomSpeed = 1.0;
            controls.dampingFactor = 0.08;
          } else {
            // At CTX close-zoom (scale bar ≤ ~50 km) blend to a much tighter
            // rotateSpeed so a small drag doesn't jump across many tiles.
            // _controlSurfaceDistance in scene units: 1 unit ≈ 1,060 km.
            // 50 km ≈ 0.047, 5 km ≈ 0.0047, 1 km ≈ 0.00094.
            const _ctxCloseZoom = (isStreamedBaseLayer(baseLayerSelect.value))
              && _controlSurfaceDistance < 0.05;
            if (_ctxCloseZoom) {
              // Extra friction tier: t=0 at surface, t=1 at ~50 km.
              const _closeT = clamp(_controlSurfaceDistance / 0.05, 0, 1);
              const _closeEase = _closeT * _closeT;
              controls.rotateSpeed = THREE.MathUtils.lerp(0.004, 0.03, _closeEase);
              controls.zoomSpeed = THREE.MathUtils.lerp(0.18, 0.28, _closeEase);
              controls.dampingFactor = THREE.MathUtils.lerp(0.32, 0.24, _closeEase);
            } else {
              controls.rotateSpeed = THREE.MathUtils.lerp(0.012, 0.75, _distanceEase);
              controls.zoomSpeed = THREE.MathUtils.lerp(0.24, 0.8, _distanceEase);
              controls.dampingFactor = THREE.MathUtils.lerp(0.22, 0.08, _distanceEase);
            }
          }
        }
        controls.update();
        // Backstop: clamp again after OrbitControls in case damping still overshot
        if (_safeMin > 0 && camera.position.length() < _safeMin) {
          camera.position.setLength(_safeMin);
          controls.object.position.copy(camera.position);
        }
        // FLIGHT-SIM: run flight physics + camera for this frame. Mirrors the
        // Mars viewer: while flying, the ship owns the camera, so the normal
        // camera-driven streaming below is skipped rather than left to fight it.
        const _flightActive = Boolean(window.__flightSim?.active);
        if (_flightActive) {
          window.__flightSim.update(camera);
          // The flight sim writes camera.position/quaternion; nothing between
          // here and the label pass recomposes the camera's matrices in THIS
          // fork's render loop (Mars's does — its loop received the flight-era
          // hardening this one never got). Left stale, every anchor the label
          // pass projects uses the pre-engage ORBIT view matrix, so 100% of
          // them read "off-screen" and features fly by as bare dots. Measured:
          // quaternion current, matrixWorldInverse frozen at the orbit pose,
          // placeMosaicLabel 6953 calls / 6953 rejected. Recompose both now.
          camera.updateMatrixWorld(true);
          camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        }
        if (!_flightActive && !activeMoonViewerFeature) {
          const _ctxMode = isStreamedBaseLayer(baseLayerSelect.value);
          if (_ctxMode) {
            const _currentScaleBar = estimateScaleBarMetersForCameraPosition(camera.position);
            if (Number.isFinite(_currentScaleBar) && _currentScaleBar < CTX_MOSAIC_MIN_SCALEBAR_METERS) {
              camera.position.copy(lastSafeMosaicCameraPosition);
              controls.object.position.copy(camera.position);
            } else if (Number.isFinite(_currentScaleBar) && _currentScaleBar >= CTX_MOSAIC_MIN_SCALEBAR_METERS) {
              lastSafeMosaicCameraPosition.copy(camera.position);
            }
          } else {
            // Only record a non-CTX position as "safe" if it is above the CTX
            // zoom floor. This ensures that if the user switches to CTX while
            // already zoomed past 10 km (e.g. on Viking), the snap target is a
            // genuinely safe altitude rather than the too-close current position.
            const _nonCtxScaleBar = estimateScaleBarMetersForCameraPosition(camera.position);
            if (!Number.isFinite(_nonCtxScaleBar) || _nonCtxScaleBar >= CTX_MOSAIC_MIN_SCALEBAR_METERS) {
              lastSafeMosaicCameraPosition.copy(camera.position);
            }
          }
        }
        const _t = performance.now();
        const _spinT = getSpinTime();
        if (!coreToggle.checked) {
          updateMoonOrbits(moonLayer.entries, moonFeatureLabelLayer.entries, _spinT);
          globe.rotation.y = Math.PI - _spinT * (2 * Math.PI / _VENUS_DISPLAY_PERIOD_MS);
          const _spinDelta = globe.rotation.y - Math.PI;
          labelLayer.group.rotation.y = _spinDelta;
          if (contourLineLayer && contourLineLayer.group) contourLineLayer.group.rotation.y = _spinDelta;
          gisBufferGroup.rotation.y = _spinDelta;
          geologyContactLayer.group.rotation.y = _spinDelta;
          geologyStructureLayer.group.rotation.y = _spinDelta;
          if (ctxDetailStreamer && ctxDetailStreamer.group) ctxDetailStreamer.group.rotation.y = _spinDelta;
          measureGroup.rotation.y = _spinDelta;
          // Keep moonMeasureGroup centred on the moon and rotating with its self-rotation.
          const _firstMoonMeasure = measurePoints.find((p) => p.context?.kind === "moon");
          if (_firstMoonMeasure) {
            moonMeasureGroup.position.copy(_firstMoonMeasure.context.centerLocal);
            moonMeasureGroup.rotation.y = -getMoonBodyAngle(_firstMoonMeasure.context.bodyName);
          }
          if (seaGlobe) seaGlobe.rotation.y = globe.rotation.y;
          if (compareGlobe) compareGlobe.rotation.y = globe.rotation.y;
          if (contourGlobe) contourGlobe.rotation.y = globe.rotation.y;
          if (ctxFocusGlobe) ctxFocusGlobe.rotation.y = globe.rotation.y;
          if (geologyGlobe) geologyGlobe.rotation.y = globe.rotation.y;
          if (mineralGlobe) mineralGlobe.rotation.y = globe.rotation.y;
          if (regionMaskGlobe) regionMaskGlobe.rotation.y = globe.rotation.y;
          labelLayer.group.updateWorldMatrix(true, false);
        }
        if (compareShader) {
          compareShader.uniforms.uViewportWidth.value = renderer.domElement.clientWidth || window.innerWidth || 1;
        }
        const removeAtmosphere = false; // Rocky planet — no atmosphere to remove.
        const venusLabelsEnabled = labelsToggle.checked && !activeMoonViewerFeature;
        // Group-level kill switch: hide the entire label layer in moon viewer mode every frame,
        // overriding any event listener that may have turned individual sprites back on.
        labelLayer.group.visible = !activeMoonViewerFeature;
        // Label/moon visibility: expensive per-entry world-space work. Runs every
        // frame when still; every 3rd frame during rotation (imperceptible at 60fps).
        if (_heavyFrame) {
          updateHemisphereLocator();
          const useMosaicLabelLayout = isStreamedBaseLayer(baseLayerSelect.value);
          const mosaicScaleBarMeters = Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null;
          if (!coreToggle.checked) {
            updateLabelVisibility(
              labelLayer.entries,
              labelLayer.group,
              globe,
              camera,
              renderer,
              venusLabelsEnabled,
              volcanicLabelsToggle.checked,
              landingLabelsToggle.checked,
              habitationLabelsToggle.checked,
              false,
              useMosaicLabelLayout,
              mosaicScaleBarMeters,
              craterLabelsToggle?.checked ?? true,
            fluvialLabelsToggle?.checked ?? true,
            tectonicLabelsToggle?.checked ?? true,
            
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
            updateMoonVisibility(
              moonLayer.entries,
              venusGroup,
              camera,
              renderer,
              moonToggle ? moonToggle.checked : true,
              venusLabelsEnabled,
              activeMoonViewerFeature,
              isPointOccludedByAnyMoon,
            );
            updateMoonFeatureLabelVisibility(
              moonFeatureLabelLayer.entries,
              venusGroup,
              camera,
              renderer,
              activeMoonViewerFeature || null,
              volcanicLabelsToggle.checked,
              landingLabelsToggle.checked,
              habitationLabelsToggle.checked,

          craterLabelsToggle?.checked ?? true,
          activePopupFeature,
          isPointOccludedByAnyMoon,
        );
          } else {
            updateLabelVisibility(
              labelLayer.entries,
              labelLayer.group,
              globe,
              camera,
              renderer,
              venusLabelsEnabled,
              volcanicLabelsToggle.checked,
              landingLabelsToggle.checked,
              habitationLabelsToggle.checked,
              true,
              useMosaicLabelLayout,
              mosaicScaleBarMeters,
              craterLabelsToggle?.checked ?? true,
            fluvialLabelsToggle?.checked ?? true,
            tectonicLabelsToggle?.checked ?? true,
            
          currentLodLevel,
          activeMoonViewerFeature,
          activeCutClipPlane,
          isPointOccludedByAnyMoon,
          moonLayer,
          activePopupFeature,
        );
            updateMoonVisibility(
              moonLayer.entries,
              venusGroup,
              camera,
              renderer,
              moonToggle ? moonToggle.checked : true,
              venusLabelsEnabled,
              activeMoonViewerFeature,
              isPointOccludedByAnyMoon,
            );
            updateMoonFeatureLabelVisibility(
              moonFeatureLabelLayer.entries,
              venusGroup,
              camera,
              renderer,
              !labelsToggle.checked ? null : activeMoonViewerFeature,
              volcanicLabelsToggle.checked,
              landingLabelsToggle.checked,
              habitationLabelsToggle.checked,
            
          craterLabelsToggle?.checked ?? true,
          activePopupFeature,
          isPointOccludedByAnyMoon,
        );
            updateCoreLabelVisibility(
              cutawayResult,
              camera,
              Boolean(coreLabelsToggle && coreLabelsToggle.checked),
            );
          }
        }

        // Moon viewer labels need per-frame updates so the behind-camera repositioning
        // applied in updateMoonFeatureLabelVisibility isn't overwritten by updateMoonOrbits
        // on non-heavy frames, which would cause flickering at max zoom.
        if (activeMoonViewerFeature && labelsToggle.checked && !coreToggle.checked) {
          updateMoonFeatureLabelVisibility(
            moonFeatureLabelLayer.entries,
            venusGroup,
            camera,
            renderer,
            activeMoonViewerFeature,
            volcanicLabelsToggle.checked,
            landingLabelsToggle.checked,
            habitationLabelsToggle.checked,
          
          craterLabelsToggle?.checked ?? true,
          activePopupFeature,
          isPointOccludedByAnyMoon,
        );
        }

        if (activePopupFeature && !scenePopup.hidden) {
          if (isMoonViewerSelectedFeature(activePopupFeature) && !activePopupIsCoreLabel) {
            syncMoonViewerPopup(activePopupFeature, false);
          }
        }

        if (selectedGeologyOutline && selectedGeologyOutline.mesh && selectedGeologyOutline.mesh.visible) {
          selectedGeologyOutline.mesh.material.opacity = 0.72 + (Math.sin(timestamp * 0.004) * 0.08);
        }

        if (selectedGeologyBoundaryGroup && selectedGeologyBoundaryGroup.visible) {
          const pulse = 0.78 + ((Math.sin(timestamp * 0.005) + 1) * 0.11);
          for (const child of selectedGeologyBoundaryGroup.children) {
            if (child.material && child.userData?.selectionAccent) {
              child.material.opacity = pulse;
            }
          }
        }

        {
          hideMosaicFocusLabel();
          const entryMarker = selectedLabelEntry
            ? (selectedLabelEntry.marker || selectedLabelEntry.dot || null)
            : null;
          if (entryMarker && entryMarker.visible) {
            if (!selectedLabelEntry._pulseBase) {
              selectedLabelEntry._pulseBase = {
                spriteColor: selectedLabelEntry.sprite?.material?.color?.clone() ?? new THREE.Color(1, 1, 1),
                spriteOpacity: selectedLabelEntry.sprite?.material?.opacity ?? 1,
                dotColor: selectedLabelEntry.dot?.material?.color?.clone() ?? new THREE.Color(1, 1, 1),
                lineOpacity: selectedLabelEntry.line?.material?.opacity ?? 0.42,
              };
            }
            const pulse = (Math.sin(_t * 0.004) + 1) * 0.5;
            if (selectedLabelEntryIsSurface) {
              const compactMosaicSelection = isStreamedBaseLayer(baseLayerSelect?.value);
              const microScaleBar = Number.isFinite(window.__lastScaleBarMeters) ? window.__lastScaleBarMeters : null;
              selectionRing.visible = !(compactMosaicSelection && Number.isFinite(microScaleBar) && microScaleBar <= 2000);
              selectionRing.position.copy(entryMarker.position);
              selectionRing.material.opacity = 0.35 + pulse * 0.55;
              const markerScale = entryMarker.scale?.x || 1;
              selectionRing.scale.setScalar(((compactMosaicSelection ? 0.36 + pulse * 0.1 : 1.2 + pulse * 0.6)) * markerScale);
              moonSelectionRing.visible = false;
              coreSelectionRing.visible = false;
            } else if (selectedLabelEntryIsCore) {
              coreSelectionRing.visible = true;
              coreSelectionRing.position.copy(entryMarker.position);
              coreSelectionRing.material.opacity = 0.35 + pulse * 0.55;
              const markerScale = entryMarker.scale?.x || 1;
              coreSelectionRing.scale.setScalar((1.2 + pulse * 0.6) * markerScale);
              selectionRing.visible = false;
              moonSelectionRing.visible = false;
            } else {
              moonSelectionRing.visible = true;
              moonSelectionRing.position.copy(entryMarker.position);
              moonSelectionRing.material.opacity = 0.35 + pulse * 0.55;
              // Scale ring to consistent apparent angular size regardless of camera distance.
              // controls.target is the moon centre world position set by activateMoonViewer — reliable.
              const _camDist = Math.max(0.001, camera.position.distanceTo(controls.target));
              const _moonRingScale = (_camDist * 0.011) / 0.0008;
              moonSelectionRing.scale.setScalar(_moonRingScale * (1.0 + pulse * 0.3));
              moonSelectionCenterDot.position.copy(entryMarker.position);
              moonSelectionCenterDot.scale.setScalar(_moonRingScale * 0.5);
              moonSelectionCenterDot.visible = true;
              moonSelectionCenterDot.material.color.setRGB(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
              moonSelectionCenterDot.material.opacity = 0.88 + pulse * 0.12;
              selectionRing.visible = false;
              coreSelectionRing.visible = false;
            }
            if (selectedLabelEntry.sprite?.material) {
              selectedLabelEntry.sprite.material.color.setRGB(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
              selectedLabelEntry.sprite.material.opacity = 0.78 + pulse * 0.22;
            }
            if (selectedLabelEntry.dot?.material) {
              selectedLabelEntry.dot.material.color.setRGB(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
            }
            if (selectedLabelEntry.line?.material) {
              selectedLabelEntry.line.material.opacity = 0.42 + pulse * 0.4;
            }
          } else {
            selectionRing.visible = false;
            moonSelectionRing.visible = false;
            moonSelectionCenterDot.visible = false;
            coreSelectionRing.visible = false;
          }
        }

        // Geo popup: reproject world-space hit point to screen each frame using differential rotation
        if (activeGeoPopupLocalPos && activeGeoPopupFeature) {
          try {
            const worldPos = venusGroup.localToWorld(
              activeGeoPopupLocalPos.clone().applyEuler(new THREE.Euler(0, globe.rotation.y - Math.PI, 0)),
            );
            const planetCenterWorld = venusGroup.localToWorld(new THREE.Vector3(0, 0, 0));
            const surfaceNormalWorld = worldPos.clone().sub(planetCenterWorld).normalize();
            const camDir = camera.position.clone().sub(worldPos).normalize();
            const visible = surfaceNormalWorld.dot(camDir) > 0.0;
            if (!visible) {
              if (geoPopup) geoPopup.hidden = true;
              if (geoPopupAnchor) geoPopupAnchor.hidden = true;
            } else {
              const projected = worldPos.clone().project(camera);
              const sx = (projected.x * 0.5 + 0.5) * window.innerWidth;
              const sy = (-projected.y * 0.5 + 0.5) * window.innerHeight;
              if (geoPopup) {
                geoPopup.hidden = false;
                geoPopup.style.left = sx + "px";
                geoPopup.style.top = sy + "px";
              }
              if (geoPopupAnchor) {
                geoPopupAnchor.hidden = false;
                geoPopupAnchor.style.left = sx + "px";
                geoPopupAnchor.style.top = sy + "px";
              }
            }
          } catch (_geoErr) {
            // Never crash the render loop due to geo popup projection
          }
        }

        // CTX streaming always runs every frame — tile drains and settle timing
        // must not be skipped or medium/high-res loading breaks.
        if (BODY_STREAMS_TILES) ctxStreamer.update(camera);
        const ctxMaxZoomStreaming = (
          BODY_STREAMS_TILES &&
          (isStreamedBaseLayer(baseLayerSelect.value)) &&
          !coreToggle.checked &&
          !activeMoonViewerFeature
        );
        window.__ctxPatchDebug = ctxMaxZoomStreaming
          ? {
              ...(window.__ctxPatchDebug || {}),
              mode: "focus-overlay",
              gate: null,
            }
          : {
              ...(window.__ctxPatchDebug || {}),
              mode: "inactive",
              active: false,
              gate: {
                baseLayer: baseLayerSelect.value,
                coreView: Boolean(coreToggle.checked),
                moonViewer: Boolean(activeMoonViewerFeature),
                distToMaxSurface: _distToMaxSurface,
                threshold: null,
              },
            };
        if (ctxDetailStreamer.active) {
          ctxDetailStreamer.deactivate();
        }
        if (!ctxMaxZoomStreaming) {
          window.__ctxPatchDebug = {
            active: false,
            altitude: null,
            focusTarget: null,
            level: null,
            refinementBbox: null,
            visibleBbox: null,
            viewTileCount: 0,
            meshCount: 0,
            inflightCount: 0,
            queueLength: 0,
            minMeshLevel: null,
            maxMeshLevel: null,
            gate: {
              baseLayer: baseLayerSelect.value,
              coreView: Boolean(coreToggle.checked),
              moonViewer: Boolean(activeMoonViewerFeature),
              distToMaxSurface: _distToMaxSurface,
              threshold: null,
            },
          };
        }
        // Detail streamer disabled in focus-overlay mode.
        if (BODY_STREAMS_TILES && ctxDetailStreamer.active) {
          ctxDetailStreamer.update(camera);
        }
        if (ctxFocusGlobe) {
          ctxFocusGlobe.visible = (
            BODY_STREAMS_TILES &&
            (isStreamedBaseLayer(baseLayerSelect.value))
            && !coreToggle.checked
            && !activeMoonViewerFeature
            && ctxStreamer.active
            && ctxStreamer._focusDisplayState.active
          );
          if (ctxFocusMaterial?.userData?.ctxShader) {
            const shader = ctxFocusMaterial.userData.ctxShader;
            const wantsColor = isStreamedBaseLayer(baseLayerSelect.value);
            shader.uniforms.uCtxColorMap.value = wantsColor ? (layerTextures.get("venus-surface") || null) : null;
            shader.uniforms.uCtxColorMix.value = wantsColor ? 1.0 : 0.0;
            shader.uniforms.uCtxColorLift.value = wantsColor ? 1.15 : 1.0;
          }
          if (ctxFocusGlobe.visible) {
            const resolved = ctxStreamer._focusResolvedLevels?.size || 0;
            const total = Math.max(1, ctxStreamer._focusDisplayState?.tileCount || 1);
            const coverage = Math.min(1, resolved / total);
            const targetOpacity = clamp((coverage - 0.15) / 0.85, 0, 1);
            ctxStreamer._focusOpacity = Number.isFinite(ctxStreamer._focusOpacity)
              ? ctxStreamer._focusOpacity
              : 0;
            ctxStreamer._focusOpacity += (targetOpacity - ctxStreamer._focusOpacity) * 0.18;
            ctxFocusMaterial.opacity = clamp(ctxStreamer._focusOpacity, 0, 1);
            ctxFocusMaterial.transparent = true;
            ctxFocusMaterial.needsUpdate = true;
          }
        }
        if (renderingIndicator) {
          const focusActive = ctxMaxZoomStreaming && ctxStreamer.active && ctxStreamer._focusDisplayState?.active;
          const inflight = ctxStreamer._focusInflight || 0;
          const queued = ctxStreamer._focusQueue?.length || 0;
          const resolved = ctxStreamer._focusResolvedLevels?.size || 0;
          const total = Math.max(1, ctxStreamer._focusDisplayState?.tileCount || 1);
          const coverage = Math.min(1, resolved / total);
          const isRendering = focusActive && (inflight > 0 || queued > 0 || coverage < 0.98);
          renderingIndicator.hidden = !isRendering;
        }
        // Scale HUD: 13 raycasts + DOM update. Throttle during motion.
        if (_heavyFrame) {
          const scaleSampleLat = (performance.now() - lastScaleSampleAt) < 250
            ? lastScaleSampleLat
            : null;
          let scaleBodyMesh = globe;
          let scaleBodyRadiusMeters = VENUS_RADIUS_METERS;
          let scaleBodyRadiusScene = 3.2;
          if (activeMoonViewerFeature) {
            const moonScaleContext = getMoonMeasureContext(activeMoonViewerFeature);
            if (moonScaleContext?.mesh) {
              scaleBodyMesh = moonScaleContext.mesh;
              scaleBodyRadiusMeters = moonScaleContext.radiusKm * 1000;
              scaleBodyRadiusScene = moonScaleContext.radiusWorld;
            }
          }
          updateScaleHud(
            camera,
            scaleBodyMesh,
            scaleBodyRadiusMeters,
            scaleBodyRadiusScene,
            scaleSampleLat,
            !coreToggle.checked,
          );
        }
        updateMeasureVisualScale();
        // ── FLIGHT-SIM: horizon POI system ───────────────────────────────────
        // In flight, a feature beyond the visible horizon is flagged by a small
        // category-coloured ▼ + name hovering just above the skyline in its
        // direction, fading/shrinking as it lies farther beyond the horizon.
        // Once the feature genuinely crests into view it promotes back to the
        // standard viewer label (dot + connector + box). Design notes:
        //  • Visibility is the GROUND-POINT horizon test γ ≤ acos(Rg/d): a
        //    feature IS its ground location, so a label anchor floating high on
        //    exaggerated terrain must not promote it early. Hysteresis (±EPS)
        //    stops flicker right at the boundary.
        //  • Hover height comes from SAMPLING the terrain skyline along each
        //    proxy's azimuth (elevation map × current relief, incl. vertical
        //    exaggeration), so proxies sit a few px above the real skyline.
        //  • The horizon band is decluttered by azimuth bins (nearest first).
        //  • Proxies are depth-tested: the ship or a nearer ridge occludes them,
        //    and nothing ever draws through the planet.
        //  • View-cone culled: a feature whose location is out of frame gets no
        //    label at all, rather than an anchor-lifted sprite hanging on screen.
        if (window.__flightSim?.active) {
          if (!window.__fsTriTex) { // white glyph so per-category tinting works
            const _c = document.createElement("canvas"); _c.width = 64; _c.height = 64;
            const _g = _c.getContext("2d");
            _g.beginPath(); _g.moveTo(6, 12); _g.lineTo(58, 12); _g.lineTo(32, 56); _g.closePath();
            _g.fillStyle = "#ffffff"; _g.fill();
            _g.lineWidth = 5; _g.strokeStyle = "rgba(8,10,14,0.9)"; _g.stroke();
            window.__fsTriTex = new THREE.CanvasTexture(_c);
          }
          const grp = labelLayer.group;
          const camLocal = grp.worldToLocal(camera.position.clone()); // camera in label/map frame
          const d = camLocal.length() || 1;
          const Chat = camLocal.clone().multiplyScalar(1 / d);        // radial "up" at the camera
          const Rg = globe.geometry?.parameters?.radius || 3.2;
          const relief = Math.max(0, (typeof getEffectiveTerrainRelief === "function" ? getEffectiveTerrainRelief() : 0) || 0);
          let tileLift = 0; // CTX tiles float above the datum; the skyline includes that
          if (ctxDetailStreamer && (isStreamedBaseLayer(baseLayerSelect?.value))) {
            tileLift = (ctxDetailStreamer.surfaceLiftBase || 0) + relief * (ctxDetailStreamer.surfaceLiftReliefFactor || 0);
          }
          // Robust viewport height: clientHeight is 0 while the tab isn't
          // compositing (hidden/mid-resize) — fall back to the drawing buffer
          // then the window so pixel→angle math never degenerates.
          const vpH = renderer.domElement.clientHeight || renderer.domElement.height || window.innerHeight || 800;
          const fovScale = vpH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
          const anglePerPx = 1 / Math.max(fovScale, 1e-4);            // radians per screen pixel
          const alpha = Math.acos(Math.max(-1, Math.min(1, Rg / d))); // camera's horizon angle
          const Dh = Math.sqrt(Math.max(d * d - Rg * Rg, 1e-8));      // slant distance to the horizon
          const uppH = Dh * anglePerPx;                               // world units per px at the horizon
          const EPS = 0.008;                                          // hysteresis band (rad)
          const canSample = typeof sampleElevationNormalized === "function" && elevationSampler;
          // View-cone culling: labels/proxies for features to the SIDE or BEHIND
          // the camera are dropped outright. Without this, a behind-camera anchor
          // can still project onto the screen ("forced into view" far from the
          // real location). Proxies cull at the frustum edge + margin.
          const fwdLocal = grp.worldToLocal(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position)).sub(camLocal).normalize();
          const vpW = renderer.domElement.clientWidth || renderer.domElement.width || window.innerWidth || vpH * 1.7;
          const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) * (vpW / vpH));
          const COS_PROXY_CULL = Math.cos(Math.min(hHalf + 0.21, 1.45)); // horizontal frustum edge + ~12°
          const fwdH = fwdLocal.clone().addScaledVector(Chat, -fwdLocal.dot(Chat)); // forward azimuth on the horizon
          const fwdHValid = fwdH.lengthSq() > 1e-6;
          if (fwdHValid) fwdH.normalize();
          const lookV = new THREE.Vector3();
          const upV = new THREE.Vector3();
          // "Location out of view → label dropped": the authoritative test is the
          // FEATURE's own position against the view frustum (+20% margin), not the
          // sprite's — anchors lift sprites far above markers, so a just-passed
          // feature's label could otherwise hang on-screen with its location
          // already out of frame behind the ship.
          camera.updateMatrixWorld();
          if (!window.__fsCamInv) window.__fsCamInv = new THREE.Matrix4();
          const camInv = window.__fsCamInv.copy(camera.matrixWorld).invert();
          const grpM = grp.matrixWorld;
          const tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
          const aspect = vpW / vpH;
          const markerInView = (Plocal) => {
            lookV.copy(Plocal).applyMatrix4(grpM).applyMatrix4(camInv); // → camera space
            if (lookV.z > -1e-4) return false;                          // behind the camera
            const lim = -lookV.z * tanHalfV * 1.2;
            return Math.abs(lookV.y) <= lim && Math.abs(lookV.x) <= lim * aspect;
          };
          const cullStats = { promotedShown: 0, promotedCulled: 0, proxiesShown: 0, baseCulled: 0 };
          const hideProxies = (e) => {
            if (e._fsTri) e._fsTri.visible = false;
            if (e._fsHLabel) e._fsHLabel.visible = false;
            if (e._fsDist) e._fsDist.visible = false;
            e._fsRamp = 0;
          };
          // Cached distance-readout textures. Cached by STRING, and the value is
          // rounded to coarse steps, so a feature 300 km out does not mint a new
          // texture every frame as the range ticks down.
          if (!window.__fsDistTex) window.__fsDistTex = new Map();
          const fsDistTexture = (txt) => {
            const cache = window.__fsDistTex;
            const hit = cache.get(txt);
            if (hit) return hit;
            const fsz = 34, pad = 9;
            const meas = document.createElement("canvas").getContext("2d");
            meas.font = `600 ${fsz}px "Exo 2", sans-serif`;
            const cv = document.createElement("canvas");
            cv.width = Math.max(8, Math.ceil(meas.measureText(txt).width) + pad * 2);
            cv.height = fsz + pad * 2;
            const g2 = cv.getContext("2d");
            g2.font = `600 ${fsz}px "Exo 2", sans-serif`;
            g2.textAlign = "center";
            g2.textBaseline = "middle";
            g2.lineWidth = 6;
            g2.strokeStyle = "rgba(8,10,14,0.92)";
            g2.strokeText(txt, cv.width / 2, cv.height / 2);
            g2.fillStyle = "#bfe0ff";
            g2.fillText(txt, cv.width / 2, cv.height / 2);
            const tex = new THREE.CanvasTexture(cv);
            if (cache.size > 160) {
              for (const k of cache.keys()) {
                cache.get(k)?.dispose?.();
                cache.delete(k);
                if (cache.size <= 120) break;
              }
            }
            cache.set(txt, tex);
            return tex;
          };
          // Screen box of a sprite, in CSS pixels. Sprites are sized in WORLD
          // units, so the pixel size follows from the perspective relation
          // pxPerUnit = viewportH / (2 * dist * tan(fov/2)). Returns null behind
          // the camera, where the projection is meaningless.
          // PERF, and this one froze the main thread: `clientWidth`/`clientHeight`
          // force a style+layout flush on every read. Reading them INSIDE this
          // helper meant one forced layout per label per frame — hundreds per
          // frame at max label density — which locks the browser. They are hoisted
          // to once per frame here, along with the constant fov term. The scratch
          // vectors likewise avoid allocating two Vector3 per label per frame.
          const _srVw = renderer.domElement.clientWidth || 1;
          const _srVh = renderer.domElement.clientHeight || 1;
          const _srTanHalfFov = Math.tan((camera.fov * Math.PI / 180) / 2);
          const _srV = new THREE.Vector3();
          const _srN = new THREE.Vector3();
          const spriteScreenRect = (sprite) => {
            if (!sprite) return null;
            _srV.copy(sprite.position);
            grp.localToWorld(_srV);
            const dist = camera.position.distanceTo(_srV);
            if (!(dist > 1e-9)) return null;
            const ndc = _srN.copy(_srV).project(camera);
            if (ndc.z > 1) return null;                      // behind the camera
            const vh = _srVh, vw = _srVw;
            const pxPerUnit = vh / (2 * dist * _srTanHalfFov);
            const hPx = sprite.scale.y * pxPerUnit;
            const wPx = sprite.scale.x * pxPerUnit;
            const cx = (ndc.x * 0.5 + 0.5) * vw;
            const cy = (-ndc.y * 0.5 + 0.5) * vh;
            // 2 px of padding so boxes that merely touch still count as clashing.
            return { l: cx - wPx / 2 - 2, r: cx + wPx / 2 + 2,
                     t: cy - hPx / 2 - 2, b: cy + hPx / 2 + 2 };
          };
          const rectsOverlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

          // Every box already claimed this frame: real in-view labels first (they
          // always win), then proxy names in significance order.
          const occupiedRects = [];

          // Pass 1 — classify every label: in view (promote) or beyond horizon.
          const candidates = [];
          for (const entry of labelLayer.entries) {
            if (!entry || !entry.sprite || !entry.marker) continue;
            // Base visibility = the viewer's own declutter verdict, refreshed on
            // "heavy" frames (updateLabelVisibility just recomputed sprite.visible
            // earlier in this same render pass); light frames keep the last known.
            if ((_heavyFrame && !coreToggle.checked) || entry._fsBaseVisible === undefined) entry._fsBaseVisible = !!entry.sprite.visible;
            if (!entry._fsBaseVisible) { hideProxies(entry); continue; }
            const P = entry.marker.position;
            const R = P.length() || 1;
            const cosG = (P.x * Chat.x + P.y * Chat.y + P.z * Chat.z) / R;
            const gamma = Math.acos(Math.max(-1, Math.min(1, cosG)));
            // GROUND-POINT horizon test (no anchor "reach"): label anchors float
            // well above the surface (relief + exaggeration lifts), and a high
            // anchor is genuinely line-of-sight visible far beyond the horizon —
            // which promoted full labels whose dot hung in the sky. A feature IS
            // its ground location: it counts as in view only once that location
            // clears the datum horizon.
            const over = gamma - alpha;            // >0 → ground point behind the planet's curve
            const wasOut = entry._fsMode === "out";
            const out = wasOut ? over > -EPS : over > EPS; // hysteresis
            entry._fsMode = out ? "out" : "in";
            if (!out) { // promote: the standard viewer label — shown only while the
              // feature's LOCATION is inside the view frustum; out of frame
              // (side/behind) the whole label is dropped, never forced on-screen.
              const onScreen = markerInView(P); // (leaves camera-space P in lookV)
              entry.sprite.visible = onScreen;
              if (entry.sprite.material) {
                entry.sprite.material.depthTest = false;
                // ...and no depth WRITE either. The ship is drawn after labels
                // (renderOrder 400 vs 201) but still depth-tests against the
                // terrain; a label writing depth nearer than the hull would
                // reject those fragments and the label would win anyway. This
                // is what let labels paint across the ship.
                entry.sprite.material.depthWrite = false;
              }
              if (entry.line) { entry.line.visible = onScreen; if (entry.line.material) entry.line.material.depthTest = false; }
              entry.marker.visible = onScreen;
              if (entry.marker.material) entry.marker.material.depthTest = false;
              if (onScreen) {
                // FLIGHT RE-ANCHOR: the orbit anchor lift is negligible at flight
                // proximity, leaving labels hugging the ground with a horizontal
                // connector. Re-anchor each frame: dot stays on the surface, the
                // label floats comfortably above it (≥1.4 label-heights, or a
                // 62 px screen-constant lift when that is larger), and the
                // connector is rewritten surface → label, i.e. sub-vertical.
                // Orbit anchors self-restore on exit via syncTerrainReliefState.
                const distCam = lookV.length();
                const lift = Math.max(distCam * anglePerPx * 62, entry.sprite.scale.y * 1.4);
                upV.copy(P).multiplyScalar(1 / (P.length() || 1)); // radial up at the feature
                entry.sprite.position.copy(P).addScaledVector(upV, lift);
                const lp = entry.line?.geometry?.attributes?.position;
                if (lp && lp.count === 2) {
                  const endLift = Math.max(lift - entry.sprite.scale.y * 0.55, lift * 0.4);
                  lp.array[0] = P.x; lp.array[1] = P.y; lp.array[2] = P.z;
                  lp.array[3] = P.x + upV.x * endLift;
                  lp.array[4] = P.y + upV.y * endLift;
                  lp.array[5] = P.z + upV.z * endLift;
                  lp.needsUpdate = true;
                  entry.line.geometry.computeBoundingSphere?.();
                }
              }
              hideProxies(entry);
              // A REAL, in-view label always outranks a horizon proxy. Bank its
              // screen box so the declutter pass below can yield to it rather
              // than stacking a skyline flag on top of it.
              if (onScreen) occupiedRects.push(spriteScreenRect(entry.sprite));
              if (onScreen) cullStats.promotedShown++; else cullStats.promotedCulled++;
              continue;
            }
            entry.sprite.visible = false;
            if (entry.line) entry.line.visible = false;
            entry.marker.visible = false;
            if (cosG <= 0.03) { cullStats.farSide = (cullStats.farSide || 0) + 1; hideProxies(entry); continue; } // far side — not "upcoming"
            cullStats.candidates = (cullStats.candidates || 0) + 1;
            candidates.push({ entry, over, cosG, P, R });
          }
          // Pass 2 — declutter the horizon band: nearest feature wins each
          // azimuth bin, capped so the skyline never crowds.
          // MAX_NAMED caps how many carry a NAME; MAX_TRI is the larger cap on
          // bare triangles, which are cheap and are the "queued" state — a
          // feature keeps its marker so you can see it coming, and earns its
          // name when it wins a slot or comes into view.
          const MAX_NAMED = 14, MAX_TRI = 40, BIN_RAD = 6 * Math.PI / 180;
          let Ub = new THREE.Vector3(0, 1, 0).cross(Chat);
          if (Ub.lengthSq() < 1e-6) Ub = new THREE.Vector3(1, 0, 0).cross(Chat);
          Ub.normalize();
          const Vb = new THREE.Vector3().crossVectors(Chat, Ub);
          // SIGNIFICANCE FIRST, distance second. `lod` is the label-density rank
          // carried by every feature (1 = continent-scale, 5 = individual craters
          // that only appear at max density), so at high density the map floods
          // with lod-5 names that would otherwise win purely by being nearer.
          const sig = (c) => Number(c.entry.item?.lod) || 3;
          candidates.sort((a, b) => (sig(a) - sig(b)) || (a.over - b.over));
          const usedBins = new Set();
          const shown = [];
          for (const c of candidates) {
            const tang = c.P.clone().multiplyScalar(1 / c.R).addScaledVector(Chat, -c.cosG);
            if (tang.lengthSq() < 1e-9) { cullStats.degenerate = (cullStats.degenerate || 0) + 1; hideProxies(c.entry); continue; }
            tang.normalize();
            // Off-view azimuth (side/behind the heading) → drop; the horizon band
            // only flags what lies AHEAD, and bins aren't wasted on hidden ones.
            if (fwdHValid && tang.dot(fwdH) < COS_PROXY_CULL) { cullStats.azimuth = (cullStats.azimuth || 0) + 1; hideProxies(c.entry); continue; }
            if (shown.length >= MAX_TRI) { hideProxies(c.entry); continue; }
            // Losing the azimuth bin, or running past the name budget, DEMOTES to
            // a bare triangle instead of vanishing — that is the queue.
            const bin = Math.round(Math.atan2(tang.dot(Vb), tang.dot(Ub)) / BIN_RAD);
            const namedSlotFree = !usedBins.has(bin) && shown.filter((x) => x.named).length < MAX_NAMED;
            if (namedSlotFree) usedBins.add(bin);
            c.named = namedSlotFree;
            c.sig = sig(c);
            c.tang = tang;
            shown.push(c);
          }
          // Pass 3 — place the survivors just above the sampled skyline.
          const sDir = new THREE.Vector3(), sPos = new THREE.Vector3(), look = new THREE.Vector3();
          for (const c of shown) {
            const { entry, tang } = c;
            // Skyline elevation along this azimuth: the highest sightline angle
            // to terrain sampled at 60/85/100% of the way to the horizon.
            let maxSin = Math.sin(-alpha); // floor: the geometric (datum) horizon
            if (canSample) {
              for (const f of [0.6, 0.85, 1.0]) {
                const a = alpha * f;
                sDir.copy(Chat).multiplyScalar(Math.cos(a)).addScaledVector(tang, Math.sin(a));
                const lat = Math.asin(Math.max(-1, Math.min(1, sDir.y))) * 180 / Math.PI;
                const lonE = ((Math.atan2(sDir.z, -sDir.x) * 180 / Math.PI) % 360 + 360) % 360;
                let en = 0.5;
                try { en = sampleElevationNormalized(elevationSampler, lat, lonE) ?? 0.5; } catch (_e) {}
                sPos.copy(sDir).multiplyScalar(Rg + en * relief + tileLift);
                look.copy(sPos).sub(camLocal);
                const sinE = look.dot(Chat) / (look.length() || 1);
                if (sinE > maxSin) maxSin = sinE;
              }
            }
            const eSky = Math.asin(Math.max(-1, Math.min(1, maxSin)));
            // Size + fade as a function of how far beyond the horizon it lies —
            // floors keep even the farthest flags readable.
            const t = Math.min(1, c.over / 0.9);
            const fade = 0.95 - t * 0.55;                 // 0.95 → 0.40
            // SIZE BY SIGNIFICANCE. lod 1 (continent-scale) draws ~15% larger than
            // the baseline, lod 5 (individual craters) ~15% smaller, so the
            // skyline reads as a hierarchy instead of a wall of equal flags.
            const sigScale = 1.18 - 0.075 * (c.sig || 3);   // lod1 1.10 → lod5 0.81
            const triPx = (16 - t * 5) * sigScale;
            const labPx = (18 - t * 4) * sigScale;
            const triH = uppH * triPx, labH = uppH * labPx;
            const liveMap = entry.sprite.material?.map || null;
            if (!entry._fsTri) {
              entry._fsTri = new THREE.Sprite(new THREE.SpriteMaterial({ map: window.__fsTriTex, transparent: true, depthTest: true, depthWrite: false }));
              entry._fsTri.renderOrder = 93; entry._fsTri.frustumCulled = false; grp.add(entry._fsTri);
              // Clickable, exactly like an in-view label: carry the feature and
              // join the raycast set. Hidden proxies are filtered out by the
              // existing isObjectActuallyVisible() test, so an off-horizon
              // triangle cannot be picked.
              entry._fsTri.userData.feature = entry.item;
              labelLayer.interactiveObjects.push(entry._fsTri);
            }
            if (!entry._fsHLabel && liveMap) {
              entry._fsHLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: liveMap, transparent: true, depthTest: true, depthWrite: false }));
              entry._fsHLabel.renderOrder = 93; entry._fsHLabel.frustumCulled = false; grp.add(entry._fsHLabel);
              entry._fsHLabel.userData.feature = entry.item;
              labelLayer.interactiveObjects.push(entry._fsHLabel);
            }
            if (entry.marker.material?.color) entry._fsTri.material.color.copy(entry.marker.material.color);
            entry._fsRamp = Math.min(1, (entry._fsRamp || 0) + 0.08); // fade-in, no popping
            const op = fade * entry._fsRamp;
            // Sightline elevation for the triangle: skyline + 8 px pad + half its height.
            const eTri = eSky + (8 + triPx * 0.5) * anglePerPx;
            sDir.copy(tang).multiplyScalar(Math.cos(eTri)).addScaledVector(Chat, Math.sin(eTri));
            entry._fsTri.visible = true;
            entry._fsTri.material.opacity = op;
            entry._fsTri.position.copy(camLocal).addScaledVector(sDir, Dh);
            entry._fsTri.scale.set(triH, triH, 1);
            // RANGE READOUT, directly under the triangle. Surface distance from
            // the ship's ground point to the feature's: cosG is the cosine of
            // the central angle between them, so gamma * Rg converts straight to
            // ground range. Rounded to coarse steps (5 / 10 / 50 km by
            // magnitude) so the text is stable to read and the texture cache
            // does not churn while closing on a target.
            {
              const gamma = Math.acos(Math.max(-1, Math.min(1, c.cosG)));
              const distKm = gamma * Rg * ((VENUS_RADIUS_METERS / 1000) / 3.2);
              const stepKm = distKm < 100 ? 5 : distKm < 1000 ? 10 : 50;
              const shown = Math.max(stepKm, Math.round(distKm / stepKm) * stepKm);
              const txt = `${shown} km`;
              if (!entry._fsDist) {
                // depthTest OFF, unlike the glyph and name above it. The range sits
                // BELOW the triangle (eDist subtracts where the name adds), which
                // puts it right on the skyline, so a depth-tested sprite gets its
                // lower half eaten by the terrain it is annotating. The whole proxy
                // is an over-horizon readout — there is nothing in front of it that
                // should legitimately occlude it — and renderOrder 94 keeps it above
                // the glyph and name it belongs to.
                entry._fsDist = new THREE.Sprite(new THREE.SpriteMaterial({
                  transparent: true, depthTest: false, depthWrite: false,
                }));
                entry._fsDist.renderOrder = 94;
                entry._fsDist.frustumCulled = false;
                grp.add(entry._fsDist);
                entry._fsDist.userData.feature = entry.item;
                labelLayer.interactiveObjects.push(entry._fsDist);
              }
              if (entry._fsDistTxt !== txt) {
                entry._fsDist.material.map = fsDistTexture(txt);
                entry._fsDist.material.needsUpdate = true;
                entry._fsDistTxt = txt;
              }
              const dmap = entry._fsDist.material.map;
              const dImg = dmap && dmap.image;
              const dAspect = dImg && dImg.height ? dImg.width / dImg.height : 3;
              const distPx = 13 - t * 3;
              const distH = uppH * distPx;
              // BELOW the glyph: subtract, where the name label adds.
              const eDist = eTri - (triPx * 0.5 + distPx * 0.62) * anglePerPx;
              sDir.copy(tang).multiplyScalar(Math.cos(eDist)).addScaledVector(Chat, Math.sin(eDist));
              entry._fsDist.visible = c.named;
              entry._fsDist.material.opacity = Math.min(1, op * 1.35);
              entry._fsDist.position.copy(camLocal).addScaledVector(sDir, Dh);
              entry._fsDist.scale.set(distH * dAspect, distH, 1);
            }
            if (entry._fsHLabel && liveMap && c.named) {
              // Keep the proxy's texture in lockstep with the live label texture:
              // rebuildLabelTextures() swaps/disposes label maps, and a proxy left
              // holding a disposed map draws NOTHING — the "triangle with no name".
              if (entry._fsHLabel.material.map !== liveMap) {
                entry._fsHLabel.material.map = liveMap;
                entry._fsHLabel.material.needsUpdate = true;
              }
              const img = liveMap.image;
              const labAspect = img && img.height ? img.width / img.height : 4;
              const eLab = eTri + (triPx * 0.5 + labPx * 0.62) * anglePerPx;
              sDir.copy(tang).multiplyScalar(Math.cos(eLab)).addScaledVector(Chat, Math.sin(eLab));
              entry._fsHLabel.visible = true;
              // Thin outlined text vanishes at the triangle's far-fade alpha —
              // boost it so the name stays legible as far as the glyph itself.
              entry._fsHLabel.material.opacity = Math.min(1, op * 1.45);
              entry._fsHLabel.position.copy(camLocal).addScaledVector(sDir, Dh);
              entry._fsHLabel.scale.set(labH * labAspect, labH, 1);
            } else if (entry._fsHLabel) {
              entry._fsHLabel.visible = false;
            }
            // SCREEN-SPACE OVERLAP. Azimuth bins alone cannot prevent the pile-up
            // in a crowded band: bins measure DIRECTION, but a label has WIDTH, so
            // two flags 7° apart still overlap when their names are long. Test the
            // actual projected box against everything already placed — real
            // in-view labels first, then higher-significance proxies — and demote
            // to a bare triangle on collision. Candidates arrive in significance
            // order, so the loser is always the less important one.
            if (entry._fsHLabel?.visible) {
              const rect = spriteScreenRect(entry._fsHLabel);
              if (rect && occupiedRects.some((r) => rectsOverlap(r, rect))) {
                entry._fsHLabel.visible = false;
                if (entry._fsDist) entry._fsDist.visible = false;
                cullStats.declutteredNames = (cullStats.declutteredNames || 0) + 1;
              } else if (rect) {
                occupiedRects.push(rect);
              }
            }
          }
          // Landing-site labels (Beagle 2, Viking, …) get the same off-view drop —
          // their anchors can equally be flung on-screen from behind. Snapshot
          // pattern so turning back toward one restores it immediately.
          if (baseSiteLayer?.entries) {
            for (const e of baseSiteLayer.entries) {
              if (!e || !e.sprite) continue;
              if (e._fsBaseVisible === undefined) e._fsBaseVisible = !!e.sprite.visible;
              if (!e._fsBaseVisible) continue;
              const p = e.marker?.position || e.sprite.position;
              const onScreen = markerInView(p);
              e.sprite.visible = onScreen;
              if (e.line) e.line.visible = onScreen;
              if (e.marker) e.marker.visible = onScreen;
              if (!onScreen) cullStats.baseCulled++;
            }
          }
          cullStats.proxiesShown = shown.length;
          window.__fsCullStats = cullStats;
          window.__fsTriActive = true;
        } else if (window.__fsTriActive) {
          // Disengaged: hide every proxy and hand the labels back to the viewer
          // exactly as they were (visibility from the snapshot, orbit-style
          // see-through materials), then let the display-state pass resync.
          for (const entry of labelLayer.entries) {
            if (entry._fsTri) entry._fsTri.visible = false;
            if (entry._fsHLabel) entry._fsHLabel.visible = false;
            // _fsDist too. A horizon proxy owns THREE sprites, and this loop was
            // written listing only two — so on exit the range readouts ("400 km")
            // stayed painted over the globe with nothing to annotate.
            if (entry._fsDist) entry._fsDist.visible = false;
            if (entry._fsBaseVisible !== undefined && entry.sprite) {
              entry.sprite.visible = entry._fsBaseVisible;
              if (entry.line) entry.line.visible = entry._fsBaseVisible;
              if (entry.marker) entry.marker.visible = entry._fsBaseVisible;
            }
            if (entry.sprite?.material) {
              entry.sprite.material.depthTest = false;
              entry.sprite.material.depthWrite = false;   // see note above
            }
            if (entry.line?.material) entry.line.material.depthTest = false;
            if (entry.marker?.material) entry.marker.material.depthTest = false;
            entry._fsMode = undefined;
            entry._fsRamp = 0;
            entry._fsBaseVisible = undefined;
          }
          if (baseSiteLayer?.entries) {
            for (const e of baseSiteLayer.entries) {
              if (e && e._fsBaseVisible !== undefined && e.sprite) {
                e.sprite.visible = e._fsBaseVisible;
                if (e.line) e.line.visible = e._fsBaseVisible;
                if (e.marker) e.marker.visible = e._fsBaseVisible;
                e._fsBaseVisible = undefined;
              }
            }
          }
          window.__fsTriActive = false;
          try { applyPlanetDisplayState(); } catch (_e) {}
        }
        renderer.render(scene, camera);
        _freeTextureImages();
        requestAnimationFrame((timestamp) => {
          lastTimestamp = Math.max(16, timestamp - (lastTimestamp || timestamp));
          render();
        });
      }

      const hasAnyBaseTexture = baseLayers.some((layer) => layerTextures.get(layer.id));
      if (!hasAnyBaseTexture) {
        setStatus("Loaded fallback globe. Color texture missing.", true);
      } else if (!elevationMap && !initialGeologyTexture) {
        setStatus("Loaded base globe only. Elevation and geology layers unavailable.", true);
      } else if (!elevationMap) {
        setStatus("Loaded without terrain relief. Elevation map unavailable.", true);
      } else if (!initialGeologyTexture) {
        setStatus("Loaded without geology overlay. Overlay asset unavailable.", true);
      } else {
        resetStatus();
      }
      spinOffset = performance.now();

      // Background-load moon textures so Phobos/Deimos render correctly on first zoom.
      // All other layers (base, geology, mineral) load on demand when the user selects them.
      (function backgroundLoadLayers() {
        const moonQueue = moonData
          .filter(item => MOON_VIEWER_TEXTURES[item.name])
          .map(item => async () => {
            const tex = await loadTextureSafe(textureLoader, MOON_VIEWER_TEXTURES[item.name]);
            if (tex) tex.colorSpace = THREE.SRGBColorSpace;
            moonTextures.set(item.name, tex || null);
            if (tex && moonLayer?.entries) {
              const entry = moonLayer.entries.find(e => e.item?.name === item.name);
              if (entry?.moonMesh?.material) {
                entry.moonMesh.material.map = tex;
                entry.moonMesh.material.color.set("#ffffff");
                entry.moonMesh.material.needsUpdate = true;
              }
            }
            _freeTexImage(tex);
          });
        Promise.all(moonQueue.map(fn => fn())).catch(() => {});
      })();

      render();
      geologyFeaturePromise.then(catalog => {
        if (!catalog) return;
        const _state = {
          width: catalog.width || 4096,
          height: catalog.height || 2048,
          features: catalog.features || {},
          featureList: Object.values(catalog.features || {}),
          unit_legend: catalog.unit_legend || [],
          rock_legend: catalog.rock_legend || [],
          contacts: catalog.contacts || [],
          structures: catalog.structures || [],
          landing_sites: catalog.landing_sites || [],
        };
        const _geoTex = geologyTextures.get(geologyLayers[0]?.id || "sim3292-units");
        if (_geoTex && _geoTex.image) {
          try {
            const _img = _geoTex.image;
            const _w = _img.naturalWidth || _img.width || 4096;
            const _h = _img.naturalHeight || _img.height || 2048;
            const _sc = document.createElement("canvas");
            _sc.width = _w; _sc.height = _h;
            const _sctx = _sc.getContext("2d", { willReadFrequently: true });
            _sctx.drawImage(_img, 0, 0, _w, _h);
            _state.samplerCtx = _sctx;
            _state.samplerWidth = _w;
            _state.samplerHeight = _h;
          } catch (_e) {}
        }
        geologyInteractiveState = _state;
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState, geologyStructureLayers);
      }).catch(() => {});
      void runEmbeddedSmokeTest();
    }

    // Register Service Worker for persistent CTX tile caching.
    // After the first visit, tiles are served from disk (Cache API) instead of
    // the network — reducing per-tile latency from ~300ms to <5ms on revisit.
    if ('serviceWorker' in navigator) {
      const ctxServiceWorkerUrl = new URL("../../sw-ctx-tiles.js", window.location.href);
      navigator.serviceWorker.register(ctxServiceWorkerUrl.href).catch(() => {});
    }

    init().catch((error) => {
      console.error(error);
      setStatus(`Viewer failed to load: ${error.message}`, true);
      showViewerErrorState(error.message);
    });

    // NASA sounds audio player (play/pause only — no seek bar)
    (function () {
      const audioEl = document.getElementById("mars-audio-el");
      const playBtn = document.getElementById("audio-play-btn");
      const iconPlay = document.getElementById("audio-icon-play");
      const iconPause = document.getElementById("audio-icon-pause");
      if (!audioEl || !playBtn) return;
      playBtn.addEventListener("click", () => {
        if (audioEl.paused) { audioEl.play(); } else { audioEl.pause(); }
      });
      audioEl.addEventListener("play",  () => { iconPlay.style.display = "none";  iconPause.style.display = "block"; });
      audioEl.addEventListener("pause", () => { iconPlay.style.display = "block"; iconPause.style.display = "none"; });
      audioEl.addEventListener("ended", () => { iconPlay.style.display = "block"; iconPause.style.display = "none"; });
    })();

    // Info button tutorial modal
    const infoBtn = document.getElementById("info-btn");
    const viewerInfo = document.getElementById("viewer-info");
    const viewerHelpOverlay = document.getElementById("viewer-help-overlay");
    const viewerHelpModal = document.getElementById("viewer-help-modal");
    const viewerHelpClose = document.getElementById("viewer-help-close");
    if (viewerInfo) {
      viewerInfo.hidden = true;
    }
    if (infoBtn && viewerHelpOverlay && viewerHelpModal) {
      const openViewerHelp = () => {
        viewerHelpOverlay.hidden = false;
        infoBtn.classList.add("is-active");
        window.requestAnimationFrame(() => viewerHelpModal.focus());
      };
      const closeViewerHelp = () => {
        viewerHelpOverlay.hidden = true;
        infoBtn.classList.remove("is-active");
      };
      infoBtn.addEventListener("click", () => {
        if (viewerHelpOverlay.hidden) {
          openViewerHelp();
        } else {
          closeViewerHelp();
        }
      });
      viewerHelpClose?.addEventListener("click", closeViewerHelp);
      viewerHelpOverlay.addEventListener("click", (event) => {
        if (event.target instanceof HTMLElement && event.target.dataset.helpClose === "true") {
          closeViewerHelp();
        }
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !viewerHelpOverlay.hidden) {
          closeViewerHelp();
        }
      });
    }

    // Nav panel collapse toggle
    const uiPanel = document.getElementById("ui");
    const navCollapseBtn = document.getElementById("nav-collapse-btn");
    const navTab = document.getElementById("nav-tab");
    const toolbar = document.getElementById("toolbar");
    const toolbarCollapseBtn = document.getElementById("toolbar-collapse-btn");
    const toolbarTab = document.getElementById("toolbar-tab");
    const surfaceHud = document.getElementById("bottom-right-hud");
    // Mobile: inject backdrop element for closing the panel by tapping outside
    const backdrop = document.createElement("div");
    backdrop.id = "mobile-panel-backdrop";
    document.body.appendChild(backdrop);

    const isMobileLayout = () => window.matchMedia("(hover: none) and (pointer: coarse)").matches;

    function openPanel() {
      uiPanel?.classList.remove("is-collapsed");
      navTab.style.display = "none";
      surfaceHud?.classList.remove("nav-collapsed");
      if (isMobileLayout()) backdrop.classList.add("is-visible");
    }
    function closePanel() {
      uiPanel?.classList.add("is-collapsed");
      navTab.style.display = "flex";
      surfaceHud?.classList.add("nav-collapsed");
      backdrop.classList.remove("is-visible");
    }

    if (uiPanel && navCollapseBtn && navTab) {
      openPanel();
      if (isMobileLayout()) closePanel();

      navCollapseBtn.addEventListener("click", closePanel);
      navTab.addEventListener("click", openPanel);
      backdrop.addEventListener("click", closePanel);
    }

    if (toolbar && toolbarCollapseBtn && toolbarTab) {
      toolbar.classList.add("is-collapsed");
      toolbarTab.style.display = "none";
      toolbarCollapseBtn.addEventListener("click", () => {
        toolbar.classList.add("is-collapsed");
        toolbarTab.style.display = "none";
      });
      toolbarTab.addEventListener("click", () => {
        toolbar.classList.remove("is-collapsed");
        toolbarTab.style.display = "none";
      });
    }
