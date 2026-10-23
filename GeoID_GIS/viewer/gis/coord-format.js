/**
 * Earth's coordinates as a reader writes them: 40.45°N, 80.00°W.
 *
 * The viewer carries longitude east-positive 0–360, and the cursor readout
 * printed it raw, so Pittsburgh read "280.00°E" (2026-10-24). On Earth a
 * longitude is said −180..180, east or west, and a latitude north or south.
 *
 * EARTH ONLY. Each planet viewer keeps its own convention (Mercury and the
 * Martian moons read west-positive 0–360 on purpose; planets-and-transit.md),
 * and the moon branch of Earth's own readout keeps its °W.
 */

/** Any longitude, east-positive 0–360 or signed, as signed −180..180 (180 stays 180). */
export function signedLon(lon) {
  if (!Number.isFinite(lon)) return NaN;
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  return w === -180 && lon > 0 ? 180 : w;
}

function hemisphere(value, digits, positive, negative, { noneAt = [] } = {}) {
  const magnitude = Number(Math.abs(value).toFixed(digits));
  const text = `${magnitude.toFixed(digits)}°`;
  // Zero, and the antimeridian, belong to neither side: "0.00°", not "0.00°E".
  if (noneAt.includes(magnitude)) return text;
  return `${text}${value > 0 ? positive : negative}`;
}

export function formatLat(lat, digits = 2) {
  if (!Number.isFinite(lat)) return "";
  return hemisphere(lat, digits, "N", "S", { noneAt: [0] });
}

export function formatLon(lon, digits = 2) {
  const s = signedLon(lon);
  if (!Number.isFinite(s)) return "";
  return hemisphere(s, digits, "E", "W", { noneAt: [0, 180] });
}

/** "40.45°N, 80.00°W" from a latitude and any longitude. */
export function formatLatLon(lat, lon, digits = 2) {
  return `${formatLat(lat, digits)}, ${formatLon(lon, digits)}`;
}
