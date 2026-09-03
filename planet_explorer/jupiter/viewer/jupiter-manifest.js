    const manifest = {"texture": {"path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-jupiter/jupiter_color.jpg?v=6b835ddd8036", "width": 4096, "source_page_url": "https://science.nasa.gov/solar-system/planets/jupiter/"}, "jupiter": {"body_scale_y": 0.935, "axial_tilt_deg": 3.13}, "elevation": {"path": "assets/jupiter_elevation.png?v=1773417264", "width": 2048, "min_m": 0.0, "max_m": 0.0, "relief_m": 0.0, "source_page_url": "synthetic-flat-dem"}, "geology": {"path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-jupiter/jupiter_geology_sim3292.png?v=9f5ac25d643f", "size": [4096, 2048], "description": "Enhanced atmospheric context layer derived from the official NASA Jupiter image."}, "geology_interactive": {"feature_path": "assets/jupiter_geology_features.json"}, "geology_layers": [{"id": "enhanced-atmosphere", "label": "Enhanced Atmosphere", "path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-jupiter/jupiter_geology_sim3292.png?v=9f5ac25d643f", "description": "Locally enhanced atmospheric context derived from the official NASA Jupiter image.", "source_page_url": "https://science.nasa.gov/solar-system/planets/jupiter/", "size": [4096, 2048], "default": true}], "layers": [{"id": "jupiter-visible", "label": "Jupiter Body", "path": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-jupiter/jupiter_color.jpg?v=6b835ddd8036", "description": "Derived Jupiter body texture for the oblate globe, separated from the ring system.", "source_page_url": "https://science.nasa.gov/solar-system/planets/jupiter/", "default": true}], "seismic": {"path": "assets/jupiter_insight_seismic_events.json?v=1773417266", "description": "Placeholder event catalog; no Mars-style seismic dataset applies to Jupiter in this workflow.", "source_page_url": "https://science.nasa.gov/jupiter/facts/", "event_count": 0, "located_event_count": 0, "clustered_event_count": 0}, "sources": {"texture_url": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-jupiter/jupiter_color.jpg?v=6b835ddd8036", "ring_texture_url": "procedural-km-calibrated-main-ring-texture", "dem_url": "synthetic-flat-dem", "geology_url": "https://data.geoidinitiative.com/assets/hotlink-ok/planet-jupiter/jupiter_color.jpg?v=6b835ddd8036", "geology_database_path": "https://science.nasa.gov/jupiter/facts/", "tes_albedo_url": "derived-grayscale-band-layer", "tes_thermal_inertia_url": "derived-storm-contrast-layer", "geology_notes_url": "https://science.nasa.gov/jupiter/facts/", "geology_dmu_url": "https://science.nasa.gov/jupiter/facts/", "geology_map_url": "https://science.nasa.gov/jupiter/facts/", "geology_database_url": "https://science.nasa.gov/jupiter/facts/", "geology_original_units_citation": "Jupiter uses an atmosphere-focused context workflow rather than a solid-surface geology map database.", "tes_albedo_page_url": "https://science.nasa.gov/solar-system/planets/jupiter/", "tes_thermal_inertia_page_url": "https://science.nasa.gov/solar-system/planets/jupiter/", "magnetic_anomaly_page_url": "https://science.nasa.gov/jupiter/facts/", "themis_day_ir_page_url": "https://science.nasa.gov/jupiter/facts/", "themis_night_ir_page_url": "https://science.nasa.gov/jupiter/facts/", "tethys_texture_page_url": "https://www.jpl.nasa.gov/images/pia11673-map-of-tethys-august-2010/"}, "mineral_layers": []};
;
    const startupStatusNode = document.getElementById("status");
    window.__jupiterViewerManifest = manifest;
    window.__jupiterViewerStartup = {
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

      window.__jupiterViewerStartup.criticalMissing = criticalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__jupiterViewerStartup.optionalMissing = optionalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__jupiterViewerStartup.checked = true;

      if (window.__jupiterViewerStartup.criticalMissing.length > 0) {
        setStartupStatus(
          "Missing required files: " + window.__jupiterViewerStartup.criticalMissing.join(", "),
          true,
        );
        return;
      }

      if (window.__jupiterViewerStartup.optionalMissing.length > 0) {
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
