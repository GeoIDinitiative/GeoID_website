# Earth Flight — inside GeoHUB

Earth Flight is the **shared flight mode** (`scripts/flightsim.js`, the one
Mars and every other world fly) running on the **GeoHUB Earth globe**:
Explorer ▸ Earth Flight ▸ Enter opens pre-flight (aim the crosshair, pick a
launch height, Launch), and the ship flies over everything the globe draws
close in — the imagery refine, and the streamed OpenStreetMap buildings with
their bridges, the London Eye and sun shadows (`GeoID_GIS/viewer/gis/osm-buildings.js`).
Esc returns to the globe.

How it is wired:

- `GeoID_GIS/viewer/earth-viewer.js` publishes `window.__flightSimHooks` (the
  viewer descends from Mars's, so the sim's hooks are its own internals),
  calls `__flightSim.update(camera)` in its render loop, and lets the ship own
  the camera while flying.
- `scripts/flightsim.js` has an `earth` body profile: gravity, the 1976
  standard atmosphere, its own launch heights (300 m to 1,000 km, 1 km by
  default), a launch throttle of ~120 m/s, a 5° launch descent, co-rotation with the planet and an open chrome.
- `GeoID_GIS/viewer/gis/earth-flight-entry.js` puts the sim's panel at the top
  of Explorer as "Earth Flight", adds the globe-buildings and shadows switches
  to it, and answers `/?flight=earth&lat=..&lon=..` by aiming the globe there
  and opening pre-flight.
- `/flight_sim/earth/` (this folder's `index.html`) is a bounce to
  `/?flight=earth`, carrying `lat`/`lon` if given, the way the standalone
  planet viewers bounce to `/?world=<id>`.

What stays in this folder is the buildings pipeline the globe uses:

    game/buildings-worker.js   decode + extrude off the main thread (module worker)
    game/mvt.js                vector-tile decoder (pure)
    game/extrude.js            footprints → roofs + walls, inferred pitched roofs (pure)
    game/structures.js         bridges (decks, piers, water patch) and lattice wheels (pure)
    game/facade.js             facade and roof shader patches (strings only)
    tests/buildings.test.mjs   run by GeoID_GIS/tests/run.mjs

The worker imports three r165 from `everest/vendor/` with Everest's stamp
(`?v=84ebb99-a7f30c15`); if `everest/tools/stamp.py` restamps, update it.

## Sources, licences, limits

| Layer | Source | Key? | Licence / terms |
|---|---|---|---|
| Imagery | Esri World Imagery (`server.arcgisonline.com/.../World_Imagery/MapServer/tile/{z}/{y}/{x}`), z16–z17 for roofs and the ground drape under each building tile | No | Esri terms of use; the attribution line on screen is required. Already used by Everest and the GIS. Esri expects heavy production use to go through an ArcGIS Location Platform account, so check the terms before promoting this widely. |
| Buildings, bridges | OpenFreeMap vector tiles (OpenMapTiles schema) at z14: `building` (`render_height`, `render_min_height`, `colour`), `transportation` (`brunnel`, `class`, `layer`) and `water` | No | Data is © OpenStreetMap contributors under the ODbL, with attribution required (shown). OpenFreeMap is free and donation-funded with no stated limits; the tile URL is read from its TileJSON each start because it carries a dated build path. |

**Considered and not used.**
- **OSM Buildings** (`data.osmbuildings.org`): returns 403 to anonymous requests now.
- **Overture Maps buildings**: the data is good (OSM plus ML footprints, many with heights), but it is published as GeoParquet. The PMTiles builds on S3 are unversioned betas, which would make a fragile endpoint to ship against. It is a good candidate for a self-hosted PMTiles extract later.
- **Google Photorealistic 3D Tiles** (Map Tiles API) is the real Google Earth / MSFS-style mesh, and it is the only way to get true photogrammetry. It needs an API key with billing. Its terms require Google's logo and the per-tile data attributions on screen, and they restrict caching and pre-fetching. No key is in this repository. If one is ever added, it belongs behind an opt-in toggle using NASA-AMMOS `3DTilesRendererJS`, with the key held server-side or referrer-restricted. Read the current terms first.

**Limits — what this is not.**
- **Not photogrammetry.** Buildings are OSM outlines extruded to their tagged height. Where mappers have tagged heights or levels (central London, Manhattan, most of Germany) the skyline is real; elsewhere a 5 m default (OpenMapTiles' and this code's) gives a low town of uniform blocks.
- **What the tiles carry, and what is inferred.** OpenFreeMap's `building` layer has OSM `building:colour`, the two heights and the OSM id, and nothing else: no building type, material, levels, `roof:shape` or `roof:colour`. Checked on 2026-10-24 for richer keyless sources: Overture's PMTiles bucket answers 403 for every release (the data is GeoParquet only), and Overpass returned 406 from overpass-api.de and timed out on two mirrors. So:
  - *walls*: `building:colour` where tagged; otherwise a palette chosen by height class (under 12 m brick, stock brick and render; 12–40 m stone and render; over 40 m glass and steel), picked per building by a hash of its OSM id so it is stable across reloads;
  - *facades* are procedural, in the material (`game/facade.js`): masonry gets storeys of 3.3 m, slab lines, punched windows in 3 m bays with per-pane variation, and shopfront glazing below 4 m. Towers over 40 m get a curtain wall: 1.5 m glass bays, mullions, a spandrel per floor, and a Fresnel sky sheen. Every wall gets contact occlusion fading out by 5 m, and the patterns fade to their average below a pixel and a half;
  - *roofs* show the imagery, a shade darker than the walls. **Pitched roofs are inferred, not read**: an outline that is a near-rectangle of 30–450 m², at most 15 m tall and with no courtyard gets a gable (long side over 1.6× the short) or a hip, rising about 35°; one in six stays flat. Everything else is flat, as the data implies;
  - *cost*: one byte per vertex for the facade style, and about 60 % more worker time per tile (112 ms against 70 ms for the densest London tile, off the main thread). Pitched roofs add 4–6 triangles per house. No measurable change in frame time at 1600×900 over central London, because draw calls rather than fill set the limit there.
- **Bridges** (`game/structures.js`). OSM bridge outlines (`man_made=bridge`, the transportation layer's `class=bridge` polygons) become deck slabs topped with their own photograph. Bridge-carrying ways (`brunnel=bridge`) not inside an outline become ribbons sized by class, with ballast-coloured decks for rail. A deck stands at the highest ground within 150 m along the way, plus 2 m, plus 2 m per `layer`: about 9 m over the Thames. Piers go every 35 m where the span is over the water layer, and a dark water patch under the deck hides the photo's flat copy of the bridge. Buildings whose centroid falls inside a bridge outline are not extruded. Decks are flat or straight-ramped (no arches), and the ship does not collide with them; the shared sim keeps it 60 m above the ground in any case.
- **Lattice structures.** Clusters of 40 or more small floating `building:part`s spanning 40 m or more in height (the London Eye's ~150 rim, capsule and A-frame parts) are not extruded. One whose parts lie on a vertical circle (median radial error under 20 % and parts in all four quadrants) is drawn as a wheel: rim, 32 capsules, spokes and an A-frame. Anything else is drawn as nothing rather than as boxes.
- **Roofs are textured from z16/z17 imagery** (z17 for tiles within 900 m when requested). Satellite imagery is not true-ortho, so a tower's photographed roof is displaced from its footprint and can wear a strip of street. The photos also carry their own baked shadows from capture time, under the real-time ones.
