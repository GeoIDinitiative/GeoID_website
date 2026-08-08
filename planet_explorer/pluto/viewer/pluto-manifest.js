const manifest = {
  "texture": {
    "path": "assets/pluto_color.jpg?v=1778680838",
    "width": 4096,
    "source_page_url": "https://astrogeology.usgs.gov/search/map/pluto_new_horizons_global_mosaic_300m"
  },
  "elevation": {
    "path": "assets/pluto_elevation.png?v=1778619309",
    "width": 2048,
    "min_m": -4101.0,
    "max_m": 6491.0,
    "relief_m": 10592.0,
    "texture_offset_x": 0.0,
    "source_page_url": "https://astrogeology.usgs.gov/search/map/pluto_new_horizons_digital_elevation_model"
  },
  "geology": {
    "path": "",
    "size": [4096, 2048],
    "description": "No geology overlay available for Pluto.",
    "source_page_url": ""
  },
  "geology_interactive": {
    "feature_path": "",
    "size": [4096, 2048],
    "feature_count": 0
  },
  "geology_layers": [],
  "layers": [
    {
      "id": "nh-color",
      "label": "NH Color Mosaic",
      "path": "assets/pluto_color.jpg?v=1778680838",
      "description": "New Horizons LORRI/Ralph enhanced-color global mosaic of Pluto.",
      "source_page_url": "https://astrogeology.usgs.gov/search/map/pluto_new_horizons_global_mosaic_300m",
      "default": true
    },
    {
      "id": "derived-hillshade",
      "label": "Hillshade",
      "path": "assets/pluto_hillshade.jpg?v=1778619281",
      "description": "Derived hillshade generated from the New Horizons global Pluto topography model.",
      "source_page_url": "https://astrogeology.usgs.gov/search/map/pluto_new_horizons_digital_elevation_model",
      "texture_offset_x": 0.0,
      "size": [2048, 1024]
    },
    {
      "id": "derived-slope",
      "label": "Slope",
      "path": "assets/pluto_slope.jpg?v=1778619281",
      "description": "Derived slope basemap generated from the New Horizons global Pluto topography model.",
      "source_page_url": "https://astrogeology.usgs.gov/search/map/pluto_new_horizons_digital_elevation_model",
      "texture_offset_x": 0.0,
      "size": [2048, 1024]
    }
  ],
  "sources": {
    "texture_url": "https://astrogeology.usgs.gov/search/map/pluto_new_horizons_global_mosaic_300m",
    "dem_url": "https://astrogeology.usgs.gov/search/map/pluto_new_horizons_digital_elevation_model"
  },
  "planet": {
    "axial_tilt_deg": 60.49
  },
  "updatedAt": "20260513-pluto"
};
const startupStatusNode = document.getElementById("status");
window.__plutoViewerManifest = manifest;
window.__mercuryViewerManifest = manifest;
window.__plutoViewerStartup = {
  checked: false,
  criticalMissing: [],
  optionalMissing: [],
  warnings: [],
};

function setStartupStatus(message, isError = false) {
  startupStatusNode.textContent = message;
  startupStatusNode.classList.toggle("is-error", isError);
}

async function checkLocalAsset(path) {
  try {
    const response = await fetch(path, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function runStartupChecks() {
  const protocol = window.location.protocol;
  const isLocalFileLaunch = protocol === "file:";
  if (isLocalFileLaunch) {
    window.__plutoViewerStartup.checked = true;
    window.__plutoViewerStartup.warnings.push(
      "Viewer opened from file://. Skipping network-based asset checks.",
    );
    setStartupStatus("Initializing viewer...");
    return;
  }

  setStartupStatus("Checking local viewer files...");

  const critical = [
    "/GeoID_GIS/viewer/vendor/three.module.js",
    "/GeoID_GIS/viewer/vendor/OrbitControls.js",
    manifest.texture.path,
  ];
  const optional = [
    manifest.elevation.path,
  ];

  const criticalChecks = await Promise.all(
    critical.map(async (path) => [path, await checkLocalAsset(path)]),
  );
  const optionalChecks = await Promise.all(
    optional.map(async (path) => [path, await checkLocalAsset(path)]),
  );

  window.__plutoViewerStartup.criticalMissing = criticalChecks
    .filter(([, ok]) => !ok)
    .map(([path]) => path);
  window.__plutoViewerStartup.optionalMissing = optionalChecks
    .filter(([, ok]) => !ok)
    .map(([path]) => path);
  window.__plutoViewerStartup.checked = true;

  if (window.__plutoViewerStartup.criticalMissing.length > 0) {
    setStartupStatus(
      "Missing required files: " + window.__plutoViewerStartup.criticalMissing.join(", "),
      true,
    );
    return;
  }

  if (window.__plutoViewerStartup.optionalMissing.length > 0) {
    setStartupStatus(
      "Optional files missing. Viewer will use reduced detail if needed.",
      false,
    );
    return;
  }

  setStartupStatus("Initializing viewer...");
}

runStartupChecks().catch((error) => {
  console.error(error);
  setStartupStatus("Startup checks failed: " + error.message, true);
});
