/**
 * "Over time" — the same expander, on any card that fetches.
 *
 * Step 3 of the time plan, and the thing that lets step 4 delete a whole panel.
 * A sequence over time is not a PLACE in this app; it is something a fetch can
 * additionally do, so it belongs on the card where that fetch is already
 * configured — beside the extent and the dataset somebody has just chosen,
 * rather than in a tab they have to go and find and configure again.
 *
 * WHAT IT OWNS AND WHAT IT DOES NOT. It owns the window fields and the
 * consent line; `time-window.js` owns what a window means and `time-series.js`
 * owns what a plan costs. It never fetches: `planSeries` is pure, so the
 * sentence under the button is written from the source's own `costFor` before
 * anything is requested — which is the whole point of it existing on a card
 * whose fetches are billed.
 *
 * A CARD WITHOUT A `timeSource` GETS NO EXPANDER. That is deliberate: a
 * control that appears everywhere and works in three places out of five is
 * worse than one that appears in three, and this tree has paid for the "wire
 * it or leave it disabled" rule often enough to state it here too.
 */

const search = new URL(import.meta.url).search;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/**
 * Build the expander into `host` for one source.
 *
 * `source` is the `time-series.js` contract plus the two things only a CARD
 * knows: `boundsOf()`, because which ground is being fetched is the card's own
 * question and it is already answered there, and `label` for the summary.
 */
export async function mountTimeControl(host, source, { open = false } = {}) {
  if (!host || !source) return null;
  const TW = await import(`./time-window.js${search}`);
  const TS = await import(`./time-series.js${search}`);

  const box = el("details", "gis-tool-section geoid-time-control");
  if (open) box.open = true;
  const summary = el("summary", null, source.label || "Over time");
  box.appendChild(summary);
  const body = el("div", "gis-tool-body");
  box.appendChild(body);

  const blurb = el("p", "compact-copy", source.blurb
    || "One frame per step over the ground and dates below, played as a sequence.");
  blurb.style.cssText = "opacity:0.75;margin:0 0 0.35rem;";
  body.appendChild(blurb);

  const field = (labelText, node) => {
    const row = el("div", "row");
    const label = el("label", null, labelText);
    row.append(label, node);
    body.appendChild(row);
    return node;
  };

  const from = field("From", Object.assign(el("input", "input"), { type: "date" }));
  const to = field("To", Object.assign(el("input", "input"), { type: "date" }));
  const step = field("One frame per", el("select", "input"));
  const season = field("Each year covers", el("select", "input"));
  const seasonRow = season.parentElement;

  TW.fillCadences(step, source.cadences || undefined, source.defaultCadence || null);
  TW.fillSeasons(season, source.seasons || undefined);
  // A source with one season has no choice to offer, so it is not asked.
  if ((source.seasons || []).length === 1) seasonRow.hidden = true;

  const range = source.defaultWindow?.() || {};
  from.value = range.from || "";
  to.value = range.to || "";

  /**
   * The consent line. Said BEFORE the press and recomputed on every keystroke,
   * because the number of frames is what a reader is agreeing to when the
   * source bills per render — and because a plan that cannot be made should
   * say why here rather than after a click.
   */
  const cost = el("p", "compact-copy geoid-time-cost");
  cost.style.cssText = "margin:0.35rem 0 0;opacity:0.8;";
  const actions = el("div", "gis-btn-row");
  actions.style.marginTop = "0.35rem";
  const play = Object.assign(el("button", "tool-button", "Play over time"), { type: "button" });
  const stop = Object.assign(el("button", "button", "Stop"), { type: "button" });
  actions.append(play, stop);
  body.append(cost, actions);
  const status = el("p", "compact-copy");
  status.style.cssText = "margin:0.35rem 0 0;opacity:0.75;";
  body.appendChild(status);

  let plan = null;
  const replan = () => {
    const read = TW.normaliseWindow({
      from: from.value, to: to.value, step: step.value, season: season.value,
    });
    if (!read.ok) {
      plan = null;
      cost.textContent = read.error;
      play.disabled = true;
      return;
    }
    plan = TS.planSeries(source, read.window);
    // A plan's own summary already counts frames and requests; the window's
    // description says which span, which the dates alone do not.
    cost.textContent = plan.ok
      ? `${TW.describeWindow(read.window)} — ${plan.summary}`
      : plan.error;
    play.disabled = !plan.ok;
  };
  [from, to, step, season].forEach((node) => {
    node.addEventListener("change", replan);
    node.addEventListener("input", replan);
  });
  replan();

  play.addEventListener("click", async () => {
    if (!plan?.ok) return;
    const bounds = await source.boundsOf?.();
    if (!bounds) {
      status.textContent = source.noBoundsMessage
        || "Choose the ground first — draw an area or pick a layer.";
      return;
    }
    status.textContent = `Building ${plan.epochs.length} frames…`;
    try {
      await source.run({
        bounds,
        window: TW.normaliseWindow({
          from: from.value, to: to.value, step: step.value, season: season.value,
        }).window,
        plan,
        onStatus: (message) => { status.textContent = message; },
      });
    } catch (error) {
      status.textContent = error?.message || "That sequence could not be built.";
    }
  });

  stop.addEventListener("click", async () => {
    const player = await import(`./timelapse-player.js${search}`);
    player.stopPlayer();
    status.textContent = "";
  });

  host.appendChild(box);
  return { box, replan };
}
