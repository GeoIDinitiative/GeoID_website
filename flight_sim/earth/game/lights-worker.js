/**
 * Off the main thread: a vector tile's road lines, decoded, and the street
 * lamps along them (lamps.js). The main thread then lights or darkens each
 * one against Black Marble and stands it on the terrain.
 */

import { decodeLayer, rings } from "./mvt.js?v=1";
import { placeLamps } from "./lamps.js?v=1";

self.onmessage = (e) => {
  const { id, buf, tileSizeM, classes } = e.data;
  try {
    const layer = decodeLayer(buf, "transportation");
    if (!layer) { self.postMessage({ id, lamps: new Float32Array(0) }); return; }
    const lines = [];
    for (const f of layer.features) {
      if (f.type !== 2 || f.props.brunnel === "tunnel") continue;
      const cls = String(f.props.class || "").replace(/_construction$/, "");
      for (const pts of rings(f.geometry)) lines.push({ cls, pts });
    }
    const lamps = placeLamps(lines, layer.extent || 4096, tileSizeM, classes);
    self.postMessage({ id, lamps }, [lamps.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
