/**
 * Every constant in one place. Nothing here touches the DOM, so the lint can
 * import it under node.
 *
 * SCALE, STATED ONCE: distances and heights are real (1 game metre = 1 metre
 * of Jezero). Speed is not: Perseverance drives at about 0.04 m/s, this
 * crewed rover tops out at 8 m/s, two hundred times faster, because a
 * five-kilometre traverse has to fit in an evening. The clock runs faster
 * than real time too (TIME_SCALE). Energy is kept honest by accounting drive
 * energy as mechanical WORK (force times distance, which does not care how
 * fast the clock runs) and the hotel loads in simulated time.
 */

export const VERSION = "0.1.0";

export const MARS = {
  gravity: 3.71,                 // m/s^2
  solSeconds: 88775.244,         // one sol: 24 h 39 m 35.244 s
  obliquityDeg: 25.19,
  lsPerSol: 360 / 668.6,         // mean areocentric solar longitude gained per sol
  solarConstant: 590,            // W/m^2 at Mars' mean distance, top of atmosphere
  radius: 3396190,
};

/** Simulated seconds per real second. 30 puts a whole sol in 49 minutes. */
export const TIME_SCALE = 30;
export const TIME_WARP = 600;    // the D-pad "time warp" quick slot

/** Geometry clipmap. `cells` must be a multiple of 4 (see terrain.js). */
export const QUALITY = {
  low:    { name: "low",    cells: 64,  baseCell: 0.25,  rocks: 500,  rockRange: 45, bloom: false, renderScale: 0.75, aniso: 2, microNormal: 0.6, shadowRes: 256 },
  medium: { name: "medium", cells: 96,  baseCell: 0.25,  rocks: 1200, rockRange: 60, bloom: false, renderScale: 1.0,  aniso: 4, microNormal: 1.0, shadowRes: 384 },
  high:   { name: "high",   cells: 128, baseCell: 0.125, rocks: 2200, rockRange: 75, bloom: true,  renderScale: 1.0,  aniso: 8, microNormal: 1.0, shadowRes: 512 },
  ultra:  { name: "ultra",  cells: 160, baseCell: 0.125, rocks: 3600, rockRange: 95, bloom: true,  renderScale: 1.0,  aniso: 16, microNormal: 1.0, shadowRes: 768 },
};
export const DEFAULT_QUALITY = "high";

export const CLIPMAP = {
  /** Outermost cell size wanted: levels are added until one reaches it. */
  maxCell: 256,
  /** Where the blend toward the parent begins, as a fraction of the half-extent. */
  morphStart: 0.70,
  /** Cells at or beyond this size low-pass the 16 m base with a 3x3 box. */
  filterCell: 32,
};

export const CAMERA = { fov: 58, near: 0.25, far: 60000 };

/** Tile streaming. */
export const TILE_BUDGET = 6;            // requests in flight
export const HEIGHT_RADIUS = { 1: 420, 4: 1700 };   // metres of fine height tiles kept around the rover, by level mpp
export const IMAGERY_WINDOW_TILES = 4;   // each streamed imagery level is a 4 x 4 tile window

/** Default atmosphere. Optical depth is game state (state.weather.tau); this is where it starts. */
export const ATMOSPHERE = { tau: 0.55, tauClear: 0.3, tauStorm: 4.0 };

export const SAVE_KEY = "geoid.mars_surface.save";
export const SETTINGS_KEY = "geoid.mars_surface.settings";
export const SAVE_SCHEMA = 1;

/** Palette restated for canvas / WebGL use (CSS custom properties cannot be read by a shader). */
export const PROVENANCE_COLOURS = {
  hirise: [0.20, 0.85, 0.45],       // measured, HiRISE
  ctx: [0.25, 0.55, 1.00],          // measured, CTX
  interpolated: [1.00, 0.72, 0.15], // blended or upsampled
  procedural: [1.00, 0.20, 0.80],   // generated
};
