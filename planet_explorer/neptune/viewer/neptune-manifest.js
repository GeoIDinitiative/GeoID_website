    const manifest = {"texture":{"path":"assets/neptune_color.jpg","width":4096,"source_page_url":"https://science.nasa.gov/3d-resources/neptune/"},"elevation":{"path":"assets/neptune_elevation.png","width":2048,"min_m":0.0,"max_m":0.0,"relief_m":0.0,"source_page_url":"synthetic-flat-dem"},"geology":{"path":"assets/neptune_geology_sim3292.png","size":[4096,2048],"description":"Enhanced atmospheric context layer derived from the official NASA Neptune image."},"geology_interactive":{"feature_path":"assets/neptune_geology_features.json"},"geology_layers":[{"id":"enhanced-atmosphere","label":"Enhanced Atmosphere","path":"assets/neptune_geology_sim3292.png","description":"Locally enhanced atmospheric context derived from the official NASA Neptune image.","source_page_url":"https://science.nasa.gov/3d-resources/neptune/","size":[4096,2048],"default":true}],"layers":[{"id":"neptune-visible","label":"Visible Texture","path":"assets/neptune_color.jpg","description":"Official NASA global Neptune image used as the primary globe texture.","source_page_url":"https://science.nasa.gov/3d-resources/neptune/","default":true},{"id":"neptune-band-contrast","label":"Band Contrast","path":"assets/neptune_tes_albedo.png","description":"Derived grayscale layer emphasizing Neptune's broad cloud bands and haze structure.","source_page_url":"https://science.nasa.gov/3d-resources/neptune/","size":[2880,1440]},{"id":"neptune-storm-contrast","label":"Storm Contrast","path":"assets/neptune_tes_thermal_inertia.png","description":"Derived contrast layer emphasizing bright methane cloud systems and dark vortices.","source_page_url":"https://science.nasa.gov/3d-resources/neptune/","size":[2880,1440]}],"seismic":{"path":"assets/neptune_insight_seismic_events.json","description":"Placeholder event catalog; no seismic dataset applies to Neptune in this workflow.","source_page_url":"https://science.nasa.gov/neptune/facts/","event_count":0,"located_event_count":0,"clustered_event_count":0},"sources":{"texture_url":"https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/image/neptune/Neptune.jpg","ring_texture_url":"synthetic-transparent-placeholder","dem_url":"synthetic-flat-dem","geology_url":"https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/image/neptune/Neptune.jpg","geology_database_path":"https://science.nasa.gov/neptune/facts/","tes_albedo_url":"derived-grayscale-band-layer","tes_thermal_inertia_url":"derived-storm-contrast-layer","geology_notes_url":"https://science.nasa.gov/neptune/facts/","geology_dmu_url":"https://science.nasa.gov/neptune/facts/","geology_map_url":"https://science.nasa.gov/neptune/facts/","geology_database_url":"https://science.nasa.gov/neptune/facts/","geology_original_units_citation":"Neptune uses an atmosphere-focused context workflow rather than a solid-surface geology map database.","tes_albedo_page_url":"https://science.nasa.gov/3d-resources/neptune/","tes_thermal_inertia_page_url":"https://science.nasa.gov/3d-resources/neptune/","magnetic_anomaly_page_url":"https://science.nasa.gov/neptune/facts/","themis_day_ir_page_url":"https://science.nasa.gov/neptune/facts/","themis_night_ir_page_url":"https://science.nasa.gov/neptune/facts/"},"mineral_layers":[],"neptune":{"body_scale_y":0.9886,"axial_tilt_deg":28.32,"rings":{"path":"assets/neptune_rings.png","inner_km":41900,"outer_km":63000,"inner_radius":3.552,"outer_radius":7.596,"opacity":0.55,"texture_repeat":1,"texture_offset":0,"source_page_url":"https://science.nasa.gov/neptune/facts/"}}};
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
