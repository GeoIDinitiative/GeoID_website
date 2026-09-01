/**
 * WHAT AN ICE POLYGON SAYS WHEN YOU CLICK IT.
 *
 * The ice layers already opened the ordinary feature card — they are ordinary
 * layers — and the card said the wrong things about them, because everything
 * it knows how to say was written for a rock. Measured on the Ross Ice Shelf:
 * kicker "Continental", which is `crustalSetting` answering about a polygon
 * floating on 500 m of seawater; no source; no date; nothing anywhere saying
 * whether the ice is grounded or afloat.
 *
 * So this is the one place that turns an ice polygon into the three lines and
 * the rows a card wants, and BOTH card paths use it: the tiled RGI inventory
 * builds its features in `geology-panel.js`, while the ice sheets, the shelves
 * and the live GLIMS outlines are ordinary imports built in `feature-popup.js`.
 * One implementation, so a glacier reads the same however it arrived.
 *
 * Pure, and tested in Node against the properties the three sources really
 * carry — `ice-cover.test.mjs`.
 */

/** RGI's own first-order regions, in its own words, keyed by its own codes. */
export const RGI_REGIONS = {
  "01": "Alaska", "02": "Western Canada and USA", "03": "Arctic Canada, North",
  "04": "Arctic Canada, South", "05": "Greenland periphery", "06": "Iceland",
  "07": "Svalbard and Jan Mayen", "08": "Scandinavia", "09": "Russian Arctic",
  "10": "North Asia", "11": "Central Europe", "12": "Caucasus and Middle East",
  "13": "Central Asia", "14": "South Asia, West", "15": "South Asia, East",
  "16": "Low latitudes", "17": "Southern Andes", "18": "New Zealand",
  "19": "Subantarctic and Antarctic islands",
};

/**
 * The `kind` each source stamps on its features, and what the card leads with.
 *
 * GROUNDED OR FLOATING IS THE FIRST THING TO SAY about the two big ones. A
 * shelf is the ice sheet's outflow afloat on the sea, already displacing its
 * own weight of water, so it is the half of Antarctica's ice whose loss does
 * NOT raise sea level directly — and a card that calls it "Continental",
 * as this one did, is saying the opposite of the truth.
 */
const KINDS = {
  "Glacier or ice cap": {
    kicker: "Glacier or ice cap", source: "Randolph Glacier Inventory 7.0",
  },
  "Ice sheet": {
    kicker: "Ice sheet — grounded", source: "Natural Earth 10m",
  },
  "Ice shelf": {
    kicker: "Ice shelf — floating", source: "Natural Earth 10m",
  },
  "Glacier outline (GLIMS)": {
    kicker: "Glacier outline — GLIMS archive", source: "GLIMS",
  },
  "Glacier change (GLIMS)": {
    /**
     * NOT "repeat outlines", which is how the layer is MADE rather than what
     * the card is about — reported as not making sense, and it does not.
     *
     * Nor "vol. change", which was the wording asked for: what two outlines
     * give is an AREA, and volume through time is not in this data (IceBoost
     * is a single epoch). The card would then be claiming a measurement it
     * cannot show.
     */
    kicker: "Glacier — change over time", source: "GLIMS",
  },
};

/** Does this feature belong to one of the ice layers? */
export function isIceFeature(props) {
  return Boolean(props && KINDS[String(props.kind || "")]);
}

/**
 * THE NAME TABLE, injected rather than imported.
 *
 * This module is pure and is tested in Node; the names come off a 1.5 MB file
 * the browser fetches once. So the panel hands the lookup in and the card asks
 * it — no fetch in here, and the tests can hand it a table of two.
 */
let lookupName = () => null;
let lookupVolume = () => null;

export function useIceNames(lookup) {
  lookupName = typeof lookup === "function" ? lookup : () => null;
}

/** The same arrangement for the ice VOLUME table — see `ice-thickness.js`. */
export function useIceVolumes(lookup) {
  lookupVolume = typeof lookup === "function" ? lookup : () => null;
}

const text = (value) => {
  const out = String(value ?? "").trim();
  return out && out !== "null" && out !== "undefined" ? out : null;
};

/** A number a person reads: 88.6, 0.0132, 8,087. */
const fmt = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n >= 100) return Math.round(n).toLocaleString();
  if (n >= 1) return n.toFixed(1);
  if (n >= 0.01) return n.toFixed(3);
  return n.toPrecision(2);
};

const km2 = (value) => (Number.isFinite(Number(value))
  ? `${Number(Number(value).toFixed(Number(value) < 100 ? 2 : 0)).toLocaleString()} km²`
  : null);

/**
 * The card's three lines and its rows, for one ice polygon.
 *
 * The TITLE is the ice's own name where it has one, and most of this ice has
 * none: RGI names about a tenth of its complexes and GLIMS about a fifteenth of
 * its outlines. An unnamed glacier is not a nameless one — it is a mapped ice
 * mass with an id and a region — so it is titled by WHERE it is rather than by
 * "Unnamed", which says nothing and reads like a fault.
 */
export function iceCard(props = {}) {
  const kind = String(props.kind || "");
  const spec = KINDS[kind];
  if (!spec) return null;
  /**
   * The feature's own name first — GLIMS and Natural Earth carry one — then
   * the table, which is where every RGI complex's name lives. RGI itself has
   * no name column for a complex at all.
   */
  const found = text(props.name) || text(props.glac_name)
    ? null : lookupName(props.rgi_id);
  const name = text(props.name) || text(props.glac_name) || (found?.name ?? null);
  const region = RGI_REGIONS[text(props.o1region)] || null;
  const published = props.area_km2 ?? props.db_area;

  const title = name
    || (region ? `Glacier complex, ${region}` : null)
    || (kind === "Glacier outline (GLIMS)" ? "Glacier outline" : kind);

  /**
   * The META line is what the title is NOT. A named shelf says what it is
   * made of; an unnamed complex has already said where it is, so it says its
   * id instead — the handle you would use to look it up.
   */
  const meta = [];
  if (name && region) meta.push(region);
  // A named sheet or shelf has no region and needs no restatement of its kind:
  // the kicker directly above already says "Ice shelf — floating". What it does
  // not say is WHO mapped it, so that is the line.
  if (name && !region && kind !== "Glacier outline (GLIMS)") meta.push(spec.source);
  const id = text(props.rgi_id) || text(props.glac_id);
  if (id && (!name || !region)) meta.push(id);
  const date = text(props.outline_date) || text(props.src_date)?.slice(0, 10);
  if (date) meta.push(`imagery ${date}`);

  /**
   * The PUBLISHED area, beside the card's own measured one.
   *
   * They are different facts and they disagree: the card measures the polygon
   * it drew, generalised to whatever level the tiles were baked at, while RGI
   * publishes the area its own analysis found. Showing only ours would be
   * quietly restating the source at our precision.
   */
  const rows = [];
  const area = km2(published);
  if (area) rows.push([kind === "Glacier or ice cap" ? "Published area (RGI)" : "Published area", area]);

  /**
   * HOW MUCH ICE, on the card's own face rather than in a fold.
   *
   * The volume is the number every downstream question needs — melt, runoff,
   * sea level — and it is the one thing an outline cannot say. It comes with
   * its uncertainty because the model's own is tens of percent: a volume
   * printed alone would be read as a measurement.
   *
   * MEAN THICKNESS is derived here rather than tabulated, from the volume and
   * the published area — it is the shape of the number a reader pictures, and
   * deriving it keeps the table to what the model actually produces.
   */
  /**
   * A CHANGE IS TWO READINGS, so the card shows both and the span between
   * them. The rate is a percentage of the first area per year and nothing
   * more: an outline moving is not the same measurement as ice being lost, and
   * the card must not let the second be read out of the first.
   */
  if (kind === "Glacier change (GLIMS)") {
    const pct = Number(props.change_pct);
    const rate = Number(props.change_pct_yr);
    const headline = [];
    if (Number.isFinite(pct)) {
      headline.push(["Area change",
        `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%  (${fmt(props.first_area_km2)} → `
        + `${fmt(props.last_area_km2)} km²)`]);
    }
    if (Number.isFinite(rate)) {
      headline.push(["Rate", `${rate > 0 ? "+" : ""}${rate.toFixed(2)}% a year`]);
    }
    headline.push(["Between", `${props.first_date} and ${props.last_date}`
      + `  ·  ${props.span_years} years`]);
    return {
      kicker: spec.kicker,
      title: name || "Glacier outline",
      /**
       * NO META LINE. The id and the outline count were on it, under the
       * glacier's name — plumbing where the card's second line should be
       * saying something about the ice. Both are still here, in the rows,
       * which is where a handle and a tally belong.
       */
      meta: "",
      rows: [
        ["GLIMS id", text(props.glac_id) || "—"],
        ["Outlines in the archive", String(props.outlines ?? "—")],
        ...(text(props.archive_coverage)
          ? [["This fetch held", text(props.archive_coverage)]] : []),
        ["Read from", "Two GLIMS outlines — different dates, and usually "
          + "different analysts and instruments"],
        ["What it is not", "An area change is not a mass balance: a glacier "
          + "can thin for years without its outline moving, and late snow can "
          + "make an outline larger than the ice under it"],
      ],
      source: spec.source,
      publishedArea: km2(props.last_area_km2),
      headline,
    };
  }

  const ice = lookupVolume(props.rgi_id);
  const headline = [];
  if (ice?.volumeKm3) {
    headline.push(["Ice volume", `${fmt(ice.volumeKm3)} ± ${fmt(ice.errorKm3)} km³`]);
    const areaKm2 = Number(published);
    if (Number.isFinite(areaKm2) && areaKm2 > 0) {
      headline.push(["Mean thickness",
        `${Math.round((ice.volumeKm3 / areaKm2) * 1000).toLocaleString()} m`]);
    }
    /**
     * Sea-level equivalent, and the two things it must not pretend. It is what
     * this ice would ADD if all of it melted — not a forecast — and the part
     * already below sea level is subtracted because it is already displacing
     * its own volume.
     */
    headline.push(["Sea-level equivalent",
      `${ice.seaLevelMm >= 0.01 ? ice.seaLevelMm.toFixed(2) : ice.seaLevelMm.toFixed(3)} mm`]);
    rows.push(["Ice volume source", "IceBoost v2.0 (Maffezzoli 2026), CC BY 4.0"]);
  }
  if (region) rows.push(["RGI region", region]);
  if (id) rows.push([kind === "Glacier or ice cap" ? "RGI id" : "GLIMS id", id]);
  if (date) rows.push(["Imagery date", date]);
  /**
   * WHERE THE NAME CAME FROM, because it did not come from the polygon.
   * RGI names a glacier and this names the COMPLEX, which is a different
   * claim — and a gazetteer name is a match by position, not by identity.
   */
  if (found?.source) {
    rows.push(["Name from", found.source === "RGI"
      ? "RGI 7.0 (this complex is that glacier)"
      : "GeoNames (CC BY 4.0), matched by position"]);
  }
  if (text(props.note)) rows.push(["Note", text(props.note)]);

  /**
   * The published area is handed back on its own as well as in the rows,
   * because it is the one number a reader wants without opening a fold — and
   * it is NOT the area the card measures for itself, which is the drawn
   * polygon at whatever level the tiles were baked at.
   */
  return {
    kicker: spec.kicker, title, meta: meta.join("  ·  "), rows,
    source: spec.source, publishedArea: area,
    /** The lines the card shows without opening anything. */
    headline,
  };
}

if (typeof window !== "undefined") {
  window.GeoIDIceCard = { isIceFeature, iceCard, RGI_REGIONS };
}
