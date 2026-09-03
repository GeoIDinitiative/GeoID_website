const manifest = {"planet":{"axial_tilt_deg":25.19},"texture":{"path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_color.jpg?v=aff5dbff30d7","width":4096,"source_page_url":"https://planetarymaps.usgs.gov/mosaic/Mars_Viking_ClrMosaic_global_925m.tif"},"elevation":{"path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_elevation_upscaled.png?v=36d60c8f04d3","width":4096,"min_m":-8201.0,"max_m":21241.0,"relief_m":29442.0,"height":2048},"elevation_hd":{"path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_elevation_hd.png?v=0343e97030e4","width":4096,"height":2048,"encoding":"rg16","min_m":-8201.0,"max_m":21241.0,"relief_m":29442.0,"quantisation_m":0.4493,"source":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_elevation_upscaled.png?v=36d60c8f04d3","note":"De-terraced 16-bit reconstruction of the 8-bit DEM; R=high byte, G=low byte. Built by tools/build_dem_hd.py."},"geology":{"path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_geology_sim3292.png?v=c6b825f8e610","size":[4096,2048]},"geology_legend":{"path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_geology_legacy_legend.png?v=b59e54aac9fe","size":[1200,1938],"description":"Legend extracted from USGS Atlas of Mars sheet I-1802-B."},"geology_layers":[{"id":"sim3292-units","label":"USGS, Geologic Map of Mars","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_geology_sim3292.png?v=c6b825f8e610","description":"USGS, Geologic Map of Mars geology overlay sourced from Scientific Investigations Map 3292.","source_page_url":"https://pubs.usgs.gov/sim/3292/","size":[4096,2048],"default":true}],"layers":[{"id":"viking-color","label":"Mars Color Map - Viking","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_color.jpg?v=aff5dbff30d7","description":"USGS Viking global color mosaic basemap.","source_page_url":"https://planetarymaps.usgs.gov/mosaic/Mars_Viking_ClrMosaic_global_925m.tif","default":true},{"id":"tes-albedo","label":"TES Albedo","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_tes_albedo.png?v=c91b449ee156","description":"ASU TES Lambert albedo global product.","source_page_url":"https://www.mars.asu.edu/data/tes_albedo/","size":[2880,1440]},{"id":"tes-thermal-inertia","label":"TES Thermal Inertia","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_tes_thermal_inertia.png?v=91ea20b51a10","description":"ASU TES thermal inertia global product.","source_page_url":"https://www.mars.asu.edu/data/tes_ti/","size":[2880,1440]},{"id":"derived-hillshade","label":"Hillshade","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_hillshade.jpg?v=6e78b13d6c49","description":"Derived hillshade generated from the global elevation model.","source_page_url":"generated/mars-globe-viewer/mars_elevation.tif","size":[4096,2048]},{"id":"derived-slope","label":"Slope","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_slope.jpg?v=91dc01e60879","description":"Derived slope basemap generated from the global elevation model.","source_page_url":"generated/mars-globe-viewer/mars_elevation.tif","size":[4096,2048]}],"mineral_layers":[{"id":"mineral-quartz","label":"Quartz","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_quartz.png?v=4cfbb0ec9388","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_quartz_legend.png?v=a41be9f31006","description":"ASU TES mineral abundance map for quartz.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-k_feldspar","label":"K-Feldspar","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_k_feldspar.png?v=d064d66beb5a","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_k_feldspar_legend.png?v=84860547a6e3","description":"ASU TES mineral abundance map for k-feldspar.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-plagioclase","label":"Plagioclase","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_plagioclase.png?v=a78886c2fc5a","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_plagioclase_legend.png?v=d20980cda7d1","description":"ASU TES mineral abundance map for plagioclase.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-amphibole","label":"Amphibole","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_amphibole.png?v=15e813740090","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_amphibole_legend.png?v=cee26b241250","description":"ASU TES mineral abundance map for amphibole.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-low_ca_pyroxene","label":"Low-Ca Pyroxene","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_low_ca_pyroxene.png?v=a37bef783628","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_low_ca_pyroxene_legend.png?v=ffd4295fb626","description":"ASU TES mineral abundance map for low-ca pyroxene.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-high_ca_pyroxene","label":"High-Ca Pyroxene","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_high_ca_pyroxene.png?v=d3d7f6427f24","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_high_ca_pyroxene_legend.png?v=f892d4f83f98","description":"ASU TES mineral abundance map for high-ca pyroxene.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-olivine","label":"Olivine","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_olivine.png?v=56192f326242","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_olivine_legend.png?v=8943757e805f","description":"ASU TES mineral abundance map for olivine.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-hematite","label":"Hematite","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_hematite.png?v=399c12b586c8","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_hematite_legend.png?v=e9f2f0d6dc0a","description":"ASU TES mineral abundance map for hematite.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-sulfate","label":"Sulfate","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_sulfate.png?v=3c67022b9b6f","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_sulfate_legend.png?v=865c86d30314","description":"ASU TES mineral abundance map for sulfate.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-carbonate","label":"Carbonate","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_carbonate.png?v=348960912b4b","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_carbonate_legend.png?v=d526690071c7","description":"ASU TES mineral abundance map for carbonate.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-sheet_hi_si_glass","label":"Sheet Silicate / High-Si Glass","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_sheet_hi_si_glass.png?v=d99dc747c3a0","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_sheet_hi_si_glass_legend.png?v=5fbb17391190","description":"ASU TES mineral abundance map for sheet silicate / high-si glass.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-surface_dust","label":"Surface Dust","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_surface_dust.png?v=0cb17237cfa9","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_surface_dust_legend.png?v=ff75ba821bcb","description":"ASU TES mineral abundance map for surface dust.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]},{"id":"mineral-rms_error","label":"RMS Error","path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_rms_error.png?v=b184ed9b1f39","legend_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_mineral_rms_error_legend.png?v=0ed073dffb35","description":"ASU TES mineral abundance map for rms error.","source_page_url":"https://tes.mars.asu.edu/products/","size":[2880,1440],"legend_size":[1200,732]}],"sources":{"texture_url":"generated/mars-globe-viewer/mars_color.jpg","dem_url":"generated/mars-globe-viewer/mars_elevation.tif","geology_url":"https://marsoweb.nas.nasa.gov/globalData/images/fullscale/geology.jpg","geology_labeled_url":"https://d9-wret.s3.us-west-2.amazonaws.com/assets/palladium/production/s3fs-public/thumbnails/image/6-Mars-a1.jpg","tes_albedo_url":"http://ms-mars.mars.asu.edu/TES_Lambert_Albedo?SERVICE=WMS&REQUEST=GetMap&FORMAT=image/png&WIDTH=2880&HEIGHT=1440&SRS=JMARS:4&BBOX=-180,-90,180,90&STYLES=&VERSION=1.1.1&LAYERS=TES_Lambert_Albedo","tes_thermal_inertia_url":"http://ms-mars.mars.asu.edu/TES_Thermal_Inertia?SERVICE=WMS&REQUEST=GetMap&FORMAT=image/png&WIDTH=2880&HEIGHT=1440&SRS=JMARS:4&BBOX=-180,-90,180,90&STYLES=&VERSION=1.1.1&LAYERS=TES_Thermal_Inertia","geology_notes_url":"https://marsoweb.nas.nasa.gov/globalData/geology_notes.html","geology_dmu_url":"https://pubs.usgs.gov/sim/3292/","geology_map_url":"https://pubs.usgs.gov/sim/3292/","geology_database_url":"https://pubs.usgs.gov/sim/3292/","geology_legacy_legend_pdf_url":"https://pubs.usgs.gov/imap/1802b/plate-1.pdf","geology_original_units_citation":"Tanaka, K.L., Skinner, J.A., Jr., Dohm, J.M., Irwin, R.P., III, Kolb, E.J., Fortezzo, C.M., Platz, T., Michael, G.G., and Hare, T.M., 2014, Geologic map of Mars: U.S. Geological Survey Scientific Investigations Map 3292, scale 1:20,000,000, pamphlet 43 p., https://dx.doi.org/10.3133/sim3292.","tes_albedo_page_url":"https://www.mars.asu.edu/data/tes_albedo/","tes_thermal_inertia_page_url":"https://www.mars.asu.edu/data/tes_ti/","themis_day_ir_page_url":"https://www.mars.asu.edu/data/thm_dir/","themis_night_ir_page_url":"https://www.mars.asu.edu/data/themis_nightir/","tes_mineral_products_url":"https://tes.mars.asu.edu/products/","insight_seismic_catalog_url":"https://raw.githubusercontent.com/UMD-InSight/InSight-seismic-data-downloader/main/events_mars_extended_multiorigin_v12_2022-07-01.xml","magnetic_anomaly_page_url":"https://science.nasa.gov/photojournal/global-map-of-magnetic-anomalies-mager/"},"seismic":{"path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_insight_seismic_events.json?v=072e5c50bc29","description":"InSight seismic catalog summary rebuilt from the UMD InSight seismic data downloader catalog.","source_page_url":"https://github.com/UMD-InSight/InSight-seismic-data-downloader"},"geology_interactive":{"feature_path":"https://data.geoidinitiative.com/assets/hotlink-ok/planet-mars/mars_geology_features.json?v=12bcfcabc5b8","size":[4096,2048],"feature_count":1311}};
    const startupStatusNode = document.getElementById("status");
    window.__marsViewerManifest = manifest;
    window.__marsViewerStartup = {
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
        window.__marsViewerStartup.checked = true;
        window.__marsViewerStartup.warnings.push(
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
      if (manifest.elevation_hd?.path) {
        optional.push(manifest.elevation_hd.path);
      }
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

      window.__marsViewerStartup.criticalMissing = criticalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__marsViewerStartup.optionalMissing = optionalChecks
        .filter(([, ok]) => !ok)
        .map(([path]) => path);
      window.__marsViewerStartup.checked = true;

      if (window.__marsViewerStartup.criticalMissing.length > 0) {
        setStartupStatus(
          "Missing required files: " + window.__marsViewerStartup.criticalMissing.join(", "),
          true,
        );
        return;
      }

      if (window.__marsViewerStartup.optionalMissing.length > 0) {
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
