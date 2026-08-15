// Shared search-text primitives (tool-ux-spec.md section 2). The tool palette
// and the Research Hub page search must stay ONE algorithm, so the proven
// pieces of atlas-assistant.js's page search live here and both sides import
// them instead of keeping drifting copies.
//
// STOPWORDS is moved VERBATIM from atlas-assistant.js:155-162. Without the
// strip, "WHERE do I do meshing?" matched the Metadata & Lineage blurb "WHERE
// every file came from" -- the question's grammar outvoted its subject and the
// answer was confidently wrong. Deliberately only interrogatives and
// auxiliaries: "run", "data", "mesh" and friends are real page and tool words
// and must survive.
export const STOPWORDS = new Set([
  "the", "and", "for", "are", "you", "your", "this", "that", "with", "from",
  "where", "what", "how", "why", "when", "which", "who", "does", "did", "can",
  "could", "should", "would", "will", "shall", "there", "they", "them", "then",
  "have", "has", "had", "been", "was", "were", "into", "onto", "out", "about",
  "get", "got", "put", "see", "look", "find", "want", "need", "please", "help",
  "any", "all", "some", "more", "most", "just", "now", "here",
]);

/** Light stemming, so "meshing"/"meshes" both reach "Mesh" and "buffering"
    reaches "Buffer". `|| word` keeps a word that IS its own suffix ("es"). */
export function stem(word) {
  return word.replace(/(ings?|ed|es|s)$/, "") || word;
}

/**
 * Query text to scoring tokens. Two deliberate deltas from the original page
 * search (spec section 2), both needed for tools: the token pattern admits
 * digits and length-2 words, because "idw", "tin", "2d" and "dem" are tool
 * vocabulary the old [a-z]{3,} silently dropped; and stemming applies to the
 * query side, as it does today.
 */
export function tokenize(q) {
  return (q.toLowerCase().match(/[a-z0-9]{2,}/g) || [])
    .filter((w) => !STOPWORDS.has(w))
    .map(stem);
}
