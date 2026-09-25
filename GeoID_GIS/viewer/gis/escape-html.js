/**
 * Escaping a value that came from somewhere else, before it becomes markup.
 *
 * WHY THIS EXISTS. Most of this app builds its DOM with `textContent` and
 * `createElement`, which cannot inject anything — but a handful of places
 * build a small run of markup with a template literal and set `innerHTML`,
 * and four of them were interpolating a value that did not come from this
 * codebase:
 *
 *   - an attribute VALUE from a layer, in the attribute query's result
 *     summary. A GeoJSON, a shapefile or a CSV somebody drops on the globe
 *     carries whatever its author put in it, and so does a vector tile from
 *     Macrostrat, a fault name from GEM and a glacier name from GLIMS;
 *   - a file EXTENSION, in the layer summary, which is the tail of a name
 *     somebody chose;
 *   - a physical group's NAME and a field's UNIT, out of a `.msh` or a GALES
 *     run opened in the Meshing Studio;
 *   - a data-registry TYPE, out of a project folder that may have been
 *     shared.
 *
 * None of those is a string this app wrote, and `innerHTML` does not care
 * where a string came from: `<img src=x onerror=…>` in a feature property is
 * script, running on this origin, with whatever the page can reach.
 *
 * THE RULE THIS FILE IS FOR: a value that did not come from this codebase is
 * escaped before it is interpolated into markup, or it goes in through
 * `textContent` and is not interpolated at all. The second is better wherever
 * the surrounding markup is not doing real work; this is for the places where
 * it is.
 *
 * `'` is escaped as well as `"`, so the same function is safe inside a
 * single-quoted attribute; `&` goes first, or the escapes are escaped.
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


/**
 * A URL that came from a feed, safe to put in an `href`.
 *
 * ESCAPING IS NOT ENOUGH FOR A LINK. `javascript:alert(1)` contains no
 * character `escapeHtml` touches, so an escaped value is still script the
 * moment somebody clicks it — and `data:` and `vbscript:` are the same
 * family. The scheme is what has to be checked, and it has to be checked on
 * the PARSED url rather than on the string, because `java\tscript:` and
 * `  javascript:` are both `javascript:` to a browser and neither starts with
 * the letters a prefix test looks for.
 *
 * Answers "" for anything that is not http or https, which every caller
 * treats as "no link" — an absent link is a worse page and a live
 * `javascript:` link is a compromised one.
 */
export function safeUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://geoidinitiative.com/");
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return escapeHtml(url.href);
  } catch (error) {
    return "";
  }
}

export default escapeHtml;
