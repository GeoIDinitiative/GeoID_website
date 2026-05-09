const manifest = {"texture": {"path": "assets/earth_color.jpg", "width": 1440, "source_page_url": "https://science.nasa.gov/3d-resources/earth-a/"}, "elevation": {"path": "assets/earth_elevation.png", "width": 4096, "height": 2048, "min_m": -10930, "max_m": 8627, "relief_m": 19557, "source_page_url": "https://www.gebco.net/data-products/gridded-bathymetry-data#global"}, "geology": {"path": "assets/earth_geology_sim3292.png", "size": [4096, 2048], "description": "Derived bathymetry and topography context layer based on GEBCO 2025 relief.", "source_page_url": "https://www.gebco.net/data-products/gridded-bathymetry-data#global"}, "geology_interactive": {"feature_path": "assets/earth_geology_features.json", "size": [4096, 2048], "feature_count": 0}, "geology_layers": [{"id": "gebco-bathy-context", "label": "GEBCO Relief Context", "path": "assets/earth_geology_sim3292.png", "description": "Derived bathymetry and topography context overlay based on GEBCO 2025.", "source_page_url": "https://www.gebco.net/data-products/gridded-bathymetry-data#global", "size": [4096, 2048], "default": true}], "layers": [{"id": "earth-visible", "label": "Earth Surface", "path": "assets/earth_color.jpg", "description": "NASA Earth surface texture basemap.", "source_page_url": "https://science.nasa.gov/3d-resources/earth-a/", "default": true}, {"id": "derived-hillshade", "label": "GEBCO Hillshade", "path": "assets/earth_hillshade.jpg", "description": "Derived hillshade generated from the GEBCO 2025 global elevation model.", "source_page_url": "https://www.gebco.net/data-products/gridded-bathymetry-data#global", "size": [4096, 2048]}, {"id": "derived-slope", "label": "GEBCO Slope", "path": "assets/earth_slope.jpg", "description": "Derived slope basemap generated from the GEBCO 2025 global elevation model.", "source_page_url": "https://www.gebco.net/data-products/gridded-bathymetry-data#global", "size": [4096, 2048]}], "seismic": {"path": "assets/earth_seismic_events.json", "description": "Placeholder catalog; no earthquake catalog is bundled in this Earth workflow.", "source_page_url": "https://earthquake.usgs.gov/", "event_count": 0, "located_event_count": 0, "clustered_event_count": 0}, "mineral_layers": [], "sources": {"texture_url": "https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/image/earth-(a)/Earth%20(A).jpg", "dem_url": "https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/", "geology_url": "derived/from-gebco-hillshade-and-earth-texture", "geology_database_path": "https://www.gebco.net/", "tes_albedo_url": "https://www.gebco.net/", "tes_thermal_inertia_url": "https://www.gebco.net/", "geology_notes_url": "https://www.gebco.net/", "geology_dmu_url": "https://www.gebco.net/", "geology_map_url": "https://www.gebco.net/", "geology_database_url": "https://www.gebco.net/", "geology_original_units_citation": "GEBCO Compilation Group (2025) GEBCO 2025 Grid, doi:10.5285/37c52e96-24ea-67ce-e063-7086abc05f29.", "tes_albedo_page_url": "https://www.gebco.net/", "tes_thermal_inertia_page_url": "https://www.gebco.net/", "magnetic_anomaly_page_url": "https://science.nasa.gov/earth/", "themis_day_ir_page_url": "https://www.gebco.net/", "themis_night_ir_page_url": "https://www.gebco.net/"}, "planet": {"axial_tilt_deg": 23.44}};
    const startupStatusNode = document.getElementById("status");
    window.__earthViewerManifest = manifest;
    window.__earthViewerStartup = {
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
        window.__earthViewerStartup.checked = true;
        window.__earthViewerStartup.warnings.push(
          "Viewer opened from file://. Skipping network-based asset checks.",
        );
        setStartupStatus("Initializing viewer...");
        return;
      }

      setStartupStatus("Checking local viewer files...");

      const critical = [
        "./vendor/three.module.js",
        "./vendor/OrbitControls.js",
        manifest.texture.path,
      ];
      const optional = [
        manifest.elevation.path,
        manifest.geology.path,
      ];
      if (manifest.geology_interactive?.feature_path) {
        optional.push(manifest.geology_interactive.feature_path);
      }
      if (manifest.seismic && manifest.seismic.path) {
        optional.push(manifest.seismic.path);
      }

      const criticalChecks = await Promise.all(
        critical.map(async (path) => [path, await checkLocalAsset(path)]),
      );
      const optionalChecks = await Promise.all(
        optional.map(async (path) => [path, await checkLocalAsset(path)]),
      );

      window.__earthViewerStartup.criticalMissing = criticalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__earthViewerStartup.optionalMissing = optionalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__earthViewerStartup.checked = true;

      if (window.__earthViewerStartup.criticalMissing.length > 0) {
        setStartupStatus(
          "Missing required files: " + window.__earthViewerStartup.criticalMissing.join(", "),
          true,
        );
        return;
      }

      if (window.__earthViewerStartup.optionalMissing.length > 0) {
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
