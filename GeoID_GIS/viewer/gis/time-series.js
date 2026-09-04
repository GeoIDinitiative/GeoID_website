/**
 * "Run that fetch once per frame" — written once, for every source that can
 * answer over time.
 *
 * The loop existed twice, in two shapes. The imagery animator cuts a range
 * into windows and asks Earth Engine for a composite of each; the glacier
 * animator takes the dates the GLIMS archive actually holds and asks for the
 * ice as of each one. Both then hand epochs to `timelapse-player.js`, which
 * has been the one player over this globe all along.
 *
 * THE GLACIER ANIMATOR IS THE MODEL HERE, and three of its habits are the
 * reason this file exists rather than a generic map():
 *
 *   1. EPOCHS COME FROM THE SOURCE, not from arithmetic. GLIMS knows which
 *      dates it holds; a range split evenly across them would invent frames
 *      the archive cannot fill. A source that DOES want an even split says so
 *      by using `windowsFrom` below — it is offered, not imposed.
 *   2. WHAT WAS DROPPED IS RETURNED, never swallowed. Both drivers cap their
 *      frame count and both hand back what the cap cost, because a sequence
 *      stepping five years while its control says "yearly" is the quiet lie
 *      this tree keeps paying for.
 *   3. NOTHING IS FETCHED UNTIL THE TIMELINE REACHES IT, and the count is
 *      known before the first request. Earth Engine bills per render, so the
 *      number of frames is consent, not a progress bar.
 *
 * WHAT A SOURCE IS. Four fields, all optional but `frameFor`:
 *
 *   cadences   which of `time-window`'s cuts it can honour  (default: all)
 *   epochsFor  window -> [{date, label, ...}]                (default: even split)
 *   costFor    epochs -> {requests, billed}                  (default: one each)
 *   frameFor   epoch  -> whatever the player shows
 *
 * That is deliberately small. GFS answers every hour of one run from a single
 * request, an events feed answers from features already in memory, and Earth
 * Engine answers one billed render at a time — the difference between them is
 * `costFor` and `frameFor`, and nothing above this file needs to know which.
 */

const search = new URL(import.meta.url).search;

/** A slider has a useful length; past this the sequence is strided, not cut. */
export const MAX_FRAMES = 40;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const at = (iso) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * An even split of a window, for sources that have no dates of their own.
 *
 * Offered rather than imposed: a source whose archive knows its own dates
 * should use them (see habit 1). The seasonal narrowing is applied by clipping
 * each window to the asked-for range, so a summer-only pass over 2016–2026
 * yields ten summers rather than ten whole years wearing the word "summer".
 */
export function windowsFrom({ from, to, step = "year" }) {
  if (!ISO.test(String(from)) || !ISO.test(String(to)) || at(from) > at(to)) return [];
  const out = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = at(to);
  const advance = (d) => {
    const next = new Date(d);
    if (step === "year") next.setUTCFullYear(next.getUTCFullYear() + 1);
    else if (step === "season") next.setUTCMonth(next.getUTCMonth() + 3);
    else if (step === "month") next.setUTCMonth(next.getUTCMonth() + 1);
    else next.setUTCDate(next.getUTCDate() + 1);
    return next;
  };
  let cursor = start;
  let guard = 0;
  while (cursor.getTime() <= end && (guard += 1) < 5000) {
    const next = advance(cursor);
    const windowEnd = Math.min(next.getTime() - 86400000, end);
    out.push({
      from: iso(cursor.getTime()),
      to: iso(windowEnd),
      label: step === "year" ? iso(cursor.getTime()).slice(0, 4) : iso(cursor.getTime()),
    });
    cursor = next;
  }
  return out;
}

/**
 * Cap the sequence by STRIDING, and say what that cost.
 *
 * Truncating would silently change which span the sequence covers — a
 * time-lapse is about a span, and one that stops at frame 40 is a different
 * claim from the one the control makes. The far end is kept whatever the
 * stride lands on, because it is the thing a reader is comparing against.
 *
 * Lifted from the imagery animator, which already had it right; the glacier
 * animator caps by keeping the fullest dates instead, which is its own rule
 * about ITS data and stays where it is.
 */
export function stride(epochs, max = MAX_FRAMES) {
  const all = epochs || [];
  if (all.length <= max) return { epochs: all, stride: 1, dropped: 0 };
  const step = Math.max(1, Math.ceil(all.length / max));
  const kept = all.filter((_, i) => i % step === 0);
  if (kept[kept.length - 1] !== all[all.length - 1]) kept.push(all[all.length - 1]);
  return { epochs: kept, stride: step, dropped: all.length - kept.length };
}

/**
 * What this sequence WILL be, before anything is fetched.
 *
 * Everything a panel needs to write the line above its button and everything a
 * reader needs to consent to a bill: how many frames, how many requests, and
 * whether those requests cost money. Nothing here touches the network.
 */
export function planSeries(source, window, { max = MAX_FRAMES } = {}) {
  if (!window) return { ok: false, error: "No time window given.", epochs: [] };
  const cadences = source?.cadences;
  if (cadences && !cadences.includes(window.step)) {
    return {
      ok: false, epochs: [],
      error: `This source cannot step by ${window.step}.`,
    };
  }
  const raw = source?.epochsFor
    ? source.epochsFor(window)
    : windowsFrom(window).map((w) => ({ ...w, date: w.from }));
  if (!raw || !raw.length) {
    return { ok: false, epochs: [], error: "That range holds no frames." };
  }
  const capped = stride(raw, max);
  const cost = source?.costFor
    ? source.costFor(capped.epochs)
    : { requests: capped.epochs.length, billed: false };
  return {
    ok: true, error: null,
    epochs: capped.epochs,
    stride: capped.stride,
    dropped: capped.dropped,
    cost,
    /**
     * The sentence a panel puts under its button. Said in frames and requests
     * because those are the two different numbers -- "96 frames, 1 request"
     * for a forecast and "12 frames, 12 renders" for Earth Engine is the whole
     * point of `costFor` existing.
     */
    summary: `${capped.epochs.length} frame${capped.epochs.length === 1 ? "" : "s"}`
      + `, ${cost.requests} ${cost.billed ? "billed render" : "request"}`
      + `${cost.requests === 1 ? "" : "s"}`
      + (capped.stride > 1 ? ` · stepping ${capped.stride}× to fit the slider` : ""),
  };
}

/**
 * Put the planned sequence on the globe.
 *
 * The player is not re-implemented here and never should be: it owns the bar,
 * the slider, the play loop, the scene cache and the imagery fallback, and it
 * has owned them for both drivers since before this file existed. This is the
 * one line between "what the frames are" and "show them".
 */
export async function runSeries(source, plan, { bounds, onStatus = () => {},
  noteFor, onStop = null, onShow = null, frames = null, overlayToggle = null,
  interval = 1200, playerSource = "auto" } = {}) {
  if (!plan?.ok) throw new Error(plan?.error || "Nothing to play.");
  const { startPlayer } = await import(`./timelapse-player.js${search}`);
  return startPlayer({
    bounds,
    epochs: plan.epochs,
    source: playerSource,
    frames,
    noteFor: noteFor || ((epoch, tail) => tail),
    onStatus,
    onStop,
    onShow: onShow || (source?.frameFor
      // A source that fetches per frame is asked HERE, one frame at a time, so
      // habit 3 holds: nothing is requested until the timeline arrives at it.
      //
      // The player calls back as (index, epoch) -- that order, checked against
      // `state.onShow?.(index, epoch)` rather than assumed, because reversed
      // arguments here would hand every source an integer where it expects a
      // date and fail on the first frame.
      ? (index, epoch) => source.frameFor(epoch, { bounds, index })
      : null),
    overlayToggle,
    interval,
  });
}
