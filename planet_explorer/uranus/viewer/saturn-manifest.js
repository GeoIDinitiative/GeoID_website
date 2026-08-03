    const manifest = {"texture": {"path": "assets/saturn_body_color.jpg", "width": 4096, "source_page_url": "https://science.nasa.gov/solar-system/planets/saturn/"}, "saturn": {"body_scale_y": 0.902, "axial_tilt_deg": 26.7, "rings": {"path": "assets/saturn_rings.webp", "inner_km": 66900, "outer_km": 143000, "inner_radius": 3.552, "outer_radius": 7.596, "opacity": 0.92, "texture_repeat": 1, "texture_offset": 0, "source_page_url": "https://pds-rings.seti.org/saturn/"}}, "elevation": {"path": "assets/saturn_elevation.png", "width": 2048, "min_m": 0.0, "max_m": 0.0, "relief_m": 0.0, "source_page_url": "synthetic-flat-dem"}, "geology": {"path": "assets/saturn_geology_sim3292.png", "size": [4096, 2048], "description": "Enhanced atmospheric context layer derived from the official NASA Saturn image."}, "geology_interactive": {"feature_path": "assets/saturn_geology_features.json"}, "geology_layers": [{"id": "enhanced-atmosphere", "label": "Enhanced Atmosphere", "path": "assets/saturn_geology_sim3292.png", "description": "Locally enhanced atmospheric context derived from the official NASA Saturn image.", "source_page_url": "https://science.nasa.gov/solar-system/planets/saturn/", "size": [4096, 2048], "default": true}], "layers": [{"id": "saturn-visible", "label": "Saturn Body", "path": "assets/saturn_body_color.jpg", "description": "Derived Saturn body texture for the oblate globe, separated from the ring system.", "source_page_url": "https://science.nasa.gov/solar-system/planets/saturn/", "default": true}, {"id": "saturn-band-contrast", "label": "Band Contrast", "path": "assets/saturn_tes_albedo.png", "description": "Derived grayscale layer emphasizing atmospheric bands and haze structure.", "source_page_url": "https://science.nasa.gov/solar-system/planets/saturn/", "size": [2880, 1440]}, {"id": "saturn-storm-contrast", "label": "Storm Contrast", "path": "assets/saturn_tes_thermal_inertia.png", "description": "Derived high-contrast layer emphasizing vortices and cloud texture boundaries.", "source_page_url": "https://science.nasa.gov/solar-system/planets/saturn/", "size": [2880, 1440]}], "seismic": {"path": "assets/saturn_insight_seismic_events.json", "description": "Placeholder event catalog; no Mars-style seismic dataset applies to Saturn in this workflow.", "source_page_url": "https://science.nasa.gov/saturn/facts/", "event_count": 0, "located_event_count": 0, "clustered_event_count": 0}, "sources": {"texture_url": "assets/saturn_color_upscaled.jpg", "ring_texture_url": "procedural-km-calibrated-main-ring-texture", "dem_url": "synthetic-flat-dem", "geology_url": "assets/saturn_color_upscaled.jpg", "geology_database_path": "https://science.nasa.gov/saturn/facts/", "tes_albedo_url": "derived-grayscale-band-layer", "tes_thermal_inertia_url": "derived-storm-contrast-layer", "geology_notes_url": "https://science.nasa.gov/saturn/facts/", "geology_dmu_url": "https://science.nasa.gov/saturn/facts/", "geology_map_url": "https://science.nasa.gov/saturn/facts/", "geology_database_url": "https://science.nasa.gov/saturn/facts/", "geology_original_units_citation": "Saturn uses an atmosphere-focused context workflow rather than a solid-surface geology map database.", "tes_albedo_page_url": "https://science.nasa.gov/solar-system/planets/saturn/", "tes_thermal_inertia_page_url": "https://science.nasa.gov/solar-system/planets/saturn/", "magnetic_anomaly_page_url": "https://science.nasa.gov/saturn/facts/", "themis_day_ir_page_url": "https://science.nasa.gov/saturn/facts/", "themis_night_ir_page_url": "https://science.nasa.gov/saturn/facts/", "tethys_texture_page_url": "https://www.jpl.nasa.gov/images/pia11673-map-of-tethys-august-2010/"}, "mineral_layers": []};
    const startupStatusNode = document.getElementById("status");
    window.__saturnViewerManifest = manifest;
    window.__saturnViewerStartup = {
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

      window.__saturnViewerStartup.criticalMissing = criticalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__saturnViewerStartup.optionalMissing = optionalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__saturnViewerStartup.checked = true;

      if (window.__saturnViewerStartup.criticalMissing.length > 0) {
        setStartupStatus(
          "Missing required files: " + window.__saturnViewerStartup.criticalMissing.join(", "),
          true,
        );
        return;
      }

      if (window.__saturnViewerStartup.optionalMissing.length > 0) {
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
