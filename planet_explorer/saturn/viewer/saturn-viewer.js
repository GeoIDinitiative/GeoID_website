    import * as THREE from "./vendor/three.module.js";
    import { OrbitControls } from "./vendor/OrbitControls.js";

    const manifest = window.__saturnViewerManifest;
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
    const labelData = [{"name": "North Polar Hexagon", "type": "Persistent jetstream pattern", "lat": 78.0, "lon": 0.0, "theme": "polar", "description": "A striking six-sided wave pattern encircling Saturn's north pole, maintained by a powerful high-latitude jet stream."}, {"name": "North Polar Vortex", "type": "Polar cyclone", "lat": 89.0, "lon": 0.0, "theme": "polar", "description": "A hurricane-like vortex at Saturn's north pole with a well-defined eye and tightly wound cloud structure."}, {"name": "South Polar Vortex", "type": "Polar cyclone", "lat": -89.0, "lon": 0.0, "theme": "polar", "description": "A long-lived south polar storm system revealing deep atmospheric circulation and strong polar dynamics."}, {"name": "North Polar Eye Wall", "type": "Cyclone eye wall", "lat": 87.5, "lon": 24.0, "theme": "polar", "description": "Representative ring of bright cloud walls and rapid winds encircling the eye of Saturn's north-polar cyclone."}, {"name": "South Polar Eye Wall", "type": "Cyclone eye wall", "lat": -87.5, "lon": 336.0, "theme": "polar", "description": "Representative annulus of tightly wrapped clouds surrounding the eye of Saturn's south-polar cyclone."}, {"name": "North Polar Jet", "type": "High-latitude jet", "lat": 74.0, "lon": 28.0, "theme": "polar", "description": "A powerful circumpolar jet that bounds the north-polar weather system and helps maintain the hexagon pattern."}, {"name": "South Polar Jet", "type": "High-latitude jet", "lat": -74.0, "lon": 332.0, "theme": "polar", "description": "A southern circumpolar jet surrounding Saturn's south-polar vortex and organizing the polar cloud field."}, {"name": "North Polar Collar", "type": "Polar band", "lat": 64.0, "lon": 14.0, "theme": "band", "description": "A bright high-latitude band wrapping around the north-polar domain, marking the transition into the temperate atmosphere."}, {"name": "South Polar Collar", "type": "Polar band", "lat": -64.0, "lon": 344.0, "theme": "band", "description": "A bright southern high-latitude collar separating the south-polar vortex from the adjacent zonal bands."}, {"name": "North Polar Haze Belt", "type": "High-altitude haze belt", "lat": 58.0, "lon": 70.0, "theme": "polar", "description": "Representative high-latitude belt where upper-atmosphere haze and photochemical products soften cloud-band contrasts."}, {"name": "South Polar Haze Belt", "type": "High-altitude haze belt", "lat": -58.0, "lon": 286.0, "theme": "polar", "description": "A southern haze-rich transition belt marking the shift from polar cyclone dynamics into the broader zonal circulation."}, {"name": "Equatorial Zone", "type": "Bright cloud zone", "lat": 0.0, "lon": 0.0, "theme": "band", "description": "A bright equatorial band where strong zonal winds shape cloud decks, wave features, and changing atmospheric haze."}, {"name": "Equatorial Jet Core", "type": "Fast zonal jet", "lat": 2.0, "lon": 72.0, "theme": "band", "description": "The core of Saturn's fast equatorial jet, where east-west winds dominate the visible cloud-top circulation."}, {"name": "Equatorial Wave Train", "type": "Equatorial wave field", "lat": 1.0, "lon": 142.0, "theme": "band", "description": "Representative region for the wave-like cloud structures and scalloped textures carried along Saturn's equatorial jet."}, {"name": "North Equatorial Belt", "type": "Atmospheric belt", "lat": 12.0, "lon": 0.0, "theme": "band", "description": "A darker belt north of Saturn's equator marked by wind shear and evolving cloud structure."}, {"name": "South Equatorial Belt", "type": "Atmospheric belt", "lat": -12.0, "lon": 0.0, "theme": "band", "description": "A southern low-latitude band where storms and zonal flows interact with neighboring brighter zones."}, {"name": "North Tropical Zone", "type": "Tropical zone", "lat": 21.0, "lon": 30.0, "theme": "band", "description": "A bright tropical band between the equatorial and temperate circulation systems, often marked by subtle haze and cloud contrasts."}, {"name": "South Tropical Zone", "type": "Tropical zone", "lat": -21.0, "lon": 328.0, "theme": "band", "description": "A southern tropical bright band linking the equatorial circulation to the stormier southern mid-latitudes."}, {"name": "North Temperate Belt", "type": "Temperate belt", "lat": 32.0, "lon": 0.0, "theme": "band", "description": "A mid-latitude atmospheric belt tracing Saturn's banded circulation pattern and cloud contrasts."}, {"name": "South Temperate Belt", "type": "Temperate belt", "lat": -32.0, "lon": 0.0, "theme": "band", "description": "A broad southern belt where storms and waves punctuate the more subdued banded atmosphere."}, {"name": "North Temperate Zone", "type": "Temperate zone", "lat": 43.0, "lon": 22.0, "theme": "band", "description": "A brighter northern mid-latitude zone that helps separate Saturn's temperate belts and storm tracks."}, {"name": "South Temperate Zone", "type": "Temperate zone", "lat": -43.0, "lon": 340.0, "theme": "band", "description": "A southern bright mid-latitude zone, visible between darker belts and recurring weather systems."}, {"name": "North Mid-Latitude Ribbon", "type": "Wave-rich cloud band", "lat": 46.0, "lon": 118.0, "theme": "band", "description": "Representative northern ribbon of elongated clouds and wave structure embedded within Saturn's temperate circulation."}, {"name": "South Mid-Latitude Ribbon", "type": "Wave-rich cloud band", "lat": -47.0, "lon": 254.0, "theme": "band", "description": "A southern counterpart to Saturn's wave-rich temperate cloud ribbons, often highlighted in high-contrast imaging."}, {"name": "Great White Spot", "type": "Planet-encircling storm", "lat": 35.0, "lon": 250.0, "theme": "storm", "description": "The name given to rare giant Saturn storms that can erupt and expand across much of a latitude band."}, {"name": "Great White Spot Source Latitude", "type": "Outbreak latitude", "lat": 34.5, "lon": 286.0, "theme": "storm", "description": "Representative storm-birth latitude for the 2010-2011 Great White Spot outbreak and its rapidly expanding cloud head."}, {"name": "Dragon Storm Alley", "type": "Storm-rich latitude", "lat": -35.0, "lon": 35.0, "theme": "storm", "description": "A southern storm-prone belt known from radio and lightning observations as a recurring convective region."}, {"name": "Northern Storm Track", "type": "Storm-active latitude", "lat": 37.0, "lon": 120.0, "theme": "storm", "description": "A northern mid-latitude corridor where bright storms and vortices are frequently tracked in long-term imaging."}, {"name": "Southern Storm Track", "type": "Storm-active latitude", "lat": -39.0, "lon": 290.0, "theme": "storm", "description": "A southern weather belt where convective outbreaks, waves, and dark eddies recur in spacecraft and telescope monitoring."}, {"name": "String of Pearls Latitude", "type": "Dark spot chain", "lat": 33.0, "lon": 46.0, "theme": "storm", "description": "Representative latitude of the dark-vortex chain nicknamed the String of Pearls in Saturn's northern hemisphere."}, {"name": "Anticyclone Corridor", "type": "Vortex-rich belt", "lat": -28.0, "lon": 214.0, "theme": "storm", "description": "A representative southern belt where compact anticyclones and bright companion clouds recur in monitoring campaigns."}, {"name": "Ring Shadow Belt", "type": "Seasonal shadow band", "lat": 17.0, "lon": 188.0, "theme": "band", "description": "Representative latitude where Saturn's rings cast a broad seasonal shadow across the atmosphere, modulating illumination and haze appearance."}, {"name": "Ring Plane Crossing Zone", "type": "Equinox lighting zone", "lat": 8.0, "lon": 166.0, "theme": "landing", "description": "Representative region used to illustrate the changing illumination geometry during Saturn's ring-plane crossing seasons."}, {"name": "Cassini Grand Finale Track", "type": "Mission corridor", "lat": 10.0, "lon": 210.0, "theme": "landing", "description": "Representative region for Cassini's close-in Grand Finale orbits that sampled Saturn's gravity, magnetic field, and upper atmosphere."}, {"name": "Cassini Probe Atmospheric Entry", "type": "Probe entry region", "lat": -9.5, "lon": 192.0, "theme": "landing", "description": "Approximate atmospheric sampling corridor associated with Cassini-era measurements of Saturn's atmosphere and cloud dynamics."}, {"name": "Cassini Equatorial Imaging Swath", "type": "Mission imaging track", "lat": 6.0, "lon": 118.0, "theme": "landing", "description": "Representative equatorial region repeatedly imaged by Cassini to track cloud motions, waves, and seasonal atmospheric change."}, {"name": "Cassini Radio Occultation Corridor", "type": "Atmospheric sounding track", "lat": -24.0, "lon": 84.0, "theme": "landing", "description": "Representative corridor for Cassini radio occultation profiles that constrained Saturn's upper-atmosphere temperature and density structure."}, {"name": "Cassini Storm Monitoring Longitude", "type": "Long-term monitoring sector", "lat": 36.0, "lon": 156.0, "theme": "landing", "description": "Representative long-term imaging sector used to follow Saturn's storm evolution, vortices, and seasonal cloud changes."},
{"name": "North Auroral Oval", "type": "Polar aurora", "lat": 75.0, "lon": 180.0, "theme": "polar", "description": "Saturn's northern ultraviolet and infrared auroral emission ring, powered by charged particles funnelled along magnetic field lines toward the pole. Unlike Earth's aurora, Saturn's auroral oval is nearly fixed over the magnetic pole and remains active regardless of season."},
{"name": "South Auroral Oval", "type": "Polar aurora", "lat": -75.0, "lon": 90.0, "theme": "polar", "description": "The southern counterpart to Saturn's auroral ring, visible in UV and near-IR wavelengths. Cassini and Hubble observations revealed that Saturn's south auroral oval intensifies during solar wind compressions and is slightly offset from the rotation pole."},
{"name": "North Polar Stratospheric Vortex", "type": "Stratospheric circulation", "lat": 68.0, "lon": 200.0, "theme": "polar", "description": "A distinct high-altitude vortex sitting above and separate from the tropospheric hexagon. Observed in temperature and hydrocarbon maps by Cassini CIRS, it reflects a stratospheric layer of circulation driven by seasonal heating rather than deep convection."},
{"name": "Pioneer 11 Flyby Track", "type": "Spacecraft flyby corridor", "lat": -18.0, "lon": 300.0, "theme": "landing", "description": "Representative corridor for Pioneer 11's historic first flyby of Saturn on 1 September 1979. Approaching from high southern latitudes at ~1.35 Saturn radii closest approach, Pioneer 11 discovered the F Ring, measured the magnetic field, and confirmed Saturn's radiation belts before any other spacecraft had visited."},
{"name": "Voyager 1 Flyby Track", "type": "Spacecraft flyby corridor", "lat": 5.0, "lon": 48.0, "theme": "landing", "description": "Representative corridor for Voyager 1's Saturn flyby on 12 November 1980. At ~3.09 Saturn radii closest approach on a near-equatorial trajectory, Voyager 1 returned the first detailed images of the ring structure, discovered several new moons, and made the close Titan encounter that fixed its trajectory out of the ecliptic plane."},
{"name": "Voyager 2 Flyby Track", "type": "Spacecraft flyby corridor", "lat": -3.0, "lon": 172.0, "theme": "landing", "description": "Representative corridor for Voyager 2's Saturn flyby on 26 August 1981. Passing at ~2.69 Saturn radii, Voyager 2 extended Voyager 1's ring and moon discoveries, obtained high-resolution views of the Cassini Division and A Ring structure, and continued on to Uranus and Neptune — the only spacecraft to visit all four outer planets."}];
    const ringLabelData = [{"name": "D Ring", "type": "Diffuse inner ring", "theme": "ring", "description": "Saturn's faint innermost ring, lying just beyond the cloud tops and composed of dusty low-optical-depth material.", "ring_region": "Innermost ring system", "ring_radius_km": "~67,000-74,500 km from Saturn's center", "ring_anchor": [-3.4939, 0.0, 2.2689], "ring_label": [-3.7647, 0.18, 2.6594], "ring_line_end": [-3.697, 0.12, 2.5618]}, {"name": "C Ring", "type": "Crepe ring", "theme": "ring", "description": "A broad semi-transparent ring interior to the B Ring, often called the crepe ring because of its dusky appearance.", "ring_region": "Inner main ring", "ring_radius_km": "~74,500-92,000 km from Saturn's center", "ring_anchor": [-3.5225, 0.0, 3.1717], "ring_label": [-3.6059, 0.18, 3.5697], "ring_line_end": [-3.5457, 0.12, 3.4348]}, {"name": "B Ring", "type": "Bright dense ring", "theme": "ring", "description": "The optically thickest and brightest major ring of Saturn, dominating the visible ring system.", "ring_region": "Central main ring", "ring_radius_km": "~92,000-117,500 km from Saturn's center", "ring_anchor": [-3.3974, 0.0, 4.6761], "ring_label": [-3.2505, 0.18, 4.8823], "ring_line_end": [-3.205, 0.12, 4.7176]}, {"name": "Cassini Division", "type": "Major ring gap", "theme": "ring", "description": "The broad dark gap between the B and A rings, structured by resonances and embedded ring material rather than being completely empty.", "ring_region": "Between B Ring and A Ring", "ring_radius_km": "~117,500-122,000 km from Saturn's center", "ring_anchor": [-2.7373, 0.0, 6.1482], "ring_label": [-2.6312, 0.18, 6.2048], "ring_line_end": [-2.5813, 0.12, 6.019]}, {"name": "A Ring", "type": "Outer bright main ring", "theme": "ring", "description": "The bright outer main ring, lying beyond the Cassini Division and showing rich fine-scale structure.", "ring_region": "Outer main ring", "ring_radius_km": "~122,000-137,000 km from Saturn's center", "ring_anchor": [-1.3261, 0.0, 6.8223], "ring_label": [-1.4329, 0.18, 7.0574], "ring_line_end": [-1.3772, 0.12, 6.8492]}, {"name": "Encke Gap", "type": "Embedded gap", "theme": "ring", "description": "A narrow gap in the outer A Ring associated with the moon Pan and nearby ringlet structure.", "ring_region": "Within the A Ring", "ring_radius_km": "~133,600 km from Saturn's center", "ring_anchor": [0.2475, 0.0, 7.0893], "ring_label": [0.0812, 0.18, 7.4841], "ring_line_end": [0.1178, 0.12, 7.2427]}, {"name": "Keeler Gap", "type": "Embedded gap", "theme": "ring", "description": "A very narrow outer-A-ring gap shaped by the moon Daphnis, famous for edge waves raised in nearby ring material.", "ring_region": "Outer edge of the A Ring", "ring_radius_km": "~136,500 km from Saturn's center", "ring_anchor": [1.9977, 0.0, 6.9669], "ring_label": [1.8563, 0.18, 7.4169], "ring_line_end": [1.8485, 0.12, 7.1539]}, {"name": "F Ring", "type": "Narrow shepherded ring", "theme": "ring", "description": "A thin dynamic ring just outside the A Ring, continually shaped by nearby shepherd moons and clumpy strands.", "ring_region": "Just outside the main rings", "ring_radius_km": "~140,200 km from Saturn's center", "ring_anchor": [3.73, 0.0, 6.4606], "ring_label": [3.6272, 0.18, 6.9624], "ring_line_end": [3.5633, 0.12, 6.6818]}, {"name": "G Ring", "type": "Diffuse outer ring", "theme": "ring", "description": "A faint dusty ring farther out from the main rings, supplied by small source bodies and impact-generated material.", "ring_region": "Outer diffuse ring", "ring_radius_km": "~166,000-175,000 km from Saturn's center", "ring_anchor": [5.7907, 0.0, 5.592], "ring_label": [5.9227, 0.18, 5.8029], "ring_line_end": [5.8776, 0.12, 5.6759]}, {"name": "E Ring", "type": "Broad icy ring", "theme": "ring", "description": "A very broad outer ring dominated by fine icy grains, strongly replenished by plumes from Enceladus.", "ring_region": "Broad outer ring sourced by Enceladus", "ring_radius_km": "~180,000-480,000 km from Saturn's center", "ring_anchor": [5.7564, 0.0, 7.3679], "ring_label": [5.9654, 0.18, 7.7979], "ring_line_end": [5.8715, 0.12, 7.5153]}];
    const moonData = [{"name":"Mimas","type":"Major moon","theme":"moon","description":"A small icy inner moon of Saturn, famous for its giant Herschel crater and close relationship to ring resonances.","moon_anchor":[7.4168,0.1,3.9436],"moon_radius":0.075,"moon_label_lift":0.22,"moon_color":"#bdb7ae","mean_radius_km":"198 km","orbit_distance_km":"~185,500 km","texture_source_url":null},{"name":"Enceladus","type":"Major moon","theme":"moon","description":"An active icy moon that vents water-rich plumes from its south-polar fractures and supplies much of Saturn's E Ring.","moon_anchor":[2.9666,-0.14,9.1301],"moon_radius":0.092,"moon_label_lift":0.24,"moon_color":"#e3eef5","mean_radius_km":"252 km","orbit_distance_km":"~238,000 km","texture_source_url":null},{"name":"Tethys","type":"Major moon","theme":"moon","description":"A mid-sized icy moon with the giant Odysseus crater and Ithaca Chasma, orbiting near the outer edge of the bright main ring system.","moon_anchor":[-7.4273,0.08,8.2489],"moon_radius":0.105,"moon_label_lift":0.25,"moon_color":"#cfcfc8","mean_radius_km":"531 km","orbit_distance_km":"~295,000 km","texture_source_url":"https://www.jpl.nasa.gov/images/pia11673-map-of-tethys-august-2010/"},{"name":"Dione","type":"Major moon","theme":"moon","description":"An icy moon marked by bright wispy tectonic terrain on its trailing hemisphere and a more distant orbit beyond Tethys.","moon_anchor":[-12.8809,-0.11,-3.6935],"moon_radius":0.112,"moon_label_lift":0.25,"moon_color":"#c9c4bc","mean_radius_km":"561 km","orbit_distance_km":"~377,000 km","texture_source_url":null},{"name":"Rhea","type":"Major moon","theme":"moon","description":"Saturn's second-largest moon, a heavily cratered icy world orbiting well beyond the main rings.","moon_anchor":[-8.9026,0.16,-14.2472],"moon_radius":0.128,"moon_label_lift":0.28,"moon_color":"#b6b0aa","mean_radius_km":"764 km","orbit_distance_km":"~527,000 km","texture_source_url":null},{"name":"Titan","type":"Major moon","theme":"moon","description":"Saturn's largest moon, wrapped in a dense nitrogen atmosphere and large enough to dominate the outer moon system visually.","moon_anchor":[16.0591,-0.22,-17.8355],"moon_radius":0.185,"moon_label_lift":0.34,"moon_color":"#d8b27a","mean_radius_km":"2,575 km","orbit_distance_km":"~1,221,900 km","texture_source_url":null},{"name":"Iapetus","type":"Major moon","theme":"moon","description":"A distant two-toned moon of Saturn known for its stark dark-leading hemisphere, bright trailing terrain, and prominent equatorial ridge.","moon_anchor":[29.2063,0.24,11.8001],"moon_radius":0.118,"moon_label_lift":0.3,"moon_color":"#cbbda9","mean_radius_km":"735 km","orbit_distance_km":"~3,560,800 km","texture_source_url":null},{"name":"Pan","type":"Minor moon","theme":"moon","description":"A small walnut-shaped moon orbiting within the Encke Gap of the A Ring, carving and maintaining the gap through its gravitational influence on surrounding ring material.","moon_anchor":[5.0154,0.0,5.0154],"moon_radius":0.014,"moon_label_lift":0.12,"moon_color":"#c8c0b4","mean_radius_km":"~14 km","orbit_distance_km":"~133,600 km","texture_source_url":null},{"name":"Daphnis","type":"Minor moon","theme":"moon","description":"A tiny moon embedded in the Keeler Gap whose gravity raises prominent wave-like undulations in the edges of the surrounding A Ring.","moon_anchor":[-0.3793,0.0,7.2379],"moon_radius":0.012,"moon_label_lift":0.12,"moon_color":"#b8b0a4","mean_radius_km":"~4 km","orbit_distance_km":"~136,500 km","texture_source_url":null},{"name":"Atlas","type":"Minor moon","theme":"moon","description":"A small disc-shaped moon just outside the A Ring's outer edge, acting as a weak shepherd for the ring's outer boundary.","moon_anchor":[-5.7614,0.0,4.5014],"moon_radius":0.013,"moon_label_lift":0.12,"moon_color":"#c0b8ac","mean_radius_km":"~15 km","orbit_distance_km":"~137,700 km","texture_source_url":null},{"name":"Prometheus","type":"Minor moon","theme":"moon","description":"An elongated inner shepherd moon that gravitationally sculpts the inner edge of the F Ring, producing chaotic kinks and strand-like structures.","moon_anchor":[-6.9552,0.0,-2.5316],"moon_radius":0.016,"moon_label_lift":0.13,"moon_color":"#c4bcb0","mean_radius_km":"~43 km","orbit_distance_km":"~139,400 km","texture_source_url":null},{"name":"Pandora","type":"Minor moon","theme":"moon","description":"The outer F Ring shepherd moon, working with Prometheus to confine the narrow ring through competing gravitational perturbations.","moon_anchor":[-1.9473,0.0,-7.2674],"moon_radius":0.015,"moon_label_lift":0.13,"moon_color":"#c0b8ac","mean_radius_km":"~40 km","orbit_distance_km":"~141,700 km","texture_source_url":null},{"name":"Epimetheus","type":"Minor moon","theme":"moon","description":"A co-orbital moon sharing nearly the same orbit as Janus; every four years the two approach and swap orbits instead of colliding.","moon_anchor":[4.9492,0.02,-6.3346],"moon_radius":0.022,"moon_label_lift":0.14,"moon_color":"#b0a898","mean_radius_km":"~59 km","orbit_distance_km":"~151,400 km","texture_source_url":null},{"name":"Janus","type":"Minor moon","theme":"moon","description":"The larger of a co-orbital pair with Epimetheus; the two bodies share essentially the same orbit and periodically exchange positions.","moon_anchor":[-7.5590,0.02,2.7512],"moon_radius":0.034,"moon_label_lift":0.15,"moon_color":"#b4ac9c","mean_radius_km":"~90 km","orbit_distance_km":"~151,500 km","texture_source_url":null},{"name":"Aegaeon","type":"Minor moon","theme":"moon","description":"A tiny moonlet embedded within the G Ring arc, maintained near its position by a resonance with Mimas.","moon_anchor":[7.4638,0.01,3.0156],"moon_radius":0.012,"moon_label_lift":0.12,"moon_color":"#c8d0d4","mean_radius_km":"~0.5 km","orbit_distance_km":"~167,500 km","texture_source_url":null},{"name":"Methone","type":"Minor moon","theme":"moon","description":"A small, remarkably smooth egg-shaped moonlet in the E Ring region notable for its near-total lack of craters and seemingly plastic, yield-stress surface.","moon_anchor":[4.6621,0.01,7.179],"moon_radius":0.012,"moon_label_lift":0.12,"moon_color":"#dde8ec","mean_radius_km":"~1.5 km","orbit_distance_km":"~194,200 km","texture_source_url":null},{"name":"Anthe","type":"Minor moon","theme":"moon","description":"One of the smallest known Saturnian moons, orbiting in a ring arc maintained by a 10:11 resonance with Mimas.","moon_anchor":[-3.5223,0.01,7.9113],"moon_radius":0.012,"moon_label_lift":0.12,"moon_color":"#d4dce0","mean_radius_km":"~0.5 km","orbit_distance_km":"~197,700 km","texture_source_url":null},{"name":"Pallene","type":"Minor moon","theme":"moon","description":"A small moonlet between Mimas and Enceladus associated with a faint dust ring, kept near its orbit by resonant interactions with Enceladus.","moon_anchor":[-8.7845,0.01,1.5489],"moon_radius":0.012,"moon_label_lift":0.12,"moon_color":"#d8e0e4","mean_radius_km":"~2 km","orbit_distance_km":"~212,300 km","texture_source_url":null},{"name":"Telesto","type":"Minor moon","theme":"moon","description":"A Tethys trojan moon librating around the L4 Lagrange point 60° ahead of Tethys in its orbit, co-orbiting stably.","moon_anchor":[-10.8574,0.09,-2.3078],"moon_radius":0.012,"moon_label_lift":0.12,"moon_color":"#e0ddd8","mean_radius_km":"~12 km","orbit_distance_km":"~294,700 km","texture_source_url":null},{"name":"Calypso","type":"Minor moon","theme":"moon","description":"A Tethys trojan moon at the L5 Lagrange point 60° behind Tethys, sharing its orbit and librating around the trailing equilibrium.","moon_anchor":[3.4301,0.07,10.5567],"moon_radius":0.012,"moon_label_lift":0.12,"moon_color":"#ddd8d0","mean_radius_km":"~9 km","orbit_distance_km":"~294,700 km","texture_source_url":null},{"name":"Helene","type":"Minor moon","theme":"moon","description":"Dione's leading Lagrange trojan, orbiting stably at L4 with a smooth, lightly cratered surface sculpted by mass-wasting of loose surface material.","moon_anchor":[-3.2418,-0.1,-13.002],"moon_radius":0.012,"moon_label_lift":0.12,"moon_color":"#d4cfc8","mean_radius_km":"~18 km","orbit_distance_km":"~377,400 km","texture_source_url":null},{"name":"Polydeuces","type":"Minor moon","theme":"moon","description":"A tiny trailing Lagrange trojan of Dione at L5, notable for its unusually large libration amplitude that carries it well away from the equilibrium point.","moon_anchor":[-9.6392,-0.12,9.3084],"moon_radius":0.012,"moon_label_lift":0.12,"moon_color":"#c8c4bc","mean_radius_km":"~1 km","orbit_distance_km":"~377,400 km","texture_source_url":null},{"name":"Hyperion","type":"Minor moon","theme":"moon","description":"An unusually shaped sponge-textured moon with chaotic tumbling rotation, orbiting in a 4:3 mean-motion resonance with Titan and showing a heavily pitted surface.","moon_anchor":[-24.289,0.12,-11.3262],"moon_radius":0.051,"moon_label_lift":0.18,"moon_color":"#b8a88c","mean_radius_km":"~135 km","orbit_distance_km":"~1,481,100 km","texture_source_url":null},{"name":"Phoebe","type":"Minor moon","theme":"moon","description":"A dark, heavily cratered irregular moon in a distant retrograde orbit, widely regarded as a captured Kuiper Belt object and the source of material forming Saturn's vast Phoebe ring.","moon_anchor":[36.8022,-1.8,-40.873],"moon_radius":0.04,"moon_label_lift":0.18,"moon_color":"#52504c","mean_radius_km":"~106 km","orbit_distance_km":"~12,944,300 km (retrograde)","texture_source_url":null}];
    const SATURN_EQUATORIAL_RADIUS_KM = 60268;
    const SATURN_SCENE_RADIUS = 3.2;
    const SATURN_KM_TO_SCENE = SATURN_SCENE_RADIUS / SATURN_EQUATORIAL_RADIUS_KM;
    const SATURN_EXPOSED_INTERIOR_RFRAC = 0.58;
    const SATURN_RING_REFERENCE_KM = {
      dInner: 66900,
      cInner: 74500,
      bInner: 92000,
      cassiniInner: 117580,
      aInner: 122170,
      enckeCenter: 133584,
      keelerCenter: 136505,
      aOuter: 136780,
      fRing: 140220,
      mainOuter: 143000,
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
        const radiusScene = radiusKm * SATURN_KM_TO_SCENE;
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
        const radiusScene = orbitKm * SATURN_KM_TO_SCENE;
        moon.moon_anchor = [
          Number((Math.cos(theta) * radiusScene).toFixed(4)),
          y,
          Number((Math.sin(theta) * radiusScene).toFixed(4)),
        ];
      }
    }
    georeferenceRingAndInnerMoonAnchors();

    const moonFeatureData = [{"name": "Herschel Crater","type": "Impact crater","theme": "moon","moon_name": "Mimas","lat": -1.4,"lon": 248.2,"description": "The dominant giant crater on Mimas, spanning a large fraction of the moon's diameter.","dimension": "~130 km diameter"},{"name": "Mimas Leading Hemisphere","type": "Representative terrain sector","theme": "moon","moon_name": "Mimas","lat": 0.0,"lon": 270.0,"description": "Representative cratered terrain on Mimas's leading hemisphere, useful as a reference location away from Herschel.","interpretation": "Heavily cratered icy terrain"},{"name": "Damascus Sulcus","type": "Tiger stripe fracture","theme": "moon","moon_name": "Enceladus","lat": -80.6,"lon": 74.1,"description": "One of Enceladus's south-polar tiger stripes, associated with active venting and thermal anomalies.","dimension": "South-polar fracture system"},{"name": "Baghdad Sulcus","type": "Tiger stripe fracture","theme": "moon","moon_name": "Enceladus","lat": -86.9,"lon": 129.5,"description": "One of Enceladus's best-known tiger stripe fractures, associated with warm active fissures and plume fallout.","dimension": "South-polar fracture system"},{"name": "Cairo Sulcus","type": "Tiger stripe fracture","theme": "moon","moon_name": "Enceladus","lat": -81.6,"lon": 205.5,"description": "A major south-polar fracture on Enceladus, part of the active tectonic terrain feeding plume activity.","dimension": "South-polar fracture system"},{"name": "South Polar Plume Source Region","type": "Cryovolcanic source region","theme": "moon","moon_name": "Enceladus","lat": -90.0,"lon": 0.0,"description": "Representative south-polar source area for the water-rich plumes feeding Saturn's E Ring.","origin": "Cryovolcanic vent complex"},{"name": "Odysseus Crater","type": "Impact basin","theme": "moon","moon_name": "Tethys","lat": 32.8,"lon": 51.1,"description": "Tethys's enormous impact basin, one of the most prominent features on the moon.","dimension": "~400 km diameter"},{"name": "Ithaca Chasma","type": "Tectonic canyon","theme": "moon","moon_name": "Tethys","lat": -14.0,"lon": 173.9,"description": "A giant canyon system cutting across much of Tethys, likely tied to global tectonic stress.","dimension": "Planet-scale chasma"},{"name": "Telemachus Crater","type": "Impact crater","theme": "moon","moon_name": "Tethys","lat": 54.0,"lon": 200.6,"description": "A notable crater on Tethys used as a representative landmark within its densely cratered bright terrain.","dimension": "~100 km-class crater"},{"name": "Penelope Crater","type": "Impact crater","theme": "moon","moon_name": "Tethys","lat": -10.2,"lon": 288.9,"description": "A large impact crater on Tethys's trailing hemisphere, a prominent feature of the heavily cratered icy terrain.","dimension": "~200 km-class crater"},{"name": "Ajax Crater","type": "Impact crater","theme": "moon","moon_name": "Tethys","lat": -28.6,"lon": 256.93,"description": "A large crater on Tethys representing the heavily cratered surface typical of the outer ice moon.","dimension": "~100 km-class crater"},{"name": "Polyphemus Crater","type": "Impact crater","theme": "moon","moon_name": "Tethys","lat": -4.21,"lon": 257.43,"description": "A large impact crater on Tethys's trailing hemisphere.","dimension": "~100 km-class crater"},{"name": "Phemius Crater","type": "Impact crater","theme": "moon","moon_name": "Tethys","lat": 11.17,"lon": 253.48,"description": "An impact crater on Tethys's trailing hemisphere.","dimension": "~100 km-class crater"},{"name": "Antinous Crater","type": "Impact crater","theme": "moon","moon_name": "Tethys","lat": -60.83,"lon": 253.75,"description": "A southern hemisphere impact crater on Tethys.","dimension": "~100 km-class crater"},{"name": "Wispy Terrain","type": "Bright tectonic terrain","theme": "moon","moon_name": "Dione","lat": -2.0,"lon": 45.0,"description": "Dione's bright fractured trailing-hemisphere terrain made of tectonic scarps and ice-bright cliffs.","interpretation": "Tectonic resurfacing"},{"name": "Aufidus Catena","type": "Catena","theme": "moon","moon_name": "Dione","lat": -78.0,"lon": 64,"description": "A crater chain on Dione's southern hemisphere."},{"name": "Pactolus Catena","type": "Catena","theme": "moon","moon_name": "Dione","lat": 8.79,"lon": 32.85,"description": "A crater chain on Dione near the equator."},{"name": "Pantagias Catenae","type": "Catena","theme": "moon","moon_name": "Dione","lat": -15.3,"lon": 218.3,"description": "A crater chain in Dione's southern hemisphere."},{"name": "Aurunca Chasmata","type": "Chasma","theme": "moon","moon_name": "Dione","lat": 11.56,"lon": 93.3,"description": "A tectonic chasma system on Dione."},{"name": "Drepanum Chasma","type": "Chasma","theme": "moon","moon_name": "Dione","lat": 46.0,"lon": 95,"description": "A northern hemisphere chasma on Dione."},{"name": "Eurotas Chasmata","type": "Chasma","theme": "moon","moon_name": "Dione","lat": 4.94,"lon": 90.0,"description": "An equatorial chasma on Dione."},{"name": "Larissa Chasma","type": "Chasma","theme": "moon","moon_name": "Dione","lat": 28.98,"lon": 290.5,"description": "A tectonic chasma on Dione's leading hemisphere."},{"name": "Latium Chasma","type": "Chasma","theme": "moon","moon_name": "Dione","lat": 20.0,"lon": 296.07,"description": "A chasma on Dione's leading hemisphere."},{"name": "Padua Chasmata","type": "Chasma","theme": "moon","moon_name": "Dione","lat": 17.7,"lon": 112.83,"description": "A major tectonic fracture belt on Dione, part of the moon's global network of chasmata.","dimension": "Regional fracture system"},{"name": "Palatine Chasmata","type": "Chasma","theme": "moon","moon_name": "Dione","lat": -48.0,"lon": 44,"description": "A southern hemisphere chasma on Dione."},{"name": "Tibur Chasma","type": "Chasma","theme": "moon","moon_name": "Dione","lat": 60.0,"lon": 290.7,"description": "A northern high-latitude chasma on Dione."},{"name": "Janiculum Dorsa","type": "Dorsum","theme": "moon","moon_name": "Dione","lat": 24.6,"lon": 215.9,"description": "A ridge system on Dione's trailing hemisphere."},{"name": "Argiletum Fossae","type": "Fossa","theme": "moon","moon_name": "Dione","lat": 65.18,"lon": 327.9,"description": "A high-latitude fossa system on Dione."},{"name": "Arpi Fossae","type": "Fossa","theme": "moon","moon_name": "Dione","lat": 47.47,"lon": 229.2,"description": "A fossa system on Dione's trailing hemisphere."},{"name": "Carthage Fossae","type": "Fossa","theme": "moon","moon_name": "Dione","lat": 11.93,"lon": 23.83,"description": "An equatorial fossa on Dione's leading hemisphere."},{"name": "Clusium Fossae","type": "Fossa","theme": "moon","moon_name": "Dione","lat": 39.27,"lon": 58.46,"description": "A mid-latitude fossa on Dione."},{"name": "Fidena Fossae","type": "Fossa","theme": "moon","moon_name": "Dione","lat": 0.66,"lon": 264,"description": "An equatorial fossa on Dione."},{"name": "Helorus Fossa","type": "Fossa","theme": "moon","moon_name": "Dione","lat": -31.84,"lon": 283.52,"description": "A southern hemisphere fossa on Dione."},{"name": "Himella Fossa","type": "Fossa","theme": "moon","moon_name": "Dione","lat": -45.6,"lon": 23.45,"description": "A southern fossa on Dione's leading hemisphere."},{"name": "Petelia Fossae","type": "Fossa","theme": "moon","moon_name": "Dione","lat": -8.16,"lon": 277.57,"description": "An equatorial fossa on Dione."},{"name": "Acestes Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 50.1,"lon": 116.63,"description": "Impact crater on Dione."},{"name": "Adrastus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -61.66,"lon": 313.43,"description": "Impact crater on Dione."},{"name": "Aeneas Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 25.89,"lon": 313.73,"description": "Impact crater on Dione."},{"name": "Alcander Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -52.89,"lon": 64.51,"description": "Impact crater on Dione."},{"name": "Allecto Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -7.73,"lon": 135.44,"description": "Impact crater on Dione."},{"name": "Amastrus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -9.96,"lon": 122.97,"description": "Impact crater on Dione."},{"name": "Amata Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 5.17,"lon": 80.19,"description": "Impact crater on Dione."},{"name": "Amycus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -37.52,"lon": 271.38,"description": "Impact crater on Dione."},{"name": "Anchises Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -34.0,"lon": 295.0,"description": "Impact crater on Dione."},{"name": "Anna Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -63.38,"lon": 270.04,"description": "Impact crater on Dione."},{"name": "Antenor Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -7.0,"lon": 348.46,"description": "Impact crater on Dione."},{"name": "Ascanius Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 33.43,"lon": 127.82,"description": "Impact crater on Dione."},{"name": "Assaracus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 32.65,"lon": 351.21,"description": "Impact crater on Dione."},{"name": "Aulestes Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 9.9,"lon": 212.27,"description": "Impact crater on Dione."},{"name": "Butes Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 65.72,"lon": 313.6,"description": "Impact crater on Dione."},{"name": "Caieta Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -24.71,"lon": 280.37,"description": "Impact crater on Dione."},{"name": "Camilla Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -4.36,"lon": 299.39,"description": "Impact crater on Dione."},{"name": "Cassandra Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -39.84,"lon": 113.78,"description": "Impact crater on Dione."},{"name": "Catillus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -2.38,"lon": 84.7,"description": "Impact crater on Dione."},{"name": "Coras Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 0.39,"lon": 91.55,"description": "Impact crater on Dione."},{"name": "Cretheus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -43.35,"lon": 271.47,"description": "Impact crater on Dione."},{"name": "Creusa Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 49.19,"lon": 283.68,"description": "Impact crater on Dione."},{"name": "Daucus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -15.38,"lon": 58.86,"description": "Impact crater on Dione."},{"name": "Dercennus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 29.75,"lon": 80.07,"description": "Impact crater on Dione."},{"name": "Dido Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -23.97,"lon": 341.18,"description": "Impact crater on Dione."},{"name": "Entellus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -10.93,"lon": 149.46,"description": "Impact crater on Dione."},{"name": "Erulus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -35.0,"lon": 255.24,"description": "Impact crater on Dione."},{"name": "Eumelus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -0.1,"lon": 294.04,"description": "Impact crater on Dione."},{"name": "Euryalus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -74.36,"lon": 0.0,"description": "Impact crater on Dione."},{"name": "Evander Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -57.0,"lon": 215.0,"description": "Impact crater on Dione."},{"name": "Fadus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -35.94,"lon": 134.82,"description": "Impact crater on Dione."},{"name": "Galaesus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 46.77,"lon": 63.75,"description": "Impact crater on Dione."},{"name": "Haemon Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 84.33,"lon": 83.69,"description": "Impact crater on Dione."},{"name": "Halys Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -59.17,"lon": 306.28,"description": "Impact crater on Dione."},{"name": "Herbesus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 34.68,"lon": 203.89,"description": "Impact crater on Dione."},{"name": "Iasus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -22.13,"lon": 114.08,"description": "Impact crater on Dione."},{"name": "Ilia Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -0.5,"lon": 13.73,"description": "Impact crater on Dione."},{"name": "Italus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -18.47,"lon": 283.59,"description": "Impact crater on Dione."},{"name": "Lagus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -13.56,"lon": 257.05,"description": "Impact crater on Dione."},{"name": "Lamyrus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 53.67,"lon": 104.39,"description": "Impact crater on Dione."},{"name": "Larides Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 7.17,"lon": 48.58,"description": "Impact crater on Dione."},{"name": "Latagus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 14.65,"lon": 333.54,"description": "Impact crater on Dione."},{"name": "Latinus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 52.19,"lon": 159.0,"description": "Impact crater on Dione."},{"name": "Lausus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 34.81,"lon": 337.24,"description": "Impact crater on Dione."},{"name": "Liger Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 24.0,"lon": 233.37,"description": "Impact crater on Dione."},{"name": "Lucagus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 22.15,"lon": 228.75,"description": "Impact crater on Dione."},{"name": "Magus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 18.44,"lon": 335.65,"description": "Impact crater on Dione."},{"name": "Massicus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -35.0,"lon": 304.61,"description": "Impact crater on Dione."},{"name": "Metiscus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 6.0,"lon": 266.71,"description": "Impact crater on Dione."},{"name": "Mezentius Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 19.16,"lon": 177.0,"description": "Impact crater on Dione."},{"name": "Murranus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 12.82,"lon": 269.27,"description": "Impact crater on Dione."},{"name": "Nisus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -68.18,"lon": 25.0,"description": "Impact crater on Dione."},{"name": "Oebalus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 44.47,"lon": 8.4,"description": "Impact crater on Dione."},{"name": "Pagasus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -3.0,"lon": 119.0,"description": "Impact crater on Dione."},{"name": "Palinurus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -3.3,"lon": 297.0,"description": "Impact crater on Dione."},{"name": "Phaleris Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -77.4,"lon": 193.42,"description": "Impact crater on Dione."},{"name": "Phorbas Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 81.2,"lon": 228.71,"description": "Impact crater on Dione."},{"name": "Prytanis Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -46.25,"lon": 72.6,"description": "Impact crater on Dione."},{"name": "Remus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -13.58,"lon": 328.1,"description": "Impact crater on Dione."},{"name": "Ripheus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -56.47,"lon": 323.2,"description": "Impact crater on Dione."},{"name": "Romulus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -8.15,"lon": 333.15,"description": "Impact crater on Dione."},{"name": "Sabinus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -43.65,"lon": 173.34,"description": "Impact crater on Dione."},{"name": "Sagaris Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 4.93,"lon": 255.8,"description": "Impact crater on Dione."},{"name": "Salius Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 65.09,"lon": 178.27,"description": "Impact crater on Dione."},{"name": "Silvius Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -32.7,"lon": 27.74,"description": "Impact crater on Dione."},{"name": "Sulmo Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 55.92,"lon": 26.5,"description": "Impact crater on Dione."},{"name": "Telon Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -16.2,"lon": 262.8,"description": "Impact crater on Dione."},{"name": "Tereus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -2.6,"lon": 115.0,"description": "Impact crater on Dione."},{"name": "Thymber Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 14.0,"lon": 50.85,"description": "Impact crater on Dione."},{"name": "Tiburtus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 29.11,"lon": 170.27,"description": "Impact crater on Dione."},{"name": "Turnus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 15.59,"lon": 14.69,"description": "Impact crater on Dione."},{"name": "Tyrrhus Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": 24.7,"lon": 72.1,"description": "Impact crater on Dione."},{"name": "Volcens Crater","type": "Impact crater","theme": "moon","moon_name": "Dione","lat": -13.84,"lon": 91.49,"description": "Impact crater on Dione."},{"name": "Koykamou Catena","type": "Catena","theme": "moon","moon_name": "Rhea","lat": -70.0,"lon": 116.0,"description": "A crater chain on Rhea."},{"name": "Mouru Catena","type": "Catena","theme": "moon","moon_name": "Rhea","lat": 48.5,"lon": 16.5,"description": "A crater chain on Rhea."},{"name": "Onokoro Catenae","type": "Catena","theme": "moon","moon_name": "Rhea","lat": -44.7,"lon": 31.5,"description": "A crater chain on Rhea."},{"name": "Puchou Catenae","type": "Catena","theme": "moon","moon_name": "Rhea","lat": 32.0,"lon": 273.0,"description": "A crater chain on Rhea."},{"name": "Thebeksan Catena","type": "Catena","theme": "moon","moon_name": "Rhea","lat": -39.5,"lon": 186.0,"description": "A crater chain on Rhea."},{"name": "Wungaran Catenae","type": "Catena","theme": "moon","moon_name": "Rhea","lat": 22.5,"lon": 281.0,"description": "A crater chain on Rhea."},{"name": "Harahvaiti Fossa","type": "Fossa","theme": "moon","moon_name": "Rhea","lat": -36.0,"lon": 189.0,"description": "A fossa on Rhea."},{"name": "Parun Fossa","type": "Fossa","theme": "moon","moon_name": "Rhea","lat": -46.5,"lon": 208.0,"description": "A fossa on Rhea."},{"name": "Kirinyaga Linea","type": "Linea","theme": "moon","moon_name": "Rhea","lat": -1.8,"lon": 231.2,"description": "A linea on Rhea."},{"name": "Kunlun Linea","type": "Linea","theme": "moon","moon_name": "Rhea","lat": 45.0,"lon": 52.0,"description": "A linea on Rhea."},{"name": "Aananin Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 34.9,"lon": 20.1,"description": "Impact crater on Rhea."},{"name": "Abassi Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -21.3,"lon": 213.5,"description": "Impact crater on Rhea."},{"name": "Adjua Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 40.2,"lon": 241.1,"description": "Impact crater on Rhea."},{"name": "Agunua Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 63.3,"lon": 293.8,"description": "Impact crater on Rhea."},{"name": "Ameta Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 53.3,"lon": 338.1,"description": "Impact crater on Rhea."},{"name": "Anguta Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 25.7,"lon": 170.0,"description": "Impact crater on Rhea."},{"name": "Arunaka Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -15.3,"lon": 337.9,"description": "Impact crater on Rhea."},{"name": "Atum Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -47.1,"lon": 358.9,"description": "Impact crater on Rhea."},{"name": "Awonawilona Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -37.3,"lon": 209.7,"description": "Impact crater on Rhea."},{"name": "Bulagat Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -38.2,"lon": 344.8,"description": "Impact crater on Rhea."},{"name": "Bumba Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 63.1,"lon": 309.6,"description": "Impact crater on Rhea."},{"name": "Burkhan Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 66.8,"lon": 49.4,"description": "Impact crater on Rhea."},{"name": "Chingaso Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -17.1,"lon": 254.0,"description": "Impact crater on Rhea."},{"name": "Con Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -25.8,"lon": 347.3,"description": "Impact crater on Rhea."},{"name": "Dangun Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 7.2,"lon": 152.0,"description": "Impact crater on Rhea."},{"name": "Djuli Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -31.2,"lon": 313.3,"description": "Impact crater on Rhea."},{"name": "Dohitt Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -18.0,"lon": 285.9,"description": "Impact crater on Rhea."},{"name": "Ellyay Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 71.4,"lon": 268.2,"description": "Impact crater on Rhea."},{"name": "Faro Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 45.3,"lon": 246.0,"description": "Impact crater on Rhea."},{"name": "Fatu Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 7.7,"lon": 183.9,"description": "Impact crater on Rhea."},{"name": "Gborogboro Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -12.7,"lon": 197.8,"description": "Impact crater on Rhea."},{"name": "Gmerti Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -52.0,"lon": 167.4,"description": "Impact crater on Rhea."},{"name": "Gucumatz Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 37.0,"lon": 184.2,"description": "Impact crater on Rhea."},{"name": "Haik Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -36.6,"lon": 330.7,"description": "Impact crater on Rhea."},{"name": "Haoso Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 8.3,"lon": 347.5,"description": "Impact crater on Rhea."},{"name": "Heller Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 10.1,"lon": 44.9,"description": "Impact crater on Rhea."},{"name": "Huracan Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 53.2,"lon": 171.5,"description": "Impact crater on Rhea."},{"name": "Imberombera Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -33.3,"lon": 143.3,"description": "Impact crater on Rhea."},{"name": "Inktomi Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -14.1,"lon": 247.9,"description": "Impact crater on Rhea."},{"name": "Inmar Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -2.3,"lon": 58.4,"description": "Impact crater on Rhea."},{"name": "Iraca Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 39.4,"lon": 247.9,"description": "Impact crater on Rhea."},{"name": "Izanagi Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -49.4,"lon": 49.8,"description": "Impact crater on Rhea."},{"name": "Izanami Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -46.3,"lon": 46.6,"description": "Impact crater on Rhea."},{"name": "Jumo Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 52.8,"lon": 293.5,"description": "Impact crater on Rhea."},{"name": "Karora Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 5.9,"lon": 339.9,"description": "Impact crater on Rhea."},{"name": "Khado Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 41.6,"lon": 0.9,"description": "Impact crater on Rhea."},{"name": "Kiho Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -11.1,"lon": 1.3,"description": "Impact crater on Rhea."},{"name": "Kuksu Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 25.3,"lon": 71.3,"description": "Impact crater on Rhea."},{"name": "Kuma Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 10.0,"lon": 82.8,"description": "Impact crater on Rhea."},{"name": "Kumpara Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 9.6,"lon": 32.9,"description": "Impact crater on Rhea."},{"name": "Leza Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -21.8,"lon": 50.8,"description": "Impact crater on Rhea."},{"name": "Lowa Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 40.9,"lon": 343.4,"description": "Impact crater on Rhea."},{"name": "Luli Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 46.5,"lon": 116.9,"description": "Impact crater on Rhea."},{"name": "Madumda Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -36.9,"lon": 295.2,"description": "Impact crater on Rhea."},{"name": "Maheo Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 31.6,"lon": 78.3,"description": "Impact crater on Rhea."},{"name": "Malunga Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 65.1,"lon": 303.8,"description": "Impact crater on Rhea."},{"name": "Mamaldi Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 14.0,"lon": 176.0,"description": "Impact crater on Rhea."},{"name": "Manoid Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 29.5,"lon": 351.5,"description": "Impact crater on Rhea."},{"name": "Melo Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -53.2,"lon": 352.9,"description": "Impact crater on Rhea."},{"name": "Mubai Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 55.8,"lon": 339.8,"description": "Impact crater on Rhea."},{"name": "Napi Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 26.9,"lon": 185.2,"description": "Impact crater on Rhea."},{"name": "Nishanu Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -9.0,"lon": 231.0,"description": "Impact crater on Rhea."},{"name": "Num Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 24.0,"lon": 267.3,"description": "Impact crater on Rhea."},{"name": "Nzame Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 9.0,"lon": 335.1,"description": "Impact crater on Rhea."},{"name": "Obatala Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -1.1,"lon": 90.3,"description": "Impact crater on Rhea."},{"name": "Olorun Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 24.7,"lon": 204.6,"description": "Impact crater on Rhea."},{"name": "Ormazd Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 52.5,"lon": 301.5,"description": "Impact crater on Rhea."},{"name": "Pachacamac Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -23.4,"lon": 276.3,"description": "Impact crater on Rhea."},{"name": "Pan Ku Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 65.7,"lon": 252.3,"description": "Impact crater on Rhea."},{"name": "Pedn Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 46.0,"lon": 8.3,"description": "Impact crater on Rhea."},{"name": "Pokoh Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -71.7,"lon": 33.6,"description": "Impact crater on Rhea."},{"name": "Pouliuli Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -16.9,"lon": 75.6,"description": "Impact crater on Rhea."},{"name": "Powehiwehi Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -8.2,"lon": 79.6,"description": "Impact crater on Rhea."},{"name": "Puntan Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 33.9,"lon": 67.6,"description": "Impact crater on Rhea."},{"name": "Qat Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -23.8,"lon": 8.4,"description": "Impact crater on Rhea."},{"name": "Samni Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -47.7,"lon": 269.3,"description": "Impact crater on Rhea."},{"name": "Seveki Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 12.9,"lon": 195.3,"description": "Impact crater on Rhea."},{"name": "Shedi Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -53.5,"lon": 13.2,"description": "Impact crater on Rhea."},{"name": "Sholmo Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 12.0,"lon": 13.6,"description": "Impact crater on Rhea."},{"name": "Taaroa Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 16.5,"lon": 264.5,"description": "Impact crater on Rhea."},{"name": "Tane Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -12.5,"lon": 302.6,"description": "Impact crater on Rhea."},{"name": "Tawa Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 17.9,"lon": 184.8,"description": "Impact crater on Rhea."},{"name": "Thunupa Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 45.6,"lon": 338.7,"description": "Impact crater on Rhea."},{"name": "Tika Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 25.1,"lon": 275.9,"description": "Impact crater on Rhea."},{"name": "Tirawa Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 34.2,"lon": 208.3,"description": "Impact crater on Rhea."},{"name": "Tore Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 0.0,"lon": 24.4,"description": "Impact crater on Rhea."},{"name": "Torom Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -68.1,"lon": 16.5,"description": "Impact crater on Rhea."},{"name": "Tsuki-Yomi Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 35.0,"lon": 316.2,"description": "Impact crater on Rhea."},{"name": "Tuwale Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -78.0,"lon": 117.6,"description": "Impact crater on Rhea."},{"name": "Uku Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 78.7,"lon": 264.5,"description": "Impact crater on Rhea."},{"name": "Wakonda Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 48.6,"lon": 90.3,"description": "Impact crater on Rhea."},{"name": "Wende Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -56.3,"lon": 133.6,"description": "Impact crater on Rhea."},{"name": "Whanin Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 66.9,"lon": 245.0,"description": "Impact crater on Rhea."},{"name": "Wuraka Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 25.1,"lon": 356.0,"description": "Impact crater on Rhea."},{"name": "Woyengi Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 13.7,"lon": 65.5,"description": "Impact crater on Rhea."},{"name": "Wulbari Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 67.0,"lon": 271.1,"description": "Impact crater on Rhea."},{"name": "Xamba Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 2.1,"lon": 10.3,"description": "Impact crater on Rhea."},{"name": "Xowalaci Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 2.4,"lon": 303.7,"description": "Impact crater on Rhea."},{"name": "Xu Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 55.0,"lon": 288.1,"description": "Impact crater on Rhea."},{"name": "Yu-Ti Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": 50.1,"lon": 278.5,"description": "Impact crater on Rhea."},{"name": "Zicum Crater","type": "Impact crater","theme": "moon","moon_name": "Rhea","lat": -50.9,"lon": 248.8,"description": "Impact crater on Rhea."},{"name": "Adiri","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": -10.0,"lon": 330.0,"description": "Albedo feature on Titan."},{"name": "Dilmun","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": 15.0,"lon": 5.0,"description": "Albedo feature on Titan."},{"name": "Quivira","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": 0.0,"lon": 165.0,"description": "Albedo feature on Titan."},{"name": "Tsegihi","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": -40.0,"lon": 170.0,"description": "Albedo feature on Titan."},{"name": "Xanadu","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": -15.0,"lon": 80.0,"description": "Albedo feature on Titan."},{"name": "Aaru","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": 10.0,"lon": 200.0,"description": "Albedo feature on Titan."},{"name": "Aztlan","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": -10.0,"lon": 160.0,"description": "Albedo feature on Titan."},{"name": "Belet","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": -5.0,"lon": 285.0,"description": "Albedo feature on Titan."},{"name": "Ching-tu","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": -30.0,"lon": 335.0,"description": "Albedo feature on Titan."},{"name": "Fensal","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": 5.0,"lon": 150.0,"description": "Albedo feature on Titan."},{"name": "Mezzoramia","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": -70.0,"lon": 180.0,"description": "Albedo feature on Titan."},{"name": "Senkyo","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": -5.0,"lon": 220.0,"description": "Albedo feature on Titan."},{"name": "Shangri-La","type": "Albedo feature","theme": "moon","moon_name": "Titan","lat": -10.0,"lon": 15.0,"description": "Albedo feature on Titan."},{"name": "Hotei Arcus","type": "Arcus","theme": "moon","moon_name": "Titan","lat": -28.0,"lon": 101.0,"description": "Arcus on Titan."},{"name": "Arwen Colles","type": "Collis","theme": "moon","moon_name": "Titan","lat": -7.5,"lon": 280.0,"description": "Collis on Titan."},{"name": "Bilbo Colles","type": "Collis","theme": "moon","moon_name": "Titan","lat": -4.2,"lon": 141.4,"description": "Collis on Titan."},{"name": "Faramir Colles","type": "Collis","theme": "moon","moon_name": "Titan","lat": 4.0,"lon": 26.2,"description": "Collis on Titan."},{"name": "Gandalf Colles","type": "Collis","theme": "moon","moon_name": "Titan","lat": 14.6,"lon": 330.5,"description": "Collis on Titan."},{"name": "Handir Colles","type": "Collis","theme": "moon","moon_name": "Titan","lat": 10.0,"lon": 183.3,"description": "Collis on Titan."},{"name": "Nimloth Colles","type": "Collis","theme": "moon","moon_name": "Titan","lat": 11.9,"lon": 28.7,"description": "Collis on Titan."},{"name": "Afekan","type": "Impact crater","theme": "moon","moon_name": "Titan","lat": 25.8,"lon": 339.7,"description": "Impact crater on Titan."},{"name": "Beag","type": "Impact crater","theme": "moon","moon_name": "Titan","lat": -34.7,"lon": 10.4,"description": "Impact crater on Titan."},{"name": "Forseti","type": "Impact crater","theme": "moon","moon_name": "Titan","lat": 25.5,"lon": 169.6,"description": "Impact crater on Titan."},{"name": "Ksa","type": "Impact crater","theme": "moon","moon_name": "Titan","lat": 14.0,"lon": 114.6,"description": "Impact crater on Titan."},{"name": "Menrva","type": "Impact crater","theme": "moon","moon_name": "Titan","lat": 20.1,"lon": 92.8,"description": "Impact crater on Titan."},{"name": "Mystis","type": "Impact crater","theme": "moon","moon_name": "Titan","lat": 0.1,"lon": 345.1,"description": "Impact crater on Titan."},{"name": "Selk","type": "Impact crater","theme": "moon","moon_name": "Titan","lat": 7.0,"lon": 341.0,"description": "Impact crater on Titan."},{"name": "Sinlap","type": "Impact crater","theme": "moon","moon_name": "Titan","lat": 11.3,"lon": 164.0,"description": "Impact crater on Titan."},{"name": "Antilia Faculae","type": "Facula","theme": "moon","moon_name": "Titan","lat": -11.0,"lon": 353.0,"description": "Facula on Titan."},{"name": "Bazaruto Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": 11.6,"lon": 163.9,"description": "Facula on Titan."},{"name": "Coats Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": -11.1,"lon": 150.8,"description": "Facula on Titan."},{"name": "Crete Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": 9.4,"lon": 29.9,"description": "Facula on Titan."},{"name": "Elba Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": -10.8,"lon": 178.8,"description": "Facula on Titan."},{"name": "Kerguelen Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": -5.4,"lon": 29.0,"description": "Facula on Titan."},{"name": "Mindanao Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": -6.6,"lon": 5.8,"description": "Facula on Titan."},{"name": "Nicobar Faculae","type": "Facula","theme": "moon","moon_name": "Titan","lat": 2.0,"lon": 21.0,"description": "Facula on Titan."},{"name": "Oahu Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": 5.0,"lon": 13.3,"description": "Facula on Titan."},{"name": "Santorini Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": 2.4,"lon": 34.4,"description": "Facula on Titan."},{"name": "Shikoku Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": -10.4,"lon": 15.9,"description": "Facula on Titan."},{"name": "Tasmania Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": 10.41,"lon": 12.63,"description": "Facula on Titan."},{"name": "Texel Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": -11.5,"lon": 357.4,"description": "Facula on Titan."},{"name": "Tortola Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": 8.8,"lon": 36.9,"description": "Facula on Titan."},{"name": "Vis Facula","type": "Facula","theme": "moon","moon_name": "Titan","lat": 7.0,"lon": 41.6,"description": "Facula on Titan."},{"name": "Ara Fluctus","type": "Fluctus","theme": "moon","moon_name": "Titan","lat": 39.8,"lon": 61.6,"description": "Fluctus on Titan."},{"name": "Leilah Fluctus","type": "Fluctus","theme": "moon","moon_name": "Titan","lat": 50.5,"lon": 102.2,"description": "Fluctus on Titan."},{"name": "Rohe Fluctus","type": "Fluctus","theme": "moon","moon_name": "Titan","lat": 47.3,"lon": 142.25,"description": "Fluctus on Titan."},{"name": "Winia Fluctus","type": "Fluctus","theme": "moon","moon_name": "Titan","lat": 49.0,"lon": 134.0,"description": "Fluctus on Titan."},{"name": "Celadon Flumina","type": "Flumen","theme": "moon","moon_name": "Titan","lat": -73.7,"lon": 151.2,"description": "Flumen on Titan."},{"name": "Elivagar Flumina","type": "Flumen","theme": "moon","moon_name": "Titan","lat": 19.3,"lon": 101.5,"description": "Flumen on Titan."},{"name": "Hubur Flumen","type": "Flumen","theme": "moon","moon_name": "Titan","lat": -70.2,"lon": 347.1,"description": "Flumen on Titan."},{"name": "Karesos Flumen","type": "Flumen","theme": "moon","moon_name": "Titan","lat": -70.9,"lon": 345.2,"description": "Flumen on Titan."},{"name": "Kokytos Flumina","type": "Flumen","theme": "moon","moon_name": "Titan","lat": 72.71,"lon": 285.0,"description": "Flumen on Titan."},{"name": "Sambation Flumina","type": "Flumen","theme": "moon","moon_name": "Titan","lat": 87.33,"lon": 89.88,"description": "Flumen on Titan."},{"name": "Saraswati Flumen","type": "Flumen","theme": "moon","moon_name": "Titan","lat": -74.6,"lon": 346.5,"description": "Flumen on Titan."},{"name": "Vid Flumina","type": "Flumen","theme": "moon","moon_name": "Titan","lat": 72.9,"lon": 297.5,"description": "Flumen on Titan."},{"name": "Xanthus Flumen","type": "Flumen","theme": "moon","moon_name": "Titan","lat": 83.47,"lon": 297.24,"description": "Flumen on Titan."},{"name": "Bayta Fretum","type": "Fretum","theme": "moon","moon_name": "Titan","lat": 73.0,"lon": 228.8,"description": "Fretum on Titan."},{"name": "Hardin Fretum","type": "Fretum","theme": "moon","moon_name": "Titan","lat": 57.3,"lon": 222.2,"description": "Fretum on Titan."},{"name": "Seldon Fretum","type": "Fretum","theme": "moon","moon_name": "Titan","lat": 66.0,"lon": 223.4,"description": "Fretum on Titan."},{"name": "Trevize Fretum","type": "Fretum","theme": "moon","moon_name": "Titan","lat": 74.4,"lon": 270.1,"description": "Fretum on Titan."},{"name": "Bermoothes Insula","type": "Insula","theme": "moon","moon_name": "Titan","lat": 67.1,"lon": 222.9,"description": "Insula on Titan."},{"name": "Bimini Insula","type": "Insula","theme": "moon","moon_name": "Titan","lat": 73.3,"lon": 234.6,"description": "Insula on Titan."},{"name": "Bralgu Insula","type": "Insula","theme": "moon","moon_name": "Titan","lat": 76.2,"lon": 288.5,"description": "Insula on Titan."},{"name": "Buyan Insula","type": "Insula","theme": "moon","moon_name": "Titan","lat": 77.3,"lon": 294.9,"description": "Insula on Titan."},{"name": "Hawaiki Insulae","type": "Insula","theme": "moon","moon_name": "Titan","lat": 84.32,"lon": 212.93,"description": "Insula on Titan."},{"name": "Hufaidh Insulae","type": "Insula","theme": "moon","moon_name": "Titan","lat": 67.0,"lon": 219.7,"description": "Insula on Titan."},{"name": "Krocylea Insulae","type": "Insula","theme": "moon","moon_name": "Titan","lat": 69.1,"lon": 237.6,"description": "Insula on Titan."},{"name": "Mayda Insula","type": "Insula","theme": "moon","moon_name": "Titan","lat": 79.1,"lon": 227.8,"description": "Insula on Titan."},{"name": "Meropis Insula","type": "Insula","theme": "moon","moon_name": "Titan","lat": 83.85,"lon": 226.32,"description": "Insula on Titan."},{"name": "Onogoro Insula","type": "Insula","theme": "moon","moon_name": "Titan","lat": 83.28,"lon": 228.3,"description": "Insula on Titan."},{"name": "Penglai Insula","type": "Insula","theme": "moon","moon_name": "Titan","lat": 72.2,"lon": 231.3,"description": "Insula on Titan."},{"name": "Planctae Insulae","type": "Insula","theme": "moon","moon_name": "Titan","lat": 77.5,"lon": 288.7,"description": "Insula on Titan."},{"name": "Royllo Insula","type": "Insula","theme": "moon","moon_name": "Titan","lat": 68.3,"lon": 242.8,"description": "Insula on Titan."},{"name": "Anbus Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": 39.2,"lon": 325.0,"description": "Labyrinthus on Titan."},{"name": "Corrin Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -66.0,"lon": 149.0,"description": "Labyrinthus on Titan."},{"name": "Ecaz Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -83.0,"lon": 143.3,"description": "Labyrinthus on Titan."},{"name": "Gammu Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -77.9,"lon": 290.0,"description": "Labyrinthus on Titan."},{"name": "Gamont Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": 56.8,"lon": 105.0,"description": "Labyrinthus on Titan."},{"name": "Gansireed Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -69.3,"lon": 300.7,"description": "Labyrinthus on Titan."},{"name": "Ginaz Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": 83.0,"lon": 278.3,"description": "Labyrinthus on Titan."},{"name": "Grumann Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -69.3,"lon": 300.7,"description": "Labyrinthus on Titan."},{"name": "Harmonthep Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -72.3,"lon": 78.6,"description": "Labyrinthus on Titan."},{"name": "Ipyr Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": 86.24,"lon": 251.0,"description": "Labyrinthus on Titan."},{"name": "Junction Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -47.7,"lon": 324.7,"description": "Labyrinthus on Titan."},{"name": "Kaitain Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": 52.37,"lon": 191.34,"description": "Labyrinthus on Titan."},{"name": "Kronin Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -35.7,"lon": 83.73,"description": "Labyrinthus on Titan."},{"name": "Lampadas Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -81.8,"lon": 56.0,"description": "Labyrinthus on Titan."},{"name": "Lankiveil Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -48.2,"lon": 30.5,"description": "Labyrinthus on Titan."},{"name": "Lernaeus Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -83.4,"lon": 42.0,"description": "Labyrinthus on Titan."},{"name": "Muritan Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -68.8,"lon": 320.8,"description": "Labyrinthus on Titan."},{"name": "Naraj Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -74.2,"lon": 144.2,"description": "Labyrinthus on Titan."},{"name": "Niushe Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": 75.1,"lon": 91.9,"description": "Labyrinthus on Titan."},{"name": "Palma Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -72.4,"lon": 149.0,"description": "Labyrinthus on Titan."},{"name": "Richese Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": 41.8,"lon": 341.0,"description": "Labyrinthus on Titan."},{"name": "Salusa Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": 45.6,"lon": 275.8,"description": "Labyrinthus on Titan."},{"name": "Sikun Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -77.9,"lon": 151.1,"description": "Labyrinthus on Titan."},{"name": "Tleilax Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -48.0,"lon": 164.0,"description": "Labyrinthus on Titan."},{"name": "Tupile Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -80.5,"lon": 147.8,"description": "Labyrinthus on Titan."},{"name": "Atacama Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 68.2,"lon": 312.4,"description": "Lacuna on Titan."},{"name": "Cerknica Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 71.12,"lon": 4.44,"description": "Lacuna on Titan."},{"name": "Eyre Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 72.6,"lon": 314.9,"description": "Lacuna on Titan."},{"name": "Jerid Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 66.7,"lon": 319.0,"description": "Lacuna on Titan."},{"name": "Kutch Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 88.4,"lon": 323.0,"description": "Lacuna on Titan."},{"name": "Melrhir Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 64.9,"lon": 327.4,"description": "Lacuna on Titan."},{"name": "Nakuru Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 65.81,"lon": 86.0,"description": "Lacuna on Titan."},{"name": "Ngami Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 66.7,"lon": 326.1,"description": "Lacuna on Titan."},{"name": "Orog Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 70.85,"lon": 7.94,"description": "Lacuna on Titan."},{"name": "Racetrack Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 66.1,"lon": 315.1,"description": "Lacuna on Titan."},{"name": "Uyuni Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 66.3,"lon": 311.6,"description": "Lacuna on Titan."},{"name": "Veliko Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": -76.8,"lon": 146.9,"description": "Lacuna on Titan."},{"name": "Woytchugga Lacuna","type": "Lacuna","theme": "moon","moon_name": "Titan","lat": 68.88,"lon": 71.0,"description": "Lacuna on Titan."},{"name": "Guabonito","type": "Large ringed feature","theme": "moon","moon_name": "Titan","lat": -10.9,"lon": 29.2,"description": "Large ringed feature on Titan."},{"name": "Nath","type": "Large ringed feature","theme": "moon","moon_name": "Titan","lat": -30.5,"lon": 172.3,"description": "Large ringed feature on Titan."},{"name": "Paxsi","type": "Large ringed feature","theme": "moon","moon_name": "Titan","lat": 5.0,"lon": 198.8,"description": "Large ringed feature on Titan."},{"name": "Veles","type": "Large ringed feature","theme": "moon","moon_name": "Titan","lat": 2.0,"lon": 42.7,"description": "Large ringed feature on Titan."},{"name": "Eir Macula","type": "Macula","theme": "moon","moon_name": "Titan","lat": -24.0,"lon": 65.3,"description": "Macula on Titan."},{"name": "Elpis Macula","type": "Macula","theme": "moon","moon_name": "Titan","lat": 31.2,"lon": 153.0,"description": "Macula on Titan."},{"name": "Ganesa Macula","type": "Macula","theme": "moon","moon_name": "Titan","lat": 50.0,"lon": 92.7,"description": "Macula on Titan."},{"name": "Genetaska Macula","type": "Macula","theme": "moon","moon_name": "Titan","lat": 23.5,"lon": 343.7,"description": "Macula on Titan."},{"name": "Omacatl Macula","type": "Macula","theme": "moon","moon_name": "Titan","lat": 17.6,"lon": 142.8,"description": "Macula on Titan."},{"name": "Polaznik Macula","type": "Macula","theme": "moon","moon_name": "Titan","lat": -41.1,"lon": 259.6,"description": "Macula on Titan."},{"name": "Polelya Macula","type": "Macula","theme": "moon","moon_name": "Titan","lat": 50.0,"lon": 124.0,"description": "Macula on Titan."},{"name": "Angmar Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": -10.0,"lon": 319.0,"description": "Mons on Titan."},{"name": "Dolmed Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": -11.6,"lon": 323.2,"description": "Mons on Titan."},{"name": "Doom Mons","type": "Mons","theme": "moon","moon_name": "Titan","lat": -14.65,"lon": 139.58,"description": "Mons on Titan."},{"name": "Echoriat Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": -7.4,"lon": 326.2,"description": "Mons on Titan."},{"name": "Erebor Mons","type": "Mons","theme": "moon","moon_name": "Titan","lat": -4.97,"lon": 143.77,"description": "Mons on Titan."},{"name": "Gram Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": -9.9,"lon": 332.1,"description": "Mons on Titan."},{"name": "Irensaga Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": -5.68,"lon": 327.29,"description": "Mons on Titan."},{"name": "Lithui Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": 84.68,"lon": 67.44,"description": "Mons on Titan."},{"name": "Luin Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": 81.98,"lon": 143.74,"description": "Mons on Titan."},{"name": "Merlock Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": -8.9,"lon": 328.2,"description": "Mons on Titan."},{"name": "Mindolluin Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": -3.3,"lon": 331.04,"description": "Mons on Titan."},{"name": "Misty Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": 56.8,"lon": 117.56,"description": "Mons on Titan."},{"name": "Mithrim Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": -2.16,"lon": 52.58,"description": "Mons on Titan."},{"name": "Moria Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": 15.1,"lon": 349.5,"description": "Mons on Titan."},{"name": "Rerir Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": -4.8,"lon": 327.9,"description": "Mons on Titan."},{"name": "Taniquetil Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": -3.67,"lon": 326.74,"description": "Mons on Titan."},{"name": "Sotra Patera","type": "Patera","theme": "moon","moon_name": "Titan","lat": -12.5,"lon": 140.2,"description": "Patera on Titan."},{"name": "Arrakis Planitia","type": "Planitia","theme": "moon","moon_name": "Titan","lat": -78.4,"lon": 63.0,"description": "Planitia on Titan."},{"name": "Buzzell Planitia","type": "Planitia","theme": "moon","moon_name": "Titan","lat": -66.3,"lon": 277.3,"description": "Planitia on Titan."},{"name": "Caladan Planitia","type": "Planitia","theme": "moon","moon_name": "Titan","lat": 31.0,"lon": 314.0,"description": "Planitia on Titan."},{"name": "Chusuk Planitia","type": "Planitia","theme": "moon","moon_name": "Titan","lat": -5.0,"lon": 156.5,"description": "Planitia on Titan."},{"name": "Giedi Planitia","type": "Planitia","theme": "moon","moon_name": "Titan","lat": 5.22,"lon": 182.98,"description": "Planitia on Titan."},{"name": "Hagal Planitia","type": "Planitia","theme": "moon","moon_name": "Titan","lat": -60.6,"lon": 195.0,"description": "Planitia on Titan."},{"name": "Poritrin Planitia","type": "Planitia","theme": "moon","moon_name": "Titan","lat": 48.0,"lon": 156.0,"description": "Planitia on Titan."},{"name": "Romo Planitia","type": "Planitia","theme": "moon","moon_name": "Titan","lat": -82.8,"lon": 339.0,"description": "Planitia on Titan."},{"name": "Rossak Planitia","type": "Planitia","theme": "moon","moon_name": "Titan","lat": -71.0,"lon": 185.0,"description": "Planitia on Titan."},{"name": "Xuttah Planitia","type": "Planitia","theme": "moon","moon_name": "Titan","lat": 10.6,"lon": 12.31,"description": "Planitia on Titan."},{"name": "Concordia Regio","type": "Regio","theme": "moon","moon_name": "Titan","lat": -20.0,"lon": 299.0,"description": "Regio on Titan."},{"name": "Hetpet Regio","type": "Regio","theme": "moon","moon_name": "Titan","lat": -22.0,"lon": 248.0,"description": "Regio on Titan."},{"name": "Hotei Regio","type": "Regio","theme": "moon","moon_name": "Titan","lat": -26.0,"lon": 102.0,"description": "Regio on Titan."},{"name": "Ochumare Regio","type": "Regio","theme": "moon","moon_name": "Titan","lat": 10.4,"lon": 191.9,"description": "Regio on Titan."},{"name": "Tui Regio","type": "Regio","theme": "moon","moon_name": "Titan","lat": -24.5,"lon": 55.1,"description": "Regio on Titan."},{"name": "Arnar Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 72.6,"lon": 218.0,"description": "Sinus on Titan."},{"name": "Avacha Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 82.87,"lon": 204.57,"description": "Sinus on Titan."},{"name": "Baffin Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 80.35,"lon": 195.38,"description": "Sinus on Titan."},{"name": "Boni Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 78.69,"lon": 194.62,"description": "Sinus on Titan."},{"name": "Dingle Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 81.36,"lon": 203.56,"description": "Sinus on Titan."},{"name": "Fagaloa Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 82.9,"lon": 219.5,"description": "Sinus on Titan."},{"name": "Flensborg Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 64.9,"lon": 244.7,"description": "Sinus on Titan."},{"name": "Fundy Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 83.26,"lon": 224.36,"description": "Sinus on Titan."},{"name": "Gabes Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 67.6,"lon": 250.4,"description": "Sinus on Titan."},{"name": "Genova Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 80.11,"lon": 213.39,"description": "Sinus on Titan."},{"name": "Kumbaru Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 56.8,"lon": 236.2,"description": "Sinus on Titan."},{"name": "Lulworth Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 67.19,"lon": 223.12,"description": "Sinus on Titan."},{"name": "Maizuru Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 78.9,"lon": 187.47,"description": "Sinus on Titan."},{"name": "Manza Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 79.29,"lon": 193.9,"description": "Sinus on Titan."},{"name": "Montego Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 80.76,"lon": 49.08,"description": "Sinus on Titan."},{"name": "Moray Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 76.6,"lon": 258.6,"description": "Sinus on Titan."},{"name": "Nicoya Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 74.8,"lon": 288.8,"description": "Sinus on Titan."},{"name": "Okahu Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 73.7,"lon": 258.0,"description": "Sinus on Titan."},{"name": "Patos Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 77.2,"lon": 315.2,"description": "Sinus on Titan."},{"name": "Puget Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 82.4,"lon": 298.9,"description": "Sinus on Titan."},{"name": "Rombaken Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 75.3,"lon": 307.1,"description": "Sinus on Titan."},{"name": "Saldanha Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 82.42,"lon": 217.5,"description": "Sinus on Titan."},{"name": "Skelton Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 76.8,"lon": 225.1,"description": "Sinus on Titan."},{"name": "Trold Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 71.3,"lon": 247.3,"description": "Sinus on Titan."},{"name": "Tumaco Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 82.55,"lon": 224.78,"description": "Sinus on Titan."},{"name": "Tunu Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 79.2,"lon": 240.2,"description": "Sinus on Titan."},{"name": "Wakasa Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 80.7,"lon": 270.0,"description": "Sinus on Titan."},{"name": "Walvis Sinus","type": "Sinus","theme": "moon","moon_name": "Titan","lat": 58.2,"lon": 215.9,"description": "Sinus on Titan."},{"name": "Garotman Terra","type": "Terra","theme": "moon","moon_name": "Titan","lat": -13.5,"lon": 192.0,"description": "Terra on Titan."},{"name": "Tollan Terra","type": "Terra","theme": "moon","moon_name": "Titan","lat": 6.4,"lon": 217.3,"description": "Terra on Titan."},{"name": "Tsiipiya Terra","type": "Terra","theme": "moon","moon_name": "Titan","lat": 2.83,"lon": 199.88,"description": "Terra on Titan."},{"name": "Yalaing Terra","type": "Terra","theme": "moon","moon_name": "Titan","lat": -19.5,"lon": 216.0,"description": "Terra on Titan."},{"name": "Paititi Terra","type": "Terra","theme": "moon","moon_name": "Titan","lat": 20.22,"lon": 290.61,"description": "Terra on Titan."},{"name": "Aura Undae","type": "Undae","theme": "moon","moon_name": "Titan","lat": 13.79,"lon": 313.14,"description": "Undae on Titan."},{"name": "Boreas Undae","type": "Undae","theme": "moon","moon_name": "Titan","lat": -6.0,"lon": 325.0,"description": "Undae on Titan."},{"name": "Eurus Undae","type": "Undae","theme": "moon","moon_name": "Titan","lat": -7.5,"lon": 329.7,"description": "Undae on Titan."},{"name": "Notus Undae","type": "Undae","theme": "moon","moon_name": "Titan","lat": -10.0,"lon": 328.9,"description": "Undae on Titan."},{"name": "Zephyrus Undae","type": "Undae","theme": "moon","moon_name": "Titan","lat": -8.5,"lon": 322.9,"description": "Undae on Titan."},{"name": "Bacab Virgae","type": "Virga","theme": "moon","moon_name": "Titan","lat": -19.0,"lon": 29.0,"description": "Virga on Titan."},{"name": "Hobal Virga","type": "Virga","theme": "moon","moon_name": "Titan","lat": -35.0,"lon": 14.0,"description": "Virga on Titan."},{"name": "Kalseru Virga","type": "Virga","theme": "moon","moon_name": "Titan","lat": -36.0,"lon": 43.0,"description": "Virga on Titan."},{"name": "Perkunas Virgae","type": "Virga","theme": "moon","moon_name": "Titan","lat": -27.0,"lon": 18.0,"description": "Virga on Titan."},{"name": "Shiwanni Virgae","type": "Virga","theme": "moon","moon_name": "Titan","lat": -25.0,"lon": 148.0,"description": "Virga on Titan."},{"name": "Tishtrya Virgae","type": "Virga","theme": "moon","moon_name": "Titan","lat": 23.8,"lon": 0.2,"description": "Virga on Titan."},{"name": "Tlaloc Virgae","type": "Virga","theme": "moon","moon_name": "Titan","lat": 23.7,"lon": 332.3,"description": "Virga on Titan."},{"name": "Uanui Virgae","type": "Virga","theme": "moon","moon_name": "Titan","lat": 45.2,"lon": 304.7,"description": "Virga on Titan."},{"name": "Kraken Mare","type": "Mare","theme": "moon","moon_name": "Titan","lat": 68.0,"lon": 230.0,"description": "Mare on Titan."},{"name": "Ligeia Mare","type": "Mare","theme": "moon","moon_name": "Titan","lat": 79.0,"lon": 292.0,"description": "Mare on Titan."},{"name": "Punga Mare","type": "Mare","theme": "moon","moon_name": "Titan","lat": 85.0,"lon": 200.0,"description": "Mare on Titan."},{"name": "Sotra Patera","type": "Patera","theme": "moon","moon_name": "Titan","lat": -12.5,"lon": 140.2,"description": "Patera on Titan."},{"name": "Huygens Landing Site","type": "Probe landing site","theme": "moon","moon_name": "Titan","lat": -10.3,"lon": 347.7,"description": "Probe landing site on Titan."},{"name": "Cassini Regio","type": "Dark albedo province","theme": "moon","moon_name": "Iapetus","lat": -28.1,"lon": 267.4,"description": "Iapetus's dark leading-hemisphere province, the moon's most distinctive surface unit.","interpretation": "Dark coated terrain"},{"name": "Roncevaux Terra","type": "Bright trailing terrain","theme": "moon","moon_name": "Iapetus","lat": 37.0,"lon": 120.5,"description": "A bright icy terrain province on Iapetus's trailing hemisphere, contrasting strongly with Cassini Regio.","interpretation": "Bright water-ice terrain"},{"name": "Turgis Crater","type": "Equatorial ridge","theme": "moon","moon_name": "Iapetus","lat": 16.9,"lon": 331.6,"description": "Representative segment of Iapetus's famous equatorial ridge system, which rises dramatically above the surrounding terrain.","dimension": "Equatorial ridge segment"},{"name": "Acestes","type": "Crater","theme": "moon","moon_name": "Dione","lat": 50.1,"lon": 116.63,"description": "King of Sicily."},{"name": "Adrastus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -61.66,"lon": 313.43,"description": "King of Argos, one of the seven against Thebes, and the only one to return alive."},{"name": "Aeneas","type": "Crater","theme": "moon","moon_name": "Dione","lat": 25.89,"lon": 313.73,"description": "Hero of the Aeneid. The son of Anchises and Venus and a member of the royal family of Troy."},{"name": "Alcander","type": "Crater","theme": "moon","moon_name": "Dione","lat": -52.89,"lon": 64.51,"description": "A Trojan defending Aeneas\u2019 camp against the Rutulians, killed by Turnus."},{"name": "Allecto","type": "Crater","theme": "moon","moon_name": "Dione","lat": -7.73,"lon": 135.44,"description": "One of the Furies."},{"name": "Amastrus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -9.96,"lon": 122.97,"description": "A Trojan, victim of Camilla."},{"name": "Amata","type": "Crater","theme": "moon","moon_name": "Dione","lat": 5.17,"lon": 80.19,"description": "Mother of Lavinia (wife of Aeneas)."},{"name": "Amycus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -37.52,"lon": 271.38,"description": "A Trojan, comrade of Aeneas."},{"name": "Anchises","type": "Crater","theme": "moon","moon_name": "Dione","lat": -34.0,"lon": 295.0,"description": "Aeneas' father."},{"name": "Anna","type": "Crater","theme": "moon","moon_name": "Dione","lat": -63.38,"lon": 270.04,"description": "Sister and confidante of Dido."},{"name": "Antenor","type": "Crater","theme": "moon","moon_name": "Dione","lat": -7.0,"lon": 348.46,"description": "Nephew of Priam. He escaped the fall of Troy and reached Italy before Aeneas, where he founded Padua."},{"name": "Ascanius","type": "Crater","theme": "moon","moon_name": "Dione","lat": 33.43,"lon": 127.82,"description": "Son of Aeneas by Creusa."},{"name": "Assaracus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 32.65,"lon": 351.21,"description": "Early king of Troy, son of Tros, brother of Ilus and Ganymede."},{"name": "Aulestes","type": "Crater","theme": "moon","moon_name": "Dione","lat": 9.9,"lon": 212.27,"description": "Etruscan chief, ally of Aeneas."},{"name": "Butes","type": "Crater","theme": "moon","moon_name": "Dione","lat": 65.72,"lon": 313.6,"description": "A famous boxer who had been defeated by Dares."},{"name": "Caieta","type": "Crater","theme": "moon","moon_name": "Dione","lat": -24.71,"lon": 280.37,"description": "A nurse of Aeneas."},{"name": "Camilla","type": "Crater","theme": "moon","moon_name": "Dione","lat": -4.36,"lon": 299.39,"description": "A warrior maiden; ally of Turnus."},{"name": "[Carthage Linea]","type": "Linea","theme": "moon","moon_name": "Dione","lat": 12.7,"lon": 38.1,"description": "A Punic (Phoenician) city in North Africa."},{"name": "Cassandra","type": "Crater","theme": "moon","moon_name": "Dione","lat": -39.84,"lon": 113.78,"description": "Daughter of Priam; she could foretell the future."},{"name": "Catillus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -2.38,"lon": 84.7,"description": "Brother of Tiburtus and twin brother of Coras."},{"name": "Coras","type": "Crater","theme": "moon","moon_name": "Dione","lat": 0.39,"lon": 91.55,"description": "Brother of Tiburtus and twin brother of Catillus. He was founder of Tibur and an ally of Turnus against Aeneas."},{"name": "Cretheus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -43.35,"lon": 271.47,"description": "A Trojan warrior who took part in the defense of Aeneas\u2019 camp against the Rutulians."},{"name": "Creusa","type": "Crater","theme": "moon","moon_name": "Dione","lat": 49.19,"lon": 283.68,"description": "Daughter of Priam; first wife of Aeneas."},{"name": "Daucus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -15.38,"lon": 58.86,"description": "A Rutulian, father of the twins Thymber and Larides."},{"name": "Dercennus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 29.75,"lon": 80.07,"description": "Ancient king of the Laurentians."},{"name": "Dido","type": "Crater","theme": "moon","moon_name": "Dione","lat": -23.97,"lon": 341.18,"description": "Tyrian princess who founded Carthage."},{"name": "Entellus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -10.93,"lon": 149.46,"description": "Sicilian boxing champion."},{"name": "Erulus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -35.0,"lon": 255.24,"description": "Superhuman son of the goddess Feronia."},{"name": "Eumelus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -0.1,"lon": 294.04,"description": "A Trojan companion of Aeneas."},{"name": "Euryalus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -74.36,"lon": 0.0,"description": "A Trojan companion of Aeneas, friend of Nisus."},{"name": "Evander","type": "Crater","theme": "moon","moon_name": "Dione","lat": -57.0,"lon": 215.0,"description": "Son of Mercury by Carmentis, ally of Aeneas against the Latins, mythical king of Arcadia, founded and ruled Pallanteum, built on the future site of Rome."},{"name": "Fadus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -35.94,"lon": 134.82,"description": "A Rutulian of those besieging the men of Aeneas in their leader\u2019s absence."},{"name": "Galaesus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 46.77,"lon": 63.75,"description": "An old Italian killed in the first fighting between Latins and Trojans while trying to make peace."},{"name": "Haemon","type": "Crater","theme": "moon","moon_name": "Dione","lat": 84.33,"lon": 83.69,"description": "There are two persons in the Aeneid with this name: (a) a Rutulian from a group attacking the Trojan\u2019s camp in the absence of Aeneas, and (b) an Italian whose son, priest of Apollo and Diana, was a soldier of Turnus."},{"name": "Halys","type": "Crater","theme": "moon","moon_name": "Dione","lat": -59.17,"lon": 306.28,"description": "A Trojan defending Aeneas' camp against the Rutulian attack. He was killed by Turnus."},{"name": "Herbesus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 34.68,"lon": 203.89,"description": "A Rutulian who besieged Aeneas' camp."},{"name": "Iasus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -22.13,"lon": 114.08,"description": "There are two persons in the Aeneid with this name: (a) father of Palinurus, and (b) father of Iapyx."},{"name": "Ilia","type": "Crater","theme": "moon","moon_name": "Dione","lat": -0.5,"lon": 13.73,"description": "Also known as Rhea Silvia; Mother by Mars of Romulus and Remus, the founders of Rome."},{"name": "Italus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -18.47,"lon": 283.59,"description": "Ancient hero, eponymous ancestor of the Italians."},{"name": "Lagus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -13.56,"lon": 257.05,"description": "A soldier of Turnus."},{"name": "Lamyrus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 53.67,"lon": 104.39,"description": "A Rutulian with the troops besieging the camp of Aeneas."},{"name": "Larides","type": "Crater","theme": "moon","moon_name": "Dione","lat": 7.17,"lon": 48.58,"description": "A Rutulian, member of Turnus\u2019 army, son of Daucus, twin brother of Thymber."},{"name": "Latagus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 14.65,"lon": 333.54,"description": "Soldier of Aeneas."},{"name": "Latinus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 52.19,"lon": 159.0,"description": "King of Latium, husband of Amata."},{"name": "Lausus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 34.81,"lon": 337.24,"description": "Son of Mezentius, killed by Aeneas."},{"name": "Liger","type": "Crater","theme": "moon","moon_name": "Dione","lat": 24.0,"lon": 233.37,"description": "Soldier of Turnus, brother of Lucagus."},{"name": "Lucagus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 22.15,"lon": 228.75,"description": "Soldier of Turnus, brother of Liger."},{"name": "Magus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 18.44,"lon": 335.65,"description": "A soldier of Turnus, killed by Aeneas."},{"name": "Massicus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -35.0,"lon": 304.61,"description": "An Etruscan ally of Aeneas."},{"name": "Metiscus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 6.0,"lon": 266.71,"description": "A Rutulian, charioteer of Turnus."},{"name": "Mezentius","type": "Crater","theme": "moon","moon_name": "Dione","lat": 19.16,"lon": 177.0,"description": "Etruscan king, ally of Turnus, father of Lausus."},{"name": "Murranus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 12.82,"lon": 269.27,"description": "A Rutulian."},{"name": "Nisus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -68.18,"lon": 25.0,"description": "Trojan companion of Aeneas, friend of Euryalus."},{"name": "Oebalus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 44.47,"lon": 8.4,"description": "An ally of Turnus, son of Telon and Sebethis."},{"name": "[Padua Linea]","type": "Linea","theme": "moon","moon_name": "Dione","lat": -20.0,"lon": 149.3,"description": "City in Northern Italy founded by Antenor."},{"name": "Pagasus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -3.0,"lon": 119.0,"description": "An Etruscan killed by Camilla."},{"name": "[Palatine Linea]","type": "Linea","theme": "moon","moon_name": "Dione","lat": -40.6,"lon": 54.6,"description": "One of the Seven Hills of Rome."},{"name": "Palinurus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -3.3,"lon": 297.0,"description": "Pilot of Aeneas' fleet."},{"name": "Phaleris","type": "Crater","theme": "moon","moon_name": "Dione","lat": -77.4,"lon": 193.42,"description": "Trojan defending Aeneas' camp against Rutulian attack."},{"name": "Phorbas","type": "Crater","theme": "moon","moon_name": "Dione","lat": 81.2,"lon": 228.71,"description": "A Trojan, companion of Aeneas."},{"name": "Prytanis","type": "Crater","theme": "moon","moon_name": "Dione","lat": -46.25,"lon": 72.6,"description": "Trojan defending Aeneas' camp against Rutulian attack."},{"name": "Remus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -13.58,"lon": 328.1,"description": "He and his brother Romulus founded Rome."},{"name": "Ripheus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -56.47,"lon": 323.2,"description": "A Trojan. He fought at the side of Aeneas during Troy's last night."},{"name": "Romulus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -8.15,"lon": 333.15,"description": "Mythical founder of Rome in 754 or 753 B.C., son of Mars by Ilia (Rhea Silvia)."},{"name": "Sabinus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -43.65,"lon": 173.34,"description": "Fabled ancestor of the Sabines."},{"name": "Sagaris","type": "Crater","theme": "moon","moon_name": "Dione","lat": 4.93,"lon": 255.8,"description": "Servant of Aeneas."},{"name": "Salius","type": "Crater","theme": "moon","moon_name": "Dione","lat": 65.09,"lon": 178.27,"description": "There are two persons in the Aeneid with this name: (a) a companion of Aeneas and a contestant in the foot race, and (b) a Rutulian."},{"name": "Silvius","type": "Crater","theme": "moon","moon_name": "Dione","lat": -32.7,"lon": 27.74,"description": "Son of Aeneas and Lavinia."},{"name": "Sulmo","type": "Crater","theme": "moon","moon_name": "Dione","lat": 55.92,"lon": 26.5,"description": "There are two persons in the Aeneid with this name: (a) a Rutulian in the troop of Volcens, and (b) an Italian whose sons fought for Turnus."},{"name": "Telon","type": "Crater","theme": "moon","moon_name": "Dione","lat": -16.2,"lon": 262.8,"description": "Ruler of the Teleboans on Capri; father of Oebalus."},{"name": "Tereus","type": "Crater","theme": "moon","moon_name": "Dione","lat": -2.6,"lon": 115.0,"description": "A Trojan, killed by Camilla."},{"name": "Thymber","type": "Crater","theme": "moon","moon_name": "Dione","lat": 14.0,"lon": 50.85,"description": "A Rutulian, member of Turnus\u2019 army, son of Daucus, twin brother of Larides."},{"name": "Tibur Chasmata","type": "Chasma","theme": "moon","moon_name": "Dione","lat": 60.0,"lon": 290.7,"description": "Ancient town of Italy (modern name Tivoli) not far from Rome on the river Anio."},{"name": "Tiburtus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 29.11,"lon": 170.27,"description": "Brother of the twins Catillus and Coras, founder of Tibur to which he gave his name."},{"name": "Turnus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 15.59,"lon": 14.69,"description": "Rutililan king; Aeneas' rival for hand of Lavinia."},{"name": "Tyrrhus","type": "Crater","theme": "moon","moon_name": "Dione","lat": 24.7,"lon": 72.1,"description": "Keeper of the herds for Latinus, father of Silvia."},{"name": "Volcens","type": "Crater","theme": "moon","moon_name": "Dione","lat": -13.84,"lon": 91.49,"description": "A Latin, leader of cavalry sent as reinforcements to Turnus."},{"name": "Ahmad","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 57.87,"lon": 49.98,"description": "Youngest son; brings father a magic apple; marries the Genie Peri Banu."},{"name": "Ajib","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 61.68,"lon": 120.61,"description": "Brother of Gharib in the tale \u201c;The History of Gharib and His Brother Ajib.\u201c;"},{"name": "Aladdin","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 62.69,"lon": 337.86,"description": "Hero of the tale; he has the magic lamp."},{"name": "Al-Bakbuk","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 5.26,"lon": 168.38,"description": "The barber's first brother in \u201c;The Hunchback\u2019s Tale.\u201c;"},{"name": "Alexandria Sulcus","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": -75.63,"lon": 222.44,"description": "City in the tale \u201c;The Sharper of Alexandria and the Chief of Police\u201c; from Richard F. Burton's Arabian Nights."},{"name": "Al-Fakik","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 35.52,"lon": 53.45,"description": "The barber's third brother in \u201c;The Hunchback\u2019s Tale.\u201c;"},{"name": "Al-Haddar","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 50.48,"lon": 159.22,"description": "The barber's second brother in \u201c;The Hunchback\u2019s Tale.\u201c;"},{"name": "Ali Baba","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 56.84,"lon": 342.49,"description": "Hero of tale who found a great treasure owned by 40 thieves."},{"name": "Al-Kuz","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -18.88,"lon": 181.34,"description": "The barber\u2019s fourth brother in \u201cThe Hunchback\u2019s Tale.\u201d"},{"name": "Al-Medinah Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": -50.7,"lon": 1.4,"description": "Place in the tale \u201c;The Lovers of Al-Medinah.\u201c;"},{"name": "Al-Mustazi","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -21.09,"lon": 158.25,"description": "Father of benevolent prince Al-Mustansir in \u201c;The Hunchback\u2019s Tale.\u201c;"},{"name": "Al-Yaman Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": 9.7,"lon": 168.2,"description": "Place in the tale \u201c;The Man of Al-Yaman and His Six Slave-Girls.\u201c;"},{"name": "Anbar Fossae","type": "Fossa","theme": "moon","moon_name": "Enceladus","lat": -8.76,"lon": 36.68,"description": "City in the tale \u201c;The Prior who became a Moslem.\u201c;"},{"name": "Andal\u00fas Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": 29.1,"lon": 280.9,"description": "City in the tale \u201c;The Merchant\u2019s Daughter and the Prince Al-Irak.\u201c;"},{"name": "Ayyub","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 38.58,"lon": 64.98,"description": "Damascus merchant, father of Ghanim and Fitnah in the \u201c;Tale of Ghanim Bin Ayyub, the Distraught, the Thrall O\u2019 Love.\u201c;"},{"name": "Aziz","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 17.73,"lon": 11.51,"description": "Man betrothed to his cousin Azizah in \u201c;The tale of Aziz and Azizah.\u201c;"},{"name": "Bahman","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 14.7,"lon": 298.63,"description": "Oldest Prince, brother of Parwez and Perizadah in the tale \u201c;The Two Sisters Who Envied Their Cadette.\u201c;"},{"name": "Bassorah Fossa","type": "Fossa","theme": "moon","moon_name": "Enceladus","lat": 39.8,"lon": 340.1,"description": "Town from which Sindbad embarked on his 3rd voyage."},{"name": "Behram","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -15.43,"lon": 178.51,"description": "Son of a Persian king in the tale \u201c;Prince Behram and the Princess Al-Datma.\u201c;"},{"name": "Bishangarh Fossae","type": "Fossa","theme": "moon","moon_name": "Enceladus","lat": -24.0,"lon": 134.2,"description": "Place in the tale \u201c;Prince Ahmad and the Fairy Peri Banu.\u201c;"},{"name": "Bulak Sulcus","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": 16.67,"lon": 250.68,"description": "Place in the tale \u201c;Story of the Chief of the Bulak Police.\u201c;"},{"name": "Camphor Sulcus","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": -70.78,"lon": 210.6,"description": "Islands in the \u201c;Tale of Aziz and Azizah.\u201c;"},{"name": "Cashmere Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": -52.07,"lon": 63.94,"description": "City in \u201c;The Goldsmith and the Cashmere Singing Girl.\u201c;"},{"name": "Cufa Dorsa","type": "Dorsum","theme": "moon","moon_name": "Enceladus","lat": 3.19,"lon": 73.83,"description": "City in the \u201c;Tale of Kamar Al-Zaman.\u201c;"},{"name": "Dalilah","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 51.55,"lon": 110.35,"description": "Crafty old crone who fools several men."},{"name": "Daryabar Fossa","type": "Fossa","theme": "moon","moon_name": "Enceladus","lat": 9.65,"lon": 354.58,"description": "\u201c;Ocean region\u201c;; land from which Princess Daryabar came."},{"name": "Diyar Planitia","type": "Planitia","theme": "moon","moon_name": "Enceladus","lat": -13.4,"lon": 108.05,"description": "Country where Khudadad's father ruled."},{"name": "Duban","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 58.07,"lon": 78.74,"description": "Sage who cured King Yunan of leprosy."},{"name": "Dunyazad","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 41.51,"lon": 157.96,"description": "Sister of Shahrazad."},{"name": "Ebony Dorsum","type": "Dorsum","theme": "moon","moon_name": "Enceladus","lat": 5.74,"lon": 79.46,"description": "City in the \u201c;Tale of Kamar Al-Zaman.\u201c;"},{"name": "Fitnah","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 45.39,"lon": 70.01,"description": "Daughter of Ayyub, sister of Ghanim in the \u201c;Tale of Ghanim Bin Ayyub, the Distraught, the Thrall O\u2019 Love.\u201c;"},{"name": "Ghanim","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 38.74,"lon": 79.22,"description": "Son of Ayyub, brother of Fitnah in the \u201c;Tale of Ghanim Bin Ayyub, the Distraught, the Thrall O\u2019Love.\u201c;"},{"name": "Gharib","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 81.12,"lon": 118.85,"description": "Hero of many tales."},{"name": "Hamah Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": 27.26,"lon": 54.0,"description": "City in the tale \u201c;The Man's Dispute with the Learned Woman of the Relative Excellence of the Male and Female.\u201c;"},{"name": "Harran Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": 26.39,"lon": 114.07,"description": "City where Khudadad's father ruled."},{"name": "Harun","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 36.47,"lon": 134.26,"description": "Harun al-Rashid; Caliph in many tales, for example \u201c;Harun Al-Rashid and the Two Slave-Girls.\u201c;"},{"name": "Hassan","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -31.57,"lon": 171.09,"description": "Character in the tale \u201c;Hassan of Bassorah.\u201c;"},{"name": "Hisham","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 48.25,"lon": 79.59,"description": "Caliph in the tale \u201c;The Caliph Hisham and the Arab Youth.\u201c;"},{"name": "Isbanir Fossa","type": "Fossa","theme": "moon","moon_name": "Enceladus","lat": 11.3,"lon": 1.74,"description": "Fakir Taj's home; may be ancient Ctesiphon."},{"name": "Ishak","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 47.6,"lon": 134.98,"description": "Character in the tale \u201c;Isaac of Mosul and the Merchant.\u201c;"},{"name": "Ja\u2019afar","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 34.6,"lon": 22.44,"description": "Vizier of Harun al-Rashid in the tale \u201c;Nur al-Din Ali and the Damsel Anis al-Jalis.\u201c;"},{"name": "Jansha","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -30.65,"lon": 202.6,"description": "Female hero in \u201c;The Story of Jansha.\u201c;"},{"name": "Julnar","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 53.76,"lon": 12.91,"description": "The seaborn; heroine of nights 738 to 756."},{"name": "Kamar","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -40.62,"lon": 327.75,"description": "Kamar al-Akm\u00e1r; Prince, son of Sabur (King of Persia) in the tale \u201c;The Ebony Horse.\u201c;"},{"name": "Kasim","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 42.35,"lon": 186.95,"description": "The greedy brother of Ali Baba in the tale \u201c;Ali Baba and the Forty Thieves.\u201c;"},{"name": "Kaukab\u00e1n Fossae","type": "Fossa","theme": "moon","moon_name": "Enceladus","lat": 33.0,"lon": 94.0,"description": "Place in the tale \u201c;How Abu Hasan Brake Wind.\u201c;"},{"name": "Khorasan Fossa","type": "Fossa","theme": "moon","moon_name": "Enceladus","lat": -19.0,"lon": 123.13,"description": "Place (province) in the tale \u201c;Ali Shar and Zumurrud.\u201c;"},{"name": "Khusrau","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -4.1,"lon": 174.14,"description": "King, husband of Shirin in the tale \u201c;Khusrau and Shirin and the Fisherman.\u201c;"},{"name": "Labtayt Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": -27.69,"lon": 73.92,"description": "Royal city, site of a tower locked by kings in the tale \u201c;The City of Labtayt.\u201c;"},{"name": "L\u00e1hej Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": -10.89,"lon": 58.0,"description": "City in the tale \u201cHow Abu Hasan brake wind.\u201d"},{"name": "Ma\u2019aruf","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -37.16,"lon": 26.42,"description": "Hero in the tale \u201c;Ma'aruf the Cobbler and His Wife Fatimah.\u201c;"},{"name": "Makran Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": -54.4,"lon": 224.2,"description": "Land in the tale \u201c;The Tale of Salim, the Youth of Khorasan, and Salma, his Sister.\u201c;"},{"name": "Marjanah","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 38.2,"lon": 56.99,"description": "Queen in the \u201c;Tale of Kamar Al-Zaman.\u201c;"},{"name": "Masrur","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 66.27,"lon": 65.73,"description": "Eunuch sworder in the tale \u201c;Nur al-Din Ali and the Damsel Anis al-Jalis.\u201c;"},{"name": "Misr Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": 18.0,"lon": 160.3,"description": "City in the tale \u201c;History of Al-Hajjaj Bin Yusuf and the Young Sayyid.\u201c;"},{"name": "Morgiana","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 31.75,"lon": 163.83,"description": "Clever slave girl in the tale \u201c;Ali Baba and the Forty Thieves.\u201c;"},{"name": "Mosul Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": -58.1,"lon": 23.27,"description": "City where Isaac was pulled up in a basket to a mansion and four damsels in the tale \u201cIsaac of Mosul.\u201d"},{"name": "Musa","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 73.85,"lon": 348.41,"description": "Goes to get the vessels that contain Jinni in \u201c;The City of Brass\u201c;."},{"name": "Mustafa","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -30.76,"lon": 175.05,"description": "Old tailor in the tale \u201c;Aladdin; or The Wonderful Lamp.\u201c;"},{"name": "Omar","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 17.89,"lon": 86.03,"description": "Great king, father of Sharrkan and Zau al-Mak\u00e1n in \u201c;The Tale of King Omar and his Sons.\u201c;"},{"name": "Otbah","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -40.03,"lon": 200.2,"description": "Figure in the tale \u201c;Otbah and Rayya.\u201c;"},{"name": "Parwez","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 22.95,"lon": 334.44,"description": "Second prince, brother of Bahman and Perizadah in the tale \u201c;The Two Sisters Who Envied Their Cadette.\u201c;"},{"name": "Peri-Banu","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 62.04,"lon": 40.86,"description": "Genie who marries Ahmad and helps him fulfill the demands of his father."},{"name": "Perizadah","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -21.12,"lon": 204.89,"description": "Youngest princess, sister of Bahman and Parwez in the tale \u201c;The Two Sisters Who Envied Their Cadette.\u201c;"},{"name": "Rayya","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -32.41,"lon": 181.12,"description": "Female character in the tale \u201c;Otbah and Rayya.\u201c;"},{"name": "Sabur","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -23.9,"lon": 63.82,"description": "King of Persia and father of Kamar in the tale \u201c;The Ebony Horse.\u201c;"},{"name": "Salih","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -5.99,"lon": 355.6,"description": "Brother of Julnar."},{"name": "Samad","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 61.69,"lon": 358.77,"description": "Shayk who guides Musa and Talib to the mountains in \u201c;The City of Brass\u201c;."},{"name": "[Samaria Fossa]","type": "Fossa","theme": "moon","moon_name": "Enceladus","lat": 26.89,"lon": 134.83,"description": "Place in the tale \u201cKhudadad and His Brothers.\u201d"},{"name": "Samaria Rupes","type": "Rupes","theme": "moon","moon_name": "Enceladus","lat": 26.86,"lon": 134.87,"description": "Place in the tale \u201c;Khudadad and His Brothers.\u201c;"},{"name": "Samarkand Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": 30.0,"lon": 32.5,"description": "Country ruled over by Zaman, brother of Shahryar."},{"name": "Sarandib Planitia","type": "Planitia","theme": "moon","moon_name": "Enceladus","lat": 10.23,"lon": 48.18,"description": "Ceylon (Sri Lanka); the island visited by Sindbad on his 6th voyage."},{"name": "Shahrazad","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 46.5,"lon": 158.4,"description": "Heroine who tells King Shahryar \u201c;The Tales of a Thousand Nights\u201c;."},{"name": "Shahryar","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 57.71,"lon": 133.31,"description": "King whom Shahrazad beguiles with the tales of a thousand nights and a night."},{"name": "Shakashik","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -17.59,"lon": 178.74,"description": "The barber's sixth brother in \u201c;The Hunchback\u2019s Tale.\u201c;"},{"name": "Sharrkan","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 16.42,"lon": 58.09,"description": "Son of the great King Omar in \u201c;The Tale of King Omar and his Sons.\u201c;"},{"name": "Shiraz Sulcus","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": -57.2,"lon": 320.6,"description": "Place in \u201c;Prince Ahmad and the Fairy Peri Banu.\u201c;"},{"name": "Shirin","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -2.27,"lon": 187.18,"description": "Wife of King Khusrau in the tale \u201c;Khusrau and Shirin and the Fisherman.\u201c;"},{"name": "Sindbad","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 66.97,"lon": 148.39,"description": "Voyager who had many marvelous adventures on seven voyages."},{"name": "Sind Sulci","type": "Sulcus","theme": "moon","moon_name": "Enceladus","lat": -16.4,"lon": 252.7,"description": "City in the tale \u201c;The Merchant\u2019s Daughter and the Prince of Al-Irak.\u201c;"},{"name": "Yunan","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 53.95,"lon": 74.21,"description": "Fictional king of Persian city in the tale \u201c;The Tale of the Vizier and the Sage Duban.\u201c;"},{"name": "Zaynab","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": 69.52,"lon": 333.03,"description": "Daughter of Dalilah in the tale \u201c;The Rogueries of Dalilah the Crafty and Her Daughter Zaynab the Coney-Catcher.\u201c;"},{"name": "Zumurrud","type": "Crater","theme": "moon","moon_name": "Enceladus","lat": -22.23,"lon": 177.95,"description": "Female character in the tale \u201c;Ali Shar and Zumurrud.\u201c;"},{"name": "Bahloo","type": "Crater","theme": "moon","moon_name": "Hyperion","lat": 15,"lon": 345,"description": "The Moon; maker of girl babies."},{"name": "Bond-Lassell Dorsum","type": "Dorsum","theme": "moon","moon_name": "Hyperion","lat": 70,"lon": 330,"description": "G.P. Bond (American) and William Lassell (British); discovered Hyperion on the same night in 1848."},{"name": "Helios","type": "Crater","theme": "moon","moon_name": "Hyperion","lat": 65,"lon": 105,"description": "Greek sun god; son of Hyperion."},{"name": "Jarilo","type": "Crater","theme": "moon","moon_name": "Hyperion","lat": 29,"lon": 12,"description": "East Slavic god of the sun, fertility and love."},{"name": "Meri","type": "Crater","theme": "moon","moon_name": "Hyperion","lat": -27,"lon": 345,"description": "Bororo folk hero; the sun."},{"name": "Abisme","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 37.53,"lon": 267.08,"description": "A Saracen lord, killed by Archbishop Turpin."},{"name": "Acelin","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 42.7,"lon": 205.1,"description": "Aceline of Gascony, one of the Twelve Peers, the council of King Charles."},{"name": "Adelroth","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 6.6,"lon": 176.4,"description": "Marsilion\u2019s nephew, killed by Roland in the first battle."},{"name": "Almeric","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 53.4,"lon": 84.0,"description": "One of 12 peers, killed by Marsilion."},{"name": "Anse\u00efs","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -40.7,"lon": 69.2,"description": "One of the Twelve Peers; kills Turgis; killed by Malquiant."},{"name": "Astor","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 14.9,"lon": 38.8,"description": "A French baron; ruled over Valence on Rhone."},{"name": "Baligant","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 16.4,"lon": 135.1,"description": "Emir of Babylon; Marsilion enlisted his help against Charlemagne."},{"name": "Basan","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 33.3,"lon": 165.3,"description": "French baron; Murdered while serving as Ambassador of Marsilon."},{"name": "Basbrun","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -52.0,"lon": 248.2,"description": "Charlemagne\u2019s officer who hung Ganelon\u2019s 30 relatives."},{"name": "Basile","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -0.7,"lon": 172.1,"description": "French baron; murdered near Haltile with his brother Basan while serving as ambassador to Marsilion."},{"name": "Berenger","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 62.1,"lon": 140.3,"description": "One of twelve peers; killed Estramarin; killed by Grandoyne."},{"name": "Besgun","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 76.0,"lon": 50.2,"description": "Chief cook for Charlemagne's army; he guarded Ganelon after Ganelon's treachery was discovered."},{"name": "Bevon","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 70.7,"lon": 267.0,"description": "A French baron; killed by Marsilion."},{"name": "Bramimond","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 38.0,"lon": 182.0,"description": "Queen of Saragossa, wife of Marsilion."},{"name": "Carcassone Montes","type": "Mons","theme": "moon","moon_name": "Iapetus","lat": 0.0,"lon": 143.3,"description": "Town in southern France sacked by Roland."},{"name": "Charlemagne","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 55.0,"lon": 101.2,"description": "Emperor of France and Germanic nations; his forces fought the Saracens in Spain."},{"name": "Clarin","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 18.3,"lon": 288.4,"description": "Saracen lord and emissary to Charles."},{"name": "Climborin","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 30.4,"lon": 243.1,"description": "Saracen lord who gave his helmet to Ganelon; killed by Oliver."},{"name": "Cordova Mons","type": "Mons","theme": "moon","moon_name": "Iapetus","lat": 0.0,"lon": 153.8,"description": "Town in Spain taken by Charlemagne."},{"name": "Corsablis","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 0.9,"lon": 245.8,"description": "Saracen lord; volunteered to fight at Roncevaux Pass; killed Archbishop Turpin in the first battle."},{"name": "Dapamort","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 36.6,"lon": 275.1,"description": "A Saracen king from Lycia; leader in Baligant\u2019s army."},{"name": "Engelier","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -40.5,"lon": 95.3,"description": "One of Twelve Peers, the Gascon of Bordeaux; the most valiant knight, killed by Climborin in the first battle."},{"name": "Escremiz","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 1.6,"lon": 186.5,"description": "Escremiz of Valterne; volunteered to fight at Roncevaux Pass; killed by Engelier in the first battle."},{"name": "Eudropin","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 0.9,"lon": 139.3,"description": "Saracen lord and emissary to Charles."},{"name": "Falsaron","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 33.8,"lon": 277.4,"description": "Brother of King Marsilion; killed by Oliver."},{"name": "Ganelon","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -44.3,"lon": 340.2,"description": "French count; stepfather of Roland; brother-in-law of Roland\u2019s uncle Charlemagne; betrays Roland and the French rear guard to Marsilion."},{"name": "Garlon","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -3.2,"lon": 119.5,"description": "Saracen lord and emissary to Charles."},{"name": "Gayne Mons","type": "Mons","theme": "moon","moon_name": "Iapetus","lat": 0.0,"lon": 184.0,"description": "Spanish town whose walls Roland had shattered."},{"name": "Geboin","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 58.6,"lon": 186.6,"description": "Guarded French dead; became leader of Charlemagne's 2nd column."},{"name": "Gerin","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -45.6,"lon": 127.0,"description": "One of the Twelve Peers; kills Malprimis; killed by Grandoyne."},{"name": "Godefroy","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 71.9,"lon": 110.9,"description": "Standard bearer of Charlemagne; brother of Tierri, Charlemagne's defender against Pinabel."},{"name": "Grandoyne","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 17.7,"lon": 145.5,"description": "Son of Cappadocian King Capuel; killed Gerin, Gerier, Berenger, Guy St. Antoine, Duke Astorge; killed by Roland."},{"name": "Haltile Mons","type": "Mons","theme": "moon","moon_name": "Iapetus","lat": 0.0,"lon": 169.6,"description": "Place in Spain near which Basan and Basilie were murdered by Marsilion."},{"name": "Hamon","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 10.6,"lon": 90.0,"description": "Joint Commander of Charlemagne's Eighth Division."},{"name": "Ivon","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 18.0,"lon": 45.0,"description": "Frankish baron, one of the Twelve Peers."},{"name": "Johun","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 12.4,"lon": 276.6,"description": "Johun of Outremer; Saracen lord and emissary to Charles."},{"name": "Jurfaleu","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 13.0,"lon": 357.5,"description": "Son of Marsilion, Saracen king of Spain."},{"name": "Lorant","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 65.2,"lon": 200.2,"description": "French commander of one of first divisions against Baligant; killed by Baligant."},{"name": "Malprimis","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -15.2,"lon": 241.8,"description": "A Saracen lord from Brigale; killed by Gerin in the first battle."},{"name": "Malun","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 5.9,"lon": 318.7,"description": "A Saracen lord; killed by Oliver."},{"name": "Margaris","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 27.7,"lon": 224.2,"description": "Saracen lord from Seville; volunteered to fight at Roncevaux Pass."},{"name": "Marsilion","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 39.2,"lon": 183.9,"description": "Saracen king of Spain; Roland wounds him and he died of wound later."},{"name": "Matthay","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -3.5,"lon": 172.6,"description": "Saracen lord and emissary to Charles."},{"name": "Milon","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 67.9,"lon": 89.8,"description": "Guarded French dead while Charlemagne pursued Saracen forces."},{"name": "Naimon","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 9.3,"lon": 30.7,"description": "King Charles\u2019 wisest counselor."},{"name": "Nevelon","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -33.2,"lon": 163.0,"description": "Shares command of Charlemagne\u2019s sixth division; leader of part of the 5th column."},{"name": "Ogier","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 42.5,"lon": 84.9,"description": "Dane who led 3rd column in Charlemagne's army against Baligant's forces."},{"name": "Oliver","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 62.5,"lon": 159.2,"description": "Roland's friend; mortally wounded by Marganice."},{"name": "Othon","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 33.3,"lon": 12.2,"description": "One of twelve peers; guarded French dead while Charlemagne pursued Saracen forces; sixth column leader."},{"name": "Pinabel","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -39.0,"lon": 327.0,"description": "Pinabel of Sorence, a French baron, Ganelon's kinsmen and skilled speaker. Large and powerful, he agrees to fight Thierry to settle the issue of Ganelon's guilt and he lost the judicial combat."},{"name": "Priamon","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 1.5,"lon": 173.0,"description": "Saracen lord and emissary to Charles."},{"name": "Rabel","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -64.4,"lon": 193.8,"description": "A French baron; takes Roland\u2019s place at vanguard of Charlemagne\u2019s forces; leads first column."},{"name": "Roland","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 73.3,"lon": 334.8,"description": "Charlemagne's nephew; led rear guard of French forces; hero in song of Roland."},{"name": "Rugis","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -0.1,"lon": 261.0,"description": "Saracen lord, one of the Saracen Twelve Peers."},{"name": "Samson","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 6.5,"lon": 61.4,"description": "French baron, Duke of Burgundy; one of the Twelve Peers; killed by Valdebron."},{"name": "Saragossa Terra","type": "Terra","theme": "moon","moon_name": "Iapetus","lat": -45.0,"lon": 180.0,"description": "Town held by Marsilion, eventually taken by the French."},{"name": "Seville Mons","type": "Mons","theme": "moon","moon_name": "Iapetus","lat": 0.0,"lon": 13.7,"description": "Margaris comes from here."},{"name": "Sorence  Mons","type": "Mons","theme": "moon","moon_name": "Iapetus","lat": 0.0,"lon": 166.3,"description": "Castle of Pinabel."},{"name": "Thierry","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -55.0,"lon": 352.0,"description": "French knight; Duke of Argonne; brother of Godefroy, Charlemagne\u2019s standard bearer. At Ganelon's trial, Thierry alone insists on Ganelon's guilt."},{"name": "Tibbald","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 57.0,"lon": 2.0,"description": "Tibbald of Reims; French baron; guarded French dead at Roncevaux."},{"name": "Timozel","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -9.9,"lon": 147.7,"description": "A Saracen lord; killed by Gerin and Gerier in the first battle."},{"name": "Toledo Montes","type": "Mons","theme": "moon","moon_name": "Iapetus","lat": 0.0,"lon": 224.0,"description": "Spanish town known for blacksmiths\u2019 work; the shield of the Saracen knight Malquiant was made there."},{"name": "Torleu","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": -0.2,"lon": 171.6,"description": "Leader in Baligant\u2019s army; king of Persia; killed by Rabel."},{"name": "Tortelosa Montes","type": "Mons","theme": "moon","moon_name": "Iapetus","lat": 0.0,"lon": 295.3,"description": "Spanish town ruled by Count Turgis."},{"name": "Turgis","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 16.9,"lon": 331.6,"description": "A Saracen baron; count of Tortelosa; killed by Oliver in the first battle."},{"name": "Turpin","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 47.7,"lon": 358.6,"description": "Archbishop of Rheims in Song of Roland."},{"name": "Valdebron","type": "Crater","theme": "moon","moon_name": "Iapetus","lat": 29.6,"lon": 255.6,"description": "Saracen lord, gave his sword to Ganelon."},{"name": "Valterne Mons","type": "Mons","theme": "moon","moon_name": "Iapetus","lat": 0.0,"lon": 189.4,"description": "Escremiz comes from this Spanish town."},{"name": "Accolon","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -70.56,"lon": 175.59,"description": "Companion of Arthur's; he was tricked into jousting with Arthur."},{"name": "Arthur","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -35.4,"lon": 163.96,"description": "King of the Round Table Assemblage."},{"name": "Avalon Chasma","type": "Chasma","theme": "moon","moon_name": "Mimas","lat": 35.0,"lon": 213.0,"description": "Arthurian paradise."},{"name": "Balin","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 14.71,"lon": 277.49,"description": "Knight of \u201c;matchless courage and virtue.\u201c;"},{"name": "Ban","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 43.93,"lon": 199.25,"description": "King of Benwick; father of Sir Launcelot, ally of Arthur in the battle of Bedgrayne."},{"name": "Bedivere","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 9.57,"lon": 210.58,"description": "Arthurian knight."},{"name": "Bors","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 41.82,"lon": 187.7,"description": "King of Gaul; father of Sir Ector de Marys, Sir Bors, Sir Lyonel."},{"name": "Camelot Chasma","type": "Chasma","theme": "moon","moon_name": "Mimas","lat": -43.0,"lon": 336.6,"description": "Home of the Round Table assemblage."},{"name": "Dagonet","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 47.84,"lon": 98.38,"description": "Fool at King Arthur's court."},{"name": "Dynas","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 2.35,"lon": 279.29,"description": "A knight of the Round Table."},{"name": "Elaine","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 46.33,"lon": 253.0,"description": "Daughter of King Pelles, lover of Sir Launcelot and mother, by him, of Sir Galahad."},{"name": "Gaheris","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -44.57,"lon": 61.81,"description": "Older son of King Lot; killed by Sir Launcelot in his rescue of Gwynevere from burning."},{"name": "Galahad","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -45.32,"lon": 214.69,"description": "Bastard son of Launcelot and Elaine. He went on the quest to find the Holy Grail."},{"name": "Gareth","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -43.06,"lon": 72.22,"description": "Youngest son of King Lot; killed by Sir Launcelot in his rescue of Gwynevere from burning."},{"name": "Gawain","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -58.54,"lon": 98.92,"description": "Eldest son of King Lot; Arthur's favorite cousin."},{"name": "Gwynevere","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -17.6,"lon": 36.3,"description": "Queen; wife of Arthur; lover of Launcelot."},{"name": "Herschel","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -1.38,"lon": 248.24,"description": "William; German-British astronomer; discovered Mimas and Enceladus (1738-1822)."},{"name": "Igraine","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -41.99,"lon": 128.79,"description": "Wife of Uther; mother of Arthur."},{"name": "Iseult","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -47.24,"lon": 326.22,"description": "Loved by Tristram."},{"name": "Kay","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 44.61,"lon": 239.46,"description": "Royal seneschal at Arthur's court."},{"name": "Lamerok","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -62.27,"lon": 70.82,"description": "Pellinore's son; sent testing horn to King Mark to expose adultery of Sir Tristram."},{"name": "Launcelot","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -9.46,"lon": 31.51,"description": "King Arthur's favorite; champion and lover of Queen Gwynevere."},{"name": "Lot","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -31.46,"lon": 128.4,"description": "Leader of the rebel kings of the north and west. Married Margawse and begat Sir Gawain, Sir Aggravayne, Sir Gaheris."},{"name": "Lucas","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 40.75,"lon": 139.65,"description": "Butler at King Arthur's court."},{"name": "Marhaus","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -8.96,"lon": 359.94,"description": "Delivers poison wound to Tristram before being mortally wounded by him."},{"name": "Mark","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -26.28,"lon": 51.68,"description": "King of Cornwall."},{"name": "Melyodas","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -74.93,"lon": 282.81,"description": "King of Lyoness; marries King Mark's sister, who dies bearing their son, Sir Tristram."},{"name": "Merlin","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -38.43,"lon": 140.99,"description": "Magician and prophet; son of the devil; Arthur's mentor."},{"name": "Modred","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 4.15,"lon": 140.32,"description": "Arthur's bastard son and mortal enemy; delivered fatal wound to Arthur but was killed by him."},{"name": "Morgan","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 24.21,"lon": 115.02,"description": "Arthur's half sister; enchantress; plotted to destroy Arthur but failed."},{"name": "Nero","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -0.36,"lon": 52.7,"description": "King of the West, principal enemy of Arthur."},{"name": "Oeta Chasma","type": "Chasma","theme": "moon","moon_name": "Mimas","lat": 19.0,"lon": 237.3,"description": "Shook by a Titan in the war between Titans and Olympians."},{"name": "Ossa Chasma","type": "Chasma","theme": "moon","moon_name": "Mimas","lat": -23.56,"lon": 56.25,"description": "Mt. Pelion piled on top of it in war between Titans and Gods."},{"name": "Palomides","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 3.39,"lon": 198.0,"description": "Saracen enemy of Tristam."},{"name": "Pangea Chasma","type": "Chasma","theme": "moon","moon_name": "Mimas","lat": -28.12,"lon": 19.59,"description": "Picked up by a Titan in the war with the gods."},{"name": "Pelion Chasma","type": "Chasma","theme": "moon","moon_name": "Mimas","lat": -25.31,"lon": 109.92,"description": "Mountain piled up with Mt. Ossa in war with gods."},{"name": "Pellinore","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 29.76,"lon": 224.55,"description": "King whose duty was to pursue the questing beast and either run it to earth or lose his strength."},{"name": "Percivale","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -3.01,"lon": 181.14,"description": "Very pure knight; accomplished quest of Holy Grail."},{"name": "Royns","type": "Crater","theme": "moon","moon_name": "Mimas","lat": 32.46,"lon": 12.51,"description": "King of the West, principal enemy of Arthur."},{"name": "Tintagil Catena","type": "Catena","theme": "moon","moon_name": "Mimas","lat": -58.0,"lon": 125.0,"description": "Home of Igraine, Arthur's mother."},{"name": "[Tintagil Chasma]","type": "Chasma","theme": "moon","moon_name": "Mimas","lat": -51.76,"lon": 146.65,"description": "Home of Igraine, Arthur's mother."},{"name": "Tristram","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -52.32,"lon": 334.0,"description": "Saved Iseult; fell in love with her."},{"name": "Uther","type": "Crater","theme": "moon","moon_name": "Mimas","lat": -35.16,"lon": 109.83,"description": "Ruler of all Britain; Arthur's father."},{"name": "Acastus","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": 9.6,"lon": 211.5,"description": "Argonaut, son of the Thessalian king Pelias, took part in the Calydonian boar hunt."},{"name": "Admetus","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": 11.4,"lon": 320.9,"description": "Argonaut, founder and king of Pherae in Thessaly."},{"name": "Amphion","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -27.0,"lon": 358.2,"description": "Argonaut, son of Hyperasius and Hypso."},{"name": "Butes","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -49.6,"lon": 67.5,"description": "Argonaut, son of Teleon, bee-master."},{"name": "Calais","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -38.7,"lon": 134.6,"description": "Argonaut, son of Boreas, the north wind."},{"name": "Canthus","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -69.6,"lon": 17.8,"description": "Argonaut, son of Kanethos or Cerion, the only member of the expedition to die in combat."},{"name": "Clytius","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": 46.0,"lon": 166.9,"description": "Argonaut, son of Eurytus, skilled archer who was killed by Apollo for challenging the god to a shooting match."},{"name": "Erginus","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": 31.6,"lon": 22.9,"description": "Argonaut, son of Neptune, helmsman of the Argo after the death of Tiphys."},{"name": "Euphemus","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -31.3,"lon": 28.9,"description": "Argonaut, son of Neptune and Europa."},{"name": "Eurydamas","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -61.5,"lon": 78.4,"description": "Argonaut, son of Ctimenus."},{"name": "Eurytion","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -30.4,"lon": 352.0,"description": "Argonaut, son of Kenethos or Cerion."},{"name": "Eurytus","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -39.7,"lon": 182.8,"description": "Argonaut, son of Mercury and Antianira."},{"name": "Hylas","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": 7.9,"lon": 5.5,"description": "Argonaut, son of Theiodamas/Theodamas, king of the Dryopes."},{"name": "Idmon","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -67.1,"lon": 162.2,"description": "Argonaut, son of Apollo and the nymph Cyrene, or of Abas, a prophet."},{"name": "Iphitus","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -27.2,"lon": 66.7,"description": "Argonaut, son of Eurytus, Jason's host during his consultation with the Oracle at Delphi."},{"name": "Jason","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": 16.2,"lon": 42.3,"description": "The leading argonaut, son of the Thessalian king Aeson, delivered the Fleece."},{"name": "Leto Regio","type": "Regio","theme": "moon","moon_name": "Phoebe","lat": 60.0,"lon": 340.0,"description": "Daughter of Phoebe in Greek mythology."},{"name": "Mopsus","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": 6.6,"lon": 250.9,"description": "Argonaut, prophesying son of Apollo."},{"name": "Nauplius","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": 31.5,"lon": 118.5,"description": "Argonaut, son of Neptune and Amymone, or of Klytoneos."},{"name": "Oileus","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -77.1,"lon": 263.1,"description": "Argonaut, king of the Locrians, renowned for his courage in battle."},{"name": "Peleus","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": 20.2,"lon": 167.8,"description": "Argonaut, son of Aeacus, father of Achilles."},{"name": "Phlias","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": 1.6,"lon": 0.9,"description": "Argonaut, son of Dionysus."},{"name": "Talaus","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -52.3,"lon": 34.8,"description": "Argonaut, son of Teleon, or of Bias and Pero."},{"name": "Telamon","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -48.1,"lon": 267.4,"description": "Argonaut, son of Aeacus, took part in the Calydonian boar hunt."},{"name": "Zetes","type": "Crater","theme": "moon","moon_name": "Phoebe","lat": -20.0,"lon": 137.0,"description": "Argonaut, son of Boreas, the north wind."},{"name": "Aananin","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 34.9,"lon": 20.1,"description": "Korean god of the Heavens."},{"name": "Abassi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -21.3,"lon": 213.5,"description": "Efik (Ghana) creator god."},{"name": "Adjua","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 40.2,"lon": 241.1,"description": "Mythical heroine and ancestor of the Ulci tribe."},{"name": "Agunua","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 63.3,"lon": 293.8,"description": "San Cristobal (Melanesia) god who made sea, land, people."},{"name": "Ambat","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -76.4,"lon": 58.3,"description": "Creator of islands from the giant shellfishes in mythology of Malekula Island (New Hebrides/Vanuatu, Melanesia)."},{"name": "Ameta","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 53.3,"lon": 338.1,"description": "Ceram (Indonesia) ancestor whose blood made Hainuwele."},{"name": "Amma","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -26.4,"lon": 77.3,"description": "Dogon (Mali) creator of the universe."},{"name": "Amotken","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 0.7,"lon": 157.3,"description": "Salish (NW USA, SW Canada) creator deity, wise and kind old man."},{"name": "Anansi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -63.0,"lon": 146.4,"description": "Spider in Ashanti (Ghana) mythology, who created the sun, moon, stars, and mankind."},{"name": "Anguta","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 25.7,"lon": 170.0,"description": "Eskimo/Inuit (N. Canada) supreme being who created everything, father of the sea goddess Sedna."},{"name": "Arunaka","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -15.3,"lon": 337.9,"description": "Inca creator of all things."},{"name": "Atabei","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 16.0,"lon": 109.3,"description": "Taino (Puerto Rico) mother goddess, the \u201cFirst-In-Existence.\u201d"},{"name": "Atum","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -47.1,"lon": 358.9,"description": "Old creator God of Heliopolis; became son of Ptah."},{"name": "Avaiki Chasmata","type": "Chasma","theme": "moon","moon_name": "Rhea","lat": 25.0,"lon": 81.0,"description": "Underworld in mythology of Cook Islands (Polynesia), home for mother of Vatea, the ancestor of gods and humans."},{"name": "Awonawilona","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -37.3,"lon": 209.7,"description": "Zuni (New Mexico, USA) primeval deity, supreme life giver."},{"name": "Bulagat","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -38.2,"lon": 344.8,"description": "Mythological ancestor of the Buriat tribe."},{"name": "Bumba","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 63.1,"lon": 309.6,"description": "Bushongo; dwelt in primordial waters; vomited up sun, moon, stars, animals, and men. Showed man how to make fire."},{"name": "Burkhan","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 66.8,"lon": 49.4,"description": "Buriat (Siberia) god who created world."},{"name": "Chingaso","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -17.1,"lon": 254.0,"description": "Jivaro (Peru) wife of the creator god Kumpara."},{"name": "Con","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -25.8,"lon": 347.3,"description": "Inca coastal creator god."},{"name": "Dangun","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 7.2,"lon": 152.0,"description": "Mythical ancestor of Korean nation, son of creator god."},{"name": "Djuli","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -31.2,"lon": 313.3,"description": "Neghidahan (Ukrainian) first man who was ancestor of the people."},{"name": "Dohitt","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -18.0,"lon": 285.9,"description": "Mosetene (N. Bolivia) creator of the earth and men."},{"name": "Dotet","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -45.9,"lon": 155.3,"description": "Ket (Yenisey River area, Central Siberia, Russia) god, creator of the northern, down-sloped part of the earth."},{"name": "Ehecatl","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -54.7,"lon": 184.4,"description": "Aztec feathered serpent god of wind, one of the creators of the Earth, heavens and humans. His other name is Quetzalcoatl."},{"name": "Ellyay","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 71.4,"lon": 268.2,"description": "Yakutian ancestor of the people."},{"name": "Enkai","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 38.0,"lon": 113.7,"description": "Maasai (Tanzania, Kenya) creator god and the ruler of rains."},{"name": "Faro","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 45.3,"lon": 246.0,"description": "Mande; his sacrificial killing in heaven atoned for his twin Pemba's sin; purified Earth."},{"name": "Fatu","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 7.7,"lon": 183.9,"description": "Samoan (Polynesia) male of the first human couple."},{"name": "Fuxi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -5.5,"lon": 235.8,"description": "Chinese god, husband of the goddess Nugua. These two beings were worshipped as the ultimate ancestors of all humankind."},{"name": "Galunlati Chasmata","type": "Chasma","theme": "moon","moon_name": "Rhea","lat": 38.0,"lon": 70.0,"description": "Vault above the sky in Cherokee (SE USA) myths, where anything that was alive lived before the creation of Earth."},{"name": "Gborogboro","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -12.7,"lon": 197.8,"description": "Lugbara (Uganda) first man, pair to Meme."},{"name": "Glooskap","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -35.0,"lon": 302.8,"description": "Algonquin (Great Lakes area, Canada and USA) creator of plants, animals andhumans; son of the Great Earth Mother."},{"name": "Gmerti","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -52.0,"lon": 167.4,"description": "Georgian (Caucasus) god, founder and keeper of the world order."},{"name": "Gucumatz","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 37.0,"lon": 184.2,"description": "Mayan creator god."},{"name": "Haik","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -36.6,"lon": 330.7,"description": "Mythological ancestor of the Armenian people."},{"name": "Haoso","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 8.3,"lon": 347.5,"description": "Manchurian creator of all things."},{"name": "Heller","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 10.1,"lon": 44.9,"description": "Auracanin creator of men and bringer of civilization."},{"name": "Huracan","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 53.2,"lon": 171.5,"description": "Kiche (Guatemala) creator god, bringer of children, ruler of wind and storms."},{"name": "Imberombera","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -33.3,"lon": 143.3,"description": "Kakadu (N. Australia) creator goddess, the Great Mother, mate of the giant Wuraka."},{"name": "Imra","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 19.0,"lon": 225.8,"description": "Kafir (Nuristan, NE Afghanistan) supreme god, creator of gods and people."},{"name": "Inktomi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -14.1,"lon": 247.9,"description": "Dakota (USA) spirit, \u201c;The Spider,\u201c; created time, space and language."},{"name": "Inmar","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -2.3,"lon": 58.4,"description": "Udmurtian (Uralic Finns, Russia) creator god."},{"name": "Iraca","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 39.4,"lon": 247.9,"description": "Incan creator god who became the moon."},{"name": "Itciai","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -17.8,"lon": 11.0,"description": "Yaruro (Venezuela) jaguar god, creator of the river waters."},{"name": "Izanagi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -49.4,"lon": 49.8,"description": "Japanese creator god, brother of Izanami."},{"name": "Izanami","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -46.3,"lon": 46.6,"description": "Sister and wife of Izanagi; creator goddess."},{"name": "Jumo","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 52.8,"lon": 293.5,"description": "Marijan sky god."},{"name": "Juok","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 37.6,"lon": 205.0,"description": "Shilluk (S. Sudan) creator god."},{"name": "Kanobo","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -63.8,"lon": 322.6,"description": "Warrau/Warao (Orinoco River Delta, Venezuela) benevolent supreme being and creator god."},{"name": "Karora","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 5.9,"lon": 339.9,"description": "Aranda (Australia) ancestor who, in his dreams, gives birth to animals and male children."},{"name": "Karusakaibo","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -14.2,"lon": 139.3,"description": "Mundurucu (Tapajos and Trombetas Rivers area, NE Brazil) creator god."},{"name": "Khado","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 41.6,"lon": 0.9,"description": "Nanajan; mythological hero who built the world. The first Shaman."},{"name": "Khutsau","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 44.5,"lon": 153.1,"description": "Ossetian (N. Caucasus, Russia) supreme god, creator of the Earth."},{"name": "Kiho","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -11.1,"lon": 1.3,"description": "Tuamotu (Society Islands) progenitor being; existed in void; made land, sea."},{"name": "Kuksu","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 25.3,"lon": 71.3,"description": "Pomo (N. California, USA) deity who created the world with his brother Madumda."},{"name": "Kuma","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 10.0,"lon": 82.8,"description": "Yaruro (Venezuela) moon goddess, creator of all things."},{"name": "Kumpara","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 9.6,"lon": 32.9,"description": "Jivaro (Ecuador) creator god."},{"name": "[Kun Lun Chasma]","type": "Chasma","theme": "moon","moon_name": "Rhea","lat": 46.0,"lon": 52.5,"description": "Mountain dwelling place of the immortals."},{"name": "Kurkyl","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -39.9,"lon": 246.3,"description": "Chukchi (NE Russia) creator raven."},{"name": "Leza","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -21.8,"lon": 50.8,"description": "Tonga originator of the conditions of life."},{"name": "Ligoupup","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -14.5,"lon": 313.8,"description": "Micronesian (Truk/Chuuk Island, Caroline Islands) earth goddess, created the world together with her husband Anulap, a god of magic and knowledge."},{"name": "Lowa","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 40.9,"lon": 343.4,"description": "Marshall Islands (Micronesia) great creator god."},{"name": "Lowalangi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -36.5,"lon": 110.0,"description": "Nias Island (W. Indonesia) sky god, creator of humans."},{"name": "Luli","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 46.5,"lon": 116.9,"description": "Ember-goose who took up some clay from an ocean floor to create a land in Mansi myth (W. Siberia, Russia)."},{"name": "Lumawig","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 58.0,"lon": 223.5,"description": "Igorot (Luzon Island, Philippines) Great Spirit, created humans from cut reeds."},{"name": "Madumda","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -36.9,"lon": 295.2,"description": "Pomo (N. California, USA) creator of the universe, brother of Kuksu."},{"name": "Maheo","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 31.6,"lon": 78.3,"description": "Cheyenne (Great Plains, USA) Great Spirit, creator of the world."},{"name": "Malunga","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 65.1,"lon": 303.8,"description": "Yao (Bantu); creator god; left Earth to live in sky when man was cruel to animals."},{"name": "Mamaldi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 14.0,"lon": 176.0,"description": "Nanai (Amur River area, E. Siberia, Russia) goddess who created the Asian continent and Sakhalin Island. For this action, she was killed by her husband and world creator, Khado."},{"name": "Manoid","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 29.5,"lon": 351.5,"description": "Negrito (Malay Peninsula) female progenitor goddess; wife of Pedn."},{"name": "Mbir","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 46.6,"lon": 48.1,"description": "Guarani (Paraguay, Argentina, Brazil) creator worm who appeared in pre-existing water, then became a human and made the world."},{"name": "Melo","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -53.2,"lon": 352.9,"description": "Minyong (India); original male."},{"name": "Mubai","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 55.8,"lon": 339.8,"description": "Tibetan heavenly god."},{"name": "Mumbi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -1.9,"lon": 228.8,"description": "Mythological mother of the Kikuyu people (Kenya), wife of Gikuyu, the ancestor of the people, created by god Ngai, who took him on top of Kirinyaga (Mount Kenya) to show all the land given for him."},{"name": "Nainema","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 25.5,"lon": 13.6,"description": "Uitoto (Amazon basin, SW Colombia) creator god."},{"name": "Napi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 26.9,"lon": 185.2,"description": "Blackfoot (Alberta, Canada/Montana, USA) creator of the earth, animals and mankind."},{"name": "Nareau","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -24.9,"lon": 118.1,"description": "Micronesian (Gilbert Islands/Kiribati) creator of the universe; made the world from a mussel shell."},{"name": "Ndu","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -22.4,"lon": 68.7,"description": "Sre and Ma (Mon-Khmer peoples, S. Vietnam) supreme god, created people and fire."},{"name": "Nishanu","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -9.0,"lon": 231.0,"description": "Arikara (N. Dakota, USA) creation spirit, great sky chief."},{"name": "Nishke","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 3.8,"lon": 311.0,"description": "Mordvinian (Volga River Finns, Russia) supreme god, creator of the sky and theEarth."},{"name": "Num","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 24.0,"lon": 267.3,"description": "Nenets and Selkup (Samoyed) god of heaven."},{"name": "Nzame","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 9.0,"lon": 335.1,"description": "Fang (Gabon) sky god and creator of all things."},{"name": "Obatala","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -1.1,"lon": 90.3,"description": "Yoruba (Nigeria) sky god involved in the work of creation."},{"name": "Okikurumi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -17.52,"lon": 109.17,"description": "Ainu (Japan) god of the heavens, who gave the Ainus civilization and taught them hunting and fishing."},{"name": "Olorun","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 24.7,"lon": 204.6,"description": "Yoruba (Nigeria) creator god, gave life to man."},{"name": "Ormazd","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 52.5,"lon": 301.5,"description": "Persian progenitor god of light."},{"name": "Pachacamac","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -23.4,"lon": 276.3,"description": "Inca supreme god, \u201c;Earth maker.\u201c;"},{"name": "Pan Ku","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 65.7,"lon": 252.3,"description": "Miao; creator of all things."},{"name": "Pedn","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 46.0,"lon": 8.3,"description": "Negrito (Malay Peninsula) god who created first men."},{"name": "Pokoh","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -71.7,"lon": 33.6,"description": "Pallawonaps (S. California, USA) deity who made all things."},{"name": "Pouliuli","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -16.9,"lon": 75.6,"description": "The first male being in Hawaiian myth, parent (with Powehiwehi) of all the creatures in the ocean."},{"name": "Powehiwehi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -8.2,"lon": 79.6,"description": "The first female being in Hawaiian myth, parent (with Pouliuli) of all the creatures in the ocean."},{"name": "[Pu Chou Chasma]","type": "Chasma","theme": "moon","moon_name": "Rhea","lat": 26.1,"lon": 264.7,"description": "Mountain attacked by Kung Chung."},{"name": "Pulag Chasma","type": "Chasma","theme": "moon","moon_name": "Rhea","lat": -33.0,"lon": 93.5,"description": "Mount in Igorot (Luzon Island, Philippines) mythology, on the peak of which the palace of creator god Lumawig is located."},{"name": "Puntan","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 33.9,"lon": 67.6,"description": "Chamorro (Guam Island, Micronesia) pre-existent being from whose body the world was formed."},{"name": "Purusa","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -21.2,"lon": 192.2,"description": "Ancient Hindu primordial being from whom the cosmos was formed."},{"name": "Qat","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -23.8,"lon": 8.4,"description": "New Hebrides (Melanesia); born from a stone; formed men out of trees."},{"name": "Quwai","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 19.6,"lon": 294.0,"description": "Cuebo (Columbia) god who created creeks and rocks, and stocked streams with fish."},{"name": "Samni","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -47.7,"lon": 269.3,"description": "Kachins (Burma) primeval god, the male element and father of the gods."},{"name": "Seveki","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 12.9,"lon": 195.3,"description": "Evenki (Siberia, Russia) creator of the earth and man."},{"name": "Shedi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -53.5,"lon": 13.2,"description": "The first woman, ancestor of human race, co-creator (with her brother and husband Melo) of the earth and sky in the myths of the Minyong (Assam, India)."},{"name": "Sholmo","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 12.0,"lon": 13.6,"description": "Buriat (Siberia) devil who creates."},{"name": "Shuzanghu","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -74.9,"lon": 349.7,"description": "Dhammai (NE India) pre-existent male. He and his wife Zumiang-Nui were the parents of the Earth and the sky."},{"name": "Singbonga","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -54.8,"lon": 213.1,"description": "Birhor (Jharkhand, E. India) creator god, who arises out of the primordial waters through the stem of a lotus."},{"name": "Taaroa","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 16.5,"lon": 264.5,"description": "Tahitian god imminent in all creation; existed alone in the void."},{"name": "Talapas","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -16.7,"lon": 18.2,"description": "Coyote, creator of many places and things in Chinook (NW USA) mythology."},{"name": "Tane","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -12.5,"lon": 302.6,"description": "Tuamotu Islands (Polynesia) creator god."},{"name": "Tasheting","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -59.0,"lon": 304.5,"description": "Lapcha (Nepal) god who created the first man and woman from the ice of mountain glaciers."},{"name": "Tawa","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 17.9,"lon": 184.8,"description": "Hopi (Arizona, USA) sun god who existed at the beginning of creation, father of everything."},{"name": "Thunupa","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 45.6,"lon": 338.7,"description": "Inca creator of all things."},{"name": "Tika","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 25.1,"lon": 275.9,"description": "Abkhaz (Georgian - eastern Black Sea region) supreme being."},{"name": "Tirawa","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 34.2,"lon": 208.3,"description": "Great spirit of Pawnee Tribe (USA), created first men; his messengers were the planets, stars, lightning and thunder."},{"name": "Tore","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 0.0,"lon": 20.0,"description": "Pygmy lord of the world, creator of all things."},{"name": "Torom","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -72.5,"lon": 17.0,"description": "Ostyak (western Siberia) sky god."},{"name": "Tsuki-Yomi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 35.0,"lon": 316.2,"description": "Japanese moon god, born from the right eye of the primeval god Izanagi."},{"name": "Tulpar","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 56.1,"lon": 201.4,"description": "Kazakh (Central Asia) winged horse born in the deep primordial ocean; personification of the sun and eternal movement."},{"name": "Tuwale","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -78.0,"lon": 117.6,"description": "Ceram (Molucca Islands, Indonesia) sun god and personification of the sky, took part in creation."},{"name": "Uku","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 78.7,"lon": 264.5,"description": "Estonian super god."},{"name": "Utleygon","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -20.1,"lon": 165.1,"description": "Itelmen (Kamchatka Peninsula, E. Russia) creator and master of the world."},{"name": "Vatea","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 16.0,"lon": 209.6,"description": "Father of gods and humans in Cook Islands mythology (Polynesia)."},{"name": "Vaupas Chasma","type": "Chasma","theme": "moon","moon_name": "Rhea","lat": -35.0,"lon": 100.0,"description": "River in Cuebo (Columbia) myths, where the Cuebo people were born."},{"name": "Wak","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 29.6,"lon": 165.7,"description": "Ethiopian creator god, \u201cFather of the Universe.\u201d"},{"name": "Wakonda","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 48.6,"lon": 90.3,"description": "Sioux (Great Plains, USA) great creator of all things."},{"name": "Wende","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -56.3,"lon": 133.6,"description": "Mossi (Burkina Faso) supreme god who lives in the sun, creator of the heavens and earth."},{"name": "Whanin","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 66.9,"lon": 245.0,"description": "Korean creator of all things."},{"name": "Woyengi","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 13.7,"lon": 65.5,"description": "Ijaw (Nigeria) creatrix who made men out of earth."},{"name": "Wulbari","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 67.0,"lon": 271.1,"description": "Krachi (Ghana) primeval sky god, mate of mother earth."},{"name": "Wuraka","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 25.1,"lon": 356.0,"description": "Kakadu (Australia) ancestor of all people; a giant."},{"name": "Xamba","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 2.1,"lon": 10.3,"description": "Bushman supreme being, creator of all things."},{"name": "Xowalaci","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 2.4,"lon": 303.7,"description": "Joshua (Oregon, USA) creator god."},{"name": "Xu","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 55.0,"lon": 288.1,"description": "Bushman creator."},{"name": "Yamsi Chasmata","type": "Chasma","theme": "moon","moon_name": "Rhea","lat": -28.0,"lon": 79.5,"description": "Lodge of the North Wind in Klamath (NW USA) myth, where the creator god Kemush slept during the creation of the world."},{"name": "Yehl","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 38.0,"lon": 37.6,"description": "The Great Raven, creator and cultural hero in Tlingit (SE Alaska) myths."},{"name": "Yu-Ti","type": "Crater","theme": "moon","moon_name": "Rhea","lat": 50.1,"lon": 278.5,"description": "\u201c;August Personage of Jade\u201c;; supreme primal Chinese god."},{"name": "Zicum","type": "Crater","theme": "moon","moon_name": "Rhea","lat": -50.9,"lon": 248.8,"description": "Assyro/Babylonian primeval goddess from whom came the earth and the heavens, mother of the gods."},{"name": "Achilles","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 0.6,"lon": 215.62,"description": "Son of Peleus and Thetis, commander of the Myrmidons at Troy."},{"name": "Aietes","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -41.44,"lon": 173.77,"description": "Brother of Circe."},{"name": "Ajax","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -28.41,"lon": 258.0,"description": "Greek hero second only to Achilles."},{"name": "Alcinous","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 30.31,"lon": 327.39,"description": "King of Phaeacia, husband of Arete, father of Nausicaa."},{"name": "Amphinomus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -14.87,"lon": 51.3,"description": "A suitor killed by Telemachus, a favorite of Penelope."},{"name": "Anticleia","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 51.31,"lon": 147.63,"description": "Mother of Odysseus."},{"name": "Antinous","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -59.89,"lon": 253.85,"description": "Chief of the wooers; slain by Odysseus."},{"name": "Arete","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -4.67,"lon": 241.0,"description": "Wife of Alcinous, mother of Nausicaa."},{"name": "Circe","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -12.6,"lon": 125.34,"description": "Changed Odysseus' companions into swine."},{"name": "Demodocus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -59.37,"lon": 161.79,"description": "Blind Phaeacian singer."},{"name": "Diomedes","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 38.12,"lon": 250.58,"description": "Son of Tydeus, king of Argos."},{"name": "Dolius","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -30.15,"lon": 329.67,"description": "Old servant of Penelope."},{"name": "Elpenor","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 53.43,"lon": 276.31,"description": "Follower of Odysseus."},{"name": "Euanthes","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 7.86,"lon": 301.09,"description": "Father of Maron."},{"name": "Eumaeus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 23.1,"lon": 128.88,"description": "Faithful swineherd who greets Odysseus, gave him warm cloak and guided him to palace."},{"name": "Eupithes","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 18.71,"lon": 8.79,"description": "Father of Antinous."},{"name": "Eurycleia","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 52.54,"lon": 293.5,"description": "Faithful old nurse of Odysseus."},{"name": "Eurylochus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -5.07,"lon": 152.32,"description": "Odysseus\u2019 second in command."},{"name": "Eurymachus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -35.65,"lon": 115.0,"description": "One of the two leading suitors of Penelope, killed by Odysseus."},{"name": "Halius","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 44.4,"lon": 175.04,"description": "Son of Alcinous and Arete."},{"name": "Hermione","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -38.4,"lon": 31.31,"description": "Daughter of Menelaus and Helen."},{"name": "Icarius","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -5.89,"lon": 234.15,"description": "Father of Penelope."},{"name": "Irus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -27.0,"lon": 295.19,"description": "Ithacan beggar."},{"name": "Laertes","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -46.36,"lon": 112.54,"description": "Father of Odysseus."},{"name": "Leocritus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 21.53,"lon": 61.34,"description": "A suitor of Penelope, killed by Telemachus."},{"name": "Leucothea","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -4.26,"lon": 56.16,"description": "Ino\u2019s name after she became a goddess."},{"name": "Maron","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 2.52,"lon": 60.67,"description": "Son of Euanthes, priest of Apollo at Ismarus."},{"name": "Medon","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 25.5,"lon": 36.69,"description": "Herald of Odysseus in Ithaca."},{"name": "Melanthius","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -58.5,"lon": 347.39,"description": "Disloyal goatherd; insults Odysseus; is slain."},{"name": "Mentor","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 0.25,"lon": 135.84,"description": "Friend of Odysseus."},{"name": "Naubolos","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -72.19,"lon": 234.82,"description": "Father of Euryalos."},{"name": "Nausicaa","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 84.4,"lon": 175.0,"description": "Daughter of Alcinous who advised Odysseus."},{"name": "Neleus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -19.38,"lon": 154.28,"description": "Father of Nestor."},{"name": "Nestor","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -54.0,"lon": 115.19,"description": "A wise old king."},{"name": "Odysseus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 32.82,"lon": 51.11,"description": "Hero of Odyssey."},{"name": "Oenops","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 28.13,"lon": 86.56,"description": "Father of Penelope\u2019s suitor Leodes."},{"name": "Ogygia Chasma","type": "Chasma","theme": "moon","moon_name": "Tethys","lat": 56.0,"lon": 84.8,"description": "Island home of Calypso."},{"name": "Ormenus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -20.39,"lon": 136.15,"description": "Father of Ctesius."},{"name": "Penelope","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -10.83,"lon": 290.78,"description": "Faithful wife of Odysseus."},{"name": "Periboea","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 8.0,"lon": 145.14,"description": "Mother of Nausithous."},{"name": "Phemius","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 11.32,"lon": 253.78,"description": "Minstrel to the wooers; spared by Odysseus."},{"name": "Philoetius","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 2.32,"lon": 355.29,"description": "Faithful herdsman of Odysseus' flock."},{"name": "Polycaste","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 1.38,"lon": 93.59,"description": "Daughter of Nestor."},{"name": "Polyphemus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -3.48,"lon": 257.02,"description": "Cyclops battled by Odysseus."},{"name": "Poseidon","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -55.71,"lon": 78.7,"description": "Son of Cronos, brother of Zeus, god of the sea."},{"name": "Rhexenor","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -75.63,"lon": 114.78,"description": "Brother of Alcinous."},{"name": "Salmoneus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -1.77,"lon": 204.82,"description": "Father of Tyro."},{"name": "Scheria Montes","type": "Mons","theme": "moon","moon_name": "Tethys","lat": 30.0,"lon": 49.0,"description": "Island of the Phaeacians visited by Odysseus on his way home."},{"name": "Teiresias","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 60.39,"lon": 179.17,"description": "Aged prophet; Odysseus consults him among the dead."},{"name": "Telemachus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": 54.0,"lon": 200.62,"description": "Son of Odysseus."},{"name": "Telemus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -34.53,"lon": 183.11,"description": "Prophet of the Cyclops."},{"name": "Theoclymenus","type": "Crater","theme": "moon","moon_name": "Tethys","lat": -14.43,"lon": 334.37,"description": "Fugitive prophet, given refuge on Telemachus\u2019 ship."},{"name": "Abaya Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 73.17,"lon": 134.45,"description": "Lake in Ethiopia."},{"name": "Ahmakiq Undae","type": "Unda","theme": "moon","moon_name": "Titan","lat": 2.22,"lon": 337.3,"description": "Mayan deity who locks up the crop-destroying winds."},{"name": "Akmena Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 85.1,"lon": 124.4,"description": "Lake in Lithuania."},{"name": "Albano Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 65.9,"lon": 303.6,"description": "Lake in Italy."},{"name": "Annecy Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 76.8,"lon": 51.1,"description": "Lake in France."},{"name": "Apanohuaya Flumen","type": "Flumen","theme": "moon","moon_name": "Titan","lat": 84.29,"lon": 242.76,"description": "Mythological river in the Aztec Underworld."},{"name": "Arala Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 78.1,"lon": 55.1,"description": "Lake in Mali."},{"name": "Atitl\u00e1n Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 69.3,"lon": 301.2,"description": "Lake in Guatemala."},{"name": "Balaton Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 82.9,"lon": 92.5,"description": "Lake in Hungary."},{"name": "Bolsena Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 75.75,"lon": 169.72,"description": "Lake in Italy."},{"name": "Bralgu Insulae","type": "Insula","theme": "moon","moon_name": "Titan","lat": 76.2,"lon": 288.5,"description": "Baralku; In Yolngu culture (Arnhem Land, Australia), the island of the dead and the place where the Djanggawul, the three creator siblings, originated."},{"name": "Brienz Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 85.3,"lon": 136.2,"description": "Lake in Switzerland"},{"name": "Buada Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 76.4,"lon": 50.4,"description": "Lake in Nauru."},{"name": "Cardiel Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 70.2,"lon": 333.5,"description": "Lake in Argentina."},{"name": "Cayuga Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 69.8,"lon": 310.0,"description": "Lake in New York, USA."},{"name": "Chapala Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 72.47,"lon": 37.37,"description": "Lake in Mexico."},{"name": "Chilwa Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 75.0,"lon": 48.7,"description": "Lake in Malawi and Mozambique."},{"name": "Crveno Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": -79.55,"lon": 355.09,"description": "Lake in Croatia."},{"name": "Dem Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 75.17,"lon": 41.59,"description": "Lake in Burkina Faso."},{"name": "Dilolo Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 76.2,"lon": 55.0,"description": "Lake in Angola."},{"name": "Dridzis Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 78.9,"lon": 48.7,"description": "Lake in Latvia."},{"name": "Echoriath Montes","type": "Mons","theme": "moon","moon_name": "Titan","lat": -7.4,"lon": 326.2,"description": "Name of a mountain range from Middle-earth, the fictional setting in fantasy novels by J.R.R. Tolkien."},{"name": "Enriquillo Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 71.4,"lon": 302.41,"description": "Lake in the Dominican Republic."},{"name": "Feia Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 73.7,"lon": 115.59,"description": "Lake in Brazil."},{"name": "Fena Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 74.57,"lon": 40.47,"description": "Lake in Guam."},{"name": "Fogo Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 81.9,"lon": 82.0,"description": "Lake in Portugal, Azores."},{"name": "Freeman Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 73.6,"lon": 328.9,"description": "Lake in Indiana, USA."},{"name": "Gatun Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 72.79,"lon": 1.96,"description": "Lake in Panama."},{"name": "Gihon Flumen","type": "Flumen","theme": "moon","moon_name": "Titan","lat": 76.81,"lon": 324.45,"description": "Biblical second River of Paradise, one of four rivers flowing from Eden."},{"name": "Grasmere Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 72.3,"lon": 76.9,"description": "Lake in England."},{"name": "Grumman Labyrinthus","type": "Labyrinthus","theme": "moon","moon_name": "Titan","lat": -35.3,"lon": 73.2,"description": "Planet from the Dune series; where Duncan Idaho first blooded his sword."},{"name": "Hammar Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 48.6,"lon": 231.71,"description": "Lake in Iraq."},{"name": "Hano","type": "Crater","theme": "moon","moon_name": "Titan","lat": 40.3,"lon": 194.9,"description": "Bella Coola (northwestern USA and western Canada) goddess of education, knowledge, and magic. She manifested as a shaman so she could teach the people."},{"name": "Hlawga Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 76.6,"lon": 76.4,"description": "Lake in Myanmar."},{"name": "Ihi","type": "Crater","theme": "moon","moon_name": "Titan","lat": -7.82,"lon": 14.88,"description": "Tahitian goddess of wisdom, worshipped by the learned."},{"name": "Ihotry Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 76.1,"lon": 42.8,"description": "Lake in Madagascar."},{"name": "Imogene Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 71.1,"lon": 68.2,"description": "Lake in Idaho, USA."},{"name": "Jingpo Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 73.0,"lon": 204.0,"description": "Lake in China."},{"name": "Jun\u00edn Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 66.9,"lon": 303.1,"description": "Lake in Peru."},{"name": "Karakul Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 86.3,"lon": 123.4,"description": "Lake in Tajikistan."},{"name": "Kayangan Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": -86.3,"lon": 337.83,"description": "Lake in the Philippines."},{"name": "Kivu Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 87.0,"lon": 59.0,"description": "Lake on the border between Rwanda and The Democratic Republic of the Congo."},{"name": "Koitere Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 79.4,"lon": 143.86,"description": "Lake in Finland."},{"name": "Ladoga Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 74.8,"lon": 153.9,"description": "Lake in Russia."},{"name": "Lagdo Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 75.5,"lon": 54.3,"description": "Lake in Cameroon."},{"name": "Lanao Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 71.0,"lon": 322.3,"description": "Lake in the Philippines."},{"name": "Letas Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 81.3,"lon": 91.8,"description": "Lake in Vanuatu."},{"name": "Logtak Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 70.8,"lon": 313.9,"description": "Lake in Manipur, India."},{"name": "Mackay Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 78.32,"lon": 82.47,"description": "Lake in Australia."},{"name": "Maracaibo Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 75.3,"lon": 52.3,"description": "Lake in Venezuela."},{"name": "Mohini Fluctus","type": "Fluctus","theme": "moon","moon_name": "Titan","lat": -11.78,"lon": 141.47,"description": "Indian goddess of beauty and magic."},{"name": "Momoy","type": "Crater","theme": "moon","moon_name": "Titan","lat": 11.6,"lon": 135.4,"description": "Chumash (California, USA) ancestor shaman and goddess of magic, education, knowledge, health and healing."},{"name": "M\u00fcggel Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 84.44,"lon": 336.5,"description": "Lake in Germany."},{"name": "Muzhwi Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 74.8,"lon": 53.7,"description": "Muzhwi Dam, lake in Zimbabwe."},{"name": "Mweru Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 71.9,"lon": 48.2,"description": "Lake in Zambia and Democratic Republic of the Congo."},{"name": "M\u00fdvatn Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 78.19,"lon": 44.72,"description": "Lake in Iceland."},{"name": "Neagh Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 81.11,"lon": 147.84,"description": "Lake in Northern Ireland, United Kingdom."},{"name": "Negra Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 75.5,"lon": 51.1,"description": "Lake in Uruguay."},{"name": "Ohrid Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 71.8,"lon": 318.1,"description": "Lake on the border of Macedonia and Albania."},{"name": "Olomega Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 78.7,"lon": 57.8,"description": "Lake in El Salvador."},{"name": "Oneida Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 76.14,"lon": 48.17,"description": "Lake in New York, USA."},{"name": "Ontario Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": -72.0,"lon": 357.0,"description": "Lake on the border between Canada and the United States."},{"name": "Phewa Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 72.2,"lon": 56.0,"description": "Lake in Nepal."},{"name": "Pielinen Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 71.34,"lon": 0.34,"description": "Lake in Finland."},{"name": "Prespa Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 73.1,"lon": 44.3,"description": "Lake in the Republic of Macedonia, Albania, and Greece."},{"name": "Qinghai Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 83.4,"lon": 128.5,"description": "Kukunor, Tso Ngonpo; lake in China."},{"name": "Quilotoa Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 80.3,"lon": 59.9,"description": "Lake in Ecuador."},{"name": "Rannoch Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 74.2,"lon": 50.7,"description": "Lake in Scotland."},{"name": "Robino Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 74.28,"lon": 39.54,"description": "Lake in Haiti."},{"name": "Roca Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 79.8,"lon": 56.5,"description": "Lake in Chile and Argentina."},{"name": "Rukwa Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 74.8,"lon": 45.2,"description": "Lake in Tanzania."},{"name": "Rwegura Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 71.5,"lon": 74.8,"description": "Lake in Burundi."},{"name": "Sarygamysh Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 84.64,"lon": 76.08,"description": "Lake in Turkmenistan and Uzbekistan."},{"name": "Sevan Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 69.7,"lon": 314.4,"description": "Lake in Armenia."},{"name": "Shoji Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": -79.74,"lon": 13.63,"description": "Lake in Japan."},{"name": "Sionascaig Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": -41.52,"lon": 261.88,"description": "Lake in Scotland."},{"name": "Soi","type": "Crater","theme": "moon","moon_name": "Titan","lat": 24.3,"lon": 39.1,"description": "Melanesian (New Ireland Island, Papua New Guinea) god of wisdom."},{"name": "Sotonera Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 76.75,"lon": 162.51,"description": "Lake in Spain."},{"name": "[Sotra Facula]","type": "Facula","theme": "moon","moon_name": "Titan","lat": -12.5,"lon": 140.2,"description": "Norwegian island."},{"name": "Sparrow Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 84.3,"lon": 115.3,"description": "Lake in Canada."},{"name": "Suwa Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 74.1,"lon": 44.8,"description": "Lake in Japan."},{"name": "Synevyr Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 81.0,"lon": 126.4,"description": "Lake in Ukraine."},{"name": "Taupo Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 72.7,"lon": 47.4,"description": "Lake in New Zealand."},{"name": "Tengiz Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 73.2,"lon": 74.4,"description": "Lake in Kazakhstan."},{"name": "Tibi Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 76.65,"lon": 44.25,"description": "Lake in Sierra Leone."},{"name": "Toba Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 70.9,"lon": 71.9,"description": "Lake in Indonesia."},{"name": "Totak Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 74.03,"lon": 314.01,"description": "Lake in Norway."},{"name": "Towada Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 71.4,"lon": 295.8,"description": "Lake in Japan."},{"name": "Trichonida Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 81.3,"lon": 114.7,"description": "Lake in Greece."},{"name": "Tsomgo Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": -86.37,"lon": 17.59,"description": "Tsongmo, Changu; Lake in India."},{"name": "Urmia Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": -39.27,"lon": 263.45,"description": "Lake in Iran."},{"name": "Uvs Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 69.6,"lon": 294.3,"description": "Lake in Mongolia."},{"name": "Vaca Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 77.0,"lon": 48.07,"description": "Lake in Belize."},{"name": "V\u00e4nern Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 70.4,"lon": 316.9,"description": "Lake in Sweden."},{"name": "Van Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 74.2,"lon": 42.7,"description": "Lake in Turkey."},{"name": "Viedma Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 72.0,"lon": 54.3,"description": "Lake in Argentina."},{"name": "Waikare Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 81.6,"lon": 54.0,"description": "Lake in New Zealand."},{"name": "Weija Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 68.77,"lon": 212.32,"description": "Lake in Ghana."},{"name": "Winnipeg Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 78.05,"lon": 26.69,"description": "Lake in Canada."},{"name": "Xolotl\u00e1n Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 82.3,"lon": 107.1,"description": "Managua; lake in Nicaragua."},{"name": "Yessey Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 73.0,"lon": 69.2,"description": "Lake in Siberia (Evenkia, Asiatic Russia)."},{"name": "Yojoa Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 78.1,"lon": 125.9,"description": "Lake in Honduras."},{"name": "Ypoa Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 73.4,"lon": 47.8,"description": "Lake in Paraguay."},{"name": "Zaza Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 72.4,"lon": 73.1,"description": "Lake in Cuba."},{"name": "Zub Lacus","type": "Lacus","theme": "moon","moon_name": "Titan","lat": 71.7,"lon": 77.4,"description": "Lake in Antarctica."}];
    dedupeMoonFeatureData();
    const allFeatureData = [...labelData, ...ringLabelData, ...moonData, ...moonFeatureData];
    allFeatureData.forEach((item) => {
      item.name = getFeatureDisplayName(item);
    });
    const TOUR_FACETS = [
      { id: "highlights", label: "Highlights", filter: (item) => ["North Polar Hexagon", "Great White Spot", "Cassini Grand Finale Track", "Titan", "Enceladus", "Cassini Division"].includes(item.name) },
      { id: "atmosphere", label: "Atmosphere", filter: (item) => ["polar", "band", "storm"].includes(item.theme) },
      { id: "rings", label: "Rings", filter: (item) => item.theme === "ring" || Boolean(item.ring_region) },
      { id: "moons", label: "Moons", filter: (item) => Array.isArray(item.moon_anchor) },
      { id: "mission", label: "Mission", filter: (item) => item.theme === "landing" || /cassini|huygens/i.test(`${item.name} ${item.description || ""}`) },
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
          setTimeout(() => tourModeSection?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
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
    const coreViewSection = document.getElementById("core-view-section");
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
    const legendSectionBody = legendPanel ? legendPanel.closest(".section-body") : null;
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
    let viewerApplySaturnViewMode = null;
    let viewerSyncSelectionHalo = null;
    let activeMoonViewerFeature = null;
    let moonMeshMap = null;
    let moonFeatureTypeFilter = "all";
    let activeMoonFeatureTour = null;
    let activeMoonFeatureSearchResults = [];
    let activeMoonFeatureSearchIndex = -1;
    let saturnSceneGroup = null;
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
      const baseName = String(currentProfilePlotState.title || "saturn_elevation_profile")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "saturn_elevation_profile";
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
    // Moons whose texture has lon=0° (prime meridian / sub-Saturn) at the IMAGE CENTER rather
    // than the left edge. All feature coordinates are stored in a unified left-edge CRS
    // (lon=0° = left edge of the image) so no per-feature lon correction is needed.
    // The only effect of this set is the tidal-lock rotation: π−angle instead of −angle,
    // which places the texture center (local +X, sub-Saturn face) toward Saturn.
    const TEXTURE_CENTERED_MOONS = new Set(["Tethys", "Titan", "Phoebe"]);
    // Moons whose texture has east running right-to-left (mirrored); store lon_W, display is identity.
    const WEST_POSITIVE_TEXTURE_MOONS = new Set(["Hyperion"]);
    // Real sidereal periods (days). Negative = retrograde (Phoebe).
    const MOON_PERIODS_DAYS = {
      "Pan": 0.5749, "Daphnis": 0.5940, "Atlas": 0.6017, "Prometheus": 0.6130,
      "Pandora": 0.6285, "Epimetheus": 0.6942, "Janus": 0.6945, "Aegaeon": 0.8081,
      "Methone": 1.0096, "Anthe": 1.0365, "Pallene": 1.1538, "Mimas": 0.9424,
      "Enceladus": 1.3702, "Telesto": 1.8878, "Tethys": 1.8878, "Calypso": 1.8878,
      "Dione": 2.7369, "Helene": 2.7369, "Polydeuces": 2.7369, "Rhea": 4.5175,
      "Titan": 15.9454, "Hyperion": 21.2766, "Iapetus": 79.3302, "Phoebe": -550.31,
    };
    // Self-rotation periods (days) for moons that are NOT tidally locked.
    // Hyperion tumbles chaotically (~13 d nominal); Phoebe rotates in 0.38638 d (9.273 h).
    const MOON_SELF_ROT_DAYS = { "Hyperion": 13.0, "Phoebe": 0.38638 };
    // Globe completes one rotation every 600,000 ms (10 min).
    // Saturn's real sidereal day: 10 h 33 m 38 s = 10.5606 h (IAU).
    const _SATURN_DISPLAY_PERIOD_MS = 600000;
    const _SATURN_ROT_REAL_MS = 10.5606 * 3600000; // 38,018,160 ms
    const _MOON_SPEED_FACTOR = _SATURN_ROT_REAL_MS / _SATURN_DISPLAY_PERIOD_MS; // ≈ 63.36×
    // In moon viewer the focused moon's self-rotation uses this fixed display period so
    // surface features visibly sweep across the sphere (matches Mars viewer cadence).
    const _MOON_VIEWER_SELF_ROT_PERIOD_MS = 186000; // ≈ 3.1 min, same visual rate as Mars Phobos

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
      // Major moons — mission-derived maps
      Mimas:      "assets/mimas_color_map.jpg",
      Enceladus:  "assets/enceladus_color_map.jpg",
      Tethys:     "assets/tethys_color.jpg",
      Dione:      "assets/Dione_Color_Map.jpg",
      Rhea:       "assets/rhea_color_map.jpg",
      Titan:      "assets/titan_color_map.jpg",
      Iapetus:    "assets/iapetus_color_map.jpg",
      Hyperion:   "assets/hyperion_color_map.jpg",
      Phoebe:     "assets/phoebe_color_map.jpg",
      // Mid-sized inner moons — individual Cassini-derived maps
      Epimetheus: "assets/epimetheus_color_map.jpg",
      Janus:      "assets/janus_color_map.jpg",
      Prometheus: "assets/prometheus_color_map.jpg",
      // Trojan / shepherd moons — generic icy surface stand-in
      Pandora:    "assets/pandora_color_map.jpg",
      Pan:        "assets/pan_color_map.jpg",
      Atlas:      "assets/atlas_color_map.jpg",
      Helene:     "assets/helene_color_map.jpg",
      Calypso:    "assets/calypso_color_map.jpg",
      Telesto:    "assets/telesto_color_map.jpg",
      Daphnis:    "assets/daphnis_color_map.jpg",
    };
    let currentMetadataState = null;
    let activeCutClipPlane = null;
    const MARS_MEAN_RADIUS_KM = 58232.0;
    const SATURN_MEAN_RADIUS_KM = MARS_MEAN_RADIUS_KM;
    let activeCameraFlight = null;
    const saturnViewModeSelect = document.getElementById("saturn-view-mode");
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
      let kmPerWorldUnit = SATURN_MEAN_RADIUS_KM / SATURN_SCENE_RADIUS;
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
    function configureSaturnUi() {
      if (brandLogo) {
        brandLogo.src = "../../../assets/saturn_icon.png";
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
        if (copy) copy.textContent = "Use this group for Saturn's body texture and derived atmospheric analysis layers.";
      }
      const terrainRow = terrainScale ? terrainScale.closest(".row") : null;
      if (terrainRow) terrainRow.style.display = "none";
      const geologySection = geologyToggle ? geologyToggle.closest(".control-section") : null;
      if (geologySection) {
        const geologyTitle = geologySection.querySelector(".section-title");
        const geologySummary = geologySection.querySelector(".section-toggle-main .section-summary-copy");
        if (geologyTitle) geologyTitle.textContent = "Remove Atmosphere";
        if (geologySummary) geologySummary.textContent = "Hide Saturn's upper atmospheric shells in core view.";
        geologyOpacity.closest(".row").style.display = "none";
        geologyContactsToggle.closest(".row").style.display = "none";
        geologyStructuresToggle.closest(".row").style.display = "none";
        mineralSelect.closest(".row").style.display = "none";
        mineralOpacity.closest(".row").style.display = "none";
        const summaryBlocks = geologySection.querySelectorAll(".section-summary-copy.is-left");
        if (summaryBlocks[0]) summaryBlocks[0].textContent = "Core cutaway";
        if (summaryBlocks[1]) summaryBlocks[1].style.display = "none";
        const compactCopy = geologySection.querySelector(".compact-copy");
        if (compactCopy) compactCopy.textContent = "Remove the upper atmosphere and surface maps in both exterior and core views, while keeping Saturn\'s deeper interior and rings visible.";
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
      if (saturnViewModeSelect) saturnViewModeSelect.value = "tilted";
    }
    configureSaturnUi();
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
        id: "upper-atmosphere",
        name: "Upper Atmosphere",
        type: "Cloud tops and haze",
        description: "Saturn's visible outer shell is the upper atmosphere: ammonia clouds, haze layers, zonal banding, and storm systems seen at the top of the deep hydrogen-helium envelope.",
        depth: "Cloud tops through the upper troposphere",
        composition: "Hydrogen and helium with ammonia ice, ammonium hydrosulfide, water-cloud layers below, and photochemical haze above.",
        temperature: "~80-140 K near the visible cloud deck",
        labelX: -1.9, labelY: 3.12,
        anchorY: 3.12,
      },
      {
        id: "molecular-envelope",
        name: "Molecular Envelope",
        type: "Deep H2-He fluid shell",
        description: "Most of Saturn's volume is a convecting molecular hydrogen-helium envelope where pressure rises steadily inward and weather gives way to deep fluid dynamics.",
        depth: "Outer atmosphere to the metallic transition",
        composition: "Mostly molecular hydrogen and helium with dissolved heavier elements and cloud-forming volatiles.",
        temperature: "Rises from the upper atmosphere into the thousands of kelvin at depth",
        labelX: -2.35, labelY: 2.26,
        anchorY: 2.26,
      },
      {
        id: "metallic-hydrogen",
        name: "Metallic Hydrogen Layer",
        type: "Conductive deep interior",
        description: "At extreme pressure, hydrogen is expected to enter a metallic state. This electrically conductive layer likely powers Saturn's magnetic field and dominates the deep interior.",
        depth: "Broad deep shell around the central heavy-element region",
        composition: "Metallic hydrogen with helium and heavier-element material mixed into the deep interior.",
        temperature: "Several thousand kelvin under immense pressure",
        labelX: -1.65, labelY: 1.36,
        anchorY: 1.36,
      },
      {
        id: "heavy-element-core",
        name: "Heavy-Element Core",
        type: "Diffuse rock-ice-rich center",
        description: "Saturn likely contains a central concentration of rocks, ices, and metals, but current models suggest it may be diffuse and partially mixed outward rather than a sharply bounded solid core.",
        depth: "Central region",
        composition: "Silicates, metals, and ices mixed with surrounding hydrogen under deep-interior conditions.",
        temperature: "Hot dense interior; model dependent",
        labelX: -0.55, labelY: 0,
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

    function createCalibratedSaturnRingTexture(baseTexture = null, outerRadiusKm = SATURN_RING_REFERENCE_KM.mainOuter) {
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

          if (r >= kmToUnit(SATURN_RING_REFERENCE_KM.dInner) && r <= 1) {
            const noise =
              0.5
              + 0.25 * Math.sin(r * 980)
              + 0.13 * Math.sin(r * 2740 + 1.7)
              + 0.06 * Math.sin((x * 0.019) + (y * 0.013));

            if (r < kmToUnit(SATURN_RING_REFERENCE_KM.cInner)) {
              alpha = 0.16 * smoothBand(r, SATURN_RING_REFERENCE_KM.dInner, SATURN_RING_REFERENCE_KM.cInner, 260);
              shade = 72 + 28 * noise;
            } else if (r < kmToUnit(SATURN_RING_REFERENCE_KM.bInner)) {
              alpha = 0.36 * smoothBand(r, SATURN_RING_REFERENCE_KM.cInner, SATURN_RING_REFERENCE_KM.bInner, 220);
              shade = 82 + 42 * noise;
            } else if (r < kmToUnit(SATURN_RING_REFERENCE_KM.cassiniInner)) {
              alpha = 0.9 * smoothBand(r, SATURN_RING_REFERENCE_KM.bInner, SATURN_RING_REFERENCE_KM.cassiniInner, 190);
              shade = 150 + 74 * noise;
            } else if (r < kmToUnit(SATURN_RING_REFERENCE_KM.aInner)) {
              alpha = 0.18 * smoothBand(r, SATURN_RING_REFERENCE_KM.cassiniInner, SATURN_RING_REFERENCE_KM.aInner, 120);
              shade = 35 + 28 * noise;
            } else if (r < kmToUnit(SATURN_RING_REFERENCE_KM.aOuter)) {
              alpha = 0.68 * smoothBand(r, SATURN_RING_REFERENCE_KM.aInner, SATURN_RING_REFERENCE_KM.aOuter, 160);
              shade = 126 + 62 * noise;
              alpha *= narrowGap(r, SATURN_RING_REFERENCE_KM.enckeCenter, 325, 0.025);
              shade *= narrowGap(r, SATURN_RING_REFERENCE_KM.enckeCenter, 325, 0.18);
              alpha *= narrowGap(r, SATURN_RING_REFERENCE_KM.keelerCenter, 90, 0.04);
              shade *= narrowGap(r, SATURN_RING_REFERENCE_KM.keelerCenter, 90, 0.22);
            } else if (r < kmToUnit(SATURN_RING_REFERENCE_KM.fRing - 450)) {
              alpha = 0.12 * smoothBand(r, SATURN_RING_REFERENCE_KM.aOuter, SATURN_RING_REFERENCE_KM.fRing - 450, 140);
              shade = 40 + 28 * noise;
            } else if (r < kmToUnit(SATURN_RING_REFERENCE_KM.fRing + 650)) {
              alpha = 0.62 * smoothBand(r, SATURN_RING_REFERENCE_KM.fRing - 450, SATURN_RING_REFERENCE_KM.fRing + 650, 90);
              shade = 158 + 48 * noise;
            } else {
              alpha = 0.04 * smoothBand(r, SATURN_RING_REFERENCE_KM.fRing + 650, SATURN_RING_REFERENCE_KM.mainOuter, 190);
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
          help: "Saturn does not include a Mars-style seismic event overlay in this package.",
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
      const entries = [];
      const removeAtmosphere = Boolean(geologyToggle && geologyToggle.checked);
      const coreActive = Boolean(coreToggle && coreToggle.checked);

      if (removeAtmosphere && !coreActive) {
        entries.push({
          title: "",
          copy: "",
          tags: [],
          symbols: [
            {
              type: "swatch",
              label: "Metallic Hydrogen Layer Surface",
              detail: "High-pressure hydrogen likely becomes electrically conductive at depth, shown here as the inner amber shell.",
              color: "#b7a789",
            },
          ],
        });
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
          `No active seismic catalog is used for Saturn in this workflow.`,
        );
      }
      if (coreEnabled) {
        pushActiveLayer(
          "Interior cutaway",
          "core",
          selectedBaseLayer,
          "Interior layers are a schematic Saturn model inferred from gravity, magnetic-field, and ring-seismology studies.",
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
          copy: "Use the source pages below for the enhanced atmosphere layer and related Saturn context references.",
          citation: manifest.sources.geology_original_units_citation || "",
          links: [
            makeMetadataLink("Saturn facts", manifest.sources.geology_notes_url),
            makeMetadataLink("Reference page", manifest.sources.geology_dmu_url),
            makeMetadataLink("Texture page", manifest.sources.geology_map_url),
            makeMetadataLink("Context source", manifest.sources.geology_database_url),
          ].filter(Boolean),
        });
      }
      if (seismicActive && manifest.seismic?.source_page_url) {
        sourceEntries.push({
          title: "Seismic catalog source",
          copy: "No Mars-style seismic catalog is used for this Saturn workflow.",
          links: [makeMetadataLink("Catalog source", manifest.seismic.source_page_url)].filter(Boolean),
        });
      }
      sourceEntries.push({
        title: "Moon nomenclature",
        copy: "Saturn moon feature names, locations, and classifications are derived from the IAU Working Group for Planetary System Nomenclature gazetteer, as maintained by the USGS Astrogeology Science Center.",
        links: [makeMetadataLink("USGS Planetary Nomenclature", "https://planetarynames.wr.usgs.gov/")],
      });
      sourceEntries.push({
        title: "Saturn radio emissions",
        copy: "NASA sonification of radio emissions from Saturn and Enceladus.",
        links: [makeMetadataLink("Sound of Saturn", "https://science.nasa.gov/resource/sound-of-saturn-radio-emissions-of-the-planet-and-enceladus/")],
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
        empty.textContent = "Enable geology, mineral, paleo-sea, region masks, or seismic overlays to populate the legend.";
        legendPanel.appendChild(empty);
        legendSummaryCopy.textContent = "Active overlay symbologies and legend images.";
        return;
      }

      legendSummaryCopy.textContent = `${entries.length} active legend ${entries.length === 1 ? "entry" : "entries"} for the current overlays.`;
      for (const entry of entries) {
        const card = document.createElement("section");
        card.className = "legend-entry";
        if (entry.title) {
          const title = document.createElement("p");
          title.className = "layer-type-badge";
          title.textContent = entry.title;
          card.appendChild(title);
        }
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
      if (!query) {
        clearMoonFeatureSearchResults();
        return;
      }
      const results = moonFeatureData
        .filter((f) => f.moon_name === moonName && f.name.toLowerCase().includes(query))
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
      document.documentElement.removeAttribute("data-mode");
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
      if (!isMoonFeature(feature) || !saturnSceneGroup) {
        return;
      }
      document.documentElement.setAttribute("data-mode", "moon");
      if (moonViewerSection) {
        setTimeout(() => moonViewerSection.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      }
      cancelCameraFlight();
      resumeSpin();
      if (tourModeToggle?.checked) {
        activeTourFeature = null;
        tourModeToggle.checked = false;
        if (tourModeControls) tourModeControls.style.display = "none";
        if (tourModeSection) tourModeSection.open = false;
      }
      activeMoonViewerFeature = feature;
      controls.minDistance = getMoonViewerMinDistance(feature);
      controls.maxDistance = getMoonViewerMaxDistance(feature);
      const localTarget = new THREE.Vector3(feature.moon_anchor[0], feature.moon_anchor[1], feature.moon_anchor[2]);
      const target = saturnSceneGroup.localToWorld(localTarget.clone());
      const direction = target.clone().normalize();
      if (direction.lengthSq() < 0.0001) {
        direction.set(0.55, 0.18, 1).normalize();
      }
      // Offset the entry angle so Saturn isn't dead-centre behind the moon.
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
            <h2 style="margin:0 0 0.6rem;">Saturn viewer could not start.</h2>
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
        return "Saturn";
      }
      return "Saturn";
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

    // Saturn surface-conditions estimation helpers
    const _SUN_DIR = new THREE.Vector3(8, 4, 6).normalize();
    function estimateSaturnCloudTopTemp(latDeg) {
      // Saturn cloud tops at 1 bar: ~-178°C at equator, colder toward poles
      const latRad = Math.abs(latDeg) * (Math.PI / 180);
      return Math.round(-178 - 14 * Math.pow(Math.sin(latRad), 2));
    }
    function estimateSaturnCloudTopPressure() {
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

    // Saturn interior model — rFrac = 0 (centre) → 1 (surface)
    const SATURN_INTERIOR_LAYERS = [
      { name: "Heavy-Element Core",     rMin: 0.000, rMax: 0.160 },
      { name: "Metallic Hydrogen Layer", rMin: 0.160, rMax: 0.420 },
      { name: "Molecular Envelope",      rMin: 0.420, rMax: 0.850 },
      { name: "Upper Atmosphere",        rMin: 0.850, rMax: 1.000 },
    ];
    const SATURN_INTERIOR_T_PTS = [[0.000, 25000], [0.160, 20000], [0.420, 12000], [0.850, 2000], [1.000, -134]];
    const SATURN_INTERIOR_P_PTS = [[0.000, 20000], [0.160, 1500],  [0.420, 200],   [0.850, 1.0],  [1.000, 0.0001]];
    function _saturnInteriorInterp(pts, rFrac) {
      const r = Math.max(0, Math.min(1, rFrac));
      for (let i = 0; i < pts.length - 1; i++) {
        const [r0, v0] = pts[i], [r1, v1] = pts[i + 1];
        if (r >= r0 && r <= r1) return v0 + ((r - r0) / (r1 - r0)) * (v1 - v0);
      }
      return pts[pts.length - 1][1];
    }
    function saturnInteriorLayerName(rFrac) {
      for (const layer of SATURN_INTERIOR_LAYERS) {
        if (rFrac >= layer.rMin && rFrac <= layer.rMax) return layer.name;
      }
      return "Unknown";
    }
    function saturnInteriorTempC(rFrac) { return Math.round(_saturnInteriorInterp(SATURN_INTERIOR_T_PTS, rFrac)); }
    function saturnInteriorPressureGPa(rFrac) { return Math.round(_saturnInteriorInterp(SATURN_INTERIOR_P_PTS, rFrac) * 10) / 10; }
    function saturnInteriorLayerColor(name) {
      return { "Upper Atmosphere": "#d0b18a", "Molecular Envelope": "#a29378", "Metallic Hydrogen Layer": "#c0c6cf", "Heavy-Element Core": "#8d9fbe" }[name] ?? "#ccc";
    }
    function saturnInteriorTempColor(tempC) {
      const t = Math.max(0, Math.min(1, (tempC + 134) / 25134));
      if (t < 0.33) { const f = t / 0.33; return `rgb(${Math.round(f*60)},${Math.round(f*200)},${Math.round(255-f*55)})`; }
      if (t < 0.66) { const f = (t-0.33)/0.33; return `rgb(${Math.round(60+f*195)},${Math.round(200-f*60)},${Math.round(200-f*200)})`; }
      const f = (t-0.66)/0.34; return `rgb(255,${Math.round(140-f*140)},0)`;
    }
    function saturnInteriorPressureColor(gpa) {
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
      const parentMoon = getMoonFeatureParent(feature);
      const isMoonScopedTarget = isMoonFeature(feature) || Boolean(parentMoon);
      if (!isMoonScopedTarget) {
        pauseSpin();
      }
      if (!isMoonScopedTarget && activeMoonViewerFeature) {
        deactivateMoonViewer(camera, controls);
      }
      if (isMoonFeature(feature)) {
        if (!options.isTour) {
          activateMoonViewer(feature, camera, controls);
          return;
        }
        // Tour mode: orbit the moon without switching to moon viewer
        resumeSpin();
        if (saturnSceneGroup) {
          const _tourTarget = saturnSceneGroup.localToWorld(
            new THREE.Vector3(feature.moon_anchor[0], feature.moon_anchor[1], feature.moon_anchor[2])
          );
          const _dir = _tourTarget.clone().normalize();
          if (_dir.lengthSq() < 0.0001) _dir.set(0.55, 0.18, 1);
          _dir.normalize();
          const _side = new THREE.Vector3().crossVectors(_dir, new THREE.Vector3(0, 1, 0)).normalize();
          if (_side.lengthSq() > 0.0001) _dir.addScaledVector(_side, 0.4).addScaledVector(new THREE.Vector3(0, 1, 0), 0.15).normalize();
          const _pos = _tourTarget.clone().addScaledVector(_dir, getMoonViewerDistance(feature));
          if (options.animate) {
            animateCameraFlight(camera, controls, _pos, _tourTarget, options.durationMs || 1800, options.onComplete || null);
          } else {
            camera.position.copy(_pos);
            camera.up.set(0, 1, 0);
            controls.target.copy(_tourTarget);
            controls.object.position.copy(camera.position);
            controls.update();
            options.onComplete?.();
          }
        }
        return;
      }
      if (parentMoon) {
        const lat = feature.lat !== undefined ? feature.lat : feature.anchor_lat;
        const lon = feature.lon !== undefined ? feature.lon : feature.anchor_lon;
        if (!parentMoon || !saturnSceneGroup || !Array.isArray(parentMoon.moon_anchor) || lat === undefined || lon === undefined) {
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
        const target = saturnSceneGroup.localToWorld(targetLocal.clone());
        const moonCenter = saturnSceneGroup.localToWorld(moonAnchor.clone());
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
        if (saturnSceneGroup) {
          target = saturnSceneGroup.localToWorld(target.clone());
        }
      } else if (Array.isArray(feature.moon_anchor)) {
        target = new THREE.Vector3(feature.moon_anchor[0], feature.moon_anchor[1], feature.moon_anchor[2]);
        if (saturnSceneGroup) {
          target = saturnSceneGroup.localToWorld(target.clone());
        }
      } else {
        const lat = feature.lat !== undefined ? feature.lat : feature.anchor_lat;
        const lon = feature.lon !== undefined ? feature.lon : feature.anchor_lon;
        if (lat === undefined || lon === undefined) {
          return;
        }
        target = latLonToVector3(lat, lon, 3.2);
        const _spinDelta = getSpinTime() * (2 * Math.PI / _SATURN_DISPLAY_PERIOD_MS);
        target.applyAxisAngle(new THREE.Vector3(0, 1, 0), _spinDelta);
        if (saturnSceneGroup) {
          target = saturnSceneGroup.localToWorld(target.clone());
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
      const saturnCenter = new THREE.Vector3(0, 0, 0);
      if (options.animate) {
        if (options.isTour && !Array.isArray(feature.ring_anchor)) {
          // Fly camera to face the feature but keep orbit centre at Saturn so navigation stays natural.
          animateTourFlight(camera, controls, cameraPosition, saturnCenter, 2800, options.onComplete || null);
        } else {
          animateCameraFlight(camera, controls, cameraPosition, target, options.durationMs || 1800, options.onComplete || null);
        }
      } else {
        camera.position.copy(cameraPosition);
        camera.up.set(0, 1, 0);
        controls.object.position.copy(camera.position);
        controls.target.copy(options.isTour ? saturnCenter : target);
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
      viewerSyncSelectionHalo?.();
      if (featureSearch) featureSearch.value = "";
      clearFeatureSearchResults(true);
      setStatus("Returned to the default global view.");
    }

    function reloadToDefaultGlobalView(camera, controls) {
      resumeSpin();
      resetExploreView(camera, controls);
      viewerApplySaturnViewMode?.(saturnViewModeSelect ? saturnViewModeSelect.value : "tilted");
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

    let _prevLegendEntryCount = 0;
    function syncInfoPanels(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState = null) {
      if (coreViewSection) coreViewSection.open = coreToggle.checked;
      const coreActive = coreToggle.checked;
      const removeAtmosphere = Boolean(geologyToggle && geologyToggle.checked);
      const _upperAtmRow = document.getElementById("core-layer-upper-atmosphere");
      const _molEnvRow = document.getElementById("core-layer-molecular-envelope");
      if (_upperAtmRow) _upperAtmRow.hidden = removeAtmosphere;
      if (_molEnvRow) _molEnvRow.hidden = removeAtmosphere;
      if (surfaceConditionsEl) surfaceConditionsEl.hidden = coreActive;
      if (interiorConditionsEl) {
        interiorConditionsEl.hidden = !coreActive;
        if (!coreActive && icDepth) {
          icDepth.textContent = "—"; icLayer.textContent = "—";
          icTemp.textContent = "—"; icPressure.textContent = "—";
        }
      }
      const legendEntries = buildLegendEntries(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      if (legendSection) {
        if (legendEntries.length > 0 && _prevLegendEntryCount === 0) {
          legendSection.open = true;
        } else if (legendEntries.length === 0 && _prevLegendEntryCount > 0) {
          legendSection.open = false;
        }
      }
      _prevLegendEntryCount = legendEntries.length;
      renderLegendPanel(legendEntries);
      currentMetadataState = buildMetadataState(baseLayers, geologyLayers, mineralLayers, geologyInteractiveState);
      metadataButton.textContent = currentMetadataState?.sections?.some((section) => section.title === "Legend")
        ? "Open Metadata And Legend"
        : "Open Metadata";
      if (!metadataModal.hidden) {
        renderMetadataModal(currentMetadataState);
      }
    }

    function openFeature(feature, isCoreLabel) {
      syncScenePopupSelectionStyle(feature, Boolean(isCoreLabel));
      if (isCoreLabel) {
        scenePopupKicker.textContent = feature.type || "Selected Feature";
      } else {
        scenePopupKicker.textContent = feature.type || (
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

      const geometry = new THREERef.BufferGeometry();
      geometry.setAttribute("position", new THREERef.BufferAttribute(positions, 3));
      const material = new THREERef.PointsMaterial({
        color: 0xf3f7ff,
        size: 0.55,
        sizeAttenuation: true,
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

    // ── CRUST: basaltic shell with fracture provinces and buried dikes ─────
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
        vec3 mist = vec3(0.98,0.96,0.91);
        vec3 cream = vec3(0.90,0.81,0.67);
        vec3 warm = vec3(0.79,0.66,0.51);
        vec3 shadow = vec3(0.63,0.50,0.37);
        vec3 col = mix(shadow, warm, bulk * 0.46 + plumeB * 0.10);
        col = mix(col, cream, overturn * 0.34 + cells * 0.08);
        col = mix(col, mist, wisps * 0.14 + weakBands * 0.08);
        float haze = pow(1.0 - abs(dot(nn, vec3(0.0,0.0,1.0))), 1.8);
        col += vec3(0.13,0.12,0.10) * haze * 0.28;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    // ── MANTLE: coherent plume heads, sinking slabs, and shear bands ───────
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

    // ── OUTER CORE: static convection cells and iron-sulfur circulation ────
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
        vec3 deep  = vec3(0.30,0.28,0.25);
        vec3 mid   = vec3(0.48,0.43,0.36);
        vec3 bright= vec3(0.67,0.60,0.49);
        vec3 pale  = vec3(0.85,0.80,0.68);
        vec3 col = mix(deep, mid, flow);
        col = mix(col, bright, bands * 0.26);
        col = mix(col, pale, walls * 0.22);
        float sheen = pow(1.0 - abs(dot(nn, vec3(0.0,0.0,1.0))), 3.0);
        col += vec3(0.28,0.28,0.24) * sheen * 0.28;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    // ── INNER CORE: dense crystalline metal with central heat glow (static) ──
    const INNER_CORE_FRAG = `
      varying vec2 vUv;
      varying vec3 vNormal;
      ${GLSL_NOISE}
      void main(){
        vec2 p = (vUv - 0.5) * 2.0;
        float base = fbm(vUv * 6.0 + vec2(1.8, 4.2));
        float grain = ridged(vUv * 10.0 + vec2(6.1, 2.7));
        float veins = pow(abs(sin((p.x + p.y) * 6.0 + fbm(vUv * 7.0) * 3.0)), 9.0);
        vec3 dark = vec3(0.45,0.40,0.33);
        vec3 mid  = vec3(0.61,0.56,0.47);
        vec3 pale = vec3(0.73,0.69,0.58);
        vec3 ice  = vec3(0.83,0.82,0.76);
        vec3 col = mix(dark, mid, base);
        col = mix(col, pale, grain * 0.34);
        col = mix(col, ice, veins * 0.14);
        float center = pow(clamp(1.0 - length(p), 0.0, 1.0), 2.2);
        col += vec3(0.06,0.05,0.04) * center * 0.12;
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
        vec3 mist = vec3(0.99,0.97,0.92);
        vec3 cream = vec3(0.96,0.90,0.78);
        vec3 honey = vec3(0.90,0.78,0.61);
        vec3 warm = vec3(0.80,0.67,0.50);
        vec3 shadow = vec3(0.63,0.51,0.38);
        vec3 col = mix(shadow, warm, bulk * 0.26 + cells * 0.04);
        col = mix(col, honey, overturn * 0.34);
        col = mix(col, cream, weakBands * 0.26 + strongBands * 0.14 + pow(max(plumes - 0.56, 0.0) * 2.0, 1.4) * 0.12);
        col = mix(col, mist, smoothstep(0.70, 0.99, r) * 0.30 + polarFade * 0.05);
        col += vec3(0.12,0.10,0.07) * smoothstep(0.84, 1.0, r);
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
        vec3 deep  = vec3(0.30,0.28,0.25);
        vec3 mid   = vec3(0.48,0.43,0.36);
        vec3 bright= vec3(0.67,0.60,0.49);
        vec3 pale  = vec3(0.85,0.80,0.68);
        vec3 col = mix(deep, mid, bulk);
        col = mix(col, bright, bands * 0.22);
        col = mix(col, pale, walls * 0.18);
        col *= 1.0 - smoothstep(0.88, 1.02, r) * 0.10;
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
      const SATURN_HEAVY_CORE_RADIUS = 0.22;
      const SATURN_METALLIC_HYDROGEN_RADIUS = 0.58;
      const SATURN_MOLECULAR_ENVELOPE_RADIUS = 0.96;
      
      // ── Inner core: dense crystalline metallic interior ───────────────────
      const innerCoreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * SATURN_HEAVY_CORE_RADIUS, 96, 96, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: INNER_CORE_FRAG,
          side: THREE.DoubleSide,
        }),
      );
      innerCoreMesh.rotation.y = Math.PI;
      group.add(innerCoreMesh);

      // ── Outer liquid core: animated Bénard convective cells ───────────────
      const outerCoreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * SATURN_METALLIC_HYDROGEN_RADIUS, 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: CORE_FRAG,
          side: THREE.DoubleSide,
        }),
      );
      outerCoreMesh.rotation.y = Math.PI;
      group.add(outerCoreMesh);

      // ── Mantle outer boundary shell ───────────────────────────────────────
      const mantleMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * SATURN_MOLECULAR_ENVELOPE_RADIUS, 128, 128, phiStart, phiLength),
        new THREE.ShaderMaterial({
          uniforms: {},
          vertexShader: LAYER_VERT,
          fragmentShader: MANTLE_FRAG,
          side: THREE.BackSide,
        }),
      );
      mantleMesh.rotation.y = Math.PI;
      group.add(mantleMesh);

      // ── Mantle inner boundary shell: explicit inner wall around the core ──
      const mantleInnerBoundaryMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * (SATURN_METALLIC_HYDROGEN_RADIUS + 0.002), 128, 128, phiStart, phiLength),
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

      // ── Crust shell: fills gap between mantle and globe surface ──────────────
      // BackSide only → inner face visible from cut; outer face suppressed (no rim).
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

      // ── Crust inner boundary shell: explicit wall against the mantle ──────
      const crustInnerBoundaryMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * SATURN_MOLECULAR_ENVELOPE_RADIUS, 128, 128, phiStart, phiLength),
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

      // ── Cross-section face (ring caps at x=0 plane) ───────────────────────
      const CAP_X = -0.012;
      const crustInnerRadius = radius * SATURN_MOLECULAR_ENVELOPE_RADIUS;
      const crustOuterRadius = radius + (elevationMap ? terrainRelief : 0);
      const capDefs = [
        { outer: crustOuterRadius, inner: crustInnerRadius, fragmentShader: CRUST_SECTION_FRAG },  // crust ring
        { outer: crustInnerRadius, inner: radius * SATURN_METALLIC_HYDROGEN_RADIUS,  fragmentShader: MANTLE_SECTION_FRAG },  // molecular envelope ring
        { outer: radius * SATURN_METALLIC_HYDROGEN_RADIUS,  inner: radius * SATURN_HEAVY_CORE_RADIUS,  fragmentShader: CORE_SECTION_FRAG },  // metallic hydrogen ring
      ];
      let crustRing = null;
      let molecularEnvelopeRing = null;
      let metallicHydrogenRing = null;
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
        } else {
          metallicHydrogenRing = ring;
        }
        group.add(ring);
      }

      // Outer-core cross-section cap disc — same convective cells shader
      const fluidCapMat = new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: SECTION_FACE_VERT,
        fragmentShader: CORE_SECTION_FRAG,
        side: THREE.DoubleSide,
      });
      const fluidCapDisk = new THREE.Mesh(
        new THREE.CircleGeometry(radius * SATURN_METALLIC_HYDROGEN_RADIUS, 128),
        fluidCapMat,
      );
      fluidCapDisk.rotation.y = Math.PI / 2;
      fluidCapDisk.position.x = CAP_X - 0.001;
      group.add(fluidCapDisk);

      // Inner-core centre cap disc — crystalline shader matches the shell
      const innerCapMat = new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: LAYER_VERT,
        fragmentShader: INNER_CORE_FRAG,
        side: THREE.DoubleSide,
      });
      const innerCapDisk = new THREE.Mesh(
        new THREE.CircleGeometry(radius * SATURN_HEAVY_CORE_RADIUS, 96),
        innerCapMat,
      );
      innerCapDisk.rotation.y = Math.PI / 2;
      innerCapDisk.position.x = CAP_X - 0.002;
      group.add(innerCapDisk);

      // ── Layer labels ───────────────────────────────────────────────────────
      if (layerData && layerData.length > 0) {
        const markerGeo = new THREE.SphereGeometry(0.06, 10, 10);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0xffcf9d });
        const hitGeo = new THREE.SphereGeometry(0.28, 10, 10);
        const hitMat = new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0.01, depthTest: false, depthWrite: false,
        });

        for (const layer of layerData) {
          const lx = layer.labelX;
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

          // Connector line: from layer surface to the floating label
          const lineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(CAP_X, layer.anchorY, 0),
            new THREE.Vector3(lx, ly, 0),
          ]);
          const lineMat = new THREE.LineBasicMaterial({
            color: 0xffcf9d, transparent: true, opacity: 0.45,
          });
          const line = new THREE.Line(lineGeo, lineMat);
          labelsGroup.add(line);

          // Text sprite label
          const labelTex = makeLabelTexture(layer.name);
          const spriteMat = new THREE.SpriteMaterial({
            map: labelTex.texture, transparent: true, opacity: 0.88,
            depthTest: true, depthWrite: false,
          });
          const sprite = new THREE.Sprite(spriteMat);
          sprite.scale.set((labelTex.width / 200) * 0.85, (labelTex.height / 200) * 0.85, 1);
          sprite.position.set(lx - (labelTex.width / 200) * 0.85 * 0.5 - 0.05, ly, 0);
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
        metallicHydrogenMesh: outerCoreMesh,
        metallicHydrogenCapMesh: fluidCapDisk,
        metallicHydrogenRing: metallicHydrogenRing,
        heavyElementCoreMesh: innerCoreMesh,
        heavyElementCoreCapMesh: innerCapDisk,
      };
    }

    function buildSaturnSolidInterior(radius) {
      const group = new THREE.Group();
      const CAP_X = -0.0006;
      const metallicHydrogenMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xb7a789,
        emissive: new THREE.Color(0x261b10),
        emissiveIntensity: 0.14,
        roughness: 0.34,
        metalness: 0.72,
        clearcoat: 0.28,
        clearcoatRoughness: 0.22,
      });
      const metallicHydrogenCapMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xc4b392,
        emissive: new THREE.Color(0x2b1f13),
        emissiveIntensity: 0.18,
        roughness: 0.28,
        metalness: 0.68,
        clearcoat: 0.34,
        clearcoatRoughness: 0.18,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const metallicHydrogenMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.58, 128, 128),
        metallicHydrogenMaterial,
      );
      metallicHydrogenMesh.rotation.y = Math.PI;
      group.add(metallicHydrogenMesh);
      const metallicHydrogenCapMesh = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.22, radius * 0.58, 128),
        metallicHydrogenCapMaterial,
      );
      metallicHydrogenCapMesh.rotation.y = Math.PI / 2;
      metallicHydrogenCapMesh.position.x = CAP_X;
      metallicHydrogenCapMesh.renderOrder = 6;
      metallicHydrogenCapMesh.visible = false;
      group.add(metallicHydrogenCapMesh);

      const heavyElementCoreMaterial = new THREE.MeshStandardMaterial({
        color: 0x7a6c5a,
        emissive: new THREE.Color(0x18110c),
        emissiveIntensity: 0.08,
        roughness: 0.88,
        metalness: 0.06,
      });
      const heavyElementCoreCapMaterial = new THREE.MeshStandardMaterial({
        color: 0x8c7a63,
        emissive: new THREE.Color(0x1b140e),
        emissiveIntensity: 0.10,
        roughness: 0.82,
        metalness: 0.05,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const heavyElementCoreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.22, 96, 96),
        heavyElementCoreMaterial,
      );
      heavyElementCoreMesh.rotation.y = Math.PI;
      group.add(heavyElementCoreMesh);
      const heavyElementCoreCapMesh = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.22, 96),
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
          && (entry.layerId === "upper-atmosphere" || entry.layerId === "molecular-envelope");
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
        opacity: 0,
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
      if (!saturnSceneGroup || !Array.isArray(moonData) || moonData.length === 0) {
        return [];
      }
      const scale = saturnSceneGroup.scale;
      const radiusScale = Math.max(
        Math.abs(scale.x || 1),
        Math.abs(scale.y || 1),
        Math.abs(scale.z || 1),
      );
      return moonData
        .filter((item) => Array.isArray(item.moon_anchor))
        .map((item) => ({
          name: item.name,
          center: saturnSceneGroup.localToWorld(new THREE.Vector3(
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
          name: "Pioneer 11",
          date: "1 Sep 1979",
          color: 0xffbb44,
          // Closest approach 1.35 Rs = 4.32 scene units, passed THROUGH the ring plane
          waypoints: [
            new THREE.Vector3(-4,  -20,  14),   // distant approach (south, from Jupiter direction)
            new THREE.Vector3(-1,   -8,   6),    // mid-approach, descending toward ring plane
            new THREE.Vector3( 3.5,  0,   2.5),  // periapsis in ring plane (~4.30 scene units from center)
            new THREE.Vector3( 5.5,  7,  -1.5),  // post-periapsis, rising north
            new THREE.Vector3( 8,   20,  -9),    // distant departure (north, toward heliopause)
          ],
        },
        {
          name: "Voyager 1",
          date: "12 Nov 1980",
          color: 0x66aaff,
          // Closest approach 3.09 Rs = 9.89 scene units, outside ring system
          waypoints: [
            new THREE.Vector3(-22,   4,  18),   // distant approach (from inner solar system)
            new THREE.Vector3(-14,   2,  13),   // mid-approach
            new THREE.Vector3( -2,   0.5, 9.7), // periapsis (~9.92 scene units from center)
            new THREE.Vector3(  5,  -2,   2),   // post-periapsis
            new THREE.Vector3( 12,  14, -16),   // distant departure (north, out of ecliptic)
          ],
        },
        {
          name: "Voyager 2",
          date: "26 Aug 1981",
          color: 0x44dd88,
          // Closest approach 2.67 Rs = 8.54 scene units, outside ring system
          waypoints: [
            new THREE.Vector3(-20,  -2,  17),   // distant approach (slightly south)
            new THREE.Vector3(-13,  -1,  11),   // mid-approach
            new THREE.Vector3( -2.5, 0,  8.2),  // periapsis (~8.57 scene units from center)
            new THREE.Vector3(  6,   2,   2),   // post-periapsis
            new THREE.Vector3( 20,   5, -12),   // distant departure (toward Uranus, roughly ecliptic)
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
      return /landing site|probe|lander|rover|spacecraft|mission|flyby|cassini|huygens|voyager/.test(content);
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
          if (_renderedH > 24) {
            const _r = 24 / _renderedH;
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
        opacity: 0,
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
      const startup = window.__saturnViewerStartup;
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
      function getSaturnZoomContext() {
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
        const zoomContext = getSaturnZoomContext();
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
      saturnSceneGroup = marsGroup;
      scene.add(marsGroup);
      scene.add(buildStarfield(THREE));
      scene.add(buildSunObject());

      setStatus("Loading Saturn textures...");
      const textureLoader = new THREE.TextureLoader();
      const seismicCatalog = await loadJsonSafe(manifest.seismic ? manifest.seismic.path : "");
      const geologyFeaturePromise = loadJsonSafe(manifest.geology_interactive ? manifest.geology_interactive.feature_path : "");
      let geologyInteractiveState = null;
      const layerTextures = new Map();
      const baseLayers = manifest.layers || [{
        id: "viking-color",
        label: "Saturn Body",
        path: manifest.texture.path,
        description: "Derived Saturn body texture separated from the rings.",
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
      const initialLayer = baseLayers.find((layer) => layer.label === "Saturn Body")
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

      const saturnConfig = manifest.saturn || {};
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

      const ringsConfig = saturnConfig.rings || null;
      let ringMaterial = null;
      if (ringsConfig && ringsConfig.path) {
        const ringOuterKm = Number.isFinite(Number(ringsConfig.outer_km))
          ? Number(ringsConfig.outer_km)
          : SATURN_RING_REFERENCE_KM.mainOuter;
        const baseRingTexture = await loadTextureSafe(textureLoader, ringsConfig.path);
        const ringTexture = createCalibratedSaturnRingTexture(baseRingTexture, ringOuterKm);
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
            ? Number(ringsConfig.inner_km) * SATURN_KM_TO_SCENE
            : Number(ringsConfig.inner_radius || 3.968);
          const outerRadius = Number.isFinite(Number(ringsConfig.outer_km))
            ? Number(ringsConfig.outer_km) * SATURN_KM_TO_SCENE
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
      const SATURN_UPPER_FACE_MAT = new THREE.ShaderMaterial({
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
            vec3 saturnCream = vec3(0.90, 0.82, 0.68);
            vec3 saturnPale = vec3(0.97, 0.92, 0.82);
            vec3 haze = vec3(0.98, 0.95, 0.88);
            float cloudMask = smoothstep(0.26, 0.86, texCol.r * 0.95 + texCol.g * 0.75 - texCol.b * 0.22);
            vec3 toned = mix(texCol, saturnCream, 0.58);
            toned = pow(max(toned, vec3(0.0)), vec3(0.82));
            toned = mix(toned, saturnPale, cloudMask * 0.24);
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
      const SATURN_MH_MAT  = new THREE.MeshStandardMaterial({ color: 0xa29378, roughness: 0.58, metalness: 0.44, side: THREE.BackSide });
      const SATURN_MH_OUTER = new THREE.MeshStandardMaterial({ color: 0xa29378, roughness: 0.58, metalness: 0.44, side: THREE.FrontSide });
      const SATURN_HC_MAT  = new THREE.MeshStandardMaterial({ color: 0x8a7a65, roughness: 0.82, metalness: 0.12, side: THREE.BackSide });
      // Flat cap disks and rings: DoubleSide so they're visible from both directions.
      const SATURN_MH_FLAT = new THREE.MeshStandardMaterial({ color: 0xa29378, roughness: 0.58, metalness: 0.44, side: THREE.DoubleSide });
      const SATURN_HC_FLAT = new THREE.MeshStandardMaterial({ color: 0x8a7a65, roughness: 0.82, metalness: 0.12, side: THREE.DoubleSide });
      if (cutawayResult.crustRing) cutawayResult.crustRing.material = SATURN_UPPER_FACE_MAT;
      if (cutawayResult.metallicHydrogenMesh) cutawayResult.metallicHydrogenMesh.material = SATURN_MH_MAT;
      if (cutawayResult.molecularBoundaryMesh) cutawayResult.molecularBoundaryMesh.material = SATURN_MH_OUTER;
      if (cutawayResult.metallicHydrogenCapMesh) cutawayResult.metallicHydrogenCapMesh.material = SATURN_MH_FLAT;
      if (cutawayResult.metallicHydrogenRing) cutawayResult.metallicHydrogenRing.material = SATURN_MH_FLAT;
      if (cutawayResult.heavyElementCoreMesh) cutawayResult.heavyElementCoreMesh.material = SATURN_HC_MAT;
      if (cutawayResult.heavyElementCoreCapMesh) cutawayResult.heavyElementCoreCapMesh.material = SATURN_HC_FLAT;
      const saturnSolidInterior = buildSaturnSolidInterior(3.2);
      const saturnSolidInteriorGroup = saturnSolidInterior.group;
      marsGroup.add(saturnSolidInteriorGroup);
      const saturnInteriorSphereMaterials = [
        saturnSolidInterior.metallicHydrogenMaterial,
        saturnSolidInterior.heavyElementCoreMaterial,
      ].filter(Boolean);
      const saturnInteriorCapMaterials = [
        saturnSolidInterior.metallicHydrogenCapMaterial,
        saturnSolidInterior.heavyElementCoreCapMaterial,
      ].filter(Boolean);
      const saturnBodyScaleY = Number(saturnConfig.body_scale_y || 0.902);
      const saturnAxialTiltDeg = Number(saturnConfig.axial_tilt_deg || 26.7);
      marsGroup.scale.set(1, saturnBodyScaleY, 1);
      const applySaturnViewMode = (mode = "tilted", resetCamera = false) => {
        const tiltRad = mode === "untilted"
          ? 0
          : THREE.MathUtils.degToRad(saturnAxialTiltDeg);
        marsGroup.rotation.z = tiltRad;
        cutawayClipPlane.normal.set(Math.cos(tiltRad), Math.sin(tiltRad), 0).normalize();
        cutawayClipPlane.constant = 0;
        if (resetCamera) {
          camera.position.set(DEFAULT_CAMERA_POSITION.x, DEFAULT_CAMERA_POSITION.y, DEFAULT_CAMERA_POSITION.z);
          controls.target.set(0, 0, 0);
          controls.update();
        }
      };
      viewerApplySaturnViewMode = applySaturnViewMode;
      applySaturnViewMode(saturnViewModeSelect ? saturnViewModeSelect.value : "tilted");

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
      const moonSelectionCenterDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
      );
      moonSelectionCenterDot.renderOrder = 204;
      moonSelectionCenterDot.visible = false;
      labelLayer.group.add(moonSelectionCenterDot);
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
          seismicTimelineReadout.textContent = "No seismic timeline is available for Saturn.";
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
          downloadCsv("saturn_distance_measurement.csv", [
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
          downloadCsv("saturn_area_measurement.csv", rows);
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
          downloadCsv("saturn_profile_measurement.csv", rows);
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
          return getMoonMeasureContext(); // null if lookup fails — no Saturn fallback in moon viewer
        }
        return getMoonMeasureContext() || {
          kind: "planet",
          bodyName: "Saturn",
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
        // measurement overlay with Saturn so markers and area vertices stay locked.
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

      function intersectExposedSaturnInteriorSurface(clientX, clientY) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
        raycaster.setFromCamera(pointer, camera);
        const exposedTargets = [
          saturnSolidInterior?.metallicHydrogenMesh,
          saturnSolidInterior?.heavyElementCoreMesh,
        ].filter((mesh) => mesh && mesh.visible);
        if (!exposedTargets.length) return null;
        const hit = raycaster.intersectObjects(exposedTargets, false).find((entry) => entry.object.visible) || null;
        if (!hit) return null;
        const localPoint = marsGroup.worldToLocal(hit.point.clone());
        const latLon = vectorToLatLon(localPoint.clone());
        return { ...hit, localPoint, lat: latLon.lat, lon: latLon.lon, context: { kind: "saturn-interior-surface" } };
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
        // For moons the normal must point away from the moon center, not Saturn's origin.
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
          const body = measurePoints[0].bodyName || "Saturn";
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
          const body = measurePoints[0].bodyName || "Saturn";
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
            `${measurePoints[0].bodyName || "Saturn"} Elevation Profile`,
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

      function applySaturnAtmosphereRemoval() {
        const removeAtmosphere = Boolean(geologyToggle && geologyToggle.checked);
        const coreEnabled = Boolean(coreToggle && coreToggle.checked);
        const saturnLabelsEnabled = !removeAtmosphere && labelsToggle.checked && !activeMoonViewerFeature;
        globe.visible = !removeAtmosphere;
        // Solid interior only shown when removeAtmosphere AND core view is OFF.
        // When core view is on, cutaway handles the interior — solid spheres must be hidden
        // to avoid triggering expensive MeshPhysicalMaterial shader compilations.
        saturnSolidInteriorGroup.visible = removeAtmosphere && !coreEnabled;
        if (saturnSolidInterior.metallicHydrogenCapMesh) {
          saturnSolidInterior.metallicHydrogenCapMesh.visible = false;
        }
        if (saturnSolidInterior.heavyElementCoreCapMesh) {
          saturnSolidInterior.heavyElementCoreCapMesh.visible = false;
        }
        for (const material of saturnInteriorSphereMaterials) {
          material.clippingPlanes = [];
          material.needsUpdate = true;
        }
        for (const material of saturnInteriorCapMaterials) {
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
        // molecularBoundaryMesh = outer convex fill for metallic H layer: visible whenever core active.
        if (cutawayResult.molecularBoundaryMesh) cutawayResult.molecularBoundaryMesh.visible = coreEnabled;
        // Inner layers: always visible when core view is active (cutawayGroup visibility handles the rest).
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
          saturnLabelsEnabled,
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
        applySaturnAtmosphereRemoval();
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
        applySaturnAtmosphereRemoval();
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

      const coreLayerUpperAtmosphere = document.getElementById("core-layer-upper-atmosphere");
      const coreLayerMolecularEnvelope = document.getElementById("core-layer-molecular-envelope");
      function syncCoreLayerVisibility() {
        const removeAtmosphere = Boolean(geologyToggle && geologyToggle.checked);
        if (coreLayerUpperAtmosphere) coreLayerUpperAtmosphere.hidden = removeAtmosphere;
        if (coreLayerMolecularEnvelope) coreLayerMolecularEnvelope.hidden = removeAtmosphere;
      }
      syncCoreLayerVisibility();

      geologyToggle.addEventListener("change", () => {
        updateGeologyVisibility();
        syncSelectionHalo();
        syncGeologyMasterToggle();
        syncCoreLayerVisibility();
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
        syncCoreLayerVisibility();
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
        if (enabled) {
          if (coreViewSection) coreViewSection.open = true;
          setTimeout(() => coreViewSection?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
        }
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
        const moonViewerActive = moonViewerToggle && moonViewerToggle.checked;
        if (!moonViewerActive) {
          scenePopup.hidden = true;
          scenePopupAnchor.hidden = true;
          activePopupFeature = null;
        }
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
        applySaturnAtmosphereRemoval();
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
        applySaturnAtmosphereRemoval();
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
          ? "No seismic magnitude filtering is available for Saturn."
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
            const selected = activeMoonFeatureSearchIndex >= 0
              ? activeMoonFeatureSearchResults[activeMoonFeatureSearchIndex]
              : activeMoonFeatureSearchResults[0];
            if (selected) {
              focusSearchedFeature(selected, viewerCamera, viewerControls);
              clearMoonFeatureSearchResults(true);
            }
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

      if (saturnViewModeSelect) {
        saturnViewModeSelect.addEventListener("change", () => {
          resetExploreView(camera, controls);
          applySaturnViewMode(saturnViewModeSelect.value);
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
            surfaceHit = intersectExposedSaturnInteriorSurface(event.clientX, event.clientY);
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
              } else if (surfaceHit.context?.kind === "saturn-interior-surface") {
                const local = surfaceHit.localPoint || marsGroup.worldToLocal(surfaceHit.point.clone());
                const rFrac = Math.max(0, Math.min(1, local.length() / SATURN_SCENE_RADIUS));
                const layerName = saturnInteriorLayerName(rFrac);
                const tempC = saturnInteriorTempC(rFrac);
                const pGPa = saturnInteriorPressureGPa(rFrac);
                scTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                scTemp.style.color = saturnInteriorTempColor(tempC);
                scPressure.textContent = formatPressureGPa(pGPa);
                scPressure.style.color = saturnInteriorPressureColor(pGPa);
                if (scContext) scContext.textContent = `LAYER: ${layerName.toUpperCase()} (SURFACE)`;
              } else {
                const tempC = estimateSaturnCloudTopTemp(latLon.lat);
                const pressurePa = estimateSaturnCloudTopPressure();
                scTemp.textContent = `${tempC} °C`;
                scTemp.style.color = tempC < -185 ? "#6ec6ff" : tempC < -178 ? "#90d8e8" : "#e8c97a";
                scPressure.textContent = `${pressurePa.toLocaleString()} Pa`;
                scPressure.style.color = "#c8a8e0";
                if (scContext) scContext.textContent = "SATURN CLOUD TOPS";
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
                const tempC = estimateSaturnCloudTopTemp(latLon.lat);
                const pPa = estimateSaturnCloudTopPressure();
                const pGPa = pPa / 1e9;
                icDepth.textContent = "0 km";
                icLayer.textContent = "Upper Atmosphere (surface)";
                icLayer.style.color = saturnInteriorLayerColor("Upper Atmosphere");
                icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                icTemp.style.color = saturnInteriorTempColor(tempC);
                icPressure.textContent = formatPressureGPa(pGPa);
                icPressure.style.color = saturnInteriorPressureColor(pGPa);
                return;
              }
            }

            const removeAtmosphereActive = Boolean(geologyToggle && geologyToggle.checked);
            const visibleSurfaceTargets = removeAtmosphereActive
              ? [
                saturnSolidInterior?.metallicHydrogenMesh,
                saturnSolidInterior?.heavyElementCoreMesh,
                cutawayResult?.metallicHydrogenMesh,
                cutawayResult?.heavyElementCoreMesh,
              ]
              : [
                cutawayResult?.atmosphereMesh,
                cutawayResult?.molecularEnvelopeMesh,
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
                const tempC = estimateSaturnCloudTopTemp(latLon.lat);
                const pPa = estimateSaturnCloudTopPressure();
                const pGPa = pPa / 1e9;
                icDepth.textContent = "0 km";
                icLayer.textContent = "Upper Atmosphere (surface)";
                icLayer.style.color = saturnInteriorLayerColor("Upper Atmosphere");
                icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                icTemp.style.color = saturnInteriorTempColor(tempC);
                icPressure.textContent = formatPressureGPa(pGPa);
                icPressure.style.color = saturnInteriorPressureColor(pGPa);
                return;
              }
              const rScene = localHit.length();
              const rFrac = Math.max(0, Math.min(1, rScene / 3.2));
              const depthKm = Math.round((1.0 - rFrac) * 60268);
              const layerName = saturnInteriorLayerName(rFrac);
              const tempC = saturnInteriorTempC(rFrac);
              const pGPa = saturnInteriorPressureGPa(rFrac);
              icDepth.textContent = `${depthKm.toLocaleString()} km`;
              icLayer.textContent = `${layerName}`;
              icLayer.style.color = saturnInteriorLayerColor(layerName);
              icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
              icTemp.style.color = saturnInteriorTempColor(tempC);
              icPressure.textContent = formatPressureGPa(pGPa);
              icPressure.style.color = saturnInteriorPressureColor(pGPa);
              return;
            }

            const coreHit = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(activeCutClipPlane, coreHit)) {
              const localHit = marsGroup.worldToLocal(coreHit.clone());
              const rScene = localHit.length();
              const GLOBE_R = 3.2;
              const SATURN_R_KM = 60268;
              if (rScene <= GLOBE_R) {
                const rFrac = rScene / GLOBE_R;
                const depthKm = Math.round((1.0 - rFrac) * SATURN_R_KM);
                const layerName = saturnInteriorLayerName(rFrac);
                const tempC = saturnInteriorTempC(rFrac);
                const pGPa = saturnInteriorPressureGPa(rFrac);
                icDepth.textContent = `${depthKm.toLocaleString()} km`;
                icLayer.textContent = layerName;
                icLayer.style.color = saturnInteriorLayerColor(layerName);
                icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                icTemp.style.color = saturnInteriorTempColor(tempC);
                icPressure.textContent = formatPressureGPa(pGPa);
                icPressure.style.color = saturnInteriorPressureColor(pGPa);
              } else {
                icDepth.textContent = "—"; icLayer.textContent = "—"; icLayer.style.color = "";
                icTemp.textContent = "—"; icTemp.style.color = ""; icPressure.textContent = "—"; icPressure.style.color = "";
              }
            } else {
              const coreSurfaceTargets = [
                cutawayResult?.atmosphereMesh,
                cutawayResult?.molecularEnvelopeMesh,
                cutawayResult?.metallicHydrogenMesh,
                cutawayResult?.heavyElementCoreMesh,
                saturnSolidInterior?.metallicHydrogenMesh,
                saturnSolidInterior?.heavyElementCoreMesh,
              ].filter((mesh) => mesh && mesh.visible);
              const coreSurfaceHit = coreSurfaceTargets.length
                ? raycaster.intersectObjects(coreSurfaceTargets, false).find((entry) => entry.object.visible)
                : null;
              if (coreSurfaceHit) {
                const localHit = marsGroup.worldToLocal(coreSurfaceHit.point.clone());
                const rScene = localHit.length();
                const rFrac = Math.max(0, Math.min(1, rScene / 3.2));
                const depthKm = Math.round((1.0 - rFrac) * 60268);
                const layerName = saturnInteriorLayerName(rFrac);
                const tempC = saturnInteriorTempC(rFrac);
                const pGPa = saturnInteriorPressureGPa(rFrac);
                icDepth.textContent = `${depthKm.toLocaleString()} km`;
                icLayer.textContent = `${layerName}`;
                icLayer.style.color = saturnInteriorLayerColor(layerName);
                icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                icTemp.style.color = saturnInteriorTempColor(tempC);
                icPressure.textContent = formatPressureGPa(pGPa);
                icPressure.style.color = saturnInteriorPressureColor(pGPa);
              } else {
                const removeAtmosphereActive = Boolean(geologyToggle && geologyToggle.checked);
                if (removeAtmosphereActive) {
                  const rFrac = SATURN_EXPOSED_INTERIOR_RFRAC;
                  const depthKm = Math.round((1.0 - rFrac) * 60268);
                  const layerName = saturnInteriorLayerName(rFrac);
                  const tempC = saturnInteriorTempC(rFrac);
                  const pGPa = saturnInteriorPressureGPa(rFrac);
                  icDepth.textContent = `${depthKm.toLocaleString()} km`;
                  icLayer.textContent = `${layerName} (surface)`;
                  icLayer.style.color = saturnInteriorLayerColor(layerName);
                  icTemp.textContent = `${tempC > 0 ? "+" : ""}${tempC.toLocaleString()} °C`;
                  icTemp.style.color = saturnInteriorTempColor(tempC);
                  icPressure.textContent = formatPressureGPa(pGPa);
                  icPressure.style.color = saturnInteriorPressureColor(pGPa);
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

      window.__saturnViewerDebug = {
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
          let state = window.__saturnViewerDebug.getState();
          assert(state.solidGeology === true, "Solid geology should load enabled by default.");

          const feature = window.__saturnViewerDebug.openFeatureAtViewport(0.5, 0.5);
          assert(feature, "Expected a geology feature at the viewport center.");
          assert(feature.type === "Geologic unit polygon", `Expected geology polygon, got ${feature.type}`);

          state = window.__saturnViewerDebug.getState();
          assert(state.selectedOutlineVisible === true, "Selected geology outline should be visible.");

          window.__saturnViewerDebug.setToggle("geology-toggle", false);
          window.__saturnViewerDebug.setToggle("geology-contacts-toggle", true);
          window.__saturnViewerDebug.setToggle("geology-structures-toggle", true);
          state = window.__saturnViewerDebug.getState();
          assert(state.solidGeology === false, "Solid geology should be independently disabled.");
          assert(state.contacts === true, "Contacts should remain visible independently.");
          assert(state.structures === true, "Structures should remain visible independently.");

          const radiusBefore = window.__saturnViewerDebug.getFirstLineRadius("contacts");
          assert(radiusBefore !== null, "Expected a visible contact line sample radius.");
          window.__saturnViewerDebug.setTerrainRelief(0.2);
          await new Promise((resolve) => setTimeout(resolve, 250));
          const radiusAfter = window.__saturnViewerDebug.getFirstLineRadius("contacts");
          assert(radiusAfter !== null && Math.abs(radiusAfter - radiusBefore) > 1e-4, "Contact linework should move with terrain relief.");

          window.__saturnViewerDebug.setToggle("core-toggle", true);
          state = window.__saturnViewerDebug.getState();
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
          if (activeMoonViewerFeature && item.name === activeMoonViewerFeature.name) {
            // Focused moon: fixed-rate self-rotation so surface features visibly sweep
            // across the sphere regardless of the moon's actual orbital period.
            const _viewerOmega = (2 * Math.PI) / _MOON_VIEWER_SELF_ROT_PERIOD_MS;
            const _viewerAngle = t * _viewerOmega;
            item._currentAngle = _viewerAngle;
            moonMesh.rotation.y = TEXTURE_CENTERED_MOONS.has(item.name)
              ? (Math.PI - _viewerAngle)
              : -_viewerAngle;
            moonMesh.updateMatrix();
            continue;
          }
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
          globe.rotation.y = Math.PI + _spinT * (2 * Math.PI / _SATURN_DISPLAY_PERIOD_MS);
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
        const saturnLabelsEnabled = labelsToggle.checked && !removeAtmosphere && !activeMoonViewerFeature;
        const saturnSeismicEnabled = seismicToggle.checked && !removeAtmosphere;
        labelLayer.group.visible = !activeMoonViewerFeature;

  
        if (!coreToggle.checked) {
          updateLabelVisibility(
            labelLayer.entries,
            labelLayer.group,
            globe,
            camera,
            renderer,
            saturnLabelsEnabled,
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
            saturnSeismicEnabled,
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
            saturnLabelsEnabled,
            saturnLabelsEnabled && volcanicLabelsToggle.checked,
            saturnLabelsEnabled && landingLabelsToggle.checked,
            saturnLabelsEnabled && habitationLabelsToggle.checked,
            true,
            stormLabelsToggle ? (saturnLabelsEnabled && stormLabelsToggle.checked) : true,
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
            saturnSeismicEnabled,
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
            const _ringPos = new THREE.Vector3(
              _p.x * _cos + _p.z * _sin,
              _p.y,
              -_p.x * _sin + _p.z * _cos
            );
            selectionRing.position.copy(_ringPos);
            selectionRing.scale.setScalar(1.2 + pulse * 0.6);
            selectionRing.visible = true;
            moonSelectionCenterDot.position.copy(_ringPos);
            moonSelectionCenterDot.visible = true;
            moonSelectionCenterDot.material.color.setRGB(1.0, 0.83 + pulse * 0.14, 0.42 + pulse * 0.43);
            moonSelectionCenterDot.material.opacity = 0.88 + pulse * 0.12;
          } else {
            selectionRing.position.copy(entryMarker.position);
            const markerScale = entryMarker.scale?.x || 1;
            selectionRing.scale.setScalar((1.2 + pulse * 0.6) * markerScale);
            selectionRing.visible = true;
            moonSelectionCenterDot.visible = false;
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
          moonSelectionCenterDot.visible = false;
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
