/**
 * EARTH ENGINE, as a time source.
 *
 * The `time-series.js` contract filled in for the one source that already had
 * a working animator, so step 3 puts the SAME expander on the card where
 * imagery is fetched rather than inventing a second flow beside it. The frame
 * arithmetic, the collection fallback and the player are all
 * `imagery-timelapse.js`'s, untouched — this file is the four fields that say
 * what Earth Engine can do and what it costs.
 *
 * WHY `costFor` SAYS "billed". Earth Engine renders per request, so twelve
 * frames is twelve renders and a careless cadence over a wide box is a large
 * bill arriving as a progress bar. That is the whole reason the plan is shown
 * before the press.
 */

const search = new URL(import.meta.url).search;

/** The window the card opens on: the last ten years, stepped yearly. */
function defaultWindow() {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const then = new Date(now);
  then.setUTCFullYear(then.getUTCFullYear() - 10);
  return { from: iso(then), to: iso(now) };
}

export function earthEngineTimeSource({ boundsOf, extentHint }) {
  return {
    label: "Imagery over time",
    blurb: "One satellite composite per step over the ground and dates below, "
      + "played as a sequence. Every frame is a composite of real scenes inside "
      + "its own window — a step the sensor never saw is left blank, never filled in.",

    /**
     * No DAY. A single day is one overpass and mostly cloud, which is the
     * reason a frame here is a WINDOW rather than an instant — offering a
     * cadence whose frames would come back empty is a question with a wrong
     * answer in it.
     */
    cadences: ["year", "season", "month"],
    defaultCadence: "year",
    seasons: ["full", "summer", "winter"],

    defaultWindow,
    boundsOf,
    noBoundsMessage: extentHint
      || "Choose a fetch extent first — draw an area, or pick a layer.",

    /**
     * The cost, stated the way a reader can act on it. `requests` is frames
     * because Earth Engine renders one composite per window; `billed` is what
     * makes the sentence read "12 billed renders" rather than "12 requests".
     */
    costFor: (epochs) => ({ requests: epochs.length, billed: true }),

    /**
     * The driver owns the run, so the plan is used for its COUNT and the
     * epochs are rebuilt inside `startImageryTimelapse` from the same window —
     * one frame arithmetic, not two that must agree.
     */
    async run({ bounds, window, onStatus }) {
      const driver = await import(`./imagery-timelapse.js${search}`);
      return driver.startImageryTimelapse({
        bounds,
        from: window.from,
        to: window.to,
        step: window.step,
        season: window.season,
        collection: "auto",
        onStatus,
      });
    },
  };
}
