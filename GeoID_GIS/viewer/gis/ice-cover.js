/**
 * ICE COVER IS NOT GEOLOGY, and it was sitting in the geological map.
 *
 * Macrostrat's global compilation maps the ice sheets as ordinary polygons —
 * named "Phanerozoic ice", carrying no lithology at all — in the same tiles as
 * the bedrock. Measured on the live layer: **13 of 53 features over Antarctica,
 * 24.5%**, and 33 over Greenland. So a geological map of those places is
 * substantially a map of what is lying ON TOP of the geology, and the rock
 * underneath is hidden by it.
 *
 * They are also the reason a rock-property map over the poles reads oddly: ice
 * has real properties and they are nothing like a rock's, so an ice sheet
 * painted into a strength map is a genuine value answering a question nobody
 * asked of it.
 *
 * So `isIceCover` is ONE predicate, used three ways: the geology layer streams
 * everything it says no to, the Ice cover subtab streams everything it says
 * yes to, and both come off the same tiles and the same cache. Because the
 * tiler applies it at build, it governs the drawing, the click picker,
 * extraction and clipping alike rather than only the picture.
 *
 * WHY IT MATCHES ON THE NAME. These units carry a BLANK `lith` — the
 * compilation states no lithology for them, which is the same gap the
 * no-information prior exists for — so the lithology column cannot answer and
 * the unit's own name is the only thing that says what it is. The lithology is
 * still checked first, because a survey that does state one should be believed
 * over a name.
 */

/** `ice`, `snow`, `glacier`, `firn` — as WORDS, never as substrings. */
const ICE_WORDS = /(^|[^a-z])(ice|snow|glacier|glacial ice|firn|icefield|ice cap|ice sheet)([^a-z]|$)/i;

/**
 * Words that contain one of the above and are not ice.
 *
 * The word boundary already excludes `Iceland`, `pumice` and `service`, which
 * is most of the risk. This is for the compounds a boundary cannot help with,
 * and it is checked FIRST so a name like "Ice-contact glaciofluvial sand"
 * — which is a sand, deposited by ice, not ice — is not filed as an ice sheet.
 */
const NOT_ICE = /(ice-contact|ice-marginal|ice-rafted|glaciofluvial|glaciolacustrine|glaciomarine|glacigenic|glacial (till|drift|deposit|sediment|sand|gravel|clay))/i;

/**
 * Is this polygon ice cover rather than ground?
 *
 * Deliberately narrow. A glacial DEPOSIT is geology — a till is a soil with a
 * strength and a permeability, and it is exactly the material a landslide model
 * wants — so only the ice ITSELF is taken out of the geological map.
 */
export function isIceCover(feature) {
  const props = feature?.properties || {};
  const lith = String(props.lith ?? props.LITH ?? "").trim();
  const name = String(props.name ?? props.NAME ?? "").trim();
  if (NOT_ICE.test(`${lith} ${name}`)) return false;
  if (lith) return ICE_WORDS.test(lith);
  return ICE_WORDS.test(name);
}

/** The complement, for the layer that should hold everything else. */
export function isNotIceCover(feature) {
  return !isIceCover(feature);
}

if (typeof window !== "undefined") {
  window.GeoIDIceCover = { isIceCover, isNotIceCover };
}
