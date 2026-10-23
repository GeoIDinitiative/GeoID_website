// node social/js/embed.test.mjs — parsing only; the DOM parts are not loaded.
import assert from "node:assert/strict";

globalThis.document = globalThis.document || { createElement: () => ({}) };
const { parseVideoLink } = await import("./embed.js");

let passed = 0;
const ok = (name, fn) => { fn(); passed += 1; console.log(`ok  ${name}`); };

ok("every common YouTube address resolves to the no-cookie player", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
  ]) {
    const v = parseVideoLink(url);
    assert.equal(v?.provider, "youtube", url);
    assert.equal(v.id, "dQw4w9WgXcQ");
    assert.ok(v.embedUrl.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?"));
  }
});

ok("a start time carries over", () => {
  assert.match(parseVideoLink("https://youtu.be/dQw4w9WgXcQ?t=42").embedUrl, /start=42/);
});

ok("Vimeo, public and unlisted (with its hash), with do-not-track", () => {
  const v = parseVideoLink("https://vimeo.com/76979871");
  assert.equal(v.provider, "vimeo"); assert.equal(v.id, "76979871");
  assert.match(v.embedUrl, /^https:\/\/player\.vimeo\.com\/video\/76979871\?autoplay=1&dnt=1$/);
  const unlisted = parseVideoLink("https://vimeo.com/76979871/abc123def4");
  assert.match(unlisted.embedUrl, /h=abc123def4/);
});

ok("anything else is not a video", () => {
  for (const url of ["https://example.org/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", "https://youtube.com/watch?v=<script>",
    "https://youtube.com/watch?v=short", "not a url", "https://vimeo.com/channels/staffpicks"]) {
    assert.equal(parseVideoLink(url), null, url);
  }
});

console.log(`\n${passed} passed`);
