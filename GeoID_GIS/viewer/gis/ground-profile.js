/**
 * WHAT IS UNDER THIS POINT, from every map that knows something about it.
 *
 * Three datasets describe the ground here and each answers a different
 * question, at a different resolution, over a different extent:
 *
 *   * **Superficial deposits (BGS, 1:625,000, UK only)** — what the
 *     unconsolidated material IS, mapped: till, alluvium, peat, sand and
 *     gravel. The finest of the three, and the one with a border.
 *   * **Soils of the world (FAO/UNESCO, 1:5,000,000, global)** — what soil has
 *     formed at the top of it, with FAO's own measured sand/silt/clay, pH,
 *     organic carbon and bulk density per unit.
 *   * **Soil and sediment thickness (Pelletier, 1 km, global, modelled)** — how
 *     MUCH there is above bedrock.
 *
 * Plus the slope from the streamed DEM, because the material and the depth
 * only mean something on a gradient.
 *
 * WHY THIS IS NOT A BLENDED LAYER, which is the first thing anybody proposes.
 * Painting them into one raster would make a map whose meaning changes at the
 * UK border — 1:625,000 mapped geology inside it, a 1:5,000,000 generalisation
 * outside — with nothing on the pixel to say which. That is the same fault as
 * a picture claiming a precision its source never had, and it destroys the
 * most useful thing here: where BGS maps 3 m of till and Pelletier models 12 m,
 * the DISAGREEMENT is the signal. So every field keeps its own source and its
 * own scale, and the card says so on every line.
 *
 * The profile is also exactly what the Factor of Safety model wants — c′, φ′
 * and γ from the material, z from the thickness, β from the slope — which is
 * the point of assembling it rather than reading three cards.
 */

import { materialFor } from "./fos.js?v=20260905-38a6fb3";

/** Which loaded layer is which, by what its name says it is. */
const SUPERFICIAL = /superficial|drift|quaternary/i;
const SOIL_MAP = /soils of the world|fao|dsmw/i;

/**
 * The failure plane of a shallow translational slide is not the base of a
 * sediment basin.
 *
 * Pelletier models the whole permeable column — up to 50 m in a valley fill —
 * and the infinite-slope model assumes a plane PARALLEL to the ground and long
 * compared with its depth. Handing it 50 m would answer a question nobody
 * asked, about a rotational failure the model cannot represent. So the depth
 * offered to FoS is capped, and the card says both numbers rather than quietly
 * substituting one for the other.
 */
export const SHALLOW_FAILURE_CAP_M = 3;

function firstHit(hits, pattern) {
  return hits.find(({ layer }) => pattern.test(layer?.name || "")) || null;
}

/**
 * A SOIL UNIT'S NAME IS NOT A MATERIAL, but its texture is.
 *
 * `materialFor` matches lithology words — till, clay, sand, peat — which a
 * superficial map says outright and a FAO unit name never does: "Dystric
 * Cambisols" matched nothing, so every point outside the UK fell to the
 * strength table's no-information default. FAO publishes the topsoil's sand,
 * silt and clay percentages per unit, and the dominant fraction IS a material
 * keyword the table already holds.
 *
 * Crude, and the card says so: this is the unit's typical texture, not a
 * measurement of this hillside, and a texture class is not a survey's mapped
 * deposit. It is still an answer drawn from the data instead of a default
 * standing in for one.
 */
/**
 * A card's own feature, back into the properties this module reads.
 *
 * The catalogue holds cards, not survey columns: `soil-card.js` has already
 * turned FAO's sand, silt and clay into display rows by the time a feature
 * reaches it. Reading them back is inelegant and it is the honest option —
 * the alternative is a profile that goes quiet exactly when the tiles are
 * still settling, which is when somebody is most likely to be clicking.
 */
function fromCard(feature) {
  const props = { name: feature.rock_type || feature.name || null };
  const numeric = { Sand: "sand_pct", Silt: "silt_pct", Clay: "clay_pct" };
  for (const [label, value] of feature.rows || []) {
    const key = numeric[label];
    if (!key) continue;
    const n = Number.parseFloat(String(value));
    if (Number.isFinite(n)) props[key] = n;
  }
  return props;
}

function textureKeyword(properties = {}) {
  const parts = [["sand", properties.sand_pct], ["silt", properties.silt_pct],
    ["clay", properties.clay_pct]].filter(([, v]) => Number.isFinite(v));
  if (parts.length < 2) return null;
  const [name, pct] = parts.sort((a, b) => b[1] - a[1])[0];
  return { name, pct };
}

/** What a polygon says its material is, in the words its own survey used. */
function describe(feature) {
  const p = feature?.properties || {};
  return [p.rcs_d, p.lex_d, p.rock_type, p.lithology, p.lith, p.description,
    p.name, p.unit, p.code].filter(Boolean).join(" ");
}

/**
 * Assemble the profile. Everything is synchronous except the thickness, which
 * reads one cell out of the COG — 35-60 ms warm, and the caller already has a
 * pattern for the first read of a session being slower.
 */
export async function profileAt(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const hits = window.GeoIDFeaturePopup?.featuresAt?.(lat, lon) || [];

  let superficialHit = firstHit(hits, SUPERFICIAL);
  let soilHit = firstHit(hits, SOIL_MAP);

  /**
   * THE TILED MAPS ARE HELD TWICE, and the two copies are not always in step.
   *
   * The FAO soils arrive as a `geologyDataset`, so the viewer keeps its own
   * interactive catalogue of their polygons AND the import manager keeps the
   * layer's features. The card is drawn from the catalogue; `featuresAt` reads
   * the layer. Measured: click on Donegal three seconds after flying there and
   * the card names Dystric Cambisols while `featuresAt` finds nothing at the
   * same coordinate — the layer's features had not caught up with the tiles.
   * The profile then quietly dropped the two rows the click was most about.
   *
   * So where the layer has no answer, the catalogue the card itself came from
   * is asked. Not instead: the layer's copy carries the full properties and is
   * preferred when it is there.
   */
  if (!superficialHit && !soilHit) {
    const carded = window.GeoIDViewer?.getGeologyFeatureAtLatLon?.(lat, lon);
    const named = carded?.source_layer || "";
    if (carded && SUPERFICIAL.test(named)) {
      superficialHit = { layer: { name: named }, feature: { properties: fromCard(carded) } };
    } else if (carded && SOIL_MAP.test(named)) {
      soilHit = { layer: { name: named }, feature: { properties: fromCard(carded) } };
    }
  }

  let thickness = null;
  try {
    const sample = await window.GeoIDSoilThickness?.sampleAt?.(lat, lon);
    if (sample) {
      thickness = {
        metres: sample.outside ? null : sample.metres,
        outside: Boolean(sample.outside),
        source: "Pelletier et al. (2016)",
        scale: "1 km grid, modelled",
      };
    }
  } catch { /* the sheet may not be loaded; the profile says so */ }

  const slopeDeg = window.GeoIDViewer?.estimateSurfaceSlopeDegrees?.(lat, lon);
  const slope = Number.isFinite(slopeDeg)
    ? { degrees: slopeDeg, source: "Streamed DEM", scale: "Horn 3x3 at the view's own grid" }
    : null;

  /**
   * THE MATERIAL IS THE BEST-MAPPED ANSWER, NOT A BLEND. Superficial geology
   * where it exists, because it is eight times the scale and it is what the
   * strength table is keyed on; the soil unit where it does not. The profile
   * records WHICH, because a c′ from a 1:625,000 map and a c′ from a
   * 1:5,000,000 one are not the same claim.
   */
  const from = superficialHit ? "superficial" : soilHit ? "soil" : null;
  const texture = soilHit && !superficialHit
    ? textureKeyword(soilHit.feature?.properties) : null;
  const description = superficialHit ? describe(superficialHit.feature)
    : texture ? texture.name
      : soilHit ? describe(soilHit.feature) : "";
  const material = from
    ? { ...materialFor(description), from, description, texture } : null;

  return {
    lat,
    lon,
    /** Whether the map was asked, as distinct from whether it answered. */
    superficialLoaded: hits.some(({ layer }) => SUPERFICIAL.test(layer?.name || ""))
      || (window.GeoIDImportManager?.getLayers?.() || [])
        .some((layer) => SUPERFICIAL.test(layer?.name || "")),
    superficial: superficialHit ? {
      feature: superficialHit.feature,
      layer: superficialHit.layer,
      source: "BGS",
      scale: "1:625,000, UK only",
    } : null,
    soil: soilHit ? {
      feature: soilHit.feature,
      layer: soilHit.layer,
      source: "FAO/UNESCO DSMW",
      scale: "1:5,000,000, global",
    } : null,
    thickness,
    slope,
    material,
    /** What FoS should use for z here, and why it is not the thickness. */
    failureDepth: Number.isFinite(thickness?.metres)
      ? Math.min(thickness.metres, SHALLOW_FAILURE_CAP_M) : null,
  };
}

const metres = (v) => (Number.isFinite(v)
  ? (Number.isInteger(v) ? `${v} m` : `${v.toFixed(1)} m`) : null);

/** Title-case a survey's shouted name, as `soil-card.js` does. */
function tidy(name) {
  return String(name || "").replace(/\b[A-Z]{2,}\b/g,
    (word) => word[0] + word.slice(1).toLowerCase());
}

/**
 * The profile as card rows — every line carrying the source it came from,
 * because that is the whole argument for not blending them.
 */
export function profileRows(profile) {
  if (!profile) return [];
  const rows = [];

  if (profile.superficial) {
    const p = profile.superficial.feature?.properties || {};
    rows.push(["Superficial deposit",
      `${tidy(p.rcs_d || p.lex_d || p.name || p.description || "mapped")} `
      + `— ${profile.superficial.source} ${profile.superficial.scale}`]);
  } else {
    /**
     * A LAYER THAT IS NOT LOADED IS NOT A PLACE THAT IS NOT MAPPED, and the
     * card said the second when it meant the first. "Not mapped here" over
     * County Donegal reads as a statement about Donegal; it was a statement
     * about which tabs are ticked.
     */
    rows.push(["Superficial deposit", profile.superficialLoaded
      ? "not mapped here — BGS covers the UK only"
      : "no superficial map loaded — tick BGS superficial deposits to include it"]);
  }

  if (profile.soil) {
    const p = profile.soil.feature?.properties || {};
    rows.push(["Soil unit",
      `${tidy(p.name || p.code || "unmapped")} — ${profile.soil.source}, `
      + `${profile.soil.scale}`]);
  }

  if (profile.thickness) {
    const t = profile.thickness;
    rows.push(["Thickness above bedrock",
      t.outside ? "outside the model (south of 60°S)"
        : Number.isFinite(t.metres)
          ? `${metres(t.metres)} — ${t.source}, ${t.scale}`
          : `not modelled here — ${t.source}`]);
  }

  if (profile.slope) {
    rows.push(["Slope", `${profile.slope.degrees.toFixed(1)}° — ${profile.slope.source}`]);
  }

  if (profile.material) {
    const m = profile.material;
    const basis = m.from === "superficial" ? "the superficial map's own deposit"
      : m.texture ? `the soil unit's typical texture, ${m.texture.pct.toFixed(0)}% ${m.texture.name}`
        : "the soil map";
    rows.push(["Screening strength",
      `${m.matched || "no match — the table's no-information default"}: `
      + `c′ ${m.cohesion} kPa, φ′ ${m.friction}°, γ ${m.unitWeight} kN/m³ `
      + `— from ${basis}`]);
  }

  if (Number.isFinite(profile.failureDepth)) {
    rows.push(["Depth to the failure plane",
      `${metres(profile.failureDepth)} — the modelled thickness capped at `
      + `${SHALLOW_FAILURE_CAP_M} m, because an infinite-slope model describes a `
      + "shallow plane parallel to the ground, not the base of a sediment basin"]);
  }

  return rows;
}

/** Is this layer one of the three the profile is assembled from? */
export function isGroundLayer(layer) {
  const name = layer?.name || "";
  return SUPERFICIAL.test(name) || SOIL_MAP.test(name)
    || /soil and sediment thickness/i.test(name);
}

/**
 * Put the profile on a card that has already opened.
 *
 * Appended rather than built into the card because the thickness is a read: the
 * card must not wait on the network to show what the click already knows. The
 * section arrives a frame or two later, in the card's own row style, under a
 * rule that says what it is.
 *
 * A ticket, because clicking twice quickly must not leave the first click's
 * profile under the second click's heading.
 */
let appendTicket = 0;

/**
 * TAKE THE LAST CARD'S PROFILE DOWN, and do it on every open rather than only
 * before appending a new one.
 *
 * `openGeoPopup` rebuilds the card by REFILLING its named elements — the
 * kicker, the title, the detail list — and anything appended alongside them
 * survives untouched. So a profile added to one card stayed under the next
 * one, and the next card was a different place: measured, a click on Donegal
 * showed the profile of a click made in the Bering Sea, with every field
 * plausible and every field wrong. A stale answer that looks fresh is worse
 * than no answer.
 */
export function clearProfileFrom(host) {
  appendTicket += 1;                       // any read in flight is now stale
  host?.querySelectorAll?.(".ground-profile-section").forEach((n) => n.remove());
}

/**
 * The hook every card goes through, wherever it was raised from.
 *
 * There are three paths to the same card and the profile has to be on all of
 * them: `feature-popup` for an imported vector layer, `geology-panel` for the
 * tiled maps — which is how the FAO soils actually arrive, as a
 * `geologyDataset`, so a hook on the vector path alone never fired for it —
 * and `soil-thickness` for the sheet's own click. `openGeoPopup` is where they
 * meet, so the hook is there and this is what it calls.
 *
 * It clears unconditionally and appends only for a ground card: that is what
 * stops one card's profile outliving it under the next.
 */
export function attachToCard(feature, lat, lon) {
  const host = document.querySelector("#geo-popup .geo-popup-scroll")
    || document.getElementById("geo-popup");
  clearProfileFrom(host);
  if (!host || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const named = feature?.source_layer || feature?.layer_name || "";
  // `soil` is the flag both the FAO card and the thickness card already set to
  // say their lines were written for a soil rather than a rock.
  if (!isGroundLayer({ name: named }) && !feature?.soil) return;
  appendProfileTo(host, lat, lon);
}

export function appendProfileTo(host, lat, lon) {
  if (!host) return;
  clearProfileFrom(host);
  const ticket = (appendTicket += 1);
  void (async () => {
    let rows = [];
    try {
      rows = profileRows(await profileAt(lat, lon));
    } catch (error) {
      console.warn("the ground profile could not be assembled:", error.message);
      return;
    }
    // The card may have been replaced while the thickness was read.
    if (ticket !== appendTicket || !host.isConnected || rows.length < 2) return;
    const section = document.createElement("div");
    section.className = "ground-profile-section";
    const head = document.createElement("p");
    head.className = "layer-type-badge";
    head.textContent = "Ground profile";
    section.appendChild(head);
    /**
     * EVERY LINE CARRIES ITS SOURCE. Three maps at three scales over three
     * extents, and the reader has to be able to tell a 1:625,000 answer from a
     * 1:5,000,000 one without leaving the card -- which is the whole reason
     * these are assembled rather than blended.
     */
    for (const [key, value] of rows) {
      const row = document.createElement("div");
      row.className = "scene-popup-detail-row";
      const k = document.createElement("span");
      k.className = "scene-popup-detail-key";
      k.textContent = key;
      const v = document.createElement("span");
      v.className = "scene-popup-detail-val";
      v.textContent = value;
      row.append(k, v);
      section.appendChild(row);
    }
    host.appendChild(section);
  })();
}

if (typeof window !== "undefined") {
  window.GeoIDGroundProfile = {
    profileAt, profileRows, appendProfileTo, clearProfileFrom, attachToCard,
    isGroundLayer, SHALLOW_FAILURE_CAP_M,
  };
}
