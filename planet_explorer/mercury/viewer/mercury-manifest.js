const manifest = {"texture": {"path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_color.jpg?v=f0148673d25a", "width": 4096, "texture_offset_x": 0.5, "texture_repeat_x": 1, "source_page_url": "https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_basemap_md3_color_global_mosaic_665m"}, "elevation": {"path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_elevation.png?v=1032ec850126", "width": 2048, "min_m": -10733.0, "max_m": 8955.0, "relief_m": 19688.0, "texture_offset_x": 0.5, "texture_repeat_x": 1, "source_page_url": "https://astrogeology.usgs.gov/search/map/mercury_messenger_global_dem_665m"}, "geology": {"path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_geology_sim3292.png?v=68624230d2de", "size": [4096, 2048], "description": "Enhanced-color compositional context overlay derived from MESSENGER global products.", "source_page_url": "https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_basemap_enhanced_color_global_mosaic_665m"}, "geology_interactive": {"feature_path": "assets/mercury_geology_features.json", "size": [4096, 2048], "feature_count": 0}, "geology_layers": [{"id": "enhanced-color-context", "label": "Enhanced Color Context", "path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_geology_sim3292.png?v=68624230d2de", "description": "Enhanced-color compositional context overlay from MESSENGER global products.", "source_page_url": "https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_basemap_enhanced_color_global_mosaic_665m", "size": [4096, 2048], "texture_offset_x": 0.5, "texture_repeat_x": 1, "default": true}], "layers": [{"id": "mercury-md3-color", "label": "MD3 Color", "path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_color.jpg?v=f0148673d25a", "description": "MESSENGER MD3 false-color global mosaic.", "source_page_url": "https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_basemap_md3_color_global_mosaic_665m", "texture_offset_x": 0.5, "texture_repeat_x": 1, "default": true}, {"id": "mercury-monochrome", "label": "750 nm Mosaic", "path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_tes_albedo.png?v=26321f9878d7", "description": "MESSENGER global monochrome mosaic built from 750 nm imagery.", "source_page_url": "https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_global_mosaic_250m", "texture_offset_x": 0.5, "texture_repeat_x": 1, "size": [2880, 1440]}, {"id": "mercury-enhanced-color", "label": "Enhanced Color", "path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_tes_thermal_inertia.png?v=87ec4413bd84", "description": "MESSENGER enhanced-color mosaic emphasizing subtle compositional differences.", "source_page_url": "https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_basemap_enhanced_color_global_mosaic_665m", "texture_offset_x": 0.5, "texture_repeat_x": 1, "size": [2880, 1440]}, {"id": "derived-hillshade", "label": "Hillshade", "path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_hillshade_v2.jpg?v=015de35df157", "description": "Derived hillshade generated from the global Mercury topography model.", "source_page_url": "https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif", "texture_offset_x": 0.5, "texture_repeat_x": 1, "size": [2048, 1024]}, {"id": "derived-slope", "label": "Slope", "path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-mercury/mercury_slope_v2.jpg?v=6a2d26a39d26", "description": "Derived slope basemap generated from the global Mercury topography model.", "source_page_url": "https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif", "texture_offset_x": 0.5, "texture_repeat_x": 1, "size": [2048, 1024]}], "sources": {"texture_url": "https://planetarymaps.usgs.gov/mosaic/Mercury_MESSENGER_MDIS_Basemap_MD3Color_Mosaic_Global_665m.tif", "dem_url": "https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif", "geology_url": "https://planetarymaps.usgs.gov/mosaic/Mercury_MESSENGER_MDIS_Basemap_EnhancedColor_Mosaic_Global_665m.tif", "geology_database_path": "https://astrogeology.usgs.gov/search/map/mercury-messenger-global-products", "tes_albedo_url": "https://planetarymaps.usgs.gov/mosaic//Mercury_MESSENGER_mosaic_global_250m_2013.tif", "tes_thermal_inertia_url": "https://planetarymaps.usgs.gov/mosaic/Mercury_MESSENGER_MDIS_Basemap_EnhancedColor_Mosaic_Global_665m.tif", "geology_notes_url": "https://astrogeology.usgs.gov/search/map/mercury-messenger-global-products", "geology_dmu_url": "https://astrogeology.usgs.gov/search/map/mercury-messenger-global-products", "geology_map_url": "https://astrogeology.usgs.gov/search/map/mercury-messenger-global-products", "geology_database_url": "https://astrogeology.usgs.gov/search/map/mercury-messenger-global-products", "geology_original_units_citation": "Enhanced-color context overlay uses official MESSENGER global Mercury products; this workflow does not include a Mars-style global vector geology database for Mercury.", "tes_albedo_page_url": "https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_global_mosaic_250m", "tes_thermal_inertia_page_url": "https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_basemap_enhanced_color_global_mosaic_665m", "magnetic_anomaly_page_url": "https://astrogeology.usgs.gov/search/map/mercury-messenger-global-products", "themis_day_ir_page_url": "https://astrogeology.usgs.gov/search/map/mercury-messenger-global-products", "themis_night_ir_page_url": "https://astrogeology.usgs.gov/search/map/mercury-messenger-global-products"}, "planet": {"axial_tilt_deg": 0.034}};
    const startupStatusNode = document.getElementById("status");
    window.__mercuryViewerManifest = manifest;
    window.__mercuryViewerStartup = {
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
        window.__mercuryViewerStartup.checked = true;
        window.__mercuryViewerStartup.warnings.push(
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

      window.__mercuryViewerStartup.criticalMissing = criticalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__mercuryViewerStartup.optionalMissing = optionalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__mercuryViewerStartup.checked = true;

      if (window.__mercuryViewerStartup.criticalMissing.length > 0) {
        setStartupStatus(
          "Missing required files: " + window.__mercuryViewerStartup.criticalMissing.join(", "),
          true,
        );
        return;
      }

      if (window.__mercuryViewerStartup.optionalMissing.length > 0) {
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
