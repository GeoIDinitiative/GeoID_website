    const manifest = {"texture":{"path":"assets/uranus_body_color.jpg","width":4096,"source_page_url":"https://science.nasa.gov/uranus/facts/"},"elevation":{"path":"assets/uranus_elevation.png","width":2048,"min_m":0.0,"max_m":0.0,"relief_m":0.0,"source_page_url":"synthetic-flat-dem"},"geology":{"path":"assets/uranus_geology_sim3292.png","size":[4096,2048],"description":"Enhanced atmospheric context layer derived from the official NASA Uranus image."},"geology_interactive":{"feature_path":"assets/uranus_geology_features.json"},"geology_layers":[{"id":"enhanced-atmosphere","label":"Enhanced Atmosphere","path":"assets/uranus_geology_sim3292.png","description":"Locally enhanced atmospheric context derived from the official NASA Uranus image.","source_page_url":"https://science.nasa.gov/uranus/facts/","size":[4096,2048],"default":true}],"layers":[{"id":"uranus-visible","label":"Uranus Body","path":"assets/uranus_body_color.jpg","description":"Derived Uranus body texture for the oblate globe, separated from the ring system.","source_page_url":"https://science.nasa.gov/uranus/facts/","default":true},{"id":"uranus-band-contrast","label":"Band Contrast","path":"assets/uranus_tes_albedo.png","description":"Derived grayscale layer emphasizing atmospheric bands and haze structure.","source_page_url":"https://science.nasa.gov/uranus/facts/","size":[2880,1440]},{"id":"uranus-storm-contrast","label":"Storm Contrast","path":"assets/uranus_tes_thermal_inertia.png","description":"Derived contrast layer emphasizing cloud texture boundaries.","source_page_url":"https://science.nasa.gov/uranus/facts/","size":[2880,1440]}],"seismic":{"path":"assets/uranus_insight_seismic_events.json","description":"Placeholder event catalog; no seismic dataset applies to Uranus in this workflow.","source_page_url":"https://science.nasa.gov/uranus/facts/","event_count":0,"located_event_count":0,"clustered_event_count":0},"sources":{"texture_url":"assets/uranus_body_color.jpg","ring_texture_url":"assets/uranus_rings.png","dem_url":"synthetic-flat-dem","geology_url":"assets/uranus_geology_sim3292.png","geology_database_path":"https://science.nasa.gov/uranus/facts/","tes_albedo_url":"derived-grayscale-band-layer","tes_thermal_inertia_url":"derived-storm-contrast-layer","geology_notes_url":"https://science.nasa.gov/uranus/facts/","geology_dmu_url":"https://science.nasa.gov/uranus/facts/","geology_map_url":"https://science.nasa.gov/uranus/facts/","geology_database_url":"https://science.nasa.gov/uranus/facts/","geology_original_units_citation":"Uranus uses an atmosphere-focused context workflow rather than a solid-surface geology map database.","tes_albedo_page_url":"https://science.nasa.gov/uranus/facts/","tes_thermal_inertia_page_url":"https://science.nasa.gov/uranus/facts/","magnetic_anomaly_page_url":"https://science.nasa.gov/uranus/facts/","themis_day_ir_page_url":"https://science.nasa.gov/uranus/facts/","themis_night_ir_page_url":"https://science.nasa.gov/uranus/facts/"},"mineral_layers":[],"uranus":{"body_scale_y":0.9771,"axial_tilt_deg":97.77,"rings":{"path":"assets/uranus_rings.png","inner_km":37000,"outer_km":51500,"inner_radius":3.552,"outer_radius":7.596,"opacity":0.72,"texture_repeat":1,"texture_offset":0,"source_page_url":"https://science.nasa.gov/uranus/facts/"}}};
    const startupStatusNode = document.getElementById("status");
    window.__uranusViewerManifest = manifest;
    window.__uranusViewerStartup = {
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

      window.__uranusViewerStartup.criticalMissing = criticalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__uranusViewerStartup.optionalMissing = optionalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__uranusViewerStartup.checked = true;

      if (window.__uranusViewerStartup.criticalMissing.length > 0) {
        setStartupStatus(
          "Missing required files: " + window.__uranusViewerStartup.criticalMissing.join(", "),
          true,
        );
        return;
      }

      if (window.__uranusViewerStartup.optionalMissing.length > 0) {
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
