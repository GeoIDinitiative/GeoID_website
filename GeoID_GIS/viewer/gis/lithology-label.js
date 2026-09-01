/**
 * A `lith` STRING IS A DATA FORMAT, and the card was printing it raw.
 *
 * Macrostrat's lithology column carries the survey's own proportions in a
 * brace syntax — `Major:{claystone}, Minor{siltstone,sandstone,gypsum}` — and
 * the geology card used it verbatim as its heading, braces, colons and all.
 * Measured on one view of the world layer: **203 of 299 distinct lith strings
 * are in that form**, so this is the normal case rather than an oddity.
 *
 * This is DISPLAY ONLY. `rock-properties.js` reads the same string for the
 * property lookup and must keep receiving it verbatim: the proportion words
 * are what weight a mixture, and a prettified string is a second spelling for
 * its parser to learn.
 */

/** The proportion words the compilations use, `Major:` colon and all. */
const GROUP = /(major|minor|incidental|subordinate|accessory|trace)\s*:?\s*\{([^}]*)\}/gi;

function tidy(text) {
  return String(text).replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
}

function upperFirst(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * The terms of one group, in order, with the empties dropped.
 *
 * Split on the comma and rejoined with one — which is IDENTITY for the terms
 * that carry a comma of their own ("carbonates, consolidated", "gypsum,
 * anhydrite"), so a display split cannot damage them. `rock-properties.js`
 * has to work harder because it must resolve each term against a dictionary;
 * a reader only needs the list to read as a list.
 */
function terms(body) {
  return String(body).split(",").map((t) => tidy(t)).filter(Boolean);
}

/**
 * The lithology as a person would write it.
 *
 * `Major:{claystone}, Minor{siltstone,sandstone,gypsum}`
 *   → `Claystone — minor siltstone, sandstone, gypsum`
 *
 * The proportion WORD is kept rather than dropped: "minor" is the difference
 * between a claystone and a claystone with some gypsum in it, and a landslide
 * or an aquifer cares which. Anything without braces is passed through with
 * its first letter raised, because most surveys write plain prose there.
 */
export function lithologyLabel(raw) {
  const text = tidy(raw ?? "");
  if (!text) return "";

  const groups = [];
  GROUP.lastIndex = 0;
  let match;
  while ((match = GROUP.exec(text))) {
    const list = terms(match[2]);
    if (list.length) groups.push([match[1].toLowerCase(), list]);
  }

  if (!groups.length) {
    // No proportions to read — but a stray brace still must not reach the
    // card, and a survey that writes `{sandstone}` has been seen.
    return upperFirst(tidy(text.replace(/[{}]/g, " ")));
  }

  /**
   * A rock is named ONCE, at its strongest mention.
   *
   * `Minor{limestone,siltstone,limestone}` is real and in the live data, and a
   * heading that says limestone twice reads as a mistake in the map rather
   * than in the string.
   */
  const seen = new Set();
  const kept = [];
  for (const [word, list] of groups) {
    const fresh = list.filter((term) => {
      const key = term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (fresh.length) kept.push([word, fresh]);
  }

  const major = kept.filter(([word]) => word === "major").flatMap(([, list]) => list);
  const rest = kept.filter(([word]) => word !== "major");
  const head = major.join(", ");
  const tail = rest.map(([word, list]) => `${word} ${list.join(", ")}`).join("; ");
  if (head && tail) return upperFirst(`${head} — ${tail}`);
  return upperFirst(head || tail);
}

if (typeof window !== "undefined") {
  window.GeoIDLithologyLabel = { lithologyLabel };
}
