    const startupStatusNode = document.getElementById("status");
    const manifest = {"planet":{"axial_tilt_deg":23.44},"texture":{"path":"assets/blue-marble-Aug8km.jpg?v=20260905-3edf317","width":5400,"source_page_url":"https://science.nasa.gov/3d-resources/earth-a/"},"elevation":{"path":"https://data.geoidinitiative.com/assets/hotlink-ok/earth-viewer/earth_elevation.png?v=6f89e540b82e&c=2","sample_path":"https://data.geoidinitiative.com/assets/hotlink-ok/earth-viewer/earth_elevation_sampler.png?v=fed0b2516fc7","encoding":"rgb24","width":4096,"height":2048,"min_m":-10930,"max_m":8627,"relief_m":19557,"source_page_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global"},"geology":{"path":"https://data.geoidinitiative.com/assets/hotlink-ok/earth-viewer/earth_geology_sim3292.png?v=0ceabcf21789&c=2","size":[4096,2048],"description":"Derived bathymetry and topography context layer based on GEBCO 2025 relief."},"geology_layers":[],"geology_interactive":{"feature_path":"/GeoID_Earth/assets/earth_geology_features.json","size":[4096,2048],"feature_count":0},"layers":[{"id":"blue-marble","label":"Blue Marble","path":"assets/blue-marble-Aug8km.jpg?v=20260905-3edf317","description":"NASA Blue Marble global composite, August, 8 km/px. Equirectangular EPSG:4326 covering -180..180 and -90..90, converted from blue-marble-Aug8km.tif, with the ocean coloured from GEBCO bathymetry.","source_page_url":"https://visibleearth.nasa.gov/collection/1484/blue-marble","size":[5400,2700],"default":true},{"id":"earth-visible","label":"Earth Surface","path":"https://data.geoidinitiative.com/assets/hotlink-ok/earth-viewer/earth_color.jpg?v=5e18afce2860&c=2","description":"NASA Earth surface texture basemap.","source_page_url":"https://science.nasa.gov/3d-resources/earth-a/"},{"id":"derived-hillshade","label":"GEBCO Hillshade","path":"https://data.geoidinitiative.com/assets/hotlink-ok/earth-viewer/earth_hillshade.jpg?v=73b83ab30445","description":"Derived hillshade generated from the GEBCO 2025 global elevation model.","source_page_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global","size":[4096,2048]},{"id":"derived-slope","label":"GEBCO Slope","path":"/GeoID_Earth/assets/earth_slope.jpg?v=20260905-3edf317","description":"Derived slope basemap generated from the GEBCO 2025 global elevation model.","source_page_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global","size":[4096,2048]},{"id":"gebco-bathy-context","label":"GEBCO Relief Context","path":"https://data.geoidinitiative.com/assets/hotlink-ok/earth-viewer/earth_geology_sim3292.png?v=0ceabcf21789&c=2","description":"Derived bathymetry and topography context overlay based on GEBCO 2025.","source_page_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global","size":[4096,2048]}],"mineral_layers":[],"sources":{"texture_url":"https://assets.science.nasa.gov/content/dam/science/cds/3d/resources/image/earth-(a)/Earth%20(A).jpg","dem_url":"https://dap.ceda.ac.uk/bodc/gebco/global/gebco_2025/ice_surface_elevation/geotiff/gebco_2025_geotiff.zip?download=1","geology_url":"derived/from-gebco-hillshade-and-earth-texture","geology_notes_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global","geology_dmu_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global","geology_map_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global","geology_database_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global","geology_original_units_citation":"GEBCO Compilation Group (2025) GEBCO 2025 Grid, doi:10.5285/37c52e96-24ea-67ce-e063-7086abc05f29.","tes_albedo_page_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global","tes_thermal_inertia_page_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global","themis_day_ir_page_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global","themis_night_ir_page_url":"https://www.gebco.net/data-products/gridded-bathymetry-data#global","magnetic_anomaly_page_url":"https://science.nasa.gov/earth/"},"seismic":{"path":"/GeoID_Earth/assets/earth_seismic_events.json?v=20260905-3edf317","description":"Placeholder catalog; no earthquake catalog is bundled in this Earth workflow.","source_page_url":"https://earthquake.usgs.gov/"}};
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
