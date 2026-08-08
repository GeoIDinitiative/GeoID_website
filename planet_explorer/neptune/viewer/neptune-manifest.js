    const manifest = {"texture": {"path": "assets/neptune_body_color.jpg?v=1777746549", "width": 4096, "source_page_url": "https://science.nasa.gov/solar-system/planets/neptune/"}, "neptune": {"body_scale_y": 0.983, "axial_tilt_deg": 28.32, "rings": {"path": "assets/neptune_rings.png?v=1774035791", "inner_km": 41900, "outer_km": 64500, "inner_radius": 1.693, "outer_radius": 2.543, "opacity": 0.75, "texture_repeat": 1, "texture_offset": 0, "source_page_url": "https://science.nasa.gov/neptune/moons-and-rings/"}}, "elevation": {"path": "assets/neptune_elevation.png?v=1774035791", "width": 2048, "min_m": 0.0, "max_m": 0.0, "relief_m": 0.0, "source_page_url": "synthetic-flat-dem"}, "geology": {"path": "assets/neptune_geology_sim3292.png?v=1774035788", "size": [4096, 2048], "description": "Enhanced atmospheric context layer derived from the official NASA Neptune image."}, "geology_interactive": {"feature_path": "assets/neptune_geology_features.json"}, "geology_layers": [{"id": "enhanced-atmosphere", "label": "Enhanced Atmosphere", "path": "assets/neptune_geology_sim3292.png?v=1774035788", "description": "Locally enhanced atmospheric context derived from the official NASA Neptune image.", "source_page_url": "https://science.nasa.gov/solar-system/planets/neptune/", "size": [4096, 2048], "default": true}], "layers": [{"id": "neptune-visible", "label": "Neptune Body", "path": "assets/neptune_body_color.jpg?v=1777746549", "description": "Derived Neptune body texture for the oblate globe, separated from the ring system.", "source_page_url": "https://science.nasa.gov/solar-system/planets/neptune/", "default": true}], "seismic": {"path": "assets/neptune_insight_seismic_events.json?v=1774035791", "description": "Placeholder event catalog; no Mars-style seismic dataset applies to Neptune in this workflow.", "source_page_url": "https://science.nasa.gov/neptune/facts/", "event_count": 0, "located_event_count": 0, "clustered_event_count": 0}, "sources": {"texture_url": "assets/neptune_color.jpg", "ring_texture_url": "procedural-km-calibrated-main-ring-texture", "dem_url": "synthetic-flat-dem", "geology_url": "assets/neptune_color.jpg", "geology_database_path": "https://science.nasa.gov/neptune/facts/", "tes_albedo_url": "derived-grayscale-band-layer", "tes_thermal_inertia_url": "derived-storm-contrast-layer", "geology_notes_url": "https://science.nasa.gov/neptune/facts/", "geology_dmu_url": "https://science.nasa.gov/neptune/facts/", "geology_map_url": "https://science.nasa.gov/neptune/facts/", "geology_database_url": "https://science.nasa.gov/neptune/facts/", "geology_original_units_citation": "Neptune uses an atmosphere-focused context workflow rather than a solid-surface geology map database.", "tes_albedo_page_url": "https://science.nasa.gov/solar-system/planets/neptune/", "tes_thermal_inertia_page_url": "https://science.nasa.gov/solar-system/planets/neptune/", "magnetic_anomaly_page_url": "https://science.nasa.gov/neptune/facts/", "themis_day_ir_page_url": "https://science.nasa.gov/neptune/facts/", "themis_night_ir_page_url": "https://science.nasa.gov/neptune/facts/", "tethys_texture_page_url": "https://www.jpl.nasa.gov/images/pia11673-map-of-tethys-august-2010/"}, "mineral_layers": []};
;
    const startupStatusNode = document.getElementById("status");
    window.__neptuneViewerManifest = manifest;
    window.__neptuneViewerStartup = {
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

      window.__neptuneViewerStartup.criticalMissing = criticalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__neptuneViewerStartup.optionalMissing = optionalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__neptuneViewerStartup.checked = true;

      if (window.__neptuneViewerStartup.criticalMissing.length > 0) {
        setStartupStatus(
          "Missing required files: " + window.__neptuneViewerStartup.criticalMissing.join(", "),
          true,
        );
        return;
      }

      if (window.__neptuneViewerStartup.optionalMissing.length > 0) {
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
