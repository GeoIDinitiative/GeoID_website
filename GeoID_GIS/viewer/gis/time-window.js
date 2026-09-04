/**
 * "Which stretch of time, cut how?" — asked once, answered the same way
 * everywhere.
 *
 * The sibling of `extent-picker.js`, and written because the same three
 * questions were being asked in three vocabularies. A standalone imagery panel
 * asked From / To / one frame per / each year covers through its own fields;
 * the Earth Engine card asks From / To through `gee-date-*` and could not say
 * a cadence at all; the glacier animator asks none of them, because its dates
 * come out of the archive. Three panels, three spellings of one question, and
 * a reader who learned it in one place learned nothing about the next.
 *
 * That imagery panel is gone — `time-control.js` puts the question on the card
 * that already answers "which ground" and "which dataset" — which is what this
 * module and `time-series.js` between them made possible.
 *
 * WHAT THIS IS AND IS NOT. It is the QUESTION: read the fields, validate them
 * together, hand back one window. It is not the answer — splitting a window
 * into frames is `time-series.js`, because how a window becomes frames is the
 * source's business (Earth Engine composites over it, GFS already holds every
 * hour of it, an events feed treats it as a filter). Keeping those apart is
 * what stops this becoming a fourth spelling.
 *
 * Everything here speaks ISO dates (`YYYY-MM-DD`) and the season vocabulary
 * the player already uses, so a window handed to `datasetForYear` or
 * `seasonFor` needs no translation on the way.
 */

/** The cadences a window can be cut at. A source says which of these it can honour. */
export const CADENCES = [
  { id: "year", label: "Year" },
  { id: "season", label: "Season" },
  { id: "month", label: "Month" },
  { id: "day", label: "Day" },
];

/** What a year can be narrowed to, for sources whose answer varies by season. */
export const SEASONS = [
  { id: "full", label: "The whole year" },
  { id: "summer", label: "Summer only" },
  { id: "winter", label: "Winter only" },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const at = (iso) => Date.parse(`${iso}T00:00:00Z`);

/** Today, as the fields spell it. */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Read a window off a set of fields, whatever they are called here.
 *
 * The ids differ per panel and always will — `imagery-tl-from` and
 * `gee-date-from` are both "From" — so the caller names its own fields and
 * this owns what the answer MEANS. That is the same division `extent-picker`
 * draws: it does not care which select it was handed, only what a valid extent
 * is.
 */
export function readWindow({ from, to, step, season } = {}) {
  const value = (id) => (id ? document.getElementById(id)?.value ?? "" : "");
  return normaliseWindow({
    from: value(from),
    to: value(to),
    step: value(step) || "year",
    season: value(season) || "full",
  });
}

/**
 * A window, checked as a WHOLE.
 *
 * Each field can be individually valid and the pair still meaningless, which
 * is the failure worth catching here: two well-formed dates the wrong way
 * round produced "That range holds no frames" from deep inside the frame
 * arithmetic, which tells a reader what happened and not what to do about it.
 *
 * Refusing rather than repairing. The Earth Engine card silently widens a
 * backwards range by sixty days, which is a reasonable thing for a card whose
 * default IS a sixty-day window and a bad rule to generalise: a time-lapse
 * quietly given a range nobody asked for is a sequence of the wrong years.
 */
export function normaliseWindow({ from, to, step = "year", season = "full" } = {}) {
  const problems = [];
  if (!ISO.test(String(from))) problems.push("Give a From date.");
  if (!ISO.test(String(to))) problems.push("Give a To date.");
  if (!problems.length && at(from) > at(to)) {
    problems.push("The From date has to come before the To date.");
  }
  const known = CADENCES.some((c) => c.id === step);
  if (!known) problems.push(`"${step}" is not a cadence this can cut by.`);
  return {
    ok: problems.length === 0,
    error: problems[0] || null,
    problems,
    window: problems.length ? null
      : { from, to, step, season: SEASONS.some((s) => s.id === season) ? season : "full" },
  };
}

/**
 * Fill a cadence select with only what this source can actually honour.
 *
 * A control offering "Day" over a sixteen-day archive, or "Year" over a
 * forecast that ends on Tuesday, is a question with a wrong answer in it. The
 * source declares its cadences; anything else never appears.
 */
export function fillCadences(select, allowed = CADENCES.map((c) => c.id), chosen = null) {
  if (!select) return null;
  const offered = CADENCES.filter((c) => allowed.includes(c.id));
  select.textContent = "";
  offered.forEach((cadence) => {
    const option = document.createElement("option");
    option.value = cadence.id;
    option.textContent = cadence.label;
    select.appendChild(option);
  });
  const want = offered.some((c) => c.id === chosen) ? chosen : offered[0]?.id || null;
  if (want) select.value = want;
  return want;
}

/** The same, for the season narrowing, so a source with no seasons shows none. */
export function fillSeasons(select, allowed = SEASONS.map((s) => s.id), chosen = null) {
  if (!select) return null;
  const offered = SEASONS.filter((s) => allowed.includes(s.id));
  select.textContent = "";
  offered.forEach((season) => {
    const option = document.createElement("option");
    option.value = season.id;
    option.textContent = season.label;
    select.appendChild(option);
  });
  const want = offered.some((s) => s.id === chosen) ? chosen : offered[0]?.id || null;
  if (want) select.value = want;
  return want;
}

/**
 * A window's own description, for the line above the button.
 *
 * Said in the reader's terms — "2016 to 2026, one frame per year" — rather
 * than in the two ISO dates they just typed, which they can already see.
 */
export function describeWindow(window) {
  if (!window) return "";
  const years = `${String(window.from).slice(0, 4)} to ${String(window.to).slice(0, 4)}`;
  const cadence = CADENCES.find((c) => c.id === window.step)?.label.toLowerCase() || window.step;
  const season = window.season && window.season !== "full"
    ? `, ${window.season} only` : "";
  return `${years}, one frame per ${cadence}${season}`;
}
