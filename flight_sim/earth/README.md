# Earth Flight — photoreal flying over real cities

`/flight_sim/earth/` — fly a light aircraft low over any city on Earth:
satellite imagery draped on real terrain, OpenStreetMap buildings in 3D,
and the sun casting real-time shadows for any hour of the day. No key, no
account, no build step.

    /flight_sim/earth/index.html          the page (no inline script; CSP via scripts/csp.py)
    /flight_sim/earth/game/main.js        boot, loop, shadow frustum, HUD, window.__earthFlight hooks
    /flight_sim/earth/game/geo.js         Mercator local frame with a moving origin
    /flight_sim/earth/game/terrain.js     chunked-LOD quadtree: Esri imagery on Terrarium DEM
    /flight_sim/earth/game/buildings.js   OpenFreeMap building tiles → meshes, roof imagery, facades
    /flight_sim/earth/game/buildings-worker.js   decode + extrude off the main thread
    /flight_sim/earth/game/mvt.js         vector-tile decoder (pure; also used by the test)
    /flight_sim/earth/game/extrude.js     footprints → roofs + walls (pure)
    /flight_sim/earth/game/sky.js         sun position, sky, haze, light balance
    /flight_sim/earth/game/plane.js       aircraft, arcade flight model, cameras
    /flight_sim/earth/tests/buildings.test.mjs   run by GeoID_GIS/tests/run.mjs

URL parameters: `?city=london|catania|newyork|paris|rome|sanfran|chicago|tokyo|hongkong|dubai|sydney|rio`,
`lat`, `lon`, `alt` (m above ground), `hdg`, `pitch`, `hour` (local solar time), `cam=cockpit`, `pause`.

## In GeoHUB

- **Explorer → Earth Flight → Enter** opens this page at the centre of the
  globe view, facing the way the view faces, at the view's height clamped to
  150 m–3 km (or a chosen start height). `← GeoHUB` in the bar goes back.
- **The globe itself** streams the same buildings when the camera comes down
  over a city: `GeoID_GIS/viewer/gis/osm-buildings.js` reuses this folder's
  worker, MVT decoder, extruder and `game/facade.js`. Below 6 km above the
  drawn ground they load by z14 tile round the camera (16 tiles at most); above
  8 km they are all unloaded; sun shadows below 4 km. Each building tile also
  lays its own Esri imagery (z17 near, ~0.7 m/px; z16 further out) on the
  ground under it, because the globe's default basemap is Sentinel-2 at 10 m,
  which is soft from a few hundred metres. Earth Flight's own terrain goes to
  z18 (measured: z18 chunks drawn under the aircraft at 150 m). Notes:
  `GeoID_GIS/docs/notes/globe-rendering.md`, "Streamed 3D buildings".

## What is reused, and what is new

It is built on the Everest game's machinery rather than a new pipeline:
three r165 from `everest/vendor/`, the request scheduler `everest/game/tiles.js`
(one budget, coalescing, retire-don't-abort, decoded-image LRU), and the solar
position from `everest/game/sky.js`. The two tile services are the ones Everest
measured.

The terrain is not Everest's clipmap. A walker needs four fixed nested
canvases; a plane crosses one in seconds and climbs through all of them in a
minute. So the ground is a quadtree on the Web Mercator tile grid where every
node is exactly one 256 px imagery tile and one 33² height grid. A landed tile
is one texture upload, never a canvas repaint, and LOD follows the camera in
3D. A node splits only once all four children are ready, so there are no holes
and no pops; skirts hide the cracks between levels, and chunk edges are drawn at
half resolution so that neighbouring levels meet.

Pinned imports: everything imports Everest files with Everest's current stamp
(`?v=84ebb99-a7f30c15`). If `everest/tools/stamp.py` restamps, update these
too, or the page will load a second copy of three.

## Sources, licences, limits

| Layer | Source | Key? | Licence / terms |
|---|---|---|---|
| Imagery | Esri World Imagery (`server.arcgisonline.com/.../World_Imagery/MapServer/tile/{z}/{y}/{x}`), z ≤ 18 | No | Esri terms of use; the attribution line on screen is required. Already used by Everest and the GIS. Esri expects heavy production use to go through an ArcGIS Location Platform account, so check the terms before promoting this widely. |
| Elevation | Mapzen Terrain Tiles (Terrarium) on AWS Open Data, z ≤ 15 | No | Mixed open sources (SRTM, GMTED, ETOPO1, national LiDAR). Attribution is required: see the AWS registry entry. |
| Buildings | OpenFreeMap vector tiles (OpenMapTiles schema), `building` layer at z14: `render_height`, `render_min_height`, `colour` | No | Data is © OpenStreetMap contributors under the ODbL, with attribution required (shown). OpenFreeMap is free and donation-funded with no stated limits; the tile URL is read from its TileJSON each start because it carries a dated build path. |
| Sun | NOAA-style solar position (from Everest) | — | — |

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
- **Bridges** (`game/structures.js`). OSM bridge outlines (`man_made=bridge`, the transportation layer's `class=bridge` polygons) become deck slabs topped with their own photograph. Bridge-carrying ways (`brunnel=bridge`) not inside an outline become ribbons sized by class, with ballast-coloured decks for rail. A deck stands at the highest ground within 150 m along the way, plus 2 m, plus 2 m per `layer`: about 9 m over the Thames. Piers go every 35 m where the span is over the water layer, and a dark water patch under the deck hides the photo's flat copy of the bridge. Buildings whose centroid falls inside a bridge outline are not extruded. Decks are flat or straight-ramped (no arches), and the aircraft does not collide with them. You can fly under one.
- **Lattice structures.** Clusters of 40 or more small floating `building:part`s spanning 40 m or more in height (the London Eye's ~150 rim, capsule and A-frame parts) are not extruded. One whose parts lie on a vertical circle (median radial error under 20 % and parts in all four quadrants) is drawn as a wheel: rim, 32 capsules, spokes and an A-frame. Anything else is drawn as nothing rather than as boxes.
- **Roofs are textured from z16/z17 imagery** (z17 for tiles within 900 m when requested). Satellite imagery is not true-ortho, so a tower's photographed roof is displaced from its footprint and can wear a strip of street. The photos also carry their own baked shadows from capture time, under the real-time ones.
- **Shadows** come from one 4096² shadow map (2048² where the GPU caps textures below 8192). It is refitted every frame to a square ahead of the camera, ~1.2 km across at rooftop height and up to 8 km across from high up, and snapped to texels so the edges do not crawl. Beyond that box nothing casts. Hills cast too, but only from chunks at z ≥ 14. Cascaded shadow maps were judged not worth a second and third depth pass: a building's shadow is only legible near the building.
- **Terrain** is ~30 m SRTM interpolated to z15, so cliffs and embankments are soft. Some published Terrarium tiles are empty (all no-data), e.g. 14/8873/6336 on Etna's west flank. These are filled from the parent tile; without that they became 2 km pits ringed by skirt walls.
- **Scale.** The world is Mercator × cos(lat₀) about the starting city, re-centred by translation every 20 km. Distances drift ~1.5 % per degree of latitude flown, and the horizon comes from a d²/2R curvature drop in the vertex shader.
- **Streaming.** All imagery, DEM and roof tiles share one budget of 6 in flight. Measured on this laptop (Intel Iris Xe, 1600×900): a fresh city settles in 15–35 s from a cold cache. Frame rate over central London at ~200 m is 22–36 fps with ~1 M triangles, and 45–60 fps at altitude or over the countryside.
- **Flight model** is arcade: throttle sets speed, bank sets the turn rate (ω = g·tanφ/v), and the aircraft cannot hit the ground.

## Testing

`node flight_sim/earth/tests/buildings.test.mjs` encodes a vector tile by hand
and checks decode, ring grouping, clipping, roof area with a courtyard, wall
winding and normals, and facade UVs. It is also picked up by
`node GeoID_GIS/tests/run.mjs`.

For visuals, `window.__earthFlight` exposes `setPose`, `orbit`, `setHour`,
`pause`, `idle()` (resolves once nothing has loaded for a while) and `stats()`.
Pass `?capture` to keep the drawing buffer for screenshots.
