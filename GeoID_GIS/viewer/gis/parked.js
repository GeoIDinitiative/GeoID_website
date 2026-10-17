/**
 * Features PARKED off the live site: built, but hidden until they can work.
 *
 * Each one needs a server-side piece that does not exist yet, and without it
 * the reader only ever sees an error (2026-10-17):
 *
 *   wind-flow, current-flow, flow   a global field costs ~2,000 Open-Meteo
 *                                   calls against a 600-a-minute free limit,
 *                                   so every load is refused (HTTP 429). Needs
 *                                   a field baked hourly to the bucket.
 *   traffic-air                     adsb.lol does not answer, airplanes.live
 *                                   refuses anonymous use (403), and OpenSky
 *                                   sends no CORS header for this origin.
 *                                   Needs a cached proxy on our own Worker.
 *
 * Un-parking is deleting the id here. The code behind each stays loaded and
 * tested, so nothing else has to change.
 */
export const PARKED = new Set(["wind-flow", "current-flow", "flow", "traffic-air"]);

export const isParked = (id) => PARKED.has(id);
