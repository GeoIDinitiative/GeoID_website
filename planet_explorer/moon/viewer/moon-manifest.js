const manifest = {"planet":{"axial_tilt_deg":1.54},"texture":{"path":"assets/lroc_color_8k.jpg","width":8192,"source_page_url":"https://svs.gsfc.nasa.gov/4720"},"elevation":{"path":"assets/ldem_3_8bit.jpg","width":1024,"min_m":-9150,"max_m":10786,"relief_m":19936},"layers":[{"id":"lro-wac","label":"LROC Color 8k","path":"assets/lroc_color_8k.jpg","description":"NASA LRO Wide Angle Camera global color mosaic with poles, 8192×4096, derived from NASA SVS CGI Moon Kit 16-bit sRGB source. Source: NASA SVS CGI Moon Kit #4720.","source_page_url":"https://svs.gsfc.nasa.gov/4720","default":true}],"geology_interactive":{"feature_path":"assets/moon_geology_features.json","width":4096,"height":2048},"geology_layers":[{"id":"usgs-unified-geology","label":"Unified Geologic Map","path":"assets/geology_4k.png","description":"USGS Unified Geologic Map of the Moon v2 (Skinner et al., 2020). Geological units colour-coded by stratigraphic era. 4096×2048 equirectangular overlay rasterised from GeoUnits.shp.","source_page_url":"https://astrogeology.usgs.gov/search/map/Moon/Geology/Unified_Geologic_Map_of_the_Moon_GIS_v2","default":true,"opacity":0.7,"legend":[{"label":"Crater Unit","description":"Impact crater material across all epochs.","color":"#C05030"},{"label":"Terra Unit","description":"Highland terrain; ancient cratered uplands.","color":"#C8A030"},{"label":"Upper Mare Unit","description":"Younger basaltic mare fill.","color":"#4A6AB0"},{"label":"Plains Unit","description":"Smooth plains material.","color":"#D0B870"},{"label":"Basin Undivided Unit","description":"Multi-ring impact basin material, undivided.","color":"#706840"},{"label":"Basin Massif Unit","description":"Basin ring massifs and mountain blocks.","color":"#808050"},{"label":"Mare Unit","description":"Basaltic mare volcanic plain.","color":"#3A5AA0"},{"label":"Lower Mare Unit","description":"Older basaltic mare fill.","color":"#2A4A90"},{"label":"Dark Mantling Unit","description":"Pyroclastic dark mantle deposits.","color":"#303840"},{"label":"Grooved Terrain Unit","description":"Lineated and grooved terrain.","color":"#6878A0"},{"label":"Orientale Formations","description":"Ejecta and basin facies of the Orientale impact.","color":"#907888"}]}]};
    const startupStatusNode = document.getElementById("status");
    window.__moonViewerManifest = manifest;
    window.__moonViewerStartup = {
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
        window.__moonViewerStartup.checked = true;
        window.__moonViewerStartup.warnings.push(
          "Viewer opened from file://. Skipping network-based asset checks.",
        );
        setStartupStatus("Initializing viewer...");
        return;
      }

      setStartupStatus("Checking local viewer files...");

      // Use the 4k fallback path for the asset check so low-end GPUs don't
      // report the 8k file as critical-missing when it will be swapped at runtime.
      const _texCheck = manifest.texture.path.includes("8k")
        ? manifest.texture.path.replace("lroc_color_8k.jpg", "lroc_color_4k.jpg")
        : manifest.texture.path;
      const critical = [
        "./vendor/three.module.js",
        "./vendor/OrbitControls.js",
        _texCheck,
      ];
      const optional = [
        ...(manifest.elevation?.path ? [manifest.elevation.path] : []),
      ];

      const criticalChecks = await Promise.all(
        critical.map(async (path) => [path, await checkLocalAsset(path)]),
      );
      const optionalChecks = await Promise.all(
        optional.map(async (path) => [path, await checkLocalAsset(path)]),
      );

      window.__moonViewerStartup.criticalMissing = criticalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__moonViewerStartup.optionalMissing = optionalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__moonViewerStartup.checked = true;

      if (window.__moonViewerStartup.criticalMissing.length > 0) {
        setStartupStatus(
          "Missing required files: " + window.__moonViewerStartup.criticalMissing.join(", "),
          true,
        );
        return;
      }

      if (window.__moonViewerStartup.optionalMissing.length > 0) {
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
