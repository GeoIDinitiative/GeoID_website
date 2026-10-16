/**
 * Diagnostics and the headless driving hook.
 *
 *   window.__mars            always: { game, stats(), shaderErrors() }
 *   window.__drive           only with ?shot in the URL: step the loop by hand
 *
 * requestAnimationFrame does not fire in a tab that is not compositing, so a
 * headless check steps the game itself: with ?shot the game never starts its
 * own loop and the drawing buffer is preserved for screenshots.
 *
 * READ shaderErrors() FIRST. A shader that fails to compile still issues
 * every draw call: counts, uniforms and textures all look right and the only
 * symptom is black pixels (the Everest README has the long version).
 */
import * as tiles from "./tiles.js?v=b8cfe8e-efa5b7b7";

export function install(game, ui) {
  const stats = () => {
    const i = game.renderer.info;
    return {
      version: game.version, quality: game.quality.name, fps: Math.round(game.fps),
      drawCalls: i.render.calls, triangles: i.render.triangles, programs: (i.programs || []).length,
      terrainTriangles: game.terrain ? game.terrain.triangles : 0, clipLevels: game.terrain ? game.terrain.levels.length : 0,
      rocks: game.rocks ? game.rocks.count : 0, textures: i.memory.textures, geometries: i.memory.geometries,
      tilesLoaded: tiles.stats.loaded, tilesFailed: tiles.stats.failed, tilesPending: tiles.pending(),
      rover: game.model ? game.model.source : null,
      padMode: window.GeoIDPad ? window.GeoIDPad.mode : null,
    };
  };
  window.__mars = { game, stats, shaderErrors: () => game.shaderErrors(),
    /** Base modules: is each one drawn, visible, opaque, the right size, on the ground, and how big on screen? (the base system's diagnose()) */
    modules: () => { const b = window.__mars.base, rows = b && b.diagnose ? b.diagnose() : []; if (console.table) console.table(rows.map((r) => ({ type: r.type, built: r.built, drawn: r.drawn, visible: r.visible, opacity: +r.opacity.toFixed(2), px: Math.round(r.px.w) + " x " + Math.round(r.px.h), offGround_m: +r.offGround.toFixed(2), buried_m: +r.buried.toFixed(2), fromRover_m: Math.round(r.fromFocus) }))); return rows; } };
  if (!game.headless) return;

  // Count draw calls over the whole frame (three resets its counters per render() call, and the post chain makes several).
  game.renderer.info.autoReset = false;
  const frameStats = () => {
    game.renderer.info.reset();
    game.tick(0);
    return stats();
  };

  window.__drive = {
    game, stats, frameStats,
    boot: (fresh = true) => ui.begin(fresh),
    /** Step the game n times by dt seconds, as if driving. */
    run: (n = 60, dt = 1 / 60) => { for (let i = 0; i < n; i++) game.tick(dt); },
    /** Step without rendering cost mattering: physics only, then one frame. */
    sim: (seconds, ctl = null, dt = 1 / 60) => {
      const post = game.post.render; game.post.render = () => {};
      const hud = game.hud.update; game.hud.update = () => {};
      const poll = game.input.poll;
      if (ctl) game.input.poll = () => Object.assign(game.input.ctl, { throttle: 0, brake: 0, steer: 0, handbrake: false, crawl: false }, ctl);
      try { for (let t = 0; t < seconds; t += dt) game.tick(dt); }
      finally { game.post.render = post; game.hud.update = hud; game.input.poll = poll; }
      game.tick(0);
      return game.vehicle.t;
    },
    /** Let tiles land and the clipmap rebuild. */
    settle: async (ms = 20000) => {
      const end = performance.now() + ms;
      let quiet = 0;
      while (performance.now() < end) {
        game.tick(0);
        quiet = tiles.pending() > 0 || !game.field.settled || !game.imagery.settled ? 0 : quiet + 1;
        if (quiet > 8) break;
        await new Promise((r) => setTimeout(r, 60));
      }
      game.terrain.invalidate(); game.tick(0); game.tick(0);
      return quiet;
    },
    teleport: (x, z, heading = 0) => game.teleport(x, z, heading),
    teleportLL: (lat, lon, heading = 0) => { const p = game.site.fromLonLat(lon, lat); game.teleport(p.x, p.z, heading); return p; },
    setHour: (h) => { game.setTimeOfDay(h); game.tick(0); },
    shaderErrors: () => game.shaderErrors(),
    /** Raw 16-bit height of the tile sample nearest (x, z) at a level, read back from the PNG itself. */
    tileHeight: async (levelId, x, z) => {
      const s = game.site, L = s.levels.find((l) => l.id === levelId);
      const i = Math.round(s.u(L, x)), j = Math.round(s.v(L, z));
      const tx = Math.floor(i / L.tile), ty = Math.floor(j / L.tile);
      if (!L.has.has(tx + "_" + ty)) return null;
      const img = new Image();
      img.src = s.tileUrl(L, tx, ty);
      await img.decode();
      const c = document.createElement("canvas"); c.width = c.height = L.tile;
      const g = c.getContext("2d", { colorSpace: "srgb" }); g.drawImage(img, 0, 0);
      const d = g.getImageData(i - tx * L.tile, j - ty * L.tile, 1, 1).data;
      const H = s.manifest.height;
      // the sample's own world position, so the caller can compare like with like
      const wx = ((i + 0.5) * L.mpp - s.projW / 2) * s.cos, wz = (j + 0.5) * L.mpp - s.projH / 2;
      return { elevation: H.offset + (d[0] * 256 + d[1]) * H.scale, prov: d[2], x: wx, z: wz };
    },
  };
}
