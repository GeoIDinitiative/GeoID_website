const manifest = {"texture": {"path": "assets/venus_color.jpg?v=1773379748", "width": 4096, "source_page_url": "https://astrogeology.usgs.gov/search/map/Venus/Magellan/Venus_Magellan_C3MDIRColorizedTopoMosaic_global_6600m"}, "elevation": {"path": "assets/venus_elevation.png?v=1773380069", "width": 2048, "min_m": -2886.0, "max_m": 11600.0, "relief_m": 14486.0, "source_page_url": "https://astrogeology.usgs.gov/search/map/venus_mission_data/topography/venus_magellan_gtdr_global_4641m"}, "geology": {"path": "assets/venus_geology_sim3292.png?v=1773381377", "size": [4096, 2048], "description": "Colorized topographic context overlay derived from Magellan global products."}, "geology_interactive": {"feature_path": "assets/venus_geology_features.json", "size": [4096, 2048], "feature_count": 0}, "geology_layers": [{"id": "topographic-context", "label": "Topographic Context", "path": "assets/venus_geology_sim3292.png?v=1773381377", "description": "Colorized topographic context overlay from Magellan global products.", "source_page_url": "https://astrogeology.usgs.gov/search/map/venus_mission_data/magellan", "size": [4096, 2048], "default": true}], "layers": [{"id": "venus-surface", "label": "Venus Surface", "path": "assets/venus_color.jpg?v=1773379748", "description": "USGS Magellan synthetic color global mosaic basemap.", "source_page_url": "https://astrogeology.usgs.gov/search/map/Venus/Magellan/Venus_Magellan_C3MDIRColorizedTopoMosaic_global_6600m", "default": true}, {"id": "derived-hillshade", "label": "Hillshade", "path": "assets/venus_hillshade.jpg?v=1773413425", "description": "Derived hillshade generated from the global Venus topography model.", "source_page_url": "https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_Topography_Global_4641m_v02.tif", "size": [2048, 1024]}, {"id": "derived-slope", "label": "Slope", "path": "assets/venus_slope.jpg?v=1773413425", "description": "Derived slope basemap generated from the global Venus topography model.", "source_page_url": "https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_Topography_Global_4641m_v02.tif", "size": [2048, 1024]}], "sources": {"texture_url": "https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_C3-MDIR_Colorized_Global_Mosaic_4641m.tif", "dem_url": "https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_Topography_Global_4641m_v02.tif", "geology_url": "https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_C3-MDIR_ClrTopo_Global_Mosaic_6600m.tif", "geology_database_path": "https://astrogeology.usgs.gov/search/map/venus_mission_data/magellan", "tes_albedo_url": "https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_FresnelReflectivity_Global_4641m.tif", "tes_thermal_inertia_url": "https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_MicrowaveEmissivity_Global_4641m.tif", "geology_notes_url": "https://astrogeology.usgs.gov/search/map/venus_mission_data/magellan", "geology_dmu_url": "https://astrogeology.usgs.gov/search/map/venus_mission_data/magellan", "geology_map_url": "https://astrogeology.usgs.gov/search/map/venus_mission_data/magellan", "geology_database_url": "https://astrogeology.usgs.gov/search/map/venus_mission_data/magellan", "geology_original_units_citation": "Topographic context overlay uses Magellan global Venus products; this workflow does not include a Mars-style global vector geology database for Venus.", "tes_albedo_page_url": "https://astrogeology.usgs.gov/search/map/venus_mission_data/magellan", "tes_thermal_inertia_page_url": "https://astrogeology.usgs.gov/search/map/venus_mission_data/magellan", "magnetic_anomaly_page_url": "https://astrogeology.usgs.gov/search/map/venus_mission_data/magellan", "themis_day_ir_page_url": "https://astrogeology.usgs.gov/search/map/venus_mission_data/magellan", "themis_night_ir_page_url": "https://astrogeology.usgs.gov/search/map/venus_mission_data/magellan"}, "planet": {"axial_tilt_deg": 2.64}};
    const startupStatusNode = document.getElementById("status");
    window.__venusViewerManifest = manifest;
    window.__venusViewerStartup = {
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
        window.__venusViewerStartup.checked = true;
        window.__venusViewerStartup.warnings.push(
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

      window.__venusViewerStartup.criticalMissing = criticalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__venusViewerStartup.optionalMissing = optionalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__venusViewerStartup.checked = true;

      if (window.__venusViewerStartup.criticalMissing.length > 0) {
        setStartupStatus(
          "Missing required files: " + window.__venusViewerStartup.criticalMissing.join(", "),
          true,
        );
        return;
      }

      if (window.__venusViewerStartup.optionalMissing.length > 0) {
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
