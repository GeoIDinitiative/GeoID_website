    import * as THREE from "./vendor/three.module.js";
    import { OrbitControls } from "./vendor/OrbitControls.js";

    const manifest = window.__jupiterViewerManifest;
    const app = document.getElementById("app");
    const statusNode = document.getElementById("status");
    const baseLayerSelect = document.getElementById("base-layer-select");
    const geologyToggle = document.getElementById("geology-toggle");
    const geologyOpacity = document.getElementById("geology-opacity");
    const geologyContactsToggle = document.getElementById("geology-contacts-toggle");
    const geologyStructuresToggle = document.getElementById("geology-structures-toggle");
    const geologyMasterToggle = document.getElementById("geology-master-toggle");
    const tourModeSection = document.getElementById("tour-mode-section");
    const tourModeToggle = document.getElementById("tour-mode-toggle");
    const tourModeControls = document.getElementById("tour-mode-controls");
    const tourModeFacet = document.getElementById("tour-mode-facet");
    const tourModeTarget = document.getElementById("tour-mode-target");
    const tourModeCopy = document.getElementById("tour-mode-copy");
    const tourModePrev = document.getElementById("tour-mode-prev");
    const tourModeNext = document.getElementById("tour-mode-next");
    const brandLogo = document.getElementById("brand-logo");
    const terrainScale = document.getElementById("terrain-scale");
    const seaToggle = document.getElementById("sea-toggle");
    const seaLevelSlider = document.getElementById("sea-level-slider");
    const seaLevelValue = document.getElementById("sea-level-value");
    const seaLevelCopy = document.getElementById("sea-level-copy");
    const labelsToggle = document.getElementById("labels-toggle");
    const volcanicLabelsToggle = document.getElementById("volcanic-labels-toggle");
    const stormLabelsToggle = document.getElementById("storm-labels-toggle");
    const landingLabelsToggle = document.getElementById("landing-labels-toggle");
    const flybyPathsToggle = document.getElementById("flyby-paths-toggle");
    const habitationLabelsToggle = document.getElementById("habitation-labels-toggle");
    const moonToggle = document.getElementById("moon-toggle");
    const seismicToggle = document.getElementById("seismic-toggle");
    const locationsMasterToggle = document.getElementById("locations-master-toggle");
    const coreToggle = document.getElementById("core-toggle");
    const seismicFilterSelect = document.getElementById("seismic-filter-select");
    const regionMaskSelect = document.getElementById("region-mask-select");
    const regionMaskOpacity = document.getElementById("region-mask-opacity");
    const mineralSelect = document.getElementById("mineral-select");
    const mineralOpacity = document.getElementById("mineral-opacity");
    const featureSearch = document.getElementById("feature-search");
    const featureSearchGo = document.getElementById("feature-search-go");
    const featureSearchResults = document.getElementById("feature-search-results");
    const exploreReset = document.getElementById("explore-reset");
    const moonViewerToggle = document.getElementById("moon-viewer-toggle");
    const moonViewerSection = document.getElementById("moon-viewer-section");
    const moonViewerControls = document.getElementById("moon-viewer-controls");
    const moonViewerSelect = document.getElementById("moon-viewer-select");
    const moonViewerPrev = document.getElementById("moon-viewer-prev");
    const moonViewerNext = document.getElementById("moon-viewer-next");
    const moonFeatureTypeSelect = document.getElementById("moon-feature-type");
    const moonFeatureTourTarget = document.getElementById("moon-feature-tour-target");
    const moonFeatureTourPrev = document.getElementById("moon-feature-tour-prev");
    const moonFeatureTourNext = document.getElementById("moon-feature-tour-next");
    let moonNavContext = "moon";
    const moonFeatureSearchInput = document.getElementById("moon-feature-search");
    const moonFeatureSearchGo = document.getElementById("moon-feature-search-go");
    const moonFeatureSearchResults = document.getElementById("moon-feature-search-results");
    const seismicStatusSelect = document.getElementById("seismic-status-select");
    const seismicMagnitudeMin = document.getElementById("seismic-magnitude-min");
    const seismicMagnitudeCopy = document.getElementById("seismic-magnitude-copy");
    const seismicTimelineSlider = document.getElementById("seismic-timeline-slider");
    const seismicTimelineReadout = document.getElementById("seismic-timeline-readout");
    const labelData = [{"name":"Great Red Spot","type":"Anticyclonic storm","lat":-22.0,"lon":310.0,"theme":"storm","description":"Jupiter's long-lived anticyclonic storm system, large enough to dominate the southern tropical atmosphere."},{"name":"Great Red Spot Hollow","type":"Storm wake region","lat":-23.0,"lon":326.0,"theme":"storm","description":"The turbulent atmospheric wake downstream of the Great Red Spot, where smaller vortices and cloud filaments are common."},{"name":"North Equatorial Belt","type":"Dark cloud belt","lat":12.0,"lon":40.0,"theme":"band","description":"A prominent dark belt north of the equator shaped by fast zonal winds and recurring convective outbreaks."},{"name":"South Equatorial Belt","type":"Dark cloud belt","lat":-7.0,"lon":140.0,"theme":"band","description":"A major dark belt south of Jupiter's equator where bright storms and plume outbreaks can disturb the band."},{"name":"Equatorial Zone","type":"Bright cloud zone","lat":0.0,"lon":0.0,"theme":"band","description":"A bright equatorial cloud zone crossed by fast jet streams, waves, and high-altitude haze."},{"name":"North Temperate Belt","type":"Temperate belt","lat":24.0,"lon":90.0,"theme":"band","description":"A mid-latitude belt marking one of Jupiter's organized jet-stream corridors."},{"name":"South Temperate Belt","type":"Temperate belt","lat":-28.0,"lon":250.0,"theme":"band","description":"A southern mid-latitude belt that hosts white ovals, smaller vortices, and turbulent cloud structures."},{"name":"Oval BA","type":"Anticyclonic oval","lat":-33.0,"lon":210.0,"theme":"storm","description":"A large anticyclonic oval sometimes called Red Spot Jr., formed from the merger of three white ovals."},{"name":"North Tropical Zone","type":"Bright zone","lat":20.0,"lon":0.0,"theme":"band","description":"A bright tropical band between the equatorial and temperate circulation systems."},{"name":"South Tropical Zone","type":"Bright zone","lat":-20.0,"lon":0.0,"theme":"band","description":"A southern tropical bright band linking the equatorial circulation to the stormier southern mid-latitudes."},{"name":"North Polar Haze","type":"Polar atmosphere","lat":68.0,"lon":35.0,"theme":"polar","description":"A high-latitude haze region above Jupiter's northern polar atmosphere."},{"name":"South Polar Cyclone Region","type":"Polar cyclone field","lat":-68.0,"lon":215.0,"theme":"polar","description":"Representative southern polar region where spacecraft imaging reveals organized cyclone structures."},{"name":"Juno Perijove Track","type":"Mission corridor","lat":7.0,"lon":190.0,"theme":"landing","description":"Representative close-approach corridor for NASA's Juno mission during perijove science passes."},{"name":"Galileo Probe Entry Region","type":"Probe entry region","lat":6.5,"lon":4.0,"theme":"landing","description":"Approximate atmospheric entry latitude and longitude region for the Galileo probe."}];
    const ringLabelData = [];
    const moonData = [{"name":"Io","type":"Major moon","theme":"moon","description":"The innermost Galilean moon, volcanically active and tidally heated by Jupiter.","moon_anchor":[6.0,0.1,6.8],"moon_radius":0.115,"moon_label_lift":0.235,"moon_color":"#d8b45d","mean_radius_km":"1,822 km","orbit_distance_km":"~421,700 km","texture_source_url":null},{"name":"Europa","type":"Major moon","theme":"moon","description":"An icy Galilean moon with a young fractured surface and a probable subsurface ocean.","moon_anchor":[-8.8,-0.05,6.4],"moon_radius":0.105,"moon_label_lift":0.225,"moon_color":"#d7d1bf","mean_radius_km":"1,561 km","orbit_distance_km":"~671,100 km","texture_source_url":null},{"name":"Ganymede","type":"Major moon","theme":"moon","description":"The largest moon in the Solar System, with bright grooved terrain, dark cratered regions, and its own magnetic field.","moon_anchor":[-12.4,0.12,-7.8],"moon_radius":0.15,"moon_label_lift":0.27,"moon_color":"#9d9080","mean_radius_km":"2,634 km","orbit_distance_km":"~1,070,400 km","texture_source_url":null},{"name":"Callisto","type":"Major moon","theme":"moon","description":"A heavily cratered outer Galilean moon preserving an ancient impact-scarred surface.","moon_anchor":[15.0,-0.1,-12.0],"moon_radius":0.138,"moon_label_lift":0.258,"moon_color":"#726b62","mean_radius_km":"2,410 km","orbit_distance_km":"~1,882,700 km","texture_source_url":null}];
    const JUPITER_EQUATORIAL_RADIUS_KM = 71492;
    const JUPITER_SCENE_RADIUS = 3.2;
    const JUPITER_KM_TO_SCENE = JUPITER_SCENE_RADIUS / JUPITER_EQUATORIAL_RADIUS_KM;
    const JUPITER_EXPOSED_INTERIOR_RFRAC = 0.58;
    const JUPITER_RING_REFERENCE_KM = {
      dInner: 92000, cInner: 122500, bInner: 128940, cassiniInner: 128940,
      aInner: 129000, aOuter: 129200, enckeCenter: 128000, keelerCenter: 128500,
      fRing: 129400, mainOuter: 129200,
    };

    function georeferenceRingAndInnerMoonAnchors() {
      const ringAnchorKmByName = {
        "D Ring": 70500,
        "C Ring": 83250,
        "B Ring": 104750,
        "Cassini Division": 119750,
        "A Ring": 129300,
        "Encke Gap": 133584,
        "Keeler Gap": 136505,
        "F Ring": 140220,
        // Display-compressed anchor for readability in this scene.
        "G Ring": 148500,
        // Display anchor is intentionally compressed for UI readability in this scene.
        "E Ring": 150000,
      };
      for (const entry of ringLabelData) {
        const radiusKm = ringAnchorKmByName[entry.name];
        if (!radiusKm || !Array.isArray(entry.ring_anchor)) continue;
        const [x, y, z] = entry.ring_anchor;
        const theta = Math.atan2(z, x);
        const radiusScene = radiusKm * JUPITER_KM_TO_SCENE;
        entry.ring_anchor = [
          Number((Math.cos(theta) * radiusScene).toFixed(4)),
          y,
          Number((Math.sin(theta) * radiusScene).toFixed(4)),
        ];
        if (entry.name === "G Ring" || entry.name === "E Ring") {
          const ax = entry.ring_anchor[0];
          const az = entry.ring_anchor[2];
          const ar = Math.hypot(ax, az) || 1;
          const ux = ax / ar;
          const uz = az / ar;
          const tx = -uz;
          const tz = ux;
          const lineScale = entry.name === "G Ring" ? 1.012 : 1.018;
          const labelScale = entry.name === "G Ring" ? 1.026 : 1.038;
          const tangentOffset = entry.name === "G Ring" ? 0.05 : 0.08;
          entry.ring_line_end = [
            Number((ux * ar * lineScale).toFixed(4)),
            0.12,
            Number((uz * ar * lineScale).toFixed(4)),
          ];
          entry.ring_label = [
            Number((ux * ar * labelScale + tx * tangentOffset).toFixed(4)),
            0.18,
            Number((uz * ar * labelScale + tz * tangentOffset).toFixed(4)),
          ];
        }
      }

      const moonOrbitKmByName = {
        Pan: 133584,
        Daphnis: 136505,
        Atlas: 137670,
        Prometheus: 139380,
        Pandora: 141700,
        Epimetheus: 151410,
        Janus: 151460,
        Aegaeon: 167500,
        Methone: 194200,
        Anthe: 197700,
        Pallene: 212300,
      };
      for (const moon of moonData) {
        const orbitKm = moonOrbitKmByName[moon.name];
        if (!orbitKm || !Array.isArray(moon.moon_anchor)) continue;
        const [x, y, z] = moon.moon_anchor;
        const theta = Math.atan2(z, x);
        const radiusScene = orbitKm * JUPITER_KM_TO_SCENE;
        moon.moon_anchor = [
          Number((Math.cos(theta) * radiusScene).toFixed(4)),
          y,
          Number((Math.sin(theta) * radiusScene).toFixed(4)),
        ];
      }
    }
    georeferenceRingAndInnerMoonAnchors();

    const moonFeatureData = [{"name":"Gaea","type":"Impact crater","theme":"moon","moon_name":"Amalthea","lat":-80.0,"lon":270.0,"description":"Greek mother earth goddess who brought Zeus to Crete.","dimension":"80.0 km"},{"name":"Ida Facula","type":"Facula","theme":"moon","moon_name":"Amalthea","lat":20.0,"lon":185.0,"description":"Greek; mountain where Zeus played as a child.","dimension":"50.0 km"},{"name":"Lyctos Facula","type":"Facula","theme":"moon","moon_name":"Amalthea","lat":-20.0,"lon":190.0,"description":"Greek; area in Crete where Zeus was raised.","dimension":"25.0 km"},{"name":"Pan","type":"Impact crater","theme":"moon","moon_name":"Amalthea","lat":55.0,"lon":325.0,"description":"Greek; goat-god, son of Amalthea and Hermes in some legends, also Zeus' foster brother.","dimension":"100.0 km"},{"name":"Adal","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":75.5,"lon":100.3,"description":"Norse; son of Karl and Erna.","dimension":"41.7 km"},{"name":"Adlinda","type":"Large ringed feature","theme":"moon","moon_name":"Callisto","lat":-48.5,"lon":144.4,"description":"Eskimo; place in ocean depths where souls are imprisoned after death.","dimension":"840.0 km"},{"name":"Aegir","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-45.8,"lon":76.2,"description":"Norse sea god.","dimension":"53.9 km"},{"name":"Agloolik","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-47.7,"lon":97.6,"description":"Eskimo spirit of the seal caves.","dimension":"61.6 km"},{"name":"\u00c4gr\u00f6i","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":43.2,"lon":169.1,"description":"Finno-Ugric god of twins.","dimension":"67.4 km"},{"name":"Ahti","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":41.4,"lon":77.6,"description":"Finnish god of water; sends fish to the fisherman.","dimension":"54.8 km"},{"name":"Ajleke","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":22.7,"lon":78.6,"description":"Saami god of holidays.","dimension":"70.0 km"},{"name":"Akycha","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":72.6,"lon":221.3,"description":"Alaskan name of the sun.","dimension":"81.0 km"},{"name":"Alfr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-9.9,"lon":317.3,"description":"Norse dwarf.","dimension":"96.0 km"},{"name":"\u00c1li","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":59.0,"lon":124.1,"description":"Norse; strongest of men.","dimension":"32.9 km"},{"name":"\u00c1narr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":44.0,"lon":179.5,"description":"Norse dwarf.","dimension":"41.7 km"},{"name":"[Aningan]","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":50.5,"lon":171.8,"description":"Moon god of Greenland Eskimos. The feature originally intended for this name does not exist, so this name has been dropped.","dimension":"287.0 km"},{"name":"Arcas","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-85.6,"lon":112.5,"description":"Callisto's child by Zeus.","dimension":"60.9 km"},{"name":"Asgard","type":"Large ringed feature","theme":"moon","moon_name":"Callisto","lat":32.2,"lon":40.1,"description":"Norse; the home of the gods.","dimension":"1400.0 km"},{"name":"Askr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":51.8,"lon":215.9,"description":"Norse; first man, created from a log drifted ashore on a beach.","dimension":"68.8 km"},{"name":"Audr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-30.9,"lon":99.4,"description":"Ottar's ancestor.","dimension":"80.8 km"},{"name":"Austri","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-80.9,"lon":115.5,"description":"Norse dwarf.","dimension":"15.0 km"},{"name":"Aziren","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":35.4,"lon":1.8,"description":"Estonian spirit of death.","dimension":"55.6 km"},{"name":"Balkr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":28.9,"lon":168.3,"description":"Norse; Ottar's ancestor.","dimension":"68.0 km"},{"name":"Barri","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-31.5,"lon":109.5,"description":"Ottar's ancestor.","dimension":"69.0 km"},{"name":"Bav\u00f6rr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":49.1,"lon":160.0,"description":"Norse dwarf.","dimension":"85.3 km"},{"name":"Beli","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":62.6,"lon":99.8,"description":"Celtic; father of Caswallawn.","dimension":"55.6 km"},{"name":"Biflindi","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-53.6,"lon":105.9,"description":"Another name for Odinn.","dimension":"58.0 km"},{"name":"Bragi","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":75.5,"lon":119.3,"description":"Skaldic; god of poetry.","dimension":"61.8 km"},{"name":"Brami","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":28.8,"lon":161.0,"description":"Norse; Ottar's ancestor.","dimension":"75.7 km"},{"name":"Bran","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-24.2,"lon":334.4,"description":"Celtic; omnipotent god who watched over people.","dimension":"78.0 km"},{"name":"Buga","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":22.3,"lon":216.1,"description":"Tungu heaven god.","dimension":"59.0 km"},{"name":"Buri","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-37.5,"lon":134.5,"description":"Norse dwarf.","dimension":"86.0 km"},{"name":"Burr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":42.7,"lon":45.5,"description":"Norse giant; his sons raised up heaven's vault and shaped the Earth.","dimension":"75.4 km"},{"name":"Dag","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":58.5,"lon":106.7,"description":"Norse; Ottar's ancestor.","dimension":"46.6 km"},{"name":"Danr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":62.5,"lon":103.1,"description":"Norse; king against whom Konr marched.","dimension":"45.2 km"},{"name":"Debegey","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":10.2,"lon":13.8,"description":"Yukagir (NE Siberia) mythological hero, the first man.","dimension":"125.0 km"},{"name":"Dia","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":73.0,"lon":129.5,"description":"Greek; Callisto's sister.","dimension":"34.4 km"},{"name":"Doh","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":30.6,"lon":38.6,"description":"Ketian shaman who created the earth.","dimension":"59.5 km"},{"name":"Dryops","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":80.0,"lon":145.2,"description":"Greek; son of Dia by Apollo.","dimension":"31.5 km"},{"name":"Durinn","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":67.0,"lon":90.9,"description":"Norse dwarf.","dimension":"51.6 km"},{"name":"Egdir","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":33.9,"lon":144.1,"description":"Norse; shepherd for the giants.","dimension":"60.6 km"},{"name":"Egres","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":42.5,"lon":3.4,"description":"Karelian deity of the harvest of beans.","dimension":"45.5 km"},{"name":"Eikin Catena","type":"Crater chain","theme":"moon","moon_name":"Callisto","lat":-8.9,"lon":164.5,"description":"Norse river.","dimension":"223.1 km"},{"name":"Erlik","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":66.8,"lon":178.7,"description":"Russian first man who became a devil.","dimension":"26.6 km"},{"name":"Fadir","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":56.6,"lon":167.4,"description":"Norse farmer.","dimension":"78.6 km"},{"name":"Fili","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":64.2,"lon":190.3,"description":"Norse dwarf.","dimension":"31.7 km"},{"name":"Fimbulthul Catena","type":"Crater chain","theme":"moon","moon_name":"Callisto","lat":8.2,"lon":115.2,"description":"Norse river.","dimension":"287.0 km"},{"name":"Finnr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":15.5,"lon":175.7,"description":"Norse dwarf.","dimension":"80.0 km"},{"name":"Freki","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":79.8,"lon":188.3,"description":"Norse; wolf's name meaning \u201c;insatiable.\u201c","dimension":"55.0 km"},{"name":"Frodi","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":68.4,"lon":40.1,"description":"Norse; Hledis' father.","dimension":"45.9 km"},{"name":"Fulla","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":74.0,"lon":71.9,"description":"Norse; maid to Frigg, queen of the gods.","dimension":"58.9 km"},{"name":"Fulnir","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":60.1,"lon":144.7,"description":"Norse; son of Thrael and Thyr.","dimension":"43.1 km"},{"name":"Gandalfr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-80.5,"lon":116.4,"description":"Norse dwarf.","dimension":"17.0 km"},{"name":"Geirvimul Catena","type":"Crater chain","theme":"moon","moon_name":"Callisto","lat":48.9,"lon":192.8,"description":"Norse river.","dimension":"113.1 km"},{"name":"Geri","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":66.7,"lon":186.2,"description":"Norse; wolf's name meaning \u201c;greedy.\u201c","dimension":"38.9 km"},{"name":"Ginandi","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-85.3,"lon":127.9,"description":"Ottar's ancestor.","dimension":"44.4 km"},{"name":"Gipul Catena","type":"Crater chain","theme":"moon","moon_name":"Callisto","lat":68.5,"lon":125.8,"description":"Norse river.","dimension":"641.0 km"},{"name":"Gisl","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":57.2,"lon":145.4,"description":"Norse; steed ridden by Aesir.","dimension":"37.0 km"},{"name":"Gloi","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":49.0,"lon":295.0,"description":"Norse dwarf.","dimension":"115.3 km"},{"name":"G\u00f6ll","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":57.3,"lon":220.3,"description":"Norse; servant to the gods.","dimension":"55.4 km"},{"name":"Gomul Catena","type":"Crater chain","theme":"moon","moon_name":"Callisto","lat":35.5,"lon":132.9,"description":"Norse river.","dimension":"342.6 km"},{"name":"G\u00f6ndul","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":60.0,"lon":65.9,"description":"Norse; a Valkyrie.","dimension":"45.5 km"},{"name":"Grimr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":41.5,"lon":325.4,"description":"Norse; a name for Odin.","dimension":"103.2 km"},{"name":"Gunnr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":64.6,"lon":75.3,"description":"Norse; a Valkyrie.","dimension":"61.1 km"},{"name":"Gunntro Catena","type":"Crater chain","theme":"moon","moon_name":"Callisto","lat":-19.5,"lon":196.9,"description":"Norse river.","dimension":"149.0 km"},{"name":"Gymir","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":63.7,"lon":131.2,"description":"Norse; another name for the sea-god, Legir.","dimension":"40.6 km"},{"name":"H\u00e1brok","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":76.2,"lon":48.1,"description":"Norse; a hawk.","dimension":"37.2 km"},{"name":"Haki","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":25.0,"lon":224.9,"description":"Norse giant.","dimension":"72.2 km"},{"name":"H\u00e1r","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-3.5,"lon":182.0,"description":"Norse; a name for Odin.","dimension":"52.2 km"},{"name":"Heimdall","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-63.5,"lon":183.0,"description":"Teutonic god of light, guardian of the great bridge Bifr\u00f6st.","dimension":"210.0 km"},{"name":"Hepti","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":64.5,"lon":156.6,"description":"Norse dwarf.","dimension":"48.6 km"},{"name":"Hijsi","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":63.1,"lon":8.5,"description":"Karelian deity of hunting.","dimension":"54.1 km"},{"name":"H\u00f6dr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":69.1,"lon":90.8,"description":"Norse; Baldr's blind brother who shot Baldr unknowingly.","dimension":"76.5 km"},{"name":"Hoenir","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-33.7,"lon":279.1,"description":"Norse; god who gave souls to first humans.","dimension":"81.1 km"},{"name":"H\u00f6gni","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-11.8,"lon":175.2,"description":"Norse; Ottar's ancestor.","dimension":"76.0 km"},{"name":"H\u00f6ldr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":43.9,"lon":71.8,"description":"Son of Karl and Snor in Rigdismal.","dimension":"68.1 km"},{"name":"Igaluk","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":5.6,"lon":224.0,"description":"Alaskan name of the Moon.","dimension":"111.7 km"},{"name":"Ilma","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-29.9,"lon":12.8,"description":"A celestial divinity of air.","dimension":"102.0 km"},{"name":"Ivarr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-5.8,"lon":218.6,"description":"Norse; Ottar's ancestor.","dimension":"73.1 km"},{"name":"Jalkr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-38.6,"lon":97.3,"description":"Another name for Odinn.","dimension":"93.5 km"},{"name":"Jumal","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":58.9,"lon":62.0,"description":"Estonian sky god.","dimension":"58.5 km"},{"name":"Jumo","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":65.7,"lon":168.2,"description":"Finno-Ugric heaven god.","dimension":"43.6 km"},{"name":"K\u00e1ri","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":48.2,"lon":63.7,"description":"Ottar's ancestor.","dimension":"34.5 km"},{"name":"Karl","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":56.4,"lon":209.4,"description":"Norse; Rigr's son with Amma.","dimension":"34.0 km"},{"name":"Keelut","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-76.8,"lon":89.1,"description":"Eskimo evil spirit who resembles a hairless dog.","dimension":"64.0 km"},{"name":"Kol Facula","type":"Facula","theme":"moon","moon_name":"Callisto","lat":4.5,"lon":257.3,"description":"Icelandic frost or storm giant.","dimension":"390.0 km"},{"name":"Kul'","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":62.9,"lon":58.1,"description":"Komi wood spirit.","dimension":"40.5 km"},{"name":"Lempo","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-25.2,"lon":220.1,"description":"Finno-Ugric evil spirit.","dimension":"41.3 km"},{"name":"Ljekio","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":49.1,"lon":17.7,"description":"Finnish god of grass, roots of trees.","dimension":"23.8 km"},{"name":"Lodurr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-50.8,"lon":269.9,"description":"Norse; god who gave first humans goodly color.","dimension":"72.0 km"},{"name":"Lofn","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-56.5,"lon":157.7,"description":"Norse goddess of marriage.","dimension":"200.0 km"},{"name":"Loni","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-3.6,"lon":325.7,"description":"Norse dwarf.","dimension":"85.0 km"},{"name":"Losy","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":65.3,"lon":216.7,"description":"Mongolian; Mongol evil snake; tried to kill all living things.","dimension":"62.1 km"},{"name":"Lycaon","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-45.4,"lon":174.1,"description":"Callisto's father.","dimension":"59.0 km"},{"name":"Maderatcha","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":30.7,"lon":84.7,"description":"Saami sky god.","dimension":"66.2 km"},{"name":"Mera","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":64.1,"lon":104.8,"description":"Greek; another nymph of Artemis seduced by Zeus.","dimension":"39.5 km"},{"name":"Mimir","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":32.6,"lon":126.8,"description":"Norse giant.","dimension":"47.7 km"},{"name":"Mitsina","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":57.5,"lon":76.3,"description":"Alaskan old man who perished while hunting on ice.","dimension":"40.4 km"},{"name":"Modi","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":66.4,"lon":60.7,"description":"Norse; son of Thor and Sif.","dimension":"37.8 km"},{"name":"Nakki","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-56.4,"lon":110.3,"description":"Finnish water god.","dimension":"59.8 km"},{"name":"Nama","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":57.0,"lon":209.0,"description":"Altaic hero who built ark to save his family from the flood.","dimension":"30.1 km"},{"name":"N\u00e1r","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-1.5,"lon":134.0,"description":"Norse dwarf.","dimension":"56.9 km"},{"name":"Nerrivik","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-16.9,"lon":123.6,"description":"Alaskan name of Sedna.","dimension":"44.3 km"},{"name":"Nidi","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":66.4,"lon":85.1,"description":"Norse dwarf.","dimension":"49.3 km"},{"name":"Nirkes","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":31.4,"lon":15.7,"description":"Karelian patron of squirrel hunting.","dimension":"58.5 km"},{"name":"Njord","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":16.7,"lon":47.4,"description":"Nordic gods called the Vanir; pacific, benevolent, guardians of man.","dimension":"44.6 km"},{"name":"Nori","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":45.2,"lon":196.4,"description":"Norse dwarf.","dimension":"114.0 km"},{"name":"Norov-Ava","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":54.6,"lon":67.2,"description":"Mordvinian mistress of the field.","dimension":"41.4 km"},{"name":"Nuada","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":62.3,"lon":267.5,"description":"Irish chieftain god.","dimension":"66.0 km"},{"name":"Numi-Torum","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-50.1,"lon":87.1,"description":"Mansi creator god.","dimension":"75.6 km"},{"name":"Nyctimus","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-62.8,"lon":176.1,"description":"Brother of Callisto.","dimension":"34.0 km"},{"name":"Oluksak","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-47.8,"lon":116.5,"description":"Eskimo god of lakes.","dimension":"86.7 km"},{"name":"Omol'","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":42.3,"lon":63.1,"description":"Komi wood spirit.","dimension":"60.4 km"},{"name":"Orestheus","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-46.7,"lon":132.3,"description":"Brother of Callisto.","dimension":"22.5 km"},{"name":"Oski","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":57.5,"lon":271.0,"description":"Norse; a name for Odin.","dimension":"48.1 km"},{"name":"Ottar","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":61.5,"lon":76.1,"description":"Innsteinn's son and Freyja's favorite.","dimension":"59.8 km"},{"name":"Pekko","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":18.3,"lon":174.6,"description":"Finno-Ugric god of barley.","dimension":"62.0 km"},{"name":"Randver","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-71.9,"lon":126.1,"description":"Ottar's ancestor.","dimension":"28.0 km"},{"name":"Reginleif","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-66.0,"lon":83.5,"description":"Servant of the gods.","dimension":"54.8 km"},{"name":"Reginn","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":39.8,"lon":89.9,"description":"Norse dwarf.","dimension":"57.0 km"},{"name":"Reifnir","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-50.8,"lon":125.7,"description":"Ottar's ancestor.","dimension":"36.8 km"},{"name":"Rigr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":70.8,"lon":295.4,"description":"Norse; another name for the god Heimdall.","dimension":"72.5 km"},{"name":"Rongoteus","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":53.6,"lon":73.9,"description":"Karelian deity of the harvest of rye.","dimension":"35.5 km"},{"name":"Rota","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":27.2,"lon":71.6,"description":"Deity of the underground world.","dimension":"45.0 km"},{"name":"Saga","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":0.6,"lon":214.1,"description":"Scandinavian goddess, wife of Odin.","dimension":"11.1 km"},{"name":"Sarakka","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-3.3,"lon":126.5,"description":"Finno-Ugric goddess of childbirth.","dimension":"47.7 km"},{"name":"Seqinek","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":55.5,"lon":154.6,"description":"Eskimo; the sun.","dimension":"80.7 km"},{"name":"Sholmo","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":53.7,"lon":163.8,"description":"Finno-Ugric heaven god.","dimension":"57.0 km"},{"name":"Sid Catena","type":"Crater chain","theme":"moon","moon_name":"Callisto","lat":49.2,"lon":76.1,"description":"Norse river.","dimension":"81.4 km"},{"name":"Sigyn","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":35.9,"lon":151.0,"description":"Norse; Loki's wife.","dimension":"49.8 km"},{"name":"Skeggold","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-49.7,"lon":148.1,"description":"Servant of the gods.","dimension":"43.0 km"},{"name":"Sk\u00f6ll","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":55.6,"lon":224.4,"description":"Norse wolf.","dimension":"59.6 km"},{"name":"Skuld","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":10.0,"lon":142.1,"description":"Norse; maiden living near Yggdrasill who governed the fate of humans.","dimension":"91.8 km"},{"name":"Sudri","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":55.9,"lon":44.4,"description":"Norse dwarf.","dimension":"69.5 km"},{"name":"Sumbur","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":67.1,"lon":214.8,"description":"Russian (Buriat) world mountain.","dimension":"37.9 km"},{"name":"Svol Catena","type":"Crater chain","theme":"moon","moon_name":"Callisto","lat":10.6,"lon":142.8,"description":"Norse river.","dimension":"161.0 km"},{"name":"Tapio","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":30.1,"lon":71.4,"description":"Finnish deity of the wood who sends game to the hunter.","dimension":"52.2 km"},{"name":"Thekkr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-80.3,"lon":118.0,"description":"Norse dwarf.","dimension":"13.0 km"},{"name":"Thorir","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-31.9,"lon":113.3,"description":"Ottar's ancestor.","dimension":"62.7 km"},{"name":"Tindr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-2.3,"lon":184.5,"description":"Norse; Ottar's ancestor.","dimension":"75.8 km"},{"name":"Tontu","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":27.6,"lon":79.7,"description":"Finnish god of housekeeping.","dimension":"40.2 km"},{"name":"Tornarsuk","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":28.8,"lon":52.4,"description":"Greenland legendary hero.","dimension":"99.0 km"},{"name":"Tyll","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":44.8,"lon":13.5,"description":"Estonian epic hero; struggled with a giant.","dimension":"68.7 km"},{"name":"Tyn","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":71.1,"lon":307.5,"description":"Great god of Germanic peoples.","dimension":"63.0 km"},{"name":"Uksakka","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-49.5,"lon":137.8,"description":"Lapp protector goddess.","dimension":"22.5 km"},{"name":"Utgard","type":"Large ringed feature","theme":"moon","moon_name":"Callisto","lat":45.0,"lon":46.0,"description":"Teutonic home of giants.","dimension":"610.0 km"},{"name":"Valf\u00f6dr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-1.3,"lon":293.0,"description":"Norse; a name for Odin, god of wisdom.","dimension":"101.5 km"},{"name":"Valhalla","type":"Large ringed feature","theme":"moon","moon_name":"Callisto","lat":14.7,"lon":124.0,"description":"Norse; Odin's hall, where he received the souls of slain warriors.","dimension":"3000.0 km"},{"name":"Vali","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":9.7,"lon":214.7,"description":"Norse; Ottar's ancestor.","dimension":"54.3 km"},{"name":"Vanapagan","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":39.5,"lon":21.5,"description":"Estonian, a wicked giant.","dimension":"62.7 km"},{"name":"Veralden","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":33.3,"lon":84.5,"description":"Saami god of fertility.","dimension":"75.2 km"},{"name":"Vestri","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":45.3,"lon":127.5,"description":"Norse dwarf.","dimension":"77.3 km"},{"name":"Vidarr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":12.1,"lon":346.6,"description":"Norse god.","dimension":"78.0 km"},{"name":"Vili","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":32.6,"lon":324.1,"description":"In Norse mythology, brother of the god Odin.","dimension":"42.0 km"},{"name":"Vitr","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-22.1,"lon":190.6,"description":"Norse dwarf.","dimension":"72.8 km"},{"name":"Vu-Murt","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":21.5,"lon":9.7,"description":"Estonian spirit of water.","dimension":"34.5 km"},{"name":"Vutash","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":31.6,"lon":77.7,"description":"Estonian spirit of water.","dimension":"46.2 km"},{"name":"Ymir","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":51.5,"lon":80.3,"description":"Norse; giant from whom Earth was created.","dimension":"79.0 km"},{"name":"Yuryung","type":"Impact crater","theme":"moon","moon_name":"Callisto","lat":-54.7,"lon":94.3,"description":"Yakutian heaven god.","dimension":"75.1 km"},{"name":"Acacallis Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-5.27,"lon":134.44,"description":"Granddaughter of Europa and sibling of Phaedra and Katreus.","dimension":"940.0 km"},{"name":"Adonis Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-61.0,"lon":237.4,"description":"Greek; son of Phoenix, nephew of Europa.","dimension":"1560.0 km"},{"name":"Agave Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":12.8,"lon":86.9,"description":"Daughter of Harmonia and Cadmus.","dimension":"1440.0 km"},{"name":"Agenor Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-43.8,"lon":146.5,"description":"Greek; Europa's father.","dimension":"1496.0 km"},{"name":"\u00c1ine","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-43.0,"lon":182.5,"description":"Celtic goddess of love and fertility.","dimension":"5.0 km"},{"name":"Alphesiboea Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-25.1,"lon":184.1,"description":"Son of Phoenix, nephew of Europa.","dimension":"1438.0 km"},{"name":"Amaethon","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":13.82,"lon":182.53,"description":"Celtic god of agriculture.","dimension":"1.7 km"},{"name":"Amergin","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-14.7,"lon":129.4,"description":"Legendary Irish druid and poet.","dimension":"17.0 km"},{"name":"Ancaeus Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":57.82,"lon":177.54,"description":"The nephew of Europa, in Greek mythology.","dimension":"145.0 km"},{"name":"Androgeos Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":11.7,"lon":80.7,"description":"Son of Minos in Greek mythology.","dimension":"723.0 km"},{"name":"Angus","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-12.6,"lon":284.9,"description":"Beautiful Celtic god of love.","dimension":"4.5 km"},{"name":"Annwn Regio","type":"Regio","theme":"moon","moon_name":"Europa","lat":20.0,"lon":40.0,"description":"Traditional name of the Welsh Otherworld where sparkling wine is the normal beverage, and age and sickness are unknown.","dimension":"2300.0 km"},{"name":"Arachne Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-8.82,"lon":140.04,"description":"Daughter of Idmon of Colophon in Greek mythology, who challenged the goddess Athena in a weaving contest.","dimension":"954.0 km"},{"name":"Argadnel Regio","type":"Regio","theme":"moon","moon_name":"Europa","lat":-14.6,"lon":151.5,"description":"In Celtic mythology, one of the islands of Earthly paradise seen during Bran's voyage.","dimension":"1900.0 km"},{"name":"Argiope Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-1.7,"lon":164.4,"description":"Greek; another name for Telephassa.","dimension":"689.0 km"},{"name":"Arran Chaos","type":"Chaos, chaoses","theme":"moon","moon_name":"Europa","lat":13.4,"lon":279.5,"description":"Island where Manann\u00e1n had a palace.","dimension":"26.0 km"},{"name":"Asterius Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":14.9,"lon":89.2,"description":"Greek; Europa's husband after Zeus.","dimension":"1943.0 km"},{"name":"Astypalaea Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-75.8,"lon":147.9,"description":"Sister of Europa.","dimension":"817.0 km"},{"name":"Autono\u00eb Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":18.2,"lon":194.9,"description":"Daughter of Harmonia and Cadmus in Greek mythology.","dimension":"760.0 km"},{"name":"Avagddu","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":1.4,"lon":190.5,"description":"Celtic storm deity, ill-fated son of Tegid the Bald.","dimension":"10.0 km"},{"name":"Balgatan Regio","type":"Regio","theme":"moon","moon_name":"Europa","lat":-50.0,"lon":330.0,"description":"In Celtic mythology, pass to which the Tuatha D\u00e9 Dannan retreated before the battle with the Fir Bolgs.","dimension":"2500.0 km"},{"name":"Balor","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-52.8,"lon":262.2,"description":"Celtic god of the night whose evil eye caused the death of those on whom it glanced.","dimension":"4.8 km"},{"name":"Beenalaght Fossa","type":"Fossa","theme":"moon","moon_name":"Europa","lat":1.2,"lon":277.92,"description":"Stone row in County Cork, Ireland.","dimension":"882.0 km"},{"name":"Belenos Mensa","type":"Mensa, mensae","theme":"moon","moon_name":"Europa","lat":42.75,"lon":284.92,"description":"Celtic sun god, equated with Apollo in that character; found mainly in Aquileia (now at NE Italy).","dimension":"34.0 km"},{"name":"Belus Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":9.3,"lon":128.6,"description":"Greek; Agenor's twin brother.","dimension":"2437.0 km"},{"name":"Boeotia Macula","type":"Macula","theme":"moon","moon_name":"Europa","lat":-53.6,"lon":193.2,"description":"Place where Cadmus led cow before it stopped at site of Thebes.","dimension":"30.0 km"},{"name":"Borvo Mensa","type":"Mensa, mensae","theme":"moon","moon_name":"Europa","lat":-0.45,"lon":134.69,"description":"Romano-Celtic (Gallic) god of healing identified with several therapeutic springs and mineral baths.","dimension":"49.7 km"},{"name":"Bress","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":37.64,"lon":261.34,"description":"Beautiful son of Elatha in Celtic mythology.","dimension":"10.0 km"},{"name":"Brigid","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":10.8,"lon":278.7,"description":"Celtic goddess of healing, smiths, fertility and poetry.","dimension":"9.5 km"},{"name":"Butterdon Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-44.7,"lon":359.9,"description":"Stone row in England.","dimension":"1900.0 km"},{"name":"Cadmus Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":38.7,"lon":168.3,"description":"Greek; brother of Europa.","dimension":"3548.0 km"},{"name":"Callanish","type":"Large ringed feature","theme":"moon","moon_name":"Europa","lat":-16.7,"lon":25.5,"description":"Stone circle in the Outer Hebrides, Scotland.","dimension":"107.0 km"},{"name":"Camulus","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-26.5,"lon":278.9,"description":"Gaelic war god.","dimension":"4.5 km"},{"name":"Castalia Macula","type":"Macula","theme":"moon","moon_name":"Europa","lat":-1.6,"lon":134.3,"description":"Greek; spring where Cadmus, brother of Europa, killed the dragon.","dimension":"35.0 km"},{"name":"Chthonius Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-1.4,"lon":55.8,"description":"Survivor of the men Cadmus sowed with dragon's teeth, a founder of Thebes.","dimension":"2180.0 km"},{"name":"Cilicia Flexus","type":"Flexus, flex\u016bs","theme":"moon","moon_name":"Europa","lat":-59.5,"lon":188.3,"description":"Land named for Cilix on his search for Europa.","dimension":"1312.0 km"},{"name":"Cilix","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":2.6,"lon":178.1,"description":"Brother of Europa.","dimension":"15.0 km"},{"name":"Cliodhna","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-2.5,"lon":283.6,"description":"Celtic goddess of beauty who was lured asleep by music, then swept away by a great wave.","dimension":"3.0 km"},{"name":"Conamara Chaos","type":"Chaos, chaoses","theme":"moon","moon_name":"Europa","lat":9.7,"lon":87.3,"description":"Rugged part of western Ireland named for Conmac, son of the Queen of Connacht.","dimension":"143.7 km"},{"name":"Corick Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":17.8,"lon":341.7,"description":"Stone row in Ireland.","dimension":"1300.0 km"},{"name":"Cormac","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-36.9,"lon":271.9,"description":"Cormac Mac Art, High King of Ulster in Irish myths.","dimension":"4.0 km"},{"name":"Cyclades Macula","type":"Macula","theme":"moon","moon_name":"Europa","lat":-62.5,"lon":168.7,"description":"Islands where Rhadamanthys reigned.","dimension":"107.0 km"},{"name":"Dagda","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":37.35,"lon":191.26,"description":"One of the chief deities of the Tuatha de Danann in Irish mythology.","dimension":"9.8 km"},{"name":"Deirdre","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-65.4,"lon":152.7,"description":"The most beautiful woman in Irish myths.","dimension":"4.5 km"},{"name":"Delphi Flexus","type":"Flexus, flex\u016bs","theme":"moon","moon_name":"Europa","lat":-68.2,"lon":185.9,"description":"Where the cow led Cadmus before it stopped at the site of Thebes.","dimension":"793.0 km"},{"name":"Diarmuid","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-61.3,"lon":258.0,"description":"Handsome Irish mythological warrior, husband of Gr\u00e1inne.","dimension":"8.2 km"},{"name":"Dinrigh Chaos","type":"Chaos, chaoses","theme":"moon","moon_name":"Europa","lat":-46.48,"lon":227.84,"description":"In Celtic mythology, the location where Maon slew Covac.","dimension":"335.0 km"},{"name":"Drizzlecomb Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":7.7,"lon":248.3,"description":"Stone row in England.","dimension":"1500.0 km"},{"name":"Drumskinny Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":48.3,"lon":199.0,"description":"Stone row in Ireland.","dimension":"1375.0 km"},{"name":"Dyfed Regio","type":"Regio","theme":"moon","moon_name":"Europa","lat":10.0,"lon":110.0,"description":"In Welsh mythology, the southwestern kingdom of Wales just east of Annwn, containing a mysterious realm.","dimension":"1750.0 km"},{"name":"Dylan","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-55.3,"lon":275.6,"description":"Celtic sea god.","dimension":"5.3 km"},{"name":"Echion Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-11.6,"lon":174.8,"description":"Survivor of the men Cadmus sowed with the dragon's teeth; a founder of Thebes.","dimension":"1026.0 km"},{"name":"Eightercua Fossa","type":"Fossa","theme":"moon","moon_name":"Europa","lat":6.68,"lon":19.29,"description":"Stone row in County Kerry, Ireland.","dimension":"407.0 km"},{"name":"Elathan","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-31.9,"lon":280.2,"description":"Handsome Celtic king, father of sun god Bres.","dimension":"2.5 km"},{"name":"Eochaid","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-50.48,"lon":126.67,"description":"King of the Fir Bolgs in Celtic mythology.","dimension":"10.6 km"},{"name":"Euphemus Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-11.4,"lon":314.3,"description":"In Greek mythology, son of Europa and Poseidon who could walk on water.","dimension":"1250.0 km"},{"name":"Falga Regio","type":"Regio","theme":"moon","moon_name":"Europa","lat":30.0,"lon":150.0,"description":"In Celtic mythology, island where Midir had a stronghold.","dimension":"2500.0 km"},{"name":"Glaukos Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":57.8,"lon":129.1,"description":"Son of Minos in Greek mythology.","dimension":"1400.0 km"},{"name":"Goirias Chaos","type":"Chaos, chaoses","theme":"moon","moon_name":"Europa","lat":10.77,"lon":179.25,"description":"In Celtic mythology, one of the four cities of the Tuatha D\u00e9 Danann (Dana) people.","dimension":"470.0 km"},{"name":"Gortyna Flexus","type":"Flexus, flex\u016bs","theme":"moon","moon_name":"Europa","lat":-42.1,"lon":215.4,"description":"Place on Crete where Zeus brought Europa.","dimension":"940.0 km"},{"name":"Govannan","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-37.3,"lon":57.2,"description":"One of the Children of Don, a smith and brewer.","dimension":"11.5 km"},{"name":"Gr\u00e1inne","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-59.7,"lon":260.6,"description":"Daughter of Cormac Mac Art, the mythical High King of Ulster, and wife of Diarmuid.","dimension":"13.5 km"},{"name":"Grannus Mensa","type":"Mensa, mensae","theme":"moon","moon_name":"Europa","lat":-2.51,"lon":134.2,"description":"Romano-Celtic (Continental Europe) god of healing associated with medicinal hot springs and hot mineral waters.","dimension":"42.0 km"},{"name":"Gwern","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":9.14,"lon":15.46,"description":"Son of Branwen in Celtic mythology.","dimension":"22.2 km"},{"name":"Gwydion","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-60.5,"lon":278.4,"description":"Celtic poet, one of the children of the mother goddess Don.","dimension":"5.0 km"},{"name":"Harmonia Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":28.0,"lon":188.3,"description":"Wife of Cadmus.","dimension":"1154.0 km"},{"name":"Hyperenor Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-12.1,"lon":35.6,"description":"Survivor of the men Cadmus sowed with dragon's teeth, a founder of Thebes.","dimension":"2996.0 km"},{"name":"Ino Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-1.7,"lon":185.4,"description":"Daughter of Harmonia and Cadmus.","dimension":"1515.0 km"},{"name":"Katreus Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-38.8,"lon":146.7,"description":"Son of Minos in Greek mythology.","dimension":"195.0 km"},{"name":"Kennet Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-41.0,"lon":48.0,"description":"Stone row in England.","dimension":"3200.0 km"},{"name":"Kerlescan Fossae","type":"Fossa","theme":"moon","moon_name":"Europa","lat":3.34,"lon":121.76,"description":"Stone rows in France (Carnac, Brittany).","dimension":"410.0 km"},{"name":"Kermario Fossae","type":"Fossa","theme":"moon","moon_name":"Europa","lat":44.69,"lon":5.64,"description":"Stone rows in France (Carnac, Brittany).","dimension":"191.0 km"},{"name":"Leix Chaos","type":"Chaos, chaoses","theme":"moon","moon_name":"Europa","lat":-39.39,"lon":223.8,"description":"In Celtic mythology, the city to which Maeld\u016bn voyaged to avenge his father, Ailill Edge-of-Battle.","dimension":"415.0 km"},{"name":"Libya Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-54.0,"lon":179.0,"description":"Greek; Agenor's mother.","dimension":"366.0 km"},{"name":"Llyr","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-1.8,"lon":138.2,"description":"Celtic sea god.","dimension":"1.1 km"},{"name":"Luchtar","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-40.2,"lon":102.43,"description":"Celtic god of carpentry.","dimension":"19.9 km"},{"name":"Lug","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":27.99,"lon":315.69,"description":"Irish omnicompetent god.","dimension":"11.0 km"},{"name":"Mael D\u00fain","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-16.8,"lon":162.1,"description":"Celtic hero.","dimension":"2.0 km"},{"name":"Maeve","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":58.8,"lon":281.1,"description":"Mythological Irish queen of Connacht province.","dimension":"21.3 km"},{"name":"Manann\u00e1n","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":3.1,"lon":120.3,"description":"Irish sea and fertility god.","dimension":"30.0 km"},{"name":"Math","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-25.6,"lon":176.3,"description":"Celtic god of wealth and treasure.","dimension":"10.8 km"},{"name":"Maughanasilly Fossa","type":"Fossa","theme":"moon","moon_name":"Europa","lat":-34.24,"lon":204.81,"description":"Stone row in County Cork, Ireland.","dimension":"920.0 km"},{"name":"Mehen Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":56.0,"lon":123.3,"description":"Stone row in Brittany, France.","dimension":"1500.0 km"},{"name":"M\u00e9nec Fossae","type":"Fossa","theme":"moon","moon_name":"Europa","lat":-51.98,"lon":182.13,"description":"Stone rows in France (Carnac, Brittany).","dimension":"33.0 km"},{"name":"Merrivale Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-41.0,"lon":60.5,"description":"Stone row in England.","dimension":"1600.0 km"},{"name":"Midir","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":3.65,"lon":21.25,"description":"Gaelic fate and underworld deity.","dimension":"37.4 km"},{"name":"Minos Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":47.2,"lon":164.8,"description":"Greek; son of Europa and Zeus.","dimension":"2170.0 km"},{"name":"Morvran","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-4.9,"lon":207.4,"description":"Celtic; ugly son of Tegid.","dimension":"15.0 km"},{"name":"Moyle Cavus","type":"Cavus, cavi","theme":"moon","moon_name":"Europa","lat":-25.0,"lon":192.0,"description":"In Celtic mythology, a cold sea where the children of Lir (Llyr), transformed into swans, were forced to spend three hundred years.","dimension":"145.0 km"},{"name":"Moytura Regio","type":"Regio","theme":"moon","moon_name":"Europa","lat":-50.0,"lon":65.7,"description":"Location of battles between the Fomorians and the Tautha de Danann.","dimension":"483.0 km"},{"name":"Murias Chaos","type":"Chaos, chaoses","theme":"moon","moon_name":"Europa","lat":22.4,"lon":276.2,"description":"One of the four great cities of the Tuatha D\u00e9 Danann (the people of the goddess Danu, the wizards) in Irish Celtic myths.","dimension":"116.0 km"},{"name":"Narberth Chaos","type":"Chaos, chaoses","theme":"moon","moon_name":"Europa","lat":-26.0,"lon":87.0,"description":"Chief court of Pwyll; he first saw his future wife Rhiannon at a nearby mound.","dimension":"20.0 km"},{"name":"Niamh","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":21.1,"lon":143.1,"description":"Golden-haired daughter of the Celtic sea and fertility god Manann\u00e1n.","dimension":"5.0 km"},{"name":"Ogma","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":87.45,"lon":72.14,"description":"Celtic god of eloquence and literature, a son of Dagda.","dimension":"5.0 km"},{"name":"Ois\u00edn","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-52.3,"lon":146.6,"description":"Mythical Irish warrior, son of Fionn Mac Cumhail and Sadb.","dimension":"6.2 km"},{"name":"Onga Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-38.7,"lon":148.7,"description":"Phoenician name for Athene.","dimension":"870.0 km"},{"name":"Pasiphae Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":41.08,"lon":351.94,"description":"Daughter-in-law of Europa, wife of King Minos (Europa\u2019s son by Zeus), mother of the Minotaur.","dimension":"1306.0 km"},{"name":"Pelagon Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":35.5,"lon":186.4,"description":"King who sold Cadmus the cow with a white full moon on each flank.","dimension":"616.7 km"},{"name":"Pelorus Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-19.8,"lon":171.7,"description":"Greek; survivor of the men Cadmus sowed with the dragon's teeth; a founder of Thebes.","dimension":"1535.0 km"},{"name":"Phineus Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-29.8,"lon":40.1,"description":"Greek; brother of Europa.","dimension":"2004.0 km"},{"name":"Phocis Flexus","type":"Flexus, flex\u016bs","theme":"moon","moon_name":"Europa","lat":-44.5,"lon":161.6,"description":"Where the cow lead Cadmus before it stopped at the site of Thebes.","dimension":"242.0 km"},{"name":"Phoenix Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":16.6,"lon":171.2,"description":"Brother of Europa.","dimension":"1621.0 km"},{"name":"Powys Regio","type":"Regio","theme":"moon","moon_name":"Europa","lat":0.0,"lon":215.0,"description":"In Celtic mythology, ancient kingdom of mid-Wales.","dimension":"2000.0 km"},{"name":"Pryderi","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-66.1,"lon":200.9,"description":"Son of Pwyll, Celtic god of the underworld.","dimension":"1.7 km"},{"name":"Pwyll","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-25.2,"lon":88.6,"description":"Celtic god of the underworld.","dimension":"45.0 km"},{"name":"Rathcroghan Chaos","type":"Chaos, chaoses","theme":"moon","moon_name":"Europa","lat":-10.08,"lon":178.08,"description":"In Celtic mythology, the seat or palace of Maev, warrior queen.","dimension":"430.0 km"},{"name":"Rathmore Chaos","type":"Chaos, chaoses","theme":"moon","moon_name":"Europa","lat":25.4,"lon":285.0,"description":"Seat of Mongan, a son of the sea god Manann\u00e1n.","dimension":"57.0 km"},{"name":"Rhadamanthys Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":19.3,"lon":159.5,"description":"Son of Europa and Zeus.","dimension":"1747.0 km"},{"name":"Rhiannon","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-80.9,"lon":165.1,"description":"Celtic heroine.","dimension":"15.9 km"},{"name":"Sarpedon Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-49.5,"lon":267.1,"description":"Greek; son of Europa and Zeus.","dimension":"900.0 km"},{"name":"Sharpitor Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":65.4,"lon":188.3,"description":"Stone row in England.","dimension":"1650.0 km"},{"name":"Sidon Flexus","type":"Flexus, flex\u016bs","theme":"moon","moon_name":"Europa","lat":-66.4,"lon":176.6,"description":"Another name for Tyre; where Europa was born.","dimension":"1133.0 km"},{"name":"Sparti Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":59.3,"lon":114.5,"description":"In Greek mythology, warriors who sprouted from the dragon's teeth sewn by Athene, ancestors of the Thebans.","dimension":"1600.0 km"},{"name":"Staldon Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-0.8,"lon":332.6,"description":"Stone row in England.","dimension":"1525.0 km"},{"name":"Taliesin","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-22.8,"lon":222.0,"description":"Celtic, son of Bran; magician.","dimension":"50.0 km"},{"name":"Tara Regio","type":"Regio","theme":"moon","moon_name":"Europa","lat":-10.0,"lon":285.0,"description":"In Celtic mythology, the main royal residence of the High Kings.","dimension":"1780.0 km"},{"name":"Tectamus Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":26.9,"lon":160.8,"description":"Father of Asterius.","dimension":"2096.0 km"},{"name":"Tegid","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":0.8,"lon":195.6,"description":"Celtic hero who lived in Bula Lake.","dimension":"29.7 km"},{"name":"Telephassa Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-0.8,"lon":182.8,"description":"Europa's mother.","dimension":"777.0 km"},{"name":"Thasus Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-66.1,"lon":176.0,"description":"Greek; brother of Europa.","dimension":"669.3 km"},{"name":"Thera Macula","type":"Macula","theme":"moon","moon_name":"Europa","lat":-46.7,"lon":178.8,"description":"Greek; place where Cadmus stopped in his search for Europa.","dimension":"95.0 km"},{"name":"Thrace Macula","type":"Macula","theme":"moon","moon_name":"Europa","lat":-45.9,"lon":187.9,"description":"Place in northern Greece where Cadmus stopped in his search for Europa.","dimension":"180.2 km"},{"name":"Thynia Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-59.2,"lon":205.5,"description":"Peninsula between Black and Marmara Seas, where Phineus sought Europa.","dimension":"412.6 km"},{"name":"Tormsdale Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":47.7,"lon":102.0,"description":"Stone row in Ireland.","dimension":"875.0 km"},{"name":"Tuag","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":59.92,"lon":187.64,"description":"Irish dawn goddess.","dimension":"15.2 km"},{"name":"Tyre","type":"Large ringed feature","theme":"moon","moon_name":"Europa","lat":33.6,"lon":213.4,"description":"Greek; the seashore from which Zeus abducted Europa. Changed from Tyre Macula.","dimension":"149.0 km"},{"name":"[Tyre Macula]","type":"Macula","theme":"moon","moon_name":"Europa","lat":31.7,"lon":213.0,"description":"Greek; the seashore from which Zeus abducted Europa. Changed to Tyre.","dimension":"148.0 km"},{"name":"Uaithne","type":"Impact crater","theme":"moon","moon_name":"Europa","lat":-48.5,"lon":269.3,"description":"The harpist for Dagda, the father of all gods in Celtic myths.","dimension":"6.5 km"},{"name":"Udaeus Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":48.6,"lon":120.6,"description":"In Greek mythology, survivors of the men Cadmus sowed with dragon's teeth.","dimension":"2050.0 km"},{"name":"Yelland Linea","type":"Linea","theme":"moon","moon_name":"Europa","lat":-16.7,"lon":164.0,"description":"Stone row in England.","dimension":"186.0 km"},{"name":"Abydos Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":33.33,"lon":26.56,"description":"Egyptian town where Osiris was worshipped.","dimension":"180.0 km"},{"name":"Achelous","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":61.9,"lon":168.22,"description":"Greek river god; father of Callirrhoe, Ganymede's mother.","dimension":"40.0 km"},{"name":"Adad","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":57.43,"lon":181.98,"description":"Assyro-Babylonian god of thunder.","dimension":"39.0 km"},{"name":"Adapa","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":73.08,"lon":148.68,"description":"Assyro-Babylonian; lost immortality when, at Ea's advice, he refused food of life.","dimension":"57.0 km"},{"name":"Agreus","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":15.87,"lon":307.3,"description":"Hunter god in Tyre.","dimension":"63.0 km"},{"name":"Agrotes","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":60.93,"lon":347.38,"description":"Tyre; greatest god of Gebal; farmer god.","dimension":"74.0 km"},{"name":"Akhmin Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":28.3,"lon":350.2,"description":"Egyptian town where Min was worshipped.","dimension":"245.0 km"},{"name":"Akitu Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":39.0,"lon":346.0,"description":"Where Marduk's statue was carried each year.","dimension":"365.0 km"},{"name":"Aleyin","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":15.14,"lon":45.92,"description":"Son of Ba'al, spirit of springs.","dimension":"12.4 km"},{"name":"Ammura","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":31.76,"lon":197.65,"description":"Phoenician; god of the west.","dimension":"61.5 km"},{"name":"Amon","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":33.69,"lon":319.39,"description":"Theban king of gods.","dimension":"102.0 km"},{"name":"Amset","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-14.41,"lon":1.25,"description":"One of the four gods of the dead, son of Horus.","dimension":"11.0 km"},{"name":"Anat","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-4.1,"lon":52.0,"description":"Assyro-Babylonian goddess of dew.","dimension":"2.9 km"},{"name":"Andjeti","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-52.75,"lon":18.9,"description":"Egyptian; first god of Busirus.","dimension":"52.0 km"},{"name":"Anhur","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":32.63,"lon":347.68,"description":"Egyptian warrior god.","dimension":"25.0 km"},{"name":"Anshar Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":18.9,"lon":341.3,"description":"Assyro-Babylonian; celestial-world home of Lakhmu and Lakhamu.","dimension":"1372.0 km"},{"name":"Antum","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":5.09,"lon":321.06,"description":"Babylonian; wife of Anu.","dimension":"14.8 km"},{"name":"Anu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":65.24,"lon":195.75,"description":"Sumerian-Akkadian god of power, of heavens.","dimension":"55.0 km"},{"name":"Anubis","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-84.44,"lon":51.34,"description":"Egyptian jackal-headed god who opened the underworld to the dead.","dimension":"114.0 km"},{"name":"Anzu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":63.51,"lon":117.27,"description":"Gigantic lion-headed bird-like figure, the Sumerian Thunderbird.","dimension":"210.0 km"},{"name":"Apophis","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-8.12,"lon":263.84,"description":"Egyptian gigantic serpent symbolizing chaos or nonexistence.","dimension":"57.0 km"},{"name":"Apsu Sulci","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-37.5,"lon":314.8,"description":"Sumero-Akkadian; primordial ocean.","dimension":"1950.0 km"},{"name":"Aquarius Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":52.4,"lon":176.0,"description":"Greek; Zeus set Ganymede among the stars as the constellation of Aquarius, the water carrier.","dimension":"1420.0 km"},{"name":"Arbela Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-34.0,"lon":176.0,"description":"Assyrian town where Ishtar was worshipped.","dimension":"3850.0 km"},{"name":"Ash\u00eema","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-39.05,"lon":57.02,"description":"Semitic-Arab god of fate.","dimension":"84.0 km"},{"name":"Asshur","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":54.16,"lon":206.52,"description":"Assyro-Babylonian warrior god.","dimension":"25.5 km"},{"name":"Atra-hasis","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":22.54,"lon":285.89,"description":"Exceedingly wise' hero of Akkadian myth, survived the great flood.","dimension":"133.0 km"},{"name":"Aya","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":68.34,"lon":217.98,"description":"Assyro-Babylonian; wife of Shamash.","dimension":"38.0 km"},{"name":"Ba'al","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":24.92,"lon":210.03,"description":"Phoenician; Canaanite god.","dimension":"43.0 km"},{"name":"Babylon Sulci","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-22.5,"lon":84.5,"description":"Assyro-Babylonian town in the land known as Akkad.","dimension":"3100.0 km"},{"name":"Barnard Regio","type":"Regio","theme":"moon","moon_name":"Ganymede","lat":-6.8,"lon":168.4,"description":"Edward E.; American astronomer (1857-1923).","dimension":"3200.0 km"},{"name":"Bau","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":23.05,"lon":131.33,"description":"Goddess who breathed into men the breath of life; daughter of Anu and patroness of Lagash.","dimension":"77.0 km"},{"name":"Bes","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-25.48,"lon":359.04,"description":"Egyptian god of marriage.","dimension":"63.0 km"},{"name":"Bigeh Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":29.0,"lon":85.7,"description":"Island where Hapi, Egyptian Nile god, resided.","dimension":"224.0 km"},{"name":"Borsippa Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-60.0,"lon":180.0,"description":"Akkadian town, location of the Sumerian god Nabu's principal sanctuary.","dimension":"3300.0 km"},{"name":"Bubastis Sulci","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-81.0,"lon":315.0,"description":"Town in Egypt where Bast was worshipped.","dimension":"2730.0 km"},{"name":"Busiris Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":16.0,"lon":324.7,"description":"Town in lower Egypt where Osiris was first installed as local god.","dimension":"369.0 km"},{"name":"Buto Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":13.3,"lon":336.8,"description":"Swamp where Isis hid Osiris' body.","dimension":"245.0 km"},{"name":"Byblus Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":37.6,"lon":340.3,"description":"Ancient Phoenician city where Adonis was worshipped.","dimension":"645.0 km"},{"name":"Chrysor","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":15.3,"lon":45.66,"description":"Phoenician god; inventor of bait, fishing hooks and line, first to sail.","dimension":"7.0 km"},{"name":"Cisti","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-31.6,"lon":115.77,"description":"Iranian healing god.","dimension":"70.0 km"},{"name":"Coptos Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":10.0,"lon":331.0,"description":"Early town from which caravans departed.","dimension":"329.0 km"},{"name":"Damkina","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-30.17,"lon":175.12,"description":"Babylonian sky and health deity, queen of the gods, and mother of Marduk in some accounts.","dimension":"190.0 km"},{"name":"Danel","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-4.33,"lon":158.7,"description":"Phoenician; mythical hero versed in art of divination.","dimension":"56.0 km"},{"name":"Dardanus Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-31.5,"lon":167.3,"description":"Greek; where Ganymede was abducted by Zeus disguised as an eagle.","dimension":"1500.0 km"},{"name":"Dendera","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-1.12,"lon":284.54,"description":"Town where Hathor was chief goddess. (Name changed from Dendera Facula.)","dimension":"82.0 km"},{"name":"[Dendera Facula]","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":0.0,"lon":283.0,"description":"Town where Hathor was chief goddess. Name changed to Dendera.","dimension":"114.0 km"},{"name":"Diment","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":23.14,"lon":188.23,"description":"Egyptian goddess of the dwelling place of the dead.","dimension":"40.0 km"},{"name":"Dukug Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":83.7,"lon":177.5,"description":"Sumerian holy cosmic chamber of the gods.","dimension":"385.0 km"},{"name":"Ea","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":17.72,"lon":31.27,"description":"Assyro-babylonian god of water, wisdom, and the earth.","dimension":"20.0 km"},{"name":"Edfu Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":25.7,"lon":32.9,"description":"Egyptian town where Horus was worshipped.","dimension":"184.0 km"},{"name":"El","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":1.01,"lon":28.64,"description":"\u201c;Father of Men\u201c;, existed before the birth of gods.","dimension":"55.0 km"},{"name":"Elam Sulci","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":60.0,"lon":340.0,"description":"Ancient Babylonian seat of sun worship, in present-day Iran.","dimension":"1500.0 km"},{"name":"Enki Catena","type":"Crater chain","theme":"moon","moon_name":"Ganymede","lat":38.84,"lon":166.14,"description":"Principal water god of the Apsu.","dimension":"160.0 km"},{"name":"Enkidu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-26.61,"lon":214.87,"description":"Friend of Gilgamesh.","dimension":"122.0 km"},{"name":"Enlil","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":55.36,"lon":227.9,"description":"Assyro-Babylonian; nature god of the air, hurricanes, and nature.","dimension":"34.6 km"},{"name":"En-zu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":11.59,"lon":11.6,"description":"Babylonian moon god.","dimension":"5.0 km"},{"name":"Epigeus","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":22.96,"lon":359.35,"description":"Phoenician god.","dimension":"343.0 km"},{"name":"Erech Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-7.3,"lon":0.8,"description":"Akkadian town that was built by Marduk.","dimension":"953.0 km"},{"name":"Erichthonius","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-15.32,"lon":4.74,"description":"Possible father of Ganymede.","dimension":"31.0 km"},{"name":"Eshmun","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-17.45,"lon":347.88,"description":"Phoenician; divinity of Sidon.","dimension":"98.0 km"},{"name":"Etana","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":74.74,"lon":199.65,"description":"Assyro-Babylonian; asked the eagle for an herb to give him an heir.","dimension":"46.0 km"},{"name":"Gad","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-13.56,"lon":42.44,"description":"Semitic god of fate or good fortune.","dimension":"72.0 km"},{"name":"Galileo Regio","type":"Regio","theme":"moon","moon_name":"Ganymede","lat":45.0,"lon":53.0,"description":"Italian astronomer (1564-1642).","dimension":"4439.0 km"},{"name":"Geb","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":56.41,"lon":357.35,"description":"Heliopolis Earth god.","dimension":"60.0 km"},{"name":"Geinos","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":18.64,"lon":320.56,"description":"Tyre; god of brick making.","dimension":"56.0 km"},{"name":"Gilgamesh","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-62.84,"lon":55.17,"description":"Assyro-Babylonian; sought immortality after Enkidu died.","dimension":"153.0 km"},{"name":"Gir","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":34.05,"lon":34.25,"description":"Sumerian god of summer heat.","dimension":"73.0 km"},{"name":"Gula","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":64.15,"lon":167.7,"description":"Assyro-Babylonian; health god.","dimension":"38.0 km"},{"name":"Gushkin","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":20.75,"lon":134.02,"description":"Gushkin-Banda, Sumerian patron god of goldsmiths.","dimension":"40.5 km"},{"name":"Halieus","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":34.45,"lon":12.86,"description":"Tyre; fisherman god.","dimension":"90.0 km"},{"name":"Hammamat Patera","type":"Volcanic patera","theme":"moon","moon_name":"Ganymede","lat":-24.23,"lon":221.9,"description":"Wadi in Egypt, associated with petroglyphs and ancient mining.","dimension":"45.0 km"},{"name":"Hamra Patera","type":"Volcanic patera","theme":"moon","moon_name":"Ganymede","lat":-77.35,"lon":8.63,"description":"Wadi in Jordan, associated with red sandstone cliffs and ancient copper mines.","dimension":"43.0 km"},{"name":"Hapi","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-30.57,"lon":327.34,"description":"Egyptian god of the Nile.","dimension":"96.0 km"},{"name":"Harakhtes","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":35.95,"lon":79.74,"description":"\u201c;Horus of the Two Horizons\u201c;, form of Egyptian god Horus who represents the path of the sun.","dimension":"108.0 km"},{"name":"Haroeris","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":28.53,"lon":243.18,"description":"Egyptian sky god whose eyes are the sun and the moon, a form of Horus.","dimension":"70.0 km"},{"name":"Harpagia Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-11.8,"lon":226.5,"description":"Greek; where Ganymede was abducted an eagle.","dimension":"1400.0 km"},{"name":"Hathor","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-66.9,"lon":271.26,"description":"Egyptian goddess of joy and love.","dimension":"173.0 km"},{"name":"Hay-tau","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":14.44,"lon":46.87,"description":"Nega god, spirit of forest vegetation.","dimension":"27.0 km"},{"name":"Hedetet","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-32.91,"lon":288.99,"description":"Egyptian scorpion goddess.","dimension":"106.0 km"},{"name":"Heliopolis Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":18.5,"lon":33.0,"description":"Sacred Egyptian city of the sun.","dimension":"50.0 km"},{"name":"Hermopolis Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":22.3,"lon":344.7,"description":"Place where Unut was worshipped.","dimension":"260.0 km"},{"name":"Hershef","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":47.39,"lon":270.62,"description":"Egyptian ram-headed god.","dimension":"120.0 km"},{"name":"Humbaba","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-55.15,"lon":112.69,"description":"Babylonian terrifying guardian of the cedar forests.","dimension":"40.0 km"},{"name":"Hursag Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-9.49,"lon":291.54,"description":"Sumerian mountain where winds dwell.","dimension":"2183.0 km"},{"name":"Ilah","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":22.0,"lon":19.38,"description":"First Sumerian sky god.","dimension":"76.0 km"},{"name":"Ilus","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-13.46,"lon":69.57,"description":"Ganymede's brother.","dimension":"90.0 km"},{"name":"Irkalla","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-32.52,"lon":65.16,"description":"Sumerian goddess of underworld, seen by Enkidu in a dream.","dimension":"117.0 km"},{"name":"Ishkur","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":0.37,"lon":171.63,"description":"Sumerian god of rain.","dimension":"67.0 km"},{"name":"Isimu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":8.5,"lon":180.0,"description":"Sumerian god of vegetation.","dimension":"89.5 km"},{"name":"Isis","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-67.28,"lon":338.8,"description":"Egyptian goddess; wife of Osiris.","dimension":"75.0 km"},{"name":"Kadi","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":47.68,"lon":1.5,"description":"Babylonian goddess of justice.","dimension":"87.0 km"},{"name":"[Keret]","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":16.0,"lon":144.8,"description":"Phoenician hero. Name dropped because feature not found on imagery.","dimension":"36.0 km"},{"name":"Khensu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":1.02,"lon":27.07,"description":"Egyptian moon god.","dimension":"17.0 km"},{"name":"Khepri","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":20.41,"lon":32.44,"description":"God of transformations for the Heliopitans.","dimension":"47.0 km"},{"name":"[Khnum]","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-17.8,"lon":94.8,"description":"Egyptian ram-headed creation god.","dimension":"45.0 km"},{"name":"Khnum Catena","type":"Crater chain","theme":"moon","moon_name":"Ganymede","lat":32.9,"lon":190.73,"description":"Egyptian creation god.","dimension":"66.0 km"},{"name":"Khonsu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-37.51,"lon":349.17,"description":"Egyptian moon god.","dimension":"80.0 km"},{"name":"Khumbam","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-24.1,"lon":204.65,"description":"Assyro-Babylonian; Elamite creator god.","dimension":"57.0 km"},{"name":"Kingu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-34.66,"lon":312.97,"description":"Assyro-Babylonian; conquered leader of Tiamat's forces whose blood was used to create man.","dimension":"78.0 km"},{"name":"Kishar","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":72.7,"lon":190.54,"description":"Assyro-Babylonian; terrestrial progenitor goddess.","dimension":"78.0 km"},{"name":"Kishar Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-6.4,"lon":323.4,"description":"Assyro-Babylonian; terrestrial-world home of Lakhmu and Lakhamu.","dimension":"1187.0 km"},{"name":"Kittu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":0.4,"lon":205.4,"description":"Assyro-Babylonian god of justice.","dimension":"15.0 km"},{"name":"Kulla","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":33.22,"lon":66.13,"description":"Sumerian god of brick making.","dimension":"93.0 km"},{"name":"Lagamal","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":64.3,"lon":295.79,"description":"Son of Babylonian god Ea.","dimension":"131.0 km"},{"name":"Lagash Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-8.99,"lon":15.99,"description":"Early Babylonian town.","dimension":"1575.0 km"},{"name":"Lakhamu Fossa","type":"Fossa","theme":"moon","moon_name":"Ganymede","lat":-11.7,"lon":312.8,"description":"Dragon monster, or divine natural force produced by Apsu and Tiamat.","dimension":"370.0 km"},{"name":"Lakhmu Fossae","type":"Fossa","theme":"moon","moon_name":"Ganymede","lat":50.4,"lon":52.0,"description":"Dragon monster, or divine natural force produced by Apsu and Tiamat.","dimension":"3700.0 km"},{"name":"Laomedon","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":20.9,"lon":102.1,"description":"In Greek mythology, legendary king of Troy, nephew (or possibly father) of Ganymede.","dimension":"64.0 km"},{"name":"Larsa Sulci","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":2.0,"lon":280.0,"description":"Sumerian town.","dimension":"1130.0 km"},{"name":"Latpon","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":58.74,"lon":8.79,"description":"One of the sons of El.","dimension":"43.0 km"},{"name":"Lugalmeslam","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":23.72,"lon":346.11,"description":"Sumerian god of the underworld.","dimension":"64.0 km"},{"name":"Lumha","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":36.01,"lon":25.77,"description":"Title of Enki as patron of singers; also Babylonian priest.","dimension":"58.0 km"},{"name":"Maa","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":1.3,"lon":336.37,"description":"Egyptian god of the sense of sight.","dimension":"31.0 km"},{"name":"Marius Regio","type":"Regio","theme":"moon","moon_name":"Ganymede","lat":2.5,"lon":352.3,"description":"Simon; German astronomer (1570-1624).","dimension":"4940.0 km"},{"name":"Mashu Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":34.0,"lon":330.0,"description":"Assyro-Babylonian; mountain with twin peaks where sun rose and set.","dimension":"2960.0 km"},{"name":"Mehit","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":28.95,"lon":15.61,"description":"Egyptian lion-headed goddess; Anhur's wife.","dimension":"47.0 km"},{"name":"Melkart","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-9.86,"lon":353.93,"description":"Phoenician; divinity of Tyre.","dimension":"105.0 km"},{"name":"Melotte Regio","type":"Regio","theme":"moon","moon_name":"Ganymede","lat":-12.0,"lon":295.0,"description":"Philibert Jacques; British astronomer (1880-1961).","dimension":"4100.0 km"},{"name":"Memphis Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":14.1,"lon":48.09,"description":"Ancient capitol of lower kingdom.","dimension":"361.0 km"},{"name":"Menhit","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-36.31,"lon":39.68,"description":"Egyptian lion and war goddess.","dimension":"140.0 km"},{"name":"Min","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":29.23,"lon":178.74,"description":"Egyptian fertility god.","dimension":"33.0 km"},{"name":"Mir","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-3.3,"lon":309.7,"description":"West Semitic god of wind.","dimension":"8.0 km"},{"name":"Misharu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-4.31,"lon":204.11,"description":"Assyro-Babylonian god of law.","dimension":"88.0 km"},{"name":"Mont","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":44.62,"lon":228.05,"description":"Theban war god.","dimension":"15.0 km"},{"name":"Mor","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":30.55,"lon":212.65,"description":"Phoenician; spirit of the harvest.","dimension":"41.0 km"},{"name":"Mot","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":9.93,"lon":14.05,"description":"Spirit of the harvest, one of the sons of El.","dimension":"23.0 km"},{"name":"Mummu Sulci","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-39.0,"lon":0.0,"description":"Assyro-Babylonian; the tumult of the waves at the place where the waters of primordial freshwater ocean Apsu and salt sea Tiamat are mingled.","dimension":"2680.0 km"},{"name":"Musa Patera","type":"Volcanic patera","theme":"moon","moon_name":"Ganymede","lat":-31.35,"lon":351.54,"description":"Wadi in Jordan, proximal to Petra archeological site.","dimension":"69.0 km"},{"name":"Mush","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-15.12,"lon":65.23,"description":"Sumerian male deity; upper parts are human, lower parts a serpent.","dimension":"99.0 km"},{"name":"Mysia Sulci","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-7.0,"lon":172.2,"description":"Greek; where Ganymede was abducted by an eagle.","dimension":"5066.0 km"},{"name":"Nabu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-45.39,"lon":178.81,"description":"Sumerian god of intellectual activity.","dimension":"40.0 km"},{"name":"Nah-Hunte","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-17.76,"lon":94.74,"description":"Elamite god of light and justice.","dimension":"47.0 km"},{"name":"Namtar","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-58.34,"lon":199.3,"description":"Assyro-Babylonian plague demon.","dimension":"50.0 km"},{"name":"Nanna","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-17.61,"lon":298.13,"description":"Sumerian moon god; god of wisdom.","dimension":"56.0 km"},{"name":"Nanshe Catena","type":"Crater chain","theme":"moon","moon_name":"Ganymede","lat":15.4,"lon":187.1,"description":"Goddess of springs and canals, daughter of Enki.","dimension":"103.8 km"},{"name":"Natrun Patera","type":"Volcanic patera","theme":"moon","moon_name":"Ganymede","lat":-30.93,"lon":356.74,"description":"Wadi in Egypt, site of ancient monasteries, proximal to site of Antoine de Saint-Exup\u00e9ry\u2019s aircraft crash that inspired the novella \u201cThe Little Prince\u201d.","dimension":"37.5 km"},{"name":"Nefertum","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":44.35,"lon":218.96,"description":"Original divine son of the Memphis triad, son of Ptah.","dimension":"29.0 km"},{"name":"Neheh","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":72.13,"lon":117.34,"description":"Egyptian god of eternity.","dimension":"54.0 km"},{"name":"Neith","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":29.45,"lon":173.03,"description":"Egyptian warrior goddess; goddess of domestic arts.","dimension":"90.0 km"},{"name":"Nergal","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":38.58,"lon":339.67,"description":"Assyro-babylonian king of the underworld.","dimension":"9.6 km"},{"name":"Nicholson Regio","type":"Regio","theme":"moon","moon_name":"Ganymede","lat":-33.1,"lon":173.6,"description":"Seth Barnes; American astronomer (1891-1963).","dimension":"3900.0 km"},{"name":"Nidaba","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":17.75,"lon":56.57,"description":"Sumerian grain goddess.","dimension":"199.0 km"},{"name":"Nigirsu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-58.26,"lon":219.43,"description":"Assyro-Babylonian; god of the fields, war god.","dimension":"53.0 km"},{"name":"Nineveh Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":23.2,"lon":127.0,"description":"City where Ishtar was worshipped.","dimension":"1700.0 km"},{"name":"Ningishzida","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":14.11,"lon":350.16,"description":"Sumerian vegetation god.","dimension":"32.0 km"},{"name":"Ninkasi","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":59.21,"lon":131.15,"description":"Sumerian goddess of brewing.","dimension":"81.0 km"},{"name":"Ninki","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-8.37,"lon":59.21,"description":"Consort to Ea, Babylonian god of water.","dimension":"194.0 km"},{"name":"Ninlil","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":6.27,"lon":61.68,"description":"Chief Assyrian goddess; Asshur's consort.","dimension":"91.0 km"},{"name":"Ninsum","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-14.35,"lon":39.45,"description":"Minor Babylonian goddess of wisdom; Gilgamesh's mother.","dimension":"88.0 km"},{"name":"Nippur Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":35.41,"lon":356.65,"description":"Sumerian city.","dimension":"1425.0 km"},{"name":"Nun Sulci","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":49.5,"lon":223.6,"description":"Egyptian; chaos; primordial ocean; held germ of all things.","dimension":"1500.0 km"},{"name":"Nut","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-54.21,"lon":270.8,"description":"Egyptian goddess of the sky.","dimension":"90.0 km"},{"name":"Ombos","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":4.75,"lon":303.84,"description":"Egyptian town where Sebek's triad worshiped; present Kom Ombo.","dimension":"177.0 km"},{"name":"[Ombos Facula]","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":4.8,"lon":304.0,"description":"Egyptian town where Sebek's triad worshipped; present Kom Ombo.","dimension":"170.0 km"},{"name":"Osiris","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-38.0,"lon":13.69,"description":"Egyptian god of the dead.","dimension":"107.0 km"},{"name":"Perrine Regio","type":"Regio","theme":"moon","moon_name":"Ganymede","lat":34.0,"lon":152.0,"description":"Charles D.; American astronomer (1867-1951).","dimension":"3800.0 km"},{"name":"Philae Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":68.4,"lon":11.8,"description":"Temple that was the chief sanctuary of Isis.","dimension":"900.0 km"},{"name":"Philus Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":44.5,"lon":330.1,"description":"Greek; where Ganymede and Hebe were worshipped as rain-givers.","dimension":"465.0 km"},{"name":"Phrygia Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":12.0,"lon":159.4,"description":"Greek; kingdom in Asia Minor where Ganymede was born.","dimension":"3700.0 km"},{"name":"Ptah","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-65.9,"lon":322.95,"description":"Sovereign god of Memphis; patron of artisans.","dimension":"30.0 km"},{"name":"Punt","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-24.89,"lon":300.15,"description":"Land east of Egypt where Bes originated. Changed from Punt Facula.","dimension":"135.0 km"},{"name":"[Punt Facula]","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":-26.1,"lon":297.8,"description":"Land east of Egypt where Bes originated. Changed to Punt (crater).","dimension":"228.0 km"},{"name":"Rum Patera","type":"Volcanic patera","theme":"moon","moon_name":"Ganymede","lat":-30.66,"lon":357.18,"description":"Wadi in Jordan associated with travels of T. E. Lawrence, petroglyphs, and several Neolithic sites.","dimension":"38.0 km"},{"name":"Ruti","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":13.23,"lon":231.35,"description":"Phoenician; Byblos god.","dimension":"16.0 km"},{"name":"[Sais Facula]","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":37.9,"lon":165.8,"description":"Capital of Egypt in mid-7th century B.C.","dimension":"137.0 km"},{"name":"Saltu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-14.15,"lon":187.23,"description":"Babylonian goddess of discord and hostility.","dimension":"40.0 km"},{"name":"Sapas","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":57.45,"lon":146.01,"description":"Assyro-Babylonian; torch of the gods.","dimension":"56.0 km"},{"name":"Sati","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":30.84,"lon":167.2,"description":"Wife of Khnum, Egyptian god of the Cataracts.","dimension":"95.0 km"},{"name":"Sebek","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":61.25,"lon":183.22,"description":"Egyptian crocodile god.","dimension":"61.0 km"},{"name":"Seima","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":17.09,"lon":324.03,"description":"Mother goddess of the Arameans.","dimension":"38.0 km"},{"name":"Seker","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-39.16,"lon":194.62,"description":"Egyptian god of the dead at Memphis.","dimension":"103.0 km"},{"name":"Selket","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":15.03,"lon":74.3,"description":"Tutelary goddess who guarded intestines of the dead.","dimension":"168.0 km"},{"name":"Serapis","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-12.4,"lon":135.89,"description":"Egyptian healing god.","dimension":"169.0 km"},{"name":"Shu","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":43.16,"lon":183.16,"description":"Egyptian god of air.","dimension":"44.0 km"},{"name":"Shuruppak Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-19.62,"lon":308.25,"description":"Assyro-Babylonian town on the banks of the Euphrates River where the gods planned the great flood.","dimension":"2730.0 km"},{"name":"Sicyon Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":33.7,"lon":164.7,"description":"Greek; where Ganymede and Hebe were worshipped as rain-givers.","dimension":"2125.0 km"},{"name":"Sin","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":52.94,"lon":182.54,"description":"Babylonian moon god.","dimension":"19.0 km"},{"name":"Sippar Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":-19.9,"lon":9.8,"description":"Ancient Babylonian town.","dimension":"3260.0 km"},{"name":"Siwah Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":7.0,"lon":37.0,"description":"Oasis oracle of Zeus-Ammon; visited by Alexander.","dimension":"220.0 km"},{"name":"Tammuz","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":13.45,"lon":309.24,"description":"Akkadian youthful god of vegetation; Ishtar's son.","dimension":"51.0 km"},{"name":"Tanit","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":57.49,"lon":143.38,"description":"Assyro-Babylonian; Carthaginian goddess.","dimension":"26.0 km"},{"name":"Tashmetum","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-39.72,"lon":275.46,"description":"Assyro-Babylonian goddess who invented writing with her husband Nabu.","dimension":"135.0 km"},{"name":"Ta-urt","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":27.66,"lon":235.8,"description":"Egyptian childbirth goddess.","dimension":"94.0 km"},{"name":"Terah Catena","type":"Crater chain","theme":"moon","moon_name":"Ganymede","lat":7.1,"lon":262.4,"description":"Phoenician moon god who battled with Keret in Negeb.","dimension":"283.0 km"},{"name":"Teshub","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-68.3,"lon":260.72,"description":"Elamite god of the tempest.","dimension":"188.0 km"},{"name":"Tettu Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":37.6,"lon":19.04,"description":"Egyptian town where Hatmenit and Osiris were worshipped.","dimension":"189.0 km"},{"name":"Thebes Facula","type":"Facula","theme":"moon","moon_name":"Ganymede","lat":7.1,"lon":337.8,"description":"Ancient capitol of upper kingdom.","dimension":"360.0 km"},{"name":"Thoth","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-43.22,"lon":32.75,"description":"Egyptian moon god; invented all arts and sciences.","dimension":"102.0 km"},{"name":"Tiamat Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":4.14,"lon":330.9,"description":"Assyro-Babylonian; tumultuous sea from which everything was generated.","dimension":"1330.0 km"},{"name":"Tros","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":11.14,"lon":152.74,"description":"Greek; father of Ganymede.","dimension":"94.0 km"},{"name":"Umma Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":4.1,"lon":290.5,"description":"Sumerian town.","dimension":"1270.0 km"},{"name":"Upuant","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":46.4,"lon":220.46,"description":"Jackal-headed warrior god, god of the dead.","dimension":"17.0 km"},{"name":"Ur Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":49.5,"lon":2.5,"description":"Ancient Sumerian seat of moon worship.","dimension":"1145.0 km"},{"name":"Uruk Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":3.4,"lon":20.0,"description":"Babylonian city ruled by Gilgamesh.","dimension":"2200.0 km"},{"name":"[Wadjet]","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-53.8,"lon":271.1,"description":"Egyptian cobra goddess. Same crater as Nut.","dimension":"100.0 km"},{"name":"We-ila","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-12.36,"lon":249.65,"description":"Akkadian god from whom the hero Atra-hasis was created.","dimension":"36.0 km"},{"name":"Wepwawet","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":-69.89,"lon":120.19,"description":"Ancient Egyptian jackal deity.","dimension":"86.0 km"},{"name":"Xibalba Sulcus","type":"Sulcus","theme":"moon","moon_name":"Ganymede","lat":43.0,"lon":108.9,"description":"Mayan \u201c;place of fright\u201c;; destination of those who escaped violent death.","dimension":"2200.0 km"},{"name":"Yaroun Patera","type":"Volcanic patera","theme":"moon","moon_name":"Ganymede","lat":-46.65,"lon":37.85,"description":"Wadi in Lebanon, Neolithic archaeological site.","dimension":"96.0 km"},{"name":"Zakar","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":31.28,"lon":206.33,"description":"Assyrian supreme deity.","dimension":"170.0 km"},{"name":"Zaqar","type":"Impact crater","theme":"moon","moon_name":"Ganymede","lat":58.16,"lon":142.59,"description":"Assyro-Babylonian; Sin's messenger who brought dreams to men.","dimension":"33.0 km"},{"name":"Zu Fossae","type":"Fossa","theme":"moon","moon_name":"Ganymede","lat":38.5,"lon":29.5,"description":"Dragon of chaos slain by Marduk.","dimension":"2900.0 km"},{"name":"Ababinili Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":12.78,"lon":217.83,"description":"Chickasaw fire and sun god.","dimension":"103.6 km"},{"name":"Acala Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":9.03,"lon":25.4,"description":"Japanese fire god.","dimension":"415.3 km"},{"name":"Agni Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-40.78,"lon":26.91,"description":"Hindu god of fire.","dimension":"19.7 km"},{"name":"Ah Peku Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":10.36,"lon":253.02,"description":"Mayan thunder god.","dimension":"84.9 km"},{"name":"Aidne Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-1.76,"lon":182.89,"description":"Irish creator of fire.","dimension":"29.8 km"},{"name":"Altjirra Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-34.4,"lon":251.18,"description":"Australian sky god whose voice is thunder.","dimension":"60.3 km"},{"name":"Amaterasu Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":38.21,"lon":53.45,"description":"Japanese sun goddess.","dimension":"95.3 km"},{"name":"Amatsumara Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":44.17,"lon":285.95,"description":"Shinto (Japanese) smith deity.","dimension":"39.0 km"},{"name":"Amirani","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":25.02,"lon":244.82,"description":"Georgian god of fire.","dimension":"415.2 km"},{"name":"Angpetu Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-21.18,"lon":351.15,"description":"Dakota name meaning the sun.","dimension":"18.5 km"},{"name":"Antenora Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":84.9,"lon":26.35,"description":"Name for the second ring of Cocytus, the frozen lake that is the ninth circle of Hell in Dante\u2019s \u201cThe Inferno.\u201d","dimension":"122.0 km"},{"name":"Apis Tholus","type":"Tholus","theme":"moon","moon_name":"Io","lat":-11.92,"lon":12.3,"description":"Greek; name for Epaphus, son of Io and Zeus.","dimension":"199.2 km"},{"name":"Aramazd Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-73.57,"lon":23.39,"description":"Armenian thunder god.","dimension":"69.3 km"},{"name":"Argos Planum","type":"Planum","theme":"moon","moon_name":"Io","lat":-47.9,"lon":42.19,"description":"Where Io was captured by Zeus.","dimension":"170.7 km"},{"name":"Arinna Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":31.63,"lon":210.81,"description":"Hittite sun goddess.","dimension":"121.7 km"},{"name":"Arusha Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-38.99,"lon":258.51,"description":"Hindu god of the rising sun.","dimension":"69.5 km"},{"name":"Asha Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-8.84,"lon":134.42,"description":"Persian spirit of fire.","dimension":"118.0 km"},{"name":"Asis Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":44.33,"lon":268.86,"description":"Nandi (Kenya) supreme god, personified by the Sun.","dimension":"98.0 km"},{"name":"\u0100tar Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":30.87,"lon":81.35,"description":"Iranian personification of fire.","dimension":"80.0 km"},{"name":"Aten Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-48.45,"lon":50.03,"description":"Egyptian sun god.","dimension":"48.8 km"},{"name":"Babbar Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-39.81,"lon":88.41,"description":"Sumerian; sun god.","dimension":"110.3 km"},{"name":"Bactria Regio","type":"Regio","theme":"moon","moon_name":"Io","lat":-48.25,"lon":236.47,"description":"Io passed through this area of ancient Iran in her wanderings.","dimension":"663.1 km"},{"name":"Balder Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":11.46,"lon":203.84,"description":"Norse god of light.","dimension":"37.0 km"},{"name":"Belenus Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":2.93,"lon":202.27,"description":"Celtic fire and sun god.","dimension":"22.1 km"},{"name":"Bochica Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-61.5,"lon":341.12,"description":"Chibcha sky god.","dimension":"54.1 km"},{"name":"Bo\u00f6saule Montes","type":"Mons","theme":"moon","moon_name":"Io","lat":-3.75,"lon":90.89,"description":"Cave where Io bore Epaphus.","dimension":"540.0 km"},{"name":"Bosphorus Regio","type":"Regio","theme":"moon","moon_name":"Io","lat":-2.3,"lon":239.43,"description":"\u201c;Ford of the Cow\u201c;; Io wandered through here while trying to escape from the gadfly.","dimension":"1607.2 km"},{"name":"Bulicame Regio","type":"Regio","theme":"moon","moon_name":"Io","lat":34.79,"lon":170.06,"description":"Hot sulfur spring, the water of which sinful women were permitted to use in \u201c;The Inferno.\u201c","dimension":"514.2 km"},{"name":"Camaxtli Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":15.28,"lon":223.2,"description":"Aztec thunder, tornado, and war god.","dimension":"56.0 km"},{"name":"Capaneus Mensa","type":"Mensa, mensae","theme":"moon","moon_name":"Io","lat":-16.82,"lon":238.6,"description":"The great blasphemer in Dante's \u201c;The Inferno.\u201c","dimension":"288.1 km"},{"name":"Carancho Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":1.52,"lon":42.72,"description":"Bolivian legendary hero who received fire from an owl.","dimension":"30.6 km"},{"name":"Cataquil Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-24.21,"lon":343.34,"description":"Inca god of thunder and lightning.","dimension":"117.7 km"},{"name":"Catha Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-53.72,"lon":258.42,"description":"Etruscan sun god.","dimension":"65.7 km"},{"name":"Caucasus Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":-31.95,"lon":121.52,"description":"Io passed by these mountains while trying to escape from the gadfly.","dimension":"146.6 km"},{"name":"Chaac Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":11.96,"lon":202.56,"description":"Mayan thunder and rain god.","dimension":"95.5 km"},{"name":"Chalybes Regio","type":"Regio","theme":"moon","moon_name":"Io","lat":56.88,"lon":275.33,"description":"Greek; Io passed through here in her wanderings.","dimension":"760.3 km"},{"name":"Chors Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":68.42,"lon":110.09,"description":"Slavic sun god.","dimension":"68.9 km"},{"name":"Cocytus Montes","type":"Mons","theme":"moon","moon_name":"Io","lat":60.98,"lon":28.33,"description":"Name for the frozen lake which is the ninth and final circle of Hell in Dante\u2019s \u201cThe Inferno.\u201d","dimension":"542.0 km"},{"name":"Colchis Regio","type":"Regio","theme":"moon","moon_name":"Io","lat":2.47,"lon":151.58,"description":"Greek; Io passed through this part of Asia Minor in her wanderings.","dimension":"2860.0 km"},{"name":"Creidne Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-53.31,"lon":17.45,"description":"Celtic smith god.","dimension":"168.7 km"},{"name":"Crimea Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":-75.4,"lon":116.65,"description":"Where Io passed by in her wanderings.","dimension":"138.6 km"},{"name":"Cuchi Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-0.83,"lon":215.35,"description":"Australian snake demon whose growl is thunder.","dimension":"74.1 km"},{"name":"Culann Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-19.88,"lon":199.89,"description":"Celtic smith god.","dimension":"28.9 km"},{"name":"Daedalus Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":19.5,"lon":85.69,"description":"Greek hero, smith; father of Icarus.","dimension":"74.7 km"},{"name":"Danube Planum","type":"Planum","theme":"moon","moon_name":"Io","lat":-22.58,"lon":101.99,"description":"Where Io passed by in her wanderings.","dimension":"248.0 km"},{"name":"Dazhbog Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":55.13,"lon":58.48,"description":"Slavonic sun god.","dimension":"118.8 km"},{"name":"Dingir Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-4.12,"lon":18.61,"description":"Sumerian sun god; means \u201c;shining\u201c;.","dimension":"48.3 km"},{"name":"Dis Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":70.89,"lon":41.98,"description":"Name for the walled city encompassing the sixth through ninth circles of Hell in Dante\u2019s \u201cThe Inferno.\u201d","dimension":"150.0 km"},{"name":"Dodona Planum","type":"Planum","theme":"moon","moon_name":"Io","lat":-59.07,"lon":11.77,"description":"Greek; where Io went after the death of Argus.","dimension":"515.0 km"},{"name":"Donar Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":20.29,"lon":173.01,"description":"Teutonic god of thunder.","dimension":"436.4 km"},{"name":"Dorian Montes","type":"Mons","theme":"moon","moon_name":"Io","lat":-25.1,"lon":163.31,"description":"Region in ancient Greece.","dimension":"566.2 km"},{"name":"Dusura Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":37.53,"lon":240.97,"description":"Nabataean sun god.","dimension":"65.6 km"},{"name":"Echo Mensa","type":"Mensa, mensae","theme":"moon","moon_name":"Io","lat":-79.92,"lon":5.47,"description":"Mother of Iynx.","dimension":"205.1 km"},{"name":"Egypt Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":-41.56,"lon":103.03,"description":"Io ended her wanderings here.","dimension":"218.5 km"},{"name":"Ekhi Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-28.36,"lon":271.51,"description":"Basque sun goddess.","dimension":"51.7 km"},{"name":"Emakong Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-3.37,"lon":240.15,"description":"Sulca (New Britain) man who brought fire.","dimension":"77.4 km"},{"name":"Epaphus Mensa","type":"Mensa, mensae","theme":"moon","moon_name":"Io","lat":-53.05,"lon":120.05,"description":"\u201c;Child of touch,\u201c; son of Io and Zeus.","dimension":"126.3 km"},{"name":"Estan Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":21.53,"lon":272.41,"description":"Hittite sun god.","dimension":"95.6 km"},{"name":"Ethiopia Planum","type":"Planum","theme":"moon","moon_name":"Io","lat":-45.48,"lon":335.55,"description":"Where Io passed by in her wanderings.","dimension":"328.0 km"},{"name":"Euboea Fluct\u016bs","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-44.87,"lon":8.9,"description":"Where Io passed by in her wanderings.","dimension":"113.0 km"},{"name":"Euboea Montes","type":"Mons","theme":"moon","moon_name":"Io","lat":-47.94,"lon":24.22,"description":"Where Io passed by in her wanderings.","dimension":"274.9 km"},{"name":"Euxine Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":26.32,"lon":233.56,"description":"Io passed by here in her wanderings.","dimension":"282.1 km"},{"name":"Fjorgynn Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":10.92,"lon":1.2,"description":"Norse thunder god.","dimension":"413.8 km"},{"name":"Fo Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":41.78,"lon":168.75,"description":"Chinese fire and sun god.","dimension":"104.4 km"},{"name":"Fuchi Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":28.41,"lon":32.4,"description":"Ainu fire goddess.","dimension":"66.4 km"},{"name":"Gabija Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-51.9,"lon":157.47,"description":"Lithuanian fire and household goddess.","dimension":"50.6 km"},{"name":"Galai Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-10.8,"lon":71.9,"description":"Mongol fire god.","dimension":"122.0 km"},{"name":"Gauwa Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":35.65,"lon":347.82,"description":"!Kung (people of Sao/Bushmen group in Angola, Namibia, and Botswana) western sky sun god.","dimension":"27.0 km"},{"name":"Gibil Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-14.91,"lon":65.41,"description":"Sumerian fire god.","dimension":"107.6 km"},{"name":"Girru Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":22.83,"lon":120.0,"description":"Babylonian fire god.","dimension":"67.3 km"},{"name":"Gish Bar Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":18.5,"lon":271.05,"description":"Babylonian sun god.","dimension":"218.5 km"},{"name":"Gish Bar Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":16.18,"lon":269.7,"description":"Babylonian sun god.","dimension":"117.1 km"},{"name":"Grannos Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":11.17,"lon":214.66,"description":"Gaulish sun god.","dimension":"43.6 km"},{"name":"Grian Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-11.3,"lon":348.15,"description":"Celtic solar goddess.","dimension":"87.8 km"},{"name":"Guaraci Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-17.57,"lon":337.36,"description":"Guarani (Brazil) sun god.","dimension":"92.0 km"},{"name":"Gurzil Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":50.4,"lon":311.74,"description":"Huwwara (Berbers of Libya) sun god.","dimension":"51.0 km"},{"name":"Haemus Montes","type":"Mons","theme":"moon","moon_name":"Io","lat":-70.12,"lon":313.39,"description":"Where Io passed by in her wanderings.","dimension":"331.3 km"},{"name":"Haokah Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-20.85,"lon":173.37,"description":"Sioux thunder god.","dimension":"52.0 km"},{"name":"Hatchawa Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-59.51,"lon":328.03,"description":"Yaroro (Slavic) god who, in form of a boy, gave fire to mankind.","dimension":"85.3 km"},{"name":"Heiseb Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":29.95,"lon":115.51,"description":"Bushman devil who represents fire.","dimension":"78.5 km"},{"name":"Heno Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-57.09,"lon":48.36,"description":"Iroquois god of thunder.","dimension":"71.7 km"},{"name":"Hephaestus Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":1.85,"lon":70.22,"description":"Greek smith god.","dimension":"40.6 km"},{"name":"Hermes Mensa","type":"Mensa, mensae","theme":"moon","moon_name":"Io","lat":-43.65,"lon":113.66,"description":"Freed Io from Argus.","dimension":"133.3 km"},{"name":"Hi'iaka Montes","type":"Mons","theme":"moon","moon_name":"Io","lat":-4.68,"lon":278.04,"description":"Sister of Hawaiian volcano goddess Pele.","dimension":"500.0 km"},{"name":"Hi'iaka Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-3.55,"lon":280.52,"description":"Sister of Pele.","dimension":"142.0 km"},{"name":"Hiruko Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-65.09,"lon":31.13,"description":"Japanese sun god.","dimension":"92.8 km"},{"name":"Horus Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-9.91,"lon":22.63,"description":"Egyptian falcon-headed solar god.","dimension":"165.1 km"},{"name":"Huo Shen Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-16.69,"lon":29.7,"description":"Chinese god of fire.","dimension":"182.7 km"},{"name":"Hybristes Planum","type":"Planum","theme":"moon","moon_name":"Io","lat":-54.39,"lon":341.63,"description":"Where Io passed by in her wanderings.","dimension":"195.8 km"},{"name":"Illyrikon Regio","type":"Regio","theme":"moon","moon_name":"Io","lat":-70.88,"lon":182.23,"description":"Io passed by here in her wanderings.","dimension":"1000.5 km"},{"name":"Ilmarinen Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-14.41,"lon":358.8,"description":"Finnish blacksmith with supernatural creative powers.","dimension":"39.8 km"},{"name":"Inachus Tholus","type":"Tholus","theme":"moon","moon_name":"Io","lat":-16.21,"lon":12.35,"description":"Greek; river god, father of Io.","dimension":"178.9 km"},{"name":"Inti Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-68.37,"lon":12.5,"description":"Inca sun god.","dimension":"76.3 km"},{"name":"Ionian Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":9.04,"lon":123.76,"description":"Io crossed this sea in her wanderings.","dimension":"193.3 km"},{"name":"Iopolis Planum","type":"Planum","theme":"moon","moon_name":"Io","lat":-35.29,"lon":27.29,"description":"Town where Io was worshipped as moon goddess (present-day Antioch).","dimension":"234.7 km"},{"name":"Isum Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":29.86,"lon":151.47,"description":"Assyrian fire god.","dimension":"59.1 km"},{"name":"Itzamna Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-15.81,"lon":260.82,"description":"Mayan sun, sky, wind and rain god.","dimension":"142.5 km"},{"name":"Iynx Mensa","type":"Mensa, mensae","theme":"moon","moon_name":"Io","lat":-62.28,"lon":56.0,"description":"Cast a spell on Zeus so he fell in love with Io.","dimension":"117.0 km"},{"name":"Janus Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-4.56,"lon":320.98,"description":"Italian sun god.","dimension":"53.2 km"},{"name":"Kami-Nari Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-8.82,"lon":124.91,"description":"Japanese god of rolling thunder.","dimension":"36.2 km"},{"name":"Kanehekili","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":-17.46,"lon":326.64,"description":"Hawaiian thunder god.","dimension":""},{"name":"Kanehekili Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-17.18,"lon":326.63,"description":"Hawaiian thunder god.","dimension":"258.7 km"},{"name":"Kane Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-48.42,"lon":348.25,"description":"Hawaiian god of sunlight.","dimension":"132.2 km"},{"name":"Kanlaon Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-31.06,"lon":22.04,"description":"Visayan (Philippines) supreme god that resides on the Kanlaon/Malaspina Volcano of Negros island.","dimension":"94.0 km"},{"name":"Karei Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":0.2,"lon":346.83,"description":"Semangan (Malay Peninsula) thunder god.","dimension":"35.4 km"},{"name":"Kava Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-16.82,"lon":18.59,"description":"Persian blacksmith.","dimension":"63.0 km"},{"name":"Khalla Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":6.18,"lon":56.73,"description":"Bushman sun in form of man often referred to as the hunter.","dimension":"95.8 km"},{"name":"Kibero Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-11.83,"lon":54.89,"description":"Yaroro toad who lives in underworld giving mankind fire.","dimension":"63.1 km"},{"name":"Kinich Ahau Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":49.35,"lon":49.75,"description":"Mayan sun god.","dimension":"44.3 km"},{"name":"Kotar Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":11.18,"lon":298.63,"description":"Old Syrian blacksmith god.","dimension":"67.0 km"},{"name":"Kurdalagon Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-50.57,"lon":141.77,"description":"Ossetian celestial smith.","dimension":"81.1 km"},{"name":"Laki-oi Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-40.0,"lon":301.64,"description":"Bornean hero who invented fire.","dimension":"58.4 km"},{"name":"Lei-Kung Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":40.13,"lon":153.56,"description":"Chinese thunder god.","dimension":"347.4 km"},{"name":"Lei-zi Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":13.48,"lon":315.07,"description":"Chinese goddess of thunder.","dimension":"176.9 km"},{"name":"Lerna Regio","type":"Regio","theme":"moon","moon_name":"Io","lat":-61.8,"lon":67.92,"description":"Greek; meadows of Lyrcea.","dimension":"580.9 km"},{"name":"Llew Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":12.16,"lon":117.66,"description":"Celtic sun god.","dimension":"73.3 km"},{"name":"Loki","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":18.41,"lon":57.42,"description":"Norse blacksmith, trickster god.","dimension":""},{"name":"Loki Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":13.01,"lon":51.21,"description":"Norse blacksmith, trickster god.","dimension":"226.6 km"},{"name":"Lu Huo Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-38.56,"lon":6.9,"description":"Stove fire associated with Chinese god of the hearth fire.","dimension":"66.6 km"},{"name":"Lyrcea Planum","type":"Planum","theme":"moon","moon_name":"Io","lat":-41.99,"lon":90.57,"description":"Plain where Io was born.","dimension":"424.9 km"},{"name":"Maasaw Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-40.28,"lon":20.89,"description":"Hopi (USA) god of fire and death.","dimension":"44.1 km"},{"name":"Mafuike Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-13.58,"lon":100.58,"description":"Hawaiian demigoddess whose fingers held fire.","dimension":"153.9 km"},{"name":"Malik Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-34.15,"lon":230.34,"description":"Babylonian, Caananite sun god.","dimension":"117.8 km"},{"name":"Mama Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-11.29,"lon":4.67,"description":"Chagaba (Chibcha, Colombia) word for sun.","dimension":"13.8 km"},{"name":"Mandulis Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-30.42,"lon":54.48,"description":"Nubian (Sudan/Egypt) sun god.","dimension":"37.0 km"},{"name":"Manua Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":35.91,"lon":38.18,"description":"Hawaiian sun god.","dimension":"111.5 km"},{"name":"Marduk","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":-29.64,"lon":150.1,"description":"Sumero-Akkadian fire god.","dimension":"370.1 km"},{"name":"Marduk Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-26.8,"lon":148.67,"description":"Sumero-Akkadian fire god.","dimension":"200.0 km"},{"name":"Masaya Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-22.62,"lon":15.42,"description":"Nicaraguan smith god.","dimension":"61.9 km"},{"name":"Masubi","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":-50.29,"lon":302.7,"description":"Japanese fire god.","dimension":"509.1 km"},{"name":"Masubi Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-50.89,"lon":302.23,"description":"Japanese fire god.","dimension":"499.9 km"},{"name":"Maui","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":19.69,"lon":237.72,"description":"Hawaiian demigod who sought fire from Mafuike.","dimension":"109.9 km"},{"name":"Maui Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":16.61,"lon":235.77,"description":"Hawaiian demigod who sought fire from Mafuike.","dimension":"38.1 km"},{"name":"[Mazda Catena]","type":"Crater chain","theme":"moon","moon_name":"Io","lat":-8.81,"lon":46.72,"description":"Babylonian sun god. (Changed to Mazda Paterae.)","dimension":"240.8 km"},{"name":"Mazda Paterae","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-8.2,"lon":46.99,"description":"Babylonian sun god.","dimension":"223.0 km"},{"name":"Mbali Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-31.43,"lon":355.04,"description":"Pygmy word representing fire itself.","dimension":"49.8 km"},{"name":"Media Regio","type":"Regio","theme":"moon","moon_name":"Io","lat":10.62,"lon":300.1,"description":"Greek; Io passed through this part of Iran in her wanderings.","dimension":"2627.9 km"},{"name":"Menahka Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-31.34,"lon":15.16,"description":"Mandan (USA) name for the sun.","dimension":"19.2 km"},{"name":"Mentu Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":7.01,"lon":220.61,"description":"Egyptian god of the rising sun.","dimension":"101.7 km"},{"name":"Michabo Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":1.13,"lon":192.44,"description":"Algonquin lord of eastern light, thunder, and wind.","dimension":"96.7 km"},{"name":"Mihr Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-16.46,"lon":54.58,"description":"Armenian fire god.","dimension":"58.7 km"},{"name":"Mithra Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-59.04,"lon":93.52,"description":"Persian god of light.","dimension":"32.2 km"},{"name":"Mixcoatl Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-46.32,"lon":218.85,"description":"Aztec cloud-serpent, a storm god who uses lightning arrows as his weapon.","dimension":"246.0 km"},{"name":"Monan Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":15.54,"lon":255.8,"description":"Brazilian god who destroyed the world with fire and flood.","dimension":"293.8 km"},{"name":"Monan Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":19.82,"lon":255.19,"description":"Brazilian god who destroyed the world with fire and flood.","dimension":"137.5 km"},{"name":"Mongibello Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":22.67,"lon":292.95,"description":"Name for Mt. Etna, site of Vulcan's forge in Dante's \u201c;The Inferno.\u201c; Thunderbolts from here killed Capaneus, the great blasphemer.","dimension":"214.6 km"},{"name":"Mulungu Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":17.29,"lon":142.12,"description":"African thunder god.","dimension":"64.8 km"},{"name":"Mycenae Regio","type":"Regio","theme":"moon","moon_name":"Io","lat":-36.6,"lon":195.05,"description":"Greek; in some legends, Io was transformed there.","dimension":"594.0 km"},{"name":"Namarrkun Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":10.06,"lon":184.48,"description":"Australian \u201c;lightning man\u201c; who made lightning and thunder by striking clouds with stone axes attached to his elbows and knees.","dimension":"17.0 km"},{"name":"Nemea Planum","type":"Planum","theme":"moon","moon_name":"Io","lat":-72.33,"lon":94.18,"description":"Greek; where Io was turned into a cow by Zeus and given to Hera.","dimension":"888.5 km"},{"name":"Nile Montes","type":"Mons","theme":"moon","moon_name":"Io","lat":53.65,"lon":109.54,"description":"Where Zeus restored Io to her human form.","dimension":"417.0 km"},{"name":"Nina Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-38.15,"lon":197.37,"description":"Inca fire god.","dimension":"43.5 km"},{"name":"Ninurta Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-16.79,"lon":44.81,"description":"Babylonian god of the spring sun.","dimension":"82.9 km"},{"name":"Nusku Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-64.96,"lon":356.39,"description":"Assyrian fire god.","dimension":"128.0 km"},{"name":"Nyambe Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":0.32,"lon":16.84,"description":"Zambezi sun god.","dimension":"56.6 km"},{"name":"Odqan Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-42.33,"lon":185.64,"description":"Mongolian fire-spirit.","dimension":"86.0 km"},{"name":"Olafat Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-62.66,"lon":115.61,"description":"Caroline Islands (Micronesia) fire-bringing demigod, the great trickster, similar to Polynesian Maui.","dimension":"119.0 km"},{"name":"Ot Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":4.28,"lon":144.24,"description":"Mongolian fire and marriage goddess.","dimension":"167.4 km"},{"name":"Ot Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-1.14,"lon":142.62,"description":"Mongolian fire and marriage goddess.","dimension":"50.1 km"},{"name":"P\u00e4ive Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-45.69,"lon":1.45,"description":"Saami-Lapp sun god.","dimension":"57.4 km"},{"name":"Pajonn Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":83.38,"lon":269.25,"description":"Lapp/Sami god of thunder.","dimension":"67.0 km"},{"name":"Pan Mensa","type":"Mensa, mensae","theme":"moon","moon_name":"Io","lat":-51.8,"lon":329.14,"description":"Father of Iynx.","dimension":"287.5 km"},{"name":"Pautiwa Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-34.2,"lon":14.41,"description":"Hopi (USA) name for the sun.","dimension":"7.5 km"},{"name":"Pele","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":-18.71,"lon":104.72,"description":"Hawaiian goddess of the volcano.","dimension":""},{"name":"Pillan Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-10.58,"lon":116.64,"description":"Araucanian (Chile/Argentina) thunder, fire, and volcano god.","dimension":"95.0 km"},{"name":"Pillan Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":-8.02,"lon":114.59,"description":"Araucanian thunder, fire, and volcano god.","dimension":"201.1 km"},{"name":"Pillan Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-12.3,"lon":116.71,"description":"Araucanian thunder, fire, and volcano god.","dimension":"68.9 km"},{"name":"Podja Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-18.5,"lon":55.25,"description":"Tungu spirit who keeps the fire.","dimension":"69.6 km"},{"name":"Prometheus","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":-1.52,"lon":206.06,"description":"Greek fire god.","dimension":"438.8 km"},{"name":"Prometheus Mensa","type":"Mensa, mensae","theme":"moon","moon_name":"Io","lat":-2.49,"lon":207.83,"description":"Greek fire god.","dimension":"178.7 km"},{"name":"Prometheus Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-0.64,"lon":207.59,"description":"Greek fire god.","dimension":"28.3 km"},{"name":"Purgine Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-2.37,"lon":62.74,"description":"Mordvinian (Russia) thunder god.","dimension":"18.5 km"},{"name":"Pyerun Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-55.65,"lon":108.94,"description":"Slavonic god of thunder.","dimension":"56.9 km"},{"name":"Quzah Fluct\u016bs","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-31.76,"lon":48.43,"description":"Ancient Arabian god of thunder.","dimension":"189.0 km"},{"name":"Radegast Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-27.81,"lon":200.01,"description":"West Slavic maker of thunder and lightning.","dimension":"25.8 km"},{"name":"Ra Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-8.59,"lon":35.18,"description":"Egyptian sun god.","dimension":"41.2 km"},{"name":"Rarog Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-41.63,"lon":55.7,"description":"Czech fire deity.","dimension":"102.9 km"},{"name":"Rata Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":-36.4,"lon":158.74,"description":"M\u0101ori sun hero.","dimension":"167.9 km"},{"name":"Rata Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-35.6,"lon":160.31,"description":"M\u0101ori sun hero.","dimension":"47.3 km"},{"name":"Reiden Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-13.3,"lon":124.53,"description":"Japanese thunder god.","dimension":"77.7 km"},{"name":"Reshef Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":27.7,"lon":201.95,"description":"Phoenician god of lightning, sun, and thunder.","dimension":"59.2 km"},{"name":"[Reshet Catena]","type":"Crater chain","theme":"moon","moon_name":"Io","lat":0.53,"lon":54.52,"description":"Aramaic sun god. (Changed to Reshet Patera.)","dimension":"148.3 km"},{"name":"Reshet Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":0.79,"lon":54.38,"description":"Aramaic sun god.","dimension":"146.1 km"},{"name":"Ruaumoko Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":14.72,"lon":220.26,"description":"Polynesian god who causes earthquakes and volcanoes.","dimension":"18.3 km"},{"name":"Ruwa Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":0.2,"lon":358.35,"description":"African sun god associated Mt. Kilimanjaro.","dimension":"51.4 km"},{"name":"Savitr Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":48.51,"lon":236.81,"description":"Hindu sun god.","dimension":"104.8 km"},{"name":"S\u00ead Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-2.94,"lon":56.28,"description":"Phoenician chariot rider of the Sun.","dimension":"55.1 km"},{"name":"Sengen Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-32.86,"lon":56.21,"description":"Japanese; deity of Mt. Fujiyama.","dimension":"66.0 km"},{"name":"Sethlaus Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-52.29,"lon":166.13,"description":"Etruscan celestial smith.","dimension":"74.5 km"},{"name":"Seth Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":-10.76,"lon":225.87,"description":"Egyptian thunder god.","dimension":"128.0 km"},{"name":"Seth Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-5.31,"lon":227.97,"description":"Egyptian thunder god.","dimension":"18.5 km"},{"name":"Shakuru Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":24.0,"lon":94.1,"description":"Pawnee (USA) sun god of the East; gives light and heat.","dimension":"110.2 km"},{"name":"Shamash Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-35.49,"lon":207.47,"description":"Assyro-Babylonian sun god.","dimension":"113.0 km"},{"name":"Shamshu Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":-12.04,"lon":288.59,"description":"Arabian sun goddess.","dimension":"210.0 km"},{"name":"Shamshu Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-9.95,"lon":296.83,"description":"Arabian sun goddess.","dimension":"107.1 km"},{"name":"Shango Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":32.46,"lon":259.49,"description":"Yoruba thunder god.","dimension":"90.8 km"},{"name":"[Shen Yi]","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":-55.0,"lon":70.0,"description":"Chinese sun god.","dimension":""},{"name":"Shoshu Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-20.38,"lon":35.29,"description":"Caucasian patron of fire.","dimension":"23.2 km"},{"name":"Shurdi Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-38.47,"lon":69.26,"description":"Illyrian (modern-day Albania, Croatia, etc.) storm god who sends thunder and lightning.","dimension":"46.0 km"},{"name":"Sigurd Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-5.77,"lon":261.95,"description":"Norse sun hero.","dimension":"52.9 km"},{"name":"Silpium Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":-52.62,"lon":87.65,"description":"Greek; where Io dies of grief in some legends.","dimension":"114.5 km"},{"name":"Siun Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-49.75,"lon":359.68,"description":"Nanai (Siberia) sun god.","dimension":"52.5 km"},{"name":"Skythia Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":26.33,"lon":262.19,"description":"Io passed by here in her wanderings.","dimension":"249.6 km"},{"name":"Sobo Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":14.03,"lon":209.24,"description":"Haitian voodoo thunder spirit.","dimension":"44.8 km"},{"name":"Steropes Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":15.5,"lon":221.08,"description":"One of the Greek Cyclops who created thunderbolts for Zeus.","dimension":"27.7 km"},{"name":"Sui Jen Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-19.14,"lon":357.44,"description":"Chinese hero who discovered fire.","dimension":"28.0 km"},{"name":"Surt","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":45.37,"lon":22.79,"description":"Icelandic volcano god.","dimension":""},{"name":"Surya Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":21.53,"lon":208.64,"description":"Hindu sun god.","dimension":"55.8 km"},{"name":"Susanoo Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":22.46,"lon":140.25,"description":"Japanese storm and thunder god.","dimension":"55.2 km"},{"name":"Svarog Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-48.51,"lon":94.35,"description":"Russian smith god.","dimension":"124.4 km"},{"name":"Tabiti Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-6.75,"lon":84.1,"description":"Scythian goddess of fire.","dimension":"103.0 km"},{"name":"Talos Paterae","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-26.35,"lon":5.24,"description":"Nephew of Daedalus; also a blacksmith.","dimension":"28.0 km"},{"name":"Taranis Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-71.12,"lon":332.03,"description":"Celtic thunder god.","dimension":"95.8 km"},{"name":"Tarsus Regio","type":"Regio","theme":"moon","moon_name":"Io","lat":-36.69,"lon":306.6,"description":"Io passed through here in her wanderings.","dimension":"1498.6 km"},{"name":"Tawhaki Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":3.39,"lon":283.79,"description":"M\u0101ori lightning god.","dimension":"47.4 km"},{"name":"Tawhaki Vallis","type":"Vallis","theme":"moon","moon_name":"Io","lat":0.31,"lon":287.24,"description":"M\u0101ori lightning god.","dimension":"165.7 km"},{"name":"Taw Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-33.65,"lon":1.63,"description":"Monguor word for fire or hearth.","dimension":"7.0 km"},{"name":"Telegonus Mensae","type":"Mensa, mensae","theme":"moon","moon_name":"Io","lat":-52.37,"lon":244.63,"description":"Egyptian king whom Io married.","dimension":"329.5 km"},{"name":"Thomagata Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":25.65,"lon":194.03,"description":"Chibcha storm god, a terrifying fire spirit who flew through the air changing men into animals.","dimension":"55.2 km"},{"name":"Thor","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":39.2,"lon":226.88,"description":"Norse god of thunder.","dimension":"240.3 km"},{"name":"Tien Mu Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":12.31,"lon":225.66,"description":"Chinese Mother-Lightening.","dimension":"26.7 km"},{"name":"Tiermes Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":22.29,"lon":9.85,"description":"Lapp thunder god.","dimension":"112.6 km"},{"name":"Tiwaz Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-70.44,"lon":80.25,"description":"Luvian (ancient people in Anatolia, present-day Turkey) sun god.","dimension":"78.0 km"},{"name":"Tohil Mons","type":"Mons","theme":"moon","moon_name":"Io","lat":-28.42,"lon":198.43,"description":"Central American god who gave fire to man.","dimension":"433.4 km"},{"name":"Tohil Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-26.25,"lon":201.91,"description":"Central American god who gave fire to man.","dimension":"126.5 km"},{"name":"Tol-Ava Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":1.75,"lon":37.96,"description":"Mordvinian (Russia) goddess of fire.","dimension":"87.2 km"},{"name":"Tonatiuh","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":52.0,"lon":283.0,"description":"Aztec sun god.","dimension":""},{"name":"Ts\u0169i Goab Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-1.27,"lon":196.55,"description":"Hottentot (southern Africa) supreme being, associated with thunder.","dimension":"111.4 km"},{"name":"Ts\u0169i Goab Tholus","type":"Tholus","theme":"moon","moon_name":"Io","lat":-0.18,"lon":197.05,"description":"Hottentot (southern Africa) supreme being, associated with thunder.","dimension":"48.5 km"},{"name":"Tung Yo Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-17.32,"lon":3.49,"description":"Chinese fire god.","dimension":"457.9 km"},{"name":"Tung Yo Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-18.0,"lon":359.05,"description":"Chinese fire god.","dimension":"49.6 km"},{"name":"Tupan Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-18.68,"lon":218.85,"description":"Thunder god of the Tupi-Guarani Indians of Brazil.","dimension":"78.5 km"},{"name":"[Tvashtar Catena]","type":"Crater chain","theme":"moon","moon_name":"Io","lat":62.76,"lon":236.47,"description":"Indian sun god and smith who forged the thunderbolt of the thunder god Indra. (Changed to Tvashtar Paterae.)","dimension":"306.2 km"},{"name":"Tvashtar Mensae","type":"Mensa, mensae","theme":"moon","moon_name":"Io","lat":61.6,"lon":240.06,"description":"Indian sun god and smith who forged the thunderbolt of the thunder god Indra.","dimension":"293.0 km"},{"name":"Tvashtar Paterae","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":62.76,"lon":236.47,"description":"Indian sun god and smith who forged the thunderbolt of the thunder god Indra.","dimension":"305.0 km"},{"name":"Ukko Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":30.82,"lon":341.52,"description":"Finnish thunder god.","dimension":"36.0 km"},{"name":"\u00dclgen Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-40.74,"lon":72.78,"description":"Siberian progenitor god who struck first fire.","dimension":"49.8 km"},{"name":"Upulevo Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-79.88,"lon":45.08,"description":"Timor Island (Indonesia) sun god.","dimension":"113.0 km"},{"name":"Uta Fluctus","type":"Lava flow field","theme":"moon","moon_name":"Io","lat":-33.12,"lon":343.86,"description":"Sumerian sun god.","dimension":"366.7 km"},{"name":"Uta Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-35.86,"lon":337.48,"description":"Sumerian sun god.","dimension":"33.8 km"},{"name":"Vahagn Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-24.19,"lon":9.27,"description":"Armenian fire god.","dimension":"95.2 km"},{"name":"Verbti Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":37.99,"lon":272.08,"description":"Albanian god of fire.","dimension":"62.0 km"},{"name":"Viracocha Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-61.75,"lon":79.93,"description":"Qechua sun god.","dimension":"60.6 km"},{"name":"Vivasvant Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":75.59,"lon":66.48,"description":"Hindu god of the morning sun.","dimension":"98.7 km"},{"name":"Volund","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":29.33,"lon":188.25,"description":"Germanic supreme smith of the gods.","dimension":"427.3 km"},{"name":"Wabasso Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-22.89,"lon":193.35,"description":"Potawatomi (north central U.S.) sun god.","dimension":"30.6 km"},{"name":"Wanajo Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-58.75,"lon":181.13,"description":"Louisiade Archipelago (Papua New Guinea) cultural hero, lit the first fire and scattered its ashes across the heavens to form clouds.","dimension":"24.0 km"},{"name":"Wayland Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":-32.55,"lon":134.17,"description":"Anglo-Saxon legendary smith.","dimension":"94.5 km"},{"name":"Xihe","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":-55.0,"lon":70.0,"description":"Chinese sun goddess, \u201c;Mother of the Ten Suns.\u201c","dimension":""},{"name":"Yaw Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":9.62,"lon":227.66,"description":"Hebrew sun god at Gaza.","dimension":"36.5 km"},{"name":"Yeloje Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":20.1,"lon":227.6,"description":"Yukaghir (NE Siberia, Asiatic Russia) sun god.","dimension":"107.0 km"},{"name":"Zal Montes","type":"Mons","theme":"moon","moon_name":"Io","lat":38.43,"lon":282.82,"description":"Iranian sun god.","dimension":"436.0 km"},{"name":"Zal Patera","type":"Volcanic patera","theme":"moon","moon_name":"Io","lat":40.14,"lon":285.54,"description":"Iranian sun god.","dimension":"168.1 km"},{"name":"Zamama","type":"Eruptive center","theme":"moon","moon_name":"Io","lat":18.7,"lon":187.71,"description":"Babylonian sun, corn, and war god.","dimension":"198.0 km"}];
    dedupeMoonFeatureData();
    const allFeatureData = [...labelData, ...ringLabelData, ...moonData, ...moonFeatureData];
    allFeatureData.forEach((item) => {
      item.name = getFeatureDisplayName(item);
    });
    const TOUR_FACETS = [
      { id: "highlights", label: "Highlights", filter: (item) => ["Great Red Spot", "Oval BA", "North Equatorial Belt", "South Equatorial Belt", "North Polar Haze", "South Polar Cyclone Region", "Io", "Europa", "Ganymede", "Callisto"].includes(item.name) },
      { id: "atmosphere", label: "Atmosphere", filter: (item) => ["polar", "band", "storm"].includes(item.theme) },
      { id: "moons", label: "Moons", filter: (item) => Array.isArray(item.moon_anchor) },
      { id: "mission", label: "Mission", filter: (item) => item.theme === "landing" || /juno|galileo/i.test(`${item.name} ${item.description || ""}`) },
    ];
    let activeTourFeature = null;

    function normalizeNomenclatureText(text) {
      let normalized = String(text || "")
        .trim()
        .replace(/\s+/g, " ")
        .replace(/^Name of\s+/i, "")
        .replace(/^Mythological\s+/i, "")
        .replace(/\.$/, "");
      normalized = normalized
        .replace(/^Lake in\b/i, "a lake in")
        .replace(/^Mountain\b/i, "a mountain")
        .replace(/^Island\b/i, "an island")
        .replace(/^mother\b/i, "the mother")
        .replace(/^father\b/i, "the father");
      return normalized;
    }

    function moonFeatureKind(feature) {
      const type = String(feature?.type || "").toLowerCase();
      const name = String(feature?.name || "").toLowerCase();
      const content = `${type} ${name}`;
      if (/crater|large ringed feature/.test(content)) return "impact crater";
      if (/catena/.test(content)) return "crater chain";
      if (/chasma|chasmata|fossa|fossae|linea|lineae|labyrinthus/.test(content)) return "tectonic fracture system";
      if (/dorsum|dorsa/.test(content)) return "ridge system";
      if (/mare|lacus|fretum|flumen/.test(content)) return "hydrocarbon-lake or drainage feature";
      if (/unda|undae/.test(content)) return "dune field";
      if (/mons|montes/.test(content)) return "mountainous terrain";
      if (/fluctus/.test(content)) return "flow-like terrain";
      if (/planitia|planitiae/.test(content)) return "plain";
      if (/regio|regiones|macula|maculae|facula|faculae|arcus|insula/.test(content)) return "albedo or regional terrain unit";
      if (/virga|virgae/.test(content)) return "linear streak terrain";
      return String(feature?.type || "surface feature").toLowerCase();
    }

    function moonFeatureScienceDescription(feature) {
      if (!feature?.moon_name) return feature?.description || feature?.type || "";
      const kind = moonFeatureKind(feature);
      const moon = feature.moon_name;
      const coordinate = Number.isFinite(feature.lat) && Number.isFinite(feature.lon)
        ? ` near ${feature.lat.toFixed(1)}°, ${moonLonToW(feature.lon, moon).toFixed(1)}°W`
        : "";
      const dimension = feature.dimension ? ` ${feature.dimension}.` : "";
      const interpretation = feature.interpretation ? ` Interpreted as ${String(feature.interpretation).toLowerCase()}.` : "";
      let base;
      if (moon === "Titan" && /hydrocarbon-lake|drainage/.test(kind)) {
        base = `A mapped ${kind} on Titan${coordinate}, part of Titan's methane-ethane surface system.`;
      } else if (moon === "Titan" && /dune field/.test(kind)) {
        base = `A mapped dune field on Titan${coordinate}, recording wind-shaped organic sediment transport.`;
      } else if (/impact crater/.test(kind)) {
        base = `An impact crater on ${moon}${coordinate}, useful for reading crater density, surface age, and local degradation.`;
      } else if (/tectonic fracture|ridge/.test(kind)) {
        base = `A mapped ${kind} on ${moon}${coordinate}, recording brittle deformation of the icy crust.`;
      } else {
        base = `A mapped ${kind} on ${moon}${coordinate}.`;
      }
      return `${base}${dimension}${interpretation}`.trim();
    }

    function isLikelyNomenclatureDescription(feature) {
      const text = String(feature?.description || "").trim();
      if (!feature?.moon_name || !text) return false;
      if (/\b(on|of)\s+(Mimas|Enceladus|Tethys|Dione|Rhea|Titan|Iapetus|Phoebe)\b/i.test(text)) return false;
      if (/\b(impact|tectonic|fracture|cratered|terrain|basin|plume|vent|ridge|scarps|sulcus|fossa|chasma|catena|dune|hydrocarbon|methane|ethane|surface|crust)\b/i.test(text)) return false;
      return /\b(god|goddess|myth|mythological|fictional|middle-earth|dune|queen|king|wife|husband|father|mother|son|daughter|ancestor|hero|deity|nymph|prophet|river of paradise|lake in|mountain|island|named|name of|worshipped|creator|created|people|tribe)\b/i.test(text);
    }

    function formatMoonFeatureDescription(feature, { includeNomenclature = true } = {}) {
      if (!feature?.moon_name) {
        return feature?.description || feature?.type || feature?.name || "";
      }
      const science = moonFeatureScienceDescription(feature);
      if (!includeNomenclature || !isLikelyNomenclatureDescription(feature)) {
        return science || feature.description || feature.type || feature.name || "";
      }
      const nomenclature = normalizeNomenclatureText(feature.description);
      return nomenclature
        ? `${science} Named after ${nomenclature}.`
        : science;
    }

    function getTourFeatures(facetId = tourModeFacet?.value || "highlights") {
      const facet = TOUR_FACETS.find((item) => item.id === facetId) || TOUR_FACETS[0];
      return allFeatureData.filter(facet.filter);
    }

    function populateTourTargets(selectedName = activeTourFeature?.name || "") {
      if (!tourModeTarget) return;
      const features = getTourFeatures();
      tourModeTarget.innerHTML = "";
      for (const feature of features) {
        const option = document.createElement("option");
        option.value = feature.name;
        option.textContent = feature.name;
        tourModeTarget.appendChild(option);
      }
      if (features.some((feature) => feature.name === selectedName)) {
        tourModeTarget.value = selectedName;
      } else if (features[0]) {
        tourModeTarget.value = features[0].name;
      }
      const activeIndex = features.findIndex((feature) => feature.name === tourModeTarget.value);
      const hasMultiple = features.length > 1;
      if (tourModePrev) tourModePrev.disabled = !hasMultiple;
      if (tourModeNext) tourModeNext.disabled = !hasMultiple;
      if (tourModeCopy) {
        tourModeCopy.textContent = features[activeIndex]?.description || "Choose a theme to start a guided tour.";
      }
    }

    function focusTourFeature(feature) {
      if (!feature) return;
      activeTourFeature = feature;
      if (tourModeTarget) tourModeTarget.value = feature.name;
      if (tourModeCopy) tourModeCopy.textContent = feature.description || feature.type || feature.name;
      if (viewerCamera && viewerControls) {
        focusSearchedFeature(feature, viewerCamera, viewerControls, { animate: true, isTour: true });
      }
    }

    function cycleTourFeature(direction) {
      const features = getTourFeatures();
      if (!features.length) return;
      const currentName = activeTourFeature?.name || tourModeTarget?.value || features[0].name;
      const currentIndex = Math.max(0, features.findIndex((feature) => feature.name === currentName));
      const nextFeature = features[((currentIndex + direction) % features.length + features.length) % features.length];
      focusTourFeature(nextFeature);
    }

    if (tourModeFacet && tourModeFacet.options.length === 0) {
      for (const facet of TOUR_FACETS) {
        const option = document.createElement("option");
        option.value = facet.id;
        option.textContent = facet.label;
        tourModeFacet.appendChild(option);
      }
      populateTourTargets();
    }
    if (tourModeToggle) {
      tourModeToggle.addEventListener("change", () => {
        const enabled = tourModeToggle.checked;
        if (tourModeControls) tourModeControls.style.display = enabled ? "" : "none";
        if (tourModeSection) tourModeSection.open = enabled;
        if (enabled) {
          populateTourTargets();
          focusTourFeature(getTourFeatures().find((feature) => feature.name === tourModeTarget?.value) || getTourFeatures()[0]);
        }
      });
    }
    if (tourModeFacet) {
      tourModeFacet.addEventListener("change", () => {
        populateTourTargets("");
        if (tourModeToggle?.checked) {
          focusTourFeature(getTourFeatures()[0]);
        }
      });
    }
    if (tourModeTarget) {
      tourModeTarget.addEventListener("change", () => {
        focusTourFeature(getTourFeatures().find((feature) => feature.name === tourModeTarget.value));
      });
    }
    if (tourModePrev) tourModePrev.addEventListener("click", () => cycleTourFeature(-1));
    if (tourModeNext) tourModeNext.addEventListener("click", () => cycleTourFeature(1));
    if (moonViewerSelect && moonViewerSelect.options.length <= 1) {
      const majorGroup = document.createElement("optgroup");
      majorGroup.label = "Major moons";
      const minorGroup = document.createElement("optgroup");
      minorGroup.label = "Minor moons";
      for (const item of moonData) {
        const option = document.createElement("option");
        option.value = item.name;
        option.textContent = item.name;
        (item.type === "Major moon" ? majorGroup : minorGroup).appendChild(option);
      }
      moonViewerSelect.appendChild(majorGroup);
      moonViewerSelect.appendChild(minorGroup);
    }
    const metadataButton = document.getElementById("metadata-button");
    const metadataModal = document.getElementById("metadata-modal");
    const metadataTitle = document.getElementById("metadata-title");
    const metadataSubtitle = document.getElementById("metadata-subtitle");
    const metadataSections = document.getElementById("metadata-sections");
    const metadataClose = document.getElementById("metadata-close");
    const legendSection = document.getElementById("legend-section");
    const legendPanel = document.getElementById("legend-panel");
    const legendSummaryCopy = document.getElementById("legend-summary-copy");
    const scenePopup = document.getElementById("scene-popup");
    const scenePopupState = document.getElementById("scene-popup-state");
    const scenePopupKicker = document.getElementById("scene-popup-kicker");
    const scenePopupTitle = document.getElementById("scene-popup-title");
    const scenePopupMeta = document.getElementById("scene-popup-meta");
    const scenePopupCopy = document.getElementById("scene-popup-copy");
    const scenePopupDetail = document.getElementById("scene-popup-detail");
    const scenePopupClose = document.getElementById("scene-popup-close");
    const scenePopupAnchor = document.getElementById("scene-popup-anchor");
    const measureDistanceButton = document.getElementById("measure-distance");
    const measureAreaButton = document.getElementById("measure-area");
    const measureProfileButton = document.getElementById("measure-profile");
    const measureCopy = document.getElementById("measure-copy");
    const measurePanel = document.getElementById("measure-panel");
    const measureMetric = document.getElementById("measure-metric");
    const measureExport = document.getElementById("measure-export");
    const measurementResultCard = document.getElementById("measurement-result-card");
    const measurementResultTitle = document.getElementById("measurement-result-title");
    const measurementResultBody = document.getElementById("measurement-result-body");
    const profileModal = document.getElementById("profile-modal");
    const profileModalTitle = document.getElementById("profile-modal-title");
    const profileModalSummary = document.getElementById("profile-modal-summary");
    const profileModalCanvas = document.getElementById("profile-modal-canvas");
    const profileModalExportPng = document.getElementById("profile-modal-export-png");
    const profileModalClose = document.getElementById("profile-modal-close");
    const profileCanvas = document.getElementById("profile-canvas");
    const cursorReadout = document.getElementById("cursor-readout");
    const scaleReadout = document.getElementById("scale-readout");
    const scaleLabel0 = document.getElementById("scale-label-0");
    const scaleLabel1 = document.getElementById("scale-label-1");
    const scaleLabel2 = document.getElementById("scale-label-2");
    const scaleLabel3 = document.getElementById("scale-label-3");
    const scaleLabel4 = document.getElementById("scale-label-4");
    const scaleLabel5 = document.getElementById("scale-label-5");
    const hemisphereLocatorCanvas = document.getElementById("hemisphere-locator-canvas");
    const hemisphereLocatorEl = document.getElementById("hemisphere-locator");
    const hemisphereLocatorReadout = document.getElementById("hemisphere-locator-readout");
    const hoverTooltip = document.getElementById("hover-tooltip");
    const scTemp = document.getElementById("sc-temp");
    const scPressure = document.getElementById("sc-pressure");
    const scContext = document.getElementById("sc-context");
    const surfaceConditionsEl = document.getElementById("surface-conditions");
    const interiorConditionsEl = document.getElementById("interior-conditions");
    const icDepth = document.getElementById("ic-depth");
    const icLayer = document.getElementById("ic-layer");
    const icTemp = document.getElementById("ic-temp");
    const icPressure = document.getElementById("ic-pressure");
    let activePopupFeature = null;
    let activePopupIsCoreLabel = false;
    const coreWrap = document.getElementById("core-wrap");
    const coreViewSection = document.getElementById("core-view-section");
    const legendSectionBody = legendPanel ? legendPanel.closest(".section-body") : null;

    function placeCoreSymbologyUnderLegend() {
      // Core legend stays inside the Core View section — do not move it.
    }
    let selectedGeologyOutline = null;
    let selectedGeologyBoundaryGroup = null;
    let selectedLabelEntry = null;
    let selectedLabelEntryIsSurface = false;
    let selectedLabelEntryIsCore = false;
    let lastTimestamp = 0;
    let activeSearchResults = [];
    let activeSearchIndex = -1;
    let viewerCamera = null;
    let viewerControls = null;
    let viewerApplyJupiterViewMode = null;
    let viewerSyncSelectionHalo = null;
    let activeMoonViewerFeature = null;
    let moonMeshMap = null;
    let moonFeatureTypeFilter = "all";
    let activeMoonFeatureTour = null;
    let activeMoonFeatureSearchResults = [];
    let activeMoonFeatureSearchIndex = -1;
    let jupiterSceneGroup = null;
    let spinPaused = false;
    let spinPauseStart = 0;
    let spinOffset = 0;
    let freezeViewActive = false;
    let freezeViewWasPaused = false;
    const spinToggleBtn = document.getElementById("spin-toggle");
    const spinToggleGlyph = document.getElementById("spin-toggle-glyph");
    const freezeViewToggleBtn = document.getElementById("freeze-view-toggle");
    const toolRailDistanceButton = document.getElementById("tool-rail-distance");
    const toolRailAreaButton = document.getElementById("tool-rail-area");
    const toolRailProfileButton = document.getElementById("tool-rail-profile");
    const measureRailActionGroups = [...document.querySelectorAll("[data-measure-actions]")];
    const measureRailExportButtons = [...document.querySelectorAll("[data-measure-export]")];
    let activeMeasurementResultAnchor = null;
    let currentProfilePlotState = null;

    function positionMeasurementResultCard(anchorEl = null) {
      if (!measurementResultCard || measurementResultCard.hidden) return;
      if (!anchorEl) {
        measurementResultCard.style.left = "";
        measurementResultCard.style.top = "";
        measurementResultCard.style.right = "1.1rem";
        return;
      }
      const rect = anchorEl.getBoundingClientRect();
      const cardRect = measurementResultCard.getBoundingClientRect();
      const gap = 12;
      const left = Math.max(12, rect.left - cardRect.width - gap);
      const top = Math.max(12, Math.min(
        window.innerHeight - cardRect.height - 12,
        rect.top + (rect.height * 0.5) - (cardRect.height * 0.5),
      ));
      measurementResultCard.style.right = "auto";
      measurementResultCard.style.left = `${left}px`;
      measurementResultCard.style.top = `${top}px`;
    }

    function hideMeasurementResultCard() {
      activeMeasurementResultAnchor = null;
      if (measurementResultCard) {
        measurementResultCard.hidden = true;
        measurementResultCard.style.left = "";
        measurementResultCard.style.top = "";
        measurementResultCard.style.right = "";
      }
      if (measurementResultTitle) measurementResultTitle.textContent = "Measurement";
      if (measurementResultBody) measurementResultBody.innerHTML = "";
    }

    function showMeasurementResultCard(title, bodyHtml, anchorEl = null) {
      if (!measurementResultCard || !measurementResultBody) return;
      activeMeasurementResultAnchor = anchorEl || null;
      if (measurementResultTitle) measurementResultTitle.textContent = title || "Measurement";
      measurementResultBody.innerHTML = bodyHtml || "";
      measurementResultCard.hidden = false;
      requestAnimationFrame(() => positionMeasurementResultCard(activeMeasurementResultAnchor));
    }

    function exportCurrentProfilePng() {
      if (!profileModalCanvas || !currentProfilePlotState?.samples?.length) return;
      const baseName = String(currentProfilePlotState.title || "jupiter_elevation_profile")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "jupiter_elevation_profile";
      const link = document.createElement("a");
      link.href = profileModalCanvas.toDataURL("image/png");
      link.download = `${baseName}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    function hideProfileModal() {
      if (profileModal) profileModal.hidden = true;
    }

    function showProfileModal(title, summary, samples) {
      if (!profileModal || !profileModalCanvas) return;
      if (profileModalTitle) profileModalTitle.textContent = title || "Elevation Profile";
      if (profileModalSummary) profileModalSummary.textContent = summary || "Distance and elevation profile.";
      currentProfilePlotState = {
        title: title || "Elevation Profile",
        summary: summary || "Distance and elevation profile.",
        samples: Array.isArray(samples) ? samples.map((sample) => ({ ...sample })) : [],
      };
      drawProfile(profileModalCanvas, samples);
      profileModal.hidden = false;
    }
    function syncSpinToggleBtn() {
      if (!spinToggleBtn) return;
      const glyph = spinPaused ? "▶" : "⏸";
      if (spinToggleGlyph) {
        spinToggleGlyph.textContent = glyph;
      } else {
        spinToggleBtn.textContent = glyph;
      }
      if (spinPaused) {
        spinToggleBtn.title = "Resume rotation";
        spinToggleBtn.setAttribute("aria-label", "Resume rotation");
        spinToggleBtn.classList.add("is-paused");
      } else {
        spinToggleBtn.title = "Pause rotation";
        spinToggleBtn.setAttribute("aria-label", "Pause rotation");
        spinToggleBtn.classList.remove("is-paused");
      }
    }
    function getSpinTime() {
      return spinPaused ? (spinPauseStart - spinOffset) : (performance.now() - spinOffset);
    }
    function pauseSpin() {
      if (!spinPaused) {
        spinPaused = true;
        spinPauseStart = performance.now();
        syncSpinToggleBtn();
      }
    }
    function resumeSpin() {
      if (spinPaused) {
        spinOffset += performance.now() - spinPauseStart;
        spinPaused = false;
        syncSpinToggleBtn();
      }
    }
    if (spinToggleBtn) {
      spinToggleBtn.addEventListener("click", () => {
        if (spinPaused) { resumeSpin(); } else { pauseSpin(); }
      });
    }
    function applyFreezeViewState() {
      if (viewerControls) {
        viewerControls.enabled = !freezeViewActive;
        viewerControls.enableRotate = !freezeViewActive;
        viewerControls.enableZoom = !freezeViewActive;
        viewerControls.enablePan = false;
      }
      if (freezeViewToggleBtn) {
        freezeViewToggleBtn.classList.toggle("is-active", freezeViewActive);
        freezeViewToggleBtn.title = freezeViewActive ? "Unfreeze view" : "Freeze view";
        freezeViewToggleBtn.setAttribute("aria-label", freezeViewActive ? "Unfreeze view" : "Freeze view");
      }
    }
    if (freezeViewToggleBtn) {
      freezeViewToggleBtn.addEventListener("click", () => {
        if (!freezeViewActive) {
          freezeViewWasPaused = spinPaused;
          freezeViewActive = true;
          pauseSpin();
        } else {
          freezeViewActive = false;
          if (!freezeViewWasPaused) {
            resumeSpin();
          }
        }
        applyFreezeViewState();
      });
    }
    document.addEventListener("keydown", (event) => {
      if (event.code !== "Space") { return; }
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") { return; }
      event.preventDefault();
      if (spinPaused) { resumeSpin(); } else { pauseSpin(); }
    });
    const DEFAULT_CONTROL_MIN_DISTANCE = 4.5;
    const DEFAULT_CONTROL_MAX_DISTANCE = 80;
    const DEFAULT_CAMERA_POSITION = Object.freeze({ x: -6.6, y: 3.4, z: 17 });
    // Moons whose texture has lon=0° (prime meridian / sub-Jupiter) at the IMAGE CENTER rather
    // than the left edge. All feature coordinates are stored in a unified left-edge CRS
    // (lon=0° = left edge of the image) so no per-feature lon correction is needed.
    // The only effect of this set is the tidal-lock rotation: π−angle instead of −angle,
    // which places the texture center (local +X, sub-Jupiter face) toward Jupiter.
    const TEXTURE_CENTERED_MOONS = new Set(["Ganymede", "Callisto"]);
    // Moons whose texture has east running right-to-left (mirrored); store lon_W, display is identity.
    const WEST_POSITIVE_TEXTURE_MOONS = new Set([]);
    // Real sidereal periods (days). Negative = retrograde (Phoebe).
    const MOON_PERIODS_DAYS = {
      "Io": 1.7692, "Europa": 3.5512, "Ganymede": 7.1549, "Callisto": 16.6890,
    };
    // Self-rotation periods (days) for moons that are NOT tidally locked.
    // Hyperion tumbles chaotically (~13 d nominal); Phoebe rotates in 0.38638 d (9.273 h).
    const MOON_SELF_ROT_DAYS = {};
    // Globe completes one rotation every 600,000 ms (10 min).
    // Jupiter's real sidereal day: 10 h 33 m 38 s = 10.5606 h (IAU).
    const _PLANET_DISPLAY_PERIOD_MS = 600000;
    const _PLANET_ROT_REAL_MS = 9.9250 * 3600000; // System III sidereal day
    const _MOON_SPEED_FACTOR = _PLANET_ROT_REAL_MS / _PLANET_DISPLAY_PERIOD_MS;

    // Convert stored longitude back to IAU west-positive for display.
    // WEST_POSITIVE_TEXTURE_MOONS (Hyperion): stored = lon_W, display is identity.
    // TEXTURE_CENTERED_MOONS (Tethys, Titan): stored lon=0 at IAU 180°E → lon_W = (540−stored)%360.
    // Standard moons: stored = lon_E → lon_W = (360−stored)%360.
    function moonLonToW(lonStored, moonName) {
      if (WEST_POSITIVE_TEXTURE_MOONS.has(moonName)) return lonStored % 360;
      if (TEXTURE_CENTERED_MOONS.has(moonName)) return ((540 - lonStored) % 360);
      return ((360 - lonStored) % 360);
    }

    const MOON_VIEWER_TEXTURES = {
      Io:       "assets/io_color_map.jpg",
      Europa:   "assets/europa_color_map.jpg",
      Ganymede: "assets/ganymede_color_map.jpg",
      Callisto: "assets/callisto_color_map.jpg",
    };
    let currentMetadataState = null;
    let activeCutClipPlane = null;
    const MARS_MEAN_RADIUS_KM = 58232.0;
    const JUPITER_MEAN_RADIUS_KM = MARS_MEAN_RADIUS_KM; // 69911 km
    let activeCameraFlight = null;
    const jupiterViewModeSelect = document.getElementById("jupiter-view-mode");
    function formatScaleDistance(valueKm) {
      if (!Number.isFinite(valueKm) || valueKm <= 0) return "-";
      if (valueKm >= 1000000) return `${(valueKm / 1000000).toFixed(valueKm >= 10000000 ? 0 : 1)}M km`;
      if (valueKm >= 1000) return `${Math.round(valueKm / 1000).toLocaleString()}k km`;
      return `${Math.round(valueKm).toLocaleString()} km`;
    }
    function formatScaleDistanceValue(distanceMeters, totalDistanceMeters) {
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0 || !Number.isFinite(totalDistanceMeters) || totalDistanceMeters <= 0) return "—";
      if (totalDistanceMeters >= 1000) {
        const valueKm = distanceMeters / 1000;
        return Math.abs(valueKm - Math.round(valueKm)) < 1e-9
          ? `${Math.round(valueKm)}`
          : valueKm.toFixed(1).replace(/\.0$/, "");
      }
      return distanceMeters >= 10 ? `${Math.round(distanceMeters)}` : distanceMeters.toFixed(1).replace(/\.0$/, "");
    }
    function formatScaleDistanceTerminal(distanceMeters) {
      if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return "—";
      if (distanceMeters >= 1000) {
        const km = distanceMeters / 1000;
        const formatted = Math.abs(km - Math.round(km)) < 1e-9 ? `${Math.round(km)}` : km.toFixed(1).replace(/\.0$/, "");
        return `${formatted} km`;
      }
      const formatted = distanceMeters >= 10 ? `${Math.round(distanceMeters)}` : distanceMeters.toFixed(1).replace(/\.0$/, "");
      return `${formatted} m`;
    }
    function chooseNiceScaleDistance(metersPerPixel, targetPixelWidth = 168) {
      if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
      const roughDistance = metersPerPixel * Math.max(16, targetPixelWidth);
      const exponent = Math.floor(Math.log10(roughDistance));
      const magnitude = 10 ** exponent;
      const normalized = roughDistance / magnitude;
      let niceNormalized = 1;
      if (normalized >= 7.5) niceNormalized = 10;
      else if (normalized >= 3.5) niceNormalized = 5;
      else if (normalized >= 1.5) niceNormalized = 2;
      return niceNormalized * magnitude;
    }
    function chooseScaleLabelScheme(totalDistanceMeters) {
      if (!Number.isFinite(totalDistanceMeters) || totalDistanceMeters <= 0) {
        return [
          { position: 0, label: "0" },
          { position: 1, label: "—" },
        ];
      }
      const quarter = totalDistanceMeters / 4;
      const half = totalDistanceMeters / 2;
      if (totalDistanceMeters >= 1000) {
        return [
          { position: 0, label: "0" },
          { position: 0.25, label: formatScaleDistanceValue(quarter, totalDistanceMeters) },
          { position: 0.5, label: formatScaleDistanceValue(half, totalDistanceMeters) },
          { position: 1, label: formatScaleDistanceTerminal(totalDistanceMeters) },
        ];
      }
      return [
        { position: 0, label: "0" },
        { position: 0.25, label: formatScaleDistanceValue(quarter, totalDistanceMeters) },
        { position: 0.5, label: formatScaleDistanceValue(half, totalDistanceMeters) },
        { position: 0.75, label: formatScaleDistanceValue((totalDistanceMeters * 3) / 4, totalDistanceMeters) },
        { position: 1, label: formatScaleDistanceTerminal(totalDistanceMeters) },
      ];
    }
    function estimateScaleLabelLayoutWidth(scheme) {
      if (!Array.isArray(scheme) || scheme.length === 0) return 96;
      const labelWidthAt = (spec) => {
        const text = String(spec?.label ?? "");
        if (!text) return 0;
        return Math.max(18, (text.length * 8.2) + 8);
      };
      let required = 96;
      for (let i = 0; i < scheme.length; i += 1) {
        const current = scheme[i];
        const currentWidth = labelWidthAt(current);
        for (let j = i + 1; j < scheme.length; j += 1) {
          const next = scheme[j];
          const delta = Math.max(0.05, next.position - current.position);
          const pairWidth = (currentWidth * 0.5) + (labelWidthAt(next) * 0.5) + 10;
          required = Math.max(required, pairWidth / delta);
        }
      }
      return required;
    }
    function resolveScaleBarWidthPx() {
      const track = scaleReadout?.querySelector(".scale-bar-track");
      if (track) {
        const measuredWidth = track.getBoundingClientRect().width;
        if (Number.isFinite(measuredWidth) && measuredWidth > 0) return measuredWidth;
      }
      return 168;
    }
    function chooseFittedScaleLabelScheme(totalDistanceMeters, maxWidthPx) {
      const primaryScheme = chooseScaleLabelScheme(totalDistanceMeters);
      if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) return primaryScheme;
      if (estimateScaleLabelLayoutWidth(primaryScheme) <= maxWidthPx) return primaryScheme;
      const simplifiedScheme = primaryScheme.filter((spec) => spec && (spec.position <= 0 || spec.position >= 1 || Math.abs(spec.position - 0.5) < 1e-6));
      if (estimateScaleLabelLayoutWidth(simplifiedScheme) <= maxWidthPx) return simplifiedScheme;
      return [
        { position: 0, label: "0" },
        { position: 1, label: formatScaleDistanceTerminal(totalDistanceMeters) },
      ];
    }
    function updateScaleReadout(camera, renderer, controls) {
      if (!scaleReadout || !camera || !renderer) return;
      const viewportWidth = Math.max(1, renderer.domElement.clientWidth || window.innerWidth || 1);
      const target = controls?.target || new THREE.Vector3();
      const distanceToTarget = Math.max(0.01, camera.position.distanceTo(target));
      const viewportHeight = Math.max(1, renderer.domElement.clientHeight || window.innerHeight || 1);
      const worldHeight = 2 * distanceToTarget * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      const scaleBarPixels = resolveScaleBarWidthPx();
      const worldBar = worldHeight * (scaleBarPixels / viewportHeight);
      let kmPerWorldUnit = JUPITER_MEAN_RADIUS_KM / JUPITER_SCENE_RADIUS;
      if (activeMoonViewerFeature) {
        const _moonKm = Number(String(activeMoonViewerFeature.mean_radius_km || "").replace(/[^0-9.]/g, ""));
        const _moonWorld = Number(activeMoonViewerFeature.moon_radius || 0.1);
        if (Number.isFinite(_moonKm) && _moonKm > 0 && _moonWorld > 0) kmPerWorldUnit = _moonKm / _moonWorld;
      }
      const metersPerPixel = (worldBar * kmPerWorldUnit * 1000) / Math.max(scaleBarPixels, 1);
      const niceScaleDistance = chooseNiceScaleDistance(metersPerPixel, scaleBarPixels);
      if (Number.isFinite(niceScaleDistance)) window.__lastScaleBarMeters = niceScaleDistance;
      const primaryScheme = chooseScaleLabelScheme(niceScaleDistance);
      const preferredWidth = Math.min(
        Math.max(132, Math.ceil(estimateScaleLabelLayoutWidth(primaryScheme))),
        Math.floor(viewportWidth * 0.34),
      );
      scaleReadout.style.setProperty("--scale-bar-width", `${preferredWidth}px`);
      const fittedWidth = resolveScaleBarWidthPx();
      const scheme = chooseFittedScaleLabelScheme(niceScaleDistance, fittedWidth);
      const labelNodes = [scaleLabel0, scaleLabel1, scaleLabel2, scaleLabel3, scaleLabel4, scaleLabel5];
      for (let i = 0; i < labelNodes.length; i += 1) {
        const node = labelNodes[i];
        if (!node) continue;
        const spec = scheme[i];
        if (!spec) {
          node.textContent = "";
          node.style.left = "0%";
          node.style.transform = "translateX(-50%)";
          continue;
        }
        node.textContent = spec.label;
        node.style.left = `${spec.position * 100}%`;
        node.style.transform = spec.position <= 0 ? "none" : spec.position >= 1 ? "translateX(-100%)" : "translateX(-50%)";
      }
      scaleReadout.hidden = false;
    }

    function formatPressureGPa(pGPa) {
      const value = Math.max(0, Number(pGPa) || 0);
      if (value > 0 && value < 0.01) return `${value.toExponential(2)} GPa`;
      if (value >= 1000) return `${Math.round(value).toLocaleString()} GPa`;
      if (value >= 100) return `${value.toFixed(0)} GPa`;
      if (value >= 10) return `${value.toFixed(1)} GPa`;
      return `${value.toFixed(2)} GPa`;
    }
    const _locatorCtx = hemisphereLocatorCanvas?.getContext("2d") ?? null;
    const _locatorCameraLocal = new THREE.Vector3();
    let _locatorLatLon = { lat: 0, lon: 0 };
    let _locatorDrawnLatLon = { lat: NaN, lon: NaN };

    function drawHemisphereLocator(latDeg, lonDeg) {
      if (!_locatorCtx || !hemisphereLocatorCanvas) return;
      const ctx = _locatorCtx;
      const width = hemisphereLocatorCanvas.width;
      const height = hemisphereLocatorCanvas.height;
      const centerX = width * 0.5;
      const centerY = height * 0.5;
      const radius = Math.min(width, height) * 0.39;
      const lonRad = THREE.MathUtils.degToRad(lonDeg || 0);
      const sinTilt = Math.sin(THREE.MathUtils.degToRad(22));
      const cosTilt = Math.cos(THREE.MathUtils.degToRad(22));
      const project = (lat, lon) => {
        const phi = THREE.MathUtils.degToRad(lat);
        const lambda = THREE.MathUtils.degToRad(lon) - lonRad;
        const x = Math.cos(phi) * Math.sin(lambda);
        const y0 = Math.sin(phi);
        const z0 = Math.cos(phi) * Math.cos(lambda);
        const y = y0 * cosTilt - z0 * sinTilt;
        const z = y0 * sinTilt + z0 * cosTilt;
        return { x: centerX + x * radius, y: centerY - y * radius, visible: z >= 0 };
      };
      ctx.clearRect(0, 0, width, height);
      const globeFill = ctx.createRadialGradient(centerX - radius * 0.28, centerY - radius * 0.32, radius * 0.18, centerX, centerY, radius);
      globeFill.addColorStop(0, "rgba(255,255,255,0.03)");
      globeFill.addColorStop(0.55, "rgba(255,255,255,0.012)");
      globeFill.addColorStop(1, "rgba(255,255,255,0.005)");
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = globeFill;
      ctx.fill();
      const drawPolyline = (points, strokeStyle, lineWidth = 1, alpha = 1) => {
        let drawing = false;
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        for (const point of points) {
          if (!point.visible) { drawing = false; continue; }
          if (!drawing) { ctx.moveTo(point.x, point.y); drawing = true; }
          else { ctx.lineTo(point.x, point.y); }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      };
      for (let lat = -60; lat <= 60; lat += 30) {
        const pts = [];
        for (let lon = -180; lon <= 180; lon += 4) pts.push(project(lat, lon));
        drawPolyline(pts, "rgba(255,255,255,0.26)");
      }
      for (let lon = -150; lon <= 180; lon += 30) {
        const pts = [];
        for (let lat = -90; lat <= 90; lat += 4) pts.push(project(lat, lon));
        drawPolyline(pts, "rgba(255,255,255,0.18)");
      }
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 1;
      ctx.stroke();
      const marker = project(latDeg, lonDeg);
      if (marker.visible) {
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.98)";
        ctx.shadowColor = "rgba(255,255,255,0.42)";
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(111,217,232,0.78)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    function updateCenterReadout(camera, globe, marsGroup) {
      if (!camera) return;
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction).negate();
      // In moon-viewer mode convert the world-space direction to the moon's body-fixed frame
      // using the moon mesh's world transform. This correctly accounts for the orbital position,
      // tidal-locking rotation, and marsGroup's axial tilt and scale.
      if (activeMoonViewerFeature) {
        const moonMesh = moonMeshMap ? moonMeshMap.get(activeMoonViewerFeature.name) : null;
        if (moonMesh) {
          // world → marsGroup local
          direction.transformDirection(marsGroup.matrixWorld.clone().invert());
          // marsGroup local → moon mesh local (removes orbital pos + tidal-locking rotation.y)
          direction.transformDirection(moonMesh.matrix.clone().invert());
          // vectorToLatLon on the mesh-local direction gives lon in the texture's left-edge CRS.
        }
      }
      const latLon = vectorToLatLon(direction);
      if (hemisphereLocatorReadout) {
        hemisphereLocatorReadout.textContent = `Center ${latLon.lat.toFixed(1)}°, ${moonLonToW(latLon.lon, activeMoonViewerFeature?.name || "").toFixed(1)}°W`;
      }
      if (
        !Number.isFinite(_locatorDrawnLatLon.lat) ||
        Math.abs(_locatorDrawnLatLon.lat - latLon.lat) > 0.15 ||
        Math.abs(_locatorDrawnLatLon.lon - latLon.lon) > 0.15
      ) {
        drawHemisphereLocator(latLon.lat, latLon.lon);
        _locatorDrawnLatLon = { ...latLon };
      }
    }
    function configureJupiterUi() {
      if (brandLogo) {
        brandLogo.src = "../../../assets/jupiter_icon.png";
      }
      terrainScale.value = "0";
      terrainScale.disabled = true;
      const basemapSection = baseLayerSelect ? baseLayerSelect.closest(".control-section") : null;
      if (basemapSection) {
        const title = basemapSection.querySelector(".section-title");
        const summary = basemapSection.querySelector(".section-body .section-summary-copy");
        const copy = basemapSection.querySelector(".compact-copy");
        if (title) {
          const titleLabel = title.querySelector(".section-title-row span:last-child");
          if (titleLabel) {
            titleLabel.textContent = "Basemap";
          } else {
            title.textContent = "Basemap";
          }
        }
        if (summary) summary.textContent = "Body texture and derived atmosphere layers.";
        if (copy) copy.textContent = "Use this group for Jupiter's body texture and derived atmospheric analysis layers.";
      }
      const terrainRow = terrainScale ? terrainScale.closest(".row") : null;
      if (terrainRow) terrainRow.style.display = "none";
      const geologySection = geologyToggle ? geologyToggle.closest(".control-section") : null;
      if (geologySection) {
        const geologyTitle = geologySection.querySelector(".section-title");
        const geologySummary = geologySection.querySelector(".section-toggle-main .section-summary-copy");
        if (geologyTitle) geologyTitle.textContent = "Remove Atmosphere";
        if (geologySummary) geologySummary.textContent = "Hide Jupiter's upper atmospheric shells in core view.";
        geologyOpacity.closest(".row").style.display = "none";
        geologyContactsToggle.closest(".row").style.display = "none";
        geologyStructuresToggle.closest(".row").style.display = "none";
        mineralSelect.closest(".row").style.display = "none";
        mineralOpacity.closest(".row").style.display = "none";
        const summaryBlocks = geologySection.querySelectorAll(".section-summary-copy.is-left");
        if (summaryBlocks[0]) summaryBlocks[0].textContent = "Core cutaway";
        if (summaryBlocks[1]) summaryBlocks[1].style.display = "none";
        const compactCopy = geologySection.querySelector(".compact-copy");
        if (compactCopy) compactCopy.textContent = "Remove the upper atmosphere and surface maps in both exterior and core views, while keeping Jupiter\'s deeper interior and rings visible.";
        geologyToggle.checked = false;
        geologyMasterToggle.checked = false;
      }
      [seaToggle, regionMaskSelect].forEach((node) => {
        const section = node ? node.closest(".control-section") : null;
        if (section) section.style.display = "none";
      });
      if (seismicToggle) {
        seismicToggle.checked = false;
        seismicToggle.disabled = true;
      }
      if (jupiterViewModeSelect) jupiterViewModeSelect.value = "tilted";
    }
    configureJupiterUi();
    const REGION_MASK_DEFS = {
      "volcanic-provinces": [
        { lat: 7, lon: 247, radiusDeg: 28, color: "rgba(255,96,76,0.78)" },
        { lat: 24, lon: 147, radiusDeg: 16, color: "rgba(255,112,82,0.78)" },
        { lat: 9, lon: 67, radiusDeg: 13, color: "rgba(255,126,88,0.78)" },
      ],
      basins: [
        { lat: -42.4, lon: 70.5, radiusDeg: 18, color: "rgba(84,166,255,0.76)" },
        { lat: 13.9, lon: 88.4, radiusDeg: 12, color: "rgba(104,186,255,0.76)" },
        { lat: 46.7, lon: 117.5, radiusDeg: 18, color: "rgba(84,166,255,0.76)" },
        { lat: -49.8, lon: 316.7, radiusDeg: 14, color: "rgba(104,186,255,0.76)" },
      ],
    };

    const CORE_LAYER_DATA = [
      {
        id: "outer-atmosphere",
        name: "Outer Atmosphere",
        type: "Gas H, He with CH₄, NH₃, H₂O traces",
        description: "Jupiter's outermost visible shell: ammonia clouds, haze layers, zonal banding, and storm systems at the top of the deep hydrogen-helium envelope.",
        depth: "Cloud tops through the upper troposphere",
        composition: "Hydrogen and helium gas with ammonia ice, ammonium hydrosulfide, water-cloud layers, and photochemical haze.",
        temperature: "~80–140 K near the visible cloud deck",
        labelX: -1.60, labelY: 3.20,
        anchorY: 3.12,
      },
      {
        id: "inner-atmosphere",
        name: "Inner Atmosphere",
        type: "Liquid H and He",
        description: "A layer of liquid hydrogen-helium where pressure rises steeply and the gas transitions from compressible to fluid behaviour.",
        depth: "Below the cloud deck to the liquid–metallic transition",
        composition: "Mostly liquid hydrogen and helium.",
        temperature: "Rises from hundreds to thousands of kelvin with depth",
        labelX: -1.90, labelY: 3.05,
        anchorY: 2.86,
      },
      {
        id: "fluid-transition",
        name: "Fluid Transition",
        type: "H and He transitioning to metallic form",
        description: "A gradual transition zone where hydrogen shifts from a molecular to a metallic conducting state as pressure increases with depth.",
        depth: "Between the liquid hydrogen envelope and fully metallic interior",
        composition: "Hydrogen and helium in a mixed molecular-metallic state under extreme pressure.",
        temperature: "Several thousand kelvin",
        labelX: -2.20, labelY: 2.78,
        anchorY: 2.62,
      },
      {
        id: "fluid-layer",
        name: "Metallic Liquid Hydrogen Outer Core",
        type: "H and He in metallic form",
        description: "The dominant interior layer. Metallic hydrogen is electrically conducting and drives Jupiter's powerful magnetic field. It makes up the vast bulk of Jupiter's volume.",
        depth: "From ~20,000 km depth to the central core",
        composition: "Metallic hydrogen and helium under immense pressure.",
        temperature: "Several thousand to tens of thousands of kelvin",
        labelX: -2.10, labelY: 1.50,
        anchorY: 1.47,
      },
      {
        id: "inner-core",
        name: "Inner Core",
        type: "Solid rock, Fe, and frozen H₂O",
        description: "Jupiter's central core of silicate rock, iron, and frozen water under enormous pressure. Current models suggest it may be partially diffuse rather than sharply bounded.",
        depth: "Central region",
        composition: "Silicates, iron, and water ice mixed under deep-interior conditions.",
        temperature: "Estimated 20,000–30,000 K at the center",
        labelX: -0.85, labelY: 0.25,
        anchorY: 0,
      },
    ];

    function setStatus(message, isError = false) {
      statusNode.textContent = message;
      statusNode.classList.toggle("is-error", isError);
    }

    function loadTextureSafe(textureLoader, path) {
      if (!path) {
        return Promise.resolve(null);
      }
      return textureLoader.loadAsync(path).catch((error) => {
        console.warn(`Texture load failed for ${path}`, error);
        return null;
      });
    }

    function createCalibratedJupiterRingTexture(baseTexture = null, outerRadiusKm = JUPITER_RING_REFERENCE_KM.mainOuter) {
      const size = 4096;
      const center = (size - 1) / 2;
      const maxRadius = size / 2;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const imageData = ctx.createImageData(size, size);
      const data = imageData.data;
      let basePixels = null;
      let baseWidth = 0;
      let baseHeight = 0;
      if (baseTexture?.image) {
        const baseCanvas = document.createElement("canvas");
        baseWidth = baseTexture.image.width || baseTexture.image.naturalWidth || 0;
        baseHeight = baseTexture.image.height || baseTexture.image.naturalHeight || 0;
        if (baseWidth && baseHeight) {
          baseCanvas.width = baseWidth;
          baseCanvas.height = baseHeight;
          const baseCtx = baseCanvas.getContext("2d", { willReadFrequently: true });
          baseCtx.drawImage(baseTexture.image, 0, 0, baseWidth, baseHeight);
          basePixels = baseCtx.getImageData(0, 0, baseWidth, baseHeight).data;
        }
      }
      const kmToUnit = (km) => km / outerRadiusKm;
      const smoothBand = (r, innerKm, outerKm, edgeKm = 170) => {
        const inner = kmToUnit(innerKm);
        const outer = kmToUnit(outerKm);
        const edge = edgeKm / outerRadiusKm;
        const enter = Math.min(1, Math.max(0, (r - inner) / edge));
        const exit = Math.min(1, Math.max(0, (outer - r) / edge));
        return Math.min(enter, exit);
      };
      const narrowGap = (r, centerKm, widthKm, floor = 0.08) => {
        const centerUnit = kmToUnit(centerKm);
        const halfWidth = Math.max(widthKm / outerRadiusKm / 2, 1.6 / maxRadius);
        const distance = Math.abs(r - centerUnit);
        if (distance >= halfWidth) return 1;
        return floor + (1 - floor) * (distance / halfWidth);
      };
      const sampleBaseColor = (r, angle) => {
        if (!basePixels) return null;
        const bx = Math.max(0, Math.min(baseWidth - 1, Math.round(((Math.cos(angle) * r) * 0.5 + 0.5) * (baseWidth - 1))));
        const by = Math.max(0, Math.min(baseHeight - 1, Math.round(((Math.sin(angle) * r) * 0.5 + 0.5) * (baseHeight - 1))));
        const bi = (by * baseWidth + bx) * 4;
        if (basePixels[bi + 3] < 8) return null;
        return [basePixels[bi], basePixels[bi + 1], basePixels[bi + 2]];
      };

      for (let y = 0; y < size; y += 1) {
        const dy = y - center;
        for (let x = 0; x < size; x += 1) {
          const dx = x - center;
          const r = Math.hypot(dx, dy) / maxRadius;
          const angle = Math.atan2(dy, dx);
          const i = (y * size + x) * 4;
          let alpha = 0;
          let shade = 0;

          if (r >= kmToUnit(JUPITER_RING_REFERENCE_KM.dInner) && r <= 1) {
            const noise =
              0.5
              + 0.25 * Math.sin(r * 980)
              + 0.13 * Math.sin(r * 2740 + 1.7)
              + 0.06 * Math.sin((x * 0.019) + (y * 0.013));

            if (r < kmToUnit(JUPITER_RING_REFERENCE_KM.cInner)) {
              alpha = 0.16 * smoothBand(r, JUPITER_RING_REFERENCE_KM.dInner, JUPITER_RING_REFERENCE_KM.cInner, 260);
              shade = 72 + 28 * noise;
            } else if (r < kmToUnit(JUPITER_RING_REFERENCE_KM.bInner)) {
              alpha = 0.36 * smoothBand(r, JUPITER_RING_REFERENCE_KM.cInner, JUPITER_RING_REFERENCE_KM.bInner, 220);
              shade = 82 + 42 * noise;
            } else if (r < kmToUnit(JUPITER_RING_REFERENCE_KM.cassiniInner)) {
              alpha = 0.9 * smoothBand(r, JUPITER_RING_REFERENCE_KM.bInner, JUPITER_RING_REFERENCE_KM.cassiniInner, 190);
              shade = 150 + 74 * noise;
            } else if (r < kmToUnit(JUPITER_RING_REFERENCE_KM.aInner)) {
              alpha = 0.18 * smoothBand(r, JUPITER_RING_REFERENCE_KM.cassiniInner, JUPITER_RING_REFERENCE_KM.aInner, 120);
              shade = 35 + 28 * noise;
            } else if (r < kmToUnit(JUPITER_RING_REFERENCE_KM.aOuter)) {
              alpha = 0.68 * smoothBand(r, JUPITER_RING_REFERENCE_KM.aInner, JUPITER_RING_REFERENCE_KM.aOuter, 160);
              shade = 126 + 62 * noise;
              alpha *= narrowGap(r, JUPITER_RING_REFERENCE_KM.enckeCenter, 325, 0.025);
              shade *= narrowGap(r, JUPITER_RING_REFERENCE_KM.enckeCenter, 325, 0.18);
              alpha *= narrowGap(r, JUPITER_RING_REFERENCE_KM.keelerCenter, 90, 0.04);
              shade *= narrowGap(r, JUPITER_RING_REFERENCE_KM.keelerCenter, 90, 0.22);
            } else if (r < kmToUnit(JUPITER_RING_REFERENCE_KM.fRing - 450)) {
              alpha = 0.12 * smoothBand(r, JUPITER_RING_REFERENCE_KM.aOuter, JUPITER_RING_REFERENCE_KM.fRing - 450, 140);
              shade = 40 + 28 * noise;
            } else if (r < kmToUnit(JUPITER_RING_REFERENCE_KM.fRing + 650)) {
              alpha = 0.62 * smoothBand(r, JUPITER_RING_REFERENCE_KM.fRing - 450, JUPITER_RING_REFERENCE_KM.fRing + 650, 90);
              shade = 158 + 48 * noise;
            } else {
              alpha = 0.04 * smoothBand(r, JUPITER_RING_REFERENCE_KM.fRing + 650, JUPITER_RING_REFERENCE_KM.mainOuter, 190);
              shade = 50 + 24 * noise;
            }
          }

          const baseColor = sampleBaseColor(r, angle);
          const proceduralColor = [shade * 1.08, shade * 1.02, shade * 0.92];
          const color = baseColor
            ? [
              baseColor[0] * 0.78 + proceduralColor[0] * 0.22,
              baseColor[1] * 0.78 + proceduralColor[1] * 0.22,
              baseColor[2] * 0.78 + proceduralColor[2] * 0.22,
            ]
            : proceduralColor;
          const tintR = Math.max(0, Math.min(255, color[0]));
          const tintG = Math.max(0, Math.min(255, color[1]));
          const tintB = Math.max(0, Math.min(255, color[2]));
          data[i] = tintR;
          data[i + 1] = tintG;
          data[i + 2] = tintB;
          data[i + 3] = Math.max(0, Math.min(255, alpha * 255));
        }
      }

      ctx.putImageData(imageData, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      return texture;
    }

    async function loadJsonSafe(path) {
      if (!path) {
        return null;
      }
      try {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return await response.json();
      } catch (error) {
        console.warn(`JSON load failed for ${path}`, error);
        return null;
      }
    }

    async function loadImageDataSafe(path) {
      if (!path) {
        return null;
      }
      try {
        const image = new Image();
        image.decoding = "async";
        image.src = path;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      } catch (error) {
        console.warn(`Image-data load failed for ${path}`, error);
        return null;
      }
    }

    function describeLayer(layer) {
      if (!layer) {
        return "No active layer metadata available.";
      }
      const parts = [layer.description];
      if (layer.source_page_url) {
        parts.push(`Source page: ${layer.source_page_url}`);
      }
      return parts.join(" ");
    }

    function decodeFeatureId(pixelState, x, y) {
      if (!pixelState || !pixelState.pixels) {
        return 0;
      }
      const clampedX = Math.max(0, Math.min(pixelState.width - 1, x));
      const clampedY = Math.max(0, Math.min(pixelState.height - 1, y));
      const index = ((clampedY * pixelState.width) + clampedX) * 4;
      return (
        pixelState.pixels[index]
        + (pixelState.pixels[index + 1] << 8)
        + (pixelState.pixels[index + 2] << 16)
      );
    }

    function normalizeLongitudeDegrees(lonDegrees) {
      return (((lonDegrees % 360) + 540) % 360) - 180;
    }

    function wrapLongitudeAround(referenceLon, lonDegrees) {
      return referenceLon + normalizeLongitudeDegrees(lonDegrees - referenceLon);
    }

    function pointInRing(lonDegrees, latDegrees, ring) {
      let inside = false;
      if (!Array.isArray(ring) || ring.length < 3) {
        return false;
      }
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const xi = wrapLongitudeAround(lonDegrees, Number(ring[i][0]));
        const yi = Number(ring[i][1]);
        const xj = wrapLongitudeAround(lonDegrees, Number(ring[j][0]));
        const yj = Number(ring[j][1]);
        const intersects = ((yi > latDegrees) !== (yj > latDegrees))
          && (lonDegrees < (((xj - xi) * (latDegrees - yi)) / ((yj - yi) || 1e-9)) + xi);
        if (intersects) {
          inside = !inside;
        }
      }
      return inside;
    }

    function pointInPolygonFeature(lonDegrees, latDegrees, feature) {
      if (!feature || !Array.isArray(feature.polygons)) {
        return false;
      }
      for (const polygon of feature.polygons) {
        if (!polygon || !Array.isArray(polygon.outer) || !pointInRing(lonDegrees, latDegrees, polygon.outer)) {
          continue;
        }
        const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
        let inHole = false;
        for (const hole of holes) {
          if (pointInRing(lonDegrees, latDegrees, hole)) {
            inHole = true;
            break;
          }
        }
        if (!inHole) {
          return true;
        }
      }
      return false;
    }

    function pointWithinFeatureBounds(lonDegrees, latDegrees, feature) {
      const bounds = feature?.selection_bounds;
      if (!bounds) {
        return true;
      }
      if (latDegrees < Number(bounds.lat_min) || latDegrees > Number(bounds.lat_max)) {
        return false;
      }
      const lonOffset = normalizeLongitudeDegrees(lonDegrees - Number(bounds.lon_center));
      return lonOffset >= Number(bounds.lon_min_offset) && lonOffset <= Number(bounds.lon_max_offset);
    }

    function getGeologyFeatureAtPoint(point, geologyInteractiveState) {
      if (!geologyInteractiveState || !geologyToggle.checked) {
        return null;
      }
      const latLon = vectorToLatLon(point);
      const featureList = geologyInteractiveState.featureList || [];
      const feature = featureList.find((candidate) => (
        pointWithinFeatureBounds(latLon.lon, latLon.lat, candidate)
        && pointInPolygonFeature(latLon.lon, latLon.lat, candidate)
      ));
      if (!feature) {
        return null;
      }
      return {
        ...feature,
        lat: latLon.lat,
        lon: latLon.lon,
      };
    }

    function createGeologyOutlineState(THREERef, geometryState) {
      if (!geometryState || !geometryState.width || !geometryState.height) {
        return null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = geometryState.width;
      canvas.height = geometryState.height;
      const context = canvas.getContext("2d");
      const texture = new THREERef.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      return {
        width: geometryState.width,
        height: geometryState.height,
        canvas,
        context,
        texture,
        featureId: "",
      };
    }

    function traceGeologyRing(context, ring, referenceLon, shiftX, width, height) {
      if (!Array.isArray(ring) || ring.length < 2) {
        return;
      }
      const baseX = (((referenceLon - 180) / 360) * width) + shiftX;
      ring.forEach((pair, index) => {
        const lon = wrapLongitudeAround(referenceLon, Number(pair[0]));
        const lat = Number(pair[1]);
        const x = baseX + (((lon - referenceLon) / 360) * width);
        const y = latToTextureV(lat) * height;
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.closePath();
    }

    function paintSelectedGeologyOutline(outlineState, feature) {
      if (!outlineState) {
        return false;
      }
      const context = outlineState.context;
      context.clearRect(0, 0, outlineState.width, outlineState.height);
      if (!feature || !Array.isArray(feature.polygons) || !feature.polygons.length) {
        outlineState.texture.needsUpdate = true;
        outlineState.featureId = "";
        return false;
      }
      if (outlineState.featureId === String(feature.id || "")) {
        return true;
      }
      const referenceLon = Number(feature.anchor_lon ?? feature.lon ?? 180);
      const shifts = [-outlineState.width, 0, outlineState.width];
      context.lineJoin = "round";
      context.lineCap = "round";
      for (const polygon of feature.polygons) {
        for (const shift of shifts) {
          context.beginPath();
          traceGeologyRing(context, polygon.outer, referenceLon, shift, outlineState.width, outlineState.height);
          for (const hole of polygon.holes || []) {
            traceGeologyRing(context, hole, referenceLon, shift, outlineState.width, outlineState.height);
          }
          context.fillStyle = "rgba(255, 196, 64, 0.22)";
          context.fill("evenodd");
          context.strokeStyle = "rgba(255, 232, 162, 0.96)";
          context.lineWidth = 5;
          context.stroke();
          context.strokeStyle = "rgba(255, 149, 62, 0.94)";
          context.lineWidth = 2.4;
          context.stroke();
        }
      }
      outlineState.texture.needsUpdate = true;
      outlineState.featureId = String(feature.id || "");
      return true;
    }

    function buildGeologyVectorLayer(THREERef, entries, radius, elevationSampler, elevationCache, getTerrainRelief, lift, defaultOpacity, renderOrder = 108) {
      const group = new THREE.Group();
      const interactiveObjects = [];
      const materialCache = new Map();

      const interpolateWrappedLon = (startLon, endLon, t) => {
        let delta = endLon - startLon;
        if (delta > 180) {
          delta -= 360;
        } else if (delta < -180) {
          delta += 360;
        }
        return ((startLon + (delta * t)) % 360 + 360) % 360;
      };

      const densifySegment = (segment, maxStepDegrees = 0.3) => {
        if (!Array.isArray(segment) || segment.length < 2) {
          return [];
        }
        const densified = [];
        for (let index = 0; index < segment.length - 1; index += 1) {
          const [startLonRaw, startLatRaw] = segment[index];
          const [endLonRaw, endLatRaw] = segment[index + 1];
          const startLon = Number(startLonRaw);
          const startLat = Number(startLatRaw);
          const endLon = Number(endLonRaw);
          const endLat = Number(endLatRaw);
          const lonDeltaWrapped = Math.abs((((endLon - startLon) + 540) % 360) - 180);
          const latDelta = Math.abs(endLat - startLat);
          const steps = Math.max(1, Math.ceil(Math.max(lonDeltaWrapped, latDelta) / maxStepDegrees));
          if (index === 0) {
            densified.push([startLon, startLat]);
          }
          for (let step = 1; step <= steps; step += 1) {
            const t = step / steps;
            densified.push([
              interpolateWrappedLon(startLon, endLon, t),
              startLat + ((endLat - startLat) * t),
            ]);
          }
        }
        return densified;
      };

      const segmentToReliefPoints = (segment) => densifySegment(segment).map(([lon, lat]) => (
        getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, Number(lat), Number(lon), lift)
      ));

      const getMaterial = (color, opacity) => {
        const key = `${color}|${opacity}`;
        if (!materialCache.has(key)) {
          materialCache.set(
            key,
            new THREERef.LineBasicMaterial({
              color,
              transparent: true,
              opacity,
              depthWrite: false,
              depthTest: true,
              clipping: true,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
            }),
          );
        }
        return materialCache.get(key);
      };

      for (const entry of Array.isArray(entries) ? entries : []) {
        const segments = Array.isArray(entry.segments) ? entry.segments : [];
        for (const segment of segments) {
          if (!Array.isArray(segment) || segment.length < 2) {
            continue;
          }
          const points = segmentToReliefPoints(segment);
          const line = new THREERef.Line(
            new THREERef.BufferGeometry().setFromPoints(points),
            getMaterial(entry.color || "#ffffff", entry.opacity || defaultOpacity),
          );
          line.renderOrder = renderOrder;
          line.userData.feature = entry;
          line.userData.segment = segment;
          group.add(line);
          interactiveObjects.push(line);
        }
      }

      function rebuild() {
        for (const line of interactiveObjects) {
          const segment = line.userData.segment;
          if (!Array.isArray(segment) || segment.length < 2) {
            continue;
          }
          const points = segmentToReliefPoints(segment);
          line.geometry.dispose();
          line.geometry = new THREERef.BufferGeometry().setFromPoints(points);
        }
      }

      function setClippingPlanes(planes) {
        for (const material of materialCache.values()) {
          material.clippingPlanes = planes;
          material.needsUpdate = true;
        }
      }

      return { group, interactiveObjects, available: interactiveObjects.length > 0, rebuild, setClippingPlanes };
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function normalizeSeaLevelMeters(levelMeters) {
      const minMeters = Number(manifest.elevation?.min_m ?? -8200);
      const reliefMeters = Math.max(Number(manifest.elevation?.relief_m ?? 1), 1);
      return clamp((levelMeters - minMeters) / reliefMeters, 0, 1);
    }

    function createSeaOverlayTextureState(elevationTexture) {
      if (!elevationTexture || !elevationTexture.image) {
        return null;
      }
      const sourceCanvas = document.createElement("canvas");
      sourceCanvas.width = elevationTexture.image.width;
      sourceCanvas.height = elevationTexture.image.height;
      const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
      sourceContext.drawImage(elevationTexture.image, 0, 0);
      const sourcePixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data;

      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.width = sourceCanvas.width;
      overlayCanvas.height = sourceCanvas.height;
      const overlayContext = overlayCanvas.getContext("2d");
      const overlayImage = overlayContext.createImageData(overlayCanvas.width, overlayCanvas.height);
      const texture = new THREE.CanvasTexture(overlayCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;

      return {
        sourcePixels,
        overlayCanvas,
        overlayContext,
        overlayImage,
        texture,
        minMeters: Number(manifest.elevation?.min_m ?? -8200),
        reliefMeters: Math.max(Number(manifest.elevation?.relief_m ?? 1), 1),
      };
    }

    function updateSeaOverlayTexture(state, seaLevelMeters) {
      if (!state) {
        return;
      }
      const threshold = normalizeSeaLevelMeters(seaLevelMeters);
      const output = state.overlayImage.data;
      const source = state.sourcePixels;
      const coastalBand = 0.012;
      const shallowBandMeters = 400;
      const deepBandMeters = 3200;
      for (let index = 0; index < source.length; index += 4) {
        const elevationNorm = source[index] / 255;
        if (elevationNorm > threshold) {
          output[index] = 0;
          output[index + 1] = 0;
          output[index + 2] = 0;
          output[index + 3] = 0;
          continue;
        }
        const elevationMeters = state.minMeters + (elevationNorm * state.reliefMeters);
        const depthMeters = Math.max(0, seaLevelMeters - elevationMeters);
        const depthRatio = clamp(depthMeters / deepBandMeters, 0, 1);
        const shallowRatio = clamp(depthMeters / shallowBandMeters, 0, 1);
        const shorelineMix = clamp((coastalBand - (threshold - elevationNorm)) / coastalBand, 0, 1);
        const shelfMix = 1 - shallowRatio;
        const red = Math.round(
          (18 * depthRatio) +
          (42 * shelfMix) +
          (86 * shorelineMix)
        );
        const green = Math.round(
          62 +
          (72 * shelfMix) +
          (54 * shorelineMix) -
          (28 * depthRatio)
        );
        const blue = Math.round(
          128 +
          (80 * shelfMix) +
          (82 * depthRatio) +
          (36 * shorelineMix)
        );
        const alpha = Math.round(
          82 +
          (62 * depthRatio) +
          (36 * shallowRatio) +
          (48 * shorelineMix)
        );
        output[index] = red;
        output[index + 1] = green;
        output[index + 2] = blue;
        output[index + 3] = alpha;
      }
      state.overlayContext.putImageData(state.overlayImage, 0, 0);
      state.texture.needsUpdate = true;
    }

    function createElevationSamplerState(elevationTexture) {
      if (!elevationTexture || !elevationTexture.image) {
        return null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = elevationTexture.image.width;
      canvas.height = elevationTexture.image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(elevationTexture.image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return { canvas, context, pixels, width: canvas.width, height: canvas.height };
    }

    function lonToTextureU(lonDegrees) {
      return (((((lonDegrees - 180) % 360) + 360) % 360) / 360);
    }

    function latToTextureV(latDegrees) {
      return clamp((90 - latDegrees) / 180, 0, 1);
    }

    function sampleElevationNormalized(state, latDegrees, lonDegrees) {
      if (!state) {
        return 0;
      }
      const u = lonToTextureU(lonDegrees);
      const v = latToTextureV(latDegrees);
      const x = u * (state.width - 1);
      const y = v * (state.height - 1);
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(state.width - 1, x0 + 1);
      const y1 = Math.min(state.height - 1, y0 + 1);
      const tx = x - x0;
      const ty = y - y0;
      const sampleAt = (sx, sy) => state.pixels[((sy * state.width) + sx) * 4] / 255;
      const n00 = sampleAt(x0, y0);
      const n10 = sampleAt(x1, y0);
      const n01 = sampleAt(x0, y1);
      const n11 = sampleAt(x1, y1);
      return (
        n00 * (1 - tx) * (1 - ty) +
        n10 * tx * (1 - ty) +
        n01 * (1 - tx) * ty +
        n11 * tx * ty
      );
    }

    function sampleElevationMeters(state, latDegrees, lonDegrees) {
      if (!state) {
        return null;
      }
      const normalized = sampleElevationNormalized(state, latDegrees, lonDegrees);
      const minMeters = Number(manifest.elevation?.min_m ?? -8200);
      const reliefMeters = Number(manifest.elevation?.relief_m ?? 0);
      return minMeters + (normalized * reliefMeters);
    }

    function createColorizedTopographyTexture(elevationSampler) {
      if (!elevationSampler) {
        return null;
      }
      const canvas = document.createElement("canvas");
      canvas.width = elevationSampler.width;
      canvas.height = elevationSampler.height;
      const context = canvas.getContext("2d");
      const imageData = context.createImageData(canvas.width, canvas.height);
      const source = elevationSampler.pixels;
      const output = imageData.data;
      const ramp = [
        { t: 0.0, c: [21, 44, 130] },
        { t: 0.18, c: [41, 118, 198] },
        { t: 0.36, c: [52, 170, 184] },
        { t: 0.5, c: [88, 190, 104] },
        { t: 0.68, c: [188, 188, 92] },
        { t: 0.82, c: [188, 128, 82] },
        { t: 1.0, c: [244, 238, 226] },
      ];
      const lerpChannel = (a, b, t) => Math.round(a + ((b - a) * t));
      for (let i = 0; i < source.length; i += 4) {
        const t = source[i] / 255;
        let lower = ramp[0];
        let upper = ramp[ramp.length - 1];
        for (let j = 1; j < ramp.length; j += 1) {
          if (t <= ramp[j].t) {
            lower = ramp[j - 1];
            upper = ramp[j];
            break;
          }
        }
        const localT = upper.t === lower.t ? 0 : (t - lower.t) / (upper.t - lower.t);
        output[i] = lerpChannel(lower.c[0], upper.c[0], localT);
        output[i + 1] = lerpChannel(lower.c[1], upper.c[1], localT);
        output[i + 2] = lerpChannel(lower.c[2], upper.c[2], localT);
        output[i + 3] = 255;
      }
      context.putImageData(imageData, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      return texture;
    }

    function createRegionMaskTexture(maskId, elevationSampler) {
      const width = elevationSampler ? elevationSampler.width : 2048;
      const height = elevationSampler ? elevationSampler.height : 1024;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, width, height);

      if (maskId === "lowlands" || maskId === "highlands") {
        const source = elevationSampler ? elevationSampler.pixels : null;
        const imageData = context.createImageData(width, height);
        const output = imageData.data;
        const thresholdMeters = -2500;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const index = ((y * width) + x) * 4;
            const normalized = source ? source[index] / 255 : 0;
            const elevationMeters = Number(manifest.elevation?.min_m ?? -8200) + normalized * Number(manifest.elevation?.relief_m ?? 0);
            const matches = maskId === "lowlands" ? elevationMeters <= thresholdMeters : elevationMeters > thresholdMeters;
            if (!matches) {
              continue;
            }
            if (maskId === "lowlands") {
              output[index] = 64; output[index + 1] = 160; output[index + 2] = 255; output[index + 3] = 132;
            } else {
              output[index] = 255; output[index + 1] = 170; output[index + 2] = 82; output[index + 3] = 118;
            }
          }
        }
        context.putImageData(imageData, 0, 0);
      } else if (REGION_MASK_DEFS[maskId]) {
        for (const region of REGION_MASK_DEFS[maskId]) {
          const x = lonToTextureU(region.lon) * width;
          const y = latToTextureV(region.lat) * height;
          const radiusX = (region.radiusDeg / 360) * width;
          const radiusY = (region.radiusDeg / 180) * height;
          const gradient = context.createRadialGradient(x, y, radiusX * 0.2, x, y, radiusX);
          gradient.addColorStop(0, region.color);
          gradient.addColorStop(1, "rgba(0,0,0,0)");
          context.fillStyle = gradient;
          context.beginPath();
          context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
          context.fill();
        }
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
      return texture;
    }

    function vectorToLatLon(point) {
      const p = point.clone().normalize();
      const lat = THREE.MathUtils.radToDeg(Math.asin(p.y));
      const lonScene = THREE.MathUtils.radToDeg(Math.atan2(p.z, -p.x));
      const lon = ((lonScene % 360) + 360) % 360;
      return { lat, lon };
    }

    function greatCircleDistanceKm(a, b) {
      const radiusKm = a.radiusKm || b.radiusKm || MARS_MEAN_RADIUS_KM;
      const aLat = THREE.MathUtils.degToRad(a.lat);
      const bLat = THREE.MathUtils.degToRad(b.lat);
      const dLat = bLat - aLat;
      const dLon = THREE.MathUtils.degToRad(b.lon - a.lon);
      const hav = Math.sin(dLat / 2) ** 2 + Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2;
      return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(hav)));
    }

    function sphericalPolygonAreaKm2(points) {
      if (points.length < 3) {
        return 0;
      }
      const radiusKm = points[0]?.radiusKm || MARS_MEAN_RADIUS_KM;
      const vectors = points.map((point) => latLonToVector3(point.lat, point.lon, 1).normalize());
      let totalAngle = 0;
      for (let i = 0; i < vectors.length; i += 1) {
        const a = vectors[(i - 1 + vectors.length) % vectors.length];
        const b = vectors[i];
        const c = vectors[(i + 1) % vectors.length];
        const ab = a.clone().cross(b).normalize();
        const cb = c.clone().cross(b).normalize();
        totalAngle += Math.acos(clamp(ab.dot(cb), -1, 1));
      }
      const excess = totalAngle - ((vectors.length - 2) * Math.PI);
      return Math.abs(excess) * (radiusKm ** 2);
    }

    function sampleGreatCircleProfile(start, end, elevationSampler, sampleCount = 72) {
      const startVec = latLonToVector3(start.lat, start.lon, 1).normalize();
      const endVec = latLonToVector3(end.lat, end.lon, 1).normalize();
      const angle = Math.acos(clamp(startVec.dot(endVec), -1, 1));
      const samples = [];
      for (let index = 0; index < sampleCount; index += 1) {
        const t = sampleCount === 1 ? 0 : index / (sampleCount - 1);
        let point;
        if (angle < 1e-5) {
          point = startVec.clone();
        } else {
          const sinTotal = Math.sin(angle);
          point = startVec.clone().multiplyScalar(Math.sin((1 - t) * angle) / sinTotal)
            .add(endVec.clone().multiplyScalar(Math.sin(t * angle) / sinTotal))
            .normalize();
        }
        const latLon = vectorToLatLon(point);
        samples.push({
          ...latLon,
          elevation: sampleElevationMeters(elevationSampler, latLon.lat, latLon.lon) || 0,
        });
      }
      return samples;
    }

    function sampleGreatCircleArc(startVec, endVec, radius, minSegments = 32) {
      const start = startVec.clone().normalize();
      const end = endVec.clone().normalize();
      const angle = Math.acos(clamp(start.dot(end), -1, 1));
      const segmentCount = Math.max(minSegments, Math.ceil((angle / Math.PI) * 96));
      const points = [];
      for (let index = 0; index <= segmentCount; index += 1) {
        const t = segmentCount === 0 ? 0 : index / segmentCount;
        let point;
        if (angle < 1e-5) {
          point = start.clone();
        } else {
          const sinTotal = Math.sin(angle);
          point = start.clone().multiplyScalar(Math.sin((1 - t) * angle) / sinTotal)
            .add(end.clone().multiplyScalar(Math.sin(t * angle) / sinTotal))
            .normalize();
        }
        points.push(point.multiplyScalar(radius));
      }
      return points;
    }

    function drawProfile(canvas, samples) {
      const context = canvas.getContext("2d");
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(8, 14, 24, 0.95)";
      context.fillRect(0, 0, width, height);
      if (!samples.length) {
        return;
      }
      const elevations = samples.map((sample) => sample.elevation);
      const min = Math.min(...elevations);
      const max = Math.max(...elevations);
      const relief = Math.max(1, max - min);
      context.strokeStyle = "rgba(86, 210, 232, 0.95)";
      context.lineWidth = 2;
      context.beginPath();
      samples.forEach((sample, index) => {
        const x = (index / (samples.length - 1)) * (width - 16) + 8;
        const y = height - 10 - (((sample.elevation - min) / relief) * (height - 24));
        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.stroke();
    }

    function setTagRow(node, tags) {
      node.innerHTML = "";
      for (const tag of tags.filter(Boolean)) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = tag;
        node.appendChild(chip);
      }
    }

    function inferLayerMeta(layer, context = "base") {
      if (context === "core") {
        return {
          badge: "Schematic",
          help: "Interior cutaway layers are teaching models inferred from geophysics and seismic constraints.",
          tags: ["interior", "schematic", "inferred"],
        };
      }
      if (context === "sea") {
        return {
          badge: "Modeled",
          help: "The paleo-sea overlay is a threshold model applied to the global elevation raster. It is exploratory rather than a confirmed shoreline reconstruction.",
          tags: ["paleo-ocean", "modeled", "elevation-threshold"],
        };
      }
      if (context === "modeled") {
        return {
          badge: "Modeled",
          help: "These masks are derived from elevation thresholds or curated regional envelopes meant for exploration rather than formal cartographic boundaries.",
          tags: ["regional", "modeled", "exploratory"],
        };
      }
      if (context === "seismic") {
        return {
          badge: "Derived",
          help: "Jupiter does not include a Mars-style seismic event overlay in this package.",
          tags: ["placeholder", "disabled"],
        };
      }
      if (!layer) {
        return {
          badge: "Measured",
          help: "No specific layer metadata available.",
          tags: [],
        };
      }
      if (layer.id === "tes-albedo" || layer.id === "tes-thermal-inertia") {
        return {
          badge: "Derived",
          help: "TES basemaps are science products derived from spacecraft observations rather than direct color imagery.",
          tags: ["orbital", "processed", "science-product"],
        };
      }
      if (layer.id === "colorized-topography") {
        return {
          badge: "Derived",
          help: "Colorized topography is generated from the global elevation model to emphasize relief rather than natural surface color.",
          tags: ["topography", "derived", "elevation"],
        };
      }
      if (layer.id === "derived-hillshade") {
        return {
          badge: "Derived",
          help: "Hillshade is generated from the elevation model to emphasize landform illumination and relief texture.",
          tags: ["hillshade", "derived", "elevation"],
        };
      }
      if (layer.id === "derived-slope") {
        return {
          badge: "Derived",
          help: "Slope is generated from the elevation model to emphasize steeper terrain with a warm color ramp.",
          tags: ["slope", "derived", "elevation"],
        };
      }
      if (layer.id && layer.id.startsWith("mineral-")) {
        return {
          badge: "Derived",
          help: "Mineral maps are spectral abundance estimates derived from TES observations and processing assumptions.",
          tags: ["spectral", "TES", "derived"],
        };
      }
      if (layer.id === "sim3292-units") {
        return {
          badge: "Interpretive",
          help: "Geology overlays are interpretive geologic maps based on mapped surface units and structures, not raw measured imagery.",
          tags: ["geology", "interpretive", "mapped-units"],
        };
      }
      return {
        badge: "Measured",
        help: "This basemap is a global observed surface product intended as the main visual context layer.",
        tags: ["basemap", "observed", "surface"],
      };
    }

    function getLayerMeta(context, layer) {
      return inferLayerMeta(layer, context);
    }

    function makeMetadataLink(label, href) {
      return href ? { label, href } : null;
    }

    function buildLegendEntries(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState = null) {
      const selectedGeologyLayer = getSelectedGeologyLayer(geologyLayers);
      const selectedMineralLayer = getSelectedMineralLayer(mineralLayers);
      const seaActive = seaToggle.checked;
      const regionMaskActive = Boolean(regionMaskSelect.value);
      const seismicActive = seismicToggle.checked;
      const entries = [];


      if (selectedMineralLayer) {
        entries.push({
          title: `${selectedMineralLayer.label} mineral scale`,
          copy: "ASU TES mineral abundance legend for the currently selected mineral overlay.",
          image: selectedMineralLayer.legend_path || "",
          tags: ["mineral", "TES"],
        });
      }

      if (seaActive) {
        entries.push({
          title: "Paleo-sea symbology",
          copy: `Sea-level threshold model. Current level: ${Number(seaLevelSlider.value)} m.`,
          tags: ["paleo-sea", "modeled"],
          symbols: [
            {
              type: "gradient",
              label: "Modeled water fill",
              detail: "Color ramps from shallow coastal cyan to deeper basin blue below the selected threshold.",
              colorA: "#73d8ef",
              colorB: "#2f86b8",
            },
            {
              type: "swatch",
              label: "Shoreline highlight",
              detail: "Brighter edge band marks terrain just below the current sea level.",
              color: "#b0f0ff",
            },
          ],
        });
      }

      if (regionMaskActive) {
        if (regionMaskSelect.value === "lowlands") {
          entries.push({
            title: "Lowlands mask",
            copy: "Threshold mask for elevations at or below -2500 m.",
            tags: ["region-mask", "lowlands"],
            symbols: [
              {
                type: "swatch",
                label: "Northern lowlands",
                detail: "Blue translucent fill marks terrain at or below the lowland threshold.",
                color: "rgba(64,160,255,0.72)",
              },
            ],
          });
        } else if (regionMaskSelect.value === "highlands") {
          entries.push({
            title: "Highlands mask",
            copy: "Threshold mask for elevations above -2500 m.",
            tags: ["region-mask", "highlands"],
            symbols: [
              {
                type: "swatch",
                label: "Southern highlands",
                detail: "Amber translucent fill marks terrain above the lowland-highland break.",
                color: "rgba(255,170,82,0.72)",
              },
            ],
          });
        } else if (regionMaskSelect.value === "volcanic-provinces") {
          entries.push({
            title: "Volcanic province mask",
            copy: "Curated translucent halos centered on the main volcanic provinces.",
            tags: ["region-mask", "volcanic-provinces"],
            symbols: [
              {
                type: "swatch",
                label: "Province halo",
                detail: "Warm red-orange halos mark the Tharsis, Elysium, and Syrtis Major volcanic regions.",
                color: "rgba(255,112,82,0.78)",
              },
            ],
          });
        } else if (regionMaskSelect.value === "basins") {
          entries.push({
            title: "Impact basin mask",
            copy: "Curated translucent halos centered on major impact basins.",
            tags: ["region-mask", "basins"],
            symbols: [
              {
                type: "swatch",
                label: "Basin halo",
                detail: "Blue halos mark the major Hellas, Isidis, Utopia, and Argyre basin regions.",
                color: "rgba(84,166,255,0.76)",
              },
            ],
          });
        }
      }

      return entries;
    }

    function buildMetadataState(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState = null) {
      const coreEnabled = coreToggle.checked;
      const selectedBaseLayer = getSelectedBaseLayer(baseLayers);
      const selectedGeologyLayer = getSelectedGeologyLayer(geologyLayers);
      const selectedMineralLayer = getSelectedMineralLayer(mineralLayers);
      const seismicActive = seismicToggle.checked;
      const seaActive = seaToggle.checked;
      const regionMaskActive = Boolean(regionMaskSelect.value);
      const sections = [];
      const activeLayers = [];

      const pushActiveLayer = (title, context, layer, detail = null) => {
        const meta = getLayerMeta(context, layer);
        activeLayers.push({
          title,
          copy: detail || describeLayer(layer),
          citation: `${meta.badge}. ${meta.help}`,
          tags: meta.tags,
        });
      };

      pushActiveLayer("Basemap", "base", selectedBaseLayer);
      if (geologyToggle.checked && selectedGeologyLayer) {
        pushActiveLayer("Atmospheric context layer", "geology", selectedGeologyLayer);
      }
      if (geologyContactsToggle.checked && (geologyInteractiveState?.contacts || []).length) {
        pushActiveLayer(
          "Geology contacts",
          "geology",
          selectedGeologyLayer || selectedBaseLayer,
          "SIM 3292 geologic contacts draped from the vector shapefiles.",
        );
      }
      if (geologyStructuresToggle.checked && (geologyInteractiveState?.structures || []).length) {
        pushActiveLayer(
          "Geology structures",
          "geology",
          selectedGeologyLayer || selectedBaseLayer,
          "SIM 3292 faults and structural traces draped from the vector shapefiles.",
        );
      }
      if (selectedMineralLayer) {
        pushActiveLayer("Mineral map", "mineral", selectedMineralLayer);
      }
      if (seaActive) {
        pushActiveLayer(
          "Paleo-sea overlay",
          "sea",
          selectedBaseLayer,
          `Sea-level threshold model over global relief. Current level: ${Number(seaLevelSlider.value)} m.`,
        );
      }
      if (regionMaskActive) {
        pushActiveLayer(
          "Region mask",
          "modeled",
          selectedBaseLayer,
          `${regionMaskSelect.options[regionMaskSelect.selectedIndex].text} mask derived from elevation thresholds or curated regional envelopes.`,
        );
      }
      if (seismicActive) {
        pushActiveLayer(
          "Seismic catalog",
          "seismic",
          selectedBaseLayer,
          `No active seismic catalog is used for Jupiter in this workflow.`,
        );
      }
      if (coreEnabled) {
        pushActiveLayer(
          "Interior cutaway",
          "core",
          selectedBaseLayer,
          "Interior layers are a schematic Jupiter model inferred from gravity, magnetic-field, and ring-seismology studies.",
        );
      }

      sections.push({ title: "Active Layers", entries: activeLayers });

      const legendEntries = buildLegendEntries(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      if (legendEntries.length) {
        sections.push({ title: "Legend", entries: legendEntries });
      }

      const sourceEntries = [];
      sourceEntries.push({
        title: selectedBaseLayer?.label || "Basemap source",
        copy: describeLayer(selectedBaseLayer),
        links: [makeMetadataLink("Source page", selectedBaseLayer?.source_page_url)].filter(Boolean),
      });
      if (selectedMineralLayer) {
        sourceEntries.push({
          title: `${selectedMineralLayer.label} mineral product`,
          copy: "ASU TES mineral abundance product.",
          links: [makeMetadataLink("TES mineral products", selectedMineralLayer.source_page_url)].filter(Boolean),
        });
      }
      if (
        (geologyToggle.checked && selectedGeologyLayer) ||
        geologyContactsToggle.checked ||
        geologyStructuresToggle.checked
      ) {
        sourceEntries.push({
          title: "Atmospheric context references",
          copy: "Use the source pages below for the enhanced atmosphere layer and related Jupiter context references.",
          citation: manifest.sources.geology_original_units_citation || "",
          links: [
            makeMetadataLink("Jupiter facts", manifest.sources.geology_notes_url),
            makeMetadataLink("Reference page", manifest.sources.geology_dmu_url),
            makeMetadataLink("Texture page", manifest.sources.geology_map_url),
            makeMetadataLink("Context source", manifest.sources.geology_database_url),
          ].filter(Boolean),
        });
      }
      if (seismicActive && manifest.seismic?.source_page_url) {
        sourceEntries.push({
          title: "Seismic catalog source",
          copy: "No Mars-style seismic catalog is used for this Jupiter workflow.",
          links: [makeMetadataLink("Catalog source", manifest.seismic.source_page_url)].filter(Boolean),
        });
      }
      sourceEntries.push({
        title: "Moon nomenclature",
        copy: "Jupiter moon feature names, locations, and classifications are derived from the IAU Working Group for Planetary System Nomenclature gazetteer, as maintained by the USGS Astrogeology Science Center.",
        links: [makeMetadataLink("USGS Planetary Nomenclature", "https://planetarynames.wr.usgs.gov/")],
      });
      sourceEntries.push({
        title: "Jupiter radio emissions",
        copy: "NASA sonification of radio emissions from Jupiter and Enceladus.",
        links: [makeMetadataLink("Sound of Jupiter", "https://science.nasa.gov/resource/sound-of-jupiter-radio-emissions-of-the-planet-and-enceladus/")],
      });
      sourceEntries.push({
        title: "Background music",
        copy: "Ambient space music licensed via Pixabay. Music by Nikita Kondrashev and Sigma Music Art.",
        links: [
          makeMetadataLink("Nikita Kondrashev — Space", "https://pixabay.com/music/space-space-440026/"),
          makeMetadataLink("Sigma Music Art — Space Ambient Background Music", "https://pixabay.com/music/space-space-ambient-background-music-462074/"),
        ],
      });
            sections.push({ title: "Sources", entries: sourceEntries });

      return {
        title: "Layer Metadata",
        subtitle: "Citations, provenance, and legend context for the current map state.",
        sections,
      };
    }

    function renderMetadataModal(state) {
      currentMetadataState = state;
      metadataTitle.textContent = state?.title || "Layer Metadata";
      metadataSubtitle.textContent = state?.subtitle || "Citations and provenance for the current map state.";
      metadataSections.innerHTML = "";
      for (const section of state?.sections || []) {
        if (!section.entries || !section.entries.length) {
          continue;
        }
        const sectionNode = document.createElement("section");
        sectionNode.className = "metadata-section";
        const title = document.createElement("h3");
        title.className = "metadata-section-title";
        title.textContent = section.title;
        sectionNode.appendChild(title);
        for (const entry of section.entries) {
          const entryTitle = document.createElement("p");
          entryTitle.className = "layer-type-badge";
          entryTitle.textContent = entry.title;
          sectionNode.appendChild(entryTitle);
          if (entry.copy) {
            const copy = document.createElement("p");
            copy.className = "metadata-section-copy";
            copy.textContent = entry.copy;
            sectionNode.appendChild(copy);
          }
          if (entry.citation) {
            const citation = document.createElement("p");
            citation.className = "metadata-citation";
            citation.textContent = entry.citation;
            sectionNode.appendChild(citation);
          }
          if (entry.tags && entry.tags.length) {
            const tags = document.createElement("div");
            tags.className = "result-chip-row";
            setTagRow(tags, entry.tags);
            sectionNode.appendChild(tags);
          }
          if (entry.symbols && entry.symbols.length) {
            const symbolList = document.createElement("div");
            symbolList.className = "legend-symbol-list";
            for (const symbolDef of entry.symbols) {
              const row = document.createElement("div");
              row.className = "legend-symbol-row";
              const visual = document.createElement("span");
              if (symbolDef.type === "ring") {
                visual.className = "legend-ring";
              } else if (symbolDef.type === "line") {
                visual.className = "legend-line";
                if (symbolDef.color) {
                  visual.style.borderTopColor = symbolDef.color;
                }
              } else if (symbolDef.type === "gradient") {
                visual.className = "legend-gradient";
                visual.style.background = `linear-gradient(135deg, ${symbolDef.colorA}, ${symbolDef.colorB})`;
              } else {
                visual.className = symbolDef.type === "dot" ? "legend-dot" : "legend-swatch";
                if (symbolDef.color) {
                  visual.style.background = symbolDef.color;
                }
                if (symbolDef.borderColor) {
                  visual.style.borderColor = symbolDef.borderColor;
                }
              }
              row.appendChild(visual);
              const copyWrap = document.createElement("div");
              copyWrap.className = "legend-symbol-copy";
              const label = document.createElement("div");
              label.className = "legend-symbol-label";
              label.textContent = symbolDef.label;
              copyWrap.appendChild(label);
              if (symbolDef.detail) {
                const detail = document.createElement("div");
                detail.className = "legend-symbol-detail";
                detail.textContent = symbolDef.detail;
                copyWrap.appendChild(detail);
              }
              row.appendChild(copyWrap);
              symbolList.appendChild(row);
            }
            sectionNode.appendChild(symbolList);
          }
          if (entry.image) {
            const image = document.createElement("img");
            image.className = "metadata-image";
            image.src = entry.image;
            image.alt = entry.title;
            sectionNode.appendChild(image);
          }
          if (entry.links && entry.links.length) {
            const links = document.createElement("div");
            links.className = "metadata-links";
            for (const linkDef of entry.links) {
              const link = document.createElement("a");
              link.className = "reference-link";
              link.href = linkDef.href;
              link.target = "_blank";
              link.rel = "noreferrer";
              link.textContent = linkDef.label;
              links.appendChild(link);
            }
            sectionNode.appendChild(links);
          }
        }
        metadataSections.appendChild(sectionNode);
      }
    }

    function renderLegendPanel(entries) {
      legendPanel.innerHTML = "";
      if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "legend-empty";
        empty.textContent = "";
        legendPanel.appendChild(empty);
        legendSummaryCopy.textContent = "Active overlay symbologies and legend images.";
        return;
      }

      legendSummaryCopy.textContent = `${entries.length} active legend ${entries.length === 1 ? "entry" : "entries"} for the current overlays.`;
      for (const entry of entries) {
        const card = document.createElement("section");
        card.className = "legend-entry";
        const title = document.createElement("p");
        title.className = "layer-type-badge";
        title.textContent = entry.title;
        card.appendChild(title);
        if (entry.copy) {
          const copy = document.createElement("p");
          copy.className = "metadata-section-copy";
          copy.textContent = entry.copy;
          card.appendChild(copy);
        }
        if (entry.tags && entry.tags.length) {
          const tags = document.createElement("div");
          tags.className = "result-chip-row";
          setTagRow(tags, entry.tags);
          card.appendChild(tags);
        }
        if (entry.symbols && entry.symbols.length) {
          const symbolList = document.createElement("div");
          symbolList.className = "legend-symbol-list";
          for (const symbolDef of entry.symbols) {
            const row = document.createElement("div");
            row.className = "legend-symbol-row";
            const visual = document.createElement("span");
            if (symbolDef.type === "ring") {
              visual.className = "legend-ring";
            } else if (symbolDef.type === "line") {
              visual.className = "legend-line";
              if (symbolDef.color) {
                visual.style.borderTopColor = symbolDef.color;
              }
            } else if (symbolDef.type === "gradient") {
              visual.className = "legend-gradient";
              visual.style.background = `linear-gradient(135deg, ${symbolDef.colorA}, ${symbolDef.colorB})`;
            } else {
              visual.className = symbolDef.type === "dot" ? "legend-dot" : "legend-swatch";
              if (symbolDef.color) {
                visual.style.background = symbolDef.color;
              }
              if (symbolDef.borderColor) {
                visual.style.borderColor = symbolDef.borderColor;
              }
            }
            row.appendChild(visual);
            const copyWrap = document.createElement("div");
            copyWrap.className = "legend-symbol-copy";
            const label = document.createElement("div");
            label.className = "legend-symbol-label";
            label.textContent = symbolDef.label;
            copyWrap.appendChild(label);
            if (symbolDef.detail) {
              const detail = document.createElement("div");
              detail.className = "legend-symbol-detail";
              detail.textContent = symbolDef.detail;
              copyWrap.appendChild(detail);
            }
            row.appendChild(copyWrap);
            symbolList.appendChild(row);
          }
          card.appendChild(symbolList);
        }
        if (entry.image) {
          const image = document.createElement("img");
          image.className = "legend-entry-image";
          image.src = entry.image;
          image.alt = entry.title;
          card.appendChild(image);
        }
        legendPanel.appendChild(card);
      }
    }

    function makeCacheKey(latDegrees, lonDegrees) {
      return `${Number(latDegrees).toFixed(4)}:${Number(lonDegrees).toFixed(4)}`;
    }

    function getCachedElevationNormalized(cache, sampler, latDegrees, lonDegrees) {
      if (!sampler) {
        return 0;
      }
      const key = makeCacheKey(latDegrees, lonDegrees);
      if (!cache.has(key)) {
        cache.set(key, sampleElevationNormalized(sampler, latDegrees, lonDegrees));
      }
      return cache.get(key);
    }

    function getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, latDegrees, lonDegrees, lift = 0) {
      const displacement = getCachedElevationNormalized(elevationCache, elevationSampler, latDegrees, lonDegrees) * getTerrainRelief();
      return latLonToVector3(latDegrees, lonDegrees, radius + displacement + lift);
    }

    function parseEventTimestamp(value) {
      const time = Date.parse(value || "");
      return Number.isFinite(time) ? time : null;
    }

    function isGeologyFeature(feature) {
      return Boolean(
        feature && typeof feature.type === "string" && feature.type.toLowerCase().startsWith("geologic")
      );
    }

    function syncScenePopupSelectionStyle(feature, isCoreLabel = false) {
      const geologySelected = isGeologyFeature(feature) && !isCoreLabel;
      scenePopup.classList.toggle("is-geology-selected", geologySelected);
      scenePopupAnchor.classList.toggle("is-geology-selected", geologySelected);
      if (!scenePopupState) {
        return;
      }
      if (!feature) {
        scenePopupState.hidden = true;
        scenePopupState.classList.remove("is-geology-selected");
        scenePopupState.textContent = "";
        return;
      }
      const moonViewerSelected = Boolean(
        activeMoonViewerFeature
        && feature
        && Array.isArray(feature.moon_anchor)
        && feature.name === activeMoonViewerFeature.name
      );
      scenePopup.classList.toggle("is-moon-viewer-selected", moonViewerSelected && !isCoreLabel);
      scenePopupAnchor.classList.toggle("is-moon-viewer-selected", moonViewerSelected && !isCoreLabel);
      scenePopupState.hidden = false;
      scenePopupState.classList.toggle("is-geology-selected", geologySelected);
      scenePopupState.textContent = geologySelected
        ? "Active geology selection"
        : moonViewerSelected
          ? "Moon viewer"
          : "Current focus";
    }

    function isMoonViewerSelectedFeature(feature) {
      const parentMoon = getMoonFeatureParent(feature);
      return Boolean(
        activeMoonViewerFeature
        && (
          (isMoonFeature(feature) && feature.name === activeMoonViewerFeature.name)
          || (parentMoon && parentMoon.name === activeMoonViewerFeature.name)
        )
      );
    }

    function isMoonFeature(feature) {
      return Boolean(feature && Array.isArray(feature.moon_anchor));
    }

    function getMoonFeatureIndex(feature) {
      if (!feature) {
        return -1;
      }
      return moonData.findIndex((item) => item.name === feature.name);
    }

    function getMoonFeatureByIndex(index) {
      if (!moonData.length) {
        return null;
      }
      const wrapped = ((index % moonData.length) + moonData.length) % moonData.length;
      return moonData[wrapped] || null;
    }

    function getMoonFeatureParent(feature) {
      if (!feature?.moon_name) {
        return null;
      }
      return moonData.find((item) => item.name === feature.moon_name) || null;
    }

    function getMoonSurfaceFeaturePoint(feature, lift = 0.01) {
      const parentMoon = getMoonFeatureParent(feature);
      if (!parentMoon) {
        return null;
      }
      const lat = feature.lat !== undefined ? feature.lat : feature.anchor_lat;
      const lon = feature.lon !== undefined ? feature.lon : feature.anchor_lon;
      if (lat === undefined || lon === undefined || !Array.isArray(parentMoon.moon_anchor)) {
        return null;
      }
      const moonAnchor = new THREE.Vector3(parentMoon.moon_anchor[0], parentMoon.moon_anchor[1], parentMoon.moon_anchor[2]);
      return latLonToVector3(lat, lon, Number(parentMoon.moon_radius || 0.1) + lift).add(moonAnchor);
    }

    function getMoonViewerDistance(feature) {
      const radius = Number(feature?.moon_radius || 0.1);
      return THREE.MathUtils.clamp(radius * 6.2, 0.5, 1.2);
    }

    function getMoonViewerMinDistance(feature) {
      const radius = Number(feature?.moon_radius || 0.1);
      return Math.max(radius * 1.15, 0.05);
    }

    function getMoonViewerMaxDistance(feature) {
      return Math.max(getMoonViewerDistance(feature) * 6, 3.6);
    }

    function populateMoonFeatureTypes(moonName) {
      if (!moonFeatureTypeSelect) return;
      const types = new Map();
      if (moonName) {
        moonFeatureData.forEach((f) => {
          if (f.moon_name === moonName && f.type) {
            types.set(f.type, (types.get(f.type) || 0) + 1);
          }
        });
      }
      moonFeatureTypeSelect.innerHTML = "";
      const allOpt = document.createElement("option");
      allOpt.value = "all";
      allOpt.textContent = `All features (${moonFeatureData.filter((f) => f.moon_name === moonName).length})`;
      moonFeatureTypeSelect.appendChild(allOpt);
      [...types.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([type, count]) => {
        const opt = document.createElement("option");
        opt.value = type;
        opt.textContent = `${type} (${count})`;
        moonFeatureTypeSelect.appendChild(opt);
      });
      moonFeatureTypeSelect.value = "all";
      moonFeatureTypeFilter = "all";
      populateMoonFeatureTourTargets();
    }

    function getMoonFeatureTourFeatures() {
      if (!activeMoonViewerFeature) return [];
      return moonFeatureData.filter((f) =>
        f.moon_name === activeMoonViewerFeature.name &&
        (moonFeatureTypeFilter === "all" || f.type === moonFeatureTypeFilter)
      );
    }

    function populateMoonFeatureTourTargets(selectedName = activeMoonFeatureTour?.name || "") {
      if (!moonFeatureTourTarget) return;
      const features = getMoonFeatureTourFeatures();
      moonFeatureTourTarget.innerHTML = "";
      for (const feature of features) {
        const option = document.createElement("option");
        option.value = feature.name;
        option.textContent = feature.name;
        moonFeatureTourTarget.appendChild(option);
      }
      if (features.some((f) => f.name === selectedName)) {
        moonFeatureTourTarget.value = selectedName;
      } else if (features[0]) {
        moonFeatureTourTarget.value = features[0].name;
      }
      const hasMultiple = features.length > 1;
      if (moonFeatureTourPrev) moonFeatureTourPrev.disabled = !hasMultiple;
      if (moonFeatureTourNext) moonFeatureTourNext.disabled = !hasMultiple;
      const active = features.find((f) => f.name === moonFeatureTourTarget.value);
    }

    function focusMoonFeatureTour(feature) {
      if (!feature) return;
      activeMoonFeatureTour = feature;
      if (moonFeatureTourTarget) moonFeatureTourTarget.value = feature.name;
      if (viewerCamera && viewerControls) {
        const parentMoon = getMoonFeatureParent(feature);
        const closeUpDist = parentMoon ? getMoonViewerMinDistance(parentMoon) : undefined;
        moveCameraToFeature(feature, viewerCamera, viewerControls, { animate: true, isTour: true, distance: closeUpDist });
        openFeature(feature, false);
      }
    }

    function cycleMoonFeatureTour(direction) {
      const features = getMoonFeatureTourFeatures();
      if (!features.length) return;
      const currentName = activeMoonFeatureTour?.name || moonFeatureTourTarget?.value || features[0].name;
      const currentIndex = Math.max(0, features.findIndex((f) => f.name === currentName));
      const next = features[((currentIndex + direction) % features.length + features.length) % features.length];
      focusMoonFeatureTour(next);
    }

    function renderMoonFeatureSearchResults(results, preserveIndex = false) {
      activeMoonFeatureSearchResults = results;
      if (!results.length) {
        activeMoonFeatureSearchIndex = -1;
      } else if (!preserveIndex || activeMoonFeatureSearchIndex < 0) {
        activeMoonFeatureSearchIndex = 0;
      } else {
        activeMoonFeatureSearchIndex = Math.min(activeMoonFeatureSearchIndex, results.length - 1);
      }
      moonFeatureSearchResults.innerHTML = "";
      if (!results.length) {
        moonFeatureSearchResults.hidden = true;
        return;
      }
      for (const [index, item] of results.entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-suggestion" + (index === activeMoonFeatureSearchIndex ? " is-active" : "");
        button.textContent = getFeatureDisplayName(item);
        const meta = document.createElement("span");
        meta.className = "search-suggestion-meta";
        meta.textContent = item.type || "Feature";
        button.appendChild(meta);
        button.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          focusSearchedFeature(item, viewerCamera, viewerControls);
          clearMoonFeatureSearchResults(true);
        });
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          focusSearchedFeature(item, viewerCamera, viewerControls);
          clearMoonFeatureSearchResults(true);
        });
        moonFeatureSearchResults.appendChild(button);
      }
      moonFeatureSearchResults.hidden = false;
    }

    function clearMoonFeatureSearchResults(resetInput = false) {
      if (resetInput && moonFeatureSearchInput) moonFeatureSearchInput.value = "";
      if (moonFeatureSearchResults) {
        moonFeatureSearchResults.hidden = true;
        moonFeatureSearchResults.innerHTML = "";
      }
      activeMoonFeatureSearchResults = [];
      activeMoonFeatureSearchIndex = -1;
    }

    function refreshMoonFeatureSearch() {
      if (!moonFeatureSearchInput || !moonFeatureSearchResults || !activeMoonViewerFeature) return;
      const query = String(moonFeatureSearchInput.value || "").trim().toLowerCase();
      const moonName = activeMoonViewerFeature.name;
      const results = moonFeatureData
        .filter((f) => f.moon_name === moonName && (!query || f.name.toLowerCase().includes(query)))
        .slice(0, 12);
      renderMoonFeatureSearchResults(results);
    }

    function syncMoonViewerControls(feature = activeMoonViewerFeature) {
      if (moonViewerSelect && feature) {
        moonViewerSelect.value = feature.name;
      }
      if (moonViewerToggle) {
        moonViewerToggle.checked = Boolean(feature);
      }
      if (moonViewerSection) {
        moonViewerSection.open = Boolean(feature);
      }
      if (moonViewerControls) {
        moonViewerControls.style.display = Boolean(feature) ? "" : "none";
      }
      const hasMoon = moonData.length > 0;
      const isActive = Boolean(feature);
      if (moonViewerPrev) {
        moonViewerPrev.disabled = !hasMoon || !isActive;
      }
      if (moonViewerNext) {
        moonViewerNext.disabled = !hasMoon || !isActive;
      }
      populateMoonFeatureTypes(feature ? feature.name : "");
      if (!feature) activeMoonFeatureTour = null;
      clearMoonFeatureSearchResults(true);
    }

    function syncMoonViewerPopup(feature = activePopupFeature, isCoreLabel = activePopupIsCoreLabel) {
      const shouldDock = Boolean(feature);
      scenePopup.classList.toggle("is-moon-viewer-selected", shouldDock);
      scenePopupAnchor.classList.toggle("is-moon-viewer-selected", shouldDock);
      if (shouldDock) {
        scenePopup.hidden = false;
        scenePopupAnchor.hidden = true;
        scenePopup.style.left = "";
        scenePopup.style.top = "";
        scenePopupAnchor.style.left = "";
        scenePopupAnchor.style.top = "";
      }
    }

    function deactivateMoonViewer(camera, controls) {
      activeMoonViewerFeature = null;
      moonNavContext = "moon";
      controls.minDistance = DEFAULT_CONTROL_MIN_DISTANCE;
      controls.maxDistance = DEFAULT_CONTROL_MAX_DISTANCE;
      controls.target.set(0, 0, 0);
      syncMoonViewerControls(null);
      syncScenePopupSelectionStyle(activePopupFeature);
      syncMoonViewerPopup(activePopupFeature);
      if (typeof measureMode !== "undefined" && typeof measurePoints !== "undefined" && (measureMode || measurePoints.length)) {
        resetActiveMeasurement(true);
      }
      if (camera && controls) {
        controls.object.position.copy(camera.position);
        controls.update();
      }
    }

    function activateMoonViewer(feature, camera, controls) {
      if (!isMoonFeature(feature) || !jupiterSceneGroup) {
        return;
      }
      cancelCameraFlight();
      activeMoonViewerFeature = feature;
      controls.minDistance = getMoonViewerMinDistance(feature);
      controls.maxDistance = getMoonViewerMaxDistance(feature);
      const localTarget = new THREE.Vector3(feature.moon_anchor[0], feature.moon_anchor[1], feature.moon_anchor[2]);
      const target = jupiterSceneGroup.localToWorld(localTarget.clone());
      const direction = target.clone().normalize();
      if (direction.lengthSq() < 0.0001) {
        direction.set(0.55, 0.18, 1).normalize();
      }
      // Offset the entry angle so Jupiter isn't dead-centre behind the moon.
      const _up = new THREE.Vector3(0, 1, 0);
      const _side = new THREE.Vector3().crossVectors(direction, _up).normalize();
      if (_side.lengthSq() > 0.0001) {
        direction.addScaledVector(_side, 0.4).addScaledVector(_up, 0.15).normalize();
      }
      camera.position.copy(target.clone().addScaledVector(direction, getMoonViewerDistance(feature)));
      camera.up.set(0, 1, 0);
      controls.target.copy(target);
      controls.object.position.copy(camera.position);
      controls.update();
      syncMoonViewerControls(feature);
      scenePopup.hidden = true;
      scenePopupAnchor.hidden = true;
      activePopupFeature = null;
      syncScenePopupSelectionStyle(null);
      syncMoonViewerPopup(null, false);
      if (typeof measureMode !== "undefined" && typeof measurePoints !== "undefined" && (measureMode || measurePoints.length)) {
        resetActiveMeasurement(false);
      }
    }

    function cycleMoonViewer(direction, camera, controls) {
      if (!activeMoonViewerFeature) {
        return;
      }
      const startIndex = activeMoonViewerFeature
        ? getMoonFeatureIndex(activeMoonViewerFeature)
        : (direction >= 0 ? -1 : 0);
      const nextFeature = getMoonFeatureByIndex(startIndex + direction);
      if (!nextFeature) {
        return;
      }
      activateMoonViewer(nextFeature, camera, controls);
      setStatus(`Moon viewer locked on ${nextFeature.name}.`);
    }

    function showViewerErrorState(message) {
      app.innerHTML = `
        <div class="webgl-fallback">
          <div class="webgl-fallback-card">
            <p class="eyebrow">Viewer Error</p>
            <h2 style="margin:0 0 0.6rem;">Jupiter viewer could not start.</h2>
            <p class="copy" style="margin:0 0 0.7rem;">${message}</p>
            <p class="compact-copy">Check WebGL support, local asset availability, or the browser console for more detail.</p>
          </div>
        </div>
      `;
      cursorReadout.hidden = true;
      hoverTooltip.hidden = true;
    }

    function getFeatureDisplayName(feature) {
      return String(feature?.name || "").replace(/^\s*\[([^\]]+)\]\s*$/, "$1").trim();
    }

    function getCanonicalMoonFeatureName(feature) {
      const typeWords = String(feature?.type || "")
        .split(/\s+/)
        .map((word) => word.replace(/[^a-z]/gi, "").toLowerCase())
        .filter((word) => word.length > 2);
      const suffixes = [
        ...typeWords,
        "catenae", "catena", "chasmata", "chasma", "crater", "dorsa", "dorsum",
        "faculae", "facula", "fluctus", "flumen", "fossae", "fossa", "insulae",
        "insula", "labyrinthus", "lacus", "lineae", "linea", "maculae", "macula",
        "montes", "mons", "planitiae", "planitia", "regiones", "regio", "rupes",
        "sulci", "sulcus", "undae", "unda", "virgae", "virga",
      ];
      const suffixPattern = new RegExp(`\\s+(?:${[...new Set(suffixes)].join("|")})$`, "i");
      return normalizeSearchText(getFeatureDisplayName(feature)).replace(suffixPattern, "").trim();
    }

    function moonFeatureDedupScore(feature) {
      let score = 0;
      const displayName = getFeatureDisplayName(feature);
      const type = String(feature?.type || "");
      if (!new RegExp(`\\s+${type.replace(/[^a-z]/gi, "")}$`, "i").test(displayName)) score += 2;
      if (isLikelyNomenclatureDescription(feature)) score += 2;
      if (Number.isFinite(feature?.lat) && Number.isFinite(feature?.lon)) score += 1;
      if (feature?.dimension || feature?.interpretation || feature?.origin) score += 1;
      return score;
    }

    function dedupeMoonFeatureData() {
      const winners = new Map();
      for (const feature of moonFeatureData) {
        const key = `${feature.moon_name || ""}|${getCanonicalMoonFeatureName(feature)}`;
        const current = winners.get(key);
        if (!current || moonFeatureDedupScore(feature) > moonFeatureDedupScore(current)) {
          winners.set(key, feature);
        }
      }
      for (let i = moonFeatureData.length - 1; i >= 0; i -= 1) {
        const feature = moonFeatureData[i];
        const key = `${feature.moon_name || ""}|${getCanonicalMoonFeatureName(feature)}`;
        if (winners.get(key) !== feature) {
          moonFeatureData.splice(i, 1);
        }
      }
    }

    function findFeatureByName(name) {
      const needle = normalizeSearchText(name);
      if (!needle) {
        return null;
      }
      return allFeatureData.find((item) => normalizeSearchText(getFeatureDisplayName(item)) === needle)
        || allFeatureData.find((item) => normalizeSearchText(getFeatureDisplayName(item)).startsWith(needle));
    }

    function normalizeSearchText(value) {
      return String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
    }

    function getPredictiveNameMatches(query, maxResults = 25) {
      const needle = normalizeSearchText(query);
      if (!needle) {
        return [];
      }
      return allFeatureData
        .filter((item) => normalizeSearchText(getFeatureDisplayName(item)).startsWith(needle))
        .sort((a, b) => getFeatureDisplayName(a).localeCompare(getFeatureDisplayName(b)))
        .slice(0, maxResults);
    }

    function rankFeatureMatches(query, maxResults = 6) {
      const needle = String(query || "").trim().toLowerCase();
      if (!needle) {
        return [];
      }
      return allFeatureData
        .map((item) => {
          const haystack = getFeatureDisplayName(item).toLowerCase();
          let score = 0;
          if (haystack === needle) {
            score = 1000;
          } else if (haystack.startsWith(needle)) {
            score = 700 - haystack.length;
          } else if (haystack.includes(needle)) {
            score = 500 - haystack.indexOf(needle);
          } else {
            const terms = needle.split(/\s+/).filter(Boolean);
            score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 80 : 0), 0);
          }
          if (item.theme === "landing") {
            score += 12;
          }
          return { item, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || getFeatureDisplayName(a.item).localeCompare(getFeatureDisplayName(b.item)))
        .slice(0, maxResults)
        .map((entry) => entry.item);
    }

    function getFeatureBodyLabel(feature) {
      if (!feature) {
        return "";
      }
      if (feature.moon_name) {
        return feature.moon_name;
      }
      if (Array.isArray(feature.moon_anchor)) {
        return feature.name || "Moon";
      }
      if (feature.ring_region || /ring/i.test(feature.name || "")) {
        return "Jupiter";
      }
      return "Jupiter";
    }

    function renderFeatureSearchResults(results, preserveIndex = false) {
      activeSearchResults = results;
      if (!results.length) {
        activeSearchIndex = -1;
      } else if (!preserveIndex || activeSearchIndex < 0) {
        activeSearchIndex = 0;
      } else {
        activeSearchIndex = Math.min(activeSearchIndex, results.length - 1);
      }
      featureSearchResults.innerHTML = "";
      if (!results.length) {
        featureSearchResults.hidden = true;
        return;
      }
      for (const [index, item] of results.entries()) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-suggestion" + (index === activeSearchIndex ? " is-active" : "");
        button.textContent = getFeatureDisplayName(item);
        const meta = document.createElement("span");
        meta.className = "search-suggestion-meta";
        meta.textContent = `${item.type || "Mapped feature"} | ${getFeatureBodyLabel(item)}`;
        button.appendChild(meta);
        button.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          focusSearchedFeature(item, viewerCamera, viewerControls);
        });
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          focusSearchedFeature(item, viewerCamera, viewerControls);
        });
        featureSearchResults.appendChild(button);
      }
      featureSearchResults.hidden = false;
    }

    function clearFeatureSearchResults(resetInput = false) {
      if (resetInput) {
        featureSearch.value = "";
      }
      featureSearchResults.hidden = true;
      featureSearchResults.innerHTML = "";
      activeSearchResults = [];
      activeSearchIndex = -1;
    }

    function resolveFeatureSearchSelection() {
      const typedValue = String(featureSearch.value || "").trim();
      if (!typedValue) {
        return null;
      }
      if (activeSearchResults.length) {
        if (activeSearchIndex >= 0 && activeSearchIndex < activeSearchResults.length) {
          return activeSearchResults[activeSearchIndex];
        }
        return activeSearchResults[0];
      }
      return findFeatureByName(typedValue) || rankFeatureMatches(typedValue, 1)[0] || null;
    }

    function cancelCameraFlight() {
      if (activeCameraFlight) {
        activeCameraFlight.cancelled = true;
        activeCameraFlight = null;
      }
    }

    function animateCameraFlight(camera, controls, nextPosition, nextTarget, durationMs = 1400, onComplete = null) {
      if (!camera || !controls || !nextPosition || !nextTarget) {
        onComplete?.();
        return;
      }
      cancelCameraFlight();
      const flight = {
        cancelled: false,
        startAt: performance.now(),
        startPosition: camera.position.clone(),
        startTarget: controls.target.clone(),
        endPosition: nextPosition.clone(),
        endTarget: nextTarget.clone(),
        durationMs,
        onComplete,
      };
      activeCameraFlight = flight;
      const step = (now) => {
        if (flight.cancelled) return;
        const t = Math.min(1, (now - flight.startAt) / Math.max(flight.durationMs, 1));
        const eased = 1 - ((1 - t) ** 3);
        camera.position.lerpVectors(flight.startPosition, flight.endPosition, eased);
        controls.target.lerpVectors(flight.startTarget, flight.endTarget, eased);
        controls.object.position.copy(camera.position);
        controls.update();
        if (t < 1) {
          requestAnimationFrame(step);
          return;
        }
        activeCameraFlight = null;
        flight.onComplete?.();
      };
      requestAnimationFrame(step);
    }

    // Jupiter surface-conditions estimation helpers
    const _SUN_DIR = new THREE.Vector3(8, 4, 6).normalize();
    function estimateJupiterCloudTopTemp(latDeg) {
      // Jupiter cloud tops at 1 bar: ~-178°C at equator, colder toward poles
      const latRad = Math.abs(latDeg) * (Math.PI / 180);
      return Math.round(-178 - 14 * Math.pow(Math.sin(latRad), 2));
    }
    function estimateJupiterCloudTopPressure() {
      return 101325; // 1 bar displayed as Pa
    }
    function estimateMoonSurfaceTemperature(moonName, surfaceNormalWorld) {
      const cosTheta = Math.max(0, surfaceNormalWorld.dot(_SUN_DIR));
      const moonTDayMap = { titan: -179, enceladus: -198, mimas: -209, tethys: -187, dione: -186, rhea: -220, iapetus: -173 };
      const moonTNightMap = { titan: -183, enceladus: -240, mimas: -240, tethys: -188, dione: -186, rhea: -220, iapetus: -220 };
      const key = moonName.toLowerCase();
      const T_day = moonTDayMap[key] ?? -180;
      const T_night = moonTNightMap[key] ?? -220;
      return Math.round(T_night + (T_day - T_night) * cosTheta);
    }
    function estimateSpaceTemperature(camDist) {
      const t = Math.max(0, Math.min(1, (camDist - 6) / 60));
      return Math.round(-178 - 69 * t);
    }

    // Jupiter interior model — rFrac = 0 (centre) → 1 (surface)
    const JUPITER_INTERIOR_LAYERS = [
      { name: "Inner Core",        rMin: 0.000, rMax: 0.120 },
      { name: "Metallic Liquid Hydrogen Outer Core",       rMin: 0.120, rMax: 0.800 },
      { name: "Fluid Transition",  rMin: 0.800, rMax: 0.835 },
      { name: "Inner Atmosphere",  rMin: 0.835, rMax: 0.950 },
      { name: "Outer Atmosphere",  rMin: 0.950, rMax: 1.000 },
    ];
    const JUPITER_INTERIOR_T_PTS = [[0.000, 25000], [0.160, 20000], [0.420, 12000], [0.850, 2000], [1.000, -134]];
    const JUPITER_INTERIOR_P_PTS = [[0.000, 20000], [0.160, 1500],  [0.420, 200],   [0.850, 1.0],  [1.000, 0.0001]];
    function _jupiterInteriorInterp(pts, rFrac) {
      const r = Math.max(0, Math.min(1, rFrac));
      for (let i = 0; i < pts.length - 1; i++) {
        const [r0, v0] = pts[i], [r1, v1] = pts[i + 1];
        if (r >= r0 && r <= r1) return v0 + ((r - r0) / (r1 - r0)) * (v1 - v0);
      }
      return pts[pts.length - 1][1];
    }
    function jupiterInteriorLayerName(rFrac) {
      for (const layer of JUPITER_INTERIOR_LAYERS) {
        if (rFrac >= layer.rMin && rFrac <= layer.rMax) return layer.name;
      }
      return "Unknown";
    }
    function jupiterInteriorTempC(rFrac) { return Math.round(_jupiterInteriorInterp(JUPITER_INTERIOR_T_PTS, rFrac)); }
    function jupiterInteriorPressureGPa(rFrac) { return Math.round(_jupiterInteriorInterp(JUPITER_INTERIOR_P_PTS, rFrac) * 10) / 10; }
    function jupiterInteriorLayerColor(name) {
      return { "Outer Atmosphere": "#d4b882", "Inner Atmosphere": "#7a6248", "Fluid Transition": "#5080b8", "Metallic Liquid Hydrogen Outer Core": "#b0bcc8", "Inner Core": "#c84020" }[name] ?? "#ccc";
    }

    function jupiterInteriorTempColor(tempC) {
      const t = Math.max(0, Math.min(1, (tempC + 134) / 25134));
      if (t < 0.33) { const f = t / 0.33; return `rgb(${Math.round(f*60)},${Math.round(f*200)},${Math.round(255-f*55)})`; }
      if (t < 0.66) { const f = (t-0.33)/0.33; return `rgb(${Math.round(60+f*195)},${Math.round(200-f*60)},${Math.round(200-f*200)})`; }
      const f = (t-0.66)/0.34; return `rgb(255,${Math.round(140-f*140)},0)`;
    }
    function jupiterInteriorPressureColor(gpa) {
      const t = Math.max(0, Math.min(1, gpa / 20000));
      return `rgb(${Math.round(t<0.5?t*2*220:220)},${Math.round(t<0.5?200:(1-(t-0.5)*2)*200)},60)`;
    }

    // Tour-mode arc flight: pulls camera up to a cruise altitude mid-flight,
    // slews across the planet via a great-circle arc, then descends.
    function animateTourFlight(camera, controls, nextPosition, nextTarget, durationMs = 2800, onComplete = null) {
      if (!camera || !controls || !nextPosition || !nextTarget) {
        onComplete?.();
        return;
      }
      cancelCameraFlight();

      const startPosition = camera.position.clone();
      const startTarget = controls.target.clone();
      const startDist = startPosition.length();
      const endDist = nextPosition.length();
      const startDir = startDist > 0.0001 ? startPosition.clone().normalize() : new THREE.Vector3(0, 1, 0);
      const endDir = endDist > 0.0001 ? nextPosition.clone().normalize() : startDir.clone();

      const TOUR_GLOBE_R = 3.2;
      const CRUISE_DIST = Math.max(startDist, endDist, TOUR_GLOBE_R * 2.1);

      const dot = Math.max(-1, Math.min(1, startDir.dot(endDir)));
      const angle = Math.acos(dot);
      const sinAngle = Math.sin(angle);

      const flight = { cancelled: false, startAt: performance.now(), durationMs, onComplete };
      activeCameraFlight = flight;

      const step = (now) => {
        if (flight.cancelled) return;
        const t = Math.min(1, (now - flight.startAt) / Math.max(flight.durationMs, 1));
        const easedT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        let currentDir;
        if (sinAngle < 0.0001) {
          currentDir = startDir.clone();
        } else {
          const w1 = Math.sin((1 - easedT) * angle) / sinAngle;
          const w2 = Math.sin(easedT * angle) / sinAngle;
          currentDir = new THREE.Vector3(
            w1 * startDir.x + w2 * endDir.x,
            w1 * startDir.y + w2 * endDir.y,
            w1 * startDir.z + w2 * endDir.z,
          ).normalize();
        }

        const baseDist = startDist + (endDist - startDist) * easedT;
        const bump = Math.sin(t * Math.PI) * Math.max(CRUISE_DIST - baseDist, 0);
        const currentDist = baseDist + bump;

        camera.position.copy(currentDir).multiplyScalar(currentDist);
        controls.target.lerpVectors(startTarget, nextTarget, easedT);
        controls.object.position.copy(camera.position);
        controls.update();

        if (t < 1) { requestAnimationFrame(step); return; }
        activeCameraFlight = null;
        flight.onComplete?.();
      };
      requestAnimationFrame(step);
    }

    function focusSearchedFeature(feature, camera, controls, options = {}) {
      if (!feature) {
        setStatus("Feature search did not match a mapped feature.", true);
        return false;
      }
      featureSearch.value = feature.name;
      const parentMoon = getMoonFeatureParent(feature);
      const mergedOptions = {
        animate: true,
        onComplete: () => openFeature(feature, false),
        ...(parentMoon ? { distance: getMoonViewerMinDistance(parentMoon) * 1.5 } : {}),
        ...options,
      };
      moveCameraToFeature(feature, camera, controls, mergedOptions);
      clearFeatureSearchResults();
      setStatus(`Focused on ${feature.name}.`);
      return true;
    }

    function moveCameraToFeature(feature, camera, controls, options = {}) {
      if (!feature) {
        return;
      }
      pauseSpin();
      const parentMoon = getMoonFeatureParent(feature);
      const isMoonScopedTarget = isMoonFeature(feature) || Boolean(parentMoon);
      if (!isMoonScopedTarget && activeMoonViewerFeature) {
        deactivateMoonViewer(camera, controls);
      }
      if (isMoonFeature(feature)) {
        activateMoonViewer(feature, camera, controls);
        return;
      }
      if (parentMoon) {
        const lat = feature.lat !== undefined ? feature.lat : feature.anchor_lat;
        const lon = feature.lon !== undefined ? feature.lon : feature.anchor_lon;
        if (!parentMoon || !jupiterSceneGroup || !Array.isArray(parentMoon.moon_anchor) || lat === undefined || lon === undefined) {
          return;
        }
        activeMoonViewerFeature = parentMoon;
        controls.minDistance = getMoonViewerMinDistance(parentMoon);
        controls.maxDistance = getMoonViewerMaxDistance(parentMoon);
        const moonAnchor = new THREE.Vector3(parentMoon.moon_anchor[0], parentMoon.moon_anchor[1], parentMoon.moon_anchor[2]);
        // Use moonFeatureLocalPos + moonMesh.matrix to compute the actual surface position,
        // accounting for tidal-locking rotation and centered-moon texture flip.
        const _flyMesh = moonMeshMap ? moonMeshMap.get(parentMoon.name) : null;
        let targetLocal;
        if (_flyMesh) {
          const _localPos = moonFeatureLocalPos(lat, lon, parentMoon.name, Number(parentMoon.moon_radius || 0.1) + 0.002);
          targetLocal = _localPos.clone().applyMatrix4(_flyMesh.matrix);
        } else {
          targetLocal = latLonToVector3(lat, lon, Number(parentMoon.moon_radius || 0.1) + 0.002).add(moonAnchor);
        }
        const target = jupiterSceneGroup.localToWorld(targetLocal.clone());
        const moonCenter = jupiterSceneGroup.localToWorld(moonAnchor.clone());
        const direction = target.clone().sub(moonCenter).normalize();
        if (direction.lengthSq() < 0.0001) {
          direction.set(0.55, 0.18, 1).normalize();
        }
        const flyDist = options.distance !== undefined ? options.distance : getMoonViewerDistance(parentMoon);
        const cameraPos = target.clone().addScaledVector(direction, flyDist);
        if (options.animate) {
          animateCameraFlight(camera, controls, cameraPos, moonCenter, options.durationMs || 1800, options.onComplete || null);
        } else {
          camera.position.copy(cameraPos);
          camera.up.set(0, 1, 0);
          controls.target.copy(moonCenter);
          controls.object.position.copy(camera.position);
          controls.update();
        }
        syncMoonViewerControls(parentMoon);
        return;
      }
      let target = null;
      if (Array.isArray(feature.ring_anchor)) {
        target = new THREE.Vector3(feature.ring_anchor[0], feature.ring_anchor[1], feature.ring_anchor[2]);
        if (jupiterSceneGroup) {
          target = jupiterSceneGroup.localToWorld(target.clone());
        }
      } else if (Array.isArray(feature.moon_anchor)) {
        target = new THREE.Vector3(feature.moon_anchor[0], feature.moon_anchor[1], feature.moon_anchor[2]);
        if (jupiterSceneGroup) {
          target = jupiterSceneGroup.localToWorld(target.clone());
        }
      } else {
        const lat = feature.lat !== undefined ? feature.lat : feature.anchor_lat;
        const lon = feature.lon !== undefined ? feature.lon : feature.anchor_lon;
        if (lat === undefined || lon === undefined) {
          return;
        }
        target = latLonToVector3(lat, lon, 3.2);
        const _spinDelta = getSpinTime() * (2 * Math.PI / _PLANET_DISPLAY_PERIOD_MS);
        target.applyAxisAngle(new THREE.Vector3(0, 1, 0), _spinDelta);
        if (jupiterSceneGroup) {
          target = jupiterSceneGroup.localToWorld(target.clone());
        }
      }
      const direction = target.clone().normalize();
      const cameraDistance = Array.isArray(feature.ring_anchor)
        ? 4.8
        : 3.2;
      activeMoonViewerFeature = null;
      controls.minDistance = DEFAULT_CONTROL_MIN_DISTANCE;
      controls.maxDistance = DEFAULT_CONTROL_MAX_DISTANCE;
      syncMoonViewerControls(null);
      const cameraPosition = Array.isArray(feature.ring_anchor)
        ? target.clone().add(new THREE.Vector3(0, 1.8, 4.6))
        : target.clone().addScaledVector(direction, cameraDistance);
      const jupiterCenter = new THREE.Vector3(0, 0, 0);
      if (options.animate) {
        if (options.isTour && !Array.isArray(feature.ring_anchor)) {
          // Fly camera to face the feature but keep orbit centre at Jupiter so navigation stays natural.
          animateTourFlight(camera, controls, cameraPosition, jupiterCenter, 2800, options.onComplete || null);
        } else {
          animateCameraFlight(camera, controls, cameraPosition, target, options.durationMs || 1800, options.onComplete || null);
        }
      } else {
        camera.position.copy(cameraPosition);
        camera.up.set(0, 1, 0);
        controls.object.position.copy(camera.position);
        controls.target.copy(options.isTour ? jupiterCenter : target);
        controls.update();
      }
    }

    function resetExploreView(camera, controls) {
      cancelCameraFlight();
      deactivateMoonViewer(camera, controls);
      camera.position.set(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z);
      camera.up.set(0, 1, 0);
      controls.object.position.copy(camera.position);
      controls.target.set(0, 0, 0);
      controls.minDistance = DEFAULT_CONTROL_MIN_DISTANCE;
      controls.maxDistance = DEFAULT_CONTROL_MAX_DISTANCE;
      controls.update();
      clearFeatureSearchResults(true);
      scenePopup.hidden = true;
      scenePopupAnchor.hidden = true;
      activePopupFeature = null;
      hoverTooltip.hidden = true;
      syncScenePopupSelectionStyle(null);
      syncMoonViewerPopup(null, false);
      activePopupIsCoreLabel = false;
      setStatus("Returned to the default global view.");
    }

    function reloadToDefaultGlobalView(camera, controls) {
      resumeSpin();
      resetExploreView(camera, controls);
      viewerApplyJupiterViewMode?.(jupiterViewModeSelect ? jupiterViewModeSelect.value : "tilted");
      controls.saveState();
    }

    function closeScenePopup() {
      scenePopup.hidden = true;
      scenePopupAnchor.hidden = true;
      activePopupFeature = null;
      hoverTooltip.hidden = true;
      syncScenePopupSelectionStyle(null);
      syncMoonViewerPopup(null, false);
      viewerSyncSelectionHalo?.();
    }

    function downloadCsv(filename, rows) {
      const csv = rows
        .map((row) => row.map((value) => {
          const cell = String(value ?? "");
          return /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
        }).join(","))
        .join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }

    function getSelectedBaseLayer(baseLayers) {
      return baseLayers.find((layer) => layer.id === baseLayerSelect.value) || null;
    }

    function getSelectedGeologyLayer(geologyLayers) {
      return Array.isArray(geologyLayers) && geologyLayers.length ? geologyLayers[0] : null;
    }

    function getSelectedMineralLayer(mineralLayers) {
      return mineralLayers.find((layer) => layer.id === mineralSelect.value) || null;
    }

    function syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState = null) {
      if (coreWrap) coreWrap.hidden = !coreToggle.checked;
      if (coreViewSection) coreViewSection.open = coreToggle.checked;
      const coreActive = coreToggle.checked;
      if (surfaceConditionsEl) surfaceConditionsEl.hidden = coreActive;
      if (interiorConditionsEl) {
        interiorConditionsEl.hidden = !coreActive;
        if (!coreActive && icDepth) {
          icDepth.textContent = "—"; icLayer.textContent = "—";
          icTemp.textContent = "—"; icPressure.textContent = "—";
        }
      }
      renderLegendPanel(buildLegendEntries(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState));
      currentMetadataState = buildMetadataState(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      metadataButton.textContent = currentMetadataState?.sections?.some((section) => section.title === "Legend")
        ? "Open Metadata And Legend"
        : "Open Metadata";
      if (!metadataModal.hidden) {
        renderMetadataModal(currentMetadataState);
      }
    }

    function normalizeFeatureType(type) {
      if (!type) return null;
      const t = type.trim();
      const IAU_PLAIN = {
        "chasma":         "Canyon",
        "chasmata":       "Canyon system",
        "fossa":          "Fracture trench",
        "fossae":         "Fracture trench system",
        "mons":           "Mountain",
        "montes":         "Mountain range",
        "tholus":         "Dome-shaped hill",
        "tholi":          "Dome-shaped hills",
        "sulcus":         "Fracture groove system",
        "sulci":          "Fracture groove systems",
        "linea":          "Linear ridge",
        "lineae":         "Linear ridge system",
        "dorsum":         "Ridge",
        "dorsa":          "Ridge system",
        "rupes":          "Cliff / scarp",
        "scopulus":       "Irregular escarpment",
        "scopuli":        "Irregular escarpments",
        "labyrinthus":    "Valley complex",
        "vallis":         "Valley",
        "valles":         "Valley system",
        "lacus":          "Lake",
        "palus":          "Marsh",
        "paludes":        "Marshes",
        "mare":           "Sea",
        "maria":          "Seas",
        "sinus":          "Bay",
        "fretum":         "Strait",
        "flumen":         "River channel",
        "flumina":        "River channel system",
        "planitia":       "Plain",
        "planitiae":      "Plains",
        "planum":         "Plateau",
        "terra":          "Highland region",
        "terrae":         "Highland regions",
        "regio":          "Region",
        "regiones":       "Regions",
        "mensa":          "Mesa",
        "mensae":         "Mesas",
        "collis":         "Hill",
        "colles":         "Hills",
        "cavus":          "Hollow / pit",
        "cavi":           "Hollows / pits",
        "catena":         "Crater chain",
        "catenae":        "Crater chains",
        "patera":         "Volcanic depression",
        "paterae":        "Volcanic depressions",
        "fluctus":        "Lava flow",
        "crater":         "Impact crater",
        "impact crater":  "Impact crater",
        "albedo feature": "Albedo region",
        "facula":         "Bright spot",
        "faculae":        "Bright spots",
        "macula":         "Dark spot",
        "maculae":        "Dark spots",
        "corona":         "Ovoid terrain",
        "coronae":        "Ovoid terrain features",
        "plume":          "Eruptive plume",
        "plumes":         "Eruptive plumes",
      };
      const key = t.toLowerCase();
      if (IAU_PLAIN[key]) return IAU_PLAIN[key];
      return t;
    }

    function openFeature(feature, isCoreLabel) {
      syncScenePopupSelectionStyle(feature, Boolean(isCoreLabel));
      if (isCoreLabel) {
        scenePopupKicker.textContent = normalizeFeatureType(feature.type) || "Selected Feature";
      } else {
        scenePopupKicker.textContent = normalizeFeatureType(feature.type) || (
          feature.theme === "volcanic"
            ? "Volcanic Feature"
            : feature.theme === "landing" || feature.theme === "mission"
              ? "Mission Location"
              : "Surface Feature"
        );
      }
      scenePopupTitle.textContent = (
        feature.type === "Geologic unit polygon" && feature.rock_type
          ? feature.rock_type
          : feature.name
      );
      if (feature.moon_name && feature.lat !== undefined) {
        const elevStr = (feature.elevation_m !== undefined)
          ? ` | ${feature.elevation_m >= 0 ? "+" : ""}${feature.elevation_m.toLocaleString()} m`
          : "";
        scenePopupMeta.textContent = `${feature.moon_name} | ${feature.lat.toFixed(2)}°, ${moonLonToW(feature.lon, feature.moon_name).toFixed(2)}°W${elevStr}`;
      } else if (feature.lat !== undefined) {
        const elevStr = (feature.elevation_m !== undefined)
          ? ` | ${feature.elevation_m >= 0 ? "+" : ""}${feature.elevation_m.toLocaleString()} m`
          : "";
        scenePopupMeta.textContent = `${feature.lat.toFixed(2)}°, ${feature.lon.toFixed(2)}°E${elevStr}`;
      } else if (feature.moon_name && feature.anchor_lat !== undefined && feature.anchor_lon !== undefined) {
        scenePopupMeta.textContent = `${feature.moon_name} | ${feature.anchor_lat.toFixed(2)}°, ${moonLonToW(feature.anchor_lon, feature.moon_name).toFixed(2)}°W`;
      } else if (feature.anchor_lat !== undefined && feature.anchor_lon !== undefined) {
        scenePopupMeta.textContent = `${feature.anchor_lat.toFixed(2)}°, ${feature.anchor_lon.toFixed(2)}°E`;
      } else if (feature.ring_region) {
        scenePopupMeta.textContent = feature.ring_region;
      } else if (feature.orbit_distance_km) {
        scenePopupMeta.textContent = `orbit ${feature.orbit_distance_km}`;
      } else {
        scenePopupMeta.textContent = "";
      }
      scenePopupCopy.textContent = (
        feature.type === "Geologic unit polygon"
          ? (feature.unit_description || feature.description || "")
          : feature.moon_name
            ? formatMoonFeatureDescription(feature)
            : (feature.description || "")
      );
      // Extra detail rows (depth, composition, temperature)
      scenePopupDetail.innerHTML = "";
      const extraFields = [
        feature.rock_type ? ["Rock type", feature.rock_type] : null,
        feature.rock_type_detail ? ["Rock detail", feature.rock_type_detail] : null,
        feature.unit        ? ["Unit",        feature.unit]        : null,
        feature.unit_description ? ["Unit name", feature.unit_description] : null,
        feature.contact_type ? ["Contact type", feature.contact_type] : null,
        feature.origin      ? ["Origin",      feature.origin]      : null,
        feature.interpretation ? ["Interpretation", feature.interpretation] : null,
        feature.preservation ? ["Preservation", feature.preservation] : null,
        feature.dimension   ? ["Dimension",   feature.dimension]   : null,
        feature.region      ? ["Region",      feature.region]      : null,
        feature.ring_region ? ["Ring region", feature.ring_region] : null,
        feature.ring_radius_km ? ["Ring span", feature.ring_radius_km] : null,
        feature.mean_radius_km ? ["Moon radius", feature.mean_radius_km] : null,
        feature.orbit_distance_km ? ["Orbital distance", feature.orbit_distance_km] : null,
        feature.magnitude_label ? ["Magnitude", feature.magnitude_label] : null,
        feature.catalog_status ? ["Catalog status", feature.catalog_status] : null,
        feature.event_time  ? ["Event time",  feature.event_time]  : null,
        feature.length_km   ? ["Mapped length", `${feature.length_km.toLocaleString()} km`] : null,
        feature.mapped_area_km2 ? ["Mapped area", `${feature.mapped_area_km2.toLocaleString()} km²`] : null,
        feature.depth       ? ["Depth",       feature.depth]       : null,
        feature.composition ? ["Composition", feature.composition] : null,
        feature.temperature ? ["Temperature", feature.temperature] : null,
      ].filter(Boolean);
      if (extraFields.length > 0) {
        for (const [key, val] of extraFields) {
          const row = document.createElement("div");
          row.className = "scene-popup-detail-row";
          row.innerHTML = `<span class="scene-popup-detail-key">${key}</span>`
                        + `<span class="scene-popup-detail-val">${val}</span>`;
          scenePopupDetail.appendChild(row);
        }
        scenePopupDetail.hidden = false;
      } else {
        scenePopupDetail.hidden = true;
      }
      activePopupFeature = feature;
      activePopupIsCoreLabel = Boolean(isCoreLabel);
      scenePopup.hidden = false;
      scenePopupAnchor.hidden = false;
      syncMoonViewerPopup(feature, Boolean(isCoreLabel));
      viewerSyncSelectionHalo?.();
    }

    function buildSunObject() {
      const SUN_DIR = new THREE.Vector3(8, 4, 6).normalize();
      const SUN_DIST = 180;
      const sunPos = SUN_DIR.clone().multiplyScalar(SUN_DIST);
      const sunVisual = new THREE.Mesh(
        new THREE.SphereGeometry(1.8, 20, 20),
        new THREE.MeshBasicMaterial({ color: 0xfffdf7, transparent: true, opacity: 0.95 }),
      );
      sunVisual.position.copy(sunPos);
      sunVisual.userData.nonInteractive = true;
      sunVisual.raycast = () => {};
      return sunVisual;
    }

    function buildStarfield(THREERef) {
      const starCount = 5000;
      const positions = new Float32Array(starCount * 3);
      for (let i = 0; i < starCount; i += 1) {
        const radius = 140 + Math.random() * 180;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        positions[(i * 3)] = radius * Math.sin(phi) * Math.cos(theta);
        positions[(i * 3) + 1] = radius * Math.cos(phi);
        positions[(i * 3) + 2] = radius * Math.sin(phi) * Math.sin(theta);
      }

      const starCanvas = document.createElement("canvas");
      starCanvas.width = 16;
      starCanvas.height = 16;
      const ctx = starCanvas.getContext("2d");
      const grd = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.4, "rgba(255,255,255,0.8)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(8, 8, 8, 0, Math.PI * 2);
      ctx.fill();

      const geometry = new THREERef.BufferGeometry();
      geometry.setAttribute("position", new THREERef.BufferAttribute(positions, 3));
      const material = new THREERef.PointsMaterial({
        color: 0xf3f7ff,
        size: 0.55,
        sizeAttenuation: true,
        map: new THREERef.CanvasTexture(starCanvas),
        transparent: true,
        alphaTest: 0.01,
      });
      return new THREERef.Points(geometry, material);
    }

    function createRenderer(THREERef) {
      const attempts = [
        { antialias: true, powerPreference: "high-performance" },
        { antialias: false, powerPreference: "high-performance" },
        { antialias: false, powerPreference: "low-power" },
      ];
      let lastError = null;
      for (const options of attempts) {
        try {
          return new THREERef.WebGLRenderer(options);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("Error creating WebGL context.");
    }

    // ── Shared GLSL utilities injected into every fragment shader ────────────
    const GLSL_NOISE = `
      float h21(vec2 p){p=fract(p*vec2(127.1,311.7));p+=dot(p,p+45.32);return fract(p.x*p.y);}
      float vnoise(vec2 p){
        vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),
                   mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);
      }
      float fbm(vec2 p){float v=0.;float a=0.5;
        for(int i=0;i<6;i++){v+=a*vnoise(p);p*=2.15;a*=0.5;}return v;}
      float ridged(vec2 p){
        float v=0.; float a=0.5;
        for(int i=0;i<5;i++){
          float n=1.0-abs(vnoise(p)*2.0-1.0);
          v+=n*a; p*=2.05; a*=0.5;
        }
        return v;
      }
      vec2 swirl(vec2 p, float amount){
        float a = amount * (fbm(p*0.6) - 0.5) * 6.28318;
        float s = sin(a), c = cos(a);
        return mat2(c,-s,s,c) * p;
      }
    `;

    // Shared vertex shader for all four layer shaders
    const LAYER_VERT = `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main(){
        vUv=uv;
        vNormal=normalize(normalMatrix*normal);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
      }
    `;

    // ── CRUST: outer atmosphere — cyan-blue gas shell ──────────────────────
    const CRUST_FRAG = `
      varying vec2 vUv;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main(){
        vec3 nn = normalize(vNormal);
        vec3 w = abs(nn); w = pow(w, vec3(4.0)); w /= w.x + w.y + w.z;
        vec2 px = swirl(nn.yz * 3.1 + vec2(0.4, 4.6), 0.38);
        vec2 py = swirl(nn.xz * 3.1 + vec2(3.1, 1.3), 0.38);
        vec2 pz = swirl(nn.xy * 3.1 + vec2(6.7, 7.5), 0.38);
        float bulk = fbm(px * 1.25) * w.x + fbm(py * 1.25) * w.y + fbm(pz * 1.25) * w.z;
        float plumeA = ridged(px * 2.3) * w.x + ridged(py * 2.3) * w.y + ridged(pz * 2.3) * w.z;
        float plumeB = fbm(px * 2.8 + vec2(1.7, 4.9)) * w.x + fbm(py * 2.8 + vec2(1.7, 4.9)) * w.y + fbm(pz * 2.8 + vec2(1.7, 4.9)) * w.z;
        float cells = fbm(px * 4.6 + vec2(7.3, 2.2)) * w.x + fbm(py * 4.6 + vec2(7.3, 2.2)) * w.y + fbm(pz * 4.6 + vec2(7.3, 2.2)) * w.z;
        float overturn = smoothstep(0.42, 0.80, bulk + plumeA * 0.34 - plumeB * 0.16);
        float wisps = pow(max(plumeA - 0.58, 0.0) * 2.1, 1.6);
        float weakBands = 0.5 + 0.5 * sin(nn.y * 8.0 + plumeB * 1.3);
        vec3 pale  = vec3(0.60,0.82,0.92);
        vec3 mid   = vec3(0.48,0.74,0.88);
        vec3 deep  = vec3(0.36,0.62,0.78);
        vec3 shadow= vec3(0.28,0.52,0.70);
        vec3 col = mix(shadow, deep, bulk * 0.46 + plumeB * 0.10);
        col = mix(col, mid, overturn * 0.34 + cells * 0.08);
        col = mix(col, pale, wisps * 0.14 + weakBands * 0.08);
        float haze = pow(1.0 - abs(dot(nn, vec3(0.0,0.0,1.0))), 1.8);
        col += vec3(0.10,0.14,0.18) * haze * 0.28;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    // ── MANTLE: inner atmosphere — warm brown convection (Saturn palette) ──
    const MANTLE_FRAG = `
      varying vec2 vUv;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main(){
        vec3 nn = normalize(vNormal);
        vec3 w = abs(nn); w = pow(w, vec3(4.0)); w /= w.x + w.y + w.z;
        vec2 px = swirl(nn.yz * 3.5 + vec2(1.2, 4.0), 0.42);
        vec2 py = swirl(nn.xz * 3.5 + vec2(5.6, 2.2), 0.42);
        vec2 pz = swirl(nn.xy * 3.5 + vec2(2.8, 8.6), 0.42);
        float bulk = fbm(px * 1.35) * w.x + fbm(py * 1.35) * w.y + fbm(pz * 1.35) * w.z;
        float convection = fbm(px * 2.4 + vec2(5.2, 1.1)) * w.x + fbm(py * 2.4 + vec2(5.2, 1.1)) * w.y + fbm(pz * 2.4 + vec2(5.2, 1.1)) * w.z;
        float overturn = ridged(px * 2.8) * w.x + ridged(py * 2.8) * w.y + ridged(pz * 2.8) * w.z;
        float plumes = pow(max(overturn - 0.54, 0.0) * 2.2, 1.5);
        float eddies = fbm(px * 5.0 + vec2(8.1, 3.9)) * w.x + fbm(py * 5.0 + vec2(8.1, 3.9)) * w.y + fbm(pz * 5.0 + vec2(8.1, 3.9)) * w.z;
        float weakBands = 0.5 + 0.5 * sin(nn.y * 6.5 + convection * 1.2);
        vec3 deep = vec3(0.24,0.18,0.14);
        vec3 fluid = vec3(0.36,0.28,0.22);
        vec3 amber = vec3(0.49,0.40,0.31);
        vec3 mist = vec3(0.60,0.52,0.41);
        vec3 col = mix(deep, fluid, bulk * 0.52 + convection * 0.10);
        col = mix(col, amber, plumes * 0.26 + eddies * 0.08);
        col = mix(col, mist, smoothstep(0.48, 0.84, bulk + overturn * 0.24) * 0.12 + weakBands * 0.06);
        vec3 upperBlend = vec3(0.78,0.67,0.54);
        float lift = smoothstep(0.52, 0.96, bulk + convection * 0.22);
        col = mix(col, upperBlend, lift * 0.18);
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    // ── OUTER CORE: fluid layer — metallic hydrogen, warm golden-tan (Saturn palette) ──
    const CORE_FRAG = `
      varying vec2 vUv;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      float cellField(vec2 p){
        vec2 g=floor(p), f=fract(p);
        float md=8.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
          vec2 c=vec2(x,y);
          vec2 o=vec2(h21(g+c),h21(g+c+vec2(9.7,5.3)));
          vec2 d=c+o-f;
          md=min(md,length(d));
        }
        return md;
      }
      void main(){
        vec3 nn=normalize(vNormal);
        vec3 w=abs(nn); w=pow(w,vec3(4.0)); w/=w.x+w.y+w.z;
        vec2 px = swirl(nn.yz*4.1 + vec2(1.9,3.1), 0.20);
        vec2 py = swirl(nn.xz*4.1 + vec2(5.1,7.2), 0.20);
        vec2 pz = swirl(nn.xy*4.1 + vec2(8.2,1.5), 0.20);
        float flow = fbm(px*2.0)*w.x + fbm(py*2.0)*w.y + fbm(pz*2.0)*w.z;
        float cells = cellField(px*2.4)*w.x + cellField(py*2.4)*w.y + cellField(pz*2.4)*w.z;
        float walls = 1.0 - smoothstep(0.07, 0.16, cells);
        float bands = 0.5 + 0.5*sin(nn.y*13.0 + flow*3.0);
        vec3 deep  = vec3(0.52,0.56,0.60);
        vec3 mid   = vec3(0.62,0.66,0.70);
        vec3 bright= vec3(0.72,0.75,0.78);
        vec3 pale  = vec3(0.82,0.84,0.87);
        vec3 col = mix(deep, mid, flow);
        col = mix(col, bright, bands * 0.26);
        col = mix(col, pale, walls * 0.22);
        float sheen = pow(1.0 - abs(dot(nn, vec3(0.0,0.0,1.0))), 3.0);
        col += vec3(0.10,0.12,0.14) * sheen * 0.28;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    // ── INNER CORE: hot rock/iron/ice center — red-orange glow ───────────
    const INNER_CORE_FRAG = `
      varying vec2 vUv;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float base = fbm(vUv * 6.0 + vec2(1.8, 4.2));
        float grain = ridged(vUv * 10.0 + vec2(6.1, 2.7));
        float veins = pow(abs(sin((p.x + p.y) * 6.0 + fbm(vUv * 7.0) * 3.0)), 9.0);
        vec3 dark = vec3(0.55,0.10,0.04);
        vec3 mid  = vec3(0.72,0.22,0.08);
        vec3 pale = vec3(0.85,0.38,0.14);
        vec3 hot  = vec3(0.90,0.55,0.25);
        vec3 col = mix(dark, mid, base);
        col = mix(col, pale, grain * 0.34);
        col = mix(col, hot, veins * 0.14);
        float center = pow(clamp(1.0 - length(p), 0.0, 1.0), 2.2);
        col += vec3(0.18,0.08,0.02) * center * 0.40;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const SECTION_FACE_VERT = `
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const CRUST_SECTION_FRAG = `
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        vec2 flow = swirl(p * 2.0 + vec2(0.8, 0.3), 0.34);
        float bulk = fbm(flow * 1.7 + vec2(2.6, 6.8));
        float plumes = ridged(flow * 2.9 + vec2(5.4, 1.7));
        float cells = fbm(flow * 5.1 + vec2(6.0, 0.8));
        float overturn = smoothstep(0.44, 0.82, bulk + plumes * 0.32);
        float weakBands = 0.5 + 0.5 * sin(p.y * 9.2 + bulk * 1.7);
        float strongBands = 0.5 + 0.5 * sin(p.y * 15.0 + cells * 1.6 + 0.7);
        float polarFade = smoothstep(0.2, 1.0, abs(p.y));
        vec3 pale   = vec3(0.60,0.82,0.92);
        vec3 bright = vec3(0.48,0.74,0.88);
        vec3 mid    = vec3(0.40,0.66,0.82);
        vec3 deep   = vec3(0.30,0.56,0.74);
        vec3 shadow = vec3(0.22,0.46,0.66);
        vec3 col = mix(shadow, deep, bulk * 0.26 + cells * 0.04);
        col = mix(col, mid, overturn * 0.34);
        col = mix(col, bright, weakBands * 0.26 + strongBands * 0.14 + pow(max(plumes - 0.56, 0.0) * 2.0, 1.4) * 0.12);
        col = mix(col, pale, smoothstep(0.70, 0.99, r) * 0.30 + polarFade * 0.05);
        col += vec3(0.08,0.10,0.14) * smoothstep(0.84, 1.0, r);
        col *= 1.0 - smoothstep(0.92, 1.02, r) * 0.06;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const MANTLE_SECTION_FRAG = `
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        vec2 flow = swirl(p * 2.1 + vec2(0.1, 0.5), 0.36);
        float bulk = fbm(flow * 1.8 + vec2(1.9, 5.6));
        float convection = fbm(flow * 3.0 + vec2(4.1, 0.9));
        float plumes = ridged(flow * 3.4 + vec2(7.2, 2.6));
        float eddies = fbm(flow * 5.4 + vec2(2.3, 8.1));
        float weakBands = 0.5 + 0.5 * sin(p.y * 4.8 + convection * 1.0);
        vec3 deep = vec3(0.24,0.18,0.14);
        vec3 fluid = vec3(0.36,0.28,0.22);
        vec3 amber = vec3(0.49,0.40,0.31);
        vec3 mist = vec3(0.60,0.52,0.41);
        vec3 col = mix(deep, fluid, bulk * 0.50 + convection * 0.10);
        col = mix(col, amber, pow(max(plumes - 0.55, 0.0) * 2.1, 1.45) * 0.24 + eddies * 0.06);
        col = mix(col, mist, smoothstep(0.50, 0.86, bulk + plumes * 0.18) * 0.10 + weakBands * 0.05);
        vec3 upperBlend = vec3(0.80,0.69,0.56);
        float outward = smoothstep(0.58, 0.98, r);
        col = mix(col, upperBlend, outward * 0.24);
        col *= 1.0 - smoothstep(0.92, 1.02, r) * 0.05;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const CORE_SECTION_FRAG = `
      varying vec2 vUv;
      ${GLSL_NOISE}
      float cell(vec2 p){
        vec2 g=floor(p), f=fract(p);
        float md=9.0;
        for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
          vec2 c=vec2(x,y);
          vec2 o=vec2(h21(g+c),h21(g+c+vec2(9.7,5.3)));
          md=min(md, length(c + o - f));
        }
        return md;
      }
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        vec2 flow = swirl(p * 1.8, 0.20);
        float bulk = fbm(flow * 2.1 + vec2(2.0, 5.1));
        float cells = cell(flow * 2.5);
        float walls = 1.0 - smoothstep(0.07, 0.16, cells);
        float bands = 0.5 + 0.5 * sin(p.y * 12.0 + bulk * 2.8);
        vec3 deep  = vec3(0.52,0.56,0.60);
        vec3 mid   = vec3(0.62,0.66,0.70);
        vec3 bright= vec3(0.72,0.75,0.78);
        vec3 pale  = vec3(0.82,0.84,0.87);
        vec3 col = mix(deep, mid, bulk);
        col = mix(col, bright, bands * 0.22);
        col = mix(col, pale, walls * 0.18);
        col *= 1.0 - smoothstep(0.88, 1.02, r) * 0.10;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    // ── FLUID TRANSITION: gradual H molecular→metallic transition ─────────
    const FLUID_TRANSITION_FRAG = `
      varying vec2 vUv;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main(){
        vec3 nn = normalize(vNormal);
        vec3 w = abs(nn); w = pow(w, vec3(4.0)); w /= w.x + w.y + w.z;
        vec2 px = swirl(nn.yz * 3.8 + vec2(2.1, 5.3), 0.32);
        vec2 py = swirl(nn.xz * 3.8 + vec2(6.4, 1.8), 0.32);
        vec2 pz = swirl(nn.xy * 3.8 + vec2(4.7, 7.1), 0.32);
        float bulk = fbm(px * 1.60) * w.x + fbm(py * 1.60) * w.y + fbm(pz * 1.60) * w.z;
        float convection = fbm(px * 2.7 + vec2(3.3, 0.8)) * w.x + fbm(py * 2.7 + vec2(3.3, 0.8)) * w.y + fbm(pz * 2.7 + vec2(3.3, 0.8)) * w.z;
        float overturn = ridged(px * 3.1) * w.x + ridged(py * 3.1) * w.y + ridged(pz * 3.1) * w.z;
        float weakBands = 0.5 + 0.5 * sin(nn.y * 7.0 + convection * 1.1);
        vec3 deep  = vec3(0.22,0.38,0.62);
        vec3 mid   = vec3(0.30,0.48,0.70);
        vec3 light = vec3(0.40,0.56,0.76);
        vec3 pale  = vec3(0.50,0.64,0.80);
        vec3 col = mix(deep, mid, bulk * 0.54 + convection * 0.10);
        col = mix(col, light, pow(max(overturn - 0.52, 0.0) * 2.1, 1.4) * 0.22 + weakBands * 0.06);
        col = mix(col, pale, smoothstep(0.52, 0.88, bulk + overturn * 0.20) * 0.10);
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const FLUID_TRANSITION_SECTION_FRAG = `
      varying vec2 vUv;
      ${GLSL_NOISE}
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        vec2 flow = swirl(p * 2.0 + vec2(1.2, 0.6), 0.32);
        float bulk = fbm(flow * 1.9 + vec2(3.1, 4.7));
        float convection = fbm(flow * 3.2 + vec2(5.0, 1.2));
        float plumes = ridged(flow * 3.6 + vec2(6.8, 2.1));
        float weakBands = 0.5 + 0.5 * sin(p.y * 5.6 + convection * 1.1);
        vec3 deep  = vec3(0.22,0.38,0.62);
        vec3 mid   = vec3(0.30,0.48,0.70);
        vec3 light = vec3(0.40,0.56,0.76);
        vec3 pale  = vec3(0.50,0.64,0.80);
        vec3 col = mix(deep, mid, bulk * 0.52 + convection * 0.10);
        col = mix(col, light, pow(max(plumes - 0.53, 0.0) * 2.1, 1.4) * 0.22 + weakBands * 0.05);
        col = mix(col, pale, smoothstep(0.54, 0.90, bulk + plumes * 0.18) * 0.10);
        float outward = smoothstep(0.62, 1.00, r);
        col = mix(col, pale, outward * 0.20);
        col *= 1.0 - smoothstep(0.92, 1.02, r) * 0.05;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    function buildCutawayInterior(radius, layerData, elevationMap, terrainRelief) {
      const group = new THREE.Group();
      const labelsGroup = new THREE.Group();
      group.add(labelsGroup);
      const interactiveObjects = [];
      const labelEntries = [];

      const phiStart = -Math.PI / 2;
      const phiLength = Math.PI;
      const JUPITER_INNER_CORE_RADIUS        = 0.12;
      const JUPITER_FLUID_LAYER_RADIUS        = 0.80;
      const JUPITER_FLUID_TRANSITION_RADIUS   = 0.835;
      const JUPITER_INNER_ATMO_RADIUS         = 0.95;

      // ── Inner core: hot rock/iron/ice sphere ─────────────────────────────
      const innerCoreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * JUPITER_INNER_CORE_RADIUS, 96, 96, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: INNER_CORE_FRAG,
          side: THREE.DoubleSide,
        }),
      );
      innerCoreMesh.rotation.y = Math.PI;
      group.add(innerCoreMesh);

      // ── Fluid layer: fully metallic H/He, darker gray ────────────────────
      const outerCoreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * JUPITER_FLUID_LAYER_RADIUS, 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: CORE_FRAG,
          side: THREE.DoubleSide,
        }),
      );
      outerCoreMesh.rotation.y = Math.PI;
      group.add(outerCoreMesh);

      // ── Fluid transition zone: molecular→metallic transition ─────────────
      const fluidTransitionMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * JUPITER_FLUID_TRANSITION_RADIUS, 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: FLUID_TRANSITION_FRAG,
          side: THREE.BackSide,
        }),
      );
      fluidTransitionMesh.rotation.y = Math.PI;
      group.add(fluidTransitionMesh);

      // ── Fluid transition inner boundary: wall against the fluid layer ─────
      const fluidTransitionInnerBoundaryMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * (JUPITER_FLUID_LAYER_RADIUS + 0.002), 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: FLUID_TRANSITION_FRAG,
          side: THREE.FrontSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      fluidTransitionInnerBoundaryMesh.rotation.y = Math.PI;
      group.add(fluidTransitionInnerBoundaryMesh);

      // ── Inner atmosphere outer shell ─────────────────────────────────────
      const mantleMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * JUPITER_INNER_ATMO_RADIUS, 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: MANTLE_FRAG,
          side: THREE.BackSide,
        }),
      );
      mantleMesh.rotation.y = Math.PI;
      group.add(mantleMesh);

      // ── Inner atmosphere inner boundary: wall against the fluid transition ──
      const mantleInnerBoundaryMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * (JUPITER_FLUID_TRANSITION_RADIUS + 0.002), 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: MANTLE_FRAG,
          side: THREE.FrontSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      mantleInnerBoundaryMesh.rotation.y = Math.PI;
      group.add(mantleInnerBoundaryMesh);

      // ── Outer atmosphere shell: fills gap between inner atmo and surface ──
      const crustMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: CRUST_FRAG,
          side: THREE.BackSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
      crustMesh.rotation.y = Math.PI;
      group.add(crustMesh);

      // ── Outer atmosphere inner boundary: wall against the inner atmosphere ──
      const crustInnerBoundaryMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * JUPITER_INNER_ATMO_RADIUS, 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: CRUST_FRAG,
          side: THREE.FrontSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      crustInnerBoundaryMesh.rotation.y = Math.PI;
      group.add(crustInnerBoundaryMesh);

      // ── Cross-section face rings at x=0 plane ────────────────────────────
      const CAP_X = -0.012;
      const crustInnerRadius  = radius * JUPITER_INNER_ATMO_RADIUS;
      const crustOuterRadius  = radius + (elevationMap ? terrainRelief : 0);
      const capDefs = [
        { outer: crustOuterRadius,                           inner: crustInnerRadius,                           fragmentShader: CRUST_SECTION_FRAG },
        { outer: crustInnerRadius,                           inner: radius * JUPITER_FLUID_TRANSITION_RADIUS,   fragmentShader: MANTLE_SECTION_FRAG },
        { outer: radius * JUPITER_FLUID_TRANSITION_RADIUS,  inner: radius * JUPITER_FLUID_LAYER_RADIUS,        fragmentShader: FLUID_TRANSITION_SECTION_FRAG },
        { outer: radius * JUPITER_FLUID_LAYER_RADIUS,       inner: radius * JUPITER_INNER_CORE_RADIUS,         fragmentShader: CORE_SECTION_FRAG },
      ];
      let crustRing             = null;
      let molecularEnvelopeRing = null;
      let fluidTransitionRing   = null;
      let metallicHydrogenRing  = null;
      for (const cap of capDefs) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(cap.inner, cap.outer, 128),
          new THREE.ShaderMaterial({
            uniforms: {},
            vertexShader: SECTION_FACE_VERT,
            fragmentShader: cap.fragmentShader,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
        );
        ring.rotation.y = Math.PI / 2;
        ring.position.x = CAP_X;
        if (cap.inner === crustInnerRadius) {
          crustRing = ring;
          ring.position.x = 0;
          ring.renderOrder = 4;
        } else if (cap.outer === crustInnerRadius) {
          molecularEnvelopeRing = ring;
        } else if (cap.inner === radius * JUPITER_FLUID_LAYER_RADIUS) {
          fluidTransitionRing = ring;
        } else {
          metallicHydrogenRing = ring;
        }
        group.add(ring);
      }

      // Fluid layer cap disk
      const fluidCapMat = new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: SECTION_FACE_VERT,
        fragmentShader: CORE_SECTION_FRAG,
        side: THREE.DoubleSide,
      });
      const fluidCapDisk = new THREE.Mesh(
        new THREE.CircleGeometry(radius * JUPITER_FLUID_LAYER_RADIUS, 128),
        fluidCapMat,
      );
      fluidCapDisk.rotation.y = Math.PI / 2;
      fluidCapDisk.position.x = CAP_X - 0.001;
      group.add(fluidCapDisk);

      // Inner core centre cap disk
      const innerCapMat = new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: LAYER_VERT,
        fragmentShader: INNER_CORE_FRAG,
        side: THREE.DoubleSide,
      });
      const innerCapDisk = new THREE.Mesh(
        new THREE.CircleGeometry(radius * JUPITER_INNER_CORE_RADIUS, 96),
        innerCapMat,
      );
      innerCapDisk.rotation.y = Math.PI / 2;
      innerCapDisk.position.x = CAP_X - 0.002;
      group.add(innerCapDisk);

      // ── Layer labels ───────────────────────────────────────────────────────
      if (layerData && layerData.length > 0) {
        const markerGeo = new THREE.SphereGeometry(0.06, 10, 10);
        const hitGeo = new THREE.SphereGeometry(0.28, 10, 10);
        const hitMat = new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0.01, depthTest: false, depthWrite: false,
        });

        const markerMat = new THREE.MeshBasicMaterial({ color: 0xffcf9d });
        for (const layer of layerData) {
          const ly = layer.labelY;

          // Dot marker at the layer surface on the cut face
          const dot = new THREE.Mesh(markerGeo, markerMat.clone());
          dot.position.set(CAP_X, layer.anchorY, 0);
          dot.userData.feature = layer;
          labelsGroup.add(dot);

          // Invisible hit sphere (bigger, easier to click)
          const hit = new THREE.Mesh(hitGeo, hitMat.clone());
          hit.position.set(CAP_X, layer.anchorY, 0);
          hit.userData.feature = layer;
          labelsGroup.add(hit);
          interactiveObjects.push(hit, dot);

          // Text sprite label — sprite center = line endpoint for correct billboard alignment
          const labelTex = makeLabelTexture(layer.name);
          const _sw = (labelTex.width / 200) * 1.4;
          const _sh = (labelTex.height / 200) * 1.4;
          const spriteCX = layer.labelX - _sw * 0.5;

          // Connector line: from layer surface to the sprite center
          const lineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(CAP_X, layer.anchorY, 0),
            new THREE.Vector3(spriteCX, ly, 0),
          ]);
          const lineMat = new THREE.LineBasicMaterial({
            color: 0xffcf9d, transparent: true, opacity: 0.45,
          });
          const line = new THREE.Line(lineGeo, lineMat);
          labelsGroup.add(line);

          const spriteMat = new THREE.SpriteMaterial({
            map: labelTex.texture, transparent: true, opacity: 0.88,
            depthTest: true, depthWrite: false,
          });
          const sprite = new THREE.Sprite(spriteMat);
          sprite.scale.set(_sw, _sh, 1);
          sprite.position.set(spriteCX, ly, 0);
          sprite.userData.feature = layer;
          labelsGroup.add(sprite);
          interactiveObjects.push(sprite);
          labelEntries.push({ dot, hit, line, sprite, layerId: layer.id });
        }
      }

      group.visible = false;
      return {
        group,
        labelsGroup,
        interactiveObjects,
        labelEntries,
        crustRing,
        crustInnerRadius,
        crustRadius: radius,
        atmosphereMesh: crustMesh,
        atmosphereBoundaryMesh: crustInnerBoundaryMesh,
        molecularEnvelopeMesh: mantleMesh,
        molecularBoundaryMesh: mantleInnerBoundaryMesh,
        molecularEnvelopeRing: molecularEnvelopeRing,
        fluidTransitionMesh,
        fluidTransitionBoundaryMesh: fluidTransitionInnerBoundaryMesh,
        fluidTransitionRing,
        metallicHydrogenMesh: outerCoreMesh,
        metallicHydrogenCapMesh: fluidCapDisk,
        metallicHydrogenRing: metallicHydrogenRing,
        heavyElementCoreMesh: innerCoreMesh,
        heavyElementCoreCapMesh: innerCapDisk,
      };
    }

    function buildJupiterSolidInterior(radius) {
      const group = new THREE.Group();
      const CAP_X = -0.0006;

      // Fluid transition zone sphere
      const fluidTransitionMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x5080b8,
        emissive: new THREE.Color(0x081020),
        emissiveIntensity: 0.12,
        roughness: 0.42,
        metalness: 0.55,
        clearcoat: 0.20,
        clearcoatRoughness: 0.28,
      });
      const fluidTransitionCapMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x5888c0,
        emissive: new THREE.Color(0x0a1422),
        emissiveIntensity: 0.14,
        roughness: 0.38,
        metalness: 0.52,
        clearcoat: 0.24,
        clearcoatRoughness: 0.24,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const fluidTransitionSolidMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.835, 128, 128),
        fluidTransitionMaterial,
      );
      fluidTransitionSolidMesh.rotation.y = Math.PI;
      group.add(fluidTransitionSolidMesh);
      const fluidTransitionCapMesh = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.80, radius * 0.835, 128),
        fluidTransitionCapMaterial,
      );
      fluidTransitionCapMesh.rotation.y = Math.PI / 2;
      fluidTransitionCapMesh.position.x = CAP_X;
      fluidTransitionCapMesh.renderOrder = 5;
      fluidTransitionCapMesh.visible = false;
      group.add(fluidTransitionCapMesh);

      // Fluid layer sphere (metallic hydrogen — metallic grey)
      const metallicHydrogenMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xb0bcc8,
        emissive: new THREE.Color(0x181c20),
        emissiveIntensity: 0.18,
        roughness: 0.50,
        metalness: 0.25,
        clearcoat: 0.30,
        clearcoatRoughness: 0.22,
      });
      const metallicHydrogenCapMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xb8c4d0,
        emissive: new THREE.Color(0x1a1e22),
        emissiveIntensity: 0.18,
        roughness: 0.46,
        metalness: 0.25,
        clearcoat: 0.34,
        clearcoatRoughness: 0.20,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const metallicHydrogenMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.80, 128, 128),
        metallicHydrogenMaterial,
      );
      metallicHydrogenMesh.rotation.y = Math.PI;
      group.add(metallicHydrogenMesh);
      const metallicHydrogenCapMesh = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.12, radius * 0.80, 128),
        metallicHydrogenCapMaterial,
      );
      metallicHydrogenCapMesh.rotation.y = Math.PI / 2;
      metallicHydrogenCapMesh.position.x = CAP_X;
      metallicHydrogenCapMesh.renderOrder = 6;
      metallicHydrogenCapMesh.visible = false;
      group.add(metallicHydrogenCapMesh);

      // Inner core sphere (rock/iron/ice at 0.12R)
      const heavyElementCoreMaterial = new THREE.MeshStandardMaterial({
        color: 0xc84020,
        emissive: new THREE.Color(0x4a0a04),
        emissiveIntensity: 0.30,
        roughness: 0.70,
        metalness: 0.10,
      });
      const heavyElementCoreCapMaterial = new THREE.MeshStandardMaterial({
        color: 0xd85030,
        emissive: new THREE.Color(0x540e06),
        emissiveIntensity: 0.32,
        roughness: 0.82,
        metalness: 0.05,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const heavyElementCoreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.12, 96, 96),
        heavyElementCoreMaterial,
      );
      heavyElementCoreMesh.rotation.y = Math.PI;
      group.add(heavyElementCoreMesh);
      const heavyElementCoreCapMesh = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.12, 96),
        heavyElementCoreCapMaterial,
      );
      heavyElementCoreCapMesh.rotation.y = Math.PI / 2;
      heavyElementCoreCapMesh.position.x = CAP_X;
      heavyElementCoreCapMesh.renderOrder = 7;
      heavyElementCoreCapMesh.visible = false;
      group.add(heavyElementCoreCapMesh);

      group.visible = false;
      return {
        group,
        fluidTransitionMesh: fluidTransitionSolidMesh,
        fluidTransitionMaterial,
        fluidTransitionCapMesh,
        fluidTransitionCapMaterial,
        metallicHydrogenMesh,
        metallicHydrogenMaterial,
        metallicHydrogenCapMesh,
        metallicHydrogenCapMaterial,
        heavyElementCoreMesh,
        heavyElementCoreMaterial,
        heavyElementCoreCapMesh,
        heavyElementCoreCapMaterial,
      };
    }

    function syncCutawaySurfaceInterface(cutawayResult, elevationMap, terrainRelief) {
      if (!cutawayResult) {
        return;
      }
      if (cutawayResult.crustRing) {
        const outerRadius = cutawayResult.crustRadius + (elevationMap ? terrainRelief : 0);
        cutawayResult.crustRing.geometry.dispose();
        cutawayResult.crustRing.geometry = new THREE.RingGeometry(
          cutawayResult.crustInnerRadius,
          outerRadius,
          128,
        );
      }
    }

    function applyTerrainRelief(nextTerrainRelief, elevationMap, baseMaterial, geologyMaterial, mineralMaterial, seaMaterial, regionMaskMaterial, cutawayResult) {
      baseMaterial.displacementScale = nextTerrainRelief;
      if (geologyMaterial) {
        geologyMaterial.displacementScale = nextTerrainRelief;
      }
      if (mineralMaterial) {
        mineralMaterial.displacementScale = nextTerrainRelief;
      }
      if (seaMaterial) {
        seaMaterial.displacementScale = nextTerrainRelief;
      }
      if (regionMaskMaterial) {
        regionMaskMaterial.displacementScale = nextTerrainRelief;
      }
      syncCutawaySurfaceInterface(cutawayResult, elevationMap, nextTerrainRelief);
    }

    function updateGeologyVectorLayer(layer) {
      if (layer && typeof layer.rebuild === "function") {
        layer.rebuild();
      }
    }

    function updateCoreLabelVisibility(cutawayResult, camera, labelsEnabled) {
      if (!cutawayResult || !cutawayResult.labelEntries) {
        return;
      }
      const removeAtmosphere = Boolean(geologyToggle && geologyToggle.checked);
      for (const entry of cutawayResult.labelEntries) {
        const hiddenByAtmosphereRemoval = removeAtmosphere
          && (entry.layerId === "outer-atmosphere" || entry.layerId === "inner-atmosphere" || entry.layerId === "fluid-transition");
        const visible = labelsEnabled && !hiddenByAtmosphereRemoval;
        entry.dot.visible = visible;
        entry.hit.visible = visible;
        entry.line.visible = visible;
        entry.sprite.visible = visible;
      }
    }

    function marsLonToSceneLon(lonDegrees) {
      return ((((lonDegrees + 180) % 360) + 360) % 360) - 180;
    }

    function latLonToVector3(latDegrees, lonDegrees, radius) {
      const lat = THREE.MathUtils.degToRad(latDegrees);
      const lon = THREE.MathUtils.degToRad(marsLonToSceneLon(lonDegrees));
      const x = -radius * Math.cos(lat) * Math.cos(lon);
      const y = radius * Math.sin(lat);
      const z = radius * Math.cos(lat) * Math.sin(lon);
      return new THREE.Vector3(x, y, z);
    }

    function makeLabelTexture(labelInput, options = {}) {
      const isObject = typeof labelInput === "object" && labelInput !== null;
      const text = isObject ? (labelInput.name || "") : String(labelInput);
      const theme = options.theme || (isObject ? labelInput.theme : "") || "standard";
      const small = options.small === true;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const backingScale = 4;
      const paddingX = small ? 8 : 14;
      const accentWidth = small ? 4 : 6;
      const bodyLeft = paddingX + accentWidth + (small ? 5 : 7);
      const titleFont = small
        ? "600 10px Orbitron, 'Exo 2', Aldrich, 'Trebuchet MS', sans-serif"
        : "600 15px Orbitron, 'Exo 2', Aldrich, 'Trebuchet MS', sans-serif";
      context.font = titleFont;
      const textWidth = Math.ceil(context.measureText(text).width);
      const logicalWidth = Math.max(small ? 70 : 110, textWidth + bodyLeft + paddingX);
      const logicalHeight = small ? 22 : 34;
      canvas.width = logicalWidth * backingScale;
      canvas.height = logicalHeight * backingScale;
      context.scale(backingScale, backingScale);

      const palette = theme === "storm"
        ? {
            bg: "rgba(28, 14, 4, 0.74)",
            stroke: "rgba(255, 140, 66, 0.56)",
            accent: "rgba(255, 120, 40, 0.92)",
            title: "rgba(255, 235, 215, 0.96)",
          }
        : theme === "volcanic"
        ? {
            bg: "rgba(28, 10, 10, 0.72)",
            stroke: "rgba(255, 122, 96, 0.56)",
            accent: "rgba(255, 88, 69, 0.92)",
            title: "rgba(255, 234, 230, 0.96)",
          }
        : theme === "mission"
          ? {
              bg: "rgba(10, 22, 14, 0.74)",
              stroke: "rgba(128, 229, 160, 0.42)",
              accent: "rgba(98, 222, 132, 0.94)",
              title: "rgba(237, 255, 242, 0.96)",
            }
        : theme === "moon"
          ? {
              bg: "rgba(14, 18, 26, 0.72)",
              stroke: "rgba(255, 255, 255, 0.34)",
              accent: "rgba(255, 255, 255, 0.94)",
              title: "rgba(255, 255, 255, 0.96)",
            }
        : theme === "moon-poi"
          ? {
              bg: "rgba(9, 14, 24, 0.64)",
              stroke: "rgba(90, 214, 233, 0.52)",
              accent: "rgba(58, 238, 232, 1)",
              title: "rgba(255, 255, 255, 0.96)",
            }
        : theme === "habitation"
          ? {
              bg: "rgba(8, 20, 11, 0.74)",
              stroke: "rgba(112, 232, 146, 0.46)",
              accent: "rgba(92, 222, 118, 0.96)",
              title: "rgba(234, 255, 238, 0.96)",
            }
        : theme === "landing"
          ? {
              bg: "rgba(23, 18, 8, 0.74)",
              stroke: "rgba(255, 215, 125, 0.58)",
              accent: "rgba(255, 205, 92, 0.94)",
              title: "rgba(255, 246, 223, 0.96)",
            }
        : {
            bg: "rgba(9, 14, 24, 0.62)",
            stroke: "rgba(90, 214, 233, 0.28)",
            accent: "rgba(58, 214, 208, 0.92)",
            title: "rgba(242, 247, 250, 0.94)",
          };

      context.textBaseline = "middle";
      context.fillStyle = palette.bg;
      context.strokeStyle = palette.stroke;
      context.lineWidth = small ? 1.2 : 1.6;
      const radius = small ? 8 : 14;
      context.beginPath();
      context.moveTo(radius, 1);
      context.lineTo(logicalWidth - radius, 1);
      context.quadraticCurveTo(logicalWidth - 1, 1, logicalWidth - 1, radius);
      context.lineTo(logicalWidth - 1, logicalHeight - radius - 1);
      context.quadraticCurveTo(logicalWidth - 1, logicalHeight - 1, logicalWidth - radius, logicalHeight - 1);
      context.lineTo(radius, logicalHeight - 1);
      context.quadraticCurveTo(1, logicalHeight - 1, 1, logicalHeight - radius);
      context.lineTo(1, radius);
      context.quadraticCurveTo(1, 1, radius, 1);
      context.closePath();
      context.fill();
      context.stroke();

      context.fillStyle = palette.accent;
      context.beginPath();
      context.moveTo(radius + 1, 4);
      context.lineTo(radius + accentWidth, 4);
      context.lineTo(radius + accentWidth, logicalHeight - 4);
      context.lineTo(radius + 1, logicalHeight - 4);
      context.closePath();
      context.fill();

      context.font = titleFont;
      context.fillStyle = palette.title;
      context.fillText(text, bodyLeft, logicalHeight / 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      return { texture, width: logicalWidth, height: logicalHeight };
    }

    function makeSeismicMarkerTexture(style = "located-reviewed") {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const size = 128;
      canvas.width = size;
      canvas.height = size;
      context.clearRect(0, 0, size, size);
      context.translate(size / 2, size / 2);

      if (style === "insight-site-event") {
        context.strokeStyle = "rgba(255, 236, 226, 0.92)";
        context.lineWidth = 6;
        context.beginPath();
        context.arc(0, 0, 24, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.fillStyle = "rgba(230, 54, 54, 0.96)";
        context.arc(0, 0, 13, 0, Math.PI * 2);
        context.fill();
      } else if (style === "located-preliminary") {
        context.fillStyle = "rgba(224, 74, 58, 0.94)";
        context.strokeStyle = "rgba(255, 228, 220, 0.94)";
        context.lineWidth = 5;
        context.beginPath();
        context.arc(0, 0, 22, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.beginPath();
        context.fillStyle = "rgba(172, 38, 38, 0.92)";
        context.arc(0, 0, 8, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillStyle = "rgba(241, 92, 68, 0.94)";
        context.strokeStyle = "rgba(255, 222, 214, 0.92)";
        context.lineWidth = 5;
        context.beginPath();
        context.arc(0, 0, 24, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        context.beginPath();
        context.fillStyle = "rgba(184, 34, 34, 0.88)";
        context.arc(0, 0, 10, 0, Math.PI * 2);
        context.fill();
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;
      return texture;
    }

    function seismicMarkerStyle(event) {
      if (event.kind === "insight-site-event") {
        return "insight-site-event";
      }
      return String(event.catalog_status || "").toLowerCase() === "preliminary"
        ? "located-preliminary"
        : "located-reviewed";
    }

    function seismicMarkerScale(event) {
      const mag = Number.isFinite(Number(event.magnitude)) ? Number(event.magnitude) : 2.5;
      const normalized = clamp((mag + 0.5) / 4.5, 0, 1);
      const baseScale = 0.04 + normalized * 0.11;
      return event.kind === "insight-site-event" ? baseScale * 0.82 : baseScale;
    }

    function buildSeismicLayer(radius, seismicCatalog, elevationSampler, elevationCache, getTerrainRelief) {
      const group = new THREE.Group();
      const hitGeometry = new THREE.SphereGeometry(0.18, 14, 14);
      const hitMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });
      const entries = [];
      const interactiveObjects = [];

      if (!seismicCatalog || !Array.isArray(seismicCatalog.events)) {
        return { group, entries, interactiveObjects, available: false };
      }

      function sampleSeismicSurfacePoint(latDegrees, lonDegrees, lift = 0.01) {
        return getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, latDegrees, lonDegrees, lift);
      }

      for (const event of seismicCatalog.events) {
        const anchor = sampleSeismicSurfacePoint(event.lat, event.lon, 0.01);
        const texture = makeSeismicMarkerTexture(seismicMarkerStyle(event));
        const spriteMaterial = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: event.kind === "insight-site-event" ? 0.68 : 0.9,
          depthTest: false,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        const scale = seismicMarkerScale(event);
        sprite.scale.set(scale, scale, 1);
        sprite.position.copy(anchor);
        sprite.userData.feature = event;
        group.add(sprite);

        const hitTarget = new THREE.Mesh(hitGeometry, hitMaterial.clone());
        hitTarget.position.copy(anchor);
        hitTarget.userData.feature = event;
        group.add(hitTarget);
        interactiveObjects.push(sprite, hitTarget);

        entries.push({
          sprite,
          hitTarget,
          surfacePoint: sampleSeismicSurfacePoint(event.lat, event.lon, 0),
          item: event,
          priority: event.kind === "insight-site-event" ? 1 : 2,
        });
      }

      return { group, entries, interactiveObjects, available: true };
    }

    function updateSeismicAnchors(seismicLayer, elevationSampler, elevationCache, getTerrainRelief, radius = 3.2) {
      if (!seismicLayer || !seismicLayer.entries) {
        return;
      }
      for (const entry of seismicLayer.entries) {
        const event = entry.item;
        const surfacePoint = getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, event.lat, event.lon, 0);
        const anchor = getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, event.lat, event.lon, 0.01);
        entry.surfacePoint.copy(surfacePoint);
        entry.sprite.position.copy(anchor);
        entry.hitTarget.position.copy(anchor);
      }
    }

    function updateSeismicVisibility(entries, marsGroup, globe, camera, renderer, seismicEnabled, cutawayModeEnabled, seismicFilter, seismicStatus, minMagnitude, timelineCutoff) {
      const groupWorldPosition = new THREE.Vector3();
      const surfaceWorldPosition = new THREE.Vector3();
      const cameraDirection = new THREE.Vector3();
      const projected = new THREE.Vector3();
      const occupiedRects = [];
      const candidates = [];
      const viewportWidth = renderer.domElement.clientWidth || window.innerWidth;
      const viewportHeight = renderer.domElement.clientHeight || window.innerHeight;
      const fovScale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
      marsGroup.getWorldPosition(groupWorldPosition);

      for (const entry of entries) {
        surfaceWorldPosition.copy(entry.surfacePoint).applyMatrix4(marsGroup.matrixWorld);
        const normal = surfaceWorldPosition.clone().sub(groupWorldPosition).normalize();
        cameraDirection.copy(camera.position).sub(surfaceWorldPosition).normalize();
        const survivesCut = !cutawayModeEnabled || (activeCutClipPlane ? activeCutClipPlane.distanceToPoint(surfaceWorldPosition) : surfaceWorldPosition.x) >= -0.02;
        const matchesFilter = seismicFilter === "located"
          ? entry.item.kind === "located-event"
          : seismicFilter === "insight-site"
            ? entry.item.kind === "insight-site-event"
            : true;
        const status = String(entry.item.catalog_status || "").toLowerCase();
        const matchesStatus = seismicStatus === "reviewed"
          ? status && status !== "preliminary"
          : seismicStatus === "preliminary"
            ? status === "preliminary"
            : true;
        const magnitude = Number.isFinite(Number(entry.item.magnitude)) ? Number(entry.item.magnitude) : 0;
        const withinMagnitude = magnitude >= minMagnitude;
        const eventTimestamp = parseEventTimestamp(entry.item.event_time);
        const withinTimeline = timelineCutoff === null || eventTimestamp === null || eventTimestamp <= timelineCutoff;
        const isVisible = seismicEnabled && matchesFilter && matchesStatus && withinMagnitude && withinTimeline && survivesCut && normal.dot(cameraDirection) > 0.02;
        entry.sprite.visible = false;
        entry.hitTarget.visible = false;
        if (!isVisible) {
          continue;
        }
        projected.copy(entry.sprite.position).applyMatrix4(marsGroup.matrixWorld).project(camera);
        const distance = camera.position.distanceTo(entry.sprite.position.clone().applyMatrix4(marsGroup.matrixWorld));
        const pixelsPerWorldUnit = fovScale / Math.max(distance, 0.001);
        const radiusPx = Math.max(12, entry.sprite.scale.x * pixelsPerWorldUnit * 0.6);
        const screenX = ((projected.x + 1) * 0.5) * viewportWidth;
        const screenY = ((1 - projected.y) * 0.5) * viewportHeight;
        candidates.push({
          entry,
          priority: entry.priority,
          rect: {
            left: screenX - radiusPx,
            right: screenX + radiusPx,
            top: screenY - radiusPx,
            bottom: screenY + radiusPx,
          },
        });
      }

      candidates.sort((a, b) => b.priority - a.priority);
      for (const candidate of candidates) {
        const overlaps = occupiedRects.some((rect) => (
          candidate.rect.left < rect.right &&
          candidate.rect.right > rect.left &&
          candidate.rect.top < rect.bottom &&
          candidate.rect.bottom > rect.top
        ));
        if (overlaps) {
          continue;
        }
        candidate.entry.sprite.visible = true;
        candidate.entry.hitTarget.visible = true;
        occupiedRects.push(candidate.rect);
      }
    }

    function buildRingLabelLayer() {
      const group = new THREE.Group();
      const RING_LABEL_RENDER_ORDER = 220;
      const dotCanvas = document.createElement("canvas");
      dotCanvas.width = 32; dotCanvas.height = 32;
      const dotCtx = dotCanvas.getContext("2d");
      dotCtx.fillStyle = "#4fe0db";
      dotCtx.beginPath();
      dotCtx.arc(16, 16, 13, 0, Math.PI * 2);
      dotCtx.fill();
      const dotTexture = new THREE.CanvasTexture(dotCanvas);
      const hitGeometry = new THREE.SphereGeometry(0.22, 14, 14);
      const hitMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.01,
        depthTest: false,
        depthWrite: false,
      });
      const entries = [];
      const interactiveObjects = [];

      for (const item of ringLabelData) {
        const anchor = new THREE.Vector3(item.ring_anchor[0], item.ring_anchor[1], item.ring_anchor[2]);
        const labelPos = new THREE.Vector3(item.ring_label[0], item.ring_label[1], item.ring_label[2]);
        const marker = new THREE.Sprite(new THREE.SpriteMaterial({
          map: dotTexture,
          transparent: true,
          opacity: 0.94,
          depthTest: false,
          depthWrite: false,
        }));
        marker.renderOrder = RING_LABEL_RENDER_ORDER;
        marker.scale.set(0.056, 0.056, 1);
        marker.position.copy(anchor);
        marker.userData.feature = item;

        const hitTarget = new THREE.Mesh(hitGeometry, hitMaterial.clone());
        hitTarget.renderOrder = RING_LABEL_RENDER_ORDER;
        hitTarget.position.copy(anchor);
        hitTarget.userData.feature = item;
        group.add(hitTarget);

        const label = makeLabelTexture(item, { theme: "moon-poi" });
        const spriteMaterial = new THREE.SpriteMaterial({
          map: label.texture,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.renderOrder = RING_LABEL_RENDER_ORDER;
        sprite.scale.set((label.width / 200) * 0.68, (label.height / 200) * 0.68, 1);
        sprite.position.copy(labelPos);
        sprite.userData.feature = item;
        group.add(sprite);

        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([anchor, labelPos]),
          new THREE.LineBasicMaterial({
            color: 0x7be7e3,
            transparent: true,
            opacity: 0.4,
            depthTest: false,
            depthWrite: false,
          }),
        );
        line.renderOrder = RING_LABEL_RENDER_ORDER;
        group.add(line);
        group.add(marker);
        interactiveObjects.push(hitTarget, marker, sprite);
        entries.push({
          marker,
          hitTarget,
          sprite,
          line,
          item,
          priority: 5,
        });
      }

      return { group, entries, interactiveObjects };
    }

    function isPointOccludedByPlanet(pointLocal, marsGroup, camera, bodyRadius = 3.2) {
      const inverseWorld = marsGroup.matrixWorld.clone().invert();
      const cameraLocal = camera.position.clone().applyMatrix4(inverseWorld);
      const anchorLocal = pointLocal.clone();
      const ray = anchorLocal.clone().sub(cameraLocal);
      const segmentLength = ray.length();
      if (segmentLength <= 1e-5) {
        return false;
      }
      ray.divideScalar(segmentLength);
      const b = 2 * cameraLocal.dot(ray);
      const c = cameraLocal.lengthSq() - (bodyRadius * bodyRadius);
      const discriminant = (b * b) - (4 * c);
      if (discriminant <= 0) {
        return false;
      }
      const root = Math.sqrt(discriminant);
      const near = (-b - root) * 0.5;
      const far = (-b + root) * 0.5;
      const epsilon = 1e-4;
      return (near > epsilon && near < segmentLength - epsilon)
        || (far > epsilon && far < segmentLength - epsilon);
    }

    function getMoonOccluders() {
      if (!jupiterSceneGroup || !Array.isArray(moonData) || moonData.length === 0) {
        return [];
      }
      const scale = jupiterSceneGroup.scale;
      const radiusScale = Math.max(
        Math.abs(scale.x || 1),
        Math.abs(scale.y || 1),
        Math.abs(scale.z || 1),
      );
      return moonData
        .filter((item) => Array.isArray(item.moon_anchor))
        .map((item) => ({
          name: item.name,
          center: jupiterSceneGroup.localToWorld(new THREE.Vector3(
            item.moon_anchor[0],
            item.moon_anchor[1],
            item.moon_anchor[2],
          )),
          radius: Number(item.moon_radius || 0.1) * radiusScale,
        }));
    }

    function isPointOccludedByMoonOccluder(pointWorld, camera, occluder) {
      const segment = pointWorld.clone().sub(camera.position);
      const segmentLength = segment.length();
      if (segmentLength <= 1e-5) {
        return false;
      }
      const direction = segment.clone().divideScalar(segmentLength);
      const offset = camera.position.clone().sub(occluder.center);
      const b = 2 * offset.dot(direction);
      const c = offset.lengthSq() - (occluder.radius * occluder.radius);
      const discriminant = (b * b) - (4 * c);
      if (discriminant <= 0) {
        return false;
      }
      const root = Math.sqrt(discriminant);
      const near = (-b - root) * 0.5;
      const far = (-b + root) * 0.5;
      const epsilon = 1e-4;
      return (near > epsilon && near < segmentLength - epsilon)
        || (far > epsilon && far < segmentLength - epsilon);
    }

    function isPointOccludedByAnyMoon(pointWorld, camera, ignoredMoonName = null) {
      const occluders = getMoonOccluders();
      for (const occluder of occluders) {
        if (ignoredMoonName && occluder.name === ignoredMoonName) {
          continue;
        }
        if (isPointOccludedByMoonOccluder(pointWorld, camera, occluder)) {
          return true;
        }
      }
      return false;
    }

    function updateRingLabelVisibility(entries, marsGroup, camera, renderer, labelsEnabled) {
      const projected = new THREE.Vector3();
      const markerWorldPosition = new THREE.Vector3();
      const spriteWorldPosition = new THREE.Vector3();
      const viewportWidth = renderer.domElement.clientWidth || window.innerWidth;
      const viewportHeight = renderer.domElement.clientHeight || window.innerHeight;
      const fovScale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
      const occupiedRects = [];
      const candidates = [];

      for (const entry of entries) {
        entry.marker.visible = labelsEnabled;
        entry.hitTarget.visible = labelsEnabled;
        entry.sprite.visible = false;
        entry.line.visible = false;
        if (!labelsEnabled) {
          continue;
        }
        if (isPointOccludedByPlanet(entry.marker.position, marsGroup, camera)) {
          entry.marker.visible = false;
          entry.hitTarget.visible = false;
          continue;
        }
        markerWorldPosition.copy(entry.marker.position).applyMatrix4(marsGroup.matrixWorld);
        if (isPointOccludedByAnyMoon(markerWorldPosition, camera)) {
          entry.marker.visible = false;
          entry.hitTarget.visible = false;
          continue;
        }
        spriteWorldPosition.copy(entry.sprite.position).applyMatrix4(marsGroup.matrixWorld);
        if (isPointOccludedByAnyMoon(spriteWorldPosition, camera)) {
          entry.marker.visible = false;
          entry.hitTarget.visible = false;
          continue;
        }
        projected.copy(spriteWorldPosition).project(camera);
        if (projected.z < -1 || projected.z > 1) {
          entry.marker.visible = false;
          entry.hitTarget.visible = false;
          continue;
        }
        const distance = camera.position.distanceTo(spriteWorldPosition);
        const pixelsPerWorldUnit = fovScale / Math.max(distance, 0.001);
        const rectWidth = Math.max(110, entry.sprite.scale.x * pixelsPerWorldUnit * 1.04);
        const rectHeight = Math.max(30, entry.sprite.scale.y * pixelsPerWorldUnit * 1.08);
        const screenX = ((projected.x + 1) * 0.5) * viewportWidth;
        const screenY = ((1 - projected.y) * 0.5) * viewportHeight;
        candidates.push({
          entry,
          distance,
          rect: {
            left: screenX - rectWidth * 0.5,
            right: screenX + rectWidth * 0.5,
            top: screenY - rectHeight * 0.5,
            bottom: screenY + rectHeight * 0.5,
          },
        });
      }

      candidates.sort((a, b) => a.distance - b.distance);
      for (const candidate of candidates) {
        const overlaps = occupiedRects.some((rect) => (
          candidate.rect.left - 12 < rect.right &&
          candidate.rect.right + 12 > rect.left &&
          candidate.rect.top - 10 < rect.bottom &&
          candidate.rect.bottom + 10 > rect.top
        ));
        if (overlaps) {
          continue;
        }
        candidate.entry.sprite.visible = true;
        candidate.entry.line.visible = true;
        occupiedRects.push(candidate.rect);
      }
    }

    function buildFlybyPaths() {
      const group = new THREE.Group();
      group.renderOrder = 10;

      const FLYBY_DATA = [
        {
          name: "Pioneer 10",
          date: "3 Dec 1973",
          color: 0xffaa33,
          // Source: JPL Horizons, Jupiter-centred ecliptic J2000 vectors (6 h cadence).
          // Axis map: scene_x=X_ecl, scene_y=Z_ecl, scene_z=Y_ecl; scale=3.2/71492 sc/km.
          // Closest sample 13.5 sc at Dec 4 00:00 TDB; actual periapsis ~5.84 sc occurred ~02:26 UTC Dec 4.
          waypoints: [
            new THREE.Vector3(-35.96, -10.19,  67.50),  // 3 Dec 00:00 TDB – 77 sc
            new THREE.Vector3(-28.99,  -7.95,  37.44),  // 3 Dec 12:00 – 48 sc
            new THREE.Vector3(-23.63,  -6.32,  19.98),  // 3 Dec 18:00 – 32 sc
            new THREE.Vector3(-13.07,  -3.31,  -0.86),  // 4 Dec 00:00 – 13.5 sc ← closest sample
            new THREE.Vector3( 14.69,   3.86,  -7.36),  // 4 Dec 06:00 – 16.7 sc
            new THREE.Vector3( 33.61,   8.51,   3.02),  // 4 Dec 12:00 – 35 sc
            new THREE.Vector3( 59.69,  14.82,  23.24),  // 5 Dec 00:00 – 65 sc
          ],
        },
        {
          name: "Pioneer 11",
          date: "2 Dec 1974",
          color: 0xffdd66,
          // Source: JPL Horizons, Jupiter-centred ecliptic J2000 vectors (1 h cadence near periapsis).
          // Closest sample 5.48 sc at Dec 3 05:00 TDB (actual periapsis ~5.13 sc = 114,000 km).
          // Gravity assist southward toward Saturn; periapsis south of Jupiter's equatorial plane.
          waypoints: [
            new THREE.Vector3(-16.94, -14.80,  35.98),  // 2 Dec 18:00 – 40 sc
            new THREE.Vector3( -5.31, -11.80,  20.03),  // 3 Dec 00:00 – 24 sc
            new THREE.Vector3(  1.17,  -8.67,   9.36),  // 3 Dec 03:00 – 13 sc
            new THREE.Vector3(  3.25,  -6.68,   4.75),  // 3 Dec 04:00 – 9 sc
            new THREE.Vector3(  4.41,  -3.16,  -0.76),  // 3 Dec 05:00 – 5.48 sc ← closest sample
            new THREE.Vector3(  2.25,   2.36,  -5.20),  // 3 Dec 06:00 – 6.1 sc
            new THREE.Vector3( -1.72,   7.00,  -6.70),  // 3 Dec 07:00 – 9.8 sc
            new THREE.Vector3( -9.03,  13.47,  -6.94),  // 3 Dec 09:00 – 18 sc
            new THREE.Vector3(-18.29,  20.45,  -5.80),  // 3 Dec 12:00 – 28 sc
          ],
        },
        {
          name: "Voyager 1",
          date: "5 Mar 1979",
          color: 0x66aaff,
          // Source: JPL Horizons, Jupiter-centred ecliptic J2000 vectors.
          // Closest sample 15.6 sc at 5 Mar 12:00 TDB (actual periapsis 348,890 km = 15.62 sc ✓).
          waypoints: [
            new THREE.Vector3( 48.91,   0.14, -88.36),  // 4 Mar 00:00 – 101 sc
            new THREE.Vector3( 32.96,  -1.09, -25.48),  // 5 Mar 00:00 – 41.7 sc
            new THREE.Vector3(  8.57,  -0.97,  13.00),  // 5 Mar 12:00 – 15.6 sc ← periapsis ✓
            new THREE.Vector3(-100.29,   6.00,   5.08),  // 7 Mar 00:00 – 101 sc
          ],
        },
        {
          name: "Voyager 2",
          date: "9 Jul 1979",
          color: 0x44dd88,
          // Source: JPL Horizons, Jupiter-centred ecliptic J2000 vectors.
          // Closest sample 32.3 sc at 9 Jul 22:00 TDB (actual periapsis 721,670 km = 32.3 sc ✓).
          // Grand tour trajectory onward to Saturn, Uranus, Neptune.
          waypoints: [
            new THREE.Vector3( 75.50,   8.38, -127.58),  // 7 Jul 00:00 – 148 sc
            new THREE.Vector3( 54.26,  -0.48,  -29.08),  // 9 Jul 00:00 – 61.6 sc
            new THREE.Vector3( 20.92,  -3.84,   24.32),  // 9 Jul 22:00 – 32.3 sc ← periapsis ✓
            new THREE.Vector3(-49.08,  -1.53,   45.64),  // 11 Jul 00:00 – 67 sc
          ],
        },
        {
          name: "Juno",
          date: "2016+",
          color: 0xff6699,
          // Source: JPL Horizons, Jupiter-centred ecliptic J2000 vectors, 15-min cadence (PJ1, Aug 27 2016).
          // Perijove at 12:45 TDB = 77,752 km = 3.47 sc, scene (+0.026, +1.388, +3.178).
          // Dense sampling around perijove prevents CatmullRom from dipping through globe (r=3.2 sc).
          waypoints: [
            new THREE.Vector3( -0.93,  19.99, -52.81),  // 26 Aug 18:00 – 56.5 sc (approach)
            new THREE.Vector3( -0.73,  18.43, -39.35),  // 27 Aug 00:00 – 43.5 sc
            new THREE.Vector3( -0.49,  15.55, -23.21),  // 27 Aug 06:00 – 27.9 sc
            new THREE.Vector3( -0.104,  7.258,  -1.427), // 27 Aug 11:45 – 7.44 sc
            new THREE.Vector3( -0.075,  6.243,  -0.156), // 27 Aug 12:00 – 6.24 sc
            new THREE.Vector3( -0.044,  4.995,   1.117), // 27 Aug 12:15 – 5.12 sc
            new THREE.Vector3( -0.010,  3.407,   2.304), // 27 Aug 12:30 – 4.11 sc
            new THREE.Vector3(  0.026,  1.388,   3.178), // 27 Aug 12:45 – 3.47 sc ← perijove
            new THREE.Vector3(  0.055, -0.908,   3.378), // 27 Aug 13:00 – 3.51 sc
            new THREE.Vector3(  0.073, -3.036,   2.880), // 27 Aug 13:15 – 4.34 sc
            new THREE.Vector3(  0.083, -4.802,   2.015), // 27 Aug 13:30 – 5.17 sc
            new THREE.Vector3(  0.087, -6.256,   1.011), // 27 Aug 13:45 – 6.33 sc
            new THREE.Vector3(  0.087, -7.492,  -0.035), // 27 Aug 14:00 – 7.49 sc
            new THREE.Vector3(  0.076, -11.12,  -4.111), // 27 Aug 15:00 – 11.85 sc
            new THREE.Vector3(  0.057, -13.69,  -7.849), // 27 Aug 16:00 – 15.57 sc
            new THREE.Vector3(  0.035, -15.72, -11.290), // 27 Aug 17:00 – 19.41 sc (departure)
            new THREE.Vector3( -0.12,  -24.44, -30.80),  // 28 Aug 00:00 – 39.3 sc
            new THREE.Vector3( -0.24,  -29.04, -44.21),  // 28 Aug 06:00 – 52.9 sc
          ],
        },
      ];

      const entries = [];

      for (const flyby of FLYBY_DATA) {
        const curve = new THREE.CatmullRomCurve3(flyby.waypoints, false, "catmullrom", 0.5);
        const points = curve.getPoints(180);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: flyby.color,
          transparent: true,
          opacity: 0.82,
          depthTest: true,
          depthWrite: false,
        });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 10;
        group.add(line);

        // Periapsis marker — small glowing dot at closest approach
        const periapsisIdx = Math.round(points.length * 0.44);
        const periapsisPos = points[periapsisIdx];
        const dotGeo = new THREE.SphereGeometry(0.06, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({
          color: flyby.color,
          transparent: true,
          opacity: 0.95,
          depthTest: true,
          depthWrite: false,
        });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(periapsisPos);
        dot.renderOrder = 11;
        group.add(dot);

        // Periapsis label — name + date near closest approach point
        const periLabel = makeLabelTexture(`${flyby.name}  ${flyby.date}`, { theme: "landing", small: true });
        const periSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: periLabel.texture,
          transparent: true,
          opacity: 0.88,
          depthTest: false,
          depthWrite: false,
        }));
        periSprite.scale.set((periLabel.width / 200) * 0.1, (periLabel.height / 200) * 0.1, 1);
        periSprite.position.set(periapsisPos.x, periapsisPos.y + 0.35, periapsisPos.z);
        periSprite.renderOrder = 12;
        group.add(periSprite);

        // Approach-arm label — spacecraft name floated along the incoming arc (~15% along curve)
        const approachPos = curve.getPoint(0.12);
        const approachLabel = makeLabelTexture(flyby.name, { theme: "landing", small: true });
        const approachSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: approachLabel.texture,
          transparent: true,
          opacity: 0.78,
          depthTest: false,
          depthWrite: false,
        }));
        approachSprite.scale.set((approachLabel.width / 200) * 0.09, (approachLabel.height / 200) * 0.09, 1);
        approachSprite.position.copy(approachPos).addScaledVector(new THREE.Vector3(0, 1, 0), 0.3);
        approachSprite.renderOrder = 12;
        group.add(approachSprite);

        entries.push({ flyby, line, dot, periSprite, approachSprite });
      }

      return { group, entries };
    }

    function buildMoonLayer(textureMap) {
      const group = new THREE.Group();
      const orbitGroup = new THREE.Group();
      const labelGroup = new THREE.Group();
      const MOON_LABEL_RENDER_ORDER = 221;
      group.add(orbitGroup);
      group.add(labelGroup);
      const entries = [];
      const interactiveObjects = [];

      for (const item of moonData) {
        const anchor = new THREE.Vector3(item.moon_anchor[0], item.moon_anchor[1], item.moon_anchor[2]);
        const moonRadius = Number(item.moon_radius || 0.09);
        const moonMesh = new THREE.Mesh(
          new THREE.SphereGeometry(moonRadius, 96, 96),
          new THREE.MeshStandardMaterial({
            map: textureMap.get(item.name) || null,
            color: new THREE.Color(textureMap.get(item.name) ? "#ffffff" : (item.moon_color || "#d8d2c8")),
            roughness: 0.96,
            metalness: 0.02,
            transparent: false,
            opacity: 1,
            depthTest: true,
            depthWrite: true,
          }),
        );
        moonMesh.position.copy(anchor);
        moonMesh.userData.feature = item;
        group.add(moonMesh);

        const orbitRadius = Math.hypot(anchor.x, anchor.z);
        const initialAngle = Math.atan2(anchor.z, anchor.x);
        const orbitPoints = [];
        for (let i = 0; i <= 128; i += 1) {
          const theta = (i / 128) * Math.PI * 2;
          orbitPoints.push(new THREE.Vector3(
            Math.cos(theta) * orbitRadius,
            anchor.y,
            Math.sin(theta) * orbitRadius,
          ));
        }
        const orbitLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(orbitPoints),
          new THREE.LineBasicMaterial({
            color: 0x8ea5b8,
            transparent: true,
            opacity: 0.18,
          }),
        );
        orbitGroup.add(orbitLine);

        const label = makeLabelTexture(item, { theme: "moon" });
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: label.texture,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          depthWrite: false,
        }));
        sprite.renderOrder = MOON_LABEL_RENDER_ORDER;
        sprite.scale.set((label.width / 200) * 0.42, (label.height / 200) * 0.42, 1);
        sprite.userData.baseScale = { x: sprite.scale.x, y: sprite.scale.y };
        const lift = Number(item.moon_label_lift || 0.24);
        const labelPos = anchor.clone().add(new THREE.Vector3(0, lift, 0));
        sprite.position.copy(labelPos);
        sprite.userData.feature = item;
        labelGroup.add(sprite);

        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            anchor.clone().add(new THREE.Vector3(0, moonRadius, 0)),
            labelPos.clone().add(new THREE.Vector3(0, -0.06, 0)),
          ]),
          new THREE.LineBasicMaterial({
            color: 0xd9e4ef,
            transparent: true,
            opacity: 0.36,
            depthTest: false,
            depthWrite: false,
          }),
        );
        line.renderOrder = MOON_LABEL_RENDER_ORDER;
        labelGroup.add(line);

        interactiveObjects.push(moonMesh, sprite);
        entries.push({ moonMesh, sprite, line, orbitLine, item, anchor, orbitRadius, initialAngle, moonRadius, lift, priority: 6 });
      }

      return { group, orbitGroup, labelGroup, entries, interactiveObjects };
    }

    function isVolcanicMoonFeature(item) {
      const content = [
        item.theme,
        item.type,
        item.name,
        item.description,
        item.origin,
        item.interpretation,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return /(?:cryo)?volcan|patera|caldera|plume|vent|eruption|lava|basalt|sulcus/.test(content);
    }

    function isMissionMoonFeature(item) {
      const content = [item.type, item.name, item.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return /landing site|probe|lander|rover|spacecraft|mission|flyby|pioneer|voyager|galileo|juno/.test(content);
    }

    /**
     * Returns a feature's position in the moon mesh's LOCAL coordinate system.
     *
     * Three.js SphereGeometry UV: u=0 → local(−1,0,0), u=0.5 → local(+1,0,0).
     * Standard moons: lon=0° at the image left edge; tidal-lock rotation = −initAngle.
     * Phoebe stores feature coords in east-positive CRS; a +180° offset maps them onto the texture.
     * Tethys and Titan features are already in left-edge CRS and need no offset.
     */
    const MOON_FEATURE_LON_OFFSET_SET = new Set(["Phoebe"]);
    function moonFeatureLocalPos(lat, lon, moonName, radius) {
      const offset = MOON_FEATURE_LON_OFFSET_SET.has(moonName) ? 180 : 0;
      return latLonToVector3(lat, lon + offset, radius);
    }

    function buildMoonFeatureLabelLayer(moonMeshMap) {
      const group = new THREE.Group();
      const MOON_LABEL_RENDER_ORDER = 221;
      const entries = [];
      const interactiveObjects = [];
      const markerGeometry = new THREE.SphereGeometry(0.001, 8, 8);
      const hitGeometry = new THREE.SphereGeometry(0.008, 10, 10);
      const hitMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });

      for (const item of moonFeatureData) {
        const parentMoon = moonData.find((moon) => moon.name === item.moon_name);
        if (!parentMoon || !Array.isArray(parentMoon.moon_anchor)) {
          continue;
        }
        const lat = item.lat !== undefined ? item.lat : item.anchor_lat;
        const lon = item.lon !== undefined ? item.lon : item.anchor_lon;
        if (lat === undefined || lon === undefined) {
          continue;
        }
        const moonMesh = moonMeshMap ? moonMeshMap.get(item.moon_name) : null;
        const moonRadius = Number(parentMoon.moon_radius || 0.1);

        // Compute positions in the moon mesh's LOCAL coordinate system.
        // The featureEntries loop applies moonMesh.matrix each frame to convert to scene space.
        const localMarkerPos  = moonFeatureLocalPos(lat, lon, item.moon_name, moonRadius + 0.001);
        const localHitPos     = moonFeatureLocalPos(lat, lon, item.moon_name, moonRadius + 0.008);
        const localSurfacePos = moonFeatureLocalPos(lat, lon, item.moon_name, moonRadius);

        const normal = localMarkerPos.clone().normalize();
        const east = new THREE.Vector3(-normal.z, 0, normal.x);
        if (east.lengthSq() < 0.0001) {
          east.set(1, 0, 0);
        }
        east.normalize();
        const up = normal.clone().cross(east).normalize();
        const direction = normal.clone().multiplyScalar(0.82).addScaledVector(east, lat >= 0 ? 0.36 : -0.36).addScaledVector(up, lat > 35 ? -0.08 : 0.06).normalize();
        const labelDistance = moonRadius * 0.15;
        const localLabelPos = localMarkerPos.clone().addScaledVector(normal, moonRadius * 0.05).addScaledVector(direction, labelDistance);

        // surfacePoint is a live Vector3 updated each frame by the featureEntries loop.
        // updateMoonFeatureLabelVisibility reads it as a marsGroup-local position.
        const surfacePoint = new THREE.Vector3();
        const moonAnchor = new THREE.Vector3(
          parentMoon.moon_anchor[0], parentMoon.moon_anchor[1], parentMoon.moon_anchor[2]
        );

        const category = isVolcanicMoonFeature(item) ? "volcanic" : isMissionMoonFeature(item) ? "landing" : "moon";
        const featureColor = category === "volcanic" ? 0xff5845 : category === "landing" ? 0xffd163 : 0x3ad6d0;
        const featureTheme = category === "volcanic" ? "volcanic" : category === "landing" ? "landing" : "standard";

        const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({
          color: featureColor,
          transparent: true,
          opacity: 0.92,
          depthTest: false,
          depthWrite: false,
        }));
        marker.renderOrder = MOON_LABEL_RENDER_ORDER;
        marker.userData.feature = item;
        group.add(marker);

        const hitTarget = new THREE.Mesh(hitGeometry, hitMaterial);
        hitTarget.renderOrder = MOON_LABEL_RENDER_ORDER;
        hitTarget.userData.feature = item;
        group.add(hitTarget);

        const label = makeLabelTexture(item, { theme: featureTheme, small: true });
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: label.texture,
          transparent: true,
          opacity: 0.92,
          depthTest: false,
          depthWrite: false,
        }));
        sprite.renderOrder = MOON_LABEL_RENDER_ORDER;
        sprite.scale.set((label.width / 200) * 0.07, (label.height / 200) * 0.07, 1);
        sprite.userData.feature = item;
        group.add(sprite);

        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(),
            new THREE.Vector3(),
          ]),
          new THREE.LineBasicMaterial({
            color: featureColor,
            transparent: true,
            opacity: 0.42,
            depthTest: false,
            depthWrite: false,
          }),
        );
        line.renderOrder = MOON_LABEL_RENDER_ORDER;
        group.add(line);
        interactiveObjects.push(hitTarget, marker, sprite);
        entries.push({
          item, parentMoon, moonMesh, moonAnchor,
          marker, hitTarget, sprite, line, surfacePoint,
          localMarkerPos, localHitPos, localSurfacePos, localLabelPos,
          category, priority: 5,
        });
      }

      return { group, entries, interactiveObjects };
    }

    function updateMoonFeatureLabelVisibility(entries, marsGroup, camera, renderer, activeMoonFeature, volcanicEnabled = true, labelsEnabled = true, typeFilter = "all") {
      const projected = new THREE.Vector3();
      const moonCenterWorld = new THREE.Vector3();
      const surfaceWorldPosition = new THREE.Vector3();
      const spriteWorldPosition = new THREE.Vector3();
      const cameraDirection = new THREE.Vector3();
      const viewportWidth = renderer.domElement.clientWidth || window.innerWidth;
      const viewportHeight = renderer.domElement.clientHeight || window.innerHeight;
      const fovScale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
      const occupiedRects = [];
      const candidates = [];

      for (const entry of entries) {
        const isActiveMoon = Boolean(activeMoonFeature) && entry.parentMoon.name === activeMoonFeature.name;
        entry.marker.visible = false;
        entry.hitTarget.visible = false;
        entry.sprite.visible = false;
        entry.line.visible = false;
        const categoryEnabled = entry.category === "volcanic" ? volcanicEnabled : labelsEnabled;
        if (!isActiveMoon || !categoryEnabled) {
          continue;
        }
        if (typeFilter !== "all" && entry.item.type !== typeFilter) {
          continue;
        }
        moonCenterWorld.copy(entry.moonAnchor).applyMatrix4(marsGroup.matrixWorld);
        surfaceWorldPosition.copy(entry.surfacePoint).applyMatrix4(marsGroup.matrixWorld);
        cameraDirection.copy(camera.position).sub(surfaceWorldPosition).normalize();
        const normal = surfaceWorldPosition.clone().sub(moonCenterWorld).normalize();
        // In moon-viewer mode at close range, tighten backface culling to avoid limb labels
        const _moonCamDist = camera.position.distanceTo(moonCenterWorld);
        const _moonRelDist = _moonCamDist / Math.max(entry.parentMoon?.moon_radius || 0.001, 0.001);
        const _minNormalDot = (activeMoonFeature && _moonRelDist < 2.5)
          ? Math.min(0.25, (2.5 - _moonRelDist) * 0.12)
          : 0.02;
        if (normal.dot(cameraDirection) <= _minNormalDot) {
          continue;
        }
        if (isPointOccludedByAnyMoon(surfaceWorldPosition, camera, entry.parentMoon.name)) {
          continue;
        }
        entry.marker.visible = true;
        entry.hitTarget.visible = true;
        // Cap marker dot pixel radius in moon-viewer mode to keep it proportional at close zoom
        if (activeMoonFeature) {
          if (entry.marker.userData._baseMSX === undefined) {
            entry.marker.userData._baseMSX = entry.marker.scale.x;
            entry.marker.userData._baseMSY = entry.marker.scale.y;
            entry.marker.userData._baseMSZ = entry.marker.scale.z;
          } else {
            entry.marker.scale.set(entry.marker.userData._baseMSX, entry.marker.userData._baseMSY, entry.marker.userData._baseMSZ);
          }
          const _geomR = entry.marker.geometry?.parameters?.radius ?? 0.001;
          const _markerDist = Math.max(camera.position.distanceTo(surfaceWorldPosition), 0.001);
          const _markerRadiusPx = _geomR * entry.marker.scale.x * (fovScale / _markerDist);
          if (_markerRadiusPx > 8) {
            entry.marker.scale.setScalar(8 / _markerRadiusPx);
          }
        }
        const isPinnedEntry = Boolean(activePopupFeature && entry.item.name === activePopupFeature.name);
        spriteWorldPosition.copy(entry.sprite.position).applyMatrix4(marsGroup.matrixWorld);
        if (!isPinnedEntry && isPointOccludedByAnyMoon(spriteWorldPosition, camera, entry.parentMoon.name)) {
          entry.marker.visible = false;
          entry.hitTarget.visible = false;
          continue;
        }
        // Persist original scale so close-zoom capping is reversible when zooming back out
        if (entry.sprite.userData._baseSX === undefined) {
          entry.sprite.userData._baseSX = entry.sprite.scale.x;
          entry.sprite.userData._baseSY = entry.sprite.scale.y;
        } else {
          entry.sprite.scale.set(entry.sprite.userData._baseSX, entry.sprite.userData._baseSY, 1);
        }
        // In moon-viewer mode, cap sprite pixel height so labels stay readable at any zoom.
        // Use surface point distance as a stable reference — the sprite may be just behind
        // the camera near-clip plane making its own distance unreliably small.
        if (activeMoonFeature) {
          const _refDist = Math.max(camera.position.distanceTo(surfaceWorldPosition), 0.001);
          const _renderedH = entry.sprite.userData._baseSY * (fovScale / _refDist);
          if (_renderedH > 52) {
            const _r = 52 / _renderedH;
            entry.sprite.scale.set(entry.sprite.userData._baseSX * _r, entry.sprite.userData._baseSY * _r, 1);
          }
        }
        projected.copy(spriteWorldPosition).project(camera);
        if (projected.z < -1 || projected.z > 1) {
          if (!activeMoonFeature) {
            entry.marker.visible = false;
            entry.hitTarget.visible = false;
            continue;
          }
          // Sprite is behind the camera at max zoom — reposition it next to the surface marker
          const anchorProj = surfaceWorldPosition.clone().project(camera);
          if (anchorProj.z < -1 || anchorProj.z > 1) continue;
          const anchorSX = ((anchorProj.x + 1) * 0.5) * viewportWidth;
          const anchorSY = ((1 - anchorProj.y) * 0.5) * viewportHeight;
          if (anchorSX < 0 || anchorSX > viewportWidth || anchorSY < 0 || anchorSY > viewportHeight) continue;
          const _nudgePPU = fovScale / Math.max(camera.position.distanceTo(surfaceWorldPosition), 0.001);
          const nudgePx = Math.max(12, entry.sprite.scale.x * _nudgePPU * 0.7);
          const nudgeX = (anchorSX + nudgePx < viewportWidth - 12) ? nudgePx : -nudgePx;
          const nudgeSX = Math.max(12, Math.min(viewportWidth - 12, anchorSX + nudgeX));
          const nudgeSY = Math.max(12, Math.min(viewportHeight - 12, anchorSY));
          const repositioned = new THREE.Vector3(
            (nudgeSX / viewportWidth) * 2 - 1,
            1 - (nudgeSY / viewportHeight) * 2,
            anchorProj.z,
          ).unproject(camera);
          const localRepositioned = marsGroup.worldToLocal(repositioned.clone());
          entry.sprite.position.copy(localRepositioned);
          if (entry.line?.geometry?.attributes?.position) {
            const fp = entry.line.geometry.attributes.position.array;
            fp[3] = localRepositioned.x; fp[4] = localRepositioned.y; fp[5] = localRepositioned.z;
            entry.line.geometry.attributes.position.needsUpdate = true;
          }
          spriteWorldPosition.copy(repositioned);
          projected.set(
            (nudgeSX / viewportWidth) * 2 - 1,
            1 - (nudgeSY / viewportHeight) * 2,
            anchorProj.z,
          );
        }
        const distance = camera.position.distanceTo(spriteWorldPosition);
        const pixelsPerWorldUnit = fovScale / Math.max(distance, 0.001);
        const rectWidth = Math.max(88, entry.sprite.scale.x * pixelsPerWorldUnit * 1.02);
        const rectHeight = Math.max(26, entry.sprite.scale.y * pixelsPerWorldUnit * 1.06);
        const screenX = ((projected.x + 1) * 0.5) * viewportWidth;
        const screenY = ((1 - projected.y) * 0.5) * viewportHeight;
        candidates.push({
          entry,
          distance,
          rect: {
            left: screenX - rectWidth * 0.5,
            right: screenX + rectWidth * 0.5,
            top: screenY - rectHeight * 0.5,
            bottom: screenY + rectHeight * 0.5,
          },
        });
      }

      candidates.sort((a, b) => {
        const aPinned = Boolean(activePopupFeature && a.entry.item.name === activePopupFeature.name);
        const bPinned = Boolean(activePopupFeature && b.entry.item.name === activePopupFeature.name);
        if (aPinned !== bPinned) {
          return aPinned ? -1 : 1;
        }
        return a.distance - b.distance;
      });
      for (const candidate of candidates) {
        const isPinned = Boolean(activePopupFeature && candidate.entry.item.name === activePopupFeature.name);
        const overlaps = occupiedRects.some((rect) => (
          candidate.rect.left - 2 < rect.right &&
          candidate.rect.right + 2 > rect.left &&
          candidate.rect.top - 2 < rect.bottom &&
          candidate.rect.bottom + 2 > rect.top
        ));
        if (overlaps && !isPinned) {
          continue;
        }
        candidate.entry.sprite.visible = true;
        candidate.entry.line.visible = true;
        occupiedRects.push(candidate.rect);
      }
    }

    function updateMoonVisibility(entries, marsGroup, camera, renderer, moonsEnabled, labelsEnabled, inMoonViewer = false) {
      const projected = new THREE.Vector3();
      const moonWorldPosition = new THREE.Vector3();
      const spriteWorldPosition = new THREE.Vector3();
      const viewportWidth = renderer.domElement.clientWidth || window.innerWidth;
      const viewportHeight = renderer.domElement.clientHeight || window.innerHeight;
      const fovScale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
      const occupiedRects = [];
      const candidates = [];

      for (const entry of entries) {
        entry.moonMesh.visible = moonsEnabled;
        entry.orbitLine.visible = moonsEnabled && labelsEnabled;
        entry.sprite.visible = false;
        entry.line.visible = false;
        if (!moonsEnabled) {
          continue;
        }
        if (isPointOccludedByPlanet(entry.moonMesh.position, marsGroup, camera)) {
          entry.moonMesh.visible = false;
          continue;
        }

        moonWorldPosition.copy(entry.moonMesh.position).applyMatrix4(marsGroup.matrixWorld);
        projected.copy(moonWorldPosition).project(camera);
        if (projected.z < -1 || projected.z > 1) {
          entry.moonMesh.visible = false;
          entry.orbitLine.visible = false;
          continue;
        }
        if (!labelsEnabled) {
          continue;
        }

        spriteWorldPosition.copy(entry.sprite.position).applyMatrix4(marsGroup.matrixWorld);
        if (isPointOccludedByAnyMoon(spriteWorldPosition, camera)) {
          continue;
        }
        projected.copy(spriteWorldPosition).project(camera);
        if (projected.z < -1 || projected.z > 1) {
          continue;
        }
        const distance = camera.position.distanceTo(spriteWorldPosition);
        if (entry.sprite.userData.baseScale) {
          const _sf = inMoonViewer ? 0.5 : 1.0;
          entry.sprite.scale.set(entry.sprite.userData.baseScale.x * _sf, entry.sprite.userData.baseScale.y * _sf, 1);
        }
        const pixelsPerWorldUnit = fovScale / Math.max(distance, 0.001);
        const rectWidth = Math.max(96, entry.sprite.scale.x * pixelsPerWorldUnit * 1.02);
        const rectHeight = Math.max(28, entry.sprite.scale.y * pixelsPerWorldUnit * 1.06);
        const screenX = ((projected.x + 1) * 0.5) * viewportWidth;
        const screenY = ((1 - projected.y) * 0.5) * viewportHeight;
        candidates.push({
          entry,
          distance,
          rect: {
            left: screenX - rectWidth * 0.5,
            right: screenX + rectWidth * 0.5,
            top: screenY - rectHeight * 0.5,
            bottom: screenY + rectHeight * 0.5,
          },
        });
      }

      candidates.sort((a, b) => a.distance - b.distance);
      for (const candidate of candidates) {
        const overlaps = occupiedRects.some((rect) => (
          candidate.rect.left - 10 < rect.right &&
          candidate.rect.right + 10 > rect.left &&
          candidate.rect.top - 8 < rect.bottom &&
          candidate.rect.bottom + 8 > rect.top
        ));
        if (overlaps) {
          continue;
        }
        candidate.entry.sprite.visible = true;
        candidate.entry.line.visible = !inMoonViewer;
        occupiedRects.push(candidate.rect);
      }
    }

    function buildLabelLayer(radius, elevationSampler, elevationCache, getTerrainRelief) {
      const group = new THREE.Group();
      const markerGeometry = new THREE.SphereGeometry(0.021, 10, 10);
      const hitGeometry = new THREE.SphereGeometry(0.18, 14, 14);
      const hitMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.01,
        depthTest: false,
        depthWrite: false,
      });
      const entries = [];
      const interactiveObjects = [];

      function sampleLabelSurfacePoint(latDegrees, lonDegrees, lift = 0) {
        return getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, latDegrees, lonDegrees, lift);
      }

      function labelThemeStyle(theme) {
        if (theme === "volcanic") {
          return {
            markerColor: 0xff735d,
            lineColor: 0xff8c73,
            spriteOpacity: 0.94,
            priority: 2,
            category: "volcanic",
          };
        }
        if (theme === "storm") {
          return {
            markerColor: 0xff8c42,
            lineColor: 0xffaa66,
            spriteOpacity: 0.92,
            priority: 2,
            category: "storm",
          };
        }
        if (theme === "landing") {
          return {
            markerColor: 0xffd163,
            lineColor: 0xffdc8c,
            spriteOpacity: 0.92,
            priority: 3,
            category: "landing",
          };
        }
        if (theme === "mission") {
          return {
            markerColor: 0x63dc86,
            lineColor: 0x82ef9f,
            spriteOpacity: 0.92,
            priority: 3,
            category: "mission",
          };
        }
        if (theme === "habitation") {
          return {
            markerColor: 0x65dc78,
            lineColor: 0x86f19a,
            spriteOpacity: 0.94,
            priority: 4,
            category: "habitation",
          };
        }
        return {
          markerColor: 0x34d7d1,
          lineColor: 0x46d7d1,
          spriteOpacity: 0.86,
          priority: 1,
          category: "surface",
        };
      }

      for (const item of labelData) {
        const style = labelThemeStyle(item.theme);
        const anchor = sampleLabelSurfacePoint(item.lat, item.lon, 0.0);
        const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({
          color: style.markerColor,
          transparent: true,
          opacity: 0.92,
          depthTest: false,
          depthWrite: false,
        }));
        marker.position.copy(anchor);
        marker.userData.feature = item;
        group.add(marker);

        const hitTarget = new THREE.Mesh(hitGeometry, hitMaterial);
        hitTarget.position.copy(sampleLabelSurfacePoint(item.lat, item.lon, 0.002));
        hitTarget.userData.feature = item;
        group.add(hitTarget);

        const label = makeLabelTexture(item, {
          theme: item.theme === "landing" ? "landing" : item.theme,
        });
        const spriteMaterial = new THREE.SpriteMaterial({
          map: label.texture,
          transparent: true,
          opacity: style.spriteOpacity,
          depthTest: false,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set((label.width / 200) * 0.66, (label.height / 200) * 0.66, 1);
        const normal = anchor.clone().normalize();
        const east = new THREE.Vector3(-normal.z, 0, normal.x);
        if (east.lengthSq() < 0.0001) {
          east.set(1, 0, 0);
        }
        east.normalize();
        const up = normal.clone().cross(east).normalize();
        const direction = item.lat >= 0 ? east.clone().multiplyScalar(1.0) : east.clone().multiplyScalar(-1.0);
        direction.addScaledVector(up, item.lat > 35 ? -0.28 : 0.18).normalize();
        const labelDistance = item.label_distance !== undefined ? item.label_distance : 0.52;
        const spritePos = anchor.clone().addScaledVector(normal, 0.22).addScaledVector(direction, labelDistance)
          .addScaledVector(up, item.label_push_up || 0)
          .addScaledVector(east, item.label_push_east || 0);
        sprite.position.copy(spritePos);
        sprite.userData.feature = item;
        group.add(sprite);
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
          anchor.clone(),
          spritePos.clone(),
        ]);
        const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({
          color: style.lineColor,
          transparent: true,
          opacity: 0.42,
          depthTest: false,
          depthWrite: false,
        }));
        group.add(line);
        interactiveObjects.push(hitTarget, marker, sprite);

        entries.push({
          marker,
          hitTarget,
          sprite,
          line,
          surfacePoint: sampleLabelSurfacePoint(item.lat, item.lon, 0),
          item,
          priority: style.priority,
          category: style.category,
        });
      }

      return { group, entries, interactiveObjects };
    }

    function updateLabelAnchors(labelLayer, elevationSampler, elevationCache, getTerrainRelief, radius = 3.2) {
      if (!labelLayer || !labelLayer.entries) {
        return;
      }
      for (const entry of labelLayer.entries) {
        const item = entry.item;
        const anchor = getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, item.lat, item.lon, 0.0);
        const hitPoint = getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, item.lat, item.lon, 0.002);
        const surfacePoint = getReliefPoint(radius, elevationSampler, elevationCache, getTerrainRelief, item.lat, item.lon, 0);
        const normal = anchor.clone().normalize();
        const east = new THREE.Vector3(-normal.z, 0, normal.x);
        if (east.lengthSq() < 0.0001) {
          east.set(1, 0, 0);
        }
        east.normalize();
        const up = normal.clone().cross(east).normalize();
        const direction = item.lat >= 0 ? east.clone().multiplyScalar(1.0) : east.clone().multiplyScalar(-1.0);
        direction.addScaledVector(up, item.lat > 35 ? -0.28 : 0.18).normalize();
        const labelDistance = item.label_distance !== undefined ? item.label_distance : 0.52;
        const spritePos = anchor.clone().addScaledVector(normal, 0.22).addScaledVector(direction, labelDistance)
          .addScaledVector(up, item.label_push_up || 0)
          .addScaledVector(east, item.label_push_east || 0);

        entry.marker.position.copy(anchor);
        entry.hitTarget.position.copy(hitPoint);
        entry.sprite.position.copy(spritePos);
        entry.surfacePoint.copy(surfacePoint);
        entry.line.geometry.dispose();
        entry.line.geometry = new THREE.BufferGeometry().setFromPoints([
          anchor.clone(),
          spritePos.clone(),
        ]);
      }
    }

    function rebuildLabelTextures(labelLayer) {
      if (!labelLayer || !labelLayer.entries) {
        return;
      }
      for (const entry of labelLayer.entries) {
        const nextLabel = makeLabelTexture(entry.item, {
          theme: entry.item.theme,
        });
        const style = entry.item.theme === "volcanic"
          ? { opacity: 0.92 }
          : entry.item.theme === "landing" || entry.item.theme === "mission"
            ? { opacity: 0.9 }
            : entry.item.theme === "habitation"
              ? { opacity: 0.94 }
              : { opacity: 0.84 };
                entry.sprite.material.map.dispose();
        entry.sprite.material.map = nextLabel.texture;
        entry.sprite.material.opacity = style.opacity;
        entry.sprite.scale.set((nextLabel.width / 200) * 0.66, (nextLabel.height / 200) * 0.66, 1);
        entry.sprite.material.needsUpdate = true;
      }
    }

    function updateLabelVisibility(
      entries,
      marsGroup,
      globe,
      camera,
      renderer,
      surfaceLabelsEnabled,
      volcanicLabelsEnabled,
      landingLabelsEnabled,
      habitationLabelsEnabled,
      cutawayModeEnabled,
      stormLabelsEnabled = true,
    ) {
      const groupWorldPosition = new THREE.Vector3();
      const surfaceWorldPosition = new THREE.Vector3();
      const cameraDirection = new THREE.Vector3();
      const spriteWorldPosition = new THREE.Vector3();
      const projected = new THREE.Vector3();
      const viewportWidth = renderer.domElement.clientWidth || window.innerWidth;
      const viewportHeight = renderer.domElement.clientHeight || window.innerHeight;
      const fovScale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
      const occupiedRects = [];
      const candidates = [];
      marsGroup.getWorldPosition(groupWorldPosition);

      for (const entry of entries) {
        entry.marker.getWorldPosition(surfaceWorldPosition);
        const normal = surfaceWorldPosition.clone().sub(groupWorldPosition).normalize();
        cameraDirection.copy(camera.position).sub(surfaceWorldPosition).normalize();
        const categoryEnabled = entry.category === "volcanic"
          ? volcanicLabelsEnabled
          : entry.category === "storm"
            ? stormLabelsEnabled
          : entry.category === "landing" || entry.category === "mission"
            ? landingLabelsEnabled
          : entry.category === "habitation"
            ? habitationLabelsEnabled
          : surfaceLabelsEnabled;
        const survivesCut = !cutawayModeEnabled || (activeCutClipPlane ? activeCutClipPlane.distanceToPoint(surfaceWorldPosition) : surfaceWorldPosition.x) >= -0.02;
        const isVisible = categoryEnabled && survivesCut && normal.dot(cameraDirection) > 0.02;
        entry.marker.visible = isVisible;
        entry.hitTarget.visible = isVisible;
        entry.sprite.visible = false;
        if (entry.line) {
          entry.line.visible = false;
        }
        if (!isVisible) {
          continue;
        }
        if (isPointOccludedByAnyMoon(surfaceWorldPosition, camera)) {
          entry.marker.visible = false;
          entry.hitTarget.visible = false;
          continue;
        }

        spriteWorldPosition.copy(entry.sprite.position).applyMatrix4(marsGroup.matrixWorld);
        if (isPointOccludedByAnyMoon(spriteWorldPosition, camera)) {
          entry.marker.visible = false;
          entry.hitTarget.visible = false;
          continue;
        }
        projected.copy(spriteWorldPosition).project(camera);
        if (projected.z < -1 || projected.z > 1) {
          continue;
        }

        const distance = camera.position.distanceTo(spriteWorldPosition);
        const pixelsPerWorldUnit = fovScale / Math.max(distance, 0.001);
        const rectWidth = Math.max(94, entry.sprite.scale.x * pixelsPerWorldUnit * 1.02);
        const rectHeight = Math.max(28, entry.sprite.scale.y * pixelsPerWorldUnit * 1.06);
        const screenX = ((projected.x + 1) * 0.5) * viewportWidth;
        const screenY = ((1 - projected.y) * 0.5) * viewportHeight;
        candidates.push({
          entry,
          distance,
          rect: {
            left: screenX - rectWidth * 0.5,
            right: screenX + rectWidth * 0.5,
            top: screenY - rectHeight * 0.5,
            bottom: screenY + rectHeight * 0.5,
          },
        });
      }

      candidates.sort((a, b) => {
        if (b.entry.priority !== a.entry.priority) {
          return b.entry.priority - a.entry.priority;
        }
        return a.distance - b.distance;
      });

      for (const candidate of candidates) {
        const overlaps = occupiedRects.some((rect) => (
          candidate.rect.left - 10 < rect.right &&
          candidate.rect.right + 10 > rect.left &&
          candidate.rect.top - 8 < rect.bottom &&
          candidate.rect.bottom + 8 > rect.top
        ));
        if (overlaps) {
          continue;
        }
        candidate.entry.sprite.visible = true;
        if (candidate.entry.line) {
          candidate.entry.line.visible = true;
        }
        occupiedRects.push(candidate.rect);
      }
    }

    function processMineralTexture(texture) {
      if (!texture || !texture.image) { return texture; }
      const img = texture.image;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) {
          d[i + 3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      const processed = new THREE.CanvasTexture(canvas);
      processed.colorSpace = THREE.SRGBColorSpace;
      texture.dispose();
      return processed;
    }

    function applyTextureTransforms(texture, layer) {
      if (!texture || !layer) {
        return texture;
      }
      const offsetX = Number(layer.texture_offset_x || 0);
      const offsetY = Number(layer.texture_offset_y || 0);
      const repeatX = Number(layer.texture_repeat_x || 1);
      const repeatY = Number(layer.texture_repeat_y || 1);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.repeat.set(repeatX, repeatY);
      texture.offset.set(offsetX, offsetY);
      texture.needsUpdate = true;
      return texture;
    }

    async function init() {
      const startup = window.__jupiterViewerStartup;
      if (startup && startup.checked && startup.criticalMissing.length > 0) {
        throw new Error(`Required files missing: ${startup.criticalMissing.join(", ")}`);
      }

      setStatus("Initializing viewer...");

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x02050b);

      const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
      camera.position.set(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z);
      viewerCamera = camera;

      const renderer = createRenderer(THREE);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.localClippingEnabled = true;
      app.appendChild(renderer.domElement);

      const cutawayClipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
      activeCutClipPlane = cutawayClipPlane;

      const controls = new OrbitControls(camera, renderer.domElement);
      viewerControls = controls;
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 4.5;
      controls.maxDistance = DEFAULT_CONTROL_MAX_DISTANCE;
      controls.enablePan = false;
      controls.rotateSpeed = 0.75;
      controls.zoomSpeed = 0.8;
      controls.enableZoom = false;
      if ("zoomToCursor" in controls) controls.zoomToCursor = false;
      applyFreezeViewState();

      const wheelZoomBodyCenter = new THREE.Vector3();
      const wheelZoomDirection = new THREE.Vector3();
      function getJupiterZoomContext() {
        if (activeMoonViewerFeature) {
          const moonMesh = moonMeshMap ? moonMeshMap.get(activeMoonViewerFeature.name) : null;
          if (!moonMesh) return null;
          const centerWorld = new THREE.Vector3();
          moonMesh.getWorldPosition(centerWorld);
          const moonRadius = Number(activeMoonViewerFeature.moon_radius || 0.1);
          return {
            centerWorld,
            radiusWorld: moonRadius,
            minSurfaceDistance: 0.0005,
            maxSurfaceDistance: Math.max(0.05, controls.maxDistance - moonRadius),
          };
        }
        marsGroup.getWorldPosition(wheelZoomBodyCenter);
        return {
          centerWorld: wheelZoomBodyCenter.clone(),
          radiusWorld: 3.2,
          minSurfaceDistance: 0.092,
          maxSurfaceDistance: Math.max(0.5, controls.maxDistance - 3.2),
        };
      }
      function handleSurfaceWheelZoom(event) {
        if (freezeViewActive) return;
        const zoomContext = getJupiterZoomContext();
        if (!zoomContext) return;
        const moonViewerMode = Boolean(activeMoonViewerFeature);
        const delta = Number(event.deltaY || 0);
        if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) return;
        event.preventDefault();
        wheelZoomDirection.copy(camera.position).sub(zoomContext.centerWorld);
        const centerDistance = wheelZoomDirection.length();
        if (!(centerDistance > 0)) return;
        const surfaceDistance = Math.max(0.00001, centerDistance - zoomContext.radiusWorld);
        const normalizedDelta = clamp(Math.abs(delta) / 120, moonViewerMode ? 0.65 : 0.4, 6);
        const distanceT = clamp(surfaceDistance / (moonViewerMode ? 0.55 : 1.5), 0, 1);
        const stepStrength = THREE.MathUtils.lerp(
          moonViewerMode ? 0.085 : 0.035,
          moonViewerMode ? 0.3 : 0.20,
          distanceT,
        ) * normalizedDelta;
        const zoomFactor = Math.exp(Math.sign(delta) * stepStrength);
        const nextSurfaceDistance = clamp(
          surfaceDistance * zoomFactor,
          zoomContext.minSurfaceDistance,
          zoomContext.maxSurfaceDistance,
        );
        wheelZoomDirection.normalize().multiplyScalar(zoomContext.radiusWorld + nextSurfaceDistance);
        camera.position.copy(zoomContext.centerWorld.clone().add(wheelZoomDirection));
        controls.update();
      }
      renderer.domElement.addEventListener("wheel", handleSurfaceWheelZoom, { passive: false });

      scene.add(new THREE.AmbientLight(0xbfd0ff, 0.85));

      const keyLight = new THREE.DirectionalLight(0xffdfbf, 1.9);
      keyLight.position.set(8, 4, 6);
      scene.add(keyLight);

      const rimLight = new THREE.DirectionalLight(0x7aa6ff, 0.55);
      rimLight.position.set(-8, -2, -6);
      scene.add(rimLight);

      const marsGroup = new THREE.Group();
      jupiterSceneGroup = marsGroup;
      scene.add(marsGroup);
      scene.add(buildStarfield(THREE));
      scene.add(buildSunObject());

      setStatus("Loading Jupiter textures...");
      const textureLoader = new THREE.TextureLoader();
      const seismicCatalog = await loadJsonSafe(manifest.seismic ? manifest.seismic.path : "");
      const geologyFeaturePromise = loadJsonSafe(manifest.geology_interactive ? manifest.geology_interactive.feature_path : "");
      let geologyInteractiveState = null;
      const layerTextures = new Map();
      const baseLayers = manifest.layers || [{
        id: "viking-color",
        label: "Jupiter Body",
        path: manifest.texture.path,
        description: "Derived Jupiter body texture separated from the rings.",
      }];
      // Phase 1: load only the default base layer — non-default layers load in background.
      const baseTextureResults = await Promise.all(
        baseLayers.map((layer) => layer.default ? loadTextureSafe(textureLoader, layer.path) : Promise.resolve(null)),
      );
      const moonTextures = new Map(); // populated in background after first render
      for (let index = 0; index < baseLayers.length; index += 1) {
        const texture = baseTextureResults[index]
          ? applyTextureTransforms(baseTextureResults[index], baseLayers[index])
          : null;
        if (texture) {
          texture.colorSpace = THREE.SRGBColorSpace;
        }
        layerTextures.set(baseLayers[index].id, texture);
      }

      const geologyLayers = manifest.geology_layers || [{
        id: "sim3292-units",
        label: "SIM 3292 units",
        path: manifest.geology.path,
        description: "Global geology unit fill rebuilt from the SIM 3292 polygon database.",
        default: true,
      }];
      const mineralLayers = manifest.mineral_layers || [];
      const geologyTextures = new Map();
      const mineralTextures = new Map();
      // Phase 1: elevation + default geology only. Non-default geology and minerals load in background.
      const [elevationMap, ...overlayMaps] = await Promise.all([
        loadTextureSafe(textureLoader, manifest.elevation.path),
        ...geologyLayers.map((layer) => layer.default ? loadTextureSafe(textureLoader, layer.path) : Promise.resolve(null)),
        ...mineralLayers.map(() => Promise.resolve(null)),
      ]);
      for (let index = 0; index < geologyLayers.length; index += 1) {
        const texture = applyTextureTransforms(overlayMaps[index], geologyLayers[index]);
        if (texture) {
          texture.colorSpace = THREE.SRGBColorSpace;
        }
        geologyTextures.set(geologyLayers[index].id, texture);
      }
      for (let index = 0; index < mineralLayers.length; index += 1) {
        const raw = overlayMaps[geologyLayers.length + index];
        if (raw) {
          raw.colorSpace = THREE.SRGBColorSpace;
        }
        const texture = raw ? processMineralTexture(raw) : null;
        mineralTextures.set(mineralLayers[index].id, texture);
      }
      if (elevationMap) {
        elevationMap.colorSpace = THREE.NoColorSpace;
      }
      const elevationSampler = createElevationSamplerState(elevationMap);
      const labelElevationCache = new Map();
      const seismicElevationCache = new Map();
      const popupElevationCache = new Map();

      for (const layer of baseLayers) {
        const option = document.createElement("option");
        option.value = layer.id;
        option.textContent = layer.label;
        baseLayerSelect.appendChild(option);
      }
      const noneOption = document.createElement("option");
      noneOption.value = "";
      noneOption.textContent = "None";
      mineralSelect.appendChild(noneOption);
      for (const layer of mineralLayers) {
        const option = document.createElement("option");
        option.value = layer.id;
        option.textContent = layer.label;
        mineralSelect.appendChild(option);
      }
      const initialLayer = baseLayers.find((layer) => layer.label === "Jupiter Body")
        || baseLayers.find((layer) => layer.default)
        || baseLayers[0];
      baseLayerSelect.value = initialLayer.id;
      const initialGeologyLayer = geologyLayers.find((layer) => layer.default) || geologyLayers[0];
      mineralSelect.value = "";
      const seaLevelMaxMeters = 0;
      const elevationMinMeters = Math.floor(Number(manifest.elevation?.min_m ?? -8200) / 25) * 25;
      seaLevelSlider.min = String(elevationMinMeters);
      seaLevelSlider.max = String(seaLevelMaxMeters);
      seaLevelSlider.value = String(clamp(Number(seaLevelSlider.value), elevationMinMeters, seaLevelMaxMeters));
      seaLevelValue.textContent = `${seaLevelSlider.value} m`;
      seaLevelCopy.innerHTML = `Speculative northern-ocean highstand slider. Upper bound: ${seaLevelMaxMeters} m. Current level: <span id="sea-level-value">${seaLevelSlider.value} m</span>`;

      const jupiterConfig = manifest.jupiter || {};
      const sphereGeometry = new THREE.SphereGeometry(3.2, 192, 192);
      const initialBaseTexture = layerTextures.get(initialLayer.id) || null;

      const baseMaterial = new THREE.MeshStandardMaterial({
        color: initialBaseTexture ? 0xffffff : 0xd0b18a,
        map: initialBaseTexture,
        roughness: 1,
        metalness: 0,
      });

      const globe = new THREE.Mesh(sphereGeometry, baseMaterial);
      globe.rotation.y = Math.PI;
      marsGroup.add(globe);

      const ringsConfig = jupiterConfig.rings || null;
      let ringMaterial = null;
      if (ringsConfig && ringsConfig.path) {
        const ringOuterKm = Number.isFinite(Number(ringsConfig.outer_km))
          ? Number(ringsConfig.outer_km)
          : JUPITER_RING_REFERENCE_KM.mainOuter;
        const baseRingTexture = await loadTextureSafe(textureLoader, ringsConfig.path);
        const ringTexture = createCalibratedJupiterRingTexture(baseRingTexture, ringOuterKm);
        if (baseRingTexture) {
          baseRingTexture.dispose();
        }
        if (ringTexture) {
          ringTexture.colorSpace = THREE.SRGBColorSpace;
          ringTexture.wrapS = THREE.ClampToEdgeWrapping;
          ringTexture.wrapT = THREE.ClampToEdgeWrapping;
          ringTexture.generateMipmaps = false;
          ringTexture.minFilter = THREE.LinearFilter;
          ringTexture.magFilter = THREE.LinearFilter;
          ringTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          const ringUvRepeat = Number(ringsConfig.texture_repeat || 1);
          ringTexture.center.set(0.5, 0.5);
          ringTexture.repeat.set(ringUvRepeat, ringUvRepeat);
          ringTexture.offset.set(0, 0);
          const innerRadius = Number.isFinite(Number(ringsConfig.inner_km))
            ? Number(ringsConfig.inner_km) * JUPITER_KM_TO_SCENE
            : Number(ringsConfig.inner_radius || 3.968);
          const outerRadius = Number.isFinite(Number(ringsConfig.outer_km))
            ? Number(ringsConfig.outer_km) * JUPITER_KM_TO_SCENE
            : Number(ringsConfig.outer_radius || 7.62);
          ringMaterial = new THREE.MeshStandardMaterial({
            map: ringTexture,
            transparent: true,
            opacity: Number(ringsConfig.opacity ?? 0.5),
            alphaTest: 0.02,
            side: THREE.DoubleSide,
            roughness: 0.94,
            metalness: 0,
            emissive: new THREE.Color(0.04, 0.05, 0.09),
            emissiveIntensity: 1.0,
            depthWrite: false,
            depthTest: true,
          });
          const ringMesh = new THREE.Mesh(
            new THREE.RingGeometry(innerRadius, outerRadius, 1024),
            ringMaterial,
          );
          ringMesh.rotation.x = -Math.PI / 2;
          ringMesh.renderOrder = 1;
          marsGroup.add(ringMesh);
        }
      }

      const cutawayResult = buildCutawayInterior(
        3.2,
        CORE_LAYER_DATA,
        elevationMap,
        0,
      );
      const cutawayGroup = cutawayResult.group;
      marsGroup.add(cutawayGroup);
      // Replace all inner-layer shader materials with solid opaque MeshStandardMaterial.
      // BackSide on curved half-spheres = concave inner surface only (no donut).
      // molecularBoundaryMesh is the outer convex fill — override it too so it's fully opaque.
      const JUPITER_UPPER_FACE_MAT = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: layerTextures.get(baseLayerSelect.value) || null },
        },
        vertexShader: SECTION_FACE_VERT,
        fragmentShader: `
          varying vec2 vUv;
          uniform sampler2D uMap;
          void main(){
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);
            float x = sqrt(max(1.0 - min(r * r, 1.0), 0.0));
            vec3 spherePoint = normalize(vec3(x, -p.y, p.x));
            float lon = atan(spherePoint.z, spherePoint.x);
            float lat = asin(clamp(spherePoint.y, -1.0, 1.0));
            vec2 sampleUv = vec2(0.5 + lon / (6.28318530718), 0.5 - lat / 3.14159265359);
            vec3 texCol = texture2D(uMap, sampleUv).rgb;
            vec3 jupiterCream = vec3(0.90, 0.82, 0.68);
            vec3 jupiterPale = vec3(0.97, 0.92, 0.82);
            vec3 haze = vec3(0.98, 0.95, 0.88);
            float cloudMask = smoothstep(0.26, 0.86, texCol.r * 0.95 + texCol.g * 0.75 - texCol.b * 0.22);
            vec3 toned = mix(texCol, jupiterCream, 0.58);
            toned = pow(max(toned, vec3(0.0)), vec3(0.82));
            toned = mix(toned, jupiterPale, cloudMask * 0.24);
            float rim = smoothstep(0.72, 0.99, r);
            vec3 col = mix(toned, haze, rim * 0.22);
            col *= vec3(1.02, 0.99, 0.94);
            col *= 1.0 - smoothstep(0.94, 1.02, r) * 0.04;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const JUPITER_IA_OUTER = new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 0.68, metalness: 0.10, side: THREE.FrontSide });
      const JUPITER_FT_MAT   = new THREE.MeshStandardMaterial({ color: 0x5080b8, roughness: 0.50, metalness: 0.42, side: THREE.BackSide });
      const JUPITER_FT_OUTER = new THREE.MeshStandardMaterial({ color: 0xb0bcc8, roughness: 0.55, metalness: 0.20, side: THREE.FrontSide });
      const JUPITER_FT_FLAT  = new THREE.MeshStandardMaterial({ color: 0x5080b8, roughness: 0.50, metalness: 0.42, side: THREE.DoubleSide });
      const JUPITER_MH_MAT   = new THREE.MeshStandardMaterial({ color: 0xb0bcc8, roughness: 0.55, metalness: 0.20, side: THREE.BackSide });
      const JUPITER_MH_OUTER = new THREE.MeshStandardMaterial({ color: 0xb0bcc8, roughness: 0.55, metalness: 0.20, side: THREE.FrontSide });
      const JUPITER_HC_MAT   = new THREE.MeshStandardMaterial({ color: 0xc84020, roughness: 0.72, metalness: 0.10, side: THREE.BackSide });
      const JUPITER_MH_FLAT  = new THREE.MeshStandardMaterial({ color: 0xb0bcc8, roughness: 0.55, metalness: 0.20, side: THREE.DoubleSide });
      const JUPITER_HC_FLAT  = new THREE.MeshStandardMaterial({ color: 0xc84020, roughness: 0.72, metalness: 0.10, side: THREE.DoubleSide });
      if (cutawayResult.crustRing) cutawayResult.crustRing.material = JUPITER_UPPER_FACE_MAT;
      if (cutawayResult.molecularBoundaryMesh) cutawayResult.molecularBoundaryMesh.material = JUPITER_IA_OUTER;
      if (cutawayResult.heavyElementCoreMesh) cutawayResult.heavyElementCoreMesh.material = JUPITER_HC_MAT;
      if (cutawayResult.heavyElementCoreCapMesh) cutawayResult.heavyElementCoreCapMesh.material = JUPITER_HC_FLAT;
      const jupiterSolidInterior = buildJupiterSolidInterior(3.2);
      const jupiterSolidInteriorGroup = jupiterSolidInterior.group;
      marsGroup.add(jupiterSolidInteriorGroup);
      const jupiterInteriorSphereMaterials = [
        jupiterSolidInterior.fluidTransitionMaterial,
        jupiterSolidInterior.metallicHydrogenMaterial,
        jupiterSolidInterior.heavyElementCoreMaterial,
      ].filter(Boolean);
      const jupiterInteriorCapMaterials = [
        jupiterSolidInterior.fluidTransitionCapMaterial,
        jupiterSolidInterior.metallicHydrogenCapMaterial,
        jupiterSolidInterior.heavyElementCoreCapMaterial,
      ].filter(Boolean);
      const jupiterBodyScaleY = Number(jupiterConfig.body_scale_y || 0.902);
      const jupiterAxialTiltDeg = Number(jupiterConfig.axial_tilt_deg || 26.7);
      marsGroup.scale.set(1, jupiterBodyScaleY, 1);
      const applyJupiterViewMode = (mode = "tilted", resetCamera = false) => {
        const tiltRad = mode === "untilted"
          ? 0
          : THREE.MathUtils.degToRad(jupiterAxialTiltDeg);
        marsGroup.rotation.z = tiltRad;
        cutawayClipPlane.normal.set(Math.cos(tiltRad), Math.sin(tiltRad), 0).normalize();
        cutawayClipPlane.constant = 0;
        if (resetCamera) {
          camera.position.set(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z);
          controls.target.set(0, 0, 0);
          controls.update();
        }
      };
      viewerApplyJupiterViewMode = applyJupiterViewMode;
      applyJupiterViewMode(jupiterViewModeSelect ? jupiterViewModeSelect.value : "tilted");

      await document.fonts.ready;
      const getTerrainRelief = () => 0;
      const labelLayer = buildLabelLayer(3.2, elevationSampler, labelElevationCache, getTerrainRelief);
      labelLayer.group.visible = true;
      marsGroup.add(labelLayer.group);
      const selectionRing = new THREE.Mesh(
        new THREE.SphereGeometry(0.036, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
      );
      selectionRing.renderOrder = 203;
      selectionRing.visible = false;
      labelLayer.group.add(selectionRing);
      const ringLabelLayer = buildRingLabelLayer();
      ringLabelLayer.group.visible = true;
      marsGroup.add(ringLabelLayer.group);
      const moonLayer = buildMoonLayer(moonTextures);
      for (const entry of moonLayer.entries) {
        const initAngle = Math.atan2(entry.anchor.z, entry.anchor.x);
        // Tidal locking: left-edge moons → −initAngle; texture-centered → π−initAngle.
        // Non-locked moons (Hyperion, Phoebe) start at 0 and rotate via own period each frame.
        const _moonName = entry.item?.name;
        entry.moonMesh.rotation.y = MOON_SELF_ROT_DAYS[_moonName] !== undefined
          ? 0
          : TEXTURE_CENTERED_MOONS.has(_moonName)
            ? (Math.PI - initAngle)
            : -initAngle;
      }
      moonLayer.group.visible = true;
      marsGroup.add(moonLayer.group);
      // Map moon name → THREE.Mesh so feature labels and the readout can use the mesh's transform.
      moonMeshMap = new Map(
        moonLayer.entries.map(e => [e.item?.name, e.moonMesh]).filter(([k]) => k)
      );
      const moonFeatureLabelLayer = buildMoonFeatureLabelLayer(moonMeshMap);
      moonFeatureLabelLayer.group.visible = true;
      marsGroup.add(moonFeatureLabelLayer.group);
      // Verify Dione feature coordinates at startup — remove once confirmed correct.
      // Force dioneMesh.matrix current (position + rotation.y were set in the init loop above).
      (() => {
        const dioneMesh = moonMeshMap.get("Dione");
        const dioneData = moonData.find(m => m.name === "Dione");
        if (!dioneMesh || !dioneData) return;
        dioneMesh.updateMatrix();
        const invMeshMatrix = dioneMesh.matrix.clone().invert();
        moonFeatureData.filter(f => f.moon_name === "Dione").forEach(f => {
          // Compute the local position and transform it to marsGroup space.
          const local = moonFeatureLocalPos(f.lat, f.lon, "Dione", dioneData.moon_radius);
          const marsLocal = local.clone().applyMatrix4(dioneMesh.matrix);
          // Round-trip: convert marsGroup-local back to moon-local and get IAU coords.
          const localBack = marsLocal.clone().applyMatrix4(invMeshMatrix).normalize();
          // Left-edge convention: local space = body-fixed direction directly.
          const check = vectorToLatLon(localBack);
          const ok = Math.abs(check.lat - f.lat) < 0.5 && Math.abs(((check.lon - f.lon + 540) % 360) - 180) < 0.5;
          console.log(`[Dione verify] ${f.name}: expected (${f.lat.toFixed(1)}°N, ${f.lon.toFixed(1)}°E) → round-trip (${check.lat.toFixed(1)}°N, ${check.lon.toFixed(1)}°E) ${ok ? "✓" : "✗ MISMATCH"}`);
        });
      })();
      const flybyPathLayer = buildFlybyPaths();
      flybyPathLayer.group.visible = flybyPathsToggle.checked;
      marsGroup.add(flybyPathLayer.group);

      const seismicLayer = buildSeismicLayer(3.2, seismicCatalog, elevationSampler, seismicElevationCache, getTerrainRelief);
      seismicLayer.group.visible = seismicToggle.checked && seismicLayer.available;
      marsGroup.add(seismicLayer.group);
      const geologyContactLayer = buildGeologyVectorLayer(
        THREE,
        geologyInteractiveState?.contacts || [],
        3.202,
        elevationSampler,
        popupElevationCache,
        getTerrainRelief,
        0.00025,
        0.28,
        108,
      );
      geologyContactLayer.group.visible = geologyContactsToggle.checked && geologyContactLayer.available;
      marsGroup.add(geologyContactLayer.group);
      const geologyStructureLayer = buildGeologyVectorLayer(
        THREE,
        geologyInteractiveState?.structures || [],
        3.204,
        elevationSampler,
        popupElevationCache,
        getTerrainRelief,
        0.00045,
        0.48,
        109,
      );
      geologyStructureLayer.group.visible = geologyStructuresToggle.checked && geologyStructureLayer.available;
      marsGroup.add(geologyStructureLayer.group);
      const seismicTimelineEvents = (seismicCatalog && Array.isArray(seismicCatalog.events) ? seismicCatalog.events : [])
        .map((event) => ({ event, timestamp: parseEventTimestamp(event.event_time) }))
        .filter((entry) => entry.timestamp !== null)
        .sort((a, b) => a.timestamp - b.timestamp);
      const seismicTimelineMin = seismicTimelineEvents.length ? seismicTimelineEvents[0].timestamp : null;
      const seismicTimelineMax = seismicTimelineEvents.length ? seismicTimelineEvents[seismicTimelineEvents.length - 1].timestamp : null;
      const currentTimelineCutoff = () => {
        if (!seismicTimelineEvents.length || Number(seismicTimelineSlider.value) >= 100) {
          return null;
        }
        const ratio = Number(seismicTimelineSlider.value) / 100;
        return seismicTimelineMin + ((seismicTimelineMax - seismicTimelineMin) * ratio);
      };
      const raycaster = new THREE.Raycaster();
      raycaster.params.Line.threshold = 0.12;
      const pointer = new THREE.Vector2();
      let pointerDown = null;
      let hoveredFeature = null;
      let measureMode = "";
      let measurePoints = [];
      let measureProfileSamples = [];
      const measureVisuals = [];
      const measureGroup = new THREE.Group();
      marsGroup.add(measureGroup);
      const geologyBoundaryGroup = new THREE.Group();
      geologyBoundaryGroup.visible = false;
      geologyBoundaryGroup.renderOrder = 111;
      marsGroup.add(geologyBoundaryGroup);
      selectedGeologyBoundaryGroup = geologyBoundaryGroup;

      const geologyOutlineState = createGeologyOutlineState(THREE, geologyInteractiveState);
      if (geologyOutlineState) {
        const geologyOutlineMesh = new THREE.Mesh(
          new THREE.SphereGeometry(3.209, 192, 192),
          new THREE.MeshBasicMaterial({
            map: geologyOutlineState.texture,
            displacementMap: elevationMap || null,
            displacementScale: elevationMap ? Number(terrainScale.value) : 0,
            transparent: true,
            opacity: 0.92,
            depthWrite: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -6,
            polygonOffsetUnits: -6,
          }),
        );
        geologyOutlineMesh.rotation.y = Math.PI;
        geologyOutlineMesh.visible = false;
        geologyOutlineMesh.renderOrder = 109;
        marsGroup.add(geologyOutlineMesh);
        selectedGeologyOutline = {
          ...geologyOutlineState,
          mesh: geologyOutlineMesh,
        };
      }

      function getFeatureSurfacePoint(feature, lift = 0.01) {
        if (Array.isArray(feature.ring_anchor)) {
          const anchor = feature.ring_anchor;
          return new THREE.Vector3(anchor[0], anchor[1] + lift, anchor[2]);
        }
        if (Array.isArray(feature.moon_anchor)) {
          const anchor = feature.moon_anchor;
          return new THREE.Vector3(anchor[0], anchor[1] + lift, anchor[2]);
        }
        const lat = feature.lat !== undefined ? feature.lat : feature.anchor_lat;
        const lon = feature.lon !== undefined ? feature.lon : feature.anchor_lon;
        return getReliefPoint(3.2, elevationSampler, popupElevationCache, getTerrainRelief, lat, lon, lift);
      }

      function syncGeologyFeatureOutline() {
        if (!selectedGeologyOutline || !selectedGeologyOutline.mesh) {
          return;
        }
        const geologyFeature = !activePopupIsCoreLabel && activePopupFeature && Array.isArray(activePopupFeature.polygons)
          ? activePopupFeature
          : null;
        const shouldShow = Boolean(geologyFeature) && geologyToggle.checked;
        if (!shouldShow) {
          paintSelectedGeologyOutline(selectedGeologyOutline, null);
          selectedGeologyOutline.mesh.visible = false;
          return;
        }
        paintSelectedGeologyOutline(selectedGeologyOutline, geologyFeature);
        selectedGeologyOutline.mesh.visible = true;
      }

      function rebuildSelectedGeologyBoundary() {
        if (!selectedGeologyBoundaryGroup) {
          return;
        }
        while (selectedGeologyBoundaryGroup.children.length) {
          const child = selectedGeologyBoundaryGroup.children.pop();
          child.geometry?.dispose?.();
          child.material?.dispose?.();
        }
        if (
          activePopupIsCoreLabel ||
          !activePopupFeature ||
          !Array.isArray(activePopupFeature.polygons) ||
          !activePopupFeature.polygons.length ||
          !geologyToggle.checked ||
          coreToggle.checked
        ) {
          selectedGeologyBoundaryGroup.visible = false;
          return;
        }

        const buildSegments = (ring) => {
          const segments = [];
          let current = [];
          let previousLon = null;
          for (const pair of ring) {
            const [rawLon, lat] = pair;
            const lon = ((Number(rawLon) % 360) + 360) % 360;
            if (previousLon !== null && Math.abs(lon - previousLon) > 180) {
              if (current.length >= 2) {
                segments.push(current);
              }
              current = [];
            }
            current.push(getReliefPoint(3.2, elevationSampler, popupElevationCache, getTerrainRelief, lat, lon, 0.0032));
            previousLon = lon;
          }
          if (current.length >= 2) {
            segments.push(current);
          }
          return segments;
        };

        const rings = activePopupFeature.polygons.flatMap((polygon) => [polygon.outer, ...(polygon.holes || [])]);
        for (const ring of rings) {
          for (const segment of buildSegments(ring)) {
            const line = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(segment),
              new THREE.LineBasicMaterial({
                color: 0xffbf6f,
                transparent: true,
                opacity: 0.92,
                depthTest: true,
                depthWrite: false,
                clipping: true,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
              }),
            );
            line.renderOrder = 110;
            line.userData.selectionAccent = true;
            selectedGeologyBoundaryGroup.add(line);

            const markerGeometry = new THREE.SphereGeometry(0.006, 10, 10);
            const markerMaterial = new THREE.MeshBasicMaterial({
              color: 0xffdeac,
              transparent: true,
              opacity: 0.86,
              depthTest: true,
              depthWrite: false,
              clipping: true,
              polygonOffset: true,
              polygonOffsetFactor: -3,
              polygonOffsetUnits: -3,
            });
            for (let index = 0; index < segment.length; index += 4) {
              const marker = new THREE.Mesh(markerGeometry, markerMaterial);
              marker.position.copy(segment[index]);
              marker.renderOrder = 111;
              marker.userData.selectionAccent = true;
              selectedGeologyBoundaryGroup.add(marker);
            }
          }
        }
        selectedGeologyBoundaryGroup.visible = selectedGeologyBoundaryGroup.children.length > 0;
      }

      function resetLabelEntryPulse(entry) {
        if (!entry || !entry._pulseBase) return;
        if (entry.sprite?.material) {
          entry.sprite.material.color.copy(entry._pulseBase.spriteColor);
          entry.sprite.material.opacity = entry._pulseBase.spriteOpacity;
        }
        if (entry.dot?.material) {
          entry.dot.material.color.copy(entry._pulseBase.dotColor);
        }
        if (entry.marker?.material) {
          entry.marker.material.color.copy(entry._pulseBase.markerColor);
          entry.marker.material.opacity = entry._pulseBase.markerOpacity;
        }
        if (entry.marker && entry._pulseBase.markerScale) {
          entry.marker.scale.copy(entry._pulseBase.markerScale);
        }
        if (entry.line?.material) {
          entry.line.material.opacity = entry._pulseBase.lineOpacity;
        }
        delete entry._pulseBase;
      }

      function featuresLikelyEqual(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        if (a.id !== undefined && b.id !== undefined && a.id === b.id) return true;
        if (a.name && b.name && a.name === b.name) {
          const aLat = a.lat !== undefined ? Number(a.lat) : (a.anchor_lat !== undefined ? Number(a.anchor_lat) : null);
          const bLat = b.lat !== undefined ? Number(b.lat) : (b.anchor_lat !== undefined ? Number(b.anchor_lat) : null);
          const aLon = a.lon !== undefined ? Number(a.lon) : (a.anchor_lon !== undefined ? Number(a.anchor_lon) : null);
          const bLon = b.lon !== undefined ? Number(b.lon) : (b.anchor_lon !== undefined ? Number(b.anchor_lon) : null);
          if (aLat === null || bLat === null || aLon === null || bLon === null) return true;
          return Math.abs(aLat - bLat) < 1e-6 && Math.abs(aLon - bLon) < 1e-6;
        }
        return false;
      }

      function entryMatchesFeature(entry, feature) {
        if (!entry || !feature) return false;
        const refs = [
          entry.item,
          entry.marker?.userData?.feature,
          entry.dot?.userData?.feature,
          entry.hitTarget?.userData?.feature,
          entry.sprite?.userData?.feature,
          entry.moonMesh?.userData?.feature,
          entry.line?.userData?.feature,
        ].filter(Boolean);
        return refs.some((ref) => featuresLikelyEqual(ref, feature));
      }

      function entryMatchesObject(entry, object) {
        if (!entry || !object) return false;
        return entry.marker === object
          || entry.hitTarget === object
          || entry.sprite === object
          || entry.moonMesh === object
          || entry.dot === object
          || entry.line === object;
      }

      function findEntryForFeature(feature) {
        if (!feature) return null;
        return labelLayer.entries.find((e) => entryMatchesFeature(e, feature))
          || ringLabelLayer.entries.find((e) => entryMatchesFeature(e, feature))
          || moonLayer.entries.find((e) => entryMatchesFeature(e, feature))
          || moonFeatureLabelLayer.entries.find((e) => entryMatchesFeature(e, feature))
          || null;
      }

      function syncSelectionHalo() {
        const coreEntry = (activePopupFeature && activePopupIsCoreLabel)
          ? (cutawayResult?.labelEntries || []).find((e) => e.dot?.userData?.feature === activePopupFeature || (activePopupFeature.id !== undefined && e.layerId === activePopupFeature.id)) || null
          : null;
        const nextEntry = (activePopupFeature && !activePopupIsCoreLabel)
          ? findEntryForFeature(activePopupFeature)
          : coreEntry;
        if (selectedLabelEntry && selectedLabelEntry !== nextEntry) {
          resetLabelEntryPulse(selectedLabelEntry);
        }
        selectedLabelEntry = nextEntry;
        selectedLabelEntryIsSurface = Boolean(nextEntry && !coreEntry);
        selectedLabelEntryIsCore = Boolean(coreEntry);
        syncGeologyFeatureOutline();
        rebuildSelectedGeologyBoundary();
      }
      viewerSyncSelectionHalo = syncSelectionHalo;

      function updateSeismicTimelineReadout() {
        const cutoff = currentTimelineCutoff();
        if (!seismicTimelineEvents.length || cutoff === null) {
          seismicTimelineReadout.textContent = "No seismic timeline is available for Jupiter.";
          return;
        }
        seismicTimelineReadout.textContent = `Showing events through ${new Date(cutoff).toLocaleDateString()}.`;
      }

    function buildDefaultSearchSuggestions() {
      return allFeatureData
        .slice()
        .sort((a, b) => getFeatureDisplayName(a).localeCompare(getFeatureDisplayName(b)));
    }

    function refreshSearchSuggestions() {
      const query = String(featureSearch.value || "").trim();
      featureSearchResults.hidden = true;
      featureSearchResults.innerHTML = "";
      activeSearchResults = [];
      activeSearchIndex = -1;
      if (!query) {
        renderFeatureSearchResults(buildDefaultSearchSuggestions());
        return;
      }
      renderFeatureSearchResults(getPredictiveNameMatches(query));
    }

    function refreshSearchSuggestionsAfterTextEdit() {
      refreshSearchSuggestions();
    }

    function isObjectActuallyVisible(object) {
      let current = object;
      while (current) {
        if (current.visible === false) {
          return false;
        }
        current = current.parent;
      }
      return true;
    }

      function clearMeasureGroup() {
        while (measureGroup.children.length > 0) {
          const child = measureGroup.children.pop();
          if (child.geometry) { child.geometry.dispose?.(); }
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((material) => material.dispose?.());
            } else {
              child.material.dispose?.();
            }
          }
        }
        measureVisuals.length = 0;
      }

      function setMeasureMode(nextMode) {
        measureMode = measureMode === nextMode ? "" : nextMode;
        resetActiveMeasurement(true);
      }

      function resetActiveMeasurement(preserveMode = false) {
        if (!preserveMode) {
          measureMode = "";
        }
        measurePoints = [];
        measureProfileSamples = [];
        clearMeasureGroup();
        hideMeasurementResultCard();
        measurePanel.hidden = !measureMode;
        measureMetric.textContent = "";
        profileCanvas.hidden = true;
        measureExport.disabled = !measureMode;
        [measureDistanceButton, measureAreaButton, measureProfileButton].forEach((button) => {
          button.classList.toggle("is-active", button.dataset.mode === measureMode);
        });
        [
          [toolRailDistanceButton, "distance"],
          [toolRailAreaButton, "area"],
          [toolRailProfileButton, "profile"],
        ].forEach(([button, mode]) => {
          if (button) button.classList.toggle("is-active", mode === measureMode);
        });
        measureRailActionGroups.forEach((group) => {
          group.hidden = group.dataset.measureActions !== measureMode;
        });
        measureRailExportButtons.forEach((button) => {
          button.disabled = !measureMode;
        });
        const context = getActiveMeasureContext();
        measureCopy.textContent = measureMode
          ? `Active tool: ${measureMode}. Click on ${context.bodyName}'s surface to add measurement points.`
          : "Choose a tool, then click on the globe to start measuring.";
        syncMeasureRailActions();
      }

      measureDistanceButton.dataset.mode = "distance";
      measureAreaButton.dataset.mode = "area";
      measureProfileButton.dataset.mode = "profile";
      measureDistanceButton.addEventListener("click", () => setMeasureMode("distance"));
      measureAreaButton.addEventListener("click", () => setMeasureMode("area"));
      measureProfileButton.addEventListener("click", () => setMeasureMode("profile"));
      if (toolRailDistanceButton) toolRailDistanceButton.addEventListener("click", () => measureDistanceButton.click());
      if (toolRailAreaButton) toolRailAreaButton.addEventListener("click", () => measureAreaButton.click());
      if (toolRailProfileButton) toolRailProfileButton.addEventListener("click", () => measureProfileButton.click());
      measureRailExportButtons.forEach((button) => {
        button.addEventListener("click", () => exportCurrentMeasurementCsv());
      });

      function exportCurrentMeasurementCsv() {
        if (!measureMode || !measurePoints.length) {
          return;
        }
        if (measureMode === "distance" && measurePoints.length >= 2) {
          const distanceKm = greatCircleDistanceKm(measurePoints[0], measurePoints[1]);
          downloadCsv("jupiter_distance_measurement.csv", [
            ["type", "start_lat_deg", "start_lon_deg_e", "end_lat_deg", "end_lon_deg_e", "distance_km"],
            [
              "distance",
              measurePoints[0].lat.toFixed(6),
              measurePoints[0].lon.toFixed(6),
              measurePoints[1].lat.toFixed(6),
              measurePoints[1].lon.toFixed(6),
              distanceKm.toFixed(3),
            ],
          ]);
          return;
        }
        if (measureMode === "area" && measurePoints.length >= 3) {
          const areaKm2 = sphericalPolygonAreaKm2(measurePoints);
          const rows = [["type", "vertex_index", "lat_deg", "lon_deg_e", "total_area_km2"]];
          measurePoints.forEach((point, index) => {
            rows.push([
              "area",
              index + 1,
              point.lat.toFixed(6),
              point.lon.toFixed(6),
              index === 0 ? areaKm2.toFixed(3) : "",
            ]);
          });
          downloadCsv("jupiter_area_measurement.csv", rows);
          return;
        }
        if (measureMode === "profile" && measureProfileSamples.length >= 2) {
          const totalDistanceKm = greatCircleDistanceKm(measurePoints[0], measurePoints[1]);
          const rows = [["sample_index", "distance_along_km", "lat_deg", "lon_deg_e", "elevation_m"]];
          measureProfileSamples.forEach((sample, index) => {
            rows.push([
              index + 1,
              ((index / (measureProfileSamples.length - 1)) * totalDistanceKm).toFixed(3),
              sample.lat.toFixed(6),
              sample.lon.toFixed(6),
              sample.elevation.toFixed(3),
            ]);
          });
          downloadCsv("jupiter_profile_measurement.csv", rows);
        }
      }

      function syncMeasureRailActions() {
        const canExport = {
          distance: measurePoints.length >= 2,
          area: measurePoints.length >= 3,
          profile: measureProfileSamples.length >= 2,
        };
        measureRailActionGroups.forEach((group) => {
          const mode = group.dataset.measureActions;
          group.hidden = measureMode !== mode;
        });
        measureRailExportButtons.forEach((button) => {
          const mode = button.dataset.measureExport;
          button.disabled = !canExport[mode];
        });
      }

      function parseMoonRadiusKm(feature) {
        const value = Number(String(feature?.mean_radius_km || "").replace(/[^0-9.]/g, ""));
        return Number.isFinite(value) && value > 0 ? value : MARS_MEAN_RADIUS_KM;
      }

      function cloneMeasureContext(context) {
        return {
          kind: context.kind,
          bodyName: context.bodyName,
          radiusKm: context.radiusKm,
          radiusWorld: context.radiusWorld,
          centerLocal: context.centerLocal.clone(),
        };
      }

      function getMoonMeasureContext(feature = activeMoonViewerFeature) {
        if (!feature || !moonLayer || !Array.isArray(moonLayer.entries)) {
          return null;
        }
        const entry = moonLayer.entries.find((item) => item.item?.name === feature.name);
        if (!entry) {
          return null;
        }
        return {
          kind: "moon",
          bodyName: feature.name,
          radiusKm: parseMoonRadiusKm(feature),
          radiusWorld: Number(feature.moon_radius || 0.1),
          centerLocal: entry.anchor.clone(),
          mesh: entry.moonMesh,
        };
      }

      function getActiveMeasureContext() {
        if (activeMoonViewerFeature) {
          return getMoonMeasureContext(); // null if lookup fails — no Jupiter fallback in moon viewer
        }
        return getMoonMeasureContext() || {
          kind: "planet",
          bodyName: "Jupiter",
          radiusKm: MARS_MEAN_RADIUS_KM,
          radiusWorld: 3.2,
          centerLocal: new THREE.Vector3(0, 0, 0),
          mesh: globe,
        };
      }

      function vectorToLatLonInMeasureContext(localPoint, context) {
        return vectorToLatLon(localPoint.clone().sub(context.centerLocal));
      }

      function normalizeMeasureHitLocalPoint(localPoint, context) {
        if (context.kind === "moon") {
          return localPoint.clone();
        }
        // Store planetary measurements in the unspun body frame, then rotate the
        // measurement overlay with Jupiter so markers and area vertices stay locked.
        return localPoint.clone().applyEuler(new THREE.Euler(0, -(globe.rotation.y - Math.PI), 0));
      }

      function intersectMarsSurface(clientX, clientY) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        const intersections = raycaster.intersectObject(globe, false);
        return intersections.find((entry) => entry.object.visible) || null;
      }

      function intersectExposedJupiterInteriorSurface(clientX, clientY) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        const exposedTargets = [
          jupiterSolidInterior?.fluidTransitionMesh,
          jupiterSolidInterior?.metallicHydrogenMesh,
          jupiterSolidInterior?.heavyElementCoreMesh,
        ].filter((mesh) => mesh && mesh.visible);
        if (!exposedTargets.length) return null;
        const hit = raycaster.intersectObjects(exposedTargets, false).find((entry) => entry.object.visible) || null;
        if (!hit) return null;
        const localPoint = marsGroup.worldToLocal(hit.point.clone());
        const latLon = vectorToLatLon(localPoint.clone());
        return { ...hit, localPoint, lat: latLon.lat, lon: latLon.lon, context: { kind: "jupiter-interior-surface" } };
      }

      function intersectMeasurementSurface(clientX, clientY) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        const context = getActiveMeasureContext();
        const intersections = raycaster.intersectObject(context.mesh, false);
        const hit = intersections.find((entry) => entry.object.visible) || null;
        if (!hit) {
          return null;
        }
        const hitLocalPoint = marsGroup.worldToLocal(hit.point.clone());
        const localPoint = normalizeMeasureHitLocalPoint(hitLocalPoint, context);
        // For moon hits, transform into the moon mesh's own local frame so that
        // vectorToLatLon sees texture-space coordinates (tidal-locking rotation included).
        const latLon = (context.kind === "moon" && context.mesh)
          ? vectorToLatLon(context.mesh.worldToLocal(hit.point.clone()))
          : vectorToLatLonInMeasureContext(localPoint, context);
        // vectorToLatLon on the mesh-local hit gives lon in the texture's left-edge CRS,
        // which is what we store, so no correction needed.
        return { ...hit, localPoint, lat: latLon.lat, lon: latLon.lon, context };
      }

      function getMeasurePointContext(pointLike) {
        if (pointLike?.context) {
          return pointLike.context;
        }
        return getActiveMeasureContext();
      }

      function getMeasurePointLocal(pointLike) {
        if (pointLike?.localPoint) {
          return pointLike.localPoint.clone();
        }
        if (pointLike?.point) {
          return pointLike.point.clone();
        }
        return pointLike.clone();
      }

      function getMeasurePointNormal(pointLike, context = getMeasurePointContext(pointLike)) {
        return getMeasurePointLocal(pointLike).sub(context.centerLocal).normalize();
      }

      function addMeasureMarker(point, index) {
        const context = getMeasurePointContext(point);
        const isMoon = context.kind === "moon";
        const baseMarkerRadius = (isMoon
          ? THREE.MathUtils.clamp(context.radiusWorld * 0.024, 0.0022, 0.0038)
          : 0.05) * 0.5;
        const markerPos = projectMeasurePoint(point, isMoon ? 0.0025 : 0.018);
        // For moons the normal must point away from the moon center, not Jupiter's origin.
        const surfaceNormal = isMoon
          ? markerPos.clone().sub(context.centerLocal).normalize()
          : markerPos.clone().normalize();
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(baseMarkerRadius, 10, 10),
          new THREE.MeshBasicMaterial({
            color: 0xffd0b0,
            depthTest: false,
            depthWrite: false,
          }),
        );
        marker.position.copy(markerPos);
        marker.renderOrder = 90;
        measureGroup.add(marker);

        // Point label ("A", "B", "C"…)
        const letter = String.fromCharCode(65 + (index || 0));
        const labelCanvas = document.createElement("canvas");
        const fontSize = isMoon ? 18 : 26;
        labelCanvas.width = fontSize * 2;
        labelCanvas.height = fontSize * 2;
        const lctx = labelCanvas.getContext("2d");
        lctx.font = `bold ${fontSize}px sans-serif`;
        lctx.textAlign = "center";
        lctx.textBaseline = "middle";
        lctx.strokeStyle = "rgba(10,10,18,0.9)";
        lctx.lineWidth = fontSize * 0.28;
        lctx.lineJoin = "round";
        lctx.strokeText(letter, labelCanvas.width / 2, labelCanvas.height / 2);
        lctx.fillStyle = "#ffd0b0";
        lctx.fillText(letter, labelCanvas.width / 2, labelCanvas.height / 2);
        const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(labelCanvas),
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }));
        const baseSpriteScale = isMoon ? baseMarkerRadius * 8 : 0.18;
        labelSprite.scale.set(baseSpriteScale, baseSpriteScale, 1);
        const outDir = surfaceNormal.clone();
        const baseLabelOffset = isMoon ? baseMarkerRadius * 5 : 0.14;
        labelSprite.position.copy(markerPos).addScaledVector(outDir, baseLabelOffset);
        labelSprite.renderOrder = 91;
        measureGroup.add(labelSprite);

        measureVisuals.push({
          marker,
          labelSprite,
          markerAnchor: markerPos.clone(),
          surfaceNormal: surfaceNormal.clone(),
          baseLabelOffset,
          baseMarkerRadius,
          targetMarkerPx: isMoon ? 11 : 8,
          targetLabelPx: isMoon ? 16 : 18,
          maxMarkerWorldRadius: isMoon ? context.radiusWorld * 0.06 : 0.04,
        });
      }

      function updateMeasureVisualScale() {
        if (!measureVisuals.length) return;
        const viewportHeight = renderer.domElement.clientHeight || window.innerHeight || 1;
        const fovScale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5));
        const markerWorldPos = new THREE.Vector3();
        for (const visual of measureVisuals) {
          if (!visual.marker || !visual.labelSprite) continue;
          visual.marker.getWorldPosition(markerWorldPos);
          const dist = Math.max(camera.position.distanceTo(markerWorldPos), 0.001);
          const worldUnitsPerPixel = dist / Math.max(fovScale, 0.001);
          const baseR = Math.max(visual.baseMarkerRadius, 1e-6);
          const rawMarkerScale = (worldUnitsPerPixel * visual.targetMarkerPx) / baseR;
          const maxMarkerScale = visual.maxMarkerWorldRadius / baseR;
          const markerScale = Math.min(rawMarkerScale, maxMarkerScale);
          const rawSpriteScale = worldUnitsPerPixel * visual.targetLabelPx;
          const maxSpriteScale = visual.maxMarkerWorldRadius * (visual.targetLabelPx / Math.max(visual.targetMarkerPx, 1));
          const spriteScale = Math.min(rawSpriteScale, maxSpriteScale);
          visual.marker.scale.setScalar(markerScale);
          visual.labelSprite.scale.set(spriteScale, spriteScale, 1);
          visual.labelSprite.position.copy(visual.markerAnchor)
            .addScaledVector(visual.surfaceNormal, visual.baseLabelOffset + baseR * markerScale * 0.5);
        }
      }

      function measureSurfaceRadius(latDegrees, lonDegrees, lift = 0.012, context = getActiveMeasureContext()) {
        if (context.kind === "moon") {
          return context.radiusWorld + lift;
        }
        const relief = elevationMap ? Number(terrainScale.value) : 0;
        const displacement = elevationMap ? sampleElevationNormalized(elevationSampler, latDegrees, lonDegrees) * relief : 0;
        return 3.2 + displacement + lift;
      }

      function sampleMeasureSurfacePoint(latDegrees, lonDegrees, lift = 0.012, context = getActiveMeasureContext()) {
        const point = latLonToVector3(latDegrees, lonDegrees, measureSurfaceRadius(latDegrees, lonDegrees, lift, context));
        return context.kind === "moon" ? point.add(context.centerLocal) : point;
      }

      function projectMeasurePoint(pointLike, lift = 0.012) {
        const context = getMeasurePointContext(pointLike);
        const localPoint = getMeasurePointLocal(pointLike);
        if (context.kind === "moon") {
          return context.centerLocal.clone().add(
            localPoint.sub(context.centerLocal).normalize().multiplyScalar(context.radiusWorld + lift),
          );
        }
        const latLon = vectorToLatLon(localPoint);
        return sampleMeasureSurfacePoint(latLon.lat, latLon.lon, lift, context);
      }

      function buildMeasureArcPoints(startPoint, endPoint) {
        const context = getMeasurePointContext(startPoint);
        const startVec = getMeasurePointNormal(startPoint, context);
        const endVec = getMeasurePointNormal(endPoint, context);
        const angle = Math.acos(clamp(startVec.dot(endVec), -1, 1));
        const segmentCount = Math.max(40, Math.ceil((angle / Math.PI) * 96));
        const points = [];
        for (let index = 0; index <= segmentCount; index += 1) {
          const t = segmentCount === 0 ? 0 : index / segmentCount;
          let point;
          if (angle < 1e-5) {
            point = startVec.clone();
          } else {
            const sinTotal = Math.sin(angle);
            point = startVec.clone().multiplyScalar(Math.sin((1 - t) * angle) / sinTotal)
              .add(endVec.clone().multiplyScalar(Math.sin(t * angle) / sinTotal))
              .normalize();
          }
          if (context.kind === "moon") {
            points.push(context.centerLocal.clone().add(point.multiplyScalar(context.radiusWorld + 0.0025)));
          } else {
            const latLon = vectorToLatLon(point);
            points.push(sampleMeasureSurfacePoint(latLon.lat, latLon.lon, 0.012, context));
          }
        }
        return points;
      }

      function buildMeasureBoundaryPoints(points) {
        if (points.length < 2) {
          return [];
        }
        const boundaryPoints = [];
        for (let index = 0; index < points.length; index += 1) {
          const current = points[index];
          const next = points[(index + 1) % points.length];
          const arcPoints = buildMeasureArcPoints(current, next);
          if (index > 0) {
            arcPoints.shift();
          }
          boundaryPoints.push(...arcPoints);
        }
        return boundaryPoints;
      }

      function sampleMeasureSlerpPoint(startPoint, endPoint, t, lift = 0.01, context = getMeasurePointContext(startPoint)) {
        const startVec = getMeasurePointNormal(startPoint, context);
        const endVec = getMeasurePointNormal(endPoint, context);
        const angle = Math.acos(clamp(startVec.dot(endVec), -1, 1));
        let point;
        if (angle < 1e-5) {
          point = startVec.clone();
        } else {
          const sinTotal = Math.sin(angle);
          point = startVec.clone().multiplyScalar(Math.sin((1 - t) * angle) / sinTotal)
            .add(endVec.clone().multiplyScalar(Math.sin(t * angle) / sinTotal))
            .normalize();
        }
        if (context.kind === "moon") {
          return context.centerLocal.clone().add(point.multiplyScalar(context.radiusWorld + lift));
        }
        const latLon = vectorToLatLon(point);
        return sampleMeasureSurfacePoint(latLon.lat, latLon.lon, lift, context);
      }

      function buildAreaFillMesh(points) {
        if (points.length < 3) {
          return null;
        }
        const context = getMeasurePointContext(points[0]);
        const positions = [];
        if (context.kind === "moon") {
          // Fan-triangulate directly from boundary arc points — centroid-based fill
          // can diverge due to coordinate frame differences on small moon surfaces.
          const boundary = buildMeasureBoundaryPoints(points);
          if (boundary.length < 3) { return null; }
          const origin = boundary[0];
          for (let i = 1; i < boundary.length - 1; i += 1) {
            const a = origin;
            const b = boundary[i];
            const c = boundary[i + 1];
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
          }
        } else {
          const centerNormal = points.reduce((acc, point) => (
            acc.add(getMeasurePointNormal(point, context))
          ), new THREE.Vector3()).normalize();
          const center = sampleMeasureSurfacePoint(vectorToLatLon(centerNormal).lat, vectorToLatLon(centerNormal).lon, 0.01, context);
          const radialSegments = 12;
          for (let index = 0; index < points.length; index += 1) {
            const currentPoint = points[index];
            const nextPoint = points[(index + 1) % points.length];
            for (let segment = 0; segment < radialSegments; segment += 1) {
              const t0 = segment / radialSegments;
              const t1 = (segment + 1) / radialSegments;
              const a = sampleMeasureSlerpPoint(center, currentPoint, t0, 0.01, context);
              const b = sampleMeasureSlerpPoint(center, nextPoint, t0, 0.01, context);
              const c = sampleMeasureSlerpPoint(center, currentPoint, t1, 0.01, context);
              const d = sampleMeasureSlerpPoint(center, nextPoint, t1, 0.01, context);
              positions.push(
                a.x, a.y, a.z,
                c.x, c.y, c.z,
                b.x, b.y, b.z,
                c.x, c.y, c.z,
                d.x, d.y, d.z,
                b.x, b.y, b.z,
              );
            }
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: 0x58d0f6,
            transparent: true,
            opacity: 0.24,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
          }),
        );
        mesh.renderOrder = 80;
        mesh.frustumCulled = false;
        return mesh;
      }

      function updateMeasureVisualization() {
        clearMeasureGroup();
        if (!measurePoints.length) {
          hideMeasurementResultCard();
          measurePanel.hidden = !measureMode;
          measureMetric.textContent = "";
          profileCanvas.hidden = true;
          measureProfileSamples = [];
          return;
        }
        measurePanel.hidden = false;
        measurePoints.forEach((item, idx) => addMeasureMarker(item.point, idx));
        if (measurePoints.length >= 2) {
          let linePoints = [];
          if (measureMode === "area") {
            for (let index = 0; index < measurePoints.length - 1; index += 1) {
              const arcPoints = buildMeasureArcPoints(measurePoints[index].point, measurePoints[index + 1].point);
              if (index > 0) {
                arcPoints.shift();
              }
              linePoints.push(...arcPoints);
            }
          } else {
            linePoints = buildMeasureArcPoints(measurePoints[0].point, measurePoints[1].point);
          }
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(linePoints),
            new THREE.LineBasicMaterial({
              color: 0xffcf9d,
              transparent: true,
              opacity: 0.98,
              depthTest: false,
              depthWrite: false,
            }),
          );
          line.renderOrder = 95;
          measureGroup.add(line);
        }
        if (measureMode === "distance" && measurePoints.length >= 2) {
          const distanceKm = greatCircleDistanceKm(measurePoints[0], measurePoints[1]);
          const body = measurePoints[0].bodyName || "Jupiter";
          measureMetric.innerHTML = `${body} distance: ${distanceKm.toFixed(1)} km`;
          showMeasurementResultCard(
            `Distance: ${distanceKm.toFixed(1)} km`,
            measureMetric.innerHTML,
            toolRailDistanceButton,
          );
          measureProfileSamples = [];
          profileCanvas.hidden = true;
          hideProfileModal();
        } else if (measureMode === "area" && measurePoints.length >= 3) {
          const boundaryPoints = buildMeasureBoundaryPoints(measurePoints.map((item) => item.point));
          const fillMesh = buildAreaFillMesh(measurePoints);
          if (fillMesh) {
            measureGroup.add(fillMesh);
          }
          const closingPoints = [...boundaryPoints, boundaryPoints[0]];
          const polygonLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(closingPoints),
            new THREE.LineBasicMaterial({
              color: 0x58d0f6,
              transparent: true,
              opacity: 0.98,
              depthTest: false,
              depthWrite: false,
            }),
          );
          polygonLine.renderOrder = 96;
          measureGroup.add(polygonLine);
          const areaKm2 = sphericalPolygonAreaKm2(measurePoints);
          const body = measurePoints[0].bodyName || "Jupiter";
          measureMetric.innerHTML = `${body} area: ${areaKm2.toFixed(0)} km²`;
          showMeasurementResultCard(
            `Area: ${areaKm2.toFixed(0)} km²`,
            measureMetric.innerHTML,
            toolRailAreaButton,
          );
          measureProfileSamples = [];
          profileCanvas.hidden = true;
          hideProfileModal();
        } else if (measureMode === "profile" && measurePoints.length >= 2) {
          const profileSampler = activeMoonViewerFeature ? null : elevationSampler;
          const samples = sampleGreatCircleProfile(measurePoints[0], measurePoints[1], profileSampler);
          measureProfileSamples = samples;
          const elevations = samples.map((sample) => sample.elevation);
          const min = Math.min(...elevations);
          const max = Math.max(...elevations);
          measureMetric.innerHTML = `Profile: min ${min.toFixed(0)} m, max ${max.toFixed(0)} m, relief ${(max - min).toFixed(0)} m`;
          hideMeasurementResultCard();
          profileCanvas.hidden = true;
          showProfileModal(
            `${measurePoints[0].bodyName || "Jupiter"} Elevation Profile`,
            `Min ${min.toFixed(0)} m · Max ${max.toFixed(0)} m · Relief ${(max - min).toFixed(0)} m`,
            samples,
          );
        } else {
          measureMetric.textContent = "Add more points to complete this measurement.";
          hideMeasurementResultCard();
          measureProfileSamples = [];
          profileCanvas.hidden = true;
          hideProfileModal();
        }
        syncMeasureRailActions();
      }

      const coreLabelsToggle = document.getElementById("core-labels-toggle");
      if (coreLabelsToggle) {
        coreLabelsToggle.addEventListener("change", () => {
          updateCoreLabelVisibility(cutawayResult, camera, coreLabelsToggle.checked);
        });
      }

      let geologyGlobe = null;
      let geologyMaterial = null;
      let mineralGlobe = null;
      let mineralMaterial = null;
      let seaGlobe = null;
      let seaMaterial = null;
      let regionMaskGlobe = null;
      let regionMaskMaterial = null;
      const initialGeologyTexture = geologyTextures.get(initialGeologyLayer.id) || null;
      if (initialGeologyTexture) {
        geologyMaterial = new THREE.MeshStandardMaterial({
          map: initialGeologyTexture,
          displacementMap: elevationMap || null,
          displacementScale: elevationMap ? Number(terrainScale.value) : 0,
          transparent: true,
          opacity: Number(geologyOpacity.value),
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
          roughness: 1,
          metalness: 0,
        });

        geologyGlobe = new THREE.Mesh(
          new THREE.SphereGeometry(3.202, 192, 192),
          geologyMaterial,
        );
        geologyGlobe.rotation.y = Math.PI;
        marsGroup.add(geologyGlobe);
      } else {
        geologyOpacity.disabled = true;
      }

      mineralMaterial = new THREE.MeshStandardMaterial({
        map: null,
        displacementMap: elevationMap || null,
        displacementScale: elevationMap ? Number(terrainScale.value) : 0,
        transparent: true,
        opacity: Number(mineralOpacity.value),
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        roughness: 1,
        metalness: 0,
      });
      mineralGlobe = new THREE.Mesh(
        new THREE.SphereGeometry(3.204, 192, 192),
        mineralMaterial,
      );
      mineralGlobe.rotation.y = Math.PI;
      mineralGlobe.visible = false;
      marsGroup.add(mineralGlobe);

      const seaOverlayState = createSeaOverlayTextureState(elevationMap);
      if (seaOverlayState) {
        updateSeaOverlayTexture(seaOverlayState, Number(seaLevelSlider.value));
        seaMaterial = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: seaOverlayState.texture,
          displacementMap: elevationMap || null,
          displacementScale: elevationMap ? Number(terrainScale.value) : 0,
          transparent: true,
          opacity: 0.76,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
          roughness: 0.24,
          metalness: 0.02,
          emissive: new THREE.Color(0x123d54),
          emissiveIntensity: 0.2,
        });
        seaGlobe = new THREE.Mesh(
          new THREE.SphereGeometry(3.206, 192, 192),
          seaMaterial,
        );
        seaGlobe.rotation.y = Math.PI;
        seaGlobe.visible = seaToggle.checked;
        marsGroup.add(seaGlobe);
      } else {
        seaToggle.checked = false;
        seaToggle.disabled = true;
        seaLevelSlider.disabled = true;
        seaLevelCopy.textContent = "Paleo-sea overlay unavailable because the elevation raster could not be loaded.";
      }

      if (elevationSampler) {
        const initialRegionTexture = createRegionMaskTexture(regionMaskSelect.value, elevationSampler);
        regionMaskMaterial = new THREE.MeshStandardMaterial({
          map: initialRegionTexture,
          displacementMap: elevationMap || null,
          displacementScale: elevationMap ? Number(terrainScale.value) : 0,
          transparent: true,
          opacity: Number(regionMaskOpacity.value),
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
          roughness: 1,
          metalness: 0,
        });
        regionMaskGlobe = new THREE.Mesh(
          new THREE.SphereGeometry(3.208, 192, 192),
          regionMaskMaterial,
        );
        regionMaskGlobe.rotation.y = Math.PI;
        regionMaskGlobe.visible = Boolean(regionMaskSelect.value);
        marsGroup.add(regionMaskGlobe);
      } else {
        regionMaskSelect.disabled = true;
        regionMaskOpacity.disabled = true;
      }

      function applyJupiterAtmosphereRemoval() {
        const removeAtmosphere = Boolean(geologyToggle && geologyToggle.checked);
        const coreEnabled = Boolean(coreToggle && coreToggle.checked);
        const jupiterLabelsEnabled = !removeAtmosphere && labelsToggle.checked;
        globe.visible = !removeAtmosphere;
        // Solid interior only shown when removeAtmosphere AND core view is OFF.
        jupiterSolidInteriorGroup.visible = removeAtmosphere && !coreEnabled;
        if (jupiterSolidInterior.fluidTransitionMesh) {
          jupiterSolidInterior.fluidTransitionMesh.visible = false;
        }
        if (jupiterSolidInterior.fluidTransitionCapMesh) {
          jupiterSolidInterior.fluidTransitionCapMesh.visible = false;
        }
        if (jupiterSolidInterior.metallicHydrogenCapMesh) {
          jupiterSolidInterior.metallicHydrogenCapMesh.visible = false;
        }
        if (jupiterSolidInterior.heavyElementCoreCapMesh) {
          jupiterSolidInterior.heavyElementCoreCapMesh.visible = false;
        }
        for (const material of jupiterInteriorSphereMaterials) {
          material.clippingPlanes = [];
          material.needsUpdate = true;
        }
        for (const material of jupiterInteriorCapMaterials) {
          material.clippingPlanes = [];
          material.needsUpdate = true;
        }
        if (baseMaterial) {
          baseMaterial.map = !removeAtmosphere ? (layerTextures.get(baseLayerSelect.value) || null) : null;
          baseMaterial.color.set(!removeAtmosphere ? (baseMaterial.map ? 0xffffff : 0xd0b18a) : 0x6f675f);
          baseMaterial.needsUpdate = true;
        }
        if (geologyGlobe) {
          geologyGlobe.visible = false;
        }
        geologyContactLayer.group.visible = false;
        geologyStructureLayer.group.visible = false;
        if (mineralGlobe) {
          mineralGlobe.visible = false;
        }
        if (seaGlobe) {
          seaGlobe.visible = !removeAtmosphere && seaToggle.checked;
        }
        if (regionMaskGlobe) {
          regionMaskGlobe.visible = !removeAtmosphere && Boolean(regionMaskSelect.value);
        }
        if (selectedGeologyOutline && selectedGeologyOutline.mesh) {
          selectedGeologyOutline.mesh.visible = false;
        }
        if (selectedGeologyBoundaryGroup) {
          selectedGeologyBoundaryGroup.visible = false;
        }
        // Keep the outer globe as the visible exterior skin, but preserve the upper-atmosphere
        // cut boundary and cut face in normal core view so the outer layer actually exists.
        const showUpperAtmosphereCut = coreEnabled && !removeAtmosphere;
        if (cutawayResult.atmosphereMesh) cutawayResult.atmosphereMesh.visible = false;
        if (cutawayResult.atmosphereBoundaryMesh) cutawayResult.atmosphereBoundaryMesh.visible = showUpperAtmosphereCut;
        if (cutawayResult.crustRing) cutawayResult.crustRing.visible = showUpperAtmosphereCut;
        // Molecular envelope: only when core active AND atmosphere NOT removed.
        const showMolecular = coreEnabled && !removeAtmosphere;
        if (cutawayResult.molecularEnvelopeMesh) cutawayResult.molecularEnvelopeMesh.visible = showMolecular;
        if (cutawayResult.molecularEnvelopeRing) cutawayResult.molecularEnvelopeRing.visible = showMolecular;
        // molecularBoundaryMesh = outermost cutaway shell.
        // When atmosphere removed: repaint grey and scale down to 0.80R (metallic-H boundary)
        // so it sits flush against the outer core with no gap.
        if (cutawayResult.molecularBoundaryMesh) {
          const mbMat = cutawayResult.molecularBoundaryMesh.material;
          if (mbMat && mbMat.isMeshStandardMaterial) {
            mbMat.color.set(removeAtmosphere ? 0xb0bcc8 : 0x7a6248);
            mbMat.roughness          = removeAtmosphere ? 0.55 : 0.68;
            mbMat.metalness          = removeAtmosphere ? 0.20 : 0.10;
            mbMat.polygonOffset      = removeAtmosphere;
            mbMat.polygonOffsetFactor = removeAtmosphere ? -2 : 0;
            mbMat.polygonOffsetUnits  = removeAtmosphere ? -2 : 0;
            mbMat.needsUpdate = true;
          }
          // 0.837R → 0.80R: scale = 0.80 / 0.837
          cutawayResult.molecularBoundaryMesh.scale.setScalar(removeAtmosphere ? (0.80 / 0.837) : 1.0);
          cutawayResult.molecularBoundaryMesh.visible = coreEnabled;
        }
        // Fluid transition: hide all three components when atmosphere is removed
        // so the model visually ends at the metallic-H boundary (0.80R).
        const showFluidTransition = coreEnabled && !removeAtmosphere;
        if (cutawayResult.fluidTransitionMesh) cutawayResult.fluidTransitionMesh.visible = showFluidTransition;
        if (cutawayResult.fluidTransitionBoundaryMesh) cutawayResult.fluidTransitionBoundaryMesh.visible = showFluidTransition;
        if (cutawayResult.fluidTransitionRing) cutawayResult.fluidTransitionRing.visible = showFluidTransition;
        if (cutawayResult.metallicHydrogenMesh) cutawayResult.metallicHydrogenMesh.visible = coreEnabled;
        if (cutawayResult.heavyElementCoreMesh) cutawayResult.heavyElementCoreMesh.visible = coreEnabled;
        if (cutawayResult.metallicHydrogenRing) cutawayResult.metallicHydrogenRing.visible = coreEnabled;
        if (cutawayResult.metallicHydrogenCapMesh) cutawayResult.metallicHydrogenCapMesh.visible = coreEnabled;
        if (cutawayResult.heavyElementCoreCapMesh) cutawayResult.heavyElementCoreCapMesh.visible = coreEnabled;
        updateLabelVisibility(
          labelLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          jupiterLabelsEnabled,
          !removeAtmosphere && volcanicLabelsToggle.checked,
          !removeAtmosphere && landingLabelsToggle.checked,
          !removeAtmosphere && habitationLabelsToggle.checked,
          coreEnabled,
          stormLabelsToggle ? (!removeAtmosphere && stormLabelsToggle.checked) : true,
        );
        updateRingLabelVisibility(
          ringLabelLayer.entries,
          marsGroup,
          camera,
          renderer,
          labelsToggle.checked && !activeMoonViewerFeature,
        );
        updateSeismicVisibility(
          seismicLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          !removeAtmosphere && seismicToggle.checked,
          coreEnabled,
          seismicFilterSelect.value,
          seismicStatusSelect.value,
          Number(seismicMagnitudeMin.value),
          currentTimelineCutoff(),
        );
        updateCoreLabelVisibility(cutawayResult, camera, Boolean(coreLabelsToggle && coreLabelsToggle.checked));
      }

      function updateGeologyVisibility() {
        if (geologyGlobe) {
          geologyGlobe.visible = false;
        }
        geologyContactLayer.group.visible = false;
        geologyStructureLayer.group.visible = false;
        if (mineralGlobe) {
          mineralGlobe.visible = false;
        }
        applyJupiterAtmosphereRemoval();
      }

      function syncBasemapVisibility() {
        const nextLayer = baseLayers.find((layer) => layer.id === baseLayerSelect.value);
        const nextTexture = nextLayer ? layerTextures.get(nextLayer.id) : null;
        baseMaterial.map = nextTexture || null;
        baseMaterial.color.set(nextTexture ? 0xffffff : 0xd0b18a);
        baseMaterial.needsUpdate = true;
        if (cutawayResult.crustRing && cutawayResult.crustRing.material && cutawayResult.crustRing.material.uniforms && cutawayResult.crustRing.material.uniforms.uMap) {
          cutawayResult.crustRing.material.uniforms.uMap.value = nextTexture || null;
        }
        applyJupiterAtmosphereRemoval();
      }

      function applyDefaultGeologyState() {
        geologyToggle.checked = true;
        geologyContactsToggle.checked = false;
        geologyStructuresToggle.checked = false;
        mineralSelect.value = "";
        if (geologyMaterial) {
          geologyMaterial.opacity = 0;
          geologyMaterial.needsUpdate = true;
        }
        if (mineralMaterial) {
          mineralMaterial.map = null;
          mineralMaterial.needsUpdate = true;
        }
        if (mineralGlobe) {
          mineralGlobe.visible = false;
        }
        updateGeologyVisibility();
        syncSelectionHalo();
      }

      function syncGeologyMasterToggle() {
        geologyMasterToggle.checked = Boolean(geologyToggle.checked);
      }

      function applyDefaultLocationsState() {
        labelsToggle.checked = true;
        volcanicLabelsToggle.checked = true;
        if (stormLabelsToggle) stormLabelsToggle.checked = true;
        landingLabelsToggle.checked = true;
        habitationLabelsToggle.checked = true;
        seismicToggle.checked = true;
        seismicFilterSelect.value = "all";
        seismicStatusSelect.value = "all";
        seismicMagnitudeMin.value = "0";
        seismicTimelineSlider.value = "100";
        seismicLayer.group.visible = seismicToggle.checked && seismicLayer.available;
        updateLabelVisibility(
          labelLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          coreToggle.checked,
          stormLabelsToggle ? stormLabelsToggle.checked : true,
        );
        updateSeismicVisibility(
          seismicLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          seismicToggle.checked,
          coreToggle.checked,
          seismicFilterSelect.value,
          seismicStatusSelect.value,
          Number(seismicMagnitudeMin.value),
          currentTimelineCutoff(),
        );
        updateSeismicTimelineReadout();
      }

      function syncLocationsMasterToggle() {
        locationsMasterToggle.checked = Boolean(
          labelsToggle.checked ||
          volcanicLabelsToggle.checked ||
          (stormLabelsToggle && stormLabelsToggle.checked) ||
          landingLabelsToggle.checked ||
          flybyPathsToggle.checked ||
          habitationLabelsToggle.checked ||
          (moonToggle && moonToggle.checked) ||
          seismicToggle.checked
        );
      }

      [tourModeToggle, geologyMasterToggle, locationsMasterToggle, moonViewerToggle].forEach((node) => {
        if (!node) return;
        ["click", "pointerdown"].forEach((eventName) => {
          node.addEventListener(eventName, (event) => {
            event.stopPropagation();
          });
        });
      });

      geologyToggle.addEventListener("change", () => {
        updateGeologyVisibility();
        syncSelectionHalo();
        syncGeologyMasterToggle();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      geologyContactsToggle.addEventListener("change", () => {
        updateGeologyVisibility();
        syncGeologyMasterToggle();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      geologyStructuresToggle.addEventListener("change", () => {
        updateGeologyVisibility();
        syncGeologyMasterToggle();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      baseLayerSelect.addEventListener("change", () => {
        syncBasemapVisibility();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      geologyMasterToggle.addEventListener("change", () => {
        geologyToggle.checked = geologyMasterToggle.checked;
        updateGeologyVisibility();
        syncSelectionHalo();
        syncGeologyMasterToggle();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      mineralSelect.addEventListener("change", () => {
        if (mineralMaterial) {
          mineralMaterial.map = null;
          mineralMaterial.needsUpdate = true;
        }
        if (mineralGlobe) {
          mineralGlobe.visible = false;
        }
        syncGeologyMasterToggle();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      labelsToggle.addEventListener("change", () => {
        updateLabelVisibility(
          labelLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          coreToggle.checked,
          stormLabelsToggle ? stormLabelsToggle.checked : true,
        );
        syncLocationsMasterToggle();
      });

      volcanicLabelsToggle.addEventListener("change", () => {
        updateLabelVisibility(
          labelLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          coreToggle.checked,
          stormLabelsToggle ? stormLabelsToggle.checked : true,
        );
        syncLocationsMasterToggle();
      });

      if (stormLabelsToggle) {
        stormLabelsToggle.addEventListener("change", () => {
          updateLabelVisibility(
            labelLayer.entries,
            marsGroup,
            globe,
            camera,
            renderer,
            labelsToggle.checked,
            volcanicLabelsToggle.checked,
            landingLabelsToggle.checked,
            habitationLabelsToggle.checked,
            coreToggle.checked,
            stormLabelsToggle.checked,
          );
          syncLocationsMasterToggle();
        });
      }

      landingLabelsToggle.addEventListener("change", () => {
        updateLabelVisibility(
          labelLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          coreToggle.checked,
          stormLabelsToggle ? stormLabelsToggle.checked : true,
        );
        syncLocationsMasterToggle();
      });

      const flybyLegendEl = document.getElementById("flyby-legend");
      const syncFlybyLegend = () => {
        if (flybyLegendEl) flybyLegendEl.hidden = !flybyPathsToggle.checked;
      };
      syncFlybyLegend();
      flybyPathsToggle.addEventListener("change", () => {
        flybyPathLayer.group.visible = flybyPathsToggle.checked;
        syncFlybyLegend();
      });

      habitationLabelsToggle.addEventListener("change", () => {
        updateLabelVisibility(
          labelLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          coreToggle.checked,
          stormLabelsToggle ? stormLabelsToggle.checked : true,
        );
        syncLocationsMasterToggle();
      });

      seismicToggle.addEventListener("change", () => {
        seismicLayer.group.visible = seismicToggle.checked && seismicLayer.available;
        updateSeismicVisibility(
          seismicLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          seismicToggle.checked,
          coreToggle.checked,
          seismicFilterSelect.value,
          seismicStatusSelect.value,
          Number(seismicMagnitudeMin.value),
          currentTimelineCutoff(),
        );
        syncLocationsMasterToggle();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      if (moonToggle) {
        moonToggle.addEventListener("change", () => {
          syncLocationsMasterToggle();
        });
      }

      locationsMasterToggle.addEventListener("change", () => {
        const on = locationsMasterToggle.checked;
        labelsToggle.checked = on;
        volcanicLabelsToggle.checked = on;
        if (stormLabelsToggle) stormLabelsToggle.checked = on;
        landingLabelsToggle.checked = on;
        flybyPathsToggle.checked = on;
        flybyPathLayer.group.visible = on;
        syncFlybyLegend();
        habitationLabelsToggle.checked = on;
        if (moonToggle) moonToggle.checked = on;
        seismicToggle.checked = on;
        seismicLayer.group.visible = on && seismicLayer.available;
        updateLabelVisibility(
          labelLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          coreToggle.checked,
          stormLabelsToggle ? stormLabelsToggle.checked : true,
        );
        updateSeismicVisibility(
          seismicLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          seismicToggle.checked,
          coreToggle.checked,
          seismicFilterSelect.value,
          seismicStatusSelect.value,
          Number(seismicMagnitudeMin.value),
          currentTimelineCutoff(),
        );
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      [seismicFilterSelect, seismicStatusSelect].forEach((node) => node.addEventListener("change", () => {
        updateSeismicVisibility(
          seismicLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          seismicToggle.checked,
          coreToggle.checked,
          seismicFilterSelect.value,
          seismicStatusSelect.value,
          Number(seismicMagnitudeMin.value),
          currentTimelineCutoff(),
        );
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      }));

      coreToggle.addEventListener("change", () => {
        const enabled = coreToggle.checked;
        if (enabled && elevationMap) {
          terrainScale.value = "0";
          applyTerrainRelief(0, elevationMap, baseMaterial, geologyMaterial, mineralMaterial, seaMaterial, regionMaskMaterial, cutawayResult);
        }
        const planes = enabled ? [cutawayClipPlane] : [];
        baseMaterial.clippingPlanes = planes;
        baseMaterial.needsUpdate = true;
        if (geologyMaterial) {
          geologyMaterial.clippingPlanes = planes;
          geologyMaterial.needsUpdate = true;
        }
        if (selectedGeologyOutline && selectedGeologyOutline.mesh && selectedGeologyOutline.mesh.material) {
          selectedGeologyOutline.mesh.material.clippingPlanes = planes;
          selectedGeologyOutline.mesh.material.needsUpdate = true;
        }
        geologyContactLayer.setClippingPlanes(planes);
        geologyStructureLayer.setClippingPlanes(planes);
        if (selectedGeologyBoundaryGroup) {
          for (const child of selectedGeologyBoundaryGroup.children) {
            if (child.material) {
              child.material.clippingPlanes = planes;
              child.material.needsUpdate = true;
            }
          }
        }
        updateGeologyVisibility();
        if (mineralMaterial) {
          mineralMaterial.clippingPlanes = planes;
          mineralMaterial.needsUpdate = true;
        }
        if (seaMaterial) {
          seaMaterial.clippingPlanes = planes;
          seaMaterial.needsUpdate = true;
        }
        if (regionMaskMaterial) {
          regionMaskMaterial.clippingPlanes = planes;
          regionMaskMaterial.needsUpdate = true;
        }
        cutawayGroup.visible = enabled;
        labelLayer.group.visible = true;
        scenePopup.hidden = true;
        scenePopupAnchor.hidden = true;
        activePopupFeature = null;
        syncSelectionHalo();
        baseLayerSelect.disabled = false;
        geologyToggle.disabled = false;
        geologyOpacity.disabled = !geologyMaterial;
        geologyContactsToggle.disabled = !geologyContactLayer.available;
        geologyStructuresToggle.disabled = !geologyStructureLayer.available;
        terrainScale.disabled = enabled || !elevationMap;
        labelsToggle.disabled = false;
        volcanicLabelsToggle.disabled = false;
        landingLabelsToggle.disabled = false;
        habitationLabelsToggle.disabled = false;
        seismicToggle.disabled = !seismicLayer.available;
        mineralSelect.disabled = false;
        mineralOpacity.disabled = false;
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      geologyOpacity.addEventListener("input", () => {
        if (geologyMaterial) {
          geologyMaterial.opacity = Number(geologyOpacity.value);
        }
      });

      mineralOpacity.addEventListener("input", () => {
        if (mineralMaterial) {
          mineralMaterial.opacity = Number(mineralOpacity.value);
        }
      });

      terrainScale.addEventListener("input", () => {
        const nextTerrainRelief = elevationMap ? Number(terrainScale.value) : 0;
        applyTerrainRelief(nextTerrainRelief, elevationMap, baseMaterial, geologyMaterial, mineralMaterial, seaMaterial, regionMaskMaterial, cutawayResult);
        if (selectedGeologyOutline && selectedGeologyOutline.mesh && selectedGeologyOutline.mesh.material) {
          selectedGeologyOutline.mesh.material.displacementScale = nextTerrainRelief;
          selectedGeologyOutline.mesh.material.needsUpdate = true;
        }
        updateGeologyVectorLayer(geologyContactLayer);
        updateGeologyVectorLayer(geologyStructureLayer);
        updateLabelAnchors(labelLayer, elevationSampler, labelElevationCache, getTerrainRelief, 3.2);
        updateSeismicAnchors(seismicLayer, elevationSampler, seismicElevationCache, getTerrainRelief, 3.2);
        syncSelectionHalo();
        if (measureMode && measurePoints.length) {
          updateMeasureVisualization();
        }
      });

      seaToggle.addEventListener("change", () => {
        if (seaGlobe) {
          seaGlobe.visible = seaToggle.checked;
        }
        applyJupiterAtmosphereRemoval();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      seaLevelSlider.addEventListener("input", () => {
        const nextSeaLevel = Number(seaLevelSlider.value);
        seaLevelCopy.innerHTML = `Speculative northern-ocean highstand slider. Upper bound: ${seaLevelMaxMeters} m. Current level: <span id="sea-level-value">${nextSeaLevel} m</span>`;
        if (seaOverlayState) {
          updateSeaOverlayTexture(seaOverlayState, nextSeaLevel);
        }
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      regionMaskSelect.addEventListener("change", () => {
        if (!regionMaskMaterial || !elevationSampler) {
          return;
        }
        regionMaskMaterial.map?.dispose?.();
        regionMaskMaterial.map = regionMaskSelect.value
          ? createRegionMaskTexture(regionMaskSelect.value, elevationSampler)
          : null;
        regionMaskMaterial.needsUpdate = true;
        regionMaskGlobe.visible = Boolean(regionMaskSelect.value);
        applyJupiterAtmosphereRemoval();
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      regionMaskOpacity.addEventListener("input", () => {
        if (regionMaskMaterial) {
          regionMaskMaterial.opacity = Number(regionMaskOpacity.value);
        }
      });

      seismicMagnitudeMin.addEventListener("input", () => {
        const minMagnitude = Number(seismicMagnitudeMin.value);
        seismicMagnitudeCopy.textContent = minMagnitude <= 0
          ? "No seismic magnitude filtering is available for Jupiter."
          : `Showing magnitude ${minMagnitude.toFixed(1)} and higher.`;
        updateSeismicVisibility(
          seismicLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          seismicToggle.checked,
          coreToggle.checked,
          seismicFilterSelect.value,
          seismicStatusSelect.value,
          minMagnitude,
          currentTimelineCutoff(),
        );
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      seismicTimelineSlider.addEventListener("input", () => {
        updateSeismicTimelineReadout();
        updateSeismicVisibility(
          seismicLayer.entries,
          marsGroup,
          globe,
          camera,
          renderer,
          seismicToggle.checked,
          coreToggle.checked,
          seismicFilterSelect.value,
          seismicStatusSelect.value,
          Number(seismicMagnitudeMin.value),
          currentTimelineCutoff(),
        );
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      });

      metadataButton.addEventListener("click", () => {
        renderMetadataModal(currentMetadataState || buildMetadataState(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState));
        metadataModal.hidden = false;
      });

      metadataClose.addEventListener("click", () => {
        metadataModal.hidden = true;
      });

      metadataModal.addEventListener("click", (event) => {
        if (event.target === metadataModal) {
          metadataModal.hidden = true;
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !metadataModal.hidden) {
          metadataModal.hidden = true;
          return;
        }
      });

      featureSearchGo.addEventListener("click", () => {
        focusSearchedFeature(resolveFeatureSearchSelection(), camera, controls);
      });

      featureSearch.addEventListener("input", refreshSearchSuggestionsAfterTextEdit);
      featureSearch.addEventListener("keyup", refreshSearchSuggestionsAfterTextEdit);
      featureSearch.addEventListener("change", refreshSearchSuggestionsAfterTextEdit);
      featureSearch.addEventListener("focus", refreshSearchSuggestions);
      featureSearchResults.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      featureSearchResults.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      featureSearch.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" && activeSearchResults.length) {
          activeSearchIndex = (activeSearchIndex + 1) % activeSearchResults.length;
          renderFeatureSearchResults(activeSearchResults, true);
          event.preventDefault();
          return;
        }
        if (event.key === "ArrowUp" && activeSearchResults.length) {
          activeSearchIndex = (activeSearchIndex - 1 + activeSearchResults.length) % activeSearchResults.length;
          renderFeatureSearchResults(activeSearchResults, true);
          event.preventDefault();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          focusSearchedFeature(resolveFeatureSearchSelection(), camera, controls);
        }
      });
      document.addEventListener("pointerdown", (event) => {
        if (
          event.target !== featureSearch
          && event.target !== featureSearchGo
          && !featureSearchResults.contains(event.target)
        ) {
          clearFeatureSearchResults(false);
        }
      });

      exploreReset.addEventListener("click", () => {
        reloadToDefaultGlobalView(camera, controls);
      });

      if (moonViewerToggle) {
        moonViewerToggle.addEventListener("change", () => {
          if (moonViewerToggle.checked) {
            if (moonViewerSection) moonViewerSection.open = true;
            const first = moonData[0] || null;
            if (first) {
              moveCameraToFeature(first, camera, controls);
              openFeature(first, false);
              setStatus(`Moon viewer locked on ${first.name}.`);
            }
          } else {
            if (moonViewerSection) moonViewerSection.open = false;
            reloadToDefaultGlobalView(camera, controls);
          }
        });
      }

      if (moonViewerSelect) {
        moonViewerSelect.addEventListener("change", () => {
          const feature = moonData.find((item) => item.name === moonViewerSelect.value) || null;
          if (!feature) {
            reloadToDefaultGlobalView(camera, controls);
            return;
          }
          moonNavContext = "moon";
          resetActiveMeasurement(true);
          moveCameraToFeature(feature, camera, controls);
          openFeature(feature, false);
          setStatus(`Moon viewer locked on ${feature.name}.`);
        });
      }

      if (moonViewerPrev) {
        moonViewerPrev.addEventListener("click", () => {
          moonNavContext = "moon";
          resetActiveMeasurement(true);
          cycleMoonViewer(-1, camera, controls);
        });
      }

      if (moonViewerNext) {
        moonViewerNext.addEventListener("click", () => {
          moonNavContext = "moon";
          resetActiveMeasurement(true);
          cycleMoonViewer(1, camera, controls);
        });
      }

      if (moonFeatureTypeSelect) {
        moonFeatureTypeSelect.addEventListener("change", () => {
          moonNavContext = "feature";
          moonFeatureTypeFilter = moonFeatureTypeSelect.value;
          activeMoonFeatureTour = null;
          populateMoonFeatureTourTargets();
        });
      }

      if (moonFeatureTourTarget) {
        moonFeatureTourTarget.addEventListener("change", () => {
          moonNavContext = "feature";
          const features = getMoonFeatureTourFeatures();
          focusMoonFeatureTour(features.find((f) => f.name === moonFeatureTourTarget.value));
        });
      }

      if (moonFeatureTourPrev) moonFeatureTourPrev.addEventListener("click", () => { moonNavContext = "feature"; cycleMoonFeatureTour(-1); });
      if (moonFeatureTourNext) moonFeatureTourNext.addEventListener("click", () => { moonNavContext = "feature"; cycleMoonFeatureTour(1); });

      if (moonFeatureSearchInput) {
        moonFeatureSearchInput.addEventListener("input", refreshMoonFeatureSearch);
        moonFeatureSearchInput.addEventListener("focus", refreshMoonFeatureSearch);
        moonFeatureSearchResults.addEventListener("pointerdown", (e) => e.stopPropagation());
        moonFeatureSearchResults.addEventListener("click", (e) => e.stopPropagation());
        moonFeatureSearchInput.addEventListener("keydown", (event) => {
          if (event.key === "ArrowDown" && activeMoonFeatureSearchResults.length) {
            activeMoonFeatureSearchIndex = (activeMoonFeatureSearchIndex + 1) % activeMoonFeatureSearchResults.length;
            renderMoonFeatureSearchResults(activeMoonFeatureSearchResults, true);
            event.preventDefault();
            return;
          }
          if (event.key === "ArrowUp" && activeMoonFeatureSearchResults.length) {
            activeMoonFeatureSearchIndex = (activeMoonFeatureSearchIndex - 1 + activeMoonFeatureSearchResults.length) % activeMoonFeatureSearchResults.length;
            renderMoonFeatureSearchResults(activeMoonFeatureSearchResults, true);
            event.preventDefault();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const activeBtn = moonFeatureSearchResults && moonFeatureSearchResults.querySelector(".search-suggestion.is-active");
            const firstBtn  = moonFeatureSearchResults && moonFeatureSearchResults.querySelector(".search-suggestion");
            if (activeBtn) { activeBtn.click(); }
            else if (firstBtn) { firstBtn.click(); }
          }
        });
        document.addEventListener("pointerdown", (event) => {
          if (
            event.target !== moonFeatureSearchInput &&
            event.target !== moonFeatureSearchGo &&
            !moonFeatureSearchResults.contains(event.target)
          ) {
            clearMoonFeatureSearchResults();
          }
        });
      }

      if (moonFeatureSearchGo) {
        moonFeatureSearchGo.addEventListener("click", () => {
          const selected = activeMoonFeatureSearchIndex >= 0
            ? activeMoonFeatureSearchResults[activeMoonFeatureSearchIndex]
            : activeMoonFeatureSearchResults[0];
          if (selected) {
            focusSearchedFeature(selected, viewerCamera, viewerControls);
            clearMoonFeatureSearchResults(true);
          }
        });
      }

      if (jupiterViewModeSelect) {
        jupiterViewModeSelect.addEventListener("change", () => {
          resetExploreView(camera, controls);
          applyJupiterViewMode(jupiterViewModeSelect.value);
        });
      }

      measureExport.addEventListener("click", () => exportCurrentMeasurementCsv());
      if (profileModalExportPng) {
        profileModalExportPng.addEventListener("click", () => exportCurrentProfilePng());
      }
      if (profileModalClose) {
        profileModalClose.addEventListener("click", () => hideProfileModal());
      }
      if (profileModal) {
        profileModal.addEventListener("click", (event) => {
          if (event.target === profileModal) hideProfileModal();
        });
      }

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          if (profileModal && !profileModal.hidden) {
            hideProfileModal();
            return;
          }
          if (!scenePopup.hidden || activePopupFeature) {
            closeScenePopup();
            return;
          }
          if (measureMode || measurePoints.length) {
            setMeasureMode("");
          }
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          const tag = document.activeElement && document.activeElement.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
          const dir = event.key === "ArrowLeft" ? -1 : 1;
          if (activeMoonViewerFeature) {
            event.preventDefault();
            if (moonNavContext === "feature") {
              cycleMoonFeatureTour(dir);
            } else {
              cycleMoonViewer(dir, camera, controls);
            }
          } else if (tourModeToggle?.checked) {
            event.preventDefault();
            cycleTourFeature(dir);
          }
        }
      });

      if (!elevationMap) {
        terrainScale.value = "0";
        terrainScale.disabled = true;
        seaToggle.checked = false;
        seaToggle.disabled = true;
        seaLevelSlider.disabled = true;
      }
      geologyContactsToggle.disabled = !geologyContactLayer.available;
      geologyStructuresToggle.disabled = !geologyStructureLayer.available;
      updateGeologyVisibility();
      if (!seismicLayer.available) {
        seismicToggle.checked = false;
        seismicToggle.disabled = true;
      }
      updateSeismicTimelineReadout();
      refreshSearchSuggestions();
      syncMoonViewerControls(null);
      syncBasemapVisibility();
      syncGeologyMasterToggle();
      syncLocationsMasterToggle();

      scenePopupClose.addEventListener("click", () => {
        closeScenePopup();
      });

      syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      applyTerrainRelief(
        elevationMap ? Number(terrainScale.value) : 0,
        elevationMap,
        baseMaterial,
        geologyMaterial,
        mineralMaterial,
        seaMaterial,
        regionMaskMaterial,
        cutawayResult,
      );

      renderer.domElement.addEventListener("pointerdown", (event) => {
        pointerDown = { x: event.clientX, y: event.clientY };
      });

      renderer.domElement.addEventListener("pointermove", (event) => {
        let surfaceHit = null;
        if (!coreToggle.checked) {
          const removeAtmosphereActive = Boolean(geologyToggle && geologyToggle.checked);
          surfaceHit = measureMode || activeMoonViewerFeature
            ? intersectMeasurementSurface(event.clientX, event.clientY)
            : intersectMarsSurface(event.clientX, event.clientY);
          if (!surfaceHit && removeAtmosphereActive) {
            surfaceHit = intersectExposedJupiterInteriorSurface(event.clientX, event.clientY);
          }
          if (surfaceHit) {
            const latLon = surfaceHit.context
              ? { lat: surfaceHit.lat, lon: surfaceHit.lon }
              : vectorToLatLon(surfaceHit.point);
            cursorReadout.hidden = false;
            const _isMoonHit = surfaceHit.context?.kind === "moon";
            const _lonStr = _isMoonHit
              ? `${moonLonToW(latLon.lon, surfaceHit.context.bodyName || "").toFixed(2)}°W`
              : `${latLon.lon.toFixed(2)}°E`;
            cursorReadout.textContent = `${latLon.lat.toFixed(2)}°, ${_lonStr}`;
            if (scTemp && scPressure) {
              if (surfaceHit.context?.kind === "moon") {
                const moonName = surfaceHit.context.bodyName || "Moon";
                const moonCenter = new THREE.Vector3();
                surfaceHit.context.mesh?.getWorldPosition?.(moonCenter);
                const surfaceNormal = surfaceHit.point.clone().sub(moonCenter).normalize();
                const tempC = estimateMoonSurfaceTemperature(moonName, surfaceNormal);
                scTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC} °C`;
                scTemp.style.color = tempC < -200 ? "#6ec6ff" : tempC < -170 ? "#90d8e8" : "#e8c97a";
                scPressure.textContent = "< 10⁻⁶ Pa";
                scPressure.style.color = "#aaaacc";
                if (scContext) scContext.textContent = moonName.toUpperCase() + " SURFACE";
              } else if (surfaceHit.context?.kind === "jupiter-interior-surface") {
                const local = surfaceHit.localPoint || marsGroup.worldToLocal(surfaceHit.point.clone());
                const rFrac = Math.max(0, Math.min(1, local.length() / JUPITER_SCENE_RADIUS));
                const layerName = jupiterInteriorLayerName(rFrac);
                const tempC = jupiterInteriorTempC(rFrac);
                const pGPa = jupiterInteriorPressureGPa(rFrac);
                scTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                scTemp.style.color = jupiterInteriorTempColor(tempC);
                scPressure.textContent = formatPressureGPa(pGPa);
                scPressure.style.color = jupiterInteriorPressureColor(pGPa);
                if (scContext) scContext.textContent = `LAYER: ${layerName.toUpperCase()} (SURFACE)`;
              } else {
                const tempC = estimateJupiterCloudTopTemp(latLon.lat);
                const pressurePa = estimateJupiterCloudTopPressure();
                scTemp.textContent = `${tempC} °C`;
                scTemp.style.color = tempC < -185 ? "#6ec6ff" : tempC < -178 ? "#90d8e8" : "#e8c97a";
                scPressure.textContent = `${pressurePa.toLocaleString()} Pa`;
                scPressure.style.color = "#c8a8e0";
                if (scContext) scContext.textContent = "JUPITER CLOUD TOPS";
              }
            }
          } else {
            cursorReadout.hidden = true;
            cursorReadout.textContent = "";
            if (scTemp && scPressure) {
              const camDist = camera.position.length();
              const tempC = estimateSpaceTemperature(camDist);
              scTemp.textContent = `${tempC} °C`;
              scTemp.style.color = "#6ec6ff";
              scPressure.textContent = "< 10⁻¹⁰ Pa";
              scPressure.style.color = "#aaaacc";
              if (scContext) scContext.textContent = "INTERPLANETARY SPACE";
            }
          }
        } else {
          cursorReadout.hidden = true;
          cursorReadout.textContent = "";
        }
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        if (coreToggle.checked) {
          updateLabelVisibility(
            labelLayer.entries,
            marsGroup,
            globe,
            camera,
          renderer,
          labelsToggle.checked,
          volcanicLabelsToggle.checked,
          landingLabelsToggle.checked,
          habitationLabelsToggle.checked,
          true,
        );
          updateCoreLabelVisibility(
            cutawayResult,
            camera,
            Boolean(coreLabelsToggle && coreLabelsToggle.checked),
          );
          const hits = [
            ...(coreLabelsToggle && coreLabelsToggle.checked
              ? raycaster.intersectObjects(cutawayResult.interactiveObjects, false)
              : []),
            ...raycaster.intersectObjects(labelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(ringLabelLayer.interactiveObjects, false),
          ];
          const hit = hits.find((e) => e.object.visible && e.object.userData.feature);
          hoveredFeature = hit ? hit.object.userData.feature : null;
          hoverTooltip.hidden = true;
          renderer.domElement.style.cursor = hoveredFeature ? "pointer" : "";
          if (surfaceConditionsEl) surfaceConditionsEl.hidden = true;
          if (interiorConditionsEl) interiorConditionsEl.hidden = false;
          if (activeCutClipPlane && icDepth) {
            const coreRect = renderer.domElement.getBoundingClientRect();
            pointer.x = ((event.clientX - coreRect.left) / coreRect.width) * 2 - 1;
            pointer.y = -(((event.clientY - coreRect.top) / coreRect.height) * 2 - 1);
            raycaster.setFromCamera(pointer, camera);
            const coreGlobeHit = globe
              ? raycaster.intersectObject(globe, false).find((entry) => entry.object.visible)
              : null;
            if (coreGlobeHit) {
              const signedDistance = activeCutClipPlane.distanceToPoint(coreGlobeHit.point);
              if (signedDistance >= 0) {
                const localHit = marsGroup.worldToLocal(coreGlobeHit.point.clone());
                const latLon = vectorToLatLon(localHit.clone());
                const tempC = estimateJupiterCloudTopTemp(latLon.lat);
                const pPa = estimateJupiterCloudTopPressure();
                const pGPa = pPa / 1e9;
                icDepth.textContent = "0 km";
                icLayer.textContent = "Outer Atmosphere (surface)";
                icLayer.style.color = jupiterInteriorLayerColor("Outer Atmosphere");
                icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                icTemp.style.color = jupiterInteriorTempColor(tempC);
                icPressure.textContent = formatPressureGPa(pGPa);
                icPressure.style.color = jupiterInteriorPressureColor(pGPa);
                return;
              }
            }

            const removeAtmosphereActive = Boolean(geologyToggle && geologyToggle.checked);
            const visibleSurfaceTargets = removeAtmosphereActive
              ? [
                jupiterSolidInterior?.fluidTransitionMesh,
                jupiterSolidInterior?.metallicHydrogenMesh,
                jupiterSolidInterior?.heavyElementCoreMesh,
                cutawayResult?.fluidTransitionMesh,
                cutawayResult?.metallicHydrogenMesh,
                cutawayResult?.heavyElementCoreMesh,
              ]
              : [
                cutawayResult?.atmosphereMesh,
                cutawayResult?.molecularEnvelopeMesh,
                cutawayResult?.fluidTransitionMesh,
                cutawayResult?.metallicHydrogenMesh,
                cutawayResult?.heavyElementCoreMesh,
              ];
            const visibleSurfaceHit = visibleSurfaceTargets
              .filter((mesh) => mesh && mesh.visible)
              .length
              ? raycaster.intersectObjects(visibleSurfaceTargets.filter((mesh) => mesh && mesh.visible), false).find((entry) => entry.object.visible)
              : null;
            if (visibleSurfaceHit && !removeAtmosphereActive) {
              const hitObject = visibleSurfaceHit.object;
              const localHit = marsGroup.worldToLocal(visibleSurfaceHit.point.clone());
              if (hitObject === cutawayResult?.atmosphereMesh) {
                const latLon = vectorToLatLon(localHit.clone());
                const tempC = estimateJupiterCloudTopTemp(latLon.lat);
                const pPa = estimateJupiterCloudTopPressure();
                const pGPa = pPa / 1e9;
                icDepth.textContent = "0 km";
                icLayer.textContent = "Outer Atmosphere (surface)";
                icLayer.style.color = jupiterInteriorLayerColor("Outer Atmosphere");
                icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                icTemp.style.color = jupiterInteriorTempColor(tempC);
                icPressure.textContent = formatPressureGPa(pGPa);
                icPressure.style.color = jupiterInteriorPressureColor(pGPa);
                return;
              }
              const rScene = localHit.length();
              const rFrac = Math.max(0, Math.min(1, rScene / 3.2));
              const depthKm = Math.round((1.0 - rFrac) * 60268);
              const layerName = jupiterInteriorLayerName(rFrac);
              const tempC = jupiterInteriorTempC(rFrac);
              const pGPa = jupiterInteriorPressureGPa(rFrac);
              icDepth.textContent = `${depthKm.toLocaleString()} km`;
              icLayer.textContent = `${layerName} (shell surface)`;
              icLayer.style.color = jupiterInteriorLayerColor(layerName);
              icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
              icTemp.style.color = jupiterInteriorTempColor(tempC);
              icPressure.textContent = formatPressureGPa(pGPa);
              icPressure.style.color = jupiterInteriorPressureColor(pGPa);
              return;
            }

            const coreHit = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(activeCutClipPlane, coreHit)) {
              const localHit = marsGroup.worldToLocal(coreHit.clone());
              const rScene = localHit.length();
              const GLOBE_R = 3.2;
              const JUPITER_R_KM = 60268;
              if (rScene <= GLOBE_R) {
                const rFrac = rScene / GLOBE_R;
                const depthKm = Math.round((1.0 - rFrac) * JUPITER_R_KM);
                const layerName = jupiterInteriorLayerName(rFrac);
                const tempC = jupiterInteriorTempC(rFrac);
                const pGPa = jupiterInteriorPressureGPa(rFrac);
                icDepth.textContent = `${depthKm.toLocaleString()} km`;
                icLayer.textContent = layerName;
                icLayer.style.color = jupiterInteriorLayerColor(layerName);
                icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                icTemp.style.color = jupiterInteriorTempColor(tempC);
                icPressure.textContent = formatPressureGPa(pGPa);
                icPressure.style.color = jupiterInteriorPressureColor(pGPa);
              } else {
                icDepth.textContent = "—"; icLayer.textContent = "—"; icLayer.style.color = "";
                icTemp.textContent = "—"; icTemp.style.color = ""; icPressure.textContent = "—"; icPressure.style.color = "";
              }
            } else {
              const coreSurfaceTargets = [
                cutawayResult?.atmosphereMesh,
                cutawayResult?.molecularEnvelopeMesh,
                cutawayResult?.fluidTransitionMesh,
                cutawayResult?.metallicHydrogenMesh,
                cutawayResult?.heavyElementCoreMesh,
                jupiterSolidInterior?.fluidTransitionMesh,
                jupiterSolidInterior?.metallicHydrogenMesh,
                jupiterSolidInterior?.heavyElementCoreMesh,
              ].filter((mesh) => mesh && mesh.visible);
              const coreSurfaceHit = coreSurfaceTargets.length
                ? raycaster.intersectObjects(coreSurfaceTargets, false).find((entry) => entry.object.visible)
                : null;
              if (coreSurfaceHit) {
                const localHit = marsGroup.worldToLocal(coreSurfaceHit.point.clone());
                const rScene = localHit.length();
                const rFrac = Math.max(0, Math.min(1, rScene / 3.2));
                const depthKm = Math.round((1.0 - rFrac) * 60268);
                const layerName = jupiterInteriorLayerName(rFrac);
                const tempC = jupiterInteriorTempC(rFrac);
                const pGPa = jupiterInteriorPressureGPa(rFrac);
                icDepth.textContent = `${depthKm.toLocaleString()} km`;
                icLayer.textContent = `${layerName} (shell surface)`;
                icLayer.style.color = jupiterInteriorLayerColor(layerName);
                icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                icTemp.style.color = jupiterInteriorTempColor(tempC);
                icPressure.textContent = formatPressureGPa(pGPa);
                icPressure.style.color = jupiterInteriorPressureColor(pGPa);
              } else {
                const removeAtmosphereActive = Boolean(geologyToggle && geologyToggle.checked);
                if (removeAtmosphereActive) {
                  const rFrac = JUPITER_EXPOSED_INTERIOR_RFRAC;
                  const depthKm = Math.round((1.0 - rFrac) * 60268);
                  const layerName = jupiterInteriorLayerName(rFrac);
                  const tempC = jupiterInteriorTempC(rFrac);
                  const pGPa = jupiterInteriorPressureGPa(rFrac);
                  icDepth.textContent = `${depthKm.toLocaleString()} km`;
                  icLayer.textContent = `${layerName} (surface)`;
                  icLayer.style.color = jupiterInteriorLayerColor(layerName);
                  icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                  icTemp.style.color = jupiterInteriorTempColor(tempC);
                  icPressure.textContent = formatPressureGPa(pGPa);
                  icPressure.style.color = jupiterInteriorPressureColor(pGPa);
                } else {
                  icDepth.textContent = "—"; icLayer.textContent = "—"; icLayer.style.color = "";
                  icTemp.textContent = "—"; icTemp.style.color = ""; icPressure.textContent = "—"; icPressure.style.color = "";
                }
              }
            }
          }
          return;
        }
        if (
          !labelsToggle.checked &&
          !volcanicLabelsToggle.checked &&
          !landingLabelsToggle.checked &&
          !habitationLabelsToggle.checked &&
          !moonToggle.checked &&
          !seismicToggle.checked &&
          !geologyToggle.checked &&
          !geologyContactsToggle.checked &&
          !geologyStructuresToggle.checked
        ) {
          renderer.domElement.style.cursor = "";
          hoveredFeature = null;
          hoverTooltip.hidden = true;
          return;
        }
        const intersections = [
          ...raycaster.intersectObjects(labelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(ringLabelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(moonLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(moonFeatureLabelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(geologyStructureLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(geologyContactLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(seismicLayer.interactiveObjects, false),
        ].sort((a, b) => a.distance - b.distance);
        let hit = intersections.find((entry) => isObjectActuallyVisible(entry.object) && entry.object.userData.feature);
        const geologySurfaceHit = geologyToggle.checked ? intersectMarsSurface(event.clientX, event.clientY) : null;
        const geologyFeature = geologySurfaceHit ? getGeologyFeatureAtPoint(geologySurfaceHit.point, geologyInteractiveState) : null;
        if (geologyFeature) {
          hoveredFeature = geologyFeature;
          hit = null;
        } else {
          hoveredFeature = hit ? hit.object.userData.feature : null;
        }
        if (hit && hit.object.userData.feature && hit.object.userData.feature.event_time) {
          const feature = hit.object.userData.feature;
          hoverTooltip.innerHTML = `<div class="hover-tooltip-title">Seismic Event</div>${feature.name || feature.magnitude_label || "Atmospheric feature"}<br>${feature.magnitude_label || "Magnitude not reported"}${feature.event_time ? `<br>${feature.event_time}` : ""}`;
          hoverTooltip.style.left = `${event.clientX + 16}px`;
          hoverTooltip.style.top = `${event.clientY + 16}px`;
          hoverTooltip.hidden = false;
        } else {
          hoverTooltip.hidden = true;
        }
        renderer.domElement.style.cursor = hoveredFeature ? "pointer" : "";
      });

      renderer.domElement.addEventListener("pointerup", (event) => {
        if (!pointerDown) { return; }
        const dx = event.clientX - pointerDown.x;
        const dy = event.clientY - pointerDown.y;
        pointerDown = null;
        if (Math.hypot(dx, dy) > 10) { return; }

        if (measureMode) {
          const surfaceHit = intersectMeasurementSurface(event.clientX, event.clientY);
          if (surfaceHit) {
            const context = cloneMeasureContext(surfaceHit.context);
            if (measurePoints.length > 0 && measurePoints[0].bodyName !== context.bodyName) {
              resetActiveMeasurement(true);
            }
            measurePoints.push({
              lat: surfaceHit.lat,
              lon: surfaceHit.lon,
              point: surfaceHit.localPoint.clone(),
              localPoint: surfaceHit.localPoint.clone(),
              bodyKind: context.kind,
              bodyName: context.bodyName,
              radiusKm: context.radiusKm,
              radiusWorld: context.radiusWorld,
              context,
            });
            if ((measureMode === "distance" || measureMode === "profile") && measurePoints.length > 2) {
              measurePoints = measurePoints.slice(-2);
            }
            updateMeasureVisualization();
            return;
          }
        }

        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);

        if (coreToggle.checked) {
          const hits = [
            ...(coreLabelsToggle && coreLabelsToggle.checked
              ? raycaster.intersectObjects(cutawayResult.interactiveObjects, false)
              : []),
            ...raycaster.intersectObjects(labelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(ringLabelLayer.interactiveObjects, false),
            ...raycaster.intersectObjects(seismicLayer.interactiveObjects, false),
          ];
          const hit = hits.find((e) => e.object.visible && e.object.userData.feature);
          if (hit) { openFeature(hit.object.userData.feature, hit.object.parent === cutawayResult.labelsGroup || hit.object.parent === cutawayResult.group); }
          return;
        }

        const intersections = [
          ...raycaster.intersectObjects(labelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(ringLabelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(moonLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(moonFeatureLabelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(geologyStructureLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(geologyContactLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(seismicLayer.interactiveObjects, false),
        ].sort((a, b) => a.distance - b.distance);
        const hit = intersections.find((entry) => isObjectActuallyVisible(entry.object) && entry.object.userData.feature);
        const surfaceHit = geologyToggle.checked ? intersectMarsSurface(event.clientX, event.clientY) : null;
        if (surfaceHit) {
          const geologyFeature = getGeologyFeatureAtPoint(surfaceHit.point, geologyInteractiveState);
          if (geologyFeature) {
            openFeature(geologyFeature, false);
            return;
          }
        }
        if (hit) {
          openFeature(hit.object.userData.feature, false);
          return;
        }
      });

      function onResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (activeMeasurementResultAnchor && measurementResultCard && !measurementResultCard.hidden) {
          positionMeasurementResultCard(activeMeasurementResultAnchor);
        }
      }

      window.addEventListener("resize", onResize);

      function viewportToClient(nx, ny) {
        const rect = renderer.domElement.getBoundingClientRect();
        return {
          clientX: rect.left + rect.width * nx,
          clientY: rect.top + rect.height * ny,
        };
      }

      function sampleFeatureAtViewport(nx, ny) {
        const { clientX, clientY } = viewportToClient(nx, ny);
        const surfaceHit = intersectMarsSurface(clientX, clientY);
        const geologyFeature = surfaceHit ? getGeologyFeatureAtPoint(surfaceHit.point, geologyInteractiveState) : null;
        if (geologyFeature) {
          return geologyFeature;
        }
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        const intersections = [
          ...raycaster.intersectObjects(labelLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(geologyStructureLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(geologyContactLayer.interactiveObjects, false),
          ...raycaster.intersectObjects(seismicLayer.interactiveObjects, false),
        ];
        const hit = intersections.find((entry) => isObjectActuallyVisible(entry.object) && entry.object.userData.feature);
        return hit ? hit.object.userData.feature : null;
      }

      window.__jupiterViewerDebug = {
        isReady: () => true,
        getState: () => ({
          solidGeology: Boolean(geologyGlobe && geologyGlobe.visible),
          contacts: Boolean(geologyContactLayer.group.visible),
          structures: Boolean(geologyStructureLayer.group.visible),
          coreEnabled: Boolean(coreToggle.checked),
          selectedFeatureType: activePopupFeature?.type || null,
          selectedFeatureName: activePopupFeature?.name || null,
          selectedOutlineVisible: Boolean(selectedGeologyOutline?.mesh?.visible),
        }),
        setToggle: (id, checked) => {
          const node = document.getElementById(id);
          if (!node) {
            return false;
          }
          node.checked = Boolean(checked);
          node.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        },
        setTerrainRelief: (value) => {
          terrainScale.value = String(value);
          terrainScale.dispatchEvent(new Event("input", { bubbles: true }));
          return Number(terrainScale.value);
        },
        sampleFeatureAtViewport: (nx = 0.5, ny = 0.5) => sampleFeatureAtViewport(nx, ny),
        openFeatureAtViewport: (nx = 0.5, ny = 0.5) => {
          const feature = sampleFeatureAtViewport(nx, ny);
          if (feature) {
            openFeature(feature, false);
          }
          return feature;
        },
        getFirstLineRadius: (kind) => {
          const layer = kind === "contacts" ? geologyContactLayer : geologyStructureLayer;
          const line = layer?.interactiveObjects?.find((entry) => isObjectActuallyVisible(entry));
          if (!line) {
            return null;
          }
          const positions = line.geometry?.attributes?.position?.array;
          if (!positions || positions.length < 3) {
            return null;
          }
          return Math.sqrt(
            positions[0] * positions[0] +
            positions[1] * positions[1] +
            positions[2] * positions[2]
          );
        },
      };

      async function runEmbeddedSmokeTest() {
        const params = new URLSearchParams(window.location.search);
        if (params.get("smoketest") !== "1") {
          return;
        }
        const resultNode = document.createElement("pre");
        resultNode.id = "smoke-test-result";
        resultNode.textContent = "RUNNING";
        resultNode.style.position = "fixed";
        resultNode.style.left = "1rem";
        resultNode.style.bottom = "1rem";
        resultNode.style.zIndex = "999";
        resultNode.style.padding = "0.65rem 0.8rem";
        resultNode.style.borderRadius = "0.7rem";
        resultNode.style.background = "rgba(7, 10, 18, 0.92)";
        resultNode.style.color = "#f2f5ff";
        document.body.appendChild(resultNode);

        const assert = (condition, message) => {
          if (!condition) {
            throw new Error(message);
          }
        };

        try {
          let state = window.__jupiterViewerDebug.getState();
          assert(state.solidGeology === true, "Solid geology should load enabled by default.");

          const feature = window.__jupiterViewerDebug.openFeatureAtViewport(0.5, 0.5);
          assert(feature, "Expected a geology feature at the viewport center.");
          assert(feature.type === "Geologic unit polygon", `Expected geology polygon, got ${feature.type}`);

          state = window.__jupiterViewerDebug.getState();
          assert(state.selectedOutlineVisible === true, "Selected geology outline should be visible.");

          window.__jupiterViewerDebug.setToggle("geology-toggle", false);
          window.__jupiterViewerDebug.setToggle("geology-contacts-toggle", true);
          window.__jupiterViewerDebug.setToggle("geology-structures-toggle", true);
          state = window.__jupiterViewerDebug.getState();
          assert(state.solidGeology === false, "Solid geology should be independently disabled.");
          assert(state.contacts === true, "Contacts should remain visible independently.");
          assert(state.structures === true, "Structures should remain visible independently.");

          const radiusBefore = window.__jupiterViewerDebug.getFirstLineRadius("contacts");
          assert(radiusBefore !== null, "Expected a visible contact line sample radius.");
          window.__jupiterViewerDebug.setTerrainRelief(0.2);
          await new Promise((resolve) => setTimeout(resolve, 250));
          const radiusAfter = window.__jupiterViewerDebug.getFirstLineRadius("contacts");
          assert(radiusAfter !== null && Math.abs(radiusAfter - radiusBefore) > 1e-4, "Contact linework should move with terrain relief.");

          window.__jupiterViewerDebug.setToggle("core-toggle", true);
          state = window.__jupiterViewerDebug.getState();
          assert(state.coreEnabled === true, "Core view should enable.");
          assert(state.solidGeology === true, "Solid geology should remain visible in core view when enabled.");
          assert(state.contacts === true, "Contacts should remain available in core view.");
          assert(state.structures === true, "Structures should remain available in core view.");

          resultNode.dataset.status = "pass";
          resultNode.textContent = "PASS";
        } catch (error) {
          resultNode.dataset.status = "fail";
          resultNode.textContent = `FAIL
${error && error.message ? error.message : error}`;
        }
      }


      function updateMoonOrbits(moonEntries, featureEntries, t) {
        if (activeMoonViewerFeature) {
          return;
        }
        const BASE_ORBIT_RADIUS = 8.4;
        const BASE_PERIOD_MS = 240000;
        const BASE_OMEGA = (2 * Math.PI) / BASE_PERIOD_MS;
        for (const entry of moonEntries) {
          const { item, anchor, moonMesh, sprite, line, orbitRadius, initialAngle, moonRadius, lift } = entry;
          const _periodDays = MOON_PERIODS_DAYS[item.name];
          const omega = _periodDays !== undefined
            ? (2 * Math.PI * _MOON_SPEED_FACTOR * Math.sign(_periodDays)) / (Math.abs(_periodDays) * 86400000)
            : BASE_OMEGA * Math.pow(BASE_ORBIT_RADIUS / orbitRadius, 1.5);
          const angle = initialAngle + t * omega;
          const x = Math.cos(angle) * orbitRadius;
          const z = Math.sin(angle) * orbitRadius;
          const y = anchor.y;
          item.moon_anchor[0] = x;
          item.moon_anchor[2] = z;
          anchor.set(x, y, z);
          moonMesh.position.set(x, y, z);
          // Rotation: tidally-locked moons track orbital angle; non-locked use own period.
          if (MOON_SELF_ROT_DAYS[item.name] !== undefined) {
            const selfOmega = (2 * Math.PI * _MOON_SPEED_FACTOR) / (MOON_SELF_ROT_DAYS[item.name] * 86400000);
            moonMesh.rotation.y = t * selfOmega;
          } else {
            moonMesh.rotation.y = TEXTURE_CENTERED_MOONS.has(item.name)
              ? (Math.PI - angle)
              : -angle;
          }
          // Update moonMesh.matrix now so the featureEntries loop can use it this frame.
          moonMesh.updateMatrix();
          sprite.position.set(x, y + lift, z);
          const lp = line.geometry.attributes.position.array;
          lp[0] = x;  lp[1] = y + moonRadius;  lp[2] = z;
          lp[3] = x;  lp[4] = y + lift - 0.06;        lp[5] = z;
          line.geometry.attributes.position.needsUpdate = true;
        }
        for (const entry of featureEntries) {
          const { parentMoon, moonMesh, moonAnchor, marker, hitTarget, sprite, line, surfacePoint,
                  localMarkerPos, localHitPos, localSurfacePos, localLabelPos } = entry;
          // Keep moonAnchor in sync (read by updateMoonFeatureLabelVisibility).
          moonAnchor.set(
            parentMoon.moon_anchor[0],
            parentMoon.moon_anchor[1],
            parentMoon.moon_anchor[2]
          );
          if (!moonMesh) continue;
          // Apply moon mesh's local matrix (position + tidal-locking rotation) to each local position.
          // moonMesh.matrix maps moon-local → moonLayer.group local = marsGroup local space.
          const wMark  = localMarkerPos.clone().applyMatrix4(moonMesh.matrix);
          const wHit   = localHitPos.clone().applyMatrix4(moonMesh.matrix);
          const wSurf  = localSurfacePos.clone().applyMatrix4(moonMesh.matrix);
          const wLabel = localLabelPos.clone().applyMatrix4(moonMesh.matrix);
          surfacePoint.copy(wSurf);
          marker.position.copy(wMark);
          hitTarget.position.copy(wHit);
          sprite.position.copy(wLabel);
          const fp = line.geometry.attributes.position.array;
          fp[0] = wMark.x;  fp[1] = wMark.y;  fp[2] = wMark.z;
          fp[3] = wLabel.x; fp[4] = wLabel.y; fp[5] = wLabel.z;
          line.geometry.attributes.position.needsUpdate = true;
        }
      }

      function render() {
        controls.update();
        // Tighten near plane in moon viewer so labels don't get GPU-clipped when zoomed close.
        const _moonViewerNear = activeMoonViewerFeature
          ? Math.max(0.005, Number(activeMoonViewerFeature.moon_radius || 0.1) * 0.08)
          : 0.1;
        if (Math.abs(camera.near - _moonViewerNear) > 0.0001) {
          camera.near = _moonViewerNear;
          camera.updateProjectionMatrix();
        }
        updateScaleReadout(camera, renderer, controls);
        updateCenterReadout(camera, globe, marsGroup);
        const _t = performance.now();
        const _spinT = getSpinTime();
        if (!coreToggle.checked) {
          updateMoonOrbits(moonLayer.entries, moonFeatureLabelLayer.entries, _spinT);
          globe.rotation.y = Math.PI + _spinT * (2 * Math.PI / _PLANET_DISPLAY_PERIOD_MS);
          const _spinDelta = globe.rotation.y - Math.PI;
          labelLayer.group.rotation.y = _spinDelta;
          seismicLayer.group.rotation.y = _spinDelta;
          geologyContactLayer.group.rotation.y = _spinDelta;
          geologyStructureLayer.group.rotation.y = _spinDelta;
          measureGroup.rotation.y = activeMoonViewerFeature ? 0 : _spinDelta;
          labelLayer.group.updateWorldMatrix(true, false);
        }
        updateMeasureVisualScale();
        const removeAtmosphere = Boolean(geologyToggle && geologyToggle.checked);
        const jupiterLabelsEnabled = labelsToggle.checked && !removeAtmosphere;
        const jupiterSeismicEnabled = seismicToggle.checked && !removeAtmosphere;

  
        if (!coreToggle.checked) {
          updateLabelVisibility(
            labelLayer.entries,
            labelLayer.group,
            globe,
            camera,
            renderer,
            jupiterLabelsEnabled,
            !removeAtmosphere && volcanicLabelsToggle.checked,
            !removeAtmosphere && landingLabelsToggle.checked,
            !removeAtmosphere && habitationLabelsToggle.checked,
            false,
            stormLabelsToggle ? (!removeAtmosphere && stormLabelsToggle.checked) : true,
          );
          updateRingLabelVisibility(
            ringLabelLayer.entries,
            marsGroup,
            camera,
            renderer,
            labelsToggle.checked && !activeMoonViewerFeature,
          );
          updateMoonVisibility(
            moonLayer.entries,
            marsGroup,
            camera,
            renderer,
            true,
            moonToggle ? moonToggle.checked : true,
            Boolean(activeMoonViewerFeature),
          );
          updateMoonFeatureLabelVisibility(
            moonFeatureLabelLayer.entries,
            marsGroup,
            camera,
            renderer,
            activeMoonViewerFeature,
            volcanicLabelsToggle.checked,
            labelsToggle.checked,
            moonFeatureTypeFilter,
          );
          updateSeismicVisibility(
            seismicLayer.entries,
            marsGroup,
            globe,
            camera,
            renderer,
            jupiterSeismicEnabled,
            false,
            seismicFilterSelect.value,
            seismicStatusSelect.value,
            Number(seismicMagnitudeMin.value),
            currentTimelineCutoff(),
          );
        } else {
          updateLabelVisibility(
            labelLayer.entries,
            labelLayer.group,
            globe,
            camera,
            renderer,
            jupiterLabelsEnabled,
            jupiterLabelsEnabled && volcanicLabelsToggle.checked,
            jupiterLabelsEnabled && landingLabelsToggle.checked,
            jupiterLabelsEnabled && habitationLabelsToggle.checked,
            true,
            stormLabelsToggle ? (jupiterLabelsEnabled && stormLabelsToggle.checked) : true,
          );
          updateRingLabelVisibility(
            ringLabelLayer.entries,
            marsGroup,
            camera,
            renderer,
            labelsToggle.checked && !activeMoonViewerFeature,
          );
          updateMoonVisibility(
            moonLayer.entries,
            marsGroup,
            camera,
            renderer,
            true,
            moonToggle ? moonToggle.checked : true,
            Boolean(activeMoonViewerFeature),
          );
          updateMoonFeatureLabelVisibility(
            moonFeatureLabelLayer.entries,
            marsGroup,
            camera,
            renderer,
            activeMoonViewerFeature,
            volcanicLabelsToggle.checked,
            labelsToggle.checked,
            moonFeatureTypeFilter,
          );
          updateSeismicVisibility(
            seismicLayer.entries,
            marsGroup,
            globe,
            camera,
            renderer,
            jupiterSeismicEnabled,
            true,
            seismicFilterSelect.value,
            seismicStatusSelect.value,
            Number(seismicMagnitudeMin.value),
            currentTimelineCutoff(),
          );
          updateCoreLabelVisibility(
            cutawayResult,
            camera,
            Boolean(coreLabelsToggle && coreLabelsToggle.checked),
          );
        }

        if (activePopupFeature && !scenePopup.hidden) {
          if (isMoonViewerSelectedFeature(activePopupFeature) && !activePopupIsCoreLabel) {
            scenePopup.hidden = false;
            scenePopupAnchor.hidden = true;
            syncMoonViewerPopup(activePopupFeature, false);
          } else {
            scenePopupAnchor.hidden = false;
          }
          let anchorPos;
          if (isMoonViewerSelectedFeature(activePopupFeature) && !activePopupIsCoreLabel) {
            anchorPos = null;
          } else if (activePopupIsCoreLabel) {
            // Core label: use fixed label position in local space
            anchorPos = new THREE.Vector3(
              activePopupFeature.labelX,
              activePopupFeature.labelY,
              0,
            );
            anchorPos.applyMatrix4(marsGroup.matrixWorld);
          } else {
            const popupAnchorLift = isGeologyFeature(activePopupFeature) ? 0.018 : 0.28;
            anchorPos = getFeatureSurfacePoint(activePopupFeature, popupAnchorLift);
            anchorPos.applyMatrix4(marsGroup.matrixWorld);
          }
          if (anchorPos) {
            const projected = anchorPos.clone().project(camera);
            if (projected.z > 1) {
              scenePopup.hidden = true;
              scenePopupAnchor.hidden = true;
            } else {
              const sx = (projected.x * 0.5 + 0.5) * window.innerWidth;
              const sy = -(projected.y * 0.5 - 0.5) * window.innerHeight;
              scenePopup.style.left = `${sx}px`;
              scenePopup.style.top = `${sy}px`;
              scenePopupAnchor.style.left = `${sx}px`;
              scenePopupAnchor.style.top = `${sy}px`;
            }
          }
        }

        if (activeMeasurementResultAnchor && measurementResultCard && !measurementResultCard.hidden) {
          positionMeasurementResultCard(activeMeasurementResultAnchor);
        }

        if (selectedGeologyOutline && selectedGeologyOutline.mesh && selectedGeologyOutline.mesh.visible) {
          selectedGeologyOutline.mesh.material.opacity = 0.72 + (Math.sin(timestamp * 0.004) * 0.08);
        }

        if (selectedGeologyBoundaryGroup && selectedGeologyBoundaryGroup.visible) {
          const pulse = 0.78 + ((Math.sin(timestamp * 0.005) + 1) * 0.11);
          for (const child of selectedGeologyBoundaryGroup.children) {
            if (child.material && child.userData?.selectionAccent) {
              child.material.opacity = pulse;
            }
          }
        }

        const entryMarker = selectedLabelEntry
          ? (selectedLabelEntry.marker || selectedLabelEntry.dot || selectedLabelEntry.sprite || null)
          : null;
        if (entryMarker && entryMarker.visible) {
          if (!selectedLabelEntry._pulseBase) {
            selectedLabelEntry._pulseBase = {
              spriteColor: selectedLabelEntry.sprite?.material?.color?.clone() ?? new THREE.Color(1, 1, 1),
              spriteOpacity: selectedLabelEntry.sprite?.material?.opacity ?? 1,
              dotColor: selectedLabelEntry.dot?.material?.color?.clone() ?? new THREE.Color(1, 1, 1),
              markerColor: selectedLabelEntry.marker?.material?.color?.clone() ?? new THREE.Color(1, 1, 1),
              markerOpacity: selectedLabelEntry.marker?.material?.opacity ?? 1,
              markerScale: selectedLabelEntry.marker?.scale?.clone?.() || null,
              lineOpacity: selectedLabelEntry.line?.material?.opacity ?? 0.42,
            };
          }
          const pulse = (Math.sin(_t * 0.004) + 1) * 0.5;
          const _isMoonSurfaceEntry = moonFeatureLabelLayer.entries.some((e) => e === selectedLabelEntry);
          if (_isMoonSurfaceEntry) {
            // Moon feature markers live in moonFeatureLabelLayer.group (unrotated),
            // but selectionRing lives in labelLayer.group (rotated by _spinDelta).
            // Un-rotate the marker position by -_spinDelta to place ring correctly.
            const _yRot = -labelLayer.group.rotation.y;
            const _cos = Math.cos(_yRot), _sin = Math.sin(_yRot);
            const _p = entryMarker.position;
            selectionRing.position.set(
              _p.x * _cos + _p.z * _sin,
              _p.y,
              -_p.x * _sin + _p.z * _cos
            );
            selectionRing.scale.setScalar((0.002 / 0.036) * (1.2 + pulse * 0.05));
            selectionRing.visible = true;
          } else {
            selectionRing.position.copy(entryMarker.position);
            const markerScale = entryMarker.scale?.x || 1;
            selectionRing.scale.setScalar((1.2 + pulse * 0.6) * markerScale);
            selectionRing.visible = true;
          }
          selectionRing.material.opacity = 0.35 + pulse * 0.55;
          if (selectedLabelEntry.sprite?.material) {
            selectedLabelEntry.sprite.material.color.setRGB(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
            selectedLabelEntry.sprite.material.opacity = 0.78 + pulse * 0.22;
          }
          if (selectedLabelEntry.dot?.material) {
            selectedLabelEntry.dot.material.color.setRGB(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
          }
          if (selectedLabelEntry.marker?.material) {
            selectedLabelEntry.marker.material.color.setRGB(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
            selectedLabelEntry.marker.material.opacity = 0.86 + pulse * 0.14;
          }
          if (selectedLabelEntry.marker?.scale && selectedLabelEntry._pulseBase?.markerScale) {
            const ms = selectedLabelEntry._pulseBase.markerScale;
            selectedLabelEntry.marker.scale.set(ms.x * (1 + pulse * 0.14), ms.y * (1 + pulse * 0.14), ms.z * (1 + pulse * 0.14));
          }
          if (selectedLabelEntry.line?.material) {
            selectedLabelEntry.line.material.opacity = 0.42 + pulse * 0.4;
          }
        } else {
          selectionRing.visible = false;
        }

        renderer.render(scene, camera);
        requestAnimationFrame((timestamp) => {
          lastTimestamp = Math.max(16, timestamp - (lastTimestamp || timestamp));
          render();
        });
      }

      const hasAnyBaseTexture = baseLayers.some((layer) => layerTextures.get(layer.id));
      if (!hasAnyBaseTexture) {
        setStatus("Loaded fallback globe. Color texture missing.", true);
      } else if (!elevationMap && !initialGeologyTexture) {
        setStatus("Loaded base globe only. Elevation and geology layers unavailable.", true);
      } else if (!elevationMap) {
        setStatus("Loaded without terrain relief. Elevation map unavailable.", true);
      } else if (!initialGeologyTexture) {
        setStatus("Loaded without geology overlay. Overlay asset unavailable.", true);
      } else {
        setStatus("© 2026 GeoID: Explorer. GeoID Solutions, led by Owen McCluskey. All rights reserved.");
      }

      // Background-load all non-default layers in batches of 4.
      // The globe is already rendering with default layers by the time this runs.
      (function backgroundLoadLayers() {
        const BATCH = 4;
        const queue = [
          // Non-default base layers
          ...baseLayers
            .filter(l => l.path && !layerTextures.get(l.id))
            .map(layer => async () => {
              const raw = await loadTextureSafe(textureLoader, layer.path);
              const tex = applyTextureTransforms(raw, layer);
              if (tex) tex.colorSpace = THREE.SRGBColorSpace;
              layerTextures.set(layer.id, tex);
            }),
          // Moon textures
          ...moonData
            .filter(item => MOON_VIEWER_TEXTURES[item.name])
            .map(item => async () => {
              const tex = await loadTextureSafe(textureLoader, MOON_VIEWER_TEXTURES[item.name]);
              if (tex) tex.colorSpace = THREE.SRGBColorSpace;
              moonTextures.set(item.name, tex || null);
              if (tex && moonLayer) {
                const entry = moonLayer.entries.find(e => e.item?.name === item.name);
                if (entry && entry.moonMesh) {
                  // All moon textures are already east-positive with lon=0° at the left edge.
                  // No horizontal flip is applied.
                  entry.moonMesh.material.map = tex;
                  entry.moonMesh.material.color.set('#ffffff');
                  entry.moonMesh.material.needsUpdate = true;
                }
              }
            }),
          // Non-default geology overlays
          ...geologyLayers
            .filter(l => !l.default)
            .map(layer => async () => {
              const raw = await loadTextureSafe(textureLoader, layer.path);
              const tex = applyTextureTransforms(raw, layer);
              if (tex) tex.colorSpace = THREE.SRGBColorSpace;
              geologyTextures.set(layer.id, tex);
            }),
          // Mineral maps
          ...mineralLayers.map(layer => async () => {
            const raw = await loadTextureSafe(textureLoader, layer.path);
            if (raw) raw.colorSpace = THREE.SRGBColorSpace;
            const tex = raw ? processMineralTexture(raw) : null;
            mineralTextures.set(layer.id, tex);
          }),
        ];
        async function runQueue() {
          for (let i = 0; i < queue.length; i += BATCH) {
            await Promise.all(queue.slice(i, i + BATCH).map(fn => fn()));
          }
        }
        runQueue().catch(() => {});
      })();
      if (new URLSearchParams(window.location.search).get('transit') === '1') {
        const _startLoop = () => {
          try { window.parent.postMessage('geoid-ready', '*'); } catch (_) {}
          render();
        };
        try {
          if (window.parent._geoidReveal) { _startLoop(); }
          else { window.addEventListener('message', e => { if (e.data === 'geoid-reveal') _startLoop(); }, { once: true }); }
        } catch (_) { render(); }
      } else {
        render();
      }
      geologyFeaturePromise.then(catalog => {
        if (!catalog) return;
        geologyInteractiveState = {
          width: catalog.width || 4096,
          height: catalog.height || 2048,
          features: catalog.features || {},
          featureList: Object.values(catalog.features || {}),
          unit_legend: catalog.unit_legend || [],
          rock_legend: catalog.rock_legend || [],
          contacts: catalog.contacts || [],
          structures: catalog.structures || [],
          landing_sites: catalog.landing_sites || [],
        };
        syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      }).catch(() => {});
      void runEmbeddedSmokeTest();
    }

    init().catch((error) => {
      console.error(error);
      setStatus(`Viewer failed to load: ${error.message}`, true);
      showViewerErrorState(error.message);
    });

    // Custom audio player
    (function () {
      const audioEl = document.getElementById("mars-audio-el");
      const playBtn = document.getElementById("audio-play-btn");
      const iconPlay = document.getElementById("audio-icon-play");
      const iconPause = document.getElementById("audio-icon-pause");
      const seekEl = document.getElementById("audio-seek");
      const timeEl = document.getElementById("audio-time");
      if (!audioEl || !playBtn) return;
      function fmt(s) {
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, "0")}`;
      }
      function updateTime() {
        const cur = isFinite(audioEl.currentTime) ? audioEl.currentTime : 0;
        const dur = isFinite(audioEl.duration) ? audioEl.duration : 0;
        timeEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;
        if (dur > 0) seekEl.value = (cur / dur) * 100;
      }
      playBtn.addEventListener("click", () => {
        if (audioEl.paused) { audioEl.play(); } else { audioEl.pause(); }
      });
      audioEl.addEventListener("play", () => {
        iconPlay.style.display = "none";
        iconPause.style.display = "block";
      });
      audioEl.addEventListener("pause", () => {
        iconPlay.style.display = "block";
        iconPause.style.display = "none";
      });
      audioEl.addEventListener("ended", () => {
        iconPlay.style.display = "block";
        iconPause.style.display = "none";
        seekEl.value = 0;
      });
      if (seekEl && timeEl) {
        audioEl.addEventListener("timeupdate", updateTime);
        audioEl.addEventListener("loadedmetadata", updateTime);
        seekEl.addEventListener("input", () => {
          if (isFinite(audioEl.duration)) {
            audioEl.currentTime = (seekEl.value / 100) * audioEl.duration;
          }
        });
      }
    })();

    // Info button → help overlay
    const infoBtn = document.getElementById("info-btn");
    const viewerHelpOverlay = document.getElementById("viewer-help-overlay");
    const viewerHelpModal = document.getElementById("viewer-help-modal");
    if (infoBtn && viewerHelpOverlay && viewerHelpModal) {
      const openViewerHelp = () => { viewerHelpOverlay.hidden = false; infoBtn.classList.add("is-active"); viewerHelpModal.focus(); };
      const closeViewerHelp = () => { viewerHelpOverlay.hidden = true; infoBtn.classList.remove("is-active"); };
      infoBtn.addEventListener("click", () => viewerHelpOverlay.hidden ? openViewerHelp() : closeViewerHelp());
      const helpClose = document.getElementById("viewer-help-close");
      if (helpClose) helpClose.addEventListener("click", closeViewerHelp);
      viewerHelpOverlay.addEventListener("click", (e) => { if (e.target.dataset.helpClose) closeViewerHelp(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !viewerHelpOverlay.hidden) closeViewerHelp(); });
    } else if (infoBtn) {
      const viewerInfo = document.getElementById("viewer-info");
      if (viewerInfo) {
        infoBtn.addEventListener("click", () => {
          const visible = viewerInfo.classList.toggle("is-visible");
          infoBtn.classList.toggle("is-active", visible);
        });
      }
    }

    // Brand logo button → reset camera view
    const brandResetButton = document.getElementById("brand-reset-button");
    if (brandResetButton) {
      brandResetButton.addEventListener("click", () => {
        if (viewerCamera && viewerControls) {
          reloadToDefaultGlobalView(viewerCamera, viewerControls);
        }
      });
    }

    // Nav panel collapse toggle
    const uiPanel = document.getElementById("ui");
    const navCollapseBtn = document.getElementById("nav-collapse-btn");
    const navTab = document.getElementById("nav-tab");
    const bottomRightHud = document.getElementById("bottom-right-hud");
    if (uiPanel && navCollapseBtn && navTab) {
      const syncNavCollapseHudState = () => {
        if (!bottomRightHud) return;
        bottomRightHud.classList.toggle("nav-collapsed", uiPanel.classList.contains("is-collapsed"));
      };
      navCollapseBtn.addEventListener("click", () => {
        uiPanel.classList.add("is-collapsed");
        navTab.style.display = "flex";
        syncNavCollapseHudState();
      });
      navTab.addEventListener("click", () => {
        uiPanel.classList.remove("is-collapsed");
        navTab.style.display = "none";
        syncNavCollapseHudState();
      });
      syncNavCollapseHudState();
    }
