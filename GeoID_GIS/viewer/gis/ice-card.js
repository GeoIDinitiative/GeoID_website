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

export function useIceNames(lookup) {
  lookupName = typeof lookup === "function" ? lookup : () => null;
}

const text = (value) => {
  const out = String(value ?? "").trim();
  return out && out !== "null" && out !== "undefined" ? out : null;
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
  };
}

if (typeof window !== "undefined") {
  window.GeoIDIceCard = { isIceFeature, iceCard, RGI_REGIONS };
}
