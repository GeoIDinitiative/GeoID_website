# Mars surface asset kit

40 binary glTF models (5.75 MB) for the Mars exploration and base-building game, plus
`catalog.json` (the contract the game reads) and `_contact_sheet.png` (a software render of every item
and of a base assembled through the port frames).

Conventions for every file: **metres, Y up, +Z forward, origin on the ground under the model's centre,
real-world scale**. No external textures; core glTF 2.0 only (no Draco, no extensions), so three.js r165
`GLTFLoader` needs no decoders. `bounds` in the catalogue is `[length (Z), width (X), height (Y)]`.

## Items

| file | kind | what | L x W x H (m) | triangles | KB | origin |
|---|---|---|---|---|---|---|
| `rover_crew.glb` | vehicle | Crew rover (pressurized) | 5.63 x 3.32 x 4.10 | 8970 | 179 | generated |
| `rover_scout.glb` | vehicle | Scout buggy (pressurised pod, four wheels) | 3.62 x 2.52 x 2.90 | 5530 | 114 | generated |
| `rover_hauler.glb` | vehicle | Heavy hauler (cab and cargo module) | 6.79 x 3.83 x 3.92 | 8350 | 138 | generated |
| `rover_perseverance.glb` | vehicle | Perseverance (Mars 2020) rover | 3.10 x 2.71 x 1.84 | 40895 | 1472 | NASA |
| `rover_curiosity.glb` | vehicle | Curiosity (MSL) rover | 3.21 x 2.96 x 1.50 | 54436 | 1150 | NASA |
| `ingenuity.glb` | vehicle | Ingenuity Mars Helicopter | 1.11 x 0.99 x 0.56 | 9060 | 321 | NASA |
| `hab_small.glb` | module | Small habitat | 4.00 x 4.00 x 3.58 | 4008 | 125 | generated |
| `hab_large.glb` | module | Large habitat | 4.00 x 8.00 x 4.05 | 3860 | 118 | generated |
| `node_hub.glb` | module | Node hub | 4.00 x 4.00 x 3.71 | 2668 | 85 | generated |
| `corridor_straight.glb` | module | Corridor, straight | 4.00 x 2.10 x 3.03 | 1488 | 57 | generated |
| `corridor_corner.glb` | module | Corridor, corner | 3.05 x 3.05 x 3.00 | 1848 | 68 | generated |
| `airlock.glb` | module | Airlock | 4.00 x 3.36 x 3.54 | 2248 | 98 | generated |
| `greenhouse.glb` | module | Greenhouse | 8.00 x 3.62 x 3.05 | 3076 | 110 | generated |
| `solar_array.glb` | module | Solar array | 3.11 x 3.70 x 2.94 | 696 | 34 | generated |
| `battery_bank.glb` | module | Battery bank | 2.36 x 3.67 x 2.51 | 1744 | 81 | generated |
| `isru_plant.glb` | module | ISRU plant | 3.60 x 7.52 x 4.46 | 3772 | 134 | generated |
| `water_tank.glb` | module | Water tank | 3.31 x 2.88 x 3.53 | 2064 | 71 | generated |
| `oxygen_tank.glb` | module | Oxygen tank | 3.65 x 3.90 x 3.38 | 2044 | 64 | generated |
| `comms_tower.glb` | module | Comms tower | 3.76 x 3.74 x 10.30 | 2108 | 95 | generated |
| `garage.glb` | module | Rover garage | 7.67 x 7.88 x 4.31 | 2852 | 108 | generated |
| `landing_pad.glb` | module | Landing pad | 11.96 x 11.96 x 0.75 | 1420 | 65 | generated |
| `regolith_berm.glb` | module | Regolith berm | 2.73 x 4.00 x 2.24 | 988 | 47 | generated |
| `light_mast.glb` | module | Light mast | 1.86 x 2.07 x 5.74 | 564 | 30 | generated |
| `storage_crate.glb` | module | Storage container | 2.30 x 3.42 x 2.45 | 596 | 36 | generated |
| `hab_hdu.glb` | module | Habitat Demonstration Unit (NASA reference habitat) | 11.65 x 16.67 x 5.83 | 6480 | 310 | NASA |
| `astronaut.glb` | character | Astronaut (EVA suit) | 0.70 x 0.97 x 1.88 | 7001 | 259 | NASA |
| `rock_small_01.glb` | prop | Rock (round, 0.28 m) | 0.25 x 0.28 x 0.13 | 258 | 11 | generated |
| `rock_small_02.glb` | prop | Rock (slab, 0.36 m) | 0.26 x 0.36 x 0.09 | 262 | 10 | generated |
| `rock_small_03.glb` | prop | Rock (round, 0.45 m) | 0.45 x 0.44 x 0.30 | 261 | 11 | generated |
| `rock_small_04.glb` | prop | Rock (tall, 0.50 m) | 0.48 x 0.50 x 0.52 | 282 | 11 | generated |
| `rock_small_05.glb` | prop | Rock (slab, 0.62 m) | 0.54 x 0.62 x 0.23 | 249 | 10 | generated |
| `rock_small_06.glb` | prop | Rock (round, 0.75 m) | 0.67 x 0.75 x 0.40 | 283 | 11 | generated |
| `rock_large_01.glb` | prop | Rock (round, 1.90 m) | 1.63 x 1.90 x 1.05 | 986 | 31 | generated |
| `rock_large_02.glb` | prop | Rock (slab, 2.80 m) | 2.80 x 1.95 x 0.87 | 1066 | 34 | generated |
| `rock_large_03.glb` | prop | Rock (tall, 3.40 m) | 3.08 x 3.40 x 3.58 | 989 | 31 | generated |
| `sample_tube.glb` | prop | Mars 2020 sample tube | 0.14 x 0.02 x 0.02 | 900 | 36 | NASA |
| `flag_marker.glb` | prop | Flag marker | 0.14 x 0.50 x 1.63 | 140 | 10 | generated |
| `beacon.glb` | prop | Navigation beacon | 0.75 x 0.85 x 1.45 | 558 | 24 | generated |
| `crate.glb` | prop | Supply crate | 0.63 x 0.89 x 0.60 | 564 | 28 | generated |
| `rover_upgrade_kit.glb` | part | Rover upgrade kit (bolt-on parts, three wheel sets; one node per part, origin = mount point) | 9.57 x 7.64 x 1.14 | 6380 | 263 | generated |

Triangles are rendered triangles (instanced wheels counted per instance).

## How things are exposed

**Materials.** Geometry is split by named material, the same parts-by-material idea as the site's baked
ship STLs: `hull`, `hull_alt`, `trim`, `dark`, `accent` (safety orange), `metal`, `foil`, `glass`
(alpha blend, double sided), `glass_dark` (opaque glazing), `solar`, `tyre`, `glow` / `glow_red`
(emissive), `regolith`, `rock`, `plant`, `id_blue` (water), `id_green` (oxygen), `fabric`. The same name
means the same look in every generated file, so the game can restyle the kit by replacing a few materials.
Metalness is kept moderate on purpose: under a sun and a dusty sky with no environment map, fully
metallic surfaces render black.

**Wheels** (`rover_crew`, `rover_perseverance`, `rover_curiosity`). Six nodes `wheel_fl, wheel_ml,
wheel_rl, wheel_fr, wheel_mr, wheel_rr`, direct children of the root, origin at the wheel centre, axle =
local +X on both sides (`l` = +X = the rover's left). Spin about X, steer about Y:
`node.rotation.set(spin, steer, 0, 'YXZ')`; suspension travel = `node.position.y`. The catalogue gives
`radius`, `position`, `steer` per wheel. The crew rover also has `rocker_l/r` with child `bogie_l/r`
nodes (pivot about local X) so the links can follow the wheels; on the two NASA rovers the suspension
is part of the static `body` node. `ingenuity` has `rotor_upper` / `rotor_lower` pivoted on the mast
axis (spin about local Y, opposite directions).

**Ports** (modules). Empty nodes on the 4 m cell boundary at y = 1.5 m (centre of a 1.4 x 2.0 m door
whose sill is the 0.5 m floor), the node's +Z pointing out of the module, +Y up. `port_n` = +Z,
`port_e` = +X, `port_s` = -Z, `port_w` = -X; a second port on the same side of a multi-cell module is
`port_n2` etc. To snap B onto A: `B.port world frame = A.port world frame x RotY(180 deg)`.
Port `type`: `pressurized` (docking collar ending exactly on the cell boundary, plus a removable hatch
node `hatch_<dir>`: hide both hatches when two ports are joined), `utility` (grid snap only),
`exterior` (walk-out side of the airlock), `stack` (`port_up`, +Z up: put the upper module's origin
there; `accepts` lists what fits), `rover_dock` (crew rover rear hatch).
Other moving nodes: `solar_array/panel` (tilt about X), `comms_tower/dish`, `garage/door`,
`airlock/door_outer`; see `tilt`, `steer`, `doors` in the catalogue.

**Astronaut.** Nodes `torso` > `head`, `arm_l`, `arm_r`, `leg_l`, `leg_r`, pivots at neck, shoulders
and hips (`pivots` in the catalogue). Swing limbs about local X. The source is a T-pose: the arm nodes
carry a default -/+72 deg rotation about Z that lowers them, so use
`arm.rotation.set(swing, 0, restZ)`.

## Regenerating

Everything is built by `mars_surface/tools/assets/` and can be rebuilt from the sources:

```
cd mars_surface/tools/assets
NASA_3D_RESOURCES=/home/owen/mars_game_assets/nasa-3d-resources ./build_all.sh
```

`build_nasa.py` (NASA-derived items), `build_modules.py` (base kit), `build_procedural.py` (crew rover,
rocks, props), `build_catalog.py`, `validate.py` (checks + contact sheet), `kitlib.py` (primitives, GLB
writer, software renderer), `view.py` (multi-view render of chosen items). Needs Python 3 with numpy,
scipy, PIL, trimesh and open3d (quadric decimation), and node with `draco3dgltf@1.5.7` (installed
locally by `npm install`; NASA's GLBs are Draco-compressed and trimesh 4.7 cannot decode them).
No Blender is involved anywhere.

## Sources and licences

* **NASA-derived** (`rover_perseverance`, `rover_curiosity`, `ingenuity`, `hab_hdu`, `astronaut`,
  `sample_tube`): NASA 3D Resources, https://github.com/nasa/NASA-3D-Resources. NASA media are generally
  not copyrighted and are free to use under NASA's media usage guidelines
  (https://www.nasa.gov/nasa-brand-center/images-and-media/): credit NASA (NASA/JPL-Caltech for the
  rovers, helicopter and sample tube), do not imply NASA endorsement, and do not use the NASA insignia
  or logotype as branding. The exact source file, attribution line and the processing applied are in each
  catalogue entry and in each GLB's `asset.copyright` / `asset.extras`. Small textures on the
  Perseverance model may show mission markings as NASA modelled them.
* **Generated** (crew rover, all base modules except `hab_hdu`, rocks, flag, beacon, crate): original
  procedural geometry written for this project; no third-party content.

## Honest limitations

* **The astronaut is not rigged.** There is no skeleton, no skin weights and no animation clips, and
  no Blender here to make them. The suit mesh was cut by planes into six rigid parts with capped cuts;
  limbs swing as rigid pieces, so elbows and knees do not bend and a seam shows at the shoulders and
  hips at large angles. A proper rig needs a DCC tool.
* **Curiosity is an approximation.** Both NASA Curiosity print sets are print-plate layouts (loose parts
  laid flat). The detailed set could not be assembled; the rover is assembled by script from the
  simplified print kit, with real-size 0.50 m wheels from the detailed set. Proportions are the print
  toy's: 1.5 m tall instead of 2.2 m, a short mast, a simplified arm in a made-up pose. The hub brackets
  and the belly plate are generated geometry, and materials are assigned by rule (STL has no colour).
  The Blender-only "Curiosity (Clean/Dirty)" models could not be opened.
* **Perseverance is heavily reduced**: about 200k -> 41k triangles. Large textured parts were flattened
  to the mean colour of their texture before decimation (the only decimator here drops UVs), animations
  and the skin were dropped, and the arm, mast and suspension are one static node. All six wheels are
  instances of the front-left wheel. It is 1.47 MB, just under the 1.5 MB target.
* **hab_hdu** is scenery: off-grid, no ports, 310 KB (over the 300 KB module target because of its two
  textures). Its scale (inches -> metres) is inferred from door height; four alpha-mapped bracing planes
  that rendered as opaque black sheets were removed.
* **sample_tube** is the print model (inches), decimated 42k -> 900 triangles; its open end is rough.
* The rover hatch (`port_dock`, 2.0 m up, 0.9 x 1.4 m) is not level with base ports (1.5 m, 1.4 x 2.0 m).
* Hatches and doors are single slabs to hide or slide; there are no interiors (the greenhouse beds and
  the garage floor are the only inside detail), and no collision meshes or LODs.
* `glow` materials carry `emissiveFactor` only; add real lights in the game.
* Validation checks that stored normals agree with triangle winding; whether faces point outward was
  checked by eye on the contact sheet (back faces render magenta there). NASA-derived materials are
  double sided because their sources contain single-sided sheets.
* Gameplay numbers are suggestions. Each `gameplay.notes` says which figures are real and which are
  game design values.
