/**
 * Features PARKED off the live site: built, but hidden until they can work.
 *
 * Each one needs a server-side piece that does not exist yet, and without it
 * the reader only ever sees an error (2026-10-17):
 *
 *   current-flow                    a global field cost ~2,200 Open-Meteo
 *                                   calls against a 600-a-minute free limit,
 *                                   so every load was refused (HTTP 429), and
 *                                   a lattice coarse enough to fit is
 *                                   meaningless for currents. Waits for a
 *                                   daily NOAA OSCAR field baked to the bucket.
 *                                   (Wind was parked with it, and came back
 *                                   once it spent from a per-minute budget:
 *                                   flow-field.js createCallBudget.)
 *   traffic-air                     adsb.lol does not answer, airplanes.live
 *                                   refuses anonymous use (403), and OpenSky
 *                                   sends no CORS header for this origin.
 *                                   Needs a cached proxy on our own Worker.
 *
 * Un-parking is deleting the id here. The code behind each stays loaded and
 * tested, so nothing else has to change.
 */
export const PARKED = new Set(["current-flow", "traffic-air"]);

export const isParked = (id) => PARKED.has(id);
